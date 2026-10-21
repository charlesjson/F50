#!/usr/bin/env python3
"""Bounded WebKitGTK diagnostic against the local UFI device (no setting writes)."""
import argparse
import base64
import json
import os
import signal
from pathlib import Path
import tempfile
import time

import gi
gi.require_version('Gtk', '3.0')
gi.require_version('WebKit2', '4.1')
from gi.repository import Gtk, WebKit2, GLib

parser = argparse.ArgumentParser()
parser.add_argument('--mode', choices=['raw', 'host'], default='host')
parser.add_argument('--address', default='http://192.168.0.1:2333/')
parser.add_argument('--seconds', type=int, default=45)
parser.add_argument('--saved-session', action='store_true')
parser.add_argument('--variant', choices=['normal', 'javascript-off', 'software', 'no-filters', 'no-backdrop'], default='normal')
parser.add_argument('--block-regex')
parser.add_argument('--limit-mib', type=int, default=1536)
parser.add_argument('--report', default='')
args = parser.parse_args()
address = args.address
scripts = []
if args.saved_session:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    profiles = json.loads((Path.home() / '.config/ufi-panel-linux/profiles.json').read_text())
    profile = next(p for p in profiles['profiles'] if p['address'].rstrip('/') == address.rstrip('/'))
    gi.require_version('Secret', '1')
    from gi.repository import Secret
    service = Secret.Service.get_sync(Secret.ServiceFlags.OPEN_SESSION, None)
    items = service.search_sync(None, {'application': 'io.ufi.panel.linux', 'purpose': 'tauri-profile-key-v1'}, Secret.SearchFlags.ALL | Secret.SearchFlags.LOAD_SECRETS, None)
    key = bytes(items[0].get_secret().get())
    if len(key) != 32: raise RuntimeError('Saved session key unavailable')
    encoded = base64.b64decode(profile['secret'])
    credentials = json.loads(AESGCM(key).decrypt(encoded[4:16], encoded[32:] + encoded[16:32], None))
    token = credentials['token']
    from urllib.parse import urlsplit
    parsed = urlsplit(address)
    origin = f'{parsed.scheme}://{parsed.netloc}'
    scripts.append('if(location.origin === ' + json.dumps(origin) + ') localStorage.setItem("kano_sms_token", ' + json.dumps(token) + ');')
    del credentials, token, key
if args.mode == 'host':
    source = Path(__file__).resolve().parents[2] / 'src-tauri/src/device-page-lifecycle.js'
    scripts.append(source.read_text())

manager = WebKit2.UserContentManager()
dom = {}
def diagnostic(_manager, result):
    global dom
    try: dom = json.loads(result.get_js_value().to_string())
    except Exception: pass
manager.register_script_message_handler('memoryProbe')
manager.connect('script-message-received::memoryProbe', diagnostic)
scripts.append('setInterval(() => window.webkit.messageHandlers.memoryProbe.postMessage(JSON.stringify({ready:document.readyState,nodes:document.querySelectorAll("*").length,canvases:[...document.querySelectorAll("canvas")].map(c=>[c.id,c.width,c.height]),frames:document.querySelectorAll("iframe").length})),250);')
if args.variant == 'no-filters':
    manager.add_style_sheet(WebKit2.UserStyleSheet.new('* { filter: none !important; backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }', WebKit2.UserContentInjectedFrames.ALL_FRAMES, WebKit2.UserStyleLevel.USER, None, None))
if args.variant == 'no-backdrop':
    css = (Path(__file__).resolve().parents[2] / 'src-tauri/src/device-page-compat.css').read_text()
    manager.add_style_sheet(WebKit2.UserStyleSheet.new(css, WebKit2.UserContentInjectedFrames.ALL_FRAMES, WebKit2.UserStyleLevel.USER, None, None))
for script in scripts:
    manager.add_script(WebKit2.UserScript.new(script, WebKit2.UserContentInjectedFrames.TOP_FRAME, WebKit2.UserScriptInjectionTime.START, None, None))
context = WebKit2.WebContext.new_with_website_data_manager(WebKit2.WebsiteDataManager.new_ephemeral())
view = WebKit2.WebView(user_content_manager=manager, web_context=context)
if args.variant == 'javascript-off': view.get_settings().set_enable_javascript(False)
if args.variant == 'software': view.get_settings().set_hardware_acceleration_policy(WebKit2.HardwareAccelerationPolicy.NEVER)
window = Gtk.Window(title='UFI · 内存诊断（只读）')
window.set_default_size(1180, 820)
window.add(view)
window.connect('destroy', lambda *_: Gtk.main_quit() if Gtk.main_level() else None)
window.show_all()
filter_directory = tempfile.TemporaryDirectory(prefix='ufi-memory-filter-')
if args.block_regex:
    store = WebKit2.UserContentFilterStore.new(filter_directory.name)
    rule = [{'trigger': {'url-filter': args.block_regex}, 'action': {'type': 'block'}}]
    def filter_ready(store, result, _data):
        manager.add_filter(store.save_finish(result)); view.load_uri(address)
    store.save('probe', GLib.Bytes.new(json.dumps(rule).encode()), None, filter_ready, None)
else:
    view.load_uri(address)
started = time.monotonic()
samples = []
failure = None

def memory():
    pids = {os.getpid()}
    statuses = []
    for path in Path('/proc').glob('[0-9]*/status'):
        try:
            fields = dict(line.split(':', 1) for line in path.read_text().splitlines() if ':' in line)
            statuses.append((int(path.parent.name), fields))
        except (OSError, ValueError): pass
    for _ in range(4):
        pids.update(pid for pid, fields in statuses if int(fields['PPid']) in pids)
    return [{'pid': pid, 'name': fields['Name'].strip(), 'rssKiB': int(fields.get('VmRSS', '0').split()[0]), 'swapKiB': int(fields.get('VmSwap', '0').split()[0])} for pid, fields in statuses if pid in pids]

def sample():
    global failure
    processes = memory()
    total = sum(p['rssKiB'] + p['swapKiB'] for p in processes)
    seconds = round(time.monotonic() - started, 2)
    row = {'second': seconds, 'totalKiB': total, 'processes': processes, 'dom': dom}
    samples.append(row)
    if len(samples) % 20 == 0: print(json.dumps(row), flush=True)
    if total > args.limit_mib * 1024:
        failure = f'Device WebKit memory exceeds {args.limit_mib} MiB; stopping before host pressure'
    if failure or seconds >= args.seconds:
        if failure:
            for item in processes:
                if item['name'] == 'WebKitWebProces':
                    try: os.kill(item['pid'], signal.SIGKILL)
                    except ProcessLookupError: pass
        Gtk.main_quit()
        return False
    return True

GLib.timeout_add(50, sample)
Gtk.main()
result = {'result': 'failed' if failure else 'passed', 'mode': args.mode, 'variant': args.variant, 'webkit': '.'.join(str(fn()) for fn in [WebKit2.get_major_version, WebKit2.get_minor_version, WebKit2.get_micro_version]), 'failure': failure, 'samples': samples}
out = Path(__file__).resolve().parents[2] / ('artifacts/' + (args.report or f'host-memory-{args.mode}-{args.variant}') + '.json')
out.write_text(json.dumps(result, indent=2))
view.load_uri('about:blank')
window.destroy()
filter_directory.cleanup()
raise SystemExit(1 if failure else 0)
