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

A consulta ocorre ao entrar e a cada cinco minutos com o app visível. A integração consulta 30 dias de movimentações; o extrato mostra inicialmente sete dias, incluindo hoje, e Ver mais revela as demais da prévia. A última prévia fica em uma tabela privada separada das despesas. Após aplicar o SQL 08, ela é reutilizada por cinco minutos e substituída após a próxima consulta bem-sucedida. O resultado diferencia entradas, saídas, conta e cartão. A revisão ocorre antes de qualquer incorporação aos lançamentos.

Para ativar, cadastre PLUGGY_CLIENT_ID, PLUGGY_CLIENT_SECRET, PLUGGY_ITAU_ITEM_ID e PLUGGY_MERCADO_PAGO_ITEM_ID em Edge Functions → Secrets. Para este projeto, execute o arquivo local `work/06-previa-bancaria.sql` no SQL Editor. Ele já contém o ID do titular. O arquivo público `supabase/06-previa-bancaria.sql.template` é um modelo para outras instalações.

Crie a Edge Function bank-preview com o conteúdo de supabase/functions/bank-preview/index.ts em index.ts. Desative a verificação JWT legada do gateway somente para essa função. Antes de chamar a Pluggy, a função encaminha o JWT a uma RPC do PostgREST que valida a sessão, o MFA e o titular explicitamente cadastrado. Para conferir a ativação, entre pelo site e toque em Consultar prévia. O teste local usa dados sintéticos.

## Controle financeiro e histórico mensal

O Painel resume entradas, saídas e resultado do dinheiro movimentado nas contas durante os dias guardados do mês selecionado. Contas mantém o planejamento manual, vencimentos e avisos. O Início reúne o fluxo, os gastos por categoria, a origem das entradas e a classificação por movimento. Categorias sugeridas podem ser corrigidas, incluindo salário, refeições, supermercado, combustível, transferências próprias e pagamento de fatura.

Para ativar em um projeto que já executou o SQL 06, publique a versão atual de `supabase/functions/bank-preview/index.ts` como `bank-preview`, com a mesma configuração e os mesmos quatro segredos. Depois execute `supabase/07-historico-financeiro.sql`. Esse script usa o titular definido no 06. Uma prévia antiga é marcada para atualização. No app, abra Cartões, consulte o extrato e clique em Guardar período no histórico.

O aplicativo registra automaticamente os 30 dias da prévia no histórico financeiro após cada consulta nova. Consultas futuras ampliam o histórico. Salvar a mesma transação atualiza seus dados e mantém a categoria escolhida. Movimentos ausentes em uma consulta posterior que cobre a mesma data ficam marcados e saem dos totais. A consulta mensal informa quantos dias foram cobertos, inclusive períodos sem transações. O CSV financeiro é exportado no Início, em Classificar movimentos e exportar o mês. Os backups JSON de Ajustes continuam cobrindo os lançamentos manuais.

O fluxo de caixa considera movimentos confirmados de contas bancárias em BRL. Gastos por categoria consideram débitos classificados em contas e cartões, excluindo transferências próprias e pagamentos de fatura identificados. Um Pix sem finalidade conhecida fica para classificação. Pendências, registros ausentes e outras moedas não entram nos totais. A aba Faturas apresenta os valores e vencimentos efetivamente fornecidos pelo banco, sem inferir o saldo em aberto ou o pagamento a partir das compras.

Referências da integração: [transações](https://docs.pluggy.ai/en/docs/products/transactions) e [faturas](https://v2.docs.pluggy.ai/en/reference/bill/bills-list).

## Interface azul

Início mostra saldos disponíveis em reais na última consulta, cofrinhos explicitamente identificados nas reservas bancárias, o total pendente dos lançamentos fixos e variáveis e os gráficos do histórico guardado. O gráfico de fluxo cobre seis meses e usa um traço nos períodos sem dados. O saldo é o informado na consulta, independentemente do mês escolhido para os gráficos.

Cartões reúne extrato de conta e cartão, filtros por instituição e instrumento, faturas e limites informados. No detalhe da fatura é possível vinculá-la a um lançamento do mês ou criar uma despesa variável. A referência bancária impede cadastrar a mesma fatura novamente. O vínculo preserva o valor, vencimento e situação de uma despesa existente. Faturas exibidas só entram na dívida após registro.

Despesas oferece lançamento, edição, filtros de pagamento e de tipo, além dos relatórios manuais. Ajustes agrupa aparência, notificações, sincronização, arquivos e segurança em seções recolhíveis.

Para habilitar os novos campos, atualize a função existente bank-preview usando supabase/functions/bank-preview/index.ts. Aplique também supabase/08-atualizacao-automatica.sql para reduzir o cache de 24 horas a cinco minutos. O histórico continua usando o SQL 07. Referência: [campos de contas e limites na Pluggy](https://v2.docs.pluggy.ai/en/docs/products/accounts).

## Radar e histórico de despesas
O histórico manual foi movido inteiro para o Início. O radar mostra contas pendentes vencidas ou com vencimento até três dias à frente. Tocar em uma conta abre Despesas no mês correto sem abrir o editor. As notificações push existentes mantêm seu agendamento.

A consulta automática busca os dados já disponibilizados pela Pluggy; não força uma atualização do banco e não garante tempo real. Opera apenas com uma sessão autenticada e a página visível. Os gráficos usam o SQL 07 e preservam categorias e referências para evitar duplicações. Falhas voltam a ser tentadas no próximo ciclo. Não há consulta automática quando o app está fechado.
