# UFI Panel Linux 0.5.5

在「网络 → 连接终端」的每个 Wi-Fi 终端旁新增「踢出并拉黑」按钮。确认窗口显示设备名称、IP、MAC 及持续禁止重连的效果；确认后交给设备的访问控制功能执行。下方新增「设备黑名单」，可逐项解除，让终端重新使用正确的 Wi-Fi 口令连接。

此操作使用设备现有的 MAC 黑名单，会持续阻止重连，直到手动解除。若拉黑的是当前管理电脑，管理连接也可能中断；可通过有线或 USB 网络连接设备后解除。界面在设备接受请求后重新读取终端和黑名单；终端实际断开时间取决于固件。

实现通过原厂 `queryDeviceAccessControlList` 读取名单，调用 `setDeviceAccessControlList` 修改一个 MAC，与 [UFI-TOOLS 上游终端管理](https://github.com/kanoqwq/UFI-TOOLS/blob/http-server-version/app/frontEnd/public/script/main.js) 使用相同的设备接口。本机 F50 的只读查询确认五个访问控制字段齐全、`AclMode=2`、当前黑名单为空；未对真机执行踢出或拉黑。

提交前重新读取并校验名单及访问控制模式，其他页面已经修改时要求刷新后重新确认。仅修改选中 MAC 及对应名称，保留其他黑名单条目、白名单和现有模式。名称中的分隔符不会扩展为额外条目；未确认、确认过期、连接切换或目标已经离线时不提交；超时后不自动重复写入。

有线终端没有踢出按钮。当前只在已确认的黑名单模式 `AclMode=2` 下开放写入；其他模式不会自动切换或清空白名单。设备未提供完整接口或固件拒绝组合查询时保留原有终端列表，隐藏不支持的操作。ZWRT 暂未适配此功能。

验证命令：

```sh
npm test
npm run dist
npm run test:client-access
npm run test:interactions
```

单元测试覆盖目标 MAC/连接类型校验、只添加/解除一项、已有名单和白名单保留、并发修改拦截、目标离线、缺少接口的降级、名称分隔符和未知写入结果。原生 WebKit 通过本地模拟设备验证按钮、确认/取消、旧确认失效、拉黑后列表刷新、解除恢复及不支持接口的显示；测试写入仅发生在本地模拟设备。

界面验证：`artifacts/tauri-client-access-validation.json`；截图：`artifacts/tauri-client-blocked.png`。0.5.4 的 SQLite 历史监控保留。
