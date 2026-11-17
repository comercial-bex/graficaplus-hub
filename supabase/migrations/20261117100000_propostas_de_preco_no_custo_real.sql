-- =====================================================================================================
-- PROPOSTAS DE PREÇO NO CUSTO REAL (17/11/2026)
--
-- O defeito. O cartão de "Preços pendentes" mostra o custo, o piso e as margens GRAVADOS na proposta. Duas funções
-- gravavam esses números só com o custo do material (produtos.custo_medio), embora a tela "Preços por produto" e as
-- propostas de 16/11 já usassem o custo real (produto_custo_real: custo de produção com a ocupação alvo, imposto e
-- metade da taxa do cartão):
--
-- a) preco_proposta_criar, a do botão "Pedir este preço" em Preços por produto. No Adesivo vinil recortado a R$ 99,90
--    o cartão mostraria piso de R$ 12,07 e margem de 92,75 por cento, quando o piso de verdade é o preço mínimo
--    recomendado de R$ 72,84 e a margem líquida é de 58,71 por cento. Um número que tranquiliza sem motivo.
-- b) preco_proposta_aprovar, ao aprovar, REGRAVAVA o registro com o custo do material. Foi o que aconteceu em
--    16/11/2026 com as duas propostas manuais aprovadas, Adesivo transparente e Adesivo vinil recortado: o histórico
--    passou a dizer margem de 71 e 92 por cento, e não os 48,25 e 58,71 que o gestor viu na hora de decidir.
--
-- A correção.
-- 1) _preco_proposta_numeros: uma conta só para os números da proposta, a mesma da migração de 16/11 e da tela
--    Preços por produto. Custo = custo de produção; piso = preço mínimo recomendado; margem mínima do produto, ou 30
--    quando vazia ou zero; margem = 1 menos custo real dividido pelo preço. Produto sem custo real na visão (inativo,
--    sem preço de balcão, sem custo) cai na conta de antes, só com o material, como as propostas mais antigas.
-- 2) preco_proposta_criar e preco_proposta_aprovar passam a gravar com ela. O resto das duas fica IGUAL, inclusive a
--    trava do aprovar: o banco continua recusando preço abaixo do piso do MATERIAL. O preço mínimo recomendado é
--    recomendação (decisão do dono, 16/11/2026); abaixo dele o cartão fica vermelho e diz para não aprovar.
-- 3) As duas propostas aprovadas em 16/11 voltam a ter os números com que foram decididas. Só elas, só se ainda
--    estiverem com os números do material, e só se a conta de hoje der exatamente o que o gestor viu (prova de que o
--    custo não mudou desde então). Nenhum preço muda: produtos, produto_precos e orçamentos ficam como estão.
--
-- Ensaio no banco vivo, com RAISE EXCEPTION final: docs/ensaio-propostas-no-custo-real-17-11-2026.md.
-- Corpo das funções sem linha de comentário dentro, para o md5 do prosrc vivo bater com o arquivo.
-- =====================================================================================================
BEGIN;
SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------------------------------
-- 0. Troca na definição viva: os corpos que vamos trocar são os que o banco tem hoje.
-- ---------------------------------------------------------------------------------------------------
DO $guarda$
DECLARE
  v_h text;
BEGIN
  SELECT md5(prosrc) INTO v_h FROM pg_proc
   WHERE pronamespace = 'public'::regnamespace AND proname = 'preco_proposta_criar';
  IF v_h IS DISTINCT FROM '4db878d2fc485462cd65e865dda8973e' THEN
    RAISE EXCEPTION 'preco_proposta_criar mudou no banco (md5 %). Releia a definição viva antes de trocar.', v_h;
  END IF;

  SELECT md5(prosrc) INTO v_h FROM pg_proc
   WHERE pronamespace = 'public'::regnamespace AND proname = 'preco_proposta_aprovar';
  IF v_h IS DISTINCT FROM '462f90afe3237e362b7aee6964445402' THEN
    RAISE EXCEPTION 'preco_proposta_aprovar mudou no banco (md5 %). Releia a definição viva antes de trocar.', v_h;
  END IF;
END
$guarda$;

