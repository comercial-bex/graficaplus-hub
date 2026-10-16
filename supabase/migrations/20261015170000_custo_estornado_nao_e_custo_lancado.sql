-- ============================================================================
-- Custo líquido zero não é "custo lançado": OS com o custo todo estornado
-- volta a dizer "sem custo" e não fecha
-- ============================================================================
--
-- POR QUÊ
--   Desde 20261008100000, o estorno de baixa lança em custos_operacionais_os
--   uma linha NEGATIVA espelho (livro-razão: a linha da baixa fica). Depois de
--   um estorno TOTAL a OS tem duas linhas que somam R$ 0,00. Três lugares
--   perguntavam "existe linha?" em vez de "existe custo?":
--     vw_resultado_os   custo_lancado = (soma IS NOT NULL) → true; lucro
--                       realizado = receita inteira; margem realizada 100%
--     rel_lucro_por_os  idem (Relatórios: lucro por OS, "OS com custo")
--     fechar_os         trava "custos_operacionais" só se NÃO EXISTE linha →
--                       a OS fechava com custo 0 e margem 100% no snapshot
--   A tela da OS já sabe dizer a verdade quando custo_lancado = false ("Nenhum
--   custo foi lançado nesta OS, então lucro e margem realizados não podem ser
--   calculados"); o painel conta "OS com custo" pelo mesmo campo. Bastava o
--   banco não chamar de "lançado" um custo que deu zero.
--
--   Medido em 15/10/2026 na OS 49 (ac27e850, venda de R$ 100 só no ensaio),
--   tudo desfeito: baixa de 2 m² de lona 440 (R$ 32,46) e estorno total
--   (−R$ 32,46), como o gestor (Yvens):
--                              ANTES                  DEPOIS
--     vw_resultado_os          custo 0, lançado sim,  custo 0, lançado NÃO,
--                              margem 100%            margem vazia (a tela
--                                                     mostra o aviso)
--     rel_lucro_por_os         custo 0, lançado sim,  custo vazio, lançado
--                              margem 100%            não, margem vazia
--     fechar_os                sem a trava de custo   trava "custos_operacionais"
--     painel (OS com custo)    3                      2
--   Só a baixa (custo positivo): igual antes e depois — R$ 32,46, margem
--   67,54%, sem trava. As definições novas das duas views foram comparadas
--   com as vivas: a única diferença é o NULLIF; opções e grants iguais.
--   Uso real até 15/10: nenhum estorno na base.
--   (rel_lucro_por_os já não abre para authenticated — cita colunas de dinheiro
--   de ordens_servico sem grant —; só a get_relatorios_prioritarios a lê, como
--   dona. Não muda aqui.)
--
-- O QUE MUDA (só isto; o resto das definições é a viva, copiada)
--   1. vw_resultado_os, CTE realizado: total = NULLIF(sum(total), 0).
--   2. rel_lucro_por_os, LATERAL co: custos_lancados = NULLIF(sum(total), 0).
--      Em ambas, todo o resto já trata NULL como "sem custo".
--   3. fechar_os: a trava "custos_operacionais" passa a valer quando a SOMA
--      dos custos da OS é zero ou menos (antes: quando não havia linha).
--   As duas views continuam security_invoker (o WITH é obrigatório: CREATE OR
--   REPLACE VIEW sem ele TROCA as opções e a view passaria a rodar como dona,
--   furando a RLS). Grants e assinatura da função ficam como estão.
--
-- O QUE FICA DE FORA
--   * Saída de "refazer a baixa" depois de estornar: baixar_estoque_os ainda
--     recusa uma 2ª baixa na mesma OS e a reserva não volta (decisão do
--     20261008100000). A OS com custo todo estornado sai da trava lançando o
--     custo real pela aba Financeiro ou fechando um apontamento de máquina.
--   * vw_resultado_operacional_os tem a mesma pergunta, mas ninguém lê (nem
--     tela, nem função): fica como está.
--   * custo_real_por_peca (PDF) soma por item; estorno total dá 0 ali, certo.
--
-- COMO CONFERIR DEPOIS DE APLICAR
--   select reloptions from pg_class where relname in ('vw_resultado_os','rel_lucro_por_os');
--     → {security_invoker=true} nas duas
--   select position('NULLIF(sum(co.total)' in pg_get_viewdef('public.vw_resultado_os')) > 0,
--          position('NULLIF(sum(co1.total)' in pg_get_viewdef('public.rel_lucro_por_os')) > 0,
--          position('SUM(co.total)' in (select prosrc from pg_proc where proname = 'fechar_os')) > 0;
--     → true, true, true
-- ============================================================================

CREATE OR REPLACE VIEW public.vw_resultado_os WITH (security_invoker = true) AS
 WITH previsto_material AS (
         SELECT p.os_id,
            sum((p.quantidade * COALESCE(p.custo_unitario_previsto, (0)::numeric))) AS total
           FROM os_materiais_previstos p
          GROUP BY p.os_id
        ), realizado AS (
         SELECT co.os_id,
            NULLIF(sum(co.total), (0)::numeric) AS total,
            sum(co.total) FILTER (WHERE (co.categoria = 'retrabalho'::text)) AS retrabalho
           FROM custos_operacionais_os co
          GROUP BY co.os_id
        ), reservado AS (
         SELECT r.os_id,
            sum((r.quantidade * l.custo_unitario_snapshot)) AS total
           FROM (estoque_reservas r
             LEFT JOIN material_lotes l ON ((l.id = r.lote_id)))
          GROUP BY r.os_id
        )
 SELECT os.id AS os_id,
    (COALESCE(f.valor_total, (0)::numeric) + COALESCE(f.desconto, (0)::numeric)) AS receita_bruta,
    COALESCE(f.desconto, (0)::numeric) AS descontos,
    COALESCE(f.valor_total, (0)::numeric) AS receita_liquida,
        CASE
            WHEN (COALESCE(f.custo_previsto, (0)::numeric) > (0)::numeric) THEN f.custo_previsto
            ELSE COALESCE(pm.total, (0)::numeric)
        END AS custo_previsto,
    COALESCE(rs.total, (0)::numeric) AS custo_reservado,
    COALESCE(rl.total, (0)::numeric) AS custo_realizado,
    (COALESCE(f.valor_total, (0)::numeric) -
        CASE
            WHEN (COALESCE(f.custo_previsto, (0)::numeric) > (0)::numeric) THEN f.custo_previsto
            ELSE COALESCE(pm.total, (0)::numeric)
        END) AS lucro_previsto,
        CASE
            WHEN (rl.total IS NULL) THEN NULL::numeric
            ELSE (COALESCE(f.valor_total, (0)::numeric) - rl.total)
        END AS lucro_realizado,
        CASE
            WHEN (COALESCE(f.valor_total, (0)::numeric) > (0)::numeric) THEN round((((COALESCE(f.valor_total, (0)::numeric) -
            CASE
                WHEN (COALESCE(f.custo_previsto, (0)::numeric) > (0)::numeric) THEN f.custo_previsto
                ELSE COALESCE(pm.total, (0)::numeric)
            END) / COALESCE(f.valor_total, (0)::numeric)) * (100)::numeric), 2)
            ELSE NULL::numeric
        END AS margem_prevista,
        CASE
            WHEN (rl.total IS NULL) THEN NULL::numeric
            WHEN (COALESCE(f.valor_total, (0)::numeric) > (0)::numeric) THEN round((((COALESCE(f.valor_total, (0)::numeric) - rl.total) / COALESCE(f.valor_total, (0)::numeric)) * (100)::numeric), 2)
            ELSE NULL::numeric
        END AS margem_realizada,
    (COALESCE(rl.total, (0)::numeric) -
        CASE
            WHEN (COALESCE(f.custo_previsto, (0)::numeric) > (0)::numeric) THEN f.custo_previsto
            ELSE COALESCE(pm.total, (0)::numeric)
        END) AS divergencia_custo,
    COALESCE(rl.retrabalho, (0)::numeric) AS retrabalho,
        CASE
            WHEN ((os.prazo_entrega IS NOT NULL) AND (os.prazo_entrega < now()) AND ((os.status)::text <> ALL (ARRAY['concluido'::text, 'faturado'::text, 'cancelado'::text]))) THEN true
            ELSE false
        END AS atraso,
    COALESCE(f.status_financeiro, 'pendente'::status_pagamento) AS status_financeiro,
        CASE
            WHEN (COALESCE(f.custo_previsto, (0)::numeric) > (0)::numeric) THEN 'orcamento'::text
            WHEN (COALESCE(pm.total, (0)::numeric) > (0)::numeric) THEN 'previsao_de_material'::text
            ELSE 'sem_custo'::text
        END AS custo_previsto_origem,
    COALESCE(pm.total, (0)::numeric) AS custo_previsto_materiais,
    (rl.total IS NOT NULL) AS custo_lancado
   FROM ((((ordens_servico os
     LEFT JOIN os_resultados_financeiros f ON ((f.os_id = os.id)))
     LEFT JOIN previsto_material pm ON ((pm.os_id = os.id)))
     LEFT JOIN realizado rl ON ((rl.os_id = os.id)))
     LEFT JOIN reservado rs ON ((rs.os_id = os.id)));

CREATE OR REPLACE VIEW public.rel_lucro_por_os WITH (security_invoker = true) AS
 SELECT os.id AS os_id,
    os.numero,
    os.titulo,
    c.nome AS cliente,
    (os.created_at)::date AS criada_em,
    os.status,
    (COALESCE(pg.receita, os.valor_total, (0)::numeric))::numeric(12,2) AS receita,
    (co.custos_lancados)::numeric(12,2) AS custo,
    (
        CASE
            WHEN (co.custos_lancados IS NOT NULL) THEN (COALESCE(pg.receita, os.valor_total, (0)::numeric) - co.custos_lancados)
            ELSE NULL::numeric
        END)::numeric(12,2) AS lucro,
        CASE
            WHEN ((co.custos_lancados IS NOT NULL) AND (COALESCE(pg.receita, os.valor_total, (0)::numeric) > (0)::numeric)) THEN round((((COALESCE(pg.receita, os.valor_total, (0)::numeric) - co.custos_lancados) / COALESCE(pg.receita, os.valor_total, (0)::numeric)) * (100)::numeric), 2)
            ELSE NULL::numeric
        END AS margem_percentual,
    os.custo_previsto,
    (co.custos_lancados IS NOT NULL) AS custo_lancado
   FROM (((ordens_servico os
     JOIN clientes c ON ((c.id = os.cliente_id)))
     LEFT JOIN LATERAL ( SELECT sum(p.valor) AS receita
           FROM pagamentos p
          WHERE ((p.os_id = os.id) AND (p.status = 'pago'::status_pagamento))) pg ON (true))
     LEFT JOIN LATERAL ( SELECT NULLIF(sum(co1.total), (0)::numeric) AS custos_lancados
           FROM custos_operacionais_os co1
          WHERE (co1.os_id = os.id)) co ON (true));

CREATE OR REPLACE FUNCTION public.fechar_os(os_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid; v_result jsonb; v_cliente uuid; v_bloqueios jsonb := '[]'::jsonb;
        v_receita numeric; v_pago numeric; v_veredito text;
BEGIN
  v_uid := public.require_permission('os.close');
  -- valor_total já é o que o cliente paga (total = itens − desconto, desde a
  -- migração 20261006230000); subtrair o desconto de novo contaria duas vezes.
  SELECT o.cliente_id, COALESCE(o.valor_total,0)
    INTO v_cliente, v_receita
  FROM public.ordens_servico o WHERE o.id = fechar_os.os_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OS não encontrada'; END IF;

  IF EXISTS (SELECT 1 FROM public.os_tarefas t WHERE t.os_id = fechar_os.os_id
               AND t.obrigatoria AND t.status NOT IN ('concluida','cancelada'))
  THEN v_bloqueios := v_bloqueios || '"tarefas_obrigatorias"'::jsonb; END IF;

  v_veredito := public.veredito_qualidade_os(fechar_os.os_id);

  IF EXISTS (SELECT 1 FROM public.itens_os i WHERE i.os_id = fechar_os.os_id AND i.requer_qualidade)
     AND COALESCE(v_veredito,'') NOT IN ('aprovado','aprovado_com_ressalva')
  THEN v_bloqueios := v_bloqueios || '"qualidade_aprovada"'::jsonb; END IF;

  IF v_veredito IN ('reprovado','retrabalho')
  THEN v_bloqueios := v_bloqueios || '"qualidade_reprovada_ou_retrabalho"'::jsonb; END IF;

  IF EXISTS (SELECT 1 FROM public.os_materiais_previstos mp WHERE mp.os_id = fechar_os.os_id)
     AND NOT EXISTS (SELECT 1 FROM public.movimentacoes_estoque me
                     WHERE me.os_id = fechar_os.os_id AND me.tipo='saida' AND me.origem='baixa_os')
  THEN v_bloqueios := v_bloqueios || '"materiais_baixados"'::jsonb; END IF;

  IF EXISTS (SELECT 1 FROM public.ocorrencias oc WHERE oc.os_id = fechar_os.os_id
               AND COALESCE(oc.status,'aberta') NOT IN ('tratada','fechada','cancelada'))
  THEN v_bloqueios := v_bloqueios || '"ocorrencias_tratadas"'::jsonb; END IF;

  IF EXISTS (SELECT 1 FROM public.entregas_instalacoes ei WHERE ei.os_id = fechar_os.os_id
               AND ei.status NOT IN ('concluida','cancelada','nao_necessaria'))
  THEN v_bloqueios := v_bloqueios || '"logistica_concluida"'::jsonb; END IF;

  IF EXISTS (SELECT 1 FROM public.apontamentos_producao ap WHERE ap.os_id = fechar_os.os_id
               AND ap.finalizado_em IS NULL)
  THEN v_bloqueios := v_bloqueios || '"apontamento_aberto"'::jsonb; END IF;

  -- Custo é a SOMA, não a existência de linha: o estorno de baixa lança a
  -- linha negativa espelho, e baixa + estorno total somam zero (20261015170000).
  IF COALESCE((SELECT SUM(co.total) FROM public.custos_operacionais_os co
                WHERE co.os_id = fechar_os.os_id), 0) <= 0
  THEN v_bloqueios := v_bloqueios || '"custos_operacionais"'::jsonb; END IF;

  SELECT COALESCE(SUM(pg.valor),0) INTO v_pago FROM public.pagamentos pg
   WHERE pg.os_id = fechar_os.os_id AND pg.status='pago';

  IF v_receita > 0 AND v_pago < v_receita
     AND COALESCE((SELECT o2.status_financeiro::text FROM public.ordens_servico o2
                    WHERE o2.id = fechar_os.os_id),'pendente') <> 'pago'
  THEN v_bloqueios := v_bloqueios || '"pagamentos_pendentes"'::jsonb; END IF;

  SELECT to_jsonb(r) INTO v_result FROM public.vw_resultado_os r WHERE r.os_id = fechar_os.os_id;

  IF jsonb_array_length(v_bloqueios) > 0 THEN
    RETURN jsonb_build_object('os_id', fechar_os.os_id, 'fechada', false,
                              'bloqueios', v_bloqueios, 'resultado', v_result);
  END IF;

  INSERT INTO public.os_resultado_snapshots(os_id, resultado_json, created_by)
  VALUES (fechar_os.os_id, v_result, v_uid);
  UPDATE public.ordens_servico o SET status='concluido', status_geral='fechada', data_fechamento=now(),
         custo_real=COALESCE((v_result->>'custo_realizado')::numeric,0),
         margem_real=COALESCE((v_result->>'margem_realizada')::numeric,0)
   WHERE o.id = fechar_os.os_id;
  INSERT INTO public.pos_venda_pesquisas(os_id, cliente_id) VALUES (fechar_os.os_id, v_cliente);
  PERFORM public.registrar_evento_os(fechar_os.os_id,'os',fechar_os.os_id,'fechamento','OS fechada',NULL,v_result);
  RETURN jsonb_build_object('os_id', fechar_os.os_id, 'fechada', true, 'resultado', v_result);
END
$function$;
