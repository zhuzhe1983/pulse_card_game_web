#!/usr/bin/env bash
# Host-side unit tests for pcg_ndef / pcg_proto — no ESP-IDF required.
# Requires a C compiler (cc/clang/gcc). Run from firmware/m5dial_nfc_bridge.
set -e
cc -std=c11 -Wall -I main main/pcg_ndef.c tests/test_pcg_ndef.c  -o /tmp/pcg_ndef_test
cc -std=c11 -Wall -I main main/pcg_proto.c tests/test_pcg_proto.c -o /tmp/pcg_proto_test
cc -std=c11 -Wall -I main main/pcg_ndef.c main/pcg_proto.c tests/test_pcg_ndef.c -o /tmp/pcg_combined_test
echo "-- ndef --"; /tmp/pcg_ndef_test
echo "-- proto --"; /tmp/pcg_proto_test
echo "-- flash config --"; python3 tests/check_flash_config.py
echo "ALL HOST TESTS PASS"