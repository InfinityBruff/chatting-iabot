// Provider filter names and individual event type names are distinct contracts.
export const notificationCategories={subscribed:'Suscripciones',purchases:'Compras',tip:'Propinas',commented:'Comentarios',mentioned:'Menciones y etiquetas',favorited:'Me gusta',message:'Mensajes',deactivated_media:'Contenido desactivado'};
const aliases={paidedmessage:'purchases',paidedpost:'purchases',purchase:'purchases',purchased:'purchases',purchasedmessage:'purchases',purchasedpost:'purchases',messagepurchase:'purchases',postpurchase:'purchases',subscription:'subscribed',subscribe:'subscribed',renewed:'subscribed',renewal:'subscribed',tips:'tip',tipped:'tip',comment:'commented',mention:'mentioned',tagged:'mentioned',tag:'mentioned',favorite:'favorited',liked:'favorited',like:'favorited',messages:'message'};
export function notificationCategory(n){
 if(notificationCategories[n.category])return n.category;
 const token=typeof n.type==='string'?n.type.toLowerCase().replace(/[ _-]/g,''):'';
 if(notificationCategories[n.type])return n.type;
 if(aliases[token])return aliases[token];
 // Strict provider-generated purchase sentence observed in real notifications.
 if(/^(?:has )?purchased your (?:message|post|content) for \$(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{2})?[!.]?$/i.test((n.text||'').trim()))return 'purchases';
 return null;
}
export function notificationAmount(n){
 if(!['purchases','tip','subscribed'].includes(notificationCategory(n)))return null;
 // There is no typed amount in NotificationResponse: show only one unambiguous
 // USD amount explicitly present in its system text, never a financial total/net.
 const text=typeof n.text==='string'?n.text:'';
 if(/[€£¥]|(?:CAD|AUD|NZD|HKD|SGD|MXN|EUR|GBP)|[CAHNZS]\$/i.test(text))return null;
 const amounts=[...text.matchAll(/(?:\$\s*|\bUSD\s+)((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{2})?)(?![\d.,])/g)];
 if(amounts.length!==1||(text.match(/\$|\bUSD\b/g)||[]).length!==1)return null;
 const match=amounts[0];if(/[-\d.,]\s*$/.test(text.slice(0,match.index)))return null;
 const value=Number(match[1].replaceAll(',',''));return Number.isFinite(value)&&value>=0&&Number.isSafeInteger(Math.round(value*100))?value:null;
}
export function notificationAmountLabel(n){const amount=notificationAmount(n);return amount===null?null:new Intl.NumberFormat('es-ES',{style:'currency',currency:'USD',minimumFractionDigits:2}).format(amount)}
