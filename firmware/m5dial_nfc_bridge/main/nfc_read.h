/*
 * PULSE M5Dial bridge — NFC task glue.
 *
 * Polls the RC522 reader for a tag, extracts its full UID + NTAG NDEF
 * identity, and pushes card/removal events into the pcg.reader.v1 protocol
 * endpoint. Repeat-present suppression lives here (same tag reports once).
 */
#ifndef PCG_NFC_READ_H
#define PCG_NFC_READ_H

#include "pcg_proto.h"

/* Start the NFC polling task. proto must be initialized first. */
void nfc_read_start(pcg_proto_t *proto);

#endif /* PCG_NFC_READ_H */