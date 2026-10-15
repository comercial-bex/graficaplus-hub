-- Atendimento e fluxo de caixa (14/10/2026) — "continue a resolver".
--
-- 1. Cliente no vácuo. Duas conversas esperavam resposta havia 8 e 9 dias —
--    uma da Dani Muniz, cliente com a OS #165 aberta — e nada avisava ninguém:
--    pendencias_do_sistema não tinha bloco de WhatsApp e o lembrete da
--    gerência também não. Agora as duas falam.
-- 2. O fluxo de caixa não mostrava as baixas. vw_fluxo_caixa datava o
--    recebimento por `data_vencimento`, e confirmar_pagamento só grava
--    `data_pagamento`: a única baixa real (Guilherme, R$ 121,15, 10/10) tinha
--    data nula e sumia de todo filtro por período. E o estorno entrava como
--    "não realizado" (status cancelado), então o dinheiro devolvido seguia
--    contado como entrada.
-- 3. Lead que vira cliente leva a conversa: a conversa continuava "sem
--    cliente vinculado" depois da conversão.
-- 4. Cliente com WhatsApp diferente do telefone é reconhecido: o aviso saía
--    para o whatsapp_principal, e a resposta dele virava lead desconhecido.

-- 1a. Pendência: clientes esperando resposta ---------------------------------
DO $pend$
DECLARE
  v_def text := pg_get_functiondef('public.pendencias_do_sistema()'::regprocedure);
  v_de text := E'\n\n  -- Portal do cliente: o que o cliente mandou';
  v_para text := E'\n\n'
    || E'  -- Cliente que escreveu no WhatsApp e ninguém respondeu (14/10/2026): havia\n'
    || E'  -- conversa esperando 9 dias, de cliente com OS aberta, e só a Fila humana\n'
    || E'  -- mostrava.\n'
    || E'  RETURN QUERY SELECT ''whatsapp_esperando_resposta'', ''Clientes esperando resposta no WhatsApp'', count(*)::int,\n'
    || E'    NULL::int,\n'
    || E'    CASE WHEN min(c.aguardando_desde) < now() - interval ''1 day'' THEN ''critico'' ELSE ''atencao'' END,\n'
    || E'    ''atendimento'',\n'
    || E'    ''Esperando: '' || string_agg(\n'
    || E'      coalesce(nullif(btrim(cl.nome), ''''), nullif(btrim(c.nome_contato), ''''), c.telefone)\n'
    || E'        || '' (desde '' || to_char(c.aguardando_desde AT TIME ZONE ''America/Belem'', ''DD/MM HH24:MI'') || '')'',\n'
    || E'      '', '' ORDER BY c.aguardando_desde)\n'
    || E'      || ''. Abra a Fila humana, assuma a conversa e responda.'',\n'
    || E'    ''/whatsapp-fila-humana''\n'
    || E'  FROM public.whatsapp_conversas c LEFT JOIN public.clientes cl ON cl.id = c.cliente_id\n'
    || E'  WHERE c.status = ''aberta'' AND c.aguardando_desde < now() - interval ''2 hours''\n'
    || E'  HAVING count(*) > 0;\n'
    || E'\n  -- Portal do cliente: o que o cliente mandou';
BEGIN
  IF position('whatsapp_esperando_resposta' IN v_def) > 0 THEN RETURN; END IF;
  IF (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de) <> 1 THEN
    RAISE EXCEPTION 'pendencias_do_sistema: o trecho do portal não está como esperado; revise a troca';
  END IF;
  EXECUTE replace(v_def, v_de, v_para);
END
$pend$;

-- 1b. Lembrete da gerência: o mesmo bloco ----------------------------------
DO $lemb$
DECLARE
  v_def text := pg_get_functiondef('public.lembrete_orcamentos_aprovados_sem_os()'::regprocedure);
  v_de1 text := E'  v_os_lista text;\n';
  v_para1 text := E'  v_os_lista text;\n  v_wa_qtd int;\n  v_wa_lista text;\n';
  v_de2 text := E'  -- Silêncio quando nada está parado.\n  IF v_qtd = 0 AND v_os_qtd = 0 THEN';
  v_para2 text :=
       E'  -- Clientes que escreveram e ninguém respondeu (14/10/2026).\n'
    || E'  SELECT count(*),\n'
    || E'         string_agg(l.linha, E''\\n'' ORDER BY l.ordem) FILTER (WHERE l.ordem <= 10)\n'
    || E'    INTO v_wa_qtd, v_wa_lista\n'
    || E'  FROM (\n'
    || E'    SELECT row_number() OVER (ORDER BY c.aguardando_desde) AS ordem,\n'
    || E'           format(''%s · esperando desde %s'',\n'
    || E'             coalesce(nullif(btrim(cl.nome), ''''), nullif(btrim(c.nome_contato), ''''), c.telefone),\n'
    || E'             to_char(c.aguardando_desde AT TIME ZONE ''America/Belem'', ''DD/MM HH24:MI'')) AS linha\n'
    || E'    FROM public.whatsapp_conversas c LEFT JOIN public.clientes cl ON cl.id = c.cliente_id\n'
    || E'    WHERE c.status = ''aberta'' AND c.aguardando_desde < now() - interval ''4 hours''\n'
    || E'  ) l;\n'
    || E'  v_wa_qtd := coalesce(v_wa_qtd, 0);\n\n'
    || E'  -- Silêncio quando nada está parado.\n  IF v_qtd = 0 AND v_os_qtd = 0 AND v_wa_qtd = 0 THEN';
  v_de3 text := E'      v_os_qtd, v_os_lista) END\n  );';
  v_para3 text := E'      v_os_qtd, v_os_lista) END,\n'
    || E'    CASE WHEN v_wa_qtd > 0 THEN format(\n'
    || E'      E''Clientes esperando resposta no WhatsApp: %s.\\n%s\\nAbra a Fila humana, assuma e responda — ou passe a quem atende.'',\n'
    || E'      v_wa_qtd, v_wa_lista) END\n  );';
