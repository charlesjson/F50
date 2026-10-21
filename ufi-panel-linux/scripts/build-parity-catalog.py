#!/usr/bin/env python3
"""Build a reviewable feature ledger from the local APK's decoded evidence.
This is a migration plan, not a claim that the listed capabilities are implemented.
"""
from pathlib import Path
import collections, hashlib, json, re

project = Path(__file__).resolve().parents[1]
workspace = project.parent
analysis = workspace / 'research/ufi-panel-apk'
out = project / 'docs/full-parity'
out.mkdir(parents=True, exist_ok=True)
source_files = {}
for p in (analysis / 'sources').rglob('*.java'):
    rel = p.relative_to(analysis / 'sources')
    decoded = analysis / 'decoded' / rel
    source_files[str(rel)] = (decoded if decoded.exists() else p).read_text()
screens = collections.defaultdict(list)
for file, text in source_files.items():
    for match in re.finditer(r'([A-Za-z][A-Za-z0-9]*(?:Screen|Dialog|Widget))\.kt', text):
        name = match[1]
        if not any(x['file'] == file for x in screens[name]):
            screens[name].append({'file': file, 'line': text.count('\n', 0, match.start()) + 1})

groups = [
 {'id':'overview','name':'概览','icon':'overview','sections':[['dashboard','设备总览'],['parameters','网络参数'],['usage','流量统计'],['location','设备定位']]},
 {'id':'network','name':'网络','icon':'signal','sections':[['cellular','蜂窝与 SIM'],['bands','频段与基站'],['apn','APN'],['hotspot','Wi-Fi 热点'],['lan','LAN / USB'],['clients','连接终端']]},
 {'id':'messages','name':'消息','icon':'mail','sections':[['sms','短信'],['forward','转发与通知'],['activity','通知与执行记录']]},
 {'id':'tools','name':'工具','icon':'terminal','sections':[['speed','测速'],['capture','信令分析'],['terminal','AT / Shell'],['proxy','HTTP 代理'],['usb','USB 信息']]},
 {'id':'automation','name':'自动化','icon':'refresh','sections':[['tasks','定时任务'],['recovery','断网恢复'],['autostart','开机与共享守护']]},
 {'id':'system','name':'系统','icon':'settings','sections':[['devices','设备与连接'],['settings','设备设置'],['plugins','插件'],['updates','软件更新'],['appearance','外观与文件'],['remote','远程管理'],['app','客户端设置'],['about','关于与授权']]},
]
# id | label | section | current status | evidence file/pattern | target modes | interaction | acceptance
# Status: existing = some code exists, never implies full parity or live write validation.
rows = '''
overview.health|温度、CPU、内存与存储|dashboard|existing|m73.java:/api/baseDeviceInfo|KANO/GOFORM/STANDALONE/ZWRT|page|缺失读数与零值区分；断线保留带时间戳的快照
overview.battery|电量、电压、电流与充电状态|dashboard|missing|j83.java:电压 / 电流|capability|page|充电与放电单位统一；无电池机型说明不适用
overview.identity|型号、固件、运行时间与卡信息|dashboard|partial|j83.java:当前数据卡|all|drawer|标识字段可复制；默认遮挡敏感号码
overview.rates|实时上传下载及会话采样|dashboard|existing|rj0.java:realtime_rx_thrpt|all|page|切换设备清空会话曲线；采样空洞不补零
overview.quick|蜂窝、Wi-Fi、短信快捷入口|dashboard|partial|o83.java:Wi-Fi|capability|inline|快捷入口进入相同领域操作；不产生第二套逻辑
params.signal|NR/LTE 信号与详细参数|parameters|existing|rj0.java:Nr_snr|all|page|字段单位与来源可见；不同模式不得互相套用原始字段
params.carriers|载波聚合、PCC/SCC 与频段带宽|parameters|missing|wm.java:已上报载波|capability|drawer|配置状态、激活状态与尚未上报分别显示
params.provenance|参数来源、采样时间与同小区关联|parameters|missing|fk1.java:点按参数查看来源|capability|drawer|展示原始字段、来源与样本时间；不混合不同小区
params.ta|TA 距离估算|parameters|missing|ab3.java:TA 估算距离|ZWRT/verify|drawer|注明估算及步长，不能当作地图直线距离
usage.daily|今日、本月与区间统计|usage|existing|fk1.java:流量管理|capability|page|设备日期边界明确；缺失日期不计零
usage.chart|按日折线、日期区间选择|usage|partial|i83.java:按日折线|capability|page|图表与列表同一数据；空值段落保持断点
usage.limit|流量限额、统计口径与提醒|usage|existing|f22.java:启用限额|capability|inline|变更摘要显示周期、单位、影响；结果回读
usage.calibration|原厂流量校准与清零日期|usage|research|rj0.java:monthly_rx_bytes|KANO/GOFORM|inline|核实 APK 实际入口与原厂参数后再接入，不用额外功能冒充 APK 证据
location.position|设备坐标、精度与刷新|location|missing|mh0.java:设备定位|capability|page|坐标系、精度、来源时间可见；拒绝无效坐标
location.map|外部地图查看位置|location|missing|a40.java:打开 OSM|capability|confirm|跳转前说明发送坐标的目标；仅允许 HTTP(S) 地图地址
location.beep|播放设备提示音|location|missing|j83.java:播放提示音|capability|inline|明确目标设备；操作完成和不支持有独立反馈
cellular.mode|自动、4G、5G SA/NSA 网络制式|cellular|existing|rj0.java:SET_BEARER_PREFERENCE|all|confirm|预览旧值新值；断网后恢复连接并回读
cellular.data|蜂窝连接与断开|cellular|existing|fk1.java:蜂窝网络|capability|confirm|手动断开须暂停自动恢复，避免立即被反向操作
cellular.sim|双卡、默认数据卡与卡槽切换|cellular|partial|fk1.java:切换数据卡|all|confirm|以设备返回卡槽映射显示，不固定猜测 SIM1/2 编号
cellular.voice|每卡 VoLTE / VoNR|cellular|partial|f22.java:高清语音|capability|inline|切换槽位先读该槽位状态；写入时传正确 slot
cellular.endc|ENDC 开关|cellular|missing|sm.java:ENDC 已更新|capability|confirm|读写状态与实际后端支持一致
cellular.dataPriority|基带数据业务优先|cellular|missing|sm.java:数据业务优先已更新|capability|inline|枚举和值域从对应模式核实
cellular.roaming|数据漫游|cellular|existing|xq4.java:数据漫游|capability|confirm|开关、费用影响和回读结果明确
cellular.feline|肥猫卡运营商切换|cellular|missing|qa0.java:肥猫运营商切换|capability|stepper|读取当前卡与运营商；只展示该卡支持的选项
bands.read|支持频段、当前锁频与选择|bands|partial|zb2.java:NR_BAND_LOCK|all|page|可搜索频段列表；未知支持列表不伪装为全支持
bands.write|4G/5G 锁频、分别/全部解锁|bands|partial|zb2.java:LTE_BAND_LOCK|all|confirm|分项结果和回读；部分成功不得显示全成功
bands.neighbors|邻区与已锁小区|bands|existing|zb2.java:earfcn|capability|page|制式、频点、PCI 不缺失时可发起锁定
bands.lock|选择邻区或手动输入锁小区|bands|partial|zb2.java:CELL_LOCK|all|drawer|填入邻区参数，确认具体目标；LTE/NR PCI 范围不同
bands.unlock|解锁全部小区|bands|existing|zb2.java:UNLOCK_ALL_CELL|all|confirm|成功后回读锁记录，保持结果可追溯
apn.list|按卡读取 APN 与默认项|apn|partial|nf.java:APN_config|all|page|不同卡分开；权限不足时禁止不安全修改已有项
apn.edit|新增/编辑 APN 基础与高级字段|apn|partial|be.java:代理 / 服务器|all|drawer|覆盖认证、PDP、代理/彩信/服务字段；保留未知字段
apn.mode|自动/手动、设默认与删除|apn|existing|nf.java:apn_action|all|confirm|禁用不满足 default 类型的配置；删除后回读
wifi.state|热点开关与当前连接状态|hotspot|existing|s34.java:queryWiFiModuleSwitch|all|inline|支持单/双热点；热点重启有重连提示
wifi.basic|SSID、认证、口令、隐藏与上限|hotspot|existing|s34.java:setAccessPointInfo|all|inline|口令保持/替换/清除语义分开；按设备能力限值
wifi.radio|Wi-Fi 频段、芯片、信道与带宽|hotspot|partial|wb1.java:配置信道|capability|inline|频道由国家/频段能力生成，不给固定万能选项
wifi.isolation|热点隔离与访客配置|hotspot|partial|s34.java:ApIsolate|capability|inline|区分主热点和访客热点，按设备原值保存
wifi.boot|热点开机自启与延迟|hotspot|missing|ya1.java:开机自启|STANDALONE/ZWRT/verify|inline|区分当前状态与下次开机生效，展示依赖
wifi.apply|热点配置保存与重启恢复|hotspot|partial|wb1.java:保存后重启热点|all|stepper|保存、重启、重连、回读分阶段显示
lan.address|网关、DHCP、地址池与租约|lan|existing|d83.java:LAN 设置|KANO/GOFORM/ZWRT|confirm|校验掩码与地址池；提供新地址连接动作
lan.mtu|MTU 与网络高级参数|lan|missing|d83.java:MTU|capability|inline|应用前验证后端范围，展示旧值
usb.mode|USB 协议、仅 RNDIS 与恢复默认|lan|missing|ub0.java:恢复默认 USB 模式|capability|confirm|切换断开当前 USB 时有恢复步骤
clients.list|Wi-Fi/有线终端与搜索排序|clients|existing|s34.java:queryAccessPointInfo|capability|page|分页与搜索不重置当前选择
clients.rename|终端别名修改|clients|existing|o83.java:设备管理|KANO/GOFORM/verify|drawer|设备名、IP、MAC 同时呈现以识别对象
clients.acl|接入黑白名单与移除|clients|research|s34.java:queryAccessPointInfo|KANO/GOFORM/verify|drawer|核对 APK 入口；保存完整名单前检查并发修改
sms.read|收件箱、未读、搜索与分页|sms|existing|va0.java:确认删除该短信|all|split|列表选择后右侧读内容；选中项不随轮询跳动
sms.compose|新建、回复与发送结果|sms|existing|wm.java:SmsComposeScreen.kt|all|drawer|草稿按设备/SIM 隔离；明确计费与编码；提交不可自动重试
sms.actions|标记已读、删除与批量选择|sms|partial|k71.java:goform|all|confirm|批量操作有逐项结果；仅针对当前选择执行
sms.slot|接收模式、SIM 与通道选择|sms|missing|hf3.java:/api/|capability|inline|不同后端支持范围从能力表返回
forward.channels|SMTP、Webhook、钉钉与 curl|forward|partial|o9.java:SMTP / Webhook / 钉钉|capability|inline|保留既有秘密；测试发送要显式操作并说明设备副作用
forward.filters|号码/关键词黑名单与设备备注|forward|partial|sh.java:过滤与备注|capability|inline|显示匹配规则和长度限制，保存后回读
forward.power|电量与充电状态通知|forward|partial|sh.java:电源状态通知|capability|inline|明确触发阈值与是否有电池；不支持不显示假状态
forward.test|渠道测试、配额与送达状态|forward|missing|sh.java:今日剩余短信额度|capability|confirm|区分已提交、已接受、已送达、失败；不自动重复发送
activity.list|通知/任务/网络恢复执行记录|activity|missing|d83.java:通知与执行记录|ZWRT|split|过滤分类、展开详情，保留设备时间与状态
activity.clear|清空分类或全部记录|activity|missing|xg3.java:所有分类的通知|ZWRT|confirm|清空记录不影响配置；确认明确不可恢复
speed.local|电脑到设备的内网测速|speed|missing|th3.java:内网测速|capability|job|标注测的是局域网链路；停止关闭所有请求
speed.cellular|通过设备代理的外网测速|speed|missing|rh3.java:测速文件 URL|KANO/verify|job|路径、消耗流量、测试地址可见；绝不混为电脑直连测速
speed.full|跑满了吗：下载/上传/双向并发|speed|missing|a31.java:FullSpeedScreen.kt|verify|job|速率、总量、持续时间、线程和停止语义准确
speed.config|测速方案导入、编辑、导出与分享|speed|missing|mh3.java:SPEED_TEST_CONFIG|local|drawer|兼容原配置 schema，校验 URL；分享由用户显式触发
capture.stream|连接、鉴权、启动、暂停与停止信令流|capture|missing|xk4.java:信令接口|ZWRT|job|解析分片流；取消真正断开流；缓冲与内存有上限
capture.filter|按名称/十六进制码/内容分类过滤|capture|missing|ra3.java:按信令名|ZWRT|split|持续写入时保持选中行与滚动定位
capture.records|原始帧、十六进制与 NDJSON 完整记录|capture|missing|qa0.java:NDJSON 完整记录|ZWRT/local|drawer|保留原始载荷、时间与解码来源，避免丢字段
capture.rrc|RRC ASN.1 树与测量结果|capture|missing|f6.java:RrcTreeDialog.kt|ZWRT/local|split|未知字段保留；解码失败仍可查看原帧
capture.cell|服务小区、完整邻区与载波信息|capture|missing|ra3.java:当前服务小区|ZWRT|drawer|状态与帧按同小区关联，过期帧有标签
capture.radio|上行功率、链路质量与波束|capture|missing|ra3.java:上行功率明细|ZWRT|drawer|单位、有效范围与测量下限说明清楚
capture.qos|APN、EPS/PDU 承载与 QoS 流|capture|missing|ra3.java:APN / 承载 QoS|ZWRT|split|未捕获建立消息不能伪造完整会话
capture.security|安全算法与 IMS 信令|capture|missing|ra3.java:加密/完整性|ZWRT|drawer|未知算法显示未解析，不做无依据判断
capture.fingerprint|基站厂商指纹与证据|capture|missing|ra3.java:基站厂商指纹|ZWRT|drawer|区分推断与事实，提供匹配规则与置信依据
capture.ta|RAR TA 与距离/DRX 等派生分析|capture|missing|ab3.java:RAR 绝对 TA|ZWRT|drawer|算法/单位/推导状态可检查，有真实帧回归样本
capture.export|JSON/NDJSON 导出、清空与重拨补抓|capture|missing|ra3.java:导出抓取数据|ZWRT|job|导出不中断采集；清空需确认；重拨保留抓取
terminal.at|每卡 AT 指令、预设与历史|terminal|partial|j83.java:SIM1/2 指令终端|all|page|选择 SIM；保留输出；支持取消与超时结果未知
terminal.shell|普通/Root Shell 与输出复制|terminal|existing|o83.java:Root Shell|capability|page|区分远程命令权限；不在 Linux 主机执行设备命令
terminal.oneclick|一键工程 Shell|terminal|missing|a40.java:one_click_shell.sh|KANO|job|步骤与运行目标清楚；不把超时当作未执行
terminal.ttyd|TTYD 存活检测与独立终端窗口|terminal|missing|ub0.java:TTYD 网页终端|KANO|window|远程页无本地 Node/IPC 权限
proxy.request|HTTP 代理方法、URL、头、请求体|proxy|missing|nr2.java:HTTP 代理调试|KANO|split|明确从设备发起；敏感头默认不进日志；响应为文本展示
usb.inspect|USB 树、Host 模式、接口与速率|usb|partial|f6.java:当前不是 Host 模式|capability|page|非 Host 不显示空树为硬件故障；设备详情可展开
tasks.list|任务列表、详情与运行状态|tasks|partial|j83.java:定时任务|KANO/ZWRT|split|区分设备调度和桌面本地调度
tasks.basic|重启、网络、Wi-Fi 等定时动作|tasks|existing|ot3.java:/api/add_task|KANO/ZWRT|drawer|设备时区、重复规则、任务 ID 冲突可见
tasks.advanced|定时短信、Shell、AT、锁频等|tasks|missing|j83.java:定时执行 Shell|ZWRT/capability|drawer|按后端动作 schema 构造；危险/收费动作明确预览
tasks.manage|编辑、删除、清空与结果日志|tasks|partial|hu3.java:确认清空所有定时任务|KANO/ZWRT|confirm|单项失败保持其余结果；清空不误删客户端提醒
recovery.config|检测地址、失败阈值、冷却、重拨上限|recovery|missing|sh.java:检测与重新拨号|ZWRT|inline|两个目标失败才累计；参数上下限来自设备
recovery.reboot|拨号失败后重启与限频|recovery|missing|sh.java:每 6 小时最多|ZWRT|confirm|不得绕过设备的每小时/每轮限额
recovery.lifecycle|开始、暂停、恢复、手动断网互斥|recovery|missing|ch3.java:恢复自动检测|ZWRT|inline|手动操作/配置修改取消自动恢复；状态回读
boot.standalone|独立模式服务安装、启用、状态|autostart|equivalent|gg3.java:独立模式自启动模块|STANDALONE|stepper|远程 Android 目标/ABI/Root/签名校验明确；不安装 ARM 程序到 Linux 主机
boot.replay|开机恢复记录、删除与全部取消|autostart|missing|gg3.java:已保存的开机动作|STANDALONE|split|仅修改下次开机动作，不偷偷修改当前设备状态
boot.plugin|UFI-TOOLS 插件脚本自启动|autostart|missing|jx.java:ufi_tools_boot.sh|KANO|inline|显示脚本来源、启动条件与当前状态
boot.tether|以太网/USB 共享守护与开机启动|autostart|equivalent|qv0.java:以太网与 USB|STANDALONE/capability|inline|说明守护运行在设备；停止守护不关闭共享
devices.profiles|保存、编辑、切换与忘记设备|devices|existing|o83.java:忘记设备|all|drawer|切换成功后才替换旧会话；每设备草稿/缓存隔离
devices.discovery|地址探测、默认服务与自动识别|devices|missing|qw1.java:/api/version_info|all|stepper|只探测用户指定网络范围；取消立即停止
devices.modes|KANO / GOFORM / STANDALONE / ZWRT|devices|partial|gm.java:STANDALONE|all|stepper|四种模式分别有接入、鉴权、能力探测与连接测试
devices.auth|UFI/原厂/datad 凭据与合法授权|devices|partial|j71.java:LOGIN|all|drawer|秘密在主进程密钥环；会话不跨地址复用
settings.nickname|设备别名与技术信息|settings|existing|bb0.java:昵称（留空|capability|inline|区分本地连接名与设备别名
settings.power|重启、关机与原厂定时重启|settings|partial|wh3.java:关机后无法远程开机|capability|confirm|按设备支持提供操作，关机说明无法远程开机
settings.toggles|性能、指示灯、SMB、日志、唤醒锁|settings|existing|j83.java:设备信息|KANO/capability|inline|仅变化项提交；组合操作有分项结果
settings.nfc|NFC、自动休眠与机型专用开关|settings|research|j83.java:设备信息|capability|inline|APK 调用路径和设备能力核实后开放
settings.adb|无线 ADB 自启、存活与 USB 调试|settings|partial|f22.java:当前存活|KANO/capability|inline|展示共享凭据被写入/清除的实际副作用
settings.password|UFI 管理口令与原厂认证设置|settings|missing|f22.java:修改登录口令|capability|stepper|新口令验证、会话重建、保存凭据更新构成一条流程
plugins.market|官方/自定义仓库与目录管理|plugins|partial|w21.java:资源服务器配置|KANO|page|仓库错误与空目录不同；不向第三方转发设备凭据
plugins.edit|已装插件添加/编辑/排序/删除|plugins|partial|o83.java:插件管理|KANO|split|可单独管理代码块；原始文本无损；冲突检测与备份
plugins.install|源码预览、追加安装与结果|plugins|existing|o83.java:列表 / 添加 / 市场|KANO|drawer|源代码不在主界面执行；后端接受与实际生效分开
updates.ufi|UFI-TOOLS 检查、下载、进度、安装|updates|missing|jx.java:检查设备资源服务器|KANO|stepper|状态持久化；重连继续观察；不可取消阶段明确
updates.datad|datad 更新源、自动更新与手动安装|updates|missing|up4.java:空闲时自动更新|ZWRT|stepper|版本、来源、安装条件、服务重启恢复完整呈现
updates.desktop|Linux 客户端版本与更新说明|updates|equivalent|hx.java:软件更新|local|page|区分设备服务更新与本机客户端更新
appearance.device|设备 Web 主题、背景、模糊与颜色|appearance|missing|f22.java:主题配置|KANO|inline|设备主题与客户端主题独立，不影响原生工具可读性
appearance.files|背景/文件上传、预览、单项/全部删除|appearance|missing|f22.java:已上传文件|KANO|drawer|上传进度/大小/类型校验；远端资源不作为本地脚本执行
remote.nms|NMS 接入码、凭据、状态与上报间隔|remote|missing|bi3.java:NMS 远程管理|ZWRT|stepper|接入码当作秘密；失败不覆盖有效配置
remote.tls|系统证书、自定义 CA 与备用地址|remote|missing|sh.java:证书与备用地址|ZWRT|drawer|默认验证证书；导入 CA 显示来源和适用目标
remote.web|添加远程后台与访问控制|remote|missing|sh.java:添加后台|ZWRT|drawer|目标与权限明确；独立远程窗口隔离
remote.oem|官方后台避让、倒计时与手动恢复|remote|missing|d83.java:官方后台避让|ZWRT|inline|避让期间暂停自动登录/恢复；倒计时到点回读确认
app.theme|明暗主题、强调色与系统取色等价|app|equivalent|sh.java:动态取色|local|inline|Linux 主题可用性探测；不依赖 Android Monet
app.scale|界面大小、密度与窗口布局|app|equivalent|sh.java:界面大小|local|inline|缩放后按钮仍可达；最小窗口及高 DPI 验收
app.refresh|刷新周期、记住登录与重连策略|app|partial|sh.java:实时刷新|local|inline|监控与编辑刷新分开；后台节流不丢长任务
app.widget|小组件字段、顺序、外观与刷新|app|equivalent|ai4.java:选择下方字段|local|drawer|Linux 托盘详情/可选悬浮监控实现同等信息功能
app.background|后台驻留、自动启动与通知|app|equivalent|hx.java:小组件|local|inline|区分电脑自启与设备自启，用户可彻底退出
about.privacy|关于、隐私、更新日志与组件许可|about|partial|c32.java:更新日志|local|page|列出本客户端真实数据流与许可证，不冒称官方发行
about.activation|独立模式试用、设备码与合法激活入口|about|research|tl3.java:独立模式需要激活|STANDALONE|stepper|先确认官方服务是否允许 Linux 客户端；不伪造授权、不绕过校验
'''

