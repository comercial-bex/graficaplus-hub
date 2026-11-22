-- =====================================================================================================
-- TROFÉU DE ACRÍLICO: GRAVAR O TROFÉU E A ARTE COMO LINHAS DO ORÇAMENTO (22/11/2026)
--
-- O servidor (`salvarTrofeuNoOrcamento`, src/lib/api/trofeus.functions.ts) recalcula o preço com as taxas do banco e
-- entrega a esta função só o que vai para o orçamento. É o par de `salvar_item_3d_no_orcamento`, mais simples: o
-- troféu não tem tabelas próprias de peça por orçamento, é uma linha em `orcamento_itens` (e uma linha por item de arte).
--
--   * O TROFÉU: uma linha (`origem_calculo = 'trofeu'`, `tipo_produto = 'Troféu de acrílico'`), com o preço unitário e
--     o custo unitário (custo cheio) que o servidor calculou. `produto_id` fica vazio: não há produto "troféu" no
--     catálogo, e os gatilhos de custo e de preço por área só agem em item com produto ou com `preco_m2`, então o
--     valor gravado fica como o servidor mandou.
--   * A ARTE: uma linha por item (criação exclusiva, alteração extra, nome individual), com `origem_calculo =
--     'trofeu_arte'` e o id do troféu em `parametros.trofeu_item_id`. NÃO usa `gerado_por_item_id`: essa coluna é das
--     respostas que cobram (cobranca-das-respostas) e apaga em cascata. Salvar de novo o mesmo troféu troca as linhas
--     de arte dele; nunca mexe em linha de outro troféu.
--   * Só entra em orçamento que ainda não virou OS (mesma regra do 3D).
--   * Quem chama precisa de `orcamentos.create` (conferido aqui por `auth.uid()`, via `require_permission`).
--
-- A função GRAVA, então nasce fechada: `REVOKE ALL ... FROM PUBLIC, anon, authenticated` e só `authenticated`
-- recebe `EXECUTE` de volta, de propósito (o navegador do vendedor chama pelo servidor com o cliente dele, e a função
-- confere a permissão). A conferência final prova que `anon` e `public` não executam.
--
-- Ensaio no banco vivo, desfeito por RAISE EXCEPTION: docs/ensaio-trofeu-salvar-no-orcamento-22-11-2026.md.
-- =====================================================================================================
BEGIN;
SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------------------------------
-- 0. Guardas
-- ---------------------------------------------------------------------------------------------------
DO $guarda$
BEGIN
  IF to_regprocedure('public.salvar_trofeu_no_orcamento(uuid, uuid, uuid, text, numeric, numeric, numeric, text, jsonb, jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'salvar_trofeu_no_orcamento já existe: releia antes de recriar';
  END IF;
  IF to_regclass('public.trofeu_modelos') IS NULL THEN
    RAISE EXCEPTION 'falta a tabela trofeu_modelos: aplique antes a migração 20261122200000';
  END IF;
  IF to_regprocedure('public.require_permission(text)') IS NULL THEN
    RAISE EXCEPTION 'falta public.require_permission(text)';
  END IF;
END
$guarda$;

-- ---------------------------------------------------------------------------------------------------
-- 1. A função
-- ---------------------------------------------------------------------------------------------------
CREATE FUNCTION public.salvar_trofeu_no_orcamento(
  p_orcamento_id uuid,
  p_item_id uuid,
  p_modelo_id uuid,
  p_descricao text,
  p_quantidade numeric,
  p_valor_unitario numeric,
  p_custo_unitario numeric,
  p_especificacao text,
  p_parametros jsonb,
  p_arte jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid;
  v_orc public.orcamentos%ROWTYPE;
  v_item uuid;
  v_ordem integer;
  v_linha jsonb;
  v_arte_ids uuid[] := ARRAY[]::uuid[];
  v_novo uuid;
  v_valor_arte numeric := 0;
  v_unit numeric;
  v_total numeric;
BEGIN
  v_uid := public.require_permission('orcamentos.create');

  IF COALESCE(btrim(p_descricao), '') = '' THEN RAISE EXCEPTION 'Dê uma descrição ao troféu.'; END IF;
  IF p_quantidade IS NULL OR p_quantidade < 1 OR p_quantidade <> trunc(p_quantidade) THEN
    RAISE EXCEPTION 'A quantidade de troféus precisa ser um número inteiro, de 1 para cima.';
  END IF;
  IF COALESCE(p_valor_unitario, 0) <= 0 THEN RAISE EXCEPTION 'O troféu está sem preço: refaça a conta antes de salvar.'; END IF;
  IF COALESCE(p_custo_unitario, 0) < 0 THEN RAISE EXCEPTION 'O custo do troféu não pode ser negativo.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.trofeu_modelos WHERE id = p_modelo_id AND ativo) THEN
    RAISE EXCEPTION 'Modelo de troféu não encontrado ou desativado.';
  END IF;
  IF p_arte IS NOT NULL AND jsonb_typeof(p_arte) <> 'array' THEN
    RAISE EXCEPTION 'As linhas de arte precisam vir em uma lista.';
  END IF;

  SELECT * INTO v_orc FROM public.orcamentos WHERE id = p_orcamento_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Orçamento não encontrado'; END IF;
  IF v_orc.os_id IS NOT NULL OR v_orc.status::text = 'convertido' THEN
    RAISE EXCEPTION 'Este orçamento já virou OS: os itens ficam como foram vendidos.';
  END IF;

  IF p_item_id IS NULL THEN
    SELECT COALESCE(max(ordem) + 1, 0) INTO v_ordem FROM public.orcamento_itens WHERE orcamento_id = p_orcamento_id;
    INSERT INTO public.orcamento_itens (orcamento_id, descricao, quantidade, unidade, valor_unitario, custo_unitario, ordem,
      tipo_produto, origem_calculo, especificacao, parametros)
    VALUES (p_orcamento_id, btrim(p_descricao), p_quantidade, 'un', round(p_valor_unitario, 2), round(COALESCE(p_custo_unitario, 0), 2),
      v_ordem, 'Troféu de acrílico', 'trofeu', NULLIF(btrim(COALESCE(p_especificacao, '')), ''),
      COALESCE(p_parametros, '{}'::jsonb) || jsonb_build_object('modelo_id', p_modelo_id))
    RETURNING id INTO v_item;
  ELSE
    PERFORM 1 FROM public.orcamento_itens
      WHERE id = p_item_id AND orcamento_id = p_orcamento_id AND origem_calculo = 'trofeu' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Este troféu não pertence a este orçamento.'; END IF;
    v_item := p_item_id;
    UPDATE public.orcamento_itens
       SET descricao = btrim(p_descricao), quantidade = p_quantidade, valor_unitario = round(p_valor_unitario, 2),
           custo_unitario = round(COALESCE(p_custo_unitario, 0), 2),
           especificacao = NULLIF(btrim(COALESCE(p_especificacao, '')), ''),
           parametros = COALESCE(p_parametros, '{}'::jsonb) || jsonb_build_object('modelo_id', p_modelo_id)
     WHERE id = v_item;
  END IF;

  -- A arte deste troféu é trocada por inteiro: sai o que havia, entra o que veio. Só as linhas DELE.
  DELETE FROM public.orcamento_itens
   WHERE orcamento_id = p_orcamento_id AND origem_calculo = 'trofeu_arte' AND parametros ->> 'trofeu_item_id' = v_item::text;

  IF p_arte IS NOT NULL THEN
    SELECT COALESCE(max(ordem) + 1, 0) INTO v_ordem FROM public.orcamento_itens WHERE orcamento_id = p_orcamento_id;
    FOR v_linha IN SELECT * FROM jsonb_array_elements(p_arte) LOOP
      IF COALESCE(btrim(v_linha ->> 'descricao'), '') = '' THEN RAISE EXCEPTION 'Uma linha de arte está sem descrição.'; END IF;
      IF COALESCE((v_linha ->> 'valor')::numeric, 0) <= 0 THEN RAISE EXCEPTION 'Uma linha de arte está sem valor.'; END IF;
      IF COALESCE((v_linha ->> 'custo')::numeric, 0) < 0 THEN RAISE EXCEPTION 'O custo de uma linha de arte não pode ser negativo.'; END IF;
      INSERT INTO public.orcamento_itens (orcamento_id, descricao, quantidade, unidade, valor_unitario, custo_unitario, ordem,
        tipo_produto, origem_calculo, parametros)
      VALUES (p_orcamento_id, btrim(v_linha ->> 'descricao'), 1, 'un', round((v_linha ->> 'valor')::numeric, 2),
        round(COALESCE((v_linha ->> 'custo')::numeric, 0), 2), v_ordem, 'Arte do troféu', 'trofeu_arte',
        jsonb_build_object('trofeu_item_id', v_item))
      RETURNING id INTO v_novo;
      v_arte_ids := v_arte_ids || v_novo;
      v_valor_arte := v_valor_arte + round((v_linha ->> 'valor')::numeric, 2);
      v_ordem := v_ordem + 1;
    END LOOP;
  END IF;

  SELECT valor_unitario, valor_total INTO v_unit, v_total FROM public.orcamento_itens WHERE id = v_item;
  RETURN jsonb_build_object('orcamento_id', p_orcamento_id, 'item_id', v_item, 'arte_item_ids', to_jsonb(v_arte_ids),
                            'valor_unitario', v_unit, 'valor_total', v_total, 'valor_arte', v_valor_arte);
END
$function$;

COMMENT ON FUNCTION public.salvar_trofeu_no_orcamento(uuid, uuid, uuid, text, numeric, numeric, numeric, text, jsonb, jsonb) IS
  'Grava o troféu de acrílico e as linhas de arte dele como itens do orçamento. Exige orcamentos.create; o servidor (salvarTrofeuNoOrcamento) recalcula o preço antes de chamar.';

-- ---------------------------------------------------------------------------------------------------
-- 2. Quem executa: nasce aberta para PUBLIC e para os papéis do Supabase; fecha tudo e devolve só a `authenticated`
-- ---------------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.salvar_trofeu_no_orcamento(uuid, uuid, uuid, text, numeric, numeric, numeric, text, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.salvar_trofeu_no_orcamento(uuid, uuid, uuid, text, numeric, numeric, numeric, text, jsonb, jsonb)
  TO authenticated;

-- ---------------------------------------------------------------------------------------------------
-- 3. Conferência final: `anon` e `public` não executam, `authenticated` sim, e a função é SECURITY DEFINER fechada ao schema
-- ---------------------------------------------------------------------------------------------------
DO $final$
DECLARE
  v_oid oid := 'public.salvar_trofeu_no_orcamento(uuid, uuid, uuid, text, numeric, numeric, numeric, text, jsonb, jsonb)'::regprocedure;
BEGIN
  IF has_function_privilege('anon', v_oid, 'EXECUTE') THEN RAISE EXCEPTION 'anon ainda executa salvar_trofeu_no_orcamento'; END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
              WHERE p.oid = v_oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
    RAISE EXCEPTION 'PUBLIC ainda executa salvar_trofeu_no_orcamento';
  END IF;
  IF NOT has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN RAISE EXCEPTION 'authenticated não executa salvar_trofeu_no_orcamento'; END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_oid) THEN RAISE EXCEPTION 'a função deveria ser SECURITY DEFINER'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = v_oid AND proconfig @> ARRAY['search_path=public']) THEN
    RAISE EXCEPTION 'a função está sem search_path fixo';
  END IF;
END
$final$;

COMMIT;

-- =====================================================================================================
-- DESFAZER (as linhas de orçamento que ela gravou ficam; só a função some):
--   DROP FUNCTION public.salvar_trofeu_no_orcamento(uuid, uuid, uuid, text, numeric, numeric, numeric, text, jsonb, jsonb);
-- Para tirar também as linhas: DELETE FROM public.orcamento_itens WHERE origem_calculo IN ('trofeu', 'trofeu_arte');
-- (só em orçamento que ainda não virou OS).
-- =====================================================================================================
