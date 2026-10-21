# F50 网页、APK 与 Linux 0.5.5 功能差异复核

核对日期：2026-10-17（Asia/Shanghai）。结论是：**有未接入和部分接入的功能，但不能把 APK 四种后端的全部功能视为这台 F50 的接口。** 对当前 F50 最有价值的缺口是原厂流量管理、更多监控指标、完整定时任务编辑和上传文件管理。另有少量原生页面使用了此机没有的接口，需要修正能力判断。

本次是盘点，没有修改设备设置、安装组件、发短信、触发测速或升级；产品运行代码未变。新增了可复用的只读诊断脚本和本报告。网页由浏览器正常加载，其原有自动刷新行为保留；诊断脚本本身只请求明确核对过的读取接口，不执行 AT/Shell。

## 样本与检查范围

| 对象 | 本次核对依据 |
| --- | --- |
| 真实设备 | `http://192.168.0.1:2333`，网页及 `/api/version_info` 确认 F50 / UFI-TOOLS **4.1.5** |
| Linux 客户端 | 当前工作区 **0.5.5** 的 renderer → backend → core 实现；没有沿用 0.3.0 的缺失状态 |
| APK | `app-release.apk`，包名 `com.minikano.ufitools.client`，**1.10.1 / versionCode 87** |
| APK SHA-256 | `ffbcb93f64a9c1aa99a8229f9b90f8121d729eb67f0b8d379fe5eb07501c50d6`，本次重新计算，与原反编译样本一致 |
| APK 证据 | JADX 的 sources/decoded/resources，定向复核真实控件、回调、请求路径和后端分支；没有运行 Android 样本 |
| 设备静态资源 | 本次重新读取首页、main/utils/charts/requests 脚本；main.js 和 utils.js 与上次设备抓取逐字节一致 |
| 上游参考 | UFI-TOOLS 固定提交 `cf83b815efb114ed026f06dc90550845aafbfceb` 的网页、API 文档及 Kotlin 服务模块。文档标称 4.1.3，不能自动代表当前设备全部路由 |

明确选择的 **28 个读取 URL 中 19 个成功、9 个返回 404**；另外三个 goform 读取组成功。这里包括同一路径的不同 SIM 槽位，因此 28 不是“28 个独立功能”。未探测任意猜测路径，也没有用 GET 扫描所有路由，因为这个服务的某些 GET 会修改设备状态。

证据文件：

- [设备读取结果](/home/chnut/文档/ChatGPT/F50/ufi-panel-linux/artifacts/device-feature-audit-20261017.json)：仅保留字段名、类型、计数和非敏感能力值，不保存口令、Cookie、短信内容或坐标。
- [设备静态资源摘要](/home/chnut/文档/ChatGPT/F50/research/feature-audit-20261017/device-source/manifest.json)。
- [APK 功能证据](/home/chnut/文档/ChatGPT/F50/ufi-panel-linux/docs/full-parity/audit-20261017/apk-evidence.md)：真实入口、协议及模式边界。
- [Linux 当前源码覆盖](/home/chnut/文档/ChatGPT/F50/ufi-panel-linux/docs/full-parity/audit-20261017/linux-coverage.md)：115 个历史规划 ID 的逐项核对。

## 当前 F50 网页/API 有，而原生界面仍不完整的部分

“未接入”指没有专用用户入口；客户端已有通用 Shell/AT，并不等于已有对应的状态读取、表单、确认和结果回读。以下写操作均未在真机执行。

