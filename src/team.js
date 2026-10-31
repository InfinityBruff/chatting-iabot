export const teamRoles={owner:'Propietario',admin:'Manager',operator:'Chatter',viewer:'Analista'};
export const teamPermissions={read:'Leer chats',notes:'Editar notas',drafts:'Preparar borradores',send:'Enviar mensajes',settings:'Configurar BRUFF',analytics:'Ver analíticas y ganancias',vault:'Gestionar Vault'};
export function toggleTeamGrant(grants,creator_id,permission,checked,role){
 if(role==='admin'||role==='owner')return [];
 if(!editablePermissions(role).includes(permission))return grants;
 let next=grants.filter(g=>!(g.creator_id===creator_id&&(g.permission===permission||(!checked&&permission==='read'))));
 if(checked){next.push({creator_id,permission});if(['notes','drafts','send'].includes(permission)&&!next.some(g=>g.creator_id===creator_id&&g.permission==='read'))next.push({creator_id,permission:'read'})}
 return next;
}
export function grantsForRole(grants,role){return role==='admin'?[]:grants.filter(g=>editablePermissions(role).includes(g.permission));}
export const permissionDescriptions={read:'Leer las conversaciones de la modelo asignada. No incluye notas, Vault ni analíticas.',notes:'Crear y modificar notas sobre los fans de esta modelo.',drafts:'Preparar propuestas de mensajes sin enviarlas.',send:'Enviar mensajes cuando la conexión real de envío esté habilitada.',settings:'Configurar BRUFF para esta modelo; no incluye ajustes del sistema.',analytics:'Ver informes, métricas e ingresos de la modelo asignada, sin acceder a chats ni notas.',vault:'Consultar y organizar contenido de la modelo cuando esté conectado.'};
export function bulkTeamGrant(grants,ids,permission,checked,role){
 return [...new Set(ids)].reduce((result,id)=>toggleTeamGrant(result,id,permission,checked,role),grants);
}
export function grantCoverage(grants,ids,permission){
 const unique=[...new Set(ids)], count=unique.filter(id=>grants.some(g=>g.creator_id===id&&g.permission===permission)).length;
 return {count,total:unique.length,all:unique.length>0&&count===unique.length,mixed:count>0&&count<unique.length};
}

export function editablePermissions(role){return role==='operator'?['read','drafts','send']:role==='viewer'?['analytics']:[];}
