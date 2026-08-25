#include "storage.h"
#include "clock.h"
#include "led_mux.h"
#include "main.h"
#include <stddef.h>
#include <string.h>

#define LP_MAGIC 0x4C504149u /* LPAI: packed sparse store */
#define LP_MAGIC_V4 0x4C504148u /* LPAH: fixed 4-profile store */
#define STORE_PAGES LP_STORE_PAGES
#define STORE_BYTES LP_STORE_BYTES
#define SLOT0 ((uint32_t)(FLASH_BASE + 0xE000u))
#define SLOT1 (SLOT0 + STORE_BYTES)
#define HDR_SIZE 16u
#define KF_NACT 0x0Fu
#define KF_TITLE 0x10u
#define KF_LED 0x20u
#define KF_TEXT 0x40u
#define KEY_BITS 0x1FFu
#define EMPTY_ADD 16u

typedef struct __attribute__((packed)) {
  uint32_t magic;
  uint16_t crc;
  uint16_t used;
  uint8_t active;
  uint8_t contrast;
  uint8_t flip;
  uint8_t sleep;
  uint8_t menu_idle;
  uint8_t dirty;
  uint8_t n_profiles;
  uint8_t _pad;
} lp_hdr_t;

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

typedef struct __attribute__((packed)) {
  char label[LP_LABEL_LEN + 1];
  uint8_t led;
  uint8_t n;
  lp_action_t acts[LP_MAX_ACTIONS];
  char title[LP_TITLE_LEN + 1];
} lp_key_v4_t;

typedef struct __attribute__((packed)) {
  char name[LP_NAME_LEN + 1];
  uint8_t light_mode;
  uint8_t bright;
  uint8_t dim;
  uint8_t _pad;
  lp_key_v4_t keys[LP_N_KEYS];
} lp_profile_v4_t;

typedef struct __attribute__((packed)) {
  uint16_t off;
  uint8_t len;
} lp_text_ref_v4_t;

typedef struct __attribute__((packed)) {
  uint32_t magic;
  uint16_t crc;
  uint8_t active;
  uint8_t contrast;
  uint8_t flip;
  uint8_t sleep;
  uint8_t menu_idle;
  uint8_t dirty;
  uint8_t n_profiles;
  uint8_t _pad;
  lp_profile_v4_t profiles[4];
  lp_text_ref_v4_t texts[36];
  uint16_t pool_n;
  char pool[1200];
} lp_store_v4_t;

_Static_assert(sizeof(lp_hdr_t) == 16, "packed header");
_Static_assert(sizeof(lp_clk_snap_t) == 10, "clock snap size");
_Static_assert(sizeof(lp_store_v4_t) == 3912, "v4 store size");
_Static_assert(offsetof(lp_key_t, title) == LP_KEY_HID_BYTES, "title must follow HID key blob");
_Static_assert(LP_KEY_HID_BYTES <= 60, "HID key blob exceeds vendor packet");

lp_store_t g_store;
static uint8_t g_blob[STORE_BYTES];
static lp_profile_t g_pr;
static uint8_t g_text[LP_N_KEYS][LP_TEXT_MAX];
static uint8_t g_tlen[LP_N_KEYS];
static uint8_t g_pr_idx;
static uint8_t g_enc[3072];
static uint8_t g_text_peek[LP_TEXT_MAX];
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

static uint16_t rd16(const uint8_t *p) {
  return (uint16_t)p[0] | ((uint16_t)p[1] << 8);
}

static void wr16(uint8_t *p, uint16_t v) {
  p[0] = (uint8_t)v;
  p[1] = (uint8_t)(v >> 8);
}

static lp_hdr_t *hdr(void) {
  return (lp_hdr_t *)g_blob;
}

static uint16_t blob_used(void) {
  uint16_t u = hdr()->used;
  if (u < HDR_SIZE || u > LP_STORE_CAP) {
    return HDR_SIZE;
  }
  return u;
}

static void blob_set_crc(void) {
  uint16_t u = blob_used();
  hdr()->magic = LP_MAGIC;
  hdr()->crc = crc16(g_blob + 6, (uint32_t)u - 6u);
}

static int blob_crc_ok(const uint8_t *b, uint16_t used) {
  const lp_hdr_t *h = (const lp_hdr_t *)b;
  if (h->magic != LP_MAGIC || used < HDR_SIZE || used > LP_STORE_CAP) {
    return 0;
  }
  return h->crc == crc16(b + 6, (uint32_t)used - 6u);
}

static int skip_key(const uint8_t *b, uint16_t *off, uint16_t end) {
  uint8_t fl, nact, ln;
  if (*off >= end) {
    return -1;
  }
  fl = b[*off];
  (*off)++;
  nact = (uint8_t)(fl & KF_NACT);
  if (nact > LP_MAX_ACTIONS) {
    return -1;
  }
  if (fl & KF_LED) {
    if (*off >= end) {
      return -1;
    }
    (*off)++;
  }
  if (fl & KF_TITLE) {
    if (*off >= end) {
      return -1;
    }
    ln = b[*off];
    (*off)++;
    if (ln > LP_TITLE_LEN || (uint16_t)(*off + ln) > end) {
      return -1;
    }
    *off = (uint16_t)(*off + ln);
  }
  if ((uint16_t)(*off + (uint16_t)nact * 4u) > end) {
    return -1;
  }
  *off = (uint16_t)(*off + (uint16_t)nact * 4u);
  if (fl & KF_TEXT) {
    if (*off >= end) {
      return -1;
    }
    ln = b[*off];
    (*off)++;
    if (ln > LP_TEXT_MAX || (uint16_t)(*off + ln) > end) {
      return -1;
    }
    *off = (uint16_t)(*off + ln);
  }
  return 0;
}

