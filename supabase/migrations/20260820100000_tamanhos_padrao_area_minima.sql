-- Tamanhos padrão por produto e área mínima cobrada.
--
-- Dois problemas distintos que se resolvem no mesmo lugar:
--
-- 1) Nenhuma das 24 colunas de `produtos` guardava dimensão. O vendedor digita
--    as medidas do zero toda vez, inclusive nas peças que a gráfica vende igual
--    todo dia (banner 0,80 × 1,20, faixa de rua 3,00 × 0,70). Digitação repetida
--    é onde entra erro de medida — e medida errada vira material cortado errado.
--
-- 2) Peça pequena sai abaixo do custo. Um adesivo de 0,20 × 0,30 é vendido por
--    0,06 m²: não paga o setup da máquina nem o refile. Cobrar uma área mínima é
--    prática padrão do setor e o sistema não tinha como expressar isso.
--
-- IMPORTANTE — a área mínima nasce VAZIA de propósito. Preencher com um número
-- chutado mudaria o preço de venda em silêncio, e esse número é decisão
-- comercial de quem vende, não minha. Enquanto ficar nulo, nada muda: a área
-- cobrada é igual à área real. Os TAMANHOS, esses sim, vêm preenchidos — são
-- atalho de digitação e não alteram preço por si.

-- ---------------------------------------------------------------------------
-- 1) Área mínima no produto
-- ---------------------------------------------------------------------------
ALTER TABLE public.produtos
  ADD COLUMN IF NOT EXISTS area_minima_cobrada numeric(10,3);

COMMENT ON COLUMN public.produtos.area_minima_cobrada IS
  'Área mínima faturada por peça, em m². Nulo = sem mínimo (cobra a área real).';

ALTER TABLE public.produtos
  DROP CONSTRAINT IF EXISTS produtos_area_minima_positiva;
ALTER TABLE public.produtos
  ADD CONSTRAINT produtos_area_minima_positiva
  CHECK (area_minima_cobrada IS NULL OR area_minima_cobrada > 0);

-- É preço de venda: fica fora das views e sem grant, como preco_m2.
-- Quem precisa exibir lê pela view financeira do produto.

-- ---------------------------------------------------------------------------
-- 2) Tamanhos padrão
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.produto_tamanhos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  produto_id uuid NOT NULL REFERENCES public.produtos(id) ON DELETE CASCADE,
  nome    text NOT NULL,
  largura numeric(10,3) NOT NULL CHECK (largura > 0),
  altura  numeric(10,3) NOT NULL CHECK (altura  > 0),
  padrao  boolean NOT NULL DEFAULT false,
  ordem   int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (produto_id, nome)
);

CREATE INDEX IF NOT EXISTS idx_produto_tamanhos_produto_id
  ON public.produto_tamanhos (produto_id);

-- Um só tamanho padrão por produto — é o que a tela pré-seleciona.
CREATE UNIQUE INDEX IF NOT EXISTS produto_tamanhos_um_padrao
  ON public.produto_tamanhos (produto_id) WHERE padrao;

