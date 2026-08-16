#include "usb.h"
#include "lp_memmap.h"
#include "stm32f1xx.h"

#define EP_CTR_RX 0x8000u
#define EP_CTR_TX 0x0080u
#define EP_SETUP 0x0800u
#define EP_TYPE 0x0600u
#define EP_KIND 0x0100u
#define EP_ADDR 0x000Fu
#define EP_STAT_TX 0x0030u
#define EP_STAT_RX 0x3000u
#define EP_DTOG_TX 0x0040u
#define EP_DTOG_RX 0x4000u
#define EPREG_KEEP (EP_CTR_RX | EP_SETUP | EP_TYPE | EP_KIND | EP_CTR_TX | EP_ADDR)

#define STAT_TX_NAK 0x0020u
#define STAT_TX_VALID 0x0030u
#define STAT_RX_NAK 0x2000u
#define STAT_RX_VALID 0x3000u
#define STAT_TX_STALL 0x0010u
#define STAT_RX_STALL 0x1000u

#define TYPE_CTRL 0x0200u
#define TYPE_INT 0x0600u

#define PMA_EP0_TX 0x40u
#define PMA_EP0_RX 0x80u
#define PMA_EP1_TX 0xC0u
#define PMA_EP1_RX 0x100u
#define RX_BLK_64 0x8400u

static uint8_t hid_rx[64];
static uint8_t hid_rx_ready;
static uint8_t configured;
static uint8_t pending_addr;
static uint8_t addr_apply;
static const uint8_t *ep0_data;
static uint16_t ep0_len;
static uint8_t str_buf[40];

static volatile uint16_t *epr(uint8_t n) {
  return (volatile uint16_t *)(USB_BASE + 4u * n);
}

static volatile uint16_t *pma(uint16_t ofs) {
  return (volatile uint16_t *)(USB_PMAADDR + ((uint32_t)ofs << 1));
}

static volatile uint16_t *bt(uint8_t ep, uint8_t slot) {
  return pma((uint16_t)(ep * 8u + slot * 2u));
}

static uint16_t epr_rd(uint8_t n) { return *epr(n); }

static void epr_wr(uint8_t n, uint16_t v) { *epr(n) = v; }

static void set_stat_rx(uint8_t n, uint16_t st) {
  epr_wr(n, (uint16_t)((epr_rd(n) & (EP_STAT_RX | EPREG_KEEP)) ^ st));
}

static void set_stat_tx(uint8_t n, uint16_t st) {
  epr_wr(n, (uint16_t)((epr_rd(n) & (EP_STAT_TX | EPREG_KEEP)) ^ st));
}

static void clr_ctr_rx(uint8_t n) { epr_wr(n, (uint16_t)(epr_rd(n) & 0x7FFFu & EPREG_KEEP)); }

static void clr_ctr_tx(uint8_t n) { epr_wr(n, (uint16_t)(epr_rd(n) & 0xFF7Fu & EPREG_KEEP)); }

static void pma_write(uint16_t ofs, const uint8_t *src, uint16_t n) {
  volatile uint16_t *d = pma(ofs);
  uint16_t i;
  for (i = 0; i < n; i += 2) {
    uint16_t w = src[i];
    if (i + 1u < n) {
      w |= (uint16_t)src[i + 1u] << 8;
    }
    *d = w;
    d += 2;
  }
}

static void pma_read(uint16_t ofs, uint8_t *dst, uint16_t n) {
  volatile uint16_t *s = pma(ofs);
  uint16_t i;
  for (i = 0; i < n; i += 2) {
    uint16_t w = *s;
    dst[i] = (uint8_t)w;
    if (i + 1u < n) {
      dst[i + 1u] = (uint8_t)(w >> 8);
    }
    s += 2;
  }
}

static const uint8_t dev_desc[] = {
    18, 1, 0x00, 0x02, 0, 0, 0, 64, (uint8_t)LP_USB_VID, (uint8_t)(LP_USB_VID >> 8),
    (uint8_t)LP_USB_PID_BOOT, (uint8_t)(LP_USB_PID_BOOT >> 8), 0x00, 0x01, 1, 2, 0, 1};

static const uint8_t cfg_desc[] = {
    9, 2, 41, 0, 1, 1, 0, 0x80, 50, /* 9+9+9+7+7 = 41 */
    9, 4, 0, 0, 2, 3, 0, 0, 0,
    9, 0x21, 0x11, 0x01, 0, 1, 0x22, 29, 0,
    7, 5, 0x81, 3, 64, 0, 1,
    7, 5, 0x01, 3, 64, 0, 1};