| 功能 | 设备/网页证据 | Linux 0.5.5 现状 | 结论 |
| --- | --- | --- | --- |
| 每核心 CPU 使用率、各核心频率 | 实测 `/api/baseDeviceInfo` 返回 `cpuUsageInfo`、`cpuFreqInfo`；网页有核心图和频率列表 | 总 CPU、内存、温度及 SQLite 历史已有；这些每核心字段没有单独展示和历史记录 | 数据已能取得，缺展示/存储字段 |
| TCP/UDP/IPv6/Unix socket 连接统计 | 实测 `/api/connInfo` 返回 `tcp/tcp_active/tcp_other/tcp6/udp/udp6/unix` | 快照已取回 `connections`，但界面未消费，仅状态 JSON 导出可见 | 后端已读，缺可视化入口 |
| 原厂套餐管理、清零日期、提醒百分比、自动清零 | 网页“官方流量管理”；`DATA_LIMIT_SETTING`；相关 goform 只读字段实测有值 | 只提供 UFI 自身 `/api/get_data_limit`、`/api/set_data_limit` 的限额表单 | 原厂和 UFI 两套策略尚未完整对齐 |
| 原厂已用流量手动校准 | 网页调用 `FLOW_CALIBRATION_MANUAL` | `traffic-calibrate` 后台分支已写，但没有 renderer 按钮/表单 | 只差用户入口及完整校验/回读，不能算已交付 |
| “4G/3G”“仅 3G”制式选择 | 设备网页下拉含 `WCDMA_AND_LTE`、`Only_WCDMA`，共六个选项 | UI 和后台只允许自动、SA、NSA/LTE、仅 LTE 四项 | 同一个 `SET_BEARER_PREFERENCE` 缺两个选项 |
| 已上传文件列表、下载和预览 | 网页通过 `/api/user_shell` 的固定 `ls` 列目录，再用 `/api/uploads/{文件名}` 访问 | 有上传、输入文件名删除、清空，缺完整列表/预览/逐项下载 | 不是缺少新的“列文件 HTTP 接口”，是缺专用管理流程 |
| 定时任务详情、直接编辑、完整参数和执行状态 | `/api/get_task`、`list_tasks` 的 `actionMap/lastRunTimestamp/hasTriggered`；网页可回填任务 | 当前只能手工新增/同 ID 替换、单条删除，动作限制为五种基础模板 | 读取和编辑流程不完整，`clear_task` 也只有后台分支 |
| SELinux 与无线 ADB 就绪状态 | `/api/SELinux`、`/api/adb_alive` 均读取成功 | 有日志/ADB 配置，但没有这些运行状态的专用展示 | 两个明确可补的读取接口 |
| QCI、上下行 AMBR 信息 | 网页周期执行 `AT+CGEQOSRDP=1` 并解析；浏览器可见相应指标 | 通用 AT 可用，缺专用查询/解析卡片 | 不需要虚构新 API；本次没有直接执行该 AT |
| 自定义展示字段、SD 卡与更多设备属性 | 网页“管理字段”，基础响应有 `external_*_storage`、更详细内存等 | 原生布局固定，SD 卡与若干已读字段未展示 | 信息展示缺口，SD 卡字段存在不代表本机插了卡 |
| TTYD/ADB 端口禁用、放行及开机持久化 | 网页高级区经 `root_shell` 调整 IPv4/IPv6 防火墙及启动脚本 | 有打开 TTYD、通用 Shell/Root Shell，没有此专用工具 | 属于高级操作界面缺口，未触发设备端执行 |

关键源码证据：

- 基础采集：[client.cjs:99](/home/chnut/文档/ChatGPT/F50/ufi-panel-linux/src/core/client.cjs:99)；图表数据字段：[telemetry-data.mjs:4](/home/chnut/文档/ChatGPT/F50/ufi-panel-linux/src/renderer/telemetry-data.mjs:4)。
- 原厂流量写入：[上游 main.js:2344](/home/chnut/文档/ChatGPT/F50/research/feature-audit-20261017/upstream-main.js:2344)；本地校准后台：[maintenance.cjs:85](/home/chnut/文档/ChatGPT/F50/ufi-panel-linux/src/core/maintenance.cjs:85)；现有流量页：[features.mjs:323](/home/chnut/文档/ChatGPT/F50/ufi-panel-linux/src/renderer/features.mjs:323)。
- 制式白名单：[features.cjs:122](/home/chnut/文档/ChatGPT/F50/ufi-panel-linux/src/core/features.cjs:122)；现有 UI：[features.mjs:244](/home/chnut/文档/ChatGPT/F50/ufi-panel-linux/src/renderer/features.mjs:244)。
- 文件列表的实际机制：[上游 main.js:7795](/home/chnut/文档/ChatGPT/F50/research/feature-audit-20261017/upstream-main.js:7795)。
- 定时任务详情：[上游 scheduledTaskModule.kt:182](/home/chnut/文档/ChatGPT/F50/research/feature-audit-20261017/upstream-server/scheduledTaskModule.kt:182)；现有任务页：[features.mjs:333](/home/chnut/文档/ChatGPT/F50/ufi-panel-linux/src/renderer/features.mjs:333)。
- QCI/AMBR 解析：[上游 main.js:3212](/home/chnut/文档/ChatGPT/F50/research/feature-audit-20261017/upstream-main.js:3212)；端口操作：[上游 main.js:7012](/home/chnut/文档/ChatGPT/F50/research/feature-audit-20261017/upstream-main.js:7012)。

## 其他尚未直接接入的服务路由

