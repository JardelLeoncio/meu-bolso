-- Após 03-protecao.sql. Não altera as despesas existentes.
begin;
create table if not exists bolso_private.push_subscriptions (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 session_id uuid not null references auth.sessions(id) on delete cascade,
 endpoint text not null unique, p256dh text not null, auth_key text not null,
 created_at timestamptz not null default now(), last_attempt date,
 last_result text check(last_result in ('sent','failed'))
);
alter table bolso_private.push_subscriptions enable row level security;
revoke all on bolso_private.push_subscriptions from public,anon,authenticated;
create or replace function public.bolso_push_subscribe(p_subscription jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare endpoint_value text := p_subscription->>'endpoint'; affected integer;
begin
 perform bolso_private.guard_request(true);
 if endpoint_value is null or length(endpoint_value)>2048 or
 endpoint_value !~ '^https://(web[.]push[.]apple[.]com|fcm[.]googleapis[.]com|updates[.]push[.]services[.]mozilla[.]com)/' or
 coalesce(p_subscription->'keys'->>'p256dh','') !~ '^[A-Za-z0-9_-]{87}={0,1}$' or
 coalesce(p_subscription->'keys'->>'auth','') !~ '^[A-Za-z0-9_-]{22}={0,2}$' then
 raise exception 'Inscrição inválida' using errcode='22023'; end if;
 delete from bolso_private.push_subscriptions s where s.user_id=auth.uid() and not exists(select 1 from auth.sessions a where a.id=s.session_id);
 if not exists(select 1 from bolso_private.push_subscriptions where endpoint=endpoint_value) and
 (select count(*) from bolso_private.push_subscriptions where user_id=auth.uid())>=5 then
 raise exception 'Limite de cinco aparelhos' using errcode='22023'; end if;
 insert into bolso_private.push_subscriptions(user_id,session_id,endpoint,p256dh,auth_key)
 values(auth.uid(),(auth.jwt()->>'session_id')::uuid,endpoint_value,p_subscription->'keys'->>'p256dh',p_subscription->'keys'->>'auth')
 on conflict(endpoint) do update set session_id=excluded.session_id,p256dh=excluded.p256dh,auth_key=excluded.auth_key
 where push_subscriptions.user_id=auth.uid();
 get diagnostics affected=row_count;
 if affected=0 then raise exception 'Aparelho associado a outra conta' using errcode='42501'; end if;
end; $$;
create or replace function public.bolso_push_unsubscribe(p_endpoint text)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform bolso_private.guard_request(true);
 delete from bolso_private.push_subscriptions where user_id=auth.uid() and endpoint=p_endpoint;
end; $$;
revoke all on function public.bolso_push_subscribe(jsonb),public.bolso_push_unsubscribe(text) from public,anon;
grant execute on function public.bolso_push_subscribe(jsonb),public.bolso_push_unsubscribe(text) to authenticated;
-- Evita datas inválidas de clientes antigos derrubarem o envio diário.
create or replace function bolso_private.push_date(value text) returns date
language plpgsql immutable set search_path='' as $$
declare d date;
begin
 if value is null or value !~ '^\d{4}-\d{2}-\d{2}$' then return null; end if;
 d:=value::date; return d;
exception when others then return null; end; $$;
revoke all on function bolso_private.push_date(text) from public,anon,authenticated;
create or replace function public.bolso_push_batch()
returns table(id uuid,endpoint text,p256dh text,auth_key text,upcoming bigint,overdue bigint,due_date date)
language plpgsql security definer set search_path='' as $$
declare s record; next_day date; today date := (now() at time zone 'America/Sao_Paulo')::date; dates date[];
begin
 -- Um envio por aparelho/dia, com reserva transacional contra execuções simultâneas.
 for s in select p.* from bolso_private.push_subscriptions p
 join auth.sessions a on a.id=p.session_id and a.user_id=p.user_id
 join bolso_private.members m on m.user_id=p.user_id
 where p.last_attempt is distinct from today order by p.id limit 20
 for update of p skip locked loop
 select array_agg(bolso_private.push_date(item->>'dueDate')) into dates
 from public.bolso_documents d cross join lateral jsonb_each(d.document->'months') months
 cross join lateral jsonb_array_elements(months.value) item
 where d.user_id=s.user_id and item->>'status'='pending';
 select min(v) into next_day from unnest(dates) v where v>=today;
 select count(*) into upcoming from unnest(dates) v where v=next_day;
 select count(*) into overdue from unnest(dates) v where v<today;
 update bolso_private.push_subscriptions p set last_attempt=today,last_result=null where p.id=s.id;
 if upcoming+overdue>0 then
 id:=s.id;endpoint:=s.endpoint;p256dh:=s.p256dh;auth_key:=s.auth_key;due_date:=next_day;return next;
 end if;
 end loop;
end; $$;
create or replace function public.bolso_push_result(p_id uuid,p_status text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if p_status='expired' then delete from bolso_private.push_subscriptions where id=p_id;
 elsif p_status in ('sent','failed') then update bolso_private.push_subscriptions set last_result=p_status where id=p_id;
 else raise exception 'Resultado inválido'; end if;
end; $$;
revoke all on function public.bolso_push_batch(),public.bolso_push_result(uuid,text) from public,anon,authenticated;
grant execute on function public.bolso_push_batch(),public.bolso_push_result(uuid,text) to service_role;
notify pgrst,'reload schema';
commit;
