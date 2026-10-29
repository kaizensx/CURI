//! Runtime dependency manager. Detects Node (>= 22.13 with node:sqlite), git and the Claude Code CLI;
//! installs what is missing into the CURI runtime dir (never system-wide), reporting progress.
//! Uses only macOS/Linux built-ins (curl, shasum, tar) so no extra crates touch the network.

use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

const MIN_NODE: (u32, u32) = (22, 13);
const NODE_DIST: &str = "https://nodejs.org/dist";

#[derive(Serialize, Clone, Debug)]
pub struct Progress {
    pub step: &'static str,
    pub label: String,
    /// pending | running | done | skipped | warning | failed
    pub state: &'static str,
    pub pct: Option<f64>,
    pub detail: String,
}

pub struct Resolved {
    pub node: PathBuf,
    pub path_env: String,
    pub claude: Option<PathBuf>,
}

fn p(step: &'static str, label: &str, state: &'static str, pct: Option<f64>, detail: impl Into<String>) -> Progress {
    Progress { step, label: label.to_string(), state, pct, detail: detail.into() }
}

/// Apps launched from Finder get a minimal PATH; add the usual install locations.
pub fn search_path(home: &Path, runtime: &Path) -> String {
    let mut dirs: Vec<String> = vec![
        runtime.join("node/bin").display().to_string(),
        runtime.join("claude/node_modules/.bin").display().to_string(),
        "/opt/homebrew/bin".into(),
        "/usr/local/bin".into(),
        home.join(".local/bin").display().to_string(),
        home.join(".volta/bin").display().to_string(),
    ];
    if let Ok(cur) = std::env::var("PATH") {
        dirs.extend(cur.split(':').map(String::from));
    }
    dirs.extend(["/usr/bin", "/bin", "/usr/sbin", "/sbin"].map(String::from));
    let mut seen = std::collections::HashSet::new();
    dirs.retain(|d| !d.is_empty() && seen.insert(d.clone()));
    dirs.join(":")
}

fn node_version_ok(bin: &Path) -> Option<String> {
    let out = Command::new(bin)
        .args(["-e", "require('node:sqlite');process.stdout.write(process.versions.node)"])
        .stderr(Stdio::null())
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let v = String::from_utf8_lossy(&out.stdout).to_string();
    let mut it = v.split('.').map(|x| x.parse::<u32>().unwrap_or(0));
    let (ma, mi) = (it.next()?, it.next()?);
    ((ma, mi) >= MIN_NODE).then_some(v)
}

fn find_node(path_env: &str, runtime: &Path, force_install: bool) -> Option<(PathBuf, String)> {
    let runtime_node = runtime.join("node/bin/node");
    if let Some(v) = node_version_ok(&runtime_node) {
        return Some((runtime_node, v));
    }
    if force_install {
        return None;
    }
    path_env.split(':').map(|d| Path::new(d).join("node")).filter(|p| p.exists()).find_map(|p| node_version_ok(&p).map(|v| (p, v)))
}

