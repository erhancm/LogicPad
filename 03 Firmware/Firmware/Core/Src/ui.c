#include "ui.h"
#include "ssd1306.h"
#include "keypad.h"
#include "storage.h"
#include "hid_reports.h"
#include "macro.h"
#include "led_mux.h"
#include "clock.h"
#include <stdio.h>
#include <stddef.h>
#include <string.h>

typedef enum {
  SCR_BOOT,
  SCR_HOME,
  SCR_TOAST,
  SCR_MENU,
  SCR_PROF_LIST,
  SCR_PROF_ACTS,
  SCR_PROF_NAME,
  SCR_PROF_RESET,
  SCR_PROF_DEL,
  SCR_KEY_PICK,
  SCR_KEY_EDIT,
  SCR_KEY_NAME,
  SCR_KEY_LIGHT,
  SCR_MACRO,
  SCR_ADD_KIND,
  SCR_ADD_LETTER,
  SCR_ADD_SEND,
  SCR_ADD_SYS,
  SCR_ADD_MOUSE,
  SCR_ADD_WAIT,
  SCR_SETUP,
  SCR_LIGHTS,
  SCR_LMODE,
  SCR_LBRIGHT,
  SCR_LDIM,
  SCR_SCREEN,
  SCR_CONTRAST,
  SCR_FLIP,
  SCR_SLEEP,
  SCR_ABOUT,
  SCR_SAVED,
  SCR_RESET_ALL,
  SCR_SLEEPING,
  SCR_SAVE_PROMPT
} screen_t;

static screen_t scr;
static screen_t back_of_prompt;
static int16_t i;
static uint8_t edit_key;
static uint8_t edit_prof;
static uint16_t t_ms;
static uint32_t idle_ms;
static uint32_t live_idle;
static uint8_t need_draw = 1;
static uint8_t toast_key;
static char name_buf[13];

static uint16_t clk_year = 2026;
static uint8_t clk_mon = 8;
static uint8_t clk_day = 16;
static uint8_t clk_hour;
static uint8_t clk_min;
static uint8_t clk_sec;
static uint16_t clk_ms;
static uint8_t host_active = 1;
static uint8_t last_usb_cfg = 0xFF;

static const char *const MONS[] = {"Jan", "Feb", "Mar", "Apr", "May", "Jun",
                                   "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"};

static const char *const COLORS[] = {"Off", "White", "Red", "Green", "Blue"};
static const char *const MODES[] = {
    "Off",        "Solid",     "React",      "Breathe",   "Wave",      "Ring",
    "Ripple",     "Rain",      "Heart",      "Cross",     "Twinkle",   "Full White",
    "Full Red",   "Full Green", "Full Blue"};
_Static_assert((sizeof(MODES) / sizeof(MODES[0])) == LP_N_LIGHT_MODES, "mode names");
static const char *const SLEEP_L[] = {"Never", "15s", "30s", "1m", "5m"};
static const uint32_t SLEEP_MS[] = {0, 15000, 30000, 60000, 300000};
static const uint32_t IDLE_MS[] = {15000, 30000, 60000};

typedef struct {
  const char *name;
  uint8_t hid;
  uint8_t mods;
} sys_key_t;

/* Standalone taps. Win/Alt/Ctrl/Shift live in the modifier byte (hid 0). */
static const sys_key_t SYS_KEYS[] = {
    {"Tab", 0x2B, 0}, {"Win", 0, 8},     {"Alt", 0, 4},    {"Ctrl", 0, 1},
    {"Shift", 0, 2},  {"Esc", 0x29, 0},  {"Enter", 0x28, 0}, {"Space", 0x2C, 0},
    {"Bksp", 0x2A, 0},
};
#define N_SYS_KEYS ((uint8_t)(sizeof(SYS_KEYS) / sizeof(SYS_KEYS[0])))

/* Dual-color 0.96" panel (yellow glass fixed at physical bottom):
 * blue content y=0..47, yellow status y=48..63. */
#define UI_BLUE_H 48
#define UI_YELLOW_Y 48
#define UI_YELLOW_H 16
#define UI_ROW_H 16

static int16_t clampi(int16_t v, int16_t lo, int16_t hi) {
  if (v < lo) {
    return lo;
  }
  if (v > hi) {
    return hi;
  }
  return v;
}

static lp_profile_t *ap(void) {
  return storage_active();
}

static const char *or_dash(const char *s) {
  return (s && s[0]) ? s : "--";
}

static void set_hw_contrast(uint8_t level) {
  uint8_t c = (uint8_t)(level * 25);
  if (c == 0) {
    c = 1;
  }
  ssd1306_SetContrast(c);
}

static void dirty(void) {
  if (storage_commit() != 0) {
    need_draw = 1;
    return;
  }
  g_store.dirty = 1;
  need_draw = 1;
}

static void go(screen_t s) {
  if (scr == SCR_CONTRAST && s != SCR_CONTRAST) {
    set_hw_contrast(g_store.contrast);
  }
  scr = s;
  i = 0;
  t_ms = 0;
  idle_ms = 0;
  need_draw = 1;
}

static void header(const char *title) {
  /* Yellow band at bottom — titles / status only. */
  ssd1306_FillRect(0, UI_YELLOW_Y, 128, UI_YELLOW_H, White);
  ssd1306_SetCursor(2, (uint8_t)(UI_YELLOW_Y + 4));
  ssd1306_WriteString(title, Font_6x8, Black);
  if (g_store.dirty) {
    ssd1306_SetCursor(104, (uint8_t)(UI_YELLOW_Y + 4));
    ssd1306_WriteString("*", Font_6x8, Black);
  }
  if (hid_configured()) {
    uint8_t on = 1;
    if (hid_vendor_session()) {
      on = (HAL_GetTick() / 400) & 1;
    }
    if (on) {
      ssd1306_FillRect(118, (uint8_t)(UI_YELLOW_Y + 5), 6, 6, Black);
    }
  }
}

