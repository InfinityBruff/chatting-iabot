// Memory only: signed media and chat content never enter persistent storage here.
import {createInboxProfileStore} from './inbox-profile-store.js';
const pages=new Map(),details=new Map();let owner=null,epoch=0;
const profiles=()=>{try{return createInboxProfileStore(localStorage)}catch{return null}};
export function setPageCacheOwner(user){if(user!==owner){if(owner)profiles()?.clear(owner);owner=user;epoch++;pages.clear();details.clear()}}
export function clearPageCache(){epoch++;pages.clear();details.clear();if(owner)profiles()?.clear(owner)}
export function pageCacheEpoch(){return epoch}
export function readPageCache(key,now=Date.now()){if(!owner)return null;const item=pages.get(key);if(!item)return profiles()?.read(owner,key)||null;if(now-item.at>900000){pages.delete(key);return profiles()?.read(owner,key)||null}pages.delete(key);pages.set(key,item);return item.value}
export function writePageCache(key,value,expectedEpoch=epoch,now=Date.now()){if(!owner||epoch!==expectedEpoch||!value)return;const bytes=JSON.stringify(value).length*2;if(bytes>2097152)return;pages.delete(key);pages.set(key,{value,at:now,bytes});let total=[...pages.values()].reduce((n,row)=>n+row.bytes,0);while(pages.size>64||total>16777216){const oldest=pages.keys().next().value;total-=pages.get(oldest).bytes;pages.delete(oldest)}profiles()?.write(owner,key,value)}
export function readDetailCache(key,now=Date.now()){const item=details.get(key);if(!owner||!item)return null;if(now-item.at>120000){details.delete(key);return null}details.delete(key);details.set(key,item);return item.value}
export function writeDetailCache(key,value,expectedEpoch=epoch,now=Date.now()){if(!owner||epoch!==expectedEpoch||!value)return;const bytes=JSON.stringify(value).length;if(bytes>262144)return;details.delete(key);details.set(key,{value,at:now,bytes});let total=[...details.values()].reduce((n,row)=>n+row.bytes,0);while(details.size>96||total>2097152){const oldest=details.keys().next().value;total-=details.get(oldest).bytes;details.delete(oldest)}}
