//! Live window previews via Windows.Graphics.Capture — the same compositor
//! path OBS uses. Reads the window's own surface, so a window in front does
//! not appear in the thumb. Minimized windows are not composed; we cloak-
//! restore for one still, then put them back. One worker thread owns the D3D
//! device (COM is not Send). Never runs on the HID poll.

use tauri::AppHandle;
use std::sync::mpsc::{self, Sender};

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewFrame {
    pub hwnd: String,
    pub jpeg: String,
}

pub struct PreviewHub {
    tx: Sender<Cmd>,
}

enum Cmd {
    Watch(Vec<usize>),
    Stop,
}

pub fn spawn(app: AppHandle) -> PreviewHub {
    let (tx, rx) = mpsc::channel();
    #[cfg(windows)]
    {
        let _ = std::thread::Builder::new()
            .name("lp-wgc".into())
            .spawn(move || win::run(app, rx));
    }
    #[cfg(not(windows))]
    {
        let _ = (app, rx);
    }
    PreviewHub { tx }
}

impl PreviewHub {
    pub fn watch(&self, hwnds: Vec<String>) {
        let ids = hwnds
            .into_iter()
            .filter_map(|s| s.parse::<usize>().ok())
            .collect();
        let _ = self.tx.send(Cmd::Watch(ids));
    }

    pub fn stop(&self) {
        let _ = self.tx.send(Cmd::Stop);
    }
}

