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

Structs are in `03 Firmware/Firmware/Core/Inc/storage.h`. OLED USB dot blinks while a vendor command was seen in the last 2 s.

The pad keeps sending keyboard/mouse/media while the app holds report 4.

## Keyboard usages

Factory keys are empty. When assigning: A=0x04 … Z=0x1D. LCtrl modifier bit 0. Consumer: Prev `0xB6`, Next `0xB5`, Play/Pause `0xCD`.
