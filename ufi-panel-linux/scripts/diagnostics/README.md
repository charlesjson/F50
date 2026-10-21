# 内存诊断

这些工具用于复现和测量，不进入客户端安装包。`probe-device-memory.py` 使用宿主机的 GTK 3 / WebKit2 4.1 GI，默认测试目标为当前实验设备 `192.168.0.1:2333`，可通过 `--address` 指定其他页面。它不提交设备设置；页面仍会执行自身的常规状态查询。

`--saved-session` 从本机 UFI Panel 的 Secret Service 和加密配置读取现有设备会话，只在临时 WebKit 上下文内使用，不打印或保存口令。需要 Python GI、libsecret GI 和 cryptography。

必须使用有资源上限的独立测试组。测试器会在总 RSS 达到 1536 MiB 时主动结束测试页面，cgroup 的 2 GiB 上限作为第二层保护：

```sh
systemd-run --user --scope --quiet -p MemoryMax=2G -p MemorySwapMax=0 \
  python3 scripts/diagnostics/probe-device-memory.py \
  --mode raw --variant normal --seconds 30 --saved-session \
  --report memory-control-original

systemd-run --user --scope --quiet -p MemoryMax=2G -p MemorySwapMax=0 \
  python3 scripts/diagnostics/probe-device-memory.py \
  --mode raw --variant no-backdrop --seconds 300 --saved-session \
  --report memory-raw-fixed-five-minutes
```

`no-backdrop` 直接读取产品中的 `src-tauri/src/device-page-compat.css`，不会维护另一份测试专用修复。`--mode host` 还加载产品的 UFI 宿主页面刷新管理脚本，用于区分客户端注入与页面本身的行为。

输出在 `artifacts/`，包含各进程 RSS、交换占用、画布尺寸与 DOM 数量，不包含设备字段内容。RSS 总和会重复计算共享页，适合作为停止阈值；报告中的渲染进程曲线应单独读取 `WebKitWebProces`，不要把总 RSS 当成应用的精确物理占用。

`tauri-memory-check.cjs` 是隔离容器中的 Tauri/模拟设备观测工具，依赖上一级现有 WebDriver 工具。它适合验证本地主界面，但容器 WebKit 版本与宿主机不同时，不能代替宿主机的兼容性测试。