static int skip_profile(const uint8_t *b, uint16_t *off, uint16_t end) {
  uint8_t nlen;
  uint16_t mask;
  uint8_t k;
  if (*off >= end) {
    return -1;
  }
  nlen = b[*off];
  (*off)++;
  if (nlen > LP_NAME_LEN || (uint16_t)(*off + nlen + 6u) > end) {
    return -1;
  }
  *off = (uint16_t)(*off + nlen + 4u);
  mask = rd16(b + *off);
  *off = (uint16_t)(*off + 2u);
  if (mask & ~KEY_BITS) {
    return -1;
  }
  for (k = 0; k < LP_N_KEYS; k++) {
    if (mask & (1u << k)) {
      if (skip_key(b, off, end) != 0) {
        return -1;
      }
    }
  }
  return 0;
}

static int walk_ok(const uint8_t *b, uint16_t used, uint8_t nprof) {
  uint16_t off = HDR_SIZE;
  uint8_t p;
  if (nprof < 1) {
    return 0;
  }
  for (p = 0; p < nprof; p++) {
    if (skip_profile(b, &off, used) != 0) {
      return 0;
    }
  }
  return off == used;
}

static int slot_packed_ok(const uint8_t *b) {
  const lp_hdr_t *h = (const lp_hdr_t *)b;
  uint16_t used;
  if (h->magic != LP_MAGIC) {
    return 0;
  }
  used = h->used;
  if (!blob_crc_ok(b, used)) {
    return 0;
  }
  if (h->n_profiles < 1 || h->active >= h->n_profiles || h->contrast > 10 || h->flip > 1 ||
      h->sleep > 4 || h->menu_idle > 2) {
    return 0;
  }
  return walk_ok(b, used, h->n_profiles);
}

static int profile_span(uint8_t idx, uint16_t *off, uint16_t *len) {
  uint16_t used = blob_used();
  uint16_t o = HDR_SIZE;
  uint16_t start;
  uint8_t n = hdr()->n_profiles;
  uint8_t p;
  if (idx >= n) {
    return -1;
  }
  for (p = 0; p < idx; p++) {
    if (skip_profile(g_blob, &o, used) != 0) {
      return -1;
    }
  }
  start = o;
  if (skip_profile(g_blob, &o, used) != 0) {
    return -1;
  }
  if (off) {
    *off = start;
  }
  if (len) {
    *len = (uint16_t)(o - start);
  }
  return 0;
}

static int splice(uint16_t off, uint16_t old_len, const uint8_t *src, uint16_t new_len) {
  uint16_t used = blob_used();
  int32_t delta;
  uint16_t tail;
  if (off < HDR_SIZE || (uint32_t)off + old_len > used) {
    return -1;
  }
  delta = (int32_t)new_len - (int32_t)old_len;
  if ((int32_t)used + delta < (int32_t)HDR_SIZE || (int32_t)used + delta > (int32_t)LP_STORE_CAP) {
    return -1;
  }
  tail = (uint16_t)(used - (off + old_len));
  if (delta != 0 && tail) {
    memmove(g_blob + off + new_len, g_blob + off + old_len, tail);
  }
  if (new_len && src) {
    memcpy(g_blob + off, src, new_len);
  }
  hdr()->used = (uint16_t)(used + delta);
  return 0;
}

static uint8_t name_len_of(const char *s) {
  uint8_t n = 0;
  if (!s) {
    return 0;
  }
  while (s[n] && n < LP_NAME_LEN) {
    n++;
  }
  return n;
}

static uint8_t majority_led(const lp_profile_t *pr) {
  uint8_t cnt[5] = {0};
  uint8_t k, best = 0, bi = 0;
  for (k = 0; k < LP_N_KEYS; k++) {
    uint8_t led = pr->keys[k].led;
    if (led > 4) {
      led = 0;
    }
    cnt[led]++;
  }
  for (k = 0; k < 5; k++) {
    if (cnt[k] > best) {
      best = cnt[k];
      bi = k;
    }
  }
  return bi;
}

