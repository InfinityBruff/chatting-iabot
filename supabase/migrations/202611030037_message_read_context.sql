begin;
-- Only combines existing authenticated read checks; no new data access or storage.
create function public.bruff_message_read_context(w uuid,c uuid,fan text,ids text[],expected_binding text) returns jsonb
language plpgsql volatile security invoker set search_path='' as $$
declare authors jsonb; binding text;
begin
 if expected_binding is null or expected_binding !~ '^acct_[A-Za-z0-9_-]+$' then
  raise exception 'Cuenta de lectura inválida' using errcode='42501';
 end if;
 authors=public.bruff_message_authors(w,c,fan,ids);
 -- Recheck after attribution. VOLATILE keeps a fresh snapshot for this query.
 binding=public.bruff_live_authorize(w,c,'read');
 if binding is distinct from expected_binding then
  raise exception 'La cuenta ha cambiado' using errcode='42501';
 end if;
 return jsonb_build_object('binding',binding,'authors',authors);
end $$;
revoke all on function public.bruff_message_read_context(uuid,uuid,text,text[],text) from public,anon,service_role;
grant execute on function public.bruff_message_read_context(uuid,uuid,text,text[],text) to authenticated;
commit;
