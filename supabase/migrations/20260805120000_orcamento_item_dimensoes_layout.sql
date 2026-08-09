-- Venda por metro quadrado + layout no item.
--
-- Comunicação visual vende quase tudo por m² (adesivo, lona, vinil, ACM), mas o
-- item de orçamento só tinha quantidade × valor_unitario. As dimensões ficavam
-- fora do sistema: o vendedor calculava 3,000 × 2,450 na calculadora e digitava
-- o resultado. Sem as medidas gravadas, a produção não sabe o que cortar e o
-- preço não é auditável depois.
--
-- Também não havia como vincular a arte aprovada ao item. itens_os já tinha
-- arquivo_id, orcamento_itens não — então o layout que o cliente aprovou não
-- chegava à OS. Numa gráfica, imprimir a arte errada é material pago virando
-- refugo.
--
-- Referência de formato e de números: orçamento 1059 (adesivo starpac RP400),
-- 3,000m × 2,450m × 3un = 22,050m² e 1,100m × 0,400m = 0,440m²,
-- soma 22,490m², total R$ 792,43. Os mesmos valores estão fixados em
-- tests/orcamentos-area.test.ts.

-- ---------------------------------------------------------------------------
-- 1) Dimensões, acabamento, preço/m² e layout
-- ---------------------------------------------------------------------------
-- Metros com 3 casas (precisão de milímetro), que é como a operação mede.
ALTER TABLE public.orcamento_itens
  ADD COLUMN IF NOT EXISTS largura     numeric(10,3),
  ADD COLUMN IF NOT EXISTS altura      numeric(10,3),
  ADD COLUMN IF NOT EXISTS acabamento  text,
  ADD COLUMN IF NOT EXISTS preco_m2    numeric(12,2),
  ADD COLUMN IF NOT EXISTS arquivo_id  uuid;

ALTER TABLE public.itens_os
  ADD COLUMN IF NOT EXISTS largura     numeric(10,3),
  ADD COLUMN IF NOT EXISTS altura      numeric(10,3),
  ADD COLUMN IF NOT EXISTS acabamento  text,
  ADD COLUMN IF NOT EXISTS preco_m2    numeric(12,2);

-- Dimensão negativa não existe; zero é tratado como "não dimensionado".
ALTER TABLE public.orcamento_itens
  DROP CONSTRAINT IF EXISTS orcamento_itens_dimensoes_nao_negativas;
ALTER TABLE public.orcamento_itens
  ADD CONSTRAINT orcamento_itens_dimensoes_nao_negativas
  CHECK (COALESCE(largura, 0) >= 0 AND COALESCE(altura, 0) >= 0);

ALTER TABLE public.itens_os
  DROP CONSTRAINT IF EXISTS itens_os_dimensoes_nao_negativas;
ALTER TABLE public.itens_os
  ADD CONSTRAINT itens_os_dimensoes_nao_negativas
  CHECK (COALESCE(largura, 0) >= 0 AND COALESCE(altura, 0) >= 0);

-- O layout do item do orçamento aponta para o acervo de arquivos.
-- ON DELETE SET NULL: apagar o arquivo não pode apagar o item vendido.
ALTER TABLE public.orcamento_itens
  DROP CONSTRAINT IF EXISTS orcamento_itens_arquivo_id_fkey;
ALTER TABLE public.orcamento_itens
  ADD CONSTRAINT orcamento_itens_arquivo_id_fkey
  FOREIGN KEY (arquivo_id) REFERENCES public.arquivos(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_orcamento_itens_arquivo_id
  ON public.orcamento_itens (arquivo_id);

-- ---------------------------------------------------------------------------
-- 2) Área como coluna gerada
-- ---------------------------------------------------------------------------
-- Gerada, não calculada na aplicação: tela, PDF e produção leem o mesmo número,
-- e não há como gravar uma área que não corresponda às medidas.
--   area_unitaria = a peça          (largura × altura)
--   area_total    = o item inteiro  (× quantidade)
-- Quantidade 0 ou nula conta como 1 peça, igual a src/domain/orcamentos/area.ts.
ALTER TABLE public.orcamento_itens
  DROP COLUMN IF EXISTS area_unitaria,
  DROP COLUMN IF EXISTS area_total;
ALTER TABLE public.orcamento_itens
  ADD COLUMN area_unitaria numeric(14,3) GENERATED ALWAYS AS (
    CASE WHEN COALESCE(largura, 0) > 0 AND COALESCE(altura, 0) > 0
         THEN round(largura * altura, 3)
    END
  ) STORED,
  ADD COLUMN area_total numeric(14,3) GENERATED ALWAYS AS (
    CASE WHEN COALESCE(largura, 0) > 0 AND COALESCE(altura, 0) > 0
         THEN round(largura * altura * GREATEST(COALESCE(quantidade, 1), 1), 3)
    END
  ) STORED;

ALTER TABLE public.itens_os
  DROP COLUMN IF EXISTS area_unitaria,
  DROP COLUMN IF EXISTS area_total;
ALTER TABLE public.itens_os
  ADD COLUMN area_unitaria numeric(14,3) GENERATED ALWAYS AS (
    CASE WHEN COALESCE(largura, 0) > 0 AND COALESCE(altura, 0) > 0
         THEN round(largura * altura, 3)
    END
  ) STORED,
  ADD COLUMN area_total numeric(14,3) GENERATED ALWAYS AS (
    CASE WHEN COALESCE(largura, 0) > 0 AND COALESCE(altura, 0) > 0
         THEN round(largura * altura * GREATEST(COALESCE(quantidade, 1), 1), 3)
    END
  ) STORED;

