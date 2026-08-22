-- Auto-cadastro: a pessoa se registra e o administrador libera.
--
-- A tela /signup já existia e criava a conta, mas jogava a pessoa em /dashboard —
-- onde ela não tem papel nenhum e o guarda, que é deny-by-default, responde
-- "Acesso restrito". Conta criada com sucesso e uma tela de erro na cara: parece
-- defeito, e o administrador nem fica sabendo que alguém está esperando.
--
-- Aqui o cadastro passa a carregar o que a pessoa faz. Sem isso o administrador
-- recebe um e-mail solto na lista e precisa adivinhar se aquilo é o impressor, o
-- vendedor ou alguém que não deveria estar ali.

alter table public.usuarios
  add column if not exists cargo_pretendido text;

comment on column public.usuarios.cargo_pretendido is
  'O que a pessoa declarou fazer ao se cadastrar. Sugestão para o admin, nunca concede acesso.';

-- O gatilho de criação só copiava o nome; telefone e cargo vinham no cadastro e
-- eram descartados no caminho.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_primeiro boolean;
begin
  insert into public.usuarios (id, nome, email, telefone, cargo_pretendido)
  values (
    new.id,
    coalesce(nullif(btrim(new.raw_user_meta_data->>'nome'), ''), split_part(new.email, '@', 1)),
    new.email,
    nullif(btrim(new.raw_user_meta_data->>'telefone'), ''),
    nullif(btrim(new.raw_user_meta_data->>'cargo_pretendido'), '')
  );

  -- O primeiro usuário do sistema vira admin — sem isso não haveria ninguém para
  -- liberar ninguém. A partir do segundo, todo mundo entra sem papel e espera.
  select count(*) = 0 into v_primeiro from public.user_roles;
  if v_primeiro then
    insert into public.user_roles (user_id, role) values (new.id, 'admin');
  end if;

  return new;
end;
$$;