fn curl_text(url: &str) -> Result<String, String> {
    let out = Command::new("curl").args(["-fsSL", "--max-time", "60", url]).output().map_err(|e| format!("curl: {e}"))?;
    if !out.status.success() {
        return Err(format!("download failed ({url}): {}", String::from_utf8_lossy(&out.stderr).trim()));
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

fn content_length(url: &str) -> Option<u64> {
    let out = Command::new("curl").args(["-sIL", "--max-time", "30", url]).output().ok()?;
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .filter_map(|l| l.to_ascii_lowercase().strip_prefix("content-length:").map(|v| v.trim().to_string()))
        .next_back()?
        .parse()
        .ok()
}

fn platform() -> Result<(&'static str, &'static str, &'static str), String> {
    let os = match std::env::consts::OS {
        "macos" => "darwin",
        "linux" => "linux",
        o => return Err(format!("OS not supported for automatic Node install: {o}")),
    };
    let arch = match std::env::consts::ARCH {
        "aarch64" => "arm64",
        "x86_64" => "x64",
        a => return Err(format!("unsupported architecture: {a}")),
    };
    let key = match (os, arch) {
        ("darwin", "arm64") => "osx-arm64-tar",
        ("darwin", "x64") => "osx-x64-tar",
        ("linux", "arm64") => "linux-arm64",
        _ => "linux-x64",
    };
    Ok((os, arch, key))
}

fn install_node(runtime: &Path, emit: &dyn Fn(Progress)) -> Result<(PathBuf, String), String> {
    const S: &str = "node";
    const L: &str = "Runtime Node.js";
    let (os, arch, key) = platform()?;
    emit(p(S, L, "running", None, "Checking LTS versions on nodejs.org…"));
    let index: serde_json::Value = serde_json::from_str(&curl_text(&format!("{NODE_DIST}/index.json"))?).map_err(|e| format!("invalid index.json: {e}"))?;
    let version = index
        .as_array()
        .ok_or("unexpected index.json")?
        .iter()
        .find(|r| {
            let lts = r["lts"].is_string();
            let has = r["files"].as_array().map(|f| f.iter().any(|x| x == key)).unwrap_or(false);
            let v = r["version"].as_str().unwrap_or("v0.0.0").trim_start_matches('v').to_string();
            let mut it = v.split('.').map(|x| x.parse::<u32>().unwrap_or(0));
            let ok = (it.next().unwrap_or(0), it.next().unwrap_or(0)) >= MIN_NODE;
            lts && has && ok
        })
        .and_then(|r| r["version"].as_str())
        .ok_or("no compatible LTS version found")?
        .to_string();
    let name = format!("node-{version}-{os}-{arch}.tar.gz");
    let url = format!("{NODE_DIST}/{version}/{name}");
    let sums = curl_text(&format!("{NODE_DIST}/{version}/SHASUMS256.txt"))?;
    let expected = sums
        .lines()
        .find(|l| l.ends_with(&format!("  {name}")))
        .and_then(|l| l.split_whitespace().next())
        .ok_or("official SHA-256 not found")?
        .to_string();

    fs::create_dir_all(runtime).map_err(|e| e.to_string())?;
    let tmp = runtime.join(format!(".{name}.part"));
    let _ = fs::remove_file(&tmp);
    let total = content_length(&url);
    let mut child = Command::new("curl")
        .args(["-fsSL", "--retry", "3", "-o"])
        .arg(&tmp)
        .arg(&url)
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("curl: {e}"))?;
    let started = Instant::now();
    loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            if !status.success() {
                return Err(format!("Node download failed ({url})"));
            }
            break;
        }
        let got = fs::metadata(&tmp).map(|m| m.len()).unwrap_or(0);
        let pct = total.map(|t| (got as f64 / t as f64 * 100.0).min(99.0));
        emit(p(S, L, "running", pct, format!("Downloading {version}: {:.1} MB{} · {}s", got as f64 / 1e6, total.map(|t| format!(" of {:.1} MB", t as f64 / 1e6)).unwrap_or_default(), started.elapsed().as_secs())));
        thread::sleep(Duration::from_millis(250));
    }

    emit(p(S, L, "running", Some(99.0), "Verifying SHA-256…"));
    let out = Command::new("shasum").args(["-a", "256"]).arg(&tmp).output().map_err(|e| e.to_string())?;
    let actual = String::from_utf8_lossy(&out.stdout).split_whitespace().next().unwrap_or("").to_string();
    if actual != expected {
        let _ = fs::remove_file(&tmp);
        return Err(format!("SHA-256 mismatch (expected {expected}, got {actual}); file discarded"));
    }

    emit(p(S, L, "running", Some(99.5), "Extracting…"));
    let staging = runtime.join(".staging");
    let _ = fs::remove_dir_all(&staging);
    fs::create_dir_all(&staging).map_err(|e| e.to_string())?;
    let st = Command::new("tar").arg("-xzf").arg(&tmp).arg("-C").arg(&staging).status().map_err(|e| e.to_string())?;
    if !st.success() {
        return Err("extraction failed".into());
    }
    let extracted = staging.join(format!("node-{version}-{os}-{arch}"));
    let dest = runtime.join("node");
    let _ = fs::remove_dir_all(&dest);
    fs::rename(&extracted, &dest).map_err(|e| e.to_string())?;
    let _ = fs::remove_dir_all(&staging);
    let _ = fs::remove_file(&tmp);
    let node = dest.join("bin/node");
    let v = node_version_ok(&node).ok_or("Node installed but doesn't start")?;
    Ok((node, v))
}

