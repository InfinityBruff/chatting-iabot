const mediaTypes=new Set(['photo','video','audio','gif']);
const usd=new Intl.NumberFormat('es-ES',{style:'currency',currency:'USD'});
const identity=value=>typeof value==='string'&&/^[1-9]\d{0,23}$/.test(value)?value:typeof value==='number'&&Number.isSafeInteger(value)&&value>0?String(value):null;
const amount=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;

export function galleryPriceLabel(message){
 const price=amount(message?.price);
 if(price===null)return 'Precio no disponible';
 if(message?.isTip===true)return `${usd.format(price)} · Propina`;
 return price===0?'Gratis':`${usd.format(price)} · Precio del conjunto`;
}

function status(message){
 if(message.isTip===true)return {key:'tip',label:'Propina'};
 if(message.price===0)return {key:'free',label:'Gratis'};
 if(message.price>0)return message.isOpened===true?{key:'unlocked',label:'Desbloqueado'}:{key:'paid',label:'PPV · Sin desbloqueo confirmado'};
 return {key:'unknown',label:'Estado no disponible'};
}

// The price belongs to the carrying message, including when a type filter hides
// some of its attachments. Viewing permission and read receipts do not prove a sale.
export function galleryMessages(messages,{tab='sent',type='all',query=''}={}){
 if(!Array.isArray(messages))return [];
 const groups=new Map(),filter=mediaTypes.has(type)?type:'all',search=typeof query==='string'?query.trim().toLocaleLowerCase('es-ES'):'';
 for(const message of messages){
  if(!message||message.isFromMe!==true||message.delivery)continue;
  const id=identity(message.id);if(!id)continue;
  const assets=new Map();
  for(const item of Array.isArray(message.media)?message.media:[]){
   if(!item||typeof item!=='object'||Array.isArray(item))continue;
   const mediaId=identity(item.id);if(!mediaId)continue;
   assets.set(mediaId,{...item,id:mediaId,type:mediaTypes.has(item.type)?item.type:'file',...(Array.isArray(item.previewSources)?{previewSources:[...item.previewSources]}:{})});
  }
  const missingMediaCount=Number.isSafeInteger(message.mediaCount)&&message.mediaCount>0?Math.max(0,message.mediaCount-assets.size):0;
  if(!assets.size&&!missingMediaCount)continue;
  const price=amount(message.price),group={id,text:typeof message.text==='string'?message.text:'',createdAt:typeof message.createdAt==='string'&&Number.isFinite(Date.parse(message.createdAt))?message.createdAt:null,price,isFromMe:true,isTip:message.isTip===true,isOpened:typeof message.isOpened==='boolean'?message.isOpened:null,media:[...assets.values()],missingMediaCount};
  group.status=status(group);groups.set(id,group);
 }
 return [...groups.values()].filter(message=>tab!=='unlocked'||message.status.key==='unlocked').map(message=>({...message,media:message.media.filter(item=>filter==='all'||item.type===filter)})).filter(message=>(message.media.length||filter==='all'&&message.missingMediaCount>0)&&(!search||[message.id,message.text,...message.media.map(item=>item.id)].some(value=>value.toLocaleLowerCase('es-ES').includes(search)))).sort((a,b)=>(Date.parse(b.createdAt)||0)-(Date.parse(a.createdAt)||0));
}
