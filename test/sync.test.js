import test from 'node:test';
import assert from 'node:assert/strict';
import { LibrarySync } from '../dist/sync.js';
const defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
test('Serializes saves and keeps edits made while a request is in flight',async()=>{
 const first=defer(), calls=[];
 const sync=new LibrarySync({revision:3,save:async payload=>{calls.push(payload);if(calls.length===1)return first.promise;return{revision:5};}});
 sync.enqueue({draft:'A'});const run=sync.flush();sync.enqueue({draft:'B'});
 first.resolve({revision:4});assert.equal(await run,true);
 assert.deepEqual(calls,[{revision:3,library:{draft:'A'}},{revision:4,library:{draft:'B'}}]);assert.equal(sync.pending,null);
});
test('Network failure keeps latest draft for retry with unchanged base revision',async()=>{
 let online=false;const sync=new LibrarySync({revision:0,save:async()=>{if(!online)throw new Error('offline');return{revision:1};}});
 sync.enqueue({draft:'Рукопись'});assert.equal(await sync.flush(),false);assert.equal(sync.revision,0);assert.deepEqual(sync.pending,{draft:'Рукопись'});
 online=true;assert.equal(await sync.flush(),true);assert.equal(sync.revision,1);
});
test('Conflict and expired session stop automatic retries without discarding the draft',async()=>{
 for(const status of [409,401]){
  let calls=0;const sync=new LibrarySync({revision:0,save:async()=>{calls++;throw Object.assign(new Error('blocked'),{status});}});
  sync.enqueue({draft:'Keep me'});assert.equal(await sync.flush(),false);assert.equal(await sync.flush(),false);
  assert.equal(calls,1);assert.deepEqual(sync.pending,{draft:'Keep me'});assert.equal(sync.paused,true);
 }
});

test('Pausing during an in-flight save never sends a later edit',async()=>{
 const first=defer();let calls=0;
 const sync=new LibrarySync({revision:1,save:async()=>{calls++;return first.promise;}});
 sync.enqueue({draft:'A'});const running=sync.flush();sync.enqueue({draft:'B'});sync.pause(Object.assign(new Error('Account changed'),{status:409}));
 first.resolve({revision:2});assert.equal(await running,false);assert.equal(calls,1);assert.deepEqual(sync.pending,{draft:'B'});
});
