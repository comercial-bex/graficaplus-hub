-- O resultado da OS para de mentir de duas formas ao mesmo tempo.
--
-- DEFEITO 1 — CUSTO NÃO LANÇADO VIRAVA MARGEM DE 100%
-- `COALESCE(sum(custo), 0)` trata "nenhum custo foi lançado" e "o custo medido
-- foi zero" como a mesma coisa. Não são. Conferido no banco em 10/09/2026: a OS
-- #44 tem receita de 121,15, nenhuma linha em custos_operacionais_os, e a view
-- respondia margem realizada = 1,0 — isto é, lucro integral. O sistema
-- afirmava, com a confiança de um número calculado, que o serviço não custou
-- nada.
--
-- Ausência não é zero. Onde não há custo lançado, a margem e o lucro
-- realizados passam a devolver NULL, e a nova coluna `custo_lancado` deixa a
-- tela dizer POR QUE está vazio em vez de mostrar um travessão mudo.
--
-- DEFEITO 2 — A MARGEM ESTAVA EM FRAÇÃO E A TELA ESCREVIA "%"
-- A view devolvia 0,4999 para uma margem de 50%, e as telas de OS e de
-- relatórios formatavam como `0.50%`. Uma margem saudável aparecia como erro
-- de arredondamento. Pior: `fechar_os` gravava esse mesmo valor em
-- `ordens_servico.margem_real`, coluna que `avancar_os_status` lê como
-- PORCENTAGEM e compara com o mínimo de 20 — então uma OS fechada com 100% de
-- margem ficaria registrada como 1,00 e seria barrada depois por "margem
-- abaixo do mínimo".
--
-- A unidade canônica do sistema é PORCENTAGEM: é o que as colunas de
-- `ordens_servico` guardam, o que `vw_resultado_operacional_os` já devolvia e
-- o que as duas telas já escrevem. `vw_resultado_os` era a única fora do passo,
-- e é ela que se alinha.

CREATE OR REPLACE VIEW public.vw_resultado_os
WITH (security_invoker = true) AS
WITH previsto_material AS (
  SELECT p.os_id, sum(p.quantidade * COALESCE(p.custo_unitario_previsto, 0)) AS total
  FROM os_materiais_previstos p GROUP BY p.os_id
), realizado AS (
  SELECT co.os_id,
         sum(co.total) AS total,
         sum(co.total) FILTER (WHERE co.categoria = 'retrabalho') AS retrabalho
  FROM custos_operacionais_os co GROUP BY co.os_id
), reservado AS (
  SELECT r.os_id, sum(r.quantidade * l.custo_unitario_snapshot) AS total
  FROM estoque_reservas r LEFT JOIN material_lotes l ON l.id = r.lote_id
  GROUP BY r.os_id
)
SELECT
  os.id AS os_id,
  COALESCE(f.valor_total, 0) AS receita_bruta,
  COALESCE(f.desconto, 0) AS descontos,
  COALESCE(f.valor_total, 0) - COALESCE(f.desconto, 0) AS receita_liquida,
  CASE WHEN COALESCE(f.custo_previsto, 0) > 0 THEN f.custo_previsto
       ELSE COALESCE(pm.total, 0) END AS custo_previsto,
  COALESCE(rs.total, 0) AS custo_reservado,
  COALESCE(rl.total, 0) AS custo_realizado,
  (COALESCE(f.valor_total, 0) - COALESCE(f.desconto, 0))
    - CASE WHEN COALESCE(f.custo_previsto, 0) > 0 THEN f.custo_previsto
           ELSE COALESCE(pm.total, 0) END AS lucro_previsto,

  -- Sem custo lançado não existe lucro realizado. Devolver a receita inteira
  -- como se fosse lucro é o erro que esta migração corrige.
  CASE WHEN rl.total IS NULL THEN NULL
       ELSE (COALESCE(f.valor_total, 0) - COALESCE(f.desconto, 0)) - rl.total
  END AS lucro_realizado,

  -- Em PORCENTAGEM, como o resto do sistema.
  CASE WHEN (COALESCE(f.valor_total, 0) - COALESCE(f.desconto, 0)) > 0
       THEN round((((COALESCE(f.valor_total, 0) - COALESCE(f.desconto, 0))
              - CASE WHEN COALESCE(f.custo_previsto, 0) > 0 THEN f.custo_previsto
                     ELSE COALESCE(pm.total, 0) END)
             / (COALESCE(f.valor_total, 0) - COALESCE(f.desconto, 0))) * 100, 2)
       ELSE NULL END AS margem_prevista,

  CASE WHEN rl.total IS NULL THEN NULL
       WHEN (COALESCE(f.valor_total, 0) - COALESCE(f.desconto, 0)) > 0
       THEN round((((COALESCE(f.valor_total, 0) - COALESCE(f.desconto, 0)) - rl.total)
             / (COALESCE(f.valor_total, 0) - COALESCE(f.desconto, 0))) * 100, 2)
       ELSE NULL END AS margem_realizada,

  COALESCE(rl.total, 0) - CASE WHEN COALESCE(f.custo_previsto, 0) > 0 THEN f.custo_previsto
                               ELSE COALESCE(pm.total, 0) END AS divergencia_custo,
  COALESCE(rl.retrabalho, 0) AS retrabalho,
  CASE WHEN os.prazo_entrega IS NOT NULL AND os.prazo_entrega < now()
        AND os.status::text <> ALL (ARRAY['concluido','faturado','cancelado'])
       THEN true ELSE false END AS atraso,
  COALESCE(f.status_financeiro, 'pendente'::status_pagamento) AS status_financeiro,
  CASE WHEN COALESCE(f.custo_previsto, 0) > 0 THEN 'orcamento'
       WHEN COALESCE(pm.total, 0) > 0 THEN 'previsao_de_material'
       ELSE 'sem_custo' END AS custo_previsto_origem,
  COALESCE(pm.total, 0) AS custo_previsto_materiais,

  -- A coluna nova: separa "custo medido foi zero" de "ninguém lançou custo".
  (rl.total IS NOT NULL) AS custo_lancado
