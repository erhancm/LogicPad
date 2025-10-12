# LogicPad 3x3 Macro Pad - Project Progress Tracker

## Project Overview
A programmable 3x3 macro pad with RGB LED feedback, featuring USB custom HID for PC configuration and internal Flash storage for macro persistence.

## Current Status Analysis

### ✅ Completed Components
- **Hardware Configuration**: GPIO pins configured for 3x3 RGB LED matrix
- **LED Control**: Basic RGB LED test functionality implemented
- **Pin Definitions**: All GPIO pins defined in [`main.h`](Core/Inc/main.h)

### 🔧 Issues Identified
1. **Inconsistent Pull Configuration**: Mixed pull-up/pull-down settings in [`gpio.c`](Core/Src/gpio.c)
2. **LED Control Logic**: Duplicate code and inverted logic in [`LED_Control.c`](Core/Src/LED_Control.c)
3. **Missing USB**: No USB or custom HID implementation
4. **No Button Matrix**: Current design only has LED output, no button input

### 🎯 Project Architecture
- **3x3 Macro Keys**: Each physical button corresponds to a programmable macro
- **RGB LED Feedback**: Visual indication of key states and modes
- **USB Custom HID**: Bidirectional communication with PC for configuration
- **Internal Flash Storage**: Persistent macro storage without external memory

## Detailed Pin Configuration

### GPIO Port A (LED Anodes)
| Pin Name | Pin Number | Function | Status |
|----------|------------|----------|---------|
| `C0R0_Pin` | `GPIO_PIN_0` | LED Matrix Column 0, Row 0 | ✅ Configured |
| `C0R1_Pin` | `GPIO_PIN_1` | LED Matrix Column 0, Row 1 | ✅ Configured |
| `C0R2_Pin` | `GPIO_PIN_2` | LED Matrix Column 0, Row 2 | ✅ Configured |
| `C1R0_Pin` | `GPIO_PIN_3` | LED Matrix Column 1, Row 0 | ✅ Configured |
| `C1R1_Pin` | `GPIO_PIN_4` | LED Matrix Column 1, Row 1 | ✅ Configured |
| `C1R2_Pin` | `GPIO_PIN_5` | LED Matrix Column 1, Row 2 | ✅ Configured |
| `C2R0_Pin` | `GPIO_PIN_6` | LED Matrix Column 2, Row 0 | ✅ Configured |
| `C2R1_Pin` | `GPIO_PIN_7` | LED Matrix Column 2, Row 1 | ✅ Configured |
| `C2R2_Pin` | `GPIO_PIN_8` | LED Matrix Column 2, Row 2 | ✅ Configured |
| `CtrlLed_Pin` | `GPIO_PIN_9` | Control LED | ✅ Configured |

### GPIO Port B (Control & Input)
| Pin Name | Pin Number | Function | Status |
|----------|------------|----------|---------|
| `B_Ctrl_Pin` | `GPIO_PIN_10` | Blue LED Cathode Control | ✅ Configured |
| `Row_0_Pin` | `GPIO_PIN_12` | Row Control 0 | ✅ Configured |
| `Row_1_Pin` | `GPIO_PIN_13` | Row Control 1 | ✅ Configured |
| `Row_2_Pin` | `GPIO_PIN_14` | Row Control 2 | ✅ Configured |
| `Selector_Pin` | `GPIO_PIN_15` | Mode Selection Input | ✅ Configured |
| `Column_2_Pin` | `GPIO_PIN_3` | Column Control 2 | ✅ Configured |
| `Column_1_Pin` | `GPIO_PIN_4` | Column Control 1 | ✅ Configured |
| `Column_0_Pin` | `GPIO_PIN_5` | Column Control 0 | ✅ Configured |
| `R_Ctrl_Pin` | `GPIO_PIN_8` | Red LED Cathode Control | ✅ Configured |
| `G_Ctrl_Pin` | `GPIO_PIN_9` | Green LED Cathode Control | ✅ Configured |

## Implementation Roadmap

### Phase 1: Hardware Foundation ✅
- [x] Configure GPIO pins for LED matrix
- [x] Implement basic LED control functions
- [x] Test RGB LED functionality

### Phase 2: USB Custom HID Implementation 🔄
- [ ] Configure USB peripheral in STM32CubeMX
- [ ] Design custom HID report descriptor
- [ ] Implement USB device stack
- [ ] Create data transfer functions

### Phase 3: Button Matrix & Input 🔄
- [ ] Design 3x3 button matrix circuit
- [ ] Implement button scanning algorithm
- [ ] Add debouncing logic
- [ ] Map buttons to macro keys

### Phase 4: Flash Storage & Configuration 🔄
- [ ] Design macro data structure
- [ ] Implement Flash read/write functions
- [ ] Create configuration protocol
- [ ] Add error handling for Flash operations

### Phase 5: PC Configuration Application 🔄
- [ ] Develop PC GUI application
- [ ] Implement HID communication
- [ ] Add macro editing interface
- [ ] Create keycode mapping system

### Phase 6: Advanced Features 🔄
- [ ] Implement LED feedback for key states
- [ ] Add multiple macro profiles
- [ ] Create configuration validation
- [ ] Optimize performance

## Technical Specifications

### Custom HID Report Descriptor (Planned)
- **Report ID 1**: Standard keyboard input (key presses)
- **Report ID 2**: Custom configuration output (macro programming)
- **Data Structure**: Macro key index, keycode count, keycode array

### Flash Memory Usage
- **Storage Location**: Dedicated Flash sector/page
- **Data Structure**: Array of `MacroDefinition_t` structs
- **Persistence**: Survives power cycles
- **Endurance**: ~10,000 write cycles (sufficient for configuration)

### LED Matrix Control
- **Type**: Common cathode RGB LEDs
- **Control**: Multiplexed scanning
- **Colors**: Individual RGB control per LED
- **Feedback**: Key states, modes, errors

## Next Steps Priority

1. **Fix LED Control Logic** - Address duplicate code and inverted logic
2. **Implement USB Custom HID** - Core communication functionality
3. **Add Button Matrix** - Physical input for macro keys
4. **Develop Flash Storage** - Persistent macro configuration

## Files to Modify
- [`Core/Src/LED_Control.c`](Core/Src/LED_Control.c) - Fix LED logic
- [`Core/Src/gpio.c`](Core/Src/gpio.c) - Add button matrix configuration
- STM32CubeMX project - Add USB configuration
- New files: `macro_config.h/c`, `usb_hid_keys.h`, `button_matrix.h/c`

## Notes
- Project uses STM32F1 series microcontroller
- No external memory required - uses internal Flash
- Generic HID driver on PC - no custom kernel driver needed
- Cross-platform PC application possible (Python, C#, etc.)