import {createLiveHandler} from './handler.js';
Deno.serve(createLiveHandler({url:Deno.env.get('SUPABASE_URL'),anonKey:Deno.env.get('SUPABASE_ANON_KEY'),providerKey:Deno.env.get('OFMAPI_API_KEY')}));
