use crate::sim::{SimPad, SIM_ID, SIM_LABEL};
use hidapi::{HidApi, HidDevice};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, VecDeque};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

pub const VID: u16 = 0x0483;
pub const PID: u16 = 0x5750;
pub const PID_BOOT: u16 = 0x5751;
const USAGE_PAGE_VENDOR: u16 = 0xFF00;
#[cfg(windows)]
const USAGE_PAGE_DESKTOP: u16 = 0x01;
#[cfg(windows)]
const USAGE_PAGE_CONSUMER: u16 = 0x0C;
const REPORT_ID: u8 = 4;
const REPORT_LEN: usize = 64;
const KEY_BYTES: usize = 60;
const MAX_ACTS: usize = 12;

const CMD_PING: u8 = 0x01;
const CMD_GET_META: u8 = 0x02;
const CMD_GET_KEY: u8 = 0x03;
const CMD_SET_KEY: u8 = 0x04;
const CMD_SET_ACTIVE: u8 = 0x05;
const CMD_SAVE: u8 = 0x06;
const CMD_RELOAD: u8 = 0x07;
const CMD_FACTORY: u8 = 0x08;
const CMD_GET_PROFILE_HDR: u8 = 0x09;
const CMD_SET_PROFILE_HDR: u8 = 0x0A;
const CMD_ENTER_BOOTLOADER: u8 = 0x0C;
const CMD_KEY_EVENT: u8 = 0x0D;
const CMD_SET_TIME: u8 = 0x0E;
const CMD_GET_TEXT: u8 = 0x0F;
const CMD_SET_TEXT: u8 = 0x10;
const CMD_ADD_PROFILE: u8 = 0x11;
const CMD_DEL_PROFILE: u8 = 0x12;
const CMD_GET_TITLE: u8 = 0x13;
const CMD_SET_TITLE: u8 = 0x14;
const CMD_SET_HOST: u8 = 0x15;
const CMD_SET_SCREEN: u8 = 0x16;
const CMD_GET_LEDS: u8 = 0x17;
const CMD_BL_START: u8 = 0x40;
const CMD_BL_DATA: u8 = 0x41;
const CMD_BL_FINISH: u8 = 0x42;
const APP_MAX: usize = 52 * 1024;
pub const TEXT_POOL: u16 = 1200;
pub const TEXT_MAX: usize = 240;
const TEXT_SET_CHUNK: usize = 58;
const TEXT_GET_CHUNK: usize = 56;
pub const TITLE_MAX: usize = 12;
pub const LABEL_HID: usize = 6;

#[derive(Debug, thiserror::Error)]
pub enum PadError {
    #[error("{0}")]
    Msg(String),
}

impl From<PadError> for String {
    fn from(e: PadError) -> Self {
        e.to_string()
    }
}

pub type KeyCallback = Arc<dyn Fn(u8, u8, bool) + Send + Sync>;
pub type LedCallback = Arc<dyn Fn(LedFrame) + Send + Sync>;

enum HidReq {
    Rpc {
        cmd: u8,
        payload: Vec<u8>,
        timeout_ms: u32,
        tx: Sender<Result<Vec<u8>, PadError>>,
    },
    Stop,
}

enum Pending {
    Rpc {
        cmd: u8,
        deadline: Instant,
        tx: Sender<Result<Vec<u8>, PadError>>,
    },
    Leds {
        deadline: Instant,
    },
}

pub struct Pad {
    api: Mutex<HidApi>,
    tx: Mutex<Option<Sender<HidReq>>>,
    worker: Mutex<Option<JoinHandle<()>>>,
    on_key: Mutex<Option<KeyCallback>>,
    on_leds: Mutex<Option<LedCallback>>,
    has_text: Mutex<bool>,
    has_titles: Mutex<bool>,
    has_host: Mutex<bool>,
    sim: Mutex<SimPad>,
    current_id: Mutex<String>,
    user_pick: Mutex<bool>,
    last_path: Mutex<PathBuf>,
    flashing: Mutex<bool>,
    led_watch: Arc<AtomicBool>,
    led_last: Arc<Mutex<Option<LedFrame>>>,
}

impl Pad {
    pub fn new() -> Result<Self, PadError> {
        let api = HidApi::new().map_err(|e| PadError::Msg(e.to_string()))?;
        Ok(Self {
            api: Mutex::new(api),
            tx: Mutex::new(None),
            worker: Mutex::new(None),
            on_key: Mutex::new(None),
            on_leds: Mutex::new(None),
            has_text: Mutex::new(false),
            has_titles: Mutex::new(false),
            has_host: Mutex::new(false),
            sim: Mutex::new(SimPad::new()),
            current_id: Mutex::new(String::new()),
            user_pick: Mutex::new(false),
            last_path: Mutex::new(PathBuf::new()),
            flashing: Mutex::new(false),
            led_watch: Arc::new(AtomicBool::new(false)),
            led_last: Arc::new(Mutex::new(None)),
        })
    }

    pub fn set_config_dir(&self, dir: &Path) {
        if let Ok(mut sim) = self.sim.lock() {
            sim.set_path(dir.join("simulated-pad.json"));
        }
        if let Ok(mut p) = self.last_path.lock() {
            *p = dir.join("last-pad.txt");
        }
    }

    pub fn set_on_key(&self, cb: KeyCallback) {
        if let Ok(mut g) = self.on_key.lock() {
            *g = Some(cb);
        }
    }

    pub fn set_on_leds(&self, cb: LedCallback) {
        if let Ok(mut g) = self.on_leds.lock() {
            *g = Some(cb);
        }
    }

    pub fn connected(&self) -> bool {
        if self.is_simulated() {
            return true;
        }
        self.tx.lock().ok().map(|g| g.is_some()).unwrap_or(false)
    }

    pub fn is_simulated(&self) -> bool {
        self.current_id() == SIM_ID
    }

    pub fn flashing(&self) -> bool {
        self.flashing.lock().ok().map(|g| *g).unwrap_or(false)
    }

    pub fn current_id(&self) -> String {
        self.current_id.lock().ok().map(|g| g.clone()).unwrap_or_default()
    }

    pub fn list_pads(&self) -> Vec<PadInfo> {
        let current = self.current_id();
        let mut out = vec![PadInfo::simulated(current == SIM_ID)];
        for usb in self.list_usb() {
            let selected = usb.id == current;
            out.push(usb.into_info(selected));
        }
        out
    }

    pub fn current_pad(&self) -> PadInfo {
        let id = self.current_id();
        self.list_pads()
            .into_iter()
            .find(|p| p.id == id)
            .unwrap_or_else(|| PadInfo::simulated(id == SIM_ID))
    }

