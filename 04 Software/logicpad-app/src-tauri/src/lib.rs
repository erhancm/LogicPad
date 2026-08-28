mod file_dialog;
mod focus;
mod hid;
mod host;
mod launch;
mod preview;
mod profile_switch;
mod sim;
mod switch_graph;

use hid::{Meta, Pad, PadInfo, PadKey, ProfileHdr, Snapshot};
use launch::{LaunchEntry, LaunchStore, ResolvedProgram};
use profile_switch::{ActiveEvt, SwitchConfig, SwitchStore};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_autostart::ManagerExt;

struct AppPad(Arc<Mutex<Pad>>);

#[tauri::command]
fn connect(pad: State<AppPad>) -> Result<(), String> {
    pad.0.lock().map_err(|e| e.to_string())?.connect().map_err(Into::into)
}

#[tauri::command]
fn connect_to(pad: State<AppPad>, id: String) -> Result<(), String> {
    pad.0
        .lock()
        .map_err(|e| e.to_string())?
        .connect_to(&id)
        .map_err(Into::into)
}

#[tauri::command]
fn list_pads(pad: State<AppPad>) -> Vec<PadInfo> {
    pad.0.lock().map(|g| g.list_pads()).unwrap_or_else(|_| {
        vec![PadInfo {
            id: crate::sim::SIM_ID.into(),
            kind: "simulated".into(),
            label: crate::sim::SIM_LABEL.into(),
            serial: None,
            simulated: true,
            selected: false,
        }]
    })
}

#[tauri::command]
fn current_pad(pad: State<AppPad>) -> PadInfo {
    pad.0
        .lock()
        .map(|g| g.current_pad())
        .unwrap_or_else(|_| PadInfo {
            id: crate::sim::SIM_ID.into(),
            kind: "simulated".into(),
            label: crate::sim::SIM_LABEL.into(),
            serial: None,
            simulated: true,
            selected: true,
        })
}

#[tauri::command]
fn disconnect(pad: State<AppPad>) {
    if let Ok(g) = pad.0.lock() {
        g.disconnect();
    }
}

#[tauri::command]
fn is_connected(pad: State<AppPad>) -> bool {
    pad.0.lock().map(|g| g.connected()).unwrap_or(false)
}

#[tauri::command]
fn ping(pad: State<AppPad>) -> Result<(u8, u8), String> {
    pad.0.lock().map_err(|e| e.to_string())?.ping().map_err(Into::into)
}

#[tauri::command]
fn get_meta(pad: State<AppPad>) -> Result<Meta, String> {
    pad.0.lock().map_err(|e| e.to_string())?.get_meta().map_err(Into::into)
}

#[tauri::command]
fn load_pad(pad: State<AppPad>) -> Result<Snapshot, String> {
    pad.0.lock().map_err(|e| e.to_string())?.load_all().map_err(Into::into)
}

#[tauri::command]
fn apply_key(pad: State<AppPad>, key: PadKey) -> Result<(), String> {
    pad.0.lock().map_err(|e| e.to_string())?.set_key(&key).map_err(Into::into)
}

#[tauri::command]
fn apply_profile(pad: State<AppPad>, hdr: ProfileHdr) -> Result<(), String> {
    pad.0.lock().map_err(|e| e.to_string())?.set_profile(&hdr).map_err(Into::into)
}

#[tauri::command]
fn set_active(pad: State<AppPad>, profile: u8) -> Result<(), String> {
    pad.0
        .lock()
        .map_err(|e| e.to_string())?
        .set_active(profile)
        .map_err(Into::into)
}

#[tauri::command]
fn add_profile(pad: State<AppPad>) -> Result<Snapshot, String> {
    let g = pad.0.lock().map_err(|e| e.to_string())?;
    let idx = g.add_profile().map_err(Into::<String>::into)?;
    g.set_active(idx).map_err(Into::<String>::into)?;
    g.load_all().map_err(Into::into)
}

#[tauri::command]
fn delete_profile(
    app: AppHandle,
    pad: State<AppPad>,
    store: State<Arc<LaunchStore>>,
    switch: State<Arc<SwitchStore>>,
    profile: u8,
) -> Result<Snapshot, String> {
    let g = pad.0.lock().map_err(|e| e.to_string())?;
    g.del_profile(profile).map_err(Into::<String>::into)?;
    drop(g);
    store.shift_after_delete(profile)?;
    switch.shift_after_delete(profile)?;
    sync_autostart(&app, &store, &switch);
    pad.0
        .lock()
        .map_err(|e| e.to_string())?
        .load_all()
        .map_err(Into::into)
}

