export const INITIAL_CHAT_TARGET=40;
export function inboxNextPage({page,busy,error,seen,initialPages=0,nearEnd=false,pageQueued=false,requestCursor}){
 if(error||!page?.hasMore||!page.cursor||seen.has(page.cursor))return null;
 // A scroll can promote the SAME queued preload. It never creates another
 // cursor request while a provider read or an unrelated operation is busy.
 if(busy&&!(nearEnd&&pageQueued&&requestCursor===page.cursor))return null;
 return ((page.conversations?.filter(f=>!f.profileSnapshot).length||0)<INITIAL_CHAT_TARGET&&initialPages<8)||nearEnd?page.cursor:null;
}
