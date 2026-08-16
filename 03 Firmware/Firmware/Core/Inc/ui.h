#ifndef UI_H
#define UI_H

#include <stdint.h>

void ui_init(void);
void ui_tick(void);
void ui_draw_if_needed(void);
int ui_is_live(void);
int ui_is_sleeping(void);
void ui_wake(void);
void ui_mark_dirty(void);

#endif
