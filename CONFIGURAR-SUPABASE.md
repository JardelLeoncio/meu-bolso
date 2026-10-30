# Configurar o Meu Bolso pessoal

Preparação local em `feature/login-sincronizacao`. Não publicar essa branch antes de configurar e testar a conta. A versão anterior do site continua funcionando.

## 1. Criar o banco protegido

No VS Code, Ctrl+P → `supabase/01-banco.sql`. Copie todo o arquivo.
No projeto Supabase `ohfqsuqjhkmlooqvifvf`, abra SQL Editor → New query, cole e clique Run.
Esse script cria a tabela de despesas e as regras; não importa histórico nem cria conta. Pode ser reaplicado sem apagar lançamentos.

## 2. Restringir o acesso e criar sua conta

- Em Authentication, procure a configuração **Allow new users to sign up** e desligue. Mantenha login por e-mail habilitado; login anônimo desabilitado.
- Em Authentication → Users → Add user → Create new user, crie somente sua conta, com um e-mail que você controla e senha única de pelo menos 12 caracteres. Para esse cadastro manual pelo proprietário, use a opção de confirmar automaticamente esse usuário; não desative globalmente a confirmação de e-mail.
- Guarde a senha em gerenciador. Não a envie ao chat ou ao GitHub.
- Copie o **User UID** recém-criado. Abra `supabase/02-autorizar-conta.sql`, copie para uma nova consulta no painel e substitua o marcador pelo UID dentro do painel. Execute. Não precisa alterar o arquivo versionado.
- Em MFA, mantenha habilitado o uso de aplicativo autenticador (TOTP). A conta cadastrará o autenticador na primeira entrada. Sem esse código, a regra no banco nega acesso às despesas.
- Proteja também sua conta administrativa do Supabase e a conta do GitHub com dois fatores.

## 3. Endereço e recuperação

Em Authentication → URL Configuration:

- Site URL: `https://jardelleoncio.github.io/meu-bolso/`
- Redirect URLs: adicione exatamente o mesmo endereço, sem curingas abrangentes.

O envio padrão de e-mails do Supabase só atende endereços da equipe do projeto, tem limites baixos e não tem garantia de entrega. Para teste pessoal use o mesmo e-mail da sua conta administrativa e teste o recebimento. Recuperação para outros endereços depende de SMTP próprio; não habilite plano pago para seguir este guia. A configuração de SMTP fica pendente se você não quiser acrescentar um serviço agora. Não dependa da recuperação por e-mail sem validar esse fluxo.

O botão “Esqueci minha senha” abre o fluxo com PKCE: solicite e abra o link no mesmo navegador/aba de sessão. Depois da segunda verificação, defina a nova senha. O teste de envio/recebimento real só pode ocorrer quando a conta e os endereços estiverem configurados.

Guarde a chave de configuração do autenticador em gerenciador de senhas privado. Nunca a coloque em prints ou no Git. Sem o autenticador, use essa cópia; se perder ambos, será necessário o proprietário recuperar o fator no painel após verificar a identidade. O app não oferece um atalho que ignore a segunda verificação.

## 4. Validar antes de publicar

1. Exporte um backup na versão antiga do site e guarde-o privadamente.
2. Teste localmente com `npm run dev`, entre na conta e cadastre o autenticador.
3. Confira se a conta começa vazia. O histórico do site antigo pode não aparecer no servidor local porque são endereços diferentes; isso é esperado.
4. Use apenas uma despesa fictícia para testar salvar, sair e entrar novamente. Confirme “Sincronizado”.
5. Teste o login sem o segundo fator: não deve exibir despesas. Teste recuperação por e-mail no endereço publicado quando a versão estiver disponível.
6. Depois desses testes, revisar commit e publicação na `main`. A branch de desenvolvimento não deve substituir o site antes da configuração.
7. Na versão publicada, entre e use “Importar histórico antigo para minha conta” se a conta estiver vazia, ou restaure seu backup pela interface com confirmação. Uma restauração substitui os dados da conta em todos os aparelhos.
8. Entre em outro aparelho e confira as despesas. Teste também editar a mesma informação nos dois aparelhos: a segunda gravação deve sinalizar conflito, sem sobrescrever silenciosamente.

## Limites desta entrega

Não há edição offline, backups automáticos do banco ou promessa de disponibilidade no plano Free. O backup manual continua necessário. Login protege o acesso ao banco; não criptografa os JSON já baixados nem o histórico antigo que permanece no navegador. Use bloqueio de tela no aparelho.

O app só armazena despesas da conta após login, segundo fator e autorização explícita da migração. A API pública é identificada pela chave publishable; autenticação, lista de contas autorizadas, RLS e a função de gravação fazem o controle de acesso. As escritas diretas na tabela são bloqueadas para evitar que o controle de conflitos seja contornado.

Referências: https://supabase.com/docs/guides/database/postgres/row-level-security e https://supabase.com/docs/guides/auth/auth-smtp
