#ifndef PCG_IDENTITY_H
#define PCG_IDENTITY_H
#include <stdbool.h>
#include <stddef.h>
#include "cJSON.h"
#define PCG_IDENTITY_MIME "application/vnd.pcg.identity+json"
#define PCG_IDENTITY_MAX 384
/* Validate the player-only schema and emit the same key order as the browser. */
bool pcg_player_object(const cJSON *value, char *out, size_t capacity);
bool pcg_player_json(const char *json, char *out, size_t capacity);
#endif
