# LogicPad Pinout

This is the definitive pin-mapping reference for the LogicPad hardware. Firmware must match this document.

**MCU:** STM32F103C8 (48-pin LQFP, 72 MHz, USB FS)
**USB:** Type-B connector, using the STM32's built-in USB FS peripheral. Standard OS HID drivers — no custom kernel driver needed.
**OLED:** 0.96-inch SSD1306, 128 x 64 pixels, connected over I2C1.

---

## Key Matrix

The 3 x 3 key grid plus the selector button are scanned as a matrix. The MCU drives columns low one at a time and reads the rows to detect which key is pressed.

**Scanning method:** Column drive, row read. Columns sit idle-high; the firmware pulls one column low per scan step and reads the row pins. A pressed key shows as low on its row when its column is driven low.

| Net Name    | MCU Pin | Direction      | Notes                                                              |
|-------------|---------|----------------|--------------------------------------------------------------------|
| Column_0    | PB5     | Output         | Idle high; driven low to scan                                      |
| Column_1    | PB4     | Output         | Available as GPIO because SWJ is set to NOJTAG mode                |
| Column_2    | PB3     | Output         | Available as GPIO because SWJ is set to NOJTAG mode                |
| Row_0       | PB12    | Input, pull-up | Top row of the key grid                                            |
| Row_1       | PB13    | Input, pull-up | Middle row                                                         |
| Row_2       | PB14    | Input, pull-up | Bottom row                                                         |
| Selector    | PB15    | Input, pull-up | Standalone button below the grid. Short press = menu/back, long press (500 ms) = home. Not a 10th macro key. |

### Key Index Map

Keys are indexed in row-major order (left to right, top to bottom):

```
[0] [1] [2]      row 0
[3] [4] [5]      row 1
[6] [7] [8]      row 2
      [SEL]       selector button (below the grid, centered)
```

> **Note:** Older test firmware used the opposite scanning direction (row drive, column read). Do not use that polarity — the current production firmware uses column drive / row read as described above.

---

## OLED Display (I2C1)

The SSD1306 OLED communicates over I2C1 at 400 kHz (fast mode).

| Net Name | MCU Pin  | I2C Function |
|----------|----------|--------------|
| SCL      | PB6      | I2C1 clock   |
| SDA      | PB7      | I2C1 data    |

**I2C address:** `0x78` (8-bit HAL address, which is `0x3C` in 7-bit notation).

---

## Per-Key RGB LEDs

Each of the 9 keys and the selector button has its own RGB LED. The LEDs are driven by a software PWM multiplexer running on TIM2 at 16 kHz (about 111 Hz refresh per key with 16 PWM steps).

### Anode (High-Side) Switches — PA0 through PA8

Each key's LED anode is switched through a **BSS84 P-channel MOSFET**. The GPIO pins on PA0 through PA8 control these switches:

| Net Name | MCU Pin | Key Index | Notes                        |
|----------|---------|-----------|------------------------------|
| C0R0     | PA0     | 0         | Top-left key                 |
| C0R1     | PA1     | 1         | Top-center key               |
| C0R2     | PA2     | 2         | Top-right key                |
| C1R0     | PA3     | 3         | Middle-left key              |
| C1R1     | PA4     | 4         | Middle-center key            |
| C1R2     | PA5     | 5         | Middle-right key             |
| C2R0     | PA6     | 6         | Bottom-left key              |
| C2R1     | PA7     | 7         | Bottom-center key            |
| C2R2     | PA8     | 8         | Bottom-right key             |
| CtrlLed  | PA9     | SEL       | Selector RGB LED (10th pixel, not a 10th macro key) |

**Polarity:** GPIO **low = LED on**, GPIO **high = LED off** (P-FET high-side switch).

> **Important:** The net names (C0R0, C0R1, C0R2, ...) walk down each column on the MCU port, which is the transpose of the physical key grid. The firmware accounts for this — key index 0 maps to C0R0 (PA0), key index 1 maps to C0R1 (PA1), and so on in row-major order.

### Color Sink (Low-Side) Switches — PB8, PB9, PB10

The red, green, and blue color channels share common sink lines. Each channel is switched through a **2N7002 N-channel MOSFET**:

| Net Name | MCU Pin | Color  | Polarity                    |
|----------|---------|--------|-----------------------------|
| R_Ctrl   | PB8     | Red    | GPIO **high = on**, low = off |
| G_Ctrl   | PB9     | Green  | GPIO **high = on**, low = off |
| B_Ctrl   | PB10    | Blue   | GPIO **high = on**, low = off |

White is achieved by turning on all three color channels simultaneously.

---

## USB

The LogicPad connects to the host via a **USB Type-B** connector wired to the STM32F103's built-in USB FS peripheral. It presents as a standard HID composite device (keyboard, mouse, media keys, and vendor-specific reports). The host OS uses its inbox HID drivers — no custom kernel driver is required.

---

## Pin Usage Summary

| Port | Pins Used   | Function                              |
|------|-------------|---------------------------------------|
| PA0  | PA0 - PA8   | LED anode switches (9 keys)           |
| PA9  | PA9         | Selector LED anode switch             |
| PA11 | PA12        | USB D- / D+ (USB FS peripheral)       |
| PB3  | PB3 - PB5   | Key matrix columns (outputs)          |
| PB6  | PB7         | I2C1 SCL / SDA (OLED)                |
| PB8  | PB8 - PB10  | LED color sinks (R, G, B)             |
| PB12 | PB12 - PB14 | Key matrix rows (inputs, pull-up)     |
| PB15 | PB15        | Selector button (input, pull-up)      |
