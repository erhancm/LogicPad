# LogicPad HID Protocol

This document describes the USB HID protocol used by LogicPad — a macro pad that presents itself as a standard keyboard, mouse, and media device over a single Custom HID interface. The host OS handles reports 1–3 with its inbox class drivers; no custom kernel driver is needed. Report 4 (vendor) is ignored by the OS and opened in userspace by the optional Tauri desktop app via hidapi.

**Source files:** `03 Firmware/Firmware/Core/Inc/hid_reports.h`, `03 Firmware/Firmware/Core/Src/hid_reports.c`, `03 Firmware/Firmware/Core/Inc/storage.h`, `03 Firmware/bootloader/boot.c`, `04 Software/logicpad-app/src-tauri/src/hid.rs`.

---

## Report IDs

| ID | Size (incl. ID) | Direction | Purpose |
|----|-----------------|-----------|---------|
| 1 | 9 | IN | Keyboard: modifier byte, reserved, 6-key rollover |
| 2 | 5 | IN | Mouse: buttons, X, Y, wheel |
| 3 | 3 | IN | Consumer control: 16-bit usage (volume, media, etc.) |
| 4 | 64 | IN/OUT | Vendor commands — 63-byte payload (see below) |

Endpoint IN/OUT max packet size is 64 bytes. Poll interval is 1 ms.

---

## Vendor Packet Format

Every vendor packet is 64 bytes on the wire:

| Byte | Content |
|------|---------|
| 0 | Report ID (`4`) |
| 1 | Command code |
| 2–63 | Payload (command-specific) |

The pad echoes the command byte in every reply.

### Protocol Versioning

`PING` returns a two-byte version: major `0x01`, then a minor number. The minor version tracks which features the firmware supports. The Tauri app uses this to enable or hide UI elements:

| Minor | Feature added |
|-------|--------------|
| 0 | Base protocol (no type-text pool) |
| 1 | Type-text pool (`GET_TEXT` / `SET_TEXT`) |
| 2 | Add / delete profiles (`ADD_PROFILE` / `DEL_PROFILE`) |
| 3 | 12-character key titles (`GET_TITLE` / `SET_TITLE`) |
| 4 | Host session state (`SET_HOST`) |
| 5 | Packed flash store — profiles fill flash instead of a fixed 4-slot layout |
| 6 | OLED screen settings (`SET_SCREEN` — contrast, flip, sleep) |
| 7 | Live LED snapshot (`GET_LEDS`) |
| 8 | Standby clock style in `GET_META` / `SET_SCREEN` (`clock_style` field) |
| 9 | Clock preview (`PREVIEW_CLOCK`) |

Current firmware returns `0x01, 0x09`.

---

## Application Vendor Commands

| Cmd | Name | Host → pad | Pad → host |
|-----|------|------------|------------|
| 0x01 | PING | — | major `0x01`, minor (see versioning table) |
| 0x02 | GET_META | — | active, dirty, contrast, flip, sleep, in_menu, usb, n_profiles, used u16le, cap u16le, clock_style (minor ≥ 8) |
| 0x03 | GET_KEY | profile, key | profile, key, first 57 bytes of `lp_key_t` (`LP_KEY_HID_BYTES`) |
| 0x04 | SET_KEY | profile, key, 57-byte key blob | echo profile, key, status |
| 0x05 | SET_ACTIVE | profile | echo profile (live slot only; does not mark flash dirty) |
| 0x06 | SAVE | — | ack |
| 0x07 | RELOAD | — | ack |
| 0x08 | FACTORY | — | ack |
| 0x09 | GET_PROFILE_HDR | profile | index, name (13 bytes NUL-padded), light_mode, bright, dim |
| 0x0A | SET_PROFILE_HDR | index, name (13), light_mode, bright, dim | echo (17 bytes) |
| 0x0B | GET_STATUS | — | same as `GET_META` |
| 0x0C | ENTER_BOOTLOADER | — | ack, then reset into the 4 KB HID updater |
| 0x0D | KEY_EVENT | — | unsolicited IN: profile, key, down (1/0). Live keys only. |
| 0x0E | SET_TIME | year u16le, month, day, hour, min, sec (local 24h) | echo (7 bytes) |
| 0x0F | GET_TEXT | profile, key, offset | profile, key, total_len, offset, pool_used u16le, data (56 bytes) |
| 0x10 | SET_TEXT | profile, key, offset, total_len, data (58 bytes) | profile, key, offset, status, pool_used u16le |
| 0x11 | ADD_PROFILE | — | index, n_profiles, status |
| 0x12 | DEL_PROFILE | profile | profile, n_profiles, active, status |
| 0x13 | GET_TITLE | profile, key | profile, key, title (12 chars + NUL) |
| 0x14 | SET_TITLE | profile, key, title (12, NUL-padded) | echo profile, key |
| 0x15 | SET_HOST | `1` = PC session in use, `0` = away (locked / logged off) | echo |
| 0x16 | SET_SCREEN | contrast (0–10), flip (0–1), sleep (0–4), clock_style | echo + status byte (`0` ok, `1` bad values) |
| 0x17 | GET_LEDS | — | 10 colors, 10 duties, anim_ms u16le, idle_ms u16le, flash_key, flash_ms u16le, ripple_key, ripple_age u16le, flood (31 bytes) |
| 0x18 | PREVIEW_CLOCK | on (0/1) | echo on |

