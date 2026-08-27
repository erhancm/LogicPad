use crate::focus;
use crate::hid::Pad;
use crate::launch;
use crate::switch_graph::{
    self, eval_graph, flatten_graph, graph_from_rules, GraphDecision, SwitchGraph,
};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

pub use switch_graph::exe_basename;
use switch_graph::exe_stem;

const DEBOUNCE: Duration = Duration::from_millis(400);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SwitchRule {
    pub exe: String,
    pub profile: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SwitchConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub rules: Vec<SwitchRule>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub graph: Option<SwitchGraph>,
}

impl Default for SwitchConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            rules: Vec::new(),
            graph: Some(switch_graph::default_graph()),
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

fn match_profile(cfg: &SwitchConfig, exe: &str, running: &[String]) -> Option<u8> {
    if let Some(graph) = &cfg.graph {
        return match eval_graph(graph, exe, running) {
            GraphDecision::Set(p) => Some(p),
            GraphDecision::Restore | GraphDecision::Miss => None,
        };
    }
    let needle = exe_stem(exe);
    if needle.is_empty() {
        return None;
    }
    cfg.rules
        .iter()
        .find(|r| exe_stem(&r.exe) == needle)
        .map(|r| r.profile)
}

fn running_exes() -> Vec<String> {
    focus::list_running_exes()
}

fn normalize_config(mut cfg: SwitchConfig) -> SwitchConfig {
    if cfg.graph.is_none() {
        let pairs: Vec<(String, u8)> = cfg
            .rules
            .iter()
            .map(|r| (exe_basename(&r.exe), r.profile))
            .filter(|(exe, _)| !exe.is_empty())
            .collect();
        cfg.graph = Some(if pairs.is_empty() {
            switch_graph::default_graph()
        } else {
            graph_from_rules(&pairs)
        });
    }
    if let Some(graph) = cfg.graph.as_mut() {
        switch_graph::sanitize(graph);
        cfg.rules = flatten_graph(graph)
            .into_iter()
            .map(|(exe, profile)| SwitchRule { exe, profile })
            .collect();
    } else {
        cfg.rules.retain(|r| !exe_basename(&r.exe).is_empty());
        for r in &mut cfg.rules {
            r.exe = exe_basename(&r.exe);
        }
    }
    cfg
}

impl SwitchStore {
    pub fn load(file: PathBuf) -> Self {
        let mut cfg = SwitchConfig::default();
        if let Ok(raw) = fs::read_to_string(&file) {
            if let Ok(parsed) = serde_json::from_str::<SwitchConfig>(&raw) {
                cfg = parsed;
            }
        }
        cfg = normalize_config(cfg);
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
            .map(|g| {
                g.cfg.enabled
                    && (!g.cfg.rules.is_empty()
                        || g.cfg.graph.as_ref().is_some_and(|gr| {
                            gr.nodes
                                .iter()
                                .any(|n| matches!(n, switch_graph::GraphNode::SetProfile { .. }))
                        }))
            })
            .unwrap_or(false)
    }

    pub fn reset_seen(&self) {
        if let Ok(mut g) = self.inner.lock() {
            g.rt.reset_seen();
        }
    }

    pub fn set_config(&self, cfg: SwitchConfig) -> Result<SwitchConfig, String> {
        let cfg = normalize_config(cfg);
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
        let mut graph = g.cfg.graph.take().unwrap_or_else(switch_graph::default_graph);
        switch_graph::add_program(&mut graph, profile, &exe);
        g.cfg.graph = Some(graph);
        g.cfg = normalize_config(g.cfg.clone());
        g.cfg.enabled = true;
        g.rt.reset_seen();
        Self::persist(&self.file, &g.cfg)?;
        Ok(g.cfg.clone())
    }

    pub fn remove_program(&self, exe: &str) -> Result<SwitchConfig, String> {
        let exe = exe_basename(exe);
        let mut g = self.inner.lock().map_err(|_| "lock".to_string())?;
        if let Some(graph) = g.cfg.graph.as_mut() {
            switch_graph::remove_program(graph, &exe);
        }
        g.cfg = normalize_config(g.cfg.clone());
        g.rt.reset_seen();
        Self::persist(&self.file, &g.cfg)?;
        Ok(g.cfg.clone())
    }

