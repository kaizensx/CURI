//! The menu bar icon. It shows what the Core is doing (from its `CURI-STATUS` lines), sends
//! `check` back, toggles "Open at login" (a user LaunchAgent, no privileges; it also brings CURI
//! back if it crashes) and is the one place that really quits CURI. Notifications only fire while
//! the window isn't in front.

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
    std::env::var_os("HOME")
        .map(|h| PathBuf::from(h).join(format!("Library/LaunchAgents/{LABEL}.plist")))
}

/// Linux: an XDG autostart entry.
#[cfg(target_os = "linux")]
fn autostart_file() -> Option<PathBuf> {
    let base = std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))?;
    Some(base.join("autostart").join("curi.desktop"))
}

/// Windows: the per-user Run key (no admin rights).
#[cfg(windows)]
const RUN_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";

fn login_enabled() -> bool {
    #[cfg(windows)]
    return crate::deps::quiet("reg")
        .args(["query", RUN_KEY, "/v", "CURI"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);
    #[cfg(target_os = "linux")]
    return autostart_file().is_some_and(|p| p.exists());
    #[cfg(target_os = "macos")]
    agent_plist().is_some_and(|p| p.exists())
}

/// Opens CURI, hidden in the tray, when you log in: a LaunchAgent on macOS, the Run key on Windows,
/// an autostart entry on Linux. All per user, no privileges.
fn set_login(on: bool) -> Result<(), String> {
    #[cfg(not(target_os = "macos"))]
    {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        #[cfg(windows)]
        {
            let out = if on {
                crate::deps::quiet("reg")
                    .args(["add", RUN_KEY, "/v", "CURI", "/t", "REG_SZ", "/f", "/d"])
                    .arg(format!("\"{}\" --hidden", exe.display()))
                    .output()
            } else {
                crate::deps::quiet("reg")
                    .args(["delete", RUN_KEY, "/v", "CURI", "/f"])
                    .output()
            }
            .map_err(|e| e.to_string())?;
            return if out.status.success() || !on {
                Ok(())
            } else {
                Err(String::from_utf8_lossy(&out.stderr).into_owned())
            };
        }
        #[cfg(target_os = "linux")]
        {
            let f = autostart_file().ok_or("no home folder")?;
            if !on {
                let _ = fs::remove_file(&f);
                return Ok(());
            }
            fs::create_dir_all(f.parent().ok_or("bad path")?).map_err(|e| e.to_string())?;
            let quoted = exe.display().to_string().replace('"', "\\\"");
            return fs::write(&f, format!("[Desktop Entry]\nType=Application\nName=CURI\nExec=\"{quoted}\" --hidden\nX-GNOME-Autostart-enabled=true\nNoDisplay=true\n")).map_err(|e| e.to_string());
        }
    }
    #[cfg(target_os = "macos")]
    {
        let p = agent_plist().ok_or("no home folder")?;
        if !on {
            return match fs::remove_file(&p) {
                Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
                _ => Ok(()),
            };
        }
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let esc = |s: &str| {
            s.replace('&', "&amp;")
                .replace('<', "&lt;")
                .replace('>', "&gt;")
        };
        let plist = format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>{LABEL}</string>
  <key>ProgramArguments</key><array><string>{}</string><string>--hidden</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>15</integer>
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
}

pub fn build(app: &AppHandle, home: &Path) -> tauri::Result<()> {
    // First run: open at login, as the app is meant to stay on. The menu bar toggle turns it off for good.
    // On a brand-new install the data folder doesn't exist yet; without it the marker can't be written
    // and the default would be re-applied on every launch, even after you turned it off.
    let _ = fs::create_dir_all(home);
    let marker = home.join("login-item-default");
    if !marker.exists() {
        let _ = set_login(true);
        let _ = fs::write(&marker, "set\n");
    } else if login_enabled() {
        // Keep the login item current (app moved, new keys) without turning it back on.
        let _ = set_login(true);
    }
    let status = MenuItem::with_id(app, "tray:status", "Starting…", false, None::<&str>)?;
    let login = CheckMenuItem::with_id(
        app,
        "tray:login",
        "Open at Login",
        true,
        login_enabled(),
        None::<&str>,
    )?;
    let menu = Menu::with_items(
        app,
        &[
            &status,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "tray:open", "Open CURI", true, None::<&str>)?,
            &MenuItem::with_id(app, "tray:check", "Check Now", true, None::<&str>)?,
            &MenuItem::with_id(
                app,
                "tray:route:operations",
                "Activity…",
                true,
                None::<&str>,
            )?,
            &PredefinedMenuItem::separator(app)?,
            &login,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "tray:quit", "Quit CURI", true, None::<&str>)?,
        ],
    )?;
    let icon = TrayIconBuilder::with_id("curi")
        // macOS draws a template glyph in the menu bar colour; elsewhere the colour icon reads on any taskbar.
        .icon(if cfg!(target_os = "macos") {
            Image::from_bytes(include_bytes!("../icons/tray/template@2x.png"))?
        } else {
            Image::from_bytes(include_bytes!("../icons/32x32.png"))?
        })
        .icon_as_template(cfg!(target_os = "macos"))
        .tooltip("CURI")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .build(app)?;
    app.manage(Tray {
        icon,
        status,
        login,
        seen: Mutex::new(None),
    });
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
        "tray:quit" => {
            #[cfg(target_os = "macos")]
            crate::quit::allow();
            app.exit(0)
        }
        _ => {
            let Some(route) = id.strip_prefix("tray:") else {
                return false;
            };
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
    let Ok(s) = serde_json::from_str::<serde_json::Value>(json) else {
        return;
    };
    let Some(t) = app.try_state::<Tray>() else {
        return;
    };
    let num = |v: &serde_json::Value, k: &str| v.get(k).and_then(|x| x.as_u64()).unwrap_or(0);
    let summary = s
        .get("summary")
        .and_then(|x| x.as_str())
        .unwrap_or("CURI is running");
    let _ = t.status.set_text(summary);
    let _ = t.icon.set_tooltip(Some(format!("CURI · {summary}")));
    // A small count next to the icon only when something needs you.
    let waiting = num(&s, "waiting");
    let _ = t.icon.set_title(if waiting > 0 {
        Some(waiting.to_string())
    } else {
        None::<String>
    });

    let mut seen = t.seen.lock().unwrap();
    if let Some(prev) = seen.as_ref() {
        let fid = |v: &serde_json::Value| {
            v.pointer("/finished/id")
                .and_then(|x| x.as_str())
                .map(str::to_owned)
        };
        if fid(&s).is_some() && fid(&s) != fid(prev) {
            let title = s
                .pointer("/finished/title")
                .and_then(|x| x.as_str())
                .unwrap_or("Done");
            let body = s
                .pointer("/finished/body")
                .and_then(|x| x.as_str())
                .unwrap_or("");
            notify(app, title, body);
        }
        if waiting > num(prev, "waiting") {
            notify(
                app,
                if waiting == 1 {
                    "1 thing needs your OK"
                } else {
                    "Some things need your OK"
                },
                "Open CURI to review it.",
            );
        }
        let sug = num(&s, "suggestions");
        if sug > num(prev, "suggestions") {
            notify(
                app,
                "New suggestions",
                &format!("{sug} updates or fixes ready to review."),
            );
        }
    }
    *seen = Some(s);
}
