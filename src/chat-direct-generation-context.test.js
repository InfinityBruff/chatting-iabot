import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {transformWithOxc} from 'vite';
import {scopeKey,validateChatDirectSuggestions,materializeChatDirectSuggestion} from './chat-direct.js';
import {safeGenerationDiagnostic,generationDiagnosticError} from './chat-direct-diagnostics.js';

// Execute the actual provider with deterministic hook scheduling. No DOM,
// portal, source facade, RPC or network is substituted into its state logic.
const original=await readFile(new URL('./components/ChatDirectContext.jsx',import.meta.url),'utf8');
const transformed=await transformWithOxc(original,'ChatDirectContext.jsx',{lang:'jsx',jsx:{runtime:'classic'}});
const code=transformed.code.replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
const actor='11111111-1111-4111-8111-111111111111',workspace='22222222-2222-4222-8222-222222222222',account='33333333-3333-4333-8333-333333333333',generation='44444444-4444-4444-8444-444444444444',example='55555555-5555-4555-8555-555555555555';
const day=new Date().toISOString().slice(0,10);
const quota={usageDay:day,resetsAt:new Date(Date.parse(day+'T00:00:00Z')+86400000).toISOString(),modelQueries:1,modelDailyLimit:100,sharedBudgetNeurons:7500,calculatedNeurons:37,reservedNeurons:0,chargedNeurons:37,remainingNeurons:7463,observedRequests:1,reservedRequests:0};
const context=patch=>{const value={actor,workspace,account,fanId:'99',revision:'context-v1',canRead:true,canInsert:true,canVault:false,messages:[],...patch};return {...value,scope:scopeKey(value)}};
function payload(request){return {scope:request.scope,revision:request.revision,quota,knowledge:{engine:'generative',status:'connected',approvedCount:1,engineInvoked:true,reused:false,generationId:generation,expiresAt:new Date(Date.now()+600000).toISOString()},candidates:[{id:'gen.'+generation+'.1',english:'How is your morning?',spanish:'¿Cómo va tu mañana?',variables:[],aiGenerated:true,aiVerified:false,generationId:generation,expiresAt:new Date(Date.now()+600000).toISOString(),exampleIds:[example],knowledgeIds:[],source:{kind:'generated',modelId:request.context.account,verified:false,label:'Borrador IA · Revisión humana',version:'a'.repeat(32)}}]}}
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve()};
function harness(source){
 const slots=[],pending=[];let cursor=0,epoch=0,current;
 const same=(a,b)=>a&&b&&a.length===b.length&&a.every((x,i)=>Object.is(x,b[i]));
 const state=initial=>{const i=cursor++;if(!slots[i])slots[i]={value:typeof initial==='function'?initial():initial};return [slots[i].value,value=>{slots[i].value=typeof value==='function'?value(slots[i].value):value}]};
 const ref=value=>{const i=cursor++;return (slots[i]??={current:value})};
 const memo=(fn,deps)=>{const i=cursor++;if(!slots[i]||!same(slots[i].deps,deps))slots[i]={deps,value:fn()};return slots[i].value};
 const effect=(fn,deps)=>{const i=cursor++,old=slots[i];if(!old||!same(old.deps,deps)){const item={deps,cleanup:old?.cleanup};slots[i]=item;pending.push(()=>{item.cleanup?.();item.cleanup=fn()})}};
 const React={createElement:(type,props,...children)=>({type,props:{...props,children}})};
 const Component=new Function('React','createContext','lazy','Suspense','useCallback','useContext','useEffect','useMemo','useRef','useState','scopeKey','validateSuggestions','materializeSuggestion','pageCacheEpoch','safeGenerationDiagnostic',code+'\nreturn ScopedProvider;')(React,()=>({Provider:'Provider'}),()=> 'Panel','Suspense',(fn,deps)=>memo(()=>fn,deps),()=>null,effect,memo,ref,state,scopeKey,validateChatDirectSuggestions,materializeChatDirectSuggestion,()=>epoch,safeGenerationDiagnostic);
 const find=node=>node?.type==='Panel'?node:node?.props?.children?.flat(Infinity).map(find).find(Boolean);
 const view=()=>{cursor=0;const tree=Component({actor,workspace,source,canManage:true,children:null});current={public:tree.props.value,panel:find(tree)?.props};while(pending.length)pending.shift()();return current};
 return {view,get current(){return current},setEpoch:()=>epoch++,unmount:()=>slots.forEach(x=>x?.cleanup?.())};
}
async function open(source,ctx=context()){
 const h=harness(source);h.view().public.setContext(ctx);h.view().public.openFrom();h.view();await flush();h.view();return h;
}

