#ifndef SSD1306_FONTS_H
#define SSD1306_FONTS_H

#include <stdint.h>

typedef struct {
  const uint8_t FontWidth;
  uint8_t FontHeight;
  const uint16_t *data;
} FontDef;

extern FontDef Font_6x8;

#endif
