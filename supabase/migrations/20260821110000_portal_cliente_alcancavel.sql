-- Portal do cliente: dar um caminho para ele existir.
--
-- Diagnóstico: `portal_cliente_acessos` tinha UMA policy, de SELECT do próprio
-- registro. Sem INSERT, o RLS recusava a criação do vínculo para qualquer um,
-- inclusive admin — e não havia função, trigger nem tela que criasse. A tela do
-- portal chegava a instruir o cliente a "solicitar que cadastrem seu acesso em
-- portal_cliente_acessos", ou seja, alguém digitar direto na tabela.
--
-- Segundo beco: `portal_cliente_solicitacoes` só era legível pelo próprio
-- cliente. Uma dúvida enviada pelo portal não era lida por ninguém da gráfica.

-- ---------------------------------------------------------------------------
-- Acessos: o cliente lê o próprio vínculo; o comercial administra.
-- ---------------------------------------------------------------------------
create policy "portal acesso staff read" on public.portal_cliente_acessos
  for select using (
    is_staff((select auth.uid())) and has_permission((select auth.uid()), 'clientes.read')
  );

create policy "portal acesso staff write" on public.portal_cliente_acessos
  for update using (has_permission((select auth.uid()), 'clientes.update'))
  with check (has_permission((select auth.uid()), 'clientes.update'));

create policy "portal acesso staff delete" on public.portal_cliente_acessos
  for delete using (has_permission((select auth.uid()), 'clientes.update'));

-- O INSERT fica só pela RPC abaixo: criar o vínculo sem o papel `cliente` deixa
-- o usuário parado numa rota que o guarda recusa. As duas coisas andam juntas.

-- ---------------------------------------------------------------------------
-- Solicitações: quem atende precisa ler e responder.
-- ---------------------------------------------------------------------------
create policy "portal solicitacao staff read" on public.portal_cliente_solicitacoes
  for select using (
    is_staff((select auth.uid())) and has_permission((select auth.uid()), 'clientes.read')
  );

create policy "portal solicitacao staff update" on public.portal_cliente_solicitacoes
  for update using (has_permission((select auth.uid()), 'clientes.update'))
  with check (has_permission((select auth.uid()), 'clientes.update'));

-- ---------------------------------------------------------------------------
-- Vínculo em uma operação só.
--
-- Precisa ser SECURITY DEFINER porque `user_roles` é escrita só por admin: sem
-- isso, um gestor criaria o acesso e o usuário esbarraria no guarda de rota,
-- que exige o papel `cliente`. A permissão exigida é clientes.update — a mesma
-- de quem edita o cadastro do cliente.
-- ---------------------------------------------------------------------------
create or replace function public.vincular_usuario_ao_portal(
  p_usuario_id uuid,
  p_cliente_id uuid
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_email text;
begin
  perform public.require_permission('clientes.update');

  select email into v_email from public.usuarios where id = p_usuario_id;
  if not found then
    raise exception 'Usuário não encontrado. Ele precisa criar o login antes de ser vinculado.';
  end if;

  if not exists (select 1 from public.clientes where id = p_cliente_id) then
    raise exception 'Cliente não encontrado';
  end if;

  -- Funcionário não vira usuário de portal: acumular o papel `cliente` sobre um
  -- papel de staff confunde o que cada tela mostra e não é o que ninguém quis.
  if public.is_staff(p_usuario_id) then
    raise exception 'Este usuário é da equipe. O portal é para contatos do cliente.';
  end if;

  insert into public.user_roles (user_id, role)
  values (p_usuario_id, 'cliente')
  on conflict do nothing;

  insert into public.portal_cliente_acessos (usuario_id, cliente_id, ativo)
  values (p_usuario_id, p_cliente_id, true)
  on conflict do nothing;

  -- Reativa um vínculo que tinha sido desligado, em vez de falhar em silêncio
  -- no ON CONFLICT e devolver "sucesso" sem ter religado nada.
  update public.portal_cliente_acessos
     set ativo = true
   where usuario_id = p_usuario_id and cliente_id = p_cliente_id;

  return jsonb_build_object('usuario_id', p_usuario_id, 'cliente_id', p_cliente_id, 'email', v_email);
end;
$$;

comment on function public.vincular_usuario_ao_portal is
  'Liga um usuário já cadastrado ao portal de um cliente, garantindo o papel cliente.';

revoke all on function public.vincular_usuario_ao_portal(uuid, uuid) from public;
grant execute on function public.vincular_usuario_ao_portal(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Busca de candidatos ao portal.
--
-- `usuarios` só é legível pelo próprio registro (fora admin e gestor), então o
-- comercial não conseguiria encontrar por e-mail quem acabou de criar o login.
-- Esta função devolve só id, nome e e-mail de quem NÃO é da equipe — o mínimo
-- para escolher a pessoa certa, sem abrir a tabela inteira.
-- ---------------------------------------------------------------------------
create or replace function public.buscar_usuario_para_portal(p_busca text)
returns table (id uuid, nome text, email text)
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform public.require_permission('clientes.update');
  if coalesce(length(btrim(p_busca)), 0) < 3 then
    return;
  end if;
  return query
    select u.id, u.nome, u.email
    from public.usuarios u
    where not public.is_staff(u.id)
      and (u.email ilike '%' || btrim(p_busca) || '%' or u.nome ilike '%' || btrim(p_busca) || '%')
    order by u.email
    limit 10;
end;
$$;

comment on function public.buscar_usuario_para_portal is
  'Procura por e-mail/nome quem pode ser vinculado ao portal, sem expor a tabela usuarios.';

revoke all on function public.buscar_usuario_para_portal(text) from public;
grant execute on function public.buscar_usuario_para_portal(text) to authenticated;
