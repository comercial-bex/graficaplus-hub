-- =====================================================================================================
-- CUSTO REAL DO PRODUTO (16/11/2026)
-- Ensaiada com RAISE EXCEPTION final no banco vivo (docs/ensaio-custo-real.md). O preço de NENHUM produto muda
-- aqui: produtos.preco_base, preco_parceiro e os itens de orçamento já gravados ficam como estão.
--
-- 1) custos_tabela ganha confirmado_em e confirmado_por. Pendente = valor nulo OU confirmado_em nulo. O valor deixa
--    de ser obrigatório (um parâmetro novo nasce sem número). As linhas antigas nascem confirmadas na própria
--    migração, para o lembrete não cobrar o que já vale. Mudar o número confirma; apagar o número desconfirma.
--    O gatilho que recompõe o custo de todos os produtos passa a olhar só valor e ativo: confirmar não recompõe.
-- 2) Nove parâmetros novos, numa única instrução. Só o aluguel tem número (R$ 2.000, confirmado pelo dono).
-- 3) O aluguel entra DENTRO do rateio por hora e nunca por cima: custo_admin_hora passa a ser
--    (aluguel + outros fixos) / horas do mês, mantido por gatilho, e continua UMA linha só lida por todos.
-- 4) Salário e encargos: a rescisão provisionada sobe de 3,20 para 3,82 e os encargos de 32,19 para 32,82 por cento.
-- 5) maquinas ganha velocidade_calculo_m2_h e velocidade_calculo_texto. Só a Plotter i1600 recebe valor: calcula
--    com 10 m² por hora, a nominal do catálogo (14) fica intacta e é o que agenda e capacidade seguem.
--    O gatilho de máquina passa a reagir à velocidade.
-- 6) custo_cheio_do_produto trocada na definição viva: velocidade usada, perda e falha como divisor só sobre
--    material de ficha, custos extras da plotter (manutenção, cabeçote, limpeza, tinta) que valem zero enquanto
--    o parâmetro está vazio. custo_total continua sendo material + máquina + mão de obra + rateio: a perda e o
--    extra saem em chaves à parte (custo_perdas, custo_extra, custo_producao) e NÃO entram em
--    produto_custo_cheio, que desconto_avaliar e meta_por_produto leem. Trocar o consumidor para o custo real
--    é decisão do dono, em migração própria.
-- 7) View produto_custo_real (security_invoker, SELECT só service_role) e função pendencias_de_custo()
--    (EXECUTE só service_role).
-- =====================================================================================================
BEGIN;
SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------------------------------
-- 0. Troca na definição viva: o corpo que vamos trocar é o que o banco tem hoje.
-- ---------------------------------------------------------------------------------------------------
DO $guarda$
DECLARE
  v_h text;
  v_cols text;
BEGIN
  SELECT md5(prosrc) INTO v_h FROM pg_proc
   WHERE pronamespace = 'public'::regnamespace AND proname = 'custo_cheio_do_produto';
  IF v_h IS DISTINCT FROM '849742afd482caf421f1b72200381f23' THEN
    RAISE EXCEPTION 'custo_cheio_do_produto mudou no banco (md5 %). Releia a definição viva antes de trocar.', v_h;
  END IF;

  SELECT md5(prosrc) INTO v_h FROM pg_proc
   WHERE pronamespace = 'public'::regnamespace AND proname = 'custos_tabela_log';
  IF v_h IS DISTINCT FROM '2c6b8d76e3035e7f3d0522fdbc0eafd2' THEN
    RAISE EXCEPTION 'custos_tabela_log mudou no banco (md5 %). Releia a definição viva antes de trocar.', v_h;
  END IF;

  SELECT string_agg(attname, ',' ORDER BY attnum) INTO v_cols
    FROM pg_attribute WHERE attrelid = 'public.custos_tabela'::regclass AND attnum > 0 AND NOT attisdropped;
  IF v_cols IS DISTINCT FROM 'id,categoria,codigo,descricao,unidade,valor,observacao,ativo,atualizado_por,created_at,updated_at' THEN
    RAISE EXCEPTION 'custos_tabela mudou de colunas no banco: %. Releia antes de trocar.', v_cols;
  END IF;

  IF EXISTS (SELECT 1 FROM public.custos_tabela WHERE codigo IN (
        'aluguel_espaco_mensal', 'outros_fixos_admin_mes', 'plotter_horas_mes_reais', 'energia_comercial_tarifa_kwh',
        'tinta_consumo_ml_m2', 'plotter_manutencao_mensal', 'plotter_cabecote_custo', 'plotter_cabecote_vida_m2',
        'plotter_limpeza_mensal')) THEN
    RAISE EXCEPTION 'algum parâmetro novo já existe em custos_tabela. Releia antes de inserir.';
  END IF;
