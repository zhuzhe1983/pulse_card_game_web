/* Node is only needed for development checks, never to play the game. */
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
for(const file of ['readers','clash','clash_roster','clash_synergy','clash_ai','clash_sim','clash_mount','clash_nfc','clash_tactical','wiki','i18n']){
 const run=spawnSync(process.execPath,[path.join(root,'tests',file+'.test.cjs')],{stdio:'inherit'});
 if(run.status!==0)process.exit(run.status||1);
}
console.log('PASS: active clash and retained hardware adapter checks.');
