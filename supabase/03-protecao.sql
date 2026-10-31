-- Aplicar depois de 01-banco.sql. Não apaga despesas.
begin;
create table if not exists bolso_private.request_limits (
 user_id uuid primary key references auth.users(id) on delete cascade,
 window_start timestamptz not null, reads integer not null default 0, writes integer not null default 0
);
alter table bolso_private.request_limits enable row level security;
revoke all on bolso_private.request_limits from public, anon, authenticated;
create or replace function bolso_private.guard_request(writing boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare u uuid := auth.uid(); r integer; w integer;
begin
 if u is null or coalesce(auth.jwt()->>'aal','') <> 'aal2' or not bolso_private.is_member() then
  raise exception 'Acesso negado' using errcode='42501';
 end if;
 -- Uma sessão revogada não pode continuar usando um JWT ainda não expirado.
 if not exists (select 1 from auth.sessions s where s.id::text=auth.jwt()->>'session_id' and s.user_id=u) then
  raise exception 'Sessão encerrada' using errcode='42501';
 end if;
 insert into bolso_private.request_limits as limits values(u,clock_timestamp(),case when writing then 0 else 1 end,case when writing then 1 else 0 end)
 on conflict(user_id) do update set
 window_start=case when limits.window_start < clock_timestamp()-interval '1 minute' then clock_timestamp() else limits.window_start end,
 reads=case when limits.window_start < clock_timestamp()-interval '1 minute' then 0 else limits.reads end + case when writing then 0 else 1 end,
 writes=case when limits.window_start < clock_timestamp()-interval '1 minute' then 0 else limits.writes end + case when writing then 1 else 0 end
 returning reads,writes into r,w;
 if r>120 or w>30 then raise exception 'Limite atingido. Aguarde um minuto.' using errcode='PT429'; end if;
end; $$;
revoke all on function bolso_private.guard_request(boolean) from public, anon, authenticated;
create or replace function public.bolso_read()
returns table(document jsonb,revision bigint) language plpgsql security definer set search_path='' as $$
begin
 perform bolso_private.guard_request(false);
 return query select d.document,d.revision from public.bolso_documents d where d.user_id=auth.uid();
end; $$;
revoke all on function public.bolso_read() from public,anon;
grant execute on function public.bolso_read() to authenticated;
revoke select on public.bolso_documents from authenticated;
-- Encapsula a gravação anterior, preservando validação e controle de conflitos.
do $$ begin
 if to_regprocedure('bolso_private.save_document(jsonb,bigint)') is null then
  alter function public.bolso_save(jsonb,bigint) set schema bolso_private;
  alter function bolso_private.bolso_save(jsonb,bigint) rename to save_document;
 end if;
end $$;
revoke all on function bolso_private.save_document(jsonb,bigint) from public,anon,authenticated;
create or replace function public.bolso_save(p_document jsonb,p_revision bigint)
returns bigint language plpgsql security definer set search_path='' as $$
begin
 perform bolso_private.guard_request(true);
 return bolso_private.save_document(p_document,p_revision);
end; $$;
revoke all on function public.bolso_save(jsonb,bigint) from public,anon;
grant execute on function public.bolso_save(jsonb,bigint) to authenticated;
notify pgrst,'reload schema';
commit;
