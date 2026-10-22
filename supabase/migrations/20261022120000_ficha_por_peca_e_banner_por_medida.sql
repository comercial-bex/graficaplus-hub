-- Ficha "por peça" e o banner do cliente final vendido por medida (22/10/2026).
--
-- Pedido do dono: "banner com o cliente final não tá dando pra colocar as
-- medidas, só o banner terceirizado". Medido:
--
--   * "Banner com bastão e corda" (cliente final) era vendido por UNIDADE a
--     R$ 110: a medida não mudava o preço nem o material — um 2×1 m baixava 1 m²
--     de lona. Por isso a equipe digitava o banner como ITEM LIVRE (8 dos 16
--     itens livres dos orçamentos enviados/aprovados), e item livre não tem
--     ficha: custo zero, estoque sem baixa, margem inventada.
--   * "(Terceirizado)" era por m², mas a ficha não tinha o bastão e a corda:
--     nunca saíam do estoque.
--
-- O banner tem material de dois jeitos: lona por m² e um kit de bastão e corda
-- POR PEÇA. A ficha só sabia multiplicar tudo pela mesma base (m² cobrados, ou
-- peças quando não há medida) — um 2×1 m reservaria 2 kits. `por_peca` diz que
-- a linha conta pela quantidade de peças, com ou sem medida.
--
-- Decisão do dono (22/10): banner do cliente final por m², R$ 110,00/m², área
-- mínima de 1 m² (igual ao terceirizado). Custo do produto continua somando a
-- ficha por unidade de venda (recalcular_custo_produto): no banner maior que
-- 1 m² o custo/m² conta o kit uma vez por m² — a conta erra para MAIS (margem
-- menor que a real), nunca para menos. A calculadora de custo e a previsão da
-- OS já contam o kit por peça.

-- 1. A linha da ficha que conta por peça -----------------------------------------
ALTER TABLE public.produto_materiais
  ADD COLUMN IF NOT EXISTS por_peca boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.produto_materiais.por_peca IS
  'A linha conta por PEÇA (quantidade do item), mesmo em produto vendido por m². Ex.: o kit de bastão e corda do banner. Falso: conta pela base de consumo (m² cobrados ou peças).';

-- 2. A previsão de material da OS respeita a linha por peça ------------------------
DO $m$
DECLARE
  v_def text := pg_get_functiondef('public.gerar_materiais_previstos_os'::regproc);
  v_de text := 'pm.quantidade_por_unidade * public.base_de_consumo_item(i.area_cobrada, i.quantidade)';
  v_para text := 'pm.quantidade_por_unidade * CASE WHEN pm.por_peca THEN greatest(coalesce(i.quantidade, 1), 1) ELSE public.base_de_consumo_item(i.area_cobrada, i.quantidade) END';
  n int;
BEGIN
  n := (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de);
  IF n <> 1 THEN
    RAISE EXCEPTION 'gerar_materiais_previstos_os: âncora apareceu % vezes (esperado 1)', n;
  END IF;
  EXECUTE replace(v_def, v_de, v_para);
END $m$;

-- 3. O banner do cliente final por medida ------------------------------------------
UPDATE public.produtos
   SET unidade = 'm2', area_minima_cobrada = 1
 WHERE id = 'cb58f5d8-1eaf-4019-a84c-6b311d0cf9c3'   -- Banner com bastão e corda
   AND unidade = 'un';

-- O kit de bastão e corda é um por banner, em qualquer tamanho.
UPDATE public.produto_materiais
   SET por_peca = true
 WHERE produto_id = 'cb58f5d8-1eaf-4019-a84c-6b311d0cf9c3'
   AND material_id = 'a42a7912-ba66-4ed2-a917-f179b43db6f1';   -- Bastão + corda para banner

-- 4. O terceirizado ganha o kit que faltava ---------------------------------------
-- O gatilho tg_ficha_nova_alcanca_os_aberta leva o kit às OS abertas desse
-- produto (#164 e #166), já contado por peça.
INSERT INTO public.produto_materiais (produto_id, material_id, quantidade_por_unidade, por_peca)
SELECT 'a90b6fc0-79a1-43d0-bd24-68e36663b542', 'a42a7912-ba66-4ed2-a917-f179b43db6f1', 1, true
 WHERE NOT EXISTS (
   SELECT 1 FROM public.produto_materiais
    WHERE produto_id = 'a90b6fc0-79a1-43d0-bd24-68e36663b542'
      AND material_id = 'a42a7912-ba66-4ed2-a917-f179b43db6f1'
 );
