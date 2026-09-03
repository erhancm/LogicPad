#include "oled.h"
#include "stm32f1xx.h"

#define SSD_ADDR 0x78u

static const uint8_t font[] = {
    0x7E, 0x11, 0x11, 0x11, 0x7E, 0x7F, 0x49, 0x49, 0x49, 0x36, 0x3E, 0x41, 0x41, 0x41, 0x22,
    0x7F, 0x41, 0x41, 0x22, 0x1C, 0x7F, 0x49, 0x49, 0x49, 0x41, 0x7F, 0x09, 0x09, 0x09, 0x01,
    0x7F, 0x08, 0x08, 0x08, 0x7F, 0x00, 0x41, 0x7F, 0x41, 0x00, 0x7F, 0x08, 0x14, 0x22, 0x41,
    0x7F, 0x40, 0x40, 0x40, 0x40, 0x7F, 0x02, 0x0C, 0x02, 0x7F, 0x7F, 0x04, 0x08, 0x10, 0x7F,
    0x3E, 0x41, 0x41, 0x41, 0x3E, 0x7F, 0x09, 0x19, 0x29, 0x46, 0x46, 0x49, 0x49, 0x49, 0x31,
    0x01, 0x01, 0x7F, 0x01, 0x01, 0x3F, 0x40, 0x40, 0x40, 0x3F};

/* A..U -> glyph index, 0xFF = none */
static const uint8_t ix[] = {0, 1, 2, 3, 4, 5, 0xFF, 6, 7, 0xFF, 8, 9, 10, 11, 12, 0xFF, 0xFF, 13, 14, 15, 16};

static void delay(uint32_t n) {
  volatile uint32_t i;
  for (i = 0; i < n; i++) {
  }
}

static void i2c_start(void) {
  GPIOB->BSRR = (1u << 7) | (1u << 6);
  delay(8);
  GPIOB->BRR = (1u << 7);
  delay(8);
  GPIOB->BRR = (1u << 6);
}

static void i2c_stop(void) {
  GPIOB->BRR = (1u << 7);
  delay(4);
  GPIOB->BSRR = (1u << 6);
  delay(8);
  GPIOB->BSRR = (1u << 7);
}

static void i2c_byte(uint8_t b) {
  uint8_t i;
  for (i = 0; i < 8u; i++) {
    if (b & 0x80u) {
      GPIOB->BSRR = (1u << 7);
    } else {
      GPIOB->BRR = (1u << 7);
    }
    delay(4);
    GPIOB->BSRR = (1u << 6);
    delay(4);
    GPIOB->BRR = (1u << 6);
    b = (uint8_t)(b << 1);
  }
  GPIOB->BSRR = (1u << 7);
  delay(4);
  GPIOB->BSRR = (1u << 6);
  delay(4);
  GPIOB->BRR = (1u << 6);
}

static void cmds(const uint8_t *c, uint8_t n) {
  i2c_start();
  i2c_byte(SSD_ADDR);
  i2c_byte(0x00);
  while (n--) {
    i2c_byte(*c++);
  }
  i2c_stop();
}

static void page_begin(uint8_t pg) {
  uint8_t sel[3];
  sel[0] = (uint8_t)(0xB0u + pg);
  sel[1] = 0x00;
  sel[2] = 0x10;
  cmds(sel, 3);
  i2c_start();
  i2c_byte(SSD_ADDR);
  i2c_byte(0x40);
}

static void page_fill(uint8_t pg, uint8_t v) {
  uint8_t i;
  page_begin(pg);
  for (i = 0; i < 128u; i++) {
    i2c_byte(v);
  }
  i2c_stop();
}

static void text(uint8_t pg, const char *s) {
  uint8_t col, n = 0;
  const char *t = s;
  while (*t++) {
    n++;
  }
  page_begin(pg);
  {
    uint8_t pad = (uint8_t)((128u - (uint8_t)(n * 6u)) / 2u);
    while (pad--) {
      i2c_byte(0);
    }
  }
  while (*s) {
    char c = *s++;
    const uint8_t *g = 0;
    if (c >= 'a') {
      c = (char)(c - 32);
    }
    if (c >= 'A' && c <= 'U') {
      uint8_t k = ix[c - 'A'];
      if (k != 0xFF) {
        g = &font[k * 5u];
      }
    }
    for (col = 0; col < 5u; col++) {
      i2c_byte(g ? g[col] : 0);
    }
    i2c_byte(0);
  }
  i2c_stop();
}

void oled_init(void) {
  static const uint8_t init[] = {0xAE, 0x20, 0x02, 0xC0, 0x40, 0x81, 0x7F, 0xA0, 0xA6, 0xA8,
                                 0x3F, 0xA4, 0xD3, 0x00, 0xD5, 0xF0, 0xD9, 0x22, 0xDA, 0x12,
                                 0xDB, 0x20, 0x8D, 0x14, 0xAF};
  uint8_t p;
  RCC->APB2ENR |= RCC_APB2ENR_IOPBEN;
  GPIOB->CRL = (GPIOB->CRL & ~(0xFFu << 24)) | (0x55u << 24);
  GPIOB->BSRR = (1u << 6) | (1u << 7);
  delay(2000000u);
  cmds(init, (uint8_t)sizeof(init));
  for (p = 0; p < 8u; p++) {
    page_fill(p, 0);
  }
}

void oled_progress(uint8_t pct) {
  uint8_t i, fill;
  if (pct > 100u) {
    pct = 100;
  }
  fill = (uint8_t)(4u + ((uint16_t)pct * 120u) / 100u);
  page_begin(5);
  for (i = 0; i < 128u; i++) {
    i2c_byte((i < 4u || i > 123u || i < fill) ? 0x3C : 0x24);
  }
  i2c_stop();
}

void oled_boot(void) {
  text(2, "BOOT");
  text(4, "BOOT MODE");
  oled_progress(0);
  text(6, "USB FLASH");
  page_fill(7, 0xFF);
}

void oled_result(int ok) {
  page_fill(2, 0);
  if (ok) {
    text(2, "OK");
    text(6, "DONE");
  } else {
    text(2, "FAIL");
    text(6, "ERROR");
  }
}
