/* Node is only needed for development checks, never to play the game. */
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
for(const file of ['engine','store','readers','rtc','network-game','clash','clash_roster','wiki']){
 const run=spawnSync(process.execPath,[path.join(root,'tests',file+'.test.cjs')],{stdio:'inherit'});
 if(run.status!==0)process.exit(run.status||1);
}
const fs=require('node:fs');
const E=require('../src/engine.js');
const pack=JSON.parse(fs.readFileSync(path.join(root,'content/pack.json')));
const manifest=JSON.parse(fs.readFileSync(path.join(root,'content/manifest.json')));
if(E.digest(pack)!==manifest.content_hash)throw Error('Pack manifest mismatch: rebuild HTML.');
E.newMatch(pack,'bundle-check',['alpha','beta'],[pack.starter_deck,pack.starter_deck],0);
console.log('PASS: packaged content is valid and matches its manifest.');
