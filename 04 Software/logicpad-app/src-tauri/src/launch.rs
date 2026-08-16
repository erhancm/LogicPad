use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchEntry {
    pub profile: u8,
    pub key: u8,
    pub path: String,
    pub args: String,
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

    pub fn set(&self, entry: LaunchEntry) -> Result<(), String> {
        let mut g = self.map.lock().map_err(|_| "lock".to_string())?;
        if entry.path.trim().is_empty() {
            g.remove(&(entry.profile, entry.key));
        } else {
            g.insert((entry.profile, entry.key), entry);
        }
        self.persist(&g)
    }

    pub fn launch(&self, profile: u8, key: u8) -> Result<(), String> {
        let g = self.map.lock().map_err(|_| "lock".to_string())?;
        let Some(e) = g.get(&(profile, key)) else {
            return Ok(());
        };
        spawn(&e.path, &e.args)
    }
}

pub fn pick_program() -> Option<String> {
    rfd::FileDialog::new()
        .add_filter("Programs", &["exe", "bat", "cmd", "lnk", "com"])
        .add_filter("All files", &["*"])
        .pick_file()
        .map(|p| p.to_string_lossy().into_owned())
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
