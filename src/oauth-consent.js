const id=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{8,200}$/u.test(value);
export function authorizationId(search){const values=new URLSearchParams(search).getAll('authorization_id');return values.length===1&&id(values[0])?values[0]:null}
// Restrict this consent surface to the OpenAI callback formats documented for
// ChatGPT. The Auth server still verifies registration, state and PKCE.
export function chatgptCallback(value){
 if(typeof value!=='string')return null;
 try{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.port||u.hash||u.hostname!=='chatgpt.com')return null;
  if(u.pathname!=='/connector_platform_oauth_redirect'&&!/^\/connector\/oauth\/[A-Za-z0-9_-]+$/u.test(u.pathname))return null;
  return u;
 }catch{return null}
}
export function consentDetails(data,{authorization,actor}){
 if(!id(authorization)||typeof actor!=='string'||!actor)throw Error('Solicitud de conexión no válida.');
 if(!data||data.authorization_id!==authorization||data.user?.id!==actor||!id(data.client?.id)||typeof data.client?.name!=='string'||!data.client.name.trim()||data.client.name.length>200||typeof data.scope!=='string'||data.scope.length>200)throw Error('No se pudo verificar la solicitud de conexión.');
 const callback=chatgptCallback(data.redirect_uri),scopes=data.scope.trim()?data.scope.trim().split(/\s+/u):[];
 if(!callback||callback.search||scopes.some(scope=>!['openid','email','profile','offline_access'].includes(scope)))throw Error('La solicitud utiliza un destino o permisos que BRUFF no reconoce.');
 return {authorization,clientId:data.client.id,clientName:data.client.name,redirectUri:callback.href,scopes:[...new Set(scopes)]};
}
