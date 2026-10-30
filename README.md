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

As sessões ficam nesta aba do navegador. Alterações pendentes usam um rascunho por conta no armazenamento da sessão. Fechar a aba com mudanças pendentes pode perder esse rascunho: baixe o backup antes. A primeira versão exige internet para editar e consulta atualizações a cada 30 segundos e ao voltar à janela. Conflitos bloqueiam novas edições e permitem baixar o rascunho e recarregar a nuvem.

O histórico local antigo permanece intacto e só será enviado à conta após confirmação explícita. A importação inicial só é oferecida se a conta ainda estiver vazia. A restauração de backup substitui o conteúdo da conta; nunca é uma mesclagem automática. Os arquivos JSON e CSV contêm dados pessoais sem criptografia e devem ficar em local privado.

Antes de limpar dados do navegador ou trocar de aparelho, gere um backup em **Configurações → Baixar backup (.json)** e guarde-o em um local privado.

## Publicação

O projeto continua estático no GitHub Pages. Envie apenas os arquivos públicos revisados; nunca envie backups ou históricos pessoais. `src/` e `supabase/` são código público sem segredos. As regras no banco protegem os dados, não a ocultação desses arquivos.

Os testes usam dados fictícios, um PostgreSQL local via PGlite e respostas de Auth simuladas no Chrome. Não substituem o teste final no Supabase, a verificação de e-mails nem uma auditoria independente. Nenhum dado financeiro real foi enviado durante a preparação.
