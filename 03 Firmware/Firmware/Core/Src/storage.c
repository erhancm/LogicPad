#include "storage.h"
#include "led_mux.h"
#include "main.h"
#include <string.h>

#define LP_MAGIC 0x4C504147u /* LPAG: shared type-text pool */
#define STORE_PAGES 4
#define STORE_BYTES (STORE_PAGES * 1024u)
#define SLOT0 ((uint32_t)(FLASH_BASE + 0xE000u))
#define SLOT1 (SLOT0 + STORE_BYTES)

_Static_assert(sizeof(lp_store_t) <= STORE_BYTES, "store exceeds ping-pong slot");

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

void storage_factory(void) {
  memset(&g_store, 0, sizeof(g_store));
  g_store.magic = LP_MAGIC;
  g_store.active = 0;
  g_store.contrast = 7;
  g_store.flip = 0;
  g_store.sleep = 3; /* 1m */
  g_store.menu_idle = 1; /* 30s */
  g_store.dirty = 0;

  static const char *const names[LP_N_PROFILES] = {"P1", "P2", "P3", "P4"};
  for (int p = 0; p < LP_N_PROFILES; p++) {
    strncpy(g_store.profiles[p].name, names[p], LP_NAME_LEN);
    g_store.profiles[p].light_mode = 1;
    g_store.profiles[p].bright = 6;
    g_store.profiles[p].dim = 2;
    /* Nine keys are macros; factory has no actions or labels. */
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

static int store_sane(const lp_store_t *s) {
  if (s->active >= LP_N_PROFILES || s->contrast > 10 || s->flip > 1 || s->sleep > 4 ||
      s->menu_idle > 2) {
    return 0;
  }
  for (int p = 0; p < LP_N_PROFILES; p++) {
    unsigned char c = (unsigned char)s->profiles[p].name[0];
    if (c < 32 || c > 126) {
      return 0;
    }
    if (s->profiles[p].light_mode >= LP_N_LIGHT_MODES || s->profiles[p].bright > 10 ||
        s->profiles[p].dim > 10) {
      return 0;
    }
  }
  return 1;
}

void storage_init(void) {
  const lp_store_t *a = (const lp_store_t *)SLOT0;
  const lp_store_t *b = (const lp_store_t *)SLOT1;
  int ao = slot_ok(a);
  int bo = slot_ok(b);
  if (bo) {
    memcpy(&g_store, b, sizeof(g_store));
  } else if (ao) {
    memcpy(&g_store, a, sizeof(g_store));
  } else {
    storage_factory();
    storage_save();
  }
  if (!store_sane(&g_store)) {
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

static lp_text_ref_t *tref(uint8_t profile, uint8_t key) {
  return &g_store.texts[(unsigned)profile * LP_N_KEYS + key];
}

static void pool_remove(uint8_t profile, uint8_t key) {
  lp_text_ref_t *r = tref(profile, key);
  if (r->len == 0) {
    return;
  }
  uint16_t off = r->off;
  uint8_t len = r->len;
  if ((uint32_t)off + len > g_store.pool_n) {
    r->off = 0;
    r->len = 0;
    return;
  }
  memmove(g_store.pool + off, g_store.pool + off + len, g_store.pool_n - off - len);
  g_store.pool_n = (uint16_t)(g_store.pool_n - len);
  r->off = 0;
  r->len = 0;
  for (int i = 0; i < LP_TEXT_SLOTS; i++) {
    if (g_store.texts[i].len && g_store.texts[i].off > off) {
      g_store.texts[i].off = (uint16_t)(g_store.texts[i].off - len);
    }
  }
}

int storage_set_text(uint8_t profile, uint8_t key, const uint8_t *data, uint8_t len) {
  if (profile >= LP_N_PROFILES || key >= LP_N_KEYS) {
    return -3;
  }
  if (len > LP_TEXT_MAX) {
    return -2;
  }
  lp_text_ref_t *r = tref(profile, key);
  uint16_t others = (uint16_t)(g_store.pool_n - r->len);
  if ((uint32_t)others + len > LP_TEXT_POOL) {
    return -1;
  }
  pool_remove(profile, key);
  if (len == 0) {
    return 0;
  }
  if (data == NULL) {
    return -3;
  }
  r->off = g_store.pool_n;
  r->len = len;
  memcpy(g_store.pool + r->off, data, len);
  g_store.pool_n = (uint16_t)(g_store.pool_n + len);
  return 0;
}

const uint8_t *storage_text(uint8_t profile, uint8_t key, uint8_t *len) {
  if (profile >= LP_N_PROFILES || key >= LP_N_KEYS) {
    if (len) {
      *len = 0;
    }
    return NULL;
  }
  lp_text_ref_t *r = tref(profile, key);
  if (len) {
    *len = r->len;
  }
  if (r->len == 0) {
    return NULL;
  }
  if ((uint32_t)r->off + r->len > g_store.pool_n) {
    if (len) {
      *len = 0;
    }
    return NULL;
  }
  return (const uint8_t *)(g_store.pool + r->off);
}

uint16_t storage_pool_used(void) {
  return g_store.pool_n;
}
