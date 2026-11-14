#include <stdint.h>

/* Compiler/linker smoke check only; no board startup or peripheral drivers. */
volatile uint32_t probe_result;

static uint32_t adc_to_millivolts(uint32_t sample)
{
    if (sample > 4095u) {
        sample = 4095u;
    }
    return (sample * 3300u + 2047u) / 4095u;
}

void probe(void)
{
    probe_result = adc_to_millivolts(2048u);
    for (;;) {
        /* Deliberately no hardware access in this compile-only example. */
    }
}
