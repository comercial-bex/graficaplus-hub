-- =====================================================================================================
-- PREÇO MÍNIMO RECOMENDADO (16/11/2026)
-- Ensaio com RAISE EXCEPTION final no banco vivo em docs/ensaio-preco-minimo.md. A aplicação é feita depois, pelo dono,
-- depois de 20261116100000, 20261116110000 e 20261116120000 (as três já estão aplicadas e publicadas).
-- O preço de NENHUM produto muda aqui: produtos.preco_base, produto_precos, orçamentos e itens de OS ficam como estão.
-- As duas únicas linhas de preço que nascem são PROPOSTAS pendentes, que só gestor ou admin decidem.
--
-- Decisões do dono em 16/11/2026:
-- 1) OCUPAÇÃO. O custo da conversão por unidade (hora da máquina SEM a energia, mão de obra com encargos e rateio
--    com o aluguel) é dividido pela ocupação alvo, que parte de 50 por cento, porque nem a plotter nem o impressor nem
--    o aluguel trabalham 100 por cento das horas pagas. Energia e perdas NÃO são divididas: só correm quando roda.
-- 2) FÓRMULA. Preço mínimo recomendado = o MAIOR entre (a) multiplicador da regra de três, hoje 3, vezes o material
--    com perda e falha, e (b) o piso do custo de produção = custo de produção dividido por (1 menos a margem mínima
--    do produto menos o imposto sobre a venda menos a metade da taxa do cartão). Margem mínima do produto vazia ou
--    zero vale 30. Custo de produção já com a ocupação.
-- 3) O tempo de recorte do adesivo recortado, 35 minutos, está próximo do real: NÃO muda.
-- 4) Multiplicador e ocupação são parâmetros do cadastro de custos, confirmáveis por gestor e financeiro.
--
-- O que esta migração faz:
-- a) custos_tabela ganha ocupacao_alvo_pct (50) e multiplicador_regra_de_tres (3), os dois confirmados pelo dono.
-- b) custo_cheio_do_produto trocada na definição viva (md5 conferido). Chave nova custo_ocupacao, SOMADA só a
--    custo_producao e NUNCA a custo_total: desconto_avaliar, meta_por_produto e produto_custo_cheio leem custo_total
--    (pela composição gravada) e o piso de desconto dos orçamentos abertos não pode mudar. Ocupação limitada entre
--    5 e 100 por cento. Serviço inteiro e produto sem máquina não levam ocupação.
-- c) View produto_custo_real recriada com as colunas atuais na mesma ordem e sete colunas novas no FIM.
--    custo_real e margem_liquida_pct passam a usar o custo de produção novo, porque leem a mesma chave.
-- d) confirmar_custo_fixo trocada na definição viva com os dois códigos novos, limites de 5 a 100 para a ocupação
--    e de 1 a 10 para o multiplicador, e custo zero recusado.
-- e) Duas propostas de preço pendentes: Adesivo transparente (atualiza a pendente que já existe, sem decidir nada
--    por ninguém) e Adesivo vinil recortado (nova).
-- f) pendencias_de_custo NÃO muda: lê custo_producao da view, então a conta de parceiro já segue o custo novo.
-- g) sincronizar_precificacao_do_produto NÃO muda e não é recomposta: ela grava só custo_material, custo_maquina,
--    custo_mao_obra e custo_indireto, e essas quatro chaves não mudam de valor.
--
-- Corpo das funções: sem linhas de comentário dentro, para o md5 do arquivo ser igual ao md5 do prosrc vivo (o banco
-- guarda o corpo sem os comentários).
-- =====================================================================================================
BEGIN;
SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------------------------------
-- 0. Troca na definição viva: os corpos que vamos trocar são os que o banco tem hoje.
-- ---------------------------------------------------------------------------------------------------
DO $guarda$
DECLARE
  v_h text;
  v_cols text;
