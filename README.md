# Meu Bolso

Aplicativo web para registrar despesas, acompanhar gráficos e guardar os dados na conta Supabase.

Login e sincronização preparados para publicação. O proprietário confirmou o login com autenticador e o teste de sincronização entre navegadores na versão local. A recuperação de senha por e-mail e o acesso pelo celular no endereço publicado ainda precisam ser validados. Para configurar outra instalação, siga `CONFIGURAR-SUPABASE.md`.

## Executar localmente

Abra a pasta no VS Code. No terminal integrado execute `npm ci`, `npm run build` e `npm run dev`.
Abra http://127.0.0.1:4173. O servidor local disponibiliza somente os arquivos públicos; backups e `.git` não são servidos.
Depois de editar `src/`, execute `npm run build` para atualizar `cloud.js`. Esse arquivo pronto é usado pelo GitHub Pages.
Execute `npm test` para os testes de banco e navegador (Chrome instalado).

## Privacidade

O banco exige conta previamente autorizada e MFA por autenticador para acesso às despesas. A chave publishable é pública. Nenhuma senha ou chave administrativa deve entrar no repositório.

A sessão de login fica no armazenamento persistente do navegador (localStorage), com renovação automática. Fechar e abrir o navegador mantém o acesso enquanto a sessão for válida. Sair, limpar os dados do site ou revogar/expirar a sessão exige novo login e MFA. O upgrade migra uma vez a sessão antiga da aba, sem guardar a senha. Perfil, alteração de senha, saída, sincronização e histórico antigo ficam em Ajustes. Alterações pendentes usam um rascunho por conta no armazenamento da sessão. Fechar a aba com mudanças pendentes pode perder esse rascunho: baixe o backup antes. A primeira versão exige internet para editar e consulta atualizações a cada 30 segundos e ao voltar à janela. Conflitos bloqueiam novas edições e permitem baixar o rascunho e recarregar a nuvem.

O histórico local antigo permanece intacto e só será enviado à conta após confirmação explícita. A importação inicial só é oferecida se a conta ainda estiver vazia. A restauração de backup substitui o conteúdo da conta; nunca é uma mesclagem automática. Os arquivos JSON e CSV contêm dados pessoais sem criptografia e devem ficar em local privado.

Antes de limpar dados do navegador ou trocar de aparelho, gere um backup em **Ajustes → Backup dos seus dados → Baixar backup (.json)** e guarde-o em um local privado.

## Publicação

O projeto continua estático no GitHub Pages. Envie apenas os arquivos públicos revisados; nunca envie backups ou históricos pessoais. `src/` e `supabase/` são código público sem segredos. As regras no banco protegem os dados, não a ocultação desses arquivos.

Os testes usam dados fictícios, um PostgreSQL local via PGlite e respostas de Auth simuladas no Chrome. Não substituem o teste final no Supabase, a verificação de e-mails nem uma auditoria independente. Nenhum dado financeiro real foi enviado durante a preparação.

## Datas e avisos de vencimento

Cada despesa pode ter dueDate (vencimento manual) e paidDate (pagamento), em YYYY-MM-DD. Ao marcar como paga, o app usa o dia local do aparelho; a data pode ser editada. Desmarcar limpa a data de pagamento. Despesas antigas pagas sem data continuam sem data conhecida. Ao copiar fixas para outro mês, as duas datas são limpas para preenchimento manual.

O início lista todas as atrasadas e as contas da próxima data de vencimento a partir de hoje, inclusive hoje, sem limite de seis dias. Contas com a mesma próxima data entram juntas; datas posteriores aparecem quando passam a ser as próximas. Pagas, status desconhecido e contas sem vencimento não entram. JSON e CSV preservam as datas. Recarregue todos os aparelhos antes de editar após atualizar.

O envio com o app fechado foi implementado com Web Push, Supabase Edge Functions e Cron. Exige ativação conforme `CONFIGURAR-NOTIFICACOES.md`: migração 04, segredos privados, função, agendamento 05 e chave pública do cliente. A chave pública vem vazia até a ativação; publicar o código sozinho não liga o envio. O painel interno funciona independentemente disso.

O resumo é agendado para 9h de Brasília, no máximo uma tentativa diária por aparelho, com até cinco aparelhos por conta. Só inclui quantidades e a próxima data, sem nomes ou valores. Não envia se não há pendências com data válida. O cadastro exige MFA, conta autorizada e sessão válida; sair ou revogar a sessão interrompe novos envios dessa sessão. Ao entrar novamente, o app tenta renovar o cadastro previamente consentido.

Testes locais cobrem datas, permissões, reserva diária e recebimento simulado pelo service worker. A entrega real com o iPhone fechado depende da ativação no Supabase e de um teste no aparelho. Permissão, conexão, foco do iOS e disponibilidade do serviço podem atrasar ou impedir a entrega. Não é um alarme com horário garantido nem substitui conferir os vencimentos. A data do painel usa o calendário do aparelho; o resumo diário usa Brasília.

## Interface e aparência

O aplicativo tem temas Claro, Escuro e Sistema em Ajustes → Aparência. A preferência fica em `meu-bolso-theme`, no armazenamento local de cada aparelho; não altera o documento financeiro nem a sessão. O tema Sistema acompanha a preferência do dispositivo, inclusive quando ela muda com o app aberto.

A abertura mostra somente o ícone enquanto a conta é verificada. Uma sessão válida abre o painel diretamente; login, MFA e recuperação mantêm suas telas quando necessários. Após 12 segundos sem conclusão, a abertura oferece tentar novamente, preservando a sessão. Não há atraso artificial para exibir a marca.

A navegação usa menu lateral no computador e barra inferior no celular. Ajustes reúne perfil e aparência, notificações e sincronização, backups/exportação e segurança. Importação em lote e exclusão ficam em seções recolhíveis. As operações financeiras, datas, autorização e serviço de notificações continuam usando os fluxos existentes; esta atualização não requer SQL.

A verificação local usa somente dados fictícios: temas persistentes, preferência do sistema, abertura com e sem sessão, modal por teclado e telas de 320, 390, 768 e 1366 pixels. A aparência e o teclado do Safari devem ser conferidos no iPhone real após publicar.

## Prévia bancária pessoal

Em Ajustes → Bancos → Consultar prévia, o titular pode consultar 30 dias de movimentações. A última prévia fica em uma tabela privada separada das despesas. Ela é reutilizada por 24 horas e substituída após a próxima consulta bem-sucedida. O resultado diferencia entradas, saídas, conta e cartão. A revisão ocorre antes de qualquer incorporação aos lançamentos.

Para ativar, cadastre PLUGGY_CLIENT_ID, PLUGGY_CLIENT_SECRET, PLUGGY_ITAU_ITEM_ID e PLUGGY_MERCADO_PAGO_ITEM_ID em Edge Functions → Secrets. Aplique supabase/06-previa-bancaria.sql com o marcador __OWNER_UUID__ substituído pelo ID do titular em Authentication → Users. Confira o titular antes de executar. O arquivo preparado em work/06-previa-bancaria.sql já contém o ID para a instalação pessoal deste projeto.

Crie a Edge Function bank-preview com o conteúdo de supabase/functions/bank-preview/index.ts em index.ts. Desative a verificação JWT legada do gateway somente para essa função. Antes de chamar a Pluggy, a função encaminha o JWT a uma RPC do PostgREST que valida a sessão, o MFA e o titular explicitamente cadastrado. Para conferir a ativação, entre pelo site e toque em Consultar prévia. O teste local usa dados sintéticos.
