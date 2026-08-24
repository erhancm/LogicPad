# LogicPad C4 model

C4 diagrams of the firmware, optional desktop app, and USB HID path. There is **no custom kernel driver**: reports 1–3 use inbox OS HID; report 4 is opened in userspace by hidapi.

Sources: `AGENTS.md`, `HID_PROTOCOL.md`, `Pinout.md`, `OLED_UI.md`, `03 Firmware/`, `04 Software/logicpad-app/`.

How to read:

| Level | What it shows |
|-------|----------------|
| 1 Context | People and systems around LogicPad |
| 2 Containers | Deployable pieces (firmware images, OS HID, Tauri app) |
| 3 Components | Modules inside firmware, the desktop app, and the USB/HID stack |
| 4 Code | Flash map, HID reports, vendor commands |

---

## Level 1 — System context

The pad is a USB HID keyboard/mouse/media device on its own. The configurator is optional. Factory programming uses ST-Link once; later updates use the HID bootloader.

```mermaid
C4Context
title LogicPad system context

Person(operator, "Operator", "Types with the pad. Configures on the OLED. Optionally opens the PC app.")
Person(factory, "Factory / recovery", "First flash or brick recovery with ST-Link.")

System(pad, "LogicPad device", "STM32F103C8 macro pad. OLED editor, macros, RGB. USB Custom HID.")
System(app, "LogicPad configurator", "Optional Tauri 2 app. Profiles, macros, type-text, launch mapping, firmware update.")

System_Ext(osHid, "Host OS HID stack", "Windows / macOS / Linux inbox HID. No LogicPad kernel driver.")
System_Ext(apps, "Focused host apps", "Editors, browsers, anything that takes keyboard, mouse, or media keys.")
System_Ext(stlink, "ST-Link", "SWD. Writes LogicPad_factory.hex (bootloader + app).")

Rel(operator, pad, "Keys, SEL, OLED menus")
Rel(operator, app, "Edit, save, update firmware", "optional")
Rel(app, pad, "Vendor HID report 4", "hidapi, VID 0483 PID 5750 / 5751")
Rel(pad, osHid, "Keyboard, mouse, consumer", "HID reports 1-3, 1 ms")
Rel(osHid, apps, "Input events")
Rel(factory, stlink, "Flash once")
Rel(stlink, pad, "LogicPad_factory.hex", "SWD")
```

---

## Level 2 — Containers

One USB Custom HID interface. The OS claims reports 1–3. The app opens only the vendor collection (usage page `0xFF00`) so typing continues while the app is connected.

```mermaid
C4Container
title LogicPad containers

Person(operator, "Operator", "Uses pad and optional app.")

System_Boundary(device, "LogicPad STM32F103C8") {
    Container(boot, "HID bootloader", "C, 4 KB at 0x08000000", "PID 0x5751 LogicPad Boot. Bare-metal USB. Writes app flash.")
    Container(fw, "Firmware application", "C, Cube HAL, 52 KB at 0x08001000", "PID 0x5750. 1 ms loop: scan, UI, macros, HID, RGB.")
    ContainerDb(store, "Config store", "Flash ping-pong 8 KB at 0x0800E000", "lp_store_t, magic LPAG. Profiles, keys, type-text pool, clock snapshot.")
}

System_Boundary(host, "Host computer") {
    Container(osHid, "OS HID class drivers", "Inbox hidclass / usbhid / IOHIDFamily", "Keyboard, mouse, consumer. Not a LogicPad driver.")
    Container(ui, "Configurator UI", "React, WebView2", "Profiles, 3x3 keys, macros, lights, firmware file picker.")
    Container(rust, "Configurator sidecar", "Rust, Tauri 2, hidapi", "Vendor report 4 RPC. KEY_EVENT. HID bootloader flash.")
    ContainerDb(launches, "launches.json", "Local app config dir", "Host program paths per profile/key. Not stored in pad flash.")
    Container_Ext(focus, "Focused applications", "Whatever has OS focus")
}

Rel(operator, fw, "Keys and OLED")
Rel(operator, ui, "Optional editor")
Rel(ui, rust, "Tauri invoke / events")
Rel(rust, fw, "Report 4 commands", "PING, GET/SET key, SAVE, SET_TIME, text pool")
Rel(rust, boot, "Update firmware", "BL_START / BL_DATA / BL_FINISH")
Rel(fw, boot, "ENTER_BOOTLOADER", "SRAM magic LPBL, reset")
Rel(fw, store, "Load / CRC save")
Rel(boot, fw, "Jump to 0x08001000", "after CRC + vector check")
Rel(fw, osHid, "Reports 1-3")
Rel(osHid, focus, "Keystrokes, mouse, media")
Rel(fw, rust, "KEY_EVENT 0x0D", "live key down/up")
Rel(rust, launches, "Read/write")
Rel(rust, focus, "Launch mapped .exe", "if app is running")
```

