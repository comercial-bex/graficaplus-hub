-- APLICADA em 10/11/2026, em produção, depois de ensaio na mesma base: antes=47 orçamentos acusavam, depois=5 (todos mudanças
-- reais: 115, 134, 198, 204 e 206), alarme novo=0, versões e funções vizinhas idênticas, permissões conferidas.

-- Faixa "Mudou depois de enviado/aprovado" lê só o que a versão guardou (decisão 7 de proximos-passos-interface-holdprint.md).
--
-- DEFEITO (medido em 05/11/2026): 38 de 44 orçamentos com versão mostravam a faixa sem terem mudado. O hash da
-- versão é md5(itens::text || '|' || valor_total) e o item traz toda coluna de orcamento_itens. Duas colunas
-- (respostas e gerado_por_item_id, 02/11) nasceram depois das versões antigas, então o hash de hoje nunca bate com
-- o guardado. Tirando só essas duas chaves, o hash de hoje é igual ao guardado em 30 dos 38.
--
-- CORREÇÃO, SÓ DE LEITURA. orcamento_diferenca_da_versao deixa de comparar hash e compara o conteúdo, olhando só
-- as chaves que a versão guardou. NÃO muda o que a versão guarda: orcamento_versoes, orcamento_versao_itens,
-- tg_orcamento_congela_versao, orcamento_hash_atual e orcamento_itens_para_versao ficam como estão. A RPC devolve
-- os mesmos campos de antes (mudou, valor_mudou...) e ganha o_que_mudou; a tela atual funciona sem mudar.
--
-- REGRAS (orcamento_retrato_diferencas):
--  1. Itens ligados pelo id: só no retrato = tirado; só hoje = novo.
--  2. Item nos dois lados: só as chaves que o retrato guardou e que ainda existem hoje. Chave nova não conta, chave
--     que sumiu não conta. Fora: id, orcamento_id, created_at (identidade) e arquivo_id (a arte).
--  3. Comparação em jsonb: número por valor (12.20 = 12.2), objeto sem ordem de chaves.
--  4. Retrato sem nenhum item e com total maior que zero (orçamento antigo, linhas preenchidas depois) não descreve
--     os itens: só o total vale.
--  5. O total (valor_total) sempre conta, na própria RPC, e nunca depende desta função.
--  6. Termos do cabeçalho (o que o PDF e a página do cliente mostram) saem à parte, em o_que_mudou.termos, e NÃO
--     entram em mudou. Só contam quando já havia valor e ele trocou. Na condição de pagamento só valem forma,
--     bandeira, modelo, entrada, parcelas, intervalo e primeiro vencimento, nunca o Pix gerado ou recebido.

