import {memoryQuestionKind} from '../../../server/fan-memory.js';
import {isAllowedContextualReply,isAllowedCoarsePlace,isNeutralMemoryQuote} from './cited-candidates.js';

// Context is evidence, not an assertion of nationality, residence or truth.
// Only already-read, adjacent messages are considered. No network or AI here.
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const exact=(value,keys)=>object(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const id=value=>typeof value==='string'&&/^[1-9][0-9]{0,23}$/u.test(value);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(value);
const iso=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,19)===value.slice(0,19);
const fold=value=>value.normalize('NFD').replace(/[\u0300-\u036f]/gu,'').replace(/[’‘]/gu,"'").toLowerCase();
const categories=Object.freeze({where_from:'personal_context',where_based:'personal_context',preferred_name:'preferred_name',language:'language',interests:'interests'});
const scopeKeys=['ownerId','workspaceId','creatorId','binding','fanId'];
const fail=(code='MEMORY_CONTEXTUAL',status=503)=>Object.assign(Error(status===409?'La página contiene más candidatos contextuales de los admitidos.':'No se pudo verificar la evidencia contextual de memoria.'),{code,status});
function checkedScope(scope){
 if(!object(scope)||!['ownerId','workspaceId','creatorId'].every(key=>uuid(scope[key]))||!id(scope.fanId)||typeof scope.binding!=='string'||!/^acct_[A-Za-z0-9_-]{1,123}$/u.test(scope.binding))throw fail();
 return scopeKeys.map(key=>scope[key]);
}
async function hash(value){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))].map(part=>part.toString(16).padStart(2,'0')).join('');}
const ambiguous=value=>/["“”«»]/u.test(value)||/\b(?:not|never|no|don't|dont|doesn't|doesnt|isn't|isnt|aren't|arent|wasn't|wasnt|can't|cant|cannot|didn't|didnt|won't|wont|nunca|ni|if|would|could|might|maybe|perhaps|probably|possibly|wish|imagine|either|or|versus|quizas|quiza|si|podria|quisiera|ojala|tal vez|used to|previously|formerly|antes|visiting|vacation|holiday|tourist|vacaciones|viaje)\b/u.test(fold(value))||/\b(?:he|she|they|his|her|their|someone|somebody|my (?:friend|buddy|brother|sister|wife|husband|parents?|father|mother|dad|mom|mum|son|daughter|cousin|partner|boss|colleague)|mi (?:amigo|amiga|hermano|hermana|padre|madre|hijo|hija|primo|prima|pareja|novio|novia|jefe|colega|familia)|ella|ellos|ellas)\b/u.test(fold(value))||/\bel\s+(?:vive|es|esta|trabaja|reside)\b/u.test(fold(value));
function wholeAnswer(text,kind){
 if(typeof text!=='string'||text.length>120)return null;const quote=text.trim();if(quote.length<2||quote.length>120||/[\u0000-\u001f\u007f]/u.test(quote)||ambiguous(quote)||quote.endsWith('?'))return null;
 return isAllowedContextualReply(kind,quote)?quote:null;
}
function placePrefix(suffix){
 const words=[];for(const word of suffix.matchAll(/[\p{L}]+(?:['’-][\p{L}]+)*/gu)){words.push(word);if(words.length===6)break;}let best=null;
 for(const word of words){const end=word.index+word[0].length,place=suffix.slice(0,end);if(place.length>80||word.index>0&&!/^[\p{L} '-]+$/u.test(place))break;if(isAllowedCoarsePlace(place))best={place,end};}
 return best;
}
function compactSelfDescription(before){
 const start=/^(?:i am|i'm|im|soy|yo soy|estoy|yo estoy)\b/u.exec(before);if(!start)return false;let rest=before.slice(start[0].length).trim();
 if(!rest)return true;
 const age=/^(\d{1,3})(?:\s*(?:years? old|yo|y\/o|anos?))?(?:[,\s]+|$)/u.exec(rest);
 if(age){const value=Number(age[1]);if(value<18||value>120)return false;rest=rest.slice(age[0].length).trim();}
 // Optional grammar only: the entire discarded prefix must be closed and
 // compact. No free narrative, sensitive descriptors or ages are persisted.
 if(!rest)return true;
 return /^(?:(?:a|an|un|una) )?(?:person|man|woman|guy|retired|persona|jubilad[oa]|friendly|cheerful|quiet|relaxed|amable|tranquil[oa]|alegre)$/u.test(rest)||isNeutralMemoryQuote('I am '+rest,'personal_context');
}
function minorIndicator(text){
 const value=fold(text);if(/\b(?:underage|minor|child|kid|teenager|seventeen|sixteen|fifteen|fourteen|thirteen|twelve|eleven|menor|adolescente|nino|nina|diecisiete|dieciseis|quince|catorce|trece|doce)\b/u.test(value))return true;
 const age=/\b(?:i am|i'm|im|tengo)\s+(\d{1,3})(?:\b|\s*(?:years?|yo|y\/o|anos?))/u.exec(value);return !!age&&(Number(age[1])<18||Number(age[1])>120);
}
function placeFragments(text){
 if(typeof text!=='string'||text.length>10000||ambiguous(text)||minorIndicator(text)||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text))return [];
 const direct=text.trim().replace(/[.!]+$/u,'').trimEnd();
 if(direct.length>=2&&direct.length<=80&&isAllowedContextualReply('where_from',direct))return[direct];
 if(/\b(?:street|road|avenue|postcode|postal|zip|calle|avenida|whatsapp|telegram|phone number|numero de telefono)\b/iu.test(text))return [];
 if(/\b(?:moved?|moving|relocat\w*|going to|mud\w*|watch\w*|film|movie|book|story|song|read|reading|saw|seen|hear|heard|said|told|pelicula|libro|cuento|cancion|vi|dijo)\b/u.test(fold(text)))return [];
 const found=[],observedPlaces=new Set();
 const prefixes=/\b(?:in|from|near|around|en|de|cerca de)\s+(?:(?:the\s+|las\s+|los\s+|el\s+)?(?:mountains|mountain region|countryside|state|area|montañas|montanas|estado|zona)\s+(?:of|de)\s+)?/giu;
 for(const match of text.matchAll(prefixes)){
  const start=match.index,after=start+match[0].length,prefix=placePrefix(text.slice(after)),best=prefix?{place:prefix.place,end:after+prefix.end}:null;
  if(!best||text[best.end]==='?'||/^[\s-]*(?:street|road|avenue|st\b|rd\b|ave\b|calle|avenida|\d)/iu.test(text.slice(best.end)))continue;
  // Count all observed coarse places before filtering their attribution. A
  // later unowned clause must not make an ambiguous first location look unique.
  observedPlaces.add(fold(best.place));if(observedPlaces.size>1)return[];
  const before=fold(text.slice(0,start)).trim().replace(/[,;]\s*$/u,''),selfDescription=compactSelfDescription(before)||isNeutralMemoryQuote(before,'personal_context'),ownLocation=/\b(?:i (?:live|reside|am based|am located)|i'm based|im based|vivo|resido|estoy ubicad[oa])$/u.test(before);
  if(!selfDescription&&!ownLocation)continue;
  const tail=text.slice(best.end),connector=/^\s*(?:,|and\b|y\b|&|\/|\()\s*/iu.exec(tail),second=connector?placePrefix(tail.slice(connector[0].length)):null;
  if(second&&fold(second.place)!==fold(best.place))return[];
  const quote=text.slice(start,best.end);if(!isAllowedContextualReply('where_from',quote))continue;
  found.push({quote,place:fold(best.place)});
 }
 if(new Set(found.map(item=>item.place)).size!==1)return [];
 return found.length?[found[0].quote]:[];
}
function answerFor(kind,text){return kind==='where_from'||kind==='where_based'?placeFragments(text):[wholeAnswer(text,kind)].filter(Boolean);}

export function validateContextualBoundaryShape(boundary){
 if(boundary===null||boundary===undefined)return null;
 if(!exact(boundary,['scopeHash','messageId','at','candidates'])||typeof boundary.scopeHash!=='string'||!/^[a-f0-9]{64}$/u.test(boundary.scopeHash)||!id(boundary.messageId)||!iso(boundary.at)||!Array.isArray(boundary.candidates)||boundary.candidates.length<1||boundary.candidates.length>2)throw fail('MEMORY_CONTEXT_BOUNDARY');
 const seen=new Set();
 for(const candidate of boundary.candidates){
  if(!exact(candidate,['kind','category','quote'])||!['where_from','where_based','language','interests'].includes(candidate.kind)||candidate.category!==categories[candidate.kind]||typeof candidate.quote!=='string'||candidate.quote.length<2||candidate.quote.length>120||!answerFor(candidate.kind,candidate.quote).includes(candidate.quote))throw fail('MEMORY_CONTEXT_BOUNDARY');
  const key=JSON.stringify([candidate.kind,candidate.quote]);if(seen.has(key))throw fail('MEMORY_CONTEXT_BOUNDARY');seen.add(key);
 }
 return structuredClone(boundary);
}
export async function validateContextualBoundary(scope,boundary){
 const identity=checkedScope(scope),value=validateContextualBoundaryShape(boundary);if(value&&value.scopeHash!==await hash(identity))throw fail('MEMORY_CONTEXT_BOUNDARY');return value;
}
function checkedRows(scope,messages){
 if(!Array.isArray(messages)||messages.length>200)throw fail();const seen=new Set();
 return messages.map(message=>{
  if(!object(message))throw fail();const messageId=typeof message.id==='number'&&Number.isSafeInteger(message.id)?String(message.id):message.id;
  if(!id(messageId)||seen.has(messageId)||typeof message.isFromMe!=='boolean'||!iso(message.createdAt)||message.text!=null&&typeof message.text!=='string')throw fail();seen.add(messageId);
  for(const[field,expected]of[['workspaceId',scope.workspaceId],['creatorId',scope.creatorId],['modelId',scope.creatorId],['fanId',scope.fanId],['binding',scope.binding]])if(Object.hasOwn(message,field)&&message[field]!==expected)throw fail();
  return{id:messageId,at:new Date(message.createdAt).toISOString(),text:message.text||'',isFromMe:message.isFromMe,blocked:!!(message.pending||message.delivery)};
 }).sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)||(BigInt(a.id)<BigInt(b.id)?-1:1));
}
function question(row){
 if(!row||!row.isFromMe||row.blocked)return null;const quote=row.text.trim(),kind=memoryQuestionKind(quote);return kind?{messageId:row.id,quote,at:row.at,author:'model',kind}:null;
}
async function item(scope,source,question){
 const key='context_'+await hash([...checkedScope(scope),question.kind,question.messageId,question.quote,question.at,source.messageId,source.quote,source.at]);
 return{workspaceId:scope.workspaceId,creatorId:scope.creatorId,fanId:scope.fanId,key,category:categories[question.kind],value:source.quote,status:'pending',origin:'analysis',pinned:false,source:{messageId:source.messageId,quote:source.quote,at:source.at,author:'fan',question}};
}
function closedBoundaryCandidates(row){
 if(!row||row.isFromMe||row.blocked)return[];
 const place=placeFragments(row.text);if(place.length)return['where_from','where_based'].map(kind=>({kind,category:'personal_context',quote:place[0]}));
 // A name without an observed question is not a closed neutral vocabulary.
 for(const kind of ['language','interests']){const quote=wholeAnswer(row.text,kind);if(quote)return[{kind,category:categories[kind],quote}];}
 return[];
}

export async function extractContextualFanCandidates(scope,messages,{boundary=null}={}){
 const identity=checkedScope(scope),previous=await validateContextualBoundary(scope,boundary),rows=checkedRows(scope,messages),counts=new Map(),items=[];
 for(const row of rows)counts.set(row.at,(counts.get(row.at)||0)+1);
 const unique=row=>counts.get(row.at)===1;
 for(let index=1;index<rows.length;index++){
  const before=rows[index-1],answer=rows[index],asked=question(before);
  if(!asked||answer.isFromMe||answer.blocked||!unique(before)||!unique(answer)||Date.parse(before.at)>=Date.parse(answer.at))continue;
  const quote=answerFor(asked.kind,answer.text)[0];if(quote)items.push(await item(scope,{messageId:answer.id,quote,at:answer.at},asked));
 }
 if(previous&&rows.length){
  const latest=rows.at(-1),asked=question(latest);
  if(asked&&unique(latest)&&!rows.some(row=>row.id===previous.messageId)&&Date.parse(latest.at)<Date.parse(previous.at)){
   const candidate=previous.candidates.find(candidate=>candidate.kind===asked.kind);if(candidate)items.push(await item(scope,{messageId:previous.messageId,quote:candidate.quote,at:previous.at},asked));
  }
 }
 if(items.length>20)throw fail('MEMORY_CONTEXT_LIMIT',409);
 const oldest=rows[0],candidates=oldest&&unique(oldest)?closedBoundaryCandidates(oldest):[];
 const next=candidates.length?{scopeHash:await hash(identity),messageId:oldest.id,at:oldest.at,candidates}:null;
 return{items,boundary:validateContextualBoundaryShape(next)};
}