FROM ordens_servico os
LEFT JOIN os_resultados_financeiros f ON f.os_id = os.id
LEFT JOIN previsto_material pm ON pm.os_id = os.id
LEFT JOIN realizado rl ON rl.os_id = os.id
LEFT JOIN reservado rs ON rs.os_id = os.id;

COMMENT ON VIEW public.vw_resultado_os IS
  'Resultado da OS. Margens em PORCENTAGEM (unidade canônica do sistema). Margem e lucro realizados são NULL quando nenhum custo foi lançado — ausência não é zero; ver custo_lancado.';

-- A mesma mentira morava aqui, e esta view ninguém lê ainda. Corrigir agora
-- evita que ela volte quando alguém a ligar em alguma tela.
CREATE OR REPLACE VIEW public.vw_resultado_operacional_os
WITH (security_invoker = true) AS
SELECT
  os.id AS os_id,
  COALESCE(os.valor_total, 0) AS receita,
  COALESCE(os.custo_previsto, 0) AS custo_previsto,
  COALESCE(sum(co.total), 0) AS custo_realizado,
  COALESCE(sum(co.total), 0) - COALESCE(os.custo_previsto, 0) AS divergencia,
  COALESCE(sum(co.total) FILTER (WHERE co.categoria = 'retrabalho'), 0) AS retrabalho,
  COALESCE(os.valor_total, 0) - COALESCE(os.custo_previsto, 0) AS lucro_previsto,
  CASE WHEN sum(co.total) IS NULL THEN NULL
       ELSE COALESCE(os.valor_total, 0) - sum(co.total)
  END AS lucro_operacional_realizado,
  CASE WHEN COALESCE(os.valor_total, 0) > 0
       THEN round(((COALESCE(os.valor_total, 0) - COALESCE(os.custo_previsto, 0)) / os.valor_total) * 100, 2)
       ELSE NULL END AS margem_prevista,
  CASE WHEN sum(co.total) IS NULL THEN NULL
       WHEN COALESCE(os.valor_total, 0) > 0
       THEN round(((COALESCE(os.valor_total, 0) - sum(co.total)) / os.valor_total) * 100, 2)
       ELSE NULL END AS margem_operacional,
  (sum(co.total) IS NOT NULL) AS custo_lancado
FROM ordens_servico os
LEFT JOIN custos_operacionais_os co ON co.os_id = os.id
GROUP BY os.id, os.valor_total, os.custo_previsto;

COMMENT ON VIEW public.vw_resultado_operacional_os IS
  'Resultado operacional da OS. Margem em PORCENTAGEM; NULL quando nenhum custo foi lançado. Ver custo_lancado.';