END $guarda$;

-- ---------------------------------------------------------------------------------------------------
-- 1. custos_tabela: confirmação. Tabela sem GRANT por coluna: a coluna nova não derruba nenhuma consulta.
-- ---------------------------------------------------------------------------------------------------
ALTER TABLE public.custos_tabela
  ALTER COLUMN valor DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS confirmado_por uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS confirmado_em timestamptz;

COMMENT ON COLUMN public.custos_tabela.confirmado_em IS
  'Quando um responsável confirmou o valor. Pendente = valor nulo OU confirmado_em nulo.';
COMMENT ON COLUMN public.custos_tabela.confirmado_por IS
  'Quem confirmou (usuarios.id, o mesmo id do login). Nulo quando a confirmação veio de migração.';

-- O gatilho de recomposição olhava todo INSERT, UPDATE e DELETE: confirmar uma linha sem mudar o número
-- recompunha o custo de todos os produtos. Agora só reage a valor e ativo.
DROP TRIGGER IF EXISTS tg_custos_tabela_recompoe_custos ON public.custos_tabela;
CREATE TRIGGER tg_custos_tabela_recompoe_custos
  AFTER INSERT OR DELETE OR UPDATE OF valor, ativo ON public.custos_tabela
  FOR EACH STATEMENT EXECUTE FUNCTION public.tg_parametro_recompoe_custos();

-- Troca na definição viva de custos_tabela_log: o que já fazia (updated_at e histórico do valor) segue igual.
-- Novo: mudar o número confirma (quem e quando); apagar o número tira a confirmação; carimbar confirmado_em
-- sem mexer no número grava quem carimbou.
CREATE OR REPLACE FUNCTION public.custos_tabela_log()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_quem uuid := (SELECT u.id FROM public.usuarios u WHERE u.id = auth.uid());
BEGIN
  NEW.updated_at = now();
  IF TG_OP = 'UPDATE' AND NEW.valor IS DISTINCT FROM OLD.valor THEN
    INSERT INTO public.custos_tabela_historico (custo_id, codigo, valor_anterior, valor_novo, alterado_por)
    VALUES (NEW.id, NEW.codigo, OLD.valor, NEW.valor, auth.uid());
    IF NEW.confirmado_em IS NOT DISTINCT FROM OLD.confirmado_em THEN
      IF NEW.valor IS NULL THEN
        NEW.confirmado_em := NULL;
        NEW.confirmado_por := NULL;
      ELSE
        NEW.confirmado_em := now();
        NEW.confirmado_por := COALESCE(v_quem, NEW.confirmado_por);
      END IF;
    END IF;
  ELSIF TG_OP = 'UPDATE' AND NEW.confirmado_em IS DISTINCT FROM OLD.confirmado_em
        AND NEW.confirmado_em IS NOT NULL AND v_quem IS NOT NULL THEN
    NEW.confirmado_por := v_quem;
  END IF;
  RETURN NEW;
END;
$function$;

