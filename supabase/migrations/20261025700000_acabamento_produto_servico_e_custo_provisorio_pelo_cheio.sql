-- 1) acabamentos.produto_servico_id: o produto de serviço que cobra o acabamento no orçamento.
--    Troca a ligação por NOME que estava no código (src/domain/orcamentos/cobranca-do-acabamento.ts)
--    por uma coluna. Preenche os dois que já se cobram (bainha + ilhós e laminação).
-- 2) Os sete produtos ativados com custo provisório (migração 20261025500000) tinham o custo_medio
--    copiado do cadastro DIGITADO do produto parecido (R$ 22 e R$ 34, antigos). Passa a ser o custo
--    CHEIO dele (matéria-prima + máquina + mão de obra + indireto): vinil R$ 14,78, perfurado
--    R$ 28,09, lona 440 R$ 22,21. Continua provisório (a observação segue lá) até o custo real.
-- Desfazer: UPDATE produtos SET custo_medio = 22 / 34 / 18.30 nos sete; DROP da coluna.
ALTER TABLE public.acabamentos ADD COLUMN IF NOT EXISTS produto_servico_id uuid REFERENCES public.produtos(id) ON DELETE SET NULL;
COMMENT ON COLUMN public.acabamentos.produto_servico_id IS 'Produto de serviço que cobra este acabamento no orçamento (linha comum). Substitui a ligação por nome que estava no código.';

UPDATE public.acabamentos a SET produto_servico_id = p.id
  FROM public.produtos p
 WHERE a.produto_servico_id IS NULL AND p.tipo = 'servico'
   AND ((a.nome = 'Bainha + ilhós' AND p.nome = 'Acabamento de lona (bainha + ilhós)')
     OR (a.nome = 'Laminação de adesivo' AND p.nome = 'Laminação de adesivo'));

WITH par(id_novo, id_irmao) AS (
  SELECT n.id, s.id FROM public.produtos n JOIN public.produtos s ON s.nome = CASE n.nome
      WHEN 'Adesivo PROMO' THEN 'Adesivo vinil branco impresso'
      WHEN 'Adesivo transparente' THEN 'Adesivo vinil branco impresso'
      WHEN 'Adesivo fosco' THEN 'Adesivo vinil branco impresso'
      WHEN 'Adesivo blackout' THEN 'Adesivo vinil branco impresso'
      WHEN 'Adesivo perfurado promocional' THEN 'Adesivo perfurado (one way)'
      WHEN 'Lona fosca' THEN 'Lona 440g reforçada impressa'
      WHEN 'Lona backlight' THEN 'Lona 440g reforçada impressa' END
   WHERE n.observacoes_internas LIKE 'CUSTO E PREÇO DE BALCÃO PROVISÓRIOS%' AND n.ativo
)
UPDATE public.produtos n
   SET custo_medio = round((public.custo_cheio_do_produto(par.id_irmao)->>'custo_total')::numeric, 2),
       observacoes_internas = n.observacoes_internas || ' [25/10/2026: custo trocado pelo CUSTO CHEIO do produto parecido (matéria-prima + máquina + mão de obra + indireto), em vez do custo digitado antigo dele.]'
  FROM par
 WHERE n.id = par.id_novo AND n.observacoes_internas NOT LIKE '%CUSTO CHEIO do produto parecido%';
