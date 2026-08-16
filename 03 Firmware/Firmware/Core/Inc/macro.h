#ifndef MACRO_H
#define MACRO_H

#include <stdint.h>

void macro_init(void);
void macro_tick(void);
void macro_play(uint8_t key_idx);
int macro_busy(void);
void macro_cancel(void);

#endif