-- As linhas que já existem valem hoje: nascem confirmadas (por migração, sem pessoa).
UPDATE public.custos_tabela SET confirmado_em = now() WHERE confirmado_em IS NULL;

-- ---------------------------------------------------------------------------------------------------
-- 2. Rateio: o aluguel entra DENTRO de custo_admin_hora. Uma linha só, lida por custo_cheio_do_produto,
--    custo_do_acabamento_interno e pelas telas. Enquanto o aluguel não estiver confirmado, a linha fica como está.
-- ---------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_custos_rateio_admin_hora()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_aluguel numeric; v_outros numeric; v_horas numeric; v_rateio numeric;
BEGIN
  SELECT max(valor) FILTER (WHERE codigo = 'aluguel_espaco_mensal' AND confirmado_em IS NOT NULL),
         max(valor) FILTER (WHERE codigo = 'outros_fixos_admin_mes'),
         max(valor) FILTER (WHERE codigo = 'plotter_horas_mes_reais')
    INTO v_aluguel, v_outros, v_horas
    FROM public.custos_tabela WHERE ativo;

  IF COALESCE(v_aluguel, 0) <= 0 THEN RETURN NULL; END IF;

  v_horas := COALESCE(NULLIF(v_horas, 0),
                      (SELECT NULLIF(mq.horas_produtivas_mensais, 0) FROM public.maquinas mq
                        WHERE mq.nome ILIKE '%i1600%' ORDER BY mq.created_at LIMIT 1),
                      160);
  v_rateio := round((v_aluguel + COALESCE(v_outros, 0)) / v_horas, 4);

  UPDATE public.custos_tabela
     SET valor = v_rateio,
         observacao = 'Calculado: aluguel mais outros fixos do espaço, divididos pelas horas produtivas do mês. Não some o aluguel por cima.'
   WHERE codigo = 'custo_admin_hora' AND valor IS DISTINCT FROM v_rateio;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.tg_custos_rateio_admin_hora() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER tg_custos_rateio_admin_hora
  AFTER INSERT OR UPDATE OF valor, confirmado_em, ativo ON public.custos_tabela
  FOR EACH ROW
  WHEN (NEW.codigo IN ('aluguel_espaco_mensal', 'outros_fixos_admin_mes', 'plotter_horas_mes_reais'))
  EXECUTE FUNCTION public.tg_custos_rateio_admin_hora();

-- ---------------------------------------------------------------------------------------------------
-- 3. Parâmetros novos, numa instrução só (a recomposição roda uma vez). Valor nulo = ainda não informado.
--    O gatilho de rateio acima já existe: o INSERT do aluguel leva custo_admin_hora de 12,00 para 12,50.
-- ---------------------------------------------------------------------------------------------------
INSERT INTO public.custos_tabela (categoria, codigo, descricao, unidade, valor, observacao, confirmado_em) VALUES
  ('fixos', 'aluguel_espaco_mensal', 'Aluguel do espaço', 'R$/mês', 2000,
   'Valor do dono em 15/11/2026. Entra dentro do rateio por hora e nunca por cima do custo administrativo por hora.',
   now()),
  ('fixos', 'outros_fixos_admin_mes', 'Outros custos fixos do espaço, como internet e software', 'R$/mês', NULL,
   'Pendente. Somado ao aluguel dentro do rateio por hora. Vazio conta como zero.', NULL),
  ('plotter', 'plotter_horas_mes_reais', 'Horas reais de produção da plotter por mês', 'h/mês', NULL,
   'Pendente. Enquanto vazio, o rateio usa as horas produtivas cadastradas na máquina, 160.', NULL),
  ('energia', 'energia_comercial_tarifa_kwh', 'Tarifa de energia comercial', 'R$/kWh', NULL,
   'Pendente. O cálculo segue com a tarifa da fatura atual até o gestor informar a comercial.', NULL),
  ('plotter', 'tinta_consumo_ml_m2', 'Consumo médio de tinta da plotter', 'ml/m²', NULL,
   'Pendente. Só entra no custo do produto impresso que não tem tinta na ficha de material.', NULL),
  ('plotter', 'plotter_manutencao_mensal', 'Manutenção mensal da plotter', 'R$/mês', NULL,
   'Pendente. Vazio conta como zero e o custo do produto impresso fica marcado como incompleto.', NULL),
  ('plotter', 'plotter_cabecote_custo', 'Custo do cabeçote da plotter', 'R$', NULL,
   'Pendente. Dividido pela vida em m² do cabeçote.', NULL),
  ('plotter', 'plotter_cabecote_vida_m2', 'Vida útil do cabeçote da plotter', 'm²', NULL,
   'Pendente. Quantos m² o cabeçote imprime até a troca.', NULL),
  ('plotter', 'plotter_limpeza_mensal', 'Limpeza mensal da plotter', 'R$/mês', NULL,
   'Pendente. Vazio conta como zero e o custo do produto impresso fica marcado como incompleto.', NULL);

