import {emptyFanMemory,reviewMemoryCandidates,mergeMemoryCandidates,editMemoryItem,validateMemoryQuestion} from '../../../server/fan-memory.js';
import {prepareCitedCandidates,extractCitedCandidateInputs,isNeutralMemoryQuote,normalizeFanMemoryTimestamp} from './cited-candidates.js';
import {extractContextualFanCandidates,validateContextualBoundaryShape,validateContextualBoundary} from './contextual-candidates.js';
import {prepareManualCitedCandidates} from './manual-candidates.js';
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(x);
const id=x=>typeof x==='string'&&/^[1-9]\d{0,23}$/u.test(x);
const natural=x=>Number.isSafeInteger(x)&&x>=0;
const iso=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString().slice(0,19)===x.slice(0,19);
const safe=x=>typeof x==='string'&&x.trim().length>0&&x.length<=1000&&!/[\u0000-\u001f\u007f]/u.test(x)&&!/(?:https?:\/\/|\bBearer\b|\b(?:fuck|pussy|cock|dick|sexting|nudes?|desnuda|follar|polla|coño)\b)/iu.test(x);
const failure=(code='MEMORY_CONTEXT',status=503)=>Object.assign(Error(status===409?'La memoria cambió en otra sesión. Actualiza antes de continuar.':status===400?'Revisa la edición de memoria.':'No se pudo comprobar la memoria contextual.'),{code,status});
const scopeKeys=['ownerId','workspaceId','creatorId','binding','fanId'];
export const FAN_MEMORY_EXTRACTOR_VERSION=3;
const freshScan=()=>({extractorVersion:FAN_MEMORY_EXTRACTOR_VERSION,cursor:null,historyComplete:false,pages:0,recentCheckedAt:null,historyCheckedAt:null,seenCursors:[],seenMessages:[],contextLimited:false,contextBoundary:null});
const validExtractorVersion=scan=>scan.extractorVersion===undefined||Number.isSafeInteger(scan.extractorVersion)&&scan.extractorVersion>=1&&scan.extractorVersion<=FAN_MEMORY_EXTRACTOR_VERSION;
export function validateFanMemoryScope(scope){if(!object(scope)||!['ownerId','workspaceId','creatorId'].every(k=>uuid(scope[k]))||!id(scope.fanId)||typeof scope.binding!=='string'||!/^acct_[A-Za-z0-9_-]{1,123}$/u.test(scope.binding))throw failure();return Object.fromEntries(scopeKeys.map(k=>[k,scope[k]]))}
export function emptyFanContext(scope){validateFanMemoryScope(scope);return {memory:emptyFanMemory(scope),scan:freshScan()}}
export function validateFanContext(scope,record){
 validateFanMemoryScope(scope);const memory=record?.memory,scan=record?.scan;
 if(!object(memory)||!natural(memory.version)||!Array.isArray(memory.items)||memory.items.length>100||!Array.isArray(memory.suppressedKeys)||memory.suppressedKeys.length>1000||memory.suppressedKeys.some(k=>typeof k!=='string'||!/^[a-z0-9_-]{1,80}$/u.test(k))||new Set(memory.suppressedKeys).size!==memory.suppressedKeys.length||!object(scan)||!validExtractorVersion(scan)||!natural(scan.pages)||scan.pages>1000||typeof scan.historyComplete!=='boolean'||typeof scan.contextLimited!=='boolean'||!(scan.cursor===null||typeof scan.cursor==='string'&&scan.cursor.length>0&&scan.cursor.length<=2048)||![scan.recentCheckedAt,scan.historyCheckedAt].every(x=>x===null||iso(x))||!Array.isArray(scan.seenMessages)||scan.seenMessages.length>20000||scan.seenMessages.some(x=>!id(x))||new Set(scan.seenMessages).size!==scan.seenMessages.length||!Array.isArray(scan.seenCursors)||scan.seenCursors.length>1000||scan.seenCursors.some(x=>typeof x!=='string'||!/^[a-f0-9]{64}$/u.test(x))||new Set(scan.seenCursors).size!==scan.seenCursors.length||scan.historyComplete&&(scan.cursor!==null||scan.historyCheckedAt===null||scan.contextLimited))throw failure();
 validateContextualBoundaryShape(scan.contextBoundary??null);if(scan.contextBoundary!=null&&scan.extractorVersion!==FAN_MEMORY_EXTRACTOR_VERSION)throw failure();
 const keys=new Set();
 for(const item of memory.items){
  if(!object(item)||keys.has(item.key)||!['pending','confirmed'].includes(item.status)||!['analysis','manual'].includes(item.origin)||typeof item.pinned!=='boolean'||!safe(item.value)||!object(item.source)||!id(item.source.messageId)||!safe(item.source.quote)||!iso(item.source.at)||!['fan','model'].includes(item.source.author))throw failure();
  const question=validateMemoryQuestion(item.source,item.category),evidence=[{...scope,id:item.source.messageId,author:item.source.author,text:item.source.quote,at:item.source.at}];if(question)evidence.push({...scope,id:question.messageId,author:'model',text:question.quote,at:question.at});
  // Manual corrections retain their cited answer; replay verifies provenance,
  // while the independently checked stored value remains the owner's edit.
  keys.add(item.key);reviewMemoryCandidates(scope,[{key:item.key,category:item.category,value:question&&item.origin==='manual'?item.source.quote:item.value,messageId:item.source.messageId,quote:item.source.quote,...(question?{question}:{})}],evidence);
 }
 // Also checks scope on each stored item, including empty-state operations.
 mergeMemoryCandidates(scope,memory,[],memory.version);
 return structuredClone(record);
}
// Both the handler's provider cursor and the pure merge must use this plan.
// Legacy coverage proves only the old pass; reset it only after a valid read.
export function fanMemoryScanPlan(record,requested='recent'){
 if(!['recent','older'].includes(requested))throw failure('MEMORY_SCAN',400);
 const state=record?.scan;if(!object(state)||!validExtractorVersion(state)||!natural(state.pages)||typeof state.historyComplete!=='boolean'||typeof state.contextLimited!=='boolean'||!(state.cursor===null||typeof state.cursor==='string'&&state.cursor.length>0&&state.cursor.length<=2048))throw failure();
 const restarting=state.extractorVersion!==FAN_MEMORY_EXTRACTOR_VERSION,older=requested==='older'&&!restarting&&state.pages>0;
 return {scan:older?'older':'recent',cursor:older?state.cursor:null,skip:older&&(state.historyComplete||state.contextLimited),restarting};
}
async function digest(value){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))].map(x=>x.toString(16).padStart(2,'0')).join('')}
export async function createFanContext(scope,record,{actorId=scope.actorId}={}){
 const identity=validateFanMemoryScope(scope);if(!uuid(actorId))throw failure();const {memory,scan}=validateFanContext(scope,record);await validateContextualBoundary(scope,scan.contextBoundary??null);
 const items=memory.items.map(({key,category,value,status,origin,pinned,source})=>({key,category,value,status,origin,pinned,source})).sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0);
 // Old-pass EOF must not disable the UI's new-pass history action. This view
 // never rewrites stored counters, citations, revisions or exclusions.
 const view=scan.extractorVersion===FAN_MEMORY_EXTRACTOR_VERSION?scan:freshScan();
 const contextRevision=await digest([identity,items.filter(item=>item.status==='confirmed'||item.status==='pending'&&item.key.startsWith(item.category+'_conflict_')),view.historyComplete,view.contextLimited]);
 return {actorId,workspaceId:scope.workspaceId,creatorId:scope.creatorId,fanId:scope.fanId,binding:scope.binding,version:memory.version,contextRevision,items,coverage:{historyComplete:view.historyComplete,cursor:view.cursor,pages:view.pages,recentCheckedAt:view.recentCheckedAt,historyCheckedAt:view.historyCheckedAt,messagesObserved:view.seenMessages.length,contextLimited:view.contextLimited}};
}
// Authorization is owned by the caller: service workers must derive this scope
// from their leased job and check delegation before/after this bounded read.
export async function fanMemoryContext(store,scope,{actorId=scope.actorId,signal}={}){const record=await store.read(scope,signal);if(signal?.aborted)throw signal.reason;return createFanContext(scope,record,{actorId})}

