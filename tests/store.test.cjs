'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
// Exercise the browser lock path without Node's process-lifetime Web Locks behavior.
if (!globalThis.navigator) globalThis.navigator = {};
let lockQueue = Promise.resolve();
Object.defineProperty(globalThis.navigator,'locks',{configurable:true,value:{request(_key,run){const result=lockQueue.then(run);lockQueue=result.catch(()=>{});return result;}}});
require('../src/engine.js'); require('../src/content.js'); require('../src/store.js');
const E = globalThis.PCGEngine, C = globalThis.PCGContent, S = globalThis.PCGStore;
const clone = x => JSON.parse(JSON.stringify(x));
const reference = p => JSON.parse(fs.readFileSync(path.join(__dirname,'reference',p),'utf8'));
class MemoryStorage {
  constructor(raw = null) { this.map = new Map(raw === null ? [] : [[S.KEY,raw]]); this.failWrites = false; }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k,v) { if (this.failWrites) throw new Error('QuotaExceededError'); this.map.set(k,String(v)); }
}
const PLAYER = '10000000-0000-4000-8000-000000000001';
const PLAYER2 = '10000000-0000-4000-8000-000000000002';
const hero = (n=1, tid='paper_archive') => ({hero_card_id:'issued:30000000-0000-4000-8000-'+String(n).padStart(12,'0'),mode:'fixed',template_id:tid});
const tests = [];
const test = (name,run) => tests.push({name,run});
const originalNow = Date.now; let now = Date.UTC(2026,10,9,8,0,0); Date.now = () => now;
async function setup() { const storage = new MemoryStorage(), store = new S.DataStore(storage); await store.createPlayer({id:PLAYER,name:'测试玩家',skin:'01',key:'demo:player_a',simulated:true}); return {storage,store}; }
function raw(storage) { return storage.getItem(S.KEY); }

