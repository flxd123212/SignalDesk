/* STM32F103C8, SSD1306 128x64 at 0x3c. PB6=SCL, PB7=SDA, external
 * pull-ups to 3.3 V. Connect PA0 to ground momentarily to change page. */
#include <stdint.h>
#define REG(addr) (*(volatile uint32_t *)(addr))
#define SCL (1u << 6)
#define SDA (1u << 7)
#define PORTB_SET REG(0x40010c10)
#define PORTB_IN REG(0x40010c08)
static void pause_bus(void) { for (volatile unsigned n=0; n<12; n++) {} }
static void drive(unsigned pin, unsigned high) { PORTB_SET = high ? pin : pin<<16; pause_bus(); }
static void start(void) { drive(SDA,1); drive(SCL,1); drive(SDA,0); drive(SCL,0); }
static void stop(void) { drive(SDA,0); drive(SCL,1); drive(SDA,1); }
static unsigned send_byte(unsigned value) {
    for (unsigned mask=128; mask; mask>>=1) {
        drive(SDA,value & mask); drive(SCL,1); drive(SCL,0);
    }
    drive(SDA,1); drive(SCL,1);
    unsigned ack = !(PORTB_IN & SDA);
    drive(SCL,0); return ack;
}
static unsigned begin(unsigned control) { start(); return send_byte(0x78) && send_byte(control); }
static unsigned draw(unsigned page) {
    static const unsigned char init[] = {0xae,0xd5,0x80,0xa8,63,0xd3,0,0x40,0x8d,0x14,0x20,0,0xa1,0xc8,0xda,0x12,0x81,0x7f,0xd9,0xf1,0xdb,0x40,0xa4,0xa6,0x21,0,127,0x22,0,7,0xaf};
    unsigned ok=begin(0);
    for (unsigned i=0; ok && i<sizeof(init); i++) ok=send_byte(init[i]);
    stop(); if (!ok) return 0;
    ok=begin(0x40);
    for (unsigned y=0; ok && y<8; y++) for (unsigned x=0; ok && x<128; x++) {
        unsigned pixel = (y==0 || y==7 || x==0 || x==127) ? 0xff : ((x/12)%2 == page && y>1 && y<6 ? 0x7e : 0);
        ok=send_byte(pixel);
    }
    stop(); return ok;
}
void reset(void) {
    REG(0x40021018) |= (1u<<2) | (1u<<3);
    PORTB_SET=SCL|SDA;
    REG(0x40010c00)=(REG(0x40010c00)&0x00ffffffu)|0x66000000u;
    REG(0x40010810)=1; REG(0x40010800)=(REG(0x40010800)&~15u)|8u;
    unsigned page=0, previous=1, dirty=1;
    for (;;) {
        unsigned button=REG(0x40010808)&1u;
        if (previous && !button) { page^=1; dirty=1; }
        if (dirty) dirty=!draw(page);
        previous=button;
        for (volatile unsigned n=0; n<30000; n++) {}
    }
}
static void fault(void) { for (;;) {} }
__attribute__((section(".vectors"),used)) const uintptr_t vectors[16] = {
    0x20005000,(uintptr_t)reset,(uintptr_t)fault,(uintptr_t)fault
};
