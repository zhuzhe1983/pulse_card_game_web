#include "sound_pattern.h"
size_t sound_pattern(ui_beep_t k,const sound_note_t **out){
 static const sound_note_t wait[]={{1800,55}},read[]={{2200,260}},ok[]={{2400,75},{0,55},{3100,105}},
 write[]={{2000,90},{0,50},{2000,90}},verify[]={{2700,45}},done[]={{2100,80},{0,45},{2700,80},{0,45},{3400,180}},error[]={{1100,180},{0,100},{800,240}};
#define PICK(a) do{*out=a;return sizeof a/sizeof a[0];}while(0)
 switch(k){case UI_BEEP_WAIT:PICK(wait);case UI_BEEP_READ:PICK(read);case UI_BEEP_OK:PICK(ok);case UI_BEEP_WRITE:PICK(write);case UI_BEEP_VERIFY:PICK(verify);case UI_BEEP_DONE:PICK(done);case UI_BEEP_ERR:PICK(error);default:*out=0;return 0;}
#undef PICK
}
