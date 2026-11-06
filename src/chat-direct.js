const part=value=>typeof value==='string'&&value.length>0&&value.length<=256&&value===value.trim()&&!/[\u0000-\u001f\u007f]/u.test(value);
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const identifier=value=>part(value)&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u.test(value);
const tokenPattern=/\{\{([A-Z][A-Z0-9_]{0,31})\}\}/gu;
const invalid=()=>Error('Las sugerencias no tienen un contexto o una fuente verificada válidos.');

export function scopeKey({actor,workspace,account,fanId}={}){
 return [actor,workspace,account,fanId].every(part)?JSON.stringify([actor,workspace,account,fanId]):null;
}
function parseScope(scope){
 if(typeof scope!=='string')return null;
 try{const values=JSON.parse(scope);if(!Array.isArray(values)||values.length!==4)return null;const [actor,workspace,account,fanId]=values;return scopeKey({actor,workspace,account,fanId})===scope?{actor,workspace,account,fanId}:null}catch{return null}
}

const id=value=>typeof value==='string'?value:Number.isSafeInteger(value)&&value>=0?String(value):null;
const amount=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;
const boolean=value=>typeof value==='boolean'?value:null;
function mediaContext(media){
 return [...new Set((Array.isArray(media)?media:[]).filter(record).map(item=>JSON.stringify([id(item.id),typeof item.type==='string'?item.type:null,amount(item.duration),boolean(item.canView),boolean(item.isDrm),boolean(item.isReady),boolean(item.hasError)])))].sort();
}
export function contextRevision(messages){
 const rows=(Array.isArray(messages)?messages:[]).filter(record).map(message=>JSON.stringify([
  id(message.id),typeof message.text==='string'?message.text:null,
  typeof message.isFromMe==='boolean'?message.isFromMe:typeof message.direction==='string'?message.direction:null,
  amount(message.price),boolean(message.isOpened),boolean(message.isTip),
  typeof message.delivery==='string'?message.delivery:message.delivery?true:null,
  typeof message.createdAt==='string'?message.createdAt:null,
  Number.isSafeInteger(message.mediaCount)&&message.mediaCount>=0?message.mediaCount:null,mediaContext(message.media),
 ]));
 const value=JSON.stringify([...new Set(rows)].sort());
 // Compact UI change detection, not a signature, source proof or authorization.
 // Transport timestamps and expiring media URLs are deliberately absent.
 let a=0x811c9dc5,b=0x9e3779b9;
 for(let i=0;i<value.length;i++){const c=value.charCodeAt(i);a=Math.imul(a^c,0x01000193);b=Math.imul(b^c,0x85ebca6b)}
 return 'ctx1:'+value.length+':'+(a>>>0).toString(16).padStart(8,'0')+(b>>>0).toString(16).padStart(8,'0');
}