static void header_hint(const char *title, const char *hint) {
  header(title);
  if (hint && hint[0]) {
    uint8_t n = (uint8_t)strlen(hint);
    uint8_t x = (uint8_t)(128 - 14 - n * 6);
    if (x < 40) {
      x = 40;
    }
    ssd1306_SetCursor(x, (uint8_t)(UI_YELLOW_Y + 4));
    ssd1306_WriteString(hint, Font_6x8, Black);
  }
}

static void footer(const char *s) {
  /* Extra hint line sits just above the yellow band in blue. */
  ssd1306_SetCursor(0, 40);
  ssd1306_WriteString(s, Font_6x8, White);
}

static void text2x_center_c(uint8_t y, const char *s, SSD1306_COLOR color) {
  uint8_t n = (uint8_t)strlen(s);
  uint8_t w = (uint8_t)(n * 12);
  uint8_t x = n ? (uint8_t)((128 - w) / 2) : 0;
  ssd1306_SetCursor(x, y);
  ssd1306_WriteString2x(s, color);
}

static void text2x_center(uint8_t y, const char *s) {
  text2x_center_c(y, s, White);
}

/* 12×16 glyphs: 10 columns on 128px. Split longer names onto two lines. */
#define TITLE_2X_COLS 10

static void split_title_2x(const char *s, char a[TITLE_2X_COLS + 1], char b[TITLE_2X_COLS + 1]) {
  size_t n = strlen(s);
  int sp = -1;
  size_t i;
  memset(a, 0, TITLE_2X_COLS + 1);
  memset(b, 0, TITLE_2X_COLS + 1);
  if (n <= TITLE_2X_COLS) {
    memcpy(a, s, n);
    return;
  }
  for (i = 1; i < n && i <= TITLE_2X_COLS; i++) {
    if (s[i] == ' ') {
      sp = (int)i;
    }
  }
  if (sp > 0) {
    size_t left = (size_t)sp;
    size_t right;
    if (left > TITLE_2X_COLS) {
      left = TITLE_2X_COLS;
    }
    memcpy(a, s, left);
    right = n - (size_t)sp - 1;
    if (right > TITLE_2X_COLS) {
      right = TITLE_2X_COLS;
    }
    memcpy(b, s + sp + 1, right);
    return;
  }
  {
    size_t left = n / 2;
    size_t right;
    if (left > TITLE_2X_COLS) {
      left = TITLE_2X_COLS;
    }
    memcpy(a, s, left);
    right = n - left;
    if (right > TITLE_2X_COLS) {
      right = TITLE_2X_COLS;
    }
    memcpy(b, s + left, right);
  }
}

static void text2x_title(const char *s, SSD1306_COLOR color) {
  char a[TITLE_2X_COLS + 1];
  char b[TITLE_2X_COLS + 1];
  split_title_2x(s, a, b);
  if (!b[0]) {
    text2x_center_c(16, a, color);
    return;
  }
  text2x_center_c(8, a, color);
  text2x_center_c(24, b, color);
}

static uint8_t month_days(uint16_t y, uint8_t m) {
  static const uint8_t d[] = {31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31};
  if (m == 2 && ((y % 4u) == 0 && ((y % 100u) != 0 || (y % 400u) == 0))) {
    return 29;
  }
  if (m < 1 || m > 12) {
    return 31;
  }
  return d[m - 1];
}

static void clock_advance_sec(void) {
  if (++clk_sec < 60) {
    return;
  }
  clk_sec = 0;
  if (++clk_min < 60) {
    return;
  }
  clk_min = 0;
  if (++clk_hour < 24) {
    return;
  }
  clk_hour = 0;
  if (++clk_day <= month_days(clk_year, clk_mon)) {
    return;
  }
  clk_day = 1;
  if (++clk_mon <= 12) {
    return;
  }
  clk_mon = 1;
  clk_year++;
}

void ui_set_clock(uint16_t year, uint8_t month, uint8_t day, uint8_t hour, uint8_t min, uint8_t sec) {
  if (year < 2000) {
    year = 2000;
  }
  if (month < 1 || month > 12) {
    month = 1;
  }
  uint8_t md = month_days(year, month);
  if (day < 1 || day > md) {
    day = 1;
  }
  if (hour > 23) {
    hour = 0;
  }
  if (min > 59) {
    min = 0;
  }
  if (sec > 59) {
    sec = 0;
  }
  clk_year = year;
  clk_mon = month;
  clk_day = day;
  clk_hour = hour;
  clk_min = min;
  clk_sec = sec;
  clk_ms = 0;
  clock_set(year, month, day, hour, min, sec);
  need_draw = 1;
}

void ui_set_host_active(int on) {
  uint8_t v = on ? 1 : 0;
  if (host_active != v) {
    host_active = v;
    need_draw = 1;
  }
}

static int idle_shows_clock(void) {
  return !hid_configured() || !host_active;
}

