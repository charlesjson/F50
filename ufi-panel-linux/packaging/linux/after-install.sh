#!/bin/sh
set -eu
# Ubuntu 24.04+ restricts unprivileged user namespaces through AppArmor.
# Keep the profile in resources on older AppArmor versions that cannot parse it.
ufi_profile=/opt/ufi-panel-linux/resources/apparmor-profile
if command -v apparmor_status >/dev/null 2>&1 && apparmor_status --enabled >/dev/null 2>&1 && command -v apparmor_parser >/dev/null 2>&1; then
    if apparmor_parser --skip-kernel-load --debug "$ufi_profile" >/dev/null 2>&1; then
        install -m 644 "$ufi_profile" /etc/apparmor.d/ufi-panel-linux
        if ! { command -v ischroot >/dev/null 2>&1 && ischroot; }; then
            apparmor_parser --replace --write-cache --skip-read-cache /etc/apparmor.d/ufi-panel-linux || true
        fi
    fi
fi
if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database -q /usr/share/applications || true
fi
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
    gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor || true
fi
