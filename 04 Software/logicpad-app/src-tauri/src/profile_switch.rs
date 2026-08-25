use crate::focus;
use crate::hid::Pad;
use crate::launch;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

const DEBOUNCE: Duration = Duration::from_millis(400);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SwitchRule {
    pub exe: String,
    pub profile: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SwitchConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub rules: Vec<SwitchRule>,
}

impl Default for SwitchConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            rules: Vec::new(),
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusEvt {
    pub exe: String,
    pub profile: Option<u8>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveEvt {
    pub profile: u8,
}

struct Runtime {
    last_seen_exe: String,
    pending_exe: String,
    pending_at: Instant,
    last_emitted: String,
    baseline: Option<u8>,
    last_applied: Option<u8>,
}

impl Runtime {
    fn new() -> Self {
        Self {
            last_seen_exe: String::new(),
            pending_exe: String::new(),
            pending_at: Instant::now(),
            last_emitted: String::new(),
            baseline: None,
            last_applied: None,
        }
    }

    fn reset_seen(&mut self) {
        self.last_seen_exe.clear();
        self.pending_exe.clear();
        self.last_emitted.clear();
    }
}

struct Inner {
    cfg: SwitchConfig,
    rt: Runtime,
}

pub struct SwitchStore {
    file: PathBuf,
    inner: Mutex<Inner>,
}

pub fn exe_basename(path: &str) -> String {
    Path::new(path.trim())
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(path.trim())
        .to_string()
}

fn match_profile(rules: &[SwitchRule], exe: &str) -> Option<u8> {
    let needle = exe_basename(exe);
    if needle.is_empty() {
        return None;
    }
    rules
        .iter()
        .find(|r| exe_basename(&r.exe).eq_ignore_ascii_case(&needle))
        .map(|r| r.profile)
}

impl SwitchStore {
    pub fn load(file: PathBuf) -> Self {
        let mut cfg = SwitchConfig::default();
        if let Ok(raw) = fs::read_to_string(&file) {
            if let Ok(parsed) = serde_json::from_str::<SwitchConfig>(&raw) {
                cfg = parsed;
            }
        }
        for r in &mut cfg.rules {
            r.exe = exe_basename(&r.exe);
        }
        Self {
            file,
            inner: Mutex::new(Inner {
                cfg,
                rt: Runtime::new(),
            }),
        }
    }

    fn persist(file: &Path, cfg: &SwitchConfig) -> Result<(), String> {
        if let Some(dir) = file.parent() {
            fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        fs::write(
            file,
            serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())
    }

    pub fn config(&self) -> SwitchConfig {
        self.inner
            .lock()
            .map(|g| g.cfg.clone())
            .unwrap_or_default()
    }

    pub fn wants_autostart(&self) -> bool {
        self.inner
            .lock()
            .map(|g| g.cfg.enabled && !g.cfg.rules.is_empty())
            .unwrap_or(false)
    }

    pub fn reset_seen(&self) {
        if let Ok(mut g) = self.inner.lock() {
            g.rt.reset_seen();
        }
    }

    pub fn set_config(&self, mut cfg: SwitchConfig) -> Result<SwitchConfig, String> {
        cfg.rules.retain(|r| !exe_basename(&r.exe).is_empty());
        for r in &mut cfg.rules {
            r.exe = exe_basename(&r.exe);
        }
        let mut g = self.inner.lock().map_err(|_| "lock".to_string())?;
        g.cfg = cfg;
        g.rt.reset_seen();
        Self::persist(&self.file, &g.cfg)?;
        Ok(g.cfg.clone())
    }

    pub fn add_program(&self, profile: u8, path: &str) -> Result<SwitchConfig, String> {
        let resolved = launch::resolve_program(path);
        let src = if resolved.path.is_empty() {
            path
        } else {
            &resolved.path
        };
        let exe = exe_basename(src);
        if exe.is_empty() {
            return Err("No program selected".into());
        }
        let mut g = self.inner.lock().map_err(|_| "lock".to_string())?;
        g.cfg
            .rules
            .retain(|r| !exe_basename(&r.exe).eq_ignore_ascii_case(&exe));
        g.cfg.rules.push(SwitchRule { exe, profile });
        g.cfg.enabled = true;
        g.rt.reset_seen();
        Self::persist(&self.file, &g.cfg)?;
        Ok(g.cfg.clone())
    }

    pub fn remove_program(&self, exe: &str) -> Result<SwitchConfig, String> {
        let exe = exe_basename(exe);
        let mut g = self.inner.lock().map_err(|_| "lock".to_string())?;
        g.cfg
            .rules
            .retain(|r| !exe_basename(&r.exe).eq_ignore_ascii_case(&exe));
        g.rt.reset_seen();
        Self::persist(&self.file, &g.cfg)?;
        Ok(g.cfg.clone())
    }

    pub fn shift_after_delete(&self, idx: u8) -> Result<(), String> {
        let mut g = self.inner.lock().map_err(|_| "lock".to_string())?;
        let mut next = Vec::new();
        for mut r in g.cfg.rules.drain(..) {
            if r.profile == idx {
                continue;
            }
            if r.profile > idx {
                r.profile -= 1;
            }
            next.push(r);
        }
        g.cfg.rules = next;
        g.rt.reset_seen();
        Self::persist(&self.file, &g.cfg)
    }

    /// Poll foreground exe; HID only when a new stable window needs a profile change.
    pub fn tick(&self, pad: &Pad, app: &AppHandle) {
        let path = focus::foreground_exe().unwrap_or_default();
        let exe = exe_basename(&path);
        let now = Instant::now();

        let mut emit: Option<FocusEvt> = None;
        let pending_apply: Option<String> = {
            let Ok(mut g) = self.inner.lock() else {
                return;
            };
            if exe != g.rt.pending_exe {
                g.rt.pending_exe = exe.clone();
                g.rt.pending_at = now;
                return;
            }
            if now.saturating_duration_since(g.rt.pending_at) < DEBOUNCE {
                return;
            }
            if exe != g.rt.last_emitted {
                g.rt.last_emitted = exe.clone();
                emit = Some(FocusEvt {
                    exe: exe.clone(),
                    profile: if g.cfg.enabled {
                        match_profile(&g.cfg.rules, &exe)
                    } else {
                        None
                    },
                });
            }
            if exe == g.rt.last_seen_exe {
                None
            } else {
                Some(exe)
            }
        };

        if let Some(evt) = emit {
            let _ = app.emit("switch-focus", evt);
        }

        let Some(stable) = pending_apply else {
            return;
        };
        if !crate::host::is_present() {
            return;
        }
        if !pad.connected() {
            return;
        }
        let Ok(meta) = pad.get_meta() else {
            return;
        };
        if meta.in_menu {
            return;
        }
        let n = if meta.n_profiles == 0 {
            4
        } else {
            meta.n_profiles
        };
        let want = {
            let Ok(mut g) = self.inner.lock() else {
                return;
            };
            decide(&mut g, &stable, meta.active, n)
        };
        match want {
            Decision::Nop => {
                if let Ok(mut g) = self.inner.lock() {
                    g.rt.last_seen_exe = stable;
                }
            }
            Decision::ClearBaseline => {
                if let Ok(mut g) = self.inner.lock() {
                    g.rt.last_seen_exe = stable;
                    g.rt.baseline = None;
                    g.rt.last_applied = None;
                }
            }
            Decision::Set(p) | Decision::Restore(p) => {
                if pad.set_active(p).is_ok() {
                    if let Ok(mut g) = self.inner.lock() {
                        g.rt.last_seen_exe = stable;
                        if matches!(want, Decision::Restore(_)) {
                            g.rt.baseline = None;
                            g.rt.last_applied = None;
                        } else {
                            g.rt.last_applied = Some(p);
                        }
                    }
                    let _ = app.emit("active-profile", ActiveEvt { profile: p });
                }
            }
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Decision {
    Nop,
    Set(u8),
    Restore(u8),
    ClearBaseline,
}

fn decide(g: &mut Inner, exe: &str, current: u8, n_profiles: u8) -> Decision {
    let matched = if g.cfg.enabled {
        match_profile(&g.cfg.rules, exe).filter(|&p| p < n_profiles)
    } else {
        None
    };
    match matched {
        Some(target) => enter(&mut g.rt, current, target),
        None => leave(&g.rt, current),
    }
}

fn enter(rt: &mut Runtime, current: u8, target: u8) -> Decision {
    if rt.baseline.is_none() {
        rt.baseline = Some(current);
    }
    if current != target {
        Decision::Set(target)
    } else {
        rt.last_applied = Some(target);
        Decision::Nop
    }
}

fn leave(rt: &Runtime, current: u8) -> Decision {
    let Some(baseline) = rt.baseline else {
        return Decision::Nop;
    };
    if rt.last_applied == Some(current) && current != baseline {
        Decision::Restore(baseline)
    } else {
        Decision::ClearBaseline
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn basename_strips_path() {
        assert_eq!(exe_basename(r"C:\CAD\SLDWORKS.exe"), "SLDWORKS.exe");
        assert_eq!(exe_basename("chrome.exe"), "chrome.exe");
    }

    #[test]
    fn match_is_case_insensitive() {
        let rules = vec![SwitchRule {
            exe: "SLDWORKS.exe".into(),
            profile: 2,
        }];
        assert_eq!(match_profile(&rules, "sldworks.exe"), Some(2));
        assert_eq!(
            match_profile(&rules, r"C:\Program Files\SOLIDWORKS\SLDWORKS.EXE"),
            Some(2)
        );
        assert_eq!(match_profile(&rules, "chrome.exe"), None);
    }

    fn rt() -> Runtime {
        Runtime::new()
    }

    #[test]
    fn first_mapped_snapshots_baseline() {
        let mut r = rt();
        assert_eq!(enter(&mut r, 0, 2), Decision::Set(2));
        assert_eq!(r.baseline, Some(0));
        r.last_applied = Some(2);
        assert_eq!(enter(&mut r, 2, 1), Decision::Set(1));
        assert_eq!(r.baseline, Some(0));
    }

    #[test]
    fn leave_restores_when_still_on_applied() {
        let mut r = rt();
        assert_eq!(enter(&mut r, 0, 2), Decision::Set(2));
        r.last_applied = Some(2);
        assert_eq!(leave(&r, 2), Decision::Restore(0));
        assert_eq!(r.baseline, Some(0));
    }

    #[test]
    fn leave_keeps_user_override() {
        let mut r = rt();
        assert_eq!(enter(&mut r, 0, 2), Decision::Set(2));
        r.last_applied = Some(2);
        assert_eq!(leave(&r, 1), Decision::ClearBaseline);
    }

    #[test]
    fn already_on_target_marks_applied() {
        let mut r = rt();
        assert_eq!(enter(&mut r, 2, 2), Decision::Nop);
        assert_eq!(r.last_applied, Some(2));
        assert_eq!(r.baseline, Some(2));
        assert_eq!(leave(&r, 2), Decision::ClearBaseline);
    }
}
