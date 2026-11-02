-- A resposta do item passa a cobrar (02/11/2026, pedido do dono: "as respostas mudarem o preço").
--
-- Até aqui, "Sim, instalamos" só escrevia no acabamento: o orçamento saía sem a instalação e ninguém via. Agora o
-- processo diz qual serviço o cobra e em que medida, e a cobrança vira uma linha do orçamento presa ao item.
--
--   Laminação               Laminação de adesivo, R$ 28,00/m²    pela área da peça, sozinho
--   Instalação              Instalação em campo, R$ 130,00/h     quem vende informa as horas
--   Deslocamento de equipe  Deslocamento, R$ 4,50/km             quem vende informa os km
--   Embalagem, Máscara      sem serviço com preço                aparece como sem cobrança à parte
--
-- Horas e km não saem da medida da peça, e número de palpite faz orçar errado: sem a informação, a linha não entra
-- e a tela avisa. `ON DELETE CASCADE`: tirar o item leva junto a cobrança que ele criou.

ALTER TABLE public.processos
  ADD COLUMN IF NOT EXISTS produto_servico_id uuid REFERENCES public.produtos(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS medida_cobrada text;
ALTER TABLE public.processos DROP CONSTRAINT IF EXISTS processos_medida_cobrada_valida;
ALTER TABLE public.processos ADD CONSTRAINT processos_medida_cobrada_valida
  CHECK (medida_cobrada IS NULL OR medida_cobrada IN ('area', 'perimetro', 'peca', 'informar'));
COMMENT ON COLUMN public.processos.produto_servico_id IS 'Serviço que cobra este processo quando uma resposta do item o acrescenta.';
COMMENT ON COLUMN public.processos.medida_cobrada IS 'Como calcular a quantidade: area, perimetro, peca ou informar (quem vende digita).';

UPDATE public.processos pr
   SET produto_servico_id = p.id, medida_cobrada = v.medida
  FROM (VALUES
    ('Laminação', 'ADE-LAM', 'area'),
    ('Instalação', 'SRV-INST', 'informar'),
    ('Deslocamento de equipe', 'SRV-DESL', 'informar')
  ) AS v(processo, sku, medida)
  JOIN public.produtos p ON p.sku = v.sku
 WHERE pr.nome = v.processo;

ALTER TABLE public.orcamento_itens ADD COLUMN IF NOT EXISTS gerado_por_item_id uuid
  REFERENCES public.orcamento_itens(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS orcamento_itens_gerado_por_item_idx
  ON public.orcamento_itens (gerado_por_item_id) WHERE gerado_por_item_id IS NOT NULL;
COMMENT ON COLUMN public.orcamento_itens.gerado_por_item_id IS 'O item cuja resposta criou esta linha de cobrança. Mudar a resposta tira a linha.';

-- A tabela dá SELECT coluna a coluna, e as views `_financeiro` e `_operacional` leem com a permissão de quem chama.
GRANT SELECT (gerado_por_item_id) ON public.orcamento_itens TO authenticated;

CREATE OR REPLACE VIEW public.orcamento_itens_operacional
WITH (security_invoker = true) AS
 SELECT id, orcamento_id, descricao, quantidade, unidade, ordem, created_at, largura, altura,
        area_unitaria, area_total, acabamento, arquivo_id, produto_id, area_minima, area_cobrada,
        tipo_produto, especificacao,
        respostas, gerado_por_item_id
   FROM public.orcamento_itens;

CREATE OR REPLACE VIEW public.orcamento_itens_comercial
WITH (security_invoker = false, security_barrier = true) AS
 SELECT oi.id, oi.orcamento_id, oi.descricao, oi.quantidade, oi.unidade, oic.valor_unitario, oic.valor_total,
        oi.ordem, oi.created_at, oi.largura, oi.altura, oi.area_unitaria, oi.area_total, oi.acabamento,
        oi.arquivo_id, oi.produto_id, oi.area_minima, oi.area_cobrada, oi.tipo_produto, oi.especificacao,
        oi.respostas, oi.gerado_por_item_id
   FROM public.orcamento_itens oi
   LEFT JOIN public.orcamento_item_custos oic ON oic.orcamento_item_id = oi.id
  WHERE public.is_staff(auth.uid()) AND public.can_see_prices(auth.uid());

CREATE OR REPLACE VIEW public.orcamento_itens_financeiro
WITH (security_invoker = true) AS
 SELECT oi.id, oi.orcamento_id, oi.descricao, oi.quantidade, oi.unidade, oic.valor_unitario, oic.custo_unitario,
        oic.valor_total, oi.ordem, oi.created_at, oi.largura, oi.altura, oi.area_unitaria, oi.area_total,
        oi.acabamento, oi.arquivo_id, oi.produto_id, oi.area_minima, oi.area_cobrada, oi.tipo_produto,
        oi.especificacao,
        oi.respostas, oi.gerado_por_item_id
   FROM public.orcamento_itens oi
   LEFT JOIN public.orcamento_item_custos oic ON oic.orcamento_item_id = oi.id
  WHERE public.can_see_financials(( SELECT auth.uid() AS uid));
