-- Terceirizados do produto (fase 3 do plano de 02/11/2026, como o "Insira os
-- terceirizados deste produto" do Holdprint): o que a gráfica paga a um
-- terceiro para fazer este produto (corte a laser fora, acabamento, frete do
-- fornecedor). Cada linha tem um valor e uma base: por peça, por m² da peça
-- ou por pedido (dividido entre as peças).
--
-- O custo entra no item pelo mesmo caminho do material por fórmula
-- (`orcamento_itens.custo_formulas`, migração 20261102220000): o gatilho soma
-- os terceirizados do produto na medida e na quantidade do item, e o espelho,
-- a view financeira, o custo estimado e a OS convertida já somam essa coluna.
--
-- Leitura: valor de terceirizado é custo. Quem vê custo (custos.read ou
-- financeiro.read) lê; administrador e gestor gravam. Quem não vê custo não
-- precisa ler: o gatilho roda como definer.

CREATE TABLE IF NOT EXISTS public.produto_terceirizados (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  produto_id uuid NOT NULL REFERENCES public.produtos(id) ON DELETE CASCADE,
  descricao text NOT NULL CHECK (btrim(descricao) <> ''),
  fornecedor_id uuid NULL REFERENCES public.fornecedores(id) ON DELETE SET NULL,
  valor numeric NOT NULL CHECK (valor >= 0),
  base text NOT NULL DEFAULT 'peca' CHECK (base IN ('peca', 'm2', 'pedido')),
  observacao text NULL,
  ordem integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS produto_terceirizados_produto_idx ON public.produto_terceirizados (produto_id);

COMMENT ON TABLE public.produto_terceirizados IS
  'O que a gráfica paga a terceiros para fazer o produto. valor por peça, por m² da peça ou por pedido; entra em orcamento_itens.custo_formulas pelo gatilho.';

ALTER TABLE public.produto_terceirizados ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "produto_terceirizados quem ve custo le" ON public.produto_terceirizados;
CREATE POLICY "produto_terceirizados quem ve custo le" ON public.produto_terceirizados
  FOR SELECT TO authenticated
  USING (
    public.has_permission((select auth.uid()), 'custos.read')
    OR public.has_permission((select auth.uid()), 'financeiro.read')
    OR public.has_role((select auth.uid()), 'admin'::public.app_role)
    OR public.has_role((select auth.uid()), 'gestor'::public.app_role)
  );

DROP POLICY IF EXISTS "produto_terceirizados admin escreve" ON public.produto_terceirizados;
CREATE POLICY "produto_terceirizados admin escreve" ON public.produto_terceirizados
  FOR ALL TO authenticated
  USING (
    public.has_role((select auth.uid()), 'admin'::public.app_role)
    OR public.has_role((select auth.uid()), 'gestor'::public.app_role)
  )
  WITH CHECK (
    public.has_role((select auth.uid()), 'admin'::public.app_role)
    OR public.has_role((select auth.uid()), 'gestor'::public.app_role)
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.produto_terceirizados TO authenticated;
REVOKE ALL ON public.produto_terceirizados FROM anon;

-- O gatilho do item: material por fórmula (enviado pela tela, por peça) mais os
-- terceirizados do produto, na medida e na quantidade do item.
CREATE OR REPLACE FUNCTION public.tg_orcamento_item_custo_das_formulas()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_formulas numeric := 0;
  v_terceiros numeric := 0;
BEGIN
  IF NEW.materiais_por_formula IS NOT NULL
     AND jsonb_typeof(NEW.materiais_por_formula) = 'array'
     AND jsonb_array_length(NEW.materiais_por_formula) > 0 THEN
    SELECT COALESCE(sum((e->>'quantidade')::numeric * COALESCE(m.custo_medio, m.custo_unitario, 0)), 0)
      INTO v_formulas
      FROM jsonb_array_elements(NEW.materiais_por_formula) e
      JOIN public.materiais m ON m.id = (e->>'material_id')::uuid
     WHERE (e->>'material_id') ~ '^[0-9a-fA-F-]{36}$'
       AND COALESCE((e->>'quantidade')::numeric, 0) > 0;
  END IF;

  IF NEW.produto_id IS NOT NULL THEN
    SELECT COALESCE(sum(
             CASE t.base
               WHEN 'm2' THEN t.valor * GREATEST(COALESCE(NEW.largura, 0) * COALESCE(NEW.altura, 0), 0)
               WHEN 'pedido' THEN t.valor / GREATEST(COALESCE(NEW.quantidade, 1), 1)
               ELSE t.valor
             END), 0)
      INTO v_terceiros
      FROM public.produto_terceirizados t
     WHERE t.produto_id = NEW.produto_id AND t.valor > 0;
  END IF;

  NEW.custo_formulas := round(COALESCE(v_formulas, 0) + COALESCE(v_terceiros, 0), 2);
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.tg_orcamento_item_custo_das_formulas() FROM PUBLIC, anon, authenticated;

-- Terceirizado depende do produto, da medida e da quantidade: o gatilho roda quando qualquer um muda.
DROP TRIGGER IF EXISTS tg_orcamento_itens_zz_custo_das_formulas ON public.orcamento_itens;
CREATE TRIGGER tg_orcamento_itens_zz_custo_das_formulas
  BEFORE INSERT OR UPDATE OF materiais_por_formula, produto_id, largura, altura, quantidade ON public.orcamento_itens
  FOR EACH ROW EXECUTE FUNCTION public.tg_orcamento_item_custo_das_formulas();

-- O espelho e a soma do orçamento liam só mudanças de valor e custo digitados:
-- custo_formulas muda por dentro (gatilho BEFORE) quando a medida, a quantidade
-- ou o produto mudam, e o espelho ficava com o número velho (ensaio de 02/11:
-- 69,20 no espelho com 64,20 no item). Agora o espelho acompanha qualquer
-- UPDATE, e a soma do orçamento também roda quando medida e produto mudam.
DROP TRIGGER IF EXISTS tg_sync_orcamento_item_custos ON public.orcamento_itens;
CREATE TRIGGER tg_sync_orcamento_item_custos
  AFTER INSERT OR UPDATE ON public.orcamento_itens
  FOR EACH ROW EXECUTE FUNCTION public.tg_sync_orcamento_item_custos();

DROP TRIGGER IF EXISTS tg_orcamento_soma_os_itens ON public.orcamento_itens;
CREATE TRIGGER tg_orcamento_soma_os_itens
  AFTER INSERT OR DELETE OR UPDATE OF valor_total, quantidade, valor_unitario, desconto, custo_unitario, custo_formulas, materiais_por_formula, largura, altura, produto_id ON public.orcamento_itens
  FOR EACH ROW EXECUTE FUNCTION public.tg_orcamento_soma_os_itens();

COMMENT ON COLUMN public.orcamento_itens.custo_formulas IS
  'Custo por peça do material por fórmula (materiais_por_formula × custo de compra) mais os terceirizados do produto (produto_terceirizados, na medida e quantidade do item). Soma-se a custo_unitario; nunca entra nele.';