test('daily boundary is Shanghai midnight', async()=> {
 const edge=Date.UTC(2026,10,9,16,0,0); assert.equal(S.day(edge),S.day(edge-1)+1);
});
test('24-character Unicode names preserve emoji and remain readable',async()=>{
 const storage=new MemoryStorage(),store=new S.DataStore(storage),name='a'.repeat(23)+'😀';
 await store.createPlayer({id:PLAYER,name,skin:'01'});assert.equal(store.getProfile(PLAYER).nickname,name);
 const emojiName='😀'.repeat(26);await store.createPlayer({id:PLAYER2,name:emojiName,skin:'09'});assert.equal(store.getProfile(PLAYER2).nickname,'😀'.repeat(24));
 const restarted=new S.DataStore(storage);assert.equal(restarted.getProfile(PLAYER).nickname,name);assert.equal(Array.from(restarted.getProfile(PLAYER2).nickname).length,24);
});
test('invalid Unicode anywhere in a transaction is rejected before storage',async()=>{
 const {store,storage}=await setup(),before=raw(storage);
 await assert.rejects(store.createPlayer({id:PLAYER2,name:'bad\ud800',skin:'02'}),e=>e.code==='JSON_INVALID_UNICODE');assert.equal(raw(storage),before);
 await assert.rejects(store.tx(d=>{d.profiles[PLAYER].extensions.future={text:'\udc00'};}),e=>e.code==='JSON_INVALID_UNICODE');assert.equal(raw(storage),before);
 assert.equal(store.getProfile(PLAYER).nickname,'测试玩家');
});
test('fixed card grants one owned character and daily duplicate is atomic',async()=>{
 const {store,storage}=await setup(); const result=await store.claim(PLAYER,hero());
 assert.equal(result.template_id,'paper_archive'); assert.equal(result.is_duplicate,false); assert.equal(result.shards_delta,0);
 const before=raw(storage); await assert.rejects(store.claim(PLAYER,hero()),/今天已领取/); assert.equal(raw(storage),before);
 assert.equal(store.getProfile(PLAYER).collection.length,1); assert.equal(store.getProfile(PLAYER).day_ledger.claims.length,1);
});
test('daily scope is player plus card, and repeated character adds shards',async()=>{
 const {store}=await setup(); await store.createPlayer({id:PLAYER2,name:'另一玩家',skin:'09',key:'demo:player_b'});
 await store.claim(PLAYER,hero()); await store.claim(PLAYER2,hero());
 const repeat=await store.claim(PLAYER,hero(2)); assert.equal(repeat.is_duplicate,true); assert.equal(repeat.shards_delta,10);
 assert.equal(store.getProfile(PLAYER).wallet.shards,10); assert.equal(store.getProfile(PLAYER).collection[0].draw_count,2);
 assert.equal(store.getProfile(PLAYER2).wallet.shards,0);
});
test('new day allows claim and replaces only daily ledger',async()=>{
 const {store}=await setup(); await store.claim(PLAYER,hero()); const base=now; now+=86400000;
 try { const r=await store.claim(PLAYER,hero()); assert.equal(r.is_duplicate,true); assert.equal(store.getProfile(PLAYER).day_ledger.claims.length,1); assert.equal(store.getProfile(PLAYER).collection[0].draw_count,2); } finally { now=base; }
});
test('clock rollback cannot grant additional rewards',async()=>{
 const {store,storage}=await setup(); await store.claim(PLAYER,hero()); const base=now,before=raw(storage); now-=86400000;
 try { await assert.rejects(store.claim(PLAYER,hero(2)),/日期回拨/); assert.equal(raw(storage),before); } finally { now=base; }
});
test('blind draw is deterministic after failed storage write',async()=>{
 const {store,storage}=await setup(), before=raw(storage); const twin=new S.DataStore(new MemoryStorage(before));
 const blind={hero_card_id:hero(3).hero_card_id,mode:'blind'};
 storage.failWrites=true; await assert.rejects(store.claim(PLAYER,blind),/保存失败/); assert.equal(raw(storage),before); assert.equal(store.data.profiles[PLAYER].collection.length,0);
 storage.failWrites=false; const actual=await store.claim(PLAYER,blind), expected=await twin.claim(PLAYER,blind); assert.deepEqual(actual,expected);
 assert.equal(store.getProfile(PLAYER).day_ledger.claims.length,1);
});
test('both original Python draw-vector rewards match',async()=>{
 const vectors=reference('fixtures/draw_vectors.json'), oldPack=C.pack, oldNow=now; C.pack=reference('content/core_pack.json');
 try {
  const {store}=await setup();
  for(const v of vectors.vectors){now=v.observed_utc_ms;const descriptor={hero_card_id:v.hero.hero_card_id,mode:v.hero.mode==='blind_box'?'blind':'fixed',template_id:v.hero.fixed_template_id};const result=await store.claim(PLAYER,descriptor);assert.deepEqual(result,v.expected_reward);}
 } finally {C.pack=oldPack;now=oldNow;}
});
test('invalid fixed reward and no logged-in player do not mutate',async()=>{
 const {store,storage}=await setup(),before=raw(storage);
 await assert.rejects(store.claim(PLAYER,hero(1,'signal_boost')),/指定角色/); await assert.rejects(store.claim(PLAYER2,hero()),/先刷玩家卡/); assert.equal(raw(storage),before);
});
test('deck rejects missing, duplicated and unknown cards',async()=>{
 const {store,storage}=await setup(),before=raw(storage),deck=C.pack.starter_deck;
 for(const bad of [deck.slice(1),Array(10).fill(deck[0]),['missing',...deck.slice(1)]]){await assert.rejects(store.setDeck(PLAYER,bad),/恰好 10/);assert.equal(raw(storage),before);}
 const reverse=deck.slice().reverse(); await store.setDeck(PLAYER,reverse); assert.deepEqual(store.getProfile(PLAYER).decks[0].template_ids,reverse);
 assert.equal(store.getProfile(PLAYER).collection.length,0,'standard loan cards do not require owned collection');
});
test('cosmetic unlock spends 50 shards once and never edits combat pack',async()=>{
 const {store,storage}=await setup(),packHash=E.digest(C.pack);
 await assert.rejects(store.ink(PLAYER,'paper_archive'),/先拥有/); await store.claim(PLAYER,hero());
 const before=raw(storage); await assert.rejects(store.ink(PLAYER,'paper_archive'),/50 碎片/); assert.equal(raw(storage),before);
 for(let i=2;i<=6;i++)await store.claim(PLAYER,hero(i)); assert.equal(store.getProfile(PLAYER).wallet.shards,50);
 await store.ink(PLAYER,'paper_archive'); assert.equal(store.getProfile(PLAYER).wallet.shards,0); assert.equal(store.getProfile(PLAYER).collection[0].skin_id,'ink');
 await store.ink(PLAYER,'paper_archive'); assert.equal(store.getProfile(PLAYER).collection[0].skin_id,'base');
 await store.ink(PLAYER,'paper_archive'); assert.equal(store.getProfile(PLAYER).collection[0].skin_id,'ink'); assert.equal(store.getProfile(PLAYER).wallet.shards,0); assert.equal(E.digest(C.pack),packHash);
});
test('player card and hero card cannot overwrite one another',async()=>{
 const {store,storage}=await setup(),before=raw(storage);
 await assert.rejects(store.bindHero('demo:player_a','blind'),/已绑定/); assert.equal(raw(storage),before);
 await store.bindHero('uid:04010203040506','fixed','paper_archive'); const binding=store.binding('uid:04010203040506'); assert.equal(binding.type,'hero');
 const bound=raw(storage); await assert.rejects(store.createPlayer({id:PLAYER,skin:'01',key:'uid:04010203040506'}),/已绑定/); assert.equal(raw(storage),bound);
});
test('export then import creates independent browser profile and card binding',async()=>{
 const {store}=await setup(); await store.claim(PLAYER,hero()); const destination=new S.DataStore(new MemoryStorage());
 const device=destination.data.device_id, result=await destination.import(store.export()); assert.equal(result.count,1); assert.equal(destination.data.device_id,device);
 assert.deepEqual(destination.getProfile(PLAYER),store.getProfile(PLAYER)); assert.deepEqual(destination.binding('demo:player_a'),store.binding('demo:player_a'));
 assert.equal((await destination.import(store.export())).count,0,'identical profile import is idempotent');
});
test('known newer descendant imported; older ancestor cannot overwrite',async()=>{
 const {store,storage}=await setup(),ancestor=store.export(),other=new S.DataStore(new MemoryStorage(raw(storage)));
 await other.claim(PLAYER,hero()); assert.equal((await store.import(other.export())).count,1); assert.deepEqual(store.getProfile(PLAYER),other.getProfile(PLAYER));
 const current=clone(store.getProfile(PLAYER)); assert.equal((await store.import(ancestor)).count,0); assert.deepEqual(store.getProfile(PLAYER),current);
});
test('concurrent branches are rejected without any partial import',async()=>{
 const {store,storage}=await setup(),other=new S.DataStore(new MemoryStorage(raw(storage)));
 await store.claim(PLAYER,hero()); await other.claim(PLAYER,hero(2)); await other.createPlayer({id:PLAYER2,name:'新玩家',skin:'02'});
 const before=raw(storage); await assert.rejects(store.import(other.export()),/存档分支/); assert.equal(raw(storage),before); assert.equal(store.getProfile(PLAYER2),null);
});
test('same snapshot id with different payload is rejected',async()=>{
 const {store,storage}=await setup(),backup=JSON.parse(store.export());backup.data.profiles[PLAYER].nickname='伪造变化';const before=raw(storage);
 await assert.rejects(store.import(JSON.stringify(backup)),/存档分支/); assert.equal(raw(storage),before);
});
test('wrong content version, negative wallet and duplicate ownership are rejected',async()=>{
 const {store,storage}=await setup();await store.claim(PLAYER,hero());const before=raw(storage);
 for(const change of [b=>b.content_hash='0'.repeat(64),b=>b.data.profiles[PLAYER].wallet.shards=-1,b=>b.data.profiles[PLAYER].collection.push(clone(b.data.profiles[PLAYER].collection[0]))]){const backup=JSON.parse(store.export());change(backup);await assert.rejects(store.import(JSON.stringify(backup)));assert.equal(raw(storage),before);}
});
test('malformed stored JSON is preserved for recovery',async()=>{
 const storage=new MemoryStorage('{broken');assert.throws(()=>new S.DataStore(storage),/原数据已保留/);assert.equal(raw(storage),'{broken');
});
test('match statistics are applied once for duplicate final state',async()=>{
 const {store}=await setup(),state={phase:'finished',match_id:'finished_match',winner:0};await store.recordMatch([PLAYER,PLAYER2],state);await store.recordMatch([PLAYER,PLAYER2],state);
 assert.deepEqual(store.getProfile(PLAYER).extensions.web.stats,{played:1,won:1,drawn:0});
});

