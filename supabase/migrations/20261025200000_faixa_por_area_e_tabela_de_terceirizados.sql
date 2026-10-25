-- Faixa por área e preços da tabela de terceirizados.
--
-- A tabela que a Bex manda aos parceiros no WhatsApp tem "acima de 6 m²: R$ 27,90/m²". O sistema
-- não tinha essa faixa e cobrava outros preços. Simulado em 24/10/2026 (docs/simulacao-balcao).
--
-- DECISÃO: a faixa é PROGRESSIVA e vale POR LINHA do orçamento.
--   * progressiva: os primeiros 6 m² saem ao preço cheio e só o que passa de 6 m² ao preço menor.
--     Desconto sobre a linha inteira fazia 6,02 m² custar R$ 11,44 a MENOS que 6,00 m².
--   * por linha: o preço fica na própria linha, não muda quando outra linha é editada e partir
--     um pedido em duas linhas nunca sai mais barato.
-- Só vale sobre o preço da tabela de parceiro (preco_m2 = produtos.preco_parceiro).
--
-- Preços: a tabela publicada é o que a Bex já cobra dos parceiros; o sistema passa a cobrar o mesmo.
-- ATENÇÃO (margem): adesivo TOP (R$ 29,90 / 27,90) e lona PROMO (R$ 26,90) ficam abaixo do piso
-- calculado pelo custo e pela margem mínima cadastrados. Ver docs/simulacao-balcao-2026-10-24.md.

DO $$
BEGIN
  IF md5(pg_get_functiondef('public.tg_item_precificar_por_area'::regproc))
       <> '1b877cb6545782a13f39f31270cafa44' THEN
    RAISE EXCEPTION 'tg_item_precificar_por_area mudou desde o ensaio desta migração; reensaiar antes de aplicar.';
  END IF;
END $$;

-- ── 1. Colunas ───────────────────────────────────────────────────────────
ALTER TABLE public.produtos
  ADD COLUMN IF NOT EXISTS preco_parceiro_acima numeric(12,2),
  ADD COLUMN IF NOT EXISTS acima_de_m2 numeric(12,3);

ALTER TABLE public.produtos DROP CONSTRAINT IF EXISTS produtos_faixa_por_area_ck;
ALTER TABLE public.produtos ADD CONSTRAINT produtos_faixa_por_area_ck CHECK (
  (preco_parceiro_acima IS NULL AND acima_de_m2 IS NULL)
  OR (preco_parceiro_acima IS NOT NULL AND acima_de_m2 IS NOT NULL
      AND acima_de_m2 > 0 AND preco_parceiro IS NOT NULL
      AND preco_parceiro_acima >= 0 AND preco_parceiro_acima <= preco_parceiro)
);

COMMENT ON COLUMN public.produtos.preco_parceiro_acima IS
  'R$/m² do que passa de acima_de_m2 na linha do orçamento, para o preço de tabela do parceiro. Progressivo: só o excedente ganha este preço.';
COMMENT ON COLUMN public.produtos.acima_de_m2 IS
  'Limite da faixa por área, em m² da LINHA (peça × quantidade).';

-- ── 2. Preço da linha ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_item_precificar_por_area()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_area_peca numeric;
  v_qtd numeric;
  v_preco_tabela numeric;
  v_preco_acima numeric;
  v_limite numeric;
  v_area_linha numeric;
  v_total_linha numeric;
