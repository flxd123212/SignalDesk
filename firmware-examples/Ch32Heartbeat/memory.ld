ENTRY(_start)
MEMORY {
  FLASH (rx) : ORIGIN = 0, LENGTH = 16K
  RAM (rw) : ORIGIN = 0x20000000, LENGTH = 2K
}
_stack_top = ORIGIN(RAM) + LENGTH(RAM);
SECTIONS {
  .text : { KEEP(*(.init)) *(.text*) *(.rodata*) } > FLASH
}
