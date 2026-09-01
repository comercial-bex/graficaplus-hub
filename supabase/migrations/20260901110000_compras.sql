-- Compras: o módulo que faltava inteiro.
--
-- Nos sistemas do setor, a compra nasce da necessidade do job: o material que a
-- OS pede e o estoque não cobre vira requisição, que vira pedido ao fornecedor,
-- que ao ser recebido entra no estoque. Aqui não havia nem tabela — a falta era
-- descoberta na hora de separar, quando já é tarde para comprar.
--
-- O recebimento NÃO reimplementa a entrada de material: chama
-- `registrar_entrada_material`, que já cria lote, grava a movimentação e
-- recalcula o custo médio ponderado. Duplicar essa lógica seria a forma mais
-- rápida de ter dois custos médios diferentes no mesmo sistema.

-- ---------------------------------------------------------------------------
-- Permissões
-- ---------------------------------------------------------------------------
insert into public.permissoes (chave, descricao, dominio) values
  ('compras.read',    'Ver pedidos de compra',        'compras'),
  ('compras.create',  'Criar pedido de compra',       'compras'),
  ('compras.receive', 'Receber pedido de compra',     'compras'),
  ('compras.cancel',  'Cancelar pedido de compra',    'compras')
on conflict (chave) do nothing;

-- Quem compra é quem gerencia e quem cuida do estoque. O financeiro acompanha.
insert into public.perfil_permissoes (perfil, permissao) values
  ('gestor','compras.read'), ('gestor','compras.create'),
  ('gestor','compras.receive'), ('gestor','compras.cancel'),
  ('estoque','compras.read'), ('estoque','compras.create'), ('estoque','compras.receive'),
  ('financeiro','compras.read'),
  ('admin','compras.read'), ('admin','compras.create'),
  ('admin','compras.receive'), ('admin','compras.cancel')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Pedido de compra
