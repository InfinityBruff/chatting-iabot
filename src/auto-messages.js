import {personalizeMessage} from './dynamic-name.js';
import {scheduleDefaults,validateSchedule,scheduleSummary,durationLabel} from './automation-schedule.js';
// Configurations only. These drafts are never passed to the v2 sending worker.
export const autoMessageTriggers = {
 mass:{name:'Masivos',icon:'users',description:'Envía una campaña a todos los fans, colecciones o perfiles elegidos.'},
 welcome:{name:'Bienvenida',icon:'hand',description:'Saluda a los fans cuando se suscriben por primera vez.',event:'se suscribe por primera vez'},
 online:{name:'En línea',icon:'online',description:'Contacta con los fans cuando aparecen en línea.',event:'aparece en línea'},
 expired:{name:'Suscripción caducada',icon:'expired',description:'Prepara un mensaje después de que caduque su suscripción.'},
 expiring:{name:'Próxima a caducar',icon:'clock',description:'Prepara un mensaje antes de que termine su suscripción.'},
};
export const triggerDelays=['1-3','3-5','5-15','15-30','30-60'];
export const sequenceDelays=['0-1','1-2','2-5','5-10','30-45','45-60'];
export const expiryDays=[1,2,5,7,10,14];
export const nameModes=[['none','Sin personalización'],['custom','Nombre personalizado'],['fan','Nombre del fan'],['fan_custom','Nombre del fan → personalizado'],['custom_fan','Personalizado → nombre del fan']];
export const newAutoMessageStep=()=>({id:crypto.randomUUID(),text:'',delay:'0-1',nameMode:'none',fallback:'',firstName:false,paidMedia:false,paidText:false,price:'',media:[],tags:[]});
const range=()=>({enabled:false,min:'',max:''});
export function newAutoMessage(trigger='welcome'){
 if(!autoMessageTriggers[trigger])throw Error('Tipo de campaña desconocido.');
 return {schemaVersion:1,id:'',name:'',trigger,action:'message',delay:'3-5',expiryDays:1,
  timeWindow:{enabled:false,start:'00:00',end:'23:00',zone:'Europe/Madrid'},
  ending:{enabled:false,mode:'date',at:'',durationMinutes:120},
  unsend:{enabled:false,mode:'all',hours:1},resend:{enabled:false,days:1},startAiOnReply:false,
  audience:{modelSpend:range(),agencySpend:range(),modelPurchase:range(),agencyPurchase:range(),buyingPower:range(),activeChats:{enabled:trigger==='welcome',mode:'all',minutes:trigger==='welcome'?1440:15},excludeLists:[]},
  ...(trigger==='mass'?{bulk:{...scheduleDefaults,audience:'all',listIds:[],recipients:[],schedule:'manual',at:''}}:{}),
  messages:[newAutoMessageStep()]};
}
export function autoMessageKey(user,workspace,creator){
 if(![user,workspace,creator].every(x=>typeof x==='string'&&x))throw Error('Falta el ámbito de la campaña.');
 return 'bruff-auto-messages-v1:'+JSON.stringify([user,workspace,creator]);
}
export function validateAutoMessage(d){
 if(!d||d.schemaVersion!==1||!autoMessageTriggers[d.trigger]||!['message','assistant'].includes(d.action))return 'Revisa el tipo de campaña y su acción.';
 if(typeof d.name!=='string'||!d.name.trim()||d.name.length>80)return 'Añade un nombre interno de hasta 80 caracteres.';
 if(d.trigger==='mass'){
  const b=d.bulk;
  if(!b||!['all','collections','selected'].includes(b.audience)||!['manual','scheduled'].includes(b.schedule)||typeof b.repeat!=='boolean')return 'Revisa la audiencia y programación del masivo.';
  for(const [key,limit] of [['listIds',100],['recipients',10000]])if(!Array.isArray(b[key])||b[key].length>limit||b[key].some(id=>typeof id!=='string'||!(/^[a-zA-Z0-9_-]{1,100}$/).test(id))||new Set(b[key]).size!==b[key].length)return 'Revisa las colecciones o fans seleccionados.';
  if(b.audience==='collections'&&!b.listIds.length||b.audience==='selected'&&!b.recipients.length)return 'Selecciona al menos una colección o un fan.';
  if(d.action!=='message'||d.messages?.length!==1)return 'Los masivos usan un único mensaje por ejecución.';
  const error=validateSchedule({...b,type:'mass'},0);if(error)return error;
 }
 if(!triggerDelays.includes(d.delay)||!expiryDays.includes(Number(d.expiryDays)))return 'Selecciona un retraso válido.';
 if(!d.timeWindow||!/^\d{2}:\d{2}$/.test(d.timeWindow.start)||!/^\d{2}:\d{2}$/.test(d.timeWindow.end)||[d.timeWindow.start,d.timeWindow.end].some(t=>Number(t.slice(0,2))>23||Number(t.slice(3))>59))return 'Revisa la franja horaria.';
 try{new Intl.DateTimeFormat('es',{timeZone:d.timeWindow.zone}).format()}catch{return 'Selecciona una zona horaria válida.'}
 if(d.timeWindow.enabled&&d.timeWindow.start===d.timeWindow.end)return 'La hora de inicio y la de fin deben ser diferentes.';
 if(!d.ending||!['date','duration'].includes(d.ending.mode))return 'Revisa la finalización.';
 if(d.ending.enabled&&(d.ending.mode==='date'?!Number.isFinite(Date.parse(d.ending.at)):!Number.isInteger(d.ending.durationMinutes)||d.ending.durationMinutes<1||d.ending.durationMinutes>525600))return 'Indica una fecha o duración válida para finalizar.';
 if(!d.unsend||!['all','unread'].includes(d.unsend.mode)||![1,2,5,8,15,20].includes(Number(d.unsend.hours)))return 'Revisa la retirada automática.';
 if(!d.resend||![1,2,3,5,7,14,30].includes(Number(d.resend.days))||d.resend.enabled&&(!d.unsend.enabled||d.trigger!=='online'))return 'El reenvío solo se prepara para mensajes en línea con retirada activada.';
 for(const key of ['modelSpend','agencySpend','modelPurchase','agencyPurchase','buyingPower']){
  const r=d.audience?.[key];if(!r)return 'Revisa los filtros de audiencia.';
  if(r.enabled&&(r.min===''||r.max===''||!Number.isFinite(Number(r.min))||!Number.isFinite(Number(r.max))||Number(r.min)<0||Number(r.max)<Number(r.min)))return 'Completa los rangos de audiencia: mínimo y máximo válidos.';
  if(r.enabled&&key==='buyingPower'&&Number(r.max)>5)return 'El poder de compra va de 0 a 5.';
 }
 if(!d.audience.activeChats||!['all','team'].includes(d.audience.activeChats.mode)||!Number.isInteger(Number(d.audience.activeChats.minutes))||Number(d.audience.activeChats.minutes)<1)return 'Revisa la exclusión de chats activos.';
 if(!Array.isArray(d.audience.excludeLists)||d.audience.excludeLists.length>100||d.audience.excludeLists.some(id=>typeof id!=='string'||!/^[\w-]{1,100}$/.test(id)))return 'Revisa las colecciones excluidas.';
 if(!Array.isArray(d.messages)||d.messages.length<1||d.messages.length>5||d.messages.some(m=>!m||typeof m.id!=='string'||!m.id)||new Set(d.messages.map(m=>m.id)).size!==d.messages.length)return 'Puedes preparar entre 1 y 5 mensajes diferentes.';
 for(const [i,m] of d.messages.entries()){
  const label='Mensaje '+(i+1)+': ';
  if(typeof m.text!=='string'||m.text.length>3000||d.action==='message'&&!m.text.trim()&&!m.media?.length)return label+'escribe un texto o selecciona contenido.';
  if(!sequenceDelays.includes(m.delay)||!nameModes.some(([id])=>id===m.nameMode)||typeof m.fallback!=='string'||m.fallback.length>80)return label+'revisa la personalización y el retraso.';
  if(m.nameMode!=='none'&&!m.fallback.trim())return label+'añade un nombre alternativo para fans sin nombre.';
  if(!Array.isArray(m.media)||m.media.length>10||m.media.some(x=>!x||typeof x.id!=='string'||!/^\d{1,24}$/.test(x.id)||!['photo','video','audio','gif'].includes(x.type)||!['free','paid'].includes(x.slot))||new Set(m.media.map(x=>x.id)).size!==m.media.length)return label+'revisa los archivos del baúl (máximo 10, sin duplicados).';
  if(m.paidMedia&&!m.media.some(x=>x.slot==='paid'))return label+'selecciona el contenido de pago.';
  if(m.paidText&&!m.text.trim())return label+'escribe el texto de pago.';
  if(m.paidMedia||m.paidText){const p=Number(String(m.price).replace(',','.'));if(!Number.isFinite(p)||p<3||p>200||Math.abs(p*100-Math.round(p*100))>0.00001)return label+'el precio debe estar entre 3 y 200 USD, con hasta 2 decimales.';}
  if(!Array.isArray(m.tags)||m.tags.length>10||m.tags.some(x=>!/^@?[a-zA-Z0-9_.]{1,64}$/.test(x)))return label+'revisa las cuentas etiquetadas.';
 }
 return '';
}
// Strip signed attachment tokens, preview URLs and server-owned status from persistence.
export function autoMessagePayload(d){
 const error=validateAutoMessage(d);if(error)throw Error(error);
 const base=newAutoMessage(d.trigger),out={};
 const shape=(sample,input)=>Object.fromEntries(Object.keys(sample).map(k=>[k,sample[k]&&typeof sample[k]==='object'&&!Array.isArray(sample[k])?shape(sample[k],input[k]):structuredClone(input[k])]));
 for(const key of Object.keys(base))if(key!=='id')out[key]=base[key]&&typeof base[key]==='object'&&!Array.isArray(base[key])?shape(base[key],d[key]):structuredClone(d[key]);
 out.name=out.name.trim();
 out.messages=out.messages.map(m=>({id:m.id,text:m.text,delay:m.delay,nameMode:m.nameMode,fallback:m.fallback,firstName:!!m.firstName,paidMedia:!!m.paidMedia,paidText:!!m.paidText,price:m.paidMedia||m.paidText?Math.round(Number(String(m.price).replace(',','.'))*100)/100:0,media:m.media.map(x=>({id:x.id,type:x.type,slot:x.slot})),tags:m.tags}));
 return out;
}
export function saveLocalAutoMessage(rows,draft,scope,now=new Date().toISOString()){
 const key=autoMessageKey(scope.user,scope.workspace,scope.creator),config=autoMessagePayload(draft);
 if(draft.scope&&draft.scope!==key||rows.some(r=>r.scope!==key))throw Error('Campaña de otra cuenta.');
 const old=rows.find(r=>r.id===draft.id);
 if(old&&old.version!==draft.version)throw Error('Este borrador cambió. Ábrelo de nuevo antes de guardar.');
 const row={...config,id:old?.id||crypto.randomUUID(),scope:key,status:'draft',archived:false,version:(old?.version||0)+1,createdAt:old?.createdAt||now,updatedAt:now};
 return {row,rows:[row,...rows.filter(r=>r.id!==row.id)]};
}
export function duplicateAutoMessage(row){const next={...structuredClone(row),id:'',name:(row.name+' · copia').slice(0,80),status:'draft',archived:false,messages:row.messages.map(m=>({...m,id:crypto.randomUUID()}))};for(const k of ['version','scope','createdAt','updatedAt','counts','history'])delete next[k];return next}
export function previewAutoMessage(step,{fan='Alex',custom='Álex'}={}){
 return personalizeMessage(step,{fan,custom}).text;
}
export function autoMessageRuleSummary(d){
 if(d.trigger==='mass')return scheduleSummary({...d.bulk,type:'mass'});
 const parts=[d.trigger==='expired'?d.expiryDays+' día(s) después de caducar':d.trigger==='expiring'?d.expiryDays+' día(s) antes de caducar':autoMessageTriggers[d.trigger]?.name+' · espera '+d.delay+' min'];
 if(d.timeWindow.enabled)parts.push(d.timeWindow.start+'–'+d.timeWindow.end+' ('+d.timeWindow.zone+')');
 if(d.ending.enabled)parts.push(d.ending.mode==='duration'?'Durante '+durationLabel(d.ending.durationMinutes):'Finaliza '+new Date(d.ending.at).toLocaleString('es-ES'));
 if(d.unsend.enabled)parts.push('Retirar '+(d.unsend.mode==='unread'?'no leídos':'todos')+' tras '+d.unsend.hours+' h');
 if(d.resend.enabled)parts.push('Reenvío tras '+d.resend.days+' día(s)');
 return parts.join(' · ');
}
export function autoMessagePreparationIssues(d){
 const issues=[d.trigger==='mass'&&!d.bulk.repeat&&!d.messages.some(m=>m.text.includes('{nombre}'))?'Masivo nativo: prepara los destinatarios y revisa el envío antes de confirmar. Las opciones incompatibles se bloquean. Guardar no envía.':'El ejecutor personalizado o recurrente todavía no está habilitado. Guardar no activa ni envía.'];
 if(d.action==='assistant'||d.startAiOnReply)issues.push('BRUFF IA necesita un modelo conectado y controles de activación verificados.');
 if(d.audience.buyingPower.enabled)issues.push('Buying Power es una métrica de OnlyMonster: OFMAPI no ofrece una equivalencia verificada.');
 if(d.audience.agencySpend.enabled||d.audience.agencyPurchase.enabled)issues.push('Los filtros de agencia necesitan un histórico unificado autorizado; no se estiman con las páginas visibles.');
 if(d.unsend.enabled)issues.push('La retirada automática necesita comprobación de permisos, estado y restricciones del proveedor.');
 return issues;
}
