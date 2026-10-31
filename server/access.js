// Server boundary policy. Memberships and grants must come from trusted DB queries,
// never request bodies or the existing demo's localStorage.
const permissions=new Set(['read','notes','drafts','send','settings','analytics','vault']);
export function canAccessAccount({userId,workspaceId,creatorId,permission,memberships,accounts,grants}){
 if(!userId||!workspaceId||!creatorId||!permissions.has(permission))return false;
 const member=memberships.find(m=>m.workspaceId===workspaceId&&m.userId===userId&&m.status==='active');
 if(!member||!accounts.some(a=>a.workspaceId===workspaceId&&a.id===creatorId))return false;
 if(['owner','admin'].includes(member.role))return true;
 if(member.role==='operator'&&!['read','drafts','send'].includes(permission))return false;
 if(member.role==='viewer'&&permission!=='analytics')return false;
 if(!['operator','viewer'].includes(member.role))return false;
 return grants.some(g=>g.workspaceId===workspaceId&&g.creatorId===creatorId&&g.userId===userId&&g.permission===permission);
}
export function requireAccountAccess(context){if(!canAccessAccount(context)){const error=new Error('Acceso no autorizado a esta cuenta');error.status=403;throw error}}
export function requireConnectedProvider(account,provider){if(account.connectionStatus!=='connected'||!account.externalId||account.provider!==provider.id){const error=new Error('Cuenta sin conexión verificada');error.status=409;throw error}}
