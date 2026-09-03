# LogicPad C4 Model

This document describes the LogicPad system using the [C4 model](https://c4model.com/) — four levels of increasing detail, from the big picture down to individual data structures.

LogicPad is a USB HID macro pad. It presents itself as a standard keyboard, mouse, and media device — **there is no custom kernel driver**. The host OS handles reports 1–3 with its inbox HID stack. Report 4 (vendor) is opened in userspace by the optional desktop app via hidapi.

**Source files:** `README.md`, `HID_PROTOCOL.md`, `Pinout.md`, `OLED_UI.md`, `03 Firmware/`, `04 Software/logicpad-app/`.

| Level | What it shows |
|-------|----------------|
| 1 — Context | People and external systems around LogicPad |
| 2 — Containers | Deployable units: firmware images, OS HID drivers, the Tauri app, config files |
| 3 — Components | Modules inside each container: firmware C modules, Rust backend, React UI, USB stack |
| 4 — Code | Flash memory map, HID report layout, vendor command table |

---

## Level 1 — System Context

The macro pad works as a standalone USB HID device — just plug it in and type. The OLED screen and physical keys let the operator configure macros directly on the device. The desktop configurator app is entirely optional; it provides a richer editing experience, profile management, firmware updates, and automatic profile switching based on the focused application.

Factory programming (first flash or brick recovery) uses an ST-Link debugger over SWD. After that, all firmware updates go through the built-in HID bootloader — no special tools needed.

![Level 1 — System Context](../01%20Documentation/diagrams/level1-context.png)

---

## Level 2 — Containers

The device exposes a single USB Custom HID interface. The OS automatically claims reports 1–3 (keyboard, mouse, consumer) through its standard class drivers. The desktop app opens only the vendor collection (usage page `0xFF00`), so normal typing continues uninterrupted while the app is connected.

On the host side, the Tauri app bundles a React frontend with a Rust backend. The Rust side owns the hidapi connection and handles all USB communication. The app stores host-side configuration (launch mappings and profile switch rules) in JSON files — these live on the PC, not in the pad's flash.

![Level 2 — Containers](../01%20Documentation/diagrams/level2-containers.png)

**Linux note:** hidapi needs access to `/dev/hidraw`. The udev rule in the app README grants this permission — it is not a driver.

---

## Level 3 — Firmware Application

The firmware runs a catch-up tick loop in `main.c`. Each iteration processes all elapsed milliseconds since the last pass, calling `ui_tick()` for each one (which includes keypad scanning). After the tick loop, `hid_tick()` and `macro_tick()` run once. OLED drawing is deferred to when the macro engine is idle, since the I2C transfer to the SSD1306 display takes ~25 ms and would otherwise stall HID reporting.

USB IN/OUT is interrupt-driven through ST's device library. The bootloader has its own separate bare-metal USB stack (`bootloader/usb.c`) and is not shown here.

![Level 3 — Firmware Application](../01%20Documentation/diagrams/level3-firmware.png)

**Related docs:** [Pinout.md](Pinout.md) for hardware pins, [OLED_UI.md](OLED_UI.md) for screen layouts.

---

## Level 3 — Desktop Configurator

The desktop app is a Tauri 2 application with a React frontend and a Rust backend. The frontend never opens HID directly — all USB communication goes through the Rust side, which owns the hidapi connection on a dedicated worker thread.

The backend has grown beyond simple pad editing. It now handles automatic profile switching based on the focused Windows application, host session detection (lock/unlock), live window previews, and an in-memory simulated pad for testing without hardware.

![Level 3 — Desktop Configurator](../01%20Documentation/diagrams/level3-desktop.png)

---

## Level 3 — USB / HID Stack (No Custom Driver)

This diagram shows the USB path as a stack of layers, from the application protocol down to the wire and back up on the host side. The bootloader does **not** use the ST USB library — it drives the same USB FS peripheral directly in `bootloader/usb.c`.

![Level 3 — USB HID Stack](../01%20Documentation/diagrams/level3-usb.png)

| Host OS | Reports 1–3 (keyboard/mouse/consumer) | Report 4 (vendor) |
|---------|---------------------------------------|--------------------|
| Windows | hidclass.sys + kbdhid/mouhid | hidapi via hid.dll (skips usage pages 0x01, 0x02, 0x0C) |
| macOS | IOHIDFamily | hidapi via IOHIDManager |
| Linux | usbhid + evdev | hidraw; requires udev rule `99-logicpad.rules` for unprivileged access |

---

## Level 4 — Code: Flash Map and HID Reports

**Chip:** STM32F103C8 — 64 KB flash, 20 KB SRAM. The built-in ROM bootloader only supports USART, so field firmware updates use the 4 KB HID bootloader instead.

### Flash Memory Map

| Region | Address | Size | Contents |
|--------|---------|------|----------|
| HID Bootloader | `0x08000000` | 4 KB | Included in `LogicPad_factory.hex` only. Bare-metal USB stack. |
| Application | `0x08001000` | 52 KB | `LogicPad.bin` (also bundled in factory hex). Main firmware. |
| Config Store | `0x0800E000` | 8 KB | Ping-pong slots with CRC. Packed profiles, keys, text pool, clock snapshot. |
| SRAM Magic | `0x20004FFC` | 4 bytes | Write `LPBL` here before reset to stay in bootloader (used by ENTER_BOOTLOADER). |

### HID Reports

| Report ID | Size (bytes) | Direction | Handled By | Purpose |
|-----------|-------------|-----------|------------|---------|
| 1 | 9 | IN | OS | Keyboard: modifier byte + 6-key rollover |
| 2 | 5 | IN | OS | Mouse: buttons, X, Y, wheel |
| 3 | 3 | IN | OS | Consumer control: 16-bit usage (volume, media, etc.) |
| 4 | 64 | IN/OUT | App / Bootloader | Vendor commands (see HID_PROTOCOL.md) |

### Vendor Commands (Application)

The full command table is documented in `HID_PROTOCOL.md`. Key commands include:

| Cmd | Name | Description |
|-----|------|-------------|
| 0x01 | PING | Returns protocol version (major, minor) |
| 0x02 | GET_META | Active profile, dirty flag, OLED settings, store usage |
| 0x03 | GET_KEY | Read key config (label, LED, actions) for a profile/key |
| 0x04 | SET_KEY | Write key config |
| 0x05 | SET_ACTIVE | Switch live profile (does not mark flash dirty) |
| 0x06 | SAVE | Persist current config to flash with CRC |
| 0x0C | ENTER_BOOTLOADER | Ack, show OLED message, reset into HID bootloader |
| 0x0D | KEY_EVENT | Unsolicited: live key down/up notification |
| 0x0E | SET_TIME | Sync wall clock from host |
| 0x0F–0x10 | GET/SET_TEXT | Type-text pool read/write (chunked) |
| 0x11–0x12 | ADD/DEL_PROFILE | Add or delete profiles (up to 255) |
| 0x13–0x14 | GET/SET_TITLE | 12-character display title per key |
| 0x15 | SET_HOST | Notify pad of host session state (locked/unlocked) |
| 0x16 | SET_SCREEN | OLED contrast, flip, sleep timeout, clock style |
| 0x17 | GET_LEDS | Live RGB snapshot for app-side LED preview |
| 0x18 | PREVIEW_CLOCK | Show/hide clock preview on OLED |

**Bootloader commands:** `0x40` BL_START, `0x41` BL_DATA, `0x42` BL_FINISH, `0x43` BL_ABORT.

### Store Schema

Defined in `03 Firmware/Firmware/Core/Inc/storage.h`. The current packed format uses magic `LPAI` (`0x4C504149`). The bootloader migrates legacy `LPAH` (`0x4C504148`, fixed 4-profile) stores into the packed layout on first boot. Up to 255 profiles, 9 keys per profile, 12 actions per key, 240 bytes of type-text per key.

---

## Runtime Paths

These trace common operations through the code, showing which components are involved at each step.

### Typing a key (standalone, no desktop app)

1. `main.c` tick loop calls `ui_tick()`
2. `keypad.c` scans the 3x3 matrix, detects a key press (with debounce)
3. `ui.c` receives the event, looks up the active profile's key config
4. `macro.c` plays the key's action sequence (HID taps, delays, mouse moves, consumer keys, typed text)
5. `hid_reports.c` sends reports 1–3 via `usbd_custom_hid_if.c` → ST USB library → USB FS peripheral
6. Host OS HID stack delivers input to the focused application

### Typing a key (desktop app running, with launch mapping)

Same HID path as above (reports 1–3 still go to the OS), **plus:**

1. `hid_reports.c` sends an unsolicited `KEY_EVENT` (0x0D) over report 4
2. `hid.rs` worker thread receives it, dispatches to the registered callback
3. `launch.rs` checks if this profile/key has a mapped host program — if so, spawns it
4. `profile_switch.rs` also receives the event and can trigger auto-switch logic

### Auto profile switching (desktop app)

1. `profile_switch.rs` polls the focused Windows application via `focus.rs`
2. `switch_graph.rs` evaluates the rule graph against the focused program's executable name
3. If a rule matches and the profile differs from the current one, sends `SET_ACTIVE` to the pad
4. Debounce timer (400 ms) prevents rapid switching during alt-tab

### Host session detection (desktop app)

1. `host.rs` monitors Windows session events (lock, unlock, fast-user-switch, logoff)
2. When the session state changes, sends `SET_HOST` (0x15) to the pad
3. The pad uses this to decide whether to show the clock or profile name on the home screen, and when to enter sleep

### Saving from the desktop app

1. React UI calls `save_store` via the invoke wrapper
2. `lib.rs` forwards to `hid.rs` which sends `CMD_SAVE` (0x06) over report 4
3. `storage.c` on the pad writes the current config to flash with a CRC checksum

### Firmware update

1. Desktop app sends `ENTER_BOOTLOADER` (0x0C) — the pad acks, shows "FLASH / BOOT MODE" on the OLED, then resets
2. SRAM magic `LPBL` tells the bootloader to stay in update mode
3. Pad re-enumerates as PID `0x5751` (LogicPad Boot)
4. App sends `BL_START` (size + CRC), then `BL_DATA` chunks, then `BL_FINISH`
5. Bootloader verifies CRC and vector table, then jumps to `0x08001000`
6. **Recovery:** hold SEL while plugging in USB to force bootloader mode
