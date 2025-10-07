# GPIO Pin Configuration

This document details the GPIO pin configurations for the project, as extracted from the `main.h` and `gpio.c` files.

## LED Matrix Configuration

The project utilizes a 3x3 LED array. Each LED has an ANODE connected to a `CxRy_Pin` (Column x, Row y) and a CATHODE controlled by `R_Ctrl`, `G_Ctrl`, or `B_Ctrl` pins.

- **`CxRy_Pin` (e.g., `C0R0_Pin`, `C1R0_Pin`):** These pins drive the ANODE of individual LEDs. There are 9 such pins, representing a 3x3 matrix (Column 0-2, Row 0-2).
- **`R_Ctrl_Pin`, `G_Ctrl_Pin`, `B_Ctrl_Pin`:** These pins control the CATHODE of all Red, Green, or Blue LEDs, respectively. When activated (pulled low), they enable the corresponding color for all LEDs in the matrix.

## GPIO Port A

| Pin Name    | Pin Number | Configuration             |
| :---------- | :--------- | :------------------------ |
| `C0R0_Pin`  | `GPIO_PIN_0` | Output Push-Pull, Low Speed |
| `C0R1_Pin`  | `GPIO_PIN_1` | Output Push-Pull, Low Speed |
| `C0R2_Pin`  | `GPIO_PIN_2` | Output Push-Pull, Low Speed |
| `C1R0_Pin`  | `GPIO_PIN_3` | Output Push-Pull, Low Speed |
| `C1R1_Pin`  | `GPIO_PIN_4` | Output Push-Pull, Low Speed |
| `C1R2_Pin`  | `GPIO_PIN_5` | Output Push-Pull, Low Speed |
| `C2R0_Pin`  | `GPIO_PIN_6` | Output Push-Pull, Low Speed |
| `C2R1_Pin`  | `GPIO_PIN_7` | Output Push-Pull, Low Speed |
| `C2R2_Pin`  | `GPIO_PIN_8` | Output Push-Pull, Low Speed |
| `CtrlLed_Pin` | `GPIO_PIN_9` | Output Push-Pull, Low Speed |

## GPIO Port B

| Pin Name       | Pin Number   | Configuration             |
| :------------- | :----------- | :------------------------ |
| `B_Ctrl_Pin`   | `GPIO_PIN_10`  | Output Push-Pull, Low Speed |
| `Row_0_Pin`    | `GPIO_PIN_12`  | Output Push-Pull, Low Speed |
| `Row_1_Pin`    | `GPIO_PIN_13`  | Output Push-Pull, Low Speed |
| `Row_2_Pin`    | `GPIO_PIN_14`  | Output Push-Pull, Low Speed |
| `Selector_Pin` | `GPIO_PIN_15`  | Input, No Pull-up/Pull-down |
| `Column_2_Pin` | `GPIO_PIN_3`   | Output Push-Pull, Low Speed |
| `Column_1_Pin` | `GPIO_PIN_4`   | Output Push-Pull, Low Speed |
| `Column_0_Pin` | `GPIO_PIN_5`   | Output Push-Pull, Low Speed |
| `R_Ctrl_Pin`   | `GPIO_PIN_8`   | Output Push-Pull, Low Speed |
| `G_Ctrl_Pin`   | `GPIO_PIN_9`   | Output Push-Pull, Low Speed |