section_group = {s[0]:g['id'] for g in groups for s in g['sections']}
status_names = {'existing':'已有实现，待完整对齐','partial':'部分实现','missing':'待实现','equivalent':'需 Linux 等价实现','research':'协议或范围待核实'}
features=[]
for raw in rows.strip().splitlines():
    id,name,section,status,proof,modes,interaction,acceptance=raw.split('|')
    file,pattern=proof.split(':',1); file='v7/'+file
    text=source_files.get(file,''); pos=text.find(pattern)
    evidence={'file':file,'pattern':pattern,'line':text.count('\n',0,pos)+1 if pos>=0 else None,'matched':pos>=0}
    evidence['basis'] = '关联页证据，具体入口仍待核实' if id in {'clients.list','clients.rename','clients.acl','usage.calibration','settings.toggles','settings.nfc'} else '页面、菜单或协议字面量证据'
    features.append({'id':id,'name':name,'group':section_group[section],'section':section,'status':status,'statusLabel':status_names[status],
      'modes':modes.split('/'),'interaction':interaction,'acceptance':acceptance,'evidence':[evidence],
      'verification':{'ui':False,'contract':False,'deviceRead':False,'deviceWriteReadback':False},
      'notes':'此处状态是 0.3.0 的迁移基线；验收标记需在后续实现中逐项记录。'})

