#include "hid_reports.h"
#include "storage.h"
#include "ui.h"
#include "led_mux.h"
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
#define KEY_EVT_Q 4
static uint8_t key_evt_prof[KEY_EVT_Q];
static uint8_t key_evt_key[KEY_EVT_Q];
static uint8_t key_evt_down[KEY_EVT_Q];
static uint8_t key_evt_qh, key_evt_qt, key_evt_qn;
static uint8_t key_evt_report[64];

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
  key_evt_qh = 0;
  key_evt_qt = 0;
  key_evt_qn = 0;
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

static void hid_on_no_host(void) {
  key_evt_qn = 0;
  key_evt_qh = 0;
  key_evt_qt = 0;
  if (hUsbDeviceFS.pClassData != NULL) {
    USBD_CUSTOM_HID_HandleTypeDef *h =
        (USBD_CUSTOM_HID_HandleTypeDef *)hUsbDeviceFS.pClassData;
    h->state = CUSTOM_HID_IDLE;
  }
}

void hid_tick(void) {
  if (enter_boot) {
    hid_go_boot();
  }
  {
    uint8_t st = hUsbDeviceFS.dev_state;
    /* Unplug / re-enumerate, not USB suspend: start the next host as in-use. */
    if (st == USBD_STATE_DEFAULT || st == USBD_STATE_ADDRESSED) {
      ui_set_host_active(1);
    }
  }
  if (hUsbDeviceFS.dev_state != USBD_STATE_CONFIGURED) {
    hid_on_no_host();
    return;
  }
  if (!key_evt_qn) {
    return;
  }
  memset(key_evt_report, 0, sizeof(key_evt_report));
  key_evt_report[0] = HID_RID_VENDOR;
  key_evt_report[1] = CMD_KEY_EVENT;
  key_evt_report[2] = key_evt_prof[key_evt_qt];
  key_evt_report[3] = key_evt_key[key_evt_qt];
  key_evt_report[4] = key_evt_down[key_evt_qt];
  if (hid_send(key_evt_report, 64) == 0) {
    key_evt_qt = (uint8_t)((key_evt_qt + 1) % KEY_EVT_Q);
    key_evt_qn--;
  }
}

void hid_notify_key(uint8_t profile, uint8_t key, uint8_t down) {
  if (hUsbDeviceFS.dev_state != USBD_STATE_CONFIGURED) {
    return;
  }
  if (key_evt_qn >= KEY_EVT_Q) {
    key_evt_qt = (uint8_t)((key_evt_qt + 1) % KEY_EVT_Q);
    key_evt_qn--;
  }
  key_evt_prof[key_evt_qh] = profile;
  key_evt_key[key_evt_qh] = key;
  key_evt_down[key_evt_qh] = down ? 1 : 0;
  key_evt_qh = (uint8_t)((key_evt_qh + 1) % KEY_EVT_Q);
  key_evt_qn++;
}

int hid_key_evt_pending(void) {
  return key_evt_qn != 0;
}

int hid_configured(void) {
  return hUsbDeviceFS.dev_state == USBD_STATE_CONFIGURED;
}

int hid_in_ready(void) {
  if (hUsbDeviceFS.dev_state != USBD_STATE_CONFIGURED || hUsbDeviceFS.pClassData == NULL) {
    return 0;
  }
  USBD_CUSTOM_HID_HandleTypeDef *h = (USBD_CUSTOM_HID_HandleTypeDef *)hUsbDeviceFS.pClassData;
  return h->state == CUSTOM_HID_IDLE;
}

int hid_vendor_session(void) {
  return (HAL_GetTick() - vendor_last_ms) < 2000u && vendor_last_ms != 0;
}

int hid_kbd_send(uint8_t mods, const uint8_t keys[6]) {
  kbd[0] = HID_RID_KBD;
  kbd[1] = mods;
  kbd[2] = 0;
  memcpy(&kbd[3], keys, 6);
  return hid_send(kbd, 9);
}

int hid_kbd_release(void) {
  uint8_t z[6] = {0};
  return hid_kbd_send(0, z);
}

int hid_mouse_send(uint8_t buttons, int8_t x, int8_t y, int8_t wheel) {
  mouse[0] = HID_RID_MOUSE;
  mouse[1] = buttons;
  mouse[2] = (uint8_t)x;
  mouse[3] = (uint8_t)y;
  mouse[4] = (uint8_t)wheel;
  return hid_send(mouse, 5);
}

