-- Aplicar após o SQL 06. Usa o mesmo titular, sessão ativa e MFA.
begin;
create table if not exists bolso_private.finance_movements (
  owner_id uuid not null references auth.users on delete cascade,
  ref text not null, day date not null, payload jsonb not null, chosen_category text, absent boolean not null default false,
  primary key(owner_id,ref)
);
create index if not exists finance_period_idx on bolso_private.finance_movements(owner_id,day);
create table if not exists bolso_private.finance_days (
  owner_id uuid not null references auth.users on delete cascade,
  day date not null, primary key(owner_id,day)
);
alter table bolso_private.finance_movements enable row level security;
alter table bolso_private.finance_days enable row level security;
revoke all on bolso_private.finance_movements,bolso_private.finance_days from public,anon,authenticated;

create or replace function bolso_private.finance_guard(writing boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform bolso_private.guard_request(writing);
  if not exists(select 1 from bolso_private.bank_preview where owner_id=auth.uid()) then
    raise exception 'Titular não autorizado' using errcode='42501';
  end if;
end $$;
revoke all on function bolso_private.finance_guard(boolean) from public,anon,authenticated;

create or replace function public.bolso_finance_archive(p_fetched_at text) returns integer
language plpgsql security definer set search_path='' as $$
declare snapshot jsonb; start_day date; end_day date; n integer;
begin
  perform bolso_private.finance_guard(true);
  select preview into snapshot from bolso_private.bank_preview
    where owner_id=auth.uid() and refreshed_at>now()-interval '24 hours' for update;
  if snapshot->>'version' is distinct from '2' or snapshot->>'fetchedAt' is distinct from p_fetched_at then
    raise exception 'Consulte a prévia atualizada antes de guardar.' using errcode='22023';
  end if;
  start_day:=(snapshot->>'from')::date;
  end_day:=(snapshot->>'to')::date;
  if start_day is null or end_day is null or end_day-start_day<>29 or
    jsonb_typeof(snapshot->'movements') is distinct from 'array' then raise exception 'Período inválido'; end if;
  if exists(select 1 from jsonb_array_elements(snapshot->'movements') m where
    coalesce(m->>'ref','') !~ '^[a-f0-9]{64}$' or m->>'date' is null or (m->>'date')::date not between start_day and end_day)
    then raise exception 'Movimentação inválida'; end if;
  insert into bolso_private.finance_movements(owner_id,ref,day,payload)
    select auth.uid(),m->>'ref',(m->>'date')::date,m from jsonb_array_elements(snapshot->'movements') m
    on conflict(owner_id,ref) do update set day=excluded.day,payload=excluded.payload,absent=false;
  get diagnostics n=row_count;
  -- Reconcilia apenas a janela completa consultada. Preserva os meses anteriores.
  update bolso_private.finance_movements f set absent=true where f.owner_id=auth.uid() and f.day between start_day and end_day
    and not exists(select 1 from jsonb_array_elements(snapshot->'movements') m where m->>'ref'=f.ref);
  insert into bolso_private.finance_days(owner_id,day)
    select auth.uid(),start_day+i from generate_series(0,end_day-start_day) i on conflict do nothing;
  return n;
end $$;

create or replace function public.bolso_finance_period(p_month text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare start_day date; end_day date;
begin
  perform bolso_private.finance_guard(false);
  if p_month is null or p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then raise exception 'Mês inválido'; end if;
  start_day:=(p_month||'-01')::date; end_day:=(start_day+interval '1 month')::date;
  return jsonb_build_object(
    'days',(select count(*) from bolso_private.finance_days where owner_id=auth.uid() and day>=start_day and day<end_day),
    'rows',(select coalesce(jsonb_agg(payload || jsonb_build_object('chosen',chosen_category,'absent',absent) order by day desc,ref),'[]'::jsonb)
      from bolso_private.finance_movements where owner_id=auth.uid() and day>=start_day and day<end_day));
end $$;

create or replace function public.bolso_finance_classify(p_ref text,p_category text) returns void
language plpgsql security definer set search_path='' as $$
declare movement jsonb;
begin
  perform bolso_private.finance_guard(true);
  select payload into movement from bolso_private.finance_movements where owner_id=auth.uid() and ref=p_ref for update;
  if not found then raise exception 'Movimentação ausente'; end if;
  if p_category is not null and not (
    p_category in ('transfer','bill','review') or
    (movement->>'direction'='Saída' and p_category in ('food','market','fuel','transport','home','health','shopping','leisure','education','services','otherExpense')) or
    (movement->>'direction'='Entrada' and p_category in ('refund','otherIncome')) or
    (movement->>'account'='Conta' and movement->>'direction'='Entrada' and p_category='salary')
  ) then raise exception 'Categoria inválida para esta movimentação' using errcode='22023'; end if;
  update bolso_private.finance_movements set chosen_category=p_category where owner_id=auth.uid() and ref=p_ref;
end $$;
revoke all on function public.bolso_finance_period(text),public.bolso_finance_archive(text),public.bolso_finance_classify(text,text) from public,anon;
grant execute on function public.bolso_finance_period(text),public.bolso_finance_archive(text),public.bolso_finance_classify(text,text) to authenticated;
update bolso_private.bank_preview set refreshed_at=null
where preview is not null and preview->>'version' is distinct from '2';
notify pgrst,'reload schema';
commit;
