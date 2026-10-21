# 全量功能迁移矩阵

这是迁移与验收条目，不是已完成功能。具体实现/真机验证依赖见 [实施方案](IMPLEMENTATION-PLAN.md)。

## 概览

| ID | 功能 | 0.3.0 基线 | 阶段 | APK 证据 |
| --- | --- | --- | --- | --- |
| overview.health | 温度、CPU、内存与存储 | 已有实现，待完整对齐 | P2 | v7/m73.java:2541（页面、菜单或协议字面量证据） |
| overview.battery | 电量、电压、电流与充电状态 | 待实现 | P2 | v7/j83.java:344（页面、菜单或协议字面量证据） |
| overview.identity | 型号、固件、运行时间与卡信息 | 部分实现 | P2 | v7/j83.java:399（页面、菜单或协议字面量证据） |
| overview.rates | 实时上传下载及会话采样 | 已有实现，待完整对齐 | P2 | v7/rj0.java:108（页面、菜单或协议字面量证据） |
| overview.quick | 蜂窝、Wi-Fi、短信快捷入口 | 部分实现 | P2 | v7/o83.java:819（页面、菜单或协议字面量证据） |
| params.signal | NR/LTE 信号与详细参数 | 已有实现，待完整对齐 | P2 | v7/rj0.java:109（页面、菜单或协议字面量证据） |
| params.carriers | 载波聚合、PCC/SCC 与频段带宽 | 待实现 | P2 | v7/wm.java:268（页面、菜单或协议字面量证据） |
| params.provenance | 参数来源、采样时间与同小区关联 | 待实现 | P2 | v7/fk1.java:773（页面、菜单或协议字面量证据） |
| params.ta | TA 距离估算 | 待实现 | P4 | v7/ab3.java:42（页面、菜单或协议字面量证据） |
| usage.daily | 今日、本月与区间统计 | 已有实现，待完整对齐 | P3 | v7/fk1.java:3087（页面、菜单或协议字面量证据） |
| usage.chart | 按日折线、日期区间选择 | 部分实现 | P3 | v7/i83.java:166（页面、菜单或协议字面量证据） |
| usage.limit | 流量限额、统计口径与提醒 | 已有实现，待完整对齐 | P3 | v7/f22.java:532（页面、菜单或协议字面量证据） |
| usage.calibration | 原厂流量校准与清零日期 | 协议或范围待核实 | P3 | v7/rj0.java:108（关联页证据，具体入口仍待核实） |
| location.position | 设备坐标、精度与刷新 | 待实现 | P3 | v7/mh0.java:226（页面、菜单或协议字面量证据） |
| location.map | 外部地图查看位置 | 待实现 | P3 | v7/a40.java:78（页面、菜单或协议字面量证据） |
| location.beep | 播放设备提示音 | 待实现 | P3 | v7/j83.java:87（页面、菜单或协议字面量证据） |

## 网络