function transcript(scope,messages){
 if(!Array.isArray(messages)||messages.length>200)throw failure();const seen=new Map();
 for(const message of messages){const key=typeof message?.id==='number'&&Number.isSafeInteger(message.id)?String(message.id):message?.id,at=normalizeFanMemoryTimestamp(message?.createdAt);if(!object(message)||!id(key)||typeof message.isFromMe!=='boolean'||!at||message.text!=null&&typeof message.text!=='string')throw failure();for(const [field,expected]of [['workspaceId',scope.workspaceId],['creatorId',scope.creatorId],['modelId',scope.creatorId],['fanId',scope.fanId],['binding',scope.binding]])if(Object.hasOwn(message,field)&&message[field]!==expected)throw failure();if(message.delivery||message.pending)continue;const row={workspaceId:scope.workspaceId,creatorId:scope.creatorId,fanId:scope.fanId,id:key,author:message.isFromMe?'model':'fan',text:message.text||'',at};const old=seen.get(key);if(old&&JSON.stringify(old)!==JSON.stringify(row))throw failure();seen.set(key,row)}
 return [...seen.values()];
}
export function extractNeutralFanCandidates(scope,messages){
 validateFanMemoryScope(scope);const rows=transcript(scope,messages),candidates=new Map();
 for(const row of rows){
  const quote=row.text.trim();if(row.author!=='fan'||!safe(quote)||quote.length>240)continue;let match,key,category,value;
  if((match=/^(?:please )?(?:call me|you can call me|me puedes llamar|llámame) ([\p{L}][\p{L} '-]{0,59})[.!]?$/iu.exec(quote))){key='preferred_name';category='preferred_name';value=match[1].replace(/[.!]$/u,'').trim()}
  else if((match=/^(?:i (?:prefer|speak)|prefiero(?: hablar)?|hablo) (english|spanish|español|inglés|french|francés|portuguese|portugués)[.!]?$/iu.exec(quote))){key='language';category='language';value=match[1]}
  else if((match=/^(?:i (?:like|enjoy)|me gusta(?:n)?) (reading|music|football|basketball|cooking|hiking|photography|leer|la música|el fútbol|el baloncesto|cocinar|el senderismo|la fotografía)[.!]?$/iu.exec(quote))){key='interest_'+match[1].toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/gu,'').replace(/[^a-z0-9]+/gu,'_');category='interests';value=match[1]}
  else continue;
  const next={key,category,value,messageId:row.id,quote},old=candidates.get(key);if(!old||Date.parse(row.at)>=Date.parse(rows.find(x=>x.id===old.messageId).at))candidates.set(key,next);
 }
 return reviewMemoryCandidates(scope,[...candidates.values()].filter(item=>isNeutralMemoryQuote(item.quote,item.category)).slice(0,100),rows);
}
export async function syncFanContext(scope,record,data,{scan='recent',now=Date.now()}={}){
 const current=validateFanContext(scope,record);if(!['recent','older'].includes(scan)||!object(data)||typeof data.hasMore!=='boolean'||!(data.cursor===null||typeof data.cursor==='string'&&data.cursor.length>0&&data.cursor.length<=2048)||data.hasMore&&!data.cursor)throw failure();
 for(const [field,expected]of [['workspaceId',scope.workspaceId],['creatorId',scope.creatorId],['modelId',scope.creatorId],['fanId',scope.fanId],['binding',scope.binding]])if(Object.hasOwn(data,field)&&data[field]!==expected)throw failure();
 await validateContextualBoundary(scope,current.scan.contextBoundary??null);
 const plan=fanMemoryScanPlan(current,scan),rows=transcript(scope,data.messages),older=plan.scan==='older';
 if(plan.restarting)current.scan=freshScan();
 if(older&&(current.scan.historyComplete||current.scan.contextLimited))return current;
 const seen=new Set(current.scan.seenMessages),cursorHash=data.hasMore?await digest(data.cursor):null;
 if(older&&(!current.scan.cursor||data.cursor===current.scan.cursor||cursorHash&&current.scan.seenCursors.includes(cursorHash)))throw failure('MEMORY_CURSOR',409);
 let limited=current.scan.contextLimited;for(const row of rows)if(!seen.has(row.id)){if(seen.size>=20000){limited=true;break}seen.add(row.id)}
 const oldItems=new Map(current.memory.items.map(item=>[item.key,item]));
 const pair=item=>JSON.stringify([item.category,item.source.messageId]),existingPairs=new Set(current.memory.items.map(pair));
 const candidates=extractNeutralFanCandidates(scope,data.messages).filter(item=>!existingPairs.has(pair(item))||current.memory.items.some(old=>pair(old)===pair(item)&&old.key===item.key)).filter(item=>!oldItems.has(item.key)||Date.parse(item.source.at)>=Date.parse(oldItems.get(item.key).source.at)).map(item=>{
  const old=oldItems.get(item.key);
  // Never silently replace reviewed or pinned data. A later contradictory
  // declaration is separately cited and pending until the owner resolves it.
  if(old&&(old.status==='confirmed'||old.origin==='manual'||old.pinned)&&item.value!==old.value&&Date.parse(item.source.at)>Date.parse(old.source.at))return {...item,key:item.category+'_conflict_'+item.source.messageId};
  return item;
 }).filter(item=>!current.memory.suppressedKeys.includes('cited_source_'+item.category+'_'+item.source.messageId));
 const claimed=new Set([...existingPairs,...candidates.map(item=>JSON.stringify([item.category,item.source.messageId]))]);
 const proof=rows.map(row=>({id:row.id,text:row.text,isFromMe:row.author==='model',createdAt:row.at,workspaceId:scope.workspaceId,creatorId:scope.creatorId,fanId:scope.fanId}));
 const cited=extractCitedCandidateInputs(proof).filter(item=>!claimed.has(JSON.stringify([item.category,item.message_id])));
 for(let offset=0;offset<cited.length;offset+=20){
  for(const item of await prepareCitedCandidates(scope,cited.slice(offset,offset+20),proof)){
   if(citedSuppressed(current.memory,item))continue;
   candidates.push(item);claimed.add(JSON.stringify([item.category,item.source.messageId]));
  }
 }
 const contextual=await extractContextualFanCandidates(scope,proof,{boundary:older?current.scan.contextBoundary??null:null});
 for(const item of contextual.items){if(claimed.has(pair(item))||citedSuppressed(current.memory,item))continue;candidates.push(item);claimed.add(pair(item));}
 const memory=mergeMemoryCandidates(scope,current.memory,candidates,current.memory.version),at=new Date(now).toISOString(),initial=current.scan.pages===0;
 if(memory.items.length>100)throw failure('MEMORY_CONTEXT_LIMIT',409);
 const next={...current.scan,seenMessages:[...seen],contextLimited:limited};
 if(older||initial)next.contextBoundary=data.hasMore?contextual.boundary:null;
 if(older||initial){next.pages=older?next.pages+1:1;next.cursor=data.hasMore?data.cursor:null;next.historyComplete=!data.hasMore;next.historyCheckedAt=at;if(cursorHash)next.seenCursors=[...next.seenCursors,cursorHash]}
 if(!older)next.recentCheckedAt=at;
 if(next.pages>=1000||limited){next.contextLimited=true;next.historyComplete=false}
 memory.coverage=next.historyComplete?'complete':'partial';return validateFanContext(scope,{memory,scan:next});
}
export function editFanContext(scope,record,edit){
 const current=validateFanContext(scope,record);if(!object(edit)||Object.keys(edit).some(k=>!['key','action','value','expected_version'].includes(k))||typeof edit.key!=='string'||!/^[a-z0-9_-]{1,80}$/u.test(edit.key)||!['confirm','correct','pin','delete'].includes(edit.action)||!natural(edit.expected_version)||edit.action==='correct'&&!safe(edit.value)||edit.action!=='correct'&&edit.value!==undefined)throw failure('MEMORY_EDIT',400);
 if(edit.expected_version!==current.memory.version)throw failure('MEMORY_CONFLICT',409);if(!current.memory.items.some(item=>item.key===edit.key))throw failure('MEMORY_EDIT',400);
 const memory=editMemoryItem(scope,current.memory,edit.key,edit.action,edit.expected_version,edit.value);
 if(edit.action==='delete'){
  const item=current.memory.items.find(item=>item.key===edit.key),marker='cited_source_'+item.category+'_'+item.source.messageId;
  memory.suppressedKeys=[...new Set([...memory.suppressedKeys,marker])];
  if(memory.suppressedKeys.length>1000)throw failure('MEMORY_CONTEXT_LIMIT',409);
 }
 return validateFanContext(scope,{memory,scan:current.scan});
}

function citedSuppressed(memory,item){
 const suppressed=memory.suppressedKeys;
 return suppressed.includes(item.key)||suppressed.includes('cited_source_'+item.category+'_'+item.source.messageId)||suppressed.includes(item.category)||item.category==='interests'&&suppressed.some(key=>key.startsWith('interest_'));
}

// Importing reviewed excerpts is separate from walking history. Evidence and
// values stay literal and pending; neither scan cursors nor coverage advance.
export async function importCitedFanCandidates(scope,record,candidates,messages,expectedVersion){
 const current=validateFanContext(scope,record);
 if(!natural(expectedVersion)||expectedVersion>=Number.MAX_SAFE_INTEGER)throw failure('MEMORY_CANDIDATES',400);
 if(current.memory.version!==expectedVersion)throw failure('MEMORY_CONFLICT',409);
 const prepared=await prepareManualCitedCandidates(scope,candidates,messages),existing=new Set(current.memory.items.map(item=>JSON.stringify([item.category,item.source.messageId,item.source.quote]))),keys=new Set(current.memory.items.map(item=>item.key)),fresh=[];
 let reused=0;
 for(const item of prepared){
  const semantic=JSON.stringify([item.category,item.source.messageId,item.source.quote]);
  // Preserve legacy category exclusions and stable category/message tombstones.
  if(existing.has(semantic)||keys.has(item.key)||citedSuppressed(current.memory,item)){reused++;continue;}
  existing.add(semantic);keys.add(item.key);fresh.push(item);
 }
 if(!fresh.length)return {record:current,importResult:{added:0,reused}};
 if(current.memory.items.length+fresh.length>100)throw failure('MEMORY_CONTEXT_LIMIT',409);
 const memory=mergeMemoryCandidates(scope,current.memory,fresh,expectedVersion);
 return {record:validateFanContext(scope,{memory,scan:current.scan}),importResult:{added:fresh.length,reused}};
}
