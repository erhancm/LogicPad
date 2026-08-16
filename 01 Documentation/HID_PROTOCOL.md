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

| Cmd | Name | Host → pad | Pad → host |
|-----|------|------------|------------|
| 0x01 | PING | — | version `0x01, 0x00` |
| 0x02 | GET_META | — | active, dirty, contrast, flip, sleep, in_menu, usb |
| 0x03 | GET_KEY | profile, key | profile, key, first 60 bytes of `lp_key_t` |
| 0x04 | SET_KEY | profile, key, 60 bytes | echo profile, key |
| 0x05 | SET_ACTIVE | profile | echo |
| 0x06 | SAVE | — | ack |
| 0x07 | RELOAD | — | ack |
| 0x08 | FACTORY | — | ack |
| 0x09 | GET_PROFILE_HDR | profile | name + lighting |
| 0x0A | SET_PROFILE_HDR | profile + name + lighting | echo |
| 0x0B | GET_STATUS | — | same as GET_META |
| 0x0C | ENTER_BOOTLOADER | — | ack, then reset into the 4 KB HID updater |
| 0x0D | KEY_EVENT | — | unsolicited IN: profile, key, down (1/0). Live keys only. |

Structs are in `03 Firmware/Firmware/Core/Inc/storage.h`. OLED USB dot blinks while a vendor command was seen in the last 2 s.

The pad keeps sending keyboard/mouse/media while the app holds report 4. KEY_EVENT lets the Tauri app launch host programs; that mapping lives on the PC, not in flash.

## Field firmware update

The STM32F103C8 ROM bootloader is USART-only. Updates go through a 4 KB HID bootloader at `0x08000000` (product **LogicPad Boot**, PID `0x5751`). The app stays at `0x08001000` (52 KB). Config store is unchanged at `0x0800E000`.

**Once:** flash `LogicPad_factory.hex` with ST-Link (bootloader + app). After that, the Tauri app **Update firmware** writes `LogicPad.bin` (app only) over vendor report 4.

Recovery: hold **SEL** while plugging USB. The pad stays in LogicPad Boot.

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

Factory keys are empty. When assigning: A=0x04 … Z=0x1D. LCtrl modifier bit 0. Consumer: Prev `0xB6`, Next `0xB5`, Play/Pause `0xCD`.
