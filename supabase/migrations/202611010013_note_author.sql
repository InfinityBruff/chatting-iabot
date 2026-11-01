begin;
create or replace function public.bruff_fan_note(w uuid,c uuid,fan text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare n bruff_private.fan_notes;
begin
 if fan is null or fan !~ '^[0-9]{1,24}$' or not bruff_private.can_access(w,c,'read')
 or not exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null)
 then raise exception 'Acceso no permitido' using errcode='42501'; end if;
 if not bruff_private.can_access(w,c,'notes') then return jsonb_build_object('allowed',false); end if;
 select * into n from bruff_private.fan_notes where workspace_id=w and creator_id=c and fan_id=fan;
 return jsonb_build_object('allowed',true,'body',coalesce(n.body,''),'version',coalesce(n.version,0),'updatedAt',n.updated_at,'updatedBy',(select coalesce(nullif(btrim(m.display_name),''),case when m.role='owner' then 'Propietario' else 'Trabajador sin nombre' end) from bruff_private.memberships m where m.workspace_id=w and m.user_id=n.updated_by));
end $$;
commit;
