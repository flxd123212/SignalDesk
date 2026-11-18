/* Synthetic memory regions for the compiler check. */
MEMORY
{
  FLASH (rx)  : ORIGIN = 0x10000, LENGTH = 64K
  RAM   (rw)  : ORIGIN = 0x20000000, LENGTH = 16K
}

SECTIONS
{
  .text : { *(.text .text.*) *(.rodata .rodata.*) } > FLASH
  .data : { *(.data .data.* .sdata .sdata.*) } > RAM AT> FLASH
  .bss (NOLOAD) : { *(.bss .bss.* .sbss .sbss.*) *(COMMON) } > RAM
}
