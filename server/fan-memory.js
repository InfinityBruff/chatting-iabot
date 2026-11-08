// Provider-independent memory boundary. No network, persistence or sending here.
import {isNeutralMemoryFragment,isAllowedContextualReply} from '../supabase/functions/bruff-memory/cited-candidates.js';
const categories = new Set(['preferred_name','language','interests','availability','pending_question','commitment','personal_context']);
const scopeFields = ['workspaceId','creatorId','fanId'];
const questionCategories={where_from:'personal_context',where_based:'personal_context',preferred_name:'preferred_name',language:'language',interests:'interests'};
const memoryQuestions=[
 ['where_from',/^(?:where (?:are|r) (?:you|u) from|where (?:you|u) from|where do (?:you|u) come from|de donde (?:eres|sos|vienes))$/u],
 ['where_based',/^(?:where (?:are|r) (?:you|u) (?:based|living)|where do (?:you|u) live|donde (?:vives|resides)|en que (?:pais|ciudad|estado) vives)$/u],
 ['preferred_name',/^(?:what(?:'s| is) your (?:name|preferred name)|what (?:name )?should i call (?:you|u)|how should i call (?:you|u)|como te llamas|como te puedo llamar|que nombre prefieres)$/u],
 ['language',/^(?:(?:what|which) language do (?:you|u) (?:prefer|speak)|que idioma (?:prefieres|hablas))$/u],
 ['interests',/^(?:what do (?:you|u) (?:like to do|enjoy doing)|what are your (?:hobbies|interests)|what do (?:you|u) do for fun|que te gusta hacer|cuales son tus (?:aficiones|pasatiempos)|que aficiones tienes)$/u],
];
export function memoryQuestionKind(quote){
 if(!isNeutralMemoryFragment(quote))return null;
 const normalized=quote.normalize('NFD').replace(/[\u0300-\u036f]/gu,'').toLowerCase().replace(/’/gu,"'").replace(/\s+/gu,' ').replace(/^¿/u,'').replace(/\?{1,3}$/u,'');
 return memoryQuestions.find(([,pattern])=>pattern.test(normalized))?.[0]??null;
}
const messageId=value=>typeof value==='string'&&/^[1-9][0-9]{0,23}$/u.test(value);
const questionTime=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,19)===value.slice(0,19);
// This validates the bounded evidence envelope. Matching the question/reply to
// actual authorized messages remains the transcript reader's responsibility.
export function validateMemoryQuestion(source,category){
 if(!source||!Object.hasOwn(source,'question'))return null;
 const question=source.question,keys=['messageId','quote','at','author','kind'];
 // Literal fragments, including two-character replies, use the same positive
 // answer vocabulary as the contextual matcher; free prose is never accepted.
 const neutralReply=question&&isAllowedContextualReply(question.kind,source.quote);
 if(!question||typeof question!=='object'||Array.isArray(question)||Object.keys(question).length!==keys.length||!keys.every(key=>Object.hasOwn(question,key))||source.author!=='fan'||question.author!=='model'||!messageId(source.messageId)||!messageId(question.messageId)||question.messageId===source.messageId||!Object.hasOwn(questionCategories,question.kind)||questionCategories[question.kind]!==category||memoryQuestionKind(question.quote)!==question.kind||!questionTime(question.at)||!questionTime(source.at)||Date.parse(question.at)>=Date.parse(source.at)||!neutralReply)throw Error('Pregunta contextual de memoria inválida.');
 return {messageId:question.messageId,quote:question.quote,at:question.at,author:'model',kind:question.kind};
}
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
  for(const item of state.items){requireScope(scope,item);const question=validateMemoryQuestion(item.source,item.category);if(question&&item.origin==='analysis'&&item.value!==item.source.quote)throw Error('La respuesta contextual debe conservar su cita literal.');}
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
    if(!m||!['fan','model'].includes(m.author)||typeof m.text!=='string'||typeof c.quote!=='string'||c.quote.trim().length<(Object.hasOwn(c,'question')?2:3)||c.quote.length>1000||!m.text.includes(c.quote)||!Number.isFinite(Date.parse(m.at)))throw Error('Recuerdo sin evidencia verificable.');
    if(typeof c.value!=='string'||!c.value.trim()||c.value.length>1000)throw Error('Valor de memoria inválido.');
    // Keep the authorized scope on each item across queues/serialization. Model
    // output must never select the agency, creator or fan for a memory record.
    const source={messageId:m.id,quote:c.quote,at:m.at,author:m.author,...(Object.hasOwn(c,'question')?{question:c.question}:{})},question=validateMemoryQuestion(source,c.category);
    if(question){const asked=evidence.get(question.messageId);if(c.value!==c.quote||!asked||asked.author!=='model'||typeof asked.text!=='string'||!asked.text.includes(question.quote)||Date.parse(asked.at)!==Date.parse(question.at))throw Error('Pregunta sin evidencia verificable.');source.question=question;}
    return {...memoryScope(scope),key:c.key,category:c.category,value:c.value.trim(),status:'pending',origin:'analysis',pinned:false,source};
  });
}
export function mergeMemoryCandidates(scope,state,items,expectedVersion) {
  requireMemoryState(scope,state);
  if(state.version!==expectedVersion)throw Error('La memoria cambió en otra sesión.');
  const next=structuredClone(state);
  for(const item of items){
    requireScope(scope,item);
    const question=validateMemoryQuestion(item.source,item.category);if(question&&item.value!==item.source.quote)throw Error('La respuesta contextual debe conservar su cita literal.');
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
