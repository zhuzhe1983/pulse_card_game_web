/* Register-level fake WS1850S. This executes the production driver, not a protocol mock. */
#include "rc522_bus.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>
static uint8_t regs[64], fifo[64], fifo_n, pointer;
static uint64_t clock_us;
static int transmissions;
static bool no_card,bad_bcc,bad_crc,io_error;
static const uint8_t uid[7]={4,0xaa,0x1b,0x2c,0x3d,0x4e,0x5f};
static void crc_a(const uint8_t *p, size_t n, uint8_t result[2]) {
 uint16_t crc=0x6363;
 while(n--) { uint8_t x=*p++ ^ (uint8_t)crc; x^=x<<4; crc=(crc>>8)^((uint16_t)x<<8)^((uint16_t)x<<3)^(x>>4); }
 result[0]=crc; result[1]=crc>>8;
}
static void reply(const uint8_t*p,size_t n,bool crc){memcpy(fifo,p,n);if(crc){crc_a(p,n,fifo+n);n+=2;if(bad_crc)fifo[n-1]^=1;}fifo_n=n;pointer=0;regs[4]=0x30;}
static void transmit(void){
 uint8_t command[64];size_t n=fifo_n;memcpy(command,fifo,n);transmissions++;
 assert(regs[1]==0x0c); /* 0x0E is authentication, NOT Transceive. */
 if(no_card){fifo_n=0;regs[4]=1;return;}
 regs[0xc]=0;
 if(n==1&&command[0]==0x26){const uint8_t atqa[]={0x44,0};reply(atqa,2,false);}
 else if(n==2&&command[1]==0x20){uint8_t b[5];if(command[0]==0x93){b[0]=0x88;memcpy(b+1,uid,3);}else{assert(command[0]==0x95);memcpy(b,uid+3,4);}b[4]=b[0]^b[1]^b[2]^b[3];if(bad_bcc)b[4]^=1;reply(b,5,false);}
 else {
  uint8_t crc[2];assert(n>=3);crc_a(command,n-2,crc);assert(command[n-2]==crc[0]&&command[n-1]==crc[1]);
  if(n==9&&command[1]==0x70){uint8_t sak=command[0]==0x93?4:0;reply(&sak,1,true);}
  else if(command[0]==0x30){uint8_t data[16];for(int i=0;i<16;i++)data[i]=command[1]*4+i;reply(data,16,true);}
  else if(command[0]==0x60){uint8_t version[]={0,4,4,2,1,0,0x11,3};reply(version,8,true);}
  else if(command[0]==0xa2){uint8_t ack=0x0a;reply(&ack,1,false);regs[0xc]=4;}
  else assert(!"unexpected RFID command");
 }
}
bool rc522_bus_init(const pcg_rc522_conf_t*c){(void)c;memset(regs,0,sizeof regs);regs[0x37]=0x92;return true;}
bool rc522_bus_write(uint8_t reg,const uint8_t*p,size_t n){
 if(io_error)return false;
 if(reg==9){assert(n+fifo_n<=64);memcpy(fifo+fifo_n,p,n);fifo_n+=n;return true;}
 assert(n==1);uint8_t value=*p;
 if(reg==0xa&&value&0x80){fifo_n=pointer=0;return true;}
 if(reg==4||reg==5){regs[reg]&=~value;return true;}
 regs[reg]=value;
 if(reg==1&&value==3){uint8_t crc[2];crc_a(fifo,fifo_n,crc);regs[0x21]=crc[1];regs[0x22]=crc[0];regs[0x23]=0x55;regs[5]|=4;}
 if(reg==0xd&&value&0x80){if(regs[1]==0xc)transmit();else regs[4]=1;}
 return true;
}
bool rc522_bus_read(uint8_t reg,uint8_t*p,size_t n){
 if(io_error)return false;
 if(reg==9){assert(pointer+n<=fifo_n);memcpy(p,fifo+pointer,n);pointer+=n;return true;}
 assert(n==1);*p=reg==0xa?fifo_n:regs[reg];return true;
}
uint64_t rc522_bus_now_us(void){clock_us+=500;return clock_us;}
void rc522_bus_delay_us(uint32_t us){clock_us+=us;}
int main(void){
 pcg_rc522_conf_t cfg={11,12,100000};assert(rc522_init(&cfg));
 pcg_tag_id_t card;assert(rc522_select(&card,200)&&card.uid_len==7&&!memcmp(uid,card.uid,7));
 uint8_t buffer[18];memset(buffer,0xa5,sizeof buffer);assert(rc522_read_memory(buffer+1,16,16)==16);assert(buffer[0]==0xa5&&buffer[17]==0xa5);for(int i=0;i<16;i++)assert(buffer[i+1]==16+i);
 uint8_t version[8];assert(rc522_get_version(version)&&version[6]==0x11);
 assert(rc522_write_page(4,buffer)==0);assert(rc522_write_page(3,buffer)!=0);assert(rc522_write_page(130,buffer)!=0);
 bad_bcc=true;assert(!rc522_select(&card,200));bad_bcc=false;
 bad_crc=true;assert(!rc522_select(&card,200));bad_crc=false;
 no_card=true;assert(!rc522_select(&card,200));no_card=false;
 io_error=true;assert(!rc522_select(&card,200));io_error=false;
 pcg_rc522_diag_t diag;rc522_diagnostics(&diag);assert(diag.polls==5&&diag.selected==1&&diag.crc_ok&&diag.io_errors>0&&transmissions>0);
 puts("PASS RC522 production driver: 0x0C transceive, 0x22 CRC low, UID cascade/BCC/SAK CRC, READ buffer, write ACK/page limits, timeout and I2C errors.");
}
