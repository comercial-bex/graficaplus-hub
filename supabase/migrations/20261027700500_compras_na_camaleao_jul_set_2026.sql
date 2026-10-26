-- Compras na Camaleão Tintas, jul–set/2026 (26/10/2026, pedido do dono).
--
-- APLICADA no banco vivo em 26/10/2026 pelo MCP, a pedido do dono, depois de
-- ensaio com rollback; conferida com as contas reais logo em seguida.
--
-- Fonte: 8 prints do ControlShop da Camaleão (tirados em 23/10/2026), enviados
-- pelo dono. Todos com "OPERAÇÃO RECEBIDA" (pagos). Comprado em dois CNPJs da
-- casa: a Agência Bex (códigos 1 e 1000086 na Camaleão) e a Bex Print
-- (68.726.406/0001-90, código 1; o CNPJ abriu em 21/08/2026).
--
--   VENDA     21512  30/07  Agência Bex   1.328,28  vinil branco ×2, lona 280, água, refrigerante
--   VENDA     21517  30/07  Agência Bex      97,19  ferramentas de aplicação
--   RESERVA   22426  15/08  Agência Bex   2.734,30  vinil branco ×5, tinta Jetbest 4 cores, vinil transparente
--   RESERVA   22921  27/08  Bex Print       400,00  vinil perfurado 1,27 × 50
--   RESERVA   22990  28/08  Agência Bex      21,87  lâmina de corte 45°
--   VENDA     23192  02/09  Agência Bex     315,00  soprador térmico — DEVOLVIDO
--   VENDA     23220  02/09  Agência Bex     511,00  soprador térmico Bosch (a troca)
--   DEVOLUÇÃO 23222  02/09  Agência Bex    −315,00  desfaz a 23192
--   Pago no total, líquido: R$ 5.092,64 (Agência Bex 4.692,64; Bex Print 400,00).
--
-- Reserva, no ControlShop, é pedido separado e pago que não virou venda (sem
-- nota). Os 4 litros Jetbest da 22426 batem com os 4.000 ml de "Tinta solvente
-- (conjunto)" lançados no estoque em 22/10/2026 — lá a R$ 0,09/ml; pagos aqui
-- a R$ 0,2317/ml.
--
-- Só registro: não mexe em estoque, caixa nem custo do material (decisão do
-- dono). Idempotente pelo par fornecedor + documento.

DO $importa$
DECLARE
  v_forn uuid;
  v_fonte constant text := 'Prints do ControlShop da Camaleão Tintas (23/10/2026), enviados pelo dono em 26/10/2026';
  v_agencia constant text := 'AGENCIA BEX LTDA';
  v_print constant text := 'BEX PRINT GRAFICA E COMUNICACAO VISUAL LTDA';
  v_print_cnpj constant text := '68.726.406/0001-90';
  v_vinil_branco uuid := (SELECT id FROM public.materiais WHERE nome = 'Vinil adesivo branco brilho' LIMIT 1);
  v_lona_280 uuid := (SELECT id FROM public.materiais WHERE nome = 'Lona 280g brilho' LIMIT 1);
  v_perfurado uuid := (SELECT id FROM public.materiais WHERE nome = 'Vinil adesivo perfurado' LIMIT 1);
  v_tinta uuid := (SELECT id FROM public.materiais WHERE nome = 'Tinta solvente (conjunto)' LIMIT 1);
  v_c uuid;
  v_23192 uuid;
