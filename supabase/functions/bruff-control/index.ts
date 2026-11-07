import {createBruffControlHandler} from './handler.js';
import {createWorkerDispatch} from './worker-dispatch.js';

// Only this fixed wake-up uses the server credential. All reads and mutations
// in the control handler still carry the real owner's Supabase access token.
const url=Deno.env.get('SUPABASE_URL');
const dispatchJob=createWorkerDispatch({url,serviceKey:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')});
Deno.serve(createBruffControlHandler({
 url,
 anonKey:Deno.env.get('SUPABASE_ANON_KEY'),
 ownerActionsEnabled:Deno.env.get('BRUFF_CONTROL_OWNER_ACTIONS_ENABLED')==='true',
 autopilotEnabled:Deno.env.get('BRUFF_AI_AUTOPILOT_ENABLED')==='true',
 autopilotSendEnabled:Deno.env.get('BRUFF_AI_AUTOPILOT_SEND_ENABLED')==='true',
 autopilotRuntimeReady:Deno.env.get('BRUFF_AI_AUTOPILOT_RUNTIME_READY')==='true',
 dispatchJob,
 ...(Deno.env.get('BRUFF_CONTROL_ALLOWED_ORIGINS')?{allowedOrigins:Deno.env.get('BRUFF_CONTROL_ALLOWED_ORIGINS')!.split(',').map(value=>value.trim()).filter(Boolean)}:{}),
}));
