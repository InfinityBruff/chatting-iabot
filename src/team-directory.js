export function memberAccess(member,accounts,grants){
 if(member.status==='disabled')return [];
 if(['owner','admin'].includes(member.role))return accounts;
 const permission=member.role==='viewer'?'analytics':'read';
 return accounts.filter(a=>grants.some(g=>g.user_id===member.user_id&&g.creator_id===a.id&&g.permission===permission));
}
export function filterMembers(members,{query='',status='active',role='all'}={}){
 const term=query.trim().toLocaleLowerCase('es');
 return members.filter(m=>(status==='all'||(status==='removed'?m.status==='disabled':m.status!=='disabled'))&&(role==='all'||m.role===role)&&(!term||[m.display_name,m.email].some(v=>(v||'').toLocaleLowerCase('es').includes(term))));
}
export function removalArgs(workspace,member,currentUserId){
 if(member.role==='owner'||member.user_id===currentUserId)throw Error('El propietario y tu propia cuenta están protegidos.');
 return {w:workspace,target:member.user_id,r:member.role,s:'disabled',g:[],expected_version:member.version,display_name:(member.display_name||member.email.split('@')[0]).slice(0,80)};
}
