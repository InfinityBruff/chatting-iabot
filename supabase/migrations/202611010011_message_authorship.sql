begin;
create table bruff_private.message_authorship (
 workspace_id uuid not null,creator_id uuid not null,fan_id text not null check(fan_id ~ '^[0-9]{1,24}$'),
 request_id uuid not null,actor_id uuid not null,actor_name text not null,
 message_id text check(message_id ~ '^[0-9]{1,24}$'),created_at timestamptz not null default now(),
 primary key(workspace_id,creator_id,request_id),unique(workspace_id,creator_id,fan_id,message_id),
 foreign key(workspace_id,creator_id) references bruff_private.creator_accounts(workspace_id,id),
 foreign key(workspace_id,actor_id) references bruff_private.memberships(workspace_id,user_id)
);
alter table bruff_private.message_authorship enable row level security;
revoke all on bruff_private.message_authorship from public,anon,authenticated;
create function public.bruff_message_begin(w uuid,c uuid,fan text,request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare n text; a bruff_private.message_authorship;
begin
 perform 1 from bruff_private.workspaces where id=w for update;
 if fan is null or fan !~ '^[0-9]{1,24}$' or request_id is null or not bruff_private.can_access(w,c,'send')
 or not exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null)
 then raise exception 'Acceso no permitido' using errcode='42501'; end if;
 select coalesce(nullif(btrim(display_name),''),case when role='owner' then 'Propietario' else 'Trabajador sin nombre' end) into n
 from bruff_private.memberships where workspace_id=w and user_id=auth.uid();
 insert into bruff_private.message_authorship(workspace_id,creator_id,fan_id,request_id,actor_id,actor_name)
 values(w,c,fan,request_id,auth.uid(),n) on conflict do nothing;
 select * into a from bruff_private.message_authorship m where m.workspace_id=w and m.creator_id=c and m.request_id=bruff_message_begin.request_id;
 if a.actor_id is distinct from auth.uid() or a.fan_id is distinct from fan then raise exception 'Envío ajeno' using errcode='42501'; end if;
 return jsonb_build_object('name',a.actor_name,'messageId',a.message_id);
end $$;
-- Only the server can associate an actual provider message ID with an actor.
create function public.bruff_message_finish(w uuid,c uuid,fan text,request_id uuid,actor uuid,message_id text) returns void
language plpgsql security definer set search_path='' as $$
declare a bruff_private.message_authorship;
begin
 if message_id is null or message_id !~ '^[0-9]{1,24}$' then raise exception 'Mensaje inválido'; end if;
 select * into a from bruff_private.message_authorship m where m.workspace_id=w and m.creator_id=c and m.request_id=bruff_message_finish.request_id for update;
 if not found or a.actor_id is distinct from actor or a.fan_id is distinct from fan or (a.message_id is not null and a.message_id<>bruff_message_finish.message_id)
 then raise exception 'Envío ajeno' using errcode='42501'; end if;
 update bruff_private.message_authorship m set message_id=bruff_message_finish.message_id
 where m.workspace_id=w and m.creator_id=c and m.request_id=bruff_message_finish.request_id;
end $$;
create function public.bruff_message_authors(w uuid,c uuid,fan text,ids text[]) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if fan is null or fan !~ '^[0-9]{1,24}$' or ids is null or cardinality(ids)>500 or not bruff_private.can_access(w,c,'read')
 or not exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null)
 then raise exception 'Acceso no permitido' using errcode='42501'; end if;
 return coalesce((select jsonb_object_agg(m.message_id,m.actor_name) from bruff_private.message_authorship m
 where m.workspace_id=w and m.creator_id=c and m.fan_id=fan and m.message_id=any(ids)),'{}'::jsonb);
end $$;
revoke all on function public.bruff_message_begin(uuid,uuid,text,uuid),public.bruff_message_authors(uuid,uuid,text,text[]) from public,anon;
grant execute on function public.bruff_message_begin(uuid,uuid,text,uuid),public.bruff_message_authors(uuid,uuid,text,text[]) to authenticated;
revoke all on function public.bruff_message_finish(uuid,uuid,text,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.bruff_message_finish(uuid,uuid,text,uuid,uuid,text) to service_role;
commit;
