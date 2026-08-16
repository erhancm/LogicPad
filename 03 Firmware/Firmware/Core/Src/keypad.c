#include "keypad.h"
#include "main.h"

#define DEBOUNCE_MS 10
#define REPEAT_DELAY_MS 400
#define REPEAT_HZ_MS 83
#define SEL_LONG_MS 500
#define QN 8

static const uint16_t col_pin[3] = {Column_0_Pin, Column_1_Pin, Column_2_Pin};
static const uint16_t row_pin[3] = {Row_0_Pin, Row_1_Pin, Row_2_Pin};

static uint8_t raw[9];
static uint8_t stable[9];
static uint8_t db_ms[9];
static uint16_t hold_ms[9];
static uint8_t sel_raw, sel_stable, sel_db;
static uint16_t sel_hold;
static uint8_t sel_long_fired;
static uint8_t wake_eat;

static keypad_event_t q[QN];
static uint8_t qh, qt, qn;

static void push(keypad_evt_t type, uint8_t key) {
  if (qn >= QN) {
    return;
  }
  q[qh].type = type;
  q[qh].key = key;
  qh = (uint8_t)((qh + 1) % QN);
  qn++;
}

static void cols_idle(void) {
  HAL_GPIO_WritePin(GPIOB, Column_0_Pin | Column_1_Pin | Column_2_Pin, GPIO_PIN_SET);
}

static uint8_t scan_row(uint8_t r) {
  return HAL_GPIO_ReadPin(GPIOB, row_pin[r]) == GPIO_PIN_RESET;
}

void keypad_init(void) {
  cols_idle();
}

void keypad_set_wake_eat(uint8_t on) {
  wake_eat = on;
}

void keypad_tick(void) {
  uint8_t mask[9] = {0};

  for (uint8_t c = 0; c < 3; c++) {
    cols_idle();
    HAL_GPIO_WritePin(GPIOB, col_pin[c], GPIO_PIN_RESET);
    __NOP();
    __NOP();
    __NOP();
    __NOP();
    for (uint8_t r = 0; r < 3; r++) {
      mask[r * 3 + c] = scan_row(r);
    }
  }
  cols_idle();

  for (uint8_t i = 0; i < 9; i++) {
    if (mask[i] == raw[i]) {
      if (db_ms[i] < 255) {
        db_ms[i]++;
      }
    } else {
      raw[i] = mask[i];
      db_ms[i] = 0;
    }
    if (db_ms[i] == DEBOUNCE_MS) {
      if (raw[i] && !stable[i]) {
        stable[i] = 1;
        hold_ms[i] = 0;
        if (!wake_eat) {
          push(KP_DOWN, i);
        }
      } else if (!raw[i] && stable[i]) {
        stable[i] = 0;
        if (!wake_eat) {
          push(KP_UP, i);
        }
      }
    }
    if (stable[i]) {
      if (hold_ms[i] < 60000) {
        hold_ms[i]++;
      }
      if (hold_ms[i] == REPEAT_DELAY_MS ||
          (hold_ms[i] > REPEAT_DELAY_MS && ((hold_ms[i] - REPEAT_DELAY_MS) % REPEAT_HZ_MS) == 0)) {
        if (!wake_eat) {
          push(KP_REPEAT, i);
        }
      }
    }
  }

  uint8_t s = HAL_GPIO_ReadPin(Selector_GPIO_Port, Selector_Pin) == GPIO_PIN_RESET;
  if (s == sel_raw) {
    if (sel_db < 255) {
      sel_db++;
    }
  } else {
    sel_raw = s;
    sel_db = 0;
  }
  if (sel_db == DEBOUNCE_MS) {
    if (sel_raw && !sel_stable) {
      sel_stable = 1;
      sel_hold = 0;
      sel_long_fired = 0;
    } else if (!sel_raw && sel_stable) {
      sel_stable = 0;
      if (!wake_eat && !sel_long_fired) {
        push(KP_SEL_SHORT, KEYPAD_NONE);
      }
    }
  }
  if (sel_stable) {
    if (sel_hold < 60000) {
      sel_hold++;
    }
    if (!sel_long_fired && sel_hold >= SEL_LONG_MS) {
      sel_long_fired = 1;
      if (!wake_eat) {
        push(KP_SEL_LONG, KEYPAD_NONE);
      }
    }
  }

  if (wake_eat) {
    uint8_t any = sel_stable;
    for (uint8_t i = 0; i < 9; i++) {
      any = (uint8_t)(any | stable[i]);
    }
    if (!any) {
      wake_eat = 0;
    }
  }
}

int keypad_pop(keypad_event_t *out) {
  if (qn == 0) {
    return 0;
  }
  *out = q[qt];
  qt = (uint8_t)((qt + 1) % QN);
  qn--;
  return 1;
}