Linux: hidapi needs hidraw access. The udev rule in the app README is a permission grant, not a driver.

---

## Level 3 — Firmware application

Main loop is 1 ms in `main.c`. USB IN/OUT is interrupt-driven through ST’s device library. Bootloader USB is a separate bare-metal stack (`bootloader/usb.c`), not this diagram.

```mermaid
C4Component
title Firmware application components

Container_Boundary(fw, "Firmware application") {
    Component(main, "main loop", "main.c", "Catch-up 1 ms ticks. keypad, ui, macro, hid. OLED draw when macro idle.")
    Component(keypad, "Keypad scan", "keypad.c", "Column-drive PB3/4/5, row-read PB12/13/14, SEL PB15. Debounce, short/long, repeat.")
    Component(ui, "OLED UI", "ui.c, ssd1306.c", "Menus, clock home, d-pad. Look-and-feel source of truth.")
    Component(macro, "Macro engine", "macro.c", "Up to 16 actions per key. HID taps, delays, mouse, consumer, ACT_TEXT.")
    Component(hid, "HID reports", "hid_reports.c", "Report IDs 1-4. Vendor command table. KEY_EVENT. ENTER_BOOTLOADER.")
    Component(storage, "Storage", "storage.c", "Ping-pong flash, CRC, profiles, 1200-byte type-text pool.")
    Component(leds, "RGB mux", "led_mux.c", "TIM2 soft-PWM. PA0-PA8 anodes, PB8/9/10 color sinks.")
    Component(clock, "Wall clock", "clock.c", "RTC from 8 MHz HSE. Flash snapshot. SET_TIME from app.")
    Component(usbdIf, "Custom HID IF", "usbd_custom_hid_if.c", "Report descriptor: kbd, mouse, consumer, vendor 0xFF00.")
    Component(usbd, "ST USB device", "USBD Core + CustomHID", "EP IN/OUT 64 bytes, 1 ms poll.")
    Component(hal, "STM32 HAL / CMSIS", "GPIO, I2C1, USB PCD, RTC, TIM2", "Cube-generated. Do not regenerate over USER CODE.")
}

Rel(main, keypad, "keypad_tick")
Rel(main, ui, "ui_tick / draw")
Rel(main, macro, "macro_tick")
Rel(main, hid, "hid_tick")
Rel(keypad, ui, "events")
Rel(ui, macro, "play key 0-8")
Rel(ui, hid, "hid_notify_key")
Rel(macro, hid, "kbd / mouse / consumer send")
Rel(hid, usbdIf, "SendReport / OutEvent")
Rel(usbdIf, usbd, "class callbacks")
Rel(usbd, hal, "PCD")
Rel(ui, storage, "read/write g_store")
Rel(hid, storage, "GET/SET key, SAVE, text")
Rel(storage, hal, "flash unlock / page erase")
Rel(leds, storage, "profile lights + key LED")
Rel(clock, storage, "time snapshot in slot tail")
Rel(ui, clock, "home HH:MM:SS")
Rel(hal, keypad, "GPIO matrix")
Rel(ui, hal, "I2C1 SSD1306 0x78")
```

Hardware pins: [Pinout.md](Pinout.md). OLED screens: [OLED_UI.md](OLED_UI.md).

---

## Level 3 — Desktop configurator

The UI never opens HID itself. Rust owns hidapi, filters to vendor report 4 (Windows also skips desktop/consumer collections), and emits `pad-key` / `flash-progress`.

```mermaid
C4Component
title LogicPad configurator components

Container_Boundary(app, "LogicPad.exe (Tauri 2)") {
    Component(react, "Editor UI", "src/App.tsx, text.ts", "Profiles, keys, macros, lights, type-text meter, firmware picker.")
    Component(api, "Invoke wrapper", "src/api.ts", "Typed Tauri commands.")
    Component(cmds, "Tauri commands", "src-tauri/src/lib.rs", "connect, load_pad, save, flash_firmware, launches.")
    Component(pad, "HID worker", "src-tauri/src/hid.rs", "hidapi thread. RPC + unsolicited KEY_EVENT. Bootloader flash.")
    Component(launch, "Launch store", "src-tauri/src/launch.rs", "launches.json. Spawn host process on key down.")
}

System_Ext(hidapi, "hidapi", "Userspace HID. Windows hid.dll, Linux hidraw, macOS IOHID.")
System_Ext(padDev, "LogicPad firmware or bootloader", "PID 5750 app / 5751 boot")
ContainerDb(json, "launches.json", "app config dir")

Rel(react, api, "calls")
Rel(api, cmds, "invoke")
Rel(cmds, pad, "Pad methods")
Rel(cmds, launch, "get/set/shift")
Rel(pad, hidapi, "open usage page FF00")
Rel(hidapi, padDev, "report 4 IN/OUT")
Rel(launch, json, "persist")
Rel(pad, launch, "KEY_EVENT down")
```