BEGIN
  SELECT id INTO v_forn FROM public.fornecedores WHERE nome ILIKE 'camale%o tintas' LIMIT 1;
  IF v_forn IS NULL THEN
    INSERT INTO public.fornecedores (nome, categorias, observacoes)
    VALUES ('Camaleão Tintas', ARRAY['tintas', 'materia_prima', 'insumos', 'ferramentas'],
            'Loja de tintas e comunicação visual em Macapá (sistema ControlShop, "Loja 1"). Vende vinil, lona, tinta solvente Jetbest e ferramentas de aplicação. Razão social, CNPJ e contato não aparecem nos prints: completar.')
    RETURNING id INTO v_forn;
  END IF;

  -- VENDA 21512 --------------------------------------------------------------
  INSERT INTO public.compras_fornecedor (fornecedor_id, documento, tipo, data_operacao, comprador_nome, codigo_cliente,
    forma_pagamento, condicao_pagamento, pago, total_bruto, desconto, total, observacoes, fonte, created_by)
  VALUES (v_forn, 'VENDA 21512', 'venda', '2026-07-30 14:33:25-03', v_agencia, '1', 'Pix', 'À vista', true,
          1659.81, 331.53, 1328.28, 'Inclui água e refrigerante (consumo).', v_fonte, NULL)
  ON CONFLICT (fornecedor_id, documento) DO NOTHING RETURNING id INTO v_c;
  IF v_c IS NOT NULL THEN
    INSERT INTO public.compras_fornecedor_itens (compra_id, ordem, codigo, descricao, unidade, quantidade, preco_lista,
      desconto_pct, preco_unitario, total, finalidade, material_id, rende_do_material) VALUES
      (v_c, 1, '00.06.671', 'VINIL BRANCO BR 1,06X50M SYNTP', 'RL', 1, 474.46, 19.9089, 380.00, 380.00, 'materia_prima', v_vinil_branco, 53),
      (v_c, 2, '00.05.856', 'VINIL BRANCO BR 1.06X50M - DEX', 'RL', 1, 450.00, 20.0000, 360.00, 360.00, 'materia_prima', v_vinil_branco, 53),
      (v_c, 3, '00.08.035', 'DEX VINIL LONA P/ IMPRESSAO (280G) 1,60X50M', 'UN', 1, 725.00, 20.0000, 580.00, 580.00, 'materia_prima', v_lona_280, 80),
      (v_c, 4, '00.08.012', 'AGUA MINERAL (COM GAS)', 'UN', 1, 3.75, 20.0000, 3.00, 3.00, 'consumo', NULL, NULL),
      (v_c, 5, '00.07.918', 'REFRIGERANTE COCA COLA ZERO LATA 350ML', 'UN', 1, 6.60, 20.0000, 5.28, 5.28, 'consumo', NULL, NULL);
  END IF;

  -- VENDA 21517 --------------------------------------------------------------
  v_c := NULL;
  INSERT INTO public.compras_fornecedor (fornecedor_id, documento, tipo, data_operacao, comprador_nome, codigo_cliente,
    forma_pagamento, condicao_pagamento, pago, total_bruto, desconto, total, observacoes, fonte, created_by)
  VALUES (v_forn, 'VENDA 21517', 'venda', '2026-07-30 14:45:10-03', v_agencia, '1', 'Pix', 'À vista', true,
          119.09, 21.90, 97.19, NULL, v_fonte, NULL)
  ON CONFLICT (fornecedor_id, documento) DO NOTHING RETURNING id INTO v_c;
  IF v_c IS NOT NULL THEN
    INSERT INTO public.compras_fornecedor_itens (compra_id, ordem, codigo, descricao, unidade, quantidade, preco_lista,
      desconto_pct, preco_unitario, total, finalidade) VALUES
      (v_c, 1, '00.07.783', 'PULVERIZADOR 2L - LOTUS', 'UN', 1, 29.98, 20.0133, 23.98, 23.98, 'ferramenta'),
      (v_c, 2, '00.07.513', 'EXF FELTRO RIGIDO DE LA', 'UN', 1, 22.95, 20.0000, 18.36, 18.36, 'ferramenta'),
      (v_c, 3, '00.07.785', 'LAMINAS P/ ESTILETE 18MM / CAIXA COM 10 - LOTUS', 'UN', 1, 9.43, 15.1644, 8.00, 8.00, 'ferramenta'),
      (v_c, 4, '00.08.114', 'ESPATULA REVESTIDA AMARELA JOKER', 'UND', 1, 7.25, 3.4483, 7.00, 7.00, 'ferramenta'),
      (v_c, 5, '00.07.505', 'EXF KIT APLICADOR (15-21409)', 'UN', 1, 17.17, 18.4624, 14.00, 14.00, 'ferramenta'),
      (v_c, 6, '00.07.507', 'EXF ESTILETE LARGO HOBBY SK2 (15-060XD)', 'UN', 1, 32.31, 19.9938, 25.85, 25.85, 'ferramenta');
  END IF;

  -- RESERVA 22426 ------------------------------------------------------------
  v_c := NULL;
  INSERT INTO public.compras_fornecedor (fornecedor_id, documento, tipo, data_operacao, comprador_nome, codigo_cliente,
    forma_pagamento, condicao_pagamento, pago, total_bruto, desconto, total, observacoes, fonte, created_by)
  VALUES (v_forn, 'RESERVA 22426', 'reserva', '2026-08-15 13:15:21-03', v_agencia, '1000086', 'Dinheiro', 'À vista', true,
          3542.88, 808.58, 2734.30,
          'Reserva paga que não virou venda no ControlShop (sem nota). Os 4 litros Jetbest batem com os 4.000 ml de "Tinta solvente (conjunto)" lançados no estoque em 22/10/2026 a R$ 0,09/ml; pagos aqui a R$ 0,2317/ml. Pedir a nota.',
          v_fonte, NULL)
  ON CONFLICT (fornecedor_id, documento) DO NOTHING RETURNING id INTO v_c;
  IF v_c IS NOT NULL THEN
    INSERT INTO public.compras_fornecedor_itens (compra_id, ordem, codigo, descricao, unidade, quantidade, preco_lista,
      desconto_pct, preco_unitario, total, finalidade, material_id, rende_do_material) VALUES
      (v_c, 1, '00.05.856', 'VINIL BRANCO BR 1.06X50M - DEX', 'RL', 5, 450.00, 24.4444, 340.00, 1700.00, 'materia_prima', v_vinil_branco, 53),
      (v_c, 2, '00.06.136', 'JETBEST DX SILVER BLACK 1L', 'UN', 1, 289.62, 19.9986, 231.70, 231.70, 'tinta', v_tinta, 1000),
      (v_c, 3, '00.06.137', 'JETBEST DX SILVER CYAN 1L', 'UN', 1, 289.62, 19.9986, 231.70, 231.70, 'tinta', v_tinta, 1000),
      (v_c, 4, '00.06.138', 'JETBEST DX SILVER MAGENTA 1L', 'UN', 1, 289.62, 19.9986, 231.70, 231.70, 'tinta', v_tinta, 1000),
      (v_c, 5, '00.06.139', 'JETBEST DX SILVER YELLOW 1L', 'UN', 1, 289.62, 19.9986, 231.70, 231.70, 'tinta', v_tinta, 1000),
      (v_c, 6, '00.06.608', 'VINIL TRANSPARENTE 1,22M PREMIUM - ALLTAK', 'MT', 5, 26.88, 20.0149, 21.50, 107.50, 'materia_prima', NULL, NULL);
  END IF;

  -- RESERVA 22921 (Bex Print) ------------------------------------------------
  v_c := NULL;
  INSERT INTO public.compras_fornecedor (fornecedor_id, documento, tipo, data_operacao, comprador_nome, comprador_cnpj,
    codigo_cliente, forma_pagamento, condicao_pagamento, pago, total_bruto, desconto, total, observacoes, fonte, created_by)
  VALUES (v_forn, 'RESERVA 22921', 'reserva', '2026-08-27 14:38:41-03', v_print, v_print_cnpj, '1', 'Pix', 'Cartão', true,
          500.00, 100.00, 400.00,
          'Primeira compra no CNPJ da Bex Print. Reserva paga que não virou venda no ControlShop (sem nota). O documento traz forma Pix com condição Cartão. O cadastro do material diz bobina de 1,06 m; esta é de 1,27 m.',
          v_fonte, NULL)
  ON CONFLICT (fornecedor_id, documento) DO NOTHING RETURNING id INTO v_c;
  IF v_c IS NOT NULL THEN
    INSERT INTO public.compras_fornecedor_itens (compra_id, ordem, codigo, descricao, unidade, quantidade, preco_lista,
      desconto_pct, preco_unitario, total, finalidade, material_id, rende_do_material) VALUES
      (v_c, 1, '00.05.854', 'DEX VINIL ADESIVO PERFURADO 1.27 X 50M', 'UN', 1, 500.00, 20.0000, 400.00, 400.00, 'materia_prima', v_perfurado, 63.5);
  END IF;

  -- RESERVA 22990 ------------------------------------------------------------
  v_c := NULL;
  INSERT INTO public.compras_fornecedor (fornecedor_id, documento, tipo, data_operacao, comprador_nome, codigo_cliente,
    forma_pagamento, condicao_pagamento, pago, total_bruto, desconto, total, observacoes, fonte, created_by)
  VALUES (v_forn, 'RESERVA 22990', 'reserva', '2026-08-28 16:48:35-03', v_agencia, '1000086', 'Pix', 'À vista', true,
          27.34, 5.47, 21.87, 'Reserva paga que não virou venda no ControlShop (sem nota).', v_fonte, NULL)
  ON CONFLICT (fornecedor_id, documento) DO NOTHING RETURNING id INTO v_c;
  IF v_c IS NOT NULL THEN
    INSERT INTO public.compras_fornecedor_itens (compra_id, ordem, codigo, descricao, unidade, quantidade, preco_lista,
      desconto_pct, preco_unitario, total, finalidade) VALUES
      (v_c, 1, '00.06.541', 'EXF LAMINA DE CORTE PADRAO 45> (6-003-45)', 'UN', 1, 27.34, 20.0073, 21.87, 21.87, 'ferramenta');
  END IF;

  -- VENDA 23192 (devolvida) --------------------------------------------------
  v_c := NULL;
  INSERT INTO public.compras_fornecedor (fornecedor_id, documento, tipo, data_operacao, comprador_nome, codigo_cliente,
    forma_pagamento, condicao_pagamento, pago, total_bruto, desconto, total, observacoes, fonte, created_by)
  VALUES (v_forn, 'VENDA 23192', 'venda', '2026-09-02 14:26:01-03', v_agencia, '1000086', 'Pix', 'Cartão', true,
          393.14, 78.14, 315.00,
          'Devolvida no mesmo dia (DEVOLUÇÃO 23222) e trocada pelo soprador Bosch (VENDA 23220). O documento traz forma Pix com condição Cartão.',
          v_fonte, NULL)
  ON CONFLICT (fornecedor_id, documento) DO NOTHING RETURNING id INTO v_c;
  IF v_c IS NOT NULL THEN
    INSERT INTO public.compras_fornecedor_itens (compra_id, ordem, codigo, descricao, unidade, quantidade, preco_lista,
      desconto_pct, preco_unitario, total, finalidade) VALUES
      (v_c, 1, '00.08.417', 'EXF SOPRADOR TERMICO COM PROTETOR ANTI QUEIMA LILAS (21-6101) 110V', 'UN', 1, 393.14, 19.8759, 315.00, 315.00, 'ferramenta');
  END IF;

  -- VENDA 23220 --------------------------------------------------------------
  v_c := NULL;
  INSERT INTO public.compras_fornecedor (fornecedor_id, documento, tipo, data_operacao, comprador_nome, codigo_cliente,
    forma_pagamento, condicao_pagamento, pago, total_bruto, desconto, total, observacoes, fonte, created_by)
  VALUES (v_forn, 'VENDA 23220', 'venda', '2026-09-02 16:17:31-03', v_agencia, '1000086', 'Cartão débito', 'À vista', true,
          638.44, 127.44, 511.00, 'Troca do soprador da VENDA 23192.', v_fonte, NULL)
  ON CONFLICT (fornecedor_id, documento) DO NOTHING RETURNING id INTO v_c;
  IF v_c IS NOT NULL THEN
    INSERT INTO public.compras_fornecedor_itens (compra_id, ordem, codigo, descricao, unidade, quantidade, preco_lista,
      desconto_pct, preco_unitario, total, finalidade) VALUES
      (v_c, 1, '00.00.072', 'SOPRADOR TERMICO 1600W GHG 180 127V - BOSCH', 'UN', 1, 638.44, 19.9612, 511.00, 511.00, 'ferramenta');
  END IF;

  -- DEVOLUÇÃO 23222 ----------------------------------------------------------
  SELECT id INTO v_23192 FROM public.compras_fornecedor WHERE fornecedor_id = v_forn AND documento = 'VENDA 23192';
  v_c := NULL;
  INSERT INTO public.compras_fornecedor (fornecedor_id, documento, tipo, data_operacao, comprador_nome, codigo_cliente,
    forma_pagamento, condicao_pagamento, pago, total_bruto, desconto, total, devolve_compra_id, observacoes, fonte, created_by)
  VALUES (v_forn, 'DEVOLUÇÃO 23222', 'devolucao', '2026-09-02 16:28:23-03', v_agencia, '1000086', 'Cartão débito', 'À vista', true,
          -315.00, 0.00, -315.00, v_23192, 'Devolve o soprador da VENDA 23192.', v_fonte, NULL)
  ON CONFLICT (fornecedor_id, documento) DO NOTHING RETURNING id INTO v_c;
  IF v_c IS NOT NULL THEN
    INSERT INTO public.compras_fornecedor_itens (compra_id, ordem, codigo, descricao, unidade, quantidade, preco_lista,
      desconto_pct, preco_unitario, total, finalidade) VALUES
      -- O print mostra preço e quantidade negativos; aqui o preço é o da venda e
      -- só a quantidade é negativa, para quantidade × preço dar o total.
      (v_c, 1, '00.08.417', 'EXF SOPRADOR TERMICO COM PROTETOR ANTI QUEIMA LILAS (21-6101) 110V', 'UN', -1, 393.14, 19.8759, 315.00, -315.00, 'ferramenta');
  END IF;

  -- Conferência: a soma dos itens bate com o total de cada documento.
  IF EXISTS (
    SELECT 1 FROM public.compras_fornecedor c
     WHERE c.fornecedor_id = v_forn
       AND c.total <> (SELECT coalesce(sum(i.total), 0) FROM public.compras_fornecedor_itens i WHERE i.compra_id = c.id)
  ) THEN
    RAISE EXCEPTION 'Documento da Camaleão com soma dos itens diferente do total.';
  END IF;
END
$importa$;
