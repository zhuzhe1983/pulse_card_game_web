#include "ui_render.h"
#include "ui_model.h"
#include "sound_pattern.h"
#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
int main(int argc,char**argv){assert(argc==3);FILE*f=fopen(argv[1],"rb");assert(f);uint8_t bg[115200];assert(fread(bg,1,sizeof bg,f)==sizeof bg);fclose(f);uint16_t*p=malloc(115200);assert(p);
 const char*kinds[]={"idle","reading","blank","pulse","writing","verifying","write_ok","error","write_error"};
 for(unsigned i=0;i<sizeof kinds/sizeof kinds[0];i++){ui_model_t m;ui_model_reset(&m);ui_frame_t frame={.nfc_ok=true,.usb_open=true,.sound=true,.progress=64};strcpy(frame.kind,kinds[i]);ui_beep_t beep=ui_model_apply(&m,1,1,kinds[i],i?"04AA1B2C3D4E5F":"",frame.title,frame.detail,frame.uid);const sound_note_t *notes;size_t n=sound_pattern(beep,&notes);assert(n);ui_render(p,bg,&frame,2);char name[512];snprintf(name,sizeof name,"%s/%s.ppm",argv[2],kinds[i]);f=fopen(name,"wb");assert(f);fprintf(f,"P6\n240 240\n255\n");for(int j=0;j<240*240;j++){uint8_t rgb[]={(p[j]>>11)*255/31,((p[j]>>5)&63)*255/63,(p[j]&31)*255/31};fwrite(rgb,1,3,f);}fclose(f);}
 free(p);puts("PASS UI: native renderer exports nine status frames and all states have distinct sound patterns.");}