endpoints=collections.defaultdict(list)
for file,text in source_files.items():
    for match in re.finditer(r'"(/api/[^"\s]*)"',text):
        path=match[1]
        if not any(v['file']==file for v in endpoints[path]): endpoints[path].append({'file':file,'line':text.count('\n',0,match.start())+1})
screen_routes = {
 'AboutScreen':'about', 'ApnEditScreen':'apn', 'ApnListScreen':'apn', 'AppSettingsScreen':'app',
 'AtTerminalScreen':'terminal', 'BandScreen':'bands', 'CellLockProductScreen':'bands', 'ConnectScreen':'devices',
 'DeviceLocationScreen':'location', 'FelineCarrierSwitchScreen':'cellular', 'FullSpeedScreen':'speed',
 'HomeScreen':'dashboard', 'HotspotScreen':'hotspot', 'ImagePreviewDialog':'appearance',
 'NdjsonRecordDialog':'capture', 'OtaScreen':'updates', 'ParamsScreen':'parameters', 'PrivacyScreen':'about',
 'ProxyToolScreen':'proxy', 'RrcTreeDialog':'capture', 'SettingsScreen':'settings', 'ShellScreen':'terminal',
 'SignalCaptureScreen':'capture', 'SmsComposeScreen':'sms', 'SmsForwardScreen':'forward', 'SmsTabScreen':'sms',
 'SpeedtestScreen':'speed', 'StandaloneAutostartModuleScreen':'autostart', 'TimingAdvanceDistanceDialog':'parameters',
 'UfiToolsPluginAutostartScreen':'autostart', 'UfiToolsWidget':'app', 'UsageScreen':'usage', 'WidgetSettingsScreen':'app',
 'ZwrtActivityScreen':'activity', 'ZwrtLanScreen':'lan', 'ZwrtNmsScreen':'remote', 'ZwrtOemAccessScreen':'remote',
 'ZwrtOtaScreen':'updates', 'ZwrtRecoveryScreen':'recovery', 'ZwrtShellScreen':'terminal',
 'ZwrtSmsForwardScreen':'forward', 'ZwrtTasksScreen':'tasks', 'ZwrtUsageScreen':'usage',
}
assert set(screens) <= set(screen_routes), f'Unmapped APK screens: {set(screens) - set(screen_routes)}'
phases = [
 {'id':'P0','name':'建立完整证据与验收基线','depends':[], 'sections':[],
  'deliverables':['运行 APK 逐页核对与四后端分支对照','页面/端点/操作证据清单','每项分离 UI、协议、真机读取、真机写入回读状态'],
  'doneWhen':'所有可达入口都有清单 ID；未能验证的分支注明条件和证据，不能被当作完成'},
 {'id':'P1','name':'导航、层级与状态基础','depends':['P0'],'sections':['devices','app'],
  'deliverables':['六组导航与可搜索功能入口','统一抽屉/确认/未保存更改处理','设备会话、草稿与长任务状态隔离'],
  'doneWhen':'旧有功能无回归；1024×700 与高 DPI 下无不可达操作；键盘关闭和焦点恢复通过'},
 {'id':'P2','name':'KANO 与 GOFORM 基础管理闭环','depends':['P1'],'sections':['dashboard','parameters','cellular','bands','apn','hotspot','lan','clients','sms','settings'],
  'deliverables':['GOFORM 直连与 KANO 代理共用官方接口实现','补齐每卡状态与高级字段','写入前预览、断网恢复、回读与部分失败'],
  'doneWhen':'每个已支持动作都有协议样本及独立结果；无未经确认的设备写入'},
 {'id':'P3','name':'KANO 工具与运维功能','depends':['P2'],'sections':['usage','speed','terminal','proxy','usb','plugins','updates','appearance','location','forward','tasks'],
  'deliverables':['测速与配置导入导出','OTA/文件上传进度与恢复','插件、主题、认证、转发、任务完整管理'],
  'doneWhen':'可取消动作真正停止；不可取消阶段明确；设置保存后正确回读'},
 {'id':'P4','name':'ZWRT / datad 接入与管理','depends':['P1'],'sections':['remote','recovery','activity'],
  'deliverables':['Bearer 鉴权、版本与能力发现','ZWRT 网络/短信/任务/流量/更新适配','NMS、官方后台避让、自动恢复与执行日志'],
  'doneWhen':'在可用 datad 环境完成接入、失败恢复及写后回读；无环境仅可标协议测试'},
 {'id':'P5','name':'信令采集与分析','depends':['P4'],'sections':['capture'],
  'deliverables':['流式连接与有界缓冲','RRC/NDJSON/原始帧视图与导出','小区/QoS/安全/指纹/功率/TA 来源关联'],
  'doneWhen':'真实帧样本逐项对照；长时运行有界；未知字段原样保留，不臆测解码'},
 {'id':'P6','name':'独立模式与 Linux 等价体验','depends':['P2'],'sections':['autostart','about'],
  'deliverables':['远程 Android Root/ABI/桥接工具部署向导','独立模式每卡管理与开机恢复','悬浮监控、托盘、外观、电脑自启；合法授权接口核验'],
  'doneWhen':'授权和目标可验证；远程设备动作不在本机误执行；Android 专属项有等价说明'},
 {'id':'P7','name':'全量回归与发行','depends':['P3','P5','P6'],'sections':[],
  'deliverables':['功能清单逐行复核','四模式固件矩阵与不支持说明','AppImage/tar.gz 验证、桌面安装与迁移指南'],
  'doneWhen':'未闭合条目保留为未完成；只有通过完整验收才称功能对齐版'},
]
for f in features:
    mode_specific = f['modes'][0]
    if f['section'] == 'capture': phase='P5'
    elif mode_specific == 'ZWRT' or f['section'] in ['remote','recovery','activity']: phase='P4'
    elif f['id'].startswith('boot.') or f['id'].startswith('app.widget') or f['id'].startswith('app.background') or f['id']=='about.activation': phase='P6'
    else: phase=next((p['id'] for p in phases if f['section'] in p['sections']), 'P3')
    f['phase']=phase
