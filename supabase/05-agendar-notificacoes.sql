-- Executar SOMENTE depois de publicar send-reminders e configurar os segredos.
-- No Vault, criar bolso_push_cron_secret com o mesmo valor de PUSH_CRON_SECRET.
-- Nenhum segredo deve ser escrito neste arquivo ou enviado ao GitHub.
begin;
create extension if not exists pg_cron;
create extension if not exists pg_net;
do $$ begin
 if not exists(select 1 from vault.decrypted_secrets where name='bolso_push_cron_secret' and length(decrypted_secret)>=32) then
  raise exception 'Configure bolso_push_cron_secret no Vault antes de agendar';
 end if;
end $$;
-- cron.schedule atualiza o job de mesmo nome; reaplicar não cria cópias.
select cron.schedule('meu-bolso-daily','0 12 * * *',
 $job$
 select net.http_post(
  url := 'https://ohfqsuqjhkmlooqvifvf.supabase.co/functions/v1/send-reminders',
  headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',
   (select decrypted_secret from vault.decrypted_secrets where name='bolso_push_cron_secret')),
  body := '{}'::jsonb,
  timeout_milliseconds := 120000
 );
 $job$
);
commit;
-- 12:00 UTC = 09:00 America/Sao_Paulo. Não alterar o fuso global do banco.
-- Para suspender apenas os avisos: select cron.unschedule('meu-bolso-daily');
