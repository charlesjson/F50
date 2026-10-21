# UFI Panel 0.5.16（Tauri）安装

本版使用 Tauri 原生窗口和系统 WebKitGTK；不捆绑 Electron、Chromium 或 Node.js。协议后端由系统 Node.js 18+ 运行，Rust 与后台通过私有标准输入输出通信，不启动本地 HTTP 管理端口。

- Arch / EndeavourOS：`sudo pacman -U ./ufi-panel-linux-0.5.16-1-x86_64.pkg.tar.zst`
- Debian 12+ / Ubuntu 24.04+：`sudo apt install ./ufi-panel-linux_0.5.16-1_amd64.deb`
- Fedora 43：`sudo dnf install ./ufi-panel-linux-0.5.16-1.x86_64.rpm`

安装后从应用菜单打开 UFI，或执行 `ufi-panel-linux`。`ufi-panel-linux --version` 显示运行时版本。不需要开发用 Rust、Cargo、npm。包管理器会安装 Node.js、WebKitGTK 和托盘库；首次安装依赖仍占用空间，但不会安装 Chromium。Ubuntu 22.04 默认 Node.js 版本不足，因此本版安装目标从 Ubuntu 24.04 起。

升级前关闭旧版。从 0.5.0 升级会保留已保存的连接与加密凭据。包名与 Electron 版相同，可正常升级；安装不会删除其它应用使用的 Electron。旧版连接名称、地址继续使用；旧加密口令需重新输入。程序会在原配置目录保留 `profiles.electron-backup.json`，重新勾选保存后使用系统 Secret Service（GNOME Keyring / KDE Secret Service）中的新密钥加密。密钥环锁定或不可用时仅保留本次会话口令，不保存明文。

配置仍在 `~/.config/ufi-panel-linux/`。用户曾主动启用的旧自启动入口会在启动新版时备份并迁移；没有启用时不创建。设备网页、插件设置和 TTYD 置于独立窗口，无客户端桥接权限。插件中心位于「系统 → 插件」，自动识别设备已安装项目，并提供设置与逐项管理。

0.5.12 的「配置页面」直接展示插件脚本生成的控件、表单、弹窗和内嵌面板。需要登录时可在配置窗口选择「显示完整设备页面」，登录后再返回配置。

0.5.14 配置页会复用已连接设备的 UFI 登录信息。勾选「保存口令」且系统密钥环可用时，网页登录凭据加密保存在配置目录的 `web-sessions.sqlite3`；关闭窗口、重新连接同一保存的设备后继续恢复。原采样发现设备恢复在线时，已加载的页面恢复有效凭据，加载失败的配置窗口重试。独立插件面板的持久 Cookie 和偏好按设备保留；其自有账号仍由插件面板管理。

左下角常驻显示实时设备状态。流量口径为「今日用量」和「本月累计」，接入数为设备报告的 Wi-Fi 终端数。暂停采集时保留最后一次读数并显示「已暂停」，更新失败显示「数据过期」，断开后清空读数。

0.5.14 左键点击托盘图标时显示独立状态窗口；点击其他应用窗口或按 Esc 自动隐藏。鼠标仅移出窗口时保持显示。「打开管理台」按钮恢复主窗口；托盘右键保留「显示管理台」「完整 UFI 面板」「退出」。原有常驻悬浮监控仍可单独打开。托盘通过桌面的 StatusNotifierItem / D-Bus 接口工作，KDE 原生支持；GNOME 需要已启用托盘扩展。

卸载使用 `sudo pacman -Rns ufi-panel-linux`、`sudo apt remove ufi-panel-linux` 或 `sudo dnf remove ufi-panel-linux`。卸载不删除用户配置；建议先在客户端设置关闭自启动。

当前仅 x86_64。系统 WebKitGTK 与 Node.js 由发行版提供安全更新。AppImage 旧文件不会被包管理器删除，建议关闭旧进程后使用新的菜单入口。

0.5.15 支持按住托盘状态窗口顶部区域拖动。程序启动时自动尝试连接上次使用、已保存口令的设备；系统密钥环不可用时跳过，失败后可手动重试或更新口令。自动连接仅尝试一次，可在连接对话框中取消。

0.5.16 的历史监控分别展示当日、当月累计流量，并按各自读数缩放纵轴。旧历史记录直接适用；悬停仍显示实际累计值，失败或缺失采样保留断点。
