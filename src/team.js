export const teamRoles={owner:'Propietario',admin:'Manager',operator:'Chatter',viewer:'Analista'};
export const teamPermissions={read:'Consultar',notes:'Editar notas',drafts:'Preparar borradores',send:'Enviar mensajes',settings:'Configurar BRUFF'};
export function toggleTeamGrant(grants,creator_id,permission,checked,role){
 if(role==='admin'||role==='owner')return [];
 if(role==='viewer'&&permission!=='read')return grants;
 let next=grants.filter(g=>!(g.creator_id===creator_id&&(g.permission===permission||(!checked&&permission==='read'))));
 if(checked){next.push({creator_id,permission});if(permission!=='read'&&!next.some(g=>g.creator_id===creator_id&&g.permission==='read'))next.push({creator_id,permission:'read'})}
 return next;
}
export function grantsForRole(grants,role){return role==='admin'?[]:role==='viewer'?grants.filter(g=>g.permission==='read'):grants;}
export const permissionDescriptions={read:'Ver los datos disponibles de esta modelo: fans, conversaciones y contenido cuando estén conectados.',notes:'Crear y modificar notas sobre los fans de esta modelo.',drafts:'Preparar propuestas de mensajes sin enviarlas.',send:'Enviar mensajes cuando la conexión real de envío esté habilitada.',settings:'Cambiar el comportamiento y los ajustes de BRUFF para esta modelo.'};
export function bulkTeamGrant(grants,ids,permission,checked,role){
 return [...new Set(ids)].reduce((result,id)=>toggleTeamGrant(result,id,permission,checked,role),grants);
}
export function grantCoverage(grants,ids,permission){
 const unique=[...new Set(ids)], count=unique.filter(id=>grants.some(g=>g.creator_id===id&&g.permission===permission)).length;
 return {count,total:unique.length,all:unique.length>0&&count===unique.length,mixed:count>0&&count<unique.length};
}
