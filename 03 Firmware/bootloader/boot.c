#include "lp_memmap.h"
#include "oled.h"
#include "stm32f1xx.h"
#include "usb.h"

#define PAGE 1024u

static uint32_t img_size;
static uint32_t img_crc;
static uint32_t wr_off;
static uint32_t run_crc;
static uint8_t flashing;
static uint8_t jump_soon;
static uint32_t jump_wait;
static uint8_t last_pct = 255;

static void clock_72(void) {
  RCC->CR |= RCC_CR_HSEON;
  while ((RCC->CR & RCC_CR_HSERDY) == 0) {
  }
  FLASH->ACR = FLASH_ACR_PRFTBE | 0x2u; /* 2 wait states at 72 MHz */
  RCC->CFGR = RCC_CFGR_PLLSRC | RCC_CFGR_PLLMULL9 | RCC_CFGR_PPRE1_DIV2;
  RCC->CR |= RCC_CR_PLLON;
  while ((RCC->CR & RCC_CR_PLLRDY) == 0) {
  }
  RCC->CFGR |= RCC_CFGR_SW_PLL;
  while ((RCC->CFGR & RCC_CFGR_SWS) != RCC_CFGR_SWS_PLL) {
  }
}

static int sel_held(void) {
  RCC->APB2ENR |= RCC_APB2ENR_IOPBEN;
  GPIOB->CRH = (GPIOB->CRH & ~(0xFu << 28)) | (0x8u << 28); /* input pull */
  GPIOB->BSRR = (1u << 15);
  {
    volatile uint32_t i;
    for (i = 0; i < 8000u; i++) {
    }
  }
  return (GPIOB->IDR & (1u << 15)) == 0;
}

static int app_ok(void) {
  uint32_t sp = *(const uint32_t *)LP_APP_BASE;
  uint32_t rv = *(const uint32_t *)(LP_APP_BASE + 4u);
  if (sp < 0x20000000u || sp > 0x20005000u) {
    return 0;
  }
  rv &= ~1u;
  return rv >= LP_APP_BASE && rv < LP_STORE_BASE;
}

static void clocks_hsi(void) {
  RCC->CFGR &= ~RCC_CFGR_SW;
  while ((RCC->CFGR & RCC_CFGR_SWS) != 0) {
  }
  RCC->CR &= ~(RCC_CR_PLLON | RCC_CR_CSSON | RCC_CR_HSEON);
  while (RCC->CR & (RCC_CR_PLLRDY | RCC_CR_HSERDY)) {
  }
  RCC->CR |= RCC_CR_HSION;
  while ((RCC->CR & RCC_CR_HSIRDY) == 0) {
  }
  RCC->CFGR = 0;
  FLASH->ACR = 0;
}

static void jump_app(void) {
  uint32_t sp = *(const uint32_t *)LP_APP_BASE;
  uint32_t rv = *(const uint32_t *)(LP_APP_BASE + 4u);
  uint32_t i;
  __disable_irq();
  if (RCC->APB1ENR & RCC_APB1ENR_USBEN) {
    usb_off();
    RCC->APB1ENR &= ~RCC_APB1ENR_USBEN;
  }
  clocks_hsi();
  SysTick->CTRL = 0;
  SysTick->LOAD = 0;
  SysTick->VAL = 0;
  for (i = 0; i < 8u; i++) {
    NVIC->ICER[i] = 0xFFFFFFFFu;
    NVIC->ICPR[i] = 0xFFFFFFFFu;
  }
  SCB->VTOR = LP_APP_BASE;
  __DSB();
  __ISB();
  __asm volatile("msr msp, %0" : : "r"(sp) : "memory");
  __asm volatile("bx %0" : : "r"(rv) : );
  for (;;) {
  }
}

static uint32_t crc32(const uint8_t *d, uint32_t n, uint32_t c) {
  uint32_t i, k;
  for (i = 0; i < n; i++) {
    c ^= d[i];
    for (k = 0; k < 8u; k++) {
      uint32_t m = (uint32_t)-(int32_t)(c & 1u);
      c = (c >> 1) ^ (0xEDB88320u & m);
    }
  }
  return c;
}