static int encode_profile(const lp_profile_t *pr, const uint8_t tlen[LP_N_KEYS],
                          const uint8_t texts[LP_N_KEYS][LP_TEXT_MAX], uint8_t *dst,
                          uint16_t dst_max, uint16_t *out_len) {
  uint16_t o = 0;
  uint8_t nlen = name_len_of(pr->name);
  uint8_t def_led = majority_led(pr);
  uint16_t mask = 0;
  uint8_t k;
  if ((uint16_t)(1u + nlen + 6u) > dst_max) {
    return -1;
  }
  dst[o++] = nlen;
  if (nlen) {
    memcpy(dst + o, pr->name, nlen);
    o = (uint16_t)(o + nlen);
  }
  dst[o++] = pr->light_mode >= LP_N_LIGHT_MODES ? 0 : pr->light_mode;
  dst[o++] = pr->bright > 10 ? 10 : pr->bright;
  dst[o++] = pr->dim > 10 ? 10 : pr->dim;
  dst[o++] = def_led;
  {
    uint16_t mask_at = o;
    o = (uint16_t)(o + 2u);
    for (k = 0; k < LP_N_KEYS; k++) {
      const lp_key_t *key = &pr->keys[k];
      const char *title = storage_key_title(key);
      uint8_t nact = key->n > LP_MAX_ACTIONS ? LP_MAX_ACTIONS : key->n;
      uint8_t has_title = (title && title[0]) ? 1 : 0;
      uint8_t tl = tlen ? tlen[k] : 0;
      uint8_t has_text = tl > 0;
      uint8_t has_led = (key->led != def_led) ? 1 : 0;
      uint8_t tln = 0;
      uint8_t fl;
      uint8_t i;
      if (has_title) {
        while (title[tln] && tln < LP_TITLE_LEN) {
          tln++;
        }
      }
      if (!nact && !has_title && !has_text && !has_led) {
        continue;
      }
      fl = nact;
      if (has_title) {
        fl |= KF_TITLE;
      }
      if (has_led) {
        fl |= KF_LED;
      }
      if (has_text) {
        fl |= KF_TEXT;
      }
      if ((uint32_t)o + 1u + (has_led ? 1u : 0u) + (has_title ? (1u + tln) : 0u) +
              (uint32_t)nact * 4u + (has_text ? (1u + tl) : 0u) >
          dst_max) {
        return -1;
      }
      dst[o++] = fl;
      if (has_led) {
        dst[o++] = key->led;
      }
      if (has_title) {
        dst[o++] = tln;
        memcpy(dst + o, title, tln);
        o = (uint16_t)(o + tln);
      }
      for (i = 0; i < nact; i++) {
        dst[o++] = key->acts[i].type;
        dst[o++] = key->acts[i].mods;
        wr16(dst + o, key->acts[i].code);
        o = (uint16_t)(o + 2u);
      }
      if (has_text) {
        dst[o++] = tl;
        memcpy(dst + o, texts[k], tl);
        o = (uint16_t)(o + tl);
      }
      mask |= (uint16_t)(1u << k);
    }
    wr16(dst + mask_at, mask);
  }
  if (out_len) {
    *out_len = o;
  }
  return 0;
}

static int decode_profile(const uint8_t *b, uint16_t start, uint16_t end, lp_profile_t *pr,
                          uint8_t tlen[LP_N_KEYS], uint8_t texts[LP_N_KEYS][LP_TEXT_MAX]) {
  uint16_t o = start;
  uint8_t nlen, def_led, k;
  uint16_t mask;
  memset(pr, 0, sizeof(*pr));
  if (tlen) {
    memset(tlen, 0, LP_N_KEYS);
  }
  if (o >= end) {
    return -1;
  }
  nlen = b[o++];
  if (nlen > LP_NAME_LEN || (uint16_t)(o + nlen + 6u) > end) {
    return -1;
  }
  if (nlen) {
    memcpy(pr->name, b + o, nlen);
  }
  o = (uint16_t)(o + nlen);
  pr->light_mode = b[o++];
  pr->bright = b[o++];
  pr->dim = b[o++];
  def_led = b[o++];
  mask = rd16(b + o);
  o = (uint16_t)(o + 2u);
  if (pr->light_mode >= LP_N_LIGHT_MODES) {
    pr->light_mode = 0;
  }
  if (pr->bright > 10) {
    pr->bright = 10;
  }
  if (pr->dim > 10) {
    pr->dim = 10;
  }
  if (def_led > 4) {
    def_led = 0;
  }
  for (k = 0; k < LP_N_KEYS; k++) {
    pr->keys[k].led = def_led;
  }
  for (k = 0; k < LP_N_KEYS; k++) {
    uint8_t fl, nact, i;
    lp_key_t *key;
    if ((mask & (1u << k)) == 0) {
      continue;
    }
    if (o >= end) {
      return -1;
    }
    key = &pr->keys[k];
    fl = b[o++];
    nact = (uint8_t)(fl & KF_NACT);
    if (nact > LP_MAX_ACTIONS) {
      return -1;
    }
    if (fl & KF_LED) {
      if (o >= end) {
        return -1;
      }
      key->led = b[o++];
    }
    if (fl & KF_TITLE) {
      uint8_t ln;
      if (o >= end) {
        return -1;
      }
      ln = b[o++];
      if (ln > LP_TITLE_LEN || (uint16_t)(o + ln) > end) {
        return -1;
      }
      memcpy(key->title, b + o, ln);
      o = (uint16_t)(o + ln);
    }
    if ((uint16_t)(o + (uint16_t)nact * 4u) > end) {
      return -1;
    }
    key->n = nact;
    for (i = 0; i < nact; i++) {
      key->acts[i].type = b[o++];
      key->acts[i].mods = b[o++];
      key->acts[i].code = rd16(b + o);
      o = (uint16_t)(o + 2u);
    }
    if (fl & KF_TEXT) {
      uint8_t ln;
      if (o >= end) {
        return -1;
      }
      ln = b[o++];
      if (ln > LP_TEXT_MAX || (uint16_t)(o + ln) > end) {
        return -1;
      }
      if (tlen) {
        tlen[k] = ln;
      }
      if (texts && ln) {
        memcpy(texts[k], b + o, ln);
      }
      o = (uint16_t)(o + ln);
    }
    storage_fill_label(key->label, storage_key_title(key));
  }
  return 0;
}

