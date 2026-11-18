/* STM8S003F3: PD3 push-pull heartbeat. */
#define PD_ODR (*(volatile unsigned char *)0x500f)
#define PD_DDR (*(volatile unsigned char *)0x5011)
#define PD_CR1 (*(volatile unsigned char *)0x5012)
void main(void) {
    volatile unsigned int delay;
    PD_DDR |= 8;
    PD_CR1 |= 8;
    for (;;) {
        PD_ODR ^= 8;
        for (delay = 0; delay < 25000; ++delay) {}
    }
}
