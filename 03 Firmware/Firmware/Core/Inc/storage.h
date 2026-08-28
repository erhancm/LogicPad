#ifndef STORAGE_H
#define STORAGE_H

#include <stdint.h>
#include <stddef.h>

#define LP_N_KEYS 9
#define LP_N_PROFILES 255 /* index cap (uint8); flash bytes are the real limit */
#define LP_N_LIGHT_MODES 15 /* Off, Solid, React, 8 shows, Full White/Red/Green/Blue */
#define LP_MAX_ACTIONS 12
#define LP_NAME_LEN 12
#define LP_LABEL_LEN 6
#define LP_TITLE_LEN 12
/* label + led + n + acts — GET_KEY / SET_KEY copy. title follows and is not in that blob. */
#define LP_KEY_HID_BYTES (LP_LABEL_LEN + 1 + 1 + 1 + (LP_MAX_ACTIONS * 4))
#define LP_TEXT_MAX 240
#define LP_STORE_PAGES 4
#define LP_STORE_BYTES (LP_STORE_PAGES * 1024u)
/* Two clock snaps (10 B) after the packed blob. */
#define LP_STORE_CAP (LP_STORE_BYTES - 20u)
/* Fallback for old firmware / docs; live max is storage_pool_max(). */
#define LP_TEXT_POOL 1200

enum {
  ACT_NONE = 0,
  ACT_KEY = 1,
  ACT_DELAY = 2,
  ACT_MOUSE_BTN = 3,
  ACT_MOUSE_MOVE = 4,
  ACT_WHEEL = 5,
  ACT_CONSUMER = 6,
  ACT_RELEASE = 7,
  ACT_TEXT = 8
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
  char title[LP_TITLE_LEN + 1];
} lp_key_t;

typedef struct __attribute__((packed)) {
  char name[LP_NAME_LEN + 1];
  uint8_t light_mode;
  uint8_t bright;
  uint8_t dim;
  uint8_t _pad;
  lp_key_t keys[LP_N_KEYS];
} lp_profile_t;

/* RAM header only. Profiles live packed in the store blob. */
typedef struct {
  uint8_t active;
  uint8_t contrast;
  uint8_t flip;
  uint8_t sleep;
  uint8_t menu_idle;
  uint8_t clock_style; /* packed: anim (0-6), speed (0-3), bar on/off */
  uint8_t dirty;
  uint8_t n_profiles;
} lp_store_t;

extern lp_store_t g_store;

void storage_init(void);
void storage_factory(void);
int storage_save(void);
void storage_reload(void);
lp_profile_t *storage_active(void);
int storage_commit(void);
uint8_t storage_n_profiles(void);
int storage_can_add_profile(void);
int storage_add_profile(void);
int storage_del_profile(uint8_t idx);
void storage_set_active(uint8_t idx);
void storage_profile_name(uint8_t idx, char *out, size_t n);
int storage_set_profile_name(uint8_t idx, const char *name);
int storage_set_profile_hdr(uint8_t idx, const char *name, uint8_t mode, uint8_t bright,
                            uint8_t dim);
int storage_get_profile_hdr(uint8_t idx, lp_profile_t *out);
int storage_get_key(uint8_t profile, uint8_t key, lp_key_t *out);
int storage_set_key(uint8_t profile, uint8_t key, const lp_key_t *in);
int storage_set_key_title_at(uint8_t profile, uint8_t key, const char *title);
int storage_reset_profile_keys(uint8_t idx);
int storage_set_text(uint8_t profile, uint8_t key, const uint8_t *data, uint8_t len);
const uint8_t *storage_text(uint8_t profile, uint8_t key, uint8_t *len);
uint16_t storage_pool_used(void);
uint16_t storage_pool_max(void);
uint16_t storage_used(void);
uint16_t storage_cap(void);
void storage_fill_label(char *label, const char *title);
void storage_set_key_title(lp_key_t *k, const char *title);
const char *storage_key_title(const lp_key_t *k);

/* Clock snapshots live in the unused tail of the active store slot (not in
 * the packed blob, so old saves stay valid). force=1 may use the last slot. */
int storage_clock_load(uint16_t *year, uint8_t *month, uint8_t *day, uint8_t *hour,
                       uint8_t *min, uint8_t *sec);
int storage_clock_store(uint16_t year, uint8_t month, uint8_t day, uint8_t hour,
                        uint8_t min, uint8_t sec, int force);

#endif
