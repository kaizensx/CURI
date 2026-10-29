#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
//! CURI desktop shell. The boot window installs/verifies runtime dependencies with live progress,
//! then starts CURI Core (loopback HTTP + token) as a child process and navigates to its UI.
//! The CURI UI never gets Tauri IPC: all privileged work stays in Core's allowlisted actions.
//! CURI lives in the menu bar: closing the window, ⌘Q and the Dock's "Quit" all hide it, and the
//! Core keeps checking in the background. Only "Quit CURI" in the menu bar icon stops it.

mod deps;
#[cfg(target_os = "macos")]
mod quit;
mod tray;
mod update;

use std::{
    fs,
    io::{BufRead, BufReader, Write},
    path::PathBuf,
    process::{Child, ChildStdin, Stdio},
    sync::{mpsc, Arc, Mutex},
    thread,
    time::Duration,
};
use tauri::{
    menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu},
    Emitter, Manager, RunEvent, Url, WindowEvent,
};

#[derive(Default)]
struct CoreProc(Mutex<Option<Child>>);

/// The Core's stdin: kept open for the app's lifetime (closing it stops the Core) and used to send commands.
#[derive(Default)]
struct CoreIn(Mutex<Option<ChildStdin>>);

/// Sends one line to the Core (`check`, `status`). Ignored before the Core is up.
pub fn core_send(app: &tauri::AppHandle, cmd: &str) {
    if let Some(stdin) = app.state::<CoreIn>().0.lock().unwrap().as_mut() {
        let _ = writeln!(stdin, "{cmd}");
        let _ = stdin.flush();
    }
}

fn curi_home(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Ok(h) = std::env::var("CURI_HOME") {
        return Ok(h.into());
    }
    // Same folder the engine uses (core/src/paths.mjs), so both halves share one data dir on every OS.
    let home = app.path().home_dir().map_err(|e| e.to_string())?;
    Ok(if cfg!(target_os = "macos") {
        home.join("Library/Application Support/CURI")
    } else if cfg!(windows) {
        std::env::var_os("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join("AppData").join("Roaming"))
            .join("CURI")
    } else {
        std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join(".local").join("share"))
            .join("curi")
    })
}

fn repo_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Ok(r) = std::env::var("CURI_REPO_ROOT") {
        return Ok(r.into());
    }
    if let Ok(res) = app.path().resource_dir() {
        let p = res.join("curi");
        if p.join("core/bin/curi.mjs").exists() {
            return Ok(p);
        }
    }
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    if dev.join("core/bin/curi.mjs").exists() {
        return Ok(dev);
    }
    Err("CURI Core resources not found in the app bundle.".into())
}