test('actual provider preserves visible cards while regenerating, clears old selection and refreshes quota once after failure',async()=>{
 const calls=[];let reject,reads=0;
 const source=async request=>{calls.push(request);if(calls.length===2)return new Promise((resolve,no)=>{reject=no});return payload(request)};
 source.readQuota=async()=>{reads++;return quota};
 const h=await open(source);assert.equal(reads,1);await h.current.panel.onConsult({});let view=h.view();const id=view.panel.entry.candidates[0].id;
 view.panel.onSelect(id);view=h.view();assert.equal(view.panel.entry.selectedId,id);
 const job=view.panel.onConsult({force:true});view=h.view();assert.equal(view.panel.entry.candidates.length,1);assert.equal(view.panel.entry.busy,true);assert.equal(view.panel.entry.selectedId,null);assert.equal(view.panel.entry.insertToken,null);
 view.panel.onSelect(id);await view.panel.onConsult({force:true});assert.equal(h.view().panel.entry.selectedId,null);assert.equal(calls.length,2);
 reject(Error('Invalid generated output'));await job;await flush();view=h.view();assert.equal(view.panel.entry.candidates.length,0);assert.equal(view.panel.entry.busy,false);assert.equal(reads,2);assert.deepEqual(calls.map(x=>x.force),[false,true]);
 h.unmount();
});
test('actual provider reads quota once per model, clears on epoch and ignores a generation that finishes in another fan',async()=>{
 let release,reads=0,observed;
 const source=request=>{observed=request;return new Promise(resolve=>{release=()=>resolve(payload(request))})};source.readQuota=async()=>{reads++;return quota};
 const h=await open(source);const job=h.current.panel.onConsult({});h.view();h.current.public.setContext(context({fanId:'100'}));h.view();await flush();h.view();assert.equal(observed.signal.aborted,true);release();await job;assert.equal(h.view().panel.entry.candidates.length,0);assert.equal(reads,1);
 h.setEpoch();h.current.public.setContext(context({fanId:'100'}));h.view();await flush();assert.equal(h.view().panel.entry.candidates.length,0);assert.equal(reads,2);
 h.unmount();
});
test('manual quota denial removes candidates and counters instead of displaying a formerly authorized balance',async()=>{
 let denied=false,reads=0;const source=async request=>payload(request);source.readQuota=async()=>{reads++;if(denied)throw generationDiagnosticError('access');return quota};
 const h=await open(source);await h.current.panel.onConsult({});h.view();denied=true;await h.current.panel.onQuota();const entry=h.view().panel.entry;
 assert.equal(reads,2);assert.equal(entry.quota,null);assert.equal(entry.quotaAt,null);assert.equal(entry.candidates.length,0);assert.equal(entry.knowledge,null);assert.equal(entry.quotaBusy,false);h.unmount();
});
test('a quota cached for the previous UTC day is refreshed on demand without an interval or another inference',async()=>{
 let reads=0,generated=0;const source=async request=>{generated++;return payload(request)};
 source.readQuota=async()=>{reads++;return reads===1?{...quota,usageDay:new Date(Date.parse(day+'T00:00:00Z')-86400000).toISOString().slice(0,10),resetsAt:day+'T00:00:00Z'}:quota};
 const h=await open(source);h.current.public.setContext(context({fanId:'100'}));h.view();await flush();assert.equal(h.view().panel.entry.quota.usageDay,day);assert.equal(reads,2);assert.equal(generated,0);h.unmount();
});
