#!/usr/bin/env bash
# Host-side unit tests for pcg_ndef / pcg_proto — no ESP-IDF required.
# Requires a C compiler (cc/clang/gcc). Run from firmware/m5dial_nfc_bridge.
set -e
cc -std=c11 -Wall -I main main/pcg_ndef.c tests/test_pcg_ndef.c  -o /tmp/pcg_ndef_test
cc -std=c11 -Wall -I main main/pcg_proto.c tests/test_pcg_proto.c -o /tmp/pcg_proto_test
cc -std=c11 -Wall -I main main/pcg_ndef.c main/pcg_proto.c tests/test_pcg_ndef.c -o /tmp/pcg_combined_test
cc -std=c11 -Wall -I main main/gc9a01_seq.c main/nfc_track.c main/session_gate.c main/ui_model.c main/ntag_layout.c main/pcg_ndef.c tests/test_dial_logic.c -o /tmp/pcg_dial_test
echo "-- ndef --"; /tmp/pcg_ndef_test
echo "-- proto --"; /tmp/pcg_proto_test
echo "-- dial logic --"; /tmp/pcg_dial_test
echo "-- reader lamp --"; node tests/test_reader_lamp.js
echo "-- probe schema --"
python3 - << 'PY'
import importlib.util
spec = importlib.util.spec_from_file_location("probe", "tools/m5dial_host_probe.py")
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
assert mod.main([]) == 0
assert mod.hello_ok({"type":"hello","protocol":"pcg.reader.v1","capabilities":["uid","ndef_read","ndef_write"],"reset":"poweron"})
assert not mod.hello_ok({"type":"hello","protocol":"pcg.reader.v1","capabilities":["uid"],"reset":"poweron"})
assert mod.card_ok({"type":"card","uid":"04AA","tech":"nfc-a","ndef":"foreign","tag":{"cc":"E1103E00","capacity":496,"writable":True,"lock":"open","ndef_hex":"D101"}})
assert not mod.card_ok({"type":"card","uid":"04AA","tech":"nfc-a","ndef":"blank"})
print("probe schema ok")
PY
echo "-- flash config --"; python3 tests/check_flash_config.py --skip-bin
echo "ALL HOST TESTS PASS"