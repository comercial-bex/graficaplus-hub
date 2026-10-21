-- Custo da peça nos itens por área do orçamento #69 (20/10/2026).
--
-- A tela, para quem vê custo, copiava o custo do produto POR M² direto no custo
-- da PEÇA (custo_unitario). Medido em 20/10: três itens, todos do #69
-- (Distribuidora Estrela, rascunho). O front foi corrigido no mesmo PR (o campo
-- vira "Custo/m²" e o custo da peça sai da área cobrada, como o preço).
--
-- Antes → depois (custo da peça; o preço não muda):
--   Adesivo vinil branco impresso 1,50 × 1,00, 3 un   R$ 22,00 → R$ 33,00
--   Placa PVC expandido 3mm      0,50 × 0,50, 6 un   R$ 78,00 → R$ 19,50
--   Placa PVC expandido 3mm      0,30 × 0,15, 25 un  R$ 78,00 → R$  3,51
--   custo_estimado do #69: R$ 5.115,07 → R$ 2.934,82 (subtotal R$ 2.238,95)
--
-- Ensaiado com rollback antes de aplicar. A guarda `custo_unitario = custo_medio`
-- faz a correção valer só para o que ainda é a cópia errada: rodar de novo não
-- muda nada. O item "Quadro Acrilico" (custo R$ 200,00 digitado à mão) não é
-- este defeito e ficou como está.
UPDATE public.orcamento_itens i
   SET custo_unitario = round(p.custo_medio * GREATEST(round(i.largura * i.altura, 3), COALESCE(i.area_minima, p.area_minima_cobrada, 0)), 2)
  FROM public.produtos p
 WHERE p.id = i.produto_id
   AND i.id IN ('5a23c2ee-b5b4-4130-a8a6-5901312f3a16', '978fe7c3-1a7d-433b-bcf1-9b557066998f', '9dc3f641-b138-4fab-94aa-a6fe9d586b18')
   AND i.custo_unitario = p.custo_medio;
