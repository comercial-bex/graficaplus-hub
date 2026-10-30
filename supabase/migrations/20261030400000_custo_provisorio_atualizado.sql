-- Custos provisórios dos seis produtos "não comprados" voltam a acompanhar o custo
-- atual do produto parecido (vinil branco 9,21; perfurado 9,38; lona 440 20,26).
-- Antes: 14,78 / 28,09 / 22,21 (defasados) e as margens apareciam piores que as reais.
-- Continuam provisórios (tag em observacoes_internas) até a primeira nota de compra.
-- Para voltar: custo_medio 14.78 (Adesivo PROMO/fosco/blackout), 28.09 (perfurado promo), 22.21 (lonas).
UPDATE public.produtos p
   SET custo_medio = s.custo_medio,
       observacoes_internas = p.observacoes_internas ||
         ' Custo atualizado em 30/10/2026 para o custo atual de "' || s.nome || '" (R$ ' ||
         to_char(s.custo_medio, 'FM990.00') || '), que baixou com a nota de compra real; continua provisório até a primeira compra do material.'
  FROM (VALUES
    ('Adesivo PROMO',                 'Adesivo vinil branco impresso'),
    ('Adesivo fosco',                 'Adesivo vinil branco impresso'),
    ('Adesivo blackout',              'Adesivo vinil branco impresso'),
    ('Adesivo perfurado promocional', 'Adesivo perfurado (one way)'),
    ('Lona fosca',                    'Lona 440g reforçada impressa'),
    ('Lona backlight',                'Lona 440g reforçada impressa')
  ) AS v(produto, irmao)
  JOIN public.produtos s ON s.nome = v.irmao AND s.ativo
 WHERE p.nome = v.produto AND p.ativo
   AND p.observacoes_internas LIKE '%PROVISÓRIOS%'
   AND p.custo_medio <> s.custo_medio;
