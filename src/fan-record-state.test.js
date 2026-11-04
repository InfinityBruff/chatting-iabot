import test from 'node:test';import assert from 'node:assert/strict';
import {adoptFanSpend,fanSectionFresh,fanSectionNeedsRead,createFanSectionDemand,fanRecordPriority} from './fan-record-state.js';import {createSectionReadGuard} from './section-read-guard.js';
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
test('explicitly visible fan sections get fan-visible priority while timers remain background',()=>{for(const kind of ['profile','spend','history']){assert.equal(fanRecordPriority(kind,'visible'),'fan-visible');assert.equal(fanRecordPriority(kind,'background'),'background')}assert.equal(fanRecordPriority('note','visible'),'background')});
test('fresh list spend adopted on mount prevents a redundant individual spend read without a detail-cache entry',()=>{const current=adoptFanSpend({busy:false},amount(50),new Date(now).toISOString());assert.equal(fanSectionNeedsRead(current,null,now+1000),false);assert.equal(fanSectionNeedsRead(null,current,now+1000),false);assert.equal(fanSectionNeedsRead(current,null,now+30000),true)});
