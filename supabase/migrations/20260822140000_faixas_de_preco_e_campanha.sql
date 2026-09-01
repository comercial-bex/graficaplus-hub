-- Preço por faixa de quantidade + identificação legal de material de campanha.
--
-- Motivo: o catálogo comercial da campanha 2026 vende POR PEÇA com quatro a seis
-- faixas de quantidade por produto (praguinha 1.000/3.000/5.000/10.000, perfurado
-- 50/100/200/300/500/1.000...). O sistema só tinha `preco_base`, um número único
-- por produto. Vender pelo catálogo hoje significaria o vendedor abrir o PDF e
-- digitar o preço à mão — o mesmo "no olho" que já corrigimos no custo.

create table if not exists public.produto_faixas_preco (
  id uuid primary key default gen_random_uuid(),
  produto_id uuid not null references public.produtos(id) on delete cascade,
  quantidade_minima integer not null check (quantidade_minima > 0),
  preco_unitario numeric(12,4) not null check (preco_unitario >= 0),
  -- A régua do catálogo (R$ 75 a R$ 47/m², perfurado R$ 92 a R$ 58). NÃO é a área
  -- da peça pronta: é a tarifa sobre a bobina que cada peça consome, já com o
  -- refile. Guardada para o vendedor conseguir explicar o preço ao cliente.
  preco_m2_referencia numeric(12,2),
  vigencia_inicio date,
  vigencia_fim date,
  observacao text,
  created_at timestamptz not null default now(),
  unique (produto_id, quantidade_minima)
);

comment on table public.produto_faixas_preco is
  'Preço unitário por faixa de quantidade. A menor faixa é também o pedido mínimo do produto.';

alter table public.produto_faixas_preco enable row level security;

create policy "faixas staff read" on public.produto_faixas_preco
  for select using (is_staff((select auth.uid())));

create policy "faixas manage" on public.produto_faixas_preco
  for all using (has_permission((select auth.uid()), 'custos.update'))
  with check (has_permission((select auth.uid()), 'custos.update'));

create index if not exists idx_faixas_produto on public.produto_faixas_preco (produto_id, quantidade_minima desc);

-- ---------------------------------------------------------------------------
-- Preço da faixa para uma quantidade.
--
-- Pega a MAIOR faixa que cabe na quantidade pedida. É isso que atende a regra
-- "acima de 10.000 unidades mantém-se o valor unitário da faixa de 10.000":
-- não existe faixa acima, então a de 10.000 continua valendo.
--
-- Quantidade abaixo da menor faixa devolve nulo — é pedido abaixo do mínimo, e
-- inventar um preço ali esconderia do vendedor que aquilo não se vende.
-- ---------------------------------------------------------------------------
create or replace function public.preco_da_faixa(p_produto_id uuid, p_quantidade integer)
returns table (
  preco_unitario numeric,
  preco_m2_referencia numeric,
  quantidade_minima integer,
  proxima_faixa integer,
  economia_na_proxima numeric
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with faixa as (
    select f.preco_unitario, f.preco_m2_referencia, f.quantidade_minima
    from public.produto_faixas_preco f
    where f.produto_id = p_produto_id
      and f.quantidade_minima <= p_quantidade
      and (f.vigencia_fim is null or f.vigencia_fim >= current_date)
    order by f.quantidade_minima desc
    limit 1
  ),
  seguinte as (
    -- Quanto o cliente economizaria subindo para a próxima faixa. É o argumento
    -- de venda que o catálogo faz no papel e a tela não fazia.
    select f.quantidade_minima, f.preco_unitario
    from public.produto_faixas_preco f
    where f.produto_id = p_produto_id
      and f.quantidade_minima > p_quantidade
      and (f.vigencia_fim is null or f.vigencia_fim >= current_date)
    order by f.quantidade_minima asc
    limit 1
  )
  select faixa.preco_unitario,
         faixa.preco_m2_referencia,
         faixa.quantidade_minima,
         seguinte.quantidade_minima,
         case when seguinte.preco_unitario is not null
              then round((faixa.preco_unitario - seguinte.preco_unitario) * seguinte.quantidade_minima, 2)
         end
  from faixa left join seguinte on true;
$$;

comment on function public.preco_da_faixa is
  'Preço unitário vigente para a quantidade, mais a próxima faixa e a economia dela.';

grant execute on function public.preco_da_faixa(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Identificação legal do material de campanha.
--
-- A Lei nº 9.504/1997 exige que TODO material impresso de campanha traga o CNPJ
-- da gráfica, o CNPJ ou CPF de quem contratou e a TIRAGEM. O catálogo promete
-- isso em todas as peças; o sistema não compunha esse texto em lugar nenhum, e
-- material sem a identificação é problema na prestação de contas do cliente.
--
-- A função monta a linha a partir do que já existe — não pede cadastro novo.
-- ---------------------------------------------------------------------------
create or replace function public.identificacao_legal_os(p_os_id uuid)
returns text
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_cnpj_grafica text;
  v_contratante text;
  v_doc text;
  v_tiragem integer;
begin
  select cnpj into v_cnpj_grafica from public.empresa_config limit 1;

  -- nullif antes do coalesce: razao_social vem como string em branco em vários
  -- cadastros, e o coalesce puro escolhia o vazio — a linha saía "para  (CPF)".
  select coalesce(nullif(btrim(c.razao_social), ''), nullif(btrim(c.nome), '')),
         coalesce(nullif(btrim(c.documento), ''), nullif(btrim(c.cpf_cnpj), ''))
    into v_contratante, v_doc
  from public.ordens_servico os
  join public.clientes c on c.id = os.cliente_id
  where os.id = p_os_id;

  select sum(i.quantidade)::integer into v_tiragem
  from public.itens_os i where i.os_id = p_os_id;

  -- Faltando qualquer parte, devolve nulo em vez de uma linha pela metade: meia
  -- identificação legal não cumpre a lei e daria a impressão de que cumpre.
  if v_cnpj_grafica is null or v_doc is null or v_contratante is null or coalesce(v_tiragem, 0) = 0 then
    return null;
  end if;

  return format(
    'Impresso por CNPJ %s para %s (%s). Tiragem: %s exemplares. Art. 38, Lei 9.504/1997.',
    v_cnpj_grafica, v_contratante, v_doc, v_tiragem
  );
end;
$$;

comment on function public.identificacao_legal_os is
  'Linha obrigatória em material de campanha: CNPJ da gráfica, contratante e tiragem.';

grant execute on function public.identificacao_legal_os(uuid) to authenticated;
