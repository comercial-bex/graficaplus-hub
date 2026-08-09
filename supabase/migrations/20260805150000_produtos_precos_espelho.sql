-- Produtos: tela e catálogo não abriam.
--
-- produtos tem o SELECT de tabela revogado para `authenticated` e apenas cinco
-- colunas reconcedidas (id, nome, descricao, ativo, created_at). A tela
-- /produtos e o ProdutoAutocomplete (o botão "Catálogo" do orçamento) fazem
-- select("*"), então falhavam com "permission denied for table produtos" —
-- verificado como authenticated. Resultado: 22 produtos cadastrados invisíveis,
-- e nenhum jeito de escolher produto ao montar um orçamento.
--
-- Corrige seguindo o padrão que o sistema já usa para OS e orçamento: os campos
-- de preço/custo vão para uma tabela-espelho com RLS can_see_financials, mantida
-- por trigger, e a view _financeiro os lê de lá. Assim ninguém precisa de grant
-- em coluna de custo na tabela base — que valeria para todo `authenticated` e
-- furaria a proteção.

-- ---------------------------------------------------------------------------
-- 1) Espelho de preços
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.produto_precos (
  produto_id      uuid PRIMARY KEY REFERENCES public.produtos(id) ON DELETE CASCADE,
  preco_base      numeric,
  custo_medio     numeric,
  margem_minima   numeric,
  margem_sugerida numeric,
  preco_minimo    numeric,
  preco_sugerido  numeric,
  preco_publico   numeric,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.produto_precos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS produto_precos_financeiro ON public.produto_precos;
CREATE POLICY produto_precos_financeiro ON public.produto_precos
  FOR ALL TO authenticated
  USING (can_see_financials((select auth.uid())))
  WITH CHECK (can_see_financials((select auth.uid())));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.produto_precos TO authenticated;

CREATE OR REPLACE FUNCTION public.tg_sync_produto_precos()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.produto_precos (
    produto_id, preco_base, custo_medio, margem_minima, margem_sugerida,
    preco_minimo, preco_sugerido, preco_publico, updated_at
  )
  VALUES (
    NEW.id, NEW.preco_base, NEW.custo_medio, NEW.margem_minima, NEW.margem_sugerida,
    NEW.preco_minimo, NEW.preco_sugerido, NEW.preco_publico, now()
  )
  ON CONFLICT (produto_id) DO UPDATE SET
    preco_base      = EXCLUDED.preco_base,
    custo_medio     = EXCLUDED.custo_medio,
    margem_minima   = EXCLUDED.margem_minima,
    margem_sugerida = EXCLUDED.margem_sugerida,
    preco_minimo    = EXCLUDED.preco_minimo,
    preco_sugerido  = EXCLUDED.preco_sugerido,
    preco_publico   = EXCLUDED.preco_publico,
    updated_at      = now();
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS tg_produtos_sync_precos ON public.produtos;
CREATE TRIGGER tg_produtos_sync_precos
  AFTER INSERT OR UPDATE ON public.produtos
  FOR EACH ROW EXECUTE FUNCTION public.tg_sync_produto_precos();

-- Backfill dos 22 produtos já cadastrados.
INSERT INTO public.produto_precos (
  produto_id, preco_base, custo_medio, margem_minima, margem_sugerida,
  preco_minimo, preco_sugerido, preco_publico, updated_at
)
SELECT id, preco_base, custo_medio, margem_minima, margem_sugerida,
       preco_minimo, preco_sugerido, preco_publico, now()
FROM public.produtos
ON CONFLICT (produto_id) DO UPDATE SET
  preco_base      = EXCLUDED.preco_base,
  custo_medio     = EXCLUDED.custo_medio,
  margem_minima   = EXCLUDED.margem_minima,
  margem_sugerida = EXCLUDED.margem_sugerida,
  preco_minimo    = EXCLUDED.preco_minimo,
  preco_sugerido  = EXCLUDED.preco_sugerido,
  preco_publico   = EXCLUDED.preco_publico,
  updated_at      = now();

-- ---------------------------------------------------------------------------
-- 2) Grant das colunas OPERACIONAIS que faltavam
-- ---------------------------------------------------------------------------
-- Nenhuma delas é preço ou custo: são cadastro e instruções de produção.
GRANT SELECT (
  sku, categoria, tipo, unidade, tempo_producao_min, imagem_url,
  observacoes_internas, updated_at, maquina_padrao_id, material_principal_id,
  exigencias, sugestoes_operacionais
) ON public.produtos TO authenticated;

-- ---------------------------------------------------------------------------
-- 3) Views
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.produtos_operacional
WITH (security_invoker = true) AS
SELECT id, nome, descricao, ativo, created_at,
       sku, categoria, tipo, unidade, tempo_producao_min, imagem_url,
       observacoes_internas, updated_at, maquina_padrao_id, material_principal_id,
       exigencias, sugestoes_operacionais
FROM public.produtos;

-- Existe agora (antes o helper apontava para uma view inexistente).
DROP VIEW IF EXISTS public.produtos_financeiro;
CREATE VIEW public.produtos_financeiro
WITH (security_invoker = true) AS
SELECT p.id, p.nome, p.descricao, p.ativo, p.created_at,
       p.sku, p.categoria, p.tipo, p.unidade, p.tempo_producao_min, p.imagem_url,
       p.observacoes_internas, p.updated_at, p.maquina_padrao_id, p.material_principal_id,
       p.exigencias, p.sugestoes_operacionais,
       pp.preco_base, pp.custo_medio, pp.margem_minima, pp.margem_sugerida,
       pp.preco_minimo, pp.preco_sugerido, pp.preco_publico
FROM public.produtos p
LEFT JOIN public.produto_precos pp ON pp.produto_id = p.id
WHERE can_see_financials((select auth.uid()));

GRANT SELECT ON public.produtos_operacional TO authenticated;
GRANT SELECT ON public.produtos_financeiro TO authenticated;