BEGIN
  SELECT md5(prosrc) INTO v_h FROM pg_proc
   WHERE pronamespace = 'public'::regnamespace AND proname = 'custo_cheio_do_produto';
  IF v_h IS DISTINCT FROM 'd6bf1523d90f88e619d4ff129f33d40e' THEN
    RAISE EXCEPTION 'custo_cheio_do_produto mudou no banco (md5 %). Releia a definição viva antes de trocar.', v_h;
  END IF;

  SELECT md5(prosrc) INTO v_h FROM pg_proc
   WHERE pronamespace = 'public'::regnamespace AND proname = 'confirmar_custo_fixo';
  IF v_h IS DISTINCT FROM '2647b2cb62c7eb230e486175f6b85926' THEN
    RAISE EXCEPTION 'confirmar_custo_fixo mudou no banco (md5 %). Releia a definição viva antes de trocar.', v_h;
  END IF;

  SELECT md5(prosrc) INTO v_h FROM pg_proc
   WHERE pronamespace = 'public'::regnamespace AND proname = 'sincronizar_precificacao_do_produto';
  IF v_h IS DISTINCT FROM 'c35b8affb3c51c2f40e3ce8a56c89d3a' THEN
    RAISE EXCEPTION 'sincronizar_precificacao_do_produto mudou no banco (md5 %). Releia: esta migração assume que ela lê só quatro chaves.', v_h;
  END IF;

  SELECT string_agg(attname, ',' ORDER BY attnum) INTO v_cols
    FROM pg_attribute WHERE attrelid = 'public.produto_custo_real'::regclass AND attnum > 0 AND NOT attisdropped;
  IF v_cols IS DISTINCT FROM 'produto_id,nome,familia,preco_balcao,custo_producao,custo_real,margem_liquida_pct,vezes_o_custo,preco_regra_de_tres,sem_tinta,material_sem_custo,sem_mao_de_obra,custo_incompleto,velocidade_usada_m2_h,velocidade_nominal_m2_h,tempo_presumido,parceiro_abaixo_do_piso' THEN
    RAISE EXCEPTION 'produto_custo_real mudou de colunas no banco: %. Releia antes de recriar.', v_cols;
  END IF;

  IF EXISTS (SELECT 1 FROM public.custos_tabela WHERE codigo IN ('ocupacao_alvo_pct', 'multiplicador_regra_de_tres')) THEN
    RAISE EXCEPTION 'algum parâmetro novo já existe em custos_tabela. Releia antes de inserir.';
  END IF;

  IF (SELECT count(*) FROM public.precos_propostas
       WHERE status = 'pendente' AND produto_id = '504a9190-317b-4e44-8e7c-e9214ea0d1dd'
         AND origem = 'referencia_m2' AND preco_proposto = 69.9) <> 1 THEN
    RAISE EXCEPTION 'a proposta pendente do Adesivo transparente não é a de 69,90 que esta migração espera atualizar.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.precos_propostas
              WHERE status = 'pendente' AND produto_id = '622d3846-6b63-432f-8ee2-c073e7373c16') THEN
    RAISE EXCEPTION 'o Adesivo vinil recortado já tem proposta pendente. Releia antes de inserir.';
  END IF;
END $guarda$;

-- ---------------------------------------------------------------------------------------------------
-- a) Parâmetros novos, numa instrução só (a recomposição roda uma vez). Confirmados pelo dono em 16/11/2026.
-- ---------------------------------------------------------------------------------------------------
INSERT INTO public.custos_tabela (categoria, codigo, descricao, unidade, valor, observacao, confirmado_em) VALUES
  ('geral', 'ocupacao_alvo_pct', 'Ocupação alvo das máquinas e da equipe', '%', 50,
   'Decisão do dono em 16/11/2026. Quanto das horas pagas a máquina, o impressor e o aluguel realmente trabalham. O custo de conversão por metro quadrado é dividido por este percentual. Energia e perdas não entram nessa divisão. Vale de 5 a 100.',
   now()),
  ('geral', 'multiplicador_regra_de_tres', 'Multiplicador da regra de três sobre o material', 'x', 3,
   'Decisão do dono em 16/11/2026. O preço mínimo recomendado nunca fica abaixo deste número vezes o material com perda e falha. Vale de 1 a 10.',
   now());

