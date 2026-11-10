# PULSE M5Dial NFC bridge — project-level CMakeLists
cmake_minimum_required(VERSION 3.16)

include($ENV{IDF_PATH}/tools/cmake/project.cmake)
project(m5dial_nfc_bridge)

# Stamp-S3 and Stamp-S3A are ESP32-S3FN8 (8 MB quad flash, no PSRAM in the
# official specs). Stop the build if menuconfig drifts back to QIO, a larger
# flash size, or PSRAM.
set(_sdk "${CMAKE_SOURCE_DIR}/sdkconfig")
if(NOT EXISTS "${_sdk}")
    message(FATAL_ERROR "M5Dial sdkconfig was not generated")
endif()
file(READ "${_sdk}" _sdk_txt)
set(_m5dial_need
    "CONFIG_IDF_TARGET_ESP32S3=y"
    "CONFIG_ESPTOOLPY_FLASHSIZE_8MB=y"
    "CONFIG_ESPTOOLPY_FLASHMODE_DIO=y"
    "CONFIG_ESPTOOLPY_FLASHFREQ_80M=y"
    "CONFIG_PARTITION_TABLE_CUSTOM=y"
    "CONFIG_ESP_CONSOLE_SECONDARY_NONE=y"
)
foreach(_item IN LISTS _m5dial_need)
    string(FIND "${_sdk_txt}" "${_item}" _pos)
    if(_pos EQUAL -1)
        message(FATAL_ERROR "M5Dial sdkconfig missing ${_item}")
    endif()
endforeach()
string(FIND "${_sdk_txt}" "# CONFIG_SPIRAM is not set" _pos)
if(_pos EQUAL -1)
    message(FATAL_ERROR "M5Dial sdkconfig must leave PSRAM disabled")
endif()
set(_m5dial_forbid
    "CONFIG_ESPTOOLPY_FLASHSIZE_32MB=y"
    "CONFIG_ESPTOOLPY_FLASHSIZE_16MB=y"
    "CONFIG_ESPTOOLPY_FLASHSIZE_4MB=y"
    "CONFIG_ESPTOOLPY_FLASHSIZE_2MB=y"
    "CONFIG_ESPTOOLPY_FLASHMODE_QIO=y"
    "CONFIG_ESPTOOLPY_FLASHMODE_QOUT=y"
    "CONFIG_ESPTOOLPY_FLASHMODE_DOUT=y"
    "CONFIG_SPIRAM=y"
    "CONFIG_SPIRAM_MODE_OCT=y"
    "CONFIG_USJ_ENABLE_USB_SERIAL_JTAG=y"
    "CONFIG_ESP_CONSOLE_SECONDARY_USB_SERIAL_JTAG=y"
)
foreach(_item IN LISTS _m5dial_forbid)
    string(FIND "${_sdk_txt}" "${_item}" _pos)
    if(NOT _pos EQUAL -1)
        message(FATAL_ERROR "M5Dial sdkconfig contains ${_item}")
    endif()
endforeach()
