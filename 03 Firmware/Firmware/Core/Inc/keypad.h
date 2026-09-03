#ifndef KEYPAD_H
#define KEYPAD_H

#include <stdint.h>

#define KEYPAD_NONE 0xFF

typedef enum {
  KP_NONE = 0,
  KP_DOWN,
  KP_UP,
  KP_REPEAT,
  KP_SEL_SHORT,
  KP_SEL_LONG
} keypad_evt_t;

typedef struct {
  keypad_evt_t type;
  uint8_t key; /* 0-8 for matrix; 0xFF for selector */
} keypad_event_t;

void keypad_init(void);
/* 1 ms scan. Called from SysTick so OLED I2C cannot drop taps. */
void keypad_tick(void);
int keypad_pop(keypad_event_t *out);

#endif