static void draw_idle_clock(void) {
  char t[12];
  char d[16];
  snprintf(t, sizeof(t), "%02u:%02u:%02u", clk_hour, clk_min, clk_sec);
  snprintf(d, sizeof(d), "%u %s %u", clk_day, MONS[clk_mon - 1], clk_year);
  text2x_center(8, t);
  {
    uint8_t n = (uint8_t)strlen(d);
    ssd1306_SetCursor((uint8_t)((128 - n * 6) / 2), 32);
    ssd1306_WriteString(d, Font_6x8, White);
  }
  /* Yellow band: seconds bar + bouncing block */
  ssd1306_FillRect(0, UI_YELLOW_Y, 128, UI_YELLOW_H, Black);
  {
    uint8_t bar = (uint8_t)((clk_sec * 128u) / 60u);
    if (bar) {
      ssd1306_FillRect(0, UI_YELLOW_Y, bar, 2, White);
    }
  }
  {
    uint16_t phase = (uint16_t)((HAL_GetTick() / 16u) % 240u);
    uint8_t span = 120;
    uint8_t x = (uint8_t)(phase < span ? phase : (uint16_t)(span * 2u - phase));
    ssd1306_FillRect(x, (uint8_t)(UI_YELLOW_Y + 5), 8, 8, White);
  }
}

static void draw_idle_home(void) {
  if (idle_shows_clock()) {
    draw_idle_clock();
    return;
  }
  {
    lp_profile_t *p = ap();
    const char *name = (p && p->name[0]) ? p->name : "--";
    text2x_title(name, White);
    header("HOME");
  }
}

static void big_menu(const char *const *items, uint8_t n, int16_t sel) {
  int16_t start = 0;
  if (n > 3) {
    if (sel <= 0) {
      start = 0;
    } else if (sel >= n - 1) {
      start = (int16_t)(n - 3);
    } else {
      start = (int16_t)(sel - 1);
    }
  }
  for (uint8_t r = 0; r < 3 && (start + r) < n; r++) {
    uint8_t idx = (uint8_t)(start + r);
    uint8_t y = (uint8_t)(r * UI_ROW_H);
    uint8_t hi = (idx == sel);
    if (hi) {
      ssd1306_FillRect(0, y, 128, UI_ROW_H, White);
    }
    ssd1306_SetCursor(2, y);
    ssd1306_WriteString2x(items[idx], hi ? Black : White);
  }
}

static void big_menu_profiles(uint8_t nprof, int add, int16_t sel) {
  uint8_t total = (uint8_t)(nprof + (add ? 1 : 0));
  int16_t start = 0;
  uint8_t r;
  if (total > 3) {
    if (sel <= 0) {
      start = 0;
    } else if (sel >= total - 1) {
      start = (int16_t)(total - 3);
    } else {
      start = (int16_t)(sel - 1);
    }
  }
  for (r = 0; r < 3 && (start + r) < total; r++) {
    uint8_t idx = (uint8_t)(start + r);
    uint8_t y = (uint8_t)(r * UI_ROW_H);
    uint8_t hi = (idx == sel);
    char line[16];
    if (hi) {
      ssd1306_FillRect(0, y, 128, UI_ROW_H, White);
    }
    if (idx == nprof) {
      snprintf(line, sizeof(line), "+ New");
    } else {
      char name[LP_NAME_LEN + 1];
      storage_profile_name(idx, name, sizeof(name));
      snprintf(line, sizeof(line), "%s%s", name[0] ? name : "--", g_store.active == idx ? "*" : "");
    }
    ssd1306_SetCursor(2, y);
    ssd1306_WriteString2x(line, hi ? Black : White);
  }
}

static void value_screen(const char *title, const char *val) {
  header_hint(title, "U/D");
  text2x_center(16, val);
}

static void confirm_screen(const char *msg) {
  header("CONFIRM");
  ssd1306_FillRect(4, 4, 120, 40, White);
  ssd1306_SetCursor(10, 12);
  ssd1306_WriteString(msg, Font_6x8, Black);
  ssd1306_SetCursor(10, 28);
  ssd1306_WriteString("OK yes   SEL no", Font_6x8, Black);
}

static uint8_t list_max(void) {
  switch (scr) {
  case SCR_MENU:
  case SCR_KEY_EDIT:
  case SCR_ADD_SEND:
  case SCR_ADD_MOUSE:
  case SCR_SETUP:
  case SCR_LIGHTS:
  case SCR_SCREEN:
  case SCR_ABOUT:
    return 2;
  case SCR_ADD_KIND:
    return 4;
  case SCR_ADD_SYS:
    return (uint8_t)(N_SYS_KEYS - 1);
  case SCR_PROF_ACTS:
    return storage_n_profiles() > 1 ? 3 : 2;
  case SCR_PROF_LIST: {
    uint8_t n = storage_n_profiles();
    if (storage_can_add_profile()) {
      return n;
    }
    return (uint8_t)(n - 1);
  }
  case SCR_KEY_LIGHT:
    return 4;
  case SCR_MACRO:
    return (uint8_t)(ap()->keys[edit_key].n); /* + Add as last */
  case SCR_ADD_LETTER:
    return 25;
  case SCR_ADD_WAIT:
    return 20;
  case SCR_LMODE:
    return LP_N_LIGHT_MODES - 1;
  case SCR_LBRIGHT:
  case SCR_LDIM:
  case SCR_CONTRAST:
    return 10;
  case SCR_FLIP:
    return 1;
  case SCR_SLEEP:
    return 4;
  default:
    return 0;
  }
}

static int is_value(void) {
  switch (scr) {
  case SCR_KEY_LIGHT:
  case SCR_ADD_LETTER:
  case SCR_ADD_WAIT:
  case SCR_LMODE:
  case SCR_LBRIGHT:
  case SCR_LDIM:
  case SCR_CONTRAST:
  case SCR_FLIP:
  case SCR_SLEEP:
  case SCR_PROF_NAME:
  case SCR_KEY_NAME:
    return 1;
  default:
    return 0;
  }
}

