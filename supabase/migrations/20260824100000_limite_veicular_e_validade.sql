-- Avisos legais e de validade no momento de orçar.
--
-- As exigências de cada produto já estavam gravadas (0,5 m² por carroceria,
-- perfurado só no vidro traseiro) e não apareciam em lugar nenhum na hora da
-- venda — ficavam num campo que só quem edita o produto vê.

-- ---------------------------------------------------------------------------
-- Quais produtos entram no limite da carroceria.
--
-- O limite da Justiça Eleitoral é POR VEÍCULO: a soma de todos os adesivos na
-- carroceria de um carro não passa de 0,5 m². Não é por pedido — 200 bolas para
-- 200 carros estão corretas, e somar o orçamento inteiro daria alarme falso.
-- Por isso a marca é no produto, e a conta útil é "quantas peças cabem em um
-- veículo", não "quanto este orçamento soma".
-- ---------------------------------------------------------------------------
alter table public.produtos
  add column if not exists conta_no_limite_carroceria boolean not null default false;

comment on column public.produtos.conta_no_limite_carroceria is
  'Adesivo aplicado na lataria: entra na soma de 0,5 m² por veículo (Justiça Eleitoral).';

-- Vinil leitoso vai na lataria. O perfurado NÃO entra nesta conta: ele é do
-- vidro traseiro, que tem regra própria e pode ocupar o vidro inteiro.
update public.produtos
   set conta_no_limite_carroceria = true
 where nome in (
   'Bola Leitoso 33 × 33 cm',
   'Bolão Leitoso 48 × 48 cm',
   'Pragão 15 × 15 cm',
   'Pragão 30 × 30 cm'
 );

-- ---------------------------------------------------------------------------
-- preco_da_faixa: devolver a validade em vez de sumir com o preço.
--
-- A versão anterior filtrava faixas vencidas, então depois de 30/09 a função
-- não devolveria nada — e a tela leria isso como "quantidade abaixo do pedido
-- mínimo", que é uma mensagem errada para um problema diferente. Agora o preço
-- vem sempre, acompanhado da data, e quem decide o que dizer é a tela.
-- ---------------------------------------------------------------------------
-- O tipo de retorno mudou (ganhou validade), e CREATE OR REPLACE não altera
-- assinatura de OUT — precisa derrubar antes.
drop function if exists public.preco_da_faixa(uuid, integer);

create function public.preco_da_faixa(p_produto_id uuid, p_quantidade integer)
returns table (
  preco_unitario numeric,
  preco_m2_referencia numeric,
  quantidade_minima integer,
  proxima_faixa integer,
  economia_na_proxima numeric,
  vigencia_fim date,
  dias_para_vencer integer
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with faixa as (
    select f.preco_unitario, f.preco_m2_referencia, f.quantidade_minima, f.vigencia_fim
    from public.produto_faixas_preco f
    where f.produto_id = p_produto_id
      and f.quantidade_minima <= p_quantidade
    order by f.quantidade_minima desc
    limit 1
  ),
  seguinte as (
    select f.quantidade_minima, f.preco_unitario
    from public.produto_faixas_preco f
    where f.produto_id = p_produto_id
      and f.quantidade_minima > p_quantidade
    order by f.quantidade_minima asc
    limit 1
  )
  select faixa.preco_unitario,
         faixa.preco_m2_referencia,
         faixa.quantidade_minima,
         seguinte.quantidade_minima,
         case when seguinte.preco_unitario is not null
              then round((faixa.preco_unitario - seguinte.preco_unitario) * seguinte.quantidade_minima, 2)
         end,
         faixa.vigencia_fim,
         case when faixa.vigencia_fim is not null
              then (faixa.vigencia_fim - current_date)::integer
         end
  from faixa left join seguinte on true;
$$;

comment on function public.preco_da_faixa is
  'Preço unitário da faixa, a próxima faixa, a economia dela e a validade da tabela.';

grant execute on function public.preco_da_faixa(uuid, integer) to authenticated;