---

## Command Details

### PING (0x01)

Returns the protocol version. The app uses the minor number to decide which features are available (see versioning table above). No payload.

### GET_META (0x02) / GET_STATUS (0x0B)

Both return the same 13-byte response. `GET_STATUS` is an alias kept for compatibility.

| Offset | Size | Field | Description |
|--------|------|-------|-------------|
| 0 | 1 | active | Currently active profile index |
| 1 | 1 | dirty | `1` if config has unsaved changes |
| 2 | 1 | contrast | OLED contrast (0–10) |
| 3 | 1 | flip | OLED 180° flip (0/1) |
| 4 | 1 | sleep | Idle sleep timeout (0=Never, 1=15s, 2=30s, 3=1m, 4=5m) |
| 5 | 1 | in_menu | `1` if the OLED is showing a config menu; `0` on home screen, toast, or sleep |
| 6 | 1 | usb | `1` if USB is configured (host connected) |
| 7 | 1 | n_profiles | Number of stored profiles |
| 8–9 | 2 | store_used | Bytes used in the packed flash store (u16le) |
| 10–11 | 2 | store_cap | Total capacity of the packed flash store (u16le) |
| 12 | 1 | clock_style | Packed standby clock settings (minor ≥ 8; `0` on older firmware) |

### GET_KEY (0x03)

Reads a key configuration. Send `profile` (0-based) and `key` (0–8). The pad returns the profile and key indices followed by the first 57 bytes of `lp_key_t` — the HID prefix containing `label[7]`, `led`, action count `n`, and up to 12 `lp_action_t` entries (4 bytes each). The `title` field is not included; use `GET_TITLE` separately.

### SET_KEY (0x04)

Writes a key configuration. The 57-byte HID blob has the same layout as the `GET_KEY` response (label, LED, action count, actions). The pad preserves the existing `title` — `SET_KEY` does not touch it. Use `SET_TITLE` to update the 12-character display name separately.

**Status:** `0` = ok, `1` = flash slot full (change discarded).

### SET_ACTIVE (0x05)

Switches the live profile and redraws lights and OLED. Does **not** set the `dirty` flag, so the host auto-switch in the Tauri app will not trigger the OLED save prompt. Persist the change with **Save**, or change it on the device (OLED edits still mark dirty).

### SAVE (0x06)

Persists the current in-memory config to flash with a CRC checksum. The pad acks after the write completes.

### RELOAD (0x07)

Discards in-memory changes and reloads the config from flash. The pad acks and redraws.

### FACTORY (0x08)

Resets all profiles and settings to factory defaults, then saves to flash. The pad acks and redraws.

### GET_PROFILE_HDR (0x09)

Reads a profile's header. Send the profile index. Returns 17 bytes: index, name (13 bytes, NUL-padded), `light_mode`, `bright`, `dim`.

### SET_PROFILE_HDR (0x0A)

Writes a profile's header (name and lighting). Send 17 bytes matching the `GET_PROFILE_HDR` layout. Marks flash dirty.

### ENTER_BOOTLOADER (0x0C)

The pad acks immediately, then the main loop shows **FLASH / BOOT MODE** on the OLED and performs a system reset. The ack is sent from the USB callback — the actual reset happens in `hid_tick()`, not in the interrupt context, because USB IRQ priority 0 would hang `HAL_Delay`.

### KEY_EVENT (0x0D)

Unsolicited IN report. The pad sends this whenever a physical key is pressed or released while USB is configured. Payload: profile index, key index, down (`1` = pressed, `0` = released). Queued up to 4 events; oldest is dropped if the queue overflows. The Tauri app uses this for launch mapping and auto profile switching.

### SET_TIME (0x0E)

Syncs the pad's wall clock from the host. Payload: year (u16le), month, day, hour, minute, second — all in local 24-hour time. The pad keeps time on its own STM32 RTC (driven by the 8 MHz HSE crystal) for as long as it has USB power. There is no 32 kHz backup crystal or battery, so a full unplug loses the time; a flash snapshot restores the last saved clock. Until the first sync, the display starts at 16 Aug 2026 00:00:00.

### GET_TEXT (0x0F)

