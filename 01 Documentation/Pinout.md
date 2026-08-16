# LogicPad pinout

Source of truth for the PCB: [Pinout.pdf](Pinout.pdf). Firmware must match this document, not the outdated test keypad driver.

MCU: STM32F103C8. USB-B. OLED 0.96" SSD1306 128×64 on I2C1.

## Matrix (column drive, row read)

| Net | Pin | Direction | Notes |
|-----|-----|-----------|--------|
| Column_0 | PB5 | Output | Idle high; drive low to scan |
| Column_1 | PB4 | Output | SWJ is NOJTAG so PB3/PB4 are GPIO |
| Column_2 | PB3 | Output | |
| Row_0 | PB12 | Input pull-up | Top row. Pressed = low when its column is low |
| Row_1 | PB13 | Input pull-up | |
| Row_2 | PB14 | Input pull-up | Bottom row |
| Selector | PB15 | Input pull-up | Short = menu/back, long = home. Not a 10th macro |

Key index is row-major:

```
[0] [1] [2]     row 0 × col 0/1/2
[3] [4] [5]
[6] [7] [8]
      [SEL]
```

Do not use the old firmware polarity (row drive / column read).

## OLED

| Net | Pin |
|-----|-----|
| SCL | PB6 (I2C1) |
| SDA | PB7 (I2C1) |
| Address | `0x78` (8-bit HAL address) |

I2C speed: 400 kHz.

## Per-key RGB

Anodes on PA0–PA8 (`C0R0` … `C2R2`). Common color enables: `R_Ctrl` PB8, `G_Ctrl` PB9, `B_Ctrl` PB10. LED on = anode high and color enable **high** (active-high on V0.2). Time-sliced mux in firmware. `CtrlLed` PA9 unused in v1.

## USB

USB-B to the F103 USB FS peripheral. Inbox OS HID drivers. No custom kernel driver.
