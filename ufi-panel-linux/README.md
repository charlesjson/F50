# UFI Panel Linux

基于 **Tauri 2 + 系统 WebKitGTK** 的 UFI-TOOLS Linux 客户端。0.5.0 已替换 Electron 窗口与桌面桥接；安装包不包含 Electron、Chromium 或捆绑 Node.js。设备协议与任务逻辑由系统 Node.js 18+ 在私有后台进程中运行，保留之前已实现的设备管理功能。

0.5.16 将历史监控的当日、当月累计流量拆为独立图表，纵轴按各自读数缩放，避免较大的累计总量把新增流量压成直线。图中标出实际纵轴范围，缺失采样保留断点。详见 [0.5.16 更新说明](docs/RELEASE-0.5.16.md)。

0.5.15 支持拖动托盘状态窗口的顶部区域，并在程序启动时自动尝试连接上次使用、已保存口令的设备。失败后保留凭据并提供手动连接。详见 [0.5.15 更新说明](docs/RELEASE-0.5.15.md)。

0.5.14 新增托盘状态窗口：左键点击查看八项实时读数，点击其他窗口或按 Esc 收起。插件配置页复用当前登录凭据，按设备在加密 SQLite 中保存网页登录信息，并在设备离线恢复后自动恢复访问。详见 [0.5.14 更新说明](docs/RELEASE-0.5.14.md)。

0.5.13 在左下角增加常驻设备状态：CPU、内存、温度、今日用量、本月累计、下载／上传网速和 Wi-Fi 接入数量，一项一行，名称、数值和单位按列对齐。状态区复用原有采样，切换页面后继续更新；暂停和过期数据会明确标注。详见 [0.5.13 更新说明](docs/RELEASE-0.5.13.md)。

0.5.12 新增通用插件配置页面：自动展示插件脚本生成的按钮、表单、弹窗和内嵌面板，支持异步加载与同设备不同端口的 Web UI；保留原始事件、表单输入和 iframe 会话，并修复切换插件窗口和备份下载。详见 [0.5.12 更新说明](docs/RELEASE-0.5.12.md)。

0.5.11 为实时速率、温度、CPU 和内存图表补上竖线和悬停读数。鼠标停留时固定当前图表，移出后恢复刷新；其他图表、后台采样和历史记录继续更新。详见 [0.5.11 更新说明](docs/RELEASE-0.5.11.md)。

0.5.10 优化图表读数：参考线吸附实际采样并高亮数据点，断线前后的孤立读数正常显示，自动纵轴使用规整刻度，时间轴与绘图区对齐，合并悬停刷新并缓存未变化的读数。详见 [0.5.10 更新说明](docs/RELEASE-0.5.10.md)。

0.5.9 为历史图表的竖向参考线新增读数浮层，直接显示对应采样时间和当前图表的数值、单位，支持左右边缘避让。详见 [0.5.9 更新说明](docs/RELEASE-0.5.9.md)。

0.5.8 修复概览与历史图表缺少纵坐标的问题，新增五档刻度及速率、百分比、温度、流量单位。历史图表的悬停采样显示跟随鼠标的竖向参考线，并校准悬停读数。详见 [0.5.8 更新说明](docs/RELEASE-0.5.8.md)。

0.5.7 移除按插件名称、专属 DOM、固定端口和面板存储进行的特殊适配。所有插件统一使用运行时菜单发现；可选 JSON 清单声明独立设置页，详见 [接入约定](docs/PLUGIN-SETTINGS-DESIGN.md) 和 [0.5.7 更新说明](docs/RELEASE-0.5.7.md)。

历史版本：0.5.6 新增通用插件菜单发现：在「系统 → 插件」自动列出插件运行后添加的按钮，支持 SSH 的安装、卸载、上传公钥以及未知插件的动态菜单。点击入口后直达原插件操作。详见 [0.5.6 更新说明](docs/RELEASE-0.5.6.md)。

0.5.5 在「网络 → 连接终端」新增 Wi-Fi 终端的「踢出并拉黑」按钮和黑名单「解除」入口，操作前核对终端及最新名单。详见 [0.5.5 更新说明](docs/RELEASE-0.5.5.md)。

0.5.4 新增 SQLite 历史监控：自动保存 CPU、内存、温度、网速、流量等采样，支持按设备、自定义时间范围查询，断开连接或重启后仍可查看。详见 [0.5.4 更新说明与负载评估](docs/RELEASE-0.5.4.md)。

历史版本（专属适配已在 0.5.7 移除）：0.5.3 将猫猫「设置」改为直达节点与策略组面板，并自动连接插件已有的控制器配置。详见 [0.5.3 更新说明](docs/RELEASE-0.5.3.md)。

0.5.2 修复设备插件设置窗口的背景滤镜内存暴涨，详见 [0.5.2 更新说明](docs/RELEASE-0.5.2.md)。

历史版本：0.5.1 新增插件中心：自动发现设备已安装插件，提供逐项管理与应用内原生设置窗口，支持猫猫、OpenSSH 定位及猫猫独立代理面板。详见 [0.5.1 更新说明](docs/RELEASE-0.5.1.md)。

