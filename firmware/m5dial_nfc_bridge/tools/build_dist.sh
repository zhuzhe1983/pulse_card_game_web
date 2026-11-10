#!/usr/bin/env bash
# Build the M5Dial NFC bridge and copy the merged 8 MB / DIO image into dist/.
# Requires ESP-IDF 5.3.x already exported (this project was developed on 5.3.2).
set -euo pipefail

FW="$(cd "$(dirname "$0")/.." && pwd)"
REPO="$(cd "$FW/../.." && pwd)"
OUT="$REPO/dist/firmware/m5dial_nfc_bridge_merged_dio.bin"

if [[ -z "${IDF_PATH:-}" ]]; then
  echo "IDF_PATH is unset. Source ESP-IDF 5.3.x export.sh first." >&2
  exit 1
fi

cd "$FW"
python3 tests/check_flash_config.py --skip-bin

# sdkconfig.defaults is the source of truth. An old sdkconfig would keep
# USB-Serial-JTAG enabled and ignore the new defaults.
rm -f sdkconfig sdkconfig.old
idf.py set-target esp32s3
idf.py build

mkdir -p "$(dirname "$OUT")"
(
  cd build
  esptool.py --chip esp32s3 merge_bin -o "$OUT" \
    --flash_mode dio --flash_freq 80m --flash_size 8MB \
    0x0 bootloader/bootloader.bin \
    0x8000 partition_table/partition-table.bin \
    0x10000 m5dial_nfc_bridge.bin
)

sha256sum "$OUT" | awk '{print $1 "  m5dial_nfc_bridge_merged_dio.bin"}' \
  > "$OUT.sha256"

python3 tests/check_flash_config.py
echo "merged image: $OUT"
cat "$OUT.sha256"