manifest={'title':'UFI Panel Linux 全量迁移清单','baseline':'UFI Panel 1.10.1 (87)','currentDesktop':'0.3.0',
 'apkSha256':hashlib.sha256((workspace/'app-release.apk').read_bytes()).hexdigest(),
 'scope':'目标为 APK 可观察用户功能全量迁移，保留 Linux 已有附加功能；关联证据项仍需核实具体 APK 入口。代码模式支持与固件能力分开记录，不以页面入口替代实现。',
 'testEnvironment':{'available':['F50 / UFI-TOOLS'], 'unavailable':['ZWRT/datad','Android 独立模式'], 'confirmedByUser':True},
 'completeness':'静态清单：覆盖已恢复的页面声明、主要菜单、端点与资源。JADX 存在反编译失败与动态字符串，运行态逐页核对仍是完整性验收前置项。',
 'groups':groups,'screenRoutes':screen_routes,'phases':phases,'features':features,'screens':dict(sorted(screens.items())),'endpoints':dict(sorted(endpoints.items())),
 'counts':{'features':len(features),'screens':len(screens),'endpoints':len(endpoints),'status':dict(collections.Counter(f['status'] for f in features))}}
(out/'feature-catalog.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
missing=[f['id'] for f in features if not all(e['matched'] for e in f['evidence'])]
print(json.dumps({'counts':manifest['counts'],'unmatchedEvidence':missing},ensure_ascii=False))

lines=['# 全量功能迁移矩阵','', '这是迁移与验收条目，不是已完成功能。具体实现/真机验证依赖见 [实施方案](IMPLEMENTATION-PLAN.md)。','']
for group in groups:
    lines += ['## '+group['name'],'', '| ID | 功能 | 0.3.0 基线 | 阶段 | APK 证据 |','| --- | --- | --- | --- | --- |']
    for f in features:
        if f['group']!=group['id']:continue
        e=f['evidence'][0]
        lines.append('| '+ ' | '.join([f['id'],f['name'],status_names[f['status']],f['phase'],f"{e['file']}:{e['line']}（{e['basis']}）"])+' |')
    lines.append('')
lines += ['## 页面覆盖','', '| APK 声明 | 桌面页面 |','| --- | --- |']
section_labels={key:label for g in groups for key,label in g['sections']}
for screen in sorted(screens): lines.append(f'| {screen} | {section_labels[screen_routes[screen]]} |')
(out/'FEATURE-MATRIX.md').write_text('\n'.join(lines)+'\n')
