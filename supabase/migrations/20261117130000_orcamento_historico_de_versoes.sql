-- =====================================================================================================
-- HISTÓRICO DE VERSÕES DO ORÇAMENTO, SÓ LEITURA (17/11/2026)
--
-- ENSAIADA no banco vivo em 17/11/2026, desfeita por RAISE EXCEPTION final (ver docs/ensaio-orcamento-historico-de-versoes.md).
-- APLICADA no banco vivo em 17/11/2026 (a 100000, da área cobrada, ficou de fora até o dono dar o OK).
-- O QUE ESTAVA FALTANDO
--   O banco já guarda versões congeladas (orcamento_versoes: 94 linhas em 17/11/2026), mas nenhuma tela as
--   lista: a equipe não via quando o orçamento foi enviado, com que total, por quem e o que mudou de uma
--   versão para a outra. A tabela guarda o retrato inteiro (com itens), que a equipe não deve ler solto.
--
-- O QUE ESTA MIGRAÇÃO FAZ
--   Cria a função NOVA orcamento_historico_de_versoes(uuid): devolve, da mais nova para a mais velha, só os
--   campos que a tela precisa (número, status, datas, autor, total, quantidade de itens, se é a aprovada, o
--   que mudou em relação à versão anterior e o total anterior). Lê quem vê preço (can_see_prices), a mesma
--   regra de orcamento_diferenca_da_versao; quem não vê recebe lista vazia. Só leitura: não grava nada,
--   não troca função viva, não toca tabela, view, policy nem GRANT por coluna.
--   anon fora; authenticated e service_role podem executar.
--
-- COMO DESFAZER (comentado): DROP FUNCTION public.orcamento_historico_de_versoes(uuid);
-- =====================================================================================================
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $g$
BEGIN
  IF to_regprocedure('public.orcamento_retrato_diferencas(jsonb, jsonb)') IS NULL THEN
    RAISE EXCEPTION 'orcamento_retrato_diferencas não existe';
  END IF;
  IF to_regprocedure('public.can_see_prices(uuid)') IS NULL THEN
    RAISE EXCEPTION 'can_see_prices não existe';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'orcamento_versoes'
        AND column_name IN ('id', 'orcamento_id', 'numero_versao', 'status', 'snapshot', 'valor_total', 'enviada_em', 'aprovada_em', 'aprovado_por', 'created_by', 'created_at')) <> 11 THEN
    RAISE EXCEPTION 'orcamento_versoes perdeu coluna usada pelo histórico';
  END IF;
END $g$;

CREATE OR REPLACE FUNCTION public.orcamento_historico_de_versoes(p_orcamento uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $f$
DECLARE
  v_uid uuid := auth.uid();
  v_va uuid;
BEGIN
  IF v_uid IS NULL OR p_orcamento IS NULL OR NOT public.can_see_prices(v_uid) THEN
    RETURN '[]'::jsonb;
  END IF;
  SELECT o.versao_aprovada_id INTO v_va FROM public.orcamentos o WHERE o.id = p_orcamento;
  RETURN coalesce((
    SELECT jsonb_agg(x.j ORDER BY x.n DESC)
      FROM (
        SELECT v.numero_versao AS n,
               jsonb_build_object(
                 'id', v.id,
                 'numero', v.numero_versao,
                 'status', v.status,
                 'criada_em', v.created_at,
                 'enviada_em', v.enviada_em,
                 'aprovada_em', v.aprovada_em,
                 'autor', (SELECT u.nome FROM public.usuarios u WHERE u.id = coalesce(v.aprovado_por, v.created_by)),
                 'valor_total', v.valor_total,
                 'qtd_itens', jsonb_array_length(CASE WHEN jsonb_typeof(v.snapshot -> 'itens') = 'array' THEN v.snapshot -> 'itens' ELSE '[]'::jsonb END),
                 'retroativa', coalesce((v.snapshot ->> 'retroativa')::boolean, false),
                 'e_a_aprovada', v.id IS NOT DISTINCT FROM v_va,
                 'o_que_mudou', CASE WHEN lag(v.snapshot) OVER w IS NULL THEN NULL
                                     ELSE public.orcamento_retrato_diferencas(lag(v.snapshot) OVER w, v.snapshot) END,
                 'valor_anterior', lag(v.valor_total) OVER w
               ) AS j
          FROM public.orcamento_versoes v
         WHERE v.orcamento_id = p_orcamento
        WINDOW w AS (ORDER BY v.numero_versao)
      ) x
  ), '[]'::jsonb);
END $f$;

REVOKE ALL ON FUNCTION public.orcamento_historico_de_versoes(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.orcamento_historico_de_versoes(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.orcamento_historico_de_versoes(uuid) IS
  'Histórico de versões congeladas de um orçamento, da mais nova para a mais velha, só com os campos da tela. Só leitura; quem não vê preço recebe lista vazia.';

DO $v$
BEGIN
  IF has_function_privilege('anon', 'public.orcamento_historico_de_versoes(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'orcamento_historico_de_versoes ficou executável por anon';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.orcamento_historico_de_versoes(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated não executa orcamento_historico_de_versoes';
  END IF;
END $v$;

COMMIT;
