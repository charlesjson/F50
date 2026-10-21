use serde_json::{json, Value};
use std::{
    cell::Cell,
    collections::{HashMap, HashSet},
    path::PathBuf,
    sync::{Arc, Mutex},
};
use tauri::{webview::NewWindowResponse, Manager, WebviewUrl, WebviewWindowBuilder};
use webkit2gtk::{
    DownloadExt, LoadEvent, URIResponseExt, UserContentInjectedFrames, UserContentManagerExt,
    UserStyleLevel, UserStyleSheet, WebContextExt, WebResourceExt, WebViewExt,
};

#[derive(Default)]
pub struct DevicePages {
    context: Mutex<String>,
    directory: Mutex<Option<PathBuf>>,
    directories: Mutex<Vec<PathBuf>>,
    session: Mutex<Option<WebSession>>,
    sessions: crate::web_sessions::WebSessions,
    failed: Mutex<HashMap<String, url::Url>>,
    // Logical page -> (unique native label, identity). Destruction is asynchronous
    // in WebKit/Tauri, so replacing a window must not immediately reuse its label.
    identities: Mutex<HashMap<String, (String, String)>>,
    download_contexts: Mutex<HashSet<PathBuf>>,
    menus: Arc<crate::plugin_menus::PluginMenus>,
}

#[derive(Clone)]
struct WebSession {
    key: String,
    base: url::Url,
    authorization: String,
    password: String,
    login_method: String,
    persist: bool,
}

impl WebSession {
    fn from_value(value: &Value) -> Result<Self, String> {
        let key = value["key"].as_str().ok_or("缺少网页会话标识")?;
        if key.len() != 64 || !key.bytes().all(|c| c.is_ascii_hexdigit()) {
            return Err("无效网页会话标识".into());
        }
        let authorization = value["authorization"].as_str().unwrap_or("");
        if !authorization.is_empty()
            && (authorization.len() != 64 || !authorization.bytes().all(|c| c.is_ascii_hexdigit()))
        {
            return Err("无效网页登录凭据".into());
        }
        let password = value["password"].as_str().unwrap_or("");
        if password.len() > 1024 {
            return Err("无效网页登录凭据".into());
        }
        Ok(Self {
            key: key.to_string(),
            base: checked_url(value["address"].as_str().ok_or("缺少网页会话地址")?)?,
            authorization: authorization.to_string(),
            password: password.to_string(),
            login_method: if value["loginMethod"] == "LOGIN_MULTI_USER" {
                "1"
            } else {
                "0"
            }
            .into(),
            persist: value["persist"].as_bool().unwrap_or(false),
        })
    }
    fn script(&self, nonce: &str) -> String {
        if self.authorization.is_empty() {
            return String::new();
        }
        include_str!("device-page-session.js").replace("__UFI_WEB_SESSION__", &json!({
            "origin":self.base.origin().ascii_serialization(), "path":self.base.path(),
            "authorization":self.authorization,"password":self.password,"loginMethod":self.login_method,
            "nonce":nonce,
        }).to_string())
    }
}

