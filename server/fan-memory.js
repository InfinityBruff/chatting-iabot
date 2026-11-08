// Provider-independent memory boundary. No network, persistence or sending here.
const categories = new Set(['preferred_name','language','interests','availability','pending_question','commitment','personal_context']);
const scopeFields = ['workspaceId','creatorId','fanId'];
export function sameMemoryScope(a,b) {
  return scopeFields.every(k=>typeof a?.[k]==='string'&&a[k].length>0&&a[k]===b?.[k]);
}
function requireScope(scope, value) {
  if (!sameMemoryScope(scope,value)) throw Error('Memoria fuera de la agencia, modelo o fan autorizado.');
}
function memoryScope(scope) {
  return Object.fromEntries(scopeFields.map(key=>[key,scope[key]]));
}
function requireMemoryState(scope,state) {
  requireScope(scope,state);
  for(const item of state.items)requireScope(scope,item);
}
export function emptyFanMemory(scope) {
  requireScope(scope,scope);
  return {...memoryScope(scope),version:0,items:[],suppressedKeys:[],coverage:'not_analyzed'};
}
// Evidence must be supplied by an authorized server-side transcript reader,
// never by the model response. Exact quotes provide provenance, not truth.
export function reviewMemoryCandidates(scope,candidates,messages) {
  requireScope(scope,scope);
  if(!Array.isArray(candidates)||candidates.length>100||!Array.isArray(messages)) throw Error('Lote de memoria inválido.');
  const evidence=new Map();
  for(const m of messages){requireScope(scope,m);if(typeof m.id!=='string'||evidence.has(m.id))throw Error('Identificador de mensaje inválido o repetido.');evidence.set(m.id,m)}
  const keys=new Set();
  return candidates.map(c=>{
    if(!categories.has(c.category)||typeof c.key!=='string'||!/^[a-z0-9_-]{1,80}$/.test(c.key)||keys.has(c.key))throw Error('Categoría o clave de memoria inválida.');
    keys.add(c.key);
    const m=evidence.get(c.messageId);
    if(!m||!['fan','model'].includes(m.author)||typeof m.text!=='string'||typeof c.quote!=='string'||c.quote.trim().length<3||c.quote.length>1000||!m.text.includes(c.quote)||!Number.isFinite(Date.parse(m.at)))throw Error('Recuerdo sin evidencia verificable.');
    if(typeof c.value!=='string'||!c.value.trim()||c.value.length>1000)throw Error('Valor de memoria inválido.');
    // Keep the authorized scope on each item across queues/serialization. Model
    // output must never select the agency, creator or fan for a memory record.
    return {...memoryScope(scope),key:c.key,category:c.category,value:c.value.trim(),status:'pending',origin:'analysis',pinned:false,source:{messageId:m.id,quote:c.quote,at:m.at,author:m.author}};
  });
}
export function mergeMemoryCandidates(scope,state,items,expectedVersion) {
  requireMemoryState(scope,state);
  if(state.version!==expectedVersion)throw Error('La memoria cambió en otra sesión.');
  const next=structuredClone(state);
  for(const item of items){
    requireScope(scope,item);
    if(item.status!=='pending'||item.origin!=='analysis')throw Error('La IA no puede confirmar recuerdos.');
    if(next.suppressedKeys.includes(item.key))continue;
    const index=next.items.findIndex(i=>i.key===item.key),old=next.items[index];
    if(old&&(old.pinned||old.origin==='manual'||old.status==='confirmed'))continue;
    if(index<0)next.items.push(structuredClone(item));else next.items[index]=structuredClone(item);
  }
  next.version++;return next;
}
export function editMemoryItem(scope,state,key,action,expectedVersion,value) {
  requireMemoryState(scope,state);
  if(state.version!==expectedVersion)throw Error('La memoria cambió en otra sesión.');
  const next=structuredClone(state),item=next.items.find(i=>i.key===key);
  if(!item)throw Error('Recuerdo inexistente.');
  if(action==='delete'){next.items=next.items.filter(i=>i.key!==key);next.suppressedKeys=[...new Set([...next.suppressedKeys,key])];}
  else if(action==='pin')item.pinned=true;
  else if(action==='confirm')item.status='confirmed';
  else if(action==='correct'){
    if(typeof value!=='string'||!value.trim()||value.length>1000)throw Error('Corrección inválida.');
    item.value=value.trim();item.origin='manual';item.status='confirmed';
  }else throw Error('Acción de memoria inválida.');
  next.version++;return next;
}
