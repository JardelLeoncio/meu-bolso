-- Execute no SQL Editor do SEU projeto. Não contém despesas ou credenciais.
begin;
create schema if not exists bolso_private;
revoke all on schema bolso_private from public, anon, authenticated;
grant usage on schema bolso_private to authenticated;

create table if not exists bolso_private.members (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table bolso_private.members enable row level security;
revoke all on bolso_private.members from public, anon, authenticated;

create or replace function bolso_private.is_member()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from bolso_private.members where user_id = auth.uid());
$$;
revoke all on function bolso_private.is_member() from public, anon;
grant execute on function bolso_private.is_member() to authenticated;

create or replace function bolso_private.valid_document(doc jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare m record; item jsonb; n numeric;
begin
  if jsonb_typeof(doc) is distinct from 'object' or octet_length(doc::text) > 5000000
     or doc->>'version' is distinct from '2'
     or coalesce(doc->>'selectedMonth','') !~ '^\d{4}-(0[1-9]|1[0-2])$'
     or jsonb_typeof(doc->'months') is distinct from 'object' then return false; end if;
  if (select count(*) from jsonb_object_keys(doc->'months')) > 500 then return false; end if;
  for m in select * from jsonb_each(doc->'months') loop
    if m.key !~ '^\d{4}-(0[1-9]|1[0-2])$' or jsonb_typeof(m.value) <> 'array' then return false; end if;
    if jsonb_array_length(m.value) > 2000 then return false; end if;
    for item in select * from jsonb_array_elements(m.value) loop
      if jsonb_typeof(item) <> 'object'
         or jsonb_typeof(item->'name') is distinct from 'string'
         or length(trim(item->>'name')) not between 1 and 200
         or jsonb_typeof(item->'id') is distinct from 'string'
         or length(item->>'id') not between 1 and 120
         or jsonb_typeof(item->'category') is distinct from 'string'
         or length(item->>'category') > 80
         or coalesce(item->>'type','') not in ('fixed','variable')
         or coalesce(item->>'status','') not in ('paid','pending','unknown')
         or jsonb_typeof(item->'amount') is distinct from 'number' then return false; end if;
      n := (item->>'amount')::numeric;
      if n < 0 or n > 1000000000 or n <> round(n,2) then return false; end if;
    end loop;
  end loop;
  return true;
exception when others then return false;
end;
$$;
revoke all on function bolso_private.valid_document(jsonb) from public, anon;
grant execute on function bolso_private.valid_document(jsonb) to authenticated;

create table if not exists public.bolso_documents (
  user_id uuid primary key references auth.users(id) on delete cascade,
  document jsonb not null check (bolso_private.valid_document(document)),
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now()
);
alter table public.bolso_documents enable row level security;
alter table public.bolso_documents force row level security;
revoke all on public.bolso_documents from public, anon, authenticated;
-- Escritas só pela função abaixo, para que ninguém contorne o controle de versão.
grant select on public.bolso_documents to authenticated;
drop policy if exists owner_mfa on public.bolso_documents;
create policy owner_mfa on public.bolso_documents for select to authenticated
  using (user_id = (select auth.uid())
    and (select auth.jwt()->>'aal') = 'aal2'
    and (select bolso_private.is_member()));

create or replace function public.bolso_access()
returns boolean language sql stable security invoker set search_path = '' as $$
  select auth.uid() is not null and coalesce(auth.jwt()->>'aal' = 'aal2', false)
    and bolso_private.is_member();
$$;
revoke all on function public.bolso_access() from public, anon;
grant execute on function public.bolso_access() to authenticated;

create or replace function public.bolso_save(p_document jsonb, p_revision bigint)
returns bigint language plpgsql security definer set search_path = '' as $$
declare who uuid := auth.uid(); current_row public.bolso_documents; next_revision bigint;
begin
  if who is null or coalesce(auth.jwt()->>'aal','') <> 'aal2'
     or not bolso_private.is_member() then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;
  if p_revision is null or p_revision < 0 or not bolso_private.valid_document(p_document) then
    raise exception 'Dados inválidos' using errcode = '22023';
  end if;
  -- Serializa inclusive a primeira gravação, antes de existir uma linha.
  perform pg_advisory_xact_lock(hashtextextended(who::text, 0));
  select * into current_row from public.bolso_documents where user_id = who for update;
  if found then
    -- Repetir uma gravação cuja resposta se perdeu é seguro.
    if current_row.document = p_document then return current_row.revision; end if;
    if current_row.revision <> p_revision then
      raise exception 'Outro dispositivo alterou os dados' using errcode = '40001';
    end if;
    next_revision := current_row.revision + 1;
    update public.bolso_documents set document=p_document, revision=next_revision, updated_at=now() where user_id=who;
  else
    if p_revision <> 0 then raise exception 'Versão divergente' using errcode = '40001'; end if;
    next_revision := 1;
    insert into public.bolso_documents(user_id,document,revision) values(who,p_document,next_revision);
  end if;
  return next_revision;
end;
$$;
revoke all on function public.bolso_save(jsonb,bigint) from public, anon;
grant execute on function public.bolso_save(jsonb,bigint) to authenticated;
notify pgrst, 'reload schema';
commit;