int hid_consumer_send(uint16_t usage) {
  cons[0] = HID_RID_CONS;
  cons[1] = (uint8_t)usage;
  cons[2] = (uint8_t)(usage >> 8);
  return hid_send(cons, 3);
}

int hid_consumer_release(void) {
  return hid_consumer_send(0);
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
  uint8_t cmd = buf[1];
  /* Live LED polls must not keep the OLED USB dot blinking. */
  if (cmd != CMD_GET_LEDS && cmd != CMD_PREVIEW_CLOCK) {
    vendor_last_ms = HAL_GetTick();
  }
  const uint8_t *p = &buf[2];
  uint8_t out[62];
  memset(out, 0, sizeof(out));

  switch (cmd) {
  case CMD_PING:
    out[0] = 0x01;
    out[1] = 0x09; /* minor: PREVIEW_CLOCK live OLED standby */
    vendor_reply(CMD_PING, out, 2);
    break;
  case CMD_GET_META:
  case CMD_GET_STATUS: {
    (void)storage_commit();
    uint16_t used = storage_used();
    uint16_t cap = storage_cap();
    out[0] = g_store.active;
    out[1] = g_store.dirty;
    out[2] = g_store.contrast;
    out[3] = g_store.flip;
    out[4] = g_store.sleep;
    /* Config menus only. Home / toast / sleep stay 0 so the tray app can auto-switch. */
    out[5] = (uint8_t)((ui_is_live() || ui_is_sleeping()) ? 0 : 1);
    out[6] = hid_configured() ? 1 : 0;
    out[7] = storage_n_profiles();
    out[8] = (uint8_t)used;
    out[9] = (uint8_t)(used >> 8);
    out[10] = (uint8_t)cap;
    out[11] = (uint8_t)(cap >> 8);
    out[12] = g_store.clock_style;
    vendor_reply(cmd, out, 13);
    break;
  }
  case CMD_GET_PROFILE_HDR: {
    static lp_profile_t pr;
    uint8_t idx = p[0];
    if (storage_get_profile_hdr(idx, &pr) != 0) {
      break;
    }
    out[0] = idx;
    memcpy(&out[1], pr.name, LP_NAME_LEN + 1);
    out[14] = pr.light_mode;
    out[15] = pr.bright;
    out[16] = pr.dim;
    vendor_reply(cmd, out, 17);
    break;
  }
  case CMD_SET_PROFILE_HDR: {
    uint8_t idx = p[0];
    char name[LP_NAME_LEN + 1];
    uint8_t old_bright = 0, old_dim = 0;
    static lp_profile_t pr;
    if (idx >= storage_n_profiles()) {
      break;
    }
    if (storage_get_profile_hdr(idx, &pr) == 0) {
      old_bright = pr.bright;
      old_dim = pr.dim;
    }
    memset(name, 0, sizeof(name));
    memcpy(name, &p[1], LP_NAME_LEN);
    if (storage_set_profile_hdr(idx, name, p[14], p[15], p[16]) != 0) {
      break;
    }
    g_store.dirty = 1;
    ui_mark_dirty();
    if (p[15] != old_bright) {
      led_mux_preview(0);
    } else if (p[16] != old_dim) {
      led_mux_preview(1);
    }
    vendor_reply(cmd, p, 17);
    break;
  }
  case CMD_GET_KEY: {
    uint8_t pi = p[0], ki = p[1];
    lp_key_t k;
    if (storage_get_key(pi, ki, &k) != 0) {
      break;
    }
    out[0] = pi;
    out[1] = ki;
    memcpy(&out[2], &k, LP_KEY_HID_BYTES);
    vendor_reply(cmd, out, 62);
    break;
  }
  case CMD_SET_KEY: {
    uint8_t pi = p[0], ki = p[1];
    lp_key_t k;
    char title[LP_TITLE_LEN + 1];
    uint8_t st = 0;
    if (storage_get_key(pi, ki, &k) != 0) {
      break;
    }
    memcpy(title, k.title, sizeof(title));
    memcpy(&k, &p[2], LP_KEY_HID_BYTES);
    k.label[LP_LABEL_LEN] = 0;
    if (k.n > LP_MAX_ACTIONS) {
      k.n = LP_MAX_ACTIONS;
    }
    memcpy(k.title, title, sizeof(title));
    if (storage_set_key(pi, ki, &k) != 0) {
      st = 1;
    } else {
      g_store.dirty = 1;
      ui_mark_dirty();
    }
    out[0] = pi;
    out[1] = ki;
    out[2] = st;
    vendor_reply(cmd, out, 3);
    break;
  }
  case CMD_GET_TITLE: {
    uint8_t pi = p[0], ki = p[1];
    lp_key_t k;
    if (storage_get_key(pi, ki, &k) != 0) {
      break;
    }
    out[0] = pi;
    out[1] = ki;
    memcpy(&out[2], k.title, LP_TITLE_LEN + 1);
    vendor_reply(cmd, out, 2 + LP_TITLE_LEN + 1);
    break;
  }
  case CMD_SET_TITLE: {
    uint8_t pi = p[0], ki = p[1];
    char tmp[LP_TITLE_LEN + 1];
    if (pi >= storage_n_profiles() || ki >= LP_N_KEYS) {
      break;
    }
    memset(tmp, 0, sizeof(tmp));
    memcpy(tmp, &p[2], LP_TITLE_LEN);
    if (storage_set_key_title_at(pi, ki, tmp) != 0) {
      break;
    }
    g_store.dirty = 1;
    ui_mark_dirty();
    vendor_reply(cmd, p, 2);
    break;
  }
  case CMD_SET_ACTIVE:
    /* Runtime slot only. Do not mark flash dirty — host auto-switch would
     * otherwise trip the OLED save prompt on every Alt-Tab. OLED profile
     * edits still call dirty() in ui.c. */
    if (p[0] < storage_n_profiles()) {
      storage_set_active(p[0]);
      ui_mark_dirty();
    }
    vendor_reply(cmd, p, 1);
    break;
  case CMD_ADD_PROFILE: {
    int idx = storage_add_profile();
    uint8_t st = 0;
    if (idx < 0) {
      st = 1;
      idx = 0;
    } else {
      ui_mark_dirty();
    }
    out[0] = (uint8_t)idx;
    out[1] = storage_n_profiles();
    out[2] = st;
    vendor_reply(cmd, out, 3);
    break;
  }
  case CMD_DEL_PROFILE: {
    uint8_t idx = p[0];
    int rc = storage_del_profile(idx);
    uint8_t st = 0;
    if (rc == -1) {
      st = 2;
    } else if (rc != 0) {
      st = 3;
    } else {
      ui_mark_dirty();
    }
    out[0] = idx;
    out[1] = storage_n_profiles();
    out[2] = g_store.active;
    out[3] = st;
    vendor_reply(cmd, out, 4);
    break;
  }
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
  case CMD_SET_HOST:
    ui_set_host_active(p[0] != 0);
    vendor_reply(cmd, p, 1);
    break;
  case CMD_SET_SCREEN: {
    uint8_t st = 0;
    if (p[0] > 10 || p[1] > 1 || p[2] > 4 || (p[3] & 0xFu) > 12u || ((p[3] >> 4) & 3u) > 3u ||
        ((p[3] >> 6) & 1u) > 1u) {
      st = 1;
    } else {
      g_store.contrast = p[0];
      g_store.flip = p[1];
      g_store.sleep = p[2];
      g_store.clock_style = p[3];
      ui_apply_screen();
      (void)storage_commit();
      g_store.dirty = 1;
      ui_mark_dirty();
    }
    out[0] = p[0];
    out[1] = p[1];
    out[2] = p[2];
    out[3] = p[3];
    out[4] = st;
    vendor_reply(cmd, out, 5);
    break;
  }
  case CMD_PREVIEW_CLOCK:
    ui_set_clock_preview(p[0] != 0);
    out[0] = p[0];
    vendor_reply(cmd, out, 1);
    break;
  case CMD_GET_LEDS: {
    led_snap_t snap;
    led_mux_snapshot(&snap);
    memcpy(&out[0], snap.color, 10);
    memcpy(&out[10], snap.duty, 10);
    out[20] = (uint8_t)snap.anim_ms;
    out[21] = (uint8_t)(snap.anim_ms >> 8);
    out[22] = (uint8_t)snap.idle_ms;
    out[23] = (uint8_t)(snap.idle_ms >> 8);
    out[24] = snap.flash_key;
    out[25] = (uint8_t)snap.flash_ms;
    out[26] = (uint8_t)(snap.flash_ms >> 8);
    out[27] = snap.ripple_key;
    out[28] = (uint8_t)snap.ripple_age;
    out[29] = (uint8_t)(snap.ripple_age >> 8);
    out[30] = snap.flood;
    vendor_reply(cmd, out, 31);
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
    if (pi >= storage_n_profiles() || ki >= LP_N_KEYS) {
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
