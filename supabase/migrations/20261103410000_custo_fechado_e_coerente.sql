-- Custo fechado e coerente (revisão adversarial de 03/11/2026 sobre #409, #410 e #417).
--
-- A revisão achou seis furos no custo que as fórmulas e os terceirizados da pasta do
-- produto (coluna orcamento_itens.custo_formulas) passaram a trazer. Nenhum deles tinha
-- dado errado ainda (0 fórmulas e 0 terceirizados cadastrados), todos aparecem no
-- primeiro cadastro. Esta migração fecha os que moram no banco:
--
--  1. O retrato da versão do orçamento tirava o custo por uma LISTA de colunas escrita à
--     mão. custo_formulas nasceu depois e não entrou na lista: foi parar em
--     orcamento_versoes.snapshot e orcamento_versao_itens.snapshot, que o vendedor lê
--     (precos.read). A função é SECURITY DEFINER, então o GRANT por coluna não protegia.
--     Agora o retrato tira toda chave que começa com custo_ ou margem_, hoje e nas colunas
--     que vierem, mais parametros, produto_snapshot e materiais_por_formula (composição
--     interna). Os retratos já gravados são limpos e o hash guardado é refeito onde a conta
--     antiga bate com ele.
--  2. desconto_avaliar (alçada e piso do desconto) não somava custo_formulas: o vendedor
--     descontava abaixo do custo real sem chamar o gerente.
--  3. catalogo_adicionar_ao_orcamento regravava custo_estimado sem custo_formulas. O custo
--     estimado passa a ter UM dono, o gatilho tg_orcamento_soma_os_itens.
--  4. orcamento_aplicar_preco('cliente_final') voltava ao preço de tabela e apagava o preço
--     especial do cliente (produto_precos_cliente, #410). Agora o especial vence a tabela.
--  5. O gatilho do custo_formulas (a) não disparava quando só custo_formulas mudava (quem
--     tem orcamentos.create gravava o custo direto pela API), (b) arredondava a centavos
--     POR PEÇA e perdia o terceirizado "por pedido" em tiragem grande (R$ 100 em 30.000
--     peças virava R$ 0,00) e (c) tratava quantidade entre 0 e 1 como 1, divergindo da
--     tela (R$ 100 por pedido em 0,5 m ficava R$ 50 em vez de R$ 100).
--
-- Cada troca é feita sobre a definição VIVA (pg_get_functiondef) com âncora que precisa
-- aparecer exatamente uma vez: se outra sessão mexeu na função, a migração para em voz
-- alta em vez de sobrescrever. Rodar de novo é inofensivo (as trocas já feitas são puladas).

-- 1. O retrato do orçamento, sem custo ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.orcamento_itens_para_versao(p_orcamento uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT coalesce(jsonb_agg(
           (x.j - ARRAY['parametros', 'produto_snapshot', 'materiais_por_formula'])
             - coalesce((SELECT array_agg(k) FROM jsonb_object_keys(x.j) AS k WHERE k ~ '^(custo|margem)_'), ARRAY[]::text[])
           ORDER BY i.ordem, i.id), '[]'::jsonb)
    FROM public.orcamento_itens i
   CROSS JOIN LATERAL (SELECT to_jsonb(i) AS j) x
   WHERE i.orcamento_id = p_orcamento
$function$;
REVOKE ALL ON FUNCTION public.orcamento_itens_para_versao(uuid) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.orcamento_itens_para_versao(uuid) IS
  'Retrato dos itens para a versão congelada do orçamento: o que o cliente viu e quem vê preço pode ler. Tira toda chave custo_* e margem_* (também as colunas futuras), parametros, produto_snapshot e materiais_por_formula. Alimenta o hash da versão.';

-- Os retratos já gravados com custo_formulas e materiais_por_formula. O hash da versão é
-- md5(itens || '|' || valor_total); ele é refeito só onde a conta antiga bate com o hash
-- guardado, para a versão não virar "mudou" por causa da limpeza.
DO $limpa$
DECLARE
  v record;
  v_itens jsonb;
  v_chaves text[] := ARRAY['custo_formulas', 'materiais_por_formula'];
  v_com_hash integer := 0;
  v_sem_hash integer := 0;
  v_linhas integer;
BEGIN
  FOR v IN
    SELECT vs.id, vs.valor_total, vs.snapshot
      FROM public.orcamento_versoes vs
     WHERE jsonb_typeof(vs.snapshot->'itens') = 'array'
       AND EXISTS (SELECT 1 FROM jsonb_array_elements(vs.snapshot->'itens') e WHERE e ?| v_chaves)
  LOOP
    SELECT coalesce(jsonb_agg(e - v_chaves ORDER BY ord), '[]'::jsonb)
      INTO v_itens
      FROM jsonb_array_elements(v.snapshot->'itens') WITH ORDINALITY AS t(e, ord);
    IF md5((v.snapshot->'itens')::text || '|' || coalesce(v.valor_total::text, '0')) = v.snapshot->>'hash' THEN
      UPDATE public.orcamento_versoes
         SET snapshot = jsonb_set(
               jsonb_set(snapshot, '{itens}', v_itens),
               '{hash}', to_jsonb(md5(v_itens::text || '|' || coalesce(valor_total::text, '0'))))
       WHERE id = v.id;
      v_com_hash := v_com_hash + 1;
    ELSE
      UPDATE public.orcamento_versoes SET snapshot = jsonb_set(snapshot, '{itens}', v_itens) WHERE id = v.id;
      v_sem_hash := v_sem_hash + 1;
    END IF;
  END LOOP;

  UPDATE public.orcamento_versao_itens SET snapshot = snapshot - v_chaves WHERE snapshot ?| v_chaves;
  GET DIAGNOSTICS v_linhas = ROW_COUNT;
  RAISE NOTICE 'retratos limpos: % versões com hash refeito, % versões sem refazer o hash, % itens de versão', v_com_hash, v_sem_hash, v_linhas;
END $limpa$;

-- 2. desconto_avaliar soma o custo das fórmulas e dos terceirizados ---------------------
DO $m$
DECLARE
  v_def text := pg_get_functiondef('public.desconto_avaliar(uuid,numeric,numeric,numeric)'::regprocedure);
  v_de text[];
  v_para text[];
  k integer;
  n integer;
BEGIN
  IF position('r.custo_formulas' IN v_def) > 0 THEN
    RAISE NOTICE 'desconto_avaliar já soma custo_formulas';
    RETURN;
  END IF;
  v_de := ARRAY[
    $d$i.custo_previsto, i.area_cobrada,$d$,
    $d$  v_m numeric;$d$,
    $d$    IF v_c IS NULL THEN$d$
  ];
  v_para := ARRAY[
    $d$i.custo_previsto, i.area_cobrada, i.custo_formulas,$d$,
    E'  v_m numeric;\n  v_f numeric;',
    E'    -- Material por fórmula e terceirizados (custo_formulas, por peça) também são custo da linha:\n'
      || E'    -- sem eles o piso e a alçada saem menores que o custo real (revisão de 03/11/2026).\n'
      || E'    -- Só soma quando o custo-base da linha existe: linha sem custo-base continua "sem custo" e cai\n'
      || E'    -- no limite fixo de 10%, mais cauteloso que a margem calculada sobre um custo parcial.\n'
      || E'    v_f := COALESCE(r.custo_formulas, 0) * COALESCE(r.quantidade, 0);\n'
      || E'    IF v_f > 0 AND v_c IS NOT NULL THEN v_c := v_c + v_f; END IF;\n\n'
      || E'    IF v_c IS NULL THEN'
  ];
  FOR k IN 1..array_length(v_de, 1) LOOP
    n := (length(v_def) - length(replace(v_def, v_de[k], ''))) / length(v_de[k]);
    IF n <> 1 THEN
      RAISE EXCEPTION 'desconto_avaliar: âncora % apareceu % vezes (esperado 1)', k, n;
    END IF;
    v_def := replace(v_def, v_de[k], v_para[k]);
  END LOOP;
  EXECUTE v_def;
END $m$;

-- 3. O custo estimado tem um dono só: o gatilho tg_orcamento_soma_os_itens ----------------
DO $m$
DECLARE
  v_def text := pg_get_functiondef('public.catalogo_adicionar_ao_orcamento(uuid,text,numeric,uuid,uuid,text)'::regprocedure);
  v_novo text;
BEGIN
  IF position('custo_estimado' IN v_def) = 0 THEN
    RAISE NOTICE 'catalogo_adicionar_ao_orcamento já deixa o custo estimado para o gatilho';
    RETURN;
  END IF;
  v_novo := regexp_replace(v_def, ', custo_estimado = s\.custo', '');
  v_novo := regexp_replace(v_novo, 'AS total,\s*coalesce\(sum\(i\.custo_unitario \* i\.quantidade\), 0\) AS custo', 'AS total');
  v_novo := replace(v_novo,
    'custo estimado = Σ custo unitário × quantidade.',
    'o custo estimado é do gatilho tg_orcamento_soma_os_itens (custo + fórmulas).');
  IF v_novo = v_def OR position('custo_estimado' IN v_novo) > 0 OR position('AS custo' IN v_novo) > 0 THEN
    RAISE EXCEPTION 'catalogo_adicionar_ao_orcamento: o trecho do custo estimado mudou; troca não aplicada';
  END IF;
  EXECUTE v_novo;
END $m$;

-- 4. O preço especial do cliente vence a tabela também ao reprecificar o orçamento -------
DO $m$
DECLARE
  v_def text := pg_get_functiondef('public.orcamento_aplicar_preco(uuid,text,uuid)'::regprocedure);
  v_de text := $d$v_preco := i.preco_base;$d$;
  v_para text;
  n integer;
BEGIN
  IF position('produto_precos_cliente' IN v_def) > 0 THEN
    RAISE NOTICE 'orcamento_aplicar_preco já conhece o preço especial';
    RETURN;
  END IF;
  v_para := E'-- Fora do modo parceiro o preço combinado com este cliente vence a tabela, como na tela\n'
    || E'      -- (precoDoProdutoNoItem): voltar de parceiro para cliente final não apaga o acordo.\n'
    || E'      SELECT pc.preco INTO v_preco FROM public.produto_precos_cliente pc\n'
    || E'       WHERE pc.produto_id = i.produto_id AND pc.cliente_id = v_orc.cliente_id;\n'
    || E'      v_preco := COALESCE(v_preco, i.preco_base);';
  n := (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de);
  IF n <> 1 THEN
    RAISE EXCEPTION 'orcamento_aplicar_preco: âncora apareceu % vezes (esperado 1)', n;
  END IF;
  EXECUTE replace(v_def, v_de, v_para);
END $m$;

-- 5. O gatilho do custo das fórmulas ---------------------------------------------------------
-- (b) sem arredondar a centavos por peça: o total do item é custo_formulas × quantidade, e
-- R$ 100 por pedido em 30.000 peças são R$ 0,0033 por peça, não zero.
-- (c) por pedido divide pela quantidade como ela é; só quantidade vazia ou zero vale 1.
DO $m$
DECLARE
  v_def text := pg_get_functiondef('public.tg_orcamento_item_custo_das_formulas()'::regprocedure);
  v_de text[];
  v_para text[];
  k integer;
  n integer;
BEGIN
  IF position('GREATEST(COALESCE(NEW.quantidade, 1), 1)' IN v_def) = 0 THEN
    RAISE NOTICE 'tg_orcamento_item_custo_das_formulas já está corrigida';
    RETURN;
  END IF;
  v_de := ARRAY[
    $d$t.valor / GREATEST(COALESCE(NEW.quantidade, 1), 1)$d$,
    $d$NEW.custo_formulas := round(COALESCE(v_formulas, 0) + COALESCE(v_terceiros, 0), 2);$d$
  ];
  v_para := ARRAY[
    $d$t.valor / CASE WHEN COALESCE(NEW.quantidade, 0) > 0 THEN NEW.quantidade ELSE 1 END$d$,
    $d$NEW.custo_formulas := COALESCE(v_formulas, 0) + COALESCE(v_terceiros, 0);$d$
  ];
  FOR k IN 1..array_length(v_de, 1) LOOP
    n := (length(v_def) - length(replace(v_def, v_de[k], ''))) / length(v_de[k]);
    IF n <> 1 THEN
      RAISE EXCEPTION 'tg_orcamento_item_custo_das_formulas: âncora % apareceu % vezes (esperado 1)', k, n;
    END IF;
    v_def := replace(v_def, v_de[k], v_para[k]);
  END LOOP;
  EXECUTE v_def;
END $m$;
REVOKE ALL ON FUNCTION public.tg_orcamento_item_custo_das_formulas() FROM PUBLIC, anon, authenticated;

-- (a) O recálculo também dispara quando alguém grava custo_formulas direto: o gatilho
-- sempre sobrescreve o valor com a conta do banco.
DROP TRIGGER IF EXISTS tg_orcamento_itens_zz_custo_das_formulas ON public.orcamento_itens;
CREATE TRIGGER tg_orcamento_itens_zz_custo_das_formulas
  BEFORE INSERT OR UPDATE OF materiais_por_formula, produto_id, largura, altura, quantidade, custo_formulas
  ON public.orcamento_itens
  FOR EACH ROW EXECUTE FUNCTION public.tg_orcamento_item_custo_das_formulas();

COMMENT ON COLUMN public.orcamento_itens.custo_formulas IS
  'Custo POR PEÇA do material por fórmula mais os terceirizados do produto, sem arredondar a centavos (o total do item é custo_formulas × quantidade). Quem grava é o gatilho tg_orcamento_itens_zz_custo_das_formulas, que sobrescreve qualquer valor escrito direto. Sem SELECT para authenticated, como custo_unitario, e fora do retrato da versão.';
