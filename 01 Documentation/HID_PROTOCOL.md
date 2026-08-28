# LogicPad HID protocol

One USB Custom HID interface. Inbox OS drivers for reports 1–3. Report 4 is ignored by the OS; the optional Tauri app opens it.

## Report IDs

| ID | Size (incl. ID) | Direction | Purpose |
|----|-----------------|-----------|---------|
| 1 | 9 | IN | Keyboard: mods, reserved, 6KRO |
| 2 | 5 | IN | Mouse: buttons, X, Y, wheel |
| 3 | 3 | IN | Consumer 16-bit usage |
| 4 | 64 | IN/OUT | Vendor config, 63-byte payload |

EP IN/OUT max packet = 64. Poll interval 1 ms.

## Vendor packets

Byte 0 = report ID `4`. Byte 1 = command. Bytes 2–63 = payload.

PING payload is protocol `0x01, 0x08` (minor `8` = standby clock style in GET_META / SET_SCREEN). Minor `7` is `GET_LEDS` live RGB snapshot. Minor `6` is `SET_SCREEN` for OLED contrast / flip / sleep; `5` is packed flash store, add profiles until the slot is full; `4` is `SET_HOST` idle home; `3` is 12-character key titles; `2` is add/delete profiles; `1` is type-text pool only; `0` is older firmware without the pool.

| Cmd | Name | Host → pad | Pad → host |
|-----|------|------------|------------|
| 0x01 | PING | — | version `0x01, 0x07` |
| 0x02 | GET_META | — | active, dirty, contrast, flip, sleep, in_menu (OLED config screens only; 0 on home/toast/sleep), usb, n_profiles, used u16le, cap u16le, clock_style (minor ≥ 8) |
| 0x03 | GET_KEY | profile, key | profile, key, first `LP_KEY_HID_BYTES` (57) of `lp_key_t` |
| 0x04 | SET_KEY | profile, key, 60-byte HID blob | echo profile, key, status |
| 0x05 | SET_ACTIVE | profile | echo (live slot only; does not mark flash dirty) |
| 0x06 | SAVE | — | ack |
| 0x07 | RELOAD | — | ack |
| 0x08 | FACTORY | — | ack |
| 0x09 | GET_PROFILE_HDR | profile | name + lighting |
| 0x0A | SET_PROFILE_HDR | profile + name + lighting | echo |
| 0x0B | GET_STATUS | — | same as GET_META |
| 0x0C | ENTER_BOOTLOADER | — | ack, then reset into the 4 KB HID updater |
| 0x0D | KEY_EVENT | — | unsolicited IN: profile, key, down (1/0). Live keys only. |
| 0x0E | SET_TIME | year u16le, month, day, hour, min, sec (local 24h) | echo |
| 0x0F | GET_TEXT | profile, key, offset | profile, key, total_len, offset, pool_used u16le, data (56) |
| 0x10 | SET_TEXT | profile, key, offset, total_len, data (58) | profile, key, offset, status, pool_used u16le |
| 0x11 | ADD_PROFILE | — | index, n_profiles, status |
| 0x12 | DEL_PROFILE | profile | profile, n_profiles, active, status |
| 0x13 | GET_TITLE | profile, key | profile, key, title (12+NUL) |
| 0x14 | SET_TITLE | profile, key, title (12, NUL-padded) | echo profile, key |
| 0x15 | SET_HOST | `1` = PC session in use, `0` = away (locked / logged off) | echo |
| 0x16 | SET_SCREEN | contrast (0–10), flip (0–1), sleep (0–4), clock_style (minor ≥ 8) | echo + status `0` ok / `1` bad values |
| 0x17 | GET_LEDS | — | 10 colors, 10 duties (keys 0–8, then SEL), then anim_ms u16le, idle_ms u16le, flash_key, flash_ms u16le, ripple_key, ripple_age u16le, flood. Color is `LED_OFF/WHITE/RED/GREEN/BLUE`. Duty is 0–16 PWM steps after gamma. Older minor `7` images may omit the clock bytes. |

`SET_SCREEN` writes the pad-wide OLED contrast, 180° flip, idle sleep (Never / 15s / 30s / 1m / 5m), and standby clock band style. `clock_style` bits 0–2 = animation (Bounce / Scan / March / Pulse / Wave / Blocks / Off), bits 3–4 = speed, bit 5 = seconds bar. Same as Setup → Screen on the pad. Applies hardware immediately and marks flash dirty; persist with **Save**. Older firmware without minor `6` ignores the command; without minor `8` ignores `clock_style`.

`GET_LEDS` copies the mux’s current frame (`pix_color` / `pix_duty`) and the animation clocks (`anim_ms`, idle, flash, ripple) so the companion app can phase-lock Wave / Breathe / the rest instead of running a separate timer. It does not mark flash dirty and does not count as a vendor session (OLED USB dot stays off). Older firmware without minor `7` ignores the command. SEL is index 9; in Solid it follows key 0 (the key below it).

