// Memory only: signed media and chat content never enter persistent storage here.
const pages=new Map();let owner=null,epoch=0;
export function setPageCacheOwner(user){if(user!==owner){owner=user;epoch++;pages.clear()}}
export function clearPageCache(){epoch++;pages.clear()}
export function pageCacheEpoch(){return epoch}
export function readPageCache(key,now=Date.now()){const item=pages.get(key);if(!owner||!item)return null;if(now-item.at>120000){pages.delete(key);return null}pages.delete(key);pages.set(key,item);return item.value}
export function writePageCache(key,value,expectedEpoch=epoch,now=Date.now()){if(!owner||epoch!==expectedEpoch||!value)return;pages.delete(key);pages.set(key,{value,at:now});while(pages.size>24)pages.delete(pages.keys().next().value)}
