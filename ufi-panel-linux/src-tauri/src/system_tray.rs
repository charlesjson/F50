use crate::{show_main, tray_popup, Bridge};
use ksni::{menu::StandardItem, TrayMethods};
use serde_json::Value;
use std::sync::{atomic::Ordering, Arc};
use tauri::Manager;

pub struct StatusTray {
    app: tauri::AppHandle,
    tooltip: String,
    icon: ksni::Icon,
}

impl ksni::Tray for StatusTray {
    fn id(&self) -> String {
        "ufi-panel-linux".into()
    }
    fn title(&self) -> String {
        "UFI Panel Linux".into()
    }
    fn icon_name(&self) -> String {
        "ufi-panel-linux".into()
    }
    fn icon_pixmap(&self) -> Vec<ksni::Icon> {
        vec![self.icon.clone()]
    }
    fn tool_tip(&self) -> ksni::ToolTip {
        ksni::ToolTip {
            title: self.tooltip.clone(),
            ..Default::default()
        }
    }
    fn activate(&mut self, x: i32, y: i32) {
        let app = self.app.clone();
        let _ = self.app.run_on_main_thread(move || {
            if let Err(error) = tray_popup::show(&app, x, y) {
                eprintln!("无法显示托盘状态：{error}");
                show_main(&app);
            }
        });
    }
    fn menu(&self) -> Vec<ksni::MenuItem<Self>> {
        vec![
            StandardItem {
                label: "显示管理台".into(),
                activate: Box::new(|tray: &mut Self| {
                    let app = tray.app.clone();
                    let _ = tray.app.run_on_main_thread(move || show_main(&app));
                }),
                ..Default::default()
            }
            .into(),
            StandardItem {
                label: "完整 UFI 面板".into(),
                activate: Box::new(|tray: &mut Self| {
                    let state = tray.app.state::<Arc<Bridge>>().inner().clone();
                    tauri::async_runtime::spawn(async move {
                        let _ = state.request("open-panel", Value::Null).await;
                    });
                }),
                ..Default::default()
            }
            .into(),
            StandardItem {
                label: "退出".into(),
                activate: Box::new(|tray: &mut Self| {
                    tray.app
                        .state::<Arc<Bridge>>()
                        .exiting
                        .store(true, Ordering::SeqCst);
                    tray.app.exit(0);
                }),
                ..Default::default()
            }
            .into(),
        ]
    }
}

pub fn start(app: &tauri::AppHandle, bridge: Arc<Bridge>) -> Result<(), String> {
    let image = tauri::image::Image::from_bytes(include_bytes!("../../assets/icon.png"))
        .map_err(|e| e.to_string())?;
    // StatusNotifierItem uses ARGB, whereas Tauri decodes PNG into RGBA.
    let mut pixels = image.rgba().to_vec();
    for pixel in pixels.chunks_exact_mut(4) {
        pixel.rotate_right(1);
    }
    let tray = StatusTray {
        app: app.clone(),
        tooltip: "UFI Panel · 未连接".into(),
        icon: ksni::Icon {
            width: image.width() as i32,
            height: image.height() as i32,
            data: pixels,
        },
    };
    // Stay registered while the desktop shell starts or restarts its watcher.
    let handle = tauri::async_runtime::block_on(tray.assume_sni_available(true).spawn())
        .map_err(|e| e.to_string())?;
    *bridge.tray.lock().unwrap() = Some(handle);
    Ok(())
}

pub fn update(bridge: &Bridge, tooltip: String) {
    let handle = bridge.tray.lock().unwrap().clone();
    if let Some(handle) = handle {
        tauri::async_runtime::spawn(async move {
            handle.update(move |tray| tray.tooltip = tooltip).await;
        });
    }
}
