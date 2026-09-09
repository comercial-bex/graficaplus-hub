-- 1) Reserva de materiais sem exigir permissão (uso interno da conversão)
CREATE OR REPLACE FUNCTION public.reservar_materiais_os_interno(p_os_id uuid, p_uid uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r RECORD; l RECORD; v_restante NUMERIC; v_reservado NUMERIC; v_faltantes JSONB := '[]'::jsonb;
BEGIN
  FOR r IN SELECT * FROM public.os_materiais_previstos WHERE os_id = p_os_id LOOP
    IF EXISTS (
      SELECT 1 FROM public.estoque_reservas
       WHERE os_id = p_os_id AND material_id = r.material_id
         AND COALESCE(os_item_id,'00000000-0000-0000-0000-000000000000'::uuid)
           = COALESCE(r.os_item_id,'00000000-0000-0000-0000-000000000000'::uuid)
    ) THEN CONTINUE; END IF;
    v_restante := r.quantidade;
    FOR l IN SELECT * FROM public.material_lotes
              WHERE material_id = r.material_id AND (quantidade - quantidade_reservada) > 0
              ORDER BY validade NULLS LAST, created_at FOR UPDATE LOOP
      EXIT WHEN v_restante <= 0;
      v_reservado := LEAST(v_restante, l.quantidade - l.quantidade_reservada);
      UPDATE public.material_lotes SET quantidade_reservada = quantidade_reservada + v_reservado WHERE id = l.id;
      INSERT INTO public.estoque_reservas(os_id, os_item_id, tarefa_id, material_id, lote_id, quantidade, status, created_by)
      VALUES (p_os_id, r.os_item_id, r.tarefa_id, r.material_id, l.id, v_reservado,
              CASE WHEN v_reservado < r.quantidade THEN 'parcial' ELSE 'reservada' END, p_uid);
      v_restante := v_restante - v_reservado;
    END LOOP;
    IF v_restante > 0 THEN
      v_faltantes := v_faltantes || jsonb_build_object('material_id', r.material_id, 'faltante', v_restante);
    END IF;
  END LOOP;

  UPDATE public.ordens_servico
     SET status_producao = CASE WHEN jsonb_array_length(v_faltantes) > 0 THEN 'material_parcial' ELSE 'material_reservado' END
   WHERE id = p_os_id;

  PERFORM public.registrar_evento_os(p_os_id,'os',p_os_id,'reserva_estoque','Reserva de materiais',NULL,
                                     jsonb_build_object('faltantes', v_faltantes));

  RETURN jsonb_build_object('os_id', p_os_id, 'faltantes', v_faltantes,
                            'status', CASE WHEN jsonb_array_length(v_faltantes) > 0 THEN 'parcial' ELSE 'reservado' END);
END;
$$;

REVOKE ALL ON FUNCTION public.reservar_materiais_os_interno(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.reservar_materiais_os(p_os_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_uid uuid;
BEGIN
  v_uid := public.require_permission('estoque.reserve');
  PERFORM 1 FROM public.ordens_servico WHERE id = p_os_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OS não encontrada'; END IF;
  RETURN public.reservar_materiais_os_interno(p_os_id, v_uid);
END;
$$;

-- 2) Conversão: gera previsão, reserva estoque e ajusta o custo previsto
CREATE OR REPLACE FUNCTION public.converter_orcamento_em_os(p_orcamento_id uuid, p_opcoes jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID;
  v_orc public.orcamentos%ROWTYPE;
  v_os_id UUID;
  v_conta_id UUID;
  v_parcelas INT;
  v_intervalo INT;
  v_primeiro DATE;
  v_valor_parcela NUMERIC;
  v_acumulado NUMERIC := 0;
  v_i INT;
  v_cliente_criado BOOLEAN := false;
  v_previstos INT := 0;
  v_reserva JSONB := '{}'::jsonb;
  v_custo_materiais NUMERIC := 0;
BEGIN
  v_uid := public.require_permission('orcamentos.convert');

  SELECT * INTO v_orc FROM public.orcamentos WHERE id = p_orcamento_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Orçamento não encontrado'; END IF;

  IF v_orc.os_id IS NOT NULL THEN
    RETURN jsonb_build_object('orcamento_id', p_orcamento_id, 'os_id', v_orc.os_id, 'idempotent', true);
  END IF;

  IF v_orc.versao_aprovada_id IS NULL AND v_orc.status::text <> 'aprovado' THEN
    RAISE EXCEPTION 'Orçamento sem versão aprovada';
  END IF;

  IF v_orc.cliente_id IS NULL THEN
    PERFORM public.vincular_cliente_do_contato(p_orcamento_id);
    SELECT * INTO v_orc FROM public.orcamentos WHERE id = p_orcamento_id;
    v_cliente_criado := true;
  END IF;

  INSERT INTO public.ordens_servico(
    cliente_id, orcamento_id, vendedor_id, titulo, briefing, observacoes,
    prazo_entrega, valor_total, custo_previsto, desconto, created_by, status_geral,
    endereco_entrega, condicao_pagamento, precisa_entrega, precisa_instalacao,
    responsavel_id
  )
  VALUES (
    v_orc.cliente_id, p_orcamento_id, v_orc.vendedor_id, v_orc.titulo, v_orc.briefing,
    v_orc.observacoes, v_orc.prazo, v_orc.valor_total, v_orc.custo_estimado,
    GREATEST(0, COALESCE(v_orc.valor_subtotal, 0) - COALESCE(v_orc.valor_total, 0)),
    v_uid, 'entrada',
    v_orc.endereco_entrega, v_orc.condicao_pagamento,
    COALESCE(v_orc.precisa_entrega, false), COALESCE(v_orc.precisa_instalacao, false),
    COALESCE(v_orc.vendedor_id, v_uid)
  )
  RETURNING id INTO v_os_id;

  INSERT INTO public.itens_os(
    os_id, orcamento_item_id, produto_id, descricao, quantidade, unidade,
    valor_unitario, custo_unitario, ordem, produto_snapshot, parametros,
    largura, altura, acabamento, preco_m2, arquivo_id
  )
  SELECT
    v_os_id, id, produto_id, descricao, quantidade, unidade,
    valor_unitario, custo_unitario, ordem, produto_snapshot, parametros,
    largura, altura, acabamento, preco_m2, arquivo_id
  FROM public.orcamento_itens
  WHERE orcamento_id = p_orcamento_id
  ORDER BY ordem;

  UPDATE public.orcamentos SET os_id = v_os_id WHERE id = p_orcamento_id;

  -- Previsão de materiais + reserva do estoque real.
  -- Nunca derruba a conversão: se o estoque estiver inconsistente, a OS nasce
  -- mesmo assim e a falta é informada de volta para a tela.
  BEGIN
    v_previstos := public.gerar_materiais_previstos_os(v_os_id);
    v_reserva := public.reservar_materiais_os_interno(v_os_id, v_uid);
  EXCEPTION WHEN OTHERS THEN
    v_reserva := jsonb_build_object('erro', SQLERRM);
  END;

  SELECT COALESCE(SUM(quantidade * COALESCE(custo_unitario_previsto, 0)), 0)
    INTO v_custo_materiais
    FROM public.os_materiais_previstos WHERE os_id = v_os_id;

  UPDATE public.ordens_servico
     SET custo_previsto = GREATEST(COALESCE(v_orc.custo_estimado, 0), v_custo_materiais)
   WHERE id = v_os_id;

  INSERT INTO public.contas_receber(cliente_id, orcamento_id, os_id, valor_total)
  VALUES (v_orc.cliente_id, p_orcamento_id, v_os_id, v_orc.valor_total)
  RETURNING id INTO v_conta_id;

  v_parcelas  := GREATEST(1, COALESCE((v_orc.condicao_pagamento->>'parcelas')::int, 1));
  v_intervalo := GREATEST(0, COALESCE((v_orc.condicao_pagamento->>'intervalo_dias')::int, 30));
  v_primeiro  := COALESCE((v_orc.condicao_pagamento->>'primeiro_vencimento')::date, CURRENT_DATE);

  v_valor_parcela := round(COALESCE(v_orc.valor_total, 0) / v_parcelas, 2);
  FOR v_i IN 1..v_parcelas LOOP
    INSERT INTO public.parcelas_receber(conta_id, parcela, valor, vencimento)
    VALUES (
      v_conta_id, v_i,
      CASE WHEN v_i < v_parcelas THEN v_valor_parcela
           ELSE COALESCE(v_orc.valor_total, 0) - v_acumulado END,
      v_primeiro + ((v_i - 1) * v_intervalo)
    );
    v_acumulado := v_acumulado + v_valor_parcela;
  END LOOP;

  INSERT INTO public.eventos_negocio(
    entidade, entidade_id, os_id, cliente_id, tipo, titulo, dados_posteriores, usuario_id
  )
  VALUES (
    'orcamento', p_orcamento_id, v_os_id, v_orc.cliente_id, 'orcamento_convertido_os',
    'Orçamento convertido em OS',
    jsonb_build_object('os_id', v_os_id, 'conta_id', v_conta_id, 'parcelas', v_parcelas,
                       'cliente_criado_do_contato', v_cliente_criado,
                       'materiais_previstos', v_previstos, 'reserva', v_reserva),
    v_uid
  );

  RETURN jsonb_build_object(
    'orcamento_id', p_orcamento_id, 'os_id', v_os_id, 'conta_id', v_conta_id,
    'parcelas', v_parcelas, 'cliente_id', v_orc.cliente_id,
    'cliente_criado_do_contato', v_cliente_criado,
    'materiais_previstos', v_previstos,
    'custo_materiais_previsto', v_custo_materiais,
    'reserva', v_reserva
  );
END;
$$;

-- 3) Custo médio do material se atualiza sozinho a cada entrada
CREATE OR REPLACE FUNCTION public.tg_material_custo_medio()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_medio NUMERIC;
BEGIN
  IF NEW.tipo::text <> 'entrada' OR COALESCE(NEW.custo_unitario_snapshot, 0) <= 0 THEN
    RETURN NULL;
  END IF;

  SELECT CASE WHEN SUM(quantidade) > 0
              THEN ROUND(SUM(quantidade * custo_unitario_snapshot) / SUM(quantidade), 2)
         END
    INTO v_medio
    FROM public.movimentacoes_estoque
   WHERE material_id = NEW.material_id
     AND tipo::text = 'entrada'
     AND COALESCE(custo_unitario_snapshot, 0) > 0;

  UPDATE public.materiais
     SET custo_medio = COALESCE(v_medio, custo_medio),
         custo_unitario = NEW.custo_unitario_snapshot,
         updated_at = now()
   WHERE id = NEW.material_id;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS tg_material_custo_medio ON public.movimentacoes_estoque;
CREATE TRIGGER tg_material_custo_medio
AFTER INSERT ON public.movimentacoes_estoque
FOR EACH ROW EXECUTE FUNCTION public.tg_material_custo_medio();

-- 4) Metragem por cliente
CREATE OR REPLACE VIEW public.vw_metragem_cliente
WITH (security_invoker = on) AS
WITH orc AS (
  SELECT o.cliente_id,
         SUM(COALESCE(i.area_cobrada, i.area_total, 0)) AS m2_orcado,
         SUM(CASE WHEN o.status::text IN ('aprovado','convertido')
                  THEN COALESCE(i.area_cobrada, i.area_total, 0) ELSE 0 END) AS m2_aprovado,
         SUM(i.quantidade) AS itens_qtd,
         SUM(i.quantidade * i.valor_unitario) AS valor_orcado
    FROM public.orcamentos o
    JOIN public.orcamento_itens i ON i.orcamento_id = o.id
   WHERE o.cliente_id IS NOT NULL
     AND o.status::text NOT IN ('rejeitado','expirado')
   GROUP BY o.cliente_id
), os AS (
  SELECT s.cliente_id,
         SUM(COALESCE(i.area_cobrada, i.area_total, 0)) AS m2_em_os,
         SUM(CASE WHEN s.status::text IN ('concluido','faturado')
                  THEN COALESCE(i.area_cobrada, i.area_total, 0) ELSE 0 END) AS m2_produzido,
         SUM(i.valor_total) AS valor_os
    FROM public.ordens_servico s
    JOIN public.itens_os i ON i.os_id = s.id
   WHERE s.cliente_id IS NOT NULL
     AND s.status::text <> 'cancelado'
   GROUP BY s.cliente_id
)
SELECT c.id AS cliente_id,
       c.nome AS cliente_nome,
       ROUND(COALESCE(orc.m2_orcado, 0), 2)   AS m2_orcado,
       ROUND(COALESCE(orc.m2_aprovado, 0), 2) AS m2_aprovado,
       ROUND(COALESCE(os.m2_em_os, 0), 2)     AS m2_em_os,
       ROUND(COALESCE(os.m2_produzido, 0), 2) AS m2_produzido,
       ROUND(GREATEST(COALESCE(os.m2_em_os, 0) - COALESCE(os.m2_produzido, 0), 0), 2) AS m2_em_aberto,
       ROUND(GREATEST(COALESCE(orc.m2_aprovado, 0) - COALESCE(os.m2_em_os, 0), 0), 2) AS m2_aprovado_sem_os,
       COALESCE(orc.valor_orcado, 0) AS valor_orcado,
       COALESCE(os.valor_os, 0)      AS valor_os
  FROM public.clientes c
  LEFT JOIN orc ON orc.cliente_id = c.id
  LEFT JOIN os  ON os.cliente_id = c.id
 WHERE COALESCE(orc.m2_orcado, 0) > 0 OR COALESCE(os.m2_em_os, 0) > 0;

GRANT SELECT ON public.vw_metragem_cliente TO authenticated;

-- 5) Aprovações por orçamento
CREATE OR REPLACE VIEW public.vw_aprovacoes_orcamento
WITH (security_invoker = on) AS
WITH artes AS (
  SELECT oi.orcamento_id,
         a.id AS arquivo_id,
         (SELECT ap.decisao FROM public.arquivo_aprovacoes ap
           WHERE ap.arquivo_id = a.id ORDER BY ap.created_at DESC LIMIT 1) AS decisao,
         (SELECT ap.created_at FROM public.arquivo_aprovacoes ap
           WHERE ap.arquivo_id = a.id ORDER BY ap.created_at DESC LIMIT 1) AS decidido_em
    FROM public.orcamento_item_arquivos oia
    JOIN public.orcamento_itens oi ON oi.id = oia.item_id
    JOIN public.arquivos a ON a.id = oia.arquivo_id
), artes_agg AS (
  SELECT orcamento_id,
         COUNT(*) AS artes_total,
         COUNT(*) FILTER (WHERE decisao = 'aprovado') AS artes_aprovadas,
         COUNT(*) FILTER (WHERE decisao = 'ajuste')   AS artes_ajuste,
         COUNT(*) FILTER (WHERE decisao IS NULL)      AS artes_sem_resposta,
         MAX(decidido_em) AS ultima_decisao_em
    FROM artes GROUP BY orcamento_id
), pedidos AS (
  SELECT orcamento_id,
         COUNT(*) FILTER (WHERE status = 'aberta') AS ajustes_abertos,
         COUNT(*) AS ajustes_total,
         MAX(created_at) AS ultimo_pedido_em
    FROM public.portal_cliente_solicitacoes
   WHERE orcamento_id IS NOT NULL
   GROUP BY orcamento_id
)
SELECT o.id,
       o.numero,
       o.titulo,
       o.status::text AS status,
       o.valor_total,
       o.enviado_em,
       o.aprovado_em,
       o.aprovado_por_nome,
       o.created_at,
       o.cliente_id,
       COALESCE(c.nome, o.contato_nome) AS cliente_nome,
       o.os_id,
       s.numero AS os_numero,
       s.status::text AS os_status,
       (s.status::text IN ('concluido','faturado')) AS finalizado,
       COALESCE(ag.artes_total, 0)        AS artes_total,
       COALESCE(ag.artes_aprovadas, 0)    AS artes_aprovadas,
       COALESCE(ag.artes_ajuste, 0)       AS artes_ajuste,
       COALESCE(ag.artes_sem_resposta, 0) AS artes_sem_resposta,
       ag.ultima_decisao_em,
       COALESCE(p.ajustes_abertos, 0) AS ajustes_abertos,
       COALESCE(p.ajustes_total, 0)   AS ajustes_total,
       p.ultimo_pedido_em
  FROM public.orcamentos o
  LEFT JOIN public.clientes c ON c.id = o.cliente_id
  LEFT JOIN public.ordens_servico s ON s.id = o.os_id
  LEFT JOIN artes_agg ag ON ag.orcamento_id = o.id
  LEFT JOIN pedidos p ON p.orcamento_id = o.id;

GRANT SELECT ON public.vw_aprovacoes_orcamento TO authenticated;