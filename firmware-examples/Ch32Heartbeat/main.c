/* CH32V003F4P6 PC4 output, reset clock, polling only. */
#define REG(addr) (*(volatile unsigned int *)(addr))
int main(void) {
    REG(0x40021018) |= 1u << 4;
    REG(0x40011000) = (REG(0x40011000) & ~(15u << 16)) | (2u << 16);
    for (;;) {
        REG(0x4001100c) ^= 1u << 4;
        for (volatile unsigned int delay = 0; delay < 80000; ++delay) {}
    }
}
