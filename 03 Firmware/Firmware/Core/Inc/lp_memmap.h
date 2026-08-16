#ifndef LP_MEMMAP_H
#define LP_MEMMAP_H

/* STM32F103C8: 64 KB flash. Last 8 KB is the ping-pong config store.
 * 4 KB HID bootloader at the start so the app can be rewritten over USB.
 * The F103 medium-density ROM bootloader is USART-only — no USB DFU. */

#define LP_FLASH_BASE 0x08000000u
#define LP_BOOT_SIZE 0x1000u
#define LP_APP_BASE (LP_FLASH_BASE + LP_BOOT_SIZE) /* 0x08001000 */
#define LP_STORE_BASE 0x0800E000u
#define LP_APP_MAX (LP_STORE_BASE - LP_APP_BASE)   /* 52 KB */

#define LP_BL_MAGIC 0x4C50424Cu /* 'LPBL' */
#define LP_BL_MAGIC_ADDR 0x20004FFCu /* last word of 20 KB SRAM, survives SW reset */

#define LP_USB_VID 0x0483u
#define LP_USB_PID_APP 0x5750u
#define LP_USB_PID_BOOT 0x5751u

#define CMD_BL_START 0x40u
#define CMD_BL_DATA 0x41u
#define CMD_BL_FINISH 0x42u
#define CMD_BL_ABORT 0x43u

#define BL_ST_OK 0u
#define BL_ST_BAD_SIZE 1u
#define BL_ST_BAD_VEC 2u
#define BL_ST_FLASH 3u
#define BL_ST_CRC 4u
#define BL_ST_STATE 5u

#endif
