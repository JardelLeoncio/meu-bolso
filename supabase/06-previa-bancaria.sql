-- Substitua __OWNER_UUID__ pelo ID da sua conta em Authentication > Users.
-- A versão personalizada preparada no computador já contém o ID do titular.
begin;
create table if not exists bolso_private.bank_preview (
  singleton boolean primary key check(singleton),
  owner_id uuid not null references auth.users(id) on delete cascade,
  lease uuid, reserved_at timestamptz, refreshed_at timestamptz, preview jsonb
);
alter table bolso_private.bank_preview enable row level security;
revoke all on bolso_private.bank_preview from public, anon, authenticated;
do $$
declare expected uuid := '__OWNER_UUID__';
begin
  if not exists(select 1 from bolso_private.members where user_id=expected) then
    raise exception 'O titular precisa ser membro autorizado';
  end if;
  insert into bolso_private.bank_preview(singleton,owner_id) values(true,expected)
    on conflict(singleton) do nothing;
  if not exists(select 1 from bolso_private.bank_preview where owner_id=expected) then
    raise exception 'Existe outro titular configurado';
  end if;
end $$;

create or replace function public.bolso_bank_preview_access(p_reserve boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare slot bolso_private.bank_preview; ticket uuid;
begin
  perform bolso_private.guard_request(false);
  select * into slot from bolso_private.bank_preview where owner_id=auth.uid() for update;
  if not found then raise exception 'Acesso negado' using errcode='42501'; end if;
  if slot.preview is not null and slot.refreshed_at > now()-interval '24 hours' then
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

create or replace function public.bolso_bank_preview_finish(p_ticket uuid,p_preview jsonb)
returns void language plpgsql security definer set search_path='' as $$
begin
  if p_preview is null or jsonb_typeof(p_preview) <> 'object' or octet_length(p_preview::text)>2000000 then
    raise exception 'Prévia inválida';
  end if;
  update bolso_private.bank_preview set preview=p_preview,refreshed_at=now(),lease=null
    where lease=p_ticket and reserved_at > now()-interval '2 minutes';
  if not found then raise exception 'Consulta expirada'; end if;
end $$;
revoke all on function public.bolso_bank_preview_access(boolean) from public,anon;
grant execute on function public.bolso_bank_preview_access(boolean) to authenticated;
revoke all on function public.bolso_bank_preview_finish(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.bolso_bank_preview_finish(uuid,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
