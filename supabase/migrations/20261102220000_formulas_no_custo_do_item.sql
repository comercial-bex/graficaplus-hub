-- Fórmulas da pasta do produto entram no custo do item (fase 4 do plano de
-- 02/11/2026, como o Holdprint). Até aqui `produto_formulas` só era lida pela
-- pasta: "as fórmulas ainda não entram no custo do orçamento".
--
-- Como passa a funcionar:
--   1. A tela roda as fórmulas do produto na medida do item e grava, em
--      `orcamento_itens.materiais_por_formula`, uma lista [{material_id,
--      quantidade}] POR PEÇA. Só quantidade: quem não vê custo nunca recebe o
--      preço do material.
--   2. O gatilho `tg_orcamento_item_custo_das_formulas` (BEFORE) calcula
--      `custo_formulas` = soma(quantidade × custo de compra do material), com
--      o custo que o banco conhece (`materiais.custo_medio`, senão
--      `custo_unitario`). `custo_unitario` do item continua sendo o custo do
--      produto: os dois somam, nunca se misturam, e editar o item não conta
--      duas vezes.
--   3. O espelho `orcamento_item_custos` ganha `custo_formulas`; a view
--      financeira o expõe; o custo estimado do orçamento e a OS convertida
--      somam os dois.
--
-- Grants: `orcamento_itens` dá privilégio coluna a coluna (lição do #337).
-- `materiais_por_formula` ganha SELECT, INSERT e UPDATE para authenticated,
-- como `respostas`; `custo_formulas` NÃO ganha SELECT, como `custo_unitario`:
-- custo se lê pelo espelho, que a RLS limita a quem vê financeiro.

ALTER TABLE public.orcamento_itens
  ADD COLUMN IF NOT EXISTS materiais_por_formula jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.orcamento_itens
  ADD COLUMN IF NOT EXISTS custo_formulas numeric NOT NULL DEFAULT 0;
GRANT SELECT (materiais_por_formula), INSERT (materiais_por_formula), UPDATE (materiais_por_formula)
  ON public.orcamento_itens TO authenticated;

COMMENT ON COLUMN public.orcamento_itens.materiais_por_formula IS
  'Materiais que as fórmulas da pasta do produto calcularam para a medida do item, por peça: [{material_id, quantidade}]. A tela grava; o gatilho transforma em custo_formulas.';
COMMENT ON COLUMN public.orcamento_itens.custo_formulas IS
  'Custo por peça dos materiais de materiais_por_formula, pelo custo de compra do material. Soma-se a custo_unitario; nunca entra nele.';

ALTER TABLE public.orcamento_item_custos
  ADD COLUMN IF NOT EXISTS custo_formulas numeric NOT NULL DEFAULT 0;

-- 2. O custo das fórmulas, calculado pelo banco.
CREATE OR REPLACE FUNCTION public.tg_orcamento_item_custo_das_formulas()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_total numeric := 0;
BEGIN
  IF NEW.materiais_por_formula IS NULL
     OR jsonb_typeof(NEW.materiais_por_formula) <> 'array'
     OR jsonb_array_length(NEW.materiais_por_formula) = 0 THEN
    NEW.custo_formulas := 0;
    RETURN NEW;
  END IF;

  SELECT COALESCE(sum((e->>'quantidade')::numeric * COALESCE(m.custo_medio, m.custo_unitario, 0)), 0)
    INTO v_total
    FROM jsonb_array_elements(NEW.materiais_por_formula) e
    JOIN public.materiais m ON m.id = (e->>'material_id')::uuid
   WHERE (e->>'material_id') ~ '^[0-9a-fA-F-]{36}$'
     AND COALESCE((e->>'quantidade')::numeric, 0) > 0;

  NEW.custo_formulas := round(v_total, 2);
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS tg_orcamento_itens_zz_custo_das_formulas ON public.orcamento_itens;
CREATE TRIGGER tg_orcamento_itens_zz_custo_das_formulas
  BEFORE INSERT OR UPDATE OF materiais_por_formula ON public.orcamento_itens
  FOR EACH ROW EXECUTE FUNCTION public.tg_orcamento_item_custo_das_formulas();

-- 3a. O espelho leva o custo das fórmulas junto.
CREATE OR REPLACE FUNCTION public.tg_sync_orcamento_item_custos()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.orcamento_item_custos (orcamento_item_id, valor_unitario, custo_unitario, custo_formulas, valor_total, updated_at)
  VALUES (NEW.id, NEW.valor_unitario, NEW.custo_unitario, COALESCE(NEW.custo_formulas, 0), NEW.valor_total, now())
  ON CONFLICT (orcamento_item_id) DO UPDATE SET
    valor_unitario = EXCLUDED.valor_unitario,
    custo_unitario = EXCLUDED.custo_unitario,
    custo_formulas = EXCLUDED.custo_formulas,
    valor_total = EXCLUDED.valor_total,
    updated_at = now();
  RETURN NEW;
END
$function$;

-- 3b. A view financeira expõe o custo das fórmulas (coluna nova no fim; as opções
-- são restabelecidas porque CREATE OR REPLACE VIEW as descarta).
CREATE OR REPLACE VIEW public.orcamento_itens_financeiro
WITH (security_invoker = true) AS
 SELECT oi.id,
    oi.orcamento_id,
    oi.descricao,
    oi.quantidade,
    oi.unidade,
    oic.valor_unitario,
    oic.custo_unitario,
    oic.valor_total,
    oi.ordem,
    oi.created_at,
    oi.largura,
    oi.altura,
    oi.area_unitaria,
    oi.area_total,
    oi.acabamento,
    oi.arquivo_id,
    oi.produto_id,
    oi.area_minima,
    oi.area_cobrada,
    oi.tipo_produto,
    oi.especificacao,
    oi.respostas,
    oi.gerado_por_item_id,
    oic.custo_formulas
   FROM public.orcamento_itens oi
     LEFT JOIN public.orcamento_item_custos oic ON oic.orcamento_item_id = oi.id
  WHERE public.can_see_financials(( SELECT auth.uid() AS uid));

-- 3c. O custo estimado do orçamento soma os dois.
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
  -- 02/11/2026: o custo do item e o do produto mais o das formulas da pasta.
  UPDATE public.orcamentos o
     SET valor_subtotal = COALESCE((SELECT sum(i.valor_total) FROM public.orcamento_itens i
                                     WHERE i.orcamento_id = v_orc), 0),
         custo_estimado = COALESCE((SELECT sum((COALESCE(i.custo_unitario, 0) + COALESCE(i.custo_formulas, 0)) * COALESCE(i.quantidade, 0))
                                      FROM public.orcamento_itens i WHERE i.orcamento_id = v_orc), 0),
         updated_at = now()
   WHERE o.id = v_orc;
  RETURN NULL;
END
$function$;

-- Função de gatilho nasce fechada: ninguém a chama pela API.
REVOKE ALL ON FUNCTION public.tg_orcamento_item_custo_das_formulas() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_sync_orcamento_item_custos() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_orcamento_soma_os_itens() FROM PUBLIC, anon, authenticated;

-- 3d. A OS convertida leva o custo cheio do item (produto + fórmulas) em
-- itens_os.custo_unitario. Troca na definição viva: a função é longa e muda
-- com frequência; reescrevê-la inteira aqui congelaria uma versão velha.
DO $$
DECLARE
  v_def text;
  v_antes text := E'valor_unitario, custo_unitario, ordem, produto_snapshot, parametros,\n    largura, altura, acabamento, preco_m2, arquivo_id\n  FROM public.orcamento_itens';
  v_depois text := E'valor_unitario, custo_unitario + COALESCE(custo_formulas, 0), ordem, produto_snapshot, parametros,\n    largura, altura, acabamento, preco_m2, arquivo_id\n  FROM public.orcamento_itens';
BEGIN
  SELECT pg_get_functiondef('public.converter_orcamento_em_os(uuid, jsonb)'::regprocedure) INTO v_def;
  IF position(v_depois IN v_def) > 0 THEN
    RAISE NOTICE 'converter_orcamento_em_os já soma custo_formulas';
    RETURN;
  END IF;
  IF (length(v_def) - length(replace(v_def, v_antes, ''))) / length(v_antes) <> 1 THEN
    RAISE EXCEPTION 'converter_orcamento_em_os: o trecho do INSERT em itens_os não foi encontrado uma vez só; conferir a função antes de trocar';
  END IF;
  EXECUTE replace(v_def, v_antes, v_depois);
END $$;
