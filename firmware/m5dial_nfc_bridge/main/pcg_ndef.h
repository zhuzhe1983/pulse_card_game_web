/*
 * PULSE M5Dial bridge — NTAG215 NDEF parsing.
 *
 * Turns raw NTAG2 memory pages and an NDEF message into the PULSE identity
 * descriptor consumed by pcg.reader.v1 and shown on the dial screen.
 *
 * Kept dependency-light and deterministic so the SAME fixtures used by the
 * web side (tests/readers.test.cjs) can be exercised here in unit tests.
 */
#ifndef PCG_NDEF_H
#define PCG_NDEF_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

/* Bounds for a descriptor JSON (fits one NTAG215 NDEF message). */
#define PCG_NDEF_MAX 512

/* Extract the NDEF message bytes from raw NTAG memory (4 bytes/page). */
size_t pcg_ndef_extract(const uint8_t *mem, size_t mem_len,
                        uint8_t *out, size_t out_len);

/* Parse a well-formed NDEF message and copy the PULSE identity JSON payload. */
bool pcg_ndef_parse_message(const uint8_t *msg, size_t len,
                            char *out, size_t out_len);

/* Pull one quoted string value (key:"...") out of the identity JSON. */
bool pcg_ndef_json_string(const char *json, const char *key,
                          char *out, size_t out_len);

/* True if the parsed identity JSON describes a player. */
bool pcg_identity_is_player(const char *json);

#endif /* PCG_NDEF_H */