static void meta_from_hdr(void) {
  const lp_hdr_t *h = hdr();
  g_store.active = h->active;
  g_store.contrast = h->contrast;
  g_store.flip = h->flip;
  g_store.sleep = h->sleep;
  g_store.menu_idle = h->menu_idle;
  g_store.n_profiles = h->n_profiles;
}

static void hdr_from_meta(void) {
  lp_hdr_t *h = hdr();
  h->active = g_store.active;
  h->contrast = g_store.contrast;
  h->flip = g_store.flip;
  h->sleep = g_store.sleep;
  h->menu_idle = g_store.menu_idle;
  h->dirty = 0;
  h->n_profiles = g_store.n_profiles;
  h->_pad = 0;
}

static int load_profile(uint8_t idx) {
  uint16_t off = 0, len = 0;
  if (idx >= hdr()->n_profiles) {
    return -1;
  }
  if (profile_span(idx, &off, &len) != 0) {
    return -1;
  }
  if (decode_profile(g_blob, off, (uint16_t)(off + len), &g_pr, g_tlen, g_text) != 0) {
    return -1;
  }
  g_pr_idx = idx;
  return 0;
}

static int replace_open(void) {
  uint16_t nlen = 0;
  uint16_t off = 0, old = 0;
  hdr_from_meta();
  if (g_pr_idx >= hdr()->n_profiles) {
    return -1;
  }
  if (encode_profile(&g_pr, g_tlen, g_text, g_enc, (uint16_t)sizeof(g_enc), &nlen) != 0) {
    return -1;
  }
  if (profile_span(g_pr_idx, &off, &old) != 0) {
    return -1;
  }
  if (splice(off, old, g_enc, nlen) != 0) {
    return -1;
  }
  return 0;
}

int storage_commit(void) {
  uint8_t saved_idx = g_pr_idx;
  if (hdr()->magic != LP_MAGIC) {
    return -1;
  }
  if (replace_open() != 0) {
    (void)load_profile(saved_idx);
    return -1;
  }
  return 0;
}

static void make_name(char *n, uint8_t idx) {
  unsigned num = (unsigned)idx + 1u;
  n[0] = 'P';
  if (num < 10u) {
    n[1] = (char)('0' + num);
    n[2] = 0;
  } else if (num < 100u) {
    n[1] = (char)('0' + num / 10u);
    n[2] = (char)('0' + num % 10u);
    n[3] = 0;
  } else {
    n[1] = (char)('0' + num / 100u);
    n[2] = (char)('0' + (num / 10u) % 10u);
    n[3] = (char)('0' + num % 10u);
    n[4] = 0;
  }
}

static void clear_texts(void) {
  memset(g_text, 0, sizeof(g_text));
  memset(g_tlen, 0, sizeof(g_tlen));
}

static int append_empty(uint8_t idx) {
  char name[LP_NAME_LEN + 1];
  uint8_t nlen;
  uint16_t o = 0;
  memset(name, 0, sizeof(name));
  make_name(name, idx);
  nlen = name_len_of(name);
  g_enc[o++] = nlen;
  memcpy(g_enc + o, name, nlen);
  o = (uint16_t)(o + nlen);
  g_enc[o++] = 1; /* Solid */
  g_enc[o++] = 6;
  g_enc[o++] = 2;
  g_enc[o++] = 0; /* default LED */
  wr16(g_enc + o, 0);
  o = (uint16_t)(o + 2u);
  return splice(blob_used(), 0, g_enc, o);
}

void storage_factory(void) {
  int p;
  memset(g_blob, 0, sizeof(g_blob));
  memset(&g_store, 0, sizeof(g_store));
  hdr()->magic = LP_MAGIC;
  hdr()->used = HDR_SIZE;
  g_store.active = 0;
  g_store.contrast = 7;
  g_store.flip = 0;
  g_store.sleep = 3;
  g_store.menu_idle = 1;
  g_store.dirty = 0;
  g_store.n_profiles = 0;
  hdr_from_meta();
  for (p = 0; p < 4; p++) {
    if (append_empty((uint8_t)p) != 0) {
      break;
    }
    g_store.n_profiles = (uint8_t)(p + 1);
    hdr()->n_profiles = g_store.n_profiles;
  }
  blob_set_crc();
  g_pr_idx = 0xFF;
  (void)load_profile(0);
}