#[tauri::command]
fn save_store(pad: State<AppPad>) -> Result<(), String> {
    pad.0.lock().map_err(|e| e.to_string())?.save().map_err(Into::into)
}

#[tauri::command]
fn reload_store(pad: State<AppPad>) -> Result<Snapshot, String> {
    let g = pad.0.lock().map_err(|e| e.to_string())?;
    g.reload().map_err(Into::<String>::into)?;
    g.load_all().map_err(Into::into)
}

#[tauri::command]
fn factory_reset(pad: State<AppPad>) -> Result<Snapshot, String> {
    let g = pad.0.lock().map_err(|e| e.to_string())?;
    g.factory().map_err(Into::<String>::into)?;
    g.load_all().map_err(Into::into)
}

#[tauri::command]
fn set_screen(
    pad: State<AppPad>,
    contrast: u8,
    flip: u8,
    sleep: u8,
) -> Result<(), String> {
    pad.0
        .lock()
        .map_err(|e| e.to_string())?
        .set_screen(contrast, flip, sleep)
        .map_err(Into::into)
}

#[tauri::command]
fn set_time(
    pad: State<AppPad>,
    year: u16,
    month: u8,
    day: u8,
    hour: u8,
    minute: u8,
    second: u8,
) -> Result<(), String> {
    pad.0
        .lock()
        .map_err(|e| e.to_string())?
        .set_time(year, month, day, hour, minute, second)
        .map_err(Into::into)
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct FlashProgress {
    phase: String,
    done: u32,
    total: u32,
}

#[tauri::command]
fn flash_firmware(app: tauri::AppHandle, pad: State<AppPad>, data: Vec<u8>) -> Result<(), String> {
    pad.0
        .lock()
        .map_err(|e| e.to_string())?
        .flash_firmware(&data, |phase, done, total| {
            let _ = app.emit(
                "flash-progress",
                FlashProgress {
                    phase: phase.to_string(),
                    done,
                    total,
                },
            );
        })
        .map_err(Into::into)
}

#[tauri::command]
fn get_launches(store: State<Arc<LaunchStore>>) -> Vec<LaunchEntry> {
    store.list()
}

#[tauri::command]
fn set_launch(
    app: AppHandle,
    store: State<Arc<LaunchStore>>,
    switch: State<Arc<SwitchStore>>,
    entry: LaunchEntry,
) -> Result<(), String> {
    store.set(entry)?;
    sync_autostart(&app, &store, &switch);
    Ok(())
}

#[tauri::command]
fn pick_program() -> Option<String> {
    launch::pick_program()
}

#[tauri::command]
fn list_open_programs() -> Vec<focus::OpenProgram> {
    focus::list_open_programs()
}

#[tauri::command]
fn list_open_windows() -> Vec<focus::OpenWindow> {
    focus::list_open_windows()
}

#[tauri::command]
fn watch_window_previews(hub: State<preview::PreviewHub>, hwnds: Vec<String>) {
    hub.watch(hwnds);
}

#[tauri::command]
fn stop_window_previews(hub: State<preview::PreviewHub>) {
    hub.stop();
}

#[tauri::command]
fn resolve_program(path: String) -> ResolvedProgram {
    launch::resolve_program(&path)
}

#[tauri::command]
fn get_switch_rules(switch: State<Arc<SwitchStore>>) -> SwitchConfig {
    switch.config()
}

#[tauri::command]
fn set_switch_rules(
    app: AppHandle,
    store: State<Arc<LaunchStore>>,
    switch: State<Arc<SwitchStore>>,
    cfg: SwitchConfig,
) -> Result<SwitchConfig, String> {
    let next = switch.set_config(cfg)?;
    sync_autostart(&app, &store, &switch);
    Ok(next)
}

#[tauri::command]
fn add_switch_program(
    app: AppHandle,
    pad: State<AppPad>,
    store: State<Arc<LaunchStore>>,
    switch: State<Arc<SwitchStore>>,
    profile: u8,
    path: String,
) -> Result<SwitchConfig, String> {
    let next = switch.add_program(profile, &path)?;
    sync_autostart(&app, &store, &switch);
    if let Ok(g) = pad.0.lock() {
        if g.connected() && g.set_active(profile).is_ok() {
            let _ = app.emit("active-profile", ActiveEvt { profile });
        }
    }
    Ok(next)
}

#[tauri::command]
fn save_text_file(name: String, contents: String) -> Option<String> {
    file_dialog::save_text_file(&name, &contents)
}

#[tauri::command]
fn load_text_file() -> Option<(String, String)> {
    file_dialog::load_text_file()
}

#[tauri::command]
fn remove_switch_program(
    app: AppHandle,
    store: State<Arc<LaunchStore>>,
    switch: State<Arc<SwitchStore>>,
    exe: String,
) -> Result<SwitchConfig, String> {
    let next = switch.remove_program(&exe)?;
    sync_autostart(&app, &store, &switch);
    Ok(next)
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct KeyEvt {
    profile: u8,
    key: u8,
    down: bool,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let pad = Pad::new().expect("hidapi");
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main(app);
        }))
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--hidden".into()]),
        ))
        .manage(AppPad(Arc::new(Mutex::new(pad))))
        .invoke_handler(tauri::generate_handler![
            connect,
            connect_to,
            list_pads,
            current_pad,
            disconnect,
            is_connected,
            ping,
            get_meta,
            load_pad,
            apply_key,
            apply_profile,
            set_active,
            add_profile,
            delete_profile,
            save_store,
            reload_store,
            factory_reset,
            set_screen,
            set_time,
            flash_firmware,
            get_launches,
            set_launch,
            pick_program,
            list_open_programs,
            list_open_windows,
            watch_window_previews,
            stop_window_previews,
            resolve_program,
            get_switch_rules,
            set_switch_rules,
            add_switch_program,
            remove_switch_program,
            save_text_file,
            load_text_file
        ])
        .setup(|app| {
            let dir = app.path().app_config_dir().unwrap_or_else(|_| std::env::temp_dir());
            let store = Arc::new(LaunchStore::load(dir.join("launches.json")));
            let switch = Arc::new(SwitchStore::load(dir.join("profile-rules.json")));
            app.manage(store.clone());
            app.manage(switch.clone());
            app.manage(preview::spawn(app.handle().clone()));
            sync_autostart(app.handle(), &store, &switch);

            let handle = app.handle().clone();
            {
                let pad = app.state::<AppPad>();
                let g = pad.0.lock().expect("pad");
                g.set_config_dir(&dir);
                g.set_on_key(Arc::new(move |profile, key, down| {
                    if down {
                        if let Err(e) = store.launch(profile, key) {
                            let _ = handle.emit("launch-error", e);
                        }
                    }
                    let _ = handle.emit(
                        "pad-key",
                        KeyEvt {
                            profile,
                            key,
                            down,
                        },
                    );
                }));
                let _ = g.connect();
            }

            build_tray(app.handle())?;
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.set_always_on_top(false);
                if std::env::args().any(|a| a == "--hidden") {
                    let _ = w.hide();
                }
            }
            let retry = app.handle().clone();
            host::spawn(app.state::<AppPad>().0.clone());
            std::thread::spawn(move || {
                let mut n = 0u32;
                let mut last_host: Option<bool> = None;
                let mut last_ids = String::new();
                loop {
                    std::thread::sleep(Duration::from_millis(250));
                    n = n.wrapping_add(1);
                    if n % 8 == 0 {
                        if let Ok(g) = retry.state::<AppPad>().0.try_lock() {
                            let switched = g.maintain().unwrap_or(false);
                            if switched {
                                retry.state::<Arc<SwitchStore>>().reset_seen();
                                last_host = None;
                                let _ = retry.emit("pad-session", g.current_pad());
                            }
                            let pads = g.list_pads();
                            let ids: String = pads.iter().map(|p| p.id.as_str()).collect::<Vec<_>>().join("|");
                            if switched || ids != last_ids {
                                last_ids = ids;
                                let _ = retry.emit("pads", pads);
                            }
                        }
                    }
                    let pending = retry.state::<Arc<SwitchStore>>().poll(&retry);
                    if let Ok(g) = retry.state::<AppPad>().0.try_lock() {
                        if let Some((exe, running)) = pending {
                            retry
                                .state::<Arc<SwitchStore>>()
                                .apply(&g, &retry, exe, running);
                        }
                        if g.connected() && !g.is_simulated() {
                            let present = host::is_present();
                            if last_host != Some(present) && g.set_host(present).is_ok() {
                                last_host = Some(present);
                            }
                        }
                    }
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            match event {
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    let _ = window.hide();
                }
                tauri::WindowEvent::Focused(_) => {
                    let _ = window.set_always_on_top(false);
                }
                _ => {}
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running LogicPad");
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.set_always_on_top(false);
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        let _ = w.set_always_on_top(false);
    }
}

fn sync_autostart(app: &AppHandle, store: &LaunchStore, switch: &SwitchStore) {
    let _ = if store.has_launches() || switch.wants_autostart() {
        app.autolaunch().enable()
    } else {
        app.autolaunch().disable()
    };
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Open LogicPad", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;
    let icon = app
        .default_window_icon()
        .cloned()
        .expect("window icon");
    TrayIconBuilder::with_id("main")
        .icon(icon)
        .tooltip("LogicPad")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => show_main(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}
