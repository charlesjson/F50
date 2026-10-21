//! Device pages may report bounded menu labels. They receive no local commands.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Mutex;
use tauri::Emitter;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Menu {
    token: String,
    plugin_id: String,
    label: String,
    kind: String,
    disabled: bool,
}
#[derive(Deserialize)]
struct Report {
    items: Vec<Menu>,
    ready: bool,
}
struct Session {
    context: String,
    revision: String,
    instance: String,
    plugins: Vec<String>,
    items: Vec<Menu>,
    ready: bool,
}
#[derive(Default)]
pub struct PluginMenus {
    session: Mutex<Option<Session>>,
}
impl PluginMenus {
    pub fn start(&self, context: &str, revision: &str, plugins: &Value) -> String {
        let instance = format!("menus-{:016x}", rand::random::<u64>());
        *self.session.lock().unwrap() = Some(Session {
            context: context.into(),
            revision: revision.into(),
            instance: instance.clone(),
            plugins: plugins
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|p| p["id"].as_str().map(str::to_string))
                .chain(["legacy".to_string()])
                .collect(),
            items: Vec::new(),
            ready: false,
        });
        instance
    }
    pub fn clear(&self) {
        self.session.lock().unwrap().take();
    }
    pub fn closed(&self, app: &tauri::AppHandle, instance: &str) {
        let mut guard = self.session.lock().unwrap();
        let Some(session) = guard.as_ref().filter(|s| s.instance == instance) else {
            return;
        };
        let payload = json!({"context":session.context,"revision":session.revision,"instance":session.instance,"closed":true});
        guard.take();
        drop(guard);
        let _ = app.emit_to("main", "plugin-menus", payload);
    }
    pub fn snapshot(&self) -> Value {
        self.session.lock().unwrap().as_ref().map(|s|json!({"context":s.context,"revision":s.revision,"instance":s.instance,"items":s.items,"ready":s.ready})).unwrap_or(Value::Null)
    }
    pub fn receive(&self, app: &tauri::AppHandle, instance: &str, text: &str) {
        if text.len() > 65536 {
            return;
        }
        let Ok(report) = serde_json::from_str::<Report>(text) else {
            return;
        };
        if report.items.len() > 128 {
            return;
        }
        let mut guard = self.session.lock().unwrap();
        let Some(session) = guard.as_mut().filter(|s| s.instance == instance) else {
            return;
        };
        if report.items.iter().any(|item| {
            !valid_token(&item.token)
                || !session.plugins.contains(&item.plugin_id)
                || item.label.is_empty()
                || item.label.chars().count() > 120
                || item.label.chars().any(char::is_control)
                || !["button", "a", "input", "summary", "select"].contains(&item.kind.as_str())
        }) {
            return;
        }
        session.items = report.items;
        session.ready = report.ready;
        let payload = json!({"context":session.context,"revision":session.revision,"instance":session.instance,"items":session.items,"ready":session.ready});
        drop(guard);
        let _ = app.emit_to("main", "plugin-menus", payload);
    }
    pub fn selection(&self, input: &Value) -> Result<String, String> {
        let guard = self.session.lock().unwrap();
        let s = guard.as_ref().ok_or("插件菜单尚未加载，请刷新后重试")?;
        if input["context"] != s.context
            || input["revision"] != s.revision
            || input["instance"] != s.instance
        {
            return Err("插件菜单已变化，请刷新后重试".into());
        }
        let token = input["token"].as_str().ok_or("无效插件菜单")?;
        let item = s
            .items
            .iter()
            .find(|m| m.token == token && !m.disabled)
            .ok_or("此插件菜单已不可用，请刷新后重试")?;
        Ok(item.token.clone())
    }
}
fn valid_token(token: &str) -> bool {
    token.starts_with("menu-")
        && token.len() == 41
        && token[5..]
            .bytes()
            .all(|c| c.is_ascii_hexdigit() || c == b'-')
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn menu_tokens_and_device_sessions_never_accept_code_or_stale_selection() {
        assert!(valid_token("menu-00000000-0000-0000-0000-000000000001"));
        assert!(!valid_token("menu-'); local_shell(); //"));
        let menus = PluginMenus::default();
        let instance = menus.start("first", "rev", &json!([{ "id":"plugin-1" }]));
        let menu = Menu {
            token: "menu-00000000-0000-0000-0000-000000000001".into(),
            plugin_id: "plugin-1".into(),
            label: "任意菜单".into(),
            kind: "button".into(),
            disabled: false,
        };
        menus
            .session
            .lock()
            .unwrap()
            .as_mut()
            .unwrap()
            .items
            .push(menu);
        let input = json!({"context":"first","revision":"rev","instance":instance,"token":"menu-00000000-0000-0000-0000-000000000001"});
        assert!(menus.selection(&input).is_ok());
        menus.start("second", "rev", &json!([]));
        assert!(menus.selection(&input).is_err());
        menus.clear();
        assert!(menus.selection(&input).is_err());
    }
}