    /// Auto-pick: 0 USB → simulated, 1 USB → that pad, 2+ → last used USB if still plugged.
    pub fn connect(&self) -> Result<(), PadError> {
        if let Ok(mut g) = self.user_pick.lock() {
            *g = false;
        }
        let want = self.auto_id();
        match self.connect_id(&want) {
            Ok(()) => Ok(()),
            Err(_) if want != SIM_ID => self.connect_id(SIM_ID),
            Err(e) => Err(e),
        }
    }

    /// User picked this pad from the list (including the simulator).
    pub fn connect_to(&self, id: &str) -> Result<(), PadError> {
        self.connect_id(id)?;
        if let Ok(mut g) = self.user_pick.lock() {
            *g = true;
        }
        Ok(())
    }

    /// Plug/unplug: keep an explicit choice if it is still available, otherwise auto-pick.
    pub fn maintain(&self) -> Result<bool, PadError> {
        if self.flashing() {
            return Ok(false);
        }
        let usb = self.list_usb();
        let usb_ids: Vec<String> = usb.iter().map(|u| u.id.clone()).collect();
        let current = self.current_id();
        let user = self.user_pick.lock().ok().map(|g| *g).unwrap_or(false);
        let connected = self.connected();

        if user && current == SIM_ID {
            if connected {
                return Ok(false);
            }
            self.connect_id(SIM_ID)?;
            return Ok(true);
        }
        if connected && current != SIM_ID {
            if usb_ids.iter().any(|id| id == &current) {
                return Ok(false);
            }
            if usb_ids.is_empty() {
                match self.ping() {
                    Ok(_) => return Ok(false),
                    Err(e) if e.to_string().to_ascii_lowercase().contains("busy") => {
                        return Ok(false);
                    }
                    Err(_) => {}
                }
            }
        }
        if user && usb_ids.iter().any(|id| id == &current) {
            if connected {
                return Ok(false);
            }
            self.connect_id(&current)?;
            return Ok(true);
        }

        let want = self.auto_id_from(&usb_ids);
        if connected && current == want {
            return Ok(false);
        }
        self.connect_id(&want)?;
        Ok(true)
    }

    pub fn disconnect(&self) {
        self.disconnect_usb();
    }

    fn auto_id(&self) -> String {
        let ids: Vec<String> = self.list_usb().into_iter().map(|u| u.id).collect();
        self.auto_id_from(&ids)
    }

    fn auto_id_from(&self, usb_ids: &[String]) -> String {
        let current = self.current_id();
        let hint = if current != SIM_ID && usb_ids.iter().any(|id| id == &current) {
            Some(current)
        } else {
            self.remembered_id()
        };
        pick_pad_id(usb_ids, hint.as_deref())
    }

    fn connect_id(&self, id: &str) -> Result<(), PadError> {
        if self.connected() && self.current_id() == id {
            return Ok(());
        }
        if id == SIM_ID {
            self.disconnect_usb();
            self.enter_sim();
            return Ok(());
        }
        self.disconnect_usb();
        self.open_usb(id)?;
        Ok(())
    }

    fn enter_sim(&self) {
        if let Ok(mut g) = self.has_text.lock() {
            *g = true;
        }
        if let Ok(mut g) = self.has_titles.lock() {
            *g = true;
        }
        if let Ok(mut g) = self.has_host.lock() {
            *g = true;
        }
        self.remember(SIM_ID);
    }

    fn open_usb(&self, id: &str) -> Result<(), PadError> {
        let mut api = self.api.lock().map_err(|_| PadError::Msg("lock".into()))?;
        api.refresh_devices()
            .map_err(|e| PadError::Msg(e.to_string()))?;
        let pads = collect_usb(&api);
        let pad = pads
            .iter()
            .find(|p| p.id == id)
            .ok_or_else(|| PadError::Msg("That LogicPad is not connected.".into()))?;
        let opened = pad.info.open_device(&api);
        match opened {
            Ok(dev) => {
                let _ = dev.set_blocking_mode(true);
                match xfer(&dev, CMD_PING, &[]) {
                    Ok(rep) if ping_ok(&rep) => {
                        let proto_min = rep.get(1).copied().unwrap_or(0);
                        drop(api);
                        self.bind_usb(dev, proto_min);
                        self.remember(id);
                        Ok(())
                    }
                    Ok(_) => Err(PadError::Msg("unexpected ping reply".into())),
                    Err(e) => Err(e),
                }
            }
            Err(e) => Err(PadError::Msg(e.to_string())),
        }
    }

    fn bind_usb(&self, dev: HidDevice, proto_min: u8) {
        if let Ok(mut g) = self.has_host.lock() {
            *g = proto_min >= 4;
        }
        let on_key = self.on_key.lock().ok().and_then(|g| g.clone());
        let on_leds = self.on_leds.lock().ok().and_then(|g| g.clone());
        let watch = self.led_watch.clone();
        let last = self.led_last.clone();
        let leds_ok = proto_min >= 7;
        let (tx, rx) = mpsc::channel();
        let handle = thread::spawn(move || hid_worker(dev, rx, on_key, on_leds, watch, last, leds_ok));
        if let Ok(mut g) = self.tx.lock() {
            *g = Some(tx);
        }
        if let Ok(mut g) = self.worker.lock() {
            *g = Some(handle);
        }
    }

    fn disconnect_usb(&self) {
        if let Ok(mut g) = self.tx.lock() {
            if let Some(tx) = g.take() {
                let _ = tx.send(HidReq::Stop);
            }
        }
        if let Ok(mut g) = self.worker.lock() {
            if let Some(h) = g.take() {
                let _ = h.join();
            }
        }
    }

    fn list_usb(&self) -> Vec<UsbPad> {
        let Ok(mut api) = self.api.lock() else {
            return Vec::new();
        };
        let _ = api.refresh_devices();
        collect_usb(&api)
    }

    fn remembered_id(&self) -> Option<String> {
        let path = self.last_path.lock().ok()?;
        let text = fs::read_to_string(&*path).ok()?;
        let id = text.trim();
        if id.is_empty() {
            None
        } else {
            Some(id.to_string())
        }
    }

    fn remember(&self, id: &str) {
        if let Ok(mut g) = self.current_id.lock() {
            *g = id.to_string();
        }
        if let Ok(path) = self.last_path.lock() {
            if !path.as_os_str().is_empty() {
                let _ = fs::write(&*path, id);
            }
        }
    }

    fn usb_serial(&self) -> Option<String> {
        let id = self.current_id();
        id.strip_prefix("sn:").map(|s| s.to_string())
    }

