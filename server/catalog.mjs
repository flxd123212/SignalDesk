// Catalog entries describe targets, not a promise that a programmer is installed.
export const chipCatalog = [
  { id: 'esp32', name: 'ESP32', tool: 'esptool', adapter: 'esp32', chips: ['esp32', 'esp32s2', 'esp32s3', 'esp32c2', 'esp32c3', 'esp32c5', 'esp32c6', 'esp32h2', 'esp32p4'], boards: ['ESP32 DevKitC', 'ESP32-S3-DevKitC-1', 'ESP32-C3-DevKitM-1', 'ESP32-C6-DevKitC-1'] },
  { id: 'esp8266', name: 'ESP8266 / ESP8285', tool: 'esptool', adapter: 'esp8266', chips: ['esp8266', 'ESP8285'], boards: ['NodeMCU 1.0', 'LOLIN D1 mini', 'ESP-01S'] },
  { id: 'stm32', name: 'STM32', tool: 'STM32CubeProgrammer', adapter: 'stm32', chips: ['STM32C011F6', 'STM32F030F4', 'STM32F103C8', 'STM32F103RB', 'STM32F303RE', 'STM32F401CC', 'STM32F407VG', 'STM32F411CE', 'STM32F446RE', 'STM32F767ZI', 'STM32G030F6', 'STM32G071RB', 'STM32G431CB', 'STM32G474RE', 'STM32H743VI', 'STM32H750VB', 'STM32H723ZG', 'STM32L053C8', 'STM32L072CZ', 'STM32L432KC', 'STM32L476RG', 'STM32U575ZI', 'STM32WB55RG', 'STM32WL55JC'], boards: ['Blue Pill', 'Black Pill', 'NUCLEO-F103RB', 'NUCLEO-F401RE', 'NUCLEO-F446RE', 'NUCLEO-H743ZI2'] },
  { id: 'avr', name: 'AVR / Arduino', tool: 'avrdude', adapter: 'avr', chips: ['ATmega328P', 'ATmega168', 'ATmega2560', 'ATmega32U4', 'ATmega1284P', 'ATtiny85', 'ATtiny84'], boards: ['Arduino Uno R3', 'Arduino Nano', 'Arduino Mega 2560', 'Arduino Leonardo', 'Arduino Micro'] },
  { id: 'rp2', name: 'RP2040 / RP2350', tool: 'picotool / UF2 外部下载', chips: ['RP2040', 'RP2350'], boards: ['Raspberry Pi Pico', 'Raspberry Pi Pico W', 'Raspberry Pi Pico 2', 'Raspberry Pi Pico 2 W'] },
  { id: 'stc', name: 'STC 8051', tool: 'Keil C51 构建 / STC-ISP 外部下载', chips: ['STC89C52RC', 'STC89C51RC', 'STC12C5A60S2', 'STC15F2K60S2', 'STC8H8K64U', 'STC8G1K08A', 'STC8A8K64S4A12'], boards: [] },
  { id: 'c51', name: '8051 / C51', tool: 'Keil / IAR 工程工具链', chips: ['AT89C51', 'AT89C52', 'AT89S51', 'AT89S52', 'C8051F020', 'C8051F340', 'EFM8BB10F8'], boards: [] },
  { id: 'gd32', name: 'GigaDevice GD32', tool: 'Keil / IAR 工程工具链', chips: ['GD32F103C8', 'GD32F303CB', 'GD32F407VG', 'GD32E103CB', 'GD32F450VI', 'GD32VF103CB', 'GD32E230F4'], boards: [] },
  { id: 'wch', name: 'WCH CH32 / CH5', tool: 'MounRiver / WCH-Link 外部工具', chips: ['CH32V003F4P6', 'CH32V103C8T6', 'CH32V203C8T6', 'CH32V307VCT6', 'CH32F103C8T6', 'CH552G', 'CH554T', 'CH582M', 'CH592F'], boards: [] },
  { id: 'nrf', name: 'Nordic nRF', tool: 'Keil 工程 / nRF Connect 外部工具', chips: ['nRF51822', 'nRF52810', 'nRF52832', 'nRF52833', 'nRF52840', 'nRF5340', 'nRF9160'], boards: ['nRF52840 DK', 'nRF5340 DK'] },
  { id: 'nxp', name: 'NXP LPC / Kinetis / i.MX RT', tool: 'Keil / IAR 工程工具链', chips: ['LPC1114', 'LPC1768', 'LPC4330', 'LPC55S69', 'MKL25Z128', 'MK64FN1M0', 'MIMXRT1062'], boards: ['FRDM-KL25Z', 'FRDM-K64F'] },
  { id: 'nuvoton', name: 'Nuvoton', tool: 'Keil / IAR 工程工具链', chips: ['N76E003', 'MS51FB9AE', 'M031EC1AE', 'M0516LBN', 'M2351KIAAE', 'NUC140VE3CN'], boards: [] },
  { id: 'ti', name: 'TI MSP430 / MSPM0 / TM4C', tool: 'IAR 工程 / CCS 外部工具', chips: ['MSP430G2553', 'MSP430F5529', 'MSP430FR5969', 'MSPM0G3507', 'TM4C123GH6PM', 'CC1310', 'CC2652R'], boards: ['MSP-EXP430G2', 'MSP-EXP430F5529LP'] },
  { id: 'sam', name: 'Microchip SAM / PIC', tool: 'Keil 工程 / MPLAB 外部工具', chips: ['ATSAMD21G18', 'ATSAMD51J19', 'ATSAM3X8E', 'PIC16F877A', 'PIC18F4520', 'PIC32MX795F512L'], boards: ['Arduino Due', 'Arduino Zero'] },
  { id: 'renesas', name: 'Renesas RA / RX / RL78', tool: 'IAR 工程 / e2 studio 外部工具', chips: ['RA4M1', 'RA4M2', 'RA6M3', 'RA6M5', 'RX63N', 'RL78G13'], boards: ['Arduino Uno R4 Minima', 'Arduino Uno R4 WiFi'] },
  { id: 'at32', name: 'Artery AT32', tool: 'Keil / IAR 工程工具链', chips: ['AT32F403A', 'AT32F407', 'AT32F415', 'AT32F421', 'AT32F435', 'AT32F437'], boards: [] },
  { id: 'hc32', name: 'HDSC HC32', tool: 'Keil / IAR 工程工具链', chips: ['HC32L110', 'HC32L130', 'HC32F003', 'HC32F030', 'HC32F460', 'HC32F4A0'], boards: [] },
  { id: 'mm32', name: 'MindMotion MM32', tool: 'Keil / IAR 工程工具链', chips: ['MM32F003', 'MM32F0130', 'MM32F103', 'MM32F3270', 'MM32F5270'], boards: [] },
];

