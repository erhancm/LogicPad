#include <stdint.h>

extern uint32_t _estack, _sidata, _sdata, _edata, _sbss, _ebss;
extern int main(void);
void Reset_Handler(void);
void Default_Handler(void);

void Default_Handler(void) {
  for (;;) {
  }
}

void Reset_Handler(void) {
  uint32_t *src = &_sidata;
  uint32_t *dst = &_sdata;
  while (dst < &_edata) {
    *dst++ = *src++;
  }
  dst = &_sbss;
  while (dst < &_ebss) {
    *dst++ = 0;
  }
  (void)main();
  for (;;) {
  }
}

__attribute__((section(".isr_vector"), used)) static const uint32_t vectors[] = {
    (uint32_t)&_estack,
    (uint32_t)Reset_Handler,
    (uint32_t)Default_Handler, /* NMI */
    (uint32_t)Default_Handler, /* HardFault */
    (uint32_t)Default_Handler,
    (uint32_t)Default_Handler,
    (uint32_t)Default_Handler,
    0,
    0,
    0,
    0,
    (uint32_t)Default_Handler, /* SVCall */
    (uint32_t)Default_Handler,
    0,
    (uint32_t)Default_Handler, /* PendSV */
    (uint32_t)Default_Handler, /* SysTick */
};
