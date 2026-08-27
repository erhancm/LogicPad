//! In-memory LogicPad used when no USB pad is selected.
//! Speaks the same editor API as firmware protocol 1.5 (packed store).

use crate::hid::{
    Action, Meta, PadError, PadKey, ProfileHdr, Snapshot, TextPool, LABEL_HID, TEXT_MAX, TEXT_POOL,
    TITLE_MAX,
};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

pub const SIM_ID: &str = "sim";
pub const SIM_LABEL: &str = "Simulated LogicPad";
const PROTO_MAJ: u8 = 0x01;
const PROTO_MIN: u8 = 0x05;
const STORE_CAP: u16 = 4076;
const HDR: u16 = 16;
const EMPTY_ADD: u16 = 16;
const MAX_PROFILES: u8 = 255;
const MAX_ACTS: usize = 12;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SimKey {
    #[serde(default)]
    label: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    led: u8,
    #[serde(default)]
    acts: Vec<Action>,
    #[serde(default)]
    text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SimProfile {
    name: String,
    light_mode: u8,
    bright: u8,
    dim: u8,
    keys: Vec<SimKey>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Inner {
    active: u8,
    contrast: u8,
    flip: u8,
    sleep: u8,
    dirty: bool,
    profiles: Vec<SimProfile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SimFile {
    version: u8,
    #[serde(flatten)]
    inner: Inner,
}

pub struct SimPad {
    path: PathBuf,
    live: Inner,
    saved: Inner,
}

impl SimPad {
    pub fn new() -> Self {
        let inner = factory_inner();
        Self {
            path: PathBuf::new(),
            live: inner.clone(),
            saved: inner,
        }
    }

    pub fn set_path(&mut self, path: PathBuf) {
        self.path = path;
        if let Some(inner) = load_file(&self.path) {
            self.live = inner.clone();
            self.saved = inner;
        }
    }

    pub fn ping() -> (u8, u8) {
        (PROTO_MAJ, PROTO_MIN)
    }

    pub fn meta(&self) -> Meta {
        let used = store_used(&self.live);
        Meta {
            active: self.live.active.min(self.live.profiles.len().saturating_sub(1) as u8),
            dirty: self.live.dirty,
            contrast: self.live.contrast,
            flip: self.live.flip,
            sleep: self.live.sleep,
            in_menu: false,
            usb: true,
            n_profiles: self.live.profiles.len() as u8,
            store_used: used,
            store_cap: STORE_CAP,
        }
    }

    pub fn snapshot(&self) -> Snapshot {
        let meta = self.meta();
        let n = self.live.profiles.len();
        let mut profiles = Vec::with_capacity(n);
        let mut keys = Vec::with_capacity(n);
        let mut text_used = 0u16;
        for (i, p) in self.live.profiles.iter().enumerate() {
            profiles.push(ProfileHdr {
                index: i as u8,
                name: p.name.clone(),
                light_mode: p.light_mode,
                bright: p.bright,
                dim: p.dim,
            });
            let mut row = Vec::with_capacity(9);
            for (k, key) in p.keys.iter().enumerate().take(9) {
                text_used = text_used.saturating_add(key.text.len() as u16);
                let title = ascii12(&key.title);
                row.push(PadKey {
                    profile: i as u8,
                    index: k as u8,
                    label: if title.is_empty() {
                        ascii_label(&key.label)
                    } else {
                        title.clone()
                    },
                    led: key.led,
                    acts: key.acts.clone(),
                    text: key.text.clone(),
                });
            }
            while row.len() < 9 {
                let i8 = row.len() as u8;
                row.push(empty_pad_key(i as u8, i8));
            }
            keys.push(row);
        }
        let n8 = n as u8;
        Snapshot {
            meta,
            profiles,
            keys,
            text_pool: TextPool {
                enabled: true,
                used: text_used,
                max: STORE_CAP
                    .saturating_sub(meta.store_used)
                    .saturating_add(text_used)
                    .max(TEXT_POOL),
            },
            can_mutate_profiles: true,
            can_titles: true,
            can_add_profiles: n8 < MAX_PROFILES
                && STORE_CAP.saturating_sub(meta.store_used) >= EMPTY_ADD,
        }
    }

    pub fn get_profile(&self, idx: u8) -> Result<ProfileHdr, PadError> {
        let p = self.profile(idx)?;
        Ok(ProfileHdr {
            index: idx,
            name: p.name.clone(),
            light_mode: p.light_mode,
            bright: p.bright,
            dim: p.dim,
        })
    }

    pub fn set_profile(&mut self, hdr: &ProfileHdr) -> Result<(), PadError> {
        let p = self.profile_mut(hdr.index)?;
        p.name = ascii12(&hdr.name);
        p.light_mode = hdr.light_mode.min(14);
        p.bright = hdr.bright.min(10);
        p.dim = hdr.dim.min(10);
        self.live.dirty = true;
        Ok(())
    }

    pub fn set_key(&mut self, key: &PadKey) -> Result<(), PadError> {
        if key.text.len() > TEXT_MAX {
            return Err(PadError::Msg(
                "Text is too long for one key (240 bytes).".into(),
            ));
        }
        let trial = {
            let mut next = self.live.clone();
            apply_key(&mut next, key)?;
            next
        };
        if store_used(&trial) > STORE_CAP {
            return Err(PadError::Msg(
                "The pad is out of memory. Delete a profile or shorten a macro.".into(),
            ));
        }
        self.live = trial;
        self.live.dirty = true;
        Ok(())
    }

    pub fn set_active(&mut self, profile: u8) -> Result<(), PadError> {
        if (profile as usize) >= self.live.profiles.len() {
            return Err(PadError::Msg("No such profile.".into()));
        }
        self.live.active = profile;
        Ok(())
    }

    pub fn add_profile(&mut self) -> Result<u8, PadError> {
        let n = self.live.profiles.len();
        if n >= MAX_PROFILES as usize || store_used(&self.live).saturating_add(EMPTY_ADD) > STORE_CAP
        {
            return Err(PadError::Msg(
                "The pad is out of memory. Delete a profile or shorten macros / text.".into(),
            ));
        }
        let idx = n as u8;
        self.live.profiles.push(empty_profile(idx));
        self.live.dirty = true;
        Ok(idx)
    }

    pub fn del_profile(&mut self, idx: u8) -> Result<u8, PadError> {
        let n = self.live.profiles.len();
        if n <= 1 {
            return Err(PadError::Msg("Keep at least one profile.".into()));
        }
        if (idx as usize) >= n {
            return Err(PadError::Msg("No such profile.".into()));
        }
        self.live.profiles.remove(idx as usize);
        if self.live.active == idx {
            self.live.active = if (idx as usize) < self.live.profiles.len() {
                idx
            } else {
                (self.live.profiles.len() - 1) as u8
            };
        } else if self.live.active > idx {
            self.live.active -= 1;
        }
        self.live.dirty = true;
        Ok(self.live.active)
    }

    pub fn save(&mut self) -> Result<(), PadError> {
        self.live.dirty = false;
        self.saved = self.live.clone();
        persist(&self.path, &self.saved)
    }

    pub fn reload(&mut self) -> Result<(), PadError> {
        self.live = self.saved.clone();
        self.live.dirty = false;
        Ok(())
    }

    pub fn factory(&mut self) -> Result<(), PadError> {
        let inner = factory_inner();
        self.live = inner.clone();
        self.saved = inner;
        persist(&self.path, &self.saved)
    }

    fn profile(&self, idx: u8) -> Result<&SimProfile, PadError> {
        self.live
            .profiles
            .get(idx as usize)
            .ok_or_else(|| PadError::Msg("No such profile.".into()))
    }

    fn profile_mut(&mut self, idx: u8) -> Result<&mut SimProfile, PadError> {
        self.live
            .profiles
            .get_mut(idx as usize)
            .ok_or_else(|| PadError::Msg("No such profile.".into()))
    }
}

fn apply_key(inner: &mut Inner, key: &PadKey) -> Result<(), PadError> {
    let p = inner
        .profiles
        .get_mut(key.profile as usize)
        .ok_or_else(|| PadError::Msg("No such profile.".into()))?;
    if key.index > 8 {
        return Err(PadError::Msg("No such key.".into()));
    }
    while p.keys.len() < 9 {
        p.keys.push(SimKey::empty());
    }
    let slot = &mut p.keys[key.index as usize];
    let title = ascii12(&key.label);
    slot.title = title.clone();
    slot.label = ascii_label(&title);
    slot.led = key.led;
    slot.acts = key.acts.iter().cloned().take(MAX_ACTS).collect();
    slot.text = key.text.clone();
    if slot.text.len() > TEXT_MAX {
        slot.text.truncate(TEXT_MAX);
    }
    Ok(())
}

fn persist(path: &Path, inner: &Inner) -> Result<(), PadError> {
    if path.as_os_str().is_empty() {
        return Ok(());
    }
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| PadError::Msg(e.to_string()))?;
    }
    let file = SimFile {
        version: 1,
        inner: inner.clone(),
    };
    let text = serde_json::to_string_pretty(&file).map_err(|e| PadError::Msg(e.to_string()))?;
    fs::write(path, text).map_err(|e| PadError::Msg(e.to_string()))
}

fn load_file(path: &Path) -> Option<Inner> {
    let text = fs::read_to_string(path).ok()?;
    let file: SimFile = serde_json::from_str(&text).ok()?;
    if file.inner.profiles.is_empty() {
        return None;
    }
    Some(file.inner)
}

fn factory_inner() -> Inner {
    Inner {
        active: 0,
        contrast: 7,
        flip: 0,
        sleep: 3,
        dirty: false,
        profiles: (0..4).map(empty_profile).collect(),
    }
}

fn empty_profile(idx: u8) -> SimProfile {
    SimProfile {
        name: profile_name(idx),
        light_mode: 1,
        bright: 6,
        dim: 2,
        keys: (0..9).map(|_| SimKey::empty()).collect(),
    }
}

impl SimKey {
    fn empty() -> Self {
        Self {
            label: String::new(),
            title: String::new(),
            led: 0,
            acts: Vec::new(),
            text: String::new(),
        }
    }
}

fn empty_pad_key(profile: u8, index: u8) -> PadKey {
    PadKey {
        profile,
        index,
        label: String::new(),
        led: 0,
        acts: Vec::new(),
        text: String::new(),
    }
}

fn profile_name(idx: u8) -> String {
    format!("P{}", idx as u16 + 1)
}

fn key_empty(k: &SimKey) -> bool {
    k.led == 0 && k.acts.is_empty() && k.title.is_empty() && k.label.is_empty() && k.text.is_empty()
}

fn store_used(inner: &Inner) -> u16 {
    let mut n = HDR as u32;
    for p in &inner.profiles {
        n += EMPTY_ADD as u32;
        n += p.name.len().min(12) as u32;
        for k in &p.keys {
            if !key_empty(k) {
                n += 8 + (k.acts.len() as u32 * 4) + k.title.len() as u32 + k.label.len() as u32;
            }
            n += k.text.len() as u32;
        }
    }
    n.min(STORE_CAP as u32) as u16
}

fn ascii12(s: &str) -> String {
    s.bytes()
        .filter(|b| (32..=126).contains(b))
        .take(TITLE_MAX)
        .map(|b| b as char)
        .collect()
}

fn ascii_label(s: &str) -> String {
    s.bytes()
        .filter(|b| *b != b' ' && (32..=126).contains(b))
        .take(LABEL_HID)
        .map(|b| b as char)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn factory_has_four_empty_profiles() {
        let s = SimPad::new();
        let snap = s.snapshot();
        assert_eq!(snap.profiles.len(), 4);
        assert_eq!(snap.profiles[0].name, "P1");
        assert!(snap.keys.iter().all(|row| row.iter().all(|k| k.acts.is_empty())));
        assert!(snap.can_add_profiles);
        assert!(snap.can_titles);
    }
}
