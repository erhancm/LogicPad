<p align="center">
  <img src="docs/readme/logo.png" alt="LogicPad" width="96" height="96">
</p>

<h1 align="center">LogicPad</h1>

<p align="center">
  <strong>A programmable USB macro pad — and a desktop app that makes it yours.</strong><br>
  Map keys, build profiles, auto-switch by app, back up setups, and update firmware over USB.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-Apache%202.0-blue.svg" alt="License"></a>
  <a href="https://git.erhancm.com/erhan/LogicPad/releases"><img src="https://img.shields.io/badge/Download-Windows%20%7C%20macOS%20%7C%20Linux-f0d060.svg" alt="Download"></a>
  <img src="https://img.shields.io/badge/Update-via%20USB%20bootloader-3388ff.svg" alt="USB bootloader">
  <img src="https://img.shields.io/badge/Hardware-Open%20KiCad%20V0.2-33cc66.svg" alt="Open hardware">
</p>

<p align="center">
  <a href="#-logicpad-configurator">Configurator</a> ·
  <a href="#-features">Features</a> ·
  <a href="#-hardware">Hardware</a> ·
  <a href="#-quick-start">Quick start</a> ·
  <a href="https://git.erhancm.com/erhan/LogicPad/releases">Download app</a>
</p>

---

## 💻 LogicPad configurator

Free **Windows, macOS, and Linux** desktop app (Tauri 2). The pad works without it — plug in USB and type — but the configurator is where LogicPad shines: full-screen editing, YAML packs, app-aware profile switching, and **firmware updates over USB** through the on-board bootloader.

<table>
  <tr>
    <td colspan="2" align="center">
      <img src="docs/readme/app-keys.png" alt="LogicPad configurator — Keys tab with 3×3 grid, macro steps, and typed text" width="100%">
      <br><sub><b>Keys</b> — macros, chords, typed text, and drag-and-drop PC program launch</sub>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center">
      <img src="docs/readme/app-profiles.png" alt="LogicPad configurator — Profiles tab with lighting modes and per-key colours" width="100%">
      <br><sub><b>Profiles</b> — wave, ripple, breathe &amp; rain lighting · per-key colours · OLED settings</sub>
    </td>
    <td width="50%" align="center">
      <img src="docs/readme/app-auto-switch.png" alt="LogicPad configurator — Auto-switch node graph" width="100%">
      <br><sub><b>Auto-switch</b> — switch profiles when you focus or run specific apps</sub>
    </td>
  </tr>
</table>

### Install the app

