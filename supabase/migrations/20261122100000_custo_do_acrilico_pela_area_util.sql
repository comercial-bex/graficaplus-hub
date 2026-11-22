-- =====================================================================================================
-- O CUSTO DO ACRÍLICO SAI DA ÁREA ÚTIL DA CHAPA, E A NF-e 859 (ACRÍLICO PRETO) ENTRA (22/11/2026)
--
-- O que o dono viu. As notas da Gonçalves & Nunes de 04/11 trazem a chapa Terzian "1030 X 2030" (1,03 × 2,03 m,
-- 2,0909 m²). A Terzian vende esse acrílico no formato comercial 1,00 × 2,00 m: os 3 cm a mais são borda, sobra,
-- e não se vendem. Decisão do dono (22/11): o custo e o estoque contam a ÁREA ÚTIL, 2,00 m² por chapa ("é 2 por 1
-- só mesmo"). Até aqui a compra contava 2,091 m², e o m² ficava 4,3% mais barato do que é.
--
-- E o preto. O acrílico preto 3 mm estava a R$ 400,00 por m², o valor que o saldo de abertura de 05/10 deu aos três
-- acrílicos de 3 mm (cristal, branco e preto). Cristal e branco foram corrigidos pelas compras de 04/11; o preto
-- nunca, porque a NF-e 859 dele (R$ 389,00 a chapa, PIX) não tinha sido lançada. Pela área útil: R$ 194,50 o m².
--
-- O que esta migração faz:
--   1. `materiais` ganha a medida útil da chapa (largura_util_m, comprimento_util_m), lida pelas duas visões, para a
--      tela de compras sugerir sozinha os 2,00 m². As visões são recriadas COM as opções de antes (sem o WITH, o
--      Postgres apaga o security_invoker da operacional, e ela passaria a ignorar o RLS).
--   2. Os seis acrílicos Terzian recebem a medida útil 1,00 × 2,00 m. O preto ganha a medida bruta e a marca.
--   3. As compras de 04/11 (NF-e 860 e 862) passam a render 2,000 m² por chapa, e os lotes e entradas delas também.
--   4. Os lotes de abertura de 05/10 dos três acrílicos de 3 mm saem de R$ 400,00 para o custo da nota.
--   5. O custo por m² dos acrílicos: cristal 2 mm 158,00, cristal 3 mm 180,00, branco 3 mm 200,00, cristal 6 mm
--      400,76, cristal 10 mm 641,25 (o 2, o 6 e o 10 mm pela cotação do fornecedor, a chapa ÷ 2,00 m²).
--   6. A NF-e 859 entra em Compras, no lote e na entrada de estoque, a R$ 194,50 o m². A entrada dispara o gatilho de
--      custo médio, que põe o preto a R$ 194,50.
-- O custo dos produtos que usam esses materiais se recompõe pelos gatilhos que já existem. Preço de venda não muda.
--
-- Nenhuma função nova (nada a fechar com REVOKE). Ensaio no banco vivo, desfeito por RAISE EXCEPTION:
-- docs/ensaio-custo-do-acrilico-pela-area-util-22-11-2026.md.
-- =====================================================================================================
BEGIN;
SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------------------------------
-- 0. Guardas: o banco está como foi medido em 22/11/2026. Qualquer diferença para tudo, sem gravar nada.
-- ---------------------------------------------------------------------------------------------------
DO $guarda$
DECLARE
  v_nome text;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'materiais'
                AND column_name IN ('largura_util_m', 'comprimento_util_m')) THEN
    RAISE EXCEPTION 'a medida útil já existe em materiais: releia antes de aplicar';
  END IF;
  FOREACH v_nome IN ARRAY ARRAY['ACRILICO PRETO VIRGEM 3MM', 'ACRILICO CRISTAL VIRGEM 3MM', 'ACRILICO BRANCO VIRGEM 3MM',
                                'ACRILICO CRISTAL VIRGEM 2MM', 'ACRILICO CRISTAL VIRGEM 6MM', 'ACRILICO CRISTAL VIRGEM 10MM'] LOOP
    IF (SELECT count(*) FROM public.materiais WHERE nome = v_nome) <> 1 THEN
      RAISE EXCEPTION 'esperava um material %, achei outro número', v_nome;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM public.compras_fornecedor WHERE documento = 'NF-e 859') THEN
    RAISE EXCEPTION 'a NF-e 859 já está em Compras: releia antes de lançar de novo';
  END IF;
  IF (SELECT custo_unitario FROM public.materiais WHERE nome = 'ACRILICO PRETO VIRGEM 3MM') <> 400 THEN
    RAISE EXCEPTION 'o preto 3 mm não está mais a R$ 400,00: alguém já corrigiu, releia';
  END IF;
  IF (SELECT count(*) FROM public.material_lotes
       WHERE codigo IN ('E-261104-NF860', 'E-261104-NF862') AND quantidade = 2.0909 AND quantidade_reservada = 0) <> 2 THEN
    RAISE EXCEPTION 'os lotes da NF-e 860 e 862 não estão como foram lançados (2,0909 m² sem reserva)';
  END IF;
  IF EXISTS (SELECT 1 FROM public.movimentacoes_estoque mv
               JOIN public.material_lotes l ON l.id = mv.lote_id
              WHERE l.codigo IN ('E-261104-NF860', 'E-261104-NF862') AND mv.tipo::text <> 'entrada') THEN
    RAISE EXCEPTION 'já saiu material dos lotes de 04/11: a correção da quantidade precisa de outra conta';
  END IF;
  IF (SELECT count(*) FROM public.compras_fornecedor_itens i
        JOIN public.compras_fornecedor c ON c.id = i.compra_id
       WHERE c.documento IN ('NF-e 860', 'NF-e 862') AND i.rende_do_material = 2.091) <> 2 THEN
    RAISE EXCEPTION 'os itens da NF-e 860 e 862 não rendem mais 2,091 m²: releia';
  END IF;
  IF (SELECT count(*) FROM public.material_lotes l JOIN public.materiais m ON m.id = l.material_id
       WHERE l.codigo = 'ABERTURA' AND l.custo_unitario_snapshot = 400 AND l.quantidade = 2
         AND m.nome IN ('ACRILICO PRETO VIRGEM 3MM', 'ACRILICO CRISTAL VIRGEM 3MM', 'ACRILICO BRANCO VIRGEM 3MM')) <> 3 THEN
    RAISE EXCEPTION 'os três lotes de abertura de 3 mm não estão mais a R$ 400,00: releia';
  END IF;
  -- Mexer no material chama a fila de automações de estoque mínimo. Hoje não há nenhuma; se surgir, pare e olhe.
  IF EXISTS (SELECT 1 FROM public.automacoes WHERE ativo AND gatilho = 'estoque_minimo') THEN
    RAISE EXCEPTION 'há automação de estoque mínimo ativa: confira quem ela avisa antes de mexer nos materiais';
  END IF;