BEGIN
  IF position('v_wa_qtd' IN v_def) > 0 THEN RETURN; END IF;
  IF (length(v_def) - length(replace(v_def, v_de1, ''))) / length(v_de1) <> 1
     OR (length(v_def) - length(replace(v_def, v_de2, ''))) / length(v_de2) <> 1
     OR (length(v_def) - length(replace(v_def, v_de3, ''))) / length(v_de3) <> 1 THEN
    RAISE EXCEPTION 'lembrete_orcamentos_aprovados_sem_os: os trechos não estão como esperado; revise a troca';
  END IF;
  EXECUTE replace(replace(replace(v_def, v_de1, v_para1), v_de2, v_para2), v_de3, v_para3);
END
$lemb$;

-- 2. Fluxo de caixa: a baixa tem data, o estorno desconta -------------------
CREATE OR REPLACE VIEW public.vw_fluxo_caixa
WITH (security_invoker = true) AS
 SELECT
    CASE WHEN p.status = 'pago'::status_pagamento OR p.pagamento_estornado_id IS NOT NULL
         THEN COALESCE(p.data_pagamento, p.data_vencimento)
         ELSE COALESCE(p.data_vencimento, p.data_pagamento) END AS data,
    'entrada'::text AS tipo,
    'pagamento'::text AS origem,
    p.valor,
    (p.status = 'pago'::status_pagamento OR p.pagamento_estornado_id IS NOT NULL) AS realizado,
    p.os_id,
    COALESCE(p.forma_pagamento, 'nao_informado'::text) AS categoria
   FROM pagamentos p
UNION ALL
 SELECT cp.vencimento AS data,
    'saida'::text AS tipo,
    'conta_pagar'::text AS origem,
    cp.valor,
    (cp.status = 'paga'::status_conta_pagar) AS realizado,
    cp.os_id,
    cp.categoria
   FROM contas_pagar cp
UNION ALL
 SELECT cm.data,
    cm.tipo,
    cm.origem,
    cm.valor,
    cm.realizado,
    cm.os_id,
    COALESCE(cm.categoria, 'geral'::text) AS categoria
   FROM caixa_movimentos cm
  WHERE ((cm.pagamento_id IS NULL) AND (cm.conta_pagar_id IS NULL));

-- 3. Lead convertido leva a conversa ---------------------------------------
DO $lead$
DECLARE
  v_def text := pg_get_functiondef('public.converter_lead_em_cliente(uuid, jsonb, boolean)'::regprocedure);
  v_de text := E'  UPDATE public.leads\n     SET cliente_id = v_cliente_id, convertido_em = now(), status = ''ganho'', etapa = ''convertido''\n   WHERE id = p_lead_id;\n';
  v_para text := v_de
    || E'\n  -- A conversa do lead passa a ser do cliente (14/10/2026): ficava "sem cliente\n'
    || E'  -- vinculado" até a próxima mensagem dele.\n'
    || E'  UPDATE public.whatsapp_conversas SET cliente_id = v_cliente_id\n'
    || E'   WHERE cliente_id IS NULL AND (lead_id = p_lead_id OR id = v_lead.conversa_id);\n';
BEGIN
  IF position('A conversa do lead passa a ser do cliente' IN v_def) > 0 THEN RETURN; END IF;
  IF (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de) <> 1 THEN
    RAISE EXCEPTION 'converter_lead_em_cliente: o trecho do lead não está como esperado; revise a troca';
  END IF;
  EXECUTE replace(v_def, v_de, v_para);
END
$lead$;

UPDATE public.whatsapp_conversas c
   SET cliente_id = l.cliente_id
  FROM public.leads l
 WHERE c.lead_id = l.id AND c.cliente_id IS NULL AND l.cliente_id IS NOT NULL;

-- 4. WhatsApp principal identifica o cliente ---------------------------------
DO $wa$
DECLARE
  v_def text := pg_get_functiondef('public.whatsapp_registrar_mensagem'::regproc);
  v_de text := E'    SELECT id FROM public.clientes WHERE telefone_normalizado = v_tel\n    UNION\n';
  v_para text := v_de
    || E'    SELECT id FROM public.clientes WHERE public.normalize_whatsapp_phone(whatsapp_principal) = v_tel\n'
    || E'    UNION\n';
BEGIN
  IF position('normalize_whatsapp_phone(whatsapp_principal) = v_tel' IN v_def) > 0 THEN RETURN; END IF;
  IF (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de) <> 1 THEN
    RAISE EXCEPTION 'whatsapp_registrar_mensagem: o trecho da busca do cliente não está como esperado; revise a troca';
  END IF;
  EXECUTE replace(v_def, v_de, v_para);
END
$wa$;
