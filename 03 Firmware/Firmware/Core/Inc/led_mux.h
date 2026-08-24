#ifndef LED_MUX_H
#define LED_MUX_H

#include <stdint.h>

enum { LED_OFF = 0, LED_WHITE, LED_RED, LED_GREEN, LED_BLUE };
#define LED_SEL 9u /* selector RGB; not a 10th macro */

void led_mux_init(void);
void led_mux_key_flash(uint8_t key); /* 0–8 pad keys, LED_SEL selector */

#endif
