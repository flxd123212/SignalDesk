/* STC89C52RC: probe P1.0, or connect an LED with a series resistor. */
__sbit __at (0x90) heartbeat;
void main(void) {
    volatile unsigned int delay;
    for (;;) {
        heartbeat = !heartbeat;
        for (delay = 0; delay < 30000; ++delay) {}
    }
}
