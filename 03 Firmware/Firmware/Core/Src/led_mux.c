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

static void colors_off(void) {
  /* Color enables are active-high on this PCB. */
  HAL_GPIO_WritePin(GPIOB, R_Ctrl_Pin | G_Ctrl_Pin | B_Ctrl_Pin, GPIO_PIN_RESET);
}

static void drive_color(uint8_t color) {
  if (color == LED_RED || color == LED_WHITE) {
    HAL_GPIO_WritePin(GPIOB, R_Ctrl_Pin, GPIO_PIN_SET);
  }
  if (color == LED_GREEN || color == LED_WHITE) {
    HAL_GPIO_WritePin(GPIOB, G_Ctrl_Pin, GPIO_PIN_SET);
  }
  if (color == LED_BLUE || color == LED_WHITE) {
    HAL_GPIO_WritePin(GPIOB, B_Ctrl_Pin, GPIO_PIN_SET);
  }
}

void led_mux_init(void) {
  anodes_off();
  colors_off();
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

  /* PWM phase 0..9, key index separate so brightness stays even. */
  uint8_t phase = slice % 10;
  uint8_t k = (slice / 10) % 9;
  slice++;
  if (slice >= 90) {
    slice = 0;
  }

  uint8_t level = (idle_ms > 2000) ? dim : bright;
  anodes_off();
  colors_off();

  if (phase >= level || mode == 0) {
    return;
  }

  uint8_t color = pr->keys[k].led;
  if (mode == 2) {
    color = (flash_key == k) ? (uint8_t)LED_WHITE : (uint8_t)LED_OFF;
  }
  if (color == LED_OFF || color > LED_BLUE) {
    return;
  }

  drive_color(color);
  HAL_GPIO_WritePin(GPIOA, anode_pin[k], GPIO_PIN_SET);
}
