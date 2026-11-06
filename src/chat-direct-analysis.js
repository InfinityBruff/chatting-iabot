import {galleryMessages,galleryPriceLabel} from './conversation-gallery.js';

const identity=value=>typeof value==='string'&&/^[1-9]\d{0,23}$/.test(value)?value:typeof value==='number'&&Number.isSafeInteger(value)&&value>0?String(value):null;
const price=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;
const mediaCount=value=>Number.isSafeInteger(value)&&value>0?value:0;

// This is a price on a message, ordered by the message's creation time. There
// is no purchase timestamp, receipt or net revenue in this messages contract.
function latestPrice(groups){
 if(!groups.length)return {value:null,messageIds:[],createdAt:null,reason:'No hay un mensaje comparable identificado.'};
 if(groups.some(group=>!group.createdAt))return {value:null,messageIds:[],createdAt:null,reason:'Faltan fechas para identificar el mensaje más reciente.'};
 let latest=-Infinity;for(const group of groups)latest=Math.max(latest,Date.parse(group.createdAt));
 const matches=groups.filter(group=>Date.parse(group.createdAt)===latest),values=new Set(matches.map(group=>group.price));
 if(values.has(null))return {value:null,messageIds:matches.map(group=>group.id),createdAt:matches[0].createdAt,reason:'El precio del mensaje más reciente no está informado.'};
 if(values.size!==1)return {value:null,messageIds:matches.map(group=>group.id),createdAt:matches[0].createdAt,reason:'Varios mensajes comparten fecha y tienen precios distintos.'};
 return {value:matches[0].price,messageIds:matches.map(group=>group.id),createdAt:matches[0].createdAt,reason:null};
}