// Integrity regressions: lineage may not be accepted on contradictory evidence.
test('contradictory ancestry is a conflict',async()=>{
 const {store,storage}=await setup();await store.claim(PLAYER,hero());const local=store.getProfile(PLAYER),backup=JSON.parse(store.export()),incoming=backup.data.profiles[PLAYER];
 incoming.snapshot_id=local.parent_snapshot_id;incoming.parent_snapshot_id=local.snapshot_id;incoming.history_tail=[local.snapshot_id];incoming.save_seq=local.save_seq+1;incoming.modified_at_ms=local.modified_at_ms+1;
 const before=raw(storage);await assert.rejects(store.import(JSON.stringify(backup)));assert.equal(raw(storage),before);
});
test('claimed ancestor with a newer counter must be rejected',async()=>{
 const {store,storage}=await setup();const ancestor=JSON.parse(store.export());await store.claim(PLAYER,hero());const local=store.getProfile(PLAYER),incoming=ancestor.data.profiles[PLAYER];incoming.save_seq=local.save_seq+5;incoming.modified_at_ms=local.modified_at_ms+5;
 const before=raw(storage);await assert.rejects(store.import(JSON.stringify(ancestor)));assert.equal(raw(storage),before);
});
test('malformed lineage metadata is rejected on import',async()=>{
 const {store}=await setup(),backup=JSON.parse(store.export());backup.data.profiles[PLAYER].history_tail='not-an-array';
 const storage=new MemoryStorage(),destination=new S.DataStore(storage),before=raw(storage);
 await assert.rejects(destination.import(JSON.stringify(backup)));assert.equal(raw(storage),before);
});

(async()=>{
 let passed=0,failed=0;
 try{for(const {name,run}of tests){try{await run();passed++;}catch(e){failed++;console.error('FAIL:',name,'—',e.message);}}}
 finally{Date.now=originalNow;}
 console.log('Store: '+passed+'/'+tests.length+' scenarios passed'+(failed?' ('+failed+' failures)':''));if(failed)process.exitCode=1;
})();
