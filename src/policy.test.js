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

import {draftFor,hasDraft,updateDraft,saveDraftMessage} from './drafts.js';
import {demoMedia} from './fanData.js';
test('drafts are isolated by account AND fan, survive serialization and retain attachments',()=>{
 let state=workspace();state.fans.push({id:1,creatorId:'valeria',messages:[]});
 state=updateDraft(state,'luna',1,{text:'Hola 😊',attachment:demoMedia[0]});
 state=updateDraft(state,'luna',2,{text:'Otro fan'});
 state=updateDraft(state,'valeria',1,{text:'Otra cuenta'});
 const restored=JSON.parse(JSON.stringify(state));
 assert.equal(draftFor(restored.fans[0]).text,'Hola 😊');assert.equal(draftFor(restored.fans[0]).attachment.id,demoMedia[0].id);
 assert.equal(draftFor(restored.fans[1]).text,'Otro fan');assert.equal(draftFor(restored.fans.at(-1)).text,'Otra cuenta');
});
test('saving a local message clears its draft atomically without clearing another fan',()=>{
 let state=updateDraft(workspace(),'luna',1,{text:'  Hola  ',attachment:demoMedia[0]});state=updateDraft(state,'luna',2,{text:'Conservar'});
 const next=saveDraftMessage(state,'luna',1);assert.equal(next.fans[0].messages.at(-1).text,'Hola');assert.equal(next.fans[0].messages.at(-1).attachment.id,demoMedia[0].id);assert.equal(hasDraft(next.fans[0]),false);assert.equal(draftFor(next.fans[1]).text,'Conservar');assert.equal(saveDraftMessage(next,'luna',1).fans[0].messages.length,1);
});
test('draft validation rejects unknown media and malformed text; blank text cannot create a message',()=>{
 assert.deepEqual(draftFor({draft:{text:44,attachment:{id:'unknown'}}}),{text:'',attachment:null});assert.equal(draftFor({draft:{text:'x'.repeat(4000)}}).text.length,3000);
 const state=updateDraft(workspace(),'luna',1,{text:'   '});assert.equal(saveDraftMessage(state,'luna',1).fans[0].messages.length,0);
});

import {archivedFor,moveArchive} from './archive.js';
test('archiving and restoring templates preserve contents and account isolation',()=>{
 const a={id:'same',creatorId:'luna',title:'Luna',text:'Original'},b={id:'same',creatorId:'valeria',title:'Valeria',text:'Other'};const state={templates:[a,b]};
 const archived=moveArchive(state,'templates','luna','same');assert.deepEqual(archived.templates,[b]);assert.deepEqual(archivedFor(archived,'templates','luna'),[a]);assert.deepEqual(archivedFor(archived,'templates','valeria'),[]);
 const restored=moveArchive(JSON.parse(JSON.stringify(archived)),'templates','luna','same',true);assert.deepEqual(restored.templates,[a,b]);assert.deepEqual(restored.archivedTemplates,[]);
});
test('campaign restoration preserves audience and dates and never creates messages',()=>{
 const campaign={id:77,creatorId:'luna',name:'Draft',text:'Hi',recipientIds:[1,2],createdAt:'2026-10-29T00:00:00Z'};const state={campaigns:[campaign],fans:[{id:1,messages:[]}]};const archived=moveArchive(state,'campaigns','luna',77);const restored=moveArchive(archived,'campaigns','luna',77,true);assert.deepEqual(restored.campaigns,[campaign]);assert.equal(restored.fans,state.fans);assert.deepEqual(restored.fans[0].messages,[]);
});
test('archive actions are idempotent and refuse overwriting conflicts or other accounts',()=>{
 const item={id:1,creatorId:'luna',text:'v1'};const state={templates:[item]};const archived=moveArchive(state,'templates','luna',1);assert.equal(moveArchive(archived,'templates','luna',1),archived);assert.equal(moveArchive(archived,'templates','valeria',1,true),archived);const conflict={...archived,templates:[{...item,text:'v2'}]};assert.equal(moveArchive(conflict,'templates','luna',1,true),conflict);assert.equal(moveArchive(state,'unknown','luna',1),state);
});

