-- =====================================================================================================
-- O ITEM QUE ENTRA NA OS PELA ABA "ITENS" NASCE COM O CUSTO DO PRODUTO (21/11/2026)
--
-- O defeito. O orçamento tem o gatilho tg_orcamento_item_custo_do_produto: item com produto e custo zerado nasce
-- com o custo do catálogo (por m² × a área da peça, ou o custo da unidade). O item da OS não tinha nada igual. A aba
-- "Itens" da OS grava o custo que a tela manda, e a tela só tem o custo quando quem inclui vê o financeiro: o
-- vendedor, que não vê custo, gravava 0. Item com custo 0 aparece com margem de 100 por cento na OS e no relatório
-- (OS 163 a 166, de outubro, ainda estão assim).
--
-- A correção. Gatilho BEFORE INSERT em itens_os com a MESMA regra do orçamento:
--   - só age se o item tem produto e o custo veio zerado (custo informado por quem vê custo nunca é mexido);
--   - produto sem custo cadastrado (custo_medio zero ou nulo): deixa como está (não inventa custo);
--   - produto vendido por m² com largura e altura: custo por m² × a área exata da peça (6 casas), com o mínimo
--     cobrado (o da linha, ou o do produto), a mesma área que o preço usa;
--   - qualquer outro: o custo da unidade do produto.
-- O gatilho só age em linha nova. As linhas que já existem sem custo, em OS ABERTA, são preenchidas uma vez, com a
-- mesma conta, no passo 3: eram 6 itens de 4 OS (163, 164, 165 e 166, as de outubro que ainda estão no quadro). Item de
-- OS encerrada ou de orçamento já convertido não é tocado: o custo daquela venda já foi apurado como foi.
--
-- A função é de gatilho: não precisa de EXECUTE para ninguém (o gatilho dispara pelo dono), então fecha para PUBLIC,
-- anon e authenticated na mesma migração, e a conferência final confere com has_function_privilege.
--
-- Ensaio no banco vivo, com RAISE EXCEPTION final: docs/ensaio-item-da-os-por-area-21-11-2026.md.
-- =====================================================================================================
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $guarda$
BEGIN
  IF to_regprocedure('public.tg_item_os_custo_do_produto()') IS NOT NULL THEN
    RAISE EXCEPTION 'tg_item_os_custo_do_produto já existe: releia antes de recriar';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.itens_os'::regclass AND tgname = 'tg_itens_os_zz_custo_do_produto') THEN
    RAISE EXCEPTION 'tg_itens_os_zz_custo_do_produto já existe: releia antes de recriar';
  END IF;
  IF to_regprocedure('public.tg_item_os_precificar_por_area()') IS NULL THEN
    RAISE EXCEPTION 'tg_item_os_precificar_por_area sumiu: a regra de preço da OS mudou';
  END IF;
END
$guarda$;

CREATE OR REPLACE FUNCTION public.tg_item_os_custo_do_produto()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_custo       numeric;
  v_unidade     text;
  v_area_minima numeric;
  v_area_peca   numeric;
BEGIN
  -- Custo já informado (por quem vê custo) ou item sem produto: nada a fazer.
  IF NEW.produto_id IS NULL OR COALESCE(NEW.custo_unitario, 0) <> 0 THEN
    RETURN NEW;
  END IF;

  SELECT p.custo_medio, p.unidade, p.area_minima_cobrada
    INTO v_custo, v_unidade, v_area_minima
    FROM public.produtos p
   WHERE p.id = NEW.produto_id;

  -- Produto sem custo cadastrado: não inventa.
  IF COALESCE(v_custo, 0) <= 0 THEN
    RETURN NEW;
  END IF;

  IF lower(btrim(COALESCE(v_unidade, ''))) IN ('m2', 'm²')
     AND COALESCE(NEW.largura, 0) > 0 AND COALESCE(NEW.altura, 0) > 0 THEN
    -- Vendido por área: custo por m² × a área exata da peça (a mesma que o preço usa), com o mínimo cobrado.
    v_area_peca := GREATEST(round(NEW.largura * NEW.altura, 6), COALESCE(NEW.area_minima, v_area_minima, 0));
    NEW.custo_unitario := round(v_custo * v_area_peca, 2);
  ELSE
    NEW.custo_unitario := v_custo;
  END IF;

  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.tg_item_os_custo_do_produto() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER tg_itens_os_zz_custo_do_produto
  BEFORE INSERT ON public.itens_os
  FOR EACH ROW EXECUTE FUNCTION public.tg_item_os_custo_do_produto();

-- ---------------------------------------------------------------------------------------------------
-- 3. Os itens de OS ABERTA que estão sem custo, tendo produto com custo cadastrado e medida: mesma conta do gatilho.
--    Para se o número de itens não for o medido (6): outro defeito, que esta migração não deve esconder.
--    O preço não muda (a regra do preço da OS guarda o valor gravado quando nenhuma entrada do preço muda).
-- ---------------------------------------------------------------------------------------------------
DO $preenche$
DECLARE
  c_esperado constant integer := 6;
  v_n integer;
  v_atualizados integer;