    fn with_sim<T>(&self, f: impl FnOnce(&mut SimPad) -> Result<T, PadError>) -> Option<Result<T, PadError>> {
        if !self.is_simulated() {
            return None;
        }
        Some(
            self.sim
                .lock()
                .map_err(|_| PadError::Msg("lock".into()))
                .and_then(|mut g| f(&mut g)),
        )
    }

    fn rpc(&self, cmd: u8, payload: &[u8]) -> Result<Vec<u8>, PadError> {
        self.rpc_to(cmd, payload, 500)
    }

    fn rpc_to(&self, cmd: u8, payload: &[u8], timeout_ms: u32) -> Result<Vec<u8>, PadError> {
        let tx = self
            .tx
            .lock()
            .map_err(|_| PadError::Msg("lock".into()))?
            .as_ref()
            .ok_or_else(|| PadError::Msg("not connected".into()))?
            .clone();
        let (rtx, rrx) = mpsc::channel();
        tx.send(HidReq::Rpc {
            cmd,
            payload: payload.to_vec(),
            timeout_ms,
            tx: rtx,
        })
        .map_err(|_| PadError::Msg("pad worker stopped".into()))?;
        rrx.recv_timeout(Duration::from_millis(timeout_ms as u64 + 200))
            .map_err(|_| PadError::Msg("no reply from pad".into()))?
    }

    pub fn ping(&self) -> Result<(u8, u8), PadError> {
        if let Some(r) = self.with_sim(|_| Ok(SimPad::ping())) {
            return r;
        }
        let p = self.rpc(CMD_PING, &[])?;
        Ok((p.first().copied().unwrap_or(0), p.get(1).copied().unwrap_or(0)))
    }

    pub fn get_meta(&self) -> Result<Meta, PadError> {
        if let Some(r) = self.with_sim(|s| Ok(s.meta())) {
            return r;
        }
        let p = self.rpc(CMD_GET_META, &[])?;
        Ok(Meta {
            active: p.first().copied().unwrap_or(0),
            dirty: p.get(1).copied().unwrap_or(0) != 0,
            contrast: p.get(2).copied().unwrap_or(0),
            flip: p.get(3).copied().unwrap_or(0),
            sleep: p.get(4).copied().unwrap_or(0),
            in_menu: p.get(5).copied().unwrap_or(0) != 0,
            usb: p.get(6).copied().unwrap_or(0) != 0,
            n_profiles: p.get(7).copied().unwrap_or(0),
            store_used: u16::from_le_bytes([p.get(8).copied().unwrap_or(0), p.get(9).copied().unwrap_or(0)]),
            store_cap: u16::from_le_bytes([p.get(10).copied().unwrap_or(0), p.get(11).copied().unwrap_or(0)]),
        })
    }

    pub fn get_profile(&self, idx: u8) -> Result<ProfileHdr, PadError> {
        if let Some(r) = self.with_sim(|s| s.get_profile(idx)) {
            return r;
        }
        parse_profile(&self.rpc(CMD_GET_PROFILE_HDR, &[idx])?)
    }

    pub fn set_profile(&self, hdr: &ProfileHdr) -> Result<(), PadError> {
        if let Some(r) = self.with_sim(|s| s.set_profile(hdr)) {
            return r;
        }
        let mut p = [0u8; 17];
        p[0] = hdr.index;
        let name = hdr.name.as_bytes();
        let n = name.len().min(12);
        p[1..1 + n].copy_from_slice(&name[..n]);
        p[14] = hdr.light_mode;
        p[15] = hdr.bright;
        p[16] = hdr.dim;
        self.rpc(CMD_SET_PROFILE_HDR, &p)?;
        Ok(())
    }

    pub fn get_key(&self, profile: u8, key: u8) -> Result<PadKey, PadError> {
        parse_key(&self.rpc(CMD_GET_KEY, &[profile, key])?)
    }

    pub fn set_key(&self, key: &PadKey) -> Result<(), PadError> {
        if let Some(r) = self.with_sim(|s| s.set_key(key)) {
            return r;
        }
        let mut p = [0u8; 62];
        p[0] = key.profile;
        p[1] = key.index;
        pack_key(key, &mut p[2..2 + KEY_BYTES]);
        let rep = self.rpc(CMD_SET_KEY, &p)?;
        if rep.get(2).copied().unwrap_or(0) == 1 {
            return Err(PadError::Msg(
                "The pad is out of memory. Delete a profile or shorten a macro.".into(),
            ));
        }
        if self.has_titles() {
            self.set_title(key.profile, key.index, &key.label)?;
        }
        if self.has_text_pool() {
            self.set_text(key.profile, key.index, &key.text)?;
        }
        Ok(())
    }

    fn has_text_pool(&self) -> bool {
        self.has_text.lock().map(|g| *g).unwrap_or(false)
    }

    fn has_titles(&self) -> bool {
        self.has_titles.lock().map(|g| *g).unwrap_or(false)
    }

    fn get_title(&self, profile: u8, key: u8) -> Result<String, PadError> {
        let p = self.rpc(CMD_GET_TITLE, &[profile, key])?;
        if p.len() < 2 {
            return Err(PadError::Msg("short title".into()));
        }
        Ok(cstr(p.get(2..).unwrap_or(&[])))
    }

    fn set_title(&self, profile: u8, key: u8, title: &str) -> Result<(), PadError> {
        let mut p = [0u8; 2 + TITLE_MAX];
        p[0] = profile;
        p[1] = key;
        let mut n = 0;
        for b in title.as_bytes() {
            if n >= TITLE_MAX {
                break;
            }
            if *b >= 32 && *b <= 126 {
                p[2 + n] = *b;
                n += 1;
            }
        }
        self.rpc(CMD_SET_TITLE, &p)?;
        Ok(())
    }

    fn get_text(&self, profile: u8, key: u8) -> Result<String, PadError> {
        let mut raw = Vec::new();
        let mut offset = 0u8;
        loop {
            let p = self.rpc(CMD_GET_TEXT, &[profile, key, offset])?;
            if p.len() < 6 {
                return Err(PadError::Msg("short text".into()));
            }
            let total = p[2];
            if total == 0 {
                return Ok(String::new());
            }
            let chunk = p.get(6..).unwrap_or(&[]);
            let need = total.saturating_sub(offset) as usize;
            let n = need.min(chunk.len()).min(TEXT_GET_CHUNK);
            raw.extend_from_slice(&chunk[..n]);
            let next = offset.saturating_add(n as u8);
            if next >= total || n == 0 {
                raw.truncate(total as usize);
                break;
            }
            offset = next;
        }
        Ok(String::from_utf8_lossy(&raw).into_owned())
    }

