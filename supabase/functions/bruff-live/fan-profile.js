// Explicit allowlist: never forward raw provider objects to the browser.
const text=v=>typeof v==='string'?v.slice(0,5000):null;
const bool=v=>typeof v==='boolean'?v:null;
const amount=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null;
const date=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}/.test(v)&&Number.isFinite(Date.parse(v))?v:null;
export function fanProfile(data,fan){
 if(String(data?.id)!==fan)throw Error('schema');
 return {id:fan,name:text(data.name),username:text(data.username),about:text(data.about),isVerified:bool(data.isVerified),subscribedOn:bool(data.subscribedOn),subscribedBy:bool(data.subscribedBy)};
}
export function fanHistory(data,fan){
 if(String(data?.fanId)!==fan)throw Error('schema');
 const h=data.history;
 if(!h||typeof h!=='object'||Array.isArray(h))throw Error('schema');
 const source=Array.isArray(h.list)?h.list:Array.isArray(h.history)?h.history:Array.isArray(h.items)?h.items:null;
 const events=(source||[]).slice(0,500).map(r=>({date:date(r?.date??r?.createdAt??r?.subscribeDate),end:date(r?.expireDate??r?.expiredAt),amount:amount(r?.price??r?.amount),type:['subscribe','subscription','renew','renewal','expire','expired','lapse'].includes(r?.type)?r.type:null})).filter(r=>r.date||r.end||r.amount!==null||r.type);
 return {since:date(h.subscribeDate??h.subscribedAt),expires:date(h.expireDate??h.expiredAt),renew:bool(h.isRenew??h.renew),price:amount(h.price),events,recognized:source!==null,truncated:(source?.length||0)>500,hasMore:h.hasMore===true};
}
