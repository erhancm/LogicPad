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

void macro_init(void) {
  playing = 0;
}

int macro_busy(void) {
  return playing;
}

void macro_cancel(void) {
  playing = 0;
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

void macro_play(uint8_t key_idx) {
  if (key_idx >= LP_N_KEYS) {
    return;
  }
  lp_key_t *k = &storage_active()->keys[key_idx];
  if (k->n == 0) {
    return;
  }
  playing = 1;
  key_i = key_idx;
  act_i = 0;
  wait_ms = 0;
  phase = 0;
  led_mux_key_flash(key_idx);
}

void macro_tick(void) {
  if (!playing) {
    return;
  }
  if (wait_ms) {
    wait_ms--;
    return;
  }
  lp_key_t *k = &storage_active()->keys[key_i];
  if (act_i >= k->n) {
    hid_kbd_release();
    hid_consumer_release();
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
