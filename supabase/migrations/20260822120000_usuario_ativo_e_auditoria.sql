-- Fazer `usuarios.ativo` valer alguma coisa.
--
-- Diagnóstico: a coluna existe, tem default true — e NADA no banco a consulta.
-- Desativar alguém na tela não tiraria nenhum acesso: a pessoa continuaria
-- entrando e enxergando tudo do papel dela. Desligar um funcionário é a operação
-- que mais precisa funcionar de primeira, e era a única que não fazia nada.
--
-- A verificação entra em has_permission e is_staff porque são os dois pontos por
-- onde todo o RLS passa. Bloquear aqui fecha o sistema inteiro de uma vez, em vez
-- de depender de cada policy lembrar de checar.

-- IMPORTANTE: a regra é "bloqueia quem está explicitamente inativo", não "só
-- passa quem está explicitamente ativo". Se um usuário existir em user_roles sem
-- linha em `usuarios`, a segunda forma o trancaria para fora sem motivo — e é
-- exatamente o tipo de detalhe que derruba o sistema inteiro numa migração.
create or replace function public.usuario_desativado(_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.usuarios u where u.id = _user_id and u.ativo is false
  )
$$;

comment on function public.usuario_desativado is
  'True apenas para usuário marcado como inativo. Ausência de cadastro não bloqueia.';

create or replace function public.has_permission(_user_id uuid, _permission text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.role_permission_matrix rpm on rpm.role = ur.role
    where ur.user_id = _user_id
      and rpm.permission = _permission
  )
  and not public.usuario_desativado(_user_id)
$$;

create or replace function public.is_staff(_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id
      and role in ('admin','gestor','financeiro','vendedor','designer','operador','estoque','instalador')
  )
  and not public.usuario_desativado(_user_id)
$$;

-- Desligar e religar alguém é decisão de acesso: entra na mesma trilha das
-- mudanças de papel.
drop trigger if exists tg_auditar_usuarios on public.usuarios;
create trigger tg_auditar_usuarios
  after update or delete on public.usuarios
  for each row execute function public.tg_auditar();

create index if not exists idx_usuarios_ativo on public.usuarios (ativo) where ativo is false;

-- A matriz de permissões virou editável pela tela nesta mesma leva. Mudar o que
-- um perfil pode fazer alcança todo mundo daquele perfil de uma vez — é mais
-- amplo que mudar o papel de uma pessoa, e estava saindo sem deixar rastro.
drop trigger if exists tg_auditar_perfil_permissoes on public.perfil_permissoes;
create trigger tg_auditar_perfil_permissoes
  after insert or update or delete on public.perfil_permissoes
  for each row execute function public.tg_auditar();