-- ---------------------------------------------------------------------------------------------------
-- b) custo_cheio_do_produto trocada na definição viva (md5 conferido no começo).
--    Muda: chave custo_ocupacao, chave ocupacao_alvo_pct, custo_producao ganha a ocupação.
--    Não muda: custo_material, custo_maquina, custo_mao_obra, custo_indireto, custo_total, custo_perdas, custo_extra.
-- ---------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.custo_cheio_do_produto(p_produto_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  p RECORD;
  v_maquina_nome text; v_maquina_custo numeric; v_setor text;
  v_velocidade numeric; v_vel_nominal numeric; v_vel_calculo numeric; v_horas_mq numeric;
  v_base text; v_kw numeric := 0; v_tarifa numeric := 0;
  v_funcao text; v_mo_hora numeric; v_mo_encargos numeric;
  v_material numeric := 0; v_sem_custo int := 0; v_tem_ficha boolean;
  v_horas numeric := 0; v_h_maq numeric := 0; v_h_mo numeric := 0;
  v_maquina numeric := 0; v_mao numeric := 0; v_indireto numeric := 0;
  v_admin_hora numeric := 0; v_fator numeric := 1.5;
  v_criterio text := 'tempo cadastrado';
  v_origem_material text := 'ficha de material';
  v_servico_inteiro boolean := false;
  v_faltas text[] := ARRAY[]::text[];
  v_tempo_presumido boolean := true;
  v_pct_perda numeric := 0; v_pct_falha numeric := 0; v_div numeric := 1; v_perdas numeric := 0;
  v_extra numeric := 0; v_horas_mes numeric;
  v_usa_plotter boolean := false; v_tem_tinta boolean := false; v_tinta_somada boolean := false;
  v_manut numeric; v_limpeza numeric; v_cab_custo numeric; v_cab_vida numeric;
  v_consumo numeric; v_horas_reais numeric; v_custo_ml numeric := 0;
  v_extras_pendentes boolean := false; v_sem_tinta boolean := false;
  v_material_sem_custo boolean := false; v_sem_mao boolean := false; v_incompleto boolean := false;
  v_maq_base numeric := 0; v_ocup_pct numeric; v_custo_ocupacao numeric := 0;
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

  v_tem_ficha := EXISTS (SELECT 1 FROM public.produto_materiais WHERE produto_id = p_produto_id);

  IF NOT v_tem_ficha THEN
    v_faltas := array_append(v_faltas, 'sem ficha de material');
    IF COALESCE(p.custo_medio, 0) > 0 THEN
      v_material := p.custo_medio;
      v_origem_material := 'custo digitado no cadastro (sem ficha)';
      v_servico_inteiro := p.tipo = 'servico';
    ELSE
      v_origem_material := 'nenhum';
    END IF;
  ELSIF v_sem_custo > 0 THEN
    v_faltas := array_append(v_faltas, v_sem_custo || ' material(is) sem custo de compra');
  END IF;
  v_material_sem_custo := (v_sem_custo > 0) OR v_origem_material = 'nenhum';

  IF v_tem_ficha AND v_material > 0 THEN
    SELECT COALESCE(max(valor) FILTER (WHERE codigo = 'pct_perda_material'), 0),
           COALESCE(max(valor) FILTER (WHERE codigo = 'pct_falha_producao'), 0)
      INTO v_pct_perda, v_pct_falha
      FROM public.custos_tabela WHERE ativo;
    v_div := 1 - LEAST(GREATEST((v_pct_perda + v_pct_falha) / 100.0, 0), 0.9);
    v_perdas := v_material / v_div - v_material;
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.produto_materiais pm JOIN public.materiais mt ON mt.id = pm.material_id
                  WHERE pm.produto_id = p_produto_id AND (mt.nome ILIKE '%tinta%' OR mt.unidade = 'ml'))
    INTO v_tem_tinta;

  v_horas := COALESCE(p.tempo_producao_min, 0) / 60.0;
  v_h_maq := v_horas; v_h_mo := v_horas;

  IF p.maquina_padrao_id IS NULL THEN
    v_faltas := array_append(v_faltas, 'sem máquina padrão');
  ELSE
    SELECT mq.nome, mq.custo_hora, mq.setor, mq.velocidade_m2_h, mq.velocidade_calculo_m2_h, mq.base_cobranca,
           COALESCE(mq.potencia_kw, 0), mq.horas_produtivas_mensais
      INTO v_maquina_nome, v_maquina_custo, v_setor, v_vel_nominal, v_vel_calculo, v_base, v_kw, v_horas_mq
    FROM public.maquinas mq WHERE mq.id = p.maquina_padrao_id;

    v_velocidade := COALESCE(NULLIF(v_vel_calculo, 0), v_vel_nominal);
    v_usa_plotter := COALESCE(v_maquina_nome, '') ILIKE '%i1600%';

    IF v_usa_plotter THEN
      SELECT max(valor) FILTER (WHERE codigo = 'plotter_manutencao_mensal'),
             max(valor) FILTER (WHERE codigo = 'plotter_limpeza_mensal'),
             max(valor) FILTER (WHERE codigo = 'plotter_cabecote_custo'),
             max(valor) FILTER (WHERE codigo = 'plotter_cabecote_vida_m2'),
             max(valor) FILTER (WHERE codigo = 'tinta_consumo_ml_m2'),
             max(valor) FILTER (WHERE codigo = 'plotter_horas_mes_reais')
        INTO v_manut, v_limpeza, v_cab_custo, v_cab_vida, v_consumo, v_horas_reais
        FROM public.custos_tabela WHERE ativo;
      SELECT COALESCE(max(COALESCE(mt.custo_medio, mt.custo_unitario)), 0) INTO v_custo_ml
        FROM public.materiais mt WHERE mt.nome ILIKE 'tinta%' AND mt.unidade = 'ml';
    END IF;

    IF v_base = 'area' AND COALESCE(v_velocidade, 0) > 0
       AND lower(replace(COALESCE(p.unidade, ''), '²', '2')) = 'm2' THEN
      SELECT COALESCE(max(valor), 1.5) INTO v_fator
        FROM public.custos_tabela WHERE ativo AND codigo = 'mo_fator_sobre_maquina';
      v_h_maq := 1.0 / v_velocidade;
      v_h_mo := v_h_maq * v_fator;
      v_tempo_presumido := false;
      IF COALESCE(v_vel_calculo, 0) > 0 AND v_vel_calculo IS DISTINCT FROM v_vel_nominal THEN
        v_criterio := 'velocidade de cálculo de ' || v_velocidade || ' m²/h. A máquina faz ' || v_vel_nominal
                      || ' m²/h e o sistema usa menos por margem de segurança. Mão de obra com fator ' || v_fator;
      ELSE
        v_criterio := 'velocidade da máquina de ' || v_velocidade || ' m²/h, com fator ' || v_fator || ' para a mão de obra';
      END IF;

      IF v_usa_plotter THEN
        v_horas_mes := COALESCE(NULLIF(v_horas_reais, 0), NULLIF(v_horas_mq, 0), 160);
        v_extra := (COALESCE(v_manut, 0) + COALESCE(v_limpeza, 0)) / v_horas_mes * v_h_maq;
        IF COALESCE(v_cab_custo, 0) > 0 AND COALESCE(v_cab_vida, 0) > 0 THEN
          v_extra := v_extra + v_cab_custo / v_cab_vida;
        END IF;
        IF NOT v_tem_tinta AND COALESCE(v_consumo, 0) > 0 AND v_custo_ml > 0 THEN
          v_extra := v_extra + v_consumo * v_custo_ml;
          v_tinta_somada := true;
        END IF;
      END IF;
    END IF;

    IF v_usa_plotter THEN
      v_sem_tinta := NOT v_tem_tinta AND NOT v_tinta_somada;
      v_extras_pendentes := v_manut IS NULL OR v_limpeza IS NULL OR v_cab_custo IS NULL OR v_cab_vida IS NULL;
      IF v_sem_tinta THEN v_faltas := array_append(v_faltas, 'sem tinta na ficha e sem consumo médio informado'); END IF;
      IF v_extras_pendentes THEN
        v_faltas := array_append(v_faltas, 'manutenção, limpeza ou cabeçote da plotter ainda não informados');
      END IF;
    END IF;

    IF COALESCE(v_maquina_custo, 0) <= 0 THEN
      v_faltas := array_append(v_faltas, 'máquina ' || COALESCE(v_maquina_nome, '?') || ' sem custo por hora');
    ELSE
      v_maquina := v_h_maq * v_maquina_custo;
      v_maq_base := v_maquina;
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
    v_maquina := 0; v_mao := 0; v_indireto := 0; v_perdas := 0; v_extra := 0; v_maq_base := 0;
    v_sem_tinta := false; v_extras_pendentes := false; v_material_sem_custo := false;
    v_origem_material := 'custo digitado no cadastro (serviço: já inclui tempo e rateio)';
    v_faltas := ARRAY[]::text[];
  END IF;

  IF NOT v_servico_inteiro AND p.maquina_padrao_id IS NOT NULL THEN
    SELECT max(valor) FILTER (WHERE codigo = 'ocupacao_alvo_pct') INTO v_ocup_pct
      FROM public.custos_tabela WHERE ativo;
    v_ocup_pct := LEAST(GREATEST(COALESCE(v_ocup_pct, 100), 5), 100);
    v_custo_ocupacao := (v_maq_base + v_mao + v_indireto) * (100.0 / v_ocup_pct - 1);
  END IF;

  v_sem_mao := v_mao <= 0 AND NOT v_servico_inteiro;
  v_incompleto := v_sem_tinta OR v_material_sem_custo OR v_sem_mao OR v_extras_pendentes;

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
    'custo_perdas', round(v_perdas, 4),
    'custo_extra', round(v_extra, 4),
    'custo_ocupacao', round(v_custo_ocupacao, 4),
    'ocupacao_alvo_pct', v_ocup_pct,
    'custo_producao', round(v_material + v_maquina + v_mao + v_indireto + v_perdas + v_extra + v_custo_ocupacao, 4),
    'velocidade_usada_m2_h', v_velocidade,
    'velocidade_nominal_m2_h', v_vel_nominal,
    'tempo_presumido', v_tempo_presumido,
    'usa_plotter', v_usa_plotter,
    'sem_tinta', v_sem_tinta,
    'material_sem_custo', v_material_sem_custo,
    'sem_mao_de_obra', v_sem_mao,
    'custo_incompleto', v_incompleto,
    'maquina', v_maquina_nome, 'funcao', v_funcao,
    'completo', (array_length(v_faltas, 1) IS NULL),
    'faltas', to_jsonb(v_faltas)
  );
