import {useEffect} from 'react';
import {startInboxWarmup} from '../inbox-warmup.js';
import {readPageCache,writePageCache,pageCacheEpoch,clearPageCache} from '../live-page-cache.js';
import {liveRequest} from './LiveData.jsx';
export function useInboxWarmup(workspace,accounts,current,enabled){
 const signature=JSON.stringify(accounts.filter(a=>a.chat).map(a=>({id:a.id,chat:true})));
 useEffect(()=>{if(!enabled)return;return startInboxWarmup({workspace,accounts:JSON.parse(signature),current,request:liveRequest,readCache:readPageCache,writeCache:writePageCache,epoch:pageCacheEpoch(),cacheEpoch:pageCacheEpoch,onDenied:clearPageCache})},[workspace,signature,current,enabled]);
}
