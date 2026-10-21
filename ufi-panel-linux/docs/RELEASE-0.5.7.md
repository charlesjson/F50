# UFI Panel Linux 0.5.7

插件接入统一为运行时菜单发现和可选的 JSON 设置页声明。移除了旧的按猫猫／OpenSSH 名称和源码片段分类、专属 DOM 定位、固定代理端口、控制器密钥提取及 zashboard 存储初始化代码。新增插件无需向客户端添加分类或设置实现。

原有插件无需修改，自动显示实际生成的菜单；点击后打开并定位原控件，安装、卸载、弹窗和文件上传继续由插件自己的页面完成。没有可识别菜单的插件保留「原生页面」。独立面板可通过统一的 `data-ufi-plugin-manifest` JSON 声明，所有插件适用同一约定，详见 [通用插件接入约定](PLUGIN-SETTINGS-DESIGN.md)。

此前代理面板的自动直达和自动配置行为随专属适配移除。现在可通过插件自身的菜单打开面板，或由插件声明独立设置 URL；登录与控制器设置由面板自身处理。客户端不会修改设备现有插件源码。

## 验证

- Node 自动测试 84 项；Rust 11 项通过，另有 1 项历史性能基准默认忽略；clippy 无警告。
- 原生 WebKit 模拟设备验证多个未知插件：内联脚本、外部脚本、异步菜单、任意容器、插件改名、更换文案、原生弹窗、真实文件选择上传、JSON 数据保持不变、菜单动态增删和设备／修订失效。
- 通用声明面板与旧插件原生页面回退；安装／启停／删除、下载不覆盖、遥测暂停和桌面桥接隔离。
- 实际 F50 的既有 SSH 菜单只读检查；不点击设备插件操作或提交配置。

报告位于 `artifacts/tauri-plugin-menus-validation.json`、`artifacts/tauri-plugin-validation.json`、`artifacts/plugin-menus-device-0.5.7.json` 和 `artifacts/validation-0.5.7.json`。
