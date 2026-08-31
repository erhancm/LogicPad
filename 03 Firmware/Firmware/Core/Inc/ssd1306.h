#ifndef SSD1306_H
#define SSD1306_H

#include <stddef.h>
#include <stdint.h>
#include "stm32f1xx_hal.h"
#include "ssd1306_fonts.h"

#ifndef SSD1306_I2C_PORT
#define SSD1306_I2C_PORT hi2c1
#endif

#ifndef SSD1306_I2C_ADDR
#define SSD1306_I2C_ADDR 0x78
#endif

#define SSD1306_HEIGHT 64
#define SSD1306_WIDTH 128
#define SSD1306_PAGE_COUNT (SSD1306_HEIGHT / 8u)

extern I2C_HandleTypeDef SSD1306_I2C_PORT;

typedef enum { Black = 0x00, White = 0x01 } SSD1306_COLOR;

void ssd1306_Init(void);
void ssd1306_Fill(SSD1306_COLOR color);
void ssd1306_InvalidateSent(void);
uint8_t ssd1306_UpdateScreen(void);
uint8_t ssd1306_UpdatePages(uint8_t first, uint8_t last);
void ssd1306_DrawPixel(uint8_t x, uint8_t y, SSD1306_COLOR color);
void ssd1306_FillRect(uint8_t x, uint8_t y, uint8_t w, uint8_t h, SSD1306_COLOR color);
char ssd1306_WriteChar(char ch, FontDef font, SSD1306_COLOR color);
char ssd1306_WriteString(const char *str, FontDef font, SSD1306_COLOR color);
void ssd1306_SetCursor(uint8_t x, uint8_t y);
void ssd1306_SetContrast(uint8_t value);
void ssd1306_SetFlip(uint8_t flip180);
void ssd1306_DisplayOn(uint8_t on);
void ssd1306_WriteChar2x(char ch, SSD1306_COLOR color);
void ssd1306_WriteString2x(const char *str, SSD1306_COLOR color);

#endif
