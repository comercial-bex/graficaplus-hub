-- Escopar a leitura de clientes e separar o portal do CRM.
--
-- Diagnóstico: a policy de SELECT em `clientes` era has_permission('clientes.read'),
-- e o papel `cliente` tem exatamente essa permissão (é a única que ele tem). Um
-- usuário de portal logado, portanto, lia a base inteira: nome, CNPJ, telefone e
-- endereço de todos os outros clientes da gráfica. O acesso do portal já é
-- controlado por portal_cliente_acessos — é assim que pos_venda_pesquisas faz —,
-- mas `clientes` nunca passou a usar esse vínculo.

-- 1) O portal ganha permissão própria, para deixar de tomar emprestada a do CRM.
--    perfil_permissoes tem FK para permissoes, então a chave entra no catálogo antes.
insert into public.permissoes (chave, dominio, descricao)
values ('portal.read', 'portal', 'Acessar o portal do cliente e ver o próprio cadastro e pedidos')
on conflict (chave) do nothing;

insert into public.perfil_permissoes (perfil, permissao)
values ('cliente', 'portal.read')
on conflict do nothing;

-- 2) O papel cliente deixa de carregar a permissão do CRM interno.
delete from public.perfil_permissoes
where perfil = 'cliente' and permissao = 'clientes.read';

-- 3) Leitura escopada: staff vê a carteira, usuário de portal vê o próprio cadastro.
drop policy if exists "clientes permission read" on public.clientes;

create policy "clientes read" on public.clientes
  for select using (
    (is_staff((select auth.uid())) and has_permission((select auth.uid()), 'clientes.read'))
    or exists (
      select 1 from public.portal_cliente_acessos a
      where a.usuario_id = (select auth.uid())
        and a.cliente_id = clientes.id
        and a.ativo
    )
  );
