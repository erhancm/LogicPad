#ifndef LED_MUX_H
#define LED_MUX_H

#include <stdint.h>

enum { LED_OFF = 0, LED_WHITE, LED_RED, LED_GREEN, LED_BLUE };
#define LED_SEL 9u /* selector RGB; not a 10th macro */

typedef struct {
  uint8_t color[10];
  uint8_t duty[10];
  uint16_t anim_ms;
  uint16_t idle_ms;
  uint8_t flash_key;
  uint16_t flash_ms;
  uint8_t ripple_key;
  uint16_t ripple_age;
  uint8_t flood;
} led_snap_t;

void led_mux_init(void);
void led_mux_key_flash(uint8_t key); /* 0–8 pad keys, LED_SEL selector */
void led_mux_preview(uint8_t use_dim);
/* Live mux frame plus animation clocks so the PC preview can phase-lock. */
void led_mux_snapshot(led_snap_t *snap);

#endif
