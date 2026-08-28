//! Host session: unlocked and logged-on vs locked / logged off / switched away.

use crate::hid::Pad;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;

static AWAY: AtomicBool = AtomicBool::new(false);

pub fn spawn(pad: Arc<Mutex<Pad>>) {
    #[cfg(windows)]
    thread::spawn(move || win::run(pad));
    #[cfg(not(windows))]
    let _ = pad;
}

pub fn is_present() -> bool {
    if AWAY.load(Ordering::SeqCst) {
        return false;
    }
    #[cfg(windows)]
    {
        win::session_present()
    }
    #[cfg(not(windows))]
    {
        true
    }
}

#[cfg(windows)]
mod win {
    use super::*;
    use windows::core::w;
    use windows::Win32::Foundation::{GetLastError, HANDLE, HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::System::RemoteDesktop::{
        WTSFreeMemory, WTSQuerySessionInformationW, WTSRegisterSessionNotification,
        WTSUnRegisterSessionNotification, WTSConnectState, WTS_CURRENT_SESSION,
        WTSINFOEXW, WTSSessionInfoEx, WTS_SESSIONSTATE_LOCK,
        NOTIFY_FOR_THIS_SESSION,
    };
    use windows::Win32::System::StationsAndDesktops::{
        CloseDesktop, GetUserObjectInformationW, OpenInputDesktop, DESKTOP_CONTROL_FLAGS,
        DESKTOP_READOBJECTS, UOI_NAME,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW,
        GetWindowLongPtrW, PostQuitMessage, RegisterClassW, SetWindowLongPtrW, TranslateMessage,
        CREATESTRUCTW, CS_HREDRAW, CS_VREDRAW, GWLP_USERDATA, HWND_MESSAGE, MSG, WINDOW_EX_STYLE,
        WM_DESTROY, WM_ENDSESSION, WM_NCCREATE, WM_QUERYENDSESSION, WNDCLASSW, WS_OVERLAPPED,
        WM_WTSSESSION_CHANGE,
    };

    const WTS_CONSOLE_CONNECT: usize = 0x1;
    const WTS_CONSOLE_DISCONNECT: usize = 0x2;
    const WTS_SESSION_LOGON: usize = 0x5;
    const WTS_SESSION_LOGOFF: usize = 0x6;
    const WTS_SESSION_LOCK: usize = 0x7;
    const WTS_SESSION_UNLOCK: usize = 0x8;
    const WTS_ACTIVE: i32 = 0;

    pub fn session_present() -> bool {
        if workstation_locked() {
            return false;
        }
        match connect_state() {
            Some(WTS_ACTIVE) => true,
            Some(_) => false,
            None => true,
        }
    }

    fn workstation_locked() -> bool {
        if let Some(locked) = session_locked_wts() {
            return locked;
        }
        input_desktop_is_winlogon()
    }

    fn session_locked_wts() -> Option<bool> {
        unsafe {
            let mut buf = windows::core::PWSTR::null();
            let mut bytes = 0u32;
            WTSQuerySessionInformationW(
                None,
                WTS_CURRENT_SESSION,
                WTSSessionInfoEx,
                &mut buf,
                &mut bytes,
            )
            .ok()?;
            if buf.is_null() || bytes < std::mem::size_of::<WTSINFOEXW>() as u32 {
                if !buf.is_null() {
                    WTSFreeMemory(buf.0.cast());
                }
                return None;
            }
            let info = buf.0.cast::<WTSINFOEXW>().read();
            let locked = if info.Level == 1 {
                let flags = info.Data.WTSInfoExLevel1.SessionFlags;
                flags == WTS_SESSIONSTATE_LOCK as i32
            } else {
                None?
            };
            WTSFreeMemory(buf.0.cast());
            Some(locked)
        }
    }

    fn input_desktop_is_winlogon() -> bool {
        unsafe {
            let Ok(desk) = OpenInputDesktop(DESKTOP_CONTROL_FLAGS(0), false, DESKTOP_READOBJECTS) else {
                return true;
            };
            let mut buf = [0u16; 64];
            let mut needed = 0u32;
            let ok = GetUserObjectInformationW(
                HANDLE(desk.0),
                UOI_NAME,
                Some(buf.as_mut_ptr().cast()),
                (buf.len() * 2) as u32,
                Some(&mut needed),
            )
            .is_ok();
            let _ = CloseDesktop(desk);
            if !ok {
                return true;
            }
            let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
            let name = String::from_utf16_lossy(&buf[..len]);
            name.eq_ignore_ascii_case("Winlogon")
        }
    }

    fn connect_state() -> Option<i32> {
        unsafe {
            let mut buf = windows::core::PWSTR::null();
            let mut bytes = 0u32;
            WTSQuerySessionInformationW(
                None,
                WTS_CURRENT_SESSION,
                WTSConnectState,
                &mut buf,
                &mut bytes,
            )
            .ok()?;
            if buf.is_null() || bytes < 4 {
                return None;
            }
            let state = buf.0.cast::<i32>().read();
            WTSFreeMemory(buf.0.cast());
            Some(state)
        }
    }

    fn push_away(pad: &Mutex<Pad>) {
        AWAY.store(true, Ordering::SeqCst);
        if let Ok(g) = pad.try_lock() {
            let _ = g.set_host(false);
        }
    }

    fn push_present(pad: &Mutex<Pad>) {
        AWAY.store(false, Ordering::SeqCst);
        if let Ok(g) = pad.try_lock() {
            let _ = g.set_host(true);
        }
    }

    pub fn run(pad: Arc<Mutex<Pad>>) {
        let leaked = Box::into_raw(Box::new(pad));
        if !unsafe { message_loop(leaked) } {
            unsafe {
                let _ = Box::from_raw(leaked);
            }
        }
    }

    unsafe fn message_loop(pad: *mut Arc<Mutex<Pad>>) -> bool {
        let class = w!("LogicPadHostWatch");
        let hinst = GetModuleHandleW(None).unwrap_or_default();
        let wc = WNDCLASSW {
            style: CS_HREDRAW | CS_VREDRAW,
            lpfnWndProc: Some(wndproc),
            hInstance: hinst.into(),
            lpszClassName: class,
            ..Default::default()
        };
        if RegisterClassW(&wc) == 0 {
            const ERROR_CLASS_ALREADY_EXISTS: u32 = 1410;
            if GetLastError().0 != ERROR_CLASS_ALREADY_EXISTS {
                return false;
            }
        }
        let hwnd = match CreateWindowExW(
            WINDOW_EX_STYLE::default(),
            class,
            w!("LogicPadHost"),
            WS_OVERLAPPED,
            0,
            0,
            0,
            0,
            Some(HWND_MESSAGE),
            None,
            Some(hinst.into()),
            Some(pad.cast()),
        ) {
            Ok(h) => h,
            Err(_) => return false,
        };
        if hwnd.0.is_null() {
            return false;
        }
        let _ = WTSRegisterSessionNotification(hwnd, NOTIFY_FOR_THIS_SESSION);
        let mut msg = MSG::default();
        while GetMessageW(&mut msg, None, 0, 0).as_bool() {
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
        true
    }

    unsafe extern "system" fn wndproc(hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
        if msg == WM_NCCREATE {
            let cs = lp.0 as *const CREATESTRUCTW;
            if !cs.is_null() {
                SetWindowLongPtrW(hwnd, GWLP_USERDATA, (*cs).lpCreateParams as isize);
            }
            return DefWindowProcW(hwnd, msg, wp, lp);
        }
        let pad = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut Arc<Mutex<Pad>>;
        match msg {
            WM_WTSSESSION_CHANGE => {
                match wp.0 {
                    WTS_SESSION_LOCK | WTS_CONSOLE_DISCONNECT | WTS_SESSION_LOGOFF => {
                        if !pad.is_null() {
                            push_away(&**pad);
                        } else {
                            AWAY.store(true, Ordering::SeqCst);
                        }
                    }
                    WTS_SESSION_UNLOCK | WTS_CONSOLE_CONNECT | WTS_SESSION_LOGON => {
                        if !pad.is_null() {
                            push_present(&**pad);
                        } else {
                            AWAY.store(false, Ordering::SeqCst);
                        }
                    }
                    _ => {}
                }
                LRESULT(0)
            }
            WM_QUERYENDSESSION | WM_ENDSESSION => {
                if !pad.is_null() {
                    push_away(&**pad);
                }
                if msg == WM_QUERYENDSESSION {
                    LRESULT(1)
                } else {
                    DefWindowProcW(hwnd, msg, wp, lp)
                }
            }
            WM_DESTROY => {
                let _ = WTSUnRegisterSessionNotification(hwnd);
                if !pad.is_null() {
                    let _ = Box::from_raw(pad);
                    SetWindowLongPtrW(hwnd, GWLP_USERDATA, 0);
                }
                PostQuitMessage(0);
                LRESULT(0)
            }
            _ => DefWindowProcW(hwnd, msg, wp, lp),
        }
    }
}
