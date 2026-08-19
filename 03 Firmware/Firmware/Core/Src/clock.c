#include "clock.h"
#include "storage.h"
#include "main.h"

#define BKP_MAGIC 0x4C50u /* 'LP' */
#define DAY_SECS 86400u
#define HSE_RTC_PRL 62499u /* 8 MHz HSE / 128 → 1 Hz */
#define SAVE_MIN_MS 600000u /* 10 min between non-forced flash snaps */

static uint8_t ready;
static uint8_t wall; /* 1 = SET_TIME or restored snap, safe to persist */
static uint8_t save_req;
static uint32_t last_save_ms;
static uint16_t date_year = 2026;
static uint8_t date_mon = 8;
static uint8_t date_day = 16;

static uint8_t month_days(uint16_t y, uint8_t m) {
  static const uint8_t d[] = {31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31};
  if (m == 2 && ((y % 4u) == 0 && ((y % 100u) != 0 || (y % 400u) == 0))) {
    return 29;
  }
  if (m < 1 || m > 12) {
    return 31;
  }
  return d[m - 1];
}

static void date_add_days(uint32_t n) {
  while (n--) {
    if (++date_day <= month_days(date_year, date_mon)) {
      continue;
    }
    date_day = 1;
    if (++date_mon <= 12) {
      continue;
    }
    date_mon = 1;
    date_year++;
  }
}

static int wait_flag(volatile uint32_t *reg, uint32_t bit, uint32_t set, uint32_t ms) {
  uint32_t t0 = HAL_GetTick();
  while ((((*reg & bit) != 0u) ? 1u : 0u) != set) {
    if ((HAL_GetTick() - t0) > ms) {
      return 0;
    }
  }
  return 1;
}

static int rtc_sync(void) {
  RTC->CRL &= (uint16_t)~RTC_CRL_RSF;
  return wait_flag(&RTC->CRL, RTC_CRL_RSF, 1, 100);
}

static int rtc_enter(void) {
  if (!wait_flag(&RTC->CRL, RTC_CRL_RTOFF, 1, 100)) {
    return 0;
  }
  RTC->CRL |= RTC_CRL_CNF;
  return 1;
}

static int rtc_exit(void) {
  RTC->CRL &= (uint16_t)~RTC_CRL_CNF;
  return wait_flag(&RTC->CRL, RTC_CRL_RTOFF, 1, 100);
}

static uint32_t rtc_read_cnt(void) {
  uint16_t h1, h2, lo;
  h1 = (uint16_t)RTC->CNTH;
  lo = (uint16_t)RTC->CNTL;
  h2 = (uint16_t)RTC->CNTH;
  if (h1 != h2) {
    lo = (uint16_t)RTC->CNTL;
    h1 = h2;
  }
  return ((uint32_t)h1 << 16) | lo;
}

static int rtc_write_cnt(uint32_t cnt) {
  if (!rtc_enter()) {
    return 0;
  }
  RTC->CNTH = (uint16_t)(cnt >> 16);
  RTC->CNTL = (uint16_t)cnt;
  return rtc_exit();
}

static void bkp_store(void) {
  BKP->DR1 = BKP_MAGIC;
  BKP->DR2 = date_year;
  BKP->DR3 = (uint32_t)date_mon | ((uint32_t)date_day << 8);
  BKP->DR4 = wall ? 1u : 0u;
}

static int bkp_load(void) {
  if ((uint16_t)BKP->DR1 != BKP_MAGIC) {
    return 0;
  }
  uint16_t y = (uint16_t)BKP->DR2;
  uint8_t mo = (uint8_t)BKP->DR3;
  uint8_t d = (uint8_t)(BKP->DR3 >> 8);
  if (y < 2000 || mo < 1 || mo > 12 || d < 1 || d > month_days(y, mo)) {
    return 0;
  }
  date_year = y;
  date_mon = mo;
  date_day = d;
  wall = (uint8_t)(BKP->DR4 & 1u);
  return 1;
}

