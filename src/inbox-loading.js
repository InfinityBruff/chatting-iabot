export const INITIAL_CHAT_TARGET=120;
export function inboxNextPage({page,busy,error,seen,initialPages=0,nearEnd=false}){
 if(busy||error||!page?.hasMore||!page.cursor||seen.has(page.cursor))return null;
 return ((page.conversations?.length||0)<INITIAL_CHAT_TARGET&&initialPages<8)||nearEnd?page.cursor:null;
}
