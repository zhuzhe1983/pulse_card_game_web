#include "ui_model.h"
#include <stdio.h>
#include <string.h>
void ui_model_reset(ui_model_t *m){memset(m,0,sizeof *m);strcpy(m->kind,"boot");}
ui_beep_t ui_model_apply(ui_model_t *m,int nfc_ok,int usb_open,const char *kind,const char *uid,char a[22],char b[22],char c[22])
{
 const char *k=kind&&*kind?kind:"idle";
 char sig[72];snprintf(sig,sizeof sig,"%d|%s|%s",nfc_ok,k,uid?uid:"");
 int changed=strcmp(sig,m->sig)!=0;
 ui_beep_t beep=UI_BEEP_NONE;
 const char *title="等待卡片",*detail="请贴近屏幕感应";
 if(!nfc_ok){title="读卡器异常";detail="请重启设备检查";beep=UI_BEEP_ERR;}
 else if(!strcmp(k,"boot")){title="正在启动";detail="正在检查读卡器";beep=UI_BEEP_STOP;}
 else if(!strcmp(k,"reading")){title="读取中";detail="请保持卡片不动";beep=UI_BEEP_READ;}
 else if(!strcmp(k,"blank")){title="空白卡已就绪";detail="在网页确认写入";beep=UI_BEEP_OK;}
 else if(!strcmp(k,"pulse")){title="玩家身份已读取";detail="可以移开卡片";beep=UI_BEEP_OK;}
 else if(!strcmp(k,"game")){title="游戏牌已读取";detail="请查看网页反馈";beep=UI_BEEP_OK;}
 else if(!strcmp(k,"foreign")){title="卡片已读取";detail="卡内已有内容";beep=UI_BEEP_OK;}
 else if(!strcmp(k,"unformatted")){title="卡片未格式化";detail="请换标准空白卡";beep=UI_BEEP_ERR;}
 else if(!strcmp(k,"unsupported")){title="卡片不支持";detail="请使用 NTAG215";beep=UI_BEEP_ERR;}
 else if(!strcmp(k,"error")){title="读取失败";detail="移开后重新放卡";beep=UI_BEEP_ERR;}
 else if(!strcmp(k,"writing")){title="正在写入身份";detail="请勿移开卡片";beep=UI_BEEP_WRITE;}
 else if(!strcmp(k,"verifying")){title="正在读回校验";detail="请勿移开卡片";beep=UI_BEEP_VERIFY;}
 else if(!strcmp(k,"write_ok")){title="身份卡制作完成";detail="校验成功请取卡";beep=UI_BEEP_DONE;}
 else if(!strcmp(k,"write_error")){title="写入未完成";detail="移开再刷检查";beep=UI_BEEP_ERR;}
 else beep=UI_BEEP_WAIT;
 snprintf(a,22,"%s",title);snprintf(b,22,"%s",detail);snprintf(c,22,"%s",uid?uid:"");
 m->nfc_ok=nfc_ok;m->usb_open=usb_open;snprintf(m->kind,sizeof m->kind,"%s",k);snprintf(m->uid,sizeof m->uid,"%s",uid?uid:"");snprintf(m->sig,sizeof m->sig,"%s",sig);
 return changed?beep:UI_BEEP_NONE;
}