-- ---------------------------------------------------------------------------------------------------
-- 1. A conta dos números da proposta. SECURITY INVOKER: só roda de dentro das funções que já conferem a pessoa,
--    e ninguém de fora a executa (produto_custo_real só abre para o dono das funções e para o service_role).
-- ---------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._preco_proposta_numeros(p_produto_id uuid, p_preco_atual numeric, p_preco_proposto numeric)
RETURNS TABLE (custo numeric, piso numeric, margem_minima numeric, margem_atual numeric, margem_proposta numeric, base text)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $f$
DECLARE
  v_real record;
  v_prod public.produtos;
BEGIN
  SELECT * INTO v_prod FROM public.produtos WHERE id = p_produto_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT r.custo_producao, r.custo_real, r.preco_minimo_recomendado
    INTO v_real
    FROM public.produto_custo_real r
   WHERE r.produto_id = p_produto_id;

  IF FOUND AND COALESCE(v_real.custo_real, 0) > 0 AND COALESCE(v_real.preco_minimo_recomendado, 0) > 0 THEN
    RETURN QUERY SELECT
      v_real.custo_producao,
      v_real.preco_minimo_recomendado,
      COALESCE(NULLIF(v_prod.margem_minima, 0), 30),
      CASE WHEN COALESCE(p_preco_atual, 0) > 0 THEN round((1 - v_real.custo_real / p_preco_atual) * 100, 2) END,
      CASE WHEN COALESCE(p_preco_proposto, 0) > 0 THEN round((1 - v_real.custo_real / p_preco_proposto) * 100, 2) END,
      'custo_real'::text;
    RETURN;
  END IF;

  RETURN QUERY SELECT
    v_prod.custo_medio,
    public._preco_piso(v_prod.custo_medio, v_prod.margem_minima),
    v_prod.margem_minima,
    public._preco_margem(p_preco_atual, v_prod.custo_medio),
    public._preco_margem(p_preco_proposto, v_prod.custo_medio),
    'material'::text;
END $f$;