Reads a chunk of a key's type-text string. Send profile, key, and byte offset. Returns profile, key, total length, offset, pool_used (u16le), and up to 56 bytes of text data. Call repeatedly with increasing offsets to read the full string.

### SET_TEXT (0x10)

Writes a chunk of a key's type-text string. Send profile, key, byte offset, total length, and up to 58 bytes of data. The first packet (offset `0`) starts a new write; subsequent packets must continue from the next byte. An empty `total_len` clears that key's text.

**Status:** `0` = ok, `1` = flash slot full, `2` = text longer than 240 bytes, `3` = bad arguments (mismatched profile/key/offset/total).

### ADD_PROFILE (0x11)

Appends an empty profile with a default name (`P1`, `P2`, …) and Solid lighting. Returns the new index, updated `n_profiles`, and status.

**Status:** `0` = ok, `1` = slot full or already 255 profiles.

### DEL_PROFILE (0x12)

Compact-deletes the given profile slot. Returns the original index, updated `n_profiles`, current `active`, and status.

**Status:** `0` = ok, `2` = would leave zero profiles, `3` = bad index.

### GET_TITLE (0x13)

Reads the 12-character display title for a key. Send profile and key. Returns profile, key, and the title string (12 chars + NUL).

### SET_TITLE (0x14)

Writes the 12-character display title for a key. The pad also fills `label` with the first 6 non-space characters as a stub for old packets. OLED and the PC app show `title` (falling back to `label` if `title` is empty). Marks flash dirty.

### SET_HOST (0x15)

Notifies the pad of the host session state. Send `1` when the PC session is in use (unlocked), `0` when away (locked, logged off, or fast-user-switched). The pad uses this to decide whether to show the clock or profile name on the home screen, and when to enter sleep. USB unconfigured/suspend counts as away without the app.

### SET_SCREEN (0x16)

Writes pad-wide OLED settings. All values are applied to hardware immediately and mark flash dirty; persist with **Save**.

| Offset | Size | Field | Range |
|--------|------|-------|-------|
| 0 | 1 | contrast | 0–10 |
| 1 | 1 | flip | 0 = normal, 1 = 180° rotation |
| 2 | 1 | sleep | 0 = Never, 1 = 15s, 2 = 30s, 3 = 1m, 4 = 5m |
| 3 | 1 | clock_style | Packed byte (see below) |

**Status:** `0` = ok, `1` = one or more values out of range.

#### clock_style packing

The `clock_style` byte controls the standby clock band animation on the OLED. It uses a v2 packing format (bit 6 set):

| Bits | Field | Values |
|------|-------|--------|
| 0–3 | Animation | 0 = Bounce, 1 = Scan, 2 = March, 3 = Pulse, 4 = Wave, 5 = Blocks, 6 = Comet, 7 = Swing, 8 = Fill, 9 = Sparkle, 10 = Ripple, 11 = Rain, 12 = Off |
| 4–5 | Speed | 0 = Slow (32 ms), 1 = Normal (16 ms), 2 = Fast (8 ms), 3 = Rapid (4 ms) |
| 6 | Seconds bar | 0 = off, 1 = on (thin progress bar across the clock band) |
| 7 | Reserved | Must be 0 |

The default is `0x50` (Bounce, Normal speed, seconds bar on).

**v1 → v2 migration:** Older firmware used a different bit layout (3-bit anim, 2-bit speed, 1-bit bar, no bit 6). The firmware and app both detect v1 by checking bit 6 = 0 and repack into v2 format automatically.

### GET_LEDS (0x17)

Copies the LED mux's current frame so the companion app can phase-lock animations instead of running a separate timer. Returns 31 bytes:

| Offset | Size | Field |
|--------|------|-------|
| 0–9 | 10 | Color per LED (keys 0–8, then SEL at index 9). Values: `LED_OFF/WHITE/RED/GREEN/BLUE` |
| 10–19 | 10 | Duty per LED (0–16 PWM steps after gamma correction) |
| 20–21 | 2 | `anim_ms` — animation clock (u16le) |
| 22–23 | 2 | `idle_ms` — idle timer (u16le) |
| 24 | 1 | `flash_key` — key currently flashing (0xFF = none) |
| 25–26 | 2 | `flash_ms` — flash timer (u16le) |
| 27 | 1 | `ripple_key` — ripple origin key (0xFF = none) |
| 28–29 | 2 | `ripple_age` — ripple timer (u16le) |
| 30 | 1 | `flood` — flood fill state |

This command does not mark flash dirty and does not count as a vendor session (the OLED USB dot stays off). In Solid mode, SEL (index 9) follows key 0 (the key below it). Older firmware without minor 7 ignores the command.

### PREVIEW_CLOCK (0x18)

