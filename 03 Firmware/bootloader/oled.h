#ifndef LP_BOOT_OLED_H
#define LP_BOOT_OLED_H

#include <stdint.h>

void oled_init(void);
void oled_boot(void);
void oled_progress(uint8_t pct);
void oled_result(int ok);

#endif