    fn set_text(&self, profile: u8, key: u8, text: &str) -> Result<(), PadError> {
        let mut bytes = text.as_bytes().to_vec();
        if bytes.len() > TEXT_MAX {
            bytes.truncate(TEXT_MAX);
            while bytes.last().is_some_and(|b| (*b & 0xC0) == 0x80) {
                bytes.pop();
            }
        }
        let total = bytes.len() as u8;
        let mut offset = 0usize;
        loop {
            let mut p = vec![profile, key, offset as u8, total];
            let n = (bytes.len() - offset).min(TEXT_SET_CHUNK);
            p.extend_from_slice(&bytes[offset..offset + n]);
            let rep = self.rpc(CMD_SET_TEXT, &p)?;
            let st = *rep.get(3).unwrap_or(&0xFF);
            if st == 1 {
                return Err(PadError::Msg(
                    "Not enough memory on the pad. Shorten a key's text or delete a profile.".into(),
                ));
            }
            if st == 2 {
                return Err(PadError::Msg("Text is too long for one key (240 bytes).".into()));
            }
            if st != 0 {
                return Err(PadError::Msg("Could not store typed text".into()));
            }
            offset += n;
            if offset >= bytes.len() {
                break;
            }
        }
        Ok(())
    }

    pub fn set_active(&self, profile: u8) -> Result<(), PadError> {
        if let Some(r) = self.with_sim(|s| s.set_active(profile)) {
            return r;
        }
        self.rpc(CMD_SET_ACTIVE, &[profile])?;
        Ok(())
    }

    pub fn add_profile(&self) -> Result<u8, PadError> {
        if let Some(r) = self.with_sim(|s| s.add_profile()) {
            return r;
        }
        let p = self.rpc(CMD_ADD_PROFILE, &[])?;
        let st = p.get(2).copied().unwrap_or(0xFF);
        if st == 1 {
            return Err(PadError::Msg(
                "The pad is out of memory. Delete a profile or shorten macros / text.".into(),
            ));
        }
        if st != 0 {
            return Err(PadError::Msg("Could not add a profile".into()));
        }
        Ok(p.first().copied().unwrap_or(0))
    }

    pub fn del_profile(&self, idx: u8) -> Result<u8, PadError> {
        if let Some(r) = self.with_sim(|s| s.del_profile(idx)) {
            return r;
        }
        let p = self.rpc(CMD_DEL_PROFILE, &[idx])?;
        let st = p.get(3).copied().unwrap_or(0xFF);
        match st {
            0 => Ok(p.get(2).copied().unwrap_or(0)),
            2 => Err(PadError::Msg("Keep at least one profile.".into())),
            3 => Err(PadError::Msg("No such profile.".into())),
            _ => Err(PadError::Msg("Could not delete that profile".into())),
        }
    }

    pub fn save(&self) -> Result<(), PadError> {
        if let Some(r) = self.with_sim(|s| s.save()) {
            return r;
        }
        self.rpc(CMD_SAVE, &[])?;
        Ok(())
    }

    pub fn reload(&self) -> Result<(), PadError> {
        if let Some(r) = self.with_sim(|s| s.reload()) {
            return r;
        }
        self.rpc(CMD_RELOAD, &[])?;
        Ok(())
    }

    pub fn factory(&self) -> Result<(), PadError> {
        if let Some(r) = self.with_sim(|s| s.factory()) {
            return r;
        }
        self.rpc(CMD_FACTORY, &[])?;
        Ok(())
    }

    pub fn set_time(&self, year: u16, month: u8, day: u8, hour: u8, min: u8, sec: u8) -> Result<(), PadError> {
        if self.is_simulated() {
            return Ok(());
        }
        let mut p = [0u8; 7];
        p[0] = year as u8;
        p[1] = (year >> 8) as u8;
        p[2] = month;
        p[3] = day;
        p[4] = hour;
        p[5] = min;
        p[6] = sec;
        self.rpc(CMD_SET_TIME, &p)?;
        Ok(())
    }

    pub fn set_host(&self, present: bool) -> Result<(), PadError> {
        if self.is_simulated() {
            return Ok(());
        }
        if !self.has_host.lock().map(|g| *g).unwrap_or(false) {
            return Ok(());
        }
        self.rpc(CMD_SET_HOST, &[u8::from(present)])?;
        Ok(())
    }

    pub fn set_screen(&self, contrast: u8, flip: u8, sleep: u8) -> Result<(), PadError> {
        if let Some(r) = self.with_sim(|s| s.set_screen(contrast, flip, sleep)) {
            return r;
        }
        let p = self.rpc(CMD_SET_SCREEN, &[contrast, flip, sleep])?;
        if p.get(3).copied().unwrap_or(0) != 0 {
            return Err(PadError::Msg("Screen values out of range.".into()));
        }
        Ok(())
    }

    pub fn watch_leds(&self, on: bool) {
        self.led_watch.store(on, Ordering::Relaxed);
        if !on {
            if let Ok(mut g) = self.led_last.lock() {
                *g = None;
            }
        }
    }

    pub fn get_leds(&self) -> Result<LedFrame, PadError> {
        if self.is_simulated() {
            return Err(PadError::Msg("simulated".into()));
        }
        self.led_last
            .lock()
            .ok()
            .and_then(|g| g.clone())
            .ok_or_else(|| PadError::Msg("no LED snapshot yet".into()))
    }

