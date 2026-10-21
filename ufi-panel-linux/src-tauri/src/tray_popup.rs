use crate::{data_dir, show_main, Bridge};
use gtk::gdk::prelude::{DeviceExt, SeatExt};
use gtk::prelude::{GtkWindowExt, WidgetExt};
use serde_json::{json, Value};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use tauri::{
    webview::NewWindowResponse, Manager, PhysicalPosition, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

const LABEL: &str = "tray-status";
const WIDTH: f64 = 276.0;
const HEIGHT: f64 = 408.0;

fn trusted_popup(label: &str, url: &url::Url) -> bool {
    label == LABEL
        && url.scheme() == "tauri"
        && url.host_str() == Some("localhost")
        && url.path() == "/tray-status.html"
}

pub fn initial_status() -> Value {
    json!({"name":"","connected":false,"interval":2000,"stale":false,"snapshot":null})
}

pub fn update(app: &tauri::AppHandle, status: &Value) {
    if let Some(window) = app.get_webview_window(LABEL) {
        if window.is_visible().unwrap_or(false) {
            push(&window, status);
        }
    }
}

fn push(window: &WebviewWindow, status: &Value) {
    // Cache before calling the renderer: a first page load can finish before
    // its ES module has installed the callback.
    let _ = window.eval(format!(
        "window.__ufiTrayStatus={status};window.__ufiTrayStatusUpdate?.(window.__ufiTrayStatus);"
    ));
}

fn create(app: &tauri::AppHandle) -> Result<WebviewWindow, String> {
    let window = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("tray-status.html".into()))
        .data_directory(data_dir().join("webview"))
        .title("UFI · 设备状态")
        .inner_size(WIDTH, HEIGHT)
        .resizable(false)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .focused(false)
        .on_navigation(|url| trusted_popup(LABEL, url))
        .on_new_window(|_, _| NewWindowResponse::Deny)
        .on_page_load(|webview, event| {
            if event.event() == tauri::webview::PageLoadEvent::Finished {
                let status = webview
                    .app_handle()
                    .state::<Arc<Bridge>>()
                    .tray_status
                    .lock()
                    .unwrap()
                    .clone();
                if let Some(window) = webview.app_handle().get_webview_window(LABEL) {
                    push(&window, &status);
                }
            }
        })
        .build()
        .map_err(|e| e.to_string())?;
    let focused = Arc::new(AtomicBool::new(false));
    let dragging = app.state::<Arc<Bridge>>().tray_dragging.clone();
    let copy = window.clone();
    window.on_window_event(move |event| match event {
        tauri::WindowEvent::Focused(true) => {
            focused.store(true, Ordering::SeqCst);
        }
        tauri::WindowEvent::Focused(false) => {
            if focused.swap(false, Ordering::SeqCst) && !dragging.load(Ordering::SeqCst) {
                let _ = copy.hide();
            }
        }
        tauri::WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            focused.store(false, Ordering::SeqCst);
            let _ = copy.hide();
        }
        _ => {}
    });
    Ok(window)
}

// All inputs and the result use physical desktop pixels, including monitors
// left/above the primary display. The work area excludes taskbars and docks.
fn position(
    anchor: (i32, i32),
    area: (i32, i32, u32, u32),
    size: (u32, u32),
    gap: i32,
) -> (i32, i32) {
    let (ax, ay) = (i64::from(anchor.0), i64::from(anchor.1));
    let (left, top, width, height) = (
        i64::from(area.0),
        i64::from(area.1),
        i64::from(area.2),
        i64::from(area.3),
    );
    let (w, h, gap) = (i64::from(size.0), i64::from(size.1), i64::from(gap));
    let x = (ax - w / 2).clamp(left, left + (width - w).max(0));
    let y = if ay < top + height / 2 {
        ay + gap
    } else {
        ay - gap - h
    };
    (x as i32, y.clamp(top, top + (height - h).max(0)) as i32)
}

pub fn show(app: &tauri::AppHandle, x: i32, y: i32) -> Result<(), String> {
    if app.state::<Arc<Bridge>>().exiting.load(Ordering::SeqCst) {
        return Ok(());
    }
    let window = match app.get_webview_window(LABEL) {
        Some(window) => window,
        None => create(app)?,
    };
    let native = window.gtk_window().map_err(|e| e.to_string())?;
    // Some hosts send (0, 0) when no tray coordinates are available.
    let anchor = if x == 0 && y == 0 {
        app.cursor_position()
            .map(|p| (p.x.round() as i32, p.y.round() as i32))
            .unwrap_or((x, y))
    } else {
        (x, y)
    };
    if let Some(monitor) = window
        .monitor_from_point(anchor.0 as f64, anchor.1 as f64)
        .or_else(|_| window.primary_monitor())
        .map_err(|e| e.to_string())?
        .or(window.primary_monitor().map_err(|e| e.to_string())?)
    {
        let area = monitor.work_area();
        // A never-shown GTK window can still report a 1×1 allocation.
        let size =
            tauri::LogicalSize::new(WIDTH, HEIGHT).to_physical::<u32>(monitor.scale_factor());
        let (px, py) = position(
            anchor,
            (
                area.position.x,
                area.position.y,
                area.size.width,
                area.size.height,
            ),
            (size.width, size.height),
            (6.0 * monitor.scale_factor()).round() as i32,
        );
        let logical = PhysicalPosition::new(px, py)
            .to_logical::<i32>(window.scale_factor().map_err(|e| e.to_string())?);
        native.move_(logical.x, logical.y);
    }
    let status = app
        .state::<Arc<Bridge>>()
        .tray_status
        .lock()
        .unwrap()
        .clone();
    push(&window, &status);
    // Tao queues show(), but its set_focus() ignores a still-hidden GTK
    // window. Present synchronously on the GTK thread so every reopening
    // receives focus and can subsequently dismiss itself on focus loss.
    native.set_accept_focus(true);
    native.show_all();
    native.present();
    window.as_ref().set_focus().map_err(|e| e.to_string())
}

