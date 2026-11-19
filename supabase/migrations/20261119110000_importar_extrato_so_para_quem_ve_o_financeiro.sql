-- =====================================================================================================
-- IMPORTAR EXTRATO SÓ PARA QUEM VÊ O FINANCEIRO (19/11/2026)
--
-- APLICADA em 19/11/2026 pelo conector do banco, a partir DESTE arquivo (do BEGIN ao COMMIT, sem alteração).
-- RETRATO: md5(prosrc) de importar_extrato(uuid, jsonb) = c8eab92181045b6da767039bf0ad9f12; anon sem EXECUTE.
-- Ensaio no banco vivo, desfeito: admin e financeiro importam; a vendedora com pagamentos.confirm é recusada
-- ("Importar extrato é do financeiro."); saldo do Itaú segue R$ 385,82.
--
-- O QUE ESTAVA ERRADO: importar_extrato só exigia pagamentos.confirm. As vendedoras têm essa chave (confirmar
-- Pix de OS) e não veem o financeiro; pela função, elas importavam extrato e lançavam no caixa. A tela já
-- escondia o botão de quem não vê o financeiro só em parte (a chave bastava).
-- O QUE FAZ: troca só importar_extrato: depois da chave, exige can_see_financials (admin passa). Mesmo
-- corpo, mesma assinatura, mesmo retorno; REVOKE/GRANT como estava (anon sem EXECUTE).
-- =====================================================================================================
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $guarda$
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.importar_extrato(uuid, jsonb)'::regprocedure)
       IS DISTINCT FROM '6f2880eddae8a07775fa9680162f92b9' THEN
    RAISE EXCEPTION 'importar_extrato mudou no banco. Releia a definição viva antes de trocar.';
  END IF;
END $guarda$;

CREATE OR REPLACE FUNCTION public.importar_extrato(p_conta_id uuid, p_linhas jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid;
  l jsonb;
  v_data date; v_valor numeric; v_tipo text; v_desc text; v_doc text; v_fitid text;
  v_hash text; v_tx uuid; v_mov uuid;
  v_importadas int := 0; v_duplicadas int := 0;
  v_dups jsonb := '[]'::jsonb;
  v_conferido date;
  v_saldos int := 0; v_ja_conferidas int := 0;
BEGIN
  v_uid := public.require_permission('pagamentos.confirm');
  -- Ver o financeiro também: a vendedora tem pagamentos.confirm (confirmar Pix de OS) sem ver o caixa.
  IF NOT public.can_see_financials(v_uid) THEN
    RAISE EXCEPTION 'Importar extrato é do financeiro.' USING ERRCODE = '42501';
  END IF;

  SELECT c.extrato_conferido_ate INTO v_conferido FROM public.contas_bancarias c WHERE c.id = p_conta_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conta bancária não encontrada';
  END IF;
  IF p_linhas IS NULL OR jsonb_typeof(p_linhas) <> 'array' THEN
    RAISE EXCEPTION 'Nenhum lançamento para importar';
  END IF;

  FOR l IN SELECT * FROM jsonb_array_elements(p_linhas) LOOP
    v_data  := NULLIF(l->>'data','')::date;
    v_valor := round(COALESCE(NULLIF(l->>'valor','')::numeric, 0), 2);
    v_desc  := COALESCE(NULLIF(btrim(l->>'descricao'),''), 'Lançamento bancário');
    v_doc   := NULLIF(btrim(COALESCE(l->>'documento','')), '');
    v_fitid := NULLIF(btrim(COALESCE(l->>'fitid','')), '');
    v_tipo  := CASE WHEN COALESCE(l->>'tipo','') IN ('credito','debito')
                    THEN l->>'tipo'
                    WHEN v_valor < 0 THEN 'debito' ELSE 'credito' END;
    v_valor := abs(v_valor);

    IF v_data IS NULL OR v_valor = 0 THEN
      CONTINUE;
    END IF;

    -- "SALDO TOTAL DISPONÍVEL DIA", "SALDO ANTERIOR", "SDO CTA/APL...": é o banco dizendo quanto há na
    -- conta, não dinheiro entrando. Em 28/10/2026 entraram 27 dessas como crédito (R$ 23.043,30).
    IF v_desc ~* '^\s*(saldo|sdo)(\s|$)' THEN
      v_saldos := v_saldos + 1;
      CONTINUE;
    END IF;

    -- Período já conferido linha a linha com o banco: reimportar não pode duplicar.
    IF v_conferido IS NOT NULL AND v_data <= v_conferido THEN
      v_ja_conferidas := v_ja_conferidas + 1;
      CONTINUE;
    END IF;

    v_hash := md5(p_conta_id::text || '|' || v_data::text || '|' || v_valor::text || '|'
                  || v_tipo || '|' || lower(v_desc) || '|' || COALESCE(v_fitid,''));

    IF EXISTS (
      SELECT 1 FROM public.banco_transacoes t
       WHERE t.conta_id = p_conta_id
         AND (t.hash_dedup = v_hash OR (v_fitid IS NOT NULL AND t.fitid = v_fitid))
    ) THEN
      v_duplicadas := v_duplicadas + 1;
      v_dups := v_dups || jsonb_build_object('data', v_data, 'descricao', v_desc, 'valor', v_valor);
      CONTINUE;
    END IF;

    INSERT INTO public.caixa_movimentos
      (tipo, origem, descricao, categoria, valor, data, realizado, conta_id, created_by, observacoes)
    VALUES
      (CASE WHEN v_tipo = 'credito' THEN 'entrada' ELSE 'saida' END,
       'extrato', v_desc, 'banco', v_valor, v_data, true, p_conta_id, v_uid,
       'Importado do extrato bancário')
    RETURNING id INTO v_mov;

    INSERT INTO public.banco_transacoes
      (conta_id, data, descricao, valor, tipo, documento, fitid, origem,
       conciliado, caixa_movimento_id, hash_dedup, created_by)
    VALUES
      (p_conta_id, v_data, v_desc, v_valor, v_tipo, v_doc, v_fitid, 'extrato',
       true, v_mov, v_hash, v_uid)
    RETURNING id INTO v_tx;

    v_importadas := v_importadas + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'conta_id', p_conta_id,
    'importadas', v_importadas,
    'duplicadas', v_duplicadas,
    'ignoradas', v_dups,
    'saldos_ignorados', v_saldos,
    'ja_conferidas', v_ja_conferidas,
    'conferido_ate', v_conferido,
    'saldo_atual', (SELECT saldo_atual FROM public.vw_saldo_conta WHERE conta_id = p_conta_id)
  );
END $function$;

REVOKE ALL ON FUNCTION public.importar_extrato(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.importar_extrato(uuid, jsonb) TO authenticated, service_role;

DO $confere$
BEGIN
  IF has_function_privilege('anon', 'public.importar_extrato(uuid, jsonb)'::regprocedure, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.importar_extrato(uuid, jsonb)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'Permissão fora do esperado em importar_extrato.';
  END IF;
END $confere$;

COMMIT;
