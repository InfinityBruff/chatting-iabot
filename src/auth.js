import { createClient } from '@supabase/supabase-js';
// Public browser configuration. Never place service-role or secret keys here.
export const authClient = createClient('https://lejxenmswcaddrnspxuf.supabase.co',
  'sb_publishable_Mf3v5e2otxlFF4YggnjAjQ_-_2Iwd9F', {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
export async function loadMemberships(client = authClient) {
  const {data: identity, error: identityError} = await client.auth.getUser();
  if (identityError) {const status=Number(identityError.status)||503;throw Object.assign(new Error([401,403].includes(status)?'La sesión no es válida. Vuelve a iniciar sesión.':'No se pudo verificar tu sesión. El servidor no responde. Se reintentará automáticamente.'),{status});}
  if (!identity?.user?.email_confirmed_at) throw Object.assign(new Error('La sesión no es válida. Vuelve a iniciar sesión.'),{status:401});
  const {data, error, status} = await client.rpc('bruff_my_workspaces');
  if (error) {const failureStatus=Number(status)||Number(error.status)||503;throw Object.assign(new Error([401,403].includes(failureStatus)?'No se pudo autorizar la consulta de permisos. Vuelve a iniciar sesión.':'No se pudo completar la consulta de permisos. El servidor no responde. Se reintentará automáticamente.'),{status:failureStatus});}
  if (!Array.isArray(data) || data.some(w => !w || typeof w.id !== 'string' || typeof w.name !== 'string' || !['owner','admin','operator','viewer'].includes(w.role) || typeof w.globally_paused !== 'boolean')) throw Object.assign(new Error('No se pudieron verificar los permisos.'),{status:503});
  return data;
}
