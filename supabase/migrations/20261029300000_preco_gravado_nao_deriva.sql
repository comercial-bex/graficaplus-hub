-- 29/10/2026 — o preço gravado não deriva (corrige o efeito colateral da área exata, migração 20261029100000).
--
-- A área exata trocou a conta por área nos dois gatilhos de item. Ensaio com rollback no mesmo dia, inserindo
-- na OS os itens como a conversão faz, mostrou o efeito colateral nos itens que JÁ estavam gravados com a conta
-- antiga (área da peça em 3 casas):
--   orçamento 150 (aprovado, Pix de 50% enviado): item R$ 37,50 -> OS R$ 35,70
--   orçamento 152 (aprovado, Pix de 50% enviado): item R$ 71,46 -> OS R$ 71,44
--   orçamento 115 (enviado): quatro itens com R$ 3,21 a menos na OS
-- Ou seja: converter em OS mudaria o preço que o cliente aprovou, e a conta a receber (que copia o total do
-- orçamento) e a OS passariam a discordar. O mesmo vale para quem abrir um desses itens e mexer só na arte ou
-- na descrição: o gatilho do orçamento recalcula o item a cada UPDATE, e o item gravado "derivaria" para a conta
-- nova sem ninguém pedir. Antes da área exata a conta era idempotente; para o que foi gravado antes, não é.
--
-- Regras desta migração (o preço aprovado manda; a conta nova vale para o que nasce e para o que muda):
--   1. Orçamento (tg_item_precificar_por_area): num UPDATE em que nenhuma ENTRADA do preço mudou (preço por m²,
--      largura, altura, quantidade, área mínima, produto), o preço gravado fica como está. Só o desconto do
--      item pode mexer no total.
--   2. OS (tg_item_os_precificar_por_area): o item que nasce de um item de orçamento copia o que o cliente
--      aprovou (unitário e total bruto = total + desconto do item). Depois, num UPDATE, vale a mesma regra do
--      item 1: o recálculo só acontece se uma entrada do preço mudar.
-- Os dois continuam como estavam quanto a privilégio: o do orçamento é SECURITY DEFINER (lê colunas de preço do
-- produto, migração 20261026700000); o da OS roda como quem escreve e, se não puder ler o item do orçamento,
-- recalcula pela conta nova.

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
    -- O preço gravado não deriva: se nenhuma entrada do preço mudou, o item fica como foi aprovado.
    IF TG_OP = 'UPDATE'
       AND OLD.valor_total IS NOT NULL AND OLD.valor_unitario IS NOT NULL
       AND NEW.preco_m2 IS NOT DISTINCT FROM OLD.preco_m2
       AND NEW.largura IS NOT DISTINCT FROM OLD.largura
       AND NEW.altura IS NOT DISTINCT FROM OLD.altura
       AND NEW.quantidade IS NOT DISTINCT FROM OLD.quantidade
       AND NEW.area_minima IS NOT DISTINCT FROM OLD.area_minima
       AND NEW.produto_id IS NOT DISTINCT FROM OLD.produto_id THEN
      NEW.valor_unitario := OLD.valor_unitario;
      NEW.valor_total := round(OLD.valor_total + COALESCE(OLD.desconto,0) - COALESCE(NEW.desconto,0), 2);
      RETURN NEW;
    END IF;

    v_qtd := GREATEST(COALESCE(NEW.quantidade,1),1);
    -- A área da peça exata ao mm² (6 casas), nunca em 3 (29/10/2026).
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

    -- O unitário é o total ÷ peças, em centavos (a coluna é numeric 12,2).
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
  v_un numeric;
  v_total numeric;
BEGIN
  IF NEW.area_minima IS NULL AND NEW.produto_id IS NOT NULL THEN
    SELECT area_minima_cobrada INTO NEW.area_minima FROM public.produtos WHERE id=NEW.produto_id;
  END IF;
  v_total_linha := NULL;
  IF NEW.preco_m2 IS NOT NULL AND COALESCE(NEW.largura,0)>0 AND COALESCE(NEW.altura,0)>0 THEN
    -- (1) Item que nasce de um item de orçamento: o preço é o que o cliente aprovou, não uma conta nova.
    IF TG_OP = 'INSERT' AND NEW.orcamento_item_id IS NOT NULL THEN
      BEGIN
        SELECT oi.valor_unitario, round(oi.valor_total + COALESCE(oi.desconto, 0), 2)
          INTO v_un, v_total
          FROM public.orcamento_itens oi
         WHERE oi.id = NEW.orcamento_item_id AND oi.valor_total IS NOT NULL;
      EXCEPTION WHEN insufficient_privilege THEN
        v_un := NULL; v_total := NULL;
      END;
      IF v_total IS NOT NULL THEN
        NEW.valor_unitario := v_un;
        NEW.valor_total := v_total;
        RETURN NEW;
      END IF;
    END IF;

    -- (2) UPDATE em que nenhuma entrada do preço mudou: o preço gravado fica.
    IF TG_OP = 'UPDATE'
       AND OLD.valor_total IS NOT NULL AND OLD.valor_unitario IS NOT NULL
       AND NEW.preco_m2 IS NOT DISTINCT FROM OLD.preco_m2
       AND NEW.largura IS NOT DISTINCT FROM OLD.largura
       AND NEW.altura IS NOT DISTINCT FROM OLD.altura
       AND NEW.quantidade IS NOT DISTINCT FROM OLD.quantidade
       AND NEW.area_minima IS NOT DISTINCT FROM OLD.area_minima
       AND NEW.produto_id IS NOT DISTINCT FROM OLD.produto_id THEN
      NEW.valor_unitario := OLD.valor_unitario;
      NEW.valor_total := OLD.valor_total;
      RETURN NEW;
    END IF;

    -- (3) Item novo ou com entrada mudada: a mesma conta do orçamento (área exata, total em centavos).
    v_qtd := GREATEST(COALESCE(NEW.quantidade,1),1);
    v_area_peca := GREATEST(round(NEW.largura*NEW.altura,6), COALESCE(NEW.area_minima,0));
    v_total_linha := round(v_area_peca * v_qtd * NEW.preco_m2, 2);
    NEW.valor_unitario := round(v_total_linha / v_qtd, 2);
  END IF;
  NEW.valor_total := COALESCE(v_total_linha, round(COALESCE(NEW.valor_unitario,0) * GREATEST(COALESCE(NEW.quantidade,1),1), 2));
  RETURN NEW;
END $function$;
