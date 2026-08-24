use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;

#[cfg(windows)]
use std::os::windows::ffi::OsStrExt;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchEntry {
    pub profile: u8,
    pub key: u8,
    pub path: String,
    pub args: String,
    #[serde(default)]
    pub slot: u8,
}

#[derive(Default, Serialize, Deserialize)]
struct LaunchFile {
    entries: Vec<LaunchEntry>,
}

pub struct LaunchStore {
    file: PathBuf,
    map: Mutex<HashMap<(u8, u8), LaunchEntry>>,
}

impl LaunchStore {
    pub fn load(file: PathBuf) -> Self {
        let mut map = HashMap::new();
        if let Ok(raw) = fs::read_to_string(&file) {
            if let Ok(parsed) = serde_json::from_str::<LaunchFile>(&raw) {
                for e in parsed.entries {
                    map.insert((e.profile, e.key), e);
                }
            }
        }
        Self {
            file,
            map: Mutex::new(map),
        }
    }

    fn persist(&self, map: &HashMap<(u8, u8), LaunchEntry>) -> Result<(), String> {
        if let Some(dir) = self.file.parent() {
            fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let file = LaunchFile {
            entries: map.values().cloned().collect(),
        };
        fs::write(&self.file, serde_json::to_string_pretty(&file).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())
    }

    pub fn list(&self) -> Vec<LaunchEntry> {
        self.map
            .lock()
            .map(|g| g.values().cloned().collect())
            .unwrap_or_default()
    }

    pub fn has_launches(&self) -> bool {
        self.map
            .lock()
            .map(|g| g.values().any(|e| !e.path.trim().is_empty()))
            .unwrap_or(false)
    }

    pub fn set(&self, entry: LaunchEntry) -> Result<(), String> {
        let mut g = self.map.lock().map_err(|_| "lock".to_string())?;
        if entry.path.trim().is_empty() {
            g.remove(&(entry.profile, entry.key));
        } else {
            g.insert((entry.profile, entry.key), entry);
        }
        self.persist(&g)
    }

    pub fn shift_after_delete(&self, idx: u8) -> Result<(), String> {
        let mut g = self.map.lock().map_err(|_| "lock".to_string())?;
        let mut next = HashMap::new();
        for ((p, k), e) in g.drain() {
            if p == idx {
                continue;
            }
            let np = if p > idx { p - 1 } else { p };
            let mut e = e;
            e.profile = np;
            next.insert((np, k), e);
        }
        *g = next;
        self.persist(&g)
    }

    pub fn launch(&self, profile: u8, key: u8) -> Result<(), String> {
        let g = self.map.lock().map_err(|_| "lock".to_string())?;
        let Some(e) = g.get(&(profile, key)) else {
            return Ok(());
        };
        let resolved = resolve_program(&e.path);
        let path = if Path::new(&resolved.path).exists() {
            &resolved.path
        } else {
            &e.path
        };
        let args = if e.args.trim().is_empty() {
            &resolved.args
        } else {
            &e.args
        };
        spawn(path, args)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedProgram {
    pub path: String,
    pub args: String,
}

pub fn pick_program() -> Option<String> {
    rfd::FileDialog::new()
        .add_filter("Programs", &["exe", "bat", "cmd", "lnk", "com"])
        .add_filter("All files", &["*"])
        .pick_file()
        .map(|p| p.to_string_lossy().into_owned())
}

pub fn resolve_program(path: &str) -> ResolvedProgram {
    let path = path.trim();
    if path.is_empty() {
        return ResolvedProgram {
            path: String::new(),
            args: String::new(),
        };
    }
    #[cfg(windows)]
    if is_lnk(path) {
        if let Some((target, args)) = resolve_lnk(Path::new(path)) {
            return ResolvedProgram { path: target, args };
        }
    }
    ResolvedProgram {
        path: path.to_string(),
        args: String::new(),
    }
}

fn is_lnk(path: &str) -> bool {
    Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("lnk"))
}

#[cfg(windows)]
fn from_wide(buf: &[u16]) -> String {
    let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    String::from_utf16_lossy(&buf[..len])
}

#[cfg(windows)]
fn to_wide(path: &Path) -> Vec<u16> {
    path.as_os_str().encode_wide().chain(Some(0)).collect()
}

/// Resolve a `.lnk` via `IShellLink` on a dedicated STA thread.
#[cfg(windows)]
fn resolve_lnk(path: &Path) -> Option<(String, String)> {
    let path = path.to_path_buf();
    std::thread::scope(|s| s.spawn(|| resolve_lnk_sta(&path)).join().ok().flatten())
}

#[cfg(windows)]
fn resolve_lnk_sta(path: &Path) -> Option<(String, String)> {
    use windows::core::{Interface, PCWSTR};
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
        COINIT_APARTMENTTHREADED, IPersistFile, STGM_READ,
    };
    use windows::Win32::UI::Shell::{IShellLinkW, ShellLink, SLR_NO_UI};

    let wide = to_wide(path);
    unsafe {
        let initialized = CoInitializeEx(None, COINIT_APARTMENTTHREADED).is_ok();
        let result = (|| {
            let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER).ok()?;
            let persist: IPersistFile = link.cast().ok()?;
            persist.Load(PCWSTR(wide.as_ptr()), STGM_READ).ok()?;
            let _ = link.Resolve(HWND::default(), SLR_NO_UI.0 as u32);
            let mut target = [0u16; 1024];
            link.GetPath(&mut target, std::ptr::null_mut(), 0)
                .ok()?;
            let target = from_wide(&target);
            if target.is_empty() {
                return None;
            }
            let mut args = [0u16; 1024];
            let args = if link.GetArguments(&mut args).is_ok() {
                from_wide(&args)
            } else {
                String::new()
            };
            Some((target, args))
        })();
        if initialized {
            CoUninitialize();
        }
        result
    }
}

fn spawn(path: &str, args: &str) -> Result<(), String> {
    let path = path.trim();
    if path.is_empty() {
        return Ok(());
    }
    if !Path::new(path).exists() {
        return Err(format!("not found: {path}"));
    }
    #[cfg(target_os = "windows")]
    {
        let mut cmd = Command::new("cmd");
        cmd.arg("/C").arg("start").arg("").arg(path);
        for a in args.split_whitespace() {
            cmd.arg(a);
        }
        cmd.spawn().map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(target_os = "macos")]
    {
        let mut cmd = Command::new("open");
        cmd.arg(path);
        if !args.trim().is_empty() {
            cmd.arg("--args");
            for a in args.split_whitespace() {
                cmd.arg(a);
            }
        }
        cmd.spawn().map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let mut cmd = Command::new(path);
        for a in args.split_whitespace() {
            cmd.arg(a);
        }
        cmd.spawn().map_err(|e| e.to_string())?;
        Ok(())
    }
}
