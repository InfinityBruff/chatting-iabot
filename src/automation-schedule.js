export const scheduleDefaults={repeat:false,intervalMinutes:120,endMode:'duration',durationMinutes:120,endAt:'',maxRuns:4};
export function validateSchedule(d,now=Date.now()){
 if(d.type==='welcome')return '';
 if(d.schedule==='scheduled'&&(!Number.isFinite(Date.parse(d.at))||Date.parse(d.at)<=now))return 'El inicio debe ser una fecha futura.';
 if(d.type==='mass'&&!d.repeat)return '';
 if(d.repeat&&(!Number.isSafeInteger(Number(d.intervalMinutes))||Number(d.intervalMinutes)<60||Number(d.intervalMinutes)>43200))return 'El intervalo debe estar entre 60 minutos y 30 días.';
 if(!['duration','date','runs'].includes(d.endMode)||d.type==='online'&&d.endMode==='runs')return 'Selecciona cuándo finalizar.';
 if(d.endMode==='duration'&&(!Number.isSafeInteger(Number(d.durationMinutes))||Number(d.durationMinutes)<1||Number(d.durationMinutes)>525600))return 'Elige una duración entre 1 minuto y 365 días.';
 if(d.endMode==='runs'&&(!Number.isSafeInteger(Number(d.maxRuns))||Number(d.maxRuns)<1||Number(d.maxRuns)>1000))return 'Elige entre 1 y 1.000 ejecuciones.';
 if(d.endMode==='date'&&(!Number.isFinite(Date.parse(d.endAt))||Date.parse(d.endAt)<=(d.schedule==='scheduled'?Date.parse(d.at):now)))return 'La finalización debe ser posterior al inicio.';
 return '';
}
export function durationLabel(minutes){const n=Math.max(0,Math.ceil(Number(minutes)||0));return [Math.floor(n/1440)&&Math.floor(n/1440)+' d',Math.floor(n%1440/60)&&Math.floor(n%1440/60)+' h',n%60&&n%60+' min'].filter(Boolean).join(' ')||'0 min'}
export function scheduleSummary(d){if(d.type==='welcome')return 'Nuevas suscripciones después de activar';const start=d.schedule==='scheduled'?'Inicio: '+new Date(d.at).toLocaleString('es-ES'):'Inicio al activar';if(d.type==='mass'&&!d.repeat)return start+' · Una sola ejecución';const end=d.endMode==='date'?'hasta '+new Date(d.endAt).toLocaleString('es-ES'):d.endMode==='runs'?d.maxRuns+' ejecuciones':'durante '+durationLabel(d.durationMinutes);return start+' · '+(d.type==='mass'?'Cada '+durationLabel(d.intervalMinutes)+' · ':'')+end}
