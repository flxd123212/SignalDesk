cmake_minimum_required(VERSION 3.20)
project(CrossCompileCheck C)

add_executable(compile_check src/probe.c)
set_target_properties(compile_check PROPERTIES SUFFIX ".elf")
target_compile_options(compile_check PRIVATE -Wall -Wextra -Werror -Wconversion -ffreestanding)
set(probe_layout "${CMAKE_CURRENT_SOURCE_DIR}/probe.ld")
set_property(TARGET compile_check APPEND PROPERTY LINK_DEPENDS "${probe_layout}")
target_link_options(compile_check PRIVATE -nostdlib -Wl,--entry=probe "-Wl,-T,${probe_layout}" -Wl,--print-memory-usage "-Wl,-Map=${CMAKE_CURRENT_BINARY_DIR}/compile_check.map")
