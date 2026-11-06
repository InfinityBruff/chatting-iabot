import test from 'node:test';
import assert from 'node:assert/strict';
import {scopeKey} from './chat-direct.js';
import {vaultAttachment} from './vault-library.js';
import {draftSnapshot,inspectDraft,applyChatDirectDraft,resolveChatDirectMedia} from './chat-direct-draft.js';

const identity={actor:'worker',workspace:'agency',account:'model-A',fanId:'123'},scope=scopeKey(identity);
const draft=(patch={})=>({text:'Existing 🙂  ',price:'9,99',attachments:[{id:'5',token:'existing',name:'Current file',media:{id:'5',type:'photo',url:'existing-preview'}}],reply:{id:'7',text:'Current reply'},...patch});
const content=(patch={})=>({accountId:'model-A',currency:'USD',priceCents:1299,mediaIds:['42','43'],reason:'Documented bundle',reference:{id:'reference-1',version:1,verified:true},...patch});
const row=(id,patch={})=>({id,type:'photo',isReady:true,canView:true,hasError:false,attachment:'fake-capability-'+id,preview:null,...patch});
const page=(media,hasMore=false,cursor=null)=>({data:{media,hasMore,cursor}});
const insert=(patch={})=>{const current=patch.draft??draft();return applyChatDirectDraft({scope,currentScope:scope,token:'choice-1',consumed:new Set(),enabled:true,draft:current,text:'New text 🙂  ',mode:'replace',expectedSnapshot:draftSnapshot(current),...patch})};
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}};

test('private draft snapshot detects raw price, attachment metadata/order/tokens and reply changes without object key-order noise',()=>{
 const original=draft(),before=draftSnapshot(original);
 for(const patch of [{text:'Existing 🙂 '},{price:'9.99'},{attachments:[{...original.attachments[0],token:'renewed'}]},{attachments:[{...original.attachments[0],media:{...original.attachments[0].media,preview:'new'}}]},{reply:{...original.reply,text:'Edited'}},{reply:null}])assert.notEqual(draftSnapshot({...original,...patch}),before);
 assert.equal(draftSnapshot({...original,reply:{text:original.reply.text,id:original.reply.id}}),before);
 assert.deepEqual(inspectDraft(original),{text:original.text,snapshot:before,hasPrepared:true});
 const two=draft({attachments:[...original.attachments,{id:'6',token:'second'}]});assert.notEqual(draftSnapshot(two),draftSnapshot({...two,attachments:two.attachments.slice().reverse()}));
});

test('prepared state includes whitespace, attachments, nonzero or invalid raw prices and replies; explicit zero remains empty',()=>{
 const empty=draft({text:'',attachments:[],reply:null,price:'0'});
 for(const price of ['0','0,00','0.00','',0,null,undefined])assert.equal(inspectDraft({...empty,price}).hasPrepared,false);
 for(const patch of [{text:' '},{attachments:[{token:'saved-upload'}]},{price:'1'},{price:'invalid'},{price:false},{reply:{id:'7'}}])assert.equal(inspectDraft({...empty,...patch}).hasPrepared,true);
});

test('check returns a private complete draft guard without mutation or consuming the selection',()=>{
 const current=draft(),before=JSON.stringify(current),consumed=new Set();
 assert.deepEqual(insert({draft:current,mode:'check',text:undefined,consumed}),{status:'checked',currentText:current.text,draftSnapshot:draftSnapshot(current),hasPrepared:true});
 assert.equal(JSON.stringify(current),before);assert.equal(consumed.size,0);
});

test('text append/replace preserve exact attachments, raw price and reply while guarding every draft field',()=>{
 const current=draft(),before=JSON.stringify(current);
 assert.deepEqual(insert({draft:current,mode:'append'}),{status:'ready',text:'Existing 🙂  \nNew text 🙂  ',price:'9,99',attachments:current.attachments});
 assert.deepEqual(insert({draft:current}),{status:'ready',text:'New text 🙂  ',price:'9,99',attachments:current.attachments});
 for(const patch of [{text:'Edited'},{price:'0'},{attachments:[]},{reply:null}]){const result=insert({draft:{...current,...patch},expectedSnapshot:draftSnapshot(current)});assert.equal(result.status,'conflict');assert.equal(result.draftSnapshot,draftSnapshot({...current,...patch}))}
 assert.equal(JSON.stringify(current),before);
});

test('scope changes, revoked editing, locks and replayed choices cannot alter a draft',()=>{
 for(const field of Object.keys(identity))assert.equal(insert({currentScope:scopeKey({...identity,[field]:'changed'})}).status,'stale');
 for(const patch of [{scope:null},{scope:'invalid'}])assert.equal(insert(patch).status,'stale');
 for(const patch of [{enabled:false},{enabled:'true'},{locked:true},{token:''},{mode:'send'},{expectedSnapshot:undefined},{draft:{text:null,attachments:[]}}])assert.equal(insert(patch).status,'blocked');
 for(const consumed of [new Set(['choice-1']),['choice-1'],'choice-1'])assert.equal(insert({consumed}).status,'duplicate');
});

