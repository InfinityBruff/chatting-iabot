export function messageAttribution(message){
 if(message.isFromMe!==true)return '';
 if(message.attributionAvailable!==true)return 'Autoría no disponible';
 return typeof message.sentBy==='string'&&message.sentBy.trim()?'Enviado por: '+message.sentBy:'by: onlyfans';
}
