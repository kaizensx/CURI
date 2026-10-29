//! Runtime dependency manager. Detects Node (>= 22.13 with node:sqlite), git and the Claude Code CLI;
//! installs what is missing into the CURI runtime dir (never system-wide), reporting progress.
//! Uses only tools every supported OS ships (curl, tar, and shasum / sha256sum / certutil), so no extra
//! crates touch the network.

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

const WIN: bool = cfg!(windows);

/// The file name of a program on this OS: `node` → `node.exe` on Windows.
fn exe(name: &str) -> String {
    if WIN {
        format!("{name}.exe")
    } else {
        name.to_string()
    }
}

/// Where the CURI runtime keeps its own Node binary.
fn runtime_node(runtime: &Path) -> PathBuf {
    if WIN {
        runtime.join("node").join("node.exe")
    } else {
        runtime.join("node/bin/node")
    }
}

/// A command that never opens a console window on Windows (the app is a GUI program, so every
/// child would otherwise get its own black terminal). Children of these processes inherit that.
pub fn quiet(program: impl AsRef<std::ffi::OsStr>) -> Command {
    #[allow(unused_mut)]
    let mut c = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        c.creation_flags(CREATE_NO_WINDOW);
    }
    c
}

fn path_dirs(path_env: &str) -> Vec<PathBuf> {
    std::env::split_paths(path_env).collect()
}

fn p(
    step: &'static str,
    label: &str,
    state: &'static str,
    pct: Option<f64>,
    detail: impl Into<String>,
) -> Progress {
    Progress {
        step,
        label: label.to_string(),
        state,
        pct,
        detail: detail.into(),
    }
}

