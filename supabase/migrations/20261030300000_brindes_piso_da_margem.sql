-- Correção da decisão de brindes de 30/10/2026: a regra era "markup de 60% com o piso da margem
-- mínima do produto", mas três brindes ficaram em 38 a 39%, abaixo do mínimo de 40% do cadastro.
-- Vão para o piso da margem mínima (custo ÷ 0,60, ao próximo ,90):
--   copo cuia 380 ml (BRI-CUIA380)        48,90 → 50,90   (custo 30)
--   kit churrasco 3 pç (BRI-KC3B)         94,90 → 98,90   (custo 59)
--   kit churrasco longo 2 pç (BRI-KCL2)  110,90 → 115,90  (custo 69)
-- Para desfazer: voltar aos valores da esquerda. Já aplicado em produção; idempotente.
UPDATE public.produtos p SET preco_base = v.preco
  FROM (VALUES ('BRI-CUIA380', 50.90), ('BRI-KC3B', 98.90), ('BRI-KCL2', 115.90)) AS v(sku, preco)
 WHERE p.sku = v.sku AND p.ativo AND p.preco_base < v.preco;
