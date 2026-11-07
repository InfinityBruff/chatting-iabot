import {runChatRelay,ChatRelayError} from './chat-relay.js';
import {ENGINE_VERSION} from '../bruff-drafts/usage.js';

// This module verifies one canonical, explicitly confirmed choice and queues it.
// Queue and dispatch are fixed owner-scoped callbacks supplied by the endpoint;
// it has no provider client, credentials, arbitrary URL or direct send operation.
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu.test(value);
const sameId=(value,expected)=>uuid(value)&&value.toLowerCase()===expected;
const fan=value=>typeof value==='string'&&/^[1-9]\d{0,23}$/u.test(value);
const fields=['workspace_id','model_id','fan_id','generation_id','draft_id','request_id','expected_english','confirmed'];
const states=['queued','claimed','generating','ready','draft_ready','sending','sent','skipped','blocked','uncertain'];

export class SelectedReplyError extends Error{
 constructor(status,code,message){super(message);this.name='SelectedReplyError';this.status=status;this.code=code}
}
const invalid=()=>new SelectedReplyError(400,'SELECTED_REPLY_INPUT','Revisa la elección y confirma el texto exacto que quieres poner en cola.');
const unavailable=()=>new SelectedReplyError(503,'SELECTED_REPLY_UNAVAILABLE','No se pudo comprobar la preparación de esta respuesta.');
const access=status=>new SelectedReplyError(status,status===401?'SELECTED_REPLY_AUTH':'SELECTED_REPLY_ACCESS',status===401?'Vuelve a conectar tu sesión de propietario de BRUFF.':'Se requiere acceso vigente de propietario a esta agencia y modelo.');
const changed=()=>new SelectedReplyError(409,'SELECTED_REPLY_CHANGED','El borrador cambió o caducó. Consulta y confirma de nuevo el texto vigente.');
const uncertain=()=>new SelectedReplyError(503,'SELECTED_REPLY_QUEUE','No se pudo confirmar el registro de esta elección. Consulta su estado antes de volver a intentarlo.');
async function ownerCheck(recheckOwner){
 try{if(await recheckOwner()===false)throw access(403)}catch(error){if([401,403].includes(error?.status))throw access(error.status);throw unavailable()}
}
function relayError(error){
 if(error instanceof ChatRelayError){
  if([401,403].includes(error.status))return access(error.status);
  if(error.status===409)return changed();
  const result=new SelectedReplyError(error.status,error.code,error.message);
  if(Number.isSafeInteger(error.retryAfter)&&error.retryAfter>0&&error.retryAfter<=86400)result.retryAfter=error.retryAfter;
  return result;
 }
 return unavailable();
}
function receipt(value,target){
 if(!record(value)||!sameId(value.actorId,target.actor)||!sameId(value.workspaceId,target.w)||!sameId(value.creatorId,target.c)||value.fanId!==target.fan||!sameId(value.generationId,target.generation)||value.draftId!==target.draft||!sameId(value.requestId,target.request)||!uuid(value.jobId)||!states.includes(value.state)||!Number.isSafeInteger(value.version)||value.version<1||typeof value.newlyQueued!=='boolean'||value.newlyQueued&&value.state!=='queued')throw unavailable();
 return {actorId:target.actor,workspaceId:target.w,creatorId:target.c,fanId:target.fan,generationId:target.generation,draftId:target.draft,requestId:target.request,jobId:value.jobId.toLowerCase(),state:value.state,version:value.version,newlyQueued:value.newlyQueued};
}

export async function queueSelectedReply({args,actor,w,c,call,recheckOwner,queue,dispatch}={}){
 if(![actor,w,c].every(uuid)||typeof call!=='function'||typeof recheckOwner!=='function'||typeof queue!=='function'||dispatch!==undefined&&typeof dispatch!=='function')throw unavailable();
 const target={actor:actor.toLowerCase(),w:w.toLowerCase(),c:c.toLowerCase()};
 if(!record(args)||Object.keys(args).length!==fields.length||fields.some(key=>!Object.hasOwn(args,key))||Object.keys(args).some(key=>!fields.includes(key))||!sameId(args.workspace_id,target.w)||!sameId(args.model_id,target.c)||!fan(args.fan_id)||!uuid(args.generation_id)||!['1','2','3'].includes(args.draft_id)||!uuid(args.request_id)||args.confirmed!==true||typeof args.expected_english!=='string'||!args.expected_english.trim()||args.expected_english.length>700||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(args.expected_english))throw invalid();
 const expectedEnglish=args.expected_english;
 Object.assign(target,{fan:args.fan_id,generation:args.generation_id.toLowerCase(),draft:args.draft_id,request:args.request_id.toLowerCase()});
 let canonical;
 try{canonical=await runChatRelay({operation:'verify',args:{workspace_id:target.w,model_id:target.c,fan_id:target.fan,generation_id:target.generation,draft_id:target.draft},actor:target.actor,w:target.w,c:target.c,call,recheckOwner})}catch(error){throw relayError(error)}
 if(canonical.selectionValid!==true||canonical.engineVersion!==ENGINE_VERSION||canonical.selectedDraft?.id!==target.draft||canonical.selectedDraft.english!==expectedEnglish)throw changed();
 let saved,failure;
 try{saved=await queue({w:target.w,c:target.c,fan:target.fan,request_id:target.request,generation_id:target.generation,draft_id:target.draft,expected_english:canonical.selectedDraft.english,confirmed:true})}catch(error){failure=error}
 // A successful queue is not an authorization lease. A revoked owner cannot
 // observe its receipt or trigger dispatch, including after a failed SQL call.
 await ownerCheck(recheckOwner);
 if(failure){if([401,403].includes(failure?.status))throw access(failure.status);if(failure?.status===409)throw changed();throw uncertain()}
 const current=receipt(saved,target);
 if(!current.newlyQueued||typeof dispatch!=='function')return {...current,dispatchRequested:false,dispatchUnconfirmed:false};
 // Dispatch only asks the durable worker to inspect this new job. Its response
 // is deliberately not used as a delivery receipt or a claim that it was sent.
 let dispatchUnconfirmed=false;
 try{await dispatch(current.jobId)}catch{dispatchUnconfirmed=true}
 await ownerCheck(recheckOwner);
 return {...current,dispatchRequested:true,dispatchUnconfirmed};
}
