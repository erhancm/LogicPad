# LogicPad — agent continuation

Read this first on a new machine or new chat. Conversation history does not travel with git.

## Where we are (2026-08-16, `development`)

Firmware v0.1 is in `03 Firmware/Firmware/` and builds (`CMake` preset `Release`, `LogicPad.elf` at `0x08001000`). It is a plug-and-use USB HID macro pad with a full OLED editor. Hardware and enclosure are **done** (`02 Electronics/V0.2`) — do not respin the board.

**Next:** own VID/PID / branding. Firmware field update is in (`03 Firmware/bootloader/` + Tauri **Update firmware**).

Tracker: [`03 Firmware/Firmware/PROJECT_PROGRESS_TRACKER.md`](03%20Firmware/Firmware/PROJECT_PROGRESS_TRACKER.md).

## Product (locked)

- **Daily use:** plug USB in. Inbox OS HID keyboard/mouse/media. No installer, no driver, no Python, no app required.
- **On-device config:** 0.96" SSD1306 128×64. Profiles, keys, macros, lights, screen. Home/sleep is a 24-hour clock with seconds.
- **Optional PC/Mac/Linux app:** one codebase — **Tauri 2 + React (or similar) + Rust hidapi**. Not Python, not Electron, not browser-only WebHID (WKWebView has no WebHID).
- App-only extra: live-record of **host** keys, backup/restore, big-screen editor, **launch a PC program** from a pad key (drag a file onto the key; app must be running; mapping is local JSON, not flash). Typed strings live in a 1200-byte flash pool on the pad and are one step in that key’s macro (so Enter or a chord can follow).
- All nine pad keys are macros. Selector is **not** a 10th macro. Factory: empty labels and empty actions (no assigned keys). Flash magic `LP_MAGIC` `0x4C504148` (`LPAH`) so older stores without 12-character key titles are discarded on boot.
- Live: SEL short = menu, SEL long = home. Keys 0–8 fire their macros (empty = no-op toast).
- Menus: d-pad — key 1 up, key 7 down, key 3 left, key 5 right, key 4 OK. SEL short = Back. SEL long = Home. Corners unused except macro list: key 2 add, key 8 delete. Save prompt: OK = yes, SEL = no.
- Out of v1: QMK/VIA, kernel drivers, Python GUI, Electron.

## Hardware truth

MCU STM32F103C8, 64 KB flash / 20 KB RAM. **4 KB HID bootloader** at `0x08000000`. App linker FLASH is **52 KB** at `0x08001000`. Last 8 KB ping-pong store at `0x0800E000`. Debug is `-Os -g3` so the app still fits beside the bootloader.

Pinout: [`01 Documentation/Pinout.md`](01%20Documentation/Pinout.md) and `Pinout.pdf`. Columns PB3/4/5 **outputs** (idle high, drive low to scan). Rows PB12/13/14 **inputs pull-up**. Selector PB15 pull-up. OLED I2C1 PB6/PB7 addr `0x78`. SWJ is already `NOJTAG`.

Do **not** copy scan polarity from `03 Firmware/Outdated testing dev fw/` (that driver is row-drive). Port OLED fonts/driver only.

Do **not** regenerate CubeMX over USER CODE. Rows must stay inputs.

## Firmware map

| Piece | Files |
|-------|--------|
| Main loop 1 ms | `Core/Src/main.c` |
| UI | `Core/Src/ui.c` |
| Keypad | `Core/Src/keypad.c` |
| Macros | `Core/Src/macro.c` |
| Flash | `Core/Src/storage.c` (`storage.h` schema) |
| HID | `Core/Src/hid_reports.c`, `USB_DEVICE/App/usbd_custom_hid_if.c` |
| RGB mux | `Core/Src/led_mux.c` |
| HID bootloader | `03 Firmware/bootloader/` (4 KB, PID `0x5751`) |
| Flash map | `Core/Inc/lp_memmap.h` |

HID reports: 1 keyboard, 2 mouse, 3 consumer, 4 vendor (64-byte). Protocol: [`01 Documentation/HID_PROTOCOL.md`](01%20Documentation/HID_PROTOCOL.md). OLED screens/nav: [`01 Documentation/OLED_UI.md`](01%20Documentation/OLED_UI.md). `ui.c` is the look-and-feel source of truth in-repo (the Cursor canvas mockup is local-only and not in git).

USB still uses ST test VID/PID 1155/22352 (app). Bootloader is the same VID, PID 22353 (`0x5751`), product string LogicPad Boot. First ST-Link flash is `LogicPad_factory.hex`. Later updates are `LogicPad.bin` via the Tauri app. Recovery: hold SEL on plug-in. Bootloader OLED (**BOOT** / **USB FLASH**) only updates with a factory hex; the app `.bin` shows **FLASH** / **BOOT MODE** then resets.

## App (when you start it)

Path: `04 Software/logicpad-app/`. Same `lp_store_t` / key structs as flash. HID via Rust hidapi filtered to vendor report 4 (Windows skips the keyboard/mouse collections) so the pad keeps typing. **Update firmware** sends the app `.bin` to the HID bootloader. Linux: udev rule in the app README (include PID `5751`), not a custom driver.

Daily Windows use: installed **LogicPad** (`%LOCALAPPDATA%\LogicPad\LogicPad.exe`) — Start menu or desktop shortcut, no terminal. Rebuild with `npm run build:app` or double-click `Build LogicPad.bat`. `npm run tauri dev` is only for live development.

**After app or HID/firmware-protocol changes, also reinstall that Start-menu copy** (close `LogicPad.exe`, `npm run build:app`, then `LogicPad_0.1.0_x64-setup.exe /S`). Do not leave the installed program stale.

## Do not

- Treat `PROJECT_PROGRESS_TRACKER.md` as stale if it conflicts with this file — this file wins on product locks; the tracker wins on checklist ticks.
- Add Python/PySide or Electron.
- Treat the nine pad keys as anything other than macros (Selector is the only non-macro).
- Assign factory default chords (Copy/Paste/etc.); keys start empty.
- Commit `.vscode`, `.clangd`, `.mxproject`, Cube `.settings` unless the user asks.
