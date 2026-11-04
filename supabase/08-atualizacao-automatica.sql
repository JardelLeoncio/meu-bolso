-- Execute após os SQL 06 e 07. Preserva titular, MFA, limites e dados.
begin;
create or replace function public.bolso_bank_preview_access(p_reserve boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare slot bolso_private.bank_preview; ticket uuid;
begin
  perform bolso_private.guard_request(false);
  select * into slot from bolso_private.bank_preview where owner_id=auth.uid() for update;
  if not found then raise exception 'Acesso negado' using errcode='42501'; end if;
  if slot.preview is not null and slot.refreshed_at > now()-interval '5 minutes' then
    return jsonb_build_object('preview',slot.preview);
  end if;
  if p_reserve is not true then return '{}'::jsonb; end if;
  if slot.reserved_at > now()-interval '2 minutes' then
    raise exception 'Aguarde antes de consultar' using errcode='PT429';
  end if;
  ticket:=gen_random_uuid();
  update bolso_private.bank_preview set lease=ticket,reserved_at=now() where singleton;
  return jsonb_build_object('ticket',ticket);
end $$;

revoke all on function public.bolso_bank_preview_access(boolean) from public,anon;
grant execute on function public.bolso_bank_preview_access(boolean) to authenticated;
notify pgrst,'reload schema';
commit;
