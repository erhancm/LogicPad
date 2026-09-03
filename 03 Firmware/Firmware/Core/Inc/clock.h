#ifndef CLOCK_H
#define CLOCK_H

#include <stdint.h>

/* Wall clock: STM32 RTC from the 8 MHz HSE (/128) while VDD is up, plus a
 * flash snapshot so a power cycle restores the last saved time. No 32 kHz
 * crystal; the PC app SET_TIME is the occasional sync. */

void clock_init(void);
void clock_set(uint16_t year, uint8_t month, uint8_t day, uint8_t hour, uint8_t min,
               uint8_t sec);
int clock_get(uint16_t *year, uint8_t *month, uint8_t *day, uint8_t *hour, uint8_t *min,
              uint8_t *sec);
void clock_request_save(void);
void clock_save_now(int force);
void clock_poll(void);
void clock_on_store_written(void);

#endif