fn checked_url(address: &str) -> Result<url::Url, String> {
    let url = url::Url::parse(address).map_err(|_| "无效设备页面地址")?;
    if !["http", "https"].contains(&url.scheme())
        || !url.username().is_empty()
        || url.password().is_some()
        || url.host_str().is_none()
    {
        return Err("无效设备页面地址".into());
    }
    Ok(url)
}
fn within(url: &url::Url, base: &url::Url) -> bool {
    let prefix = base.path().trim_end_matches('/');
    url.origin() == base.origin()
        && (url.path() == prefix || url.path().starts_with(&format!("{prefix}/")))
}
fn page_navigation(url: &url::Url, base: &url::Url) -> bool {
    within(url, base)
        || (url.scheme() == "blob"
            && url::Url::parse(url.path()).is_ok_and(|source| source.origin() == base.origin()))
}
fn same_device_panel(url: &url::Url, base: &url::Url) -> bool {
    url.scheme() == base.scheme()
        && url.host_str() == base.host_str()
        && url.username().is_empty()
        && url.password().is_none()
}
fn plugin_navigation(url: &url::Url, base: &url::Url) -> bool {
    page_navigation(url, base)
        || same_device_panel(url, base)
        || (url.scheme() == "blob"
            && url::Url::parse(url.path()).is_ok_and(|source| same_device_panel(&source, base)))
}
impl DevicePages {
    pub fn set_encryption_key(&self, key: Option<&[u8]>) {
        self.sessions.set_key(key);
    }
    fn prepare_session(&self, value: &Value) -> Result<(), String> {
        let mut session = WebSession::from_value(value)?;
        if let Ok(Some(saved)) = self.sessions.load(&session.key) {
            // A changed UFI token invalidates credentials from an earlier login.
            if saved["authorization"].as_str() == Some(session.authorization.as_str())
                && session.password.is_empty()
            {
                session.password = saved["password"].as_str().unwrap_or("").to_string();
                if let Some(method) = saved["loginMethod"]
                    .as_str()
                    .filter(|method| ["0", "1"].contains(method))
                {
                    session.login_method = method.to_string();
                }
            }
        }
        let changed = self
            .session
            .lock()
            .unwrap()
            .as_ref()
            .map_or(true, |current| current.key != session.key);
        if changed {
            self.directory.lock().unwrap().take();
        }
        let payload = json!({"authorization":session.authorization,"password":session.password,"loginMethod":session.login_method});
        if self
            .sessions
            .save(&session.key, payload, session.persist)
            .is_err()
        {
            eprintln!("无法保存网页登录状态");
        }
        *self.session.lock().unwrap() = Some(session);
        Ok(())
    }
    fn remember_login(&self, key: &str, nonce: &str, message: &str, persist: bool) {
        if message.len() > 8192 {
            return;
        }
        let Ok(value) = serde_json::from_str::<Value>(message) else {
            return;
        };
        if value["nonce"].as_str() != Some(nonce) {
            return;
        }
        let authorization = value["authorization"].as_str().unwrap_or("");
        let password = value["password"].as_str().unwrap_or("");
        // The UFI page clears its active token on network/login expiry too.
        // Keep the saved credential so recovery can authenticate again.
        if authorization.is_empty() {
            return;
        }
        if password.len() > 1024
            || (!authorization.is_empty()
                && (authorization.len() != 64
                    || !authorization.bytes().all(|c| c.is_ascii_hexdigit())))
        {
            return;
        }
        let payload = json!({"authorization":authorization,"password":password,
            "loginMethod":if value["loginMethod"] == "1" { "1" } else { "0" }});
        if self.sessions.save(key, payload, persist).is_err() {
            eprintln!("无法保存网页登录状态");
        }
    }
    pub fn reset(&self, app: &tauri::AppHandle, context: &str) {
        *self.context.lock().unwrap() = context.to_string();
        self.close_settings(app, true);
        self.directory.lock().unwrap().take();
        self.session.lock().unwrap().take();
        self.failed.lock().unwrap().clear();
    }
    pub fn recovered(&self, app: &tauri::AppHandle, context: &str) {
        if *self.context.lock().unwrap() != context {
            return;
        }
        let failed = std::mem::take(&mut *self.failed.lock().unwrap());
        for (label, address) in failed {
            if let Some(window) = app.get_webview_window(&label) {
                let _ = window.navigate(address);
            }
        }
        let labels = self
            .identities
            .lock()
            .unwrap()
            .values()
            .map(|page| page.0.clone())
            .collect::<Vec<_>>();
        for label in labels {
            if let Some(window) = app.get_webview_window(&label) {
                let _ = window.eval("window.__ufiRestoreWebSession?.()");
            }
        }
    }
    pub fn close_settings(&self, app: &tauri::AppHandle, all: bool) {
        self.menus.clear();
        let labels = {
            let mut pages = self.identities.lock().unwrap();
            let keys: Vec<_> = pages
                .keys()
                .filter(|key| all || key.as_str() != "device-terminal")
                .cloned()
                .collect();
            keys.into_iter()
                .filter_map(|key| pages.remove(&key).map(|page| page.0))
                .collect::<Vec<_>>()
        };
        for label in labels {
            if let Some(window) = app.get_webview_window(&label) {
                let _ = window.destroy();
            }
        }
    }
    fn window(&self, app: &tauri::AppHandle, key: &str) -> Option<tauri::WebviewWindow> {
        let label = self.identities.lock().unwrap().get(key)?.0.clone();
        app.get_webview_window(&label)
    }
    fn session_directory(&self) -> Result<PathBuf, String> {
        let mut current = self.directory.lock().unwrap();
        if let Some(directory) = current.as_ref() {
            return Ok(directory.clone());
        }
        let persistent = self
            .session
            .lock()
            .unwrap()
            .as_ref()
            .map(|session| crate::data_dir().join("device-webviews").join(&session.key));
        let directory = persistent.clone().unwrap_or_else(|| {
            std::env::temp_dir().join(format!(
                "ufi-panel-device-{}-{:x}",
                std::process::id(),
                rand::random::<u64>()
            ))
        });
        std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o700))
            .map_err(|e| e.to_string())?;
        if persistent.is_none() {
            self.directories.lock().unwrap().push(directory.clone());
        }
        *current = Some(directory.clone());
        Ok(directory)
    }
    pub fn cleanup(&self) {
        for directory in self.directories.lock().unwrap().drain(..) {
            let _ = std::fs::remove_dir_all(directory);
        }
    }
    pub fn open(
        self: &Arc<Self>,
        app: &tauri::AppHandle,
        action: &str,
        input: Value,
    ) -> Result<Value, String> {
        let context = input["context"].as_str().ok_or("缺少设备会话")?.to_string();
        if context.is_empty() || *self.context.lock().unwrap() != context {
            return Err("设备连接已变更".into());
        }
        if let Some(value) = input.get("session") {
            self.prepare_session(value)?;
        }
        if action == "plugin-menus-release" {
            if let Some(window) = self.window(app, "device-plugin-menus") {
                if !window.is_visible().unwrap_or(false) {
                    let _ = window.destroy();
                    self.menus.clear();
                    self.identities
                        .lock()
                        .unwrap()
                        .remove("device-plugin-menus");
                }
            }
            return Ok(Value::Null);
        }
        if action == "plugin-menu-open" {
            let token = self.menus.selection(&input)?;
            let window = self
                .window(app, "device-plugin-menus")
                .ok_or("插件菜单已关闭，请刷新后重试")?;
            window.show().map_err(|e| e.to_string())?;
            window.set_focus().map_err(|e| e.to_string())?;
            window
                .eval(format!("window.__ufiPluginMenuFocus?.({})", json!(token)))
                .map_err(|e| e.to_string())?;
            return Ok(json!({"opened":true}));
        }
        let runtime = action == "plugin-menus-start";
        let url = checked_url(input["address"].as_str().ok_or("缺少设备地址")?)?;
        let key = match action {
            "open-panel" => "device-panel",
            "open-terminal" => "device-terminal",
            "open-plugin-settings" => "device-plugin",
            "open-device-popup" => "device-popup",
            "plugin-menus-start" => "device-plugin-menus",
            _ => return Err("未知设备页面".into()),
        };
        let identity = json!([
            context,
            url.as_str(),
            input["revision"],
            input["view"]["selected"]
        ])
        .to_string();
        if let Some(window) = self.window(app, key) {
            let same = self
                .identities
                .lock()
                .unwrap()
                .get(key)
                .is_some_and(|page| page.1 == identity);
            if same && !(runtime && input["refresh"].as_bool() == Some(true)) {
                if runtime {
                    return Ok(self.menus.snapshot());
                }
                window.show().map_err(|e| e.to_string())?;
                window.set_focus().map_err(|e| e.to_string())?;
                return Ok(json!({"opened":true}));
            }
            window.destroy().map_err(|e| e.to_string())?;
        }
        let label = format!("{key}-{:016x}", rand::random::<u64>());
        let title = match action {
            "open-panel" => "UFI-TOOLS · 完整面板",
            "open-terminal" => "UFI · TTYD",
            "open-device-popup" => "UFI · 设备面板",
            "plugin-menus-start" => "UFI · 插件功能",
            _ => input["title"].as_str().unwrap_or("UFI · 插件设置"),
        };
        let base = url.clone();
        let popup_base = url.clone();
        let popup_panel = checked_url(input["panel"].as_str().unwrap_or(url.as_str()))
            .unwrap_or_else(|_| url.clone());
        let instance = if runtime {
            self.menus.start(
                &context,
                input["revision"].as_str().unwrap_or(""),
                &input["plugins"],
            )
        } else {
            String::new()
        };
        let view = &input["view"];
        let projection = view.is_object();
        let menu_script = if runtime || projection {
            let plugins = if projection {
                &view["plugins"]
            } else {
                &input["plugins"]
            };
            let unmanaged = if projection {
                &view["unmanaged"]
            } else {
                &input["unmanaged"]
            };
            include_str!("plugin-menu-runtime.js")
                .replace(
                    "__UFI_PLUGIN_MENUS__",
                    &json!({"origin":url.origin().ascii_serialization(),"path":url.path(),
                "plugins":plugins,"unmanaged":unmanaged,"selected":view["selected"]})
                    .to_string(),
                )
                .replace(
                    "__UFI_PLUGIN_VIEW_RENDERER__",
                    include_str!("plugin-view-runtime.js"),
                )
        } else {
            String::new()
        };
        let popup_app = app.clone();
        let pages = self.clone();
        let navigation_context = context.clone();
        let navigation_pages = self.clone();
        let download_directory = std::env::var_os("UFI_TEST_USER_DATA")
            .map(|directory| PathBuf::from(directory).join("downloads"))
            .or_else(|| app.path().download_dir().ok());
        let data_directory = self.session_directory()?;
        let web_session = self.session.lock().unwrap().clone();
        let session_nonce = format!("{:032x}", rand::random::<u128>());
        let session_script = web_session
            .as_ref()
            .map(|session| session.script(&session_nonce))
            .unwrap_or_default();
        let download_pages = self.clone();
        // Install the compatibility stylesheet before the first device page
        // loads; adding it after navigation leaves the initial render exposed.
        let window = WebviewWindowBuilder::new(
            app,
            label.clone(),
            WebviewUrl::External(url::Url::parse("about:blank").unwrap()),
        )
        .title(title)
        .inner_size(1180.0, 820.0)
        .visible(!runtime)
        .data_directory(data_directory.clone())
        .initialization_script(session_script)
        .initialization_script(include_str!("device-page-lifecycle.js"))
        .initialization_script(menu_script)
        .on_navigation(move |target| {
            *navigation_pages.context.lock().unwrap() == navigation_context
                && (target.as_str() == "about:blank"
                    || if runtime || projection {
                        plugin_navigation(target, &base)
                    } else {
                        page_navigation(target, &base)
                    })
        })
        .on_new_window(move |target, _| {
            if *pages.context.lock().unwrap() == context
                && (within(&target, &popup_base)
                    || within(&target, &popup_panel)
                    || ((runtime || projection) && same_device_panel(&target, &popup_panel)))
            {
                let handle = popup_app.clone();
                let state = pages.clone();
                let options = json!({"context":context,"address":target.as_str()});
                // Create a separate view without window.opener or local permissions.
                let _ = popup_app.run_on_main_thread(move || {
                    let _ = state.open(&handle, "open-device-popup", options);
                });
            }
            NewWindowResponse::Deny
        })
        .build()
        .map_err(|e| e.to_string())?;
        if runtime {
            let close_menus = self.menus.clone();
            let close_app = app.clone();
            let close_instance = instance.clone();
            window.on_window_event(move |event| {
                if matches!(event, tauri::WindowEvent::Destroyed) {
                    close_menus.closed(&close_app, &close_instance);
                }
            });
        }
        let menus = self.menus.clone();
        let menu_app = app.clone();
        let load_pages = self.clone();
        let load_label = label.clone();
        let load_context = input["context"].as_str().unwrap_or("").to_string();
        let session_context = load_context.clone();
        let session_label = label.clone();
        let session_pages = self.clone();
        let session_app = app.clone();
        window
            .with_webview(move |webview| {
                let inner = webview.inner();
                let failed_pages = load_pages.clone();
                let failed_label = load_label.clone();
                let failed_context = load_context.clone();
                inner.connect_load_failed(move |_, _, address, error| {
                    // Ignore intentional cancellation when replacing or navigating
                    // a view; only retry failed loads when telemetry comes online.
                    if error.matches(webkit2gtk::NetworkError::Cancelled) {
                        return false;
                    }
                    if *failed_pages.context.lock().unwrap() == failed_context {
                        if let Ok(address) = checked_url(address) {
                            failed_pages
                                .failed
                                .lock()
                                .unwrap()
                                .insert(failed_label.clone(), address);
                        }
                    }
                    false
                });
                inner.connect_load_changed(move |view, event| {
                    if event == LoadEvent::Finished
                        && *load_pages.context.lock().unwrap() == load_context
                        && view
                            .main_resource()
                            .and_then(|resource| resource.response())
                            .is_some_and(|response| (200..400).contains(&response.status_code()))
                    {
                        load_pages.failed.lock().unwrap().remove(&load_label);
                    }
                });
                if let Some(context) = inner.context() {
                    // Wry retains one WebContext per data directory on Linux.
                    // Per-window handlers survive destruction and can cancel a
                    // replacement window's downloads. Route the session's default
                    // destination before transfer, including Wry's earlier handler.
                    if download_pages
                        .download_contexts
                        .lock()
                        .unwrap()
                        .insert(data_directory)
                    {
                        context.connect_download_started(move |_, download| {
                            let directory = download_directory.clone();
                            let routed = Cell::new(false);
                            // The first decide-destination handler stops signal
                            // propagation. Its synchronous destination notification
                            // still lets us retain the suggested name and redirect
                            // it before WebKit writes any bytes.
                            download.connect_destination_notify(move |download| {
                                if routed.get() {
                                    return;
                                }
                                let Some(original) = download.destination() else {
                                    return;
                                };
                                routed.set(true);
                                let Some(directory) = &directory else {
                                    download.cancel();
                                    return;
                                };
                                if std::fs::create_dir_all(directory).is_err() {
                                    download.cancel();
                                    return;
                                }
                                let original = url::Url::parse(&original)
                                    .ok()
                                    .and_then(|url| url.to_file_path().ok())
                                    .unwrap_or_else(|| PathBuf::from(original.as_str()));
                                let filename = original
                                    .file_name()
                                    .unwrap_or_else(|| std::ffi::OsStr::new("backup"));
                                let destination = directory.join(format!(
                                    "ufi-{:016x}-{}",
                                    rand::random::<u64>(),
                                    filename.to_string_lossy()
                                ));
                                if let Ok(uri) = url::Url::from_file_path(destination) {
                                    download.set_allow_overwrite(false);
                                    download.set_destination(uri.as_str());
                                } else {
                                    download.cancel();
                                }
                            });
                        });
                    }
                }
                if let Some(manager) = inner.user_content_manager() {
                    if let Some(session) =
                        web_session.filter(|session| !session.authorization.is_empty())
                    {
                        manager.connect_script_message_received(
                            Some("ufiWebSession"),
                            move |_, result| {
                                if *session_pages.context.lock().unwrap() != session_context {
                                    return;
                                }
                                let Some(window) = session_app.get_webview_window(&session_label)
                                else {
                                    return;
                                };
                                if !window.url().is_ok_and(|url| within(&url, &session.base)) {
                                    return;
                                }
                                if let Some(value) = result.js_value() {
                                    session_pages.remember_login(
                                        &session.key,
                                        &session_nonce,
                                        &value.to_string(),
                                        session.persist,
                                    );
                                }
                            },
                        );
                        manager.register_script_message_handler("ufiWebSession");
                    }
                    if runtime {
                        manager.connect_script_message_received(
                            Some("ufiPluginMenus"),
                            move |_, value| {
                                if let Some(value) = value.js_value() {
                                    menus.receive(&menu_app, &instance, &value.to_string());
                                }
                            },
                        );
                        manager.register_script_message_handler("ufiPluginMenus");
                    }
                    manager.add_style_sheet(&UserStyleSheet::new(
                        include_str!("device-page-compat.css"),
                        UserContentInjectedFrames::AllFrames,
                        UserStyleLevel::User,
                        &[],
                        &[],
                    ));
                    if runtime || projection {
                        manager.add_style_sheet(&UserStyleSheet::new(
                            include_str!("plugin-view.css"),
                            UserContentInjectedFrames::TopFrame,
                            UserStyleLevel::User,
                            &[],
                            &[],
                        ));
                    }
                    inner.load_uri(url.as_str());
                }
            })
            .map_err(|e| e.to_string())?;
        self.identities
            .lock()
            .unwrap()
            .insert(key.into(), (label, identity));
        Ok(if runtime {
            self.menus.snapshot()
        } else {
            json!({"opened":true})
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn manual_web_login_restores_from_sqlite_only_for_the_same_device_and_token() {
        let root =
            std::env::temp_dir().join(format!("ufi-page-session-{:x}", rand::random::<u64>()));
        let path = root.join("sessions.sqlite3");
        let input = json!({"key":"a".repeat(64),"address":"http://device.test:2333/","authorization":"1".repeat(64),"password":"","persist":true});
        let pages = DevicePages {
            sessions: crate::web_sessions::WebSessions::new(path.clone()),
            ..Default::default()
        };
        pages.set_encryption_key(Some(&[9; 32]));
        pages.prepare_session(&input).unwrap();
        let message = json!({"nonce":"window-nonce","authorization":"1".repeat(64),"password":"manual-web-password","loginMethod":"1"}).to_string();
        pages.remember_login(&"a".repeat(64), "wrong-nonce", &message, true);
        assert_eq!(
            pages.sessions.load(&"a".repeat(64)).unwrap().unwrap()["password"],
            ""
        );
        pages.remember_login(&"a".repeat(64), "window-nonce", &message, true);
        drop(pages);
        let pages = DevicePages {
            sessions: crate::web_sessions::WebSessions::new(path),
            ..Default::default()
        };
        pages.set_encryption_key(Some(&[9; 32]));
        pages.prepare_session(&input).unwrap();
        assert_eq!(
            pages.session.lock().unwrap().as_ref().unwrap().password,
            "manual-web-password"
        );
        let mut other = input.clone();
        other["key"] = json!("b".repeat(64));
        pages.prepare_session(&other).unwrap();
        assert_eq!(pages.session.lock().unwrap().as_ref().unwrap().password, "");
        let mut changed = input;
        changed["authorization"] = json!("2".repeat(64));
        pages.prepare_session(&changed).unwrap();
        assert_eq!(pages.session.lock().unwrap().as_ref().unwrap().password, "");
        drop(pages);
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn generic_plugin_panels_allow_other_device_ports_without_exposing_local_or_external_origins() {
        let base = checked_url("http://device.test:2333/").unwrap();
        assert!(same_device_panel(
            &checked_url("http://device.test:9123/ui/").unwrap(),
            &base
        ));
        assert!(plugin_navigation(
            &checked_url("http://device.test:9123/ui/").unwrap(),
            &base
        ));
        assert!(plugin_navigation(
            &url::Url::parse("blob:http://device.test:9123/fixture").unwrap(),
            &base
        ));
        assert!(!page_navigation(
            &checked_url("http://device.test:9123/ui/").unwrap(),
            &base
        ));
        for address in [
            "http://other.test:9123/",
            "http://device.test@other.test/",
            "file:///tmp/config",
            "http://user:password@device.test/",
        ] {
            assert!(!same_device_panel(
                &url::Url::parse(address).unwrap(),
                &base
            ));
            assert!(!plugin_navigation(
                &url::Url::parse(address).unwrap(),
                &base
            ));
        }
    }
    #[test]
    fn navigation_preserves_origin_and_path_segments() {
        let base = checked_url("https://gateway.test/ufi/f50/").unwrap();
        assert!(within(
            &checked_url("https://gateway.test/ufi/f50/?theme=dark").unwrap(),
            &base
        ));
        for address in [
            "https://other.test/ufi/f50/",
            "https://gateway.test/ufi/f500/",
            "http://gateway.test/ufi/f50/",
            "https://gateway.test:9123/ufi/f50/",
            "https://gateway.test/ufi/other/",
        ] {
            assert!(!within(&checked_url(address).unwrap(), &base));
        }
        for address in [
            "file:///tmp/private",
            "javascript:alert(1)",
            "http://user:password@gateway.test/",
        ] {
            assert!(checked_url(address).is_err());
        }
    }
    #[test]
    fn panel_blob_downloads_are_confined_to_the_device_origin() {
        let base = checked_url("http://device:9123/ui/").unwrap();
        assert!(page_navigation(
            &url::Url::parse("blob:http://device:9123/fixture").unwrap(),
            &base
        ));
        for address in [
            "blob:http://other:9123/fixture",
            "blob:http://device:2333/fixture",
            "data:text/html,test",
            "http://device:9123/other/",
        ] {
            assert!(!page_navigation(&url::Url::parse(address).unwrap(), &base));
        }
    }
}
