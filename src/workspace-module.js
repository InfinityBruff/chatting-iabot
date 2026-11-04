export function canPreloadWorkspace(session,flow){
 return !flow&&typeof session?.access_token==='string'&&session.access_token.length>0&&typeof session?.user?.id==='string'&&session.user.id.length>0&&typeof session.user.email_confirmed_at==='string'&&session.user.email_confirmed_at.length>0;
}

// Preloading fetches static code only. The caller still owns authorization and
// rendering. A failed speculative import cannot poison the later lazy load.
export function createWorkspaceModule(importer){
 let shared=null,intent=null;
 function read(){
  if(shared)return shared;
  let attempt;try{attempt=Promise.resolve(importer())}catch(error){attempt=Promise.reject(error)}
  const current=attempt.catch(error=>{if(shared===current)shared=null;throw error});shared=current;return current;
 }
 return {
  preload:()=>read().catch(()=>undefined),
  load(){
   if(intent)return intent;
   const current=read().catch(()=>read()).finally(()=>{if(intent===current)intent=null});intent=current;return current;
  },
 };
}