END
$guarda$;

-- ---------------------------------------------------------------------------------------------------
-- 1. A medida útil da chapa, lida pelas duas visões de materiais
-- ---------------------------------------------------------------------------------------------------
ALTER TABLE public.materiais
  ADD COLUMN largura_util_m numeric(8, 3) CHECK (largura_util_m IS NULL OR largura_util_m > 0),
  ADD COLUMN comprimento_util_m numeric(8, 3) CHECK (comprimento_util_m IS NULL OR comprimento_util_m > 0),
  ADD CONSTRAINT materiais_area_util_cabe_na_chapa CHECK (
    (largura_util_m IS NULL OR largura_chapa_m IS NULL OR largura_util_m <= largura_chapa_m)
    AND (comprimento_util_m IS NULL OR comprimento_chapa_m IS NULL OR comprimento_util_m <= comprimento_chapa_m)
  );

COMMENT ON COLUMN public.materiais.largura_util_m IS
  'Largura da área útil da chapa, em metros: a que se vende, sem a borda que se refila. A chapa Terzian 1,03 × 2,03 m tem 1,00 × 2,00 m úteis (decisão do dono, 22/11/2026). O custo por m² e o estoque contam esta área.';
COMMENT ON COLUMN public.materiais.comprimento_util_m IS
  'Comprimento da área útil da chapa, em metros. Ver largura_util_m.';

-- A operacional é security_invoker: o leitor precisa do SELECT na coluna, senão a visão inteira cai.
GRANT SELECT (largura_util_m, comprimento_util_m) ON public.materiais TO authenticated;

CREATE OR REPLACE VIEW public.materiais_operacional WITH (security_invoker = true) AS
 SELECT id,
    nome,
    unidade,
    estoque,
    created_at,
    estoque_minimo,
    localizacao,
    status,
    largura_bobina_m,
    comprimento_bobina_m,
    caracteristicas,
    formato,
    largura_chapa_m,
    comprimento_chapa_m,
    espessura_mm,
    largura_util_m,
    comprimento_util_m
   FROM materiais;