| ID | 功能 | 0.3.0 基线 | 阶段 | APK 证据 |
| --- | --- | --- | --- | --- |
| cellular.mode | 自动、4G、5G SA/NSA 网络制式 | 已有实现，待完整对齐 | P2 | v7/rj0.java:3548（页面、菜单或协议字面量证据） |
| cellular.data | 蜂窝连接与断开 | 已有实现，待完整对齐 | P2 | v7/fk1.java:965（页面、菜单或协议字面量证据） |
| cellular.sim | 双卡、默认数据卡与卡槽切换 | 部分实现 | P2 | v7/fk1.java:1295（页面、菜单或协议字面量证据） |
| cellular.voice | 每卡 VoLTE / VoNR | 部分实现 | P2 | v7/f22.java:437（页面、菜单或协议字面量证据） |
| cellular.endc | ENDC 开关 | 待实现 | P2 | v7/sm.java:99（页面、菜单或协议字面量证据） |
| cellular.dataPriority | 基带数据业务优先 | 待实现 | P2 | v7/sm.java:102（页面、菜单或协议字面量证据） |
| cellular.roaming | 数据漫游 | 已有实现，待完整对齐 | P2 | v7/xq4.java:10（页面、菜单或协议字面量证据） |
| cellular.feline | 肥猫卡运营商切换 | 待实现 | P2 | v7/qa0.java:2100（页面、菜单或协议字面量证据） |
| bands.read | 支持频段、当前锁频与选择 | 部分实现 | P2 | v7/zb2.java:1014（页面、菜单或协议字面量证据） |
| bands.write | 4G/5G 锁频、分别/全部解锁 | 部分实现 | P2 | v7/zb2.java:1014（页面、菜单或协议字面量证据） |
| bands.neighbors | 邻区与已锁小区 | 已有实现，待完整对齐 | P2 | v7/zb2.java:406（页面、菜单或协议字面量证据） |
| bands.lock | 选择邻区或手动输入锁小区 | 部分实现 | P2 | v7/zb2.java:1282（页面、菜单或协议字面量证据） |
| bands.unlock | 解锁全部小区 | 已有实现，待完整对齐 | P2 | v7/zb2.java:2142（页面、菜单或协议字面量证据） |
| apn.list | 按卡读取 APN 与默认项 | 部分实现 | P2 | v7/nf.java:601（页面、菜单或协议字面量证据） |
| apn.edit | 新增/编辑 APN 基础与高级字段 | 部分实现 | P2 | v7/be.java:292（页面、菜单或协议字面量证据） |
| apn.mode | 自动/手动、设默认与删除 | 已有实现，待完整对齐 | P2 | v7/nf.java:454（页面、菜单或协议字面量证据） |
| wifi.state | 热点开关与当前连接状态 | 已有实现，待完整对齐 | P2 | v7/s34.java:2272（页面、菜单或协议字面量证据） |
| wifi.basic | SSID、认证、口令、隐藏与上限 | 已有实现，待完整对齐 | P2 | v7/s34.java:2785（页面、菜单或协议字面量证据） |
| wifi.radio | Wi-Fi 频段、芯片、信道与带宽 | 部分实现 | P2 | v7/wb1.java:1030（页面、菜单或协议字面量证据） |
| wifi.isolation | 热点隔离与访客配置 | 部分实现 | P2 | v7/s34.java:2862（页面、菜单或协议字面量证据） |
| wifi.boot | 热点开机自启与延迟 | 待实现 | P2 | v7/ya1.java:49（页面、菜单或协议字面量证据） |
| wifi.apply | 热点配置保存与重启恢复 | 部分实现 | P2 | v7/wb1.java:1686（页面、菜单或协议字面量证据） |
| lan.address | 网关、DHCP、地址池与租约 | 已有实现，待完整对齐 | P2 | v7/d83.java:105（页面、菜单或协议字面量证据） |
| lan.mtu | MTU 与网络高级参数 | 待实现 | P2 | v7/d83.java:106（页面、菜单或协议字面量证据） |
| usb.mode | USB 协议、仅 RNDIS 与恢复默认 | 待实现 | P2 | v7/ub0.java:3218（页面、菜单或协议字面量证据） |
| clients.list | Wi-Fi/有线终端与搜索排序 | 已有实现，待完整对齐 | P2 | v7/s34.java:2036（关联页证据，具体入口仍待核实） |
| clients.rename | 终端别名修改 | 已有实现，待完整对齐 | P2 | v7/o83.java:834（关联页证据，具体入口仍待核实） |
| clients.acl | 接入黑白名单与移除 | 协议或范围待核实 | P2 | v7/s34.java:2036（关联页证据，具体入口仍待核实） |

## 消息

| ID | 功能 | 0.3.0 基线 | 阶段 | APK 证据 |
| --- | --- | --- | --- | --- |
| sms.read | 收件箱、未读、搜索与分页 | 已有实现，待完整对齐 | P2 | v7/va0.java:328（页面、菜单或协议字面量证据） |
| sms.compose | 新建、回复与发送结果 | 已有实现，待完整对齐 | P2 | v7/wm.java:33（页面、菜单或协议字面量证据） |
| sms.actions | 标记已读、删除与批量选择 | 部分实现 | P2 | v7/k71.java:18（页面、菜单或协议字面量证据） |
| sms.slot | 接收模式、SIM 与通道选择 | 待实现 | P2 | v7/hf3.java:102（页面、菜单或协议字面量证据） |
| forward.channels | SMTP、Webhook、钉钉与 curl | 部分实现 | P3 | v7/o9.java:54（页面、菜单或协议字面量证据） |
| forward.filters | 号码/关键词黑名单与设备备注 | 部分实现 | P3 | v7/sh.java:3053（页面、菜单或协议字面量证据） |
| forward.power | 电量与充电状态通知 | 部分实现 | P3 | v7/sh.java:2384（页面、菜单或协议字面量证据） |
| forward.test | 渠道测试、配额与送达状态 | 待实现 | P3 | v7/sh.java:2329（页面、菜单或协议字面量证据） |
| activity.list | 通知/任务/网络恢复执行记录 | 待实现 | P4 | v7/d83.java:21（页面、菜单或协议字面量证据） |
| activity.clear | 清空分类或全部记录 | 待实现 | P4 | v7/xg3.java:630（页面、菜单或协议字面量证据） |