static int is_live(void) {
  return scr == SCR_HOME || scr == SCR_TOAST || scr == SCR_BOOT;
}

int ui_is_live(void) {
  return is_live() && scr != SCR_BOOT;
}

int ui_is_sleeping(void) {
  return scr == SCR_SLEEPING;
}

void ui_wake(void) {
  ssd1306_DisplayOn(1);
  go(SCR_HOME);
}

void ui_mark_dirty(void) {
  need_draw = 1;
}

static void apply_screen_hw(void) {
  set_hw_contrast(g_store.contrast);
  ssd1306_SetFlip(g_store.flip);
}

static void back(void);

static void go_home_clean(void) {
  if (g_store.dirty && scr != SCR_SAVE_PROMPT && !is_live()) {
    back_of_prompt = SCR_HOME;
    go(SCR_SAVE_PROMPT);
    return;
  }
  go(SCR_HOME);
}

static void back(void) {
  switch (scr) {
  case SCR_TOAST:
  case SCR_MENU:
    go(SCR_HOME);
    break;
  case SCR_PROF_LIST:
  case SCR_KEY_PICK:
  case SCR_SETUP:
    go(SCR_MENU);
    break;
  case SCR_PROF_ACTS:
    go(SCR_PROF_LIST);
    break;
  case SCR_PROF_NAME:
  case SCR_PROF_RESET:
  case SCR_PROF_DEL:
    go(SCR_PROF_ACTS);
    break;
  case SCR_KEY_EDIT:
    go(SCR_KEY_PICK);
    break;
  case SCR_KEY_NAME:
  case SCR_KEY_LIGHT:
  case SCR_MACRO:
    go(SCR_KEY_EDIT);
    break;
  case SCR_ADD_KIND:
    go(SCR_MACRO);
    break;
  case SCR_ADD_LETTER:
  case SCR_ADD_SYS:
  case SCR_ADD_MOUSE:
  case SCR_ADD_WAIT:
    go(SCR_ADD_KIND);
    break;
  case SCR_ADD_SEND:
    go(SCR_ADD_LETTER);
    break;
  case SCR_LIGHTS:
  case SCR_SCREEN:
  case SCR_ABOUT:
    go(SCR_SETUP);
    break;
  case SCR_LMODE:
  case SCR_LBRIGHT:
  case SCR_LDIM:
    go(SCR_LIGHTS);
    break;
  case SCR_CONTRAST:
  case SCR_FLIP:
  case SCR_SLEEP:
    go(SCR_SCREEN);
    break;
  case SCR_SAVED:
  case SCR_RESET_ALL:
    go(SCR_ABOUT);
    break;
  case SCR_SAVE_PROMPT:
    go(back_of_prompt);
    break;
  default:
    go(SCR_HOME);
    break;
  }
}

static void commit_value(void) {
  lp_profile_t *p = ap();
  switch (scr) {
  case SCR_KEY_LIGHT:
    p->keys[edit_key].led = (uint8_t)i;
    dirty();
    back();
    break;
  case SCR_ADD_WAIT: {
    lp_key_t *k = &p->keys[edit_key];
    if (k->n < LP_MAX_ACTIONS) {
      k->acts[k->n++] = (lp_action_t){.type = ACT_DELAY, .mods = 0, .code = (uint16_t)(i * 10)};
      dirty();
    }
    go(SCR_MACRO);
    break;
  }
  case SCR_LMODE:
    p->light_mode = (uint8_t)i;
    dirty();
    back();
    break;
  case SCR_LBRIGHT:
    p->bright = (uint8_t)i;
    dirty();
    back();
    break;
  case SCR_LDIM:
    p->dim = (uint8_t)i;
    dirty();
    back();
    break;
  case SCR_CONTRAST:
    g_store.contrast = (uint8_t)i;
    apply_screen_hw();
    dirty();
    back();
    break;
  case SCR_FLIP:
    g_store.flip = (uint8_t)i;
    apply_screen_hw();
    dirty();
    back();
    break;
  case SCR_SLEEP:
    g_store.sleep = (uint8_t)i;
    dirty();
    back();
    break;
  case SCR_PROF_NAME:
    storage_set_profile_name(edit_prof, name_buf);
    dirty();
    go(SCR_PROF_ACTS);
    break;
  case SCR_KEY_NAME:
    storage_set_key_title(&p->keys[edit_key], name_buf);
    dirty();
    go(SCR_KEY_EDIT);
    break;
  default:
    back();
    break;
  }
}

