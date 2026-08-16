#include "storage.h"
#include "led_mux.h"
#include "main.h"
#include <string.h>

#define LP_MAGIC 0x4C504144u
#define STORE_PAGES 4
#define STORE_BYTES (STORE_PAGES * 1024u)
#define SLOT0 ((uint32_t)(FLASH_BASE + 0xE000u))
#define SLOT1 (SLOT0 + STORE_BYTES)

lp_store_t g_store;

static uint16_t crc16(const uint8_t *p, uint32_t n) {
  uint16_t c = 0xFFFF;
  for (uint32_t i = 0; i < n; i++) {
    c ^= (uint16_t)p[i] << 8;
    for (uint8_t b = 0; b < 8; b++) {
      c = (c & 0x8000) ? (uint16_t)((c << 1) ^ 0x1021) : (uint16_t)(c << 1);
    }
  }
  return c;
}

static uint16_t store_crc(const lp_store_t *s) {
  const uint8_t *p = (const uint8_t *)s;
  return crc16(p + 6, sizeof(*s) - 6);
}

static int slot_ok(const lp_store_t *s) {
  return s->magic == LP_MAGIC && s->crc == store_crc(s);
}

/* ACT_KEY: mods = USB modifier bits, code = hid | (send_mode << 8). */
static void set_key_chord(lp_key_t *k, const char *label, uint8_t hid, uint8_t led) {
  memset(k, 0, sizeof(*k));
  strncpy(k->label, label, LP_LABEL_LEN);
  k->led = led;
  k->n = 3;
  k->acts[0] = (lp_action_t){.type = ACT_KEY, .mods = 0x01, .code = (uint16_t)SEND_DOWN << 8};
  k->acts[1] = (lp_action_t){.type = ACT_KEY, .mods = 0x00, .code = (uint16_t)hid | ((uint16_t)SEND_TAP << 8)};
  k->acts[2] = (lp_action_t){.type = ACT_KEY, .mods = 0x01, .code = (uint16_t)SEND_UP << 8};
}

static void set_media(lp_key_t *k, const char *label, uint16_t usage, uint8_t led) {
  memset(k, 0, sizeof(*k));
  strncpy(k->label, label, LP_LABEL_LEN);
  k->led = led;
  k->n = 1;
  k->acts[0] = (lp_action_t){.type = ACT_CONSUMER, .mods = SEND_TAP, .code = usage};
}

void storage_factory(void) {
  memset(&g_store, 0, sizeof(g_store));
  g_store.magic = LP_MAGIC;
  g_store.active = 0;
  g_store.contrast = 7;
  g_store.flip = 0;
  g_store.sleep = 3; /* 1m */
  g_store.menu_idle = 1; /* 30s */
  g_store.dirty = 0;

  strncpy(g_store.profiles[0].name, "WORK", LP_NAME_LEN);
  g_store.profiles[0].light_mode = 1;
  g_store.profiles[0].bright = 6;
  g_store.profiles[0].dim = 2;
  set_key_chord(&g_store.profiles[0].keys[0], "COPY", 0x06, LED_RED);
  set_key_chord(&g_store.profiles[0].keys[1], "PASTE", 0x19, LED_GREEN);
  set_key_chord(&g_store.profiles[0].keys[2], "CUT", 0x1B, LED_BLUE);
  set_key_chord(&g_store.profiles[0].keys[3], "UNDO", 0x1D, LED_WHITE);
  set_key_chord(&g_store.profiles[0].keys[4], "SAVE", 0x16, LED_RED);
  set_key_chord(&g_store.profiles[0].keys[5], "FIND", 0x09, LED_GREEN);
  set_media(&g_store.profiles[0].keys[6], "PREV", 0x00B6, LED_BLUE);
  set_media(&g_store.profiles[0].keys[7], "PLAY", 0x00CD, LED_WHITE);
  set_media(&g_store.profiles[0].keys[8], "NEXT", 0x00B5, LED_RED);

  strncpy(g_store.profiles[1].name, "P2", LP_NAME_LEN);
  strncpy(g_store.profiles[2].name, "P3", LP_NAME_LEN);
  strncpy(g_store.profiles[3].name, "P4", LP_NAME_LEN);
  for (int p = 1; p < LP_N_PROFILES; p++) {
    g_store.profiles[p].light_mode = 1;
    g_store.profiles[p].bright = 6;
    g_store.profiles[p].dim = 2;
    for (int k = 0; k < LP_N_KEYS; k++) {
      strncpy(g_store.profiles[p].keys[k].label, "KEY", LP_LABEL_LEN);
    }
  }
  g_store.crc = store_crc(&g_store);
}

static int flash_write_slot(uint32_t addr, const lp_store_t *s) {
  HAL_FLASH_Unlock();
  FLASH_EraseInitTypeDef er = {0};
  uint32_t page_err = 0;
  er.TypeErase = FLASH_TYPEERASE_PAGES;
  er.PageAddress = addr;
  er.NbPages = STORE_PAGES;
  if (HAL_FLASHEx_Erase(&er, &page_err) != HAL_OK) {
    HAL_FLASH_Lock();
    return -1;
  }
  uint32_t nbytes = sizeof(*s);
  if (nbytes & 1u) {
    nbytes++;
  }
  for (uint32_t off = 0; off < nbytes; off += 2) {
    uint16_t hw = 0xFFFF;
    uint32_t left = sizeof(*s) - off;
    if (left >= 2) {
      memcpy(&hw, (const uint8_t *)s + off, 2);
    } else if (left == 1) {
      uint8_t b = ((const uint8_t *)s)[off];
      hw = (uint16_t)(b | 0xFF00);
    }
    if (HAL_FLASH_Program(FLASH_TYPEPROGRAM_HALFWORD, addr + off, hw) != HAL_OK) {
      HAL_FLASH_Lock();
      return -1;
    }
  }
  HAL_FLASH_Lock();
  return 0;
}

void storage_init(void) {
  const lp_store_t *a = (const lp_store_t *)SLOT0;
  const lp_store_t *b = (const lp_store_t *)SLOT1;
  int ao = slot_ok(a);
  int bo = slot_ok(b);
  if (bo) {
    memcpy(&g_store, b, sizeof(g_store));
  } else if (ao) {
    memcpy(&g_store, b, sizeof(g_store));
  } else {
    storage_factory();
    storage_save();
  }
  g_store.dirty = 0;
}

int storage_save(void) {
  g_store.dirty = 0;
  g_store.magic = LP_MAGIC;
  g_store.crc = store_crc(&g_store);
  const lp_store_t *a = (const lp_store_t *)SLOT0;
  uint32_t dest = slot_ok(a) ? SLOT1 : SLOT0;
  return flash_write_slot(dest, &g_store);
}

void storage_reload(void) {
  storage_init();
}

lp_profile_t *storage_active(void) {
  if (g_store.active >= LP_N_PROFILES) {
    g_store.active = 0;
  }
  return &g_store.profiles[g_store.active];
}