pub fn hide(app: &tauri::AppHandle) {
    app.state::<Arc<Bridge>>()
        .tray_dragging
        .store(false, Ordering::SeqCst);
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.hide();
    }
}

fn primary_button_down(native: &gtk::ApplicationWindow) -> bool {
    native
        .display()
        .default_seat()
        .and_then(|seat| seat.pointer())
        .zip(native.window())
        .is_some_and(|(pointer, surface)| {
            surface
                .device_position(&pointer)
                .3
                .contains(gtk::gdk::ModifierType::BUTTON1_MASK)
        })
}

fn drag(window: &WebviewWindow) -> Result<(), String> {
    let native = window.gtk_window().map_err(|e| e.to_string())?;
    // A short click can end before its IPC arrives. Never begin an OS move
    // after button release: that move would have no release event to end it.
    if !primary_button_down(&native) {
        return Ok(());
    }
    let Some(pointer) = native
        .display()
        .default_seat()
        .and_then(|seat| seat.pointer())
    else {
        return Ok(());
    };
    let dragging = window
        .app_handle()
        .state::<Arc<Bridge>>()
        .tray_dragging
        .clone();
    if dragging.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    let (_, x, y) = pointer.position();
    native.begin_move_drag(1, x, y, 0);
    let popup = window.clone();
    let mut released = false;
    // Window managers can temporarily take keyboard focus during a move.
    // Ignore that focus loss until button release, then give the popup focus
    // again so ordinary clicks outside still dismiss it.
    gtk::glib::timeout_add_local(std::time::Duration::from_millis(50), move || {
        if !dragging.load(Ordering::SeqCst) || !popup.is_visible().unwrap_or(false) {
            dragging.store(false, Ordering::SeqCst);
            return gtk::glib::ControlFlow::Break;
        }
        let pressed = primary_button_down(&native);
        if pressed {
            return gtk::glib::ControlFlow::Continue;
        }
        if !released {
            native.present();
            let _ = popup.as_ref().set_focus();
            released = true;
            return gtk::glib::ControlFlow::Continue;
        }
        dragging.store(false, Ordering::SeqCst);
        if !native.is_active() {
            let _ = popup.hide();
        }
        gtk::glib::ControlFlow::Break
    });
    Ok(())
}

#[tauri::command]
pub fn tray_popup_action(window: WebviewWindow, action: String) -> Result<(), String> {
    if !trusted_popup(window.label(), &window.url().map_err(|e| e.to_string())?) {
        return Err("不允许的请求来源".into());
    }
    match action.as_str() {
        "hide" => hide(window.app_handle()),
        "show-main" => show_main(window.app_handle()),
        "drag" => drag(&window)?,
        _ => return Err("未知托盘操作".into()),
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn popup_stays_in_work_area_at_top_bottom_and_negative_monitor_origins() {
        let area = (0, 30, 1920, 1010);
        assert_eq!(position((1910, 20), area, (276, 408), 6), (1644, 30));
        assert_eq!(position((10, 1060), area, (276, 408), 6), (0, 632));
        assert_eq!(
            position((-1900, 1080), (-1920, 0, 1920, 1040), (552, 816), 12),
            (-1920, 224)
        );
        assert_eq!(
            position((50, -1060), (0, -1050, 1920, 1050), (276, 408), 6),
            (0, -1050)
        );
        assert_eq!(position((0, 0), (0, 0, 200, 300), (276, 408), 6), (0, 0));
    }
    #[test]
    fn only_local_popup_can_request_popup_actions() {
        assert!(trusted_popup(
            LABEL,
            &url::Url::parse("tauri://localhost/tray-status.html").unwrap()
        ));
        for (label, address) in [
            ("main", "tauri://localhost/tray-status.html"),
            (LABEL, "tauri://localhost/index.html"),
            (LABEL, "http://192.168.0.1:2333/tray-status.html"),
            (LABEL, "tauri://other/tray-status.html"),
        ] {
            assert!(!trusted_popup(label, &url::Url::parse(address).unwrap()));
        }
    }
}
