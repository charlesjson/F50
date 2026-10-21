'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawn } = require('node:child_process');
const { getFpmPath } = require('app-builder-lib/out/toolsets/linux');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'release');
const work = path.join(output, 'package-work');
const manifest = require('../package.json');
function run(executable, args, cwd = root, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, env, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${path.basename(executable)} exited with ${code}`)));
  });
}
async function install(source, target, mode = 0o644) {
  await fs.mkdir(path.dirname(target), { recursive: true }); await fs.copyFile(source, target); await fs.chmod(target, mode);
}
async function commonFiles(stage) {
  for (const [source, target, mode] of [
    ['packaging/linux/ufi-panel-linux.desktop', 'usr/share/applications/io.ufi.panel.linux.desktop'],
    ['assets/icon.png', 'usr/share/icons/hicolor/512x512/apps/ufi-panel-linux.png'],
    ['assets/icon.svg', 'usr/share/icons/hicolor/scalable/apps/ufi-panel-linux.svg'],
    ['LICENSE', 'usr/share/licenses/ufi-panel-linux/LICENSE'],
    ['packaging/INSTALL.md', 'usr/share/doc/ufi-panel-linux/INSTALL.md'],
    ['packaging/linux/launcher', 'usr/bin/ufi-panel-linux', 0o755],
  ]) await install(path.join(root, source), path.join(stage, target), mode);
  await run('desktop-file-validate', [path.join(stage, 'usr/share/applications/io.ufi.panel.linux.desktop')]);
}
async function main() {
  if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('This packaging workflow targets Linux x86_64');
  const asar = await import('@electron/asar');
  const archive = path.join(output, 'linux-unpacked/resources/app.asar');
  const packed = JSON.parse(asar.extractFile(archive, 'package.json').toString());
  if (packed.version !== manifest.version) throw new Error('Run npm run pack first: packaged version does not match package.json');
  const sourceFiles = (await fs.readdir(path.join(root, 'src'), { recursive: true })).filter(name => !name.endsWith('/'));
  for (const file of sourceFiles) {
    const source = path.join(root, 'src', file);
    if (!(await fs.stat(source)).isFile()) continue;
    if (!asar.extractFile(archive, `src/${file}`).equals(await fs.readFile(source))) throw new Error(`Stale packaged source: ${file}. Run npm run pack first.`);
  }
  await fs.mkdir(work, { recursive: true });
  const requested = process.argv.slice(2);
  if (requested.some(target => !['arch', 'deb', 'rpm'].includes(target))) throw new Error('Targets must be arch, deb, rpm');
  const targets = new Set(requested.length ? requested : ['arch', 'deb', 'rpm']);
  if (targets.has('arch')) {
    const appSource = path.join(work, 'arch-app');
    await fs.rm(appSource, { recursive: true, force: true }); await fs.mkdir(appSource);
    for (const [source, target, mode] of [
      [archive, 'app.asar'], [path.join(root, 'LICENSE'), 'LICENSE'], [path.join(root, 'packaging/INSTALL.md'), 'INSTALL.md'],
      [path.join(root, 'assets/icon.png'), 'icon.png'], [path.join(root, 'assets/icon.svg'), 'icon.svg'],
      [path.join(root, 'packaging/arch/launcher'), 'launcher', 0o755],
      [path.join(root, 'packaging/linux/ufi-panel-linux.desktop'), 'ufi-panel-linux.desktop'],
    ]) await install(source, path.join(appSource, target), mode);
    const appArchive = `ufi-panel-linux-${manifest.version}-app.tar.gz`;
    await run('tar', ['--sort=name', '--owner=0', '--group=0', '--numeric-owner', '-czf', path.join(output, appArchive), '-C', appSource, '.']);
    const appSha = createHash('sha256').update(await fs.readFile(path.join(output, appArchive))).digest('hex');
    const archBuild = path.join(work, 'arch'); await fs.mkdir(archBuild, { recursive: true });
    const pkgbuild = (await fs.readFile(path.join(root, 'packaging/arch/PKGBUILD.in'), 'utf8')).replaceAll('@VERSION@', manifest.version).replaceAll('@APP_SHA256@', appSha);
    await fs.writeFile(path.join(archBuild, 'PKGBUILD'), pkgbuild);
    await install(path.join(output, appArchive), path.join(archBuild, appArchive));
    await run('makepkg', ['--force', '--cleanbuild', '--noconfirm'], archBuild, { ...process.env, PKGDEST: output });
    const recipeDir = path.join(output, `ufi-panel-linux-${manifest.version}-arch-build`); await fs.mkdir(recipeDir, { recursive: true });
    await fs.writeFile(path.join(recipeDir, 'PKGBUILD'), pkgbuild); await install(path.join(output, appArchive), path.join(recipeDir, appArchive));

  }
  if (targets.has('deb') || targets.has('rpm')) {
    const stage = path.join(work, 'bundled'); await fs.rm(stage, { recursive: true, force: true });
    await fs.mkdir(path.join(stage, 'opt'), { recursive: true });
    await fs.cp(path.join(output, 'linux-unpacked'), path.join(stage, 'opt/ufi-panel-linux'), { recursive: true });
    // Standard Chromium SUID sandbox fallback; no launcher disables the sandbox.
    await fs.chmod(path.join(stage, 'opt/ufi-panel-linux/chrome-sandbox'), 0o4755);
    await install(path.join(root, 'packaging/linux/apparmor-profile'), path.join(stage, 'opt/ufi-panel-linux/resources/apparmor-profile'));
    await commonFiles(stage);
    const fpm = await getFpmPath();
    const common = ['-s', 'dir', '-n', 'ufi-panel-linux', '-v', manifest.version, '--iteration', '1', '-C', stage,
      '--maintainer', 'UFI Panel Linux local builds <noreply@ufi-panel-linux.invalid>', '--vendor', 'UFI Panel Linux contributors',
      '--description', 'Linux desktop client for UFI-TOOLS devices. Independent client; not an official UFI Panel release.',
      '--license', 'MIT', '--after-install', path.join(root, 'packaging/linux/after-install.sh'), '--after-remove', path.join(root, 'packaging/linux/after-remove.sh'), '--force'];
    const debDepends = ['libc6 (>= 2.31)', 'libgtk-3-0 | libgtk-3-0t64', 'libnotify4', 'libnss3', 'libnspr4', 'libxss1', 'libxtst6', 'libatspi2.0-0 | libatspi2.0-0t64', 'libuuid1', 'libsecret-1-0', 'libasound2 | libasound2t64', 'libgbm1', 'libdrm2', 'libcups2 | libcups2t64', 'libx11-6', 'libxcomposite1', 'libxdamage1', 'libxext6', 'libxfixes3', 'libxrandr2', 'libxcb1', 'libxkbcommon0', 'xdg-utils'];
    if (targets.has('deb')) await run(fpm, [...common, '-t', 'deb', '-a', 'amd64', '--deb-compression', 'xz', '--deb-compression-level', '6', '--deb-user', 'root', '--deb-group', 'root', '--deb-recommends', 'libayatana-appindicator3-1', '--deb-recommends', 'gnome-keyring | kwalletmanager', ...debDepends.flatMap(item => ['-d', item]), '-p', path.join(output, `ufi-panel-linux_${manifest.version}-1_amd64.deb`), '.']);
    const rpmDepends = ['glibc >= 2.31', 'libstdc++', 'gtk3', 'libnotify', 'nss', 'alsa-lib', 'libdrm', 'mesa-libgbm', 'cups-libs', 'libX11', 'libXcomposite', 'libXdamage', 'libXext', 'libXfixes', 'libXrandr', 'libxcb', 'libxkbcommon', 'libXScrnSaver', '(libXtst or libXtst6)', 'xdg-utils', 'at-spi2-core', '(libuuid or libuuid1)', 'libsecret'];
    if (targets.has('rpm')) await run(fpm, [...common, '-t', 'rpm', '-a', 'x86_64', '--rpm-os', 'linux', '--rpm-compression', 'xz', '--rpm-compression-level', '6', '--rpm-user', 'root', '--rpm-group', 'root', '--rpm-digest', 'sha256', '--rpm-rpmbuild-define', '_rpmformat 4', '--no-rpm-autoreqprov', ...rpmDepends.flatMap(item => ['-d', item]), '-p', path.join(output, `ufi-panel-linux-${manifest.version}-1.x86_64.rpm`), '.']);
  }
  const built = [`ufi-panel-linux-${manifest.version}-1-x86_64.pkg.tar.zst`, `ufi-panel-linux_${manifest.version}-1_amd64.deb`, `ufi-panel-linux-${manifest.version}-1.x86_64.rpm`];
  const sizes = Object.fromEntries((await Promise.all(built.map(async file => { try { return [file, (await fs.stat(path.join(output, file))).size]; } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }))).filter(Boolean));
  await fs.writeFile(path.join(output, 'package-sizes.json'), JSON.stringify({ version: manifest.version, bytes: sizes, archRuntime: 'electron43 (system dependency)', debRpmRuntime: `Electron ${manifest.devDependencies.electron} (bundled)` }, null, 2) + '\n');
  console.log(JSON.stringify({ result: 'built', version: manifest.version, bytes: sizes }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
