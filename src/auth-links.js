// Supabase ConfirmationURL redirects to Site URL with an implicit session fragment.
// Tokens stay in memory; never log them or place them in application storage.
export function consumeAuthLink(location, history) {
  const url = new URL(location.href);
  const hash = new URLSearchParams(url.hash.slice(1));
  const keys = ['access_token','refresh_token','token_type','expires_in','expires_at','type','error','error_code','error_description','code','token_hash'];
  const present = keys.some(key => hash.has(key) || url.searchParams.has(key));
  if (!present) return null;
  const type = hash.get('type');
  const access_token = hash.get('access_token'), refresh_token = hash.get('refresh_token');
  const failed = hash.has('error') || url.searchParams.has('error');
  for (const key of keys) { hash.delete(key); url.searchParams.delete(key); }
  url.hash = hash.toString();
  history.replaceState(null, '', url.pathname + url.search + url.hash);
  if (failed || !['invite','recovery'].includes(type) || !access_token || !refresh_token) return {invalid:true};
  return {type, access_token, refresh_token};
}
export async function verifyAuthLink(link, client) {
  if (!link || link.invalid) throw new Error('El enlace no es válido o ha caducado. Solicita uno nuevo.');
  const {data,error} = await client.auth.setSession({access_token:link.access_token,refresh_token:link.refresh_token});
  if (error || !data?.session) throw new Error('El enlace no es válido o ha caducado. Solicita uno nuevo.');
  const {data:identity,error:identityError} = await client.auth.getUser();
  if (identityError || !identity?.user?.email_confirmed_at) throw new Error('No se pudo verificar el enlace. Solicita uno nuevo.');
  return {type:link.type, email:identity.user.email};
}
export function passwordError(password, confirmation) {
  if (password.length < 12) return 'Usa al menos 12 caracteres para tu nueva contraseña.';
  if (password.length > 128) return 'Usa como máximo 128 caracteres.';
  if (password !== confirmation) return 'Las contraseñas no coinciden.';
  return '';
}
export async function saveLinkPassword(client, password, confirmation) {
  const validation = passwordError(password, confirmation);
  if (validation) throw new Error(validation);
  const {data:identity,error:identityError} = await client.auth.getUser();
  if (identityError || !identity?.user?.email_confirmed_at) throw new Error('Tu enlace ha caducado. Solicita uno nuevo.');
  const {error} = await client.auth.updateUser({password});
  if (error) {
    if (error.code === 'same_password') throw new Error('Elige una contraseña diferente a la anterior.');
    if (error.code === 'weak_password') throw new Error('Supabase ha rechazado esta contraseña. Elige una más segura.');
    if (['reauthentication_needed','reauthentication_not_valid','current_password_missing','current_password_invalid'].includes(error.code)) throw new Error('El servicio requiere una verificación adicional. Solicita un enlace nuevo; si persiste, contacta con el administrador.');
    throw new Error('No se pudo guardar la contraseña. Comprueba tu conexión o solicita un enlace nuevo.');
  }
}