Shows or hides a clock preview on the OLED. Send `1` to show, `0` to hide. The Tauri app uses this when the user is editing clock settings so they can see the result live on the pad. Does not mark flash dirty.

---

## Packed Flash Store

Profiles, macros, and typed strings share a **packed ping-pong slot** in flash (about 4076 bytes after clock snapshots). The current magic is `LPAI` (`0x4C504149`). The bootloader migrates legacy `LPAH` (`0x4C504148`, fixed 4-profile) stores into the packed layout on first boot. Older `LPAG` / `LPAF` stores are discarded.

Up to 255 profiles, 9 keys per profile, 12 actions per key, and 240 bytes of type-text per key. Empty keys take no flash space. Factory still ships four empty profiles; **+ New** adds more until the 4 KB slot fills.

`ACT_TEXT` (`8`) is a macro step that types a string as US-HID taps, so later steps can be Enter or a chord. Keys that still have text but no `ACT_TEXT` action play the string after the other actions (older saves).

Structs are in `03 Firmware/Firmware/Core/Inc/storage.h`. The OLED USB dot blinks while a vendor command was seen in the last 2 seconds.

---

## Host-Side Behavior

The pad keeps sending keyboard/mouse/media reports (1–3) while the app holds report 4. The two paths are independent.

**KEY_EVENT** lets the Tauri app launch host programs on key press; that mapping lives in `launches.json` on the PC, not in flash. The app can also watch the focused Windows program and send `SET_ACTIVE` to auto-switch profiles (rules in `profile-rules.json`, not flash).

**SET_HOST** tells the pad whether the Windows session is in use or away, so the home screen can show the profile name or the clock, and sleep can engage.

**SET_TIME** loads the host's local wall clock. The pad then keeps time on its own (STM32 RTC from the 8 MHz crystal) for as long as it has USB power; it does not need the app connected. There is no 32 kHz backup crystal or battery, so a full unplug still loses the seconds the pad was off; a flash snapshot restores the last saved time. Until the first sync, the display starts at 16 Aug 2026 00:00:00. Open the app now and then if it has drifted.

---

## Field Firmware Update

The STM32F103C8 ROM bootloader is USART-only — no USB DFU. Updates go through a 4 KB HID bootloader at `0x08000000` (product **LogicPad Boot**, PID `0x5751`). The application stays at `0x08001000` (52 KB). Config store is unchanged at `0x0800E000`.

**Once:** flash `LogicPad_factory.hex` with ST-Link (bootloader + app). After that, the Tauri app **Update firmware** writes `LogicPad.bin` (app only) over vendor report 4.

**Recovery:** hold **SEL** while plugging USB. The pad stays in LogicPad Boot. The OLED shows **BOOT** / **USB FLASH**, then a progress bar while the image writes.

A software reset (in-app **Update firmware**) also stays in the updater. That bootloader behavior is part of `LogicPad_factory.hex` (ST-Link once); **Update firmware** only writes the app.

### Bootloader Vendor Commands

| Cmd | Name | Host → boot | Boot → host |
|-----|------|-------------|-------------|
| 0x01 | PING | — | `0x01, 0x01, 0x00, 0x42` |
| 0x40 | BL_START | size u32le, CRC-32 IEEE u32le | status, size echoed |
| 0x41 | BL_DATA | up to 62 payload bytes | status, bytes written |
| 0x42 | BL_FINISH | — | status (CRC + vector check), then jump to app |
| 0x43 | BL_ABORT | — | status, jump if app valid |

**Bootloader PING** returns `0x01` (major), `0x01` (command echo), `0x00` (status), `0x42` (signature). This is different from the application PING.

**Status codes:** `0` = ok, `1` = bad size, `2` = bad vectors (not an app image), `3` = flash error, `4` = CRC mismatch, `5` = wrong state (e.g. `BL_DATA` before `BL_START`).

The first `BL_DATA` chunk validates the vector table (stack pointer in SRAM, reset vector in app range). If the vectors are bad, the bootloader rejects the image immediately.

Do not send `LogicPad_factory.bin` through the updater — that image includes the bootloader and would be rejected by the vector check.

---

## Keyboard Usages

Factory keys ship empty. Common HID usages when assigning keys:

| Key | Usage | Key | Usage |
|-----|-------|-----|-------|
| A–Z | `0x04`–`0x1D` | Tab | `0x2B` |
| Esc | `0x29` | Enter | `0x28` |
| Space | `0x2C` | Backspace | `0x2A` |

**Modifier bits** (byte 1 of report 1): LCtrl = bit 0, LShift = bit 1, LAlt = bit 2, LWin/LGUI = bit 3. A Win tap is `mods = 0x08` with HID usage `0` (not usage `0xE3`).

**Consumer usages** (report 3): Prev Track `0xB6`, Next Track `0xB5`, Play/Pause `0xCD`.