static int flash_wait(void) {
  while (FLASH->SR & FLASH_SR_BSY) {
  }
  if (FLASH->SR & (FLASH_SR_PGERR | FLASH_SR_WRPRTERR)) {
    FLASH->SR = FLASH_SR_PGERR | FLASH_SR_WRPRTERR;
    return -1;
  }
  return 0;
}

static int flash_unlock(void) {
  if (FLASH->CR & FLASH_CR_LOCK) {
    FLASH->KEYR = FLASH_KEY1;
    FLASH->KEYR = FLASH_KEY2;
  }
  return (FLASH->CR & FLASH_CR_LOCK) ? -1 : 0;
}

static int erase_page(uint32_t addr) {
  if (flash_wait() < 0) {
    return -1;
  }
  FLASH->CR |= FLASH_CR_PER;
  FLASH->AR = addr;
  FLASH->CR |= FLASH_CR_STRT;
  if (flash_wait() < 0) {
    FLASH->CR &= ~FLASH_CR_PER;
    return -1;
  }
  FLASH->CR &= ~FLASH_CR_PER;
  return 0;
}

static int prog_hw(uint32_t addr, uint16_t hw) {
  FLASH->CR |= FLASH_CR_PG;
  *(__IO uint16_t *)addr = hw;
  if (flash_wait() < 0) {
    FLASH->CR &= ~FLASH_CR_PG;
    return -1;
  }
  FLASH->CR &= ~FLASH_CR_PG;
  return *(__IO uint16_t *)addr == hw ? 0 : -1;
}

static void reply(uint8_t cmd, uint8_t st, uint32_t extra) {
  uint8_t r[64];
  uint8_t i;
  for (i = 0; i < 64u; i++) {
    r[i] = 0;
  }
  r[0] = 4;
  r[1] = cmd;
  r[2] = st;
  r[3] = (uint8_t)extra;
  r[4] = (uint8_t)(extra >> 8);
  r[5] = (uint8_t)(extra >> 16);
  r[6] = (uint8_t)(extra >> 24);
  usb_hid_send(r);
}

static int vec_ok(uint32_t sp, uint32_t rv) {
  if (sp < 0x20000000u || sp > 0x20005000u) {
    return 0;
  }
  rv &= ~1u;
  return rv >= LP_APP_BASE && rv < LP_STORE_BASE;
}

static int write_chunk(const uint8_t *p, uint32_t n) {
  uint32_t i = 0;
  if ((wr_off & 1u) && n) {
    return -1;
  }
  while (i < n) {
    uint32_t addr = LP_APP_BASE + wr_off + i;
    if ((addr & (PAGE - 1u)) == 0) {
      if (erase_page(addr) < 0) {
        return -1;
      }
    }
    if (i + 1u < n) {
      uint16_t hw = (uint16_t)p[i] | ((uint16_t)p[i + 1u] << 8);
      if (prog_hw(addr, hw) < 0) {
        return -1;
      }
      i += 2;
    } else {
      uint16_t hw = (uint16_t)p[i] | 0xFF00u;
      if (prog_hw(addr, hw) < 0) {
        return -1;
      }
      i += 1;
    }
  }
  wr_off += n;
  return 0;
}

