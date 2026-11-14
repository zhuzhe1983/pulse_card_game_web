#!/usr/bin/env python3
"""Write metadata for the exact merged image published beside this manifest."""
import hashlib
import json
from pathlib import Path
import re

firmware = Path(__file__).resolve().parents[1]
output = firmware.parents[1] / 'dist' / 'firmware'
image = output / 'm5dial_nfc_bridge_merged_dio.bin'
version = re.search(r'#define PCG_FIRMWARE_VERSION "([^"]+)"', (firmware / 'main/pcg_proto.h').read_text()).group(1)
data = image.read_bytes()
manifest = dict(version=version, file=image.name, bytes=len(data), sha256=hashlib.sha256(data).hexdigest(), chip='ESP32-S3', flash_mode='dio', flash_frequency='80m', flash_size='8MB', write_mode='blank-player-v1', hardware_tested=False)
(output / 'm5dial_nfc_bridge_manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
