use hidapi::{HidApi, HidDevice};
use serde::{Deserialize, Serialize};
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
const CMD_BL_START: u8 = 0x40;
const CMD_BL_DATA: u8 = 0x41;
const CMD_BL_FINISH: u8 = 0x42;
const APP_MAX: usize = 52 * 1024;

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

enum HidReq {
    Rpc {
        cmd: u8,
        payload: Vec<u8>,
        timeout_ms: u32,
        tx: Sender<Result<Vec<u8>, PadError>>,
    },
    Stop,
}

pub struct Pad {
    api: Mutex<HidApi>,
    tx: Mutex<Option<Sender<HidReq>>>,
    worker: Mutex<Option<JoinHandle<()>>>,
    on_key: Mutex<Option<KeyCallback>>,
}

impl Pad {
    pub fn new() -> Result<Self, PadError> {
        let api = HidApi::new().map_err(|e| PadError::Msg(e.to_string()))?;
        Ok(Self {
            api: Mutex::new(api),
            tx: Mutex::new(None),
            worker: Mutex::new(None),
            on_key: Mutex::new(None),
        })
    }

    pub fn set_on_key(&self, cb: KeyCallback) {
        if let Ok(mut g) = self.on_key.lock() {
            *g = Some(cb);
        }
    }

    pub fn connected(&self) -> bool {
        self.tx.lock().ok().map(|g| g.is_some()).unwrap_or(false)
    }

    pub fn connect(&self) -> Result<(), PadError> {
        self.disconnect();
        let mut api = self.api.lock().map_err(|_| PadError::Msg("lock".into()))?;
        api.refresh_devices()
            .map_err(|e| PadError::Msg(e.to_string()))?;

        let mut found: Vec<(u8, hidapi::DeviceInfo)> = Vec::new();
        for info in api.device_list() {
            if info.vendor_id() != VID || info.product_id() != PID {
                continue;
            }
            let page = info.usage_page();
            #[cfg(windows)]
            let usage = info.usage();
            #[cfg(windows)]
            {
                if page == USAGE_PAGE_DESKTOP && (usage == 6 || usage == 2) {
                    continue;
                }
                if page == USAGE_PAGE_CONSUMER {
                    continue;
                }
            }
            let rank = if page == USAGE_PAGE_VENDOR {
                0u8
            } else if page == 0 {
                1u8
            } else {
                2u8
            };
            found.push((rank, info.clone()));
        }
        found.sort_by_key(|(r, _)| *r);

        let mut opened = None;
        let mut last = PadError::Msg("LogicPad vendor interface not found".into());
        for (_, info) in found {
            match info.open_device(&api) {
                Ok(dev) => {
                    let _ = dev.set_blocking_mode(true);
                    match xfer(&dev, CMD_PING, &[]) {
                        Ok(rep) if rep.len() >= 2 && rep[0] == 0x01 => {
                            opened = Some(dev);
                            break;
                        }
                        Ok(_) => last = PadError::Msg("unexpected ping reply".into()),
                        Err(e) => last = e,
                    }
                }
                Err(e) => last = PadError::Msg(e.to_string()),
            }
        }

        let dev = opened.ok_or(last)?;
        drop(api);
        let on_key = self.on_key.lock().ok().and_then(|g| g.clone());
        let (tx, rx) = mpsc::channel();
        let handle = thread::spawn(move || hid_worker(dev, rx, on_key));
        *self.tx.lock().map_err(|_| PadError::Msg("lock".into()))? = Some(tx);
        *self.worker.lock().map_err(|_| PadError::Msg("lock".into()))? = Some(handle);
        Ok(())
    }

    pub fn disconnect(&self) {
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
        let p = self.rpc(CMD_PING, &[])?;
        Ok((p.first().copied().unwrap_or(0), p.get(1).copied().unwrap_or(0)))
    }

    pub fn get_meta(&self) -> Result<Meta, PadError> {
        let p = self.rpc(CMD_GET_META, &[])?;
        Ok(Meta {
            active: p.first().copied().unwrap_or(0),
            dirty: p.get(1).copied().unwrap_or(0) != 0,
            contrast: p.get(2).copied().unwrap_or(0),
            flip: p.get(3).copied().unwrap_or(0),
            sleep: p.get(4).copied().unwrap_or(0),
            in_menu: p.get(5).copied().unwrap_or(0) != 0,
            usb: p.get(6).copied().unwrap_or(0) != 0,
        })
    }

    pub fn get_profile(&self, idx: u8) -> Result<ProfileHdr, PadError> {
        parse_profile(&self.rpc(CMD_GET_PROFILE_HDR, &[idx])?)
    }

    pub fn set_profile(&self, hdr: &ProfileHdr) -> Result<(), PadError> {
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
        let mut p = [0u8; 62];
        p[0] = key.profile;
        p[1] = key.index;
        pack_key(key, &mut p[2..2 + KEY_BYTES]);
        self.rpc(CMD_SET_KEY, &p)?;
        Ok(())
    }

    pub fn set_active(&self, profile: u8) -> Result<(), PadError> {
        self.rpc(CMD_SET_ACTIVE, &[profile])?;
        Ok(())
    }

    pub fn save(&self) -> Result<(), PadError> {
        self.rpc(CMD_SAVE, &[])?;
        Ok(())
    }

    pub fn reload(&self) -> Result<(), PadError> {
        self.rpc(CMD_RELOAD, &[])?;
        Ok(())
    }

    pub fn factory(&self) -> Result<(), PadError> {
        self.rpc(CMD_FACTORY, &[])?;
        Ok(())
    }