REVOKE ALL ON FUNCTION public._preco_proposta_numeros(uuid, numeric, numeric) FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------
-- 2. Pedir preço. Igual à viva, menos os números gravados, que vêm da conta acima.
-- ---------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.preco_proposta_criar(p_produto_id uuid, p_preco numeric, p_motivo text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$
DECLARE
  v_uid uuid := auth.uid();
  v_prod public.produtos;
  v_preco numeric := round(p_preco, 2);
  v_motivo text := btrim(COALESCE(p_motivo, ''));
  v_id uuid;
  v_pend public.precos_propostas;
  v_num record;
BEGIN
  IF v_uid IS NULL OR NOT (public.has_role(v_uid, 'admin'::public.app_role) OR public.has_role(v_uid, 'gestor'::public.app_role))
     OR NOT public.pode_ver_custo(v_uid) THEN
    RAISE EXCEPTION 'Só admin ou gestor que vê custo propõe preço.' USING ERRCODE = '42501';
  END IF;
  IF v_preco IS NULL OR v_preco <= 0 THEN
    RAISE EXCEPTION 'O preço proposto precisa ser maior que zero.' USING ERRCODE = '22023';
  END IF;
  IF length(v_motivo) < 3 THEN
    RAISE EXCEPTION 'Explique em uma frase o motivo da proposta.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_prod FROM public.produtos WHERE id = p_produto_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Produto não encontrado.' USING ERRCODE = 'P0002'; END IF;

  SELECT * INTO v_num FROM public._preco_proposta_numeros(v_prod.id, COALESCE(v_prod.preco_base, 0), v_preco);

  INSERT INTO public.precos_propostas
    (produto_id, preco_atual, preco_proposto, custo, piso, margem_minima, margem_atual, margem_proposta, motivo, origem)
  VALUES
    (v_prod.id, COALESCE(v_prod.preco_base, 0), v_preco, v_num.custo, v_num.piso, v_num.margem_minima,
     v_num.margem_atual, v_num.margem_proposta, left(v_motivo, 500), 'manual')
  ON CONFLICT (produto_id) WHERE status = 'pendente' DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT * INTO v_pend FROM public.precos_propostas WHERE produto_id = v_prod.id AND status = 'pendente';
    IF FOUND AND v_pend.preco_proposto = v_preco THEN
      RETURN v_pend.id;
    END IF;
    RAISE EXCEPTION 'Este produto já tem uma proposta pendente de outro preço. Decida essa antes de propor de novo.'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.logs_auditoria (usuario_id, entidade, entidade_id, acao, detalhes)
  VALUES (v_uid, 'produtos', v_prod.id, 'preco_proposta_criada',
          jsonb_build_object('proposta_id', v_id, 'preco_de', COALESCE(v_prod.preco_base, 0), 'preco_proposto', v_preco,
                             'origem', 'manual', 'base', v_num.base));

  RETURN v_id;
END $f$;

REVOKE ALL ON FUNCTION public.preco_proposta_criar(uuid, numeric, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.preco_proposta_criar(uuid, numeric, text) TO authenticated;

-- ---------------------------------------------------------------------------------------------------
-- 3. Aprovar. Igual à viva, inclusive a trava do piso do material; os números congelados na decisão vêm da conta
--    acima, lidos antes de o preço mudar.
-- ---------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.preco_proposta_aprovar(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$
DECLARE
  v_uid uuid := auth.uid();
  v_prop public.precos_propostas;
  v_prod public.produtos;
  v_piso numeric;
  v_num record;
BEGIN
  IF v_uid IS NULL OR NOT (public.has_role(v_uid, 'admin'::public.app_role) OR public.has_role(v_uid, 'gestor'::public.app_role))
     OR NOT public.pode_ver_custo(v_uid) THEN
    RAISE EXCEPTION 'Só admin ou gestor que vê custo aprova preço.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_prop FROM public.precos_propostas WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Proposta não encontrada.' USING ERRCODE = 'P0002'; END IF;
  IF v_prop.status <> 'pendente' THEN
    RAISE EXCEPTION 'Esta proposta já foi %.', v_prop.status USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_prod FROM public.produtos WHERE id = v_prop.produto_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Produto da proposta não encontrado.' USING ERRCODE = 'P0002'; END IF;

  IF v_prod.preco_base IS DISTINCT FROM v_prop.preco_atual THEN
    RAISE EXCEPTION 'O preço do produto mudou depois da proposta. Recuse esta e gere outra.' USING ERRCODE = '22023';
  END IF;

  v_piso := public._preco_piso(v_prod.custo_medio, v_prod.margem_minima);
  IF v_piso IS NOT NULL AND v_prop.preco_proposto < v_piso THEN
    RAISE EXCEPTION 'O preço proposto fica abaixo do piso de %. Recuse e gere outra proposta.', public._integridade_brl(v_piso)
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_num FROM public._preco_proposta_numeros(v_prod.id, v_prop.preco_atual, v_prop.preco_proposto);

  UPDATE public.produtos SET preco_base = v_prop.preco_proposto WHERE id = v_prod.id;

  UPDATE public.precos_propostas
     SET status = 'aprovada', decidido_por = v_uid, decidido_em = now(),
         custo = v_num.custo, piso = v_num.piso, margem_minima = v_num.margem_minima,
         margem_atual = v_num.margem_atual, margem_proposta = v_num.margem_proposta
   WHERE id = p_id;

  INSERT INTO public.logs_auditoria (usuario_id, entidade, entidade_id, acao, detalhes)
  VALUES (v_uid, 'produtos', v_prod.id, 'preco_proposta_aprovada',
          jsonb_build_object('proposta_id', p_id, 'preco_de', v_prop.preco_atual, 'preco_para', v_prop.preco_proposto));

  RETURN jsonb_build_object('ok', true, 'proposta_id', p_id, 'produto_id', v_prod.id, 'produto', v_prod.nome,
                            'preco_de', v_prop.preco_atual, 'preco_para', v_prop.preco_proposto);
END $f$;

REVOKE ALL ON FUNCTION public.preco_proposta_aprovar(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.preco_proposta_aprovar(uuid) TO authenticated;

-- ---------------------------------------------------------------------------------------------------
-- 4. As duas propostas aprovadas em 16/11 voltam aos números com que foram decididas. Os valores esperados são os
--    do cartão na hora da decisão (docs/ensaio-preco-minimo.md e a proposta de 99,90 criada às 19:36 UTC). A conta
--    de hoje precisa dar exatamente eles; se der outra coisa, o custo mudou e a migração para.
-- ---------------------------------------------------------------------------------------------------
CREATE TEMP TABLE _restaurar ON COMMIT DROP AS
SELECT e.id, e.custo_material, n.custo, n.piso, n.margem_minima, n.margem_atual, n.margem_proposta, n.base,
       e.custo AS e_custo, e.piso AS e_piso, e.margem_minima AS e_margem_minima,
       e.margem_atual AS e_margem_atual, e.margem_proposta AS e_margem_proposta
  FROM (VALUES
        ('a6821c5e-e983-497a-85b3-1670dcd4db16'::uuid, 20.80::numeric, 34.33::numeric, 71.73::numeric, 30::numeric, 37.88::numeric, 48.25::numeric),
        ('8ad77013-1c08-4a80-84f5-22c8b3b2e2ae'::uuid,  7.24::numeric, 38.06::numeric, 72.84::numeric, 40::numeric, 39.34::numeric, 58.71::numeric)
       ) AS e(id, custo_material, custo, piso, margem_minima, margem_atual, margem_proposta)
  JOIN public.precos_propostas pp ON pp.id = e.id
 CROSS JOIN LATERAL public._preco_proposta_numeros(pp.produto_id, pp.preco_atual, pp.preco_proposto) n
 WHERE pp.status = 'aprovada';

DO $prova$
BEGIN
  IF (SELECT count(*) FROM _restaurar) <> 2 THEN
    RAISE EXCEPTION 'as duas propostas aprovadas de 16/11 não estão no lugar';
  END IF;
  IF EXISTS (SELECT 1 FROM _restaurar
              WHERE base <> 'custo_real'
                 OR custo <> e_custo OR piso <> e_piso OR margem_minima <> e_margem_minima
                 OR margem_atual <> e_margem_atual OR margem_proposta <> e_margem_proposta) THEN
    RAISE EXCEPTION 'a conta de hoje não dá os números da decisão: o custo mudou desde 16/11. Não restaure.';
  END IF;
END
$prova$;

WITH restauradas AS (
  UPDATE public.precos_propostas pp
     SET custo = r.custo, piso = r.piso, margem_minima = r.margem_minima,
         margem_atual = r.margem_atual, margem_proposta = r.margem_proposta
    FROM _restaurar r
   WHERE pp.id = r.id AND pp.status = 'aprovada' AND pp.custo = r.custo_material
  RETURNING pp.id, pp.produto_id
)
INSERT INTO public.logs_auditoria (usuario_id, entidade, entidade_id, acao, detalhes)
SELECT NULL, 'produtos', x.produto_id, 'preco_proposta_numeros_restaurados',
       jsonb_build_object('proposta_id', x.id, 'base', 'custo_real', 'migracao', '20261117100000')
  FROM restauradas x;

-- ---------------------------------------------------------------------------------------------------
-- Conferência final: a migração para se algo não ficou como deveria.
-- ---------------------------------------------------------------------------------------------------
DO $confere$
BEGIN
  IF has_function_privilege('anon', 'public._preco_proposta_numeros(uuid, numeric, numeric)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public._preco_proposta_numeros(uuid, numeric, numeric)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public._preco_proposta_numeros(uuid, numeric, numeric)', 'EXECUTE') THEN
    RAISE EXCEPTION '_preco_proposta_numeros não pode ser executada de fora';
  END IF;
  IF has_function_privilege('anon', 'public.preco_proposta_criar(uuid, numeric, text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.preco_proposta_aprovar(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.preco_proposta_criar(uuid, numeric, text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.preco_proposta_aprovar(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'EXECUTE de preco_proposta_criar e preco_proposta_aprovar deveria ser só de authenticated';
  END IF;
  IF (SELECT count(*) FROM public.precos_propostas
       WHERE id IN ('a6821c5e-e983-497a-85b3-1670dcd4db16', '8ad77013-1c08-4a80-84f5-22c8b3b2e2ae')
         AND (id, margem_proposta) IN (('a6821c5e-e983-497a-85b3-1670dcd4db16'::uuid, 48.25),
                                       ('8ad77013-1c08-4a80-84f5-22c8b3b2e2ae'::uuid, 58.71))) <> 2 THEN
    RAISE EXCEPTION 'as duas propostas de 16/11 não voltaram aos números da decisão';
  END IF;
END
$confere$;

COMMIT;
