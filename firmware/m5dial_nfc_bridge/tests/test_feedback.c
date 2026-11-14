#include "ui_model.h"
#include "sound_pattern.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>
int main(void){
 ui_model_t m;char a[22],b[22],c[22];ui_model_reset(&m);
 assert(ui_model_apply(&m,1,0,"idle","",a,b,c)==UI_BEEP_WAIT);
 assert(ui_model_apply(&m,1,1,"idle","",a,b,c)==UI_BEEP_NONE);
 assert(ui_model_apply(&m,1,1,"reading","04AA",a,b,c)==UI_BEEP_READ);
 assert(ui_model_apply(&m,1,1,"reading","04AA",a,b,c)==UI_BEEP_NONE);
 assert(ui_model_apply(&m,1,1,"blank","04AA",a,b,c)==UI_BEEP_OK);
 assert(ui_model_apply(&m,1,0,"blank","04AA",a,b,c)==UI_BEEP_NONE);
 assert(ui_model_apply(&m,1,1,"writing","04AA",a,b,c)==UI_BEEP_WRITE);
 assert(ui_model_apply(&m,1,1,"writing","04AA",a,b,c)==UI_BEEP_NONE);
 assert(ui_model_apply(&m,1,1,"verifying","04AA",a,b,c)==UI_BEEP_VERIFY);
 assert(ui_model_apply(&m,1,1,"write_ok","04AA",a,b,c)==UI_BEEP_DONE);
 assert(!strcmp(a,"身份卡制作完成"));
 assert(ui_model_apply(&m,1,1,"write_ok","04AA",a,b,c)==UI_BEEP_NONE);
 assert(ui_model_apply(&m,1,1,"idle","",a,b,c)==UI_BEEP_WAIT);
 assert(ui_model_apply(&m,0,1,"idle","",a,b,c)==UI_BEEP_ERR);
 assert(ui_model_apply(&m,0,1,"idle","",a,b,c)==UI_BEEP_NONE);
 const sound_note_t *n;assert(sound_pattern(UI_BEEP_WAIT,&n)==1&&n[0].ms==55&&SOUND_WAIT_INTERVAL_MS>=1000);
 assert(sound_pattern(UI_BEEP_READ,&n)==1&&n[0].ms==260);
 assert(sound_pattern(UI_BEEP_OK,&n)==3&&n[0].hz<n[2].hz&&n[1].hz==0);
 assert(sound_pattern(UI_BEEP_DONE,&n)==5&&n[0].hz<n[2].hz&&n[2].hz<n[4].hz);
 assert(sound_pattern(UI_BEEP_ERR,&n)==3&&n[0].hz>n[2].hz);
 puts("PASS feedback: state-specific tones, no repeat while held/progress/USB change, wait resume, Chinese completion and hardware error, authored timing/pitch.");
}
