# 0.5.0：Tauri / WebKitGTK 迁移

Linux 默认入口已替换为 Tauri 2.12，使用系统 WebKitGTK 4.1；不捆绑 Electron、Chromium 或 Node.js。原有 HTML/CSS/页面逻辑复用，协议后端继续采用已验证的 Node.js 模块，通过私有 stdio 与 Rust 通信。系统 Node.js 最低 18，包管理器负责安装。

## 迁移结果

- Rust 接管原生窗口、托盘、显示/隐藏、置顶监控、剪贴板、文件选择/导出、命令确认、自启动和单实例。
- 客户端 API 从 Electron preload/IPC 改为命名 Tauri 命令；本地窗口、URL 和 capability 同时校验。远程设备窗口与 TTYD 无客户端权限，使用独立临时浏览数据目录。
- `src/backend.cjs` 保留连接事务、操作计划、一次性确认、任务取消、下载/安装观察、文件选择令牌和设备变更验证。未重写设备协议，也不增加本地 HTTP 管理端口。
- Tauri 的字符串拒绝统一转换为 `Error`，避免原界面读取失败时丢失提示。已验证失败保留旧列表与重试路径。
- 持续采集在系统 Node 后台运行，隐藏窗口后不停止。主界面与悬浮窗共享数据。
- 主界面偏好使用独立的持久 WebKit 数据目录；设备页面使用隔离的临时目录，避免与本机界面或其他设备会话共用。
- 发行版可执行文件内嵌源码摘要；打包检查前端、协议后台、Rust 和配置是否匹配，避免旧二进制混入新包。

原有 4.x 已实现功能继续使用；未完成的 APK 条目、ZWRT 硬件边界和 GOFORM 间歇鉴权问题仍如历史版本记录。此迁移不表示所有 APK 功能都已完成。

## 安装与依赖

见 [Tauri 安装说明](../packaging/INSTALL-TAURI.md)。提供 x86_64 的 `.pkg.tar.zst`、`.deb`、`.rpm`。本次不生成捆绑 WebKit 的大型 AppImage。安装包本体体积见 `release/package-sizes.json`，首次系统依赖下载不计入包体，不能把约 2–3 MB 的应用包当成首次安装总下载量。

- Arch / EndeavourOS：Node.js、WebKitGTK 4.1、GTK 3、Ayatana 托盘库。
- Debian 12+ / Ubuntu 24.04+：Node.js 18+、libwebkit2gtk-4.1-0、GTK 3、托盘库。
- Fedora 43：Node.js 18+、webkit2gtk4.1、GTK 3、托盘库。

在 Debian 12 编译的程序最大 GLIBC 版本需求为 2.34；没有按 Arch 新系统的 glibc 构建后宣称兼容旧 Debian。当前没有 ARM64 包。

## 凭据升级

继续使用 `~/.config/ufi-panel-linux/`，设备名称和地址保留。Electron safeStorage 格式与新加密格式不同，因此旧口令需重新输入。存在旧加密条目时保留 `profiles.electron-backup.json`；不要把该备份视为非敏感文件公开分享。

新密钥存入系统 Secret Service，Node 后台只在内存中取得密钥并使用 AES-256-GCM 加密。Rust 与后台只通过继承的私有管道交换数据，密钥不放在命令行、环境变量或前端。没有密钥环或密钥环锁定时，不保存明文，用户可在解锁后重新启动客户端。

旧版自启动存在且处于启用状态时，备份为 `.desktop.electron-backup` 并迁移到新原生程序；不会为从未启用的用户开启自启动。旧 AppImage 不自动删除，其他应用的 Electron 不卸载。

## 验证与限制

Node 单元测试和 Rust 权限边界测试见 `artifacts/validation-0.5.0.json`。真实 WebKit 测试覆盖连接、错误恢复、短信收发与国际号码、设置确认、AT 模板、邻区选择、持续采样、监控窗、流式任务与设备页面隔离。

本机 F50 真机只读联调覆盖温度/CPU/内存/速率、隐藏窗口采样、短信分类、邻区选择后取消、AT 模板填入与悬浮窗。未发送真实短信、锁定基站、执行 AT/Shell 或安装更新。

Linux GUI 测试使用真实 Tauri 可执行文件、官方 tauri-driver/WebKitWebDriver、Xvfb 与窗口管理器。测试容器因命名空间限制显式关闭 WebKit 子进程沙箱；生产入口不含此设置。截图由 X11 窗口捕获，绕开当前 WebKitWebDriver 截图请求不返回的问题；界面交互和 IPC 检查仍在真实 WebKit 中完成。

系统 Secret Service API 已接通；加密/解密与旧文件备份路径有测试，GUI 自动测试使用私有临时配置并禁用真实密钥环，因此不把它表述为每种桌面密钥环的完整验收。Wayland/AppArmor、不同发行版托盘扩展及全部设备固件未逐一实机覆盖。

## 官方依据

- [Tauri Linux 依赖](https://v2.tauri.app/start/prerequisites/)
- [Tauri WebDriver](https://v2.tauri.app/develop/tests/webdriver/)
- [原生文件与消息对话框](https://v2.tauri.app/plugin/dialog/)
- [Tauri 的独立后端进程方案](https://v2.tauri.app/learn/sidecar-nodejs/)
