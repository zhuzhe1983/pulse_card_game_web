#include "ui_render.h"
#include "ui_font.h"
#include <string.h>
#include <stdio.h>
#define W 240
static uint32_t next(const char **s){const unsigned char*p=(const unsigned char*)*s;uint32_t c=*p++;int n=0;if(c>=0xf0){c&=7;n=3;}else if(c>=0xe0){c&=15;n=2;}else if(c>=0xc0){c&=31;n=1;}while(n--&&*p)c=(c<<6)|(*p++&63);*s=(const char*)p;return c;}
static const ui_glyph_t *glyph(uint32_t code,unsigned size){for(unsigned i=0;i<ui_glyph_count;i++)if(ui_glyphs[i].code==code&&ui_glyphs[i].size==size)return ui_glyphs+i;return 0;}
static void pixel(uint16_t*p,int x,int y,uint16_t c){if(x>=0&&y>=0&&x<W&&y<W)p[y*W+x]=c;}
static void line(uint16_t*p,int x,int y,int a,int b,uint16_t c){int dx=a>x?a-x:x-a,sx=x<a?1:-1,dy=-(b>y?b-y:y-b),sy=y<b?1:-1,e=dx+dy;while(1){pixel(p,x,y,c);if(x==a&&y==b)break;int z=2*e;if(z>=dy){e+=dy;x+=sx;}if(z<=dx){e+=dx;y+=sy;}}}
static void rect(uint16_t*p,int x,int y,int w,int h,uint16_t c){for(int j=0;j<h;j++)for(int i=0;i<w;i++)pixel(p,x+i,y+j,c);}
static void ring(uint16_t*p,int x,int y,int radius,int thick,uint16_t c){for(int a=-radius;a<=radius;a++)for(int b=-radius;b<=radius;b++){int d=a*a+b*b;if(d<=radius*radius&&d>=(radius-thick)*(radius-thick))pixel(p,x+a,y+b,c);}}
static void text(uint16_t*p,const char*s,int y,unsigned size,uint16_t color){const char*t=s;int width=0;while(*t){const ui_glyph_t*g=glyph(next(&t),size);if(g)width+=g->advance;}int x=(W-width)/2;while(*s){const ui_glyph_t*g=glyph(next(&s),size);if(!g)continue;unsigned stride=(g->width+7)/8;for(unsigned b=0;b<g->height;b++)for(unsigned a=0;a<g->width;a++)if(ui_font_bits[g->offset+b*stride+a/8]&(128>>(a%8)))pixel(p,x+a,y+b,color);x+=g->advance;}}
void ui_render(uint16_t*p,const uint8_t*bg,const ui_frame_t*f,unsigned tick){
 for(int i=0;i<W*W;i++)p[i]=(bg[i*2]<<8)|bg[i*2+1];
 bool err=!f->nfc_ok||strstr(f->kind,"error")||!strcmp(f->kind,"unsupported");
 bool work=!strcmp(f->kind,"reading")||!strcmp(f->kind,"writing")||!strcmp(f->kind,"verifying");
 bool wait=!strcmp(f->kind,"idle")||!strcmp(f->kind,"boot");
 bool done=!strcmp(f->kind,"write_ok");
 uint16_t color=err?0xfaa8:done?0x6fee:work?0xfda7:0x5f7b;
 ring(p,120,120,97,2,color);
 // Status lamps keep the physical rim readable at native resolution.
 rect(p,110,8,20,3,f->usb_open?0x5f7b:0x630c);rect(p,110,228,20,3,f->sound?0xfda7:0x630c);
 text(p,"PULSE",35,18,0xe75c);text(p,"NFC 身份终端",58,12,0x9d77);
 if(err){line(p,111,85,129,103,color);line(p,129,85,111,103,color);ring(p,120,94,21,2,color);}
 else if(done){line(p,104,94,115,104,color);line(p,115,104,137,83,color);ring(p,120,94,25,2,color);}
 else { // NFC card and radio waves, drawn with clear 240px geometry.
  rect(p,103,79,26,32,color);rect(p,105,81,22,28,0x1127);rect(p,109,87,9,7,color);rect(p,109,102,14,2,color);
  for(int i=0;i<3;i++){int x=133+i*5;line(p,x,82-i*3,x+2,92,color);line(p,x+2,92,x,102+i*3,color);}
  if(wait||work){int phase=tick%4;rect(p,106+phase*8,116,5,2,color);}
 }
 text(p,f->title,130,18,color);text(p,f->detail,156,12,0xe77c);
 if(work){int percent=f->progress;rect(p,70,177,100,4,0x320a);if(percent>=0)rect(p,70,177,percent>100?100:percent,4,color);else rect(p,70+(tick%7)*12,177,16,4,color);}
 else if(f->uid[0])text(p,f->uid,177,12,0x9d77);
 else text(p,"NTAG215",177,12,0x9d77);
 char footer[50];snprintf(footer,sizeof footer,"USB %s  %s",f->usb_open?"ON":"OFF",f->sound?"声 ON":"静音");text(p,footer,192,12,0x9d77);
}