    pub fn load_all(&self) -> Result<Snapshot, PadError> {
        if let Some(r) = self.with_sim(|s| Ok(s.snapshot())) {
            return r;
        }
        let (_maj, min) = self.ping()?;
        let has_text = min >= 1;
        let has_titles = min >= 3;
        if let Ok(mut g) = self.has_text.lock() {
            *g = has_text;
        }
        if let Ok(mut g) = self.has_titles.lock() {
            *g = has_titles;
        }
        if let Ok(mut g) = self.has_host.lock() {
            *g = min >= 4;
        }
        let has_packed = min >= 5;
        let meta = self.get_meta()?;
        let can_mutate_profiles = min >= 2;
        let n = if has_packed {
            match meta.n_profiles {
                1..=255 => meta.n_profiles,
                _ => 1,
            }
        } else if can_mutate_profiles {
            match meta.n_profiles {
                1..=4 => meta.n_profiles,
                _ => 4,
            }
        } else {
            4
        };
        let mut profiles = Vec::new();
        let mut keys = Vec::new();
        let mut text_used = 0u16;
        for p in 0..n {
            profiles.push(self.get_profile(p)?);
            let mut row = Vec::new();
            for k in 0..9u8 {
                let mut key = self.get_key(p, k)?;
                if has_text {
                    key.text = self.get_text(p, k)?;
                    text_used = text_used.saturating_add(key.text.len() as u16);
                }
                if has_titles {
                    let title = self.get_title(p, k)?;
                    if !title.is_empty() {
                        key.label = title;
                    }
                }
                row.push(key);
            }
            keys.push(row);
        }
        Ok(Snapshot {
            meta,
            profiles,
            keys,
            text_pool: TextPool {
                enabled: has_text,
                used: text_used,
                max: if has_packed && meta.store_cap > 0 {
                    meta.store_cap.saturating_sub(meta.store_used).saturating_add(text_used)
                } else {
                    TEXT_POOL
                },
            },
            can_mutate_profiles,
            can_titles: has_titles,
            can_add_profiles: if has_packed {
                n < 255 && meta.store_cap.saturating_sub(meta.store_used) >= 16
            } else {
                can_mutate_profiles && n < 4
            },
            can_set_screen: min >= 6,
            can_get_leds: min >= 7,
        })
    }

    pub fn flash_firmware(
        &self,
        image: &[u8],
        mut progress: impl FnMut(&str, u32, u32),
    ) -> Result<(), PadError> {
        if self.is_simulated() {
            return Err(PadError::Msg(
                "Can't update firmware on the simulated LogicPad. Plug in a pad and select it first."
                    .into(),
            ));
        }
        if image.len() < 16 || image.len() > APP_MAX {
            return Err(PadError::Msg(
                "Not a LogicPad app image. Use LogicPad.bin from the firmware Release build (not the factory hex)."
                    .into(),
            ));
        }
        let sp = u32::from_le_bytes(image[0..4].try_into().unwrap());
        let rv = u32::from_le_bytes(image[4..8].try_into().unwrap()) & !1;
        if !(0x2000_0000..=0x2000_5000).contains(&sp) {
            return Err(PadError::Msg(
                "Not an app .bin (stack pointer). Do not flash LogicPad_factory.bin here.".into(),
            ));
        }
        if !(0x0800_1000..0x0800_E000).contains(&rv) {
            return Err(PadError::Msg(
                "Not an app .bin (reset vector). This looks like a bootloader/factory image.".into(),
            ));
        }

        let serial = self.usb_serial();
        let _busy = FlashBusy::arm(&self.flashing);

        progress("reboot", 0, 1);
        if self.connected() {
            let _ = self.rpc_to(CMD_ENTER_BOOTLOADER, &[], 300);
        }
        self.disconnect();
        thread::sleep(Duration::from_millis(900));

        progress("wait", 0, 1);
        let mut api = self.api.lock().map_err(|_| PadError::Msg("lock".into()))?;
        *api = HidApi::new().map_err(|e| PadError::Msg(e.to_string()))?;
        let boot = wait_boot(&mut api, serial.as_deref())?;

        let crc = crc32_ieee(image);
        let mut start = [0u8; 8];
        start[0..4].copy_from_slice(&(image.len() as u32).to_le_bytes());
        start[4..8].copy_from_slice(&crc.to_le_bytes());
        progress("start", 0, image.len() as u32);
        let st = xfer_to(&boot, CMD_BL_START, &start, 800)?;
        bl_ok(&st, "start")?;
        let total = image.len() as u32;
        let mut sent = 0u32;
        let mut last_pct = 255u8;
        for chunk in image.chunks(62) {
            let st = xfer_to(&boot, CMD_BL_DATA, chunk, 800)?;
            bl_ok(&st, "write")?;
            sent += chunk.len() as u32;
            let pct = ((sent * 100) / total.max(1)) as u8;
            if pct != last_pct {
                last_pct = pct;
                progress("write", sent, total);
            }
        }
        progress("verify", total, total);
        let st = xfer_to(&boot, CMD_BL_FINISH, &[], 1500)?;
        bl_ok(&st, "verify")?;
        drop(boot);
        progress("done", total, total);
        thread::sleep(Duration::from_millis(600));
        Ok(())
    }
}

fn write_report(dev: &HidDevice, cmd: u8, payload: &[u8]) -> Result<(), PadError> {
    let mut out = [0u8; REPORT_LEN];
    out[0] = REPORT_ID;
    out[1] = cmd;
    let n = payload.len().min(62);
    out[2..2 + n].copy_from_slice(&payload[..n]);
    dev.write(&out)
        .map(|_| ())
        .map_err(|e| PadError::Msg(format!("write: {e}")))
}

fn split_vendor_in(buf: &[u8], n: usize) -> Option<(u8, &[u8])> {
    if n < 1 {
        return None;
    }
    if buf[0] == REPORT_ID {
        if n < 2 {
            return None;
        }
        Some((buf[1], &buf[2..n]))
    } else {
        Some((buf[0], &buf[1..n]))
    }
}

fn parse_led_frame(payload: &[u8]) -> Option<LedFrame> {
    if payload.len() < 20 {
        return None;
    }
    let mut f = LedFrame {
        color: payload[..10].to_vec(),
        duty: payload[10..20].to_vec(),
        anim_ms: 0,
        idle_ms: 0,
        flash_key: 0xff,
        flash_ms: 0,
        ripple_key: 0xff,
        ripple_age: 0,
        flood: 0,
        clocks: false,
    };
    if payload.len() >= 31 {
        f.anim_ms = u16::from_le_bytes([payload[20], payload[21]]);
        f.idle_ms = u16::from_le_bytes([payload[22], payload[23]]);
        f.flash_key = payload[24];
        f.flash_ms = u16::from_le_bytes([payload[25], payload[26]]);
        f.ripple_key = payload[27];
        f.ripple_age = u16::from_le_bytes([payload[28], payload[29]]);
        f.flood = payload[30];
        f.clocks = true;
    }
    Some(f)
}

