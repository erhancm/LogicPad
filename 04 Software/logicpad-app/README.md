# LogicPad configurator

Optional Tauri 2 app. The pad already works as a USB HID keyboard without it.

Talks **vendor HID report 4** only (usage page `0xFF00`), so Windows/macOS/Linux keep using reports 1–3 for typing. ST test VID/PID `1155` / `22352` until we own IDs.

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

Connect with a pad plugged in, or use the **Simulated LogicPad** to draft a setup on this PC. **Save as…** writes a YAML pack; **Import…** applies that file onto whichever pad is selected in **Pad**. One pad is selected automatically; two or more keep the last one you used. Edit profiles, the 3×3 keys, macros, and lights. **New profile** / **Delete** add or remove a profile (until the pad’s flash slot is full). **Save** writes flash on the device (or the local simulated store). **Update firmware** takes the app `LogicPad.bin` (not the factory hex) and programs the selected USB pad.

Drop an `.exe` or shortcut onto a key to launch it from this PC (stored locally, not on the pad). Key labels are 12 characters on current firmware (OLED wraps to two lines past 10). The **Type text** box is what the pad types over USB; a live bar shows pad flash (profiles + macros + text share one slot) and 240 B max per key. Flash firmware that includes `GET_TEXT` / `SET_TEXT` (`0x0F` / `0x10`) for strings longer than 12 characters, and `GET_TITLE` / `SET_TITLE` (`0x13` / `0x14`) for 12-character key names. Packed-store firmware uses magic `LPAI` and migrates `LPAH` config on boot.

**Launch program** on a key is stored on this PC (not on the pad). Pressing that key opens the file while this app is running. Flash firmware that includes `KEY_EVENT` (`0x0D`).

**Auto-switch** is an If / Else-if / Else list on the **Auto-switch** tab. Each card: pick a program (window thumbnail or Browse…), choose focused vs running, then the profile and its lights. Optional AND requires a second program to be running. Else restores the previous profile. The tray app must stay running; Start with Windows turns on when a program is listed. Rules are local (`profile-rules.json`), not flash. Firmware that does not dirty on `SET_ACTIVE` avoids an OLED save prompt on every Alt-Tab. The background switcher only enumerates other windows when a card uses **Program is running** (or AND running), and it never waits forever on a hung window title.

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
