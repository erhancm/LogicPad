//! Foreground process path. Windows is the v1 matcher; other OS return None.

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenProgram {
    pub title: String,
    pub exe: String,
    pub path: String,
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
    use super::OpenProgram;
    use std::collections::HashSet;
    use std::path::Path;
    use windows::core::PWSTR;
    use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM, TRUE};
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetForegroundWindow, GetWindow, GetWindowLongW, GetWindowTextW,
        GetWindowThreadProcessId, IsWindowVisible, GW_OWNER, GWL_EXSTYLE, WS_EX_TOOLWINDOW,
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

    unsafe extern "system" fn collect_hwnds(hwnd: HWND, lparam: LPARAM) -> windows::core::BOOL {
        let hwnds = unsafe { &mut *(lparam.0 as *mut Vec<HWND>) };
        if unsafe { is_app_window(hwnd) } {
            hwnds.push(hwnd);
        }
        TRUE
    }

    unsafe fn is_app_window(hwnd: HWND) -> bool {
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
        window_title(hwnd).is_some()
    }

    fn window_title(hwnd: HWND) -> Option<String> {
        let mut buf = [0u16; 512];
        let n = unsafe { GetWindowTextW(hwnd, &mut buf) };
        if n <= 0 {
            return None;
        }
        let title = String::from_utf16_lossy(&buf[..n as usize]);
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