## 安装

当前提供 x86_64 安装包：

```sh
# Arch / EndeavourOS（仓库需有 WebKitGTK 4.1 与 Node.js）
sudo pacman -U ./ufi-panel-linux-0.5.16-1-x86_64.pkg.tar.zst

# Debian 12+ / Ubuntu 24.04+
sudo apt install ./ufi-panel-linux_0.5.16-1_amd64.deb

# Fedora 43
sudo dnf install ./ufi-panel-linux-0.5.16-1.x86_64.rpm
```

安装后从应用菜单打开 UFI，或运行 `ufi-panel-linux`。系统尚未安装 WebKitGTK、Node.js 和托盘库时，包管理器仍需下载这些共享依赖；无需下载 Chromium。具体体积以 `release/package-sizes.json` 为准。安装、升级、卸载说明见 [Tauri 安装说明](packaging/INSTALL-TAURI.md)。

升级前关闭旧版。沿用 `~/.config/ufi-panel-linux/` 中的设备名称和地址；旧版加密口令需要重新输入一次，原文件会备份为 `profiles.electron-backup.json`。用户曾主动启用的旧自启动入口会备份并迁移，未启用时不创建。不会卸载其他应用使用的 Electron，也不会删除手动下载的旧 AppImage。

## 连接与功能

连接设备的 Wi-Fi 或 USB 网络后，填写 UFI 服务地址、UFI 口令和按需使用的中兴后台口令。本机 F50 的 UFI 地址为 `http://192.168.0.1:2333`，程序没有预置用户口令。

| 页面 | 现有功能 |
| --- | --- |
| 概览 | 默认 2 秒持续采集温度、CPU、内存、网速、流量、终端数；1/5/10 分钟曲线，缺失值断点，最小化后仍运行 |
| 历史监控 | 按接入模式和服务地址保存原始采样，自选日期离线查询；长范围自动汇总、精确峰值、原始读数与分页表格 |
| 网络 | 蜂窝/SIM、Wi-Fi、APN、频段与邻区列表选择锁定、LAN/DHCP、终端筛选和改名、Wi-Fi 终端踢出拉黑及解除 |
| 短信 | 收件、发件、草稿、其他分类；分类分页查找、回复/再次发送、国家区号搜索与最终号码确认、删除/标记已读 |
| 工具 | 24 个可搜索 AT 查询模板、Shell/AT 卡槽确认、TTYD、内网与设备代理测速、HTTP 请求调试、任务结果与取消 |
| 自动化 | 设备定时任务；已实现的 datad 恢复与活动记录 |
| 系统 | 设备控制、按槽 VoLTE/VoNR、插件、UFI 更新、主题与文件、认证/资源服务器、桌面外观、托盘和悬浮监控 |

本地界面提交的设备写入由用户确认，超时不自动重复提交；打开“再次发送”只带入号码和内容，查看短信不自动标记已读。设备网页、插件原生设置与 TTYD 是独立窗口，不能调用本机客户端接口；原生插件保留其自身的操作和确认行为。

在「系统 → 插件」查看已安装项目。未声明独立面板的插件提供「配置页面」，自动展示该插件在设备网页中创建的控件、表单和 iframe；声明通用清单的插件提供「设置面板」。配置窗口保留实际 DOM 和事件处理，异步创建的界面会继续出现。需要登录或访问未识别的内容时，可选择「显示完整设备页面」，再返回配置；此过程保留已填表单和内嵌面板。原有插件无需修改，客户端不按名称、按钮文字或专属 DOM 选择实现。安装、更新、启停和删除后自动刷新；设备网页上的外部修改也会使旧设置窗口失效。禁用或删除前端插件不会停止设备上的服务。

已安装列表也会自动显示插件创建的功能菜单，不要求逐个适配插件名称。点击菜单后展示该插件的配置并高亮原始操作控件，再由用户在插件窗口执行；上传、公钥选择、确认弹窗沿用插件自身界面。菜单随插件动态变化更新，无法明确归属的旧菜单显示在「其他插件菜单」。离开插件中心时释放未打开的菜单页面；用户已打开的操作窗口保留。

原生设置中的备份文件保存到系统下载目录，文件名前加随机标识以避免覆盖。历史未分组代码会保留并提示，可通过「高级编辑」处理。

支持 KANO/UFI-TOOLS、实验性 GOFORM 和基础 ZWRT 接入。当前仅有 F50/UFI-TOOLS 真机；其他模式、APK 全部 115 项功能尚未完全对齐。范围见 [完整功能矩阵](docs/full-parity/README.md)，旧版本行为见 [0.4.3](docs/RELEASE-0.4.3.md) 与 [0.4.2](docs/RELEASE-0.4.2.md)。

## 配置与隔离

系统 Secret Service（GNOME Keyring / KDE Secret Service）保存独立的加密密钥，连接凭据使用 AES-256-GCM 加密，配置文件权限为 `0600`。密钥环锁定或不可用时只使用内存会话，不回退为明文保存。