test('text insertion refuses overlong drafts or combined text without silently trimming',()=>{
 assert.equal(insert({text:'x'.repeat(10000),mode:'replace'}).text.length,10000);
 assert.equal(insert({text:'x'.repeat(10001)}).status,'blocked');
 assert.equal(insert({draft:draft({text:'x'.repeat(9999)}),text:'ok',mode:'append'}).reason,'limit');
 assert.equal(insert({draft:draft({attachments:Array(11).fill({token:'old'})})}).status,'blocked');
});

test('bundle replacement atomically returns ordered verified attachments and one total price, preserving owner-managed reply',()=>{
 const current=draft(),bundle=content(),items=bundle.mediaIds.map(id=>vaultAttachment(row(id))),before=JSON.stringify([current,bundle,items]);
 const result=insert({draft:current,mode:'replace-bundle',content:bundle,attachments:items});
 assert.deepEqual(result,{status:'ready',text:'New text 🙂  ',price:'12.99',attachments:items});assert.notEqual(result.attachments,items);assert.deepEqual(current.reply,{id:'7',text:'Current reply'});
 assert.equal(insert({mode:'replace-bundle',content:content({priceCents:0}),attachments:items}).price,'0');
 assert.equal(JSON.stringify([current,bundle,items]),before);
});

test('bundle insertion blocks unknown/invalid prices, foreign models, unsigned shapes, wrong order and duplicate assets',()=>{
 const bundle=content(),items=bundle.mediaIds.map(id=>vaultAttachment(row(id)));
 for(const patch of [{priceCents:null},{priceCents:-1},{priceCents:12.5},{priceCents:'1299'},{currency:'EUR'},{accountId:'model-B'},{mediaIds:['42','42']},{mediaIds:[]},{mediaIds:Array.from({length:11},(_,i)=>String(i+1))},{reference:{id:'ref',version:1,verified:false}}])assert.equal(insert({mode:'replace-bundle',content:content(patch),attachments:items}).status,'blocked');
 for(const attachments of [items.slice().reverse(),[items[0]],[{...items[0],token:'changed'},items[1]],[vaultAttachment(row('42',{isReady:false})),items[1]],[{...items[0],id:'99'},items[1]]])assert.equal(insert({mode:'replace-bundle',content:bundle,attachments}).status,'blocked');
});

test('content may be inspected but never inserted through text-only append or replace modes',()=>{
 const bundle=content(),items=bundle.mediaIds.map(id=>vaultAttachment(row(id)));
 assert.equal(insert({mode:'check',content:bundle}).status,'checked');
 for(const mode of ['append','replace'])assert.deepEqual(insert({mode,content:bundle,attachments:items}),{status:'blocked',reason:'content'});
 assert.equal(insert({content:null}).status,'ready');
 const unrepresentable=9007199254740990;
 assert.notEqual(Math.round(unrepresentable/100*100),unrepresentable);
 assert.equal(insert({mode:'replace-bundle',content:content({priceCents:unrepresentable}),attachments:items}).status,'blocked');
});

test('resolver reads sequential authorized pages and returns the requested bundle order with existing vault shape',async()=>{
 const calls=[],responses=[page([row(43),row('50',{isReady:false,attachment:null})],true,'older'),page([row('42')])];
 const result=await resolveChatDirectMedia({content:content({categoryId:'8'}),request:async(operation,args)=>{calls.push([operation,args]);return responses.shift()}});
 assert.deepEqual(calls,[['vault_media',{creator_id:'model-A',type:'all',category:'8'}],['vault_media',{creator_id:'model-A',type:'all',category:'8',cursor:'older'}]]);
 assert.equal(result.status,'resolved');assert.deepEqual(result.items.map(item=>item.id),['42',43]);assert.deepEqual(result.items.map(item=>item.token),['fake-capability-42','fake-capability-43']);
});

test('resolver stops once all assets are verified and never calls prepare, upload or send',async()=>{
 const calls=[];const result=await resolveChatDirectMedia({content:content(),request:async(op)=>{calls.push(op);return page([row('43'),row('42')],true,'not-needed')}});
 assert.equal(result.status,'resolved');assert.deepEqual(calls,['vault_media']);
});

test('missing content is explicitly unavailable after EOF or four real pages, even when asked for a larger limit',async()=>{
 let calls=0;const missing=await resolveChatDirectMedia({content:content(),request:async()=>{calls++;return page([row('42')])}});assert.equal(calls,1);assert.equal(missing.status,'unavailable');assert.match(missing.message,/páginas consultadas/);
 calls=0;const bounded=await resolveChatDirectMedia({content:content(),maxPages:99,request:async()=>{calls++;return page([row(String(100+calls))],true,'page-'+calls)}});assert.equal(calls,4);assert.equal(bounded.status,'unavailable');
});

