-- Custo cheio do produto: tempo de máquina pela capacidade, energia, e mão de obra com a regra da casa.
-- (25/10/2026, auditoria de custos)
--
-- O QUE ESTAVA ERRADO (Lona 280g: R$ 33,20 de custo cheio para R$ 15,45 de verdade)
--  1. As 5 funções de mão de obra eram o padrão semeado do módulo 3D: R$ 40/h e encargos 0%.
--     R$ 40/h é 5,4× o salário mínimo-hora (R$ 1.621 ÷ 220 = R$ 7,37) e 3,8× a média de um
--     impressor digital (R$ 2.342 ÷ 220 = R$ 10,65). A regra da casa (src/domain/financeiro/
--     encargos.ts) divide pelas 220 h CONTRATADAS e soma os encargos do Simples (32,19%).
--  2. O tempo de máquina de produto por m² vinha do cadastro (20 min/m²), mas a plotter faz
--     14 m²/h = 4,3 min/m²; a agenda (agendar_os_interno) já usava a velocidade. Aqui passa a usar
--     a mesma: máquina = 1 ÷ velocidade; mão de obra = isso × fator (custos_tabela
--     mo_fator_sobre_maquina, 1,5, estimativa a medir). Rateio administrativo segue as horas de gente.
--  3. A energia (kW × tarifa) não entrava; o simulador soma. Agora entra.
-- Dados (aplicados por SQL, fora desta migração): custos_mao_de_obra = R$ 10,65/h e 32,19% nas 5
-- funções; custos_tabela mo_custo_hora = 10,65 e mo_encargos_pct = 32,19; recomposição de todos
-- os produtos (sincronizar_precificacao_do_produto). SALÁRIO REAL pendente: R$ 2.342 é a média
-- nacional (CAGED), não o salário da casa. O módulo 3D (config_precificacao_3d) segue em R$ 40/h.
-- Desfazer: recriar a função de 20260924170000_custo_cheio_da_peca.sql e voltar os parâmetros.
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
  v_faltas text[] := ARRAY[]::text[];