function sourceSnapshot(source){
 if(!record(source)||source.verified!==true||!identifier(source.modelId))throw invalid();
 const version=Number.isSafeInteger(source.version)&&source.version>0?String(source.version):source.version;
 if(!identifier(version)||version==='0'||source.status!==undefined&&source.status!=='verified')throw invalid();
 if(source.label!==undefined&&(typeof source.label!=='string'||source.label.length>200||/[\u0000-\u001f\u007f]/u.test(source.label)))throw invalid();
 // These are provenance shapes, not proof of approval. Only the authenticated
 // bank can establish that a referenced document or conversation was reviewed.
 if(source.kind==='document'){
  if(!identifier(source.referenceId)||typeof source.label!=='string'||!source.label.trim()||'conversationId'in source||'messageId'in source)throw invalid();
  return Object.freeze({kind:'document',verified:true,modelId:source.modelId,referenceId:source.referenceId,label:source.label,version});
 }
 if(source.kind!==undefined&&source.kind!=='conversation'||'referenceId'in source||![source.conversationId,source.messageId].every(identifier))throw invalid();
 return Object.freeze({...(source.kind==='conversation'?{kind:'conversation'}:{}),verified:true,modelId:source.modelId,conversationId:source.conversationId,messageId:source.messageId,version,...(source.label!==undefined?{label:source.label}:{})});
}
function variablesSnapshot(variables,english,spanish){
 if(variables===undefined)variables=[];
 if(!Array.isArray(variables)||variables.length>20)throw invalid();
 let previous=0;const definitions=new Map(),result=[];
 for(const variable of variables){
  if(!record(variable)||typeof variable.key!=='string'||!/^[A-Z][A-Z0-9_]{0,31}$/u.test(variable.key)||typeof variable.label!=='string'||!variable.label.trim()||variable.label.length>60||/[\[\]{}\u0000-\u001f\u007f]/u.test(variable.label))throw invalid();
  const {start,end}=variable,type=variable.type==='age'?'bioAge':variable.type;
  if(!['text','bioAge'].includes(type)||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<previous||end<=start||end>english.length||end-start>120)throw invalid();
  // Offsets are UTF-16, like JavaScript slice; never split a surrogate pair.
  if(start>0&&/[\uD800-\uDBFF]/u.test(english[start-1])&&/[\uDC00-\uDFFF]/u.test(english[start])||end<english.length&&/[\uD800-\uDBFF]/u.test(english[end-1])&&/[\uDC00-\uDFFF]/u.test(english[end]))throw invalid();
  const original=english.slice(start,end);
  if(!/[\p{L}\p{N}]/u.test(original)||/[{}\r\n]/u.test(original))throw invalid();
  if(type==='bioAge'&&(!/^\d{2,3}$/u.test(original)||Number(original)<18||Number(original)>100))throw invalid();
  const definition={label:variable.label,type},old=definitions.get(variable.key);
  if(old&&(old.label!==definition.label||old.type!==type))throw invalid();
  definitions.set(variable.key,definition);result.push(Object.freeze({key:variable.key,label:variable.label,start,end,type}));previous=end;
 }
 const matches=[...spanish.matchAll(tokenPattern)],keys=new Set(matches.map(match=>match[1]));
 if(/[{}]{2}/u.test(spanish.replace(tokenPattern,''))||keys.size!==definitions.size||[...keys].some(key=>!definitions.has(key)))throw invalid();
 return Object.freeze(result);
}
function candidateSnapshot(candidate){
 if(!record(candidate)||!identifier(candidate.id)||typeof candidate.english!=='string'||!candidate.english.trim()||candidate.english.length>10000||typeof candidate.spanish!=='string'||!candidate.spanish.trim()||candidate.spanish.length>10000)throw invalid();
 const source=sourceSnapshot(candidate.source),variables=variablesSnapshot(candidate.variables,candidate.english,candidate.spanish);
 return Object.freeze({id:candidate.id,english:candidate.english,spanish:candidate.spanish,source,variables});
}

// A corpus references vault IDs; it cannot supply attachment capabilities,
// preview URLs, uploads or arbitrary media objects. Those come from an
// authorized vault read for the current operator after this validation.
function contentSnapshot(content,account){
 if(!record(content)||content.accountId!==account||content.currency!=='USD'||!Array.isArray(content.mediaIds)||content.mediaIds.length<1||content.mediaIds.length>10)throw invalid();
 const mediaIds=content.mediaIds.map(value=>{if(typeof value!=='string'||!/^[1-9]\d{0,23}$/u.test(value))throw invalid();return value});
 if(new Set(mediaIds).size!==mediaIds.length)throw invalid();
 const priceCents=content.priceCents===undefined?null:content.priceCents;
 if(priceCents!==null&&(!Number.isSafeInteger(priceCents)||priceCents<0||Math.round(priceCents/100*100)!==priceCents))throw invalid();
 if(typeof content.reason!=='string'||!content.reason.trim()||content.reason.length>500||/[\u0000-\u001f\u007f]/u.test(content.reason))throw invalid();
 const reference=content.reference,version=Number.isSafeInteger(reference?.version)&&reference.version>0?String(reference.version):reference?.version;
 if(!record(reference)||reference.verified!==true||!identifier(reference.id)||!identifier(version)||version==='0')throw invalid();
 if(content.categoryId!==undefined&&(typeof content.categoryId!=='string'||!/^\d{1,20}$/u.test(content.categoryId)))throw invalid();
 return Object.freeze({accountId:account,currency:'USD',priceCents,mediaIds:Object.freeze(mediaIds),reason:content.reason,reference:Object.freeze({id:reference.id,version,verified:true}),...(content.categoryId!==undefined?{categoryId:content.categoryId}:{})});
}