BEGIN
  SELECT count(*) INTO v_n
    FROM public.itens_os i
    JOIN public.produtos p ON p.id = i.produto_id
    JOIN public.ordens_servico os ON os.id = i.os_id
   WHERE COALESCE(i.custo_unitario, 0) = 0 AND COALESCE(p.custo_medio, 0) > 0
     AND lower(btrim(COALESCE(p.unidade, ''))) IN ('m2', 'm²')
     AND COALESCE(i.largura, 0) > 0 AND COALESCE(i.altura, 0) > 0
     AND os.status::text NOT IN ('concluido', 'faturado', 'cancelado');
  IF v_n <> c_esperado THEN
    RAISE EXCEPTION 'esperava % itens de OS aberta sem custo, achei %: releia antes de preencher', c_esperado, v_n;
  END IF;

  WITH feitos AS (
    UPDATE public.itens_os i
       SET custo_unitario = round(p.custo_medio * GREATEST(round(i.largura * i.altura, 6),
                                  COALESCE(i.area_minima, p.area_minima_cobrada, 0)), 2)
      FROM public.produtos p, public.ordens_servico os
     WHERE p.id = i.produto_id AND os.id = i.os_id
       AND COALESCE(i.custo_unitario, 0) = 0 AND COALESCE(p.custo_medio, 0) > 0
       AND lower(btrim(COALESCE(p.unidade, ''))) IN ('m2', 'm²')
       AND COALESCE(i.largura, 0) > 0 AND COALESCE(i.altura, 0) > 0
       AND os.status::text NOT IN ('concluido', 'faturado', 'cancelado')
    RETURNING i.os_id
  ), por_os AS (
    SELECT os_id, count(*) AS itens FROM feitos GROUP BY os_id
  )
  INSERT INTO public.logs_auditoria (usuario_id, entidade, entidade_id, acao, detalhes)
  SELECT NULL, 'ordens_servico', po.os_id, 'custo_do_item_preenchido',
         jsonb_build_object('numero', os.numero, 'itens', po.itens, 'migracao', '20261121130000')
    FROM por_os po JOIN public.ordens_servico os ON os.id = po.os_id;
  GET DIAGNOSTICS v_atualizados = ROW_COUNT;
  IF v_atualizados <> 4 THEN
    RAISE EXCEPTION 'esperava rastro em 4 OS, gravei %', v_atualizados;
  END IF;
END
$preenche$;

-- ---------------------------------------------------------------------------------------------------
-- Conferência final: gatilho ligado, função fechada, nenhum item de OS aberta por área sem custo.
-- ---------------------------------------------------------------------------------------------------
DO $final$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
     WHERE t.tgrelid = 'public.itens_os'::regclass AND t.tgname = 'tg_itens_os_zz_custo_do_produto'
       AND t.tgenabled = 'O' AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 'o gatilho de custo do item da OS não ficou ligado';
  END IF;
  IF has_function_privilege('anon', 'public.tg_item_os_custo_do_produto()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.tg_item_os_custo_do_produto()', 'EXECUTE')
     OR has_function_privilege('public', 'public.tg_item_os_custo_do_produto()', 'EXECUTE') THEN
    RAISE EXCEPTION 'a função de gatilho ficou aberta a anon, authenticated ou PUBLIC';
  END IF;
  IF NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = 'public.tg_item_os_custo_do_produto()'::regprocedure) THEN
    RAISE EXCEPTION 'a função de gatilho deveria ser SECURITY DEFINER (lê produtos)';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.itens_os i
      JOIN public.produtos p ON p.id = i.produto_id
      JOIN public.ordens_servico os ON os.id = i.os_id
     WHERE COALESCE(i.custo_unitario, 0) = 0 AND COALESCE(p.custo_medio, 0) > 0
       AND lower(btrim(COALESCE(p.unidade, ''))) IN ('m2', 'm²')
       AND COALESCE(i.largura, 0) > 0 AND COALESCE(i.altura, 0) > 0
       AND os.status::text NOT IN ('concluido', 'faturado', 'cancelado')
  ) THEN
    RAISE EXCEPTION 'ainda há item de OS aberta por área sem custo';
  END IF;
END
$final$;

COMMIT;

-- =====================================================================================================
-- DESFAZER:
--   DROP TRIGGER tg_itens_os_zz_custo_do_produto ON public.itens_os;
--   DROP FUNCTION public.tg_item_os_custo_do_produto();
--   (o custo preenchido nos 6 itens tem rastro em logs_auditoria, acao 'custo_do_item_preenchido'; para voltar,
--    custo_unitario = 0 nesses itens: ids por OS 163, 164, 165 e 166)
-- =====================================================================================================
