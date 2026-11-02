// Memory only: signed media and chat content never enter persistent storage here.
const pages=new Map(),details=new Map();let owner=null,epoch=0;
export function setPageCacheOwner(user){if(user!==owner){owner=user;clearPageCache()}}
export function clearPageCache(){epoch++;pages.clear();details.clear()}
export function pageCacheEpoch(){return epoch}
export function readPageCache(key,now=Date.now()){const item=pages.get(key);if(!owner||!item)return null;if(now-item.at>120000){pages.delete(key);return null}pages.delete(key);pages.set(key,item);return item.value}
export function writePageCache(key,value,expectedEpoch=epoch,now=Date.now()){if(!owner||epoch!==expectedEpoch||!value)return;pages.delete(key);pages.set(key,{value,at:now});while(pages.size>24)pages.delete(pages.keys().next().value)}
export function readDetailCache(key,now=Date.now()){const item=details.get(key);if(!owner||!item)return null;if(now-item.at>120000){details.delete(key);return null}details.delete(key);details.set(key,item);return item.value}
export function writeDetailCache(key,value,expectedEpoch=epoch,now=Date.now()){if(!owner||epoch!==expectedEpoch||!value)return;const bytes=JSON.stringify(value).length;if(bytes>262144)return;details.delete(key);details.set(key,{value,at:now,bytes});let total=[...details.values()].reduce((n,row)=>n+row.bytes,0);while(details.size>96||total>2097152){const oldest=details.keys().next().value;total-=details.get(oldest).bytes;details.delete(oldest)}}
