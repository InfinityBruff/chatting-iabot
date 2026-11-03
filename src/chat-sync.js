// Stable IDs reconcile new pages without dropping the history already on screen.
export function mergePage(previous,next,field,{append=false,retain=false}={}){
 if(!previous||!field||(!append&&!retain))return next;
 const rows=new Map((previous.data?.[field]||[]).map(x=>[String(x.userId??x.id),x]));
 for(const x of next.data?.[field]||[]){const key=String(x.userId??x.id),old=rows.get(key);const merged={...old,...x};
  if(field==='conversations'&&old&&Date.parse(old.lastMessageTime)>Date.parse(x.lastMessageTime)){for(const k of ['lastMessage','lastMessageTime','lastMessageIsFromMe'])merged[k]=old[k];}
  if(field==='conversations'&&old?.spend?.available&&x.spend?.available===false)merged.spend=old.spend;
  rows.set(key,field==='messages'&&old&&JSON.stringify(old)===JSON.stringify(merged)?old:merged);}
 return {...next,data:{...next.data,...(!append&&previous.data._extended?{cursor:previous.data.cursor,hasMore:previous.data.hasMore}:{}),_extended:append||previous.data._extended===true,[field]:[...rows.values()]}};
}
export function newestPreview(fan,message){
 if(!message?.createdAt||!Number.isFinite(Date.parse(message.createdAt))||Date.parse(message.createdAt)<(Date.parse(fan.lastMessageTime)||0))return fan;
 const preview=message.text||(message.media?.length||message.mediaCount?'Contenido adjunto':'Mensaje sin texto');
 return fan.lastMessage===preview&&fan.lastMessageTime===message.createdAt&&fan.lastMessageIsFromMe===message.isFromMe?fan:{...fan,lastMessage:preview,lastMessageTime:message.createdAt,lastMessageIsFromMe:message.isFromMe};
}
export function sessionKey(user,workspace,account='',fan='',kind='view'){return 'bruff-ui:'+JSON.stringify([user,workspace,account,fan,kind]);}
export function readSession(key,fallback=null){try{const raw=sessionStorage.getItem(key);return raw?JSON.parse(raw):fallback}catch{return fallback}}
export function writeSession(key,value){try{if(value==null)sessionStorage.removeItem(key);else sessionStorage.setItem(key,JSON.stringify(value));return true}catch{return false}}
export function clearUserSession(user){try{const prefix='bruff-ui:';for(const key of Object.keys(sessionStorage)){if(key.startsWith(prefix)&&JSON.parse(key.slice(prefix.length))[0]===user)sessionStorage.removeItem(key)}}catch{}}
