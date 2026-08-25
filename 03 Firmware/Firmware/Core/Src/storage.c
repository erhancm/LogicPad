#include "storage.h"
#include "clock.h"
#include "led_mux.h"
#include "main.h"
#include <stddef.h>
#include <string.h>

#define LP_MAGIC 0x4C504148u /* LPAH: 12-char key titles */
#define STORE_PAGES 4
#define STORE_BYTES (STORE_PAGES * 1024u)
#define SLOT0 ((uint32_t)(FLASH_BASE + 0xE000u))
#define SLOT1 (SLOT0 + STORE_BYTES)

typedef struct __attribute__((packed)) {
  uint16_t year;
  uint8_t month;
  uint8_t day;
  uint8_t hour;
  uint8_t min;
  uint8_t sec;
  uint8_t flags;
  uint16_t crc;
} lp_clk_snap_t;

#define CLK_OFF ((sizeof(lp_store_t) + 1u) & ~1u)
#define CLK_MAX ((STORE_BYTES - CLK_OFF) / sizeof(lp_clk_snap_t))

_Static_assert(sizeof(lp_store_t) <= STORE_BYTES, "store exceeds ping-pong slot");
_Static_assert(sizeof(lp_clk_snap_t) == 10, "clock snap size");
_Static_assert(CLK_MAX >= 2, "store slot has no room for clock snaps");
_Static_assert(offsetof(lp_key_t, title) == LP_KEY_HID_BYTES, "title must follow HID key blob");
_Static_assert(LP_KEY_HID_BYTES <= 60, "HID key blob exceeds vendor packet");

lp_store_t g_store;
static uint32_t live_slot = SLOT0;

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

static void pool_remove(uint8_t profile, uint8_t key);