    pub fn shift_after_delete(&self, idx: u8) -> Result<(), String> {
        let mut g = self.inner.lock().map_err(|_| "lock".to_string())?;
        if let Some(graph) = g.cfg.graph.as_mut() {
            switch_graph::shift_after_delete(graph, idx);
        }
        g.cfg
            .rules
            .retain(|r| r.profile != idx);
        for r in &mut g.cfg.rules {
            if r.profile > idx {
                r.profile -= 1;
            }
        }
        g.cfg = normalize_config(g.cfg.clone());
        g.rt.reset_seen();
        Self::persist(&self.file, &g.cfg)
    }

    /// Watch focus without touching HID. Safe to call without the pad lock.
    /// Returns `(exe, running)` when a stable focus change still needs `apply`.
    pub fn poll(&self, app: &AppHandle) -> Option<(String, Vec<String>)> {
        let path = focus::foreground_exe().unwrap_or_default();
        let exe = exe_basename(&path);
        let now = Instant::now();

        let (emit, apply, enabled, need_running) = {
            let Ok(mut g) = self.inner.lock() else {
                return None;
            };
            if exe != g.rt.pending_exe {
                g.rt.pending_exe = exe.clone();
                g.rt.pending_at = now;
                return None;
            }
            if now.saturating_duration_since(g.rt.pending_at) < DEBOUNCE {
                return None;
            }
            let emit = exe != g.rt.last_emitted;
            if emit {
                g.rt.last_emitted = exe.clone();
            }
            let enabled = g.cfg.enabled;
            let need_running = enabled
                && g.cfg
                    .graph
                    .as_ref()
                    .is_some_and(switch_graph::uses_running);
            (emit, exe != g.rt.last_seen_exe, enabled, need_running)
        };

        if !emit && !apply {
            return None;
        }

        let running = if need_running {
            running_exes()
        } else {
            Vec::new()
        };

        if emit {
            let profile = if enabled {
                self.inner
                    .lock()
                    .ok()
                    .and_then(|g| match_profile(&g.cfg, &exe, &running))
            } else {
                None
            };
            let _ = app.emit(
                "switch-focus",
                FocusEvt {
                    exe: exe.clone(),
                    profile,
                },
            );
        }

        apply.then_some((exe, running))
    }

    /// HID half of a focus change. Call with the pad lock held.
    pub fn apply(&self, pad: &Pad, app: &AppHandle, stable: String, running: Vec<String>) {
        if !crate::host::is_present() {
            return;
        }
        if !pad.connected() {
            return;
        }
        let Ok(meta) = pad.get_meta() else {
            return;
        };
        let n = if meta.n_profiles == 0 {
            4
        } else {
            meta.n_profiles
        };
        let want = {
            let Ok(mut g) = self.inner.lock() else {
                return;
            };
            decide(&mut g, &stable, &running, meta.active, n)
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

fn decide(g: &mut Inner, exe: &str, running: &[String], current: u8, n_profiles: u8) -> Decision {
    let matched = if g.cfg.enabled {
        match_profile(&g.cfg, exe, running).filter(|&p| p < n_profiles)
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
        let cfg = normalize_config(SwitchConfig {
            enabled: true,
            rules: vec![SwitchRule {
                exe: "SLDWORKS.exe".into(),
                profile: 2,
            }],
            graph: None,
        });
        let none: [String; 0] = [];
        assert_eq!(match_profile(&cfg, "sldworks.exe", &none), Some(2));
        assert_eq!(
            match_profile(
                &cfg,
                r"C:\Program Files\SOLIDWORKS\SLDWORKS.EXE",
                &none
            ),
            Some(2)
        );
        assert_eq!(match_profile(&cfg, "chrome.exe", &none), None);
        assert_eq!(match_profile(&cfg, "SLDWORKS", &none), Some(2));
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
