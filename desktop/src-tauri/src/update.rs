//! Updates from GitHub releases. Shortly after launch and then every six hours CURI reads the
//! release's `latest.json`; when there's a newer version it says so in the menu bar, with a system
//! notification (once per version) and a banner in the window. Installing downloads the update,
//! checks its signature against the public key in tauri.conf.json, installs it and restarts.
//! Downloaded by the app itself, so the update isn't flagged by Gatekeeper or SmartScreen.

use std::{sync::Mutex, time::Duration};
use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_updater::{Update, UpdaterExt};

const FIRST_CHECK: Duration = Duration::from_secs(30);
const EVERY: Duration = Duration::from_secs(6 * 3600);
const RELEASES: &str = "https://github.com/kaizensx/curi/releases/latest";

#[derive(Default)]
pub struct Pending {
    update: Mutex<Option<Update>>,
    /// The version the notification was already shown for.
    announced: Mutex<Option<String>>,
    /// A version whose download didn't pass verification; never offered again this session.
    rejected: Mutex<Option<String>>,
}

pub fn start(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(FIRST_CHECK).await;
        loop {
            let _ = check(&app, false).await;
            tokio::time::sleep(EVERY).await;
        }
    });
}

/// Looks for a newer release. `manual` also reports "up to date" and errors to the person.
pub async fn check(app: &AppHandle, manual: bool) -> Result<(), String> {
    let mut builder = app.updater_builder();
    // Lets a test build point at a local feed; release builds use the GitHub endpoint from the config.
    if let Ok(url) = std::env::var("CURI_UPDATE_URL") {
        let url = url.parse().map_err(|e| format!("CURI_UPDATE_URL: {e}"))?;
        builder = builder.endpoints(vec![url]).map_err(|e| e.to_string())?;
    }
    let result = builder.build().map_err(|e| e.to_string())?.check().await;
    match result {
        Ok(Some(update))
            if app.state::<Pending>().rejected.lock().unwrap().as_deref()
                == Some(update.version.as_str()) =>
        {
            Ok(())
        }
        Ok(Some(update)) => {
            let version = update.version.clone();
            let notes = update.body.clone().unwrap_or_default();
            *app.state::<Pending>().update.lock().unwrap() = Some(update);
            crate::tray::set_update(app, Some(&version));
            let pending = app.state::<Pending>();
            let first = {
                let mut seen = pending.announced.lock().unwrap();
                let first = seen.as_deref() != Some(version.as_str());
                *seen = Some(version.clone());
                first
            };
            if first || manual {
                let _ = app
                    .notification()
                    .builder()
                    .title(format!("CURI {version} is available"))
                    .body("Open CURI or the menu bar icon to install it.")
                    .show();
            }
            to_ui(
                app,
                serde_json::json!({ "version": version, "notes": notes, "current": app.package_info().version.to_string() }),
            );
            Ok(())
        }
        Ok(None) => {
            if manual {
                let current = app.package_info().version.to_string();
                to_ui(
                    app,
                    serde_json::json!({ "upToDate": true, "current": current }),
                );
                let _ = app
                    .notification()
                    .builder()
                    .title("CURI is up to date")
                    .body(format!("You have the latest version ({current})."))
                    .show();
            }
            Ok(())
        }
        Err(e) => {
            if manual {
                to_ui(app, serde_json::json!({ "error": e.to_string() }));
            }
            Err(e.to_string())
        }
    }
}

/// Downloads, verifies and installs the update found by `check`, then restarts CURI.
pub async fn install(app: &AppHandle) -> Result<(), String> {
    // A .deb install can't replace itself; send people to the release page instead.
    if cfg!(target_os = "linux") && std::env::var_os("APPIMAGE").is_none() {
        let _ = crate::deps::quiet("xdg-open").arg(RELEASES).spawn();
        return Ok(());
    }
    let update = app.state::<Pending>().update.lock().unwrap().take();
    let Some(update) = update else {
        return check(app, true).await;
    };
    crate::tray::set_status(app, &format!("Downloading CURI {}…", update.version));
    if let Err(e) = update.download_and_install(|_, _| {}, || {}).await {
        let msg = e.to_string();
        let bad = msg.to_lowercase().contains("signature");
        if bad {
            // Not what the release key signed: drop it and say so; nothing was installed.
            *app.state::<Pending>().rejected.lock().unwrap() = Some(update.version.clone());
            crate::tray::set_update(app, None);
            let _ = app
                .notification()
                .builder()
                .title(format!("CURI {} wasn't installed", update.version))
                .body("The download didn't match the release signature, so CURI kept the version you have.")
                .show();
        } else {
            crate::tray::set_update(app, Some(&update.version));
            *app.state::<Pending>().update.lock().unwrap() = Some(update);
        }
        crate::tray::set_status(app, "CURI is running");
        to_ui(
            app,
            serde_json::json!({ "error": if bad { "the download didn't match the release signature, so nothing was installed".to_string() } else { msg.clone() } }),
        );
        return Err(msg);
    }
    #[cfg(target_os = "macos")]
    crate::quit::allow();
    app.restart();
}

fn to_ui(app: &AppHandle, payload: serde_json::Value) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.eval(format!(
            "window.__curiUpdate && window.__curiUpdate({payload})"
        ));
    }
}