static int flash_write_slot(uint32_t addr, const uint8_t *s, uint16_t nbytes) {
  HAL_FLASH_Unlock();
  FLASH_EraseInitTypeDef er = {0};
  uint32_t page_err = 0;
  uint32_t off;
  er.TypeErase = FLASH_TYPEERASE_PAGES;
  er.PageAddress = addr;
  er.NbPages = STORE_PAGES;
  if (HAL_FLASHEx_Erase(&er, &page_err) != HAL_OK) {
    HAL_FLASH_Lock();
    return -1;
  }
  if (nbytes & 1u) {
    nbytes++;
  }
  if (nbytes > STORE_BYTES) {
    nbytes = STORE_BYTES;
  }
  for (off = 0; off < nbytes; off += 2) {
    uint16_t hw = 0xFFFF;
    if (off + 1u < nbytes) {
      memcpy(&hw, s + off, 2);
    } else if (off < nbytes) {
      hw = (uint16_t)(s[off] | 0xFF00);
    }
    if (HAL_FLASH_Program(FLASH_TYPEPROGRAM_HALFWORD, addr + off, hw) != HAL_OK) {
      HAL_FLASH_Lock();
      return -1;
    }
  }
  HAL_FLASH_Lock();
  return 0;
}

static uint16_t v4_crc(const lp_store_v4_t *s) {
  const uint8_t *p = (const uint8_t *)s;
  return crc16(p + 6, sizeof(*s) - 6);
}

static int v4_ok(const lp_store_v4_t *s) {
  uint8_t n;
  if (s->magic != LP_MAGIC_V4 || s->crc != v4_crc(s)) {
    return 0;
  }
  n = s->n_profiles;
  if (n == 0) {
    n = 4;
  }
  if (n < 1 || n > 4 || s->active >= n || s->contrast > 10 || s->flip > 1 || s->sleep > 4 ||
      s->menu_idle > 2) {
    return 0;
  }
  return 1;
}

static uint8_t v4_n(const lp_store_v4_t *s) {
  uint8_t n = s->n_profiles;
  return (n < 1 || n > 4) ? 4 : n;
}

static void migrate_v4(const lp_store_v4_t *s) {
  uint8_t n = v4_n(s);
  uint8_t p;
  memset(g_blob, 0, sizeof(g_blob));
  memset(&g_store, 0, sizeof(g_store));
  hdr()->magic = LP_MAGIC;
  hdr()->used = HDR_SIZE;
  g_store.active = s->active < n ? s->active : 0;
  g_store.contrast = s->contrast;
  g_store.flip = s->flip;
  g_store.sleep = s->sleep;
  g_store.menu_idle = s->menu_idle;
  g_store.dirty = 0;
  g_store.n_profiles = 0;
  hdr_from_meta();
  for (p = 0; p < n; p++) {
    uint8_t k;
    uint16_t nlen = 0;
    memset(&g_pr, 0, sizeof(g_pr));
    clear_texts();
    memcpy(g_pr.name, s->profiles[p].name, LP_NAME_LEN);
    g_pr.light_mode = s->profiles[p].light_mode;
    g_pr.bright = s->profiles[p].bright;
    g_pr.dim = s->profiles[p].dim;
    for (k = 0; k < LP_N_KEYS; k++) {
      memcpy(&g_pr.keys[k], &s->profiles[p].keys[k], sizeof(lp_key_t));
      {
        const lp_text_ref_v4_t *r = &s->texts[(unsigned)p * LP_N_KEYS + k];
        if (r->len && (uint32_t)r->off + r->len <= s->pool_n && r->len <= LP_TEXT_MAX) {
          g_tlen[k] = r->len;
          memcpy(g_text[k], s->pool + r->off, r->len);
        }
      }
    }
    if (encode_profile(&g_pr, g_tlen, g_text, g_enc, (uint16_t)sizeof(g_enc), &nlen) != 0) {
      break;
    }
    if (splice(blob_used(), 0, g_enc, nlen) != 0) {
      break;
    }
    g_store.n_profiles = (uint8_t)(p + 1);
    hdr()->n_profiles = g_store.n_profiles;
  }
  if (g_store.n_profiles < 1) {
    storage_factory();
    return;
  }
  if (g_store.active >= g_store.n_profiles) {
    g_store.active = 0;
  }
  hdr_from_meta();
  blob_set_crc();
  g_pr_idx = 0xFF;
  (void)load_profile(g_store.active);
}

void storage_init(void) {
  const uint8_t *a = (const uint8_t *)SLOT0;
  const uint8_t *b = (const uint8_t *)SLOT1;
  int ao = slot_packed_ok(a);
  int bo = slot_packed_ok(b);
  if (bo) {
    memcpy(g_blob, b, STORE_BYTES);
    live_slot = SLOT1;
    meta_from_hdr();
    g_store.dirty = 0;
    g_pr_idx = 0xFF;
    if (load_profile(g_store.active) != 0) {
      storage_factory();
      storage_save();
    }
    return;
  }
  if (ao) {
    memcpy(g_blob, a, STORE_BYTES);
    live_slot = SLOT0;
    meta_from_hdr();
    g_store.dirty = 0;
    g_pr_idx = 0xFF;
    if (load_profile(g_store.active) != 0) {
      storage_factory();
      storage_save();
    }
    return;
  }
  {
    const lp_store_v4_t *va = (const lp_store_v4_t *)SLOT0;
    const lp_store_v4_t *vb = (const lp_store_v4_t *)SLOT1;
    int vbo = v4_ok(vb);
    int vao = v4_ok(va);
    if (vbo) {
      migrate_v4(vb);
      live_slot = SLOT1;
      storage_save();
      return;
    }
    if (vao) {
      migrate_v4(va);
      live_slot = SLOT0;
      storage_save();
      return;
    }
  }
  storage_factory();
  storage_save();
}

