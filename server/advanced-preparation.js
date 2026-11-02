import {validateAutoMessage} from '../src/auto-messages.js';
import {massExecutionSchedule} from './advanced-schedule.js';
// Reject unsupported settings before looking up any recipient. Never silently ignore one.
export function preparationPlan(draft,now=new Date().toISOString()){
 const error=validateAutoMessage(draft);if(error)throw Error(error);
 if(draft.trigger!=='mass'||draft.action!=='message'||draft.messages.length!==1)throw Error('El ejecutor admite por ahora masivos de un mensaje');
 if(['resend'].some(k=>draft[k]?.enabled)||draft.startAiOnReply||Object.entries(draft.audience||{}).some(([k,v])=>!['excludeLists','modelSpend','buyingPower','agencySpend','modelPurchase','agencyPurchase'].includes(k)&&v?.enabled))throw Error('Hay opciones todavía sin conectar al ejecutor');
 const m=draft.messages[0];
 if(new Set(m.media.map(x=>x.slot)).size>1||m.paidText&&m.media.some(x=>x.slot==='free'))throw Error('No se puede combinar contenido gratuito y bloqueado en este envío');
 return massExecutionSchedule(draft,now);
}