// Structural validation only. A future authorized server adapter must establish
// provenance; a caller-supplied verified:true is not proof of an approved source.
export function validateSuggestions(payload,{scope,revision,allowedSourceModels}={}){
 const target=parseScope(scope);
 if(!target||typeof revision!=='string'||!revision||!record(payload)||payload.scope!==scope||payload.revision!==revision||!Array.isArray(payload.candidates)||payload.candidates.length>3)throw invalid();
 const models=allowedSourceModels===undefined?[target.account]:allowedSourceModels instanceof Set?[...allowedSourceModels]:allowedSourceModels;
 if(!Array.isArray(models)||models.some(model=>!identifier(model)))throw invalid();
 const allowed=new Set(models),byId=new Map(),byText=new Map(),definitions=new Map(),result=[];let contentCount=0;
 for(const raw of payload.candidates){
  const base=candidateSnapshot(raw),content=raw.content===undefined?null:contentSnapshot(raw.content,target.account);
  const candidate=content?Object.freeze({...base,content}):base;if(!allowed.has(candidate.source.modelId))throw invalid();
  for(const variable of candidate.variables){
   const prior=definitions.get(variable.key);
   if(prior&&(prior.label!==variable.label||prior.type!==variable.type))throw invalid();
   definitions.set(variable.key,{label:variable.label,type:variable.type});
  }
  const serialized=JSON.stringify(candidate),sameId=byId.get(candidate.id);
  if(sameId){if(sameId!==serialized)throw invalid();continue}
  byId.set(candidate.id,serialized);
  const textKey=JSON.stringify([candidate.english,candidate.content||null]),prior=byText.get(textKey);
  if(prior){if(JSON.stringify(prior.variables)!==JSON.stringify(candidate.variables)||prior.spanish!==candidate.spanish)throw invalid();continue}
  if(content&&++contentCount>1)throw invalid();
  byText.set(textKey,candidate);result.push(candidate);
 }
 return Object.freeze(result);
}

export function materializeSuggestion(candidate,values={}){
 const original=candidateSnapshot(candidate),definitions=new Map(original.variables.map(variable=>[variable.key,variable])),resolved=new Map(),missing=[],errors={};
 const plain=record(values)&&[null,Object.prototype].includes(Object.getPrototypeOf(values));
 if(!plain||Object.keys(values).some(key=>!definitions.has(key)))errors._values='Revisa los campos: solo se admiten las variables indicadas.';
 for(const [key,variable] of definitions){
  const raw=plain&&Object.hasOwn(values,key)?values[key]:undefined;
  if(raw===undefined||raw===null||typeof raw==='string'&&!raw.trim()){missing.push(key);continue}
  const value=variable.type==='bioAge'&&Number.isSafeInteger(raw)?String(raw):raw;
  if(typeof value!=='string'||value.length>120||/[\u0000-\u001f\u007f]/u.test(value)||value.includes('{{')||value.includes('}}')){errors[key]='Escribe un valor válido de hasta 120 caracteres.';missing.push(key);continue}
  if(variable.type==='bioAge'&&(!/^\d{2,3}$/u.test(value)||Number(value)<18||Number(value)>100)){errors[key]='La edad debe ser un número entero entre 18 y 100.';missing.push(key);continue}
  resolved.set(key,value);
 }
 const replacement=key=>resolved.has(key)?resolved.get(key):'['+definitions.get(key).label+']';
 let english='',offset=0;
 for(const variable of original.variables){english+=original.english.slice(offset,variable.start)+replacement(variable.key);offset=variable.end}
 english+=original.english.slice(offset);
 const spanish=original.spanish.replace(tokenPattern,(_token,key)=>replacement(key));
 return {english,spanish,complete:missing.length===0&&Object.keys(errors).length===0,missing,errors};
}

// The caller applies ready.text atomically and consumes the token afterwards.
// This helper never mutates a draft/Set, validates a send or invokes transport.
export function applyDraftInsertion({scope,currentScope,token,consumed,text,currentText,expectedText,mode,enabled,locked=false}={}){
 if(!parseScope(scope)||scope!==currentScope)return {status:'stale'};
 if(enabled!==true||locked||!part(token))return {status:'blocked'};
 if(consumed instanceof Set?consumed.has(token):Array.isArray(consumed)?consumed.includes(token):consumed===token)return {status:'duplicate'};
 if(typeof currentText!=='string'||currentText.length>10000)return {status:'blocked',reason:'draft'};
 if(mode==='check')return {status:'checked',currentText};
 if(!['append','replace'].includes(mode)||typeof text!=='string'||!text.trim()||text.length>10000||typeof expectedText!=='string')return {status:'blocked',reason:'text'};
 if(currentText!==expectedText)return {status:'conflict',currentText};
 const next=mode==='replace'?text:currentText+(currentText?'\n':'')+text;
 return next.length<=10000?{status:'ready',text:next}:{status:'blocked',reason:'limit'};
}
