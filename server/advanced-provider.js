// OFMAPI adapter for the advanced coordinator. Off by default; no retries on writes.
const id=value=>typeof value==='number'&&Number.isSafeInteger(value)&&value>0?String(value):typeof value==='string'&&/^[1-9][0-9]{0,23}$/.test(value)?value:null;
const same=(a,b)=>a&&b&&['workspace','creator','fan'].every(k=>typeof a[k]==='string'&&a[k]&&a[k]===b[k]);
export function advancedProvider({scope,binding,providerKey,authorize,fetcher=fetch,enabled=false,now=()=>Date.now(),maxVaultPages=100}){
 if(!scope||!id(scope.fan)||!/^acct_[\w-]+$/.test(binding)||typeof authorize!=='function')throw Error('Ámbito de proveedor inválido');
 let verified=null,verifiedTags=[];
 const ensure=async target=>{if(!same(target,scope)||await authorize()!==binding)throw Error('Acceso retirado o conexión modificada')};
 const read=async path=>{await ensure(scope);const r=await fetcher('https://api.ofmapi.com/v1/accounts/'+binding+'/'+path,{method:'GET',headers:{Authorization:'Bearer '+providerKey},redirect:'error',signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error(r.status===429?'Cuota de lectura del proveedor agotada':'Lectura de proveedor no confirmada');const data=await r.json();await ensure(scope);return data};
 return {
  async resolveTags(target,tags=[]){
   await ensure(target);verifiedTags=[];
   if(!Array.isArray(tags)||tags.length>10)throw Error('Etiquetas inválidas');
   const users=[];
   for(const tag of tags){
    if(typeof tag!=='string'||!/^@?[a-zA-Z0-9_.]{1,64}$/.test(tag))throw Error('Etiqueta inválida');
    const username=tag.replace(/^@/,'');const row=await read('user/'+encodeURIComponent(username));
    if(typeof row.username!=='string'||row.username.toLowerCase()!==username.toLowerCase()||!id(row.id)||!Number.isSafeInteger(Number(row.id)))throw Error('No se pudo verificar la etiqueta '+tag);
    users.push(Number(row.id));
   }
   verifiedTags=[...new Set(users)];return [...verifiedTags];
  },
  async fan(){const data=await read('user/'+scope.fan);if(id(data.id)!==scope.fan)throw Error('Perfil de otro fan');return {scope:{...scope},fanName:typeof data.name==='string'?data.name:''}},
  async resolveMedia(target,media){
   await ensure(target);verified=null;
   if(!Array.isArray(media)||media.length>10||media.some(m=>!id(m.id)||!Number.isSafeInteger(Number(m.id))||!['free','paid'].includes(m.slot))||new Set(media.map(m=>m.id)).size!==media.length)throw Error('Adjuntos inválidos');
   if(new Set(media.map(m=>m.slot)).size>1)throw Error('El proveedor no confirma adjuntos gratuitos y de pago mezclados en el mismo mensaje');
   const found=new Set(),wanted=new Map(media.map(m=>[m.id,m])),cursors=new Set();let cursor=null;
   for(let page=0;found.size<wanted.size&&page<maxVaultPages;page++){
    const params=new URLSearchParams({pages:'1'});if(cursor)params.set('cursor',cursor);
    const data=await read('vault/media?'+params);
    if(!Array.isArray(data.media)||typeof data.hasMore!=='boolean')throw Error('Baúl incompleto');
    for(const row of data.media){const key=id(row.id),requested=wanted.get(key);if(!requested)continue;if(row.canView!==true||row.isReady!==true||row.hasError!==false||row.type!==requested.type)throw Error('Archivo no disponible o modificado');found.add(key)}
    if(found.size===wanted.size||!data.hasMore)break;
    if(typeof data.cursor!=='string'||!data.cursor||data.cursor.length>2048||cursors.has(data.cursor))throw Error('Paginación de baúl incompleta');cursors.add(data.cursor);cursor=data.cursor;
   }
   if(found.size!==wanted.size)throw Error('No se verificaron todos los archivos en esta modelo');
   await ensure(scope);const items=media.map(m=>Number(m.id));verified={items,slot:media[0]?.slot||null,at:now()};return {scope:{...scope},verified:true,items};
  },
  async send(target,payload,{idempotencyKey}={}){
   if(!enabled)throw Error('Ejecutor de envíos deshabilitado');
   await ensure(target);
   if(!verified||now()-verified.at>60000||now()<verified.at||JSON.stringify(payload.media)!==JSON.stringify(verified.items))throw Error('Verificación de medios caducada o diferente');
   if(JSON.stringify(payload.tagUsers||[])!==JSON.stringify(verifiedTags))throw Error('Etiquetas no verificadas');
   const price=payload.price;
   if(typeof payload.text!=='string'||payload.text.length>3000||!payload.text.trim()&&!payload.media.length||typeof payload.lockedText!=='boolean'||!Number.isFinite(price)||price<0||price>200||Math.abs(price*100-Math.round(price*100))>0.000001||price>0&&price<3||payload.lockedText&&price===0||verified.slot==='paid'&&price===0||verified.slot==='free'&&price>0)throw Error('Precio, texto o bloqueo no compatibles');
   if(typeof idempotencyKey!=='string'||!/^bruff-advanced-[\w-]{1,100}$/.test(idempotencyKey))throw Error('Falta identificador único de entrega');
   // Consume proof before any network write. Even a failed request cannot reuse it.
   verified=null;
   const response=await fetcher('https://api.ofmapi.com/v1/accounts/'+binding+'/conversations/'+scope.fan+'/messages',{method:'POST',headers:{Authorization:'Bearer '+providerKey,'Content-Type':'application/json','Idempotency-Key':idempotencyKey},body:JSON.stringify({text:payload.text,media:payload.media,price,lockedText:payload.lockedText,...(verifiedTags.length?{tagUsers:verifiedTags}:{}),typingWpm:0}),redirect:'error',signal:AbortSignal.timeout(20000)});
   if(!response.ok)throw Error('Envío sin confirmación; revisar antes de reintentar');const data=await response.json();if(!id(data.id)||data.queueId)throw Error('El proveedor no confirmó una entrega inmediata');return {id:id(data.id)};
  }
 };
}