END $function$;

REVOKE ALL ON FUNCTION public.custo_cheio_do_produto(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.custo_cheio_do_produto(uuid) TO service_role;

-- ---------------------------------------------------------------------------------------------------
-- c) View produto_custo_real. As 17 colunas atuais na mesma ordem e as sete novas no FIM.
--    CREATE OR REPLACE VIEW descarta opções: security_invoker e GRANTs são reaplicados aqui.
--    Os valores de preço são arredondados PARA CIMA no centavo, para a margem mínima nunca cair por arredondamento.
-- ---------------------------------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.produto_custo_real WITH (security_invoker = true) AS
WITH taxa AS (
  SELECT LEAST(GREATEST((COALESCE(max(ct.valor) FILTER (WHERE ct.codigo = 'impostos_venda'), 0)
                       + COALESCE(max(ct.valor) FILTER (WHERE ct.codigo = 'taxa_cartao'), 0) / 2) / 100, 0), 0.99) AS t,
         LEAST(GREATEST(COALESCE(max(ct.valor) FILTER (WHERE ct.codigo = 'multiplicador_regra_de_tres'), 3), 1), 10) AS mult
    FROM public.custos_tabela ct WHERE ct.ativo
), base AS (
  SELECT p.id AS produto_id, p.nome, COALESCE(p.familia, p.categoria::text) AS familia,
         pr.preco_base AS preco_balcao, pr.preco_parceiro,
         COALESCE(NULLIF(p.margem_minima, 0), 30) AS margem_minima,
         f.c, taxa.t, taxa.mult
    FROM public.produtos p
    JOIN public.produto_precos pr ON pr.produto_id = p.id
    CROSS JOIN taxa
    CROSS JOIN LATERAL (SELECT public.custo_cheio_do_produto(p.id) AS c) f
   WHERE p.ativo AND COALESCE(pr.preco_base, 0) > 0
), calc AS (
  SELECT b.*, round((b.c ->> 'custo_producao')::numeric, 2) AS custo_producao,
         round((b.c ->> 'custo_producao')::numeric / (1 - b.t), 2) AS custo_real,
         b.mult * ((b.c ->> 'custo_material')::numeric + (b.c ->> 'custo_perdas')::numeric) AS tres_x_cru,
         CASE WHEN 1 - b.margem_minima / 100.0 - b.t > 0
              THEN (b.c ->> 'custo_producao')::numeric / (1 - b.margem_minima / 100.0 - b.t) END AS piso_cru
    FROM base b
), preco AS (
  SELECT c.*,
         ceil(c.tres_x_cru * 100) / 100 AS tres_x_material,
         ceil(c.piso_cru * 100) / 100 AS piso_custo_producao
    FROM calc c
)
SELECT c.produto_id,
       c.nome,
       c.familia,
       c.preco_balcao,
       c.custo_producao,
       c.custo_real,
       CASE WHEN c.custo_real > 0 THEN round((1 - c.custo_real / c.preco_balcao) * 100, 2) END AS margem_liquida_pct,
       CASE WHEN c.custo_real > 0 THEN round(c.preco_balcao / c.custo_real, 2) END AS vezes_o_custo,
       round(c.custo_real * 3, 2) AS preco_regra_de_tres,
       (c.c ->> 'sem_tinta')::boolean AS sem_tinta,
       (c.c ->> 'material_sem_custo')::boolean AS material_sem_custo,
       (c.c ->> 'sem_mao_de_obra')::boolean AS sem_mao_de_obra,
       (c.c ->> 'custo_incompleto')::boolean AS custo_incompleto,
       (c.c ->> 'velocidade_usada_m2_h')::numeric AS velocidade_usada_m2_h,
       (c.c ->> 'velocidade_nominal_m2_h')::numeric AS velocidade_nominal_m2_h,
       (c.c ->> 'tempo_presumido')::boolean AS tempo_presumido,
       (COALESCE(c.preco_parceiro, 0) > 0 AND c.custo_real > 0
         AND (1 - c.custo_real / c.preco_parceiro) < c.margem_minima / 100.0) AS parceiro_abaixo_do_piso,
       round((c.c ->> 'custo_ocupacao')::numeric, 2) AS custo_ocupacao,
       c.tres_x_material,
       c.piso_custo_producao,
       CASE WHEN GREATEST(c.tres_x_material, COALESCE(c.piso_custo_producao, 0)) > 0
            THEN GREATEST(c.tres_x_material, COALESCE(c.piso_custo_producao, 0)) END AS preco_minimo_recomendado,
       CASE WHEN GREATEST(c.tres_x_material, COALESCE(c.piso_custo_producao, 0)) > 0
            THEN CASE WHEN c.tres_x_material >= COALESCE(c.piso_custo_producao, 0) THEN 'regra_de_3' ELSE 'piso_custo' END
       END AS trava_que_manda,
       (c.c ->> 'ocupacao_alvo_pct')::numeric AS ocupacao_alvo_pct,
       c.mult AS multiplicador_regra_de_tres
  FROM preco c;