上游参考服务模块检出 72 条方法/路由声明、63 个去重路径；含读取/写入同路径和静态资源通配，不代表 72 项独立 UI 功能。机器索引在 [server-route-index.json](/home/chnut/文档/ChatGPT/F50/research/feature-audit-20261017/server-route-index.json)。下列路由除了已注明读取成功者，其存在依据是参考服务源码，未做当前设备的写入调用。

| 路由 | 功能 / 当前缺口 | 是否值得作为独立功能 |
| --- | --- | --- |
| `GET /api/get_task?id=...` | 按 ID 读取任务详情，目前没有详情编辑流程 | 值得，与完整任务编辑一起做 |
| `POST /api/do_forward_msg` | 用已有转发渠道主动推送自定义消息；现有配置保存引发测试消息不能代替它 | 可选工具，未发送测试通知 |
| `GET /api/disable_fota` | 禁用设备系统 FOTA 的写操作，尽管方法是 GET | 高级功能候选，本次未调用 |
| `POST /api/update_admin_pwd` | 更新设备保存、供无线 ADB 等功能使用的原厂后台密码 | 与“更改真实原厂登录密码”的 `CHANGE_PASSWORD` 不同，当前缺同步管理 |
| `GET /api/get_official_web_password` | 读取设备保存的原厂口令 | 不建议为凑覆盖率直接显示；本次未读取明文 |
| `POST /api/set_cookie` | 保存共享原厂会话 | 当前客户端已有私有会话，不覆盖设备网页共享 Cookie 是现有设计，不算必须补的按钮 |
| `POST /api/accept_terms`、`GET /api/device_id` | 服务自己的条款状态/设备标识，用于原网页公告等流程 | 非常规设备管理缺口，不应为“全接口”随意提交 |
| `POST /api/clear_task` | 清空所有任务 | 后台分支已存在，缺界面入口 |

这些接口是“需要评估是否有用户价值”，而不是要求每个路由都生成一个按钮。`/api/update_admin_pwd` 语义见 [adbModule.kt:26](/home/chnut/文档/ChatGPT/F50/research/feature-audit-20261017/upstream-server/adbModule.kt:26)，`do_forward_msg` 见 [smsModule.kt:447](/home/chnut/文档/ChatGPT/F50/research/feature-audit-20261017/upstream-server/smsModule.kt:447)。

## APK 真正确认而当前客户端还缺的能力

以下均核对了 APK 可操作入口。具体文件与行号集中在 [APK 证据表](/home/chnut/文档/ChatGPT/F50/ufi-panel-linux/docs/full-parity/audit-20261017/apk-evidence.md)，不是从旧功能名或 HTTP 字符串单独推断。

| 功能组 | APK 已确认功能 | Linux 现状 / 所属环境 |
| --- | --- | --- |
| 更细的 KANO 功能 | ENDC、数据业务优先、USB 仅 RNDIS、短信发送 SIM 选择、短信接收广播/轮询模式 | 缺专用实现；前四类读取能力见下方兼容性结果。短信发送接口写入本次未验证，不能保证当前设备提供 `/api/send_sms` |
| 肥猫卡专用工具 | SIM 槽位选择、移动/联通/电信切换按钮 | 没有专用工具；通过 AT，且仅适用于相应卡，不是任意 SIM 的运营商切换 |
| ZWRT 信令分析 | 信令抓取、NAS/RRC/测量筛选、原始帧/NDJSON、RRC ASN.1 树和导出 | 整套尚未接入；实际流为 `/signal/stream`，并非这台 KANO F50 的已确认接口 |
| ZWRT 载波/无线详情 | 载波聚合卡片、附加载波、TA 距离估算 | 原生界面没有完整对应视图；普通 KANO 聚合状态字段不等于该结构 |
| ZWRT LAN/远程管理 | MTU 编辑、NMS 接入码、自定义 CA、备用地址/远程后台列表、官方后台避让 | 基础 NMS 连接已做，这些高级部分缺失；不是 F50 `:2333` 的同名功能 |
| ZWRT 更新 | 空闲时自动更新、官方/自定义优先/仅自定义、多 HTTPS 源目录 | 已有检查/安装候选版本，缺自动更新及源策略编辑 |
| Android STANDALONE | 本机 Root/AT 服务、模块安装/手动导出、开机恢复、共享守护、插件自启动 | Linux 未做这一模式；不能把 Android 本机模块等同于远程 F50 的一个接口 |
| 客户端本地体验 | 小组件字段替换/排序/外观、关于/隐私/组件许可/客户端更新页；测速方案重命名/删除/持久管理 | Linux 有托盘、悬浮窗、主题、自启及方案导入导出，但未完整覆盖这些配置能力 |