static void ok(void) {
  lp_profile_t *p = ap();
  if (scr == SCR_BOOT) {
    go(SCR_HOME);
    return;
  }
  if (scr == SCR_PROF_RESET) {
    storage_reset_profile_keys(edit_prof);
    dirty();
    go(SCR_HOME);
    return;
  }
  if (scr == SCR_PROF_DEL) {
    if (storage_del_profile(edit_prof) == 0) {
      dirty();
    }
    go(SCR_PROF_LIST);
    {
      uint8_t n = storage_n_profiles();
      i = (int16_t)((edit_prof < n) ? edit_prof : (uint8_t)(n - 1));
    }
    return;
  }
  if (scr == SCR_RESET_ALL) {
    storage_factory();
    storage_save();
    go(SCR_HOME);
    return;
  }
  if (scr == SCR_SAVED) {
    go(SCR_ABOUT);
    return;
  }
  if (scr == SCR_SAVE_PROMPT) {
    storage_save();
    go(back_of_prompt == SCR_HOME ? SCR_HOME : SCR_HOME);
    return;
  }
  if (is_value() && scr != SCR_ADD_LETTER) {
    commit_value();
    return;
  }
  if (scr == SCR_ADD_LETTER) {
    go(SCR_ADD_SEND);
    return;
  }
  if (scr == SCR_PROF_LIST) {
    uint8_t n = storage_n_profiles();
    if ((uint8_t)i == n && storage_can_add_profile()) {
      int idx = storage_add_profile();
      if (idx >= 0) {
        edit_prof = (uint8_t)idx;
        dirty();
        storage_profile_name(edit_prof, name_buf, sizeof(name_buf));
        name_buf[sizeof(name_buf) - 1] = 0;
        go(SCR_PROF_NAME);
      }
      return;
    }
    edit_prof = (uint8_t)i;
    go(SCR_PROF_ACTS);
    return;
  }
  if (scr == SCR_PROF_ACTS) {
    if (i == 0) {
      storage_set_active(edit_prof);
      dirty();
      go(SCR_HOME);
    } else if (i == 1) {
      storage_profile_name(edit_prof, name_buf, sizeof(name_buf));
      name_buf[sizeof(name_buf) - 1] = 0;
      i = 0;
      go(SCR_PROF_NAME);
    } else if (i == 2) {
      go(SCR_PROF_RESET);
    } else {
      go(SCR_PROF_DEL);
    }
    return;
  }
  if (scr == SCR_KEY_EDIT) {
    if (i == 0) {
      strncpy(name_buf, storage_key_title(&p->keys[edit_key]), sizeof(name_buf));
      name_buf[sizeof(name_buf) - 1] = 0;
      go(SCR_KEY_NAME);
    } else if (i == 1) {
      i = p->keys[edit_key].led;
      go(SCR_KEY_LIGHT);
      i = p->keys[edit_key].led;
    } else {
      go(SCR_MACRO);
    }
    return;
  }
  if (scr == SCR_MACRO) {
    go(SCR_ADD_KIND);
    return;
  }
  if (scr == SCR_ADD_KIND) {
    if (i == 0) {
      go(SCR_ADD_LETTER);
    } else if (i == 1) {
      go(SCR_ADD_SYS);
    } else if (i == 2) {
      go(SCR_ADD_MOUSE);
    } else if (i == 3) {
      i = 5;
      go(SCR_ADD_WAIT);
      i = 5;
    } else {
      lp_key_t *k = &p->keys[edit_key];
      if (k->n < LP_MAX_ACTIONS) {
        k->acts[k->n++] = (lp_action_t){.type = ACT_TEXT, .mods = 0, .code = 0};
        dirty();
      }
      go(SCR_MACRO);
    }
    return;
  }
  if (scr == SCR_ADD_SYS) {
    lp_key_t *k = &p->keys[edit_key];
    if (k->n < LP_MAX_ACTIONS) {
      uint8_t idx = (uint8_t)clampi(i, 0, (int16_t)(N_SYS_KEYS - 1));
      k->acts[k->n++] = (lp_action_t){
          .type = ACT_KEY, .mods = SYS_KEYS[idx].mods, .code = SYS_KEYS[idx].hid};
      dirty();
    }
    go(SCR_MACRO);
    return;
  }
  if (scr == SCR_ADD_SEND) {
    lp_key_t *k = &p->keys[edit_key];
    if (k->n < LP_MAX_ACTIONS) {
      uint8_t hid = (uint8_t)(toast_key + 4);
      uint8_t send = (uint8_t)i;
      k->acts[k->n++] =
          (lp_action_t){.type = ACT_KEY, .mods = 0, .code = (uint16_t)hid | ((uint16_t)send << 8)};
      dirty();
    }
    go(SCR_MACRO);
    return;
  }
  if (scr == SCR_ADD_MOUSE) {
    lp_key_t *k = &p->keys[edit_key];
    if (k->n < LP_MAX_ACTIONS) {
      if (i == 0) {
        k->acts[k->n++] = (lp_action_t){.type = ACT_MOUSE_BTN, .mods = 1, .code = (uint16_t)SEND_TAP << 8};
      } else if (i == 1) {
        k->acts[k->n++] = (lp_action_t){.type = ACT_MOUSE_MOVE, .mods = 0, .code = 10};
      } else {
        k->acts[k->n++] = (lp_action_t){.type = ACT_WHEEL, .mods = 0, .code = (uint16_t)(int16_t)-1};
      }
      dirty();
    }
    go(SCR_MACRO);
    return;
  }

  const screen_t enter_menu[] = {SCR_PROF_LIST, SCR_KEY_PICK, SCR_SETUP};
  const screen_t enter_setup[] = {SCR_LIGHTS, SCR_SCREEN, SCR_ABOUT};
  const screen_t enter_lights[] = {SCR_LMODE, SCR_LBRIGHT, SCR_LDIM};
  const screen_t enter_screen[] = {SCR_CONTRAST, SCR_FLIP, SCR_SLEEP};
  if (scr == SCR_MENU) {
    go(enter_menu[i]);
    if (enter_menu[i] == SCR_PROF_LIST) {
      i = g_store.active;
      {
        uint8_t n = storage_n_profiles();
        if (i >= n && n) {
          i = (int16_t)(n - 1);
        }
      }
    }
    return;
  }
  if (scr == SCR_SETUP) {
    go(enter_setup[i]);
    return;
  }
  if (scr == SCR_LIGHTS) {
    if (i == 0) {
      i = p->light_mode;
      go(SCR_LMODE);
      i = p->light_mode;
    } else if (i == 1) {
      i = p->bright;
      go(SCR_LBRIGHT);
      i = p->bright;
    } else {
      i = p->dim;
      go(SCR_LDIM);
      i = p->dim;
    }
    return;
  }
  if (scr == SCR_SCREEN) {
    if (i == 0) {
      i = g_store.contrast;
      go(SCR_CONTRAST);
      i = g_store.contrast;
    } else if (i == 1) {
      i = g_store.flip;
      go(SCR_FLIP);
      i = g_store.flip;
    } else {
      i = g_store.sleep;
      go(SCR_SLEEP);
      i = g_store.sleep;
    }
    return;
  }
  if (scr == SCR_ABOUT) {
    if (i == 1) {
      storage_save();
      go(SCR_SAVED);
    } else if (i == 2) {
      go(SCR_RESET_ALL);
    }
    return;
  }
  (void)enter_lights;
  (void)enter_screen;
}