static const uint8_t hid_report[] = {
    0x06, 0x00, 0xFF, 0x09, 0x01, 0xA1, 0x01, 0x85, 0x04, 0x09, 0x02, 0x15, 0x00,
    0x26, 0xFF, 0x00, 0x75, 0x08, 0x95, 0x3F, 0x91, 0x02, 0x09, 0x02, 0x95, 0x3F,
    0x81, 0x02, 0xC0};

static uint8_t utf16_str(const char *s) {
  uint8_t n = 0;
  while (s[n]) {
    n++;
  }
  uint8_t bytes = (uint8_t)(2u + n * 2u);
  str_buf[0] = bytes;
  str_buf[1] = 3;
  for (uint8_t i = 0; i < n; i++) {
    str_buf[2u + i * 2u] = (uint8_t)s[i];
    str_buf[3u + i * 2u] = 0;
  }
  return bytes;
}

static void ep0_in_chunk(void) {
  uint16_t n = ep0_len;
  if (n > 64u) {
    n = 64;
  }
  pma_write(PMA_EP0_TX, ep0_data, n);
  *bt(0, 1) = n;
  ep0_data += n;
  ep0_len = (uint16_t)(ep0_len - n);
  set_stat_tx(0, STAT_TX_VALID);
}

static void ep0_zlp(void) {
  *bt(0, 1) = 0;
  set_stat_tx(0, STAT_TX_VALID);
}

static void stall_ep0(void) {
  set_stat_tx(0, STAT_TX_STALL);
  set_stat_rx(0, STAT_RX_STALL);
}

static void handle_setup(void) {
  uint8_t req[8];
  uint16_t n = *bt(0, 3) & 0x3FFu;
  if (n > 8u) {
    n = 8;
  }
  pma_read(PMA_EP0_RX, req, n);
  clr_ctr_rx(0);
  set_stat_rx(0, STAT_RX_VALID);

  uint8_t bm = req[0], bReq = req[1];
  uint16_t wLen = (uint16_t)req[6] | ((uint16_t)req[7] << 8);
  uint8_t recip = bm & 0x1Fu;
  uint8_t type = (bm >> 5) & 3u;

  ep0_data = 0;
  ep0_len = 0;
  addr_apply = 0;

  if (type == 0 && bReq == 5 && recip == 0) { /* SET_ADDRESS */
    pending_addr = req[2];
    addr_apply = 1;
    ep0_zlp();
    return;
  }
  if (type == 0 && bReq == 9 && recip == 0) { /* SET_CONFIGURATION */
    configured = req[2] != 0;
    epr_wr(1, TYPE_INT | 1u | EP_CTR_RX | EP_CTR_TX);
    *bt(1, 0) = PMA_EP1_TX;
    *bt(1, 1) = 0;
    *bt(1, 2) = PMA_EP1_RX;
    *bt(1, 3) = RX_BLK_64;
    set_stat_tx(1, STAT_TX_NAK);
    set_stat_rx(1, STAT_RX_VALID);
    ep0_zlp();
    return;
  }
  if (type == 0 && bReq == 6) { /* GET_DESCRIPTOR */
    uint8_t dtype = req[3];
    uint8_t idx = req[2];
    const uint8_t *p = 0;
    uint16_t len = 0;
    if (dtype == 1) {
      p = dev_desc;
      len = sizeof(dev_desc);
    } else if (dtype == 2) {
      p = cfg_desc;
      len = sizeof(cfg_desc);
    } else if (dtype == 3) {
      if (idx == 0) {
        str_buf[0] = 4;
        str_buf[1] = 3;
        str_buf[2] = 0x09;
        str_buf[3] = 0x04;
        p = str_buf;
        len = 4;
      } else if (idx == 1) {
        len = utf16_str("LogicPad");
        p = str_buf;
      } else {
        len = utf16_str("LogicPad Boot");
        p = str_buf;
      }
    } else if (dtype == 0x22) {
      p = hid_report;
      len = sizeof(hid_report);
    } else if (dtype == 0x21) {
      p = &cfg_desc[18];
      len = 9;
    }
    if (p) {
      if (wLen < len) {
        len = wLen;
      }
      ep0_data = p;
      ep0_len = len;
      ep0_in_chunk();
      return;
    }
  }
  if (type == 0 && bReq == 0 && recip == 0) { /* GET_STATUS */
    str_buf[0] = 0;
    str_buf[1] = 0;
    ep0_data = str_buf;
    ep0_len = (wLen < 2u) ? wLen : 2u;
    ep0_in_chunk();
    return;
  }
  if (type == 0 && bReq == 8) { /* GET_CONFIGURATION */
    str_buf[0] = configured ? 1 : 0;
    ep0_data = str_buf;
    ep0_len = 1;
    if (wLen == 0) {
      ep0_zlp();
    } else {
      ep0_in_chunk();
    }
    return;
  }
  if (type == 1 && (bReq == 0x0A || bReq == 0x0B)) { /* SET_IDLE / SET_PROTOCOL */
    ep0_zlp();
    return;
  }
  stall_ep0();
}

