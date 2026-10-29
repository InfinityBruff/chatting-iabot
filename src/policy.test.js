import test from 'node:test';
import assert from 'node:assert/strict';
import {canAssist,defaults,validateConfig} from './policy.js';
test('pause overrides individual selection',()=>{assert.equal(canAssist({...defaults,mode:'off'},{on:true}),false)});
test('selection mode only includes selected fans',()=>{assert.equal(canAssist(defaults,{on:true}),true);assert.equal(canAssist(defaults,{on:false}),false)});
test('all mode includes fans regardless of saved selection',()=>{assert.equal(canAssist({...defaults,mode:'all'},{on:false}),true)});
test('waiting interval rejects invalid and inverted bounds',()=>{for(const [min,max] of [[30,10],[-1,30],[1,3601],[1.5,30],['',30]])assert.ok(validateConfig({...defaults,min,max}));assert.equal(validateConfig(defaults),'')});

test('global BRUFF pause and manual takeover override all mode',()=>{assert.equal(canAssist({...defaults,mode:'all',paused:true},{on:true}),false);assert.equal(canAssist({...defaults,mode:'all'},{on:true,humanPaused:true}),false)});
test('star rating respects thresholds and distinguishes unavailable spend',async()=>{const {starRating}=await import('./policy.js');assert.equal(starRating(null),null);assert.equal(starRating(0),0);assert.equal(starRating(9999),1);assert.equal(starRating(10000),2);assert.equal(starRating(250000),5);assert.ok(validateConfig({...defaults,starThresholds:[1,100,90,200,300]}))});
test('online campaigns exclude offline or unknown fans; selection does not expand',async()=>{const {campaignRecipients}=await import('./policy.js');const fans=[{id:1,online:true},{id:2,online:false},{id:3}];assert.deepEqual(campaignRecipients(fans,'online'),[1]);assert.deepEqual(campaignRecipients(fans,'selected',[2]),[2]);assert.deepEqual(campaignRecipients(fans,'selected',[]),[])});

// Account isolation and migration protect existing conversations when switching profiles.
import {scopeState,fansFor} from './creators.js';
test('profile migration preserves messages and runs only once',()=>{
 const original={fans:[{id:1,name:'Alex',messages:[{text:'Conservar',mine:true}]}],campaigns:[{id:'old'}]};
 const migrated=scopeState(original);
 assert.equal(fansFor(migrated,'luna')[0].messages[0].text,'Conservar');
 assert.deepEqual(fansFor(migrated,'valeria').map(f=>f.id),[101,102]);
 assert.equal(migrated.campaigns[0].creatorId,'luna');
 assert.deepEqual(scopeState(migrated),migrated);
 assert.equal(scopeState({...migrated,activeCreatorId:'valeria'}).activeCreatorId,'valeria');
});

import {migrateWorkspace,configFor,setAccountMode,toggleFans,validateMember,commissionEstimate} from './workspace.js';
function workspace(){return migrateWorkspace(scopeState({config:{...defaults},fans:[{id:1,creatorId:'luna',on:false,messages:[]},{id:2,creatorId:'luna',on:true,messages:[]},{id:101,creatorId:'valeria',on:false,messages:[]},{id:102,creatorId:'valeria',on:true,messages:[]}],creatorSchema:1}));}
test('all chats on one account preserves selected-only mode on another',()=>{const state=setAccountMode(workspace(),'luna','all');assert.equal(canAssist(configFor(state,'luna'),state.fans[0]),true);assert.equal(canAssist(configFor(state,'valeria'),state.fans[2]),false);assert.equal(canAssist(configFor(state,'valeria'),state.fans[3]),true)});
test('manual exceptions work in all mode without affecting other fans or accounts',()=>{let state=setAccountMode(workspace(),'luna','all');const original=state.fans[2];state=toggleFans(state,'luna',[1,101],false);assert.equal(canAssist(configFor(state,'luna'),state.fans[0]),false);assert.equal(canAssist(configFor(state,'luna'),state.fans[1]),true);assert.equal(state.fans[2],original);state=toggleFans(state,'luna',[1],true);assert.equal(canAssist(configFor(state,'luna'),state.fans[0]),true)});
test('agency pause preserves every account mode and cannot be overridden by fan toggle',()=>{let state={...setAccountMode(workspace(),'luna','all'),globalPaused:true};state=toggleFans(state,'luna',[1],true);assert.equal(canAssist(configFor(state,'luna'),state.fans[0]),false);state={...state,globalPaused:false};assert.equal(canAssist(configFor(state,'luna'),state.fans[0]),true);assert.equal(state.accountConfigs.valeria.mode,'selected')});
test('account all explicitly clears its exceptions, pause retains selected fans',()=>{let state=toggleFans(workspace(),'luna',[1],false);state=setAccountMode(state,'luna','off');assert.equal(state.fans[1].on,true);state=setAccountMode(state,'luna','all');assert.equal(state.fans[0].humanPaused,false);assert.equal(state.accountConfigs.valeria.mode,'selected')});
test('legacy settings migrate to isolated accounts without losing notes or templates',()=>{const original={...workspace(),templates:[{id:'mine'}]};original.fans[0].notes='Keep';const copy=migrateWorkspace(original);assert.deepEqual(copy.templates,original.templates);assert.equal(copy.fans[0].notes,'Keep');copy.accountConfigs.luna.tone='Directo';assert.notEqual(copy.accountConfigs.valeria.tone,'Directo')});
test('advanced assistant settings reject contradictory prices and schedules',()=>{const config=workspace().accountConfigs.luna;assert.equal(validateConfig(config),'');assert.ok(validateConfig({...config,priceFloor:50,priceCeiling:10}));assert.ok(validateConfig({...config,followupLimit:10}));assert.ok(validateConfig({...config,quietStart:'99:99'}));assert.ok(validateConfig({...config,quietEnabled:true,quietStart:'08:00',quietEnd:'08:00'}))});
test('team validation rejects duplicates, invalid access and commissions',()=>{const member={id:'1',name:'Demo',email:'demo@example.com',creatorIds:['luna'],permissions:['chat'],commission:10};assert.equal(validateMember(member),'');assert.ok(validateMember({...member,commission:''}));assert.ok(validateMember({...member,commission:101}));assert.ok(validateMember({...member,creatorIds:[]}));assert.ok(validateMember({...member,permissions:['unknown']}));assert.ok(validateMember({...member,id:'2'},[member]));assert.equal(validateMember(member,[member]),'');assert.equal(commissionEstimate(12345,12.5),1543)});