// The caller owns authorization and the exact chat scope. This pure helper
// describes loaded evidence only; it never generates replies, stages or offers.
export function analyzeChatDirect(messages,{historyComplete=false}={}){
 const available=Array.isArray(messages),byId=new Map();let invalidRecords=0;
 if(available)for(const message of messages){const id=message&&typeof message==='object'&&!Array.isArray(message)?identity(message.id):null;if(id===null){invalidRecords++;continue}byId.set(id,message)}
 // Resolve duplicate IDs before eligibility, so a newer unknown/pending row
 // cannot leave an older, apparently confirmed copy in the analysis.
 const loaded=[...byId.values()],outgoing=loaded.filter(message=>message.isFromMe===true&&!message.delivery),groups=galleryMessages(loaded),groupIds=new Set(groups.map(group=>group.id));
 let freePhotos=0,freeVideos=0,ppvOffered=0,ppvUnlocked=0,unknownFreeMedia=0,unknownPriceMessages=0,missingMediaMessages=0,unknownUnlockMessages=0;
 for(const group of groups){
  if(group.status.key==='tip')continue;
  if(group.price===null)unknownPriceMessages++;
  if(group.status.key==='free'){
   freePhotos+=group.media.filter(item=>item.type==='photo').length;
   freeVideos+=group.media.filter(item=>item.type==='video').length;
   if(group.missingMediaCount||group.media.some(item=>item.type==='file'))unknownFreeMedia++;
  }
  if(group.price>0){ppvOffered++;if(group.isOpened===true)ppvUnlocked++;else if(group.isOpened===null)unknownUnlockMessages++}
 }
 for(const message of outgoing){
  if(message.isTip===true||groupIds.has(identity(message.id)))continue;
  const hasMedia=Array.isArray(message.media)&&message.media.length>0||mediaCount(message.mediaCount)>0;
  if(hasMedia||price(message.price)>0){missingMediaMessages++;if(price(message.price)===0)unknownFreeMedia++;if(price(message.price)===null)unknownPriceMessages++}
 }
 const unknownDirectionMessages=loaded.filter(message=>message.isFromMe!==true&&message.isFromMe!==false).length,freeMediaMessages=groups.filter(group=>group.status.key==='free').length;
 const complete=available&&historyComplete===true,baseKnown=complete&&invalidRecords===0&&unknownDirectionMessages===0;
 const freeKnown=baseKnown&&unknownFreeMedia===0&&unknownPriceMessages===0&&missingMediaMessages===0,offeredKnown=baseKnown&&unknownPriceMessages===0&&missingMediaMessages===0;
 const totals={freePhotos:freeKnown?freePhotos:null,freeVideos:freeKnown?freeVideos:null,ppvOffered:offeredKnown?ppvOffered:null,ppvUnlocked:offeredKnown&&unknownUnlockMessages===0?ppvUnlocked:null};
 const confirmed=latestPrice(groups.filter(group=>!group.isTip&&group.isOpened===true&&group.price!==0)),offered=latestPrice(groups.filter(group=>!group.isTip&&group.price!==0));
 const observed={freePhotos:available?freePhotos:null,freeVideos:available?freeVideos:null,ppvOffered:available?ppvOffered:null,ppvUnlocked:available?ppvUnlocked:null};
 const labels={freePhotos:['foto gratuita','fotos gratuitas'],freeVideos:['vídeo gratuito','vídeos gratuitos'],ppvOffered:['mensaje PPV con precio informado','mensajes PPV con precio informado'],ppvUnlocked:['mensaje PPV con desbloqueo explícito','mensajes PPV con desbloqueo explícito']};
 const countLabels=Object.fromEntries(Object.entries(labels).map(([key,[single,plural]])=>[key,available?`${observed[key]} ${observed[key]===1?single:plural} en el historial cargado (datos explícitos)`:`${plural}: sin datos cargados`]));
 const metadataPartial=invalidRecords>0||unknownDirectionMessages>0||unknownFreeMedia>0||unknownPriceMessages>0||missingMediaMessages>0||unknownUnlockMessages>0;
 const confirmedLabel=confirmed.value===null?'Último PPV desbloqueado identificado: sin verificar.':`Último PPV desbloqueado identificado: ${galleryPriceLabel({price:confirmed.value})}. Por fecha del mensaje, no del cobro.`;
 const offeredLabel=offered.value===null?'Último precio ofertado identificado: sin verificar.':`Último precio ofertado identificado: ${galleryPriceLabel({price:offered.value})}. No acredita un pago.`;
 return {
  ...observed,
  coverageLabel:!available?'Historial no disponible.':!complete?'Historial cargado parcial: los recuentos describen solo los mensajes cargados.':metadataPartial?'Historial cargado completo según la fuente, con metadatos sin verificar.':'Historial cargado completo según la fuente; no representa toda la actividad de la cuenta.',
  phase:'Sin verificar',lastScriptLevel:'Sin verificar',
  commercialState:!available?'Sin datos cargados':ppvUnlocked?'Desbloqueo explícito registrado en el historial cargado':ppvOffered?'PPV con precio registrado; sin desbloqueo confirmado':freeMediaMessages?'Contenido gratuito identificado en el historial cargado':'Sin evidencia comercial suficiente en el historial cargado',
  nextAction:available?'Sin acción verificada. Revisa el historial y las fuentes disponibles.':'Espera a que se cargue una conversación autorizada.',
  lastConfirmedPrice:confirmed.value,lastOfferedPrice:offered.value,lastConfirmedPriceLabel:confirmedLabel,lastOfferedPriceLabel:offeredLabel,
  countLabels,totals,totalsKnown:Object.values(totals).every(value=>value!==null),
  metadata:{available,historyComplete:complete,loadedMessages:available?loaded.length:null,outgoingConfirmedMessages:available?outgoing.length:null,mediaMessages:groups.length,freeMediaMessages,invalidRecords,unknownDirectionMessages,unknownPriceMessages,unknownFreeMedia,missingMediaMessages,unknownUnlockMessages,ignoredDeliveryMessages:loaded.filter(message=>!!message.delivery).length,confirmedPrice:{...confirmed,basis:'message_created_at',verification:'isOpened_true'},offeredPrice:{...offered,basis:'message_created_at'},priceUnit:'message_set',purchaseAmountVerified:false,purchaseTimeVerified:false,scope:'loaded_messages_only'},
 };
}
