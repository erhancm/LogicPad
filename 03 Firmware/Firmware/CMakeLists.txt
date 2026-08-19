cmake_minimum_required(VERSION 3.22)

#
# This file is generated only once,
# and is not re-generated if converter is called multiple times.
#
# User is free to modify the file as much as necessary
#

# Setup compiler settings
set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_C_EXTENSIONS ON)


# Define the build type
if(NOT CMAKE_BUILD_TYPE)
    set(CMAKE_BUILD_TYPE "Debug")
endif()

# Set the project name
set(CMAKE_PROJECT_NAME LogicPad)

# Enable compile command to ease indexing with e.g. clangd
set(CMAKE_EXPORT_COMPILE_COMMANDS TRUE)

# Core project settings
project(${CMAKE_PROJECT_NAME})
message("Build type: " ${CMAKE_BUILD_TYPE})

# Enable CMake support for ASM and C languages
enable_language(C ASM)

# Create an executable object type
add_executable(${CMAKE_PROJECT_NAME})

# Add STM32CubeMX generated sources
add_subdirectory(cmake/stm32cubemx)

# Link directories setup
target_link_directories(${CMAKE_PROJECT_NAME} PRIVATE
    # Add user defined library search paths
)

# Add sources to executable
target_sources(${CMAKE_PROJECT_NAME} PRIVATE
    Core/Src/ssd1306.c
    Core/Src/ssd1306_fonts.c
    Core/Src/keypad.c
    Core/Src/storage.c
    Core/Src/hid_reports.c
    Core/Src/macro.c
    Core/Src/led_mux.c
    Core/Src/ui.c
    Core/Src/clock.c
)

# Add include paths
target_include_directories(${CMAKE_PROJECT_NAME} PRIVATE
    # Add user defined include paths
)

# Add project symbols (macros)
target_compile_definitions(${CMAKE_PROJECT_NAME} PRIVATE
    # Add user defined symbols
)

# Remove wrong libob.a library dependency when using cpp files
list(REMOVE_ITEM CMAKE_C_IMPLICIT_LINK_LIBRARIES ob)

# Add linked libraries
target_link_libraries(${CMAKE_PROJECT_NAME}
    stm32cubemx

    # Add user defined libraries
)

add_custom_command(TARGET ${CMAKE_PROJECT_NAME} POST_BUILD
    COMMAND ${CMAKE_OBJCOPY} -O binary $<TARGET_FILE:${CMAKE_PROJECT_NAME}> ${CMAKE_CURRENT_BINARY_DIR}/LogicPad.bin
    COMMAND ${CMAKE_OBJCOPY} -O ihex $<TARGET_FILE:${CMAKE_PROJECT_NAME}> ${CMAKE_CURRENT_BINARY_DIR}/LogicPad.hex
    COMMENT "LogicPad.bin is the app image for the Tauri updater (origin 0x08001000)"
)

set(LP_BOOTLOADER_BIN "${CMAKE_CURRENT_SOURCE_DIR}/../bootloader/build/Release/bootloader.bin")
set(LP_PACK "${CMAKE_CURRENT_SOURCE_DIR}/../pack_factory.ps1")
if(EXISTS "${LP_PACK}")
  add_custom_command(TARGET ${CMAKE_PROJECT_NAME} POST_BUILD
      COMMAND powershell -NoProfile -ExecutionPolicy Bypass -File "${LP_PACK}"
          -Bl "${LP_BOOTLOADER_BIN}"
          -App "${CMAKE_CURRENT_BINARY_DIR}/LogicPad.bin"
          -OutBin "${CMAKE_CURRENT_BINARY_DIR}/LogicPad_factory.bin"
          -OutHex "${CMAKE_CURRENT_BINARY_DIR}/LogicPad_factory.hex"
          -ObjCopy "${CMAKE_OBJCOPY}"
      COMMENT "LogicPad_factory.hex = bootloader + app (first ST-Link flash)"
  )
endif()
