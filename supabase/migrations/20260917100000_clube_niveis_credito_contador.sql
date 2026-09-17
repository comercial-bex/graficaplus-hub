-- =============================================================================
-- CLUBE DE PARCEIROS — níveis calibrados, crédito como desconto e extrato do contador
-- =============================================================================
--
-- TRÊS MUDANÇAS, TRÊS MOTIVOS
--
-- 1. NÍVEIS CALIBRADOS PELA MARGEM REAL. Os valores que nasceram com o módulo
--    eram chute (10/15/20/25%). Conferido no banco em 17/09/2026 com os 21
--    produtos que têm custo cadastrado: a margem de balcão vai de 51% a 68%, e
--    o desconto que derruba o preço até o piso de margem mínima vai de 11%
--    (criação/arte) a 44% (letra caixa). Com a régua nova (15/20/25/30) a Bex
--    fica com 41% a 50% de margem média e NENHUM produto fura o piso — nos de
--    margem curta o piso trava sozinho. Bronze a 10% deixava o revendedor com
--    R$ 7 num metro de lona de R$ 70: pouco para ele atender o cliente, montar
--    a arte e ainda assumir a venda.
--
-- 2. CRÉDITO VIRA DESCONTO DESTACADO NO PEDIDO. Antes, usar crédito só deixava
--    um recado na observação interna ("abater R$ X no pagamento") — o total do
--    pedido continuava cheio, e quem cobrasse pelo sistema cobraria a mais. Com
--    o desconto no total, o documento, a OS (que copia `subtotal - total` para
--    `desconto`) e o contas a receber falam o mesmo número. É também o
--    tratamento contábil mais simples de defender: desconto no próprio
--    documento, e não abatimento por fora.
--
-- 3. O QUE O CONTADOR PRECISA, EM UMA TELA. `parceiros_contador_periodo`
--    devolve o mês fechado: saldo que veio do mês anterior, o que foi concedido
--    (cashback, meta, ajuste), o que foi usado, o que voltou, o saldo que fica
--    para o mês seguinte e os prêmios em produto/brinde entregues. Saldo de
--    crédito é obrigação assumida com o parceiro: sem esse número ninguém
--    fecha o mês direito.

-- ─── 1. Níveis ──────────────────────────────────────────────────────────────

UPDATE public.parceiro_niveis SET
  compra_minima_90d = 0, desconto_pct = 15, desconto_faixa_pct = 0, cashback_pct = 0,
  beneficios = ARRAY[
    'Tabela de parceiro: 15% abaixo do balcão',
    'Orçamento em PDF com a sua marca',
    'Metas com prêmio garantido'
  ]
WHERE nome = 'Bronze';

UPDATE public.parceiro_niveis SET
  compra_minima_90d = 1500, desconto_pct = 20, desconto_faixa_pct = 3, cashback_pct = 1,
  beneficios = ARRAY[
    'Tabela de parceiro: 20% abaixo do balcão',
    '1% de volta em crédito a cada pedido pago',
    '3% a mais nos produtos de campanha',
    'Orçamento em PDF com a sua marca'
  ]
WHERE nome = 'Prata';

UPDATE public.parceiro_niveis SET
  compra_minima_90d = 4500, desconto_pct = 25, desconto_faixa_pct = 5, cashback_pct = 2,
  beneficios = ARRAY[
    'Tabela de parceiro: 25% abaixo do balcão',
    '2% de volta em crédito a cada pedido pago',
    '5% a mais nos produtos de campanha',
    'Orçamento em PDF com a sua marca'
  ]
WHERE nome = 'Ouro';

UPDATE public.parceiro_niveis SET
  compra_minima_90d = 12000, desconto_pct = 30, desconto_faixa_pct = 8, cashback_pct = 3,
  beneficios = ARRAY[
    'Tabela de parceiro: 30% abaixo do balcão',
    '3% de volta em crédito a cada pedido pago',
    '8% a mais nos produtos de campanha',
    'Orçamento em PDF com a sua marca'
  ]
