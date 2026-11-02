import {createLiveHandler} from './handler.js';
Deno.serve(createLiveHandler({url:Deno.env.get('SUPABASE_URL'),anonKey:Deno.env.get('SUPABASE_ANON_KEY'),serviceKey:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),providerKey:Deno.env.get('OFMAPI_API_KEY'),advancedWriteEnabled:Deno.env.get('BRUFF_ADVANCED_SEND_ENABLED')==='true',writeEnabled:Deno.env.get('BRUFF_MANUAL_SEND_ENABLED')==='true'}));
