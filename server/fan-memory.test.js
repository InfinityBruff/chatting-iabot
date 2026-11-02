import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyFanMemory,reviewMemoryCandidates,mergeMemoryCandidates,editMemoryItem} from './fan-memory.js';
const scope={workspaceId:'agency',creatorId:'model-a',fanId:'fan-1'};
const messages=[{...scope,id:'m1',author:'fan',text:'Me puedes llamar Alex.',at:'2026-11-02T00:00:00Z'}];
const candidates=[{key:'name',category:'preferred_name',value:'Alex',messageId:'m1',quote:'llamar Alex'}];
const reviewed=()=>reviewMemoryCandidates(scope,candidates,messages);
const saved=()=>mergeMemoryCandidates(scope,emptyFanMemory(scope),reviewed(),0);
test('memory starts unanalyzed and model statements require review',()=>{assert.equal(emptyFanMemory(scope).coverage,'not_analyzed');assert.equal(saved().items[0].status,'pending')});
test('same fan ID never permits cross-agency or cross-model memory',()=>{for(const key of Object.keys(scope)){const other={...scope,[key]:'other'};assert.throws(()=>reviewMemoryCandidates(scope,candidates,[{...messages[0],...other}]));assert.throws(()=>mergeMemoryCandidates(other,saved(),[],1));assert.throws(()=>editMemoryItem(other,saved(),'name','delete',1))}});
test('invented evidence, duplicate IDs and unsupported categories rejected',()=>{for(const patch of [{messageId:'missing'},{quote:'invented quote'},{category:'spending'},{category:'medical_profile'}])assert.throws(()=>reviewMemoryCandidates(scope,[{...candidates[0],...patch}],messages));assert.throws(()=>reviewMemoryCandidates(scope,candidates,[...messages,...messages]))});
test('model cannot mark its output confirmed or set manual origin',()=>{const item=reviewed()[0];assert.equal(reviewMemoryCandidates(scope,[{...candidates[0],status:'confirmed',origin:'manual',pinned:true}],messages)[0].status,'pending');assert.throws(()=>mergeMemoryCandidates(scope,emptyFanMemory(scope),[{...item,status:'confirmed'}],0))});
test('human corrections and pinned records survive later extraction',()=>{for(const action of ['correct','pin','confirm']){const edited=editMemoryItem(scope,saved(),'name',action,1,'Alejandro');const next=mergeMemoryCandidates(scope,edited,[{...reviewed()[0],value:'Different'}],2);assert.deepEqual(next.items,edited.items)}});
test('deleted memory does not reappear on the next extraction',()=>{const removed=editMemoryItem(scope,saved(),'name','delete',1);assert.equal(mergeMemoryCandidates(scope,removed,reviewed(),2).items.length,0);assert.equal(saved().items.length,1)});
test('concurrent edits are rejected without mutating original state',()=>{const state=saved();assert.throws(()=>editMemoryItem(scope,state,'name','delete',0));assert.throws(()=>mergeMemoryCandidates(scope,state,[],0));assert.equal(state.version,1);assert.equal(state.items.length,1)});
test('malformed or excessive batches fail closed',()=>{assert.throws(()=>emptyFanMemory({...scope,fanId:''}));assert.throws(()=>reviewMemoryCandidates(scope,Array(101).fill(candidates[0]),messages));assert.throws(()=>reviewMemoryCandidates(scope,[{...candidates[0],value:''}],messages))});
test('reviewed candidates cannot be merged into another agency, model or fan',()=>{
  for(const key of Object.keys(scope)){
    const other={...scope,[key]:'other'};
    // Provider message IDs, quotes and memory keys can collide across accounts.
    const foreign=reviewMemoryCandidates(other,candidates,[{...messages[0],...other}]);
    const state=emptyFanMemory(scope);
    assert.throws(()=>mergeMemoryCandidates(scope,state,foreign,0),/fuera/);
    assert.deepEqual(state,emptyFanMemory(scope));
  }
});
test('memory scope survives serialization and cannot be supplied by the AI',()=>{
  const item=reviewMemoryCandidates(scope,[{...candidates[0],workspaceId:'foreign',creatorId:'foreign',fanId:'foreign'}],messages)[0];
  for(const key of Object.keys(scope))assert.equal(item[key],scope[key]);
  const batch=JSON.parse(JSON.stringify([item]));
  assert.equal(mergeMemoryCandidates(scope,emptyFanMemory(scope),batch,0).items.length,1);
  delete batch[0].fanId;
  assert.throws(()=>mergeMemoryCandidates(scope,emptyFanMemory(scope),batch,0),/fuera/);
});
test('mixed stored memory is rejected before merge or human edit',()=>{
  const state=saved();state.items[0].creatorId='other';
  assert.throws(()=>mergeMemoryCandidates(scope,state,reviewed(),1),/fuera/);
  assert.throws(()=>editMemoryItem(scope,state,'name','confirm',1),/fuera/);
  assert.equal(state.version,1);
  assert.equal(state.items[0].status,'pending');
});
