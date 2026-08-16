# LogicPad HID bootloader

4 KB USB HID updater at `0x08000000`. The STM32F103C8 ROM loader has no USB DFU.

## Build

Needs `arm-none-eabi-gcc` on PATH (STM32CubeCLT is fine).

```
cd "03 Firmware/bootloader"
cmake --preset Release
cmake --build --preset Release
```

Produces `build/Release/bootloader.bin` (must be ≤ 4096 bytes).

Then build the app with CMake preset `Release` in `03 Firmware/Firmware/`. That writes `LogicPad.bin` (updater image) and, if the bootloader binary exists, `LogicPad_factory.hex` (first ST-Link flash).

## First flash (ST-Link, once)

Program `LogicPad_factory.hex`. After that, use the Tauri app **Update firmware** with `LogicPad.bin` only.

## Recovery

Hold SEL while plugging USB. Device enumerates as **LogicPad Boot** (VID `0x0483`, PID `0x5751`).
