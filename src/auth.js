import { createClient } from '@supabase/supabase-js';
// Public browser configuration. Never place service-role or secret keys here.
export const authClient = createClient('https://lejxenmswcaddrnspxuf.supabase.co',
  'sb_publishable_Mf3v5e2otxlFF4YggnjAjQ_-_2Iwd9F', {
    auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: false },
  });
export async function loadMemberships(client = authClient) {
  const {data: identity, error: identityError} = await client.auth.getUser();
  if (identityError || !identity?.user?.email_confirmed_at) throw new Error('La sesión no es válida. Vuelve a iniciar sesión.');
  const {data, error} = await client.rpc('bruff_my_workspaces');
  if (error) throw new Error('Tu identidad está verificada, pero la consulta de permisos todavía no está disponible.');
  if (!Array.isArray(data) || data.some(w => !w || typeof w.id !== 'string' || typeof w.name !== 'string' || !['owner','admin','operator','viewer'].includes(w.role) || typeof w.globally_paused !== 'boolean')) throw new Error('No se pudieron verificar los permisos.');
  return data;
}