import {saveCampaign,scopedRecipients} from './campaigns.js';
test('campaign edits preserve identity and creation date without duplicating or touching another account',()=>{
 const old={id:1,creatorId:'luna',name:'Before',text:'Before',audience:'selected',recipientIds:[1],createdAt:'2026-01-01'},other={...old,creatorId:'valeria'};const state={...workspace(),campaigns:[old,other]};const next=saveCampaign(state,'luna',{name:' After ',text:' Edited ',audience:'selected',recipientIds:[2]},1,'2026-10-29');assert.equal(next.campaigns.length,2);assert.equal(next.campaigns[0].id,1);assert.equal(next.campaigns[0].createdAt,'2026-01-01');assert.equal(next.campaigns[0].text,'Edited');assert.equal(next.campaigns[1],other);assert.equal(next.fans,state.fans);
});
test('campaign recipients exclude other accounts and deduplicate; unavailable drafts are not recreated',()=>{
 const state={...workspace(),campaigns:[]};assert.deepEqual(scopedRecipients(state.fans,'luna',[1,1,101,999]),[1]);assert.throws(()=>saveCampaign(state,'luna',{name:'Test',text:'Test',audience:'all',recipientIds:[1]},42));assert.throws(()=>saveCampaign(state,'luna',{name:'Test',text:'Test',audience:'all',recipientIds:[101]}));
});
test('new drafts have unique IDs and reject invalid content without sending messages',()=>{
 const state={...workspace(),campaigns:[]};const input={name:'Campaign',text:'Hello',audience:'selected',recipientIds:[1]};const a=saveCampaign(state,'luna',input),b=saveCampaign(a,'luna',input);assert.notEqual(a.campaigns[0].id,b.campaigns[0].id);assert.equal(b.campaigns.length,2);assert.equal(b.fans,state.fans);for(const patch of [{name:' '},{text:' '},{text:'x'.repeat(3001)},{audience:'bad'}])assert.throws(()=>saveCampaign(state,'luna',{...input,...patch}));
});

import {createUnsavedRegistry,sameFields} from './unsaved.js';
test('unsaved editors register independently and saving one does not clear another',()=>{const registry=createUnsavedRegistry(),luna=Symbol(),valeria=Symbol();registry.set(luna,'Luna',true);registry.set(valeria,'Valeria',true);assert.deepEqual(registry.labels(),['Luna','Valeria']);registry.set(luna,'Luna',false);assert.equal(registry.hasChanges(),true);assert.deepEqual(registry.labels(),['Valeria']);registry.remove(valeria);assert.equal(registry.hasChanges(),false)});
test('editor unmount and repeat registration do not leave stale warnings',()=>{const registry=createUnsavedRegistry(),key=Symbol();registry.set(key,'Notes',true);registry.set(key,'Notes',true);assert.equal(registry.labels().length,1);registry.remove(key);registry.remove(key);assert.equal(registry.hasChanges(),false)});
test('fan context comparison treats unset fields as empty but detects edits',()=>{const keys=['nickname','timezone'];assert.equal(sameFields({nickname:'',timezone:''},undefined,keys),true);assert.equal(sameFields({nickname:'Alex'}, {nickname:'Alex'},keys),true);assert.equal(sameFields({nickname:'Alejandro'}, {nickname:'Alex'},keys),false)});

import {editorChanged} from './unsaved.js';
test('protected editors open clean, detect changed fields and become clean after reverting',()=>{const baseline={id:'worker',name:'Demo',permissions:['chat'],commission:10};assert.equal(editorChanged(structuredClone(baseline),baseline),false);assert.equal(editorChanged({...baseline,commission:15},baseline),true);assert.equal(editorChanged({...baseline,permissions:['chat','team']},baseline),true);assert.equal(editorChanged(structuredClone(baseline),baseline),false);assert.equal(editorChanged(null,baseline),false)});
test('new blank templates do not warn until edited and isolated baselines remain untouched',()=>{const baseline={creatorId:'luna',title:'',text:'',category:'General'};const edited={...baseline,text:'Hello'};assert.equal(editorChanged(baseline,structuredClone(baseline)),false);assert.equal(editorChanged(edited,baseline),true);assert.equal(baseline.text,'');assert.equal(editorChanged({...baseline,creatorId:'valeria'},baseline),true)});

import {vaultFor,filterVault,toggleVaultFavorite} from './vault.js';
test('vault folders and content are scoped to creator even with mixed data',()=>{const a=vaultFor('luna'),b=vaultFor('valeria');const mixed={items:[...a.items,...b.items],folders:[...a.folders,...b.folders]};assert.equal(filterVault(mixed,'luna').length,a.items.length);assert.ok(filterVault(mixed,'luna').every(i=>i.creatorId==='luna'));assert.deepEqual(vaultFor('unknown'),{folders:[],items:[]})});
test('vault search combines accent-insensitive text, folders, format and favorites',()=>{const data=vaultFor('luna');assert.equal(filterVault(data,'luna',{query:'videos',type:'Vídeo'}).length,1);assert.equal(filterVault(data,'luna',{folder:'unfiled'}).length,1);assert.equal(filterVault(data,'luna',{folder:'favorites',favorites:[]}).length,0);assert.equal(filterVault(data,'luna',{folder:data.folders[1].id,type:'Audio'}).length,0)});
test('vault favorites persist independently and reject items from other accounts',()=>{let state=toggleVaultFavorite({},'luna','luna-media-0');state=toggleVaultFavorite(state,'valeria','valeria-media-1');assert.deepEqual(state.vaultFavorites.luna,['luna-media-0']);assert.equal(toggleVaultFavorite(state,'luna','valeria-media-1'),state);const restored=JSON.parse(JSON.stringify(state));assert.equal(filterVault(vaultFor('luna'),'luna',{folder:'favorites',favorites:restored.vaultFavorites.luna}).length,1);assert.deepEqual(toggleVaultFavorite(state,'luna','luna-media-0').vaultFavorites.luna,[])});
