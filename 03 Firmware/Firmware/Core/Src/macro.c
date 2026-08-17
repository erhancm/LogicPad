#include "macro.h"
#include "hid_reports.h"
#include "storage.h"
#include "led_mux.h"
#include <string.h>

static uint8_t playing;
static uint8_t key_i;
static uint8_t act_i;
static uint16_t wait_ms;
static uint8_t phase; /* 0=start act, 1=hold tap */
static uint8_t live_mods;
static uint8_t live_keys[6];
static uint8_t in_text;
static uint8_t text_i;
static uint8_t text_len;
static const uint8_t *text_p;
static uint8_t text_phase;

void macro_init(void) {
  playing = 0;
}

int macro_busy(void) {
  return playing;
}

void macro_cancel(void) {
  playing = 0;
  in_text = 0;
  hid_kbd_release();
  hid_consumer_release();
  hid_mouse_send(0, 0, 0, 0);
  live_mods = 0;
  memset(live_keys, 0, 6);
}

static void keys_add(uint8_t hid) {
  if (hid == 0) {
    return;
  }
  for (int i = 0; i < 6; i++) {
    if (live_keys[i] == hid) {
      return;
    }
  }
  for (int i = 0; i < 6; i++) {
    if (live_keys[i] == 0) {
      live_keys[i] = hid;
      return;
    }
  }
}

static void keys_del(uint8_t hid) {
  for (int i = 0; i < 6; i++) {
    if (live_keys[i] == hid) {
      live_keys[i] = 0;
    }
  }
}

static uint8_t ascii_hid(uint8_t c, uint8_t *mods) {
  *mods = 0;
  if (c >= 'a' && c <= 'z') {
    return (uint8_t)(0x04u + (c - 'a'));
  }
  if (c >= 'A' && c <= 'Z') {
    *mods = 2;
    return (uint8_t)(0x04u + (c - 'A'));
  }
  if (c >= '1' && c <= '9') {
    return (uint8_t)(0x1Eu + (c - '1'));
  }
  if (c == '0') {
    return 0x27;
  }
  if (c == '\n') {
    return 0x28;
  }
  if (c == '\b') {
    return 0x2A;
  }
  if (c == '\t') {
    return 0x2B;
  }
  if (c == ' ') {
    return 0x2C;
  }
  static const uint8_t map[][3] = {
      {'!', 0x1E, 2}, {'@', 0x1F, 2}, {'#', 0x20, 2}, {'$', 0x21, 2}, {'%', 0x22, 2},
      {'^', 0x23, 2}, {'&', 0x24, 2}, {'*', 0x25, 2}, {'(', 0x26, 2}, {')', 0x27, 2},
      {'-', 0x2D, 0}, {'_', 0x2D, 2}, {'=', 0x2E, 0}, {'+', 0x2E, 2}, {'[', 0x2F, 0},
      {'{', 0x2F, 2}, {']', 0x30, 0}, {'}', 0x30, 2}, {'\\', 0x31, 0}, {'|', 0x31, 2},
      {';', 0x33, 0}, {':', 0x33, 2}, {'\'', 0x34, 0}, {'"', 0x34, 2}, {'`', 0x35, 0},
      {'~', 0x35, 2}, {',', 0x36, 0}, {'<', 0x36, 2}, {'.', 0x37, 0}, {'>', 0x37, 2},
      {'/', 0x38, 0}, {'?', 0x38, 2},
  };
  for (unsigned i = 0; i < sizeof(map) / sizeof(map[0]); i++) {
    if (map[i][0] == c) {
      *mods = map[i][2];
      return map[i][1];
    }
  }
  return 0;
}

static void load_text(uint8_t key_idx) {
  text_p = storage_text(g_store.active, key_idx, &text_len);
  text_i = 0;
  text_phase = 0;
  in_text = 0;
}

void macro_play(uint8_t key_idx) {
  if (key_idx >= LP_N_KEYS) {
    return;
  }
  lp_key_t *k = &storage_active()->keys[key_idx];
  load_text(key_idx);
  if (k->n == 0 && text_len == 0) {
    return;
  }
  playing = 1;
  key_i = key_idx;
  act_i = 0;
  wait_ms = 0;
  phase = 0;
  in_text = (k->n == 0) ? 1 : 0;
  led_mux_key_flash(key_idx);
}