-- ---------------------------------------------------------------------------------------------------
-- 4. Salário e encargos: rescisão provisionada 3,82 (era 3,20). FGTS 8,00 + 13º 8,33 + férias com um terço 11,11
--    + FGTS sobre 13º e férias 1,56 + rescisão 3,82 = 32,82. Premissa: Simples Nacional. Estimativa.
-- ---------------------------------------------------------------------------------------------------
UPDATE public.custos_tabela
   SET valor = 32.82,
       observacao = 'Estimativa de 15/11/2026, regime Simples Nacional: FGTS 8,00, 13º 8,33, férias com um terço 11,11, FGTS sobre 13º e férias 1,56, rescisão provisionada 3,82. Confirmar com o contador.'
 WHERE codigo = 'mo_encargos_pct' AND valor = 32.19;

UPDATE public.custos_mao_de_obra
   SET encargos_pct = 0.3282,
       observacoes = 'Decisão do dono: salário mínimo de 2026, R$ 1.621,00, dividido por 176 h. Encargos corrigidos em 15/11/2026 para 32,82 por cento, com a rescisão provisionada em 3,82, o que dá R$ 12,23 por hora. Estimativa no regime Simples Nacional. Para pagar um salário diferente, edite salário e horas aqui: o custo de todos os produtos é recalculado sozinho.'
 WHERE ativo AND encargos_pct = 0.3219;

-- ---------------------------------------------------------------------------------------------------
-- 5. Máquinas: velocidade usada no cálculo separada da nominal.
--    Coluna nova de tabela com GRANT por coluna nasce sem GRANT: dá SELECT só nestas duas, que não são custo.
-- ---------------------------------------------------------------------------------------------------
ALTER TABLE public.maquinas
  ADD COLUMN IF NOT EXISTS velocidade_calculo_m2_h numeric,
  ADD COLUMN IF NOT EXISTS velocidade_calculo_texto text;

GRANT SELECT (velocidade_calculo_m2_h, velocidade_calculo_texto) ON public.maquinas TO authenticated;

-- maquinas_financeiro lista as colunas uma a uma (nao e SELECT *): sem isto, quem ve custo (lerMaquinas(true) faz
-- select("*") na visao) receberia MENOS colunas que quem nao ve, e a velocidade de calculo chegaria vazia so a ele.
-- As duas colunas entram no FIM (CREATE OR REPLACE VIEW so aceita coluna nova no fim). A visao nasceu com
-- security_barrier=true e security_invoker=false (definer): reafirmados, porque CREATE OR REPLACE descarta as opcoes.
-- Os GRANTs da visao (authenticated SELECT) ficam como estao.
CREATE OR REPLACE VIEW public.maquinas_financeiro WITH (security_barrier = true, security_invoker = false) AS
 SELECT id, nome, tipo, ativa, created_at, custo_hora, potencia_kw, setup_min, velocidade_m2_h, disponibilidade_pct,
        setor, updated_at, largura_util_m, margem_lateral_m, fabricante, modelo, numero_serie, imagem_url,
        especificacoes, horas_produtivas_mensais, vida_util_horas, valor_residual, base_cobranca, tempo_minimo_min,
        velocidade_mm_s, avanco_m, forma_aquisicao, valor_aquisicao, data_aquisicao, especificacoes_comerciais,
        alimentacao, comprimento_util_m, velocidade_calculo_m2_h, velocidade_calculo_texto
   FROM public.maquinas m
  WHERE (public.is_staff((SELECT auth.uid() AS uid)) AND public.pode_ver_custo_de_maquina((SELECT auth.uid() AS uid)));

