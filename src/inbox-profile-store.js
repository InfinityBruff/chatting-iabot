const prefix='bruff-inbox-profiles-v1:',uuid=/^[0-9a-f-]{36}$/i;
const cleanProfiles=rows=>rows.slice(0,500).filter(f=>f&&/^\d{1,24}$/.test(String(f.userId??f.id))).map(f=>({userId:String(f.userId??f.id),name:typeof f.name==='string'?f.name.slice(0,200):undefined,username:typeof f.username==='string'?f.username.slice(0,100):undefined,lastMessageTime:typeof f.lastMessageTime==='string'?f.lastMessageTime.slice(0,40):undefined,unreadCount:Number.isSafeInteger(f.unreadCount)&&f.unreadCount>=0?f.unreadCount:0,profileSnapshot:true}));
function storageKey(owner,scope){try{const [workspace,account,operation,signature]=JSON.parse(scope),args=JSON.parse(signature);return owner&&uuid.test(workspace)&&uuid.test(account)&&operation==='inbox'&&!args.query?prefix+JSON.stringify([owner,workspace,account]):null}catch{return null}}
export function createInboxProfileStore(storage,now=Date.now){
 const keys=()=>{const rows=[];for(let i=0;i<storage.length;i++){const key=storage.key(i);if(key?.startsWith(prefix))rows.push(key)}return rows};
 return {
  read(owner,scope){try{const key=storageKey(owner,scope);if(!key)return null;const row=JSON.parse(storage.getItem(key));if(!row||!Number.isFinite(row.at)||row.at>now()||now()-row.at>86400000||!Array.isArray(row.profiles)||row.profiles.length>500){storage.removeItem(key);return null}return {data:{conversations:cleanProfiles(row.profiles),cursor:null,hasMore:false},cachedProfiles:true,observedAt:new Date(row.at).toISOString()}}catch{return null}},
  write(owner,scope,value){try{const key=storageKey(owner,scope);if(!key||value.cachedProfiles||!Array.isArray(value.data?.conversations))return;
   const profiles=cleanProfiles(value.data.conversations);
   const payload=JSON.stringify({at:now(),profiles});if(payload.length>131072)return;storage.removeItem(key);storage.setItem(key,payload);const stored=keys();while(stored.length>8)storage.removeItem(stored.shift());
  }catch{}},
  clear(owner){try{for(const key of keys()){try{if(JSON.parse(key.slice(prefix.length))[0]===owner)storage.removeItem(key)}catch{storage.removeItem(key)}}}catch{}}
 };
}
