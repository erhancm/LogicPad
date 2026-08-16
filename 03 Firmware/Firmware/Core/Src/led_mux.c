#include "led_mux.h"
#include "storage.h"
#include "main.h"

static const uint16_t anode_pin[9] = {
    C0R0_Pin, C1R0_Pin, C2R0_Pin,
    C0R1_Pin, C1R1_Pin, C2R1_Pin,
    C0R2_Pin, C1R2_Pin, C2R2_Pin,
};

static uint8_t slice;
static uint8_t flash_key = 0xFF;
static uint16_t flash_ms;
static uint16_t idle_ms;

static void anodes_off(void) {
  HAL_GPIO_WritePin(GPIOA, C0R0_Pin | C0R1_Pin | C0R2_Pin | C1R0_Pin | C1R1_Pin |
                                C1R2_Pin | C2R0_Pin | C2R1_Pin | C2R2_Pin,
                    GPIO_PIN_RESET);
}

static void cathodes_off(void) {
  HAL_GPIO_WritePin(GPIOB, R_Ctrl_Pin | G_Ctrl_Pin | B_Ctrl_Pin, GPIO_PIN_SET);
}

void led_mux_init(void) {
  anodes_off();
  cathodes_off();
}

void led_mux_key_flash(uint8_t key) {
  flash_key = key;
  flash_ms = 120;
  idle_ms = 0;
}

void led_mux_tick(void) {
  lp_profile_t *pr = storage_active();
  uint8_t mode = pr->light_mode;
  uint8_t bright = pr->bright > 10 ? 10 : pr->bright;
  uint8_t dim = pr->dim > 10 ? 10 : pr->dim;

  if (flash_ms) {
    flash_ms--;
    if (!flash_ms) {
      flash_key = 0xFF;
    }
  } else if (idle_ms < 60000) {
    idle_ms++;
  }

  uint8_t level = (idle_ms > 2000) ? dim : bright;
  uint8_t pwm = (slice % 10) < level;

  anodes_off();
  cathodes_off();

  if (!pwm || mode == 0) {
    slice++;
    return;
  }

  uint8_t k = slice % 9;
  uint8_t color = pr->keys[k].led;
  if (mode == 2 && flash_key == k) {
    color = LED_WHITE;
  } else if (mode == 2 && flash_key != k) {
    color = LED_OFF;
  }

  if (color == LED_OFF) {
    slice++;
    return;
  }

  HAL_GPIO_WritePin(GPIOA, anode_pin[k], GPIO_PIN_SET);
  if (color == LED_RED || color == LED_WHITE) {
    HAL_GPIO_WritePin(GPIOB, R_Ctrl_Pin, GPIO_PIN_RESET);
  }
  if (color == LED_GREEN || color == LED_WHITE) {
    HAL_GPIO_WritePin(GPIOB, G_Ctrl_Pin, GPIO_PIN_RESET);
  }
  if (color == LED_BLUE || color == LED_WHITE) {
    HAL_GPIO_WritePin(GPIOB, B_Ctrl_Pin, GPIO_PIN_RESET);
  }
  slice++;
}