    pub fn load_all(&self) -> Result<Snapshot, PadError> {
        let meta = self.get_meta()?;
        let mut profiles = Vec::new();
        let mut keys = Vec::new();
        for p in 0..4u8 {
            profiles.push(self.get_profile(p)?);
            let mut row = Vec::new();
            for k in 0..9u8 {
                row.push(self.get_key(p, k)?);
            }
            keys.push(row);
        }
        Ok(Snapshot {
            meta,
            profiles,
            keys,
        })
    }

    pub fn flash_firmware(&self, image: &[u8]) -> Result<(), PadError> {
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

        if self.connected() {
            let _ = self.rpc_to(CMD_ENTER_BOOTLOADER, &[], 200);
        }
        self.disconnect();
        thread::sleep(Duration::from_millis(400));

        let mut api = self.api.lock().map_err(|_| PadError::Msg("lock".into()))?;
        let boot = match wait_open(&mut api, VID, PID_BOOT, 2500) {
            Ok(d) => d,
            Err(_) => {
                let app = wait_open(&mut api, VID, PID, 2500)?;
                let _ = xfer_to(&app, CMD_ENTER_BOOTLOADER, &[], 200);
                drop(app);
                thread::sleep(Duration::from_millis(400));
                wait_open(&mut api, VID, PID_BOOT, 8000)?
            }
        };

        let crc = crc32_ieee(image);
        let mut start = [0u8; 8];
        start[0..4].copy_from_slice(&(image.len() as u32).to_le_bytes());
        start[4..8].copy_from_slice(&crc.to_le_bytes());
        let st = xfer_to(&boot, CMD_BL_START, &start, 800)?;
        bl_ok(&st, "start")?;
        for chunk in image.chunks(62) {
            let st = xfer_to(&boot, CMD_BL_DATA, chunk, 800)?;
            bl_ok(&st, "write")?;
        }
        let st = xfer_to(&boot, CMD_BL_FINISH, &[], 1500)?;
        bl_ok(&st, "verify")?;
        drop(boot);
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

fn hid_worker(dev: HidDevice, rx: Receiver<HidReq>, on_key: Option<KeyCallback>) {
    let mut pending: Option<(u8, Instant, Sender<Result<Vec<u8>, PadError>>)> = None;
    let mut buf = [0u8; REPORT_LEN];
    loop {
        if pending.is_none() {
            match rx.recv_timeout(Duration::from_millis(15)) {
                Ok(HidReq::Stop) => break,
                Ok(HidReq::Rpc {
                    cmd,
                    payload,
                    timeout_ms,
                    tx,
                }) => match write_report(&dev, cmd, &payload) {
                    Ok(()) => {
                        pending = Some((
                            cmd,
                            Instant::now() + Duration::from_millis(timeout_ms as u64),
                            tx,
                        ));
                    }
                    Err(e) => {
                        let _ = tx.send(Err(e));
                    }
                },
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => break,
            }
        } else {
            match rx.try_recv() {
                Ok(HidReq::Stop) => break,
                Ok(HidReq::Rpc { tx, .. }) => {
                    let _ = tx.send(Err(PadError::Msg("busy".into())));
                }
                Err(_) => {}
            }
        }

        match dev.read_timeout(&mut buf, 15) {
            Ok(n) if n > 0 && buf[0] == REPORT_ID => {
                if buf[1] == CMD_KEY_EVENT {
                    if let Some(cb) = &on_key {
                        cb(buf[2], buf[3], buf[4] != 0);
                    }
                } else if pending.as_ref().is_some_and(|(c, _, _)| *c == buf[1]) {
                    let (_, _, tx) = pending.take().unwrap();
                    let _ = tx.send(Ok(buf[2..].to_vec()));
                }
            }
            _ => {}
        }

        if let Some((_, deadline, _)) = &pending {
            if Instant::now() >= *deadline {
                let (_, _, tx) = pending.take().unwrap();
                let _ = tx.send(Err(PadError::Msg("no reply from pad".into())));
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
    let mut found: Vec<(u8, hidapi::DeviceInfo)> = Vec::new();
    for info in api.device_list() {
        if info.vendor_id() != vid || info.product_id() != pid {
            continue;
        }
        let page = info.usage_page();
        #[cfg(windows)]
        let usage = info.usage();
        #[cfg(windows)]
        {
            if page == USAGE_PAGE_DESKTOP && (usage == 6 || usage == 2) {
                continue;
            }
            if page == USAGE_PAGE_CONSUMER {
                continue;
            }
        }
        let rank = if page == USAGE_PAGE_VENDOR {
            0u8
        } else if page == 0 {
            1u8
        } else {
            2u8
        };
        found.push((rank, info.clone()));
    }
    found.sort_by_key(|(r, _)| *r);
    let mut last = PadError::Msg("HID interface not found".into());
    for (_, info) in found {
        match info.open_device(api) {
            Ok(dev) => {
                let _ = dev.set_blocking_mode(true);
                match xfer_to(&dev, CMD_PING, &[], 300) {
                    Ok(rep) if rep.first().copied() == Some(0x01) => return Ok(dev),
                    Ok(_) => last = PadError::Msg("unexpected ping reply".into()),
                    Err(e) => last = e,
                }
            }
            Err(e) => last = PadError::Msg(e.to_string()),
        }
    }
    Err(last)
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
    })
}

fn pack_key(key: &PadKey, out: &mut [u8]) {
    out.fill(0);
    let lab = key.label.as_bytes();
    let n = lab.len().min(6);
    out[..n].copy_from_slice(&lab[..n]);
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Meta {
    pub active: u8,
    pub dirty: bool,
    pub contrast: u8,
    pub flip: u8,
    pub sleep: u8,
    pub in_menu: bool,
    pub usb: bool,
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub meta: Meta,
    pub profiles: Vec<ProfileHdr>,
    pub keys: Vec<Vec<PadKey>>,
}