## 工具

| ID | 功能 | 0.3.0 基线 | 阶段 | APK 证据 |
| --- | --- | --- | --- | --- |
| speed.local | 电脑到设备的内网测速 | 待实现 | P3 | v7/th3.java:219（页面、菜单或协议字面量证据） |
| speed.cellular | 通过设备代理的外网测速 | 待实现 | P3 | v7/rh3.java:162（页面、菜单或协议字面量证据） |
| speed.full | 跑满了吗：下载/上传/双向并发 | 待实现 | P3 | v7/a31.java:46（页面、菜单或协议字面量证据） |
| speed.config | 测速方案导入、编辑、导出与分享 | 待实现 | P3 | v7/mh3.java:14（页面、菜单或协议字面量证据） |
| capture.stream | 连接、鉴权、启动、暂停与停止信令流 | 待实现 | P5 | v7/xk4.java:1526（页面、菜单或协议字面量证据） |
| capture.filter | 按名称/十六进制码/内容分类过滤 | 待实现 | P5 | v7/ra3.java:7409（页面、菜单或协议字面量证据） |
| capture.records | 原始帧、十六进制与 NDJSON 完整记录 | 待实现 | P5 | v7/qa0.java:2402（页面、菜单或协议字面量证据） |
| capture.rrc | RRC ASN.1 树与测量结果 | 待实现 | P5 | v7/f6.java:2255（页面、菜单或协议字面量证据） |
| capture.cell | 服务小区、完整邻区与载波信息 | 待实现 | P5 | v7/ra3.java:8676（页面、菜单或协议字面量证据） |
| capture.radio | 上行功率、链路质量与波束 | 待实现 | P5 | v7/ra3.java:8721（页面、菜单或协议字面量证据） |
| capture.qos | APN、EPS/PDU 承载与 QoS 流 | 待实现 | P5 | v7/ra3.java:8435（页面、菜单或协议字面量证据） |
| capture.security | 安全算法与 IMS 信令 | 待实现 | P5 | v7/ra3.java:4204（页面、菜单或协议字面量证据） |
| capture.fingerprint | 基站厂商指纹与证据 | 待实现 | P5 | v7/ra3.java:8399（页面、菜单或协议字面量证据） |
| capture.ta | RAR TA 与距离/DRX 等派生分析 | 待实现 | P5 | v7/ab3.java:41（页面、菜单或协议字面量证据） |
| capture.export | JSON/NDJSON 导出、清空与重拨补抓 | 待实现 | P5 | v7/ra3.java:8706（页面、菜单或协议字面量证据） |
| terminal.at | 每卡 AT 指令、预设与历史 | 部分实现 | P3 | v7/j83.java:162（页面、菜单或协议字面量证据） |
| terminal.shell | 普通/Root Shell 与输出复制 | 已有实现，待完整对齐 | P3 | v7/o83.java:852（页面、菜单或协议字面量证据） |
| terminal.oneclick | 一键工程 Shell | 待实现 | P3 | v7/a40.java:475（页面、菜单或协议字面量证据） |
| terminal.ttyd | TTYD 存活检测与独立终端窗口 | 待实现 | P3 | v7/ub0.java:3423（页面、菜单或协议字面量证据） |
| proxy.request | HTTP 代理方法、URL、头、请求体 | 待实现 | P3 | v7/nr2.java:95（页面、菜单或协议字面量证据） |
| usb.inspect | USB 树、Host 模式、接口与速率 | 部分实现 | P3 | v7/f6.java:2156（页面、菜单或协议字面量证据） |

## 自动化

