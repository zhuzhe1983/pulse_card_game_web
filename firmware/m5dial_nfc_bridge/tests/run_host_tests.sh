#!/usr/bin/env bash
# Host-side tests; no device or cross compiler required.
# Needs cc and cJSON source: export IDF_PATH or CJSON_DIR. Run in this directory.
set -e
cc -std=c11 -Wall -Wextra -Werror -I main main/ui_model.c main/sound_pattern.c tests/test_feedback.c -o /tmp/pcg_feedback_test
/tmp/pcg_feedback_test
cc -std=c11 -Wall -Wextra -Werror -I main main/rc522.c tests/test_rc522.c -o /tmp/pcg_rc522_test
/tmp/pcg_rc522_test
cc -std=c11 -Wall -I main main/pcg_ndef.c tests/test_pcg_ndef.c  -o /tmp/pcg_ndef_test
CJSON_DIR="${CJSON_DIR:-${IDF_PATH:?Set IDF_PATH or CJSON_DIR}/components/json/cJSON}"
COMMON=(-std=c11 -Wall -Wextra -Werror -I main -I "$CJSON_DIR")
cc "${COMMON[@]}" main/pcg_proto.c main/pcg_identity.c "$CJSON_DIR/cJSON.c" tests/test_pcg_proto.c -o /tmp/pcg_proto_test
cc "${COMMON[@]}" main/pcg_writer.c main/pcg_identity.c main/pcg_ndef.c main/ntag_layout.c "$CJSON_DIR/cJSON.c" tests/test_writer.c -o /tmp/pcg_writer_test
/tmp/pcg_writer_test
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