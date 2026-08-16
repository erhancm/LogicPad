#include "led_mux.h"
#include "storage.h"
#include "main.h"

/*
 * V0.2 LED matrix:
 *  - Anodes: BSS84 P-FET high-side (GPIO low = ON, GPIO high = OFF)
 *  - Colors: 2N7002 N-FET sinks (GPIO high = ON, GPIO low = OFF)
 * TIM2 soft-PWM mux @ 9 kHz, key-major scan, independent of main loop.
 */

#define LED_IRQ_HZ 9000u
#define LED_PWM_STEPS 10u
#define LED_KEYS 9u
#define LED_MS_TICKS (LED_IRQ_HZ / 1000u)

static const uint16_t anode_pin[LED_KEYS] = {
    C0R0_Pin, C1R0_Pin, C2R0_Pin,
    C0R1_Pin, C1R1_Pin, C2R1_Pin,
    C0R2_Pin, C1R2_Pin, C2R2_Pin,
};

static TIM_HandleTypeDef htim_led;
static uint8_t slice;
static uint8_t flash_key = 0xFF;
static uint16_t flash_ms;
static uint16_t idle_ms;
static uint16_t ms_div;

/* P-FET anodes: high = off. */
static void anodes_off(void) {
  HAL_GPIO_WritePin(GPIOA, C0R0_Pin | C0R1_Pin | C0R2_Pin | C1R0_Pin | C1R1_Pin |
                                C1R2_Pin | C2R0_Pin | C2R1_Pin | C2R2_Pin,
                    GPIO_PIN_SET);
}

static void anode_on(uint8_t key) {
  HAL_GPIO_WritePin(GPIOA, anode_pin[key], GPIO_PIN_RESET);
}

/* N-FET color sinks: high = on. Green/White appears swapped on V0.2 LEDs. */
static void drive_color(uint8_t color) {
  if (color == LED_GREEN) {
    color = LED_WHITE;
  } else if (color == LED_WHITE) {
    color = LED_GREEN;
  }

  GPIO_PinState r = GPIO_PIN_RESET;
  GPIO_PinState g = GPIO_PIN_RESET;
  GPIO_PinState b = GPIO_PIN_RESET;
  if (color == LED_RED || color == LED_WHITE) {
    r = GPIO_PIN_SET;
  }
  if (color == LED_GREEN || color == LED_WHITE) {
    g = GPIO_PIN_SET;
  }
  if (color == LED_BLUE || color == LED_WHITE) {
    b = GPIO_PIN_SET;
  }
  HAL_GPIO_WritePin(GPIOB, R_Ctrl_Pin, r);
  HAL_GPIO_WritePin(GPIOB, G_Ctrl_Pin, g);
  HAL_GPIO_WritePin(GPIOB, B_Ctrl_Pin, b);
}

static void led_mux_step(void) {
  lp_profile_t *pr = storage_active();
  uint8_t mode = pr->light_mode;
  uint8_t bright = pr->bright > 10 ? 10 : pr->bright;
  uint8_t dim = pr->dim > 10 ? 10 : pr->dim;

  if (++ms_div >= LED_MS_TICKS) {
    ms_div = 0;
    if (flash_ms) {
      flash_ms--;
      if (!flash_ms) {
        flash_key = 0xFF;
      }
    } else if (idle_ms < 60000) {
      idle_ms++;
    }
  }

  uint8_t phase = slice % LED_PWM_STEPS;
  uint8_t key = slice / LED_PWM_STEPS;
  slice++;
  if (slice >= (uint8_t)(LED_KEYS * LED_PWM_STEPS)) {
    slice = 0;
  }

  uint8_t level = (idle_ms > 2000) ? dim : bright;

  anodes_off();
  drive_color(LED_OFF);

  if (phase >= level || mode == 0) {
    return;
  }

  uint8_t color = pr->keys[key].led;
  if (mode == 2) {
    color = (flash_key == key) ? (uint8_t)LED_WHITE : (uint8_t)LED_OFF;
  }
  if (color == LED_OFF || color > LED_BLUE) {
    return;
  }

  drive_color(color);
  anode_on(key);
}

void led_mux_init(void) {
  anodes_off();
  drive_color(LED_OFF);
  /* CtrlLed is also a P-FET anode — keep off. */
  HAL_GPIO_WritePin(CtrlLed_GPIO_Port, CtrlLed_Pin, GPIO_PIN_SET);

  __HAL_RCC_TIM2_CLK_ENABLE();

  htim_led.Instance = TIM2;
  htim_led.Init.Prescaler = 0;
  htim_led.Init.CounterMode = TIM_COUNTERMODE_UP;
  htim_led.Init.Period = (72000000u / LED_IRQ_HZ) - 1u;
  htim_led.Init.ClockDivision = TIM_CLOCKDIVISION_DIV1;
  htim_led.Init.AutoReloadPreload = TIM_AUTORELOAD_PRELOAD_DISABLE;
  if (HAL_TIM_Base_Init(&htim_led) != HAL_OK) {
    Error_Handler();
  }

  HAL_NVIC_SetPriority(TIM2_IRQn, 2, 0);
  HAL_NVIC_EnableIRQ(TIM2_IRQn);
  HAL_TIM_Base_Start_IT(&htim_led);
}

void led_mux_key_flash(uint8_t key) {
  flash_key = key;
  flash_ms = 120;
  idle_ms = 0;
}

void TIM2_IRQHandler(void) {
  if (__HAL_TIM_GET_FLAG(&htim_led, TIM_FLAG_UPDATE) != RESET) {
    if (__HAL_TIM_GET_IT_SOURCE(&htim_led, TIM_IT_UPDATE) != RESET) {
      __HAL_TIM_CLEAR_IT(&htim_led, TIM_IT_UPDATE);
      led_mux_step();
    }
  }
}
