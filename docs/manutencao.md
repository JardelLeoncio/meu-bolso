# Manutenção

## Desenvolvimento

```sh
npm ci
npm run build
npm run dev
npm test
```

O servidor abre em http://127.0.0.1:4173. Os testes usam Chrome, dados fictícios e PostgreSQL local via PGlite. Alterações em `src/` exigem recompilar `cloud.js`, usado pelo GitHub Pages. Ao alterar arquivos do app, atualize a versão do cache em `sw.js`.

## Supabase

As migrações em `supabase/` permitem reconstruir o banco. Em uma instalação nova, aplique 01, 02 e 03 nessa ordem; depois as migrações dos recursos utilizados. Não reaplique 01 sobre um banco protegido por 03, pois ele restaura permissões antigas. Preencha os marcadores de titular de 02 e 06 somente em uma cópia privada.

Mantenha cadastro público e login anônimo desativados, autorize o titular e habilite MFA por autenticador. Configure a URL do site e de redirecionamento no Auth. Teste a recuperação de senha por e-mail e revise os limites de autenticação no painel. `src/config.js` contém apenas a configuração pública do cliente.

- **Bancos** — aplique 06, 07 e 08; publique `supabase/functions/bank-preview/index.ts` como `bank-preview`. Cadastre `PLUGGY_CLIENT_ID`, `PLUGGY_CLIENT_SECRET`, `PLUGGY_ITAU_ITEM_ID` e `PLUGGY_MERCADO_PAGO_ITEM_ID` nos segredos das Edge Functions.
- **Notificações** — aplique 04 e execute `npm run push:prepare`. Cadastre os quatro segredos gerados em `work/push-secrets.env` no Supabase. Publique `send-reminders`; o arquivo `work/send-reminders.ts` reúne o código para uso pelo editor do painel. No Vault, crie `bolso_push_cron_secret` com o mesmo valor de `PUSH_CRON_SECRET`, depois aplique 05. Execute `npm run push:enable` e recompile o cliente.

As duas funções usam a configuração de `supabase/config.toml`, com verificação própria de autorização. `bank-preview` valida o titular, MFA e sessão via PostgREST; `send-reminders` exige o segredo do agendamento. Não remova essas validações.

A consulta bancária ocorre a cada cinco minutos com o app visível e registra automaticamente os 30 dias recebidos. O banco pode demorar a disponibilizar novidades. As notificações são agendadas para 9h de Brasília; dependem da permissão e conexão do aparelho. Para cancelar o agendamento, execute `select cron.unschedule('meu-bolso-daily');`.

## Dados e publicação

Versione os fontes, `cloud.js`, recursos estáticos, testes e migrações. Segredos, backups e dados financeiros ficam fora do Git; `work/` é privado e não é servido pelo servidor local. Os backups JSON cobrem os lançamentos manuais; o histórico bancário tem exportação CSV própria.

Antes de publicar, execute o build e os testes. Alterações de funções e SQL precisam ser aplicadas no Supabase separadamente do envio ao GitHub. Confirme login, sincronização e notificações no ambiente publicado.