fn hid_worker(
    dev: HidDevice,
    rx: Receiver<HidReq>,
    on_key: Option<KeyCallback>,
    on_leds: Option<LedCallback>,
    watch: Arc<AtomicBool>,
    last: Arc<Mutex<Option<LedFrame>>>,
    leds_ok: bool,
) {
    let mut pending: Option<Pending> = None;
    let mut queue: VecDeque<(u8, Vec<u8>, u32, Sender<Result<Vec<u8>, PadError>>)> = VecDeque::new();
    let mut buf = [0u8; REPORT_LEN];
    let mut led_due = Instant::now();
    loop {
        let watching = leds_ok && watch.load(Ordering::Relaxed);
        let idle_ms = if watching { 4 } else { 15 };
        if pending.is_none() && queue.is_empty() {
            match rx.recv_timeout(Duration::from_millis(idle_ms)) {
                Ok(HidReq::Stop) => break,
                Ok(HidReq::Rpc {
                    cmd,
                    payload,
                    timeout_ms,
                    tx,
                }) => queue.push_back((cmd, payload, timeout_ms, tx)),
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => break,
            }
        } else {
            match rx.try_recv() {
                Ok(HidReq::Stop) => break,
                Ok(HidReq::Rpc {
                    cmd,
                    payload,
                    timeout_ms,
                    tx,
                }) => queue.push_back((cmd, payload, timeout_ms, tx)),
                Err(_) => {}
            }
        }

        if pending.is_none() {
            if let Some((cmd, payload, timeout_ms, tx)) = queue.pop_front() {
                match write_report(&dev, cmd, &payload) {
                    Ok(()) => {
                        pending = Some(Pending::Rpc {
                            cmd,
                            deadline: Instant::now() + Duration::from_millis(timeout_ms as u64),
                            tx,
                        });
                    }
                    Err(e) => {
                        let _ = tx.send(Err(e));
                    }
                }
            } else if watching && Instant::now() >= led_due {
                if write_report(&dev, CMD_GET_LEDS, &[]).is_ok() {
                    pending = Some(Pending::Leds {
                        deadline: Instant::now() + Duration::from_millis(80),
                    });
                }
                led_due = Instant::now() + Duration::from_millis(16);
            }
        }

        match dev.read_timeout(&mut buf, if watching { 8 } else { 15 }) {
            Ok(n) if n > 0 => {
                if let Some((cmd, payload)) = split_vendor_in(&buf, n) {
                    if cmd == CMD_KEY_EVENT {
                        if let Some(cb) = &on_key {
                            cb(
                                payload.first().copied().unwrap_or(0),
                                payload.get(1).copied().unwrap_or(0),
                                payload.get(2).copied().unwrap_or(0) != 0,
                            );
                        }
                    } else if let Some(p) = pending.take() {
                        match p {
                            Pending::Rpc { cmd: want, tx, .. } if want == cmd => {
                                let _ = tx.send(Ok(payload.to_vec()));
                            }
                            Pending::Leds { .. } if cmd == CMD_GET_LEDS => {
                                if let Some(frame) = parse_led_frame(payload) {
                                    if let Some(cb) = &on_leds {
                                        cb(frame.clone());
                                    }
                                    if let Ok(mut g) = last.lock() {
                                        *g = Some(frame);
                                    }
                                }
                            }
                            other => pending = Some(other),
                        }
                    }
                }
            }
            _ => {}
        }

        let timed_out = match &pending {
            Some(Pending::Rpc { deadline, .. } | Pending::Leds { deadline }) => {
                Instant::now() >= *deadline
            }
            None => false,
        };
        if timed_out {
            match pending.take() {
                Some(Pending::Rpc { tx, .. }) => {
                    let _ = tx.send(Err(PadError::Msg("no reply from pad".into())));
                }
                _ => {}
            }
        }
    }
}

fn xfer(dev: &HidDevice, cmd: u8, payload: &[u8]) -> Result<Vec<u8>, PadError> {
    xfer_to(dev, cmd, payload, 80)
}

fn xfer_to(dev: &HidDevice, cmd: u8, payload: &[u8], timeout_ms: i32) -> Result<Vec<u8>, PadError> {
    let mut out = [0u8; REPORT_LEN];
    out[0] = REPORT_ID;
    out[1] = cmd;
    let n = payload.len().min(62);
    out[2..2 + n].copy_from_slice(&payload[..n]);
    dev.write(&out)
        .map_err(|e| PadError::Msg(format!("write: {e}")))?;

    let deadline = Instant::now() + Duration::from_millis(timeout_ms.max(1) as u64);
    let mut buf = [0u8; REPORT_LEN];
    loop {
        let remain = deadline.saturating_duration_since(Instant::now()).as_millis();
        if remain == 0 {
            break;
        }
        match dev.read_timeout(&mut buf, remain.min(100) as i32) {
            Ok(0) => continue,
            Ok(_) if buf[0] == REPORT_ID && buf[1] == cmd => {
                return Ok(buf[2..].to_vec());
            }
            Ok(_) if buf[0] == cmd => {
                /* Some Windows HID stacks omit the report ID on read. */
                return Ok(buf[1..].to_vec());
            }
            Ok(_) => continue,
            Err(e) => return Err(PadError::Msg(format!("read: {e}"))),
        }
    }
    Err(PadError::Msg("no reply from pad".into()))
}

fn crc32_ieee(data: &[u8]) -> u32 {
    let mut c = 0xFFFF_FFFFu32;
    for &b in data {
        c ^= b as u32;
        for _ in 0..8 {
            c = if c & 1 != 0 {
                (c >> 1) ^ 0xEDB8_8320
            } else {
                c >> 1
            };
        }
    }
    !c
}

fn bl_ok(payload: &[u8], step: &str) -> Result<(), PadError> {
    let st = payload.first().copied().unwrap_or(0xFF);
    if st == 0 {
        return Ok(());
    }
    let why = match st {
        1 => "bad size",
        2 => "not an app image",
        3 => "flash error",
        4 => "CRC mismatch",
        5 => "updater state",
        _ => "unknown",
    };
    Err(PadError::Msg(format!("firmware {step} failed ({why})")))
}

fn wait_boot(api: &mut HidApi, serial: Option<&str>) -> Result<HidDevice, PadError> {
    let start = Instant::now();
    let mut last = PadError::Msg(
        "LogicPad Boot not found. ST-Link LogicPad_factory.hex once, or hold SEL while plugging USB."
            .into(),
    );
    let mut last_kick = Instant::now() - Duration::from_secs(10);
    let mut n = 0u32;
    while start.elapsed() < Duration::from_millis(30000) {
        if n % 5 == 0 {
            if let Ok(fresh) = HidApi::new() {
                *api = fresh;
            }
        } else {
            let _ = api.refresh_devices();
        }
        n += 1;

        match open_vid_pid_to(api, VID, PID_BOOT, 800, serial) {
            Ok(d) => return Ok(d),
            Err(e) => last = e,
        }
        if serial.is_some() {
            if let Ok(d) = open_vid_pid_to(api, VID, PID_BOOT, 800, None) {
                return Ok(d);
            }
        }
        if last_kick.elapsed() >= Duration::from_millis(2500) {
            if let Ok(app) = open_vid_pid_to(api, VID, PID, 250, serial) {
                let _ = xfer_to(&app, CMD_ENTER_BOOTLOADER, &[], 400);
                drop(app);
                last_kick = Instant::now();
                thread::sleep(Duration::from_millis(900));
                continue;
            }
        }
        thread::sleep(Duration::from_millis(200));
    }
    let seen = hid_snapshot(api);
    Err(PadError::Msg(format!(
        "LogicPad Boot (PID 5751) not found ({last}). Seen: {seen}. Hold SEL while plugging USB. If Windows never shows “LogicPad Boot”, ST-Link LogicPad_factory.hex once."
    )))
}

