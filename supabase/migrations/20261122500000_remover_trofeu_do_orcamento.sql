-- =====================================================================================================
-- TROFÉU DE ACRÍLICO: TIRAR O TROFÉU DO ORÇAMENTO COM A ARTE DELE (22/11/2026)
--
-- O troféu entra no orçamento como uma linha e, se tem arte, mais uma linha por item de arte
-- (`salvar_trofeu_no_orcamento`, migração 20261122400000). Tirar só a linha do troféu deixaria a arte solta, cobrando
-- no orçamento por um troféu que não existe mais. Esta função tira as duas coisas juntas, como
-- `remover_item_3d_do_orcamento` faz com a peça 3D.
--
--   * Só tira item de origem `trofeu` (nunca uma linha qualquer do orçamento) e só em orçamento que ainda não virou OS.
--   * As linhas de arte saem pelo vínculo do próprio troféu (`parametros.trofeu_item_id`), nunca pelas de outro.
--   * Quem chama precisa de `orcamentos.create` (conferido aqui por `auth.uid()`, via `require_permission`).
--
-- A função APAGA, então nasce fechada, como a que grava: `REVOKE ALL ... FROM PUBLIC, anon, authenticated` e só
-- `authenticated` recebe `EXECUTE` de volta. A conferência final prova que `anon` e `public` não executam.
-- =====================================================================================================
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $guarda$
BEGIN
  IF to_regprocedure('public.remover_trofeu_do_orcamento(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'remover_trofeu_do_orcamento já existe: releia antes de recriar';
  END IF;
  IF to_regprocedure('public.salvar_trofeu_no_orcamento(uuid, uuid, uuid, text, numeric, numeric, numeric, text, jsonb, jsonb)') IS NULL THEN
    RAISE EXCEPTION 'falta salvar_trofeu_no_orcamento: aplique antes a migração 20261122400000';
  END IF;
  IF to_regprocedure('public.require_permission(text)') IS NULL THEN
    RAISE EXCEPTION 'falta public.require_permission(text)';
  END IF;
END
$guarda$;

CREATE FUNCTION public.remover_trofeu_do_orcamento(p_item_id uuid) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid;
  v_item public.orcamento_itens%ROWTYPE;
  v_orc public.orcamentos%ROWTYPE;
  v_artes integer;
BEGIN
  v_uid := public.require_permission('orcamentos.create');

  SELECT * INTO v_item FROM public.orcamento_itens WHERE id = p_item_id AND origem_calculo = 'trofeu' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Este item não é um troféu do orçamento.'; END IF;

  SELECT * INTO v_orc FROM public.orcamentos WHERE id = v_item.orcamento_id FOR UPDATE;
  IF v_orc.os_id IS NOT NULL OR v_orc.status::text = 'convertido' THEN
    RAISE EXCEPTION 'Este orçamento já virou OS: os itens ficam como foram vendidos.';
  END IF;

  DELETE FROM public.orcamento_itens
   WHERE orcamento_id = v_item.orcamento_id AND origem_calculo = 'trofeu_arte' AND parametros ->> 'trofeu_item_id' = p_item_id::text;
  GET DIAGNOSTICS v_artes = ROW_COUNT;

  DELETE FROM public.orcamento_itens WHERE id = p_item_id;

  RETURN jsonb_build_object('orcamento_id', v_item.orcamento_id, 'item_id', p_item_id, 'linhas_de_arte_tiradas', v_artes);
END
$function$;

COMMENT ON FUNCTION public.remover_trofeu_do_orcamento(uuid) IS
  'Tira o troféu de acrílico do orçamento e as linhas de arte dele. Exige orcamentos.create; só item de origem trofeu, em orçamento que não virou OS.';

REVOKE ALL ON FUNCTION public.remover_trofeu_do_orcamento(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.remover_trofeu_do_orcamento(uuid) TO authenticated;

DO $final$
DECLARE
  v_oid oid := 'public.remover_trofeu_do_orcamento(uuid)'::regprocedure;
BEGIN
  IF has_function_privilege('anon', v_oid, 'EXECUTE') THEN RAISE EXCEPTION 'anon ainda executa remover_trofeu_do_orcamento'; END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
              WHERE p.oid = v_oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
    RAISE EXCEPTION 'PUBLIC ainda executa remover_trofeu_do_orcamento';
  END IF;
  IF NOT has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN RAISE EXCEPTION 'authenticated não executa remover_trofeu_do_orcamento'; END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_oid) THEN RAISE EXCEPTION 'a função deveria ser SECURITY DEFINER'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = v_oid AND proconfig @> ARRAY['search_path=public']) THEN
    RAISE EXCEPTION 'a função está sem search_path fixo';
  END IF;
END
$final$;

COMMIT;

-- =====================================================================================================
-- DESFAZER (só a função some; o que ela já tirou do orçamento não volta):
--   DROP FUNCTION public.remover_trofeu_do_orcamento(uuid);
-- =====================================================================================================
