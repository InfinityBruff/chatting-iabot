import {validateCitedCandidates,prepareCitedCandidates,isAllowedContextualReply,normalizeFanMemoryTimestamp} from './cited-candidates.js';
import {memoryQuestionKind} from '../../../server/fan-memory.js';
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(value);
const id=value=>typeof value==='string'&&/^[1-9][0-9]{0,23}$/u.test(value);
const categories={where_from:'personal_context',where_based:'personal_context',preferred_name:'preferred_name',language:'language',interests:'interests'};
const failure=(status=400,code='MEMORY_CANDIDATES')=>Object.assign(Error(status===400?'No se pudieron contrastar las citas con una pregunta y respuesta reales adyacentes.':'No se pudo verificar la fuente seleccionada para memoria.'),{status,code});
async function digest(value){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))].map(part=>part.toString(16).padStart(2,'0')).join('');}
function explicitMinor(text){
 const value=text.normalize('NFD').replace(/[\u0300-\u036f]/gu,'').replace(/[’‘]/gu,"'").toLowerCase();
 if(/\b(?:(?:i am|i'm|im)\s+(?:(?:a|an)\s+)?(?:minor|underage|child|kid|teenager|seventeen|sixteen|fifteen|fourteen|thirteen|twelve|eleven)|soy\s+(?:(?:un|una)\s+)?(?:menor|nino|nina|adolescente)|tengo\s+(?:diecisiete|dieciseis|quince|catorce|trece|doce))\b/u.test(value))return true;
 const match=/\b(?:i am|i'm|im|tengo)\s+(\d{1,3})(?=\s*(?:years? old\b|years? of age\b|yo\b|y\/o\b|anos?\b|[,;.]|and\b|y\b|in\b|from\b|en\b|de\b|near\b|around\b|at\b|$))/u.exec(value);return !!match&&Number(match[1])<18;
}

// Owner-selected excerpts still require fresh server evidence. Selection is
// neither confirmation nor universal truth. No network, AI, sending or store.
export async function prepareManualCitedCandidates(scope,candidates,messages){
 if(!object(scope)||!['ownerId','workspaceId','creatorId'].every(key=>uuid(scope[key]))||!id(scope.fanId)||typeof scope.binding!=='string'||!/^acct_[A-Za-z0-9_-]{1,123}$/u.test(scope.binding)||!Array.isArray(messages)||messages.length>400)throw failure(503,'MEMORY_CANDIDATE_SOURCE');
 const selected=validateCitedCandidates(candidates),seen=new Set(),counts=new Map(),rows=messages.map(message=>{
  if(!object(message))throw failure(503,'MEMORY_CANDIDATE_SOURCE');const messageId=typeof message.id==='number'&&Number.isSafeInteger(message.id)?String(message.id):message.id,at=normalizeFanMemoryTimestamp(message.createdAt);
  if(!id(messageId)||seen.has(messageId)||!at||typeof message.isFromMe!=='boolean'||message.text!=null&&typeof message.text!=='string')throw failure(503,'MEMORY_CANDIDATE_SOURCE');seen.add(messageId);
  for(const[field,expected]of[['workspaceId',scope.workspaceId],['creatorId',scope.creatorId],['modelId',scope.creatorId],['fanId',scope.fanId],['binding',scope.binding]])if(Object.hasOwn(message,field)&&message[field]!==expected)throw failure(503,'MEMORY_CANDIDATE_SOURCE');
  counts.set(at,(counts.get(at)||0)+1);return{...message,id:messageId,createdAt:at,text:message.text||''};
 }).sort((a,b)=>Date.parse(a.createdAt)-Date.parse(b.createdAt)||(BigInt(a.id)<BigInt(b.id)?-1:1));
 const indices=new Map(rows.map((message,index)=>[message.id,index])),items=[];
 for(const candidate of selected){
  const index=indices.get(candidate.message_id),answer=index===undefined?null:rows[index];
  if(!answer||answer.isFromMe!==false||answer.pending||answer.delivery||!answer.text.includes(candidate.quote)||explicitMinor(answer.text))throw failure();
  if(!Object.hasOwn(candidate,'question_message_id')){items.push(...await prepareCitedCandidates(scope,[candidate],[answer]));continue;}
  const questionIndex=indices.get(candidate.question_message_id),question=questionIndex===undefined?null:rows[questionIndex],quote=question?.text.trim(),kind=memoryQuestionKind(quote);
  if(!question||question.isFromMe!==true||question.pending||question.delivery||questionIndex!==index-1||counts.get(question.createdAt)!==1||counts.get(answer.createdAt)!==1||Date.parse(question.createdAt)>=Date.parse(answer.createdAt)||!kind||categories[kind]!==candidate.category||!isAllowedContextualReply(kind,candidate.quote))throw failure();
  const asked={messageId:question.id,quote,at:question.createdAt,author:'model',kind},source={messageId:answer.id,quote:candidate.quote,at:answer.createdAt,author:'fan',question:asked},identity=[scope.ownerId,scope.workspaceId,scope.creatorId,scope.binding,scope.fanId];
  const key='manual_'+await digest([identity,candidate.category,source.messageId,source.quote,source.at,asked]);
  items.push({workspaceId:scope.workspaceId,creatorId:scope.creatorId,fanId:scope.fanId,key,category:candidate.category,value:candidate.quote,status:'pending',origin:'analysis',pinned:false,source});
 }
 return items;
}