int storage_save(void) {
  const uint8_t *a = (const uint8_t *)SLOT0;
  uint32_t dest;
  uint16_t nbytes;
  (void)storage_commit();
  g_store.dirty = 0;
  hdr_from_meta();
  blob_set_crc();
  dest = slot_packed_ok(a) ? SLOT1 : SLOT0;
  nbytes = blob_used();
  if (flash_write_slot(dest, g_blob, nbytes) != 0) {
    return -1;
  }
  live_slot = dest;
  clock_on_store_written();
  return 0;
}

void storage_reload(void) {
  storage_init();
}

lp_profile_t *storage_active(void) {
  uint8_t n = storage_n_profiles();
  if (g_store.active >= n) {
    g_store.active = 0;
    hdr()->active = 0;
  }
  if (g_pr_idx != g_store.active) {
    (void)storage_commit();
    (void)load_profile(g_store.active);
  }
  return &g_pr;
}

uint8_t storage_n_profiles(void) {
  uint8_t n = hdr()->n_profiles;
  if (n < 1) {
    return 1;
  }
  return n;
}

int storage_can_add_profile(void) {
  uint8_t n = storage_n_profiles();
  if (n >= LP_N_PROFILES) {
    return 0;
  }
  return (uint32_t)blob_used() + EMPTY_ADD <= LP_STORE_CAP;
}

int storage_add_profile(void) {
  uint8_t n;
  if (storage_commit() != 0) {
    return -1;
  }
  n = storage_n_profiles();
  if (!storage_can_add_profile()) {
    return -1;
  }
  if (append_empty(n) != 0) {
    return -1;
  }
  g_store.n_profiles = (uint8_t)(n + 1);
  hdr()->n_profiles = g_store.n_profiles;
  g_store.dirty = 1;
  return (int)n;
}

int storage_del_profile(uint8_t idx) {
  uint8_t n;
  uint16_t off = 0, len = 0;
  if (storage_commit() != 0) {
    return -2;
  }
  n = storage_n_profiles();
  if (n <= 1) {
    return -1;
  }
  if (idx >= n) {
    return -2;
  }
  if (profile_span(idx, &off, &len) != 0) {
    return -2;
  }
  if (splice(off, len, NULL, 0) != 0) {
    return -2;
  }
  g_store.n_profiles = (uint8_t)(n - 1);
  hdr()->n_profiles = g_store.n_profiles;
  if (g_store.active == idx) {
    g_store.active = (idx < g_store.n_profiles) ? idx : (uint8_t)(g_store.n_profiles - 1);
  } else if (g_store.active > idx) {
    g_store.active--;
  }
  hdr()->active = g_store.active;
  g_pr_idx = 0xFF;
  (void)load_profile(g_store.active);
  g_store.dirty = 1;
  return 0;
}

void storage_set_active(uint8_t idx) {
  if (idx >= storage_n_profiles()) {
    return;
  }
  (void)storage_commit();
  g_store.active = idx;
  hdr()->active = idx;
  (void)load_profile(idx);
}

void storage_profile_name(uint8_t idx, char *out, size_t n) {
  uint16_t off = 0, len = 0;
  uint8_t nlen;
  if (!out || n == 0) {
    return;
  }
  out[0] = 0;
  if (idx == g_pr_idx) {
    strncpy(out, g_pr.name, n - 1);
    out[n - 1] = 0;
    return;
  }
  if (profile_span(idx, &off, &len) != 0 || off >= blob_used()) {
    return;
  }
  nlen = g_blob[off];
  if (nlen > LP_NAME_LEN || (uint16_t)(off + 1u + nlen) > blob_used()) {
    return;
  }
  if (nlen >= n) {
    nlen = (uint8_t)(n - 1);
  }
  memcpy(out, g_blob + off + 1, nlen);
  out[nlen] = 0;
}

static int mutate_begin(uint8_t idx, uint8_t *prev) {
  *prev = g_pr_idx;
  if (idx >= storage_n_profiles()) {
    return -1;
  }
  if (idx == g_pr_idx) {
    return 0;
  }
  if (storage_commit() != 0) {
    return -1;
  }
  return load_profile(idx);
}

static void mutate_end(uint8_t prev) {
  if (prev == g_pr_idx) {
    return;
  }
  (void)storage_commit();
  (void)load_profile(prev);
}

int storage_set_profile_name(uint8_t idx, const char *name) {
  uint8_t prev;
  if (mutate_begin(idx, &prev) != 0) {
    return -1;
  }
  memset(g_pr.name, 0, sizeof(g_pr.name));
  if (name) {
    strncpy(g_pr.name, name, LP_NAME_LEN);
  }
  if (storage_commit() != 0) {
    mutate_end(prev);
    return -1;
  }
  mutate_end(prev);
  return 0;
}

