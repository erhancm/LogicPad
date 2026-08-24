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
static uint8_t text_last_hid; /* 0 = nothing held; same usage needs a break */
static uint8_t text_resume; /* 1 = continue the macro after the string */

#define TAP_MS 8u

void macro_init(void) {
  playing = 0;
}

int macro_busy(void) {
  return playing;
}

void macro_cancel(void) {
  playing = 0;
  in_text = 0;
  text_resume = 0;
  text_last_hid = 0;
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
  text_last_hid = 0;
}

static int key_has_text_act(const lp_key_t *k) {
  uint8_t n = k->n > LP_MAX_ACTIONS ? LP_MAX_ACTIONS : k->n;
  for (uint8_t i = 0; i < n; i++) {
    if (k->acts[i].type == ACT_TEXT) {
      return 1;
    }
  }
  return 0;
}

void macro_play(uint8_t key_idx) {
  if (key_idx >= LP_N_KEYS) {
    return;
  }
  led_mux_key_flash(key_idx);
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
  text_resume = 0;
  in_text = (k->n == 0 && text_len) ? 1 : 0;
}

static int tick_text(void) {
  if (text_i >= text_len) {
    if (hid_kbd_release() != 0) {
      return 1;
    }
    live_mods = 0;
    memset(live_keys, 0, 6);
    text_last_hid = 0;
    in_text = 0;
    if (text_resume) {
      text_resume = 0;
      act_i++;
      return 1;
    }
    playing = 0;
    return 1;
  }
  uint8_t mods = 0;
  uint8_t hid = ascii_hid(text_p ? text_p[text_i] : 0, &mods);
  if (hid == 0) {
    text_i++;
    return 0;
  }
  /* USB reports are the current key state. A new usage releases the previous
   * one; the same usage (ll, a/A) needs an empty report or the host sees a hold. */
  if (text_last_hid == hid) {
    if (hid_kbd_release() != 0) {
      return 1;
    }
    live_mods = 0;
    memset(live_keys, 0, 6);
    text_last_hid = 0;
    return 1;
  }
  live_mods = mods;
  memset(live_keys, 0, 6);
  keys_add(hid);
  if (hid_kbd_send(live_mods, live_keys) != 0) {
    return 1;
  }
  text_last_hid = hid;
  text_i++;
  return 1;
}

void macro_tick(uint16_t elapsed_ms) {
  if (!playing) {
    return;
  }
  if (wait_ms) {
    if (elapsed_ms < wait_ms) {
      wait_ms = (uint16_t)(wait_ms - elapsed_ms);
      return;
    }
    wait_ms = 0;
  }
  if (in_text) {
    while (!tick_text()) {
      /* skip unmapped bytes without burning a millisecond */
    }
    return;
  }
  lp_key_t *k = &storage_active()->keys[key_i];
  if (act_i >= k->n) {
    if (hid_kbd_release() != 0) {
      return;
    }
    hid_consumer_release();
    live_mods = 0;
    memset(live_keys, 0, 6);
    if (text_len && !key_has_text_act(k)) {
      in_text = 1;
      text_resume = 0;
      text_i = 0;
      text_last_hid = 0;
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
      if (hid_kbd_send(live_mods, live_keys) != 0) {
        return;
      }
    } else if (a.type == ACT_CONSUMER) {
      if (hid_consumer_release() != 0) {
        return;
      }
    } else if (a.type == ACT_MOUSE_BTN && send == SEND_TAP) {
      if (hid_mouse_send(0, 0, 0, 0) != 0) {
        return;
      }
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
    if (hid_kbd_release() != 0) {
      return;
    }
    hid_consumer_release();
    hid_mouse_send(0, 0, 0, 0);
    act_i++;
    break;
  case ACT_CONSUMER:
    if (hid_consumer_send(a.code) != 0) {
      return;
    }
    wait_ms = TAP_MS;
    phase = 1;
    break;
  case ACT_MOUSE_BTN:
    if (hid_mouse_send(a.mods, 0, 0, 0) != 0) {
      return;
    }
    if (send == SEND_TAP) {
      wait_ms = TAP_MS;
      phase = 1;
    } else {
      act_i++;
    }
    break;
  case ACT_MOUSE_MOVE:
    if (hid_mouse_send(0, (int8_t)(a.code & 0xFF), (int8_t)(a.code >> 8), 0) != 0) {
      return;
    }
    act_i++;
    break;
  case ACT_WHEEL:
    if (hid_mouse_send(0, 0, 0, (int8_t)a.code) != 0) {
      return;
    }
    act_i++;
    break;
  case ACT_TEXT:
    if (text_len == 0) {
      act_i++;
      break;
    }
    text_i = 0;
    text_last_hid = 0;
    in_text = 1;
    text_resume = 1;
    break;
  case ACT_KEY:
    if (send == SEND_UP) {
      if (hid) {
        keys_del(hid);
      }
      live_mods = (uint8_t)(live_mods & (uint8_t)~a.mods);
      if (hid_kbd_send(live_mods, live_keys) != 0) {
        return;
      }
      act_i++;
    } else if (send == SEND_DOWN) {
      live_mods |= a.mods;
      keys_add(hid);
      if (hid_kbd_send(live_mods, live_keys) != 0) {
        return;
      }
      act_i++;
    } else {
      live_mods |= a.mods;
      keys_add(hid);
      if (hid_kbd_send(live_mods, live_keys) != 0) {
        return;
      }
      wait_ms = TAP_MS;
      phase = 1;
    }
    break;
  default:
    act_i++;
    break;
  }
}
