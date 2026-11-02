begin;
-- Complete agency manifest. Never silently omit disconnected or inaccessible models.
create function public.bruff_financial_sources(w uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not exists(select 1 from bruff_private.memberships m join auth.users u on u.id=m.user_id where m.workspace_id=w and m.user_id=auth.uid() and m.status='active' and m.role in ('owner','admin') and u.email_confirmed_at is not null) then raise exception 'Acceso no permitido' using errcode='42501';end if;
 if not exists(select 1 from bruff_private.creator_accounts where workspace_id=w) or exists(select 1 from bruff_private.creator_accounts c where c.workspace_id=w and (c.provider is distinct from 'ofmapi' or c.connection_status is distinct from 'connected' or c.external_id is null or not bruff_private.can_access(w,c.id,'analytics'))) then raise exception 'Se necesita histórico verificable de todas las modelos de la agencia';end if;
 select jsonb_agg(jsonb_build_object('id',id,'binding',external_id) order by id) into result from bruff_private.creator_accounts where workspace_id=w;
 return result;
end;$$;
revoke all on function public.bruff_financial_sources(uuid) from public,anon;
grant execute on function public.bruff_financial_sources(uuid) to authenticated;

create or replace function public.bruff_prepare_mass(w uuid,c uuid,d uuid,v bigint,actor uuid,binding_id text,recipients jsonb,plan jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare cfg jsonb;r bruff_private.advanced_runs;msg jsonb;
begin
 perform 1 from bruff_private.workspaces where id=w for update;
 if not exists(select 1 from bruff_private.memberships m join auth.users u on u.id=m.user_id where m.workspace_id=w and m.user_id=actor and m.status='active' and m.role in ('owner','admin') and u.email_confirmed_at is not null) then raise exception 'Acceso no permitido' using errcode='42501';end if;
 if not exists(select 1 from bruff_private.creator_accounts where workspace_id=w and id=c and provider='ofmapi' and external_id=binding_id and connection_status='connected') then raise exception 'Conexión modificada';end if;
 select config into cfg from bruff_private.auto_message_drafts where id=d and workspace_id=w and creator_id=c and version=v and not archived for update;
 if cfg is null then raise exception 'Borrador modificado';end if;
 if cfg->>'trigger'<>'mass' or cfg->>'action'<>'message' or jsonb_array_length(cfg->'messages')<>1 then raise exception 'Esta preparación corresponde a un masivo de un mensaje';end if;
 if (cfg->'resend'->>'enabled')::boolean or (cfg->>'startAiOnReply')::boolean or exists(select 1 from jsonb_each(cfg->'audience') x where x.key not in ('excludeLists','modelSpend','buyingPower','agencySpend','modelPurchase','agencyPurchase') and x.value->>'enabled'='true') then raise exception 'La campaña contiene opciones todavía no conectadas al ejecutor';end if;
 msg=cfg->'messages'->0;
 if (select count(distinct x->>'slot') from jsonb_array_elements(msg->'media')x)>1 or ((msg->>'paidText')::boolean and exists(select 1 from jsonb_array_elements(msg->'media')x where x->>'slot'='free')) then raise exception 'La combinación de contenido gratuito y bloqueado no está confirmada por el proveedor';end if;
 if recipients is null or jsonb_typeof(recipients)<>'array' or jsonb_array_length(recipients) not between 1 and 100000 or exists(select 1 from jsonb_array_elements(recipients)x where jsonb_typeof(x)<>'string' or x#>>'{}' !~ '^[1-9][0-9]{0,23}$') or (select count(distinct x) from jsonb_array_elements_text(recipients)x)<>jsonb_array_length(recipients) then raise exception 'Destinatarios no verificables';end if;
 if plan is null or jsonb_typeof(plan)<>'object' or not (plan ?& array['cycles','startAt','endsAt','intervalMs','missedPolicy']) or jsonb_typeof(plan->'cycles') is distinct from 'number' or jsonb_typeof(plan->'startAt') is distinct from 'string' or jsonb_typeof(plan->'endsAt') is distinct from 'string' or (plan->>'cycles')::int not between 1 and 8760 or (plan->>'endsAt')::timestamptz<=(plan->>'startAt')::timestamptz or (plan->>'endsAt')::timestamptz<=now() or (plan->>'missedPolicy') is distinct from 'skip' then raise exception 'Programación inválida';end if;
 select * into r from bruff_private.advanced_runs where draft_id=d and draft_version=v and execution_plan is not null;
 if r.id is not null then
  if r.state='paused' and r.activated_at is null then
   update bruff_private.advanced_runs set audience_ids=recipients,binding=binding_id,execution_plan=plan,prepared_at=now(),ends_at=(plan->>'endsAt')::timestamptz,revision=revision+1 where id=r.id returning * into r;
  end if;
  return jsonb_build_object('id',r.id,'state',r.state,'prepared',r.activated_at is null,'alreadyExists',true,'revision',r.revision,'count',jsonb_array_length(r.audience_ids));
 end if;
 insert into bruff_private.advanced_runs(workspace_id,creator_id,draft_id,draft_version,activated_by,state,ends_at,binding,audience_ids,execution_plan,prepared_at)
 values(w,c,d,v,actor,'paused',(plan->>'endsAt')::timestamptz,binding_id,recipients,plan,now()) returning * into r;
 return jsonb_build_object('id',r.id,'state','paused','prepared',true,'count',jsonb_array_length(recipients));
end;$$;
commit;
