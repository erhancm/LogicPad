#ifndef HID_REPORTS_H
#define HID_REPORTS_H

#include <stdint.h>

#define HID_RID_KBD 1
#define HID_RID_MOUSE 2
#define HID_RID_CONS 3
#define HID_RID_VENDOR 4

#define HID_VENDOR_PAYLOAD 63

#define CMD_PING 0x01
#define CMD_GET_META 0x02
#define CMD_GET_KEY 0x03
#define CMD_SET_KEY 0x04
#define CMD_SET_ACTIVE 0x05
#define CMD_SAVE 0x06
#define CMD_RELOAD 0x07
#define CMD_FACTORY 0x08
#define CMD_GET_PROFILE_HDR 0x09
#define CMD_SET_PROFILE_HDR 0x0A
#define CMD_GET_STATUS 0x0B
#define CMD_ENTER_BOOTLOADER 0x0C
#define CMD_KEY_EVENT 0x0D
#define CMD_SET_TIME 0x0E
#define CMD_GET_TEXT 0x0F
#define CMD_SET_TEXT 0x10
#define CMD_ADD_PROFILE 0x11
#define CMD_DEL_PROFILE 0x12

void hid_init(void);
void hid_tick(void);
int hid_configured(void);
int hid_in_ready(void);
int hid_vendor_session(void);
void hid_notify_key(uint8_t profile, uint8_t key, uint8_t down);
int hid_kbd_send(uint8_t mods, const uint8_t keys[6]);
int hid_kbd_release(void);
int hid_mouse_send(uint8_t buttons, int8_t x, int8_t y, int8_t wheel);
int hid_consumer_send(uint16_t usage);
int hid_consumer_release(void);
void hid_vendor_on_out(const uint8_t *buf, uint16_t len);

#endif
