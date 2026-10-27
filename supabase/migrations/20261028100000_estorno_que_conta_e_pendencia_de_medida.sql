-- 27/10/2026 — estorno que não reduzia o caixa e aviso de item sem medida.
--
-- 1) estornar_pagamento NÃO muda o pagamento original (continua 'pago'): grava uma linha NEGATIVA, 'cancelado',
--    com pagamento_estornado_id apontando para ele. Só que o caixa (dashboard_caixa), o "recebido" da meta do
--    mês (ponto_de_equilibrio), os avisos de pagamento (pendencias_do_sistema) e a conta de quanto a parcela
--    já recebeu (confirmar_pagamento) filtravam `pagamento_estornado_id IS NULL` e contavam o ORIGINAL: um
--    estorno não tirava nada deles (a função nunca tinha sido usada). Agora o pagamento que tem estorno
--    deixa de contar como recebido; recalcular_status_financeiro_os já somava a linha negativa e fica certo.
--    Aplicado na OS 168: dois pagamentos de R$ 150 sem parcela eram lançamento em dobro (conta de R$ 300 já
--    quitada em 2 parcelas); estornados com motivo, recebido do mês caiu R$ 300 e os avisos "pagamento sem
--    parcela" e "acima da conta" saíram.
-- 2) Aviso novo: "Itens de OS sem medida e sem ficha de material" (produto de verdade, sem ficha e sem
--    largura/altura) diz o número da OS e QUEM fez o orçamento, para cobrar dele. Chaveiro acrílico é feito na
--    casa e fica de fora da exceção de revenda dos brindes. OS sem produto (adesivo DTF, máquina que não chegou)
--    não tem máquina a agendar.
--
-- Dados aplicados por SQL em 27/10/2026: estorno dos pagamentos d02eb1ca… e 97ca8876… (OS 168); aviso por
-- WhatsApp ao Yvens (OS 161 e 162: tamanho do chaveiro); estoque de filamento e material de apoio 3D das
-- compras da Amazon e do AliExpress (33 filamentos por marca/cor; kits de hotend, placas frias, cartões de cor,
-- kit de ferramentas, bolsa, filtros, LED); máquinas 3D: A1 Combo com AMS Lite (R$ 5.396,17), 2 × A1
-- (R$ 3.504 cada) e A1 Mini (R$ 2.398), custo/hora pela mesma regra das demais (compra ÷ 5.000 h + 0,005% a/h).

DO $m$
DECLARE
  r record; v_def text; v_novo text;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p
           WHERE p.pronamespace='public'::regnamespace
             AND p.proname IN ('dashboard_caixa','ponto_de_equilibrio','pendencias_do_sistema','confirmar_pagamento')
  LOOP
    v_def := pg_get_functiondef(r.sig);
    v_novo := regexp_replace(v_def, '\m([a-z])\.pagamento_estornado_id IS NULL',
      '\1.pagamento_estornado_id IS NULL AND NOT EXISTS (SELECT 1 FROM public.pagamentos _r WHERE _r.pagamento_estornado_id = \1.id)', 'g');
    v_novo := regexp_replace(v_novo, '(WHERE|AND) pagamento_estornado_id IS NULL',
      '\1 pagamento_estornado_id IS NULL AND NOT EXISTS (SELECT 1 FROM public.pagamentos _r WHERE _r.pagamento_estornado_id = pagamentos.id)', 'g');
    IF v_novo = v_def THEN RAISE EXCEPTION 'nada trocado em %', r.sig; END IF;
    EXECUTE v_novo;
  END LOOP;
END $m$;

