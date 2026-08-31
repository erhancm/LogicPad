# LogicPad configurator

Optional Tauri 2 desktop app. The pad works as a USB HID keyboard without it.

Talks **vendor HID report 4** only (usage page `0xFF00`), so the host keeps reports 1–3 for typing. USB IDs: ST test VID/PID `1155` / `22352` (application) and `22353` (`0x5751`, bootloader) until custom IDs are assigned.

Licensed under [Apache 2.0](../LICENSE).

## Daily use (Windows)

Build once, then start **LogicPad** from the Start menu or the desktop shortcut. No terminal after that.

```
cd "04 Software/logicpad-app"
npm install
node generate-icons.mjs
npm run build:app
```

Or double-click `Build LogicPad.bat` in that folder. That installs to `%LOCALAPPDATA%\LogicPad\` (current user, no admin) and writes:

- `src-tauri/target/release/LogicPad.exe` — the raw program
- `src-tauri/target/release/bundle/nsis/LogicPad_0.1.0_x64-setup.exe` — installer

WebView2 is already on Windows 10/11. Rebuild the same way after app code changes.

## Develop

Needs Node 20+ and [Rust](https://rustup.rs/) (stable). On Windows, MSVC build tools. Cargo must be on `PATH` (`%USERPROFILE%\.cargo\bin`).

```
cd "04 Software/logicpad-app"
npm install
npm run tauri dev
```

Connect with a pad plugged in, or use the **Simulated LogicPad** to draft a setup on this PC. **Save as…** writes a YAML pack; **Import…** applies that file onto whichever pad is selected in **Pad**. One pad is selected automatically; two or more keep the last one you used. Edit the 3×3 keys and macros on **Keys**. **Profiles** is name, lighting, key LEDs, duplicate/reset, and OLED Screen (contrast / flip / sleep). **New** / **Duplicate** / **Delete** add or remove a profile (until the pad’s flash slot is full). **Save** writes flash on the device (or the local simulated store). **Update firmware** takes the app `LogicPad.bin` (not the factory hex) and programs the selected USB pad.

Drop an `.exe` or shortcut onto a key to launch it from this PC (stored locally, not on the pad). Key labels are 12 characters on current firmware (OLED wraps to two lines past 10). The **Type text** box is what the pad types over USB; a live bar shows pad flash (profiles + macros + text share one slot) and 240 B max per key. Flash firmware that includes `GET_TEXT` / `SET_TEXT` (`0x0F` / `0x10`) for strings longer than 12 characters, and `GET_TITLE` / `SET_TITLE` (`0x13` / `0x14`) for 12-character key names. Packed-store firmware uses magic `LPAI` and migrates `LPAH` config on boot.

**Launch program** on a key is stored on this PC (not on the pad). Pressing that key opens the file while this app is running. Flash firmware that includes `KEY_EVENT` (`0x0D`).

**Auto-switch** on the **Auto-switch** tab switches pad profiles when you focus an app. Use the compact rules list or open the **graph** editor for AND/OR, running checks, foreground/not-focused logic, and a default fallback (for example a Media profile when no rule matches). Rules are stored locally (`profile-rules.json`), not on the pad. Enable auto-switch in the app; it can start with Windows when launch mappings or rules exist. Firmware that does not mark the store dirty on `SET_ACTIVE` avoids an OLED save prompt on every Alt-Tab.

Home/sleep on the pad shows the **active profile** while you are using Windows. The clock comes back if USB drops, the session is locked, or you log off. That lock/logoff switch needs this tray app (and firmware with `SET_HOST` `0x15`).

## Linux udev

Not a custom driver. One rule so hidapi can open hidraw without root:

```
# /etc/udev/rules.d/99-logicpad.rules
KERNEL=="hidraw*", ATTRS{idVendor}=="0483", ATTRS{idProduct}=="5750", MODE="0666", TAG+="uaccess"
KERNEL=="hidraw*", ATTRS{idVendor}=="0483", ATTRS{idProduct}=="5751", MODE="0666", TAG+="uaccess"
```

Then `sudo udevadm control --reload-rules && sudo udevadm trigger`.

## Protocol

See [`01 Documentation/HID_PROTOCOL.md`](../../01%20Documentation/HID_PROTOCOL.md). Key payloads are the first 60 bytes of `lp_key_t` (up to 12 actions).
