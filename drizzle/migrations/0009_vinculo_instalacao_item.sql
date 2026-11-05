-- PROPOSTA — NÃO APLICADA. Decisão da equipe (05/11/2026).
-- Por que não dá para usar `parametros`: a equipe (authenticated) não tem SELECT nessa
-- coluna e ela não aparece em nenhuma das três views de orcamento_itens; a tela gravaria
-- o vínculo mas nunca conseguiria lê-lo de volta (nem para a pendência).
-- Esta proposta é aditiva: coluna nova anulável, nada muda em orçamentos existentes.

ALTER TABLE public.orcamento_itens
  ADD COLUMN instala_item_id uuid NULL
  REFERENCES public.orcamento_itens(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.orcamento_itens.instala_item_id IS
  'Item de instalação: o item do mesmo orçamento que ele instala. NULL = sem vínculo.';

-- Só pode apontar para item do mesmo orçamento e nunca para si mesmo.
CREATE OR REPLACE FUNCTION public.tg_instala_item_mesmo_orcamento()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.instala_item_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.instala_item_id = NEW.id OR NOT EXISTS (
    SELECT 1 FROM public.orcamento_itens o
    WHERE o.id = NEW.instala_item_id AND o.orcamento_id = NEW.orcamento_id
  ) THEN
    RAISE EXCEPTION 'A instalação precisa apontar para outro item do mesmo orçamento.';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER instala_item_mesmo_orcamento
  BEFORE INSERT OR UPDATE OF instala_item_id ON public.orcamento_itens
  FOR EACH ROW EXECUTE FUNCTION public.tg_instala_item_mesmo_orcamento();

GRANT SELECT (instala_item_id), INSERT (instala_item_id), UPDATE (instala_item_id)
  ON public.orcamento_itens TO authenticated;

-- As três views ganham a coluna no fim (CREATE OR REPLACE só aceita coluna nova no fim;
-- as opções security_invoker/security_barrier atuais são mantidas).
CREATE OR REPLACE VIEW public.orcamento_itens_operacional WITH (security_invoker = true) AS
SELECT id, orcamento_id, descricao, quantidade, unidade, ordem, created_at, largura, altura,
  area_unitaria, area_total, acabamento, arquivo_id, produto_id, area_minima, area_cobrada,
  tipo_produto, especificacao, respostas, gerado_por_item_id, instala_item_id
FROM public.orcamento_itens;

CREATE OR REPLACE VIEW public.orcamento_itens_comercial WITH (security_invoker = false, security_barrier = true) AS
SELECT oi.id, oi.orcamento_id, oi.descricao, oi.quantidade, oi.unidade, oic.valor_unitario,
  oic.valor_total, oi.ordem, oi.created_at, oi.largura, oi.altura, oi.area_unitaria, oi.area_total,
  oi.acabamento, oi.arquivo_id, oi.produto_id, oi.area_minima, oi.area_cobrada, oi.tipo_produto,
  oi.especificacao, oi.respostas, oi.gerado_por_item_id, oi.instala_item_id
FROM public.orcamento_itens oi
LEFT JOIN public.orcamento_item_custos oic ON oic.orcamento_item_id = oi.id
WHERE public.is_staff(auth.uid()) AND public.can_see_prices(auth.uid());

CREATE OR REPLACE VIEW public.orcamento_itens_financeiro WITH (security_invoker = true) AS
SELECT oi.id, oi.orcamento_id, oi.descricao, oi.quantidade, oi.unidade, oic.valor_unitario,
  oic.custo_unitario, oic.valor_total, oi.ordem, oi.created_at, oi.largura, oi.altura,
  oi.area_unitaria, oi.area_total, oi.acabamento, oi.arquivo_id, oi.produto_id, oi.area_minima,
  oi.area_cobrada, oi.tipo_produto, oi.especificacao, oi.respostas, oi.gerado_por_item_id,
  oic.custo_formulas, oi.instala_item_id
FROM public.orcamento_itens oi
LEFT JOIN public.orcamento_item_custos oic ON oic.orcamento_item_id = oi.id
WHERE public.can_see_financials((SELECT auth.uid()));

-- Impacto: nenhum dado alterado; itens antigos ficam com NULL. A pendência só é calculada
-- na tela para orçamento ainda editável, então aprovados/convertidos não ficam pendentes.
-- Excluir o item de origem zera o vínculo (ON DELETE SET NULL) e a pendência volta.