static void nav(int dir) {
  /* dir: -1 up/left, +1 down/right. Lists do not wrap. */
  if (scr == SCR_PROF_NAME || scr == SCR_KEY_NAME) {
    size_t n = strlen(name_buf);
    if (n == 0) {
      name_buf[0] = 'A';
      name_buf[1] = 0;
      n = 1;
    }
    char *ch = &name_buf[n - 1];
    *ch = (char)(*ch + dir);
    if (*ch < 'A') {
      *ch = '9';
    }
    if (*ch > 'Z' && *ch < 'a') {
      *ch = dir > 0 ? 'a' : 'Z';
    }
    if (*ch > 'z') {
      *ch = '0';
    }
    if (*ch < '0' && *ch > ' ') {
      *ch = 'A';
    }
    need_draw = 1;
    dirty();
    return;
  }
  i = clampi((int16_t)(i + dir), 0, list_max());
  if (scr == SCR_LMODE) {
    ap()->light_mode = (uint8_t)i;
    dirty();
  }
  if (scr == SCR_CONTRAST) {
    set_hw_contrast((uint8_t)i);
  }
  need_draw = 1;
}

static void on_event(keypad_event_t e) {
  if (e.type == KP_DOWN && e.key < 9) {
    led_mux_key_flash(e.key);
  } else if (e.type == KP_SEL_SHORT || e.type == KP_SEL_LONG) {
    led_mux_key_flash(LED_SEL);
  }
  if (scr == SCR_BOOT) {
    go(SCR_HOME);
    return;
  }
  if (scr == SCR_SLEEPING) {
    ui_wake();
    if (!(e.type == KP_DOWN && e.key < 9)) {
      return;
    }
  }
  if (scr == SCR_SAVE_PROMPT) {
    if (e.type == KP_DOWN && e.key == 4) {
      storage_save();
      go(SCR_HOME);
    } else if (e.type == KP_SEL_SHORT) {
      g_store.dirty = 0;
      go(SCR_HOME);
    }
    return;
  }

  if (is_live()) {
    if (e.type == KP_SEL_SHORT) {
      go(SCR_MENU);
      return;
    }
    if (e.type == KP_SEL_LONG) {
      go(SCR_HOME);
      return;
    }
    if (e.type == KP_DOWN && e.key < 9) {
      hid_notify_key(g_store.active, e.key, 1);
      toast_key = e.key;
      macro_play(e.key);
      go(SCR_TOAST);
      t_ms = 0;
    }
    return;
  }

  if (scr == SCR_KEY_PICK && e.type == KP_DOWN && e.key < 9) {
    edit_key = e.key;
    go(SCR_KEY_EDIT);
    dirty();
    return;
  }

  if (e.type == KP_SEL_LONG) {
    go_home_clean();
    return;
  }
  if (e.type == KP_SEL_SHORT) {
    back();
    return;
  }
  if (e.type == KP_DOWN && e.key == 4) {
    ok();
    return;
  }
  if (e.type == KP_DOWN || e.type == KP_REPEAT) {
    /* D-pad: 1 up, 7 down, 3 left, 5 right. Center 4 is OK. */
    if (e.key == 1 || e.key == 3) {
      nav(-1);
    }
    if (e.key == 7 || e.key == 5) {
      nav(1);
    }
    if (scr == SCR_MACRO && e.key == 2 && e.type == KP_DOWN) {
      go(SCR_ADD_KIND);
    }
    if (scr == SCR_MACRO && e.key == 8 && e.type == KP_DOWN) {
      lp_key_t *k = &ap()->keys[edit_key];
      if (k->n && i < k->n) {
        memmove(&k->acts[i], &k->acts[i + 1], (k->n - i - 1) * sizeof(lp_action_t));
        k->n--;
        dirty();
      }
    }
  }
}