`SET_ACTIVE` changes the live profile and redraws lights/OLED. It does not set `dirty`, so the host auto-switch in the Tauri app will not pop the OLED save prompt. Persist the slot with **Save**, or change it on the device (OLED still marks dirty). Old firmware that dirties on `SET_ACTIVE` should be updated.

`SET_KEY` copies only the HID prefix of `lp_key_t` (`label[7]`, LED, action count, 12 actions). It does not touch `title`. `SET_TITLE` stores the 12-character display name and fills `label` with the first 6 non-space characters as a stub for old packets. OLED and the PC app show `title` (fall back to `label` if empty). `SET_KEY` status `0` ok, `1` flash slot full (change discarded). `SET_TEXT` status `0` ok, `1` slot full, `2` longer than 240 bytes, `3` bad args. Offset `0` starts a new write; further packets must continue from the next byte. Empty `total_len` clears that key.

`ADD_PROFILE` appends an empty profile (default name `P1`, `P2`, …, Solid lights). Status `0` ok, `1` slot full or 255 profiles. `DEL_PROFILE` compact-deletes that slot. Status `0` ok, `2` would leave zero profiles, `3` bad index. Factory still ships four empty profiles; **+ New** adds more until the 4 KB slot fills. Empty keys take no flash. `n_profiles` `0` on older firmware means 4.

`ENTER_BOOTLOADER` acks, then the main loop shows **FLASH / BOOT MODE** on the OLED and resets. Do not wait in the USB callback — USB IRQ priority 0 would hang `HAL_Delay`.

Profiles, macros, and typed strings share the **packed ping-pong slot** (about 4076 bytes after clock snaps). Max 240 bytes per key. `ACT_TEXT` (`8`) is a macro step that types that string as US-HID taps, so later steps can be Enter or a chord. Keys that still have text but no `ACT_TEXT` play the string after the other actions (older saves). Store magic is `LPAI` (`0x4C504149`). Boot copies an `LPAH` (`0x4C504148`) 4-profile store into the packed layout. Older `LPAG` / `LPAF` stores are discarded.

Structs are in `03 Firmware/Firmware/Core/Inc/storage.h`. OLED USB dot blinks while a vendor command was seen in the last 2 s.

The pad keeps sending keyboard/mouse/media while the app holds report 4. KEY_EVENT lets the Tauri app launch host programs; that mapping lives on the PC, not in flash. The app can also watch the focused Windows program and send SET_ACTIVE (rules in `profile-rules.json`, not flash). SET_HOST tells the pad whether the Windows session is in use (unlocked) or away (locked, logged off, or fast-user-switched) so home/sleep can show the profile name or the clock. USB unconfigured/suspend is away without the app. SET_TIME loads the host's local wall clock. The pad then keeps time on its own (STM32 RTC from the 8 MHz crystal) for as long as it has USB power; it does not need the app connected. There is no 32 kHz backup crystal or battery, so a full unplug still loses the seconds the pad was off; a flash snapshot restores the last saved time. Until the first sync, the display starts at 16 Aug 2026 00:00:00. Open the app now and then if it has drifted.

## Field firmware update

The STM32F103C8 ROM bootloader is USART-only. Updates go through a 4 KB HID bootloader at `0x08000000` (product **LogicPad Boot**, PID `0x5751`). The app stays at `0x08001000` (52 KB). Config store is unchanged at `0x0800E000`.

**Once:** flash `LogicPad_factory.hex` with ST-Link (bootloader + app). After that, the Tauri app **Update firmware** writes `LogicPad.bin` (app only) over vendor report 4.

Recovery: hold **SEL** while plugging USB. The pad stays in LogicPad Boot. The OLED shows **BOOT** / **USB FLASH**, then a progress bar while the image writes.

A software reset (in-app **Update firmware**) also stays in the updater. That bootloader change is in `LogicPad_factory.hex` (ST-Link once); **Update firmware** only writes the app.

| Cmd | Name | Host → boot | Boot → host |
|-----|------|-------------|-------------|
| 0x01 | PING | — | `0x01, 0x00, 0x42` |
| 0x40 | BL_START | size u32le, CRC-32 IEEE u32le | status |
| 0x41 | BL_DATA | up to 62 payload bytes | status, bytes written |
| 0x42 | BL_FINISH | — | status (CRC + vector check), then jump to app |
| 0x43 | BL_ABORT | — | status, jump if app valid |

Status `0` = ok. `1` bad size, `2` bad vectors, `3` flash, `4` CRC, `5` wrong state.

Do not send `LogicPad_factory.bin` through the updater — that image includes the bootloader and would be rejected.

## Keyboard usages

Factory keys are empty. When assigning: A=0x04 … Z=0x1D. Tab `0x2B`, Esc `0x29`, Enter `0x28`, Space `0x2C`, Bksp `0x2A`. Modifier bits: LCtrl 0, LShift 1, LAlt 2, LWin/LGUI 3. A Win tap is mods=`0x08` with hid `0` (not usage `0xE3`). Consumer: Prev `0xB6`, Next `0xB5`, Play/Pause `0xCD`.
