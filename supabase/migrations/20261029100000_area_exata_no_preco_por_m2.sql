-- 29/10/2026 — a área da PEÇA entra exata na conta do preço por m² (auditoria orçamento a orçamento).
--
-- Os três gatilhos arredondavam a área da peça em 3 casas antes de multiplicar pelo preço:
-- `round(largura * altura, 3)`. 0,001 m² é um quadrado de 10 × 10 cm — para banner e lona não
-- muda nada, mas adesivo é vendido aos centímetros:
--   - 5 × 5 cm = 0,0025 m² virava 0,003: +20% (orçamento 115: 120 adesivos a R$ 30/m² saíram por
--     R$ 10,80 em vez de R$ 9,00);
--   - 6 × 6 cm (0,0036 → 0,004) +11%; 11 × 7 cm (0,0077 → 0,008) +4%;
--   - abaixo de 2,2 × 2,2 cm a área virava 0,000 e o preço ZERO.
-- Medido nos 80 itens de orçamento da casa: R$ 4,30 de diferença no total — pequeno em dinheiro,
-- mas é a conta que vai no PDF, e quem orça mil adesivos de 3 cm cai no zero.
--
-- O que muda:
--   1. a área da peça fica com 6 casas (o mm²), com o mínimo por peça como antes;
--   2. o TOTAL da linha sai da área exata × peças × preço/m², arredondado uma vez, em centavos
--      (a faixa de parceiro acima de X m² continua a mesma);
--   3. o unitário, que a coluna guarda em centavos (numeric 12,2 — as views comercial/financeira/
--      operacional dependem dela, não se mexe no tipo), é o total ÷ peças. Em peça miúda ele não
--      reproduz o total (R$ 0,075 → R$ 0,08): o total manda, e o PDF escreve o unitário com as
--      casas que faltam (`dinheiroDaUnidade`).
--   4. o custo da peça (custo/m² × área) usa a mesma área exata.
-- As colunas geradas `area_unitaria`/`area_total`/`area_cobrada` (3 casas) ficam como estão: são
-- de exibição e de consumo de material, e seis views dependem delas.
--
-- `tg_item_precificar_por_area` continua SECURITY DEFINER (migração 20261026700000): lê colunas
-- de preço do produto que o perfil logado não enxerga.

CREATE OR REPLACE FUNCTION public.tg_item_precificar_por_area()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
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
    v_qtd := GREATEST(COALESCE(NEW.quantidade,1),1);
    -- A área da peça exata ao mm² (6 casas), nunca em 3: 0,001 m² é 10 × 10 cm, e adesivo de
    -- 5 × 5 cm pagava 20% a mais (29/10/2026).
    v_area_peca := GREATEST(round(NEW.largura*NEW.altura,6), COALESCE(NEW.area_minima,0));
    v_area_linha := v_area_peca * v_qtd;
    -- O total da linha arredonda UMA vez, em centavos: é o que o cliente paga.
    v_total_linha := round(v_area_linha * NEW.preco_m2, 2);

    -- Faixa por área: só no preço de tabela do parceiro, e só quando a linha passa do limite.
    IF NEW.produto_id IS NOT NULL THEN
      SELECT preco_parceiro, preco_parceiro_acima, acima_de_m2
        INTO v_preco_tabela, v_preco_acima, v_limite
        FROM public.produtos WHERE id = NEW.produto_id;
      IF v_preco_acima IS NOT NULL AND NEW.preco_m2 = v_preco_tabela AND v_area_linha > v_limite THEN
        v_total_linha := round(v_limite * v_preco_tabela + (v_area_linha - v_limite) * v_preco_acima, 2);
      END IF;
    END IF;

    -- O unitário é o total ÷ peças, em centavos (a coluna é numeric 12,2). Em peça miúda ele não
    -- reproduz o total; o total manda, e o PDF escreve o unitário com as casas que faltam.
    NEW.valor_unitario := round(v_total_linha / v_qtd, 2);
  END IF;
  NEW.valor_total := round(COALESCE(v_total_linha, COALESCE(NEW.valor_unitario,0) * GREATEST(COALESCE(NEW.quantidade,1),1))
    - COALESCE(NEW.desconto,0), 2);
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.tg_item_os_precificar_por_area()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_area_peca numeric;
  v_qtd numeric;
  v_total_linha numeric;
BEGIN
  IF NEW.area_minima IS NULL AND NEW.produto_id IS NOT NULL THEN
    SELECT area_minima_cobrada INTO NEW.area_minima FROM public.produtos WHERE id=NEW.produto_id;
  END IF;
  v_total_linha := NULL;
  IF NEW.preco_m2 IS NOT NULL AND COALESCE(NEW.largura,0)>0 AND COALESCE(NEW.altura,0)>0 THEN
    v_qtd := GREATEST(COALESCE(NEW.quantidade,1),1);
    -- A mesma conta do item do orçamento (29/10/2026): área exata ao mm², total em centavos,
    -- unitário = total ÷ peças. A OS que nasce do orçamento repete o total ao centavo.
    v_area_peca := GREATEST(round(NEW.largura*NEW.altura,6), COALESCE(NEW.area_minima,0));
    v_total_linha := round(v_area_peca * v_qtd * NEW.preco_m2, 2);
    NEW.valor_unitario := round(v_total_linha / v_qtd, 2);
  END IF;
  NEW.valor_total := COALESCE(v_total_linha, round(COALESCE(NEW.valor_unitario,0) * GREATEST(COALESCE(NEW.quantidade,1),1), 2));
  RETURN NEW;
END $function$;

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
    -- Vendido por área: custo por m² × a área exata da peça (a mesma que o preço usa, 29/10/2026).
    v_area_peca := GREATEST(round(NEW.largura * NEW.altura, 6), COALESCE(NEW.area_minima, v_area_minima, 0));
    NEW.custo_unitario := round(v_custo * v_area_peca, 2);
  ELSE
    NEW.custo_unitario := v_custo;
  END IF;
  RETURN NEW;
END $function$;