WHERE nome = 'Diamante';

-- ─── 2. Crédito do parceiro como desconto do pedido ─────────────────────────

-- Invariante: enquanto o pedido carregar `credito_parceiro`, o total é o
-- subtotal menos o crédito. A tela de orçamento da equipe regrava
-- `valor_total = subtotal` sempre que alguém mexe nos itens; sem esta trava,
-- editar um item do pedido do parceiro apagaria o desconto em silêncio e a
-- gráfica cobraria de novo um crédito que já foi baixado do saldo dele.
CREATE OR REPLACE FUNCTION public.tg_parceiro_credito_no_total()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE v_credito numeric := COALESCE((NEW.condicao_pagamento->>'credito_parceiro')::numeric, 0);
BEGIN
  IF v_credito > 0 THEN
    NEW.valor_total := GREATEST(round(COALESCE(NEW.valor_subtotal, 0) - v_credito, 2), 0);
    NEW.desconto_percentual := CASE
      WHEN COALESCE(NEW.valor_subtotal, 0) > 0 THEN round(v_credito / NEW.valor_subtotal * 100, 2)
      ELSE 0 END;
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS tg_parceiro_credito_no_total ON public.orcamentos;
CREATE TRIGGER tg_parceiro_credito_no_total
  BEFORE INSERT OR UPDATE ON public.orcamentos
  FOR EACH ROW EXECUTE FUNCTION public.tg_parceiro_credito_no_total();

-- Pedido recusado: o crédito volta para o saldo, então some também do total.
CREATE OR REPLACE FUNCTION public.tg_parceiro_pedido_recusado()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_q public.parceiro_orcamentos%ROWTYPE;
BEGIN
  IF NEW.status::text NOT IN ('rejeitado', 'expirado') OR OLD.status::text = NEW.status::text THEN
    RETURN NEW;
  END IF;
  SELECT * INTO v_q FROM public.parceiro_orcamentos WHERE pedido_orcamento_id = NEW.id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF v_q.credito_usado > 0 THEN
    INSERT INTO public.parceiro_creditos (parceiro_id, tipo, valor, parceiro_orcamento_id, descricao)
    VALUES (v_q.parceiro_id, 'estorno_uso', v_q.credito_usado, v_q.id,
            format('Devolvido: pedido nº %s %s pela gráfica', NEW.numero,
                   CASE NEW.status::text WHEN 'rejeitado' THEN 'recusado' ELSE 'expirado' END));
    -- o desconto some junto com o crédito devolvido
    UPDATE public.orcamentos
       SET condicao_pagamento = COALESCE(condicao_pagamento, '{}'::jsonb) - 'credito_parceiro',
           valor_total = COALESCE(valor_subtotal, valor_total)
     WHERE id = NEW.id;
  END IF;
  UPDATE public.parceiro_orcamentos
     SET status = 'aprovado', pedido_orcamento_id = NULL, credito_usado = 0, updated_at = now()
   WHERE id = v_q.id;
  RETURN NEW;
END
$function$;

-- ─── 3. Extrato do clube para o contador ────────────────────────────────────

