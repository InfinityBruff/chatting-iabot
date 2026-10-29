export function scopedRecipients(fans,creatorId,ids){const allowed=new Set(fans.filter(f=>f.creatorId===creatorId).map(f=>f.id));return [...new Set(ids)].filter(id=>allowed.has(id));}
export function saveCampaign(state,creatorId,input,editingId=null,now=new Date().toISOString()){
 const existing=editingId===null?null:state.campaigns.find(c=>c.id===editingId&&c.creatorId===creatorId);
 if(editingId!==null&&!existing)throw new Error('El borrador ya no está disponible en esta cuenta.');
 const name=typeof input.name==='string'?input.name.trim():'',text=typeof input.text==='string'?input.text.trim():'';
 if(!name||name.length>100||!text||text.length>3000)throw new Error('Revisa el nombre y el mensaje de la campaña.');
 if(!['all','online','selected'].includes(input.audience))throw new Error('Selecciona una audiencia válida.');
 const recipientIds=scopedRecipients(state.fans,creatorId,Array.isArray(input.recipientIds)?input.recipientIds:[]);
 if(!recipientIds.length)throw new Error('Selecciona al menos un fan de esta cuenta.');
 const campaign={...(existing||{}),id:existing?.id??crypto.randomUUID(),creatorId,name,text,audience:input.audience,recipientIds,createdAt:existing?.createdAt??now,updatedAt:now};
 return {...state,campaigns:existing?state.campaigns.map(c=>c===existing?campaign:c):[campaign,...state.campaigns]};
}