COMMENT ON COLUMN public.maquinas.velocidade_calculo_m2_h IS
  'Velocidade que o CUSTO usa. Nulo = usa velocidade_m2_h. A nominal fica em velocidade_m2_h e é o que agenda e capacidade seguem.';
COMMENT ON COLUMN public.maquinas.velocidade_calculo_texto IS
  'Texto que a tela mostra para explicar por que o cálculo usa uma velocidade menor que a do catálogo.';

UPDATE public.maquinas
   SET velocidade_calculo_m2_h = 10,
       velocidade_calculo_texto = 'A máquina faz 14 m² por hora no catálogo. O sistema calcula o custo com 10 m² por hora, como margem de segurança.'
 WHERE id = 'b77ec8f1-f336-4433-9b49-03c34db4183e' AND nome ILIKE '%i1600%';

DROP TRIGGER IF EXISTS tg_maquina_recompoe_custos ON public.maquinas;
CREATE TRIGGER tg_maquina_recompoe_custos
  AFTER INSERT OR DELETE OR UPDATE OF custo_hora, velocidade_m2_h, velocidade_calculo_m2_h ON public.maquinas
  FOR EACH STATEMENT EXECUTE FUNCTION public.tg_parametro_recompoe_custos();

-- ---------------------------------------------------------------------------------------------------
-- 6. custo_cheio_do_produto trocada na definição viva (md5 conferido no começo).
--    Muda: velocidade usada (COALESCE da de cálculo com a nominal), texto do critério, perda e falha como
--    divisor só sobre material de ficha, extras da plotter, sinalizadores novos.
--    Não muda: custo_material, custo_maquina, custo_mao_obra, custo_indireto e custo_total continuam com o
--    mesmo significado, para sincronizar_precificacao_do_produto e produto_custo_cheio seguirem iguais.
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
  v_material_sem_custo := (v_sem_custo > 0) OR v_origem_material = 'nenhum';

  -- Perda de material e falha de produção: divisor sobre o material de FICHA. Custo digitado sem ficha não leva perda.
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

    -- O custo usa a velocidade de cálculo quando a máquina tem uma; senão, a nominal.
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
    v_maquina := 0; v_mao := 0; v_indireto := 0; v_perdas := 0; v_extra := 0;
    v_sem_tinta := false; v_extras_pendentes := false; v_material_sem_custo := false;
    v_origem_material := 'custo digitado no cadastro (serviço: já inclui tempo e rateio)';
    v_faltas := ARRAY[]::text[];
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
    'custo_producao', round(v_material + v_maquina + v_mao + v_indireto + v_perdas + v_extra, 4),
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
-- 7. View produto_custo_real. Uma linha por produto ativo com preço.
--    custo_real = custo_producao / (1 - taxas), as mesmas taxas de desconto_avaliar: imposto sobre a venda mais
--    metade da taxa do cartão, lidos de custos_tabela. margem_liquida_pct = (1 - custo_real / preço) * 100.
--    A regra de três é referência (custo real vezes 3), não meta automática.
--    CREATE OR REPLACE VIEW descarta opções: security_invoker e GRANTs são aplicados aqui, na criação.
-- ---------------------------------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.produto_custo_real WITH (security_invoker = true) AS
WITH taxa AS (
  SELECT LEAST(GREATEST((COALESCE(max(ct.valor) FILTER (WHERE ct.codigo = 'impostos_venda'), 0)
                       + COALESCE(max(ct.valor) FILTER (WHERE ct.codigo = 'taxa_cartao'), 0) / 2) / 100, 0), 0.99) AS t
    FROM public.custos_tabela ct WHERE ct.ativo
), base AS (
  SELECT p.id AS produto_id, p.nome, COALESCE(p.familia, p.categoria::text) AS familia,
         pr.preco_base AS preco_balcao, pr.preco_parceiro,
         COALESCE(NULLIF(p.margem_minima, 0), 30) AS margem_minima,
         f.c, taxa.t
    FROM public.produtos p
    JOIN public.produto_precos pr ON pr.produto_id = p.id
    CROSS JOIN taxa
    CROSS JOIN LATERAL (SELECT public.custo_cheio_do_produto(p.id) AS c) f
   WHERE p.ativo AND COALESCE(pr.preco_base, 0) > 0
), calc AS (
  SELECT b.*, round((b.c ->> 'custo_producao')::numeric, 2) AS custo_producao,
         round((b.c ->> 'custo_producao')::numeric / (1 - b.t), 2) AS custo_real
    FROM base b
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
       -- O parceiro paga menos que o preço que entrega a margem mínima do produto depois das taxas.
       (COALESCE(c.preco_parceiro, 0) > 0 AND c.custo_real > 0
         AND (1 - c.custo_real / c.preco_parceiro) < c.margem_minima / 100.0) AS parceiro_abaixo_do_piso
  FROM calc c;

REVOKE ALL ON public.produto_custo_real FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.produto_custo_real TO service_role;

COMMENT ON VIEW public.produto_custo_real IS
  'Custo real por produto ativo com preço. Privada: só service_role. custo_real = custo_producao / (1 - imposto - metade do cartão).';

-- ---------------------------------------------------------------------------------------------------
-- 7b. pendencias_de_custo(): o que falta confirmar, preencher ou corrigir. Sem valor em reais, só rótulo.
-- ---------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pendencias_de_custo()
 RETURNS TABLE(codigo text, rotulo text, tipo text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT ct.codigo, ct.descricao, 'parametro'::text
    FROM public.custos_tabela ct
   WHERE ct.ativo AND ct.categoria <> 'chave' AND (ct.valor IS NULL OR ct.confirmado_em IS NULL)
  UNION ALL
  SELECT 'material_sem_custo:' || mt.id::text, mt.nome, 'material_sem_custo'::text
    FROM public.materiais mt
   WHERE COALESCE(mt.custo_medio, mt.custo_unitario, 0) <= 0
     AND EXISTS (SELECT 1 FROM public.produto_materiais pm JOIN public.produtos pr ON pr.id = pm.produto_id
                  WHERE pm.material_id = mt.id AND pr.ativo)
  UNION ALL
  SELECT 'parceiro_abaixo_do_piso:' || r.produto_id::text, r.nome, 'parceiro_abaixo_do_piso'::text
    FROM public.produto_custo_real r
   WHERE r.parceiro_abaixo_do_piso
  ORDER BY 3, 2;
$function$;

REVOKE ALL ON FUNCTION public.pendencias_de_custo() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pendencias_de_custo() TO service_role;

-- ---------------------------------------------------------------------------------------------------
-- 8. Recompõe a composição gravada de todos os produtos com a função nova. Só produto_precificacao muda
--    (custo_material, custo_maquina, custo_mao_obra e custo_indireto); nenhum preço.
-- ---------------------------------------------------------------------------------------------------
DO $recompor$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.produtos LOOP
    PERFORM public.sincronizar_precificacao_do_produto(r.id);
  END LOOP;
END $recompor$;

COMMIT;