REVOKE ALL ON public.produto_custo_real FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.produto_custo_real TO service_role;

COMMENT ON VIEW public.produto_custo_real IS
  'Custo real por produto ativo com preço. Privada: só service_role. custo_producao já leva a ocupação alvo. preco_minimo_recomendado é o maior entre o multiplicador da regra de três vezes o material com perda e falha, e o piso do custo de produção com margem mínima, imposto e metade do cartão.';

-- ---------------------------------------------------------------------------------------------------
-- d) confirmar_custo_fixo trocada na definição viva (md5 conferido no começo). Dois códigos novos na lista,
--    ocupação de 5 a 100, multiplicador de 1 a 10, custo zero recusado como antes.
-- ---------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.confirmar_custo_fixo(p_codigo text, p_valor numeric, p_confirmar boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c_permitidos constant text[] := ARRAY[
    'aluguel_espaco_mensal', 'outros_fixos_admin_mes', 'plotter_horas_mes_reais', 'energia_comercial_tarifa_kwh',
    'tinta_consumo_ml_m2', 'plotter_manutencao_mensal', 'plotter_cabecote_custo', 'plotter_cabecote_vida_m2',
    'plotter_limpeza_mensal', 'energia_tarifa_kwh', 'ocupacao_alvo_pct', 'multiplicador_regra_de_tres'];
  v_uid uuid;
  v_quem uuid;
  v_id uuid;
  v_em timestamptz;
  v_por uuid;
BEGIN
  v_uid := public.require_permission('custos.fixos.update');

  IF p_codigo IS NULL OR NOT (p_codigo = ANY (c_permitidos)) THEN
    RAISE EXCEPTION 'Este custo não pode ser alterado por aqui.' USING ERRCODE = '22023';
  END IF;
  IF p_confirmar IS NULL THEN
    RAISE EXCEPTION 'Diga se o custo fica confirmado ou pendente.' USING ERRCODE = '22023';
  END IF;
  IF p_valor IS NULL OR p_valor < 0 OR p_valor > 1000000000 THEN
    RAISE EXCEPTION 'Digite um número válido para o custo.' USING ERRCODE = '22023';
  END IF;
  IF p_valor = 0 AND p_codigo <> 'outros_fixos_admin_mes' THEN
    RAISE EXCEPTION 'Este custo não pode ser zero.' USING ERRCODE = '22023';
  END IF;
  IF p_codigo = 'plotter_horas_mes_reais' AND p_valor > 744 THEN
    RAISE EXCEPTION 'Um mês tem no máximo 744 horas. Confira o número.' USING ERRCODE = '22023';
  END IF;
  IF p_codigo IN ('energia_comercial_tarifa_kwh', 'energia_tarifa_kwh') AND p_valor > 100 THEN
    RAISE EXCEPTION 'A tarifa de energia é em reais por kWh e não passa de 100. Confira o número.' USING ERRCODE = '22023';
  END IF;
  IF p_codigo = 'tinta_consumo_ml_m2' AND p_valor > 1000 THEN
    RAISE EXCEPTION 'O consumo de tinta passa de 1000 mililitros por metro quadrado. Confira o número.' USING ERRCODE = '22023';
  END IF;
  IF p_codigo = 'ocupacao_alvo_pct' AND (p_valor < 5 OR p_valor > 100) THEN
    RAISE EXCEPTION 'A ocupação alvo vai de 5 a 100 por cento. Confira o número.' USING ERRCODE = '22023';
  END IF;
  IF p_codigo = 'multiplicador_regra_de_tres' AND (p_valor < 1 OR p_valor > 10) THEN
    RAISE EXCEPTION 'O multiplicador da regra de três vai de 1 a 10. Confira o número.' USING ERRCODE = '22023';
  END IF;

  SELECT c.id INTO v_id FROM public.custos_tabela c WHERE c.codigo = p_codigo AND c.ativo FOR UPDATE;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Este custo ainda não existe no banco. Avise o suporte.' USING ERRCODE = 'P0002';
  END IF;

  v_quem := (SELECT u.id FROM public.usuarios u WHERE u.id = v_uid);

  PERFORM set_config('bex.custo_sem_confirmar', CASE WHEN p_confirmar THEN '' ELSE v_id::text END, true);

  UPDATE public.custos_tabela
     SET valor = p_valor,
         confirmado_em = CASE WHEN p_confirmar THEN now() ELSE NULL END,
         confirmado_por = CASE WHEN p_confirmar THEN v_quem ELSE NULL END
   WHERE id = v_id;

  PERFORM set_config('bex.custo_sem_confirmar', '', true);

  SELECT c.confirmado_em, c.confirmado_por INTO v_em, v_por FROM public.custos_tabela c WHERE c.id = v_id;

  RETURN jsonb_build_object('codigo', p_codigo, 'valor', p_valor, 'confirmado', v_em IS NOT NULL,
                            'confirmado_em', v_em, 'confirmado_por', v_por);
END;
$function$;

REVOKE ALL ON FUNCTION public.confirmar_custo_fixo(text, numeric, boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.confirmar_custo_fixo(text, numeric, boolean) TO authenticated;

COMMENT ON FUNCTION public.confirmar_custo_fixo(text, numeric, boolean) IS
  'Grava um custo fixo da gráfica. Exige custos.fixos.update. Só aceita os nove códigos do contrato, energia_tarifa_kwh, ocupacao_alvo_pct e multiplicador_regra_de_tres. Confirma só quando p_confirmar.';

-- ---------------------------------------------------------------------------------------------------
-- e) Propostas de preço pendentes. Nada é decidido por ninguém: gestor ou admin aprova ou recusa.
--    Preço proposto = o menor valor terminado em 0,90 ou 0,00 que fica igual ou acima do preço mínimo recomendado.
--    Motivo sem custo em reais e sem parênteses. Margens em por cento líquido, depois de imposto e metade do cartão.
-- ---------------------------------------------------------------------------------------------------
CREATE TEMP TABLE _prop_novas ON COMMIT DROP AS
SELECT r.produto_id, r.nome, r.preco_balcao, r.custo_producao, r.custo_real, r.preco_minimo_recomendado, r.trava_que_manda,
       r.ocupacao_alvo_pct, r.multiplicador_regra_de_tres,
       COALESCE(NULLIF(p.margem_minima, 0), 30) AS margem_minima,
       LEAST(ceil(r.preco_minimo_recomendado),
             CASE WHEN floor(r.preco_minimo_recomendado) + 0.90 >= r.preco_minimo_recomendado
                  THEN floor(r.preco_minimo_recomendado) + 0.90 END) AS novo
  FROM public.produto_custo_real r
  JOIN public.produtos p ON p.id = r.produto_id
 WHERE r.produto_id IN ('504a9190-317b-4e44-8e7c-e9214ea0d1dd', '622d3846-6b63-432f-8ee2-c073e7373c16')
   AND r.preco_minimo_recomendado IS NOT NULL;

DO $prop$
BEGIN
  IF (SELECT count(*) FROM _prop_novas) <> 2 THEN
    RAISE EXCEPTION 'os dois produtos das propostas não aparecem na view com preço mínimo';
  END IF;
END $prop$;

UPDATE public.precos_propostas pp
   SET preco_atual = n.preco_balcao,
       preco_proposto = n.novo,
       custo = n.custo_producao,
       piso = n.preco_minimo_recomendado,
       margem_minima = n.margem_minima,
       margem_atual = round((1 - n.custo_real / n.preco_balcao) * 100, 2),
       margem_proposta = round((1 - n.custo_real / n.novo) * 100, 2),
       origem = 'manual',
       motivo = 'O material do adesivo transparente custa mais que o dobro do vinil branco e a regra de três sobre o material com perda e falha manda neste produto. O preço mínimo recomendado é de '
                || public._integridade_brl(n.preco_minimo_recomendado)
                || ' e a proposta é o menor valor terminado em 0,90 ou 0,00 que fica igual ou acima dele. Sobe de '
                || public._integridade_brl(n.preco_balcao) || ' para ' || public._integridade_brl(n.novo)
                || '. A margem líquida vai de ' || public._integridade_brl(round((1 - n.custo_real / n.preco_balcao) * 100, 2))
                || ' para ' || public._integridade_brl(round((1 - n.custo_real / n.novo) * 100, 2)) || ' por cento.'
  FROM _prop_novas n
 WHERE pp.produto_id = n.produto_id AND pp.status = 'pendente'
   AND n.produto_id = '504a9190-317b-4e44-8e7c-e9214ea0d1dd';

INSERT INTO public.precos_propostas
  (produto_id, preco_atual, preco_proposto, custo, piso, margem_minima, margem_atual, margem_proposta, motivo, origem, status)
SELECT n.produto_id, n.preco_balcao, n.novo, n.custo_producao, n.preco_minimo_recomendado, n.margem_minima,
       round((1 - n.custo_real / n.preco_balcao) * 100, 2), round((1 - n.custo_real / n.novo) * 100, 2),
       'O adesivo vinil recortado leva a mão de obra e o rateio de um recorte de 35 minutos por metro quadrado, e o piso do custo de produção manda neste produto. Com ocupação alvo de '
         || n.ocupacao_alvo_pct::integer || ' por cento e margem mínima de ' || n.margem_minima::integer
         || ' por cento, o preço mínimo recomendado é de ' || public._integridade_brl(n.preco_minimo_recomendado)
         || ' e a proposta é o menor valor terminado em 0,90 ou 0,00 que fica igual ou acima dele. Sobe de '
         || public._integridade_brl(n.preco_balcao) || ' para ' || public._integridade_brl(n.novo)
         || '. A margem líquida vai de ' || public._integridade_brl(round((1 - n.custo_real / n.preco_balcao) * 100, 2))
         || ' para ' || public._integridade_brl(round((1 - n.custo_real / n.novo) * 100, 2)) || ' por cento.',
       'manual', 'pendente'
  FROM _prop_novas n
 WHERE n.produto_id = '622d3846-6b63-432f-8ee2-c073e7373c16';

-- ---------------------------------------------------------------------------------------------------
-- Conferência final: a migração para se algo não ficou como deveria.
-- ---------------------------------------------------------------------------------------------------
DO $confere$
DECLARE
  v_cols text;
  v_opts text[];
BEGIN
  SELECT string_agg(attname, ',' ORDER BY attnum) INTO v_cols
    FROM pg_attribute WHERE attrelid = 'public.produto_custo_real'::regclass AND attnum > 0 AND NOT attisdropped;
  IF v_cols IS DISTINCT FROM 'produto_id,nome,familia,preco_balcao,custo_producao,custo_real,margem_liquida_pct,vezes_o_custo,preco_regra_de_tres,sem_tinta,material_sem_custo,sem_mao_de_obra,custo_incompleto,velocidade_usada_m2_h,velocidade_nominal_m2_h,tempo_presumido,parceiro_abaixo_do_piso,custo_ocupacao,tres_x_material,piso_custo_producao,preco_minimo_recomendado,trava_que_manda,ocupacao_alvo_pct,multiplicador_regra_de_tres' THEN
    RAISE EXCEPTION 'colunas da view fora de ordem: %', v_cols;
  END IF;

  SELECT reloptions INTO v_opts FROM pg_class WHERE oid = 'public.produto_custo_real'::regclass;
  IF v_opts IS NULL OR NOT ('security_invoker=true' = ANY (v_opts)) THEN
    RAISE EXCEPTION 'produto_custo_real perdeu o security_invoker';
  END IF;
  IF has_table_privilege('anon', 'public.produto_custo_real', 'SELECT')
     OR has_table_privilege('authenticated', 'public.produto_custo_real', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.produto_custo_real', 'SELECT') THEN
    RAISE EXCEPTION 'SELECT de produto_custo_real deveria ser só de service_role';
  END IF;

  IF has_function_privilege('anon', 'public.custo_cheio_do_produto(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.custo_cheio_do_produto(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.custo_cheio_do_produto(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'EXECUTE de custo_cheio_do_produto deveria ser só de service_role';
  END IF;
  IF has_function_privilege('anon', 'public.confirmar_custo_fixo(text, numeric, boolean)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.confirmar_custo_fixo(text, numeric, boolean)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.confirmar_custo_fixo(text, numeric, boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'EXECUTE de confirmar_custo_fixo deveria ser só de authenticated';
  END IF;

  IF (SELECT count(*) FROM public.custos_tabela
       WHERE codigo IN ('ocupacao_alvo_pct', 'multiplicador_regra_de_tres') AND ativo AND confirmado_em IS NOT NULL
         AND valor IN (50, 3)) <> 2 THEN
    RAISE EXCEPTION 'os dois parâmetros novos não ficaram com 50 e 3, confirmados';
  END IF;

  IF (SELECT count(*) FROM public.precos_propostas
       WHERE status = 'pendente' AND origem = 'manual'
         AND produto_id IN ('504a9190-317b-4e44-8e7c-e9214ea0d1dd', '622d3846-6b63-432f-8ee2-c073e7373c16')) <> 2 THEN
    RAISE EXCEPTION 'as duas propostas pendentes não ficaram no lugar';
  END IF;
  IF EXISTS (SELECT 1 FROM public.precos_propostas
              WHERE status = 'pendente' AND motivo ~ '[()]|—|–|→'
                AND produto_id IN ('504a9190-317b-4e44-8e7c-e9214ea0d1dd', '622d3846-6b63-432f-8ee2-c073e7373c16')) THEN
    RAISE EXCEPTION 'motivo de proposta com parênteses, travessão ou seta';
  END IF;
  IF EXISTS (SELECT 1 FROM public.produto_custo_real r
              WHERE r.preco_minimo_recomendado < r.tres_x_material
                 OR r.preco_minimo_recomendado < COALESCE(r.piso_custo_producao, 0)) THEN
    RAISE EXCEPTION 'preço mínimo abaixo de uma das duas travas';
  END IF;
END
$confere$;

COMMIT;
