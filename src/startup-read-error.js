const readMessages={accounts:'No se pudieron cargar las modelos. El servidor no responde. Se reintentará automáticamente.',inbox:'No se pudo cargar la lista de chats. El servidor no responde. Se reintentará automáticamente.',messages:'No se pudo cargar el historial. El servidor no responde. Se reintentará automáticamente.'};
export function startupReadError(operation,payload,status){
 if(readMessages[operation]&&(status===503||!status||payload?.code==='READ_UNAVAILABLE'))return readMessages[operation];
 return payload?.error||'No se pudieron consultar los datos reales.';
}
