# LogicPad

LogicPad is a 9-key macro keypad. Each key is programmable (keyboard, mouse, media). A 0.96" OLED is a full on-device editor. Per-key RGB follows the Lights menu.

**Using it:** plug in USB. No driver, no app. The OS inbox HID stack treats it as a keyboard (and mouse/media when those actions run).

**Changing it:** Selector short opens the menu. Left/SEL go back. Hold SEL for home. Optional later: a Tauri app on Windows/macOS/Linux talks vendor HID report 4.

## Firmware

Project: [`03 Firmware/Firmware/`](03%20Firmware/Firmware/). MCU STM32F103C8. Docs: [Pinout.md](01%20Documentation/Pinout.md), [OLED_UI.md](01%20Documentation/OLED_UI.md), [HID_PROTOCOL.md](01%20Documentation/HID_PROTOCOL.md).

Build with the CMake `Debug` preset (arm-none-eabi-gcc) or STM32CubeIDE. Flash over ST-Link. That is a developer step, not product use.
