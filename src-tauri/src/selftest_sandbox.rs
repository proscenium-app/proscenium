// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

//! The native self-test under the App Sandbox (scripts/build-app.mjs
//! `--selftest --sandbox`, docs/engineering/release-engineering.md#REL-56).
//!
//! A sandboxed app reaches its container and nothing else, until the system
//! grants it more: the folder panel grants the folder picked, the Save panel
//! the one file it names, Finder the file it opens. Each grant is a sandbox
//! extension, which the panel's own process issues and the app consumes.
//!
//! The self-test cannot drive those panels, so its driver stands in for them
//! (scripts/selftest.mjs, which is not sandboxed): the app asks it for the
//! grant the panel would have given, and consumes what it answers. The grant
//! is the system's own kind, for the same path, and nothing wider, so the
//! sandbox then holds the app to exactly what a writer's click gives it. The
//! driver also does what the checks stage as the world around the app — a
//! Plays folder laid out before it is picked, a file made outside it, a
//! picture of the window — since the app itself may not.
//!
//! Asked on stdout, one JSON line each, and answered on stdin, one at a time.
//! Unsandboxed, nothing here asks anything: every function does the thing
//! itself, as the self-test always has.

use std::io::{BufRead, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde_json::{json, Value};

/// Whether this process runs in the App Sandbox: the sandbox names the
/// container it gave the app.
pub fn sandboxed() -> bool {
    std::env::var_os("APP_SANDBOX_CONTAINER_ID").is_some()
}

extern "C" {
    /// libsystem_sandbox: take up an extension another process issued.
    fn sandbox_extension_consume(token: *const std::ffi::c_char) -> i64;
}

/// One question to the driver at a time, numbered.
static ASKED: Mutex<u64> = Mutex::new(0);

/// Every grant the driver gave, in order, for the report.
static GRANTS: Mutex<Vec<Value>> = Mutex::new(Vec::new());

/// Ask the driver to do `verb`, and wait for its answer.
fn ask(verb: &str, args: Value) -> Result<Value, String> {
    let mut asked = ASKED.lock().unwrap_or_else(|p| p.into_inner());
    *asked += 1;
    let id = *asked;
    let mut line = json!({ "id": id, "verb": verb });
    if let (Value::Object(line), Value::Object(args)) = (&mut line, args) {
        line.extend(args);
    }
    {
        let mut out = std::io::stdout().lock();
        writeln!(out, "[selftest:ask] {line}").map_err(|e| e.to_string())?;
        out.flush().map_err(|e| e.to_string())?;
    }
    let mut answer = String::new();
    std::io::stdin()
        .lock()
        .read_line(&mut answer)
        .map_err(|e| e.to_string())?;
    if answer.is_empty() {
        return Err(format!("the driver never answered {verb}"));
    }
    let answer: Value = serde_json::from_str(answer.trim())
        .map_err(|e| format!("the driver's answer to {verb} is not JSON: {e}"))?;
    if answer["id"] != id {
        return Err(format!(
            "the driver answered {} for {verb} {id}",
            answer["id"]
        ));
    }
    match answer["error"].as_str() {
        Some(e) => Err(format!("the driver could not {verb}: {e}")),
        None => Ok(answer["value"].clone()),
    }
}

/// Take up an extension: the grant itself.
fn consume(token: &str) -> Result<(), String> {
    let token = std::ffi::CString::new(token).map_err(|e| e.to_string())?;
    // SAFETY: a NUL-terminated string, read and not kept.
    if unsafe { sandbox_extension_consume(token.as_ptr()) } < 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    Ok(())
}

/// The grants the driver made before the launch: the run's own evidence
/// folder and the expected accessibility trees, which are the harness's and
/// not the app's. Consumed before anything else is read or written.
pub fn consume_launch_grants() -> Result<(), String> {
    let Some(tokens) = std::env::var_os("PROSCENIUM_SELFTEST_GRANTS") else {
        return Ok(());
    };
    let tokens: Vec<String> =
        serde_json::from_str(&tokens.to_string_lossy()).map_err(|e| e.to_string())?;
    tokens.iter().try_for_each(|t| consume(t))
}

/// The grant the system would give for `path`, as `why` would: the folder
/// panel's, the Save panel's or Finder's. Unsandboxed there is nothing to
/// grant.
pub fn grant(path: &Path, write: bool, why: &str) -> Result<(), String> {
    if !sandboxed() {
        return Ok(());
    }
    let token = ask(
        "grant",
        json!({ "path": path.to_string_lossy(), "write": write, "why": why }),
    )?;
    let token = token.as_str().ok_or("the driver's grant is not a token")?;
    consume(token).map_err(|e| format!("{why}'s grant of {}: {e}", path.display()))?;
    GRANTS
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .push(json!({ "path": path.to_string_lossy(), "write": write, "why": why }));
    Ok(())
}

/// Copy the folder `from` into `to`, as the world does, where a sandboxed app
/// may not write: the driver does it.
pub fn copy_dir(from: &Path, to: &Path) -> Result<(), String> {
    ask(
        "copy",
        json!({ "from": from.to_string_lossy(), "to": to.to_string_lossy() }),
    )
    .map(|_| ())
}

/// Write a file outside anything the app was granted, as another program
/// would.
pub fn write_outside(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if sandboxed() {
        use base64::Engine as _;
        return ask(
            "write",
            json!({
                "path": path.to_string_lossy(),
                "base64": base64::engine::general_purpose::STANDARD.encode(bytes),
            }),
        )
        .map(|_| ());
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(path, bytes).map_err(|e| e.to_string())
}

/// The window as the screen shows it, at `path`. `screencapture` run by a
/// sandboxed app would inherit its sandbox; the driver runs it instead.
pub fn capture(window: isize, path: &Path) {
    if sandboxed() {
        let _ = ask(
            "capture",
            json!({ "window": window, "path": path.to_string_lossy() }),
        );
        return;
    }
    let _ = std::process::Command::new("/usr/sbin/screencapture")
        .args(["-x", "-o", "-l", &window.to_string()])
        .arg(path)
        .status();
}

/// What the run says about the sandbox, for the driver to judge: that it was
/// on, that it refused what nothing granted, where the app's data resolved,
/// and every grant it was given.
pub struct Facts {
    /// `HOME` as the sandbox set it, before the self-test points it at a
    /// fresh folder inside it.
    pub container_home: Option<PathBuf>,
    /// A write the sandbox should refuse, outside the container and every
    /// grant: what it said.
    pub refused: Option<String>,
}

pub fn report(facts: &Facts, app_data: Option<&Path>, cloud_root: Option<String>) -> Value {
    json!({
        "sandboxed": sandboxed(),
        "container": std::env::var("APP_SANDBOX_CONTAINER_ID").ok(),
        "containerHome": facts.container_home.as_ref().map(|p| p.to_string_lossy()),
        "refusedOutside": facts.refused,
        "appData": app_data.map(|p| p.to_string_lossy()),
        "cloudRoot": cloud_root,
        "grants": GRANTS.lock().unwrap_or_else(|p| p.into_inner()).clone(),
    })
}

/// Try to write where nothing granted the app anything; the sandbox's answer.
pub fn try_refused(dir: &Path) -> Option<String> {
    if !sandboxed() {
        return None;
    }
    let probe = dir.join("not-granted.txt");
    Some(match std::fs::write(&probe, b"") {
        Ok(()) => {
            let _ = std::fs::remove_file(&probe);
            "written".into()
        }
        Err(e) => e.to_string(),
    })
}
