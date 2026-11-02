-- Respostas das perguntas do produto no item do orçamento (02/11/2026).
--
-- A aba Checklist da pasta do produto (#330) cadastra as perguntas
-- (`produto_perguntas`). Esta coluna guarda o que foi respondido ao orçar:
-- lista de { pergunta_id, pergunta, resposta }, com o texto da pergunta
-- copiado para o item continuar legível se a pergunta mudar depois.
--
-- As três views de itens entregam a coluna no fim, cada uma com as suas opções
-- (CREATE OR REPLACE VIEW descarta as opções; aqui elas voltam como estão no
-- banco vivo em 02/11). GRANTs ficam como estão.

ALTER TABLE public.orcamento_itens ADD COLUMN IF NOT EXISTS respostas jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.orcamento_itens DROP CONSTRAINT IF EXISTS orcamento_itens_respostas_lista;
ALTER TABLE public.orcamento_itens ADD CONSTRAINT orcamento_itens_respostas_lista CHECK (jsonb_typeof(respostas) = 'array');

COMMENT ON COLUMN public.orcamento_itens.respostas IS 'Respostas das perguntas do produto (Checklist) dadas ao orçar: [{pergunta_id, pergunta, resposta}].';

CREATE OR REPLACE VIEW public.orcamento_itens_operacional
WITH (security_invoker = true) AS
 SELECT id, orcamento_id, descricao, quantidade, unidade, ordem, created_at, largura, altura,
        area_unitaria, area_total, acabamento, arquivo_id, produto_id, area_minima, area_cobrada,
        tipo_produto, especificacao,
        respostas
   FROM public.orcamento_itens;

CREATE OR REPLACE VIEW public.orcamento_itens_comercial
WITH (security_invoker = false, security_barrier = true) AS
 SELECT oi.id, oi.orcamento_id, oi.descricao, oi.quantidade, oi.unidade, oic.valor_unitario, oic.valor_total,
        oi.ordem, oi.created_at, oi.largura, oi.altura, oi.area_unitaria, oi.area_total, oi.acabamento,
        oi.arquivo_id, oi.produto_id, oi.area_minima, oi.area_cobrada, oi.tipo_produto, oi.especificacao,
        oi.respostas
   FROM public.orcamento_itens oi
   LEFT JOIN public.orcamento_item_custos oic ON oic.orcamento_item_id = oi.id
  WHERE public.is_staff(auth.uid()) AND public.can_see_prices(auth.uid());

CREATE OR REPLACE VIEW public.orcamento_itens_financeiro
WITH (security_invoker = true) AS
 SELECT oi.id, oi.orcamento_id, oi.descricao, oi.quantidade, oi.unidade, oic.valor_unitario, oic.custo_unitario,
        oic.valor_total, oi.ordem, oi.created_at, oi.largura, oi.altura, oi.area_unitaria, oi.area_total,
        oi.acabamento, oi.arquivo_id, oi.produto_id, oi.area_minima, oi.area_cobrada, oi.tipo_produto,
        oi.especificacao,
        oi.respostas
   FROM public.orcamento_itens oi
   LEFT JOIN public.orcamento_item_custos oic ON oic.orcamento_item_id = oi.id
  WHERE public.can_see_financials(( SELECT auth.uid() AS uid));
