begin;
-- Existing read coordination only, in one server round trip for a cold chat open.
create function public.bruff_message_read_turn(lease_id uuid,priority text default 'foreground') returns jsonb
language plpgsql volatile security invoker set search_path='' as $$
declare slot_state jsonb; gate_state jsonb;
begin
 slot_state=public.bruff_provider_read_slot('acquire',lease_id,priority);
 if jsonb_typeof(slot_state->'allowed') is distinct from 'boolean' then raise exception 'Turno de lectura inválido';end if;
 if (slot_state->>'allowed')::boolean=false then return slot_state;end if;
 gate_state=public.bruff_provider_read_gate('check',0);
 if jsonb_typeof(gate_state->'allowed') is distinct from 'boolean' then raise exception 'Espera de lectura inválida';end if;
 if (gate_state->>'allowed')::boolean=false then
  if jsonb_typeof(gate_state->'retryAfter') is distinct from 'number' or (gate_state->>'retryAfter')::integer<1 then raise exception 'Espera de lectura inválida';end if;
  perform public.bruff_provider_read_slot('release',(slot_state->>'lease')::uuid,priority);
  return jsonb_build_object('allowed',false,'cooldown',true,'retryAfter',(gate_state->>'retryAfter')::integer);
 end if;
 return slot_state||jsonb_build_object('gateChecked',true);
end $$;
revoke all on function public.bruff_message_read_turn(uuid,text) from public,anon,authenticated;
grant execute on function public.bruff_message_read_turn(uuid,text) to service_role;
commit;