static void fmt_act(const lp_action_t *a, char *buf, size_t n) {
  uint8_t hid = (uint8_t)a->code;
  switch (a->type) {
  case ACT_DELAY:
    snprintf(buf, n, "Wait %ums", a->code);
    break;
  case ACT_CONSUMER:
    snprintf(buf, n, "Media");
    break;
  case ACT_MOUSE_BTN:
    snprintf(buf, n, "Click");
    break;
  case ACT_MOUSE_MOVE:
    snprintf(buf, n, "Move");
    break;
  case ACT_WHEEL:
    snprintf(buf, n, "Wheel");
    break;
  case ACT_RELEASE:
    snprintf(buf, n, "Release");
    break;
  case ACT_TEXT:
    snprintf(buf, n, "Text");
    break;
  default: {
    char name[8] = "";
    if (hid >= 4 && hid <= 29) {
      name[0] = (char)('A' + (hid - 4));
      name[1] = 0;
    } else if (hid == 0x28) {
      strncpy(name, "Enter", sizeof(name));
    } else if (hid == 0x29) {
      strncpy(name, "Esc", sizeof(name));
    } else if (hid == 0x2A) {
      strncpy(name, "Bksp", sizeof(name));
    } else if (hid == 0x2B) {
      strncpy(name, "Tab", sizeof(name));
    } else if (hid == 0x2C) {
      strncpy(name, "Space", sizeof(name));
    } else if (hid) {
      strncpy(name, "Key", sizeof(name));
    }
    char m[20] = "";
    size_t p = 0;
    if (a->mods & 1u) {
      memcpy(m + p, "Ctrl+", 5);
      p += 5;
    }
    if (a->mods & 2u) {
      memcpy(m + p, "Sh+", 3);
      p += 3;
    }
    if (a->mods & 4u) {
      memcpy(m + p, "Alt+", 4);
      p += 4;
    }
    if (a->mods & 8u) {
      memcpy(m + p, "Win+", 4);
      p += 4;
    }
    if (p && !name[0]) {
      m[p - 1] = 0;
      snprintf(buf, n, "%s", m);
    } else if (p) {
      m[p] = 0;
      snprintf(buf, n, "%s%s", m, name);
    } else if (name[0]) {
      snprintf(buf, n, "%s", name);
    } else {
      snprintf(buf, n, "Key");
    }
    break;
  }
  }
}

static void draw(void) {
  char tmp[24];
  lp_profile_t *p = ap();
  ssd1306_Fill(Black);

  switch (scr) {
  case SCR_BOOT:
    text2x_center(8, "LogicPad");
    header("v0.1");
    break;
  case SCR_HOME:
    draw_idle_home();
    break;
  case SCR_TOAST: {
    const char *lab = or_dash(storage_key_title(&p->keys[toast_key]));
    ssd1306_FillRect(0, 0, 128, UI_BLUE_H, White);
    text2x_title(lab, Black);
    header(p->name);
    break;
  }
  case SCR_MENU: {
    const char *it[] = {"Profiles", "Keys", "Setup"};
    big_menu(it, 3, i);
    header("MENU");
    break;
  }
  case SCR_PROF_LIST: {
    uint8_t n = storage_n_profiles();
    big_menu_profiles(n, storage_can_add_profile(), i);
    header("PROFILE");
    break;
  }
  case SCR_PROF_ACTS: {
    const char *it[] = {"Use", "Rename", "Reset", "Delete"};
    uint8_t n = storage_n_profiles() > 1 ? 4 : 3;
    char pname[LP_NAME_LEN + 1];
    big_menu(it, n, i);
    storage_profile_name(edit_prof, pname, sizeof(pname));
    header(pname[0] ? pname : "--");
    break;
  }
  case SCR_PROF_NAME:
    text2x_title(name_buf, White);
    footer("U/D letter");
    header_hint("NAME", "OK");
    break;
  case SCR_PROF_RESET:
    confirm_screen("Reset?");
    break;
  case SCR_PROF_DEL:
    confirm_screen("Delete?");
    break;
  case SCR_KEY_PICK:
    text2x_center(4, "Press");
    text2x_center(24, "a key");
    header("KEYS");
    break;
  case SCR_KEY_EDIT: {
    const char *it[] = {"Name", "Light", "Macro"};
    big_menu(it, 3, i);
    header(or_dash(storage_key_title(&p->keys[edit_key])));
    break;
  }
  case SCR_KEY_NAME:
    text2x_title(name_buf, White);
    footer("U/D letter");
    header_hint("NAME", "OK");
    break;
  case SCR_KEY_LIGHT:
    value_screen("LIGHT", COLORS[clampi(i, 0, 4)]);
    break;
  case SCR_MACRO: {
    char a0[16] = "+ Add", a1[16] = "", a2[16] = "", a3[16] = "";
    char *rows[4] = {a0, a1, a2, a3};
    uint8_t n = (uint8_t)(p->keys[edit_key].n + 1);
    for (uint8_t k = 0; k < p->keys[edit_key].n && k < 3; k++) {
      fmt_act(&p->keys[edit_key].acts[k], rows[k], 16);
    }
    if (p->keys[edit_key].n < 3) {
      strncpy(rows[p->keys[edit_key].n], "+ Add", 16);
    }
    big_menu((const char *const *)rows, n > 3 ? 3 : n, i < 3 ? i : 2);
    header_hint("MACRO", "+/-");
    break;
  }
  case SCR_ADD_KIND: {
    const char *it[] = {"Key", "Sys", "Mouse", "Wait", "Text"};
    big_menu(it, 5, i);
    header("ADD");
    break;
  }
  case SCR_ADD_SYS: {
    const char *it[N_SYS_KEYS];
    for (uint8_t k = 0; k < N_SYS_KEYS; k++) {
      it[k] = SYS_KEYS[k].name;
    }
    big_menu(it, N_SYS_KEYS, i);
    header("SYS");
    break;
  }
  case SCR_ADD_LETTER:
    tmp[0] = (char)('A' + clampi(i, 0, 25));
    tmp[1] = 0;
    toast_key = (uint8_t)clampi(i, 0, 25);
    value_screen("KEY", tmp);
    break;
  case SCR_ADD_SEND: {
    const char *it[] = {"Tap", "Hold", "Release"};
    big_menu(it, 3, i);
    header("SEND");
    break;
  }
  case SCR_ADD_MOUSE: {
    const char *it[] = {"Button", "Move", "Wheel"};
    big_menu(it, 3, i);
    header("MOUSE");
    break;
  }
  case SCR_ADD_WAIT:
    snprintf(tmp, sizeof(tmp), "%d ms", (int)i * 10);
    value_screen("WAIT", tmp);
    break;
  case SCR_SETUP: {
    const char *it[] = {"Lights", "Screen", "About"};
    big_menu(it, 3, i);
    header("SETUP");
    break;
  }
  case SCR_LIGHTS: {
    const char *it[] = {"Mode", "Bright", "Dim"};
    big_menu(it, 3, i);
    header("LIGHTS");
    break;
  }
  case SCR_SCREEN: {
    const char *it[] = {"Contrast", "Flip", "Sleep"};
    big_menu(it, 3, i);
    header("SCREEN");
    break;
  }
  case SCR_LMODE:
    value_screen("MODE", MODES[clampi(i, 0, LP_N_LIGHT_MODES - 1)]);
    break;
  case SCR_LBRIGHT:
    snprintf(tmp, sizeof(tmp), "%d", (int)i);
    value_screen("BRIGHT", tmp);
    break;
  case SCR_LDIM:
    snprintf(tmp, sizeof(tmp), "%d", (int)i);
    value_screen("DIM", tmp);
    break;
  case SCR_CONTRAST:
    snprintf(tmp, sizeof(tmp), "%d", (int)i);
    value_screen("CONTRAST", tmp);
    break;
  case SCR_FLIP:
    value_screen("FLIP", i ? "On" : "Off");
    break;
  case SCR_SLEEP:
    value_screen("SLEEP", SLEEP_L[clampi(i, 0, 4)]);
    break;
  case SCR_ABOUT: {
    const char *it[] = {hid_configured() ? "USB OK" : "USB --", "Save", "Reset"};
    big_menu(it, 3, i);
    header("ABOUT");
    break;
  }
  case SCR_SAVED:
    text2x_center(16, "Saved");
    header("ABOUT");
    break;
  case SCR_RESET_ALL:
    confirm_screen("Erase?");
    break;
  case SCR_SLEEPING:
    draw_idle_home();
    break;
  case SCR_SAVE_PROMPT:
    confirm_screen("Save?");
    break;
  }
}

