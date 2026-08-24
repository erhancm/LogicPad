#include "led_mux.h"
#include "storage.h"
#include "main.h"

/*
 * V0.2 LED matrix:
 *  - Anodes: BSS84 P-FET high-side (GPIO low = ON, GPIO high = OFF)
 *  - Colors: 2N7002 N-FET sinks (GPIO high = ON, GPIO low = OFF)
 * TIM2 soft-PWM mux @ 16 kHz, 16 steps (≈111 Hz/key). Frame is rebuilt at 1 kHz.
 */

#define LED_IRQ_HZ 16000u
#define LED_PWM_STEPS 16u
#define LED_KEYS 9u
#define LED_PIX (LED_KEYS + 1u) /* + selector */
#define LED_MS_TICKS (LED_IRQ_HZ / 1000u)

/* Key index is row-major (same as the keypad). CubeMX CxRy nets walk
 * down each MCU column on PA0–PA8, which is the transpose of that grid:
 *   C0R0 C0R1 C0R2     keys 0 1 2
 *   C1R0 C1R1 C1R2         3 4 5
 *   C2R0 C2R1 C2R2         6 7 8
 */
static const uint16_t anode_pin[LED_KEYS] = {
    C0R0_Pin, C0R1_Pin, C0R2_Pin,
    C1R0_Pin, C1R1_Pin, C1R2_Pin,
    C2R0_Pin, C2R1_Pin, C2R2_Pin,
};

static TIM_HandleTypeDef htim_led;
static uint8_t slice;
static uint8_t flash_key = 0xFF;
static uint16_t flash_ms;
static uint16_t idle_ms;
static uint16_t ms_div;
static uint16_t anim_ms;
static uint8_t ripple_key = 0xFF;
static uint16_t ripple_age;
static uint8_t pix_color[LED_PIX];
static uint8_t pix_duty[LED_PIX];
static uint8_t flood; /* 1 = all anodes together (no 1/9 mux) */

enum {
  MODE_OFF = 0,
  MODE_SOLID,
  MODE_REACT,
  MODE_BREATHE,
  MODE_WAVE,
  MODE_RING,
  MODE_RIPPLE,
  MODE_RAIN,
  MODE_HEART,
  MODE_CROSS,
  MODE_TWINKLE,
  MODE_FULL
};

static const uint8_t HUE[3] = {LED_RED, LED_GREEN, LED_BLUE};
/* Clockwise from top-left; 0xFF = center. */
static const uint8_t RING_POS[LED_PIX] = {0, 1, 2, 7, 0xFF, 3, 6, 5, 4, 5};
/* Linear 0–16 → PWM duty; extra low-end steps so fades don’t stair-step. */
static const uint8_t GAMMA[17] = {0, 1, 1, 2, 2, 3, 4, 5, 6, 8, 10, 12, 13, 14, 15, 16, 16};

static void anodes_off(void) {
  HAL_GPIO_WritePin(GPIOA, C0R0_Pin | C0R1_Pin | C0R2_Pin | C1R0_Pin | C1R1_Pin |
                                C1R2_Pin | C2R0_Pin | C2R1_Pin | C2R2_Pin | CtrlLed_Pin,
                    GPIO_PIN_SET);
}

static void anode_on(uint8_t key) {
  if (key == LED_SEL) {
    HAL_GPIO_WritePin(CtrlLed_GPIO_Port, CtrlLed_Pin, GPIO_PIN_RESET);
  } else {
    HAL_GPIO_WritePin(GPIOA, anode_pin[key], GPIO_PIN_RESET);
  }
}

static void anodes_all_on(void) {
  HAL_GPIO_WritePin(GPIOA, C0R0_Pin | C0R1_Pin | C0R2_Pin | C1R0_Pin | C1R1_Pin |
                                C1R2_Pin | C2R0_Pin | C2R1_Pin | C2R2_Pin | CtrlLed_Pin,
                    GPIO_PIN_RESET);
}

static void pix_rc(uint8_t k, uint8_t *row, uint8_t *col) {
  if (k == LED_SEL) {
    *row = 3;
    *col = 1;
  } else {
    *row = k / 3u;
    *col = k % 3u;
  }
}

