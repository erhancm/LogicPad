#include "ssd1306.h"
#include "i2c.h"
#include <string.h>

static uint8_t SSD1306_Buffer[SSD1306_WIDTH * SSD1306_HEIGHT / 8];
static uint8_t SSD1306_Sent[SSD1306_WIDTH * SSD1306_HEIGHT / 8];
static uint8_t sent_valid;
static uint8_t s_x, s_y;

void ssd1306_WriteCommand(uint8_t byte) {
  HAL_I2C_Mem_Write(&SSD1306_I2C_PORT, SSD1306_I2C_ADDR, 0x00, 1, &byte, 1, 20);
}

static void ssd1306_WriteData(uint8_t *buffer, size_t buff_size) {
  HAL_I2C_Mem_Write(&SSD1306_I2C_PORT, SSD1306_I2C_ADDR, 0x40, 1, buffer, buff_size, 40);
}

void ssd1306_Init(void) {
  HAL_Delay(80);
  ssd1306_WriteCommand(0xAE);
  ssd1306_WriteCommand(0x20);
  ssd1306_WriteCommand(0x00);
  ssd1306_WriteCommand(0xB0);
  ssd1306_WriteCommand(0xC0); /* upright for enclosure; yellow glass stays at bottom */
  ssd1306_WriteCommand(0x00);
  ssd1306_WriteCommand(0x10);
  ssd1306_WriteCommand(0x40);
  ssd1306_WriteCommand(0x81);
  ssd1306_WriteCommand(0x7F);
  ssd1306_WriteCommand(0xA0);
  ssd1306_WriteCommand(0xA6);
  ssd1306_WriteCommand(0xA8);
  ssd1306_WriteCommand(0x3F);
  ssd1306_WriteCommand(0xA4);
  ssd1306_WriteCommand(0xD3);
  ssd1306_WriteCommand(0x00);
  ssd1306_WriteCommand(0xD5);
  ssd1306_WriteCommand(0xF0);
  ssd1306_WriteCommand(0xD9);
  ssd1306_WriteCommand(0x22);
  ssd1306_WriteCommand(0xDA);
  ssd1306_WriteCommand(0x12);
  ssd1306_WriteCommand(0xDB);
  ssd1306_WriteCommand(0x20);
  ssd1306_WriteCommand(0x8D);
  ssd1306_WriteCommand(0x14);
  ssd1306_WriteCommand(0xAF);
  ssd1306_Fill(Black);
  ssd1306_UpdateScreen();
  s_x = 0;
  s_y = 0;
}

void ssd1306_Fill(SSD1306_COLOR color) {
  uint8_t v = (color == Black) ? 0x00 : 0xFF;
  for (uint32_t i = 0; i < sizeof(SSD1306_Buffer); i++) {
    SSD1306_Buffer[i] = v;
  }
}

void ssd1306_InvalidateSent(void) {
  sent_valid = 0;
}

static void ssd1306_PushPage(uint8_t page) {
  ssd1306_WriteCommand((uint8_t)(0xB0 + page));
  ssd1306_WriteCommand(0x00);
  ssd1306_WriteCommand(0x10);
  ssd1306_WriteData(&SSD1306_Buffer[SSD1306_WIDTH * page], SSD1306_WIDTH);
  memcpy(&SSD1306_Sent[SSD1306_WIDTH * page], &SSD1306_Buffer[SSD1306_WIDTH * page], SSD1306_WIDTH);
}

static uint8_t ssd1306_PushPages(uint8_t first, uint8_t last) {
  uint8_t any = 0;

  if (first > last || last >= SSD1306_PAGE_COUNT) {
    return 0;
  }
  if (!sent_valid) {
    for (uint8_t i = 0; i < SSD1306_PAGE_COUNT; i++) {
      ssd1306_PushPage(i);
      any = 1;
    }
    sent_valid = 1;
    return any;
  }
  for (uint8_t i = first; i <= last; i++) {
    uint8_t *page = &SSD1306_Buffer[SSD1306_WIDTH * i];
    uint8_t *sent = &SSD1306_Sent[SSD1306_WIDTH * i];
    if (memcmp(page, sent, SSD1306_WIDTH) != 0) {
      ssd1306_PushPage(i);
      any = 1;
    }
  }
  return any;
}

