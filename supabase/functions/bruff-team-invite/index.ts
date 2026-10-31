import {createTeamInviteHandler} from './handler.js';
Deno.serve(createTeamInviteHandler({
 url:Deno.env.get('SUPABASE_URL'),
 anonKey:Deno.env.get('SUPABASE_ANON_KEY'),
 serviceKey:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
}));
