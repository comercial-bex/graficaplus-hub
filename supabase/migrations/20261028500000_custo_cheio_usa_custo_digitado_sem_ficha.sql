-- 28/10/2026 — auditoria de preços: a composição do custo ignorava o custo digitado.
--
-- `custo_cheio_do_produto` somava o material SÓ pela ficha (produto_materiais). Produto
-- sem ficha mas com `custo_medio` digitado no cadastro — todos os brindes, o acrílico
-- espelhado, o quadro, cartão/panfleto terceirizados, 27 dos 79 ativos — saía com material
-- ZERO: o chaveiro acrílico (custo R$ 2,25) "custava" R$ 0,55 (só laser e mão de obra) e a
-- tela de precificação mostrava margem de 92% onde a real é 57%. O item do orçamento já usava
-- o custo digitado (tg_orcamento_item_custo_do_produto), e a view produto_custo_cheio também
-- (COALESCE com pr.custo_medio): só esta função, a que a tela e o PDF "USO INTERNO" leem,
-- contava diferente. Agora, sem ficha, o material é o custo digitado; a falta "sem ficha de
-- material" continua (a ficha ainda é o certo), com a origem do número em `origem_material`.

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
  v_faltas text[] := ARRAY[]::text[];
BEGIN
  SELECT pr.id AS id, pr.nome AS nome, pr.tempo_producao_min AS tempo_producao_min,
         pr.maquina_padrao_id AS maquina_padrao_id, pr.unidade AS unidade, pp.preco_base AS preco_base,
         pr.custo_medio AS custo_medio
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

    -- Energia: horas × kW × tarifa. O custo/hora da máquina é depreciação/locação e
    -- NÃO inclui a energia (o simulador soma à parte).
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

-- Recompõe a composição guardada (produto_precificacao) de todo produto, com a conta nova.
DO $r$
DECLARE x record;
BEGIN
  FOR x IN SELECT id FROM public.produtos LOOP
    PERFORM public.sincronizar_precificacao_do_produto(x.id);
  END LOOP;
END $r$;
