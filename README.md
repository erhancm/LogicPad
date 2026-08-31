# LogicPad

Open-source 9-key USB macro pad with a 0.96" OLED editor, per-key RGB, and an optional desktop configurator.

Licensed under the [Apache License 2.0](LICENSE).

## Features

- **Plug-and-play USB HID** — keyboard, mouse, and media keys; no custom driver
- **On-device editor** — profiles, macros, lighting, and screen settings on the OLED
- **Optional companion app** — Tauri 2 desktop configurator for large-screen editing, YAML backup/import, auto-switch profiles, PC program launch, and USB firmware updates
- **Field updates** — 4 KB HID bootloader; update from the app without ST-Link
- **Open hardware** — KiCad schematic/PCB (V0.2), BOM, and manufacturing outputs

## Repository layout

| Path | Contents |
|------|----------|
| [`01 Documentation/`](01%20Documentation/) | Pinout, HID protocol, OLED UI, architecture (C4) |
| [`02 Electronics/V0.2/`](02%20Electronics/V0.2/) | Current KiCad board, BOM, Gerbers |
| [`03 Firmware/Firmware/`](03%20Firmware/Firmware/) | Production firmware (CMake) |
| [`03 Firmware/bootloader/`](03%20Firmware/bootloader/) | USB HID bootloader |
| [`04 Software/logicpad-app/`](04%20Software/logicpad-app/) | Desktop configurator |

## Using the pad

1. Plug in USB. The host OS treats it as a standard HID keyboard (plus mouse/media when configured).
2. **Selector short** opens the menu. In menus the nine keys act as a d-pad (1 up, 7 down, 3 left, 5 right, 4 OK). **SEL short** = back. **SEL long** = home.
3. Factory keys ship empty — assign macros on the OLED or with the companion app.

## Building firmware

1. Build the bootloader — CMake preset `Release` in [`03 Firmware/bootloader/`](03%20Firmware/bootloader/).
2. Build the app — CMake preset `Release` in [`03 Firmware/Firmware/`](03%20Firmware/Firmware/).
3. **First flash** — program `LogicPad_factory.hex` with ST-Link (bootloader + application).
4. **Later updates** — use **Update firmware** in the companion app with `LogicPad.bin`.

Recovery: hold **SEL** while plugging in USB to enter the HID bootloader.

Details: [`03 Firmware/bootloader/README.md`](03%20Firmware/bootloader/README.md).

## Companion app

See [`04 Software/logicpad-app/README.md`](04%20Software/logicpad-app/README.md).

```bash
cd "04 Software/logicpad-app"
npm install
npm run build:app
```

On Windows the installer writes to `%LOCALAPPDATA%\LogicPad\`. Linux needs a udev rule (documented in the app README).

### Profile packs and auto-switch

Export or import full setups as YAML (**Save as…** / **Import…**). The **Auto-switch** tab switches pad profiles when you focus specific programs (node-graph editor with AND/OR, running checks, and a default fallback).

Example productivity pack: [`04 Software/logicpad-app/productivity/LogicPad-Productivity.yaml`](04%20Software/logicpad-app/productivity/LogicPad-Productivity.yaml).

## Documentation

- [Pinout](01%20Documentation/Pinout.md) — MCU pins, matrix, OLED, RGB
- [HID protocol](01%20Documentation/HID_PROTOCOL.md) — reports and vendor commands
- [OLED UI](01%20Documentation/OLED_UI.md) — on-device menus
- [C4 architecture](01%20Documentation/C4_MODEL.md) — system overview

## Hardware

Current revision: **V0.2** (`02 Electronics/V0.2/`). MCU: STM32F103C8 (64 KB flash, 20 KB RAM). USB Custom HID currently uses ST test VID/PID until custom IDs are assigned.

## Third-party code

STM32 HAL, CMSIS, and the ST USB device library in `03 Firmware/Firmware/Drivers/` remain under their upstream licenses.

## Contributing

Issues and pull requests are welcome. By contributing, you agree your contributions are licensed under Apache 2.0.
