import test from 'node:test';import assert from 'node:assert/strict';
import {adoptFanSpend,fanSectionFresh,createFanSectionDemand,fanRecordPriority} from './fan-record-state.js';import {createSectionReadGuard} from './section-read-guard.js';
const now=Date.parse('2026-11-04T00:00:00Z'),amount=total=>({available:true,total});
test('upper subscription summary can demand profile while the lower profile is hidden',()=>{
 const demand=createFanSectionDemand();demand.set('profile','summary',true);demand.set('profile','details',false);assert.equal(demand.has('profile'),true);
 const guard=createSectionReadGuard({current:()=>true,visible:()=>demand.has('profile')});assert.equal(guard.active(),true);
 demand.set('profile','details',true);demand.set('profile','summary',false);assert.equal(guard.active(),true);demand.set('profile','details',false);assert.equal(guard.active(),false);assert.equal(demand.has('note'),true);
 const other=createFanSectionDemand();assert.equal(other.has('profile'),false);
});
test('scroll reentry or an old batch cannot overwrite a fresh fan-card spend confirmation',()=>{
 const current={data:amount(50),updated:new Date(now).toISOString(),busy:false};assert.equal(adoptFanSpend(current,amount(1),new Date(now-1000).toISOString()),current);assert.equal(adoptFanSpend(current,amount(1),undefined),current);
 const newer=adoptFanSpend(current,amount(60),new Date(now+1000).toISOString());assert.equal(newer.data.total,60);assert.equal(newer.updated,new Date(now+1000).toISOString());
 const legacy=adoptFanSpend({busy:false},amount(0),undefined);assert.equal(legacy.data.total,0);assert.equal(legacy.updated,undefined);assert.equal(fanSectionFresh(legacy,now),false);
});
test('visible cached sections revalidate stale timestamps without falsifying freshness',()=>{
 const current={data:{subscribedOn:true},updated:new Date(now-1000).toISOString()};assert.equal(fanSectionFresh(current,now),true);assert.equal(fanSectionFresh(current,now+30000),false);assert.equal(fanSectionFresh({...current,updated:new Date(now+1).toISOString()},now),false);assert.equal(fanSectionFresh({data:{}},now),false);
});
test('only the selected visible profile summary gets selected secondary priority',()=>{assert.equal(fanRecordPriority('profile',true),'selected');assert.equal(fanRecordPriority('profile',false),'background');for(const kind of ['spend','history','note'])assert.equal(fanRecordPriority(kind,true),'background')});
