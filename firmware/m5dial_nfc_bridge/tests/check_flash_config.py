#!/usr/bin/env python3
"""Regression check for the M5Dial NFC bridge flash configuration.

Original Stamp-S3 and v1.1 Stamp-S3A are both ESP32-S3FN8: 8 MB quad flash.
Official docs do not list PSRAM. The shippable image and every generator of
that image must stay on DIO / 80 MHz / 8 MB with PSRAM left off.
"""

from __future__ import annotations

import argparse
import hashlib
import struct
import sys
from pathlib import Path

FW = Path(__file__).resolve().parents[1]
REPO = FW.parents[1]
MERGED = REPO / "dist" / "firmware" / "m5dial_nfc_bridge_merged_dio.bin"
SHA_FILE = Path(str(MERGED) + ".sha256")
FLASH_BYTES = 8 * 1024 * 1024

MODE = {"QIO": 0, "QOUT": 1, "DIO": 2, "DOUT": 3}
SIZE = {0: "1MB", 1: "2MB", 2: "4MB", 3: "8MB", 4: "16MB", 5: "32MB", 6: "64MB", 7: "128MB"}
SPEED = {0: "40M", 1: "26M", 2: "20M", 0xF: "80M"}

# Strings linked in only when esp_psram is compiled into the image.
PSRAM_MARKERS = (
    b"esp_psram/esp_psram.c",
    b"octal_psram",
    b"Found %luMB PSRAM",
    b"PSRAM ID read error",
)


def fail(msg: str) -> None:
    print(f"FAIL: {msg}", file=sys.stderr)
    raise SystemExit(1)


def assignments(text: str) -> dict[str, str]:
    found: dict[str, str] = {}
    for raw in text.splitlines():
        line = raw.split("#", 1)[0].strip()
        if not line or "=" not in line:
            continue
        key, value = line.split("=", 1)
        found[key.strip()] = value.strip()
    return found


def require_defaults(path: Path) -> None:
    cfg = assignments(path.read_text(encoding="utf-8"))
    expect = {
        "CONFIG_IDF_TARGET_ESP32S3": "y",
        "CONFIG_ESPTOOLPY_FLASHSIZE_8MB": "y",
        "CONFIG_ESPTOOLPY_FLASHMODE_DIO": "y",
        "CONFIG_ESPTOOLPY_FLASHFREQ_80M": "y",
        "CONFIG_SPIRAM": "n",
        "CONFIG_PARTITION_TABLE_CUSTOM": "y",
        "CONFIG_ESP_CONSOLE_SECONDARY_NONE": "y",
        "CONFIG_USJ_ENABLE_USB_SERIAL_JTAG": "n",
    }
    for key, value in expect.items():
        if cfg.get(key) != value:
            fail(f"{path.name} {key}={cfg.get(key)!r}, expected {value}")
    for key, value in cfg.items():
        if key.startswith("CONFIG_ESPTOOLPY_FLASHSIZE_") and key.endswith("MB") and value == "y":
            if key != "CONFIG_ESPTOOLPY_FLASHSIZE_8MB":
                fail(f"{path.name} enables {key}")
        if key.startswith("CONFIG_ESPTOOLPY_FLASHMODE_") and value == "y":
            if key != "CONFIG_ESPTOOLPY_FLASHMODE_DIO":
                fail(f"{path.name} enables {key}")
        if key.startswith("CONFIG_SPIRAM") and value == "y":
            fail(f"{path.name} enables {key}")
        if key == "CONFIG_USJ_ENABLE_USB_SERIAL_JTAG" and value == "y":
            fail(f"{path.name} enables USB-Serial-JTAG beside TinyUSB")
        if key == "CONFIG_ESP_CONSOLE_SECONDARY_USB_SERIAL_JTAG" and value == "y":
            fail(f"{path.name} enables the USB-Serial-JTAG console")
    filename = cfg.get("CONFIG_PARTITION_TABLE_CUSTOM_FILENAME", "")
    if "partitions.csv" not in filename:
        fail(f"{path.name} partition filename is {filename!r}")


def parse_size(token: str) -> int:
    token = token.strip()
    mult = 1
    if token[-1] in "Kk":
        mult = 1024
        token = token[:-1]
    elif token[-1] in "Mm":
        mult = 1024 * 1024
        token = token[:-1]
    return int(token, 0) * mult


