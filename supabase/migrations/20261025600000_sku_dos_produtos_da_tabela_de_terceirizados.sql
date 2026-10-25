-- Os sete produtos da tabela de terceirizados foram ativados (migração 20261025500000) sem código:
-- a busca por código voltaria a falhar para eles. Mesmo padrão em uso (3 letras, hífen, código).
-- Só preenche quem está sem SKU; não toca em preço, custo, nome nem categoria.
WITH mapa(nome, sku) AS (VALUES
  ('Adesivo PROMO', 'ADE-PRM'),
  ('Adesivo perfurado promocional', 'ADE-PERFP'),
  ('Adesivo transparente', 'ADE-TRP'),
  ('Adesivo fosco', 'ADE-FOS'),
  ('Adesivo blackout', 'ADE-BLK'),
  ('Lona fosca', 'LON-FOS'),
  ('Lona backlight', 'LON-BCK')
)
UPDATE public.produtos p SET sku = m.sku
  FROM mapa m
 WHERE p.nome = m.nome AND p.sku IS NULL AND p.ativo;