fn boot(app: tauri::AppHandle) -> Result<(), String> {
    let emit = |pr: deps::Progress| {
        let _ = app.emit("deps-progress", pr);
    };
    let home_dir = app.path().home_dir().map_err(|e| e.to_string())?;
    let home = curi_home(&app)?;
    fs::create_dir_all(&home).map_err(|e| e.to_string())?;
    let root = repo_root(&app)?;
    let r = deps::ensure(&home_dir, &home.join("runtime"), &emit)?;

    emit(deps::Progress {
        step: "core",
        label: "CURI Core".into(),
        state: "running",
        pct: None,
        detail: "Starting the local server (127.0.0.1)…".into(),
    });
    let mut cmd = deps::quiet(&r.node);
    cmd.arg(root.join("core/bin/curi.mjs"))
        .args([
            "app",
            "--port",
            "0",
            "--no-open",
            "--print-url",
            "--exit-on-stdin-close",
            "--status-lines",
        ])
        .env("PATH", &r.path_env)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(c) = &r.claude {
        cmd.env("CURI_CLAUDE_BIN", c);
    }
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Couldn't start the Core: {e}"))?;
    let stdout = child.stdout.take().ok_or("stdout")?;
    *app.state::<CoreIn>().0.lock().unwrap() = child.stdin.take();
    let stderr = child.stderr.take().ok_or("stderr")?;
    let errbuf = Arc::new(Mutex::new(String::new()));
    let eb = errbuf.clone();
    thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            let mut b = eb.lock().unwrap();
            b.push_str(&line);
            b.push('\n');
            if b.len() > 8000 {
                let cut = b.len() - 4000;
                b.drain(..cut);
            }
        }
    });
    let (tx, rx) = mpsc::channel();
    let handle = app.clone();
    thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if line.starts_with("http://127.0.0.1:") && line.contains("#token=") {
                let _ = tx.send(line);
            } else if let Some(json) = line.strip_prefix("CURI-STATUS ") {
                tray::on_status(&handle, json);
            } else if let Some(cmd) = line.strip_prefix("CURI-CMD ") {
                // Requests from the window, relayed by the engine (the page has no IPC of its own).
                let app = handle.clone();
                match cmd.trim() {
                    "update-check" => {
                        tauri::async_runtime::spawn(async move {
                            let _ = update::check(&app, true).await;
                        });
                    }
                    "update-install" => {
                        tauri::async_runtime::spawn(async move {
                            let _ = update::install(&app).await;
                        });
                    }
                    _ => {}
                }
            }
        }
    });
    let url = match rx.recv_timeout(Duration::from_secs(45)) {
        Ok(u) => u,
        Err(_) => {
            let _ = child.kill();
            let msg = format!(
                "The Core didn't start within 45 s.\n{}",
                errbuf.lock().unwrap()
            );
            emit(deps::Progress {
                step: "core",
                label: "CURI Core".into(),
                state: "failed",
                pct: None,
                detail: msg.clone(),
            });
            return Err(msg);
        }
    };
    *app.state::<CoreProc>().0.lock().unwrap() = Some(child);
    emit(deps::Progress {
        step: "core",
        label: "CURI Core".into(),
        state: "done",
        pct: Some(100.0),
        detail: "Local server ready.".into(),
    });
    let w = app
        .get_webview_window("main")
        .ok_or("main window missing")?;
    // Tell the UI it runs inside the native shell (transparent sidebar, title-bar drag region).
    // "1" keeps the macOS layout (title bar drawn by the page); other systems keep their own frame.
    let os = if cfg!(target_os = "macos") {
        "1"
    } else if cfg!(windows) {
        "windows"
    } else {
        "linux"
    };
    let url = url.replacen("/#", &format!("/?native={os}#"), 1);
    w.navigate(Url::parse(&url).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn start(app: tauri::AppHandle) -> Result<(), String> {
    if app.state::<CoreProc>().0.lock().unwrap().is_some() {
        return Err("The Core is already running.".into());
    }
    tauri::async_runtime::spawn_blocking(move || boot(app))
        .await
        .map_err(|e| e.to_string())?
}

/// Native menu bar. Custom items forward a command id to the UI (`window.__curiMenu`), which owns routing.
fn build_menu(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let item =
        |id: &str, label: &str, accel: Option<&str>| MenuItem::with_id(app, id, label, true, accel);
    let sep = || PredefinedMenuItem::separator(app);
    let about = AboutMetadata {
        name: Some("CURI".into()),
        version: Some(env!("CARGO_PKG_VERSION").into()),
        comments: Some("Claude Universal Resource Intelligence".into()),
        ..Default::default()
    };
    let app_menu = Submenu::with_items(
        app,
        "CURI",
        true,
        &[
            &PredefinedMenuItem::about(app, Some("About CURI"), Some(about))?,
            &sep()?,
            &item("route:settings", "Settings…", Some("CmdOrCtrl+,"))?,
            &sep()?,
            &PredefinedMenuItem::hide(app, Some("Hide CURI"))?,
            &PredefinedMenuItem::hide_others(app, Some("Hide Others"))?,
            &PredefinedMenuItem::show_all(app, Some("Show All"))?,
            &sep()?,
            // ⌘Q hides to the menu bar (see quit.rs); "Quit CURI" lives in the menu bar icon.
            &PredefinedMenuItem::quit(app, Some("Hide to Menu Bar"))?,
        ],
    )?;
    let file = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &item("add-url", "Add URL…", Some("CmdOrCtrl+N"))?,
            &item("route:radar", "Search GitHub…", Some("CmdOrCtrl+Shift+N"))?,
            &sep()?,
            &PredefinedMenuItem::close_window(app, Some("Close Window"))?,
        ],
    )?;
    let edit = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, Some("Undo"))?,
            &PredefinedMenuItem::redo(app, Some("Redo"))?,
            &sep()?,
            &PredefinedMenuItem::cut(app, Some("Cut"))?,
            &PredefinedMenuItem::copy(app, Some("Copy"))?,
            &PredefinedMenuItem::paste(app, Some("Paste"))?,
            &PredefinedMenuItem::select_all(app, Some("Select All"))?,
        ],
    )?;
    let view = Submenu::with_items(
        app,
        "View",
        true,
        &[
            &item("palette", "Command Palette", Some("CmdOrCtrl+K"))?,
            &sep()?,
            &item("route:home", "Home", Some("CmdOrCtrl+1"))?,
            &item("route:library", "Library", Some("CmdOrCtrl+2"))?,
            &item("route:capabilities", "Capabilities", Some("CmdOrCtrl+3"))?,
            &item("route:connections", "Connections", Some("CmdOrCtrl+4"))?,
            &item("route:operations", "Activity", Some("CmdOrCtrl+5"))?,
            &item("route:settings", "Settings", Some("CmdOrCtrl+6"))?,
            &item("route:automation", "Autonomy", Some("CmdOrCtrl+7"))?,
            &sep()?,
            &item("route:library?tab=installed", "Installed", None)?,
            &item("route:discover", "New on GitHub", None)?,
            &sep()?,
            &item("reload", "Reload", Some("CmdOrCtrl+R"))?,
            &PredefinedMenuItem::fullscreen(app, Some("Enter Full Screen"))?,
        ],
    )?;
    let window = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, Some("Minimize"))?,
            &PredefinedMenuItem::maximize(app, Some("Zoom"))?,
            &sep()?,
            &item("route:jobs", "Searches and Quotas", None)?,
            &item("route:security", "Security", None)?,
            &item("route:audit", "Audit Log", None)?,
        ],
    )?;
    let help = Submenu::with_items(
        app,
        "Help",
        true,
        &[&item("route:about", "CURI Help", None)?],
    )?;
    Menu::with_items(app, &[&app_menu, &file, &edit, &view, &window, &help])
}