BEGIN
  IF NEW.area_minima IS NULL AND NEW.produto_id IS NOT NULL THEN
    SELECT area_minima_cobrada INTO NEW.area_minima FROM public.produtos WHERE id=NEW.produto_id;
  END IF;
  v_total_linha := NULL;
  IF NEW.preco_m2 IS NOT NULL AND COALESCE(NEW.largura,0)>0 AND COALESCE(NEW.altura,0)>0 THEN
    v_area_peca := GREATEST(round(NEW.largura*NEW.altura,3), COALESCE(NEW.area_minima,0));
    NEW.valor_unitario := round(v_area_peca * NEW.preco_m2, 2);

    -- Faixa por área: só no preço de tabela do parceiro, e só quando a linha passa do limite.
    IF NEW.produto_id IS NOT NULL THEN
      SELECT preco_parceiro, preco_parceiro_acima, acima_de_m2
        INTO v_preco_tabela, v_preco_acima, v_limite
        FROM public.produtos WHERE id = NEW.produto_id;
      IF v_preco_acima IS NOT NULL AND NEW.preco_m2 = v_preco_tabela THEN
        v_qtd := GREATEST(COALESCE(NEW.quantidade,1),1);
        v_area_linha := v_area_peca * v_qtd;
        IF v_area_linha > v_limite THEN
          v_total_linha := round(v_limite * v_preco_tabela + (v_area_linha - v_limite) * v_preco_acima, 2);
          NEW.valor_unitario := round(v_total_linha / v_qtd, 4);
        END IF;
      END IF;
    END IF;
  END IF;
  NEW.valor_total := round(COALESCE(v_total_linha, COALESCE(NEW.valor_unitario,0) * GREATEST(COALESCE(NEW.quantidade,1),1))
    - COALESCE(NEW.desconto,0), 2);
  RETURN NEW;
END $function$;

-- ── 3. O que a tela do parceiro precisa saber ───────────────────────────
CREATE OR REPLACE FUNCTION public.parceiro_faixas_por_area()
RETURNS TABLE (produto_id uuid, acima_de_m2 numeric, preco_acima numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT p.id, p.acima_de_m2, p.preco_parceiro_acima
    FROM public.produtos p
   WHERE p.ativo AND p.preco_parceiro_acima IS NOT NULL
     AND public.parceiro_do_usuario() IS NOT NULL
$$;

REVOKE ALL ON FUNCTION public.parceiro_faixas_por_area() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.parceiro_faixas_por_area() TO authenticated;

-- ── 4. Preços da tabela de terceirizados (WhatsApp) ──────────────────────
-- Adesivo TOP = "Adesivo vinil branco impresso"; Lona PROMO = "Lona 280g impressa";
-- Lona TOP = "Lona 440g reforçada impressa". Banner: "a partir de R$ 37,90" vira o preço
-- fechado, com a área mínima de 1 m² do cadastro mantida.
UPDATE public.produtos SET preco_parceiro = 29.90, preco_parceiro_acima = 27.90, acima_de_m2 = 6
 WHERE id = 'aef1d1c9-5dbb-4860-bb80-818d64729464' AND nome = 'Adesivo vinil branco impresso';
UPDATE public.produtos SET preco_parceiro = 44.90, preco_parceiro_acima = 41.90, acima_de_m2 = 6
 WHERE id = '622d3846-6b63-432f-8ee2-c073e7373c16' AND nome = 'Adesivo vinil recortado';
UPDATE public.produtos SET preco_parceiro = 54.90, preco_parceiro_acima = 52.90, acima_de_m2 = 6
 WHERE id = '8834839e-f345-46dc-b864-10dfc0f4cc54' AND nome = 'Adesivo perfurado (one way)';
UPDATE public.produtos SET preco_parceiro = 37.90
 WHERE id = 'cb58f5d8-1eaf-4019-a84c-6b311d0cf9c3' AND nome = 'Banner com bastão e corda';
UPDATE public.produtos SET preco_parceiro = 26.90
 WHERE id = '2fcb2825-56b8-4e8b-a4f7-386cf3612e2c' AND nome = 'Lona 280g impressa';
UPDATE public.produtos SET preco_parceiro = 34.90, preco_parceiro_acima = 29.90, acima_de_m2 = 6
 WHERE id = 'b642e4a8-7fc0-4168-9ca6-697bfd5b985f' AND nome = 'Lona 440g reforçada impressa';

-- Os sete produtos "(comparação)" seguem inativos: a nota deles exige custo real antes de vender
-- (Adesivo PROMO, perfurado promocional, transparente, fosco, blackout, lona fosca e backlight).

NOTIFY pgrst, 'reload schema';
