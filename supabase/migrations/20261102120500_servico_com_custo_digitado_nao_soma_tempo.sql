-- O serviço cujo custo digitado já é o custo inteiro não soma o tempo de novo (02/11/2026).
--
-- `custo_cheio_do_produto` trata o custo digitado sem ficha como material (20261028500000) e soma máquina, gente e
-- rateio por cima. No brinde isso está certo: o digitado é o preço de compra. No serviço, não: o Refile de lona tem
-- R$ 0,24 digitados, que são os 0,6 min × R$ 24,17 por hora, e a conta somava mais R$ 0,40. A margem saía -28%.
--
--   Serviço              Antes    Depois   Margem antes   Margem depois
--   Bainha na lona       R$ 5,64  R$ 2,82      -2,5%          48,7%
--   Bastão e corda       R$ 9,02  R$ 7,01      24,8%          41,6%
--   Colagem da borda     R$ 4,02  R$ 2,01     -14,9%          42,6%
--   Ilhós na lona        R$ 3,12  R$ 1,91      10,9%          45,4%
--   Refile de lona       R$ 0,64  R$ 0,24     -28,0%          52,0%
--   Criação/arte final   R$ 64,18 R$ 40,00     28,7%          55,6%
--   Instalação em campo  R$ 84,18 R$ 60,00     35,2%          53,8%
--
-- Fica no campo de material, como já estava em Acabamento manual e Recorte: é onde a view e o gatilho
-- `tg_sync_produto_precificacao` esperam o custo digitado. Mudar de campo faria a view somar duas vezes de novo.
-- As horas não mudam (a agenda lê `tempo_producao_min`). Nenhum item de orçamento usava estes 7 produtos.
-- `sem_hora_de_maquina` e `sem_mao_de_obra` deixam de acusar estes serviços: não falta nada neles, e o desconto
-- avisaria "só material" à toa.
--
-- Desfazer: reaplicar a função de 20261028500000 (com as mudanças seguintes) e a view anterior, e sincronizar.

