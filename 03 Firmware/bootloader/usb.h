#ifndef LP_BOOT_USB_H
#define LP_BOOT_USB_H

#include <stdint.h>

void usb_init(void);
void usb_poll(void);
void usb_off(void);
int usb_hid_take(uint8_t out[64]);
void usb_hid_send(const uint8_t in[64]);

#endif
