#ifndef LED_MUX_H
#define LED_MUX_H

#include <stdint.h>

enum { LED_OFF = 0, LED_WHITE, LED_RED, LED_GREEN, LED_BLUE };

void led_mux_init(void);
void led_mux_tick(void);
void led_mux_key_flash(uint8_t key);

#endif