/* N-FET color sinks: high = on. White is R+G+B. */
static void drive_color(uint8_t color) {
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

static uint16_t udiff(uint16_t a, uint16_t b) {
  return (a > b) ? (uint16_t)(a - b) : (uint16_t)(b - a);
}

static uint8_t falloff(uint16_t dist, uint16_t width) {
  if (width == 0 || dist >= width) {
    return 0;
  }
  return (uint8_t)(((uint32_t)(width - dist) * 255u) / width);
}

static uint8_t tri255(uint16_t t, uint16_t period) {
  uint16_t h = period / 2u;
  uint16_t p = t % period;
  uint16_t v = (p < h) ? p : (uint16_t)(period - p);
  return (uint8_t)(((uint32_t)v * 255u) / h);
}

static uint8_t hue_at(uint16_t t, uint16_t period) {
  return HUE[(t / period) % 3u];
}

static uint8_t to_duty(uint8_t lv255, uint8_t bright) {
  uint8_t lin;
  if (lv255 == 0 || bright == 0) {
    return 0;
  }
  lin = (uint8_t)(((uint32_t)lv255 * bright * LED_PWM_STEPS) / 2550u);
  if (lin > LED_PWM_STEPS) {
    lin = LED_PWM_STEPS;
  }
  return GAMMA[lin];
}

static void set_pix(uint8_t key, uint8_t color, uint8_t lv255, uint8_t bright) {
  pix_color[key] = color;
  pix_duty[key] = to_duty(lv255, bright);
}

static void show_frame(uint8_t mode, uint8_t bright, uint8_t dim) {
  uint8_t k;
  uint8_t level = (idle_ms > 2000) ? dim : bright;

  flood = 0;
  for (k = 0; k < LED_PIX; k++) {
    pix_color[k] = LED_OFF;
    pix_duty[k] = 0;
  }

  if (mode == MODE_OFF || mode >= LP_N_LIGHT_MODES) {
    return;
  }

  /* All nine anodes on at once (white). PWM is global, not 1/9 scanned.
   * Stays on Bright (ignores idle Dim) so this mode can actually sit at max. */
  if (mode == MODE_FULL) {
    flood = 1;
    for (k = 0; k < LED_PIX; k++) {
      set_pix(k, LED_WHITE, 255, bright);
    }
    return;
  }

  if (mode == MODE_SOLID || mode == MODE_REACT) {
    for (k = 0; k < LED_PIX; k++) {
      uint8_t color;
      if (k == LED_SEL) {
        color = storage_active()->keys[7].led; /* physically under bottom-center */
      } else {
        color = storage_active()->keys[k].led;
      }
      if (mode == MODE_REACT) {
        color = (flash_key == k) ? (uint8_t)LED_WHITE : (uint8_t)LED_OFF;
      }
      if (color != LED_OFF && color <= LED_BLUE) {
        set_pix(k, color, 255, level);
      }
    }
    return;
  }

  for (k = 0; k < LED_PIX; k++) {
    uint8_t row;
    uint8_t col;
    pix_rc(k, &row, &col);
    uint8_t lv = 0;
    uint8_t color = LED_OFF;

    switch (mode) {
    case MODE_BREATHE:
      color = hue_at(anim_ms, 2000);
      lv = tri255(anim_ms, 2000);
      break;
    case MODE_WAVE: {
      uint16_t t = anim_ms % 1280u;
      uint16_t pos = (t < 640u) ? (uint16_t)(t * 256u / 640u)
                                : (uint16_t)((1280u - t) * 256u / 640u);
      color = hue_at(anim_ms, 1280);
      lv = falloff(udiff(pos, (uint16_t)col * 128u), 150);
      break;
    }
    case MODE_RING: {
      uint8_t pos = RING_POS[k];
      uint16_t head;
      uint16_t kp;
      uint16_t d;
      if (pos == 0xFF) {
        break;
      }
      head = (uint16_t)((anim_ms % 720u) * 256u / 720u);
      kp = (uint16_t)pos * 32u;
      d = udiff(head, kp);
      if (d > 128u) {
        d = (uint16_t)(256u - d);
      }
      color = hue_at(anim_ms, 720);
      lv = falloff(d, 52);
      break;
    }
    case MODE_RIPPLE: {
      uint8_t orow;
      uint8_t ocol;
      uint16_t dist;
      uint16_t rad;
      if (ripple_key > LED_SEL || ripple_age == 0) {
        break;
      }
      pix_rc(ripple_key, &orow, &ocol);
      dist = (uint16_t)((row > orow ? row - orow : orow - row) +
                        (col > ocol ? col - ocol : ocol - col)) *
             256u;
      rad = (uint16_t)(ripple_age * 256u / 70u);
      color = hue_at(anim_ms, 1500);
      lv = falloff(udiff(rad, dist), 220);
      break;
    }
    case MODE_RAIN: {
      uint16_t t = (uint16_t)((anim_ms + (uint16_t)col * 190u) % 520u);
      uint16_t drop;
      if (t >= 420u) {
        break;
      }
      drop = (uint16_t)(t * 384u / 420u);
      color = HUE[col];
      lv = falloff(udiff(drop, (uint16_t)row * 128u), 110);
      break;
    }
    case MODE_HEART: {
      uint16_t t = anim_ms % 1100u;
      color = LED_RED;
      if (t < 140u) {
        lv = tri255(t, 140);
      } else if (t >= 200u && t < 340u) {
        lv = (uint8_t)((uint16_t)tri255((uint16_t)(t - 200u), 140) * 7u / 10u);
      }
      break;
    }
    case MODE_CROSS: {
      uint16_t t = anim_ms % 800u;
      uint8_t mix;
      uint8_t is_plus = ((k & 1u) || k == 4u || k == LED_SEL) ? 1u : 0u;
      if (t < 280u) {
        mix = 0;
      } else if (t < 400u) {
        mix = (uint8_t)((t - 280u) * 255u / 120u);
      } else if (t < 680u) {
        mix = 255;
      } else {
        mix = (uint8_t)((800u - t) * 255u / 120u);
      }
      color = hue_at(anim_ms, 1600);
      lv = is_plus ? (uint8_t)(255u - mix) : mix;
      break;
    }
    case MODE_TWINKLE: {
      uint16_t per = (uint16_t)(720u + k * 53u);
      uint16_t ph = (uint16_t)((anim_ms + (uint16_t)k * 181u) % per);
      if (ph < 280u) {
        color = HUE[k % 3u];
        lv = tri255(ph, 280);
      }
      break;
    }
    default:
      break;
    }

    if (lv && color != LED_OFF) {
      set_pix(k, color, lv, bright);
    }
  }
}

static void led_mux_step(void) {
  uint8_t phase;
  uint8_t key;

  if (++ms_div >= LED_MS_TICKS) {
    lp_profile_t *pr = storage_active();
    uint8_t bright = pr->bright > 10 ? 10 : pr->bright;
    uint8_t dim = pr->dim > 10 ? 10 : pr->dim;
    ms_div = 0;
    anim_ms++;
    if (ripple_age && ripple_age < 500) {
      ripple_age++;
    } else if (ripple_age >= 500) {
      ripple_age = 0;
      ripple_key = 0xFF;
    }
    if (flash_ms) {
      flash_ms--;
      if (!flash_ms) {
        flash_key = 0xFF;
      }
    } else if (idle_ms < 60000) {
      idle_ms++;
    }
    show_frame(pr->light_mode, bright, dim);
  }

  if (flood) {
    phase = slice % LED_PWM_STEPS;
    if (++slice >= LED_PWM_STEPS) {
      slice = 0;
    }
    if (phase >= pix_duty[0] || pix_color[0] == LED_OFF || pix_color[0] > LED_BLUE) {
      anodes_off();
      drive_color(LED_OFF);
      return;
    }
    drive_color(pix_color[0]);
    anodes_all_on();
    return;
  }

  phase = slice % LED_PWM_STEPS;
  key = slice / LED_PWM_STEPS;
  slice++;
  if (slice >= (uint8_t)(LED_PIX * LED_PWM_STEPS)) {
    slice = 0;
  }

  anodes_off();
  drive_color(LED_OFF);

  if (phase >= pix_duty[key] || pix_color[key] == LED_OFF || pix_color[key] > LED_BLUE) {
    return;
  }

  drive_color(pix_color[key]);
  anode_on(key);
}

void led_mux_init(void) {
  anodes_off();
  drive_color(LED_OFF);
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
  if (key > LED_SEL) {
    return;
  }
  flash_key = key;
  flash_ms = 120;
  idle_ms = 0;
  ripple_key = key;
  ripple_age = 1;
}

void TIM2_IRQHandler(void) {
  if (__HAL_TIM_GET_FLAG(&htim_led, TIM_FLAG_UPDATE) != RESET) {
    if (__HAL_TIM_GET_IT_SOURCE(&htim_led, TIM_IT_UPDATE) != RESET) {
      __HAL_TIM_CLEAR_IT(&htim_led, TIM_IT_UPDATE);
      led_mux_step();
    }
  }
}