ALTER TABLE public.produto_tamanhos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS produto_tamanhos_leitura ON public.produto_tamanhos;
CREATE POLICY produto_tamanhos_leitura ON public.produto_tamanhos
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS produto_tamanhos_escrita ON public.produto_tamanhos;
CREATE POLICY produto_tamanhos_escrita ON public.produto_tamanhos
  FOR ALL TO authenticated
  USING (has_permission((select auth.uid()), 'custos.manage'))
  WITH CHECK (has_permission((select auth.uid()), 'custos.manage'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.produto_tamanhos TO authenticated;

-- ---------------------------------------------------------------------------
-- 3) Área cobrada no item
-- ---------------------------------------------------------------------------
-- O mínimo mora no produto, mas coluna gerada só enxerga a própria linha. Por
-- isso o item guarda um SNAPSHOT do mínimo: além de viabilizar o cálculo, isso
-- preserva o que foi cobrado quando o produto mudar de regra amanhã.
ALTER TABLE public.orcamento_itens
  ADD COLUMN IF NOT EXISTS area_minima numeric(10,3);
ALTER TABLE public.itens_os
  ADD COLUMN IF NOT EXISTS area_minima numeric(10,3);

-- area_cobrada = a área que entra na conta, já com o mínimo por peça aplicado.
-- Fica ao lado de area_total (a área real) de propósito: dá para ver quanto se
-- está cobrando a mais por causa do mínimo.
ALTER TABLE public.orcamento_itens DROP COLUMN IF EXISTS area_cobrada;
ALTER TABLE public.orcamento_itens
  ADD COLUMN area_cobrada numeric(14,3) GENERATED ALWAYS AS (
    CASE WHEN COALESCE(largura, 0) > 0 AND COALESCE(altura, 0) > 0
         THEN round(
                GREATEST(round(largura * altura, 3), COALESCE(area_minima, 0))
                * GREATEST(COALESCE(quantidade, 1), 1), 3)
    END
  ) STORED;

ALTER TABLE public.itens_os DROP COLUMN IF EXISTS area_cobrada;
ALTER TABLE public.itens_os
  ADD COLUMN area_cobrada numeric(14,3) GENERATED ALWAYS AS (
    CASE WHEN COALESCE(largura, 0) > 0 AND COALESCE(altura, 0) > 0
         THEN round(
                GREATEST(round(largura * altura, 3), COALESCE(area_minima, 0))
                * GREATEST(COALESCE(quantidade, 1), 1), 3)
    END
  ) STORED;

-- ---------------------------------------------------------------------------
-- 4) Preço passa a respeitar o mínimo
-- ---------------------------------------------------------------------------
-- O trigger também busca o mínimo do produto quando o item vem de catálogo e
-- ainda não tem snapshot — assim a tela não precisa saber dessa regra.
CREATE OR REPLACE FUNCTION public.tg_item_precificar_por_area()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE v_area_peca numeric;
BEGIN
  IF NEW.area_minima IS NULL AND NEW.produto_id IS NOT NULL THEN
    SELECT area_minima_cobrada INTO NEW.area_minima
    FROM public.produtos WHERE id = NEW.produto_id;
  END IF;

  IF NEW.preco_m2 IS NOT NULL
     AND COALESCE(NEW.largura, 0) > 0
     AND COALESCE(NEW.altura, 0) > 0 THEN
    -- cobra pelo maior entre a área real da peça e o mínimo do produto
    v_area_peca := GREATEST(round(NEW.largura * NEW.altura, 3), COALESCE(NEW.area_minima, 0));
    NEW.valor_unitario := round(v_area_peca * NEW.preco_m2, 2);
  END IF;

  NEW.valor_total := round(
    COALESCE(NEW.valor_unitario, 0) * GREATEST(COALESCE(NEW.quantidade, 1), 1)
    - COALESCE(NEW.desconto, 0)
  , 2);

  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.tg_item_os_precificar_por_area()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE v_area_peca numeric;
BEGIN
  IF NEW.area_minima IS NULL AND NEW.produto_id IS NOT NULL THEN
    SELECT area_minima_cobrada INTO NEW.area_minima
    FROM public.produtos WHERE id = NEW.produto_id;
  END IF;

  IF NEW.preco_m2 IS NOT NULL
     AND COALESCE(NEW.largura, 0) > 0
     AND COALESCE(NEW.altura, 0) > 0 THEN
    v_area_peca := GREATEST(round(NEW.largura * NEW.altura, 3), COALESCE(NEW.area_minima, 0));
    NEW.valor_unitario := round(v_area_peca * NEW.preco_m2, 2);
  END IF;

  NEW.valor_total := round(
    COALESCE(NEW.valor_unitario, 0) * GREATEST(COALESCE(NEW.quantidade, 1), 1)
  , 2);

  RETURN NEW;
END $function$;

-- ---------------------------------------------------------------------------
-- 5) Grants e views (coluna nova em view security_invoker quebra a view inteira)
-- ---------------------------------------------------------------------------
GRANT SELECT (area_minima, area_cobrada) ON public.orcamento_itens TO authenticated;
GRANT SELECT (area_minima, area_cobrada) ON public.itens_os TO authenticated;

CREATE OR REPLACE VIEW public.orcamento_itens_operacional
WITH (security_invoker = true) AS
SELECT id, orcamento_id, descricao, quantidade, unidade, ordem, created_at,
       largura, altura, area_unitaria, area_total, acabamento, arquivo_id, produto_id,
       area_minima, area_cobrada