BEGIN
  SELECT pr.id AS id, pr.nome AS nome, pr.tempo_producao_min AS tempo_producao_min,
         pr.maquina_padrao_id AS maquina_padrao_id, pr.unidade AS unidade, pp.preco_base AS preco_base
    INTO p
  FROM public.produtos pr
  LEFT JOIN public.produto_precos pp ON pp.produto_id = pr.id
  WHERE pr.id = p_produto_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Produto não encontrado' USING ERRCODE = 'P0002'; END IF;

  -- 1. material, da receita — a mesma conta de recalcular_custo_produto
  SELECT COALESCE(sum(pm.quantidade_por_unidade * COALESCE(mt.custo_medio, mt.custo_unitario, 0)), 0),
         count(*) FILTER (WHERE COALESCE(mt.custo_medio, mt.custo_unitario, 0) <= 0)
    INTO v_material, v_sem_custo
  FROM public.produto_materiais pm
  JOIN public.materiais mt ON mt.id = pm.material_id
  WHERE pm.produto_id = p_produto_id;

  IF NOT EXISTS (SELECT 1 FROM public.produto_materiais WHERE produto_id = p_produto_id) THEN
    v_faltas := array_append(v_faltas, 'sem ficha de material');
  ELSIF v_sem_custo > 0 THEN
    v_faltas := array_append(v_faltas, v_sem_custo || ' material(is) sem custo de compra');
  END IF;

  -- 2. tempo. Produto vendido por m² numa máquina cobrada por área: o tempo de MÁQUINA
  --    é o da capacidade da máquina (1 ÷ m²/h), o mesmo que a agenda usa em
  --    agendar_os_interno; o tempo de GENTE é o da máquina × o fator de acompanhamento
  --    (preparo do arquivo, carga da bobina, refile) em custos_tabela. Os 20 min/m²
  --    cadastrados antes cobravam 4,7× o tempo real de impressão de uma bobina.
  --    Os demais produtos seguem o tempo cadastrado, por unidade.
  v_horas := COALESCE(p.tempo_producao_min, 0) / 60.0;
  v_h_maq := v_horas; v_h_mo := v_horas;

  -- 3. máquina
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
    -- NÃO inclui a energia (o simulador soma à parte); sem este termo o laser de 1,9 kW
    -- saía R$ 2,15/h mais barato aqui do que no simulador.
    SELECT COALESCE(max(valor), 0) INTO v_tarifa
      FROM public.custos_tabela WHERE ativo AND codigo = 'energia_tarifa_kwh';
    v_maquina := v_maquina + v_h_maq * v_kw * v_tarifa;
  END IF;

  IF v_h_mo <= 0 THEN v_faltas := array_append(v_faltas, 'sem tempo de produção'); END IF;

  -- 4. mão de obra: a função do setor da máquina; sem setor, a mais cara ativa.
  --    O encargo sai de `custos_mao_de_obra`, NÃO do parâmetro geral: usar o
  --    parâmetro por cima de um encargo zerado seria inventar custo que o
  --    cadastro não afirma. O aviso de encargo 0% já existe em /custos-producao.
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
    -- Encargo zerado NÃO é zero: é FGTS, 13º, férias e rescisão que saem do
    -- caixa e não estão na conta. Com o Simples são ~32% a mais; fora dele,
    -- ~60%. Dizer isso aqui é o que impede a composição de parecer completa
    -- com a mão de obra pela metade.
    IF v_mo_encargos <= 0 THEN
      v_faltas := array_append(v_faltas,
        'mão de obra sem encargos: a função ' || v_funcao || ' está com 0%');
    END IF;
  END IF;

  -- 5. rateio administrativo por hora produtiva
  SELECT COALESCE(max(valor), 0) INTO v_admin_hora
  FROM public.custos_tabela WHERE ativo AND codigo = 'custo_admin_hora';
  v_indireto := v_h_mo * v_admin_hora;

  RETURN jsonb_build_object(
    'produto_id', p.id, 'nome', p.nome, 'preco_base', p.preco_base,
    'minutos', COALESCE(p.tempo_producao_min, 0), 'horas', round(v_horas, 4),
    'horas_maquina', round(v_h_maq, 4), 'horas_mao_obra', round(v_h_mo, 4),
    'criterio_do_tempo', v_criterio,
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

INSERT INTO public.custos_tabela (categoria, codigo, descricao, unidade, valor, observacao, ativo)
SELECT 'mao_de_obra', 'mo_fator_sobre_maquina', 'Mão de obra por m² impresso = tempo de máquina × este fator (preparo, carga da bobina, refile)', 'x', 1.5, 'Estimativa de 25/10/2026; medir na produção e ajustar.', true
WHERE NOT EXISTS (SELECT 1 FROM public.custos_tabela WHERE codigo = 'mo_fator_sobre_maquina');

-- Só troca o que ainda é o padrão semeado (R$ 40/h, 0%): salário real digitado depois não é sobrescrito.
UPDATE public.custos_mao_de_obra
   SET custo_hora = 10.65, encargos_pct = 0.3219,
       observacoes = 'Estimativa de 25/10/2026, não é o salário real: R$ 2.342/mês (média nacional de impressor digital, CAGED) ÷ 220 h contratadas = R$ 10,65/h, com 32,19% de encargos do Simples (FGTS, 13º, férias, FGTS s/ 13º e férias, rescisão). Substituir pelo salário real da função.'
 WHERE ativo AND custo_hora = 40 AND COALESCE(encargos_pct, 0) = 0;
UPDATE public.custos_tabela SET valor = 10.65 WHERE codigo = 'mo_custo_hora' AND valor = 40;
UPDATE public.custos_tabela SET valor = 32.19 WHERE codigo = 'mo_encargos_pct' AND valor = 80;

DO $r$
DECLARE x record;
BEGIN
  FOR x IN SELECT id FROM public.produtos LOOP
    PERFORM public.sincronizar_precificacao_do_produto(x.id);
  END LOOP;
END $r$;