勾选「保存口令」后，UFI 网页登录信息加密保存在 `~/.config/ufi-panel-linux/web-sessions.sqlite3`，沿用相同的系统密钥环。配置窗口启动时自动恢复有效登录信息；手动网页登录得到的中兴口令也会记住。设备专属的浏览器存储位于 `device-webviews/`，保留独立插件面板的偏好与持久 Cookie。短暂断网无需重新连接客户端，原采样在设备回来后继续；已加载的配置页恢复凭据，加载失败的窗口重试。

历史记录位于 `~/.config/ufi-panel-linux/telemetry.sqlite3`（遵循 `XDG_CONFIG_HOME`），只保存指标和设备名称、服务地址，不保存口令、Cookie 或完整设备响应。默认每 30 秒批量写入，查询和正常退出时补写；原始采样长期保留，不自动删除。暂停采集、断开设备或退出客户端后不再新增记录，关闭到托盘仍继续。异常终止可能丢失最近尚未提交的约 30 秒数据；`WAL + synchronous=NORMAL` 在系统断电时也不保证最近提交持久化。数据库权限为 `0600`，SQLite 随程序静态编译，不需要另外安装数据库服务。

设备后台请求仅接受本地 `main` 窗口；托盘窗口只接收八项读数与设备名称，只能请求隐藏自身或打开管理台。设备页面不具备这些权限。界面通过 Tauri IPC 调用 Rust，再通过私有标准输入输出调用协议后台，不启动客户端 HTTP 服务。设备 API 不跟随重定向转发凭据，Shell/AT 在设备端执行，不作为本机 Shell 命令运行。

## 开发、构建与验证

开发需要 Node.js 18+、Rust（本次使用 1.96）、WebKitGTK 4.1/GTK 3/托盘开发库。`npm ci` 不安装 Electron 运行时。

```sh
npm ci
npm test
npm start
```

发行构建采用 Debian 12 容器作为 ABI 基线，再生成 Arch、DEB、RPM：

```sh
npm run dist
npm run test:interactions
npm run test:plugins
npm run test:plugin-menus
npm run test:plugin-view
npm run test:sidebar
npm run test:tray
npm run test:sessions
npm run test:startup
npm run test:history
npm run test:live-charts
npm run test:client-access
```

完整三格式打包流程已在 Arch / EndeavourOS 构建机验证，需要 Docker、Rustup/Cargo、makepkg 与 rpmbuild。容器构建脚本不会在宿主机安装软件包。已有 native binary 时可运行 `npm run package:tauri`。构建会校验可执行文件内嵌的源码摘要，拒绝把旧原生程序与新界面混装。

只读真机检查：

```sh
# 文件内容：{"address":"http://设备IP:2333","password":"UFI口令","ztePassword":"中兴口令"}
chmod 600 /path/to/private-connection.json
UFI_CONNECTION_FILE=/path/to/private-connection.json npm run test:ui
```

真实 WebKit 界面测试使用 Tauri 官方 WebDriver、Xvfb 和隔离容器。写入测试只针对本地模拟设备。真机检查不发送短信、不锁定基站、不执行 AT/Shell。结果见 `artifacts/validation-0.5.0.json`。

## 结构与说明

- `src-tauri/src/main.rs`：原生窗口、托盘、文件对话框、密钥环、进程桥接和权限验证。
- `src-tauri/src/system_tray.rs` / `tray_popup.rs`：Linux StatusNotifier 托盘、状态窗口定位及失焦隐藏。
- `src-tauri/src/web_sessions.rs` / `device-page-session.js`：按设备加密保存网页登录信息，在限定的 UFI 页面中恢复凭据。
- `src-tauri/src/history.rs`：SQLite 历史记录、批量写入、独立只读查询和负载基准。
- `src/backend.cjs` / `src/worker.cjs`：客户端会话、任务与请求分派，私有 stdio 通信。
- `src/core/`：签名传输、KANO/GOFORM/ZWRT、短信分类与设备控制协议。
- `src/renderer/`：复用的前端和 Tauri 桥接。
- [0.5.1 插件中心与验证](docs/RELEASE-0.5.1.md)、[0.5.0 迁移与验证](docs/RELEASE-0.5.0.md)、[历史 Linux 打包说明](docs/LINUX-PACKAGING.md)。

`src/main.cjs`、`src/preload.cjs` 和 `*:electron-legacy` 脚本仅保留旧版参考，不进入 Tauri 运行时。新版请使用 `release/` 中的 0.5.16 安装包。

本项目为独立客户端，新增代码使用 MIT 许可，不是官方 UFI Panel 的 Linux 发行版，未包含 APK 反编译代码或 Android 原生程序。APK 协议研究见 [分析报告](../research/UFI-PANEL-APK-ANALYSIS-20261015.md)；UFI 接口依据 [上游 API 文档](https://github.com/kanoqwq/UFI-TOOLS/blob/cf83b815efb114ed026f06dc90550845aafbfceb/API_Doc.md)。