test('resolver rejects malformed content before any read and accepts an unknown price for asset inspection only',async()=>{
 let calls=0;const request=async()=>{calls++;return page([row('42'),row('43')])};
 for(const patch of [{mediaIds:['042']},{mediaIds:[42]},{mediaIds:['0']},{mediaIds:['42','42']},{categoryId:'bad'},{categoryId:'1'.repeat(21)},{currency:'EUR'},{priceCents:undefined},{reference:{id:'ref',version:0,verified:true}}])assert.equal((await resolveChatDirectMedia({content:content(patch),request})).status,'unavailable');
 assert.equal(calls,0);assert.equal((await resolveChatDirectMedia({content:content({priceCents:null}),request})).status,'resolved');assert.equal(calls,1);
});

test('category zero and leading zeros preserve the existing backend folder query contract',async()=>{
 for(const categoryId of ['0','008']){
  const calls=[];const result=await resolveChatDirectMedia({content:content({categoryId}),request:async(op,args)=>{calls.push(args);return page([row('42'),row('43')])}});
  assert.equal(result.status,'resolved');assert.equal(calls[0].category,categoryId);
 }
});

test('unready, inaccessible, errored, unsupported or tokenless targets cannot become attachments',async()=>{
 for(const patch of [{isReady:false},{isReady:1},{canView:false},{hasError:true},{type:'file'},{attachment:null},{attachment:' '},{attachment:'x'.repeat(60001)}])assert.equal((await resolveChatDirectMedia({content:content({mediaIds:['42']}),request:async()=>page([row('42',patch)])})).status,'unavailable');
});

test('malformed pages and invalid or cross-page duplicate IDs fail without selecting an ambiguous asset',async()=>{
 for(const result of [{},page(null),{data:{media:[],hasMore:'true'}},page([row('bad')]),page([row('42'),row(42)])])assert.equal((await resolveChatDirectMedia({content:content(),request:async()=>result})).status,'unavailable');
 let calls=0;const result=await resolveChatDirectMedia({content:content(),request:async()=>++calls===1?page([row('42')],true,'next'):page([row('42',{attachment:'changed'}),row('43')])});assert.equal(result.status,'unavailable');assert.equal(calls,2);
});

test('cursor loops and missing or overlong continuation cursors stop rather than rescanning',async()=>{
 for(const cursor of [null,'','x'.repeat(2049)]){let calls=0;const result=await resolveChatDirectMedia({content:content(),request:async()=>{calls++;return page([],true,cursor)}});assert.equal(result.status,'unavailable');assert.equal(calls,1)}
 let calls=0;const result=await resolveChatDirectMedia({content:content(),request:async()=>{calls++;return page([row(String(100+calls))],true,'same')}});assert.equal(result.status,'unavailable');assert.equal(calls,2);
});

test('scope revocation or teardown before/after await returns stale without publishing items or requesting another page',async()=>{
 let active=false,calls=0;assert.equal((await resolveChatDirectMedia({content:content(),active:()=>active,request:async()=>{calls++}})).status,'stale');assert.equal(calls,0);
 const waiting=deferred();active=true;const job=resolveChatDirectMedia({content:content(),active:()=>active,request:()=>{calls++;return waiting.promise}});active=false;waiting.resolve(page([row('42'),row('43')]));assert.deepEqual(await job,{status:'stale'});assert.equal(calls,1);
});

test('request denials and rate limits propagate unchanged; failures after teardown become stale',async()=>{
 for(const status of [403,429]){const failure=Object.assign(Error('fixture'),{status,retryAfter:60});await assert.rejects(resolveChatDirectMedia({content:content(),request:async()=>{throw failure}}),error=>error===failure)}
 const waiting=deferred();let active=true;const job=resolveChatDirectMedia({content:content(),active:()=>active,request:()=>waiting.promise});active=false;waiting.reject(Error('Aborted fixture'));assert.deepEqual(await job,{status:'stale'});
});

test('resolver snapshots references before awaiting and a changed draft after resolution cannot be overwritten',async()=>{
 const bundle=content(),waiting=deferred(),calls=[];const job=resolveChatDirectMedia({content:bundle,request:async(op,args)=>{calls.push(args);return calls.length===1?waiting.promise:page([row('43')])}});
 bundle.accountId='model-B';bundle.mediaIds[1]='999';waiting.resolve(page([row('42')],true,'next'));const result=await job;assert.equal(result.status,'resolved');assert.ok(calls.every(args=>args.creator_id==='model-A'));assert.deepEqual(result.items.map(item=>item.id),['42','43']);
 const before=draft(),checked=insert({draft:before,mode:'check'});assert.equal(insert({draft:{...before,price:'20'},mode:'replace-bundle',expectedSnapshot:checked.draftSnapshot,content:content(),attachments:result.items}).status,'conflict');
});
