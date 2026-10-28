//! The menu bar icon. It shows what the Core is doing (from its `CURI-STATUS` lines), sends
//! `check` back, toggles "Open at login" (a user LaunchAgent, no privileges) and is the one place,
//! with ⌘Q, that really quits CURI. Notifications only fire while the window isn't in front.

use std::{fs, path::Path, path::PathBuf, sync::Mutex};
use tauri::{
    image::Image,
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::{TrayIcon, TrayIconBuilder},
    AppHandle, Manager, Wry,
};
use tauri_plugin_notification::NotificationExt;

const LABEL: &str = "app.curi.desktop";

struct Tray {
    icon: TrayIcon<Wry>,
    status: MenuItem<Wry>,
    login: CheckMenuItem<Wry>,
    /// Last status seen, to notify only on changes.
    seen: Mutex<Option<serde_json::Value>>,
}

fn agent_plist() -> Option<PathBuf> {
    std::env::var_os("HOME").map(|h| PathBuf::from(h).join(format!("Library/LaunchAgents/{LABEL}.plist")))
}

fn login_enabled() -> bool {
    agent_plist().is_some_and(|p| p.exists())
}

/// Writes or removes the LaunchAgent that opens CURI, hidden, when you log in.
fn set_login(on: bool) -> Result<(), String> {
    let p = agent_plist().ok_or("no home folder")?;
    if !on {
        return match fs::remove_file(&p) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
            _ => Ok(()),
        };
    }
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let esc = |s: &str| s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;");
    let plist = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>{LABEL}</string>
  <key>ProgramArguments</key><array><string>{}</string><string>--hidden</string></array>
  <key>RunAtLoad</key><true/>
  <key>ProcessType</key><string>Interactive</string>
</dict>
</plist>
"#,
        esc(&exe.to_string_lossy())
    );
    if let Some(dir) = p.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    fs::write(&p, plist).map_err(|e| e.to_string())
}

pub fn build(app: &AppHandle, home: &Path) -> tauri::Result<()> {
    // First run: open at login, as the app is meant to stay on. The menu bar toggle turns it off for good.
    let marker = home.join("login-item-default");
    if !marker.exists() {
        let _ = set_login(true);
        let _ = fs::write(&marker, "set\n");
    }
    let status = MenuItem::with_id(app, "tray:status", "Starting…", false, None::<&str>)?;
    let login = CheckMenuItem::with_id(app, "tray:login", "Open at Login", true, login_enabled(), None::<&str>)?;
    let menu = Menu::with_items(app, &[
        &status,
        &PredefinedMenuItem::separator(app)?,
        &MenuItem::with_id(app, "tray:open", "Open CURI", true, None::<&str>)?,
        &MenuItem::with_id(app, "tray:check", "Check Now", true, None::<&str>)?,
        &MenuItem::with_id(app, "tray:route:operations", "Activity…", true, None::<&str>)?,
        &PredefinedMenuItem::separator(app)?,
        &login,
        &PredefinedMenuItem::separator(app)?,
        &MenuItem::with_id(app, "tray:quit", "Quit CURI", true, None::<&str>)?,
    ])?;
    let icon = TrayIconBuilder::with_id("curi")
        .icon(Image::from_bytes(include_bytes!("../icons/tray/template@2x.png"))?)
        .icon_as_template(true)
        .tooltip("CURI")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .build(app)?;
    app.manage(Tray { icon, status, login, seen: Mutex::new(None) });
    Ok(())
}

/// Handles the menu bar icon's own items. Returns false for anything else.
pub fn on_menu(app: &AppHandle, id: &str) -> bool {
    match id {
        "tray:open" => crate::show_window(app),
        "tray:check" => {
            if let Some(t) = app.try_state::<Tray>() {
                let _ = t.status.set_text("Checking…");
            }
            crate::core_send(app, "check");
        }
        "tray:login" => {
            let want = !login_enabled();
            let ok = set_login(want).is_ok();
            if let Some(t) = app.try_state::<Tray>() {
                let _ = t.login.set_checked(if ok { want } else { !want });
            }
        }
        "tray:quit" => app.exit(0),
        _ => {
            let Some(route) = id.strip_prefix("tray:") else { return false };
            crate::show_window(app);
            crate::to_ui(app, route);
        }
    }
    true
}

fn window_in_front(app: &AppHandle) -> bool {
    app.get_webview_window("main")
        .map(|w| w.is_visible().unwrap_or(false) && w.is_focused().unwrap_or(false))
        .unwrap_or(false)
}

fn notify(app: &AppHandle, title: &str, body: &str) {
    if window_in_front(app) {
        return;
    }
    let mut n = app.notification().builder().title(title);
    if !body.is_empty() {
        n = n.body(body);
    }
    let _ = n.show();
}

/// One `CURI-STATUS` line from the Core: refresh the menu, notify about what's new.
pub fn on_status(app: &AppHandle, json: &str) {
    let Ok(s) = serde_json::from_str::<serde_json::Value>(json) else { return };
    let Some(t) = app.try_state::<Tray>() else { return };
    let num = |v: &serde_json::Value, k: &str| v.get(k).and_then(|x| x.as_u64()).unwrap_or(0);
    let summary = s.get("summary").and_then(|x| x.as_str()).unwrap_or("CURI is running");
    let _ = t.status.set_text(summary);
    let _ = t.icon.set_tooltip(Some(format!("CURI · {summary}")));
    // A small count next to the icon only when something needs you.
    let waiting = num(&s, "waiting");
    let _ = t.icon.set_title(if waiting > 0 { Some(waiting.to_string()) } else { None::<String> });

    let mut seen = t.seen.lock().unwrap();
    if let Some(prev) = seen.as_ref() {
        let fid = |v: &serde_json::Value| v.pointer("/finished/id").and_then(|x| x.as_str()).map(str::to_owned);
        if fid(&s).is_some() && fid(&s) != fid(prev) {
            let title = s.pointer("/finished/title").and_then(|x| x.as_str()).unwrap_or("Done");
            let body = s.pointer("/finished/body").and_then(|x| x.as_str()).unwrap_or("");
            notify(app, title, body);
        }
        if waiting > num(prev, "waiting") {
            notify(app, if waiting == 1 { "1 thing needs your OK" } else { "Some things need your OK" }, "Open CURI to review it.");
        }
        let sug = num(&s, "suggestions");
        if sug > num(prev, "suggestions") {
            notify(app, "New suggestions", &format!("{sug} updates or fixes ready to review."));
        }
    }
    *seen = Some(s);
}