static int rtc_setup(void) {
  __HAL_RCC_PWR_CLK_ENABLE();
  __HAL_RCC_BKP_CLK_ENABLE();
  HAL_PWR_EnableBkUpAccess();

  if (!wait_flag(&RCC->CR, RCC_CR_HSERDY, 1, 200)) {
    return 0;
  }

  uint32_t sel = RCC->BDCR & RCC_BDCR_RTCSEL;
  int first = (sel != RCC_BDCR_RTCSEL_HSE) || ((RCC->BDCR & RCC_BDCR_RTCEN) == 0);

  if (sel != 0u && sel != RCC_BDCR_RTCSEL_HSE) {
    RCC->BDCR |= RCC_BDCR_BDRST;
    RCC->BDCR &= ~RCC_BDCR_BDRST;
    first = 1;
  }

  RCC->BDCR = (RCC->BDCR & ~RCC_BDCR_RTCSEL) | RCC_BDCR_RTCSEL_HSE | RCC_BDCR_RTCEN;

  if (!rtc_sync()) {
    return 0;
  }

  if (first) {
    if (!rtc_enter()) {
      return 0;
    }
    RTC->PRLH = 0;
    RTC->PRLL = (uint16_t)HSE_RTC_PRL;
    if (!rtc_exit()) {
      return 0;
    }
  }
  return 1;
}

static void apply_cnt_rollover(void) {
  uint32_t cnt = rtc_read_cnt();
  uint32_t days = cnt / DAY_SECS;
  if (days) {
    date_add_days(days);
    rtc_write_cnt(cnt % DAY_SECS);
    bkp_store();
  }
}

static void persist(int force) {
  if (!ready || !wall) {
    return;
  }
  uint32_t now = HAL_GetTick();
  if (!force && last_save_ms && (now - last_save_ms) < SAVE_MIN_MS) {
    return;
  }
  uint16_t y;
  uint8_t mo, d, h, mi, s;
  if (!clock_get(&y, &mo, &d, &h, &mi, &s)) {
    return;
  }
  if (storage_clock_store(y, mo, d, h, mi, s, force) == 0) {
    last_save_ms = now;
  }
}

static void apply_wall(uint16_t year, uint8_t month, uint8_t day, uint8_t hour, uint8_t min,
                       uint8_t sec, int is_wall, int save) {
  if (year < 2000) {
    year = 2000;
  }
  if (month < 1 || month > 12) {
    month = 1;
  }
  uint8_t md = month_days(year, month);
  if (day < 1 || day > md) {
    day = 1;
  }
  if (hour > 23) {
    hour = 0;
  }
  if (min > 59) {
    min = 0;
  }
  if (sec > 59) {
    sec = 0;
  }
  date_year = year;
  date_mon = month;
  date_day = day;
  wall = is_wall ? 1 : 0;
  if (ready) {
    rtc_write_cnt((uint32_t)hour * 3600u + (uint32_t)min * 60u + sec);
    bkp_store();
    if (save) {
      persist(1);
    } else {
      last_save_ms = HAL_GetTick();
    }
  }
}

void clock_init(void) {
  if (!rtc_setup()) {
    return;
  }
  ready = 1;

  uint16_t y;
  uint8_t mo, d, h, mi, s;
  if (bkp_load()) {
    apply_cnt_rollover();
    return;
  }

  if (storage_clock_load(&y, &mo, &d, &h, &mi, &s) == 0) {
    apply_wall(y, mo, d, h, mi, s, 1, 0);
    return;
  }

  apply_wall(2026, 8, 16, 0, 0, 0, 0, 0);
}

void clock_set(uint16_t year, uint8_t month, uint8_t day, uint8_t hour, uint8_t min,
               uint8_t sec) {
  apply_wall(year, month, day, hour, min, sec, 1, 1);
}

int clock_get(uint16_t *year, uint8_t *month, uint8_t *day, uint8_t *hour, uint8_t *min,
              uint8_t *sec) {
  if (!ready) {
    return 0;
  }
  apply_cnt_rollover();
  uint32_t cnt = rtc_read_cnt();
  if (cnt >= DAY_SECS) {
    cnt %= DAY_SECS;
  }
  if (year) {
    *year = date_year;
  }
  if (month) {
    *month = date_mon;
  }
  if (day) {
    *day = date_day;
  }
  if (hour) {
    *hour = (uint8_t)(cnt / 3600u);
  }
  if (min) {
    *min = (uint8_t)((cnt % 3600u) / 60u);
  }
  if (sec) {
    *sec = (uint8_t)(cnt % 60u);
  }
  return 1;
}

void clock_request_save(void) {
  save_req = 1;
}

void clock_save_now(int force) {
  persist(force);
}

void clock_poll(void) {
  if (save_req) {
    save_req = 0;
    persist(0);
  }
  if (wall && last_save_ms && (HAL_GetTick() - last_save_ms) >= SAVE_MIN_MS) {
    persist(0);
  }
}

void clock_on_store_written(void) {
  persist(1);
}
