-- Planilha de custos: um lugar só para tarifa, mão de obra e custo de material.
--
-- Hoje esses números moram em três lugares que ninguém liga: `materiais`
-- (custo por unidade), `custos_mao_de_obra` (por função — ZERO linhas) e
-- `config_precificacao_3d` (energia, markup, custo admin). Sem uma tela que
-- mostre os três juntos, atualizar preço de fornecedor vira caça ao tesouro, e o
-- que não é achado continua orçando com o custo do ano passado.

-- ---------------------------------------------------------------------------
-- 1. Repassar custo novo para o que ainda está aberto.
--
-- `os_materiais_previstos.custo_unitario_previsto` é um retrato tirado na
-- conversão. Isso é certo para OS fechada — histórico não se reescreve — e
-- errado para OS que ainda vai produzir: ela vai consumir material pelo preço de
-- HOJE, e comparar com um previsto velho faz a divergência mentir.
--
-- Só mexe no que ainda não foi reservado nem baixado. Depois disso o material já
-- tem preço travado no lote, e mudar a previsão esconderia a diferença
-- justamente onde ela precisa aparecer.
-- ---------------------------------------------------------------------------
create or replace function public.recalcular_previsao_custos(p_os_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid;
  v_atualizados int;
  v_os_afetadas int;
begin
  v_uid := public.require_permission('custos.update');

  with alvo as (
    select p.id, m.custo_unitario as novo, p.custo_unitario_previsto as antigo, p.os_id
    from public.os_materiais_previstos p
    join public.materiais m on m.id = p.material_id
    join public.ordens_servico o on o.id = p.os_id
    where (p_os_id is null or p.os_id = p_os_id)
      and o.status::text not in ('concluido','faturado','cancelado')
      and coalesce(p.custo_unitario_previsto, -1) is distinct from m.custo_unitario
      and not exists (select 1 from public.estoque_reservas r
                       where r.os_id = p.os_id and r.material_id = p.material_id)
      and not exists (select 1 from public.movimentacoes_estoque mv
                       where mv.os_id = p.os_id and mv.material_id = p.material_id)
  ), aplicado as (
    update public.os_materiais_previstos p
       set custo_unitario_previsto = a.novo
      from alvo a where p.id = a.id
    returning p.os_id
  )
  select count(*)::int, count(distinct os_id)::int into v_atualizados, v_os_afetadas from aplicado;

  -- O custo previsto da OS acompanha a previsão de material.
  update public.ordens_servico o
     set custo_previsto = sub.total
    from (select p.os_id, sum(p.quantidade * coalesce(p.custo_unitario_previsto,0)) as total
            from public.os_materiais_previstos p group by p.os_id) sub
   where o.id = sub.os_id
     and (p_os_id is null or o.id = p_os_id)
     and o.status::text not in ('concluido','faturado','cancelado')
     and coalesce(o.custo_previsto,0) is distinct from sub.total;

  return jsonb_build_object('linhas_atualizadas', v_atualizados, 'os_afetadas', v_os_afetadas);
end;
$$;

comment on function public.recalcular_previsao_custos is
  'Repassa o custo atual dos materiais para as OS ainda abertas. Não toca em OS fechada (histórico) nem em material já reservado ou baixado (preço travado no lote).';

grant execute on function public.recalcular_previsao_custos(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Quanto está desatualizado?
--
-- A tela precisa dizer o que muda ANTES de mudar. Botão que altera custo sem
-- mostrar o efeito é como assinar em papel dobrado.
-- ---------------------------------------------------------------------------
create or replace function public.previsoes_desatualizadas()
returns table (
  os_id uuid, numero integer, titulo text, material text,
  custo_previsto numeric, custo_atual numeric, quantidade numeric, diferenca numeric
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select o.id, o.numero, o.titulo, m.nome,
         p.custo_unitario_previsto, m.custo_unitario, p.quantidade,
         round(p.quantidade * (m.custo_unitario - coalesce(p.custo_unitario_previsto,0)), 2)
  from public.os_materiais_previstos p
  join public.materiais m on m.id = p.material_id
  join public.ordens_servico o on o.id = p.os_id
  where o.status::text not in ('concluido','faturado','cancelado')
    and coalesce(p.custo_unitario_previsto, -1) is distinct from m.custo_unitario
    and not exists (select 1 from public.estoque_reservas r
                     where r.os_id = p.os_id and r.material_id = p.material_id)
    and not exists (select 1 from public.movimentacoes_estoque mv
                     where mv.os_id = p.os_id and mv.material_id = p.material_id)
  order by abs(p.quantidade * (m.custo_unitario - coalesce(p.custo_unitario_previsto,0))) desc
$$;

comment on function public.previsoes_desatualizadas is
  'OS abertas cujo custo previsto de material não bate mais com o preço atual, com a diferença em reais.';

grant execute on function public.previsoes_desatualizadas() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Mão de obra por função: a tabela existe e está VAZIA.
--
-- Sem uma linha aqui, todo cálculo cai no `mo_custo_hora_padrao` de
-- config_precificacao_3d (R$ 40/h) — o mesmo valor para o designer, o impressor
-- e o instalador. As três horas custam diferente, e é essa diferença que decide
-- se vale a pena terceirizar a instalação.
--
-- Semeia as funções que os setores do sistema já usam, com o padrão atual, para
-- a tela nascer preenchida e só precisar de ajuste — em vez de nascer vazia e
-- ficar vazia, que é o que aconteceu até agora.
-- ---------------------------------------------------------------------------
insert into public.custos_mao_de_obra (funcao, setor, custo_hora, encargos_pct, ativo, observacoes)
select f.funcao, f.setor,
       coalesce((select mo_custo_hora_padrao from public.config_precificacao_3d limit 1), 40),
       coalesce((select mo_encargos_pct from public.config_precificacao_3d limit 1), 0),
       true,
       'Semeado com o padrão de config_precificacao_3d — ajuste com o custo real da função'
from (values
  ('Designer',   'Arte'),
  ('Impressor',  'Impressão'),
  ('Acabamento', 'Acabamento'),
  ('Instalador', 'Instalação'),
  ('Entregador', 'Entrega')
) as f(funcao, setor)
where not exists (select 1 from public.custos_mao_de_obra c where c.funcao = f.funcao);