#[allow(dead_code)]
fn wait_open(api: &mut HidApi, vid: u16, pid: u16, ms: u64) -> Result<HidDevice, PadError> {
    let start = Instant::now();
    let mut last = PadError::Msg(format!("LogicPad {vid:04x}:{pid:04x} not found"));
    while start.elapsed() < Duration::from_millis(ms) {
        if let Err(e) = api.refresh_devices() {
            last = PadError::Msg(e.to_string());
        } else {
            match open_vid_pid(api, vid, pid) {
                Ok(d) => return Ok(d),
                Err(e) => last = e,
            }
        }
        thread::sleep(Duration::from_millis(120));
    }
    Err(last)
}

fn open_vid_pid(api: &HidApi, vid: u16, pid: u16) -> Result<HidDevice, PadError> {
    open_vid_pid_to(api, vid, pid, 80, None)
}

fn hid_snapshot(api: &HidApi) -> String {
    let mut parts: Vec<String> = Vec::new();
    for info in api.device_list() {
        if info.vendor_id() != VID {
            continue;
        }
        let name = info.product_string().unwrap_or("");
        parts.push(format!(
            "{:04x}:{:04x} page={:04x} {name}",
            info.vendor_id(),
            info.product_id(),
            info.usage_page()
        ));
    }
    if parts.is_empty() {
        "no ST HID devices".into()
    } else {
        parts.join("; ")
    }
}

fn ping_ok(payload: &[u8]) -> bool {
    payload.first().copied() == Some(0x01)
}

fn open_and_ping(dev: HidDevice, ping_ms: i32) -> Result<HidDevice, PadError> {
    let _ = dev.set_blocking_mode(true);
    match xfer_to(&dev, CMD_PING, &[], ping_ms) {
        Ok(rep) if ping_ok(&rep) => Ok(dev),
        Ok(_) => Err(PadError::Msg("unexpected ping reply".into())),
        Err(e) => Err(e),
    }
}

fn open_vid_pid_to(
    api: &HidApi,
    vid: u16,
    pid: u16,
    ping_ms: i32,
    serial: Option<&str>,
) -> Result<HidDevice, PadError> {
    let skip_iface_filter = pid == PID_BOOT;
    let mut found: Vec<(u8, hidapi::DeviceInfo)> = Vec::new();
    for info in api.device_list() {
        if info.vendor_id() != vid || info.product_id() != pid {
            continue;
        }
        if !serial_matches(info.serial_number(), serial) {
            continue;
        }
        if !skip_iface_filter && !keep_app_iface(info) {
            continue;
        }
        found.push((iface_rank(info), info.clone()));
    }
    found.sort_by_key(|(r, _)| *r);
    let mut last = PadError::Msg("HID interface not found".into());
    for (_, info) in found {
        match info.open_device(api) {
            Ok(dev) => match open_and_ping(dev, ping_ms) {
                Ok(dev) => return Ok(dev),
                Err(e) => last = e,
            },
            Err(e) => last = PadError::Msg(e.to_string()),
        }
    }
    if serial.is_some() {
        return Err(last);
    }
    match api.open(vid, pid) {
        Ok(dev) => open_and_ping(dev, ping_ms),
        Err(e) => {
            if matches!(&last, PadError::Msg(s) if s == "HID interface not found") {
                Err(PadError::Msg(e.to_string()))
            } else {
                Err(last)
            }
        }
    }
}

fn cstr(bytes: &[u8]) -> String {
    let end = bytes.iter().position(|&b| b == 0).unwrap_or(bytes.len());
    String::from_utf8_lossy(&bytes[..end]).into_owned()
}

fn parse_profile(p: &[u8]) -> Result<ProfileHdr, PadError> {
    if p.len() < 17 {
        return Err(PadError::Msg("short profile".into()));
    }
    Ok(ProfileHdr {
        index: p[0],
        name: cstr(&p[1..14]),
        light_mode: p[14],
        bright: p[15],
        dim: p[16],
    })
}

fn parse_key(p: &[u8]) -> Result<PadKey, PadError> {
    if p.len() < 2 + KEY_BYTES {
        return Err(PadError::Msg("short key".into()));
    }
    let body = &p[2..2 + KEY_BYTES];
    let n = body[8].min(MAX_ACTS as u8) as usize;
    let mut acts = Vec::new();
    for i in 0..n {
        let o = 9 + i * 4;
        if o + 4 > body.len() {
            break;
        }
        acts.push(Action {
            type_id: body[o],
            mods: body[o + 1],
            code: u16::from_le_bytes([body[o + 2], body[o + 3]]),
        });
    }
    Ok(PadKey {
        profile: p[0],
        index: p[1],
        label: cstr(&body[0..7]),
        led: body[7],
        acts,
        text: String::new(),
    })
}