static int tick_text(void) {
  if (text_i >= text_len) {
    hid_kbd_release();
    playing = 0;
    in_text = 0;
    return 1;
  }
  if (text_phase == 1) {
    hid_kbd_release();
    live_mods = 0;
    memset(live_keys, 0, 6);
    text_i++;
    text_phase = 0;
    wait_ms = 8;
    return 1;
  }
  uint8_t mods = 0;
  uint8_t hid = ascii_hid(text_p ? text_p[text_i] : 0, &mods);
  if (hid == 0) {
    text_i++;
    return 0;
  }
  live_mods = mods;
  memset(live_keys, 0, 6);
  keys_add(hid);
  hid_kbd_send(live_mods, live_keys);
  wait_ms = 12;
  text_phase = 1;
  return 1;
}

void macro_tick(void) {
  if (!playing) {
    return;
  }
  if (wait_ms) {
    wait_ms--;
    return;
  }
  if (in_text) {
    while (!tick_text()) {
      /* skip unmapped bytes without burning a millisecond */
    }
    return;
  }
  lp_key_t *k = &storage_active()->keys[key_i];
  if (act_i >= k->n) {
    hid_kbd_release();
    hid_consumer_release();
    live_mods = 0;
    memset(live_keys, 0, 6);
    if (text_len) {
      in_text = 1;
      text_i = 0;
      text_phase = 0;
      return;
    }
    playing = 0;
    return;
  }
  lp_action_t a = k->acts[act_i];
  uint8_t send = (uint8_t)(a.code >> 8);
  uint8_t hid = (uint8_t)a.code;

  if (phase == 1) {
    if (a.type == ACT_KEY && send == SEND_TAP) {
      if (hid) {
        keys_del(hid);
      } else {
        live_mods = (uint8_t)(live_mods & (uint8_t)~a.mods);
      }
      hid_kbd_send(live_mods, live_keys);
    } else if (a.type == ACT_CONSUMER) {
      hid_consumer_release();
    } else if (a.type == ACT_MOUSE_BTN && send == SEND_TAP) {
      hid_mouse_send(0, 0, 0, 0);
    }
    phase = 0;
    act_i++;
    return;
  }

  switch (a.type) {
  case ACT_DELAY:
    wait_ms = a.code;
    act_i++;
    break;
  case ACT_RELEASE:
    live_mods = 0;
    memset(live_keys, 0, 6);
    hid_kbd_release();
    hid_consumer_release();
    hid_mouse_send(0, 0, 0, 0);
    act_i++;
    break;
  case ACT_CONSUMER:
    hid_consumer_send(a.code);
    wait_ms = 12;
    phase = 1;
    break;
  case ACT_MOUSE_BTN:
    hid_mouse_send(a.mods, 0, 0, 0);
    if (send == SEND_TAP) {
      wait_ms = 12;
      phase = 1;
    } else {
      act_i++;
    }
    break;
  case ACT_MOUSE_MOVE:
    hid_mouse_send(0, (int8_t)(a.code & 0xFF), (int8_t)(a.code >> 8), 0);
    act_i++;
    break;
  case ACT_WHEEL:
    hid_mouse_send(0, 0, 0, (int8_t)a.code);
    act_i++;
    break;
  case ACT_KEY:
  default:
    if (send == SEND_UP) {
      if (hid) {
        keys_del(hid);
      }
      live_mods = (uint8_t)(live_mods & (uint8_t)~a.mods);
      hid_kbd_send(live_mods, live_keys);
      act_i++;
    } else if (send == SEND_DOWN) {
      live_mods |= a.mods;
      keys_add(hid);
      hid_kbd_send(live_mods, live_keys);
      act_i++;
    } else {
      live_mods |= a.mods;
      keys_add(hid);
      hid_kbd_send(live_mods, live_keys);
      wait_ms = 12;
      phase = 1;
    }
    break;
  }
}
