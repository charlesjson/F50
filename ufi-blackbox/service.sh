#!/system/bin/sh
# All files here belong to this plugin. No other services are stopped.
BB_HOME=/data/adb/ufi-blackbox
case "$1" in
  start)
    if "$BB_HOME/blackbox" status >/dev/null 2>&1; then
      printf '{"running":true}\n'
      exit 0
    fi
    if [ ! -f "$BB_HOME/config.json" ]; then
      printf '{"error":"尚未配置设备连接"}\n'
      exit 1
    fi
    /system/bin/nohup "$BB_HOME/blackbox" serve </dev/null >/dev/null 2>&1 &
    count=0
    while [ "$count" -lt 15 ]; do
      if "$BB_HOME/blackbox" status >/dev/null 2>&1; then
        printf '{"running":true}\n'
        exit 0
      fi
      /system/bin/sleep 0.2
      count=$((count+1))
    done
    printf '{"error":"采集器未启动，请检查安装或连接配置"}\n'
    exit 1
    ;;
  stop)
    "$BB_HOME/blackbox" stop
    ;;
  *)
    printf '{"error":"只支持 start 或 stop"}\n'
    exit 1
    ;;
esac
