begin;
create table bruff_private.fan_custom_names(
 workspace_id uuid not null,
 creator_id uuid not null,
 fan_id text not null check(fan_id ~ '^[0-9]{1,24}$'),
 custom_name text not null check(length(custom_name)<=80),
 version bigint not null default 1,
 updated_at timestamptz not null default now(),
 updated_by uuid not null references auth.users(id),
 primary key(workspace_id,creator_id,fan_id),
 foreign key(workspace_id,creator_id) references bruff_private.creator_accounts(workspace_id,id)
);
alter table bruff_private.fan_custom_names enable row level security;
revoke all on bruff_private.fan_custom_names from public,anon,authenticated;
create function public.bruff_fan_names(w uuid,c uuid,fan text default null,value text default null,expected bigint default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare n bruff_private.fan_custom_names;
begin
 perform 1 from bruff_private.workspaces where id=w for update;
 if not bruff_private.can_access(w,c,'read') or not exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null)
 then raise exception 'Acceso no permitido' using errcode='42501';end if;
 if value is null then
  if fan is not null and fan !~ '^[0-9]{1,24}$' then raise exception 'Fan inválido';end if;
  return jsonb_build_object('rows',coalesce((select jsonb_agg(jsonb_build_object('fanId',fan_id,'name',custom_name,'version',version,'updatedAt',updated_at)) from bruff_private.fan_custom_names where workspace_id=w and creator_id=c and (fan is null or fan_id=fan)),'[]'::jsonb));
 end if;
 if not bruff_private.can_access(w,c,'send') then raise exception 'Acceso no permitido' using errcode='42501';end if;
 if fan is null or fan !~ '^[0-9]{1,24}$' or length(value)>80 or value ~ '[[:cntrl:]]' or expected is null or expected<0 then raise exception 'Nombre inválido';end if;
 select * into n from bruff_private.fan_custom_names where workspace_id=w and creator_id=c and fan_id=fan for update;
 if coalesce(n.version,0)<>expected then raise exception 'El nombre cambió en otra sesión. Recarga antes de guardar.' using errcode='40001';end if;
 insert into bruff_private.fan_custom_names(workspace_id,creator_id,fan_id,custom_name,updated_by) values(w,c,fan,trim(value),auth.uid())
 on conflict(workspace_id,creator_id,fan_id) do update set custom_name=excluded.custom_name,updated_by=auth.uid(),updated_at=now(),version=bruff_private.fan_custom_names.version+1 returning * into n;
 return jsonb_build_object('fanId',n.fan_id,'name',n.custom_name,'version',n.version,'updatedAt',n.updated_at);
end $$;
revoke all on function public.bruff_fan_names(uuid,uuid,text,text,bigint) from public,anon;
grant execute on function public.bruff_fan_names(uuid,uuid,text,text,bigint) to authenticated;
commit;
