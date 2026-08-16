#include "hid_reports.h"
#include "storage.h"
#include "ui.h"
#include "usbd_customhid.h"
#include "usb_device.h"
#include <string.h>

extern USBD_HandleTypeDef hUsbDeviceFS;

static uint32_t vendor_last_ms;
static uint8_t kbd[9];
static uint8_t mouse[5];
static uint8_t cons[3];

static int hid_send(uint8_t *r, uint16_t n) {
  if (hUsbDeviceFS.dev_state != USBD_STATE_CONFIGURED || hUsbDeviceFS.pClassData == NULL) {
    return -1;
  }
  USBD_CUSTOM_HID_HandleTypeDef *h = (USBD_CUSTOM_HID_HandleTypeDef *)hUsbDeviceFS.pClassData;
  if (h->state != CUSTOM_HID_IDLE) {
    return -1;
  }
  return USBD_CUSTOM_HID_SendReport(&hUsbDeviceFS, r, n) == USBD_OK ? 0 : -1;
}

void hid_init(void) {
  memset(kbd, 0, sizeof(kbd));
  kbd[0] = HID_RID_KBD;
  mouse[0] = HID_RID_MOUSE;
  cons[0] = HID_RID_CONS;
}

void hid_tick(void) {
}

int hid_configured(void) {
  return hUsbDeviceFS.dev_state == USBD_STATE_CONFIGURED;
}

int hid_vendor_session(void) {
  return (HAL_GetTick() - vendor_last_ms) < 2000u && vendor_last_ms != 0;
}

void hid_kbd_send(uint8_t mods, const uint8_t keys[6]) {
  kbd[0] = HID_RID_KBD;
  kbd[1] = mods;
  kbd[2] = 0;
  memcpy(&kbd[3], keys, 6);
  hid_send(kbd, 9);
}

void hid_kbd_release(void) {
  uint8_t z[6] = {0};
  hid_kbd_send(0, z);
}

void hid_mouse_send(uint8_t buttons, int8_t x, int8_t y, int8_t wheel) {
  mouse[0] = HID_RID_MOUSE;
  mouse[1] = buttons;
  mouse[2] = (uint8_t)x;
  mouse[3] = (uint8_t)y;
  mouse[4] = (uint8_t)wheel;
  hid_send(mouse, 5);
}

void hid_consumer_send(uint16_t usage) {
  cons[0] = HID_RID_CONS;
  cons[1] = (uint8_t)usage;
  cons[2] = (uint8_t)(usage >> 8);
  hid_send(cons, 3);
}

void hid_consumer_release(void) {
  hid_consumer_send(0);
}

static void vendor_reply(uint8_t cmd, const uint8_t *payload, uint8_t n) {
  uint8_t r[64];
  memset(r, 0, sizeof(r));
  r[0] = HID_RID_VENDOR;
  r[1] = cmd;
  if (n > 62) {
    n = 62;
  }
  if (payload && n) {
    memcpy(&r[2], payload, n);
  }
  hid_send(r, 64);
}

void hid_vendor_on_out(const uint8_t *buf, uint16_t len) {
  if (len < 2 || buf[0] != HID_RID_VENDOR) {
    return;
  }
  vendor_last_ms = HAL_GetTick();
  uint8_t cmd = buf[1];
  const uint8_t *p = &buf[2];
  uint8_t out[62];
  memset(out, 0, sizeof(out));

  switch (cmd) {
  case CMD_PING:
    out[0] = 0x01;
    out[1] = 0x00;
    vendor_reply(CMD_PING, out, 2);
    break;
  case CMD_GET_META:
  case CMD_GET_STATUS:
    out[0] = g_store.active;
    out[1] = g_store.dirty;
    out[2] = g_store.contrast;
    out[3] = g_store.flip;
    out[4] = g_store.sleep;
    out[5] = (uint8_t)(ui_is_live() ? 0 : 1);
    out[6] = hid_configured() ? 1 : 0;
    vendor_reply(cmd, out, 7);
    break;
  case CMD_GET_PROFILE_HDR: {
    uint8_t idx = p[0];
    if (idx >= LP_N_PROFILES) {
      break;
    }
    lp_profile_t *pr = &g_store.profiles[idx];
    out[0] = idx;
    memcpy(&out[1], pr->name, LP_NAME_LEN + 1);
    out[14] = pr->light_mode;
    out[15] = pr->bright;
    out[16] = pr->dim;
    vendor_reply(cmd, out, 17);
    break;
  }
  case CMD_SET_PROFILE_HDR: {
    uint8_t idx = p[0];
    if (idx >= LP_N_PROFILES) {
      break;
    }
    lp_profile_t *pr = &g_store.profiles[idx];
    memcpy(pr->name, &p[1], LP_NAME_LEN);
    pr->name[LP_NAME_LEN] = 0;
    pr->light_mode = (p[14] >= LP_N_LIGHT_MODES) ? 0 : p[14];
    pr->bright = p[15];
    pr->dim = p[16];
    g_store.dirty = 1;
    ui_mark_dirty();
    vendor_reply(cmd, p, 17);
    break;
  }
  case CMD_GET_KEY: {
    uint8_t pi = p[0], ki = p[1];
    if (pi >= LP_N_PROFILES || ki >= LP_N_KEYS) {
      break;
    }
    out[0] = pi;
    out[1] = ki;
    memcpy(&out[2], &g_store.profiles[pi].keys[ki], 60);
    vendor_reply(cmd, out, 62);
    break;
  }
  case CMD_SET_KEY: {
    uint8_t pi = p[0], ki = p[1];
    if (pi >= LP_N_PROFILES || ki >= LP_N_KEYS) {
      break;
    }
    memcpy(&g_store.profiles[pi].keys[ki], &p[2], 60);
    g_store.dirty = 1;
    ui_mark_dirty();
    vendor_reply(cmd, p, 2);
    break;
  }
  case CMD_SET_ACTIVE:
    if (p[0] < LP_N_PROFILES) {
      g_store.active = p[0];
      g_store.dirty = 1;
      ui_mark_dirty();
    }
    vendor_reply(cmd, p, 1);
    break;
  case CMD_SAVE:
    storage_save();
    vendor_reply(cmd, NULL, 0);
    break;
  case CMD_RELOAD:
    storage_reload();
    ui_mark_dirty();
    vendor_reply(cmd, NULL, 0);
    break;
  case CMD_FACTORY:
    storage_factory();
    storage_save();
    ui_mark_dirty();
    vendor_reply(cmd, NULL, 0);
    break;
  default:
    break;
  }
}
