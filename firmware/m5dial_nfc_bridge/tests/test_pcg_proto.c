#include "pcg_proto.h"
#include "pcg_identity.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>
static char emitted[4096];static int writes;static bool wrong_readback;
static const char*id="{\"game\":\"pcg\",\"v\":1,\"type\":\"player\",\"id\":\"12345678-1234-4123-8123-123456789abc\",\"skin\":\"01\",\"name\":\"小明 \\\"}\\\"\"}";
static void send_cb(pcg_proto_t*p,const char*line){(void)p;snprintf(emitted,sizeof emitted,"%s",line);}
static bool write_cb(pcg_proto_t*p,const char*request,const char*uid,bool overwrite,const char*json,pcg_write_result_t*out){
 (void)p;(void)request;assert(!overwrite);writes++;out->ok=true;snprintf(out->uid,sizeof out->uid,"%s",wrong_readback?"04FFFFFFFFFFFF":uid);snprintf(out->descriptor,sizeof out->descriptor,"%s",json);return true;
}
static void request(pcg_proto_t*p,bool confirm,bool overwrite,const char*mime){
 cJSON*o=cJSON_CreateObject();cJSON_AddStringToObject(o,"type","write");cJSON_AddStringToObject(o,"request_id","r1");cJSON_AddStringToObject(o,"expected_uid","04AA1B2C3D4E5F");cJSON_AddStringToObject(o,"mime",mime);
 cJSON_AddBoolToObject(o,"confirm",confirm);cJSON_AddBoolToObject(o,"overwrite",overwrite);cJSON_AddItemToObject(o,"descriptor",cJSON_Parse(id));char*line=cJSON_PrintUnformatted(o);pcg_proto_on_line(p,line,strlen(line));cJSON_free(line);cJSON_Delete(o);
}
int main(void){
 pcg_proto_t p;pcg_proto_init(&p,"M5Dial",7,send_cb,write_cb,NULL);pcg_proto_set_ready(&p,true);
 request(&p,true,false,PCG_IDENTITY_MIME);assert(!writes&&strstr(emitted,"false"));
 pcg_proto_on_line(&p,"{\"type\":\"hello\",\"protocol\":\"pcg.reader.v1\"}",0);assert(strstr(emitted,PCG_FIRMWARE_VERSION)&&strstr(emitted,PCG_WRITE_MODE));
 request(&p,false,false,PCG_IDENTITY_MIME);assert(!writes);request(&p,true,true,PCG_IDENTITY_MIME);assert(!writes);request(&p,true,false,"text/plain");assert(!writes);
 request(&p,true,false,PCG_IDENTITY_MIME);assert(writes==1);cJSON*r=cJSON_Parse(emitted);assert(cJSON_IsTrue(cJSON_GetObjectItem(r,"ok"))&&cJSON_IsTrue(cJSON_GetObjectItem(r,"verified")));
 char actual[512];assert(pcg_player_object(cJSON_GetObjectItem(r,"descriptor"),actual,sizeof actual)&&strcmp(actual,id)==0);cJSON_Delete(r);
 wrong_readback=true;request(&p,true,false,PCG_IDENTITY_MIME);assert(strstr(emitted,"readback failed"));
 const char*bad[]={"{\"type\":\"hello\",\"type\":\"write\"}","{\"type\":\"hello\"} trailing","{\"type\":\"write\",\"request_id\":\"r\\u00001\"}","[]"};
 for(unsigned i=0;i<sizeof bad/sizeof *bad;i++){pcg_proto_on_line(&p,bad[i],strlen(bad[i]));assert(strstr(emitted,"error"));}
 puts("PASS protocol: write negotiation, confirmation, MIME/schema, escaped names, actual verified descriptor, wrong readback and malformed input.");
}