uint8_t ssd1306_UpdateScreen(void) {
  return ssd1306_PushPages(0, (uint8_t)(SSD1306_PAGE_COUNT - 1u));
}

uint8_t ssd1306_UpdatePages(uint8_t first, uint8_t last) {
  return ssd1306_PushPages(first, last);
}

void ssd1306_DrawPixel(uint8_t x, uint8_t y, SSD1306_COLOR color) {
  if (x >= SSD1306_WIDTH || y >= SSD1306_HEIGHT) {
    return;
  }
  if (color == White) {
    SSD1306_Buffer[x + (y / 8) * SSD1306_WIDTH] |= (uint8_t)(1u << (y % 8));
  } else {
    SSD1306_Buffer[x + (y / 8) * SSD1306_WIDTH] &= (uint8_t)~(1u << (y % 8));
  }
}

void ssd1306_FillRect(uint8_t x, uint8_t y, uint8_t w, uint8_t h, SSD1306_COLOR color) {
  for (uint8_t yy = y; yy < y + h; yy++) {
    for (uint8_t xx = x; xx < x + w; xx++) {
      ssd1306_DrawPixel(xx, yy, color);
    }
  }
}

char ssd1306_WriteChar(char ch, FontDef font, SSD1306_COLOR color) {
  if (ch < 32 || ch > 126) {
    return 0;
  }
  if (SSD1306_WIDTH < (s_x + font.FontWidth) || SSD1306_HEIGHT < (s_y + font.FontHeight)) {
    return 0;
  }
  for (uint32_t i = 0; i < font.FontHeight; i++) {
    uint16_t b = font.data[(ch - 32) * font.FontHeight + i];
    for (uint32_t j = 0; j < font.FontWidth; j++) {
      SSD1306_COLOR c = ((b << j) & 0x8000) ? color : (SSD1306_COLOR)!color;
      ssd1306_DrawPixel((uint8_t)(s_x + j), (uint8_t)(s_y + i), c);
    }
  }
  s_x = (uint8_t)(s_x + font.FontWidth);
  return ch;
}

char ssd1306_WriteString(const char *str, FontDef font, SSD1306_COLOR color) {
  while (*str) {
    if (ssd1306_WriteChar(*str, font, color) != *str) {
      return *str;
    }
    str++;
  }
  return *str;
}

void ssd1306_WriteChar2x(char ch, SSD1306_COLOR color) {
  if (ch < 32 || ch > 126) {
    return;
  }
  FontDef font = Font_6x8;
  for (uint32_t i = 0; i < font.FontHeight; i++) {
    uint16_t b = font.data[(ch - 32) * font.FontHeight + i];
    for (uint32_t j = 0; j < font.FontWidth; j++) {
      SSD1306_COLOR c = ((b << j) & 0x8000) ? color : (SSD1306_COLOR)!color;
      uint8_t px = (uint8_t)(s_x + j * 2);
      uint8_t py = (uint8_t)(s_y + i * 2);
      ssd1306_DrawPixel(px, py, c);
      ssd1306_DrawPixel(px + 1, py, c);
      ssd1306_DrawPixel(px, py + 1, c);
      ssd1306_DrawPixel(px + 1, py + 1, c);
    }
  }
  s_x = (uint8_t)(s_x + font.FontWidth * 2);
}

void ssd1306_WriteString2x(const char *str, SSD1306_COLOR color) {
  while (*str) {
    ssd1306_WriteChar2x(*str++, color);
  }
}

void ssd1306_SetCursor(uint8_t x, uint8_t y) {
  s_x = x;
  s_y = y;
}

void ssd1306_SetContrast(uint8_t value) {
  ssd1306_WriteCommand(0x81);
  ssd1306_WriteCommand(value);
}

void ssd1306_SetFlip(uint8_t flip180) {
  if (flip180) {
    ssd1306_WriteCommand(0xA1);
    ssd1306_WriteCommand(0xC8);
  } else {
    /* Default enclosure: content upright, yellow strip at physical bottom. */
    ssd1306_WriteCommand(0xA0);
    ssd1306_WriteCommand(0xC0);
  }
  ssd1306_InvalidateSent();
}

void ssd1306_DisplayOn(uint8_t on) {
  ssd1306_WriteCommand(on ? 0xAF : 0xAE);
  if (on) {
    ssd1306_InvalidateSent();
  }
}
