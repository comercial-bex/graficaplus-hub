-- Breakdown 3D: o que foi orçado por peça, e o que a peça custou de verdade.
--
-- `orcamento_3d_calculos` já guarda a quebra completa — material, máquina,
-- energia, mão de obra, acabamento, risco, indireto — e a tela de detalhe mostra
-- isso muito bem, uma peça por vez. Só que quem forma preço precisa do conjunto:
-- em quais peças a conta errou, e para que lado.
--
-- Do lado do realizado, os números agora existem: filamento saiu do estoque e
-- hora de máquina virou apontamento. Antes desta semana não havia com o que
-- comparar.

create or replace function public.breakdown_3d(
  p_inicio date default (current_date - interval '90 days')::date,
  p_fim date default current_date
)
returns table (
  orcamento_id uuid,
  titulo text,
  cliente text,
  status text,
  quantidade integer,
  -- orçado
  custo_material numeric,
  custo_maquina numeric,
  custo_energia numeric,
  custo_mao_obra numeric,
  custo_acabamento numeric,
  custo_indireto numeric,
  custo_operacional numeric,
  markup numeric,
  margem numeric,
  preco numeric,
  valor_unitario numeric,
  -- realizado
  gramas_reais numeric,
  custo_material_real numeric,
  horas_reais numeric,
  custo_maquina_real numeric,
  produzido boolean,
  divergencia_material numeric
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with ultimo_calculo as (
    -- Um orçamento pode ter várias versões de cálculo. Vale a última: é a que
    -- gerou o preço que foi para o cliente.
    select distinct on (c.orcamento_3d_id) c.*
    from public.orcamento_3d_calculos c
    order by c.orcamento_3d_id, c.versao desc, c.created_at desc
  ),
  real_material as (
    select j.orcamento_3d_id,
           sum(me.quantidade) as gramas,
           sum(me.quantidade * coalesce(me.custo_unitario_snapshot, 0)) as custo
    from public.movimentacoes_estoque me
    join public.producao_3d_jobs j on j.os_id = me.os_id
    where me.origem = 'producao_3d'
    group by j.orcamento_3d_id
  ),
  real_maquina as (
    select j.orcamento_3d_id,
           sum(a.tempo_real_segundos) / 3600.0 as horas,
           sum(a.tempo_real_segundos) / 3600.0
             * coalesce(mc.custo_hora_manual, mc.custo_hora_calculado, 0) as custo
    from public.producao_3d_apontamentos a
    join public.producao_3d_jobs j on j.id = a.job_id
    left join public.maquinas_3d_config mc on mc.maquina_id = j.maquina_id
    group by j.orcamento_3d_id, mc.custo_hora_manual, mc.custo_hora_calculado
  )
  select o.id,
         o.titulo,
         coalesce(cl.nome, o.contato_nome, 'Sem cliente'),
         o.status::text,
         coalesce(o.quantidade, 1),
         round(coalesce(k.custo_material, 0), 2),
         round(coalesce(k.custo_maquina, 0), 2),
         round(coalesce(k.custo_energia, 0), 2),
         round(coalesce(k.custo_mao_obra, 0), 2),
         round(coalesce(k.custo_acabamento, 0), 2),
         round(coalesce(k.custo_indireto, 0), 2),
         round(coalesce(k.custo_operacional, 0), 2),
         round(coalesce(k.markup, 0), 3),
         round(coalesce(k.margem, 0), 4),
         round(coalesce(o.preco_comercial, k.preco_sugerido, 0), 2),
         round(coalesce(k.valor_unitario, 0), 2),
         round(coalesce(rm.gramas, 0), 2),
         round(coalesce(rm.custo, 0), 2),
         round(coalesce(rq.horas, 0), 2),
         round(coalesce(rq.custo, 0), 2),
         (rm.gramas is not null or rq.horas is not null),
         -- Só faz sentido comparar o que foi produzido. Sem produção, a
         -- divergência seria o custo orçado inteiro aparecendo como economia.
         case when rm.custo is not null
              then round(rm.custo - coalesce(k.custo_material, 0), 2)
         end
  from public.orcamentos_3d o
  left join ultimo_calculo k on k.orcamento_3d_id = o.id
  left join public.clientes cl on cl.id = o.cliente_id
  left join real_material rm on rm.orcamento_3d_id = o.id
  left join real_maquina rq on rq.orcamento_3d_id = o.id
  where o.created_at::date between p_inicio and p_fim
  order by o.created_at desc
$$;

comment on function public.breakdown_3d is
  'Quebra de custo orçada por peça 3D e o realizado quando houve produção.';

grant execute on function public.breakdown_3d(date, date) to authenticated;