Download from **[Releases](https://git.erhancm.com/erhan/LogicPad/releases)**:

| Platform | Download | Install |
|----------|----------|---------|
| **Windows** | `LogicPad_*_x64-setup.exe` | Run the installer (per-user, no admin) |
| **macOS** | `LogicPad_*_x64.dmg` | Open the DMG, drag LogicPad to Applications |
| **Linux** | `LogicPad_*_amd64.AppImage` | `chmod +x LogicPad_*.AppImage && ./LogicPad_*.AppImage` |
| **Linux** | `logicpad-app_*_amd64.deb` | `sudo apt install ./logicpad-app_*_amd64.deb` |
| **All** | `LogicPad-Productivity.yaml` | Import in the app (**Import…**) |

Linux needs the [udev rule](04%20Software/logicpad-app/README.md#linux-udev) so the app can open the pad over USB.

Build from source: `cd "04 Software/logicpad-app" && npm install && npm run build:app`

Try the showcase demo: [`04 Software/logicpad-app/showcase/`](04%20Software/logicpad-app/showcase/) — five profiles, rich macros, and a complex auto-switch graph.

Full app docs: [`04 Software/logicpad-app/README.md`](04%20Software/logicpad-app/README.md)

---

## 🎯 Features

| | |
|---|---|
| **Keys** | 3×3 macro grid — keyboard, mouse, media, multi-step macros, typed strings (240 B/key), PC program launch |
| **Profiles** | Unlimited profiles (flash permitting) · per-profile lighting modes · per-key RGB · OLED contrast, flip, sleep |
| **Auto-switch** | Node graph: foreground / running checks, AND/OR gates, set profile or restore previous when apps change |
| **YAML packs** | **Save as…** / **Import…** full setups — profiles, keys, and auto-switch rules |
| **On-board bootloader** | 4 KB USB HID bootloader baked into every board — **Update firmware** in the app, no ST-Link needed after the first flash. Hold **SEL** on plug-in to recover |
| **On-device OLED editor** | Configure everything from the pad itself when you don't have the app handy |
| **Plug-and-play HID** | Standard USB keyboard + mouse + media — no custom driver on any OS |
| **Open hardware** | KiCad V0.2 schematic, PCB, BOM, and Gerbers — build your own |

---

## 🔩 Hardware

<p align="center">
  <img src="docs/readme/hero.jpg" alt="LogicPad macro pad — OLED showing Media profile, per-key RGB backlight" width="720">
</p>

<p align="center">
  <em>9 macro keys + selector · 0.96″ OLED · per-key RGB · STM32F103 · 3D-printable enclosure</em>
</p>

| Spec | Detail |
|------|--------|
| MCU | STM32F103C8 — 64 KB flash, 20 KB RAM |
| Keys | 9 macro keys + selector |
| Display | 0.96″ SSD1306 OLED (128×64, I²C) |
| Lighting | Per-key RGB (2020 LEDs) |
| USB | Custom HID (keyboard + mouse + media + vendor) |
| Flash map | **4 KB bootloader** · 52 KB app · 8 KB config store |

Current revision: **V0.2** in [`02 Electronics/V0.2/`](02%20Electronics/V0.2/).

### Firmware updates

LogicPad ships with an **on-board USB HID bootloader**. After the initial factory flash:

1. Build firmware — CMake preset `Release` in [`03 Firmware/Firmware/`](03%20Firmware/Firmware/).
2. Open the configurator and click **Update firmware** with `LogicPad.bin`.

No ST-Link, no SWD, no disassembly — just USB. Recovery: hold **SEL** while plugging in to enter boot mode.

First-time programming still needs ST-Link once (`LogicPad_factory.hex` includes bootloader + app). Details: [`03 Firmware/bootloader/README.md`](03%20Firmware/bootloader/README.md).

---

## 🚀 Quick start

### Daily use (no app needed)

1. **Plug in USB.** The host OS sees a standard HID keyboard (plus mouse/media when configured).
2. **Selector short** opens the menu. In menus the nine keys act as a d-pad:

   | Key | Action |
   |-----|--------|
   | 1 | Up |
   | 7 | Down |
   | 3 | Left |
   | 5 | OK |
   | 4 | Right |

   **SEL short** = back · **SEL long** = home

3. Factory keys ship **empty** — assign macros on the OLED or with the configurator.

### Build firmware from source

1. Bootloader — CMake preset `Release` in [`03 Firmware/bootloader/`](03%20Firmware/bootloader/).
2. Application — CMake preset `Release` in [`03 Firmware/Firmware/`](03%20Firmware/Firmware/).
3. **First flash** — `LogicPad_factory.hex` via ST-Link.
4. **All later updates** — **Update firmware** in the app with `LogicPad.bin`.

---

## 📁 Repository layout

| Path | Contents |
|------|----------|
| [`04 Software/logicpad-app/`](04%20Software/logicpad-app/) | Desktop configurator (Tauri 2) |
| [`03 Firmware/Firmware/`](03%20Firmware/Firmware/) | Production firmware (CMake) |
| [`03 Firmware/bootloader/`](03%20Firmware/bootloader/) | On-board USB HID bootloader |
| [`02 Electronics/V0.2/`](02%20Electronics/V0.2/) | KiCad board, BOM, Gerbers |
| [`01 Documentation/`](01%20Documentation/) | Pinout, HID protocol, OLED UI |
| [`docs/readme/`](docs/readme/) | README images |

---

## 📖 Documentation

- [Pinout](01%20Documentation/Pinout.md) — MCU pins, matrix, OLED, RGB
- [HID protocol](01%20Documentation/HID_PROTOCOL.md) — reports and vendor commands
- [OLED UI](01%20Documentation/OLED_UI.md) — on-device menus
- [C4 architecture](01%20Documentation/C4_MODEL.md) — system overview

---

## 📦 Releases

Push a **`v*`** tag to build **Windows, macOS, and Linux** packages in one Gitea Release ([`.gitea/workflows/release.yml`](.gitea/workflows/release.yml)).

Windows-only manual publish: [`scripts/Publish-Gitea-Release.ps1`](scripts/Publish-Gitea-Release.ps1). See [`CHANGELOG.md`](CHANGELOG.md).

---

## 🤝 Contributing

Issues and pull requests are welcome. By contributing, you agree your contributions are licensed under [Apache 2.0](LICENSE).

---

## 📄 License

Licensed under the [Apache License 2.0](LICENSE).

STM32 HAL, CMSIS, and the ST USB device library in `03 Firmware/Firmware/Drivers/` remain under their upstream licenses.