static void on_hid(const uint8_t *b) {
  uint8_t cmd;
  if (b[0] != 4) {
    return;
  }
  cmd = b[1];
  if (cmd == 0x01) {
    uint8_t r[64];
    uint8_t i;
    for (i = 0; i < 64u; i++) {
      r[i] = 0;
    }
    r[0] = 4;
    r[1] = 0x01;
    r[2] = 0x01;
    r[3] = 0x00;
    r[4] = 0x42;
    usb_hid_send(r);
    return;
  }
  if (cmd == CMD_BL_ABORT) {
    flashing = 0;
    FLASH->CR |= FLASH_CR_LOCK;
    reply(cmd, BL_ST_OK, 0);
    oled_boot();
    last_pct = 255;
    if (app_ok()) {
      jump_soon = 1;
      jump_wait = 200000u;
    }
    return;
  }
  if (cmd == CMD_BL_START) {
    uint32_t sz = (uint32_t)b[2] | ((uint32_t)b[3] << 8) | ((uint32_t)b[4] << 16) | ((uint32_t)b[5] << 24);
    uint32_t crc = (uint32_t)b[6] | ((uint32_t)b[7] << 8) | ((uint32_t)b[8] << 16) | ((uint32_t)b[9] << 24);
    if (sz < 16u || sz > LP_APP_MAX || (LP_APP_BASE + sz) > LP_STORE_BASE) {
      reply(cmd, BL_ST_BAD_SIZE, 0);
      return;
    }
    if (flash_unlock() < 0) {
      reply(cmd, BL_ST_FLASH, 0);
      return;
    }
    img_size = sz;
    img_crc = crc;
    wr_off = 0;
    run_crc = 0xFFFFFFFFu;
    flashing = 1;
    last_pct = 255;
    oled_progress(0);
    reply(cmd, BL_ST_OK, sz);
    return;
  }
  if (cmd == CMD_BL_DATA) {
    uint32_t n;
    if (!flashing) {
      reply(cmd, BL_ST_STATE, 0);
      return;
    }
    n = img_size - wr_off;
    if (n > 62u) {
      n = 62;
    }
    if (n == 0) {
      reply(cmd, BL_ST_OK, wr_off);
      return;
    }
    if (wr_off == 0) {
      uint32_t sp = (uint32_t)b[2] | ((uint32_t)b[3] << 8) | ((uint32_t)b[4] << 16) | ((uint32_t)b[5] << 24);
      uint32_t rv = (uint32_t)b[6] | ((uint32_t)b[7] << 8) | ((uint32_t)b[8] << 16) | ((uint32_t)b[9] << 24);
      if (!vec_ok(sp, rv)) {
        flashing = 0;
        FLASH->CR |= FLASH_CR_LOCK;
        oled_result(0);
        reply(cmd, BL_ST_BAD_VEC, 0);
        return;
      }
    }
    run_crc = crc32(&b[2], n, run_crc);
    if (write_chunk(&b[2], n) < 0) {
      flashing = 0;
      FLASH->CR |= FLASH_CR_LOCK;
      oled_result(0);
      reply(cmd, BL_ST_FLASH, wr_off);
      return;
    }
    {
      uint8_t pct = (uint8_t)((wr_off * 100u) / (img_size ? img_size : 1u));
      if (pct != last_pct) {
        last_pct = pct;
        oled_progress(pct);
      }
    }
    reply(cmd, BL_ST_OK, wr_off);
    return;
  }
  if (cmd == CMD_BL_FINISH) {
    uint32_t got;
    if (!flashing || wr_off != img_size) {
      reply(cmd, BL_ST_STATE, wr_off);
      flashing = 0;
      FLASH->CR |= FLASH_CR_LOCK;
      oled_result(0);
      return;
    }
    got = ~run_crc;
    FLASH->CR |= FLASH_CR_LOCK;
    flashing = 0;
    if (got != img_crc || !app_ok()) {
      oled_result(0);
      reply(cmd, BL_ST_CRC, got);
      return;
    }
    oled_progress(100);
    oled_result(1);
    reply(cmd, BL_ST_OK, img_size);
    jump_soon = 1;
    jump_wait = 400000u;
  }
}

int main(void) {
  int stay = 0;
  uint32_t csr = RCC->CSR;
  if (*(volatile uint32_t *)LP_BL_MAGIC_ADDR == LP_BL_MAGIC) {
    stay = 1;
    *(volatile uint32_t *)LP_BL_MAGIC_ADDR = 0;
  }
  if (sel_held()) {
    stay = 1;
  }
  /* In-app update does NVIC_SystemReset. Stay even if SRAM magic was lost. */
  if (csr & RCC_CSR_SFTRSTF) {
    stay = 1;
  }
  RCC->CSR |= RCC_CSR_RMVF;
  if (!stay && app_ok()) {
    jump_app();
  }

  clock_72();
  oled_init();
  oled_boot();
  usb_init();
  for (;;) {
    uint8_t pkt[64];
    usb_poll();
    if (usb_hid_take(pkt)) {
      on_hid(pkt);
    }
    if (jump_soon) {
      if (jump_wait) {
        jump_wait--;
      } else if (app_ok()) {
        jump_app();
      } else {
        jump_soon = 0;
      }
    }
  }
}