CREATE OR REPLACE VIEW public.materiais_financeiro WITH (security_invoker = false, security_barrier = true) AS
 SELECT m.id,
    m.nome,
    m.unidade,
    m.estoque,
    mc.custo_unitario,
    m.created_at,
    m.custo_medio,
    m.fornecedor,
    m.estoque_minimo,
    m.estoque_maximo,
    m.localizacao,
    m.status,
    m.updated_at,
    m.largura_bobina_m,
    m.comprimento_bobina_m,
    m.caracteristicas,
    m.formato,
    m.largura_chapa_m,
    m.comprimento_chapa_m,
    m.espessura_mm,
    m.largura_util_m,
    m.comprimento_util_m
   FROM materiais m
     LEFT JOIN material_custos mc ON mc.material_id = m.id
  WHERE is_staff(auth.uid()) AND can_see_financials(auth.uid());

-- ---------------------------------------------------------------------------------------------------
-- 2. A medida útil dos seis acrílicos Terzian; o preto ganha a medida bruta e a marca que faltavam
-- ---------------------------------------------------------------------------------------------------
UPDATE public.materiais
   SET largura_chapa_m = 1.030, comprimento_chapa_m = 2.030, fornecedor = 'Terzian'
 WHERE nome = 'ACRILICO PRETO VIRGEM 3MM';

UPDATE public.materiais
   SET largura_util_m = 1.000, comprimento_util_m = 2.000
 WHERE nome IN ('ACRILICO PRETO VIRGEM 3MM', 'ACRILICO CRISTAL VIRGEM 3MM', 'ACRILICO BRANCO VIRGEM 3MM',
                'ACRILICO CRISTAL VIRGEM 2MM', 'ACRILICO CRISTAL VIRGEM 6MM', 'ACRILICO CRISTAL VIRGEM 10MM');

-- ---------------------------------------------------------------------------------------------------
-- 3. As compras de 04/11 rendem 2,000 m² por chapa: item da compra, lote e entrada de estoque
--    (o lote recalcula o estoque pelo gatilho; a entrada não tem gatilho de UPDATE)
-- ---------------------------------------------------------------------------------------------------
UPDATE public.compras_fornecedor_itens i
   SET rende_do_material = 2.000
  FROM public.compras_fornecedor c
 WHERE c.id = i.compra_id AND c.documento IN ('NF-e 860', 'NF-e 862') AND i.rende_do_material = 2.091;

UPDATE public.material_lotes
   SET quantidade = 2.00,
       custo_unitario_snapshot = CASE codigo WHEN 'E-261104-NF860' THEN 180.00 ELSE 200.00 END
 WHERE codigo IN ('E-261104-NF860', 'E-261104-NF862');

UPDATE public.movimentacoes_estoque mv
   SET quantidade = 2.00,
       custo_unitario_snapshot = CASE l.codigo WHEN 'E-261104-NF860' THEN 180.00 ELSE 200.00 END
  FROM public.material_lotes l
 WHERE l.id = mv.lote_id AND l.codigo IN ('E-261104-NF860', 'E-261104-NF862') AND mv.tipo::text = 'entrada';

-- ---------------------------------------------------------------------------------------------------
-- 4. Os lotes de abertura de 05/10 (2 m² de cada acrílico de 3 mm) saem dos R$ 400,00 para o custo da nota.
--    É deles que a baixa da OS tira o custo do material.
-- ---------------------------------------------------------------------------------------------------
UPDATE public.material_lotes l
   SET custo_unitario_snapshot = v.custo, custo_total = round(l.quantidade * v.custo, 2)
  FROM public.materiais m,
       (VALUES ('ACRILICO CRISTAL VIRGEM 3MM', 180.00), ('ACRILICO BRANCO VIRGEM 3MM', 200.00),
               ('ACRILICO PRETO VIRGEM 3MM', 194.50)) AS v(nome, custo)
 WHERE m.id = l.material_id AND m.nome = v.nome AND l.codigo = 'ABERTURA' AND l.custo_unitario_snapshot = 400;

