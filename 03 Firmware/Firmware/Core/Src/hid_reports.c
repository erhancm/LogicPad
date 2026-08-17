#include "hid_reports.h"
#include "storage.h"
#include "ui.h"
#include "usbd_customhid.h"
#include "usb_device.h"
#include "lp_memmap.h"
#include "main.h"
#include <string.h>

extern USBD_HandleTypeDef hUsbDeviceFS;

static uint32_t vendor_last_ms;
static volatile uint8_t enter_boot;
static uint8_t kbd[9];
static uint8_t mouse[5];
static uint8_t cons[3];
static uint8_t key_evt_pending;
static uint8_t key_evt_profile;
static uint8_t key_evt_key;
static uint8_t key_evt_down;

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

static void hid_go_boot(void) {
  /* USB ISR is priority 0; SysTick is lower. Never HAL_Delay in OutEvent. */
  ui_show_update();
  HAL_Delay(80);
  __disable_irq();
  *(volatile uint32_t *)LP_BL_MAGIC_ADDR = LP_BL_MAGIC;
  *(volatile uint32_t *)LP_BL_MAGIC_ADDR = LP_BL_MAGIC;
  __DSB();
  USB->CNTR = USB_CNTR_FRES | USB_CNTR_PDWN;
  RCC->APB1ENR &= ~RCC_APB1ENR_USBEN;
  RCC->APB2ENR |= RCC_APB2ENR_IOPAEN;
  GPIOA->CRH = (GPIOA->CRH & ~(0xFu << 16)) | (0x1u << 16);
  GPIOA->BRR = (1u << 12);
  {
    volatile uint32_t i;
    for (i = 0; i < 1500000u; i++) {
    }
  }
  NVIC_SystemReset();
}

void hid_tick(void) {
  if (enter_boot) {
    hid_go_boot();
  }
  if (!key_evt_pending) {
    return;
  }
  if (hUsbDeviceFS.dev_state != USBD_STATE_CONFIGURED) {
    key_evt_pending = 0;
    return;
  }
  uint8_t r[64];
  memset(r, 0, sizeof(r));
  r[0] = HID_RID_VENDOR;
  r[1] = CMD_KEY_EVENT;
  r[2] = key_evt_profile;
  r[3] = key_evt_key;
  r[4] = key_evt_down;
  if (hid_send(r, 64) == 0) {
    key_evt_pending = 0;
  }
}

void hid_notify_key(uint8_t profile, uint8_t key, uint8_t down) {
  key_evt_profile = profile;
  key_evt_key = key;
  key_evt_down = down ? 1 : 0;
  key_evt_pending = 1;
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
    out[1] = 0x01; /* minor: type-text pool */
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
  case CMD_ENTER_BOOTLOADER:
    vendor_reply(cmd, NULL, 0);
    enter_boot = 1;
    break;
  case CMD_SET_TIME: {
    uint16_t year = (uint16_t)p[0] | ((uint16_t)p[1] << 8);
    ui_set_clock(year, p[2], p[3], p[4], p[5], p[6]);
    vendor_reply(cmd, p, 7);
    break;
  }
  case CMD_GET_TEXT: {
    uint8_t pi = p[0], ki = p[1], off = p[2];
    uint8_t tlen = 0;
    const uint8_t *td = storage_text(pi, ki, &tlen);
    uint16_t used = storage_pool_used();
    out[0] = pi;
    out[1] = ki;
    out[2] = tlen;
    out[3] = off;
    out[4] = (uint8_t)used;
    out[5] = (uint8_t)(used >> 8);
    if (td && off < tlen) {
      uint8_t n = (uint8_t)(tlen - off);
      if (n > 56) {
        n = 56;
      }
      memcpy(&out[6], td + off, n);
    }
    vendor_reply(cmd, out, 62);
    break;
  }
  case CMD_SET_TEXT: {
    static uint8_t acc[LP_TEXT_MAX];
    static uint8_t acc_pi, acc_ki, acc_len, acc_have;
    uint8_t pi = p[0], ki = p[1], off = p[2], total = p[3];
    uint8_t st = 0;
    if (pi >= LP_N_PROFILES || ki >= LP_N_KEYS) {
      st = 3;
    } else if (total > LP_TEXT_MAX) {
      st = 2;
    } else if (off == 0) {
      acc_pi = pi;
      acc_ki = ki;
      acc_len = total;
      acc_have = 0;
      memset(acc, 0, sizeof(acc));
      if (total > 0) {
        uint8_t n = total < 58 ? total : 58;
        memcpy(acc, &p[4], n);
        acc_have = n;
      }
    } else if (acc_pi != pi || acc_ki != ki || acc_len != total || off != acc_have) {
      st = 3;
    } else {
      uint8_t n = (uint8_t)(total - off);
      if (n > 58) {
        n = 58;
      }
      memcpy(acc + off, &p[4], n);
      acc_have = (uint8_t)(acc_have + n);
    }
    if (st == 0 && acc_have >= acc_len && acc_pi == pi && acc_ki == ki) {
      int rc = storage_set_text(pi, ki, acc, acc_len);
      if (rc == -1) {
        st = 1;
      } else if (rc != 0) {
        st = 3;
      } else {
        g_store.dirty = 1;
        ui_mark_dirty();
      }
      acc_len = 0;
      acc_have = 0;
    }
    uint16_t used = storage_pool_used();
    out[0] = pi;
    out[1] = ki;
    out[2] = off;
    out[3] = st;
    out[4] = (uint8_t)used;
    out[5] = (uint8_t)(used >> 8);
    vendor_reply(cmd, out, 6);
    break;
  }
  default:
    break;
  }
}
