// No example values in the resolver used for real recipients.
const clean=value=>typeof value==='string'?value.trim().replace(/\s+/gu,' '):'';
export function resolveDynamicName(step,{fan='',custom=''}={}){
 const order={none:[],custom:['custom'],fan:['fan'],fan_custom:['fan','custom'],custom_fan:['custom','fan']}[step.nameMode];
 if(!order)throw Error('Modo de nombre desconocido');
 if(step.nameMode==='none')return {name:'',source:'none'};
 const names={fan:clean(fan),custom:clean(custom)};
 for(const source of order)if(names[source])return {name:step.firstName?names[source].split(' ')[0]:names[source],source};
 return {name:clean(step.fallback),source:'fallback'};
}
export function personalizeMessage(step,names){
 const resolved=resolveDynamicName(step,names);
 if(step.nameMode!=='none'&&!resolved.name)throw Error('Falta un nombre alternativo para este destinatario');
 return {...resolved,text:step.text.replaceAll('{nombre}',()=>resolved.name)};
}
