import {scheduleDefaults,validateSchedule} from './automation-schedule.js';
export const automationTypes={mass:{title:'Mensajes masivos',short:'Masivos',icon:'↗',description:'Prepara una campaña para varios fans de una misma modelo.',trigger:'Una campaña, una audiencia',hint:'Define los destinatarios y revisa el mensaje antes de preparar el envío.'},welcome:{title:'Mensajes de bienvenida',short:'Bienvenida',icon:'✦',description:'Diseña el primer mensaje que recibirán los nuevos suscriptores.',trigger:'Cuando llega un nuevo suscriptor',hint:'Solo nuevas altas detectadas por BRUFF. Revisa otras bienvenidas para evitar duplicados.'},online:{title:'Mensajes a fans en línea',short:'En línea',icon:'◉',description:'Prepara una regla para contactar con fans cuya presencia esté confirmada.',trigger:'Cuando un fan está en línea',hint:'La presencia disponible corresponde a usuarios seguidos. No confirma a todos los suscriptores.'}};
export const automationKey=(user,workspace,model)=>'bruff-automation-drafts:'+JSON.stringify([user,workspace,model]);
export function newAutomation(type='mass'){return {...scheduleDefaults,listIds:[],id:'',type,name:'',text:'',audience:'all',recipients:[],schedule:'manual',at:'',cooldown:24,limit:1,skipRecent:true,archived:false}}
export function validateAutomation(d){
 const scheduling=validateSchedule({...scheduleDefaults,...d});if(scheduling)return scheduling;
 if(d.type==='mass'&&d.audience==='collections'&&(!Array.isArray(d.listIds)||!d.listIds.length))return 'Selecciona al menos una colección.';
 if(!automationTypes[d.type])return 'Elige un tipo de automatización.';
 if(!d.name?.trim()||d.name.length>80)return 'Escribe un nombre de hasta 80 caracteres.';
 if(!d.text?.trim()||d.text.length>3000)return 'Escribe un mensaje de hasta 3.000 caracteres.';
 if(d.type==='mass'&&d.audience==='selected'&&!d.recipients?.length)return 'Selecciona al menos un fan.';
 if(d.type==='mass'&&d.schedule==='scheduled'&&(!Number.isFinite(Date.parse(d.at))||Date.parse(d.at)<=Date.now()))return 'Selecciona una fecha y hora futura.';
 if(d.type==='online'&&(![24,48,72,168].includes(Number(d.cooldown))||![1,2,3].includes(Number(d.limit))))return 'Revisa los límites de frecuencia.';
 return '';
}
export function onlineAudience(rows,presence,now=Date.now()){return rows.filter(f=>{const stamp=Date.parse(presence?.confirmations?.[String(f.id)]);return Number.isFinite(stamp)&&stamp<=now&&now-stamp<60000})}
export function saveAutomation(rows,input,now=new Date().toISOString()){
 const error=validateAutomation(input);if(error)throw Error(error);
 const old=rows.find(r=>r.id===input.id),value={...input,id:old?.id||crypto.randomUUID(),createdAt:old?.createdAt||now,updatedAt:now,status:'draft',archived:false};
 return [value,...rows.filter(r=>r.id!==value.id)];
}