static void handle_ctr(void) {
  uint16_t istr = USB->ISTR;
  uint8_t ep = (uint8_t)(istr & 0x0Fu);
  if (ep == 0) {
    if (istr & USB_ISTR_DIR) {
      if (epr_rd(0) & EP_SETUP) {
        handle_setup();
      } else {
        clr_ctr_rx(0);
        set_stat_rx(0, STAT_RX_VALID);
      }
    } else {
      clr_ctr_tx(0);
      if (addr_apply) {
        USB->DADDR = (uint16_t)(pending_addr | USB_DADDR_EF);
        addr_apply = 0;
      }
      if (ep0_len) {
        ep0_in_chunk();
      } else {
        set_stat_rx(0, STAT_RX_VALID);
      }
    }
    return;
  }
  if (ep == 1) {
    if (istr & USB_ISTR_DIR) {
      uint16_t n = *bt(1, 3) & 0x3FFu;
      if (n > 64u) {
        n = 64;
      }
      pma_read(PMA_EP1_RX, hid_rx, n);
      if (n < 64u) {
        uint16_t i;
        for (i = n; i < 64u; i++) {
          hid_rx[i] = 0;
        }
      }
      hid_rx_ready = 1;
      clr_ctr_rx(1);
      set_stat_rx(1, STAT_RX_VALID);
    } else {
      clr_ctr_tx(1);
      set_stat_tx(1, STAT_TX_NAK);
    }
  }
}

static void usb_reset(void) {
  configured = 0;
  hid_rx_ready = 0;
  USB->BTABLE = 0;
  USB->DADDR = USB_DADDR_EF;
  epr_wr(0, TYPE_CTRL | EP_CTR_RX | EP_CTR_TX);
  *bt(0, 0) = PMA_EP0_TX;
  *bt(0, 1) = 0;
  *bt(0, 2) = PMA_EP0_RX;
  *bt(0, 3) = RX_BLK_64;
  set_stat_tx(0, STAT_TX_NAK);
  set_stat_rx(0, STAT_RX_VALID);
}

void usb_init(void) {
  RCC->APB2ENR |= RCC_APB2ENR_IOPAEN;
  /* PA12 low = disconnect */
  GPIOA->CRH = (GPIOA->CRH & ~(0xFu << 16)) | (0x1u << 16);
  GPIOA->BRR = (1u << 12);
  {
    volatile uint32_t i;
    for (i = 0; i < 360000u; i++) {
    }
  }
  GPIOA->CRH = (GPIOA->CRH & ~(0xFu << 16)) | (0x4u << 16);

  RCC->APB1ENR |= RCC_APB1ENR_USBEN;
  USB->CNTR = USB_CNTR_FRES | USB_CNTR_PDWN;
  {
    volatile uint32_t i;
    for (i = 0; i < 200u; i++) {
    }
  }
  USB->CNTR = USB_CNTR_FRES;
  {
    volatile uint32_t i;
    for (i = 0; i < 20u; i++) {
    }
  }
  USB->CNTR = 0;
  USB->ISTR = 0;
  usb_reset();
}

void usb_off(void) {
  USB->CNTR = USB_CNTR_FRES | USB_CNTR_PDWN;
}

void usb_poll(void) {
  uint16_t istr = USB->ISTR;
  if (istr & USB_ISTR_RESET) {
    USB->ISTR = (uint16_t)~USB_ISTR_RESET;
    usb_reset();
  }
  if (istr & USB_ISTR_CTR) {
    handle_ctr();
  }
  if (istr & USB_ISTR_SUSP) {
    USB->ISTR = (uint16_t)~USB_ISTR_SUSP;
  }
  if (istr & USB_ISTR_WKUP) {
    USB->ISTR = (uint16_t)~USB_ISTR_WKUP;
  }
}

int usb_hid_take(uint8_t out[64]) {
  if (!hid_rx_ready) {
    return 0;
  }
  hid_rx_ready = 0;
  for (uint8_t i = 0; i < 64u; i++) {
    out[i] = hid_rx[i];
  }
  return 1;
}

void usb_hid_send(const uint8_t in[64]) {
  if (!configured) {
    return;
  }
  pma_write(PMA_EP1_TX, in, 64);
  *bt(1, 1) = 64;
  set_stat_tx(1, STAT_TX_VALID);
}