-- ---------------------------------------------------------------------------------------------------
-- 5. O custo por m² útil (a chapa ÷ 2,00 m²). Os gatilhos de custo recompõem os produtos que usam cada um.
-- ---------------------------------------------------------------------------------------------------
UPDATE public.materiais m
   SET custo_unitario = v.custo, custo_medio = v.custo
  FROM (VALUES ('ACRILICO CRISTAL VIRGEM 2MM', 158.00),   -- cotação R$ 316,00 a chapa
               ('ACRILICO CRISTAL VIRGEM 3MM', 180.00),   -- NF-e 860, R$ 360,00
               ('ACRILICO BRANCO VIRGEM 3MM', 200.00),    -- NF-e 862, R$ 400,00
               ('ACRILICO CRISTAL VIRGEM 6MM', 400.76),   -- cotação R$ 801,51
               ('ACRILICO CRISTAL VIRGEM 10MM', 641.25))  -- cotação R$ 1.282,49
       AS v(nome, custo)
 WHERE m.nome = v.nome;

-- ---------------------------------------------------------------------------------------------------
-- 6. A NF-e 859: compra, item, lote e entrada de estoque, como as de 04/11 foram lançadas em 16/11.
--    A entrada dispara tg_material_custo_medio, que põe o preto a R$ 194,50 (único custo de entrada dele).
-- ---------------------------------------------------------------------------------------------------
DO $nf859$
DECLARE
  v_fornecedor uuid;
  v_material uuid;
  v_compra uuid;
  v_lote uuid;
  v_quando constant timestamptz := '2026-11-04 10:21:40-03';
BEGIN
  SELECT fornecedor_id INTO v_fornecedor FROM public.compras_fornecedor WHERE documento = 'NF-e 860';
  SELECT id INTO v_material FROM public.materiais WHERE nome = 'ACRILICO PRETO VIRGEM 3MM';
  IF v_fornecedor IS NULL OR v_material IS NULL THEN
    RAISE EXCEPTION 'sem fornecedor da NF-e 860 ou sem o material preto 3 mm';
  END IF;

  INSERT INTO public.compras_fornecedor (fornecedor_id, documento, tipo, data_operacao, comprador_nome, comprador_cnpj,
      codigo_cliente, forma_pagamento, condicao_pagamento, pago, total_bruto, desconto, total, observacoes, fonte)
  VALUES (v_fornecedor, 'NF-e 859', 'venda', v_quando, 'BEX PRINT GRAFICA E COMUNICACAO VISUAL LTDA',
      '68.726.406/0001-90', '28607', 'Pix', 'À vista', true, 389.00, 0, 389.00,
      'Chave de acesso 1626 1138 1412 5300 0239 5500 1000 0008 5915 0670 7119.',
      'DANFE da NF-e 859 da Gonçalves & Nunes LTDA (04/11/2026), enviada pelo usuário em 22/11/2026.')
  RETURNING id INTO v_compra;

  INSERT INTO public.compras_fornecedor_itens (compra_id, ordem, codigo, descricao, unidade, quantidade, preco_lista,
      desconto_pct, preco_unitario, total, finalidade, material_id, rende_do_material)
  VALUES (v_compra, 1, '014896', 'ACRILICO CAST PRETO 3MM 1030 X 2030 - TERZIAN', 'CH', 1, 389.00, 0, 389.00, 389.00,
      'materia_prima', v_material, 2.000);

  INSERT INTO public.material_lotes (material_id, codigo, quantidade, quantidade_reservada, unidade,
      custo_unitario_snapshot, custo_total, fornecedor, status, observacao, created_at)
  VALUES (v_material, 'E-261104-NF859', 2.00, 0, 'm²', 194.50, 389.00, 'Gonçalves & Nunes', 'disponivel',
      'NF-e 859 de 04/11/2026, lançada em 22/11/2026', v_quando)
  RETURNING id INTO v_lote;

  INSERT INTO public.movimentacoes_estoque (material_id, tipo, quantidade, unidade, custo_unitario_snapshot, lote_id,
      origem, motivo, observacao, created_at)
  VALUES (v_material, 'entrada', 2.00, 'm²', 194.50, v_lote, 'entrada_manual', 'NF-e 859 Gonçalves & Nunes',
      'Compra de 04/11/2026 lançada em 22/11/2026 a partir da DANFE', v_quando);

  INSERT INTO public.logs_auditoria (usuario_id, entidade, entidade_id, acao, detalhes)
  VALUES (NULL, 'materiais', v_material, 'custo_pela_area_util', jsonb_build_object(
      'migracao', '20261122100000',
      'regra', 'chapa 1,03 x 2,03 m conta 2,00 m² úteis (decisão do dono, 22/11/2026)',
      'custos_por_m2', jsonb_build_object('preto_3mm', 194.50, 'cristal_2mm', 158.00, 'cristal_3mm', 180.00,
                                          'branco_3mm', 200.00, 'cristal_6mm', 400.76, 'cristal_10mm', 641.25),
      'antes', jsonb_build_object('preto_3mm', 400.00, 'cristal_2mm', 151.13, 'cristal_3mm_medio', 181.16,
                                  'branco_3mm', 191.31, 'cristal_6mm', 383.33, 'cristal_10mm', 595.81),
      'nf_859', jsonb_build_object('compra_id', v_compra, 'lote_id', v_lote, 'valor', 389.00)));