CREATE OR REPLACE FUNCTION public.parceiros_contador_periodo(p_inicio date, p_fim date)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := public.require_permission('parceiros.read');
BEGIN
  -- número de dinheiro: só para quem vê financeiro
  IF NOT (public.can_see_financials(v_uid) OR public.has_role(v_uid, 'admin')) THEN
    RAISE EXCEPTION 'Este relatório é do financeiro.' USING ERRCODE = '42501';
  END IF;
  IF p_fim < p_inicio THEN RAISE EXCEPTION 'O fim do período é antes do início.'; END IF;

  RETURN jsonb_build_object(
    'inicio', p_inicio,
    'fim', p_fim,
    'saldo_anterior', (SELECT COALESCE(sum(c.valor), 0) FROM public.parceiro_creditos c
                        WHERE c.created_at::date < p_inicio),
    'saldo_final', (SELECT COALESCE(sum(c.valor), 0) FROM public.parceiro_creditos c
                     WHERE c.created_at::date <= p_fim),
    'por_tipo', (SELECT COALESCE(jsonb_agg(jsonb_build_object('tipo', t.tipo, 'quantidade', t.n, 'valor', t.soma)
                                           ORDER BY t.tipo), '[]'::jsonb)
                 FROM (SELECT c.tipo, count(*) AS n, sum(c.valor) AS soma
                         FROM public.parceiro_creditos c
                        WHERE c.created_at::date BETWEEN p_inicio AND p_fim
                        GROUP BY c.tipo) t),
    'movimentos', (SELECT COALESCE(jsonb_agg(m ORDER BY m.data, m.parceiro), '[]'::jsonb) FROM (
        SELECT c.created_at::date AS data,
               COALESCE(NULLIF(btrim(p.marca_nome), ''), cl.nome) AS parceiro,
               COALESCE(NULLIF(btrim(p.marca_documento), ''), cl.cpf_cnpj, cl.documento) AS documento,
               c.tipo, round(c.valor, 2) AS valor, c.descricao,
               o.numero AS pedido_numero, os.numero AS os_numero
          FROM public.parceiro_creditos c
          JOIN public.parceiros p ON p.id = c.parceiro_id
          JOIN public.clientes cl ON cl.id = p.cliente_id
          LEFT JOIN public.parceiro_orcamentos q ON q.id = c.parceiro_orcamento_id
          LEFT JOIN public.orcamentos o ON o.id = q.pedido_orcamento_id
          LEFT JOIN public.ordens_servico os ON os.id = c.os_id
         WHERE c.created_at::date BETWEEN p_inicio AND p_fim) m),
    -- Pedido de parceiro é compra para REVENDA, e a destinação é o que decide
    -- ISS x ICMS (LC 116/2003 item 13.05 e STF Tema 816). O contador precisa
    -- desta lista separada da dos pedidos de cliente final.
    'pedidos_do_periodo', (SELECT COALESCE(jsonb_agg(x ORDER BY x.data, x.numero), '[]'::jsonb) FROM (
        SELECT o.created_at::date AS data, o.numero,
               COALESCE(NULLIF(btrim(p.marca_nome), ''), cl.nome) AS parceiro,
               COALESCE(NULLIF(btrim(p.marca_documento), ''), cl.cpf_cnpj, cl.documento) AS documento,
               round(COALESCE(o.valor_subtotal, 0), 2) AS valor_bruto,
               round(COALESCE((o.condicao_pagamento->>'credito_parceiro')::numeric, 0), 2) AS desconto_credito,
               round(COALESCE(o.valor_total, 0), 2) AS valor_liquido,
               o.status::text AS status, os.numero AS os_numero
          FROM public.parceiro_orcamentos q
          JOIN public.orcamentos o ON o.id = q.pedido_orcamento_id
          JOIN public.parceiros p ON p.id = q.parceiro_id
          JOIN public.clientes cl ON cl.id = p.cliente_id
          LEFT JOIN public.ordens_servico os ON os.id = o.os_id
         WHERE o.created_at::date BETWEEN p_inicio AND p_fim) x),
    'premios_entregues', (SELECT COALESCE(jsonb_agg(x ORDER BY x.data), '[]'::jsonb) FROM (
        SELECT co.entregue_em::date AS data,
               COALESCE(NULLIF(btrim(p.marca_nome), ''), cl.nome) AS parceiro,
               COALESCE(NULLIF(btrim(p.marca_documento), ''), cl.cpf_cnpj, cl.documento) AS documento,
               pc.titulo AS campanha, pc.recompensa_tipo AS tipo, pc.recompensa_descricao AS premio,
               co.observacao
          FROM public.parceiro_conquistas co
          JOIN public.parceiro_campanhas pc ON pc.id = co.campanha_id
          JOIN public.parceiros p ON p.id = co.parceiro_id
          JOIN public.clientes cl ON cl.id = p.cliente_id
         WHERE co.status = 'entregue' AND pc.recompensa_tipo <> 'credito'
           AND co.entregue_em::date BETWEEN p_inicio AND p_fim) x)
  );
