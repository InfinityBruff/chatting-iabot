import {createDraftsHandler} from './handler.js';
Deno.serve(createDraftsHandler({
 url:Deno.env.get('SUPABASE_URL'),anonKey:Deno.env.get('SUPABASE_ANON_KEY'),
 serviceKey:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
 cloudflareAccountId:Deno.env.get('CLOUDFLARE_ACCOUNT_ID'),
 cloudflareToken:Deno.env.get('CLOUDFLARE_WORKERS_AI_TOKEN'),
 freeTierConfirmed:Deno.env.get('BRUFF_AI_FREE_TIER_CONFIRMED')==='true',
}));