| ID | 功能 | 0.3.0 基线 | 阶段 | APK 证据 |
| --- | --- | --- | --- | --- |
| tasks.list | 任务列表、详情与运行状态 | 部分实现 | P3 | v7/j83.java:40（页面、菜单或协议字面量证据） |
| tasks.basic | 重启、网络、Wi-Fi 等定时动作 | 已有实现，待完整对齐 | P3 | v7/ot3.java:90（页面、菜单或协议字面量证据） |
| tasks.advanced | 定时短信、Shell、AT、锁频等 | 待实现 | P4 | v7/j83.java:41（页面、菜单或协议字面量证据） |
| tasks.manage | 编辑、删除、清空与结果日志 | 部分实现 | P3 | v7/hu3.java:1028（页面、菜单或协议字面量证据） |
| recovery.config | 检测地址、失败阈值、冷却、重拨上限 | 待实现 | P4 | v7/sh.java:1944（页面、菜单或协议字面量证据） |
| recovery.reboot | 拨号失败后重启与限频 | 待实现 | P4 | v7/sh.java:2021（页面、菜单或协议字面量证据） |
| recovery.lifecycle | 开始、暂停、恢复、手动断网互斥 | 待实现 | P4 | v7/ch3.java:1718（页面、菜单或协议字面量证据） |
| boot.standalone | 独立模式服务安装、启用、状态 | 需 Linux 等价实现 | P6 | v7/gg3.java:592（页面、菜单或协议字面量证据） |
| boot.replay | 开机恢复记录、删除与全部取消 | 待实现 | P6 | v7/gg3.java:1734（页面、菜单或协议字面量证据） |
| boot.plugin | UFI-TOOLS 插件脚本自启动 | 待实现 | P6 | v7/jx.java:426（页面、菜单或协议字面量证据） |
| boot.tether | 以太网/USB 共享守护与开机启动 | 需 Linux 等价实现 | P6 | v7/qv0.java:411（页面、菜单或协议字面量证据） |

## 系统

| ID | 功能 | 0.3.0 基线 | 阶段 | APK 证据 |
| --- | --- | --- | --- | --- |
| devices.profiles | 保存、编辑、切换与忘记设备 | 已有实现，待完整对齐 | P1 | v7/o83.java:759（页面、菜单或协议字面量证据） |
| devices.discovery | 地址探测、默认服务与自动识别 | 待实现 | P1 | v7/qw1.java:48（页面、菜单或协议字面量证据） |
| devices.modes | KANO / GOFORM / STANDALONE / ZWRT | 部分实现 | P1 | v7/gm.java:22（页面、菜单或协议字面量证据） |
| devices.auth | UFI/原厂/datad 凭据与合法授权 | 部分实现 | P1 | v7/j71.java:585（页面、菜单或协议字面量证据） |
| settings.nickname | 设备别名与技术信息 | 已有实现，待完整对齐 | P2 | v7/bb0.java:1739（页面、菜单或协议字面量证据） |
| settings.power | 重启、关机与原厂定时重启 | 部分实现 | P2 | v7/wh3.java:2893（页面、菜单或协议字面量证据） |
| settings.toggles | 性能、指示灯、SMB、日志、唤醒锁 | 已有实现，待完整对齐 | P2 | v7/j83.java:52（关联页证据，具体入口仍待核实） |
| settings.nfc | NFC、自动休眠与机型专用开关 | 协议或范围待核实 | P2 | v7/j83.java:52（关联页证据，具体入口仍待核实） |
| settings.adb | 无线 ADB 自启、存活与 USB 调试 | 部分实现 | P2 | v7/f22.java:89（页面、菜单或协议字面量证据） |
| settings.password | UFI 管理口令与原厂认证设置 | 待实现 | P2 | v7/f22.java:358（页面、菜单或协议字面量证据） |
| plugins.market | 官方/自定义仓库与目录管理 | 部分实现 | P3 | v7/w21.java:205（页面、菜单或协议字面量证据） |
| plugins.edit | 已装插件添加/编辑/排序/删除 | 部分实现 | P3 | v7/o83.java:852（页面、菜单或协议字面量证据） |
| plugins.install | 源码预览、追加安装与结果 | 已有实现，待完整对齐 | P3 | v7/o83.java:852（页面、菜单或协议字面量证据） |
| updates.ufi | UFI-TOOLS 检查、下载、进度、安装 | 待实现 | P3 | v7/jx.java:161（页面、菜单或协议字面量证据） |
| updates.datad | datad 更新源、自动更新与手动安装 | 待实现 | P4 | v7/up4.java:44（页面、菜单或协议字面量证据） |
| updates.desktop | Linux 客户端版本与更新说明 | 需 Linux 等价实现 | P3 | v7/hx.java:299（页面、菜单或协议字面量证据） |
| appearance.device | 设备 Web 主题、背景、模糊与颜色 | 待实现 | P3 | v7/f22.java:158（页面、菜单或协议字面量证据） |
| appearance.files | 背景/文件上传、预览、单项/全部删除 | 待实现 | P3 | v7/f22.java:324（页面、菜单或协议字面量证据） |
| remote.nms | NMS 接入码、凭据、状态与上报间隔 | 待实现 | P4 | v7/bi3.java:2327（页面、菜单或协议字面量证据） |
| remote.tls | 系统证书、自定义 CA 与备用地址 | 待实现 | P4 | v7/sh.java:1376（页面、菜单或协议字面量证据） |
| remote.web | 添加远程后台与访问控制 | 待实现 | P4 | v7/sh.java:1324（页面、菜单或协议字面量证据） |
| remote.oem | 官方后台避让、倒计时与手动恢复 | 待实现 | P4 | v7/d83.java:165（页面、菜单或协议字面量证据） |
| app.theme | 明暗主题、强调色与系统取色等价 | 需 Linux 等价实现 | P1 | v7/sh.java:190（页面、菜单或协议字面量证据） |
| app.scale | 界面大小、密度与窗口布局 | 需 Linux 等价实现 | P1 | v7/sh.java:217（页面、菜单或协议字面量证据） |
| app.refresh | 刷新周期、记住登录与重连策略 | 部分实现 | P1 | v7/sh.java:256（页面、菜单或协议字面量证据） |
| app.widget | 小组件字段、顺序、外观与刷新 | 需 Linux 等价实现 | P6 | v7/ai4.java:296（页面、菜单或协议字面量证据） |
| app.background | 后台驻留、自动启动与通知 | 需 Linux 等价实现 | P6 | v7/hx.java:288（页面、菜单或协议字面量证据） |
| about.privacy | 关于、隐私、更新日志与组件许可 | 部分实现 | P6 | v7/c32.java:29（页面、菜单或协议字面量证据） |
| about.activation | 独立模式试用、设备码与合法激活入口 | 协议或范围待核实 | P6 | v7/tl3.java:43（页面、菜单或协议字面量证据） |

