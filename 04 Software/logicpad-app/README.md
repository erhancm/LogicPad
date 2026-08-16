# LogicPad configurator

Optional Tauri 2 app. The pad already works as a USB HID keyboard without it.

Talks **vendor HID report 4** only (usage page `0xFF00`), so Windows/macOS/Linux keep using reports 1–3 for typing. ST test VID/PID `1155` / `22352` until we own IDs.

## Run

Needs Node 20+ and [Rust](https://rustup.rs/) (stable). On Windows, MSVC build tools.

```
cd "04 Software/logicpad-app"
npm install
node generate-icons.mjs
npm run tauri dev
```

Connect with the pad plugged in. Edit profiles, the 3×3 keys, macros, and lights. **Save** writes flash on the device. **Update firmware** takes the app `LogicPad.bin` (not the factory hex).

**Launch program** on a key is stored on this PC (not on the pad). Pressing that key opens the file while this app is running. Flash firmware that includes `KEY_EVENT` (`0x0D`).

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