CREATE OR REPLACE FUNCTION public.custo_cheio_do_produto(p_produto_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  p RECORD;
  v_maquina_nome text; v_maquina_custo numeric; v_setor text;
  v_velocidade numeric; v_base text; v_kw numeric := 0; v_tarifa numeric := 0;
  v_funcao text; v_mo_hora numeric; v_mo_encargos numeric;
  v_material numeric := 0; v_sem_custo int := 0;
  v_horas numeric := 0; v_h_maq numeric := 0; v_h_mo numeric := 0;
  v_maquina numeric := 0; v_mao numeric := 0; v_indireto numeric := 0;
  v_admin_hora numeric := 0; v_fator numeric := 1.5;
  v_criterio text := 'tempo cadastrado';
  v_origem_material text := 'ficha de material';
  v_servico_inteiro boolean := false;
  v_faltas text[] := ARRAY[]::text[];
BEGIN
  SELECT pr.id AS id, pr.nome AS nome, pr.tempo_producao_min AS tempo_producao_min,
         pr.maquina_padrao_id AS maquina_padrao_id, pr.unidade AS unidade, pp.preco_base AS preco_base,
         pr.custo_medio AS custo_medio, pr.tipo AS tipo
    INTO p
  FROM public.produtos pr
  LEFT JOIN public.produto_precos pp ON pp.produto_id = pr.id
  WHERE pr.id = p_produto_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Produto não encontrado' USING ERRCODE = 'P0002'; END IF;

  SELECT COALESCE(sum(pm.quantidade_por_unidade * COALESCE(mt.custo_medio, mt.custo_unitario, 0)), 0),
         count(*) FILTER (WHERE COALESCE(mt.custo_medio, mt.custo_unitario, 0) <= 0)
    INTO v_material, v_sem_custo
  FROM public.produto_materiais pm
  JOIN public.materiais mt ON mt.id = pm.material_id
  WHERE pm.produto_id = p_produto_id;

  IF NOT EXISTS (SELECT 1 FROM public.produto_materiais WHERE produto_id = p_produto_id) THEN
    v_faltas := array_append(v_faltas, 'sem ficha de material');
    -- Sem ficha, vale o custo digitado no cadastro: é o que o item do orçamento usa.
    IF COALESCE(p.custo_medio, 0) > 0 THEN
      v_material := p.custo_medio;
      v_origem_material := 'custo digitado no cadastro (sem ficha)';
      -- No serviço, o digitado já é o tempo e o rateio: somar de novo contaria duas vezes.
      v_servico_inteiro := p.tipo = 'servico';
    ELSE
      v_origem_material := 'nenhum';
    END IF;
  ELSIF v_sem_custo > 0 THEN
    v_faltas := array_append(v_faltas, v_sem_custo || ' material(is) sem custo de compra');
  END IF;

  v_horas := COALESCE(p.tempo_producao_min, 0) / 60.0;
  v_h_maq := v_horas; v_h_mo := v_horas;

  IF p.maquina_padrao_id IS NULL THEN
    v_faltas := array_append(v_faltas, 'sem máquina padrão');
  ELSE
    SELECT mq.nome, mq.custo_hora, mq.setor, mq.velocidade_m2_h, mq.base_cobranca, COALESCE(mq.potencia_kw, 0)
      INTO v_maquina_nome, v_maquina_custo, v_setor, v_velocidade, v_base, v_kw
    FROM public.maquinas mq WHERE mq.id = p.maquina_padrao_id;

    IF v_base = 'area' AND COALESCE(v_velocidade, 0) > 0
       AND lower(replace(COALESCE(p.unidade, ''), '²', '2')) = 'm2' THEN
      SELECT COALESCE(max(valor), 1.5) INTO v_fator
        FROM public.custos_tabela WHERE ativo AND codigo = 'mo_fator_sobre_maquina';
      v_h_maq := 1.0 / v_velocidade;
      v_h_mo := v_h_maq * v_fator;
      v_criterio := 'velocidade da máquina (' || v_velocidade || ' m²/h) × ' || v_fator || ' para a mão de obra';
    END IF;

    IF COALESCE(v_maquina_custo, 0) <= 0 THEN
      v_faltas := array_append(v_faltas, 'máquina ' || COALESCE(v_maquina_nome, '?') || ' sem custo por hora');
    ELSE
      v_maquina := v_h_maq * v_maquina_custo;
    END IF;

    SELECT COALESCE(max(valor), 0) INTO v_tarifa
      FROM public.custos_tabela WHERE ativo AND codigo = 'energia_tarifa_kwh';
    v_maquina := v_maquina + v_h_maq * v_kw * v_tarifa;
  END IF;

  IF v_h_mo <= 0 THEN v_faltas := array_append(v_faltas, 'sem tempo de produção'); END IF;

  SELECT cm.funcao, cm.custo_hora, COALESCE(cm.encargos_pct, 0)
    INTO v_funcao, v_mo_hora, v_mo_encargos
  FROM public.custos_mao_de_obra cm
  WHERE cm.ativo
  ORDER BY (cm.setor IS NOT DISTINCT FROM v_setor) DESC, cm.custo_hora DESC
  LIMIT 1;

  IF COALESCE(v_mo_hora, 0) <= 0 THEN
    v_faltas := array_append(v_faltas, 'sem custo de mão de obra cadastrado');
  ELSE
    v_mao := v_h_mo * v_mo_hora * (1 + v_mo_encargos);
    IF v_mo_encargos <= 0 THEN
      v_faltas := array_append(v_faltas,
        'mão de obra sem encargos: a função ' || v_funcao || ' está com 0%');
    END IF;
  END IF;

  SELECT COALESCE(max(valor), 0) INTO v_admin_hora
  FROM public.custos_tabela WHERE ativo AND codigo = 'custo_admin_hora';
  v_indireto := v_h_mo * v_admin_hora;

  IF v_servico_inteiro THEN
    v_maquina := 0; v_mao := 0; v_indireto := 0;
    v_origem_material := 'custo digitado no cadastro (serviço: já inclui tempo e rateio)';
    v_faltas := ARRAY[]::text[];
  END IF;

  RETURN jsonb_build_object(
    'produto_id', p.id, 'nome', p.nome, 'preco_base', p.preco_base,
    'minutos', COALESCE(p.tempo_producao_min, 0), 'horas', round(v_horas, 4),
    'horas_maquina', round(v_h_maq, 4), 'horas_mao_obra', round(v_h_mo, 4),
    'criterio_do_tempo', v_criterio,
    'origem_material', v_origem_material,
    'custo_material', round(v_material, 4),
    'custo_maquina', round(v_maquina, 4),
    'custo_mao_obra', round(v_mao, 4),
    'custo_indireto', round(v_indireto, 4),
    'custo_total', round(v_material + v_maquina + v_mao + v_indireto, 4),
    'maquina', v_maquina_nome, 'funcao', v_funcao,
    'completo', (array_length(v_faltas, 1) IS NULL),
    'faltas', to_jsonb(v_faltas)
  );
END $function$;

CREATE OR REPLACE VIEW public.produto_custo_cheio AS
 SELECT p.id AS produto_id,
    p.nome,
    p.tempo_producao_min,
    pr.preco_base,
    pr.custo_medio,
    COALESCE(NULLIF(pp.custo_material, (0)::numeric), pr.custo_medio, (0)::numeric) AS custo_material,
    COALESCE(pp.custo_maquina, (0)::numeric) AS custo_maquina,
    COALESCE(pp.custo_mao_obra, (0)::numeric) AS custo_mao_obra,
    COALESCE(pp.custo_indireto, (0)::numeric) AS custo_indireto,
    (((COALESCE(NULLIF(pp.custo_material, (0)::numeric), pr.custo_medio, (0)::numeric) + COALESCE(pp.custo_maquina, (0)::numeric)) + COALESCE(pp.custo_mao_obra, (0)::numeric)) + COALESCE(pp.custo_indireto, (0)::numeric)) AS custo_cheio,
    ((pp.produto_id IS NULL) OR (NULLIF(pp.custo_material, (0)::numeric) IS NULL)) AS sem_ficha_de_material,
    ((COALESCE(pp.custo_maquina, (0)::numeric) = (0)::numeric) AND NOT inteiro.servico) AS sem_hora_de_maquina,
    ((COALESCE(pp.custo_mao_obra, (0)::numeric) = (0)::numeric) AND NOT inteiro.servico) AS sem_mao_de_obra,
    ((COALESCE(pp.custo_indireto, (0)::numeric) = (0)::numeric) AND NOT inteiro.servico) AS sem_rateio
   FROM ((produtos p
     JOIN produto_precos pr ON ((pr.produto_id = p.id)))
     LEFT JOIN produto_precificacao pp ON ((pp.produto_id = p.id)))
     CROSS JOIN LATERAL (SELECT (p.tipo = 'servico' AND COALESCE(pr.custo_medio, 0) > 0
       AND NOT EXISTS (SELECT 1 FROM produto_materiais pm WHERE pm.produto_id = p.id)) AS servico) inteiro;

SELECT public.sincronizar_precificacao_do_produto(p.id)
  FROM public.produtos p
 WHERE p.tipo = 'servico'
   AND COALESCE(p.custo_medio, 0) > 0
   AND NOT EXISTS (SELECT 1 FROM public.produto_materiais pm WHERE pm.produto_id = p.id);