#[cfg(windows)]
mod win {
    use super::{Cmd, PreviewFrame};
    use jpeg_encoder::{ColorType, Encoder};
    use std::collections::HashMap;
    use std::sync::mpsc::Receiver;
    use std::time::{Duration, Instant};
    use tauri::{AppHandle, Emitter};
    use windows::core::Interface;
    use windows::Graphics::Capture::{
        Direct3D11CaptureFramePool, GraphicsCaptureItem, GraphicsCaptureSession,
    };
    use windows::Graphics::DirectX::Direct3D11::IDirect3DDevice;
    use windows::Graphics::DirectX::DirectXPixelFormat;
    use windows::Graphics::SizeInt32;
    use windows::Win32::Foundation::{FALSE, HMODULE, HWND, TRUE};
    use windows::Win32::Graphics::Direct3D::D3D_DRIVER_TYPE_HARDWARE;
    use windows::Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_CLOAK};
    use windows::Win32::Graphics::Direct3D11::{
        D3D11CreateDevice, ID3D11Device, ID3D11DeviceContext, ID3D11Texture2D, D3D11_CPU_ACCESS_READ,
        D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_MAPPED_SUBRESOURCE, D3D11_MAP_READ,
        D3D11_SDK_VERSION, D3D11_TEXTURE2D_DESC, D3D11_USAGE_STAGING,
    };
    use windows::Win32::Graphics::Dxgi::IDXGIDevice;
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};
    use windows::Win32::System::WinRT::Direct3D11::{
        CreateDirect3D11DeviceFromDXGIDevice, IDirect3DDxgiInterfaceAccess,
    };
    use windows::Win32::System::WinRT::Graphics::Capture::IGraphicsCaptureItemInterop;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowPlacement, IsHungAppWindow, IsIconic, SetWindowPlacement, SetWindowPos,
        ShowWindow, HWND_BOTTOM, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW,
        SW_SHOWNOACTIVATE, WINDOWPLACEMENT,
    };

    const MAX_SESSIONS: usize = 16;
    const DST_W: u32 = 320;
    const MIN_EMIT: Duration = Duration::from_millis(50);
    const TICK: Duration = Duration::from_millis(16);
    const PEEK_MS: Duration = Duration::from_millis(800);

    fn set_cloak(hwnd: HWND, on: bool) -> windows::core::Result<()> {
        let v = if on { TRUE } else { FALSE };
        unsafe {
            DwmSetWindowAttribute(
                hwnd,
                DWMWA_CLOAK,
                &v as *const _ as *const core::ffi::c_void,
                std::mem::size_of_val(&v) as u32,
            )
        }
    }

    /// Cloak + restore a minimized window so DWM composes a frame for WGC, then
    /// put it back. Live capture of an iconic window is impossible — Windows
    /// stops drawing it. Cloak first so the restore is not visible.
    struct CloakPeek {
        hwnd: HWND,
        place: WINDOWPLACEMENT,
    }

    impl CloakPeek {
        fn begin(hwnd: HWND) -> Option<Self> {
            if !unsafe { IsIconic(hwnd) }.as_bool() {
                return None;
            }
            if unsafe { IsHungAppWindow(hwnd) }.as_bool() {
                return None;
            }
            let mut place = WINDOWPLACEMENT::default();
            place.length = std::mem::size_of::<WINDOWPLACEMENT>() as u32;
            unsafe { GetWindowPlacement(hwnd, &mut place) }.ok()?;
            if set_cloak(hwnd, true).is_err() {
                return None;
            }
            let mut shown = place;
            shown.showCmd = SW_SHOWNOACTIVATE.0 as u32;
            if unsafe { SetWindowPlacement(hwnd, &shown) }.is_err() {
                let _ = set_cloak(hwnd, false);
                return None;
            }
            unsafe {
                let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
                let _ = SetWindowPos(
                    hwnd,
                    Some(HWND_BOTTOM),
                    0,
                    0,
                    0,
                    0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW,
                );
            }
            Some(Self { hwnd, place })
        }
    }

    impl Drop for CloakPeek {
        fn drop(&mut self) {
            unsafe {
                let _ = SetWindowPlacement(self.hwnd, &self.place);
            }
            let _ = set_cloak(self.hwnd, false);
        }
    }

    struct Device {
        device: ID3D11Device,
        context: ID3D11DeviceContext,
        rt: IDirect3DDevice,
    }

    struct Session {
        hwnd: usize,
        item: GraphicsCaptureItem,
        pool: Direct3D11CaptureFramePool,
        session: GraphicsCaptureSession,
        staging: Option<ID3D11Texture2D>,
        staging_w: u32,
        staging_h: u32,
        last_emit: Instant,
        pool_w: i32,
        pool_h: i32,
        peek: Option<CloakPeek>,
        peek_until: Instant,
    }

    impl Drop for Session {
        fn drop(&mut self) {
            let _ = self.session.Close();
            let _ = self.pool.Close();
            self.peek = None;
        }
    }

    pub fn run(app: AppHandle, rx: Receiver<Cmd>) {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        }
        if !GraphicsCaptureSession::IsSupported().unwrap_or(false) {
            while rx.recv().is_ok() {}
            return;
        }
        let Some(mut dev) = build_device() else {
            while rx.recv().is_ok() {}
            return;
        };
        let mut sessions: HashMap<usize, Session> = HashMap::new();
        loop {
            while let Ok(cmd) = rx.try_recv() {
                match cmd {
                    Cmd::Stop => {
                        sessions.clear();
                    }
                    Cmd::Watch(ids) => sync_sessions(&mut dev, &mut sessions, ids),
                }
            }
            if sessions.is_empty() {
                match rx.recv_timeout(Duration::from_millis(200)) {
                    Ok(Cmd::Stop) => sessions.clear(),
                    Ok(Cmd::Watch(ids)) => sync_sessions(&mut dev, &mut sessions, ids),
                    Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => return,
                    Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
                }
                continue;
            }
            let mut dead = Vec::new();
            for (id, ses) in sessions.iter_mut() {
                if !tick(&mut dev, ses, &app) {
                    dead.push(*id);
                }
            }
            for id in dead {
                sessions.remove(&id);
            }
            std::thread::sleep(TICK);
        }
    }

    fn build_device() -> Option<Device> {
        unsafe {
            let mut device = None;
            let mut context = None;
            D3D11CreateDevice(
                None,
                D3D_DRIVER_TYPE_HARDWARE,
                HMODULE::default(),
                D3D11_CREATE_DEVICE_BGRA_SUPPORT,
                None,
                D3D11_SDK_VERSION,
                Some(&mut device),
                None,
                Some(&mut context),
            )
            .ok()?;
            let device = device?;
            let context = context?;
            let dxgi: IDXGIDevice = device.cast().ok()?;
            let inspectable = CreateDirect3D11DeviceFromDXGIDevice(&dxgi).ok()?;
            let rt: IDirect3DDevice = inspectable.cast().ok()?;
            Some(Device { device, context, rt })
        }
    }

    fn sync_sessions(dev: &Device, sessions: &mut HashMap<usize, Session>, ids: Vec<usize>) {
        let want: Vec<usize> = ids.into_iter().take(MAX_SESSIONS).collect();
        sessions.retain(|k, _| want.contains(k));
        for id in want {
            if sessions.contains_key(&id) {
                continue;
            }
            if let Some(s) = start_session(dev, id) {
                sessions.insert(id, s);
            }
        }
    }

    fn start_session(dev: &Device, hwnd_raw: usize) -> Option<Session> {
        let hwnd = HWND(hwnd_raw as *mut core::ffi::c_void);
        let peek = CloakPeek::begin(hwnd);
        let peek_until = Instant::now() + PEEK_MS;
        let interop = windows::core::factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>().ok()?;
        let item: GraphicsCaptureItem = match unsafe { interop.CreateForWindow(hwnd) } {
            Ok(item) => item,
            Err(_) if peek.is_some() => {
                std::thread::sleep(Duration::from_millis(30));
                unsafe { interop.CreateForWindow(hwnd) }.ok()?
            }
            Err(_) => return None,
        };
        let mut size = item.Size().ok()?;
        if size.Width < 8 || size.Height < 8 {
            if peek.is_none() {
                return None;
            }
            size = SizeInt32 {
                Width: 320,
                Height: 200,
            };
        }
        let pool = Direct3D11CaptureFramePool::CreateFreeThreaded(
            &dev.rt,
            DirectXPixelFormat::B8G8R8A8UIntNormalized,
            2,
            size,
        )
        .ok()?;
        let session = pool.CreateCaptureSession(&item).ok()?;
        let _ = session.SetIsCursorCaptureEnabled(false);
        let _ = session.SetIsBorderRequired(false);
        session.StartCapture().ok()?;
        Some(Session {
            hwnd: hwnd_raw,
            item,
            pool,
            session,
            staging: None,
            staging_w: 0,
            staging_h: 0,
            last_emit: Instant::now() - MIN_EMIT,
            pool_w: size.Width,
            pool_h: size.Height,
            peek,
            peek_until,
        })
    }

    fn tick(dev: &mut Device, ses: &mut Session, app: &AppHandle) -> bool {
        if let Ok(size) = ses.item.Size() {
            if (size.Width != ses.pool_w || size.Height != ses.pool_h)
                && size.Width >= 8
                && size.Height >= 8
            {
                if ses
                    .pool
                    .Recreate(
                        &dev.rt,
                        DirectXPixelFormat::B8G8R8A8UIntNormalized,
                        2,
                        size,
                    )
                    .is_ok()
                {
                    ses.pool_w = size.Width;
                    ses.pool_h = size.Height;
                    ses.staging = None;
                }
            }
        }

        let mut latest = None;
        while let Ok(frame) = ses.pool.TryGetNextFrame() {
            latest = Some(frame);
        }
        let Some(frame) = latest else {
            if ses.peek.is_some() && Instant::now() >= ses.peek_until {
                ses.peek = None;
            }
            return true;
        };
        if ses.last_emit.elapsed() < MIN_EMIT {
            let _ = frame.Close();
            return true;
        }

        let before = ses.last_emit;
        let ok = emit_frame(dev, ses, &frame, app);
        let _ = frame.Close();
        if ses.last_emit != before {
            ses.peek = None;
        } else if ses.peek.is_some() && Instant::now() >= ses.peek_until {
            ses.peek = None;
        }
        ok
    }

    fn emit_frame(
        dev: &mut Device,
        ses: &mut Session,
        frame: &windows::Graphics::Capture::Direct3D11CaptureFrame,
        app: &AppHandle,
    ) -> bool {
        let surface = match frame.Surface() {
            Ok(s) => s,
            Err(_) => return false,
        };
        let access: IDirect3DDxgiInterfaceAccess = match surface.cast() {
            Ok(a) => a,
            Err(_) => return false,
        };
        let texture: ID3D11Texture2D = match unsafe { access.GetInterface::<ID3D11Texture2D>() } {
            Ok(t) => t,
            Err(_) => return false,
        };
        let mut desc = D3D11_TEXTURE2D_DESC::default();
        unsafe { texture.GetDesc(&mut desc) };
        if desc.Width < 8 || desc.Height < 8 {
            return true;
        }

        if ses.staging.is_none() || ses.staging_w != desc.Width || ses.staging_h != desc.Height {
            let mut staging_desc = desc;
            staging_desc.Usage = D3D11_USAGE_STAGING;
            staging_desc.BindFlags = 0;
            staging_desc.CPUAccessFlags = D3D11_CPU_ACCESS_READ.0 as u32;
            staging_desc.MiscFlags = 0;
            let mut staging = None;
            if unsafe {
                dev.device
                    .CreateTexture2D(&staging_desc, None, Some(&mut staging))
            }
            .is_err()
            {
                return false;
            }
            ses.staging = staging;
            ses.staging_w = desc.Width;
            ses.staging_h = desc.Height;
        }
        let Some(staging) = ses.staging.as_ref() else {
            return false;
        };

        unsafe {
            dev.context.CopyResource(staging, &texture);
        }
        let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
        if unsafe {
            dev.context
                .Map(staging, 0, D3D11_MAP_READ, 0, Some(&mut mapped))
        }
        .is_err()
        {
            return false;
        }

        let content = frame.ContentSize().ok();
        let src_w = content
            .map(|c| (c.Width.max(0) as u32).min(desc.Width))
            .unwrap_or(desc.Width)
            .max(1);
        let src_h = content
            .map(|c| (c.Height.max(0) as u32).min(desc.Height))
            .unwrap_or(desc.Height)
            .max(1);
        if ses.peek.is_some() && (src_w < 64 || src_h < 64) {
            unsafe { dev.context.Unmap(staging, 0) };
            return true;
        }
        let dst_w = DST_W.min(src_w).max(8);
        let dst_h = ((src_h as u64 * dst_w as u64) / src_w as u64).clamp(8, 200) as u32;
        let rgb = unsafe { downscale_bgra(mapped.pData as *const u8, mapped.RowPitch, src_w, src_h, dst_w, dst_h) };
        unsafe { dev.context.Unmap(staging, 0) };

        let mut jpeg = Vec::with_capacity(12_000);
        if Encoder::new(&mut jpeg, 58)
            .encode(&rgb, dst_w as u16, dst_h as u16, ColorType::Rgb)
            .is_err()
        {
            return true;
        }
        let _ = app.emit(
            "window-preview",
            PreviewFrame {
                hwnd: format!("{}", ses.hwnd),
                jpeg: b64(&jpeg),
            },
        );
        ses.last_emit = Instant::now();
        true
    }

    unsafe fn downscale_bgra(
        src: *const u8,
        pitch: u32,
        src_w: u32,
        src_h: u32,
        dst_w: u32,
        dst_h: u32,
    ) -> Vec<u8> {
        let mut out = vec![0u8; dst_w as usize * dst_h as usize * 3];
        let pitch = pitch as usize;
        for y in 0..dst_h as usize {
            let sy = y * src_h as usize / dst_h as usize;
            let row = src.add(sy * pitch);
            for x in 0..dst_w as usize {
                let sx = x * src_w as usize / dst_w as usize;
                let p = row.add(sx * 4);
                let o = (y * dst_w as usize + x) * 3;
                out[o] = *p.add(2);
                out[o + 1] = *p.add(1);
                out[o + 2] = *p;
            }
        }
        out
    }

    fn b64(data: &[u8]) -> String {
        const T: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut s = String::with_capacity((data.len() + 2) / 3 * 4);
        let mut i = 0;
        while i + 3 <= data.len() {
            let n = ((data[i] as u32) << 16) | ((data[i + 1] as u32) << 8) | data[i + 2] as u32;
            s.push(T[((n >> 18) & 63) as usize] as char);
            s.push(T[((n >> 12) & 63) as usize] as char);
            s.push(T[((n >> 6) & 63) as usize] as char);
            s.push(T[(n & 63) as usize] as char);
            i += 3;
        }
        if i < data.len() {
            let a = data[i] as u32;
            let b = if i + 1 < data.len() { data[i + 1] as u32 } else { 0 };
            let n = (a << 16) | (b << 8);
            s.push(T[((n >> 18) & 63) as usize] as char);
            s.push(T[((n >> 12) & 63) as usize] as char);
            if i + 1 < data.len() {
                s.push(T[((n >> 6) & 63) as usize] as char);
                s.push('=');
            } else {
                s.push('=');
                s.push('=');
            }
        }
        s
    }
}
