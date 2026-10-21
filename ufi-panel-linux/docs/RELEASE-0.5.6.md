# UFI Panel Linux 0.5.6

插件安装后自行向 UFI 网页添加的菜单，现在也会显示在「系统 → 插件 → 已安装」中。已在本机 F50 / UFI-TOOLS 4.1.5 看到 OpenSSH 插件的「安装SSH」「卸载SSH」「上传公钥」三个入口，真机验证没有点击这些操作或更改设备配置。

此前的插件中心主要解决插件清单和源码管理，原生设置只对猫猫、OpenSSH 做了固定定位。0.5.6 增加通用发现机制，从插件实际创建的控件生成菜单，支持定时器/Promise/事件回调生成的菜单以及后续 DOM 增删；插件名称不再是接入条件。没有明确归属的旧菜单保留在「其他插件菜单」，没有可识别菜单的样式类插件仍使用原生设置入口。

## 操作方式

连接设备后打开「系统 → 插件」，等待菜单发现。点击某个功能会打开插件窗口并滚动、高亮其实际控件；随后在该窗口执行操作。菜单点击本身不会自动安装或卸载服务。这样保留插件已有的弹窗、选择文件、公钥上传和原生确认行为，也适用于没有统一表单协议的旧插件。

安装、更新、启停和删除后重新读取菜单，设备网页上的外部修改也通过原有修订同步失效旧入口。刷新按钮可以重新发现菜单。离开插件中心时关闭尚未打开的后台页面，已经由用户打开的操作窗口保留；设备切换、断开或插件变更时旧窗口及菜单令牌失效。手动关闭操作窗口后，可以重新打开菜单。

菜单变化只更新对应的按钮区域，保留现有插件行和管理按钮，避免异步发现过程中打断正在进行的点击。

猫猫的节点/策略组专用面板继续保留。通用插件可在独立设备窗口打开同设备的其他端口页面，仍限制设备来源并与本地桌面接口隔离。

## 实现边界

- 设备插件只在独立的设备 WebView 中运行；本地 renderer 仅用文本生成菜单，不执行插件源码或从插件接收本机命令。
- 后台解析成对插件标记，为启用的插件生成脚本来源摘要；设备页观察运行时控件并返回有限的菜单文本、类型、禁用状态及不透明令牌。
- 接收通路最多接受 128 个菜单，检查字段类型、长度、插件归属和当前会话。打开入口前重新读取插件修订；任意选择器或 JavaScript 不能通过该接口执行。
- 动态菜单没有统一插件标准。未创建常规按钮/链接/选择框、没有独立控件的画布型界面仍应通过原生设置访问；需要登录才能创建菜单的插件也可能先要求在原生页面登录。
- 内网 HTTP 上 WebKitGTK 不提供 `crypto.randomUUID()`，菜单令牌使用同样适用于该环境的 `crypto.getRandomValues()`；回归夹具显式移除前者，避免只在 localhost 测试时漏掉问题。

主要文件：`src/core/plugins.cjs`、`src/renderer/plugins-ui.mjs`、`src-tauri/src/plugin-menu-runtime.js`、`src-tauri/src/plugin_menus.rs` 和 `src-tauri/src/device_pages.rs`。

## 验证

```sh
npm test
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
npm run dist
npm run test:plugin-menus
npm run test:plugins
npm run test:interactions
```

原生 WebKit 回归使用本地模拟设备，覆盖未知插件、异步菜单、只读发现、菜单归属、原控件定位、原生弹窗、公钥文件选择/上传、后续菜单增删、插件禁用、修订过期与设备切换；原有插件中心的安装/启停/删除、猫猫面板、上传下载及隔离回归也保留。真机检查仅验证实际 SSH 菜单显示。

报告：`artifacts/tauri-plugin-menus-validation.json`、`artifacts/tauri-plugin-validation.json`、`artifacts/plugin-menus-device-0.5.6.json`。真机截图：`artifacts/tauri-plugin-menus-device-0.5.6.png`。
