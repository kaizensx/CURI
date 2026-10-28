#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
//! CURI desktop shell. The boot window installs/verifies runtime dependencies with live progress,
//! then starts CURI Core (loopback HTTP + token) as a child process and navigates to its UI.
//! The CURI UI never gets Tauri IPC: all privileged work stays in Core's allowlisted actions.

mod deps;

use std::{
    fs,
    io::{BufRead, BufReader},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{mpsc, Arc, Mutex},
    thread,
    time::Duration,
};
use tauri::{
    menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu},
    Emitter, Manager, RunEvent, Url,
};

#[derive(Default)]
struct CoreProc(Mutex<Option<Child>>);

fn curi_home(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Ok(h) = std::env::var("CURI_HOME") {
        return Ok(h.into());
    }
    Ok(app.path().home_dir().map_err(|e| e.to_string())?.join("Library/Application Support/CURI"))
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
    Err("Recursos do CURI Core não encontrados no pacote da aplicação.".into())
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

    emit(deps::Progress { step: "core", label: "CURI Core".into(), state: "running", pct: None, detail: "A iniciar servidor local (127.0.0.1)…".into() });
    let mut cmd = Command::new(&r.node);
    cmd.arg(root.join("core/bin/curi.mjs"))
        .args(["app", "--port", "0", "--no-open", "--print-url", "--exit-on-stdin-close"])
        .env("PATH", &r.path_env)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(c) = &r.claude {
        cmd.env("CURI_CLAUDE_BIN", c);
    }
    let mut child = cmd.spawn().map_err(|e| format!("Falha ao lançar o Core: {e}"))?;
    let stdout = child.stdout.take().ok_or("stdout")?;
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
    thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if line.starts_with("http://127.0.0.1:") && line.contains("#token=") {
                let _ = tx.send(line);
            }
        }
    });
    let url = match rx.recv_timeout(Duration::from_secs(45)) {
        Ok(u) => u,
        Err(_) => {
            let _ = child.kill();
            let msg = format!("O Core não arrancou em 45 s.\n{}", errbuf.lock().unwrap());
            emit(deps::Progress { step: "core", label: "CURI Core".into(), state: "failed", pct: None, detail: msg.clone() });
            return Err(msg);
        }
    };
    *app.state::<CoreProc>().0.lock().unwrap() = Some(child);
    emit(deps::Progress { step: "core", label: "CURI Core".into(), state: "done", pct: Some(100.0), detail: "Servidor local pronto.".into() });
    let w = app.get_webview_window("main").ok_or("janela principal inexistente")?;
    // Tell the UI it runs inside the native shell (transparent sidebar, title-bar drag region).
    let url = url.replacen("/#", "/?native=1#", 1);
    w.navigate(Url::parse(&url).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn start(app: tauri::AppHandle) -> Result<(), String> {
    if app.state::<CoreProc>().0.lock().unwrap().is_some() {
        return Err("O Core já está em execução.".into());
    }
    tauri::async_runtime::spawn_blocking(move || boot(app)).await.map_err(|e| e.to_string())?
}

/// Native menu bar. Custom items forward a command id to the UI (`window.__curiMenu`), which owns routing.
fn build_menu(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let item = |id: &str, label: &str, accel: Option<&str>| MenuItem::with_id(app, id, label, true, accel);
    let sep = || PredefinedMenuItem::separator(app);
    let about = AboutMetadata { name: Some("CURI".into()), version: Some(env!("CARGO_PKG_VERSION").into()), comments: Some("Claude Universal Resource Intelligence".into()), ..Default::default() };
    let app_menu = Submenu::with_items(app, "CURI", true, &[
        &PredefinedMenuItem::about(app, Some("Sobre o CURI"), Some(about))?,
        &sep()?,
        &item("route:settings", "Definições…", Some("CmdOrCtrl+,"))?,
        &sep()?,
        &PredefinedMenuItem::hide(app, Some("Ocultar CURI"))?,
        &PredefinedMenuItem::hide_others(app, Some("Ocultar outros"))?,
        &PredefinedMenuItem::show_all(app, Some("Mostrar tudo"))?,
        &sep()?,
        &PredefinedMenuItem::quit(app, Some("Sair do CURI"))?,
    ])?;
    let file = Submenu::with_items(app, "Ficheiro", true, &[
        &item("add-url", "Adicionar URL…", Some("CmdOrCtrl+N"))?,
        &item("route:radar", "Nova descoberta", Some("CmdOrCtrl+Shift+N"))?,
        &sep()?,
        &PredefinedMenuItem::close_window(app, Some("Fechar janela"))?,
    ])?;
    let edit = Submenu::with_items(app, "Editar", true, &[
        &PredefinedMenuItem::undo(app, Some("Desfazer"))?,
        &PredefinedMenuItem::redo(app, Some("Refazer"))?,
        &sep()?,
        &PredefinedMenuItem::cut(app, Some("Cortar"))?,
        &PredefinedMenuItem::copy(app, Some("Copiar"))?,
        &PredefinedMenuItem::paste(app, Some("Colar"))?,
        &PredefinedMenuItem::select_all(app, Some("Selecionar tudo"))?,
    ])?;
    let view = Submenu::with_items(app, "Ver", true, &[
        &item("palette", "Paleta de comandos", Some("CmdOrCtrl+K"))?,
        &sep()?,
        &item("route:dashboard", "Painel", Some("CmdOrCtrl+1"))?,
        &item("route:library", "Biblioteca", Some("CmdOrCtrl+2"))?,
        &item("route:radar", "Radar", Some("CmdOrCtrl+3"))?,
        &item("route:map", "Capacidades", Some("CmdOrCtrl+4"))?,
        &item("route:compare", "Comparar", Some("CmdOrCtrl+5"))?,
        &item("route:connections", "Ligações", Some("CmdOrCtrl+6"))?,
        &item("route:integrations", "Catálogo de integrações", Some("CmdOrCtrl+7"))?,
        &item("route:automation", "Automação e permissões", Some("CmdOrCtrl+8"))?,
        &item("route:operations", "Operações", Some("CmdOrCtrl+9"))?,
        &sep()?,
        &item("reload", "Atualizar dados", Some("CmdOrCtrl+R"))?,
        &PredefinedMenuItem::fullscreen(app, Some("Ecrã completo"))?,
    ])?;
    let window = Submenu::with_items(app, "Janela", true, &[
        &PredefinedMenuItem::minimize(app, Some("Minimizar"))?,
        &PredefinedMenuItem::maximize(app, Some("Zoom"))?,
        &sep()?,
        &item("route:jobs", "Pesquisa e quotas", None)?,
        &item("route:security", "Segurança", None)?,
        &item("route:audit", "Auditoria", None)?,
    ])?;
    let help = Submenu::with_items(app, "Ajuda", true, &[&item("route:about", "Ajuda do CURI", None)?])?;
    Menu::with_items(app, &[&app_menu, &file, &edit, &view, &window, &help])
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .setup(|app| {
            let menu = build_menu(app.handle())?;
            app.set_menu(menu)?;
            app.on_menu_event(|app, ev| {
                if let Some(w) = app.get_webview_window("main") {
                    let id = serde_json::to_string(ev.id().as_ref()).unwrap_or_default();
                    let _ = w.eval(format!("window.__curiMenu && window.__curiMenu({id})"));
                }
            });
            Ok(())
        })
        .manage(CoreProc::default())
        .invoke_handler(tauri::generate_handler![start])
        .build(tauri::generate_context!())
        .expect("erro ao iniciar a aplicação CURI")
        .run(|app, ev| {
            if let RunEvent::Exit = ev {
                if let Some(mut c) = app.state::<CoreProc>().0.lock().unwrap().take() {
                    let _ = c.kill();
                }
            }
        });
}