int storage_set_profile_hdr(uint8_t idx, const char *name, uint8_t mode, uint8_t bright,
                            uint8_t dim) {
  uint8_t prev;
  if (mutate_begin(idx, &prev) != 0) {
    return -1;
  }
  memset(g_pr.name, 0, sizeof(g_pr.name));
  if (name) {
    strncpy(g_pr.name, name, LP_NAME_LEN);
  }
  g_pr.light_mode = mode >= LP_N_LIGHT_MODES ? 0 : mode;
  g_pr.bright = bright > 10 ? 10 : bright;
  g_pr.dim = dim > 10 ? 10 : dim;
  if (storage_commit() != 0) {
    mutate_end(prev);
    return -1;
  }
  mutate_end(prev);
  return 0;
}

int storage_get_profile_hdr(uint8_t idx, lp_profile_t *out) {
  uint16_t off = 0, len = 0;
  static lp_profile_t peek;
  if (!out || idx >= storage_n_profiles()) {
    return -1;
  }
  if (idx == g_pr_idx) {
    *out = g_pr;
    return 0;
  }
  if (profile_span(idx, &off, &len) != 0) {
    return -1;
  }
  if (decode_profile(g_blob, off, (uint16_t)(off + len), &peek, NULL, NULL) != 0) {
    return -1;
  }
  *out = peek;
  return 0;
}

int storage_get_key(uint8_t profile, uint8_t key, lp_key_t *out) {
  static lp_profile_t peek;
  uint16_t off = 0, len = 0;
  if (!out || profile >= storage_n_profiles() || key >= LP_N_KEYS) {
    return -1;
  }
  if (profile == g_pr_idx) {
    *out = g_pr.keys[key];
    return 0;
  }
  if (profile_span(profile, &off, &len) != 0) {
    return -1;
  }
  if (decode_profile(g_blob, off, (uint16_t)(off + len), &peek, NULL, NULL) != 0) {
    return -1;
  }
  *out = peek.keys[key];
  return 0;
}

int storage_set_key(uint8_t profile, uint8_t key, const lp_key_t *in) {
  uint8_t prev;
  if (!in || key >= LP_N_KEYS) {
    return -1;
  }
  if (mutate_begin(profile, &prev) != 0) {
    return -1;
  }
  g_pr.keys[key] = *in;
  if (g_pr.keys[key].n > LP_MAX_ACTIONS) {
    g_pr.keys[key].n = LP_MAX_ACTIONS;
  }
  storage_fill_label(g_pr.keys[key].label, storage_key_title(&g_pr.keys[key]));
  if (storage_commit() != 0) {
    mutate_end(prev);
    return -1;
  }
  mutate_end(prev);
  return 0;
}

int storage_set_key_title_at(uint8_t profile, uint8_t key, const char *title) {
  uint8_t prev;
  if (key >= LP_N_KEYS) {
    return -1;
  }
  if (mutate_begin(profile, &prev) != 0) {
    return -1;
  }
  storage_set_key_title(&g_pr.keys[key], title);
  if (storage_commit() != 0) {
    mutate_end(prev);
    return -1;
  }
  mutate_end(prev);
  return 0;
}

int storage_reset_profile_keys(uint8_t idx) {
  uint8_t prev;
  if (mutate_begin(idx, &prev) != 0) {
    return -1;
  }
  memset(g_pr.keys, 0, sizeof(g_pr.keys));
  clear_texts();
  if (storage_commit() != 0) {
    mutate_end(prev);
    return -1;
  }
  mutate_end(prev);
  return 0;
}

static uint16_t blob_text_sum(void) {
  uint16_t used = blob_used();
  uint16_t off = HDR_SIZE;
  uint16_t s = 0;
  uint8_t p, n = hdr()->n_profiles;
  for (p = 0; p < n; p++) {
    uint8_t nlen, k;
    uint16_t mask;
    if (off >= used) {
      break;
    }
    nlen = g_blob[off++];
    if (nlen > LP_NAME_LEN || (uint16_t)(off + nlen + 6u) > used) {
      break;
    }
    off = (uint16_t)(off + nlen + 4u);
    mask = rd16(g_blob + off);
    off = (uint16_t)(off + 2u);
    for (k = 0; k < LP_N_KEYS; k++) {
      uint16_t ko;
      uint8_t fl;
      if ((mask & (1u << k)) == 0) {
        continue;
      }
      ko = off;
      if (skip_key(g_blob, &off, used) != 0) {
        return s;
      }
      fl = g_blob[ko];
      if (fl & KF_TEXT) {
        uint16_t tpos = (uint16_t)(ko + 1u);
        uint8_t nact = (uint8_t)(fl & KF_NACT);
        if (fl & KF_LED) {
          tpos++;
        }
        if (fl & KF_TITLE) {
          uint8_t ln = g_blob[tpos];
          tpos = (uint16_t)(tpos + 1u + ln);
        }
        tpos = (uint16_t)(tpos + (uint16_t)nact * 4u);
        if (tpos < used) {
          s = (uint16_t)(s + g_blob[tpos]);
        }
      }
    }
  }
  return s;
}

int storage_set_text(uint8_t profile, uint8_t key, const uint8_t *data, uint8_t len) {
  uint8_t prev;
  if (key >= LP_N_KEYS) {
    return -3;
  }
  if (len > LP_TEXT_MAX) {
    return -2;
  }
  if (len && data == NULL) {
    return -3;
  }
  if (mutate_begin(profile, &prev) != 0) {
    return -3;
  }
  g_tlen[key] = len;
  memset(g_text[key], 0, LP_TEXT_MAX);
  if (len) {
    memcpy(g_text[key], data, len);
  }
  if (storage_commit() != 0) {
    mutate_end(prev);
    return -1;
  }
  mutate_end(prev);
  return 0;
}