END
$nf859$;

-- ---------------------------------------------------------------------------------------------------
-- 7. Conferência final: custos, estoque, compras, visões e permissões como o planejado
-- ---------------------------------------------------------------------------------------------------
DO $final$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES ('ACRILICO PRETO VIRGEM 3MM', 194.50, 4.00), ('ACRILICO CRISTAL VIRGEM 3MM', 180.00, 4.00),
                                 ('ACRILICO BRANCO VIRGEM 3MM', 200.00, 4.00), ('ACRILICO CRISTAL VIRGEM 2MM', 158.00, 0.00),
                                 ('ACRILICO CRISTAL VIRGEM 6MM', 400.76, 0.00), ('ACRILICO CRISTAL VIRGEM 10MM', 641.25, 0.00))
                    AS v(nome, custo, estoque) LOOP
    IF NOT EXISTS (SELECT 1 FROM public.materiais m
                    WHERE m.nome = r.nome AND m.custo_unitario = r.custo AND m.custo_medio = r.custo
                      AND m.estoque = r.estoque AND m.largura_util_m = 1.000 AND m.comprimento_util_m = 2.000) THEN
      RAISE EXCEPTION '% não ficou com custo %, estoque % e área útil 1,00 × 2,00', r.nome, r.custo, r.estoque;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM public.compras_fornecedor_itens i JOIN public.compras_fornecedor c ON c.id = i.compra_id
       WHERE c.documento IN ('NF-e 859', 'NF-e 860', 'NF-e 862') AND i.rende_do_material = 2.000) <> 3 THEN
    RAISE EXCEPTION 'as três chapas de 04/11 não rendem 2,000 m² em Compras';
  END IF;
  IF EXISTS (SELECT 1 FROM public.material_lotes WHERE custo_unitario_snapshot = 400 AND codigo = 'ABERTURA'
               AND material_id IN (SELECT id FROM public.materiais WHERE nome LIKE 'ACRILICO % VIRGEM 3MM')) THEN
    RAISE EXCEPTION 'ainda há lote de abertura de 3 mm a R$ 400,00';
  END IF;
  IF NOT (SELECT 'security_invoker=true' = ANY(reloptions) FROM pg_class WHERE oid = 'public.materiais_operacional'::regclass) THEN
    RAISE EXCEPTION 'materiais_operacional perdeu o security_invoker';
  END IF;
  IF NOT (SELECT 'security_barrier=true' = ANY(reloptions) FROM pg_class WHERE oid = 'public.materiais_financeiro'::regclass) THEN
    RAISE EXCEPTION 'materiais_financeiro perdeu o security_barrier';
  END IF;
  IF NOT has_column_privilege('authenticated', 'public.materiais', 'largura_util_m', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'public.materiais', 'comprimento_util_m', 'SELECT') THEN
    RAISE EXCEPTION 'authenticated não lê a medida útil: a visão operacional cairia inteira';
  END IF;
END
$final$;

COMMIT;

-- =====================================================================================================
-- DESFAZER (os valores de antes estão no logs_auditoria, acao 'custo_pela_area_util'):
--   DELETE FROM public.movimentacoes_estoque WHERE lote_id = (SELECT id FROM public.material_lotes WHERE codigo = 'E-261104-NF859');
--   DELETE FROM public.material_lotes WHERE codigo = 'E-261104-NF859';
--   DELETE FROM public.compras_fornecedor WHERE documento = 'NF-e 859';  -- os itens saem em cascata
--   UPDATE public.material_lotes SET quantidade = 2.0909, custo_unitario_snapshot = 172.1747 WHERE codigo = 'E-261104-NF860';
--   UPDATE public.material_lotes SET quantidade = 2.0909, custo_unitario_snapshot = 191.3052 WHERE codigo = 'E-261104-NF862';
--   (entradas de 04/11 de volta a 2,09 m²; itens das NF-e 860 e 862 de volta a 2,091; lotes ABERTURA de 3 mm a R$ 400,00;
--    custos de materiais como em 'antes'; visões recriadas sem as duas colunas, COM as opções; DROP das duas colunas)
-- =====================================================================================================
