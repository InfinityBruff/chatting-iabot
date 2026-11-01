// Community endpoints never expose provider raw objects or HTML.
export const communityNames=['notifications','collections','collection_fans','collection_detail','collection_create','collection_rename','collection_add','collection_remove','bookmarks'];
const communityTypes=['subscribed','purchases','tip','commented','mentioned','favorited','message','deactivated_media'];
const communityText=v=>typeof v==='string'?v.slice(0,10000):null;
const communityId=v=>v!=null&&/^[A-Za-z0-9_-]{1,100}$/.test(String(v))?String(v):null;
function communityAvatar(v){try{const u=new URL(v);return u.protocol==='https:'&&!u.username&&!u.password?u.href:null}catch{return null}}
function communityUser(x){return {id:communityId(x?.id),name:communityText(x?.name),username:communityText(x?.username),avatar:communityAvatar(x?.avatar)}}
export function communityList(x){return {id:communityId(x.id),name:communityText(x.name),type:communityText(x.type),usersCount:Number.isSafeInteger(x.usersCount)?x.usersCount:null,canUpdate:x.canUpdate===true,canAddUsers:x.canAddUsers===true,canManageUsers:x.canManageUsers===true,users:Array.isArray(x.users)?x.users.map(communityUser):[]}}
export function communityNormalize(op,x){
 const page={cursor:typeof x.cursor==='string'?x.cursor:null,hasMore:x.hasMore===true};
 if(op==='notifications'){if(!Array.isArray(x.notifications))throw Error('schema');return {...page,notifications:x.notifications.map(n=>({id:communityId(n.id),type:communityText(n.type),subType:communityText(n.subType),text:communityText(n.text),userId:Number.isSafeInteger(n.userId)?String(n.userId):null,name:communityText(n.name),username:communityText(n.username),avatar:communityAvatar(n.avatar),createdAt:communityText(n.createdAt),isRead:typeof n.isRead==='boolean'?n.isRead:null})).filter(n=>n.id)}}
 if(op==='collection_fans'){if(!Array.isArray(x.fans))throw Error('schema');return {...page,fans:x.fans.map(communityUser).filter(n=>n.id&&/^\d+$/.test(n.id))}}
 if(op==='collections'){if(!Array.isArray(x.lists))throw Error('schema');return {...page,lists:x.lists.map(communityList).filter(n=>n.id)}}
 if(op==='bookmarks'){if(!Array.isArray(x.posts))throw Error('schema');return {...page,posts:x.posts.map(n=>({id:communityId(n.id),text:communityText(n.text),postedAt:communityText(n.postedAt),author:communityUser(n.author),mediaCount:Array.isArray(n.media)?n.media.length:null})).filter(n=>n.id)}}
 return communityList(x);
}
export async function communityAction({input,binding,providerKey,fetcher,authorize,writeEnabled}){
 const op=input.operation,params=new URLSearchParams();
 if(input.cursor!=null){if(typeof input.cursor!=='string'||input.cursor.length>2048)throw Error('input');params.set('cursor',input.cursor)}
 if(input.query){if(typeof input.query!=='string'||input.query.length>150)throw Error('input');params.set('query',input.query)}
 if(input.type){if(!(op==='collection_fans'?['all','active','expired']:communityTypes).includes(input.type))throw Error('input');params.set('type',input.type)}
 if(op==='notifications'||op==='collections'||op==='collection_fans')params.set('pages','1');
 const call=async(path,method='GET',body)=>{const r=await fetcher('https://api.ofmapi.com/v1/accounts/'+binding+'/'+path,{method,headers:{Authorization:'Bearer '+providerKey,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(25000),redirect:'error'});if(!r.ok)throw Error('provider');return r.json()};
 let result;
 if(['notifications','collections','collection_fans','bookmarks'].includes(op))result=communityNormalize(op,await call((op==='collections'?'lists':op==='collection_fans'?'fans':op)+'?'+params));
 else{
  const id=communityId(input.list_id);if(op!=='collection_create'&&!id)throw Error('input');
  if(op==='collection_detail')result=communityNormalize(op,await call('lists/'+encodeURIComponent(id)));
  else{
   if(!writeEnabled)throw Error('access');
   const name=typeof input.name==='string'?input.name.trim():'';
   if(['collection_create','collection_rename'].includes(op)&&(!name||name.length>64))throw Error('input');
   if(op!=='collection_create'){
    const list=communityList(await call('lists/'+encodeURIComponent(id)));
    if(list.id!==id||!(op==='collection_rename'?list.canUpdate:op==='collection_add'?list.canAddUsers:list.canManageUsers))throw Error('access');
   }
   if(await authorize()!==binding)throw Error('access');
   if(op==='collection_create')result=communityList(await call('lists','POST',{name}));
   else if(op==='collection_rename')result=communityList(await call('lists/'+encodeURIComponent(id),'PATCH',{name}));
   else{
    const ids=op==='collection_add'&&input.user_ids!==undefined?input.user_ids:[input.user_id];
    if(!Array.isArray(ids)||!ids.length||ids.length>100||ids.some(id=>typeof id!=='string'||!/^\d+$/.test(id)||!Number.isSafeInteger(Number(id))||Number(id)<=0))throw Error('input');
    const fans=[...new Set(ids.map(Number))],fan=fans[0];
    const response=await call('lists/'+encodeURIComponent(id)+'/members'+(op==='collection_remove'?'/'+fan:''),op==='collection_remove'?'DELETE':'POST',op==='collection_add'?{userIds:fans}:undefined);
    if(response.success!==true)throw Error('provider');result={success:true};
   }
  }
 }
 if(await authorize()!==binding)throw Error('access');return result;
}
