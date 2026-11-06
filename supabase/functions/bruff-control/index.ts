import {createBruffControlHandler} from './handler.js';

Deno.serve(createBruffControlHandler({
 url:Deno.env.get('SUPABASE_URL'),
 anonKey:Deno.env.get('SUPABASE_ANON_KEY'),
 ...(Deno.env.get('BRUFF_CONTROL_ALLOWED_ORIGINS')?{allowedOrigins:Deno.env.get('BRUFF_CONTROL_ALLOWED_ORIGINS')!.split(',').map(value=>value.trim()).filter(Boolean)}:{}),
}));