-- ---------------------------------------------------------------------------
create table if not exists public.pedidos_compra (
  id uuid primary key default gen_random_uuid(),
  numero serial unique,
  fornecedor text not null,
  status text not null default 'rascunho'
    check (status in ('rascunho','enviado','recebido_parcial','recebido','cancelado')),
  previsao_entrega date,
  observacoes text,
  -- De onde veio a necessidade. Nulo quando é compra de reposição, sem OS.
  os_id uuid references public.ordens_servico(id) on delete set null,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.pedidos_compra is
  'Pedido ao fornecedor. Nasce da falta de material da OS ou de reposição de estoque.';

create table if not exists public.pedido_compra_itens (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.pedidos_compra(id) on delete cascade,
  material_id uuid not null references public.materiais(id),
  quantidade numeric(14,4) not null check (quantidade > 0),
  quantidade_recebida numeric(14,4) not null default 0 check (quantidade_recebida >= 0),
  custo_unitario numeric(14,4) not null check (custo_unitario >= 0),
  created_at timestamptz not null default now(),
  unique (pedido_id, material_id)
);

comment on column public.pedido_compra_itens.quantidade_recebida is
  'Recebimento parcial é a regra, não a exceção: fornecedor manda o que tem.';

create index if not exists idx_pedido_compra_status on public.pedidos_compra (status, created_at desc);
create index if not exists idx_pedido_itens_pedido on public.pedido_compra_itens (pedido_id);
create index if not exists idx_pedido_itens_material on public.pedido_compra_itens (material_id);

alter table public.pedidos_compra enable row level security;
alter table public.pedido_compra_itens enable row level security;

create policy "compra read" on public.pedidos_compra
  for select using (has_permission((select auth.uid()), 'compras.read'));
create policy "compra write" on public.pedidos_compra
  for all using (has_permission((select auth.uid()), 'compras.create'))
  with check (has_permission((select auth.uid()), 'compras.create'));

create policy "compra item read" on public.pedido_compra_itens
  for select using (has_permission((select auth.uid()), 'compras.read'));
create policy "compra item write" on public.pedido_compra_itens
  for all using (has_permission((select auth.uid()), 'compras.create'))
  with check (has_permission((select auth.uid()), 'compras.create'));

-- ---------------------------------------------------------------------------
-- O que comprar para uma OS.
--
-- Reaproveita materiais_faltantes_os e acrescenta o custo da última compra, que
-- é o número que a pessoa usa para preencher o pedido.
-- ---------------------------------------------------------------------------
create or replace function public.sugerir_compra_da_os(p_os_id uuid)
returns table (
  material_id uuid,
  material text,
  unidade text,
  faltante numeric,
  ultimo_custo numeric,
  fornecedor_sugerido text
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select f.material_id,
         f.material,
         f.unidade,
         f.faltante,
         coalesce(m.custo_unitario, m.custo_medio, 0),
         m.fornecedor
  from public.materiais_faltantes_os(p_os_id) f
  join public.materiais m on m.id = f.material_id
  where f.faltante > 0
$$;

comment on function public.sugerir_compra_da_os is
  'Materiais em falta para a OS, com o último custo e o fornecedor, para preencher o pedido.';

grant execute on function public.sugerir_compra_da_os(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Receber — e entrar no estoque de verdade.
-- ---------------------------------------------------------------------------
create or replace function public.receber_item_compra(
  p_item_id uuid,
  p_quantidade numeric,
  p_custo_unitario numeric default null,
  p_nota text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid;
  v_item public.pedido_compra_itens%rowtype;
  v_pedido public.pedidos_compra%rowtype;
  v_entrada jsonb;
  v_falta numeric;
  v_pendentes int;
begin
  v_uid := public.require_permission('compras.receive');

  select * into v_item from public.pedido_compra_itens where id = p_item_id for update;
  if not found then raise exception 'Item do pedido não encontrado'; end if;

  select * into v_pedido from public.pedidos_compra where id = v_item.pedido_id for update;
  if v_pedido.status = 'cancelado' then
    raise exception 'Este pedido foi cancelado.';
  end if;

  if p_quantidade is null or p_quantidade <= 0 then
    raise exception 'Informe a quantidade recebida.';
  end if;

  v_falta := v_item.quantidade - v_item.quantidade_recebida;
  if p_quantidade > v_falta then
    raise exception 'O pedido tem % pendente e o recebimento informa %.', v_falta, p_quantidade;
  end if;

  -- A entrada é feita pela função que já existe: ela cria o lote, grava a
  -- movimentação e recalcula o custo médio ponderado. Reimplementar aqui daria
  -- dois custos médios divergentes para o mesmo material.
  v_entrada := public.registrar_entrada_material(
    v_item.material_id,
    p_quantidade,
    coalesce(p_custo_unitario, v_item.custo_unitario),
    v_pedido.fornecedor,
    coalesce(p_nota, 'Pedido de compra #' || v_pedido.numero)
  );

  update public.pedido_compra_itens
     set quantidade_recebida = quantidade_recebida + p_quantidade
   where id = p_item_id;

  select count(*) into v_pendentes
  from public.pedido_compra_itens i
  where i.pedido_id = v_pedido.id and i.quantidade_recebida < i.quantidade;

  update public.pedidos_compra
     set status = case when v_pendentes = 0 then 'recebido' else 'recebido_parcial' end,
         updated_at = now()
   where id = v_pedido.id;

  return jsonb_build_object(
    'item_id', p_item_id,
    'recebido', p_quantidade,
    'lote_id', v_entrada->'lote_id',
    'custo_medio', v_entrada->'custo_medio',
    'pedido_status', case when v_pendentes = 0 then 'recebido' else 'recebido_parcial' end,
    'itens_pendentes', v_pendentes
  );
end;
$$;

comment on function public.receber_item_compra is
  'Recebe (total ou parcial) um item do pedido e dá entrada no estoque pela via oficial.';

revoke all on function public.receber_item_compra(uuid, numeric, numeric, text) from public;
grant execute on function public.receber_item_compra(uuid, numeric, numeric, text) to authenticated;

-- Toda mudança de pedido entra na trilha: compra é dinheiro saindo.
drop trigger if exists tg_auditar_pedidos_compra on public.pedidos_compra;
create trigger tg_auditar_pedidos_compra
  after insert or update or delete on public.pedidos_compra
  for each row execute function public.tg_auditar();
