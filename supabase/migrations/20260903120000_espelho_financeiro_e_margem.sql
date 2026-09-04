-- Dois defeitos no caminho do dinheiro, achados rodando um ciclo completo.

-- ---------------------------------------------------------------------------
-- 1. O ESPELHO FINANCEIRO PARAVA DE ACOMPANHAR A ORIGEM.
--
-- `os_resultados_financeiros` é a tabela-espelho que todo relatório de dinheiro
-- lê (vw_resultado_os, rel_previsto_realizado, rel_lucro_por_os, a tela de
-- Relatórios e o `resultado` devolvido por fechar_os). Ela é mantida por
-- gatilho a partir de `ordens_servico`.
--
-- A função do gatilho copia SETE campos, incluindo `desconto` e
-- `status_financeiro`. O gatilho, porém, estava declarado assim:
--
--   AFTER INSERT OR UPDATE OF valor_total, custo_previsto, custo_real, margem_real
--
-- Faltavam justamente `desconto` e `status_financeiro`. Efeito medido:
--
--   pagamento de R$ 330 registrado
--   ordens_servico.status_financeiro       -> 'pago'
--   os_resultados_financeiros.status_...   -> 'pendente'   (para sempre)
--
-- Ou seja: OS quitada aparecendo como pendente em todo relatório financeiro. E
-- desconto concedido depois da OS criada nunca chegava ao resultado.
--
-- Fechar a OS não era bloqueado (fechar_os lê a origem, não o espelho), então o
-- estrago é de INFORMAÇÃO — e informação de margem é onde se decide preço.
-- ---------------------------------------------------------------------------
drop trigger if exists tg_sync_os_resultados_financeiros on public.ordens_servico;
create trigger tg_sync_os_resultados_financeiros
  after insert or update of valor_total, custo_previsto, custo_real, margem_real,
                            desconto, status_financeiro
  on public.ordens_servico
  for each row execute function public.tg_sync_os_resultados_financeiros();

-- Reconcilia o que já divergiu. Tocar uma coluna VIGIADA é o que dispara o
-- gatilho — mexer em `updated_at` não adianta, ela não está na lista.
update public.ordens_servico
   set status_financeiro = status_financeiro, desconto = desconto;

-- ---------------------------------------------------------------------------
-- 2. TODA OS RELATAVA MARGEM DE 100%.
--
-- `custo_previsto` da OS vem de `orcamentos.custo_estimado`, e nenhum orçamento
-- do sistema tem esse campo preenchido — os dois existentes estão com 0,00, e o
-- único item de orçamento tem `custo_unitario` zero. Com custo previsto zero:
--
--   margem_prevista = (receita - 0) / receita = 1,0  ->  100%
--
-- Cem por cento de margem em gráfica não é otimismo, é ausência de dado. E o
-- número aparece na tela de Relatórios com a mesma cara de um número real.
--
-- O sistema JÁ CALCULA um custo previsto que ninguém usava: a previsão de
-- material (`os_materiais_previstos`, gerada da ficha técnica na conversão) —
-- no banner de teste, R$ 66,33 de lona e tinta. Quando o orçamento não informa
-- custo, usar essa previsão é melhor que fingir que o custo é zero.
--
-- `custo_previsto_origem` diz de onde veio o número, para ninguém confundir
-- previsão de material com custo completo: material sem mão de obra e sem hora
-- de máquina ainda é uma margem otimista, só que honesta sobre o que inclui.
-- ---------------------------------------------------------------------------
create or replace view public.vw_resultado_os with (security_invoker = true) as
with previsto_material as (
  select p.os_id, sum(p.quantidade * coalesce(p.custo_unitario_previsto, 0)) as total
  from public.os_materiais_previstos p
  group by p.os_id
),
realizado as (
  select co.os_id,
         sum(co.total) as total,
         sum(co.total) filter (where co.categoria = 'retrabalho') as retrabalho
  from public.custos_operacionais_os co
  group by co.os_id
),
reservado as (
  select r.os_id, sum(r.quantidade * l.custo_unitario_snapshot) as total
  from public.estoque_reservas r
  left join public.material_lotes l on l.id = r.lote_id
  group by r.os_id
)
select os.id as os_id,
       coalesce(f.valor_total, 0) as receita_bruta,
       coalesce(f.desconto, 0) as descontos,
       coalesce(f.valor_total, 0) - coalesce(f.desconto, 0) as receita_liquida,
       -- Custo previsto do orçamento quando existe; senão, o que a ficha
       -- técnica prevê de material.
       case when coalesce(f.custo_previsto, 0) > 0 then f.custo_previsto
            else coalesce(pm.total, 0) end as custo_previsto,
       coalesce(rs.total, 0) as custo_reservado,
       coalesce(rl.total, 0) as custo_realizado,
       coalesce(f.valor_total, 0) - coalesce(f.desconto, 0)
         - (case when coalesce(f.custo_previsto, 0) > 0 then f.custo_previsto
                 else coalesce(pm.total, 0) end) as lucro_previsto,
       coalesce(f.valor_total, 0) - coalesce(f.desconto, 0) - coalesce(rl.total, 0) as lucro_realizado,
       case when (coalesce(f.valor_total, 0) - coalesce(f.desconto, 0)) > 0
            then (coalesce(f.valor_total, 0) - coalesce(f.desconto, 0)
                  - (case when coalesce(f.custo_previsto, 0) > 0 then f.custo_previsto
                          else coalesce(pm.total, 0) end))
                 / (coalesce(f.valor_total, 0) - coalesce(f.desconto, 0))
       end as margem_prevista,
       case when (coalesce(f.valor_total, 0) - coalesce(f.desconto, 0)) > 0
            then (coalesce(f.valor_total, 0) - coalesce(f.desconto, 0) - coalesce(rl.total, 0))
                 / (coalesce(f.valor_total, 0) - coalesce(f.desconto, 0))
       end as margem_realizada,
       coalesce(rl.total, 0)
         - (case when coalesce(f.custo_previsto, 0) > 0 then f.custo_previsto
                 else coalesce(pm.total, 0) end) as divergencia_custo,
       coalesce(rl.retrabalho, 0) as retrabalho,
       case when os.prazo_entrega is not null and os.prazo_entrega < now()
                 and os.status::text <> all (array['concluido','faturado','cancelado'])
            then true else false end as atraso,
       coalesce(f.status_financeiro, 'pendente'::status_pagamento) as status_financeiro,
       -- No FIM de propósito: CREATE OR REPLACE VIEW só aceita colunas
       -- acrescentadas ao final, nunca inseridas no meio.
       case when coalesce(f.custo_previsto, 0) > 0 then 'orcamento'
            when coalesce(pm.total, 0) > 0 then 'previsao_de_material'
            else 'sem_custo' end as custo_previsto_origem,
       coalesce(pm.total, 0) as custo_previsto_materiais
from public.ordens_servico os
left join public.os_resultados_financeiros f on f.os_id = os.id
left join previsto_material pm on pm.os_id = os.id
left join realizado rl on rl.os_id = os.id
left join reservado rs on rs.os_id = os.id;

comment on view public.vw_resultado_os is
  'Resultado por OS. Quando o orçamento não informa custo, o previsto cai na previsão de material — `custo_previsto_origem` diz qual foi usado, para margem de 100% não passar por número real.';
