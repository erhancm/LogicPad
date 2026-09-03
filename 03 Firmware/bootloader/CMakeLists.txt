cmake_minimum_required(VERSION 3.22)
set(CMAKE_SYSTEM_NAME Generic)
set(CMAKE_SYSTEM_PROCESSOR arm)
set(CMAKE_TRY_COMPILE_TARGET_TYPE STATIC_LIBRARY)
set(CMAKE_C_COMPILER arm-none-eabi-gcc)
set(CMAKE_ASM_COMPILER arm-none-eabi-gcc)
cmake_minimum_required(VERSION 3.22)
set(CMAKE_SYSTEM_NAME Generic)
set(CMAKE_SYSTEM_PROCESSOR arm)
set(CMAKE_TRY_COMPILE_TARGET_TYPE STATIC_LIBRARY)
set(CMAKE_C_COMPILER arm-none-eabi-gcc)
set(CMAKE_ASM_COMPILER arm-none-eabi-gcc)
set(CMAKE_OBJCOPY arm-none-eabi-objcopy)
set(CMAKE_SIZE arm-none-eabi-size)
set(CMAKE_C_FLAGS_RELEASE "-Os -DNDEBUG")
set(CMAKE_C_FLAGS_DEBUG "-Os -g3")

project(LogicPadBoot C)

add_executable(bootloader
    startup.c
    boot.c
    usb.c
    oled.c
)

target_include_directories(bootloader PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}
    ${CMAKE_CURRENT_SOURCE_DIR}/../Firmware/Core/Inc
    ${CMAKE_CURRENT_SOURCE_DIR}/../Firmware/Drivers/CMSIS/Device/ST/STM32F1xx/Include
    ${CMAKE_CURRENT_SOURCE_DIR}/../Firmware/Drivers/CMSIS/Include
)

target_compile_definitions(bootloader PRIVATE STM32F103xB)
target_compile_options(bootloader PRIVATE
    -mcpu=cortex-m3 -mthumb -Os -ffunction-sections -fdata-sections
    -fno-builtin -Wall -ffreestanding -flto
)
target_link_options(bootloader PRIVATE
    -mcpu=cortex-m3 -mthumb -nostartfiles -nostdlib -flto -Os
    -T${CMAKE_CURRENT_SOURCE_DIR}/STM32F103XX_BOOT.ld
    -Wl,--gc-sections -Wl,--print-memory-usage
    -Wl,-Map=${CMAKE_CURRENT_BINARY_DIR}/bootloader.map
)
set_target_properties(bootloader PROPERTIES SUFFIX ".elf" OUTPUT_NAME bootloader)

add_custom_command(TARGET bootloader POST_BUILD
    COMMAND ${CMAKE_OBJCOPY} -O binary $<TARGET_FILE:bootloader> ${CMAKE_CURRENT_BINARY_DIR}/bootloader.bin
    COMMAND ${CMAKE_OBJCOPY} -O ihex $<TARGET_FILE:bootloader> ${CMAKE_CURRENT_BINARY_DIR}/bootloader.hex
    COMMAND ${CMAKE_SIZE} $<TARGET_FILE:bootloader>
)