---

## Level 3 — USB / HID stack (no custom driver)

Device and host as layers. The bootloader does **not** use the ST USB library; it bit-bangs the same USB FS peripheral in `bootloader/usb.c`.

```mermaid
C4Component
title USB HID path — device and host

System_Boundary(dev, "Device") {
    Component(appHid, "hid_reports.c / boot.c", "Application or bootloader protocol")
    Component(desc, "Report descriptor / boot USB", "usbd_custom_hid_if.c or bootloader/usb.c")
    Component(class, "USBD CustomHID + Core", "ST middleware (app only)")
    Component(pcd, "HAL PCD + USB FS", "PA11/PA12, EP 64 B")
}

System_Boundary(cable, "USB-B FS") {
    Component(bus, "Full-speed USB", "VID 0483, PID 5750 or 5751")
}

System_Boundary(win, "Host (Windows typical)") {
    Component(hub, "usbhub / hidusb", "Inbox")
    Component(hidclass, "hidclass.sys + hidparse", "Inbox HID class")
    Component(kbdmou, "kbdhid / mouhid", "Reports 1-2. Consumer via hidclass")
    Component(user, "hidapi in LogicPad.exe", "Report 4 only. Does not claim kbd/mouse")
}

Rel(appHid, desc, "reports")
Rel(desc, class, "app path")
Rel(class, pcd, "PMA IN 0x98 OUT 0xD8")
Rel(pcd, bus, "DP/DM")
Rel(bus, hub, "enumeration")
Rel(hub, hidclass, "HID interface")
Rel(hidclass, kbdmou, "collections 1-3")
Rel(hidclass, user, "vendor collection FF00")
```

| Host | Reports 1–3 | Report 4 |
|------|-------------|----------|
| Windows | hidclass + kbdhid/mouhid | hidapi → hid.dll (skip usage 1/2/0x0C) |
| macOS | IOHIDFamily | hidapi |
| Linux | usbhid + evdev | hidraw; udev `99-logicpad.rules` for unprivileged open |

---

## Level 4 — Code: flash map and reports

STM32F103C8: 64 KB flash, 20 KB SRAM. ROM bootloader is USART-only, so field update is the 4 KB HID bootloader.

| Region | Address | Size | Image |
|--------|---------|------|--------|
| HID bootloader | `0x08000000` | 4 KB | `LogicPad_factory.hex` only |
| Application | `0x08001000` | 52 KB | `LogicPad.bin` (and factory hex) |
| Config store | `0x0800E000` | 8 KB | ping-pong `lp_store_t` |
| SRAM magic | `0x20004FFC` | word | `LPBL` → stay in bootloader |

| Report | Size | Who | Role |
|--------|------|-----|------|
| 1 | 9 | OS | Keyboard 6KRO |
| 2 | 5 | OS | Mouse |
| 3 | 3 | OS | Consumer 16-bit |
| 4 | 64 | App / bootloader | Vendor commands |

App vendor commands: `HID_PROTOCOL.md`. Bootloader: `0x40–0x43` (`BL_START`, `BL_DATA`, `BL_FINISH`, `BL_ABORT`).

Store schema: `03 Firmware/Firmware/Core/Inc/storage.h` (`lp_store_t`, magic `0x4C504147`).

---

## Runtime paths (code-level)

**Live key (no app):** keypad scan → `ui` live → `macro_play` → `hid_kbd_send` / mouse / consumer → USBD → OS HID → focused app.

**Live key (app running, launch mapped):** same HID 1–3 path, plus `hid_notify_key` → report 4 `KEY_EVENT` → hidapi worker → `LaunchStore::launch`.

**Save from app:** React → `save_store` → `CMD_SAVE` → `storage_save` → flash CRC slot.

**Update firmware:** app sends `ENTER_BOOTLOADER` → OLED **FLASH / BOOT MODE** → reset with `LPBL` → PID `0x5751` → `BL_*` writes `0x08001000` → jump to app. Recovery: hold SEL on plug-in.
