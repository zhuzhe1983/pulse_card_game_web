#include "pcg_identity.h"
#include <ctype.h>
#include <stdint.h>
#include <string.h>

static bool text_is(const cJSON *obj, const char *key, const char *expected)
{
    const cJSON *v = cJSON_GetObjectItemCaseSensitive(obj, key);
    return cJSON_IsString(v) && strcmp(v->valuestring, expected) == 0;
}
static bool nickname_ok(const unsigned char *p)
{
    unsigned count = 0;
    while (*p) {
        uint32_t cp = *p++; unsigned tail = 0; uint32_t minimum = 0;
        if (cp >= 0xc2 && cp <= 0xdf) { tail = 1; minimum = 0x80; cp &= 0x1f; }
        else if (cp >= 0xe0 && cp <= 0xef) { tail = 2; minimum = 0x800; cp &= 0x0f; }
        else if (cp >= 0xf0 && cp <= 0xf4) { tail = 3; minimum = 0x10000; cp &= 7; }
        else if (cp >= 0x80) return false;
        for (unsigned i = 0; i < tail; i++) {
            if ((*p & 0xc0) != 0x80) return false;
            cp = (cp << 6) | (*p++ & 0x3f);
        }
        if (cp < minimum || cp < 0x20 || cp == 0x7f || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff) || ++count > 24) return false;
    }
    return true;
}
bool pcg_player_object(const cJSON *value, char *out, size_t capacity)
{
    if (!cJSON_IsObject(value) || !out || capacity < 2) return false;
    const char *keys[] = {"game", "v", "type", "id", "skin", "name"};
    unsigned seen = 0;
    for (const cJSON *item = value->child; item; item = item->next) {
        unsigned i;
        for (i = 0; i < 6; i++) if (item->string && strcmp(item->string, keys[i]) == 0) break;
        if (i == 6 || (seen & (1u << i))) return false;
        seen |= 1u << i;
    }
    if ((seen & 31) != 31 || !text_is(value, "game", "pcg") || !text_is(value, "type", "player")) return false;
    const cJSON *v = cJSON_GetObjectItemCaseSensitive(value, "v");
    const cJSON *id = cJSON_GetObjectItemCaseSensitive(value, "id");
    const cJSON *skin = cJSON_GetObjectItemCaseSensitive(value, "skin");
    const cJSON *name = cJSON_GetObjectItemCaseSensitive(value, "name");
    if (!cJSON_IsNumber(v) || v->valuedouble != 1 || !cJSON_IsString(id) || strlen(id->valuestring) != 36 || !cJSON_IsString(skin)) return false;
    char uuid[37];
    for (unsigned i = 0; i < 36; i++) {
        unsigned char c = (unsigned char)id->valuestring[i];
        if (i == 8 || i == 13 || i == 18 || i == 23) { if (c != '-') return false; }
        else if (!isxdigit(c)) return false;
        uuid[i] = (char)tolower(c);
    }
    uuid[36] = 0;
    if (uuid[14] != '4' || !strchr("89ab", uuid[19])) return false;
    if (strlen(skin->valuestring) != 2 || skin->valuestring[0] != '0' || skin->valuestring[1] < '1' || skin->valuestring[1] > '9') return false;
    if (name && (!cJSON_IsString(name) || !nickname_ok((const unsigned char *)name->valuestring))) return false;
    cJSON *normalized = cJSON_CreateObject();
    if (!normalized) return false;
    bool ok = cJSON_AddStringToObject(normalized,"game","pcg") && cJSON_AddNumberToObject(normalized,"v",1)
        && cJSON_AddStringToObject(normalized,"type","player") && cJSON_AddStringToObject(normalized,"id",uuid)
        && cJSON_AddStringToObject(normalized,"skin",skin->valuestring);
    if (ok && name) ok = cJSON_AddStringToObject(normalized,"name",name->valuestring) != NULL;
    if (ok) ok = cJSON_PrintPreallocated(normalized,out,(int)capacity,false) && strlen(out) <= PCG_IDENTITY_MAX;
    cJSON_Delete(normalized);
    return ok;
}
bool pcg_player_json(const char *json, char *out, size_t capacity)
{
    /* Embedded NUL is not representable by cJSON's C-string schema. */
    if (!json || strlen(json) > PCG_IDENTITY_MAX || strstr(json,"\\u0000")) return false;
    cJSON *value = cJSON_ParseWithOpts(json,NULL,true);
    bool ok = pcg_player_object(value,out,capacity);
    cJSON_Delete(value);
    return ok;
}