/// Apps launched from Finder or the Start menu get a minimal PATH; add the usual install locations.
pub fn search_path(home: &Path, runtime: &Path) -> String {
    let mut dirs: Vec<PathBuf> = vec![
        runtime_node(runtime)
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_default(),
        runtime.join("claude").join("node_modules").join(".bin"),
        home.join(".local").join("bin"),
    ];
    if WIN {
        for (var, sub) in [
            ("ProgramFiles", "nodejs"),
            ("APPDATA", "npm"),
            ("LOCALAPPDATA", "Programs\\nodejs"),
        ] {
            if let Some(base) = std::env::var_os(var) {
                dirs.push(PathBuf::from(base).join(sub));
            }
        }
    } else {
        dirs.extend(["/opt/homebrew/bin", "/usr/local/bin"].map(PathBuf::from));
        dirs.push(home.join(".volta/bin"));
    }
    if let Some(cur) = std::env::var_os("PATH") {
        dirs.extend(std::env::split_paths(&cur));
    }
    if !WIN {
        dirs.extend(["/usr/bin", "/bin", "/usr/sbin", "/sbin"].map(PathBuf::from));
    }
    let mut seen = std::collections::HashSet::new();
    dirs.retain(|d| !d.as_os_str().is_empty() && seen.insert(d.clone()));
    std::env::join_paths(dirs)
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn node_version_ok(bin: &Path) -> Option<String> {
    let out = quiet(bin)
        .args([
            "-e",
            "require('node:sqlite');process.stdout.write(process.versions.node)",
        ])
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
    let own = runtime_node(runtime);
    if let Some(v) = node_version_ok(&own) {
        return Some((own, v));
    }
    if force_install {
        return None;
    }
    path_dirs(path_env)
        .into_iter()
        .map(|d| d.join(exe("node")))
        .filter(|p| p.exists())
        .find_map(|p| node_version_ok(&p).map(|v| (p, v)))
}

fn curl_text(url: &str) -> Result<String, String> {
    let out = quiet(exe("curl"))
        .args(["-fsSL", "--max-time", "60", url])
        .output()
        .map_err(|e| format!("curl: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "download failed ({url}): {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

fn content_length(url: &str) -> Option<u64> {
    let out = quiet(exe("curl"))
        .args(["-sIL", "--max-time", "30", url])
        .output()
        .ok()?;
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .filter_map(|l| {
            l.to_ascii_lowercase()
                .strip_prefix("content-length:")
                .map(|v| v.trim().to_string())
        })
        .next_back()?
        .parse()
        .ok()
}

fn platform() -> Result<(&'static str, &'static str, &'static str), String> {
    let os = match std::env::consts::OS {
        "macos" => "darwin",
        "linux" => "linux",
        "windows" => "win",
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
        ("win", "arm64") => "win-arm64-zip",
        ("win", _) => "win-x64-zip",
        _ => "linux-x64",
    };
    Ok((os, arch, key))
}

fn install_node(runtime: &Path, emit: &dyn Fn(Progress)) -> Result<(PathBuf, String), String> {
    const S: &str = "node";
    const L: &str = "Runtime Node.js";
    let (os, arch, key) = platform()?;
    emit(p(
        S,
        L,
        "running",
        None,
        "Checking LTS versions on nodejs.org…",
    ));
    let index: serde_json::Value =
        serde_json::from_str(&curl_text(&format!("{NODE_DIST}/index.json"))?)
            .map_err(|e| format!("invalid index.json: {e}"))?;
    let version = index
        .as_array()
        .ok_or("unexpected index.json")?
        .iter()
        .find(|r| {
            let lts = r["lts"].is_string();
            let has = r["files"]
                .as_array()
                .map(|f| f.iter().any(|x| x == key))
                .unwrap_or(false);
            let v = r["version"]
                .as_str()
                .unwrap_or("v0.0.0")
                .trim_start_matches('v')
                .to_string();
            let mut it = v.split('.').map(|x| x.parse::<u32>().unwrap_or(0));
            let ok = (it.next().unwrap_or(0), it.next().unwrap_or(0)) >= MIN_NODE;
            lts && has && ok
        })
        .and_then(|r| r["version"].as_str())
        .ok_or("no compatible LTS version found")?
        .to_string();
    let name = format!(
        "node-{version}-{os}-{arch}.{}",
        if WIN { "zip" } else { "tar.gz" }
    );
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
    let mut child = quiet(exe("curl"))
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
        emit(p(
            S,
            L,
            "running",
            pct,
            format!(
                "Downloading {version}: {:.1} MB{} · {}s",
                got as f64 / 1e6,
                total
                    .map(|t| format!(" of {:.1} MB", t as f64 / 1e6))
                    .unwrap_or_default(),
                started.elapsed().as_secs()
            ),
        ));
        thread::sleep(Duration::from_millis(250));
    }

    emit(p(S, L, "running", Some(99.0), "Verifying SHA-256…"));
    let actual = sha256(&tmp)?;
    if actual != expected {
        let _ = fs::remove_file(&tmp);
        return Err(format!(
            "SHA-256 mismatch (expected {expected}, got {actual}); file discarded"
        ));
    }

    emit(p(S, L, "running", Some(99.5), "Extracting…"));
    let staging = runtime.join(".staging");
    let _ = fs::remove_dir_all(&staging);
    fs::create_dir_all(&staging).map_err(|e| e.to_string())?;
    // tar reads both .tar.gz and (on Windows, bsdtar) .zip.
    let st = quiet(exe("tar"))
        .arg("-xf")
        .arg(&tmp)
        .arg("-C")
        .arg(&staging)
        .status()
        .map_err(|e| e.to_string())?;
    if !st.success() {
        return Err("extraction failed".into());
    }
    let extracted = staging.join(format!("node-{version}-{os}-{arch}"));
    let dest = runtime.join("node");
    let _ = fs::remove_dir_all(&dest);
    fs::rename(&extracted, &dest).map_err(|e| e.to_string())?;
    let _ = fs::remove_dir_all(&staging);
    let _ = fs::remove_file(&tmp);
    let node = runtime_node(runtime);
    let v = node_version_ok(&node).ok_or("Node installed but doesn't start")?;
    Ok((node, v))
}

/// SHA-256 of a file with the tool this OS ships: shasum (macOS), sha256sum (Linux), certutil (Windows).
fn sha256(file: &Path) -> Result<String, String> {
    let out = if WIN {
        quiet("certutil")
            .arg("-hashfile")
            .arg(file)
            .arg("SHA256")
            .output()
    } else if cfg!(target_os = "macos") {
        quiet("shasum").args(["-a", "256"]).arg(file).output()
    } else {
        quiet("sha256sum").arg(file).output()
    }
    .map_err(|e| format!("checksum tool: {e}"))?;
    let text = String::from_utf8_lossy(&out.stdout).to_lowercase();
    // certutil prints the hash on its own line, sometimes with spaces between byte pairs.
    text.lines()
        .map(|l| l.split_whitespace().collect::<Vec<_>>())
        .find_map(|w| {
            let joined = if WIN {
                w.concat()
            } else {
                w.first().map(|s| s.to_string()).unwrap_or_default()
            };
            (joined.len() == 64 && joined.chars().all(|c| c.is_ascii_hexdigit())).then_some(joined)
        })
        .ok_or_else(|| "couldn't compute SHA-256".to_string())
}

fn find_claude(path_env: &str, home: &Path, runtime: &Path) -> Option<PathBuf> {
    // Windows: only real executables. npm's claude.cmd shim can't be spawned without a shell; the
    // native installer puts claude.exe in ~/.local/bin and the npm package ships one too (see install_claude).
    let names: &[&str] = if WIN { &["claude.exe"] } else { &["claude"] };
    let mut c: Vec<PathBuf> = path_dirs(path_env)
        .into_iter()
        .flat_map(|d| names.iter().map(move |n| d.join(n)))
        .collect();
    for n in names {
        c.push(home.join(".local").join("bin").join(n));
        c.push(home.join(".claude").join("local").join(n));
    }
    // The copy CURI installed into its own runtime on an earlier launch.
    c.push(
        runtime
            .join("claude")
            .join("node_modules")
            .join("@anthropic-ai")
            .join("claude-code")
            .join("bin")
            .join(exe("claude")),
    );
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

fn install_claude(
    node: &Path,
    runtime: &Path,
    path_env: &str,
    emit: &dyn Fn(Progress),
) -> Result<PathBuf, String> {
    const S: &str = "claude";
    const L: &str = "Claude Code CLI";
    let npm = node
        .parent()
        .ok_or("npm not found")?
        .join(if WIN { "npm.cmd" } else { "npm" });
    let prefix = runtime.join("claude");
    fs::create_dir_all(&prefix).map_err(|e| e.to_string())?;
    let mut child = quiet(&npm)
        .args([
            "install",
            "--no-audit",
            "--no-fund",
            "--loglevel=error",
            "--prefix",
        ])
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
        emit(p(
            S,
            L,
            "running",
            None,
            format!(
                "Installing @anthropic-ai/claude-code via npm · {}s",
                started.elapsed().as_secs()
            ),
        ));
        thread::sleep(Duration::from_millis(500));
    }
    let bin = if WIN {
        prefix
            .join("node_modules")
            .join("@anthropic-ai")
            .join("claude-code")
            .join("bin")
            .join("claude.exe")
    } else {
        prefix.join("node_modules").join(".bin").join("claude")
    };
    bin.exists()
        .then_some(bin)
        .ok_or("claude binary not found after install".into())
}

pub fn ensure(home: &Path, runtime: &Path, emit: &dyn Fn(Progress)) -> Result<Resolved, String> {
    let force = std::env::var("CURI_FORCE_RUNTIME_INSTALL").is_ok();
    let path_env = search_path(home, runtime);

    // 1. Node.js (required)
    emit(p(
        "node",
        "Runtime Node.js",
        "running",
        None,
        "Looking for Node ≥ 22.13 with SQLite…",
    ));
    let (node, ver, how) = match find_node(&path_env, runtime, force) {
        Some((n, v)) => (n, v, "found"),
        None => {
            let (n, v) = install_node(runtime, emit).inspect_err(|e| {
                emit(p("node", "Runtime Node.js", "failed", None, e.clone()));
            })?;
            (n, v, "installed in the CURI runtime")
        }
    };
    emit(p(
        "node",
        "Runtime Node.js",
        "done",
        Some(100.0),
        format!("v{ver} {how} · {}", node.display()),
    ));

    // 2. git (used for source verification; optional)
    emit(p("git", "Git", "running", None, "Checking…"));
    match quiet("git")
        .arg("--version")
        .env("PATH", &path_env)
        .stderr(Stdio::null())
        .output()
    {
        Ok(o) if o.status.success() => emit(p(
            "git",
            "Git",
            "done",
            Some(100.0),
            String::from_utf8_lossy(&o.stdout).trim().to_string(),
        )),
        _ => {
            #[cfg(target_os = "macos")]
            let _ = quiet("xcode-select").arg("--install").spawn();
            let how = if cfg!(target_os = "macos") {
                "Apple's Command Line Tools installer was opened"
            } else if WIN {
                "install it from git-scm.com"
            } else {
                "install it with your package manager"
            };
            emit(p(
                "git",
                "Git",
                "warning",
                None,
                format!("Git missing: {how}. Source checks are limited until it's there."),
            ));
        }
    }

    // 3. Claude Code CLI (optional: catalogue works without it)
    emit(p("claude", "Claude Code CLI", "running", None, "Looking…"));
    let claude = match find_claude(&path_env, home, runtime) {
        Some(c) if !force => {
            emit(p(
                "claude",
                "Claude Code CLI",
                "done",
                Some(100.0),
                format!("found · {}", c.display()),
            ));
            Some(c)
        }
        _ => match install_claude(&node, runtime, &path_env, emit) {
            Ok(c) => {
                emit(p(
                    "claude",
                    "Claude Code CLI",
                    "done",
                    Some(100.0),
                    format!("installed in the CURI runtime · {}", c.display()),
                ));
                Some(c)
            }
            Err(e) => {
                emit(p(
                    "claude",
                    "Claude Code CLI",
                    "warning",
                    None,
                    format!("{e}. CURI works in catalogue mode without the Claude integration."),
                ));
                None
            }
        },
    };
    Ok(Resolved {
        node,
        path_env,
        claude,
    })
}
