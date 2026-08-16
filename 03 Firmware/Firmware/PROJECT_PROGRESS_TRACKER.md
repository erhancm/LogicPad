# LogicPad firmware progress

Agent continuation (locks + next steps): [`AGENTS.md`](../../AGENTS.md) at repo root.

## Done in code (v0.1)

- [x] GPIO: columns PB3/4/5 outputs (idle high), rows PB12/13/14 input pull-up, Selector PB15 pull-up
- [x] 1 ms keypad scan, debounce, SEL short/long, hold-repeat
- [x] SSD1306 I2C UI (all planned screens, Font_6x8 + 2× lists)
- [x] USB Custom HID: keyboard + mouse + consumer + vendor (report IDs 1–4)
- [x] Macro engine + CRC ping-pong flash (last 8 KB, linker FLASH = 56 KB)
- [x] Per-key RGB mux from Lights / key LED color
- [ ] Own VID/PID (still ST test IDs 1155/22352)
- [ ] Tauri configurator (`04 Software/` not started)
- [ ] Field DFU (out of scope)

## How to use

Plug USB in. Windows/macOS/Linux see a keyboard. Default profile WORK: Copy/Paste/Cut, Undo/Save/Find, media prev/play/next.

SEL opens the OLED menu. Configure profiles, keys, macros, lights, and screen on the device. No PC app required.

## Build

STM32CubeIDE or CMake preset `Debug` in `03 Firmware/Firmware/` (arm-none-eabi-gcc + Ninja). Flash with ST-Link. Do not regenerate CubeMX over USER CODE; rows must stay inputs.