FROM public.orcamento_itens;

CREATE OR REPLACE VIEW public.itens_os_operacional
WITH (security_invoker = true) AS
SELECT id, os_id, descricao, quantidade, unidade, ordem, created_at, produto_id,
       largura, altura, area_unitaria, area_total, acabamento, arquivo_id,
       area_minima, area_cobrada
FROM public.itens_os;

CREATE OR REPLACE VIEW public.orcamento_itens_financeiro
WITH (security_invoker = true) AS
SELECT oi.id, oi.orcamento_id, oi.descricao, oi.quantidade, oi.unidade,
       oic.valor_unitario, oic.custo_unitario, oic.valor_total, oi.ordem, oi.created_at,
       oi.largura, oi.altura, oi.area_unitaria, oi.area_total,
       oi.acabamento, oi.arquivo_id, oi.produto_id, oi.area_minima, oi.area_cobrada
FROM public.orcamento_itens oi
LEFT JOIN public.orcamento_item_custos oic ON oic.orcamento_item_id = oi.id
WHERE can_see_financials((select auth.uid()));

CREATE OR REPLACE VIEW public.itens_os_financeiro
WITH (security_invoker = true) AS
SELECT io.id, io.os_id, io.descricao, io.quantidade, io.unidade,
       ioc.valor_unitario, ioc.custo_unitario, ioc.valor_total, io.ordem, io.created_at,
       io.largura, io.altura, io.area_unitaria, io.area_total,
       io.acabamento, io.arquivo_id, io.produto_id, io.area_minima, io.area_cobrada
FROM public.itens_os io
LEFT JOIN public.item_os_custos ioc ON ioc.item_os_id = io.id
WHERE can_see_financials((select auth.uid()));

-- ---------------------------------------------------------------------------
-- 6) Tamanhos comuns dos produtos vendidos por m²
-- ---------------------------------------------------------------------------
-- Atalho de digitação; não muda preço. Quem vende ajusta a lista.
INSERT INTO public.produto_tamanhos (produto_id, nome, largura, altura, padrao, ordem)
SELECT p.id, t.nome, t.largura, t.altura, t.padrao, t.ordem
FROM public.produtos p
JOIN LATERAL (VALUES
  ('Banner 0,80 × 1,20',   0.800, 1.200, true,  1),
  ('Banner 1,00 × 0,70',   1.000, 0.700, false, 2),
  ('Banner 2,00 × 1,00',   2.000, 1.000, false, 3),
  ('Faixa de rua 3,00 × 0,70', 3.000, 0.700, false, 4)
) AS t(nome, largura, altura, padrao, ordem) ON p.nome ILIKE 'Lona%'
ON CONFLICT (produto_id, nome) DO NOTHING;

INSERT INTO public.produto_tamanhos (produto_id, nome, largura, altura, padrao, ordem)
SELECT p.id, t.nome, t.largura, t.altura, t.padrao, t.ordem
FROM public.produtos p
JOIN LATERAL (VALUES
  ('Pequeno 0,30 × 0,30',  0.300, 0.300, false, 1),
  ('Médio 0,50 × 0,50',    0.500, 0.500, true,  2),
  ('Vitrine 1,00 × 1,00',  1.000, 1.000, false, 3),
  ('Vitrine larga 2,00 × 1,00', 2.000, 1.000, false, 4)
) AS t(nome, largura, altura, padrao, ordem) ON p.nome ILIKE 'Adesivo%'
ON CONFLICT (produto_id, nome) DO NOTHING;

INSERT INTO public.produto_tamanhos (produto_id, nome, largura, altura, padrao, ordem)
SELECT p.id, t.nome, t.largura, t.altura, t.padrao, t.ordem
FROM public.produtos p
JOIN LATERAL (VALUES
  ('Placa 0,50 × 0,30',    0.500, 0.300, true,  1),
  ('Placa 1,00 × 0,50',    1.000, 0.500, false, 2),
  ('Placa 2,00 × 1,00',    2.000, 1.000, false, 3)
) AS t(nome, largura, altura, padrao, ordem) ON p.nome ILIKE 'Placa%'
ON CONFLICT (produto_id, nome) DO NOTHING;
