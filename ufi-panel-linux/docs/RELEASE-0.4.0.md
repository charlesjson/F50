# 0.4.0：正式客户端扩展

此版本包含实际运行的代码与发行包，不是交互原型。目标仍为持续对齐 APK；本版没有宣称 115 项全部完成。

## 本次实现

| 领域 | 实际变化 | 验证边界 |
| --- | --- | --- |
| 导航与交互 | 六个主分组、上下文二级导航；主进程生成一次性操作计划；同一编辑层内预览/确认，关闭脏表单先提示 | Electron 故障与交互检查 |
| 任务中心 | 测速、代理、文件上传、下载跟踪和安装；阶段、实际进度、取消、结果导出 | 模拟服务测试；不可取消阶段独立处理 |
| 测速 | LAN 下载、设备代理下载/上传/双向，多地址方案、1–3 并发、3–60 秒；APK JSON/CONF 方案导入导出 | F50 实际 LAN 3 秒；外网上传/双向未消耗真实套餐做压测 |
| HTTP 代理 | 方法、URL、JSON 请求头、请求体、状态码、文本响应、导出；HTML 不执行 | 模拟 404/不可信 HTML；设备源站限制仍由 UFI 执行 |
| UFI 更新 | 读取目录/日志、下载到设备、查询进度、安装后等服务恢复并读取版本 | 真机目录/状态读取；下载写入与安装流程使用模拟服务/单元测试，真机未升级 |
| 主题与上传文件 | 11 项设备网页主题字段、默认主题、文件选择上传、按设备文件名删除、清空上传目录 | 真机主题读取；上传二进制与保存参数测试；尚无服务端完整文件枚举 |
| 认证与资源 | UFI/原厂口令修改、当前会话与本机密钥环同步、资源服务器设置 | 模拟验证；没有更改用户真机口令 |
| GOFORM | 原厂直接接入、Cookie、LD/AD，支持 LOGIN/LOGIN_MULTI_USER；共用网络、终端、短信等页面 | 当前 F50 的 LOGIN_MULTI_USER 曾通过真机 API/UI；联调也观察到间歇登录返回 3，因此仍标为实验性 |
| ZWRT | Basic 登录/Bearer、状态映射、能力门控、部分网络/Wi-Fi/锁频/短信/任务；恢复、活动记录、更新、NMS；设备公布动作的参数控制台 | 上游文档和 APK 证据对照、模拟测试；没有对应真机，专用表单尚未全部覆盖 |
| 桌面 | 明暗主题、80%–120% 缩放、发行包自启动、置顶监控；主窗隐藏时监控按需刷新 | Electron 监控隔离检查；自启动写入只在用户主动启用时执行 |
| 其它 | 按卡槽 AT、单独读取每卡 VoLTE/VoNR、设备详情与标识遮挡、一键工程 Shell、TTYD 检测/隔离窗口 | 协议与 UI；真机未执行 Shell、AT、工程或模式切换 |

## 关键修复

- F50 的 `/api/speedtest` 二进制响应同时包含 `Content-Length` 与 `Transfer-Encoding: chunked`，严格 Node 解析器会拒绝。本版只对显式测速流启用兼容解析，并强制独立短连接；其它 API 保持严格解析，不全局关闭 HTTP 校验。
- 取消安装任务前的状态检查后，会再次检查取消信号，避免“已取消却仍提交安装”。安装开始后不提供虚假的取消按钮。
- 各后端凭据、连接地址和模式联合匹配；切换模式时不把隐藏的 UFI 口令发送到原厂或 datad。
- 普通空字符串与合法的 0 区分；GOFORM/ZWRT 不存在的指标不会补造为 0。
- 转发邮件口令留空时在设备端沿用已有秘密；不把已保存密码返回渲染器。
- 所有设备写操作均不自动重试。未知结果要求先重新读取状态确认。

## 尚未完成

独立 Android 模式的部署/授权、完整信令采集与 RRC/指纹等深度解码、完整 ZWRT 专用表单与 WebSocket 终端、部分机型专属接口和细节，以及部分清单项的专用管理体验仍需继续实现。当前只有 F50/UFI-TOOLS 可供真机验证，ZWRT 的模拟测试不能代替固件实测。

定位、ENDC、仅 RNDIS 等独立模式路径在本机 UFI-TOOLS 返回 404。这仅表示当前服务未提供对应路径，不代表设备硬件一定不支持这些能力。客户端会显示不适用/未适配信息，而不会伪造操作成功。

## 主要代码

- `src/core/protocol.cjs`：有界流读取、取消、二进制上传和严格/定向兼容解析。
- `src/core/jobs.cjs`、`transfers.cjs`：任务状态、测速、下载观察与安装恢复。
- `src/core/goform.cjs`、`zwrt.cjs`：后端差异与状态归一化。
- `src/core/maintenance.cjs`：维护功能的参数与请求。
- `src/main.cjs`：主进程操作计划、命名 IPC、文件选择和远程隔离窗口。
- `src/renderer/navigation.mjs`、`tools-ui.mjs`：实际导航、维护页面、任务中心；`features.mjs` 承载已有原生管理页面与单层确认。

## 协议来源

- 用户提供的 APK：完整证据清单见 `docs/full-parity/feature-catalog.json`。
- [UFI-TOOLS 固定版本 API](https://github.com/kanoqwq/UFI-TOOLS/blob/cf83b815efb114ed026f06dc90550845aafbfceb/API_Doc.md)。
- [zwrt-datad API](https://github.com/33333s/zwrt-datad/blob/main/docs/API.md)、[控制协议](https://github.com/33333s/zwrt-datad/blob/main/docs/CONTROL_API.md)、[状态结构](https://github.com/33333s/zwrt-datad/blob/main/docs/STATE_SCHEMA.md)、[NMS 配置](https://github.com/33333s/zwrt-datad/blob/main/docs/CLOUD.md)，2026-10-15 核对。设备能力仍按运行时返回值判断，不假设每个版本具备全部动作。
