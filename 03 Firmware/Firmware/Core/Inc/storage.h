#ifndef STORAGE_H
#define STORAGE_H

#include <stdint.h>

#define LP_N_PROFILES 4
#define LP_N_KEYS 9
#define LP_MAX_ACTIONS 16
#define LP_NAME_LEN 12
#define LP_LABEL_LEN 6

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
  uint32_t magic;
  uint16_t crc;
  uint8_t active;
  uint8_t contrast;
  uint8_t flip;
  uint8_t sleep;
  uint8_t menu_idle;
  uint8_t dirty;
  uint8_t _pad[2];
  lp_profile_t profiles[LP_N_PROFILES];
} lp_store_t;

extern lp_store_t g_store;

void storage_init(void);
void storage_factory(void);
int storage_save(void);
void storage_reload(void);
lp_profile_t *storage_active(void);

#endif
