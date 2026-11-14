#include "pcg_writer.h"
#include "pcg_identity.h"
#include "ntag_layout.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>
static const char *uid="04AA1B2C3D4E5F";
static const char *identity="{\"game\":\"pcg\",\"v\":1,\"type\":\"player\",\"id\":\"12345678-1234-4123-8123-123456789abc\",\"skin\":\"01\",\"name\":\"小明 \\\"}\\\"\"}";
typedef struct {uint8_t memory[540];int writes,selects,swapped_at,fail_at;bool broken_version,short_read,corrupt;} tag_t;
static bool select_tag(void*ctx,char out[24]){tag_t*t=ctx;t->selects++;strcpy(out,t->swapped_at&&t->selects>=t->swapped_at?"04AA1B2C3D4E60":uid);return true;}
static bool version(void*ctx,uint8_t out[8]){tag_t*t=ctx;uint8_t v[]={0,4,4,2,1,0,0x11,3};memcpy(out,v,8);if(t->broken_version)out[6]=0xf;return true;}
static size_t read_tag(void*ctx,uint32_t addr,uint8_t*out,size_t n){tag_t*t=ctx;assert(addr+n<=sizeof t->memory);memcpy(out,t->memory+addr,n);if(t->corrupt&&t->writes&&n==508)out[5]^=1;return t->short_read&&n==508?n-4:n;}
static int write_tag(void*ctx,uint8_t page,const uint8_t bytes[4]){tag_t*t=ctx;assert(page>=4&&page<=129);t->writes++;if(t->fail_at&&t->writes==t->fail_at)return -1;memcpy(t->memory+page*4,bytes,4);return 0;}
static void init(tag_t*t){memset(t,0,sizeof *t);memcpy(t->memory+12,"\xe1\x10\x3e\x00",4);t->memory[527]=255;}
static pcg_write_result_t run(tag_t*t){const pcg_tag_io_t io={t,select_tag,version,read_tag,write_tag};pcg_write_result_t r;pcg_write_blank_player(&io,uid,identity,&r);return r;}
int main(void){
 tag_t t;pcg_write_result_t r;char normalized[512];assert(pcg_player_json(identity,normalized,sizeof normalized));
 assert(!pcg_player_json("{\"game\":\"pcg\",\"v\":1,\"type\":\"player\",\"id\":\"bad\",\"skin\":\"01\"}",normalized,sizeof normalized));
 init(&t);uint8_t original[540];memcpy(original,t.memory,540);r=run(&t);assert(r.ok&&strcmp(r.uid,uid)==0&&strcmp(r.descriptor,identity)==0&&t.writes>2);
 assert(memcmp(t.memory,original,16)==0&&memcmp(t.memory+512,original+512,28)==0);
 int calls=t.writes;r=run(&t);assert(!r.ok&&t.writes==calls);
 init(&t);t.memory[16]=3;t.memory[17]=3;t.memory[18]=0xd0;r=run(&t);assert(r.ok);
 init(&t);t.memory[16]=3;t.memory[17]=3;t.memory[18]=0xd1;r=run(&t);assert(!r.ok&&!t.writes);
 init(&t);t.memory[14]=0x12;r=run(&t);assert(!r.ok&&!t.writes);
 init(&t);t.broken_version=true;r=run(&t);assert(!r.ok&&!t.writes);
 init(&t);t.memory[10]=1;r=run(&t);assert(!r.ok&&!t.writes);
 init(&t);t.memory[520]=1;r=run(&t);assert(!r.ok&&!t.writes);
 init(&t);t.memory[527]=4;r=run(&t);assert(!r.ok&&!t.writes);
 init(&t);t.memory[524]=0x40;r=run(&t);assert(!r.ok&&!t.writes);
 init(&t);t.short_read=true;r=run(&t);assert(!r.ok&&!t.writes);
 init(&t);t.swapped_at=2;r=run(&t);assert(!r.ok&&!t.writes);
 init(&t);t.swapped_at=4;r=run(&t);assert(!r.ok&&t.writes==2&&t.memory[17]==0);
 init(&t);t.fail_at=3;r=run(&t);assert(!r.ok&&t.memory[17]==0);
 init(&t);t.corrupt=true;r=run(&t);assert(!r.ok&&strcmp(r.error,"readback failed")==0);
 uint8_t memory[508]={0xe1,0x10,0x3e,0},planned[508],msg[512];char payload[385],parsed[512],err[64];
 for(size_t n=218;n<=384;n++){
  memset(payload,'x',n);payload[n]=0;assert(pcg_ntag_plan_write(memory,sizeof memory,3,payload,1,uid,uid,planned,err,sizeof err)==0);
  size_t got=pcg_ndef_extract(planned+4,sizeof planned-4,msg,sizeof msg);assert(got&&pcg_ndef_parse_message(msg,got,parsed,sizeof parsed)&&strcmp(payload,parsed)==0);
  assert(pcg_ndef_extract(planned+4,10,msg,sizeof msg)==0);assert(pcg_ntag_dirty_pages(memory,planned,sizeof memory,3,NULL,1)==-1);
 }
 const uint8_t with_fe[]={3,4,0xd2,0,1,0xfe,0xfe};assert(pcg_ndef_extract(with_fe,sizeof with_fe,msg,sizeof msg)==4&&msg[3]==0xfe);
 puts("PASS writer: empty/success/readback, occupied/locked/protected/model rejection, UID swap, partial read, page failure, corrupt readback, boundary lengths, protected memory.");
}