void ui_init(void) {
  ssd1306_Init();
  apply_screen_hw();
  ssd1306_DisplayOn(1);
  clock_get(&clk_year, &clk_mon, &clk_day, &clk_hour, &clk_min, &clk_sec);
  go(SCR_BOOT);
}

static int showing_idle(void) {
  return scr == SCR_SLEEPING || scr == SCR_HOME;
}

static int showing_clock(void) {
  return showing_idle() && idle_shows_clock();
}

void ui_tick(void) {
  t_ms++;
  idle_ms++;
  clock_poll();
  if (++clk_ms >= 1000) {
    clk_ms -= 1000;
    if (!clock_get(&clk_year, &clk_mon, &clk_day, &clk_hour, &clk_min, &clk_sec)) {
      clock_advance_sec();
    }
    if (showing_clock()) {
      need_draw = 1;
    }
  }
  if (is_live() && scr != SCR_BOOT) {
    live_idle++;
  } else {
    live_idle = 0;
  }
  if (showing_clock() && (clk_ms % 50u) == 0) {
    need_draw = 1;
  }
  {
    uint8_t usb = hid_configured() ? 1 : 0;
    if (usb != last_usb_cfg) {
      last_usb_cfg = usb;
      if (showing_idle()) {
        need_draw = 1;
      }
    }
  }

  keypad_event_t e;
  while (keypad_pop(&e)) {
    idle_ms = 0;
    live_idle = 0;
    on_event(e);
  }

  if (scr == SCR_BOOT && t_ms > 900) {
    go(SCR_HOME);
  }
  if (scr == SCR_TOAST && t_ms > 700) {
    go(SCR_HOME);
  }
  if (scr == SCR_SAVED && t_ms > 400) {
    go(SCR_ABOUT);
  }

  uint32_t sleep_after = SLEEP_MS[g_store.sleep <= 4 ? g_store.sleep : 3];
  if (is_live() && sleep_after && live_idle > sleep_after) {
    go(SCR_SLEEPING);
  }

  uint32_t menu_to = IDLE_MS[g_store.menu_idle <= 2 ? g_store.menu_idle : 1];
  if (!is_live() && scr != SCR_SLEEPING && scr != SCR_SAVE_PROMPT && idle_ms > menu_to) {
    go_home_clean();
  }

  if ((hid_vendor_session() && (HAL_GetTick() % 400) == 0) || need_draw) {
    need_draw = 1;
  }
}

void ui_show_update(void) {
  ssd1306_Fill(Black);
  text2x_center(8, "FLASH");
  ssd1306_SetCursor(22, 32);
  ssd1306_WriteString("Keep USB in", Font_6x8, White);
  ssd1306_FillRect(0, UI_YELLOW_Y, 128, UI_YELLOW_H, White);
  ssd1306_SetCursor(10, (uint8_t)(UI_YELLOW_Y + 4));
  ssd1306_WriteString("BOOT MODE", Font_6x8, Black);
  ssd1306_UpdateScreen();
}

void ui_draw_if_needed(void) {
  static uint32_t last;
  uint32_t now = HAL_GetTick();
  if (!need_draw && (now - last) < 100) {
    return;
  }
  last = now;
  need_draw = 0;
  draw();
  ssd1306_UpdateScreen();
}