/// Brings the window back (and the Dock icon with it).
pub fn show_window(app: &tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// Hides the window and the Dock icon; CURI stays in the menu bar.
pub fn hide_window(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.hide();
    }
    #[cfg(target_os = "macos")]
    let _ = app.set_activation_policy(tauri::ActivationPolicy::Accessory);
}

/// Forwards a menu command to the UI, which owns routing.
pub fn to_ui(app: &tauri::AppHandle, id: &str) {
    if let Some(w) = app.get_webview_window("main") {
        let id = serde_json::to_string(id).unwrap_or_default();
        let _ = w.eval(format!("window.__curiMenu && window.__curiMenu({id})"));
    }
}

fn main() {
    tauri::Builder::default()
        // Opening CURI again (Start menu, launcher, a second click) brings the running window back
        // instead of starting a second app and a second engine on the same database.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_window(app)
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            // The app menu is a macOS convention; on Windows and Linux it would sit inside the window,
            // and every shortcut it offers already works from the page (Ctrl+K, Ctrl+1…).
            if cfg!(target_os = "macos") {
                let menu = build_menu(app.handle())?;
                app.set_menu(menu)?;
            }
            app.on_menu_event(|app, ev| {
                let id = ev.id().as_ref();
                if !tray::on_menu(app, id) {
                    to_ui(app, id);
                }
            });
            #[cfg(target_os = "macos")]
            quit::install(app.handle());
            let home = curi_home(app.handle())?;
            tray::build(app.handle(), &home)?;
            update::start(app.handle());
            // Small screens (laptops, VMs): the default 1360×900 window would hang off the edge.
            if let Some(w) = app.get_webview_window("main") {
                if let Ok(Some(m)) = w.current_monitor() {
                    let screen = m.size().to_logical::<f64>(m.scale_factor());
                    if screen.width < 1360.0 || screen.height < 900.0 {
                        let _ = w.set_min_size(None::<tauri::Size>);
                        let _ = w.maximize();
                    }
                }
            }
            // Started at login: stay in the menu bar until asked.
            if std::env::args().any(|a| a == "--hidden") {
                hide_window(app.handle());
            }
            Ok(())
        })
        .on_window_event(|w, ev| {
            if let WindowEvent::CloseRequested { api, .. } = ev {
                if w.label() == "main" {
                    api.prevent_close();
                    hide_window(w.app_handle());
                }
            }
        })
        .manage(CoreProc::default())
        .manage(CoreIn::default())
        .manage(update::Pending::default())
        .invoke_handler(tauri::generate_handler![start])
        .build(tauri::generate_context!())
        .expect("error while starting CURI")
        .run(|app, ev| match ev {
            #[cfg(target_os = "macos")]
            RunEvent::Reopen { .. } => show_window(app),
            RunEvent::Exit => {
                app.state::<CoreIn>().0.lock().unwrap().take();
                if let Some(mut c) = app.state::<CoreProc>().0.lock().unwrap().take() {
                    let _ = c.kill();
                }
            }
            _ => {}
        });
}
