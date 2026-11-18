# GCC 交叉编译链路验证

这是编译器和链接器验证样例，不是可直接烧录的板级固件。

在 SignalDesk 添加本目录，选择 ARM Cortex-M4 或 RISC-V RV32IMAC 工具链目标。在“构建与测试”的设置中选择实际安装的交叉编译器，先配置 GCC 工程，再编译。产物页会列出 ELF 和 MAP，并读取 ELF 头显示目标架构。

- ARM 样例：`arm-none-eabi-gcc`，Cortex-M4、Thumb、soft float。
- RISC-V 样例：`riscv32-unknown-elf-gcc`，RV32IMAC、ILP32。
- 所有样例使用 `-Wall -Wextra -Werror -Wconversion`。
- ELF 入口为 `probe`。`probe.ld` 使用示例分区（64 KiB Flash、16 KiB RAM），可在编译后按 `Shift+F8` 查看链接占用。移植到开发板时需使用板级内存布局和启动文件。
- 实际工程应使用对应芯片的启动文件、链接脚本、SDK/HAL 和 CPU/ABI 配置；支持 ESP32 的工程优先使用 ESP-IDF 或 PlatformIO。