fn find_claude(path_env: &str, home: &Path) -> Option<PathBuf> {
    let mut c: Vec<PathBuf> = path_env.split(':').map(|d| Path::new(d).join("claude")).collect();
    c.push(home.join(".local/bin/claude"));
    c.push(home.join(".claude/local/claude"));
    let bundled = home.join("Library/Application Support/Claude/claude-code");
    if let Ok(vers) = fs::read_dir(&bundled) {
        let mut vers: Vec<PathBuf> = vers.filter_map(|e| e.ok().map(|e| e.path())).collect();
        vers.sort_by(|a, b| b.cmp(a));
        for v in vers {
            if let Ok(hashes) = fs::read_dir(&v) {
                for h in hashes.flatten() {
                    c.push(h.path().join("claude.app/Contents/MacOS/claude"));
                }
            }
        }
    }
    c.into_iter().find(|p| p.is_file())
}

fn install_claude(node: &Path, runtime: &Path, path_env: &str, emit: &dyn Fn(Progress)) -> Result<PathBuf, String> {
    const S: &str = "claude";
    const L: &str = "Claude Code CLI";
    let npm = node.parent().ok_or("npm not found")?.join("npm");
    let prefix = runtime.join("claude");
    fs::create_dir_all(&prefix).map_err(|e| e.to_string())?;
    let mut child = Command::new(&npm)
        .args(["install", "--no-audit", "--no-fund", "--loglevel=error", "--prefix"])
        .arg(&prefix)
        .arg("@anthropic-ai/claude-code")
        .env("PATH", path_env)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("npm: {e}"))?;
    let started = Instant::now();
    loop {
        if let Some(st) = child.try_wait().map_err(|e| e.to_string())? {
            if !st.success() {
                return Err("npm install @anthropic-ai/claude-code failed".into());
            }
            break;
        }
        emit(p(S, L, "running", None, format!("Installing @anthropic-ai/claude-code via npm · {}s", started.elapsed().as_secs())));
        thread::sleep(Duration::from_millis(500));
    }
    let bin = prefix.join("node_modules/.bin/claude");
    bin.exists().then_some(bin).ok_or("claude binary not found after install".into())
}

pub fn ensure(home: &Path, runtime: &Path, emit: &dyn Fn(Progress)) -> Result<Resolved, String> {
    let force = std::env::var("CURI_FORCE_RUNTIME_INSTALL").is_ok();
    let path_env = search_path(home, runtime);

    // 1. Node.js (required)
    emit(p("node", "Runtime Node.js", "running", None, "Looking for Node ≥ 22.13 with SQLite…"));
    let (node, ver, how) = match find_node(&path_env, runtime, force) {
        Some((n, v)) => (n, v, "found"),
        None => {
            let (n, v) = install_node(runtime, emit).inspect_err(|e| {
                emit(p("node", "Runtime Node.js", "failed", None, e.clone()));
            })?;
            (n, v, "installed in the CURI runtime")
        }
    };
    emit(p("node", "Runtime Node.js", "done", Some(100.0), format!("v{ver} {how} · {}", node.display())));

    // 2. git (used for source verification; optional)
    emit(p("git", "Git", "running", None, "Checking…"));
    match Command::new("git").arg("--version").env("PATH", &path_env).stderr(Stdio::null()).output() {
        Ok(o) if o.status.success() => emit(p("git", "Git", "done", Some(100.0), String::from_utf8_lossy(&o.stdout).trim().to_string())),
        _ => {
            #[cfg(target_os = "macos")]
            let _ = Command::new("xcode-select").arg("--install").spawn();
            emit(p("git", "Git", "warning", None, "Git missing: Apple's Command Line Tools installer was opened. Source checks are limited until it finishes."));
        }
    }

    // 3. Claude Code CLI (optional: catalogue works without it)
    emit(p("claude", "Claude Code CLI", "running", None, "Looking…"));
    let claude = match find_claude(&path_env, home) {
        Some(c) if !force => {
            emit(p("claude", "Claude Code CLI", "done", Some(100.0), format!("found · {}", c.display())));
            Some(c)
        }
        _ => match install_claude(&node, runtime, &path_env, emit) {
            Ok(c) => {
                emit(p("claude", "Claude Code CLI", "done", Some(100.0), format!("installed in the CURI runtime · {}", c.display())));
                Some(c)
            }
            Err(e) => {
                emit(p("claude", "Claude Code CLI", "warning", None, format!("{e}. CURI works in catalogue mode without the Claude integration.")));
                None
            }
        },
    };
    Ok(Resolved { node, path_env, claude })
}