const uint8_t *storage_text(uint8_t profile, uint8_t key, uint8_t *len) {
  if (key >= LP_N_KEYS || profile >= storage_n_profiles()) {
    if (len) {
      *len = 0;
    }
    return NULL;
  }
  if (profile == g_pr_idx) {
    if (len) {
      *len = g_tlen[key];
    }
    return g_tlen[key] ? g_text[key] : NULL;
  }
  {
    uint16_t off = 0, plen = 0;
    uint8_t nlen, k;
    uint16_t mask, end;
    if (profile_span(profile, &off, &plen) != 0) {
      if (len) {
        *len = 0;
      }
      return NULL;
    }
    end = (uint16_t)(off + plen);
    nlen = g_blob[off++];
    off = (uint16_t)(off + nlen + 4u);
    mask = rd16(g_blob + off);
    off = (uint16_t)(off + 2u);
    for (k = 0; k < LP_N_KEYS; k++) {
      if ((mask & (1u << k)) == 0) {
        if (k == key) {
          if (len) {
            *len = 0;
          }
          return NULL;
        }
        continue;
      }
      {
        uint16_t ko = off;
        uint8_t fl;
        if (skip_key(g_blob, &off, end) != 0) {
          break;
        }
        if (k != key) {
          continue;
        }
        fl = g_blob[ko];
        if (fl & KF_TEXT) {
          uint16_t tpos = (uint16_t)(ko + 1u);
          uint8_t nact = (uint8_t)(fl & KF_NACT);
          uint8_t tl;
          if (fl & KF_LED) {
            tpos++;
          }
          if (fl & KF_TITLE) {
            uint8_t ln = g_blob[tpos];
            tpos = (uint16_t)(tpos + 1u + ln);
          }
          tpos = (uint16_t)(tpos + (uint16_t)nact * 4u);
          tl = g_blob[tpos++];
          if (tl > LP_TEXT_MAX) {
            tl = 0;
          }
          if (len) {
            *len = tl;
          }
          if (!tl) {
            return NULL;
          }
          memcpy(g_text_peek, g_blob + tpos, tl);
          return g_text_peek;
        }
        if (len) {
          *len = 0;
        }
        return NULL;
      }
    }
  }
  if (len) {
    *len = 0;
  }
  return NULL;
}

uint16_t storage_pool_used(void) {
  (void)storage_commit();
  return blob_text_sum();
}

uint16_t storage_used(void) {
  return blob_used();
}

uint16_t storage_cap(void) {
  return (uint16_t)LP_STORE_CAP;
}

uint16_t storage_pool_max(void) {
  uint16_t used = blob_used();
  uint16_t text = blob_text_sum();
  if (used > LP_STORE_CAP) {
    return text;
  }
  return (uint16_t)((LP_STORE_CAP - used) + text);
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

static uint16_t clk_off_of(const uint8_t *slot) {
  const lp_hdr_t *h = (const lp_hdr_t *)slot;
  uint16_t used;
  if (h->magic == LP_MAGIC && h->used >= HDR_SIZE && h->used <= LP_STORE_CAP) {
    used = h->used;
  } else {
    used = 3912;
  }
  return (uint16_t)((used + 1u) & ~1u);
}

static uint32_t clk_max_of(uint16_t off) {
  if (off >= STORE_BYTES) {
    return 0;
  }
  return (STORE_BYTES - off) / sizeof(lp_clk_snap_t);
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
  int si;
  for (si = 0; si < 2; si++) {
    uint16_t off = clk_off_of((const uint8_t *)slots[si]);
    uint32_t max = clk_max_of(off);
    const lp_clk_snap_t *base = (const lp_clk_snap_t *)(slots[si] + off);
    uint32_t i;
    for (i = 0; i < max; i++) {
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
  uint16_t off = clk_off_of((const uint8_t *)live_slot);
  uint32_t max = clk_max_of(off);
  lp_clk_snap_t *base = (lp_clk_snap_t *)(live_slot + off);
  int empty = -1;
  int nempty = 0;
  uint32_t i;
  lp_clk_snap_t s = {0};
  uint32_t addr;
  uint32_t woff;
  if (max < 2) {
    return -2;
  }
  for (i = 0; i < max; i++) {
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
  s.year = year;
  s.month = month;
  s.day = day;
  s.hour = hour;
  s.min = min;
  s.sec = sec;
  s.flags = 1;
  s.crc = crc16((const uint8_t *)&s, 8);
  addr = live_slot + off + (uint32_t)empty * sizeof(s);
  HAL_FLASH_Unlock();
  for (woff = 0; woff < sizeof(s); woff += 2) {
    uint16_t hw;
    memcpy(&hw, (const uint8_t *)&s + woff, 2);
    if (HAL_FLASH_Program(FLASH_TYPEPROGRAM_HALFWORD, addr + woff, hw) != HAL_OK) {
      HAL_FLASH_Lock();
      return -1;
    }
  }
  HAL_FLASH_Lock();
  return 0;
}
