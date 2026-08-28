#ifndef UI_H
#define UI_H

#include <stdint.h>

void ui_init(void);
void ui_tick(void);
void ui_draw_if_needed(void);
void ui_show_update(void);
int ui_is_live(void);
int ui_is_sleeping(void);
void ui_wake(void);
void ui_mark_dirty(void);
void ui_apply_screen(void);
void ui_set_clock(uint16_t year, uint8_t month, uint8_t day, uint8_t hour, uint8_t min, uint8_t sec);
void ui_set_host_active(int on);

#endif
