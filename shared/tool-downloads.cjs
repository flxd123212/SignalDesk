const arduino = { win32: { x64: 'Windows_64bit.zip' }, darwin: { arm64: 'macOS_ARM64.tar.gz', x64: 'macOS_64bit.tar.gz' }, linux: { arm64: 'Linux_ARM64.tar.gz', x64: 'Linux_64bit.tar.gz' } };
function sources(platform = process.platform, arch = process.arch) {
  const archive = arduino[platform]?.[arch];
  return {
    'arduino-cli': archive ? `https://downloads.arduino.cc/arduino-cli/arduino-cli_1.2.2_${archive}` : 'https://arduino.github.io/arduino-cli/latest/installation/',
    platformio: 'https://platformio.org/install/cli', cmake: 'https://cmake.org/download/', ninja: 'https://github.com/ninja-build/ninja/releases',
    'arm-none-eabi-gcc': 'https://developer.arm.com/downloads/-/arm-gnu-toolchain-downloads',
    'esp-idf': 'https://docs.espressif.com/projects/esp-idf/en/stable/esp32/get-started/',
    openocd: 'https://openocd.org/pages/getting-openocd.html', 'dfu-util': 'https://dfu-util.sourceforge.net/releases/',
    keil: 'https://www.keil.com/download/', iar: 'https://www.iar.com/',
  };
}
module.exports = { sources };