fn pack_key(key: &PadKey, out: &mut [u8]) {
    out.fill(0);
    let mut n = 0;
    for b in key.label.as_bytes() {
        if n >= LABEL_HID {
            break;
        }
        if *b != b' ' {
            out[n] = *b;
            n += 1;
        }
    }
    out[7] = key.led;
    let count = key.acts.len().min(MAX_ACTS);
    out[8] = count as u8;
    for (i, a) in key.acts.iter().take(count).enumerate() {
        let o = 9 + i * 4;
        out[o] = a.type_id;
        out[o + 1] = a.mods;
        let c = a.code.to_le_bytes();
        out[o + 2] = c[0];
        out[o + 3] = c[1];
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Meta {
    pub active: u8,
    pub dirty: bool,
    pub contrast: u8,
    pub flip: u8,
    pub sleep: u8,
    pub in_menu: bool,
    pub usb: bool,
    #[serde(default)]
    pub n_profiles: u8,
    #[serde(default)]
    pub store_used: u16,
    #[serde(default)]
    pub store_cap: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileHdr {
    pub index: u8,
    pub name: String,
    pub light_mode: u8,
    pub bright: u8,
    pub dim: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Action {
    #[serde(rename = "type")]
    pub type_id: u8,
    pub mods: u8,
    pub code: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PadKey {
    pub profile: u8,
    pub index: u8,
    pub label: String,
    pub led: u8,
    pub acts: Vec<Action>,
    #[serde(default)]
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextPool {
    pub enabled: bool,
    pub used: u16,
    pub max: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LedFrame {
    pub color: Vec<u8>,
    pub duty: Vec<u8>,
    #[serde(default)]
    pub anim_ms: u16,
    #[serde(default)]
    pub idle_ms: u16,
    #[serde(default)]
    pub flash_key: u8,
    #[serde(default)]
    pub flash_ms: u16,
    #[serde(default)]
    pub ripple_key: u8,
    #[serde(default)]
    pub ripple_age: u16,
    #[serde(default)]
    pub flood: u8,
    #[serde(default)]
    pub clocks: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub meta: Meta,
    pub profiles: Vec<ProfileHdr>,
    pub keys: Vec<Vec<PadKey>>,
    #[serde(default)]
    pub text_pool: TextPool,
    #[serde(default)]
    pub can_mutate_profiles: bool,
    #[serde(default)]
    pub can_titles: bool,
    #[serde(default)]
    pub can_add_profiles: bool,
    #[serde(default)]
    pub can_set_screen: bool,
    #[serde(default)]
    pub can_get_leds: bool,
}

impl Default for TextPool {
    fn default() -> Self {
        Self {
            enabled: false,
            used: 0,
            max: TEXT_POOL,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PadInfo {
    pub id: String,
    pub kind: String,
    pub label: String,
    pub serial: Option<String>,
    pub simulated: bool,
    pub selected: bool,
}

impl PadInfo {
    fn simulated(selected: bool) -> Self {
        Self {
            id: SIM_ID.into(),
            kind: "simulated".into(),
            label: SIM_LABEL.into(),
            serial: None,
            simulated: true,
            selected,
        }
    }
}

struct UsbPad {
    id: String,
    serial: Option<String>,
    label: String,
    rank: u8,
    info: hidapi::DeviceInfo,
}

impl UsbPad {
    fn into_info(self, selected: bool) -> PadInfo {
        PadInfo {
            id: self.id,
            kind: "usb".into(),
            label: self.label,
            serial: self.serial,
            simulated: false,
            selected,
        }
    }
}

/// 0 USB → simulated, 1 USB → that pad, 2+ → last used USB if still plugged in.
pub fn pick_pad_id(usb_ids: &[String], last: Option<&str>) -> String {
    match usb_ids.len() {
        0 => SIM_ID.to_string(),
        1 => usb_ids[0].clone(),
        _ => {
            if let Some(last) = last {
                if usb_ids.iter().any(|id| id == last) {
                    return last.to_string();
                }
            }
            usb_ids[0].clone()
        }
    }
}

struct FlashBusy<'a>(&'a Mutex<bool>);

impl<'a> FlashBusy<'a> {
    fn arm(flag: &'a Mutex<bool>) -> Self {
        if let Ok(mut g) = flag.lock() {
            *g = true;
        }
        Self(flag)
    }
}

impl Drop for FlashBusy<'_> {
    fn drop(&mut self) {
        if let Ok(mut g) = self.0.lock() {
            *g = false;
        }
    }
}

fn collect_usb(api: &HidApi) -> Vec<UsbPad> {
    let mut by_id: BTreeMap<String, UsbPad> = BTreeMap::new();
    for info in api.device_list() {
        if info.vendor_id() != VID || info.product_id() != PID {
            continue;
        }
        if !keep_app_iface(info) {
            continue;
        }
        let id = usb_id(info);
        let rank = iface_rank(info);
        let serial = nonempty_serial(info.serial_number());
        let next = UsbPad {
            id: id.clone(),
            serial,
            label: String::new(),
            rank,
            info: info.clone(),
        };
        match by_id.get(&id) {
            Some(old) if old.rank <= rank => {}
            _ => {
                by_id.insert(id, next);
            }
        }
    }
    let mut pads: Vec<UsbPad> = by_id.into_values().collect();
    pads.sort_by(|a, b| {
        a.serial
            .as_deref()
            .unwrap_or("")
            .cmp(b.serial.as_deref().unwrap_or(""))
            .then_with(|| a.id.cmp(&b.id))
    });
    let n = pads.len();
    for (i, p) in pads.iter_mut().enumerate() {
        p.label = usb_label(p, i, n);
    }
    pads
}

fn usb_id(info: &hidapi::DeviceInfo) -> String {
    if let Some(s) = nonempty_serial(info.serial_number()) {
        format!("sn:{}", s.to_ascii_uppercase())
    } else {
        format!("path:{}", info.path().to_string_lossy())
    }
}

fn usb_label(pad: &UsbPad, index: usize, count: usize) -> String {
    if let Some(s) = pad.serial.as_deref() {
        format!("LogicPad · {s}")
    } else if count > 1 {
        format!("LogicPad {}", index + 1)
    } else {
        "LogicPad".into()
    }
}

fn nonempty_serial(s: Option<&str>) -> Option<String> {
    s.map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
}

fn serial_matches(got: Option<&str>, want: Option<&str>) -> bool {
    let Some(want) = want else {
        return true;
    };
    let want = want.trim();
    if want.is_empty() {
        return true;
    }
    got.map(str::trim)
        .is_some_and(|g| g.eq_ignore_ascii_case(want))
}

fn keep_app_iface(info: &hidapi::DeviceInfo) -> bool {
    let page = info.usage_page();
    #[cfg(windows)]
    {
        let usage = info.usage();
        if page == USAGE_PAGE_DESKTOP && (usage == 6 || usage == 2) {
            return false;
        }
        if page == USAGE_PAGE_CONSUMER {
            return false;
        }
    }
    true
}

fn iface_rank(info: &hidapi::DeviceInfo) -> u8 {
    let page = info.usage_page();
    if page == USAGE_PAGE_VENDOR {
        0
    } else if page == 0 {
        1
    } else {
        2
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pick_zero_one_many() {
        assert_eq!(pick_pad_id(&[], None), SIM_ID);
        assert_eq!(pick_pad_id(&["sn:A".into()], Some("sn:B")), "sn:A");
        assert_eq!(
            pick_pad_id(&["sn:A".into(), "sn:B".into()], Some("sn:B")),
            "sn:B"
        );
        assert_eq!(
            pick_pad_id(&["sn:A".into(), "sn:B".into()], Some(SIM_ID)),
            "sn:A"
        );
        assert_eq!(pick_pad_id(&["sn:A".into(), "sn:B".into()], None), "sn:A");
    }
}
