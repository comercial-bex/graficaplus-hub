-- O custo do item vem do produto, não de quem digita (19/10/2026).
--
-- Achado: das 9 OS abertas, quatro estavam sem custo previsto — três com venda
-- (#163 faixa banner R$ 1.050, #165 acrílico R$ 680, #166 banner R$ 38,40) e a
-- #49, vazia. A causa não era descuido na OS: era de ORIGEM.
--
--   O orçamento guarda o custo do item (`custo_unitario`) na hora em que o
--   produto é escolhido, e o catálogo da tela entrega o custo só a quem vê
--   custo. O vendedor (Leonardo) não vê: grava 0 — e o `custo_estimado` do
--   orçamento, que a tela só escreve quando quem edita vê custo, fica 0 também.
--   `converter_orcamento_em_os` leva esse custo para a OS. Conferido em
--   19/10/2026: todo orçamento do Leonardo com produto tinha item de custo 0
--   (orçamentos 55, 61, 65, 67, 78, 82…); os do Yvens, nenhum.
--   Um segundo caminho: item digitado em texto livre, sem produto, nasce sem
--   custo para qualquer um (#163 e #166).
--
-- O que muda:
--   1. Gatilho em orcamento_itens: item com produto e custo 0 recebe o custo do
--      cadastro do produto — por PEÇA (custo por m² × a área da peça, com a
--      área mínima, a mesma conta do preço), ou o custo médio quando não é por
--      área. Custo digitado por quem vê custo não é tocado.
--   2. O `custo_estimado` do orçamento passa a ser a soma dos itens, no banco,
--      como o subtotal já era (o cabeçalho era escrito só pela tela).
--   3. As três OS ganham o custo que a venda nunca teve (ver seção 3).
--   4. Pendência "OS abertas com venda e sem custo previsto": pega o que o
--      gatilho não alcança (item em texto livre, produto sem custo cadastrado).

-- 1. O custo do item sai do produto ------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_orcamento_item_custo_do_produto()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_custo numeric;
  v_area_minima numeric;
  v_area_peca numeric;
BEGIN
  -- Custo já informado (por quem vê custo) ou item sem produto: nada a fazer.
  IF NEW.produto_id IS NULL OR COALESCE(NEW.custo_unitario, 0) <> 0 THEN
    RETURN NEW;
  END IF;

  SELECT p.custo_medio, p.area_minima_cobrada INTO v_custo, v_area_minima
    FROM public.produtos p WHERE p.id = NEW.produto_id;
  IF COALESCE(v_custo, 0) <= 0 THEN
    RETURN NEW;
  END IF;

  IF NEW.preco_m2 IS NOT NULL AND COALESCE(NEW.largura, 0) > 0 AND COALESCE(NEW.altura, 0) > 0 THEN
    -- Vendido por área: custo por m² × a área da peça (a mesma que o preço usa).
    v_area_peca := GREATEST(round(NEW.largura * NEW.altura, 3), COALESCE(NEW.area_minima, v_area_minima, 0));
    NEW.custo_unitario := round(v_custo * v_area_peca, 2);
  ELSE
    NEW.custo_unitario := v_custo;
  END IF;
  RETURN NEW;
END $function$;
COMMENT ON FUNCTION public.tg_orcamento_item_custo_do_produto() IS
  'Item de orçamento com produto e custo 0 recebe o custo do cadastro do produto (por peça, quando vendido por área). Quem monta o orçamento sem ver custo gravava 0 e a OS nascia sem custo previsto.';
-- Gatilho nasce aberto para o público: fecha.
REVOKE ALL ON FUNCTION public.tg_orcamento_item_custo_do_produto() FROM PUBLIC, anon, authenticated;

-- "zz": roda DEPOIS de tg_orcamento_itens_precificar, que preenche area_minima.
DROP TRIGGER IF EXISTS tg_orcamento_itens_zz_custo_do_produto ON public.orcamento_itens;
CREATE TRIGGER tg_orcamento_itens_zz_custo_do_produto
  BEFORE INSERT OR UPDATE ON public.orcamento_itens
  FOR EACH ROW EXECUTE FUNCTION public.tg_orcamento_item_custo_do_produto();

-- 2. O custo estimado do orçamento acompanha os itens ----------------------------------
CREATE OR REPLACE FUNCTION public.tg_orcamento_soma_os_itens()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_orc uuid;
BEGIN
  v_orc := COALESCE(NEW.orcamento_id, OLD.orcamento_id);
  IF v_orc IS NULL THEN RETURN NULL; END IF;

  -- O total do cabecalho era escrito SO pela tela, em JavaScript. Quem grava
  -- item por outro caminho — importacao, editor do parceiro, API — deixava o
  -- cabecalho parado, e `converter_orcamento_em_os` le o CABECALHO. Aqui o
  -- subtotal acompanha a soma; total, desconto e credito saem do gatilho de
  -- totais (tg_parceiro_credito_no_total), que roda neste UPDATE.
  --
  -- O custo estimado tambem (19/10/2026): a tela so o gravava quando quem editava
  -- via custo, entao orcamento montado por vendedor ficava com custo 0 e a OS
  -- nascia sem custo previsto. Mesma conta da tela: custo do item x quantidade.
  UPDATE public.orcamentos o
     SET valor_subtotal = COALESCE((SELECT sum(i.valor_total) FROM public.orcamento_itens i
                                     WHERE i.orcamento_id = v_orc), 0),
         custo_estimado = COALESCE((SELECT sum(COALESCE(i.custo_unitario, 0) * COALESCE(i.quantidade, 0))
                                      FROM public.orcamento_itens i WHERE i.orcamento_id = v_orc), 0),
         updated_at = now()
   WHERE o.id = v_orc;
  RETURN NULL;
END $function$;

DROP TRIGGER IF EXISTS tg_orcamento_soma_os_itens ON public.orcamento_itens;
CREATE TRIGGER tg_orcamento_soma_os_itens
  AFTER INSERT OR DELETE OR UPDATE OF valor_total, quantidade, valor_unitario, desconto, custo_unitario
  ON public.orcamento_itens
  FOR EACH ROW EXECUTE FUNCTION public.tg_orcamento_soma_os_itens();

-- 3. As três OS que já nasceram sem custo ---------------------------------------------------
-- #166 e #163: o item foi digitado em texto livre. Liga ao produto que o preço
-- já indica (R$ 40/m² é exatamente o "Banner com bastão e corda (Terceirizado)";
-- R$ 70/m² é a "Lona 440g reforçada impressa") — confirmado pelo dono em
-- 19/10/2026. `area_minima = 0` explícito: NULL faria o gatilho de preço copiar
-- a área mínima do produto e subir o preço de R$ 38,40 para R$ 40,00 numa OS que
-- o cliente já pagou (o ensaio pegou). O que foi vendido não muda.
-- #165: o produto não tem ficha técnica; vale o custo médio do cadastro, por m²,
-- na área cobrada — a mesma regra do chaveiro. O Yvens deve conferir a ficha e o
-- material principal do produto (hoje aponta para "Acrilico esp dourado 2mm").
-- Idempotente e sem efeito onde a OS não existe.
DO $dados$
DECLARE r record;
BEGIN
  UPDATE public.itens_os i SET produto_id = p.id, area_minima = 0
    FROM public.ordens_servico os, public.produtos p
   WHERE os.id = i.os_id AND os.numero = 166 AND i.produto_id IS NULL
     AND p.nome = 'Banner com bastão e corda (Terceirizado)';
  UPDATE public.itens_os i SET produto_id = p.id, area_minima = 0
    FROM public.ordens_servico os, public.produtos p
   WHERE os.id = i.os_id AND os.numero = 163 AND i.produto_id IS NULL
     AND p.nome = 'Lona 440g reforçada impressa';

  FOR r IN SELECT id FROM public.ordens_servico WHERE numero IN (163, 166) LOOP
    PERFORM public.gerar_materiais_previstos_os(r.id);
  END LOOP;

  UPDATE public.ordens_servico o SET custo_previsto = sub.total
    FROM (SELECT p.os_id, sum(p.quantidade * COALESCE(p.custo_unitario_previsto, 0)) AS total
            FROM public.os_materiais_previstos p GROUP BY p.os_id) sub
   WHERE o.id = sub.os_id AND o.numero IN (163, 166) AND COALESCE(o.custo_previsto, 0) = 0
     AND o.status::text NOT IN ('concluido', 'faturado', 'cancelado');

  UPDATE public.ordens_servico o SET custo_previsto = sub.total
    FROM (SELECT i.os_id,
                 round(sum(COALESCE(p.custo_medio, 0) * public.base_de_consumo_item(i.area_cobrada, i.quantidade)), 2) AS total
            FROM public.itens_os i JOIN public.produtos p ON p.id = i.produto_id GROUP BY i.os_id) sub
   WHERE o.id = sub.os_id AND o.numero = 165 AND COALESCE(o.custo_previsto, 0) = 0 AND sub.total > 0
     AND o.status::text NOT IN ('concluido', 'faturado', 'cancelado');
END
$dados$;

-- 4. Pendência: OS aberta com venda e sem custo previsto ------------------------------------
-- Pega o que o gatilho não alcança: item em texto livre e produto sem custo no
-- cadastro. Só a contagem e os números das OS — nenhum valor.
DO $pend$
DECLARE
  v_def text := pg_get_functiondef('public.pendencias_do_sistema()'::regprocedure);
  v_de text := E'\n\n  -- Portal do cliente: o que o cliente mandou';
  v_para text := E'\n\n'
    || E'  -- OS aberta com venda e sem custo previsto (19/10/2026): a margem e o reembolso\n'
    || E'  -- ficam sem referência até alguém ligar o item a um produto ou completar o custo.\n'
    || E'  RETURN QUERY SELECT ''os_sem_custo_previsto'', ''Ordens abertas com venda e sem custo previsto'', count(*)::int,\n'
    || E'    NULL::int, ''atencao'', ''gestao'',\n'
    || E'    ''OS '' || string_agg(''nº '' || o.numero, '', '' ORDER BY o.numero) || ''. Ligue o item a um produto (ou complete o custo do produto) para a margem e o reembolso terem referência.'',\n'
    || E'    ''/os''\n'
    || E'  FROM public.ordens_servico o\n'
    || E'  WHERE o.status::text NOT IN (''concluido'', ''faturado'', ''cancelado'')\n'
    || E'    AND COALESCE(o.valor_total, 0) > 0 AND COALESCE(o.custo_previsto, 0) <= 0\n'
    || E'    AND NOT EXISTS (SELECT 1 FROM public.os_materiais_previstos m WHERE m.os_id = o.id)\n'
    || E'  HAVING count(*) > 0;\n'
    || E'\n  -- Portal do cliente: o que o cliente mandou';
BEGIN
  IF position('os_sem_custo_previsto' IN v_def) > 0 THEN RETURN; END IF;
  IF (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de) <> 1 THEN
    RAISE EXCEPTION 'pendencias_do_sistema: o trecho do portal não está como esperado; revise a troca';
  END IF;
  EXECUTE replace(v_def, v_de, v_para);
END
$pend$;