DO $m$
DECLARE
  v_def text := pg_get_functiondef('public.pendencias_do_sistema()'::regprocedure);
  v_novo text;
  v_bloco text := $b$
  -- item de OS aberta que o sistema não consegue produzir nem custear: produto de verdade (não serviço, não
  -- revenda), sem ficha de material e sem medida. Quem fez o orçamento sabe o tamanho: o aviso diz quem.
  RETURN QUERY SELECT 'item_sem_medida_e_sem_ficha', 'Itens de OS sem medida e sem ficha de material', count(*)::int,
    (SELECT count(*)::int FROM public.itens_os i2 JOIN public.ordens_servico o2 ON o2.id = i2.os_id
      WHERE o2.finalidade::text = 'venda' AND o2.status::text NOT IN ('concluido','faturado','cancelado')),
    'atencao', 'atendimento',
    'Sem a medida (e sem ficha de material) a produção não reserva material nem agenda a máquina: OS ' ||
      string_agg(DISTINCT 'nº ' || o.numero::text || ' (' || COALESCE(u.nome, 'sem vendedor') || ')', ', ') ||
      '. Cobre de quem fez o orçamento o tamanho da peça e preencha o item.', '/os'
  FROM public.itens_os i
  JOIN public.ordens_servico o ON o.id = i.os_id
  JOIN public.produtos p ON p.id = i.produto_id
  LEFT JOIN public.usuarios u ON u.id = o.vendedor_id
  WHERE o.finalidade::text = 'venda' AND o.status::text NOT IN ('concluido','faturado','cancelado')
    AND p.tipo::text <> 'servico'
    AND NOT ((p.categoria::text = 'brindes' OR p.sku LIKE 'BRI-%' OR p.sku LIKE 'PAN-%' OR p.sku LIKE 'CAR-%') AND p.sku <> 'BRI-CHA')
    AND NOT EXISTS (SELECT 1 FROM public.produto_materiais pm WHERE pm.produto_id = p.id)
    AND COALESCE(i.largura, 0) <= 0 AND COALESCE(i.altura, 0) <= 0
  HAVING count(*) > 0;
$b$;
BEGIN
  v_novo := replace(v_def, E'\n  RETURN;\nEND', v_bloco || E'\n  RETURN;\nEND');
  IF v_novo = v_def THEN RAISE EXCEPTION 'fim de pendencias_do_sistema não encontrado'; END IF;
  v_def := v_novo;
  v_novo := replace(v_def,
    $a$AND NOT (p.categoria::text = 'brindes' OR p.sku LIKE 'BRI-%' OR p.sku LIKE 'PAN-%' OR p.sku LIKE 'CAR-%')
    AND NOT EXISTS (SELECT 1 FROM public.produto_materiais pm WHERE pm.produto_id = p.id)$a$,
    $b$AND NOT ((p.categoria::text = 'brindes' OR p.sku LIKE 'BRI-%' OR p.sku LIKE 'PAN-%' OR p.sku LIKE 'CAR-%') AND p.sku <> 'BRI-CHA')
    AND NOT EXISTS (SELECT 1 FROM public.produto_materiais pm WHERE pm.produto_id = p.id)$b$);
  -- a exceção do chaveiro (BRI-CHA) vale também no aviso de produto sem ficha
  v_novo := replace(v_novo,
    $a$AND NOT (p.categoria::text = 'brindes' OR p.sku LIKE 'BRI-%' OR p.sku LIKE 'PAN-%' OR p.sku LIKE 'CAR-%') HAVING count(*)>0;$a$,
    $b$AND NOT ((p.categoria::text = 'brindes' OR p.sku LIKE 'BRI-%' OR p.sku LIKE 'PAN-%' OR p.sku LIKE 'CAR-%') AND p.sku <> 'BRI-CHA') HAVING count(*)>0;$b$);
  v_def := v_novo;
  v_novo := replace(v_def,
    $a$AND NOT EXISTS (SELECT 1 FROM public.producao_3d_jobs j WHERE j.os_id = o.id) HAVING count(*) > 0;$a$,
    $b$AND NOT EXISTS (SELECT 1 FROM public.producao_3d_jobs j WHERE j.os_id = o.id)
    AND EXISTS (SELECT 1 FROM public.itens_os ix WHERE ix.os_id = o.id AND ix.produto_id IS NOT NULL) HAVING count(*) > 0;$b$);
  IF v_novo = v_def THEN RAISE EXCEPTION 'trecho de os_sem_agenda não encontrado'; END IF;
  EXECUTE v_novo;
END $m$;