## 页面覆盖

| APK 声明 | 桌面页面 |
| --- | --- |
| AboutScreen | 关于与授权 |
| ApnEditScreen | APN |
| ApnListScreen | APN |
| AppSettingsScreen | 客户端设置 |
| AtTerminalScreen | AT / Shell |
| BandScreen | 频段与基站 |
| CellLockProductScreen | 频段与基站 |
| ConnectScreen | 设备与连接 |
| DeviceLocationScreen | 设备定位 |
| FelineCarrierSwitchScreen | 蜂窝与 SIM |
| FullSpeedScreen | 测速 |
| HomeScreen | 设备总览 |
| HotspotScreen | Wi-Fi 热点 |
| ImagePreviewDialog | 外观与文件 |
| NdjsonRecordDialog | 信令分析 |
| OtaScreen | 软件更新 |
| ParamsScreen | 网络参数 |
| PrivacyScreen | 关于与授权 |
| ProxyToolScreen | HTTP 代理 |
| RrcTreeDialog | 信令分析 |
| SettingsScreen | 设备设置 |
| ShellScreen | AT / Shell |
| SignalCaptureScreen | 信令分析 |
| SmsComposeScreen | 短信 |
| SmsForwardScreen | 转发与通知 |
| SmsTabScreen | 短信 |
| SpeedtestScreen | 测速 |
| StandaloneAutostartModuleScreen | 开机与共享守护 |
| TimingAdvanceDistanceDialog | 网络参数 |
| UfiToolsPluginAutostartScreen | 开机与共享守护 |
| UfiToolsWidget | 客户端设置 |
| UsageScreen | 流量统计 |
| WidgetSettingsScreen | 客户端设置 |
| ZwrtActivityScreen | 通知与执行记录 |
| ZwrtLanScreen | LAN / USB |
| ZwrtNmsScreen | 远程管理 |
| ZwrtOemAccessScreen | 远程管理 |
| ZwrtOtaScreen | 软件更新 |
| ZwrtRecoveryScreen | 断网恢复 |
| ZwrtShellScreen | AT / Shell |
| ZwrtSmsForwardScreen | 转发与通知 |
| ZwrtTasksScreen | 定时任务 |
| ZwrtUsageScreen | 流量统计 |