def parse_csv(path: Path) -> list[tuple[str, int, int]]:
    parts: list[tuple[str, int, int]] = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.split("#", 1)[0].strip()
        if not line:
            continue
        cols = [c.strip() for c in line.split(",")]
        if len(cols) < 5 or cols[0].lower() == "name":
            continue
        name, offset, size = cols[0], parse_size(cols[3]), parse_size(cols[4])
        parts.append((name, offset, size))
    return parts


def require_csv(parts: list[tuple[str, int, int]]) -> None:
    expect = [("nvs", 0x9000, 0x6000), ("phy_init", 0xF000, 0x1000), ("factory", 0x10000, 0x100000)]
    if parts != expect:
        fail(f"partitions.csv layout is {parts}, expected {expect}")
    for name, offset, size in parts:
        end = offset + size
        if end > FLASH_BYTES:
            fail(f"partition {name} ends at {end:#x}, past 8 MB")
    # Bootloader (0x0) and the table itself (0x8000) must sit below nvs.
    if parts[0][1] < 0x8000:
        fail("first partition overlaps the bootloader / partition table")


def require_text_sources() -> None:
    readme = (FW / "README.md").read_text(encoding="utf-8")
    if "--flash_size 8MB" not in readme or "--flash_mode dio" not in readme:
        fail("README.md does not document the 8MB DIO merge/flash command")
    if "--flash_size 32MB" in readme or "--flash_mode qio" in readme:
        fail("README.md still tells the builder to use 32MB or qio")
    script = (FW / "tools" / "build_dist.sh").read_text(encoding="utf-8")
    if "--flash_size 8MB" not in script or "--flash_mode dio" not in script or "--flash_freq 80m" not in script:
        fail("tools/build_dist.sh is not pinned to dio/80m/8MB")
    if "32MB" in script or "qio" in script:
        fail("tools/build_dist.sh contains a 32MB or qio flash setting")
    page = (REPO / "dist" / "flash.html").read_text(encoding="utf-8")
    for needle in (
        "const FLASH_MODE = 'dio'",
        "const FLASH_FREQ = '80m'",
        "const FLASH_SIZE = '8MB'",
        "flashMode: FLASH_MODE",
        "flashFreq: FLASH_FREQ",
        "flashSize: FLASH_SIZE",
        "esptool-js@0.7.1",
    ):
        if needle not in page:
            fail(f"dist/flash.html missing {needle}")
    for banned in ("32MB", "flashSizeMB", "setFlashSize", "esptool-js@0.9.7", "flashMode: 'qio'"):
        if banned in page:
            fail(f"dist/flash.html still contains {banned}")
    cmake = (FW / "CMakeLists.txt").read_text(encoding="utf-8")
    if "CONFIG_ESPTOOLPY_FLASHMODE_DIO=y" not in cmake or "# CONFIG_SPIRAM is not set" not in cmake:
        fail("CMakeLists.txt no longer guards DIO / PSRAM-off")


def header_at(blob: bytes, offset: int, label: str, end_limit: int) -> None:
    if len(blob) < offset + 24:
        fail(f"{label} is shorter than an image header")
    magic, segments, mode, speed_size = blob[offset], blob[offset + 1], blob[offset + 2], blob[offset + 3]
    speed, size = speed_size & 0xF, (speed_size >> 4) & 0xF
    chip = struct.unpack_from("<H", blob, offset + 12)[0]
    mode_name = next((name for name, value in MODE.items() if value == mode), str(mode))
    if magic != 0xE9:
        fail(f"{label} magic is {magic:#x}")
    if not 1 <= segments <= 16:
        fail(f"{label} segment count {segments} is implausible")
    if mode != MODE["DIO"] or speed != 0xF or size != 3:
        fail(
            f"{label} header is {mode_name} {SPEED.get(speed, speed)} {SIZE.get(size, size)} "
            f"byte3={speed_size:#x}, expected DIO 80M 8MB (byte3=0x3f)"
        )
    if chip != 0x0009:
        fail(f"{label} chip id is {chip:#x}, expected ESP32-S3 (0x0009)")
    # Segment payload end plus checksum padding and the optional SHA-256 trailer.
    cursor = offset + 24
    for index in range(segments):
        if cursor + 8 > len(blob):
            fail(f"{label} segment {index} header runs past the file")
        _load, length = struct.unpack_from("<II", blob, cursor)
        if length > FLASH_BYTES:
            fail(f"{label} segment {index} length {length:#x} is absurd")
        cursor += 8 + length
    if cursor + 64 > end_limit:
        fail(f"{label} image ends at {cursor:#x}, past slot limit {end_limit:#x}")