END
$function$;

-- ─── 4. Simulador de níveis (para a tela de gestão) ─────────────────────────
-- Responde, com os produtos reais: quanto o parceiro ganha, quanto sobra para a
-- Bex e onde o piso de margem trava o desconto. Aceita valores de rascunho para
-- a tela simular antes de salvar.
CREATE OR REPLACE FUNCTION public.parceiro_simular_niveis(p_descontos jsonb DEFAULT NULL)
RETURNS TABLE(
  nivel text, ordem integer, desconto_pct numeric,
  produtos_com_custo integer, produtos_sem_custo integer, travados_no_piso integer,
  quais_travam text, ganho_medio_parceiro numeric, margem_media_bex numeric, menor_margem_bex numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := public.require_permission('parceiros.manage');
BEGIN
  IF NOT (public.has_permission(v_uid, 'custos.read') OR public.can_see_financials(v_uid)
          OR public.has_role(v_uid, 'admin')) THEN
    RAISE EXCEPTION 'Simular níveis mostra custo e margem.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT pr.nome, COALESCE(pp.preco_base, pr.preco_base) AS preco,
           COALESCE(pr.custo_medio, 0) AS custo, COALESCE(pr.margem_minima, 0) AS mm
    FROM public.produtos pr
    LEFT JOIN public.produto_precos pp ON pp.produto_id = pr.id
    WHERE pr.ativo AND COALESCE(pp.preco_base, pr.preco_base) > 0
  ),
  com_custo AS (SELECT * FROM base WHERE custo > 0),
  regua AS (
    SELECT n.nome, n.ordem,
           COALESCE((SELECT (d->>'desconto_pct')::numeric FROM jsonb_array_elements(COALESCE(p_descontos, '[]'::jsonb)) d
                      WHERE d->>'nome' = n.nome), n.desconto_pct) AS desconto
    FROM public.parceiro_niveis n
  ),
  calc AS (
    SELECT r.nome, r.ordem, r.desconto, b.nome AS produto, b.preco, b.custo,
           round(b.custo / (1 - LEAST(b.mm, 99) / 100), 2) AS piso,
           round(b.preco * (1 - r.desconto / 100), 2) AS com_desconto
    FROM regua r CROSS JOIN com_custo b
  ),
  preco_final AS (SELECT c.*, GREATEST(c.com_desconto, c.piso) AS pago FROM calc c)
  SELECT f.nome, f.ordem, f.desconto,
         count(*)::integer,
         (SELECT count(*)::integer FROM base WHERE custo <= 0),
         count(*) FILTER (WHERE f.piso > f.com_desconto)::integer,
         string_agg(f.produto, ', ' ORDER BY f.produto) FILTER (WHERE f.piso > f.com_desconto),
         round(avg((f.preco - f.pago) / f.preco * 100), 1),
         round(avg((f.pago - f.custo) / f.pago * 100), 1),
         round(min((f.pago - f.custo) / f.pago * 100), 1)
  FROM preco_final f
  GROUP BY f.nome, f.ordem, f.desconto
  ORDER BY f.ordem;
END
$function$;

