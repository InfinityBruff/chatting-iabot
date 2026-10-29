export const defaults = { mode:'selected', paused:false, starThresholds:[1,10000,50000,100000,250000], tone:'Cercano y natural', instructions:'Responde de forma breve y clara. Mantén el contexto y pide intervención cuando no tengas la información necesaria.', words:'hola, qué tal, cuéntame', avoid:'mensajes repetitivos, respuestas demasiado largas', min:15, max:45, video:true };
export function canAssist(config, fan) { return !config.paused && !fan.humanPaused && (config.mode === 'all' || (config.mode === 'selected' && fan.on === true)); }
export function starRating(cents,thresholds=defaults.starThresholds){if(!Number.isFinite(cents)||cents<0)return null;return thresholds.filter(t=>cents>=t).length;}
export function campaignRecipients(fans,audience,selected=[]){return fans.filter(f=>audience==='all'||audience==='online'&&f.online===true||audience==='selected'&&selected.includes(f.id)).map(f=>f.id);}
export function validateConfig(config) {
  if (!['all','selected','off'].includes(config.mode)) return 'Selecciona un modo válido.';
  if (![config.min,config.max].every(v => Number.isInteger(v) && v >= 0 && v <= 3600)) return 'Las esperas deben ser segundos enteros entre 0 y 3600.';
  if (config.max < config.min) return 'La espera máxima debe ser igual o mayor que la mínima.';
  if(config.starThresholds && (config.starThresholds.length!==5||config.starThresholds.some((v,i,a)=>!Number.isInteger(v)||v<0||i>0&&v<=a[i-1]))) return 'Los cinco umbrales de estrellas deben ser importes crecientes y diferentes.';
  for(const [key,min,max] of [['followupLimit',1,4],['followupDelay',5,10080],['priceFloor',0,10000],['priceCeiling',0,10000],['discountLimit',0,100]]) if(config[key]!==undefined&&(!Number.isInteger(config[key])||config[key]<min||config[key]>max))return 'Revisa los límites numéricos de la configuración.';
  if(config.priceFloor!==undefined&&config.priceCeiling<config.priceFloor)return 'El precio máximo debe ser igual o mayor que el mínimo.';
  for(const key of ['quietStart','quietEnd'])if(config[key]!==undefined&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(config[key]))return 'Revisa el horario de descanso.';
  if(config.quietEnabled&&config.quietStart===config.quietEnd)return 'El inicio y final del descanso deben ser distintos.';
  return '';
}
