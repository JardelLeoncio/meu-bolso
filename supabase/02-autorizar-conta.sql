-- Primeiro crie sua conta em Authentication > Users > Add user > Create new user.
-- Copie o User UID do painel e substitua SOMENTE o texto abaixo.
-- UID é identificador, não senha. Este arquivo não deve conter seu e-mail/senha.
insert into bolso_private.members(user_id)
values ('COLE-O-USER-UID-AQUI'::uuid)
on conflict do nothing;