export function chipFamily(chip = '') {
  const value = chip.toUpperCase();
  const prefixes = [['ESP8266', 'esp8266'], ['ESP8285', 'esp8266'], ['ESP32', 'esp32'], ['STM32', 'stm32'], ['ATMEGA', 'avr'], ['ATTINY', 'avr'], ['RP20', 'rp2'], ['RP23', 'rp2'], ['STC', 'stc'], ['AT89', 'c51'], ['C8051', 'c51'], ['EFM8', 'c51'], ['GD32', 'gd32'], ['CH32', 'wch'], ['CH5', 'wch'], ['NRF', 'nrf'], ['LPC', 'nxp'], ['MKL', 'nxp'], ['MK64', 'nxp'], ['MIMX', 'nxp'], ['N76', 'nuvoton'], ['MS51', 'nuvoton'], ['NUC', 'nuvoton'], ['M031', 'nuvoton'], ['M051', 'nuvoton'], ['M235', 'nuvoton'], ['MSP', 'ti'], ['TM4', 'ti'], ['CC13', 'ti'], ['CC26', 'ti'], ['ATSAM', 'sam'], ['PIC', 'sam'], ['RA4', 'renesas'], ['RA6', 'renesas'], ['RX6', 'renesas'], ['RL78', 'renesas'], ['AT32', 'at32'], ['HC32', 'hc32'], ['MM32', 'mm32']];
  return prefixes.find(([prefix]) => value.startsWith(prefix))?.[1] || '';
}
