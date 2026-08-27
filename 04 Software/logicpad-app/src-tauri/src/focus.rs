//! Foreground process path. Windows is the v1 matcher; other OS return None.

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenProgram {
    pub title: String,
    pub exe: String,
    pub path: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenWindow {
    pub hwnd: String,
    pub title: String,
    pub exe: String,
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thumb_bmp: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon_bmp: Option<String>,
}

/// Visible top-level windows with a title, unique by full path (keep first title).
pub fn list_open_programs() -> Vec<OpenProgram> {
    #[cfg(windows)]
    {
        win::list_open_programs()
    }
    #[cfg(not(windows))]
    {
        Vec::new()
    }
}

/// Exe names of processes that currently have a visible top-level window.
/// Does not query window titles, so a hung UI cannot block auto-switch.
pub fn list_running_exes() -> Vec<String> {
    #[cfg(windows)]
    {
        win::list_running_exes()
    }
    #[cfg(not(windows))]
    {
        Vec::new()
    }
}

/// One card per visible window, with a small screenshot when capture works.
pub fn list_open_windows() -> Vec<OpenWindow> {
    #[cfg(windows)]
    {
        win::list_open_windows()
    }
    #[cfg(not(windows))]
    {
        Vec::new()
    }
}

#[cfg(windows)]
pub fn foreground_exe() -> Option<String> {
    win::foreground_exe()
}

#[cfg(not(windows))]
pub fn foreground_exe() -> Option<String> {
    None
}

#[cfg(windows)]
mod win {
    use super::{OpenProgram, OpenWindow};
    use std::collections::HashSet;
    use std::path::Path;
    use windows::core::PWSTR;
    use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM, TRUE};
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetForegroundWindow, GetWindow, GetWindowLongW, GetWindowThreadProcessId,
        IsHungAppWindow, IsIconic, IsWindowVisible, SendMessageTimeoutW, GW_OWNER, GWL_EXSTYLE,
        SMTO_ABORTIFHUNG, SMTO_BLOCK, WM_GETTEXT, WS_EX_TOOLWINDOW,
    };

    pub fn foreground_exe() -> Option<String> {
        unsafe {
            let hwnd = GetForegroundWindow();
            if hwnd.is_invalid() {
                return None;
            }
            image_path_for_hwnd(hwnd)
        }
    }

    pub fn list_open_programs() -> Vec<OpenProgram> {
        let self_pid = std::process::id();
        let self_path = std::env::current_exe().ok();
        let self_path_str = self_path
            .as_ref()
            .and_then(|p| p.to_str())
            .map(str::to_ascii_lowercase);

        let mut hwnds: Vec<HWND> = Vec::new();
        unsafe {
            let _ = EnumWindows(
                Some(collect_hwnds),
                LPARAM(&mut hwnds as *mut Vec<HWND> as isize),
            );
        }

        let mut seen = HashSet::<String>::new();
        let mut out = Vec::new();
        for hwnd in hwnds {
            let mut pid = 0u32;
            unsafe {
                GetWindowThreadProcessId(hwnd, Some(&mut pid));
            }
            if pid == 0 || pid == self_pid {
                continue;
            }
            if unsafe { IsHungAppWindow(hwnd) }.as_bool() {
                continue;
            }
            let Some(title) = window_title(hwnd) else {
                continue;
            };
            let Some(path) = image_path_for_pid(pid) else {
                continue;
            };
            if self_path_str
                .as_deref()
                .is_some_and(|own| path.eq_ignore_ascii_case(own))
            {
                continue;
            }
            let key = path.to_ascii_lowercase();
            if !seen.insert(key) {
                continue;
            }
            let exe = Path::new(&path)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or(path.as_str())
                .to_string();
            out.push(OpenProgram { title, exe, path });
        }
        out.sort_by(|a, b| a.title.cmp(&b.title));
        out
    }

    pub fn list_running_exes() -> Vec<String> {
        let self_pid = std::process::id();
        let self_path = std::env::current_exe().ok();
        let self_path_str = self_path
            .as_ref()
            .and_then(|p| p.to_str())
            .map(str::to_ascii_lowercase);

        let mut hwnds: Vec<HWND> = Vec::new();
        unsafe {
            let _ = EnumWindows(
                Some(collect_hwnds),
                LPARAM(&mut hwnds as *mut Vec<HWND> as isize),
            );
        }

        let mut seen = HashSet::<String>::new();
        let mut out = Vec::new();
        for hwnd in hwnds {
            let mut pid = 0u32;
            unsafe {
                GetWindowThreadProcessId(hwnd, Some(&mut pid));
            }
            if pid == 0 || pid == self_pid {
                continue;
            }
            let Some(path) = image_path_for_pid(pid) else {
                continue;
            };
            if self_path_str
                .as_deref()
                .is_some_and(|own| path.eq_ignore_ascii_case(own))
            {
                continue;
            }
            let exe = Path::new(&path)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or(path.as_str())
                .to_string();
            let key = exe.to_ascii_lowercase();
            if seen.insert(key) {
                out.push(exe);
            }
        }
        out
    }

    pub fn list_open_windows() -> Vec<OpenWindow> {
        const MAX: usize = 24;
        let self_pid = std::process::id();
        let self_path = std::env::current_exe().ok();
        let self_path_str = self_path
            .as_ref()
            .and_then(|p| p.to_str())
            .map(str::to_ascii_lowercase);

        let mut hwnds: Vec<HWND> = Vec::new();
        unsafe {
            let _ = EnumWindows(
                Some(collect_hwnds),
                LPARAM(&mut hwnds as *mut Vec<HWND> as isize),
            );
        }

        let mut out = Vec::new();
        for hwnd in hwnds {
            if out.len() >= MAX {
                break;
            }
            let Some(title) = window_title(hwnd) else {
                continue;
            };
            let mut pid = 0u32;
            unsafe {
                GetWindowThreadProcessId(hwnd, Some(&mut pid));
            }
            if pid == 0 || pid == self_pid {
                continue;
            }
            let Some(path) = image_path_for_pid(pid) else {
                continue;
            };
            if self_path_str
                .as_deref()
                .is_some_and(|own| path.eq_ignore_ascii_case(own))
            {
                continue;
            }
            let exe = Path::new(&path)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or(path.as_str())
                .to_string();
            let hung = unsafe { IsHungAppWindow(hwnd) }.as_bool();
            let iconic = unsafe { IsIconic(hwnd) }.as_bool();
            let thumb_bmp = if hung || iconic {
                None
            } else {
                capture_thumb(hwnd)
            };
            let icon_bmp = exe_icon_bmp(&path);
            out.push(OpenWindow {
                hwnd: format!("{}", hwnd.0 as usize),
                title,
                exe,
                path,
                thumb_bmp,
                icon_bmp,
            });
        }
        out.sort_by(|a, b| a.title.cmp(&b.title));
        out
    }

    fn capture_thumb(hwnd: HWND) -> Option<String> {
        use windows::Win32::Foundation::RECT;
        use windows::Win32::Graphics::Gdi::{
            CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetWindowDC,
            ReleaseDC, SelectObject, StretchBlt, HGDIOBJ, SRCCOPY,
        };
        use windows::Win32::UI::WindowsAndMessaging::GetWindowRect;
        unsafe {
            let mut rc = RECT::default();
            GetWindowRect(hwnd, &mut rc).ok()?;
            let src_w = (rc.right - rc.left).max(1);
            let src_h = (rc.bottom - rc.top).max(1);
            if src_w < 48 || src_h < 48 || src_w > 8192 || src_h > 8192 {
                return None;
            }
            let dst_w = 240i32;
            let dst_h = ((src_h as i64 * dst_w as i64) / src_w as i64).clamp(64, 150) as i32;
            let hdc_win = GetWindowDC(Some(hwnd));
            if hdc_win.is_invalid() {
                return None;
            }
            let hdc_dst = CreateCompatibleDC(Some(hdc_win));
            let bmp_dst = CreateCompatibleBitmap(hdc_win, dst_w, dst_h);
            let old_dst = SelectObject(hdc_dst, HGDIOBJ(bmp_dst.0));
            let _ = StretchBlt(
                hdc_dst,
                0,
                0,
                dst_w,
                dst_h,
                Some(hdc_win),
                0,
                0,
                src_w,
                src_h,
                SRCCOPY,
            );
            let pixels = dib_bgr(hdc_dst, bmp_dst, dst_w, dst_h);
            let _ = SelectObject(hdc_dst, old_dst);
            let _ = DeleteObject(HGDIOBJ(bmp_dst.0));
            let _ = DeleteDC(hdc_dst);
            let _ = ReleaseDC(Some(hwnd), hdc_win);
            pixels.map(|p| encode_bmp_b64(dst_w as u32, dst_h as u32, &p))
        }
    }

    fn dib_bgr(
        hdc: windows::Win32::Graphics::Gdi::HDC,
        hbmp: windows::Win32::Graphics::Gdi::HBITMAP,
        w: i32,
        h: i32,
    ) -> Option<Vec<u8>> {
        use windows::Win32::Graphics::Gdi::{
            GetDIBits, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
        };
        let stride = ((w * 3 + 3) / 4) * 4;
        let mut buf = vec![0u8; (stride * h) as usize];
        let mut info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: w,
                biHeight: h,
                biPlanes: 1,
                biBitCount: 24,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        unsafe {
            let n = GetDIBits(
                hdc,
                hbmp,
                0,
                h as u32,
                Some(buf.as_mut_ptr() as *mut _),
                &mut info,
                DIB_RGB_COLORS,
            );
            if n == 0 {
                None
            } else {
                Some(buf)
            }
        }
    }

    fn exe_icon_bmp(path: &str) -> Option<String> {
        use windows::core::PCWSTR;
        use windows::Win32::Graphics::Gdi::{
            CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, ReleaseDC,
            SelectObject, HGDIOBJ,
        };
        use windows::Win32::UI::Shell::ExtractIconExW;
        use windows::Win32::UI::WindowsAndMessaging::{DestroyIcon, DrawIconEx, DI_NORMAL};
        let wide: Vec<u16> = path.encode_utf16().chain(std::iter::once(0)).collect();
        let mut large = [windows::Win32::UI::WindowsAndMessaging::HICON::default()];
        unsafe {
            let n = ExtractIconExW(PCWSTR(wide.as_ptr()), 0, Some(large.as_mut_ptr()), None, 1);
            if n == 0 || large[0].is_invalid() {
                return None;
            }
            let icon = large[0];
            let hdc_scr = GetDC(None);
            let hdc = CreateCompatibleDC(Some(hdc_scr));
            let bmp = CreateCompatibleBitmap(hdc_scr, 32, 32);
            let old = SelectObject(hdc, HGDIOBJ(bmp.0));
            let _ = DrawIconEx(hdc, 0, 0, icon, 32, 32, 0, None, DI_NORMAL);
            let pixels = dib_bgr(hdc, bmp, 32, 32);
            let _ = SelectObject(hdc, old);
            let _ = DeleteObject(HGDIOBJ(bmp.0));
            let _ = DeleteDC(hdc);
            let _ = ReleaseDC(None, hdc_scr);
            let _ = DestroyIcon(icon);
            pixels.map(|p| encode_bmp_b64(32, 32, &p))
        }
    }

    fn encode_bmp_b64(w: u32, h: u32, pixels: &[u8]) -> String {
        let stride = ((w * 3 + 3) / 4) * 4;
        let pixel_size = stride * h;
        let file_size = 54 + pixel_size;
        let mut out = Vec::with_capacity(file_size as usize);
        out.extend_from_slice(b"BM");
        out.extend_from_slice(&file_size.to_le_bytes());
        out.extend_from_slice(&0u32.to_le_bytes());
        out.extend_from_slice(&54u32.to_le_bytes());
        out.extend_from_slice(&40u32.to_le_bytes());
        out.extend_from_slice(&w.to_le_bytes());
        out.extend_from_slice(&h.to_le_bytes());
        out.extend_from_slice(&1u16.to_le_bytes());
        out.extend_from_slice(&24u16.to_le_bytes());
        out.extend_from_slice(&0u32.to_le_bytes());
        out.extend_from_slice(&pixel_size.to_le_bytes());
        out.extend_from_slice(&0u32.to_le_bytes());
        out.extend_from_slice(&0u32.to_le_bytes());
        out.extend_from_slice(&0u32.to_le_bytes());
        out.extend_from_slice(&0u32.to_le_bytes());
        if pixels.len() >= pixel_size as usize {
            out.extend_from_slice(&pixels[..pixel_size as usize]);
        } else {
            out.extend_from_slice(pixels);
            out.resize(file_size as usize, 0);
        }
        b64(&out)
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

    unsafe extern "system" fn collect_hwnds(hwnd: HWND, lparam: LPARAM) -> windows::core::BOOL {
        let hwnds = unsafe { &mut *(lparam.0 as *mut Vec<HWND>) };
        if unsafe { is_top_level_app(hwnd) } {
            hwnds.push(hwnd);
        }
        TRUE
    }

    unsafe fn is_top_level_app(hwnd: HWND) -> bool {
        if hwnd.is_invalid() || !unsafe { IsWindowVisible(hwnd) }.as_bool() {
            return false;
        }
        let owner = unsafe { GetWindow(hwnd, GW_OWNER) }.unwrap_or_default();
        if !owner.is_invalid() {
            return false;
        }
        let ex = unsafe { GetWindowLongW(hwnd, GWL_EXSTYLE) } as u32;
        if ex & WS_EX_TOOLWINDOW.0 != 0 {
            return false;
        }
        true
    }

    /// Timed WM_GETTEXT. GetWindowTextW waits forever if the target is hung.
    fn window_title(hwnd: HWND) -> Option<String> {
        use windows::Win32::Foundation::{LPARAM, WPARAM};
        let mut buf = [0u16; 512];
        let mut result = 0usize;
        let sent = unsafe {
            SendMessageTimeoutW(
                hwnd,
                WM_GETTEXT,
                WPARAM(buf.len()),
                LPARAM(buf.as_mut_ptr() as isize),
                SMTO_ABORTIFHUNG | SMTO_BLOCK,
                50,
                Some(&mut result),
            )
        };
        if sent.0 == 0 || result == 0 {
            return None;
        }
        let n = result.min(buf.len());
        let end = buf[..n].iter().position(|&c| c == 0).unwrap_or(n);
        let title = String::from_utf16_lossy(&buf[..end]);
        let title = title.trim();
        if title.is_empty() {
            None
        } else {
            Some(title.to_string())
        }
    }

    fn image_path_for_hwnd(hwnd: HWND) -> Option<String> {
        let mut pid = 0u32;
        unsafe {
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
        }
        image_path_for_pid(pid)
    }

    fn image_path_for_pid(pid: u32) -> Option<String> {
        if pid == 0 {
            return None;
        }
        unsafe {
            let proc = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
            let mut buf = [0u16; 1024];
            let mut size = buf.len() as u32;
            let ok = QueryFullProcessImageNameW(
                proc,
                PROCESS_NAME_WIN32,
                PWSTR(buf.as_mut_ptr()),
                &mut size,
            );
            let _ = CloseHandle(proc);
            if ok.is_err() {
                return None;
            }
            let len = buf.iter().position(|&c| c == 0).unwrap_or(size as usize);
            let path = String::from_utf16_lossy(&buf[..len]);
            if path.is_empty() {
                None
            } else {
                Some(path)
            }
        }
    }
}
