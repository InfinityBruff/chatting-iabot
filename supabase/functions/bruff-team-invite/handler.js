const origins = new Set(['https://bruff-workspace.pages.dev','https://chatting-iabot-raul.infinitybruff.chatgpt.site']);
export function createTeamInviteHandler({url,anonKey,serviceKey,fetcher=fetch}) {
 return async request => {
  const origin=request.headers.get('origin');
  const headers={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin',...(origins.has(origin)?{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS'}:{})};
  const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers});
  if(origin&&!origins.has(origin))return reply(403,{error:'Origen no permitido'});
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(request.method!=='POST')return reply(405,{error:'Método no permitido'});
  if(!url||!anonKey||!serviceKey)return reply(503,{error:'Servicio de invitaciones no configurado'});
  const authorization=request.headers.get('authorization')||'';
  if(!/^Bearer \S+$/.test(authorization))return reply(401,{error:'Inicia sesión de nuevo'});
  const call=async(path,body,privileged=false)=>{
   const response=await fetcher(url+path,{method:body===undefined?'GET':'POST',headers:{apikey:privileged?serviceKey:anonKey,Authorization:privileged?'Bearer '+serviceKey:authorization,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});
   const data=await response.json().catch(()=>null);return {ok:response.ok,data};
  };
  try {
   const identity=await call('/auth/v1/user');
   if(!identity.ok||!identity.data?.id||!identity.data.email_confirmed_at)return reply(401,{error:'Sesión no válida'});
   let raw=''; const reader=request.body?.getReader(); if(!reader)return reply(400,{error:'Faltan los datos'});
   let size=0;const decoder=new TextDecoder();
   try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>24000){await reader.cancel();return reply(413,{error:'Solicitud demasiado grande'})}raw+=decoder.decode(value,{stream:true})}raw+=decoder.decode();}finally{reader.releaseLock()}
   let input;try{input=JSON.parse(raw)}catch{return reply(400,{error:'Solicitud no válida'})}
   if(!input||Array.isArray(input)||Object.keys(input).some(k=>!['workspace_id','email','role','grants'].includes(k))||typeof input.workspace_id!=='string'||typeof input.email!=='string'||!['admin','operator','viewer'].includes(input.role)||!Array.isArray(input.grants))return reply(400,{error:'Datos de invitación no válidos'});
   // Owner check, model scope, rate limit and pending-ticket uniqueness are transactional in SQL.
   const prepared=await call('/rest/v1/rpc/bruff_team_prepare_invite',{w:input.workspace_id,email_address:input.email,r:input.role,g:input.grants});
   if(!prepared.ok)return reply(403,{error:'No se pudo preparar la invitación. Comprueba tus permisos, el correo, las modelos y las invitaciones pendientes. Espera un minuto entre invitaciones.'});
   const ticket=prepared.data;
   let target=ticket.existing_user, result='existing';
   if(!target){
    let invited;
    try{invited=await call('/auth/v1/invite',{email:ticket.email},true)}catch{return reply(502,{error:'No se pudo confirmar el envío. Revisa la invitación pendiente antes de volver a intentar.'})}
    if(!invited.ok){await call('/rest/v1/rpc/bruff_team_finish_invite',{ticket:ticket.id,target:null,result_status:'failed'},true);return reply(502,{error:'Supabase no pudo enviar la invitación. Revisa SMTP o espera antes de intentarlo de nuevo.'})}
    target=invited.data?.id; result='sent';
   }
   const finished=await call('/rest/v1/rpc/bruff_team_finish_invite',{ticket:ticket.id,target,result_status:result},true);
   if(!finished.ok)return reply(409,{error:'La cuenta existe, pero la asignación de permisos no se completó. Revisa o cancela la invitación pendiente; no se ha concedido acceso nuevo.'});
   return reply(200,{status:result,message:result==='sent'?'Invitación enviada. Pendiente de que el trabajador confirme su correo.':'Acceso asignado a una cuenta existente. No se ha enviado correo; puede iniciar sesión con su contraseña habitual.'});
  }catch{return reply(503,{error:'No se pudo completar la operación. Revisa el equipo antes de repetirla.'})}
 };
}
