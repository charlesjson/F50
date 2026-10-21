#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod device_pages;
mod history;
mod plugin_menus;
mod system_tray;
mod tray_popup;
mod web_sessions;
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Write},
    path::PathBuf,
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tauri::{
    webview::NewWindowResponse, Emitter, Manager, State, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use tokio::sync::{oneshot, Notify};

type Reply = Result<Value, String>;
struct Bridge {
    stdin: Mutex<Option<ChildStdin>>,
    child: Mutex<Option<Child>>,
    pending: Mutex<HashMap<u64, oneshot::Sender<Reply>>>,
    sequence: AtomicU64,
    ready: AtomicBool,
    ready_error: Mutex<Option<String>>,
    notify: Notify,
    monitor: Mutex<String>,
    tray_status: Mutex<Value>,
    tray_dragging: Arc<AtomicBool>,
    tray: Mutex<Option<ksni::Handle<system_tray::StatusTray>>>,
    exiting: AtomicBool,
    pages: Arc<device_pages::DevicePages>,
    history: history::History,
}
impl Bridge {
    fn new() -> Self {
        Self {
            stdin: Mutex::new(None),
            child: Mutex::new(None),
            pending: Mutex::new(HashMap::new()),
            sequence: AtomicU64::new(1),
            ready: AtomicBool::new(false),
            ready_error: Mutex::new(None),
            notify: Notify::new(),
            monitor: Mutex::new("尚未连接设备".into()),
            tray_status: Mutex::new(tray_popup::initial_status()),
            tray_dragging: Arc::new(AtomicBool::new(false)),
            tray: Mutex::new(None),
            exiting: AtomicBool::new(false),
            pages: Arc::new(device_pages::DevicePages::default()),
            history: history::History::start(data_dir().join("telemetry.sqlite3")),
        }
    }
    fn write(&self, packet: Value) -> Result<(), String> {
        let mut line = serde_json::to_vec(&packet).map_err(|e| e.to_string())?;
        line.push(b'\n');
        self.stdin
            .lock()
            .unwrap()
            .as_mut()
            .ok_or("设备后端未运行")?
            .write_all(&line)
            .map_err(|e| e.to_string())
    }
    async fn request(&self, action: &str, input: Value) -> Reply {
        if !self.ready.load(Ordering::SeqCst) {
            let wait = self.notify.notified();
            if !self.ready.load(Ordering::SeqCst) && self.ready_error.lock().unwrap().is_none() {
                tokio::time::timeout(Duration::from_secs(20), wait)
                    .await
                    .map_err(|_| "设备后端启动超时".to_string())?;
            }
        }
        if let Some(error) = self.ready_error.lock().unwrap().clone() {
            return Err(error);
        }
        let id = self.sequence.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = oneshot::channel();
        self.pending.lock().unwrap().insert(id, tx);
        if let Err(error) =
            self.write(json!({"kind":"request","id":id,"action":action,"input":input}))
        {
            self.pending.lock().unwrap().remove(&id);
            return Err(error);
        }
        rx.await
            .map_err(|_| "设备后端已关闭，未自动重发操作".to_string())?
    }
    fn close(&self) {
        self.exiting.store(true, Ordering::SeqCst);
        if let Some(tray) = self.tray.lock().unwrap().take() {
            let _ = tray.shutdown();
        }
        let _ = self.write(json!({"kind":"shutdown"}));
        self.stdin.lock().unwrap().take();
        if let Some(mut child) = self.child.lock().unwrap().take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        self.history.close();
        self.pages.cleanup();
    }
}
fn config_home() -> PathBuf {
    std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(std::env::var_os("HOME").unwrap_or_default()).join(".config")
        })
}
fn data_dir() -> PathBuf {
    std::env::var_os("UFI_TEST_USER_DATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| config_home().join("ufi-panel-linux"))
}
fn worker_path() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let base = exe.parent().ok_or("无法定位程序")?;
    let mut options = vec![
        base.join("backend/worker.cjs"),
        base.join("../lib/ufi-panel-linux/backend/worker.cjs"),
    ];
    if cfg!(debug_assertions) {
        options.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../src/worker.cjs"));
    }
    options
        .into_iter()
        .find(|p| p.is_file())
        .ok_or("未找到设备后端文件，请完整安装软件包".into())
}
fn master_key() -> Option<Vec<u8>> {
    if std::env::var_os("UFI_TEST_USER_DATA").is_some() {
        // Isolated native fixtures may supply their own ephemeral encryption
        // key. Production profiles always use the system Secret Service.
        return std::fs::read(data_dir().join("test-master-key"))
            .ok()
            .filter(|key| key.len() == 32);
    }
    use secret_service::{blocking::SecretService, EncryptionType};
    let service = SecretService::connect(EncryptionType::Dh).ok()?;
    let collection = service.get_default_collection().ok()?;
    if collection.is_locked().ok()? {
        return None;
    }
    let attributes = HashMap::from([
        ("application", "io.ufi.panel.linux"),
        ("purpose", "tauri-profile-key-v1"),
    ]);
    for item in collection.search_items(attributes.clone()).ok()? {
        if let Ok(secret) = item.get_secret() {
            if secret.len() == 32 {
                return Some(secret);
            }
        }
    }
    let secret = rand::random::<[u8; 32]>();
    collection
        .create_item(
            "UFI Panel connection encryption",
            attributes,
            &secret,
            true,
            "application/octet-stream",
        )
        .ok()?;
    Some(secret.to_vec())
}
fn trusted_main(label: &str, url: &url::Url) -> bool {
    label == "main" && url.scheme() == "tauri" && url.host_str() == Some("localhost")
}
fn autostart_enabled(file: &std::path::Path) -> bool {
    let Ok(content) = std::fs::read_to_string(file) else {
        return false;
    };
    !content
        .lines()
        .any(|line| line == "Hidden=true" || line == "X-GNOME-Autostart-enabled=false")
}
fn migrate_autostart() {
    if cfg!(debug_assertions) || std::env::var_os("UFI_TEST_USER_DATA").is_some() {
        return;
    }
    let file = config_home().join("autostart/ufi-panel-linux.desktop");
    if !autostart_enabled(&file) {
        return;
    }
    let Ok(content) = std::fs::read_to_string(&file) else {
        return;
    };
    if !content.contains("Name=UFI Panel Linux")
        || !(content.contains("app.asar") || content.contains("AppImage"))
    {
        return;
    }
    let backup = file.with_extension("desktop.electron-backup");
    if !backup.exists() {
        let _ = std::fs::copy(&file, backup);
    }
    if let Ok(exe) = std::env::current_exe() {
        let path = exe
            .to_string_lossy()
            .replace('\\', "\\\\\\\\")
            .replace('"', "\\\\\"")
            .replace('`', "\\\\`")
            .replace('$', "\\\\$")
            .replace('%', "%%");
        let changed = content
            .lines()
            .map(|line| {
                if line.starts_with("Exec=") {
                    format!("Exec=\"{path}\"")
                } else {
                    line.to_string()
                }
            })
            .collect::<Vec<_>>()
            .join("\n")
            + "\n";
        let _ = std::fs::write(file, changed);
    }
}
fn show_main(app: &tauri::AppHandle) {
    tray_popup::hide(app);
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}
fn monitor_update(app: &tauri::AppHandle, text: &str) {
    if let Some(window) = app.get_webview_window("monitor") {
        if let Ok(value) = serde_json::to_string(text) {
            let _ = window.eval(format!(
                "document.getElementById('monitor-data').textContent = {value}"
            ));
        }
    }
}
fn handle_event(app: &tauri::AppHandle, bridge: &Arc<Bridge>, event: &str, mut payload: Value) {
    if bridge.exiting.load(Ordering::SeqCst) {
        return;
    }
    match event {
        "telemetry" => {
            bridge.history.record(&payload);
            payload["historyError"] = json!(bridge.history.error());
            let _ = app.emit_to("main", event, payload);
        }
        "monitor" => {
            let text = payload["text"]
                .as_str()
                .unwrap_or("尚未连接设备")
                .to_string();
            *bridge.monitor.lock().unwrap() = text.clone();
            monitor_update(app, &text);
            if payload["status"].is_object() {
                *bridge.tray_status.lock().unwrap() = payload["status"].clone();
                tray_popup::update(app, &payload["status"]);
            }
        }
        "tray" => {
            let name = payload["name"].as_str().unwrap_or("未连接");
            let temperature = payload["temperature"]
                .as_f64()
                .map(|v| format!(" · {v:.1}°C"))
                .unwrap_or_default();
            system_tray::update(bridge, format!("UFI Panel · {name}{temperature}"));
        }
        "device-clear" => {
            bridge
                .pages
                .reset(app, payload["context"].as_str().unwrap_or(""));
        }
        "device-online" => {
            bridge
                .pages
                .recovered(app, payload["context"].as_str().unwrap_or(""));
        }
        "plugins-changed" => {
            bridge.pages.close_settings(app, false);
            let _ = app.emit_to("main", event, payload);
        }
        _ => {
            let _ = app.emit_to("main", event, payload);
        }
    }
}
fn start_worker(app: &tauri::AppHandle, bridge: Arc<Bridge>) -> Result<(), String> {
    let worker = worker_path()?;
    let mut child = Command::new("/usr/bin/node")
        .arg(worker)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|e| format!("无法启动系统 Node.js（需要 18 或以上）：{e}"))?;
    let output = child.stdout.take().ok_or("后端输出未连接")?;
    *bridge.stdin.lock().unwrap() = child.stdin.take();
    *bridge.child.lock().unwrap() = Some(child);
    let app_handle = app.clone();
    let reader_bridge = bridge.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(output).lines() {
            let Ok(line) = line else { break };
            let Ok(packet) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            match packet["kind"].as_str().unwrap_or("") {
                "ready" => {
                    reader_bridge.ready.store(true, Ordering::SeqCst);
                    reader_bridge.notify.notify_waiters();
                    show_main(&app_handle);
                }
                "startup-error" => {
                    *reader_bridge.ready_error.lock().unwrap() = Some(
                        packet["error"]
                            .as_str()
                            .unwrap_or("后端初始化失败")
                            .to_string(),
                    );
                    reader_bridge.notify.notify_waiters();
                    show_main(&app_handle);
                }
                "response" => {
                    if let Some(id) = packet["id"].as_u64() {
                        if let Some(tx) = reader_bridge.pending.lock().unwrap().remove(&id) {
                            let reply = if packet["ok"].as_bool() == Some(true) {
                                Ok(packet["value"].clone())
                            } else {
                                Err(packet["error"].as_str().unwrap_or("操作失败").to_string())
                            };
                            let _ = tx.send(reply);
                        }
                    }
                }
                "event" => handle_event(
                    &app_handle,
                    &reader_bridge,
                    packet["event"].as_str().unwrap_or(""),
                    packet["payload"].clone(),
                ),
                "host" => {
                    let host_app = app_handle.clone();
                    let host_bridge = reader_bridge.clone();
                    tauri::async_runtime::spawn(async move {
                        let id = packet["id"].clone();
                        let action = packet["action"].as_str().unwrap_or("").to_string();
                        let input = packet["input"].clone();
                        let callback_bridge = host_bridge.clone();
                        let result = tauri::async_runtime::spawn_blocking(move || {
                            host_action(&host_app, &callback_bridge, &action, input)
                        })
                        .await;
                        let response = match result {
                            Ok(Ok(value)) => {
                                json!({"kind":"host-response","id":id,"ok":true,"value":value})
                            }
                            Ok(Err(error)) => {
                                json!({"kind":"host-response","id":id,"ok":false,"error":error})
                            }
                            Err(_) => {
                                json!({"kind":"host-response","id":id,"ok":false,"error":"桌面操作失败"})
                            }
                        };
                        let _ = reader_bridge_write(&host_bridge, &response);
                    });
                }
                _ => {}
            }
        }
        if !reader_bridge.exiting.load(Ordering::SeqCst) {
            *reader_bridge.ready_error.lock().unwrap() =
                Some("设备后端已退出；未自动重发操作".into());
            reader_bridge.notify.notify_waiters();
            let pending = std::mem::take(&mut *reader_bridge.pending.lock().unwrap());
            for (_, tx) in pending {
                let _ = tx.send(Err("设备后端已退出；结果可能未知，请重新读取确认".into()));
            }
            show_main(&app_handle);
        }
    });
    let init_app = app.clone();
    let init_bridge = bridge.clone();
    std::thread::spawn(move || {
        let key = master_key();
        init_bridge.pages.set_encryption_key(key.as_deref());
        let secret = key.map(|bytes| STANDARD.encode(bytes));
        let result =
            init_bridge.write(json!({"kind":"init","directory":data_dir(),"masterKey":secret}));
        if let Err(error) = result {
            *init_bridge.ready_error.lock().unwrap() = Some(error);
            init_bridge.notify.notify_waiters();
            show_main(&init_app);
        }
    });
    Ok(())
}
fn reader_bridge_write(bridge: &Arc<Bridge>, packet: &Value) -> Result<(), String> {
    bridge.write(packet.clone())
}
fn host_action(app: &tauri::AppHandle, bridge: &Arc<Bridge>, action: &str, input: Value) -> Reply {
    match action {
        "hide-window" => {
            app.get_webview_window("main")
                .ok_or("窗口已关闭")?
                .hide()
                .map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "show-window" => {
            show_main(app);
            Ok(Value::Null)
        }
        "set-zoom" => {
            let scale = input
                .as_f64()
                .filter(|v| *v >= 0.8 && *v <= 1.2)
                .ok_or("无效缩放")?;
            app.get_webview_window("main")
                .ok_or("窗口已关闭")?
                .set_zoom(scale)
                .map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "copy-text" => {
            app.clipboard()
                .write_text(input.as_str().ok_or("无效内容")?)
                .map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "monitor-open" => {
            if let Some(window) = app.get_webview_window("monitor") {
                window.show().map_err(|e| e.to_string())?;
            } else {
                let app_handle = app.clone();
                let state = bridge.clone();
                WebviewWindowBuilder::new(app, "monitor", WebviewUrl::App("monitor.html".into()))
                    .data_directory(data_dir().join("webview"))
                    .title("UFI 悬浮监控")
                    .inner_size(320.0, 260.0)
                    .min_inner_size(280.0, 200.0)
                    .always_on_top(true)
                    .on_navigation(|u| u.scheme() == "tauri" && u.host_str() == Some("localhost"))
                    .on_page_load(move |_, _| {
                        monitor_update(&app_handle, &state.monitor.lock().unwrap());
                    })
                    .build()
                    .map_err(|e| e.to_string())?;
            }
            monitor_update(app, &bridge.monitor.lock().unwrap());
            Ok(json!({"opened":true}))
        }
        "open-panel"
        | "open-terminal"
        | "open-plugin-settings"
        | "plugin-menus-start"
        | "plugin-menu-open"
        | "plugin-menus-release" => bridge.pages.open(app, action, input),
        "confirm" => {
            #[cfg(debug_assertions)]
            if std::env::var_os("UFI_TEST_USER_DATA").is_some() {
                if let Ok(value) = std::env::var("UFI_TEST_CONFIRM_RESPONSE") {
                    return Ok(json!({"response":if value=="accept"{1}else{0}}));
                }
            }
            let title = input["title"].as_str().unwrap_or("确认设备操作");
            let message = input["message"].as_str().unwrap_or(title);
            let detail = input["detail"].as_str().unwrap_or("");
            let mut dialog = app
                .dialog()
                .message(format!("{message}\n\n{detail}"))
                .title(title)
                .buttons(MessageDialogButtons::OkCancelCustom(
                    "执行".into(),
                    "取消".into(),
                ));
            if let Some(window) = app.get_webview_window("main") {
                dialog = dialog.parent(&window);
            }
            let accepted = dialog.blocking_show();
            Ok(json!({"response":if accepted{1}else{0}}))
        }
        "file-open" | "file-save" => {
            let mut dialog = app
                .dialog()
                .file()
                .set_title(input["title"].as_str().unwrap_or("选择文件"));
            if let Some(window) = app.get_webview_window("main") {
                dialog = dialog.set_parent(&window);
            }
            if let Some(filters) = input["filters"].as_array() {
                for filter in filters {
                    if let Some(ext) = filter["extensions"].as_array() {
                        let values = ext.iter().filter_map(Value::as_str).collect::<Vec<_>>();
                        dialog =
                            dialog.add_filter(filter["name"].as_str().unwrap_or("文件"), &values);
                    }
                }
            }
            if let Some(name) = input["defaultPath"].as_str() {
                dialog = dialog.set_file_name(name);
            }
            let selected = if action == "file-open" {
                dialog.blocking_pick_file()
            } else {
                dialog.blocking_save_file()
            };
            let selected = selected.and_then(|file| file.into_path().ok());
            Ok(if action == "file-open" {
                json!({"canceled":selected.is_none(),"filePaths":selected.into_iter().collect::<Vec<_>>()})
            } else {
                json!({"canceled":selected.is_none(),"filePath":selected})
            })
        }
        "autostart" => {
            let file = config_home().join("autostart/ufi-panel-linux.desktop");
            if !input.is_null() {
                let enabled = input.as_bool().ok_or("无效自启动设置")?;
                if enabled {
                    let exe = std::env::current_exe()
                        .map_err(|e| e.to_string())?
                        .to_string_lossy()
                        .into_owned();
                    if exe.contains(['\n', '\r']) {
                        return Err("无效程序路径".into());
                    }
                    let escaped = exe
                        .replace('\\', "\\\\\\\\")
                        .replace('"', "\\\\\"")
                        .replace('`', "\\\\`")
                        .replace('$', "\\\\$")
                        .replace('%', "%%");
                    std::fs::create_dir_all(file.parent().unwrap()).map_err(|e| e.to_string())?;
                    std::fs::write(&file,format!("[Desktop Entry]\nType=Application\nName=UFI Panel Linux\nExec=\"{escaped}\"\nTerminal=false\nX-GNOME-Autostart-enabled=true\n")).map_err(|e|e.to_string())?;
                    use std::os::unix::fs::PermissionsExt;
                    std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o600))
                        .map_err(|e| e.to_string())?;
                } else if file.exists() {
                    std::fs::remove_file(&file).map_err(|e| e.to_string())?;
                }
            }
            Ok(json!({"supported":true,"enabled":autostart_enabled(&file)}))
        }
        _ => Err("未知桌面操作".into()),
    }
}
#[tauri::command]
async fn dispatch(
    window: WebviewWindow,
    bridge: State<'_, Arc<Bridge>>,
    action: String,
    input: Option<Value>,
) -> Reply {
    let url = window.url().map_err(|e| e.to_string())?;
    if !trusted_main(window.label(), &url) {
        return Err("不允许的请求来源".into());
    }
    let input = input.unwrap_or(Value::Null);
    if matches!(action.as_str(), "history-devices" | "history-query") {
        return bridge.history.request(&action, input).await;
    }
    bridge.request(&action, input).await
}
fn main() {
    if std::env::args().any(|arg| arg == "--build-info") {
        println!(
            "{}",
            include_str!("../../build/tauri-ui/build-manifest.json")
        );
        return;
    }
    if std::env::args().any(|arg| arg == "--version") {
        println!(
            "UFI Panel Linux {} (Tauri/WebKitGTK)",
            env!("CARGO_PKG_VERSION")
        );
        return;
    }
    let bridge = Arc::new(Bridge::new());
    let setup_bridge = bridge.clone();
    let exit_bridge = bridge.clone();
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            show_main(app)
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(bridge)
        .invoke_handler(tauri::generate_handler![
            dispatch,
            tray_popup::tray_popup_action
        ])
        .setup(move |app| {
            let browser_directory = data_dir().join("webview");
            std::fs::create_dir_all(&browser_directory)?;
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(data_dir(), std::fs::Permissions::from_mode(0o700))?;
            let main = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .data_directory(browser_directory)
                .title("UFI Panel Linux")
                .inner_size(1240.0, 800.0)
                .min_inner_size(1024.0, 700.0)
                .visible(false)
                .on_navigation(|url| trusted_main("main", url))
                .on_new_window(|_, _| NewWindowResponse::Deny)
                .build()?;
            drop(main);
            migrate_autostart();
            system_tray::start(app.handle(), setup_bridge.clone())
                .map_err(std::io::Error::other)?;
            if let Some(window) = app.get_webview_window("main") {
                let state = setup_bridge.clone();
                let window_copy = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        if !state.exiting.load(Ordering::SeqCst)
                            && std::env::var_os("UFI_TEST_USER_DATA").is_none()
                        {
                            api.prevent_close();
                            let _ = window_copy.hide();
                        }
                    }
                });
            }
            start_worker(app.handle(), setup_bridge.clone()).map_err(std::io::Error::other)?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("无法启动 UFI Panel");
    app.run(move |_, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            exit_bridge.close();
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn device_windows_and_external_origins_cannot_invoke_local_backend() {
        assert!(trusted_main(
            "main",
            &url::Url::parse("tauri://localhost/index.html").unwrap()
        ));
        for (label, address) in [
            ("panel", "http://192.168.0.1:2333/"),
            ("main", "https://example.com/"),
            ("main", "tauri://other/index.html"),
            ("monitor", "tauri://localhost/monitor.html"),
            ("tray-status", "tauri://localhost/tray-status.html"),
        ] {
            assert!(!trusted_main(label, &url::Url::parse(address).unwrap()));
        }
    }
}
