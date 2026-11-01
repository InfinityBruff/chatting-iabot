// Keep the server's screening and idempotent ticket, without a second UI confirmation.
export async function sendManualMessage({request,draft,pending,onPrepared}){
 const prepared=pending||(await request('prepare_send',draft)).data;
 if(!prepared?.ticket)throw Error('No se pudo preparar el mensaje.');
 onPrepared(prepared);
 return request('send_message',{creator_id:draft.creator_id,ticket:prepared.ticket});
}