void storage_factory(void) {
  memset(&g_store, 0, sizeof(g_store));
  g_store.magic = LP_MAGIC;
  g_store.active = 0;
  g_store.contrast = 7;
  g_store.flip = 0;
  g_store.sleep = 3; /* 1m */
  g_store.menu_idle = 1; /* 30s */
  g_store.dirty = 0;
  g_store.n_profiles = LP_N_PROFILES;

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

uint8_t storage_n_profiles(void) {
  uint8_t n = g_store.n_profiles;
  if (n < 1 || n > LP_N_PROFILES) {
    return LP_N_PROFILES;
  }
  return n;
}

static uint8_t n_from(const lp_store_t *s) {
  uint8_t n = s->n_profiles;
  if (n < 1 || n > LP_N_PROFILES) {
    return LP_N_PROFILES;
  }
  return n;
}

static void profile_defaults(lp_profile_t *pr, uint8_t idx) {
  memset(pr, 0, sizeof(*pr));
  pr->name[0] = 'P';
  pr->name[1] = (char)('1' + idx);
  pr->name[2] = 0;
  pr->light_mode = 1;
  pr->bright = 6;
  pr->dim = 2;
}

static int store_sane(const lp_store_t *s) {
  uint8_t n = n_from(s);
  if (s->n_profiles > LP_N_PROFILES || s->active >= n || s->contrast > 10 || s->flip > 1 ||
      s->sleep > 4 || s->menu_idle > 2) {
    return 0;
  }
  for (uint8_t p = 0; p < n; p++) {
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
    live_slot = SLOT1;
  } else if (ao) {
    memcpy(&g_store, a, sizeof(g_store));
    live_slot = SLOT0;
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
  int r = flash_write_slot(dest, &g_store);
  if (r == 0) {
    live_slot = dest;
    clock_on_store_written();
  }
  return r;
}

void storage_reload(void) {
  storage_init();
}

lp_profile_t *storage_active(void) {
  uint8_t n = storage_n_profiles();
  if (g_store.active >= n) {
    g_store.active = 0;
  }
  return &g_store.profiles[g_store.active];
}

int storage_add_profile(void) {
  uint8_t n = storage_n_profiles();
  uint8_t k;
  if (n >= LP_N_PROFILES) {
    return -1;
  }
  profile_defaults(&g_store.profiles[n], n);
  for (k = 0; k < LP_N_KEYS; k++) {
    storage_set_text(n, k, NULL, 0);
  }
  g_store.n_profiles = (uint8_t)(n + 1);
  g_store.dirty = 1;
  return (int)n;
}

int storage_del_profile(uint8_t idx) {
  uint8_t n = storage_n_profiles();
  uint8_t k;
  if (n <= 1) {
    return -1;
  }
  if (idx >= n) {
    return -2;
  }
  for (k = 0; k < LP_N_KEYS; k++) {
    pool_remove(idx, k);
  }
  if ((uint8_t)(idx + 1) < n) {
    memmove(&g_store.profiles[idx], &g_store.profiles[idx + 1],
            (size_t)(n - idx - 1) * sizeof(lp_profile_t));
    memmove(&g_store.texts[(unsigned)idx * LP_N_KEYS], &g_store.texts[(unsigned)(idx + 1) * LP_N_KEYS],
            (size_t)(n - idx - 1) * LP_N_KEYS * sizeof(lp_text_ref_t));
  }
  memset(&g_store.profiles[n - 1], 0, sizeof(lp_profile_t));
  memset(&g_store.texts[(unsigned)(n - 1) * LP_N_KEYS], 0, LP_N_KEYS * sizeof(lp_text_ref_t));
  g_store.n_profiles = (uint8_t)(n - 1);
  if (g_store.active == idx) {
    g_store.active = (idx < g_store.n_profiles) ? idx : (uint8_t)(g_store.n_profiles - 1);
  } else if (g_store.active > idx) {
    g_store.active--;
  }
  g_store.dirty = 1;
  return 0;
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

void storage_fill_label(char *label, const char *title) {
  uint8_t n = 0;
  memset(label, 0, LP_LABEL_LEN + 1);
  if (!title) {
    return;
  }
  while (*title && n < LP_LABEL_LEN) {
    if (*title != ' ') {
      label[n++] = *title;
    }
    title++;
  }
}

void storage_set_key_title(lp_key_t *k, const char *title) {
  uint8_t n = 0;
  memset(k->title, 0, sizeof(k->title));
  if (title) {
    while (*title && n < LP_TITLE_LEN) {
      unsigned char c = (unsigned char)*title++;
      if (c >= 32 && c <= 126) {
        k->title[n++] = (char)c;
      }
    }
  }
  storage_fill_label(k->label, k->title);
}

const char *storage_key_title(const lp_key_t *k) {
  return k->title[0] ? k->title : k->label;
}

static int snap_ok(const lp_clk_snap_t *s) {
  if (s->year == 0xFFFFu || s->year < 2000 || s->month < 1 || s->month > 12 || s->day < 1 ||
      s->hour > 23 || s->min > 59 || s->sec > 59) {
    return 0;
  }
  return s->crc == crc16((const uint8_t *)s, 8);
}

int storage_clock_load(uint16_t *year, uint8_t *month, uint8_t *day, uint8_t *hour, uint8_t *min,
                       uint8_t *sec) {
  const uint32_t slots[2] = {live_slot, live_slot == SLOT0 ? SLOT1 : SLOT0};
  const lp_clk_snap_t *found = NULL;
  for (int si = 0; si < 2; si++) {
    const lp_clk_snap_t *base = (const lp_clk_snap_t *)(slots[si] + CLK_OFF);
    for (uint32_t i = 0; i < CLK_MAX; i++) {
      if (snap_ok(&base[i])) {
        found = &base[i];
      }
    }
    if (found) {
      break;
    }
  }
  if (!found) {
    return -1;
  }
  if (year) {
    *year = found->year;
  }
  if (month) {
    *month = found->month;
  }
  if (day) {
    *day = found->day;
  }
  if (hour) {
    *hour = found->hour;
  }
  if (min) {
    *min = found->min;
  }
  if (sec) {
    *sec = found->sec;
  }
  return 0;
}

int storage_clock_store(uint16_t year, uint8_t month, uint8_t day, uint8_t hour, uint8_t min,
                        uint8_t sec, int force) {
  lp_clk_snap_t *base = (lp_clk_snap_t *)(live_slot + CLK_OFF);
  int empty = -1;
  int nempty = 0;
  for (uint32_t i = 0; i < CLK_MAX; i++) {
    if (base[i].year == 0xFFFFu && base[i].crc == 0xFFFFu) {
      if (empty < 0) {
        empty = (int)i;
      }
      nempty++;
    }
  }
  if (empty < 0) {
    return -2;
  }
  if (!force && nempty <= 1) {
    return -2;
  }
  lp_clk_snap_t s = {0};
  s.year = year;
  s.month = month;
  s.day = day;
  s.hour = hour;
  s.min = min;
  s.sec = sec;
  s.flags = 1;
  s.crc = crc16((const uint8_t *)&s, 8);
  uint32_t addr = live_slot + CLK_OFF + (uint32_t)empty * sizeof(s);
  HAL_FLASH_Unlock();
  for (uint32_t off = 0; off < sizeof(s); off += 2) {
    uint16_t hw;
    memcpy(&hw, (const uint8_t *)&s + off, 2);
    if (HAL_FLASH_Program(FLASH_TYPEPROGRAM_HALFWORD, addr + off, hw) != HAL_OK) {
      HAL_FLASH_Lock();
      return -1;
    }
  }
  HAL_FLASH_Lock();
  return 0;
}