不是所有 APK 差异都应优先移植：Android Root 部署和桌面小组件需要 Linux 对应设计，ZWRT 信令则需要另一类设备/后端。它们不能通过向当前 F50 添加几个按钮完成。

## 当前设备不提供的 APK 路径：不能只补 UI 就宣布支持

本次明确读取如下路径，均返回 **404**。不能由此推断对应 POST 一定不存在，也不能通过发送写入去探测。

| 读取路径 | 实际影响 |
| --- | --- |
| `/api/get_current_location` | 当前客户端虽有“设备定位”页，但该页在这台设备上没有有效数据源；地图跳转也未做 |
| `/api/getEndcState?slot=0` | APK ENDC 开关所需的 KANO 状态读取在本机不存在 |
| `/api/getBaseBandPreferToData?slot=0` | APK 数据优先开关所需的状态读取在本机不存在 |
| `/api/getOnlyRndisSwitch` | APK“仅 RNDIS”与当前已有的 USB 网络协议选择不是同一功能，前者读接口本机不存在 |
| `/api/sms_receive_mode`（不带 mode） | APK 短信接收机制设置在本机没有可用读取接口；带 mode 的 GET 会写入，本次未调用 |
| `/api/getNetworkMode` | APK 的直接 API 本机不存在，但当前客户端可通过 goform 读取/设置网络制式，不代表网络设置整体不可用 |
| `/api/getVoLteState?slot=0` | APK 的另一套 VoLTE 读取路径不存在；本机 `/api/volte_status` 可用，客户端已使用后者 |
| `/api/getVoNrState?slot=0` | 同上；本机 `/api/vonr_status` 可用，不能重复算成未实现 VoNR |
| `/api/getSubIds` | APK 使用的订阅 ID 列表路径不存在；与当前可用的原厂 SIM 字段不同 |

另外，本机 NFC 支持、NFC 开关和 Wi-Fi 休眠的原厂字段当前为空，网页也隐藏这些控件；客户端已有条件显示的实现，不能因此列为“客户端没做”。网页里的关机、高铁模式等同样在此 F50 上隐藏，需要独立判定机型能力。

## 旧对照表不能再直接作为缺失清单

- **已经完成**：SQLite 历史监控（0.5.4）、Wi-Fi 终端踢出/拉黑/解除（0.5.5）、插件中心和独立原生设置（0.5.1–0.5.3）、短信收发分类、邻区选取、设备 OTA、主题/上传、资源服务器。它们不能重复列为“没做”。
- **部分实现**：USB 信息已有原始详情显示，不是完全没有；设备定位有 UI 但本机接口 404；流量校准/清空任务/关机有后台而缺 UI。终端黑名单已做，但白名单/ACL 模式编辑未做；也未证实 APK 有完整白名单 UI，不把它当作本次 F50 网页明确缺项。
- **此前证据不足**：基站地图、可跨重启任意查询的 RRC 历史、APK 批量短信、APK 原厂流量校准、完整 URL/headers 测速图形编辑器，这次不能确认是 APK 已有能力。设备位置地图不等于基站地图，解析字典也不等于历史数据库。
- **PIN 解锁**：静态字符串检索会命中 `ENTER_PIN`，但上游相应代码已整体注释停用；已剔除，不能将注释当作当前可用网页功能。

历史 115 个 ID 混合了功能、子功能、Linux 等价体验和待研究项，没有统一分母；本报告不以它们计算“完成率”，也不声称本次穷尽所有混淆分支或每台机型能力。

## 建议后续顺序

1. 先补原厂流量策略/校准、核心监控与连接统计；同时为定位等不支持接口显示准确的能力提示。
2. 补任务详情/编辑、上传文件浏览、两个缺失制式选项、SELinux/ADB 状态。这些与当前 F50 的实际使用关系最直接。
3. 再做专用高级工具、小组件等价配置和关于/客户端更新。ZWRT 信令/NMS 高级配置、Android STANDALONE 作为单独的模式工作推进。

## 复查方式与边界

只读检查脚本：[audit-device-features.cjs](/home/chnut/文档/ChatGPT/F50/ufi-panel-linux/scripts/diagnostics/audit-device-features.cjs)。示例使用已经存在的私有连接文件，不把口令放入终端参数：

```sh
UFI_CONNECTION_FILE=artifacts/tauri-private-connection.local.json \
  node scripts/diagnostics/audit-device-features.cjs
```

函数存在、接口读取成功、按钮可达、真机写入回读是不同证据等级。本次没有设备写入验收；JADX 的协程/Compose 反编译部分存在错误块，未确认项仍保留不确定性。原始源码摘要和按方法提取的端点索引用于复核，没有发布 APK 反编译代码或设备私有配置。
