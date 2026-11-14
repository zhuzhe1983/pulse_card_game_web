idf_component_register(
    SRCS "pcg_identity.c" "pcg_writer.c" "main.c" "rc522.c" "rc522_bus.c" "nfc_read.c" "pcg_ndef.c" "pcg_proto.c"
         "usb_cdc.c" "display_gc9a01.c" "gc9a01_seq.c" "ui_model.c"
         "nfc_track.c" "ntag_layout.c" "session_gate.c" "buzzer.c" "sound_pattern.c" "ui_render.c" "ui_font.c"
    INCLUDE_DIRS "."
    EMBED_FILES "../assets/dial-workbench-v2.rgb565"
    REQUIRES driver esp_timer nvs_flash esp_rom tinyusb json
)