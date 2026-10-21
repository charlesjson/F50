#!/bin/sh
set -eu
# Remove only the legacy Electron-specific AppArmor profile during migration.
ufi_profile=/etc/apparmor.d/ufi-panel-linux
if [ -f "$ufi_profile" ] && grep -Fq '/opt/ufi-panel-linux/ufi-panel-linux' "$ufi_profile"; then
    if command -v apparmor_parser >/dev/null 2>&1; then apparmor_parser --remove "$ufi_profile" >/dev/null 2>&1 || true; fi
    rm -f "$ufi_profile"
fi
if command -v update-desktop-database >/dev/null 2>&1; then update-desktop-database -q /usr/share/applications || true; fi
if command -v gtk-update-icon-cache >/dev/null 2>&1; then gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor || true; fi
