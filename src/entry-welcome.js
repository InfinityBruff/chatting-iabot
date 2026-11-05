const text=value=>typeof value==='string'&&value.length>0;
export function confirmedLoginWelcome(data,{attempt,currentAttempt,currentActor,flow}={}){
 const actor=data?.user?.id,session=data?.session;
 if(flow||!Number.isSafeInteger(attempt)||attempt<1||attempt!==currentAttempt||!text(actor)||currentActor!==actor||session?.user?.id!==actor||!text(session.access_token)||!text(data.user.email_confirmed_at)||!text(session.user.email_confirmed_at))return null;
 return {actor,token:JSON.stringify([actor,attempt])};
}
export function matchesEntryWelcome(entry,token,actor){return !!entry&&entry.token===token&&entry.actor===actor}
export function entryWelcomeReady(entry,{actor,flow,error,workspaces,selected,automatic,committed}={}){
 if(!entry||entry.actor!==actor||flow)return false;
 if(error)return true;
 if(!Array.isArray(workspaces))return false;
 const target=workspaces.find(workspace=>workspace.id===selected)||workspaces.find(workspace=>workspace.id===automatic);
 if(!target)return true;
 return matchesEntryWelcome(entry,committed?.token,committed?.actor)&&committed.workspace===target.id;
}
