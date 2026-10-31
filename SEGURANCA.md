# Ativação da proteção

Esta versão exige aplicar supabase/03-protecao.sql depois de 01-banco.sql. Não reaplique 01 depois de 03: a primeira migração recria permissões antigas. Para instalação nova use 01, 02 e 03 nessa ordem.

## O que está implementado
- Consulta por bolso_read (POST); tabela não pode ser consultada diretamente pelo cliente.
- Limites por conta: 120 leituras e 30 gravações por janela de um minuto. Janela compartilhada entre aparelhos. Excesso retorna PT429. Limite conta operações concluídas; transações que falham são revertidas, inclusive seus contadores.
- Sessão precisa existir em auth.sessions, pertencer ao usuário, ter MFA e conta autorizada. Sessão revogada é recusada nas próximas leituras/gravações mesmo com JWT ainda não expirado.
- Sair de todos os aparelhos revoga as sessões pelo Supabase. Dados já baixados não podem ser apagados remotamente.
- Suporte ao Cloudflare Turnstile no login e recuperação de senha.

## Configuração administrativa pendente
1. No Supabase SQL Editor execute 03-protecao.sql. A versão antiga do site deixará de ler os dados até publicar esta versão: faça a troca em sequência numa janela de manutenção.
2. Crie um widget Turnstile Free para jardelleoncio.github.io (e 127.0.0.1 se testar localmente). Coloque somente a Site Key pública em TURNSTILE_SITE_KEY em src/config.js. A Secret Key deve ir SOMENTE ao painel Supabase, Authentication > Bot and Abuse Protection. Nunca ao GitHub, navegador ou chat.
3. Compile com npm run build, publique a versão e habilite CAPTCHA no Supabase na mesma janela. Não habilite só o painel sem publicar a configuração do widget, pois isso impede o login.
4. Confira Authentication > Rate Limits: limites de token/login, recuperação e envio de e-mail. Os limites por IP e CAPTCHA são aplicados pelo Supabase; este SQL não limita tentativas de senha. Ajuste considerando renovação automática e uso em vários aparelhos. Não foi configurado um bloqueio após cinco erros.
5. Configure tamanho mínimo de senha no servidor e reautenticação para troca de senha. Ative MFA nas contas administrativas GitHub, Supabase e e-mail. São ajustes que não podem ser comprovados pelo código público.
6. Valide login real, CAPTCHA inválido/ausente, leitura, gravação e revogação entre dois navegadores. Os testes locais usam dados e autenticação simulados.

## Limites
Rate limiting no banco não impede que uma chamada alcance a infraestrutura, não protege todo endpoint do Supabase e não equivale a proteção completa contra DDoS. Não foram executados testes de sobrecarga em produção. Logs/alertas externos e bloqueio de tentativas distribuídas não estão configurados. A sessão persistente no navegador exige proteção do aparelho contra acesso indevido, extensões maliciosas e roubo de sessão. Não há criptografia ponta a ponta dos dados nem dos backups JSON. A integração com bancos ainda não está implementada; seus segredos deverão ficar no servidor. Não colocar dados financeiros em commits, issues, logs ou arquivos públicos.
