idf_component_register(
    SRCS "main.c" "rc522.c" "nfc_read.c" "pcg_ndef.c" "pcg_proto.c"
         "usb_cdc.c" "display_gc9a01.c"
    INCLUDE_DIRS "."
    REQUIRES driver esp_timer nvs_flash esp_rom tinyusb
)