#ifndef STORAGE_H
#define STORAGE_H

#include <stdint.h>

#define LP_N_PROFILES 4
#define LP_N_KEYS 9
#define LP_N_LIGHT_MODES 11 /* Off, Solid, React, then 8 shows */
#define LP_MAX_ACTIONS 16
#define LP_NAME_LEN 12
#define LP_LABEL_LEN 6
#define LP_TEXT_POOL 1200
#define LP_TEXT_MAX 240
#define LP_TEXT_SLOTS (LP_N_PROFILES * LP_N_KEYS)

enum {
  ACT_NONE = 0,
  ACT_KEY = 1,
  ACT_DELAY = 2,
  ACT_MOUSE_BTN = 3,
  ACT_MOUSE_MOVE = 4,
  ACT_WHEEL = 5,
  ACT_CONSUMER = 6,
  ACT_RELEASE = 7
};

enum { SEND_TAP = 0, SEND_DOWN = 1, SEND_UP = 2 };

typedef struct __attribute__((packed)) {
  uint8_t type;
  uint8_t mods;  /* keyboard modifiers, or mouse buttons, or send mode */
  uint16_t code; /* HID usage, delay ms, or packed dx/dy */
} lp_action_t;

typedef struct __attribute__((packed)) {
  char label[LP_LABEL_LEN + 1];
  uint8_t led;
  uint8_t n;
  lp_action_t acts[LP_MAX_ACTIONS];
} lp_key_t;

typedef struct __attribute__((packed)) {
  char name[LP_NAME_LEN + 1];
  uint8_t light_mode;
  uint8_t bright;
  uint8_t dim;
  uint8_t _pad;
  lp_key_t keys[LP_N_KEYS];
} lp_profile_t;

typedef struct __attribute__((packed)) {
  uint16_t off;
  uint8_t len;
} lp_text_ref_t;

typedef struct __attribute__((packed)) {
  uint32_t magic;
  uint16_t crc;
  uint8_t active;
  uint8_t contrast;
  uint8_t flip;
  uint8_t sleep;
  uint8_t menu_idle;
  uint8_t dirty;
  uint8_t n_profiles; /* 0 = legacy (all 4); else 1..LP_N_PROFILES */
  uint8_t _pad;
  lp_profile_t profiles[LP_N_PROFILES];
  lp_text_ref_t texts[LP_TEXT_SLOTS];
  uint16_t pool_n;
  char pool[LP_TEXT_POOL];
} lp_store_t;

extern lp_store_t g_store;

void storage_init(void);
void storage_factory(void);
int storage_save(void);
void storage_reload(void);
lp_profile_t *storage_active(void);
uint8_t storage_n_profiles(void);
int storage_add_profile(void);
int storage_del_profile(uint8_t idx);
int storage_set_text(uint8_t profile, uint8_t key, const uint8_t *data, uint8_t len);
const uint8_t *storage_text(uint8_t profile, uint8_t key, uint8_t *len);
uint16_t storage_pool_used(void);

#endif
