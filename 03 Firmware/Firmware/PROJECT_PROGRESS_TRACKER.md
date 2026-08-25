# LogicPad firmware progress

Agent continuation (locks + next steps): [`AGENTS.md`](../../AGENTS.md) at repo root.

## Done in code (v0.1)

- [x] GPIO: columns PB3/4/5 outputs (idle high), rows PB12/13/14 input pull-up, Selector PB15 pull-up
- [x] 1 ms keypad scan, debounce, SEL short/long, hold-repeat
- [x] SSD1306 I2C UI (all planned screens, Font_6x8 + 2× lists)
- [x] USB Custom HID: keyboard + mouse + consumer + vendor (report IDs 1–4)
- [x] Macro engine + CRC ping-pong flash (last 8 KB at `0x0800E000`; app FLASH = 52 KB at `0x08001000`)
- [x] Per-key RGB mux from Lights / key LED color
- [x] Tauri configurator (`04 Software/logicpad-app/` — connect, profiles, keys, save, firmware update, drag-drop launch, type-text, memory meter)
- [x] HID field update (`03 Firmware/bootloader/`, PID `0x5751`; first flash `LogicPad_factory.hex`, then app `LogicPad.bin`; OLED boot screens + in-app reset from main loop)
- [x] Idle OLED clock (24h `HH:MM:SS`, date `16 Aug 2026`; SET_TIME `0x0E` from the app; HSE RTC keeps time while powered, flash snapshot across power loss)
- [x] Idle home shows the active profile while USB is live; clock when USB is down or SET_HOST `0x15` reports the PC locked / logged off
- [ ] Own VID/PID (still ST test IDs 1155/22352 app, 22353 boot)

## How to use

Plug USB in. Windows/macOS/Linux see a keyboard. Factory profiles P1–P4 have no macros assigned; configure them on the OLED.

SEL opens the OLED menu. Configure profiles, keys, macros, lights, and screen on the device. No PC app required.

## Build

STM32CubeIDE or CMake preset `Release` in `03 Firmware/Firmware/` (arm-none-eabi-gcc + Ninja), after building `03 Firmware/bootloader` Release. First flash: `LogicPad_factory.hex` with ST-Link. Later: Tauri **Update firmware** + `LogicPad.bin`. Do not regenerate CubeMX over USER CODE; rows must stay inputs.