-- 1. A comparação: pura, só recebe dois JSON e não lê tabela ----------------------------------------------------
CREATE OR REPLACE FUNCTION public.orcamento_retrato_diferencas(p_guardado jsonb, p_vivo jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  WITH
  -- Itens do retrato (gi) e de hoje (vi), ligados pelo id.
  gi AS (
    SELECT x AS item, x ->> 'id' AS id
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_guardado -> 'itens') = 'array' THEN p_guardado -> 'itens' ELSE '[]'::jsonb END) AS x
     WHERE jsonb_typeof(x) = 'object'
  ),
  vi AS (
    SELECT x AS item, x ->> 'id' AS id
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_vivo -> 'itens') = 'array' THEN p_vivo -> 'itens' ELSE '[]'::jsonb END) AS x
     WHERE jsonb_typeof(x) = 'object'
  ),
  -- Retrato que não descreve os itens: nenhum item guardado e total maior que zero. Só o total vale.
  cego AS (
    SELECT (NOT EXISTS (SELECT 1 FROM gi))
           AND coalesce(CASE WHEN jsonb_typeof(p_guardado #> '{orcamento,valor_total}') = 'number'
                             THEN (p_guardado #>> '{orcamento,valor_total}')::numeric END, 0) > 0 AS sem_itens
  ),
  tirados AS (
    SELECT gi.id FROM gi, cego
     WHERE NOT cego.sem_itens AND NOT EXISTS (SELECT 1 FROM vi WHERE vi.id = gi.id)
  ),
  novos AS (
    SELECT vi.id FROM vi, cego
     WHERE NOT cego.sem_itens AND NOT EXISTS (SELECT 1 FROM gi WHERE gi.id = vi.id)
  ),
  -- Só as chaves que o retrato guardou. A chave que sumiu hoje não conta; a chave nova (que o retrato não tem)
  -- nem é lida. jsonb compara número por valor e objeto sem ordem.
  mudados AS (
    SELECT gi.id, array_agg(kv.key ORDER BY kv.key) AS campos
      FROM gi
      JOIN vi ON vi.id = gi.id
     CROSS JOIN LATERAL jsonb_each(gi.item) AS kv(key, value)
     WHERE kv.key <> ALL (ARRAY['id', 'orcamento_id', 'created_at', 'arquivo_id'])
       AND vi.item ? kv.key
       AND kv.value IS DISTINCT FROM (vi.item -> kv.key)
     GROUP BY gi.id
  ),
  cab AS (
    SELECT p_guardado -> 'orcamento' AS ant, p_vivo -> 'orcamento' AS dep
  ),
  -- Termos do cabeçalho: só quando já havia valor no retrato e ele trocou (vazio que vira valor não conta).
  termos AS (
    SELECT r.chave
      FROM cab
     CROSS JOIN unnest(ARRAY['cliente_id', 'validade_dias', 'prazo', 'prazo_tipo', 'data_entrega_prometida', 'preco_modo',
                             'desconto_modo', 'desconto_informado', 'desconto_percentual', 'desconto_valor',
                             'precisa_entrega', 'precisa_instalacao', 'titulo', 'observacao_cliente']) AS r(chave)
     CROSS JOIN LATERAL (SELECT cab.ant -> r.chave AS antes, cab.dep -> r.chave AS depois) x
     WHERE (cab.ant ? r.chave) AND (cab.dep ? r.chave)
       AND x.antes IS DISTINCT FROM x.depois
       AND NOT (x.antes IS NULL OR x.antes IN ('null'::jsonb, '""'::jsonb, '{}'::jsonb, '[]'::jsonb)
                OR (jsonb_typeof(x.antes) = 'string' AND btrim(x.antes #>> '{}') = ''))
    UNION ALL
    SELECT 'condicao_pagamento.' || r.chave
      FROM cab
     CROSS JOIN unnest(ARRAY['forma', 'bandeira', 'modelo', 'entrada_pct', 'entrada_valor', 'parcelas', 'intervalo_dias', 'primeiro_vencimento']) AS r(chave)
     CROSS JOIN LATERAL (SELECT cab.ant -> 'condicao_pagamento' -> r.chave AS antes, cab.dep -> 'condicao_pagamento' -> r.chave AS depois) x
     WHERE jsonb_typeof(cab.ant -> 'condicao_pagamento') = 'object' AND jsonb_typeof(cab.dep -> 'condicao_pagamento') = 'object'
       AND (cab.ant -> 'condicao_pagamento') ? r.chave AND (cab.dep -> 'condicao_pagamento') ? r.chave
       AND x.antes IS DISTINCT FROM x.depois
       AND NOT (x.antes IS NULL OR x.antes IN ('null'::jsonb, '""'::jsonb, '{}'::jsonb, '[]'::jsonb)
                OR (jsonb_typeof(x.antes) = 'string' AND btrim(x.antes #>> '{}') = ''))
  )
  SELECT jsonb_build_object(
    'mudou', EXISTS (SELECT 1 FROM tirados) OR EXISTS (SELECT 1 FROM novos) OR EXISTS (SELECT 1 FROM mudados),
    'itens_novos', (SELECT count(*) FROM novos),
    'itens_tirados', (SELECT count(*) FROM tirados),
    'itens_mudados', (SELECT count(*) FROM mudados),
    'campos', (SELECT coalesce(jsonb_agg(DISTINCT c ORDER BY c), '[]'::jsonb) FROM mudados, unnest(mudados.campos) AS c),
    'termos', (SELECT coalesce(jsonb_agg(DISTINCT t.chave ORDER BY t.chave), '[]'::jsonb) FROM termos t),
    'retrato_sem_itens', (SELECT sem_itens FROM cego)
  )
$function$;
REVOKE ALL ON FUNCTION public.orcamento_retrato_diferencas(jsonb, jsonb) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.orcamento_retrato_diferencas(jsonb, jsonb) IS
  'Compara o retrato guardado de uma versao do orcamento com o conteudo de hoje, olhando so as chaves que o retrato guardou. Pura: recebe dois JSON e devolve um resumo (itens novos, tirados e mudados, campos e termos do cabecalho). Usada so por orcamento_diferenca_da_versao.';

-- 2. A RPC passa a usar a comparação (troca sobre a definição VIVA; para se a função mudou) --------------------
DO $migracao$
DECLARE
  v_def text := pg_get_functiondef('public.orcamento_diferenca_da_versao(uuid)'::regprocedure);
  v_de text[];
  v_para text[];
  k integer;
  n integer;
BEGIN
  IF position('orcamento_retrato_diferencas' IN v_def) > 0 THEN
    RAISE NOTICE 'orcamento_diferenca_da_versao já compara pelas chaves do retrato';
    RETURN;
  END IF;
  v_de := ARRAY[
    $d$v_atual numeric;$d$,
    $d$SELECT valor_total INTO v_atual FROM public.orcamentos WHERE id = p_orcamento;$d$,
    $d$'mudou', v_ultima.snapshot->>'hash' IS DISTINCT FROM public.orcamento_hash_atual(p_orcamento),$d$
  ];
  v_para := ARRAY[
    $d$v_atual numeric; v_dif jsonb;$d$,
    $d$SELECT valor_total INTO v_atual FROM public.orcamentos WHERE id = p_orcamento;
  v_dif := public.orcamento_retrato_diferencas(v_ultima.snapshot, jsonb_build_object(
    'orcamento', (SELECT public.jsonb_sem_custo(to_jsonb(o) - 'token_publico' - 'aprovado_ip') FROM public.orcamentos o WHERE o.id = p_orcamento),
    'itens', public.orcamento_itens_para_versao(p_orcamento)));$d$,
    $d$'mudou', (v_ultima.valor_total IS DISTINCT FROM v_atual) OR coalesce((v_dif->>'mudou')::boolean, true),
    'o_que_mudou', v_dif,$d$
  ];
  FOR k IN 1..array_length(v_de, 1) LOOP
    n := (length(v_def) - length(replace(v_def, v_de[k], ''))) / length(v_de[k]);
    IF n <> 1 THEN
      RAISE EXCEPTION 'orcamento_diferenca_da_versao: âncora % apareceu % vezes (esperado 1)', k, n;
    END IF;
    v_def := replace(v_def, v_de[k], v_para[k]);
  END LOOP;
  EXECUTE v_def;
END $migracao$;
REVOKE ALL ON FUNCTION public.orcamento_diferenca_da_versao(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.orcamento_diferenca_da_versao(uuid) TO authenticated;

-- 3. Conferência: a RPC usa a comparação nova, não lê mais o hash e as portas estão como devem -------------------
DO $conferencia$
DECLARE
  v_def text := pg_get_functiondef('public.orcamento_diferenca_da_versao(uuid)'::regprocedure);
BEGIN
  IF position('orcamento_retrato_diferencas' IN v_def) = 0 THEN
    RAISE EXCEPTION 'orcamento_diferenca_da_versao não usa a comparação nova';
  END IF;
  IF position('orcamento_hash_atual' IN v_def) > 0 THEN
    RAISE EXCEPTION 'orcamento_diferenca_da_versao ainda lê o hash antigo';
  END IF;
  IF has_function_privilege('anon', 'public.orcamento_diferenca_da_versao(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.orcamento_diferenca_da_versao(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'orcamento_diferenca_da_versao: permissões fora do esperado';
  END IF;
  IF has_function_privilege('anon', 'public.orcamento_retrato_diferencas(jsonb, jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.orcamento_retrato_diferencas(jsonb, jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'orcamento_retrato_diferencas: ficou aberta ao navegador';
  END IF;
END $conferencia$;
