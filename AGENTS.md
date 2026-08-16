# LogicPad — agent continuation

Read this first on a new machine or new chat. Conversation history does not travel with git.

## Where we are (2026-08-16, `development`)

Firmware v0.1 is in `03 Firmware/Firmware/` and builds (`CMake` preset `Debug`, `LogicPad.elf`). It is a plug-and-use USB HID macro pad with a full OLED editor. Hardware and enclosure are **done** (`02 Electronics/V0.2`) — do not respin the board.

**Next:** Tauri 2 configurator (`04 Software/logicpad-app/`, not created yet), then own VID/PID / branding.

Tracker: [`03 Firmware/Firmware/PROJECT_PROGRESS_TRACKER.md`](03%20Firmware/Firmware/PROJECT_PROGRESS_TRACKER.md).

## Product (locked)

- **Daily use:** plug USB in. Inbox OS HID keyboard/mouse/media. No installer, no driver, no Python, no app required.
- **On-device config:** 0.96" SSD1306 128×64. Profiles, keys, macros, lights, screen.
- **Optional PC/Mac/Linux app:** one codebase — **Tauri 2 + React (or similar) + Rust hidapi**. Not Python, not Electron, not browser-only WebHID (WKWebView has no WebHID).
- App-only extra: live-record of **host** keys, backup/restore, big-screen editor.
- Selector is **not** a 10th macro. Live: SEL short = menu, SEL long = home. Menus: **Left = Back** (same as SEL short).
- Out of v1: QMK/VIA, kernel drivers, DFU/field firmware update, Python GUI, Electron.

## Hardware truth

MCU STM32F103C8, 64 KB flash / 20 KB RAM (linker FLASH is **56 KB**; last 8 KB is ping-pong store at `0x0800E000`).

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

HID reports: 1 keyboard, 2 mouse, 3 consumer, 4 vendor (64-byte). Protocol: [`01 Documentation/HID_PROTOCOL.md`](01%20Documentation/HID_PROTOCOL.md). OLED screens/nav: [`01 Documentation/OLED_UI.md`](01%20Documentation/OLED_UI.md). `ui.c` is the look-and-feel source of truth in-repo (the Cursor canvas mockup is local-only and not in git).

USB still uses ST test VID/PID 1155/22352. Product string is LogicPad.

## App (when you start it)

Path: `04 Software/logicpad-app/`. Same `lp_store_t` / key structs as flash. HID via Rust hidapi filtered to vendor report 4 so the pad keeps typing. Linux: udev rule in README, not a custom driver.

## Do not

- Treat `PROJECT_PROGRESS_TRACKER.md` as stale if it conflicts with this file — this file wins on product locks; the tracker wins on checklist ticks.
- Add Python/PySide or Electron.
- Make Left move the list highlight.
- Put a bootloader/DFU in v1.
- Commit `.vscode`, `.clangd`, `.mxproject`, Cube `.settings` unless the user asks.
