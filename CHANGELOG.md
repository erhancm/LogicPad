# Changelog

All notable changes to this project are documented here.

## v0.1.0 — 2026-08-31

First public release.

### LogicPad companion app (Windows)

- Profile and key editor with live pad sync
- YAML setup packs (Save as / Import)
- Auto-switch profiles with node-graph editor
- Drag-and-drop PC program launch mappings
- USB firmware update via HID bootloader
- Virtual keypad for drafting setups without hardware

### Firmware

- Plug-and-use USB HID macro pad (keyboard, mouse, media)
- Full OLED on-device editor (profiles, macros, lighting)
- 4 KB HID bootloader for field updates
- Packed flash store with multiple profiles

### Hardware

- KiCad V0.2 board design, BOM, and manufacturing outputs

### Downloads

| Platform | File | Notes |
|----------|------|-------|
| **Windows** | `LogicPad_*_x64-setup.exe` | Recommended NSIS installer (per-user, no admin) |
| **Windows** | `LogicPad-windows-x64.exe` | Portable build |
| **macOS** | `LogicPad_*_x64.dmg` | Drag **LogicPad** to Applications |
| **Linux** | `LogicPad_*_amd64.AppImage` | `chmod +x` then run; udev rule still needed for USB |
| **Linux** | `logicpad-app_*_amd64.deb` | Debian / Ubuntu package |
| **All** | `LogicPad-Productivity.yaml` | Example profile pack (Import in the app) |

Releases are built for **Windows, macOS, and Linux** when you push a `v*` tag (see `.gitea/workflows/release.yml`).