def partition_table(blob: bytes) -> list[tuple[str, int, int]]:
    base = 0x8000
    if blob[base:base + 2] != b"\xaa\x50":
        fail(f"partition table magic at 0x8000 is {blob[base:base+2].hex()}")
    parts: list[tuple[str, int, int]] = []
    off = base
    while off + 32 <= len(blob) and blob[off:off + 2] != b"\xff\xff":
        magic, _typ, _sub, poff, size, name, _flags = struct.unpack_from("<HBBII16sI", blob, off)
        if magic != 0x50AA:
            break
        label = name.split(b"\x00", 1)[0].decode("ascii", "replace")
        parts.append((label, poff, size))
        if poff + size > FLASH_BYTES:
            fail(f"image partition {label} ends at {poff + size:#x}, past 8 MB")
        off += 32
    return parts


def require_merged(path: Path) -> None:
    blob = path.read_bytes()
    if len(blob) > FLASH_BYTES:
        fail(f"{path.name} is {len(blob)} bytes, larger than 8 MB")
    header_at(blob, 0x0, "bootloader", 0x8000)
    header_at(blob, 0x10000, "app", 0x110000)
    csv_parts = parse_csv(FW / "partitions.csv")
    image_parts = partition_table(blob)
    if image_parts != csv_parts:
        fail(f"merged partition table {image_parts} != partitions.csv {csv_parts}")
    for marker in PSRAM_MARKERS:
        at = blob.find(marker)
        if at != -1:
            fail(f"{path.name} still contains PSRAM marker {marker!r} at {at:#x}")
    digest = hashlib.sha256(blob).hexdigest()
    if not SHA_FILE.is_file():
        fail(f"missing checksum file {SHA_FILE}")
    recorded = SHA_FILE.read_text(encoding="utf-8").split()[0].lower()
    if recorded != digest:
        fail(f"sha256 file is {recorded}, image is {digest}")
    print(f"merged {path.relative_to(REPO)} {len(blob)} bytes sha256 {digest}")
    print("headers: bootloader+app DIO 80MHz 8MB, partitions fit in 8MB, PSRAM markers absent")


def require_sdkconfig(path: Path) -> None:
    text = path.read_text(encoding="utf-8", errors="replace")
    cfg = assignments(text)
    for key in (
        "CONFIG_ESPTOOLPY_FLASHSIZE_8MB",
        "CONFIG_ESPTOOLPY_FLASHMODE_DIO",
        "CONFIG_ESPTOOLPY_FLASHFREQ_80M",
        "CONFIG_PARTITION_TABLE_CUSTOM",
        "CONFIG_IDF_TARGET_ESP32S3",
        "CONFIG_ESP_CONSOLE_SECONDARY_NONE",
    ):
        if cfg.get(key) != "y":
            fail(f"{path} {key}={cfg.get(key)!r}")
    if "CONFIG_USJ_ENABLE_USB_SERIAL_JTAG=y" in text or "CONFIG_ESP_CONSOLE_SECONDARY_USB_SERIAL_JTAG=y" in text:
        fail(f"{path} still enables USB-Serial-JTAG next to TinyUSB")
    if "CONFIG_SPIRAM=y" in text or "CONFIG_SPIRAM_MODE_OCT=y" in text:
        fail(f"{path} enables PSRAM")
    if "# CONFIG_SPIRAM is not set" not in text and cfg.get("CONFIG_SPIRAM") not in (None, "n"):
        fail(f"{path} does not record PSRAM as disabled")
    if cfg.get("CONFIG_ESPTOOLPY_FLASHSIZE") not in (None, '"8MB"'):
        fail(f"{path} CONFIG_ESPTOOLPY_FLASHSIZE={cfg.get('CONFIG_ESPTOOLPY_FLASHSIZE')!r}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--skip-bin", action="store_true", help="check sources only")
    args = parser.parse_args()

    require_defaults(FW / "sdkconfig.defaults")
    require_csv(parse_csv(FW / "partitions.csv"))
    require_text_sources()
    sdkconfig = FW / "sdkconfig"
    if sdkconfig.is_file():
        require_sdkconfig(sdkconfig)
    if not args.skip_bin:
        if not MERGED.is_file():
            fail(f"missing merged image {MERGED}")
        require_merged(MERGED)
        app = FW / "build" / "m5dial_nfc_bridge.bin"
        boot = FW / "build" / "bootloader" / "bootloader.bin"
        if app.is_file():
            header_at(app.read_bytes(), 0, "app build", 0x100000)
        if boot.is_file():
            header_at(boot.read_bytes(), 0, "bootloader build", 0x8000)
    print("flash config ok")


if __name__ == "__main__":
    main()