REVOKE ALL ON FUNCTION public.parceiros_contador_periodo(date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.parceiro_simular_niveis(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.parceiros_contador_periodo(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.parceiro_simular_niveis(jsonb) TO authenticated;

-- ─── 5. O pedido avisa que o crédito já virou desconto ──────────────────────
-- Só muda o texto da observação interna: antes mandava "abater no pagamento",
-- o que agora cobraria o desconto duas vezes.
CREATE OR REPLACE FUNCTION public.parceiro_enviar_pedido(p_orcamento_id uuid, p_usar_credito numeric)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_parceiro uuid := public.parceiro_do_usuario();
  v_p public.parceiros%ROWTYPE;
  v_q public.parceiro_orcamentos%ROWTYPE;
  v_nivel jsonb;
  v_orc uuid;
  v_numero integer;
  v_item record;
  v_preco record;
  v_faixa jsonb;
  v_preco_un numeric;
  v_custo_un numeric;
  v_area_peca numeric;
  v_n_itens integer := 0;
  v_livres integer := 0;
  v_subtotal numeric;
  v_saldo numeric;
  v_credito numeric := 0;
BEGIN
  IF v_parceiro IS NULL THEN
    RAISE EXCEPTION 'Acesso de parceiro não encontrado ou suspenso.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_p FROM public.parceiros WHERE id = v_parceiro;
  SELECT * INTO v_q FROM public.parceiro_orcamentos
   WHERE id = p_orcamento_id AND parceiro_id = v_parceiro FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Orçamento não encontrado.'; END IF;
  IF v_q.pedido_orcamento_id IS NOT NULL OR v_q.status = 'pedido_feito' THEN
    RAISE EXCEPTION 'Este orçamento já virou pedido.';
  END IF;
  IF v_q.status = 'perdido' THEN
    RAISE EXCEPTION 'Orçamento marcado como perdido não vira pedido. Reabra antes.';
  END IF;
  IF v_p.responsavel_id IS NULL THEN
    RAISE EXCEPTION 'Seu cadastro ainda não tem um atendente na gráfica. Fale com a equipe antes do primeiro pedido.';
  END IF;

  v_nivel := public.parceiro_nivel(v_parceiro);

  INSERT INTO public.orcamentos (
    cliente_id, vendedor_id, created_by, status, titulo, descricao, observacao_interna,
    aprovado_em, aprovado_por_nome, validade_dias, condicao_pagamento
  ) VALUES (
    v_p.cliente_id, v_p.responsavel_id, auth.uid(), 'aprovado',
    left('Pedido de parceiro · ' || v_q.titulo, 200),
    'Pedido feito pelo painel do parceiro revendedor.',
    format('Parceiro nível %s (desconto %s%%). Preços da tabela de parceiro, recalculados pelo sistema no envio. Orçamento nº %s do parceiro.',
           v_nivel->>'nome', v_nivel->>'desconto_pct', v_q.numero),
    now(), left(COALESCE(NULLIF(btrim(v_p.marca_nome), ''), 'Parceiro') || ' (painel do parceiro)', 120),
    7, '{"parcelas": 1}'::jsonb
  ) RETURNING id, numero INTO v_orc, v_numero;

  FOR v_item IN
    SELECT * FROM public.parceiro_orcamento_itens WHERE orcamento_id = v_q.id ORDER BY ordem, created_at
  LOOP
    IF v_item.produto_id IS NULL THEN
      v_livres := v_livres + 1;
      CONTINUE;
    END IF;

    SELECT * INTO v_preco FROM public.parceiro_precos(v_parceiro) pr WHERE pr.produto_id = v_item.produto_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION '"%" não está disponível na tabela de parceiro.', v_item.descricao;
    END IF;
    IF v_preco.por_area AND (COALESCE(v_item.largura, 0) <= 0 OR COALESCE(v_item.altura, 0) <= 0) THEN
      RAISE EXCEPTION '"%" é vendido por m² e precisa de largura e altura.', v_item.descricao;
    END IF;

    IF v_preco.faixas IS NOT NULL THEN
      v_faixa := NULL;
      SELECT f INTO v_faixa FROM jsonb_array_elements(v_preco.faixas) f
       WHERE (f->>'quantidade_minima')::integer <= ceil(v_item.quantidade)
       ORDER BY (f->>'quantidade_minima')::integer DESC LIMIT 1;
      IF v_faixa IS NULL THEN
        RAISE EXCEPTION '"%" tem pedido mínimo de % unidades.', v_item.descricao, v_preco.faixas->0->>'quantidade_minima';
      END IF;
      v_preco_un := (v_faixa->>'preco_parceiro')::numeric;
    ELSE
      v_preco_un := v_preco.preco_parceiro;
    END IF;

    v_area_peca := CASE WHEN v_preco.por_area
                        THEN GREATEST(round(v_item.largura * v_item.altura, 3), COALESCE(v_preco.area_minima, 0)) END;
    SELECT CASE WHEN v_preco.por_area THEN round(COALESCE(p.custo_medio, 0) * v_area_peca, 2)
                ELSE COALESCE(p.custo_medio, 0) END
      INTO v_custo_un FROM public.produtos p WHERE p.id = v_item.produto_id;

    INSERT INTO public.orcamento_itens (
      orcamento_id, produto_id, descricao, unidade, quantidade, largura, altura, acabamento,
      preco_m2, valor_unitario, custo_unitario, ordem, origem_calculo, produto_snapshot
    ) VALUES (
      v_orc, v_item.produto_id, v_item.descricao, v_preco.unidade, v_item.quantidade,
      v_item.largura, v_item.altura, v_item.acabamento,
      -- por m²: o gatilho de preço calcula a peça a partir do preço do m²
      CASE WHEN v_preco.por_area THEN v_preco_un END,
      CASE WHEN v_preco.por_area THEN 0 ELSE v_preco_un END,
      COALESCE(v_custo_un, 0), v_n_itens, 'tabela_parceiro',
      jsonb_build_object('origem', 'parceiro', 'nivel', v_nivel->>'nome',
                         'desconto_pct', v_nivel->'desconto_pct', 'preco_referencia', v_preco.preco_referencia,
                         'preco_parceiro_unidade', v_preco_un, 'origem_preco', v_preco.origem)
    );
    v_n_itens := v_n_itens + 1;
  END LOOP;

  IF v_n_itens = 0 THEN
    RAISE EXCEPTION 'Nenhum item deste orçamento é produto da gráfica. Itens livres entram só no seu PDF.';
  END IF;

  SELECT COALESCE(sum(valor_total), 0) INTO v_subtotal FROM public.orcamento_itens WHERE orcamento_id = v_orc;
  UPDATE public.orcamentos SET valor_subtotal = v_subtotal, valor_total = v_subtotal WHERE id = v_orc;

  IF COALESCE(p_usar_credito, 0) > 0 THEN
    SELECT COALESCE(sum(valor), 0) INTO v_saldo FROM public.parceiro_creditos WHERE parceiro_id = v_parceiro;
    v_credito := round(LEAST(p_usar_credito, v_saldo, v_subtotal), 2);
    IF v_credito > 0 THEN
      INSERT INTO public.parceiro_creditos (parceiro_id, tipo, valor, parceiro_orcamento_id, descricao, criado_por)
      VALUES (v_parceiro, 'uso', -v_credito, v_q.id, format('Reservado para o pedido nº %s', v_numero), auth.uid());
      -- o gatilho tg_parceiro_credito_no_total transforma isto em desconto do total
      UPDATE public.orcamentos SET
        condicao_pagamento = jsonb_build_object('parcelas', 1, 'credito_parceiro', v_credito),
        observacao_interna = observacao_interna ||
          format(' · Crédito do parceiro de R$ %s JÁ ABATIDO como desconto deste pedido — não descontar de novo.',
                 replace(to_char(v_credito, 'FM999999990.00'), '.', ','))
      WHERE id = v_orc;
    ELSE
      v_credito := 0;
    END IF;
  END IF;

  UPDATE public.parceiro_orcamentos
     SET status = 'pedido_feito', pedido_orcamento_id = v_orc, credito_usado = v_credito, updated_at = now()
   WHERE id = v_q.id;

  RETURN jsonb_build_object(
    'orcamento_id', v_orc, 'numero', v_numero, 'itens', v_n_itens,
    'itens_livres_fora_do_pedido', v_livres, 'total', v_subtotal, 'credito_usado', v_credito
  );
END
$function$;
