#!/usr/bin/env python3
"""Read-only host probe for a M5Dial pcg.reader.v1 CDC bridge.

Default mode never writes. It opens the serial port, checks that the port
stays up with no hello, sends one hello, then keeps the session open and
prints card/removed/diag lines.

Write mode is separate and refuses to run unless every guard is present:

  python3 tools/m5dial_host_probe.py --port /dev/cu.usbmodemXXXX --write \
      --uid 04AABBCCDDEEFF --descriptor identity.json --confirm OVERWRITE

The descriptor file is the identity object. overwrite is sent as true only
because --confirm OVERWRITE was given. The script still checks the card's
ndef class: unformatted tags are not written, and a non-blank card is
written only when the operator also passes --allow-foreign.

Schema of the lines this script expects is documented in docs/READERS.md.
This file does not open a port until --port is set, so importing it in CI
does not touch hardware.
"""

from __future__ import annotations

import argparse
import json
import sys
import time


def loads_line(raw: str) -> dict:
    msg = json.loads(raw)
    if not isinstance(msg, dict) or "type" not in msg:
        raise ValueError("line is not a protocol object")
    return msg


def hello_ok(msg: dict) -> bool:
    caps = msg.get("capabilities")
    return (
        msg.get("type") == "hello"
        and msg.get("protocol") == "pcg.reader.v1"
        and isinstance(caps, list)
        and "uid" in caps
        and "ndef_read" in caps
        and isinstance(msg.get("reset"), str)
    )


def card_ok(msg: dict) -> bool:
    tag = msg.get("tag")
    return (
        msg.get("type") == "card"
        and isinstance(msg.get("uid"), str)
        and msg.get("tech") == "nfc-a"
        and msg.get("ndef") in {"blank", "unformatted", "pulse", "foreign", "unsupported", "error", "unknown"}
        and isinstance(tag, dict)
        and "cc" in tag
        and "capacity" in tag
        and "writable" in tag
        and "lock" in tag
        and "ndef_hex" in tag
    )


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="M5Dial read-only probe, optional confirmed write")
    p.add_argument("--port", help="serial device, for example /dev/cu.usbmodem4827E2E3269C1")
    p.add_argument("--baud", type=int, default=115200)
    p.add_argument("--listen", type=float, default=8.0, help="seconds to listen after hello")
    p.add_argument("--write", action="store_true", help="send one write after a card event")
    p.add_argument("--uid", help="expected UID, required with --write")
    p.add_argument("--descriptor", help="path to identity JSON, required with --write")
    p.add_argument("--confirm", default="", help="must be exactly OVERWRITE")
    p.add_argument("--allow-foreign", action="store_true", help="allow write onto foreign NDEF")
    args = p.parse_args(argv)

    if args.baud == 1200:
        print("refusing 1200 baud; that is an ESP ROM reset gesture", file=sys.stderr)
        return 2
    if args.write:
        if args.confirm != "OVERWRITE" or not args.uid or not args.descriptor:
            print("write requires --uid, --descriptor and --confirm OVERWRITE", file=sys.stderr)
            return 2
        descriptor = json.loads(open(args.descriptor, encoding="utf-8").read())
        if not isinstance(descriptor, dict) or descriptor.get("game") != "pcg":
            print("descriptor is not a PULSE identity", file=sys.stderr)
            return 2
    else:
        descriptor = None

    if not args.port:
        print("schema-only check: pass --port to open a device")
        print("hello requires reset; card requires ndef and tag.cc/capacity/writable/lock/ndef_hex")
        return 0

    import serial  # pyserial, imported only when a port is requested

    port = serial.Serial(args.port, args.baud, timeout=0.2, dsrdtr=False, rtscts=False)
    try:
        deadline = time.time() + 2.0
        while time.time() < deadline:
            if not port.is_open:
                print("FAIL port dropped before hello")
                return 1
            port.read(256)
        port.write(b'{"type":"hello","protocol":"pcg.reader.v1"}\n')
        port.flush()
        hello = None
        buf = b""
        end = time.time() + args.listen
        cards = 0
        removed = 0
        while time.time() < end:
            if not port.is_open:
                print("FAIL port dropped after hello")
                return 1
            chunk = port.read(256)
            if not chunk:
                continue
            buf += chunk
            while b"\n" in buf:
                raw, buf = buf.split(b"\n", 1)
                if not raw.strip():
                    continue
                msg = loads_line(raw.decode("utf-8"))
                print(json.dumps(msg, ensure_ascii=False))
                if msg.get("type") == "hello" and hello is None:
                    hello = msg
                    if not hello_ok(msg):
                        print("FAIL hello schema", file=sys.stderr)
                        return 1
                    port.write(b'{"type":"diag"}\n')
                    port.flush()
                elif msg.get("type") == "card":
                    cards += 1
                    if not card_ok(msg):
                        print("FAIL card schema", file=sys.stderr)
                        return 1
                    if args.write and cards == 1:
                        if msg["uid"] != args.uid:
                            print("FAIL card uid does not match --uid; not writing", file=sys.stderr)
                            return 1
                        if msg["ndef"] == "unformatted":
                            print("FAIL unformatted tag; not writing", file=sys.stderr)
                            return 1
                        if msg["ndef"] not in {"blank", "pulse"} and not args.allow_foreign:
                            print("FAIL ndef is %s; pass --allow-foreign to overwrite" % msg["ndef"], file=sys.stderr)
                            return 1
                        if msg.get("tag", {}).get("writable") is False:
                            print("FAIL tag reports not writable; not writing", file=sys.stderr)
                            return 1
                        body = {
                            "type": "write",
                            "request_id": "probe-1",
                            "expected_uid": args.uid,
                            "mime": "application/vnd.pcg.identity+json",
                            "descriptor": descriptor,
                            "overwrite": True,
                        }
                        port.write((json.dumps(body, separators=(",", ":")) + "\n").encode("utf-8"))
                        port.flush()
                elif msg.get("type") == "removed":
                    removed += 1
                elif msg.get("type") == "write_result" and not msg.get("ok", False):
                    print("write was rejected:", msg.get("error"))
        if hello is None:
            print("FAIL no hello")
            return 1
        print("summary cards=%d removed=%d reset=%s" % (cards, removed, hello.get("reset")))
        return 0
    finally:
        port.close()


if __name__ == "__main__":
    sys.exit(main())
