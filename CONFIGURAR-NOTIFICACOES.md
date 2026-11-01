# Ativar os avisos do Meu Bolso

O código está preparado, mas o envio só funciona depois destas etapas administrativas. Mantenha o plano gratuito. Não é necessário serviço pago de notificações ou conta Apple Developer.

## 1. Banco

No SQL Editor do projeto atual, execute `supabase/04-notificacoes.sql`. Ele adiciona inscrições privadas e funções de envio; não apaga nem substitui despesas. Pressupõe que 01, 02 e 03 já foram aplicados. Não reaplique 01: pode restaurar permissões antigas.

## 2. Preparar as chaves no computador

No terminal do VS Code, na pasta do projeto:

```powershell
npm run push:prepare
```

São criados `work/push-secrets.env` (privado) e `work/send-reminders.ts` (função em um arquivo, para o editor). Uma segunda execução reutiliza as chaves existentes. A pasta work é ignorada pelo Git e não é servida pelo servidor local. Guarde uma cópia privada do arquivo de segredos. Não cole seu conteúdo no chat, no GitHub ou em capturas de tela.

## 3. Função no Supabase

Em **Edge Functions → Secrets**, cadastre os quatro nomes e valores de `work/push-secrets.env`: PUSH_PUBLIC_KEY, PUSH_PRIVATE_KEY, PUSH_CRON_SECRET e PUSH_SUBJECT.

Em **Edge Functions**, crie a função **send-reminders** pelo editor e substitua o conteúdo pelo arquivo `work/send-reminders.ts`. Publique com **Verify JWT / Enforce JWT verification desativado somente nesta função**. Ela faz sua própria verificação do cabeçalho secreto x-cron-secret e rejeita chamadas sem o segredo. Não use a chave publishable como segredo. As chaves administrativas padrão são fornecidas pelo ambiente do Supabase, nunca pelo navegador.

Alternativa pelo terminal, após autenticar a CLI oficial com sua própria conta:

```powershell
npx supabase login
npx supabase secrets set --env-file work/push-secrets.env --project-ref ohfqsuqjhkmlooqvifvf
npx supabase functions deploy send-reminders --project-ref ohfqsuqjhkmlooqvifvf --no-verify-jwt
```

## 4. Agendar

No **Vault** do Supabase crie o segredo `bolso_push_cron_secret` com o MESMO valor de PUSH_CRON_SECRET do arquivo privado. Depois execute `supabase/05-agendar-notificacoes.sql` no SQL Editor. Ele habilita Cron/pg_net e configura um job diário às 12h UTC, equivalentes às 9h de Brasília. O SQL público referencia apenas o nome do segredo.

## 5. Habilitar o botão no site

Somente após preparar o servidor:

```powershell
npm run push:enable
npm run build
npm test
```

O primeiro comando copia SOMENTE a chave pública para src/config.js. Faça commit de src/config.js e cloud.js e publique pelo fluxo normal do projeto. Não adicione work ao Git.

No iPhone, abra pelo ícone instalado na Tela de Início, entre com MFA, vá a **Ajustes → Avisos de vencimento → Ativar avisos neste aparelho** e permita. Não é preciso manter o app aberto.

## 6. Teste real antes de confiar no aviso

Cadastre uma conta fictícia pendente com vencimento hoje ou no futuro; feche o app. No teste da Edge Function, use POST com JSON `{}` e o cabeçalho x-cron-secret preenchido privadamente com o segredo. O retorno contém apenas sent e failed. `sent` significa aceito pelo serviço push, não prova que o iPhone exibiu. Confira a notificação no aparelho, toque nela e confira o painel. Depois remova a despesa fictícia.

Uma tentativa já feita no dia impede outro envio ao mesmo aparelho naquele dia, inclusive após falha de rede, para evitar repetição em timeouts ambíguos. Testar antes das 9h consome o envio daquele dia. Para teste manual adicional, um administrador pode executar `update bolso_private.push_subscriptions set last_attempt=null;` (permite novo aviso em todos os aparelhos cadastrados). Nunca automatize esse reset.

Confirme no Cron o job ativo e, no dia seguinte, o envio agendado sem abrir o app. O sucesso do Cron indica apenas que a requisição foi enfileirada; confira também status HTTP e logs da função. A tabela privada registra last_attempt e last_result, sem registrar conteúdo de despesas. Falha não é repetida automaticamente no mesmo dia; a próxima tentativa é no dia seguinte. Push vencido (404/410) remove a inscrição. Se houver falha persistente, reative os avisos e confira os segredos.

## Privacidade e limites

- O banco mantém despesas e inscrições privadas; as funções de lote/resultado só podem ser executadas com a chave administrativa do servidor. O cliente só cadastra/remove o próprio aparelho após MFA e verificação da sessão.
- Cada conta pode registrar cinco aparelhos. Inscrições estão vinculadas à sessão: sair ou usar Sair de todos interrompe novos envios dessas sessões. Uma mensagem já enviada pode ainda chegar depois de sair. O novo login tenta recuperar o cadastro previamente consentido; se falhar, Ajustes pede reativação.
- O envio aceita somente destinos HTTPS dos serviços push da Apple, Google e Mozilla para evitar requisições a servidores arbitrários. Outros provedores, como alguns navegadores Windows, podem exigir ampliar a lista após revisão.
- A função processa até vinte aparelhos por execução; este projeto é pessoal, com cinco por conta, e não foi dimensionado como serviço multiusuário. Não aumentar usuários sem rever fila e limites.
- O conteúdo enviado ao aparelho contém quantidade de próximas contas/atrasadas e próxima data, sem nomes, valores ou JSON financeiro. Essas contagens podem aparecer na tela bloqueada; ajuste as prévias do iPhone se preferir.
- Não há garantia de entrega/horário: dependem de rede, permissões, configurações do sistema e disponibilidade do Supabase. O projeto gratuito pode ser pausado por inatividade e tem cotas. Verifique o painel de uso; não habilite plano pago para este recurso.
- Para parar os envios no servidor execute `select cron.unschedule('meu-bolso-daily');`. Para um aparelho, use Desativar avisos em Ajustes. Se a chave privada vazar, substitua-a no servidor e cliente e recadastre todos os aparelhos. Revise também o segredo do cron.

Documentação oficial: [agendamento no Supabase](https://supabase.com/docs/guides/functions/schedule-functions), [segredos das funções](https://supabase.com/docs/guides/functions/secrets), [Web Push no iPhone](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/), [limites do plano](https://supabase.com/pricing).
