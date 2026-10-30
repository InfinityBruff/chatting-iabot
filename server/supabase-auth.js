// Validate against the auth server; decoding a JWT is not authentication.
export function createSupabaseAuthenticator({ url, publishableKey, fetchImpl = fetch }) {
  const base = new URL(url);
  if (base.protocol !== 'https:' || base.username || base.password || base.pathname !== '/' || base.search || base.hash) {
    throw new Error('Se requiere el origen HTTPS del proyecto Supabase');
  }
  if (!publishableKey) throw new Error('Falta la clave publicable de Supabase');
  return async token => {
    let response;
    try {
      response = await fetchImpl(new URL('/auth/v1/user', base), {
        headers: { apikey: publishableKey, authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(8000), redirect: 'error',
      });
    } catch {
      throw Object.assign(new Error('Servicio de identidad no disponible'), { status: 503 });
    }
    if ([401, 403].includes(response.status)) return null;
    if (!response.ok) throw Object.assign(new Error('Servicio de identidad no disponible'), { status: 503 });
    const user = await response.json();
    return typeof user.id === 'string' && user.email_confirmed_at ? { id: user.id } : null;
  };
}