-- ---------------------------------------------------------------------------
-- 3) Preço derivado da área, e valor_total sempre coerente
-- ---------------------------------------------------------------------------
-- Antes o valor_total vinha calculado no navegador (qtd × valor_unitario) e o
-- banco aceitava qualquer número. Passa a ser derivado aqui, então não há mais
-- como o total de um item divergir das suas parcelas.
--
-- Quando preco_m2 está preenchido num item dimensionado, o valor unitário é o
-- preço da PEÇA (área unitária × preço/m²) — a mesma regra
-- valor_total = valor_unitario × quantidade continua valendo para todo item.
CREATE OR REPLACE FUNCTION public.tg_item_precificar_por_area()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.preco_m2 IS NOT NULL
     AND COALESCE(NEW.largura, 0) > 0
     AND COALESCE(NEW.altura, 0) > 0 THEN
    NEW.valor_unitario := round(round(NEW.largura * NEW.altura, 3) * NEW.preco_m2, 2);
  END IF;

  NEW.valor_total := round(
    COALESCE(NEW.valor_unitario, 0) * GREATEST(COALESCE(NEW.quantidade, 1), 1)
    - COALESCE(NEW.desconto, 0)
  , 2);

  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS tg_orcamento_itens_precificar ON public.orcamento_itens;
CREATE TRIGGER tg_orcamento_itens_precificar
  BEFORE INSERT OR UPDATE ON public.orcamento_itens
  FOR EACH ROW EXECUTE FUNCTION public.tg_item_precificar_por_area();

-- itens_os não tem coluna desconto; usa a própria função com COALESCE(NULL,0).
CREATE OR REPLACE FUNCTION public.tg_item_os_precificar_por_area()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.preco_m2 IS NOT NULL
     AND COALESCE(NEW.largura, 0) > 0
     AND COALESCE(NEW.altura, 0) > 0 THEN
    NEW.valor_unitario := round(round(NEW.largura * NEW.altura, 3) * NEW.preco_m2, 2);
  END IF;

  NEW.valor_total := round(
    COALESCE(NEW.valor_unitario, 0) * GREATEST(COALESCE(NEW.quantidade, 1), 1)
  , 2);

  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS tg_itens_os_precificar ON public.itens_os;
CREATE TRIGGER tg_itens_os_precificar
  BEFORE INSERT OR UPDATE ON public.itens_os
  FOR EACH ROW EXECUTE FUNCTION public.tg_item_os_precificar_por_area();

-- ---------------------------------------------------------------------------
-- 4) Grants de coluna e views
-- ---------------------------------------------------------------------------
-- orcamento_itens e itens_os têm SELECT de tabela revogado para `authenticated`;
-- a leitura passa pelas views _operacional/_financeiro, que são
-- security_invoker. Coluna nova sem grant quebra a view inteira — foi o que
-- aconteceu com estoque_baixado e produto_id (ver PR #44). Dimensão, área,
-- acabamento e layout são dados de PRODUÇÃO, não de custo: vão para as duas
-- views. preco_m2 é preço de venda e fica apenas na financeira.
-- preco_m2 fica DE FORA das views e sem grant: é preço de venda, e o grant de
-- coluna vale para todo `authenticated`, então expor aqui furaria a proteção de
-- custo. Quem precisa do preço por m² deriva de valor_unitario ÷ area_unitaria
-- (precoM2Implicito em src/domain/orcamentos/area.ts).
GRANT SELECT (largura, altura, acabamento, arquivo_id, area_unitaria, area_total, produto_id)
  ON public.orcamento_itens TO authenticated;
GRANT SELECT (largura, altura, acabamento, arquivo_id, area_unitaria, area_total)
  ON public.itens_os TO authenticated;

-- CREATE OR REPLACE VIEW só aceita colunas NOVAS no fim da lista: a ordem
-- existente é preservada exatamente e as novas entram depois.
CREATE OR REPLACE VIEW public.orcamento_itens_operacional
WITH (security_invoker = true) AS
SELECT id, orcamento_id, descricao, quantidade, unidade, ordem, created_at,
       largura, altura, area_unitaria, area_total, acabamento, arquivo_id, produto_id
FROM public.orcamento_itens;

CREATE OR REPLACE VIEW public.itens_os_operacional
WITH (security_invoker = true) AS
SELECT id, os_id, descricao, quantidade, unidade, ordem, created_at, produto_id,
       largura, altura, area_unitaria, area_total, acabamento, arquivo_id
FROM public.itens_os;

CREATE OR REPLACE VIEW public.orcamento_itens_financeiro
WITH (security_invoker = true) AS
SELECT oi.id, oi.orcamento_id, oi.descricao, oi.quantidade, oi.unidade,
       oic.valor_unitario, oic.custo_unitario, oic.valor_total,
       oi.ordem, oi.created_at,
       oi.largura, oi.altura, oi.area_unitaria, oi.area_total,
       oi.acabamento, oi.arquivo_id, oi.produto_id
FROM public.orcamento_itens oi
LEFT JOIN public.orcamento_item_custos oic ON oic.orcamento_item_id = oi.id
WHERE can_see_financials((select auth.uid()));

CREATE OR REPLACE VIEW public.itens_os_financeiro
WITH (security_invoker = true) AS
SELECT io.id, io.os_id, io.descricao, io.quantidade, io.unidade,
       ioc.valor_unitario, ioc.custo_unitario, ioc.valor_total,
       io.ordem, io.created_at,
       io.largura, io.altura, io.area_unitaria, io.area_total,
       io.acabamento, io.arquivo_id, io.produto_id
FROM public.itens_os io
LEFT JOIN public.item_os_custos ioc ON ioc.item_os_id = io.id
WHERE can_see_financials((select auth.uid()));
