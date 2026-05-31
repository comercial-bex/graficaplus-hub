-- =========================================================================
-- Segurança financeira: RLS dedicado, tabelas sensíveis e views operacionais
-- =========================================================================

-- 1) Tabelas sensíveis separadas ------------------------------------------------
CREATE TABLE IF NOT EXISTS public.orcamento_custos (
  orcamento_id UUID PRIMARY KEY REFERENCES public.orcamentos(id) ON DELETE CASCADE,
  valor_subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  valor_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  desconto_percentual NUMERIC(5,2) NOT NULL DEFAULT 0,
  custo_estimado NUMERIC(12,2) NOT NULL DEFAULT 0,
  margem_estimada NUMERIC(5,2),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.os_resultados_financeiros (
  os_id UUID PRIMARY KEY REFERENCES public.ordens_servico(id) ON DELETE CASCADE,
  valor_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  custo_previsto NUMERIC(12,2) NOT NULL DEFAULT 0,
  custo_real NUMERIC(12,2) NOT NULL DEFAULT 0,
  margem_real NUMERIC(5,2),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.produto_precificacao (
  produto_id UUID PRIMARY KEY REFERENCES public.produtos(id) ON DELETE CASCADE,
  preco_base NUMERIC(12,2),
  custo_base NUMERIC(12,2),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.material_custos (
  material_id UUID PRIMARY KEY REFERENCES public.materiais(id) ON DELETE CASCADE,
  custo_unitario NUMERIC(12,2),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.orcamento_item_custos (
  orcamento_item_id UUID PRIMARY KEY REFERENCES public.orcamento_itens(id) ON DELETE CASCADE,
  valor_unitario NUMERIC(12,2) NOT NULL DEFAULT 0,
  custo_unitario NUMERIC(12,2) NOT NULL DEFAULT 0,
  valor_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.item_os_custos (
  item_os_id UUID PRIMARY KEY REFERENCES public.itens_os(id) ON DELETE CASCADE,
  valor_unitario NUMERIC(12,2) NOT NULL DEFAULT 0,
  custo_unitario NUMERIC(12,2) NOT NULL DEFAULT 0,
  valor_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.orcamento_custos (orcamento_id, valor_subtotal, valor_total, desconto_percentual, custo_estimado, margem_estimada, updated_at)
SELECT id, valor_subtotal, valor_total, desconto_percentual, custo_estimado, margem_estimada, updated_at
FROM public.orcamentos
ON CONFLICT (orcamento_id) DO UPDATE SET
  valor_subtotal = EXCLUDED.valor_subtotal,
  valor_total = EXCLUDED.valor_total,
  desconto_percentual = EXCLUDED.desconto_percentual,
  custo_estimado = EXCLUDED.custo_estimado,
  margem_estimada = EXCLUDED.margem_estimada,
  updated_at = now();

INSERT INTO public.os_resultados_financeiros (os_id, valor_total, custo_previsto, custo_real, margem_real, updated_at)
SELECT id, valor_total, custo_previsto, custo_real, margem_real, updated_at
FROM public.ordens_servico
ON CONFLICT (os_id) DO UPDATE SET
  valor_total = EXCLUDED.valor_total,
  custo_previsto = EXCLUDED.custo_previsto,
  custo_real = EXCLUDED.custo_real,
  margem_real = EXCLUDED.margem_real,
  updated_at = now();

INSERT INTO public.produto_precificacao (produto_id, preco_base, updated_at)
SELECT id, preco_base, now()
FROM public.produtos
ON CONFLICT (produto_id) DO UPDATE SET
  preco_base = EXCLUDED.preco_base,
  updated_at = now();

INSERT INTO public.material_custos (material_id, custo_unitario, updated_at)
SELECT id, custo_unitario, now()
FROM public.materiais
ON CONFLICT (material_id) DO UPDATE SET
  custo_unitario = EXCLUDED.custo_unitario,
  updated_at = now();

INSERT INTO public.orcamento_item_custos (orcamento_item_id, valor_unitario, custo_unitario, valor_total, updated_at)
SELECT id, valor_unitario, custo_unitario, valor_total, now()
FROM public.orcamento_itens
ON CONFLICT (orcamento_item_id) DO UPDATE SET
  valor_unitario = EXCLUDED.valor_unitario,
  custo_unitario = EXCLUDED.custo_unitario,
  valor_total = EXCLUDED.valor_total,
  updated_at = now();

INSERT INTO public.item_os_custos (item_os_id, valor_unitario, custo_unitario, valor_total, updated_at)
SELECT id, valor_unitario, custo_unitario, valor_total, now()
FROM public.itens_os
ON CONFLICT (item_os_id) DO UPDATE SET
  valor_unitario = EXCLUDED.valor_unitario,
  custo_unitario = EXCLUDED.custo_unitario,
  valor_total = EXCLUDED.valor_total,
  updated_at = now();

ALTER TABLE public.orcamento_custos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.os_resultados_financeiros ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.produto_precificacao ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.material_custos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orcamento_item_custos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.item_os_custos ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.orcamento_custos TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.os_resultados_financeiros TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.produto_precificacao TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.material_custos TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.orcamento_item_custos TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.item_os_custos TO authenticated;
GRANT ALL ON public.orcamento_custos TO service_role;
GRANT ALL ON public.os_resultados_financeiros TO service_role;
GRANT ALL ON public.produto_precificacao TO service_role;
GRANT ALL ON public.material_custos TO service_role;
GRANT ALL ON public.orcamento_item_custos TO service_role;
GRANT ALL ON public.item_os_custos TO service_role;

DROP POLICY IF EXISTS "orcamento custos financeiro all" ON public.orcamento_custos;
CREATE POLICY "orcamento custos financeiro all" ON public.orcamento_custos FOR ALL TO authenticated
  USING (public.can_see_financials(auth.uid())) WITH CHECK (public.can_see_financials(auth.uid()));

DROP POLICY IF EXISTS "os resultados financeiro all" ON public.os_resultados_financeiros;
CREATE POLICY "os resultados financeiro all" ON public.os_resultados_financeiros FOR ALL TO authenticated
  USING (public.can_see_financials(auth.uid())) WITH CHECK (public.can_see_financials(auth.uid()));

DROP POLICY IF EXISTS "produto precificacao financeiro all" ON public.produto_precificacao;
CREATE POLICY "produto precificacao financeiro all" ON public.produto_precificacao FOR ALL TO authenticated
  USING (public.can_see_financials(auth.uid())) WITH CHECK (public.can_see_financials(auth.uid()));

DROP POLICY IF EXISTS "material custos financeiro all" ON public.material_custos;
CREATE POLICY "material custos financeiro all" ON public.material_custos FOR ALL TO authenticated
  USING (public.can_see_financials(auth.uid())) WITH CHECK (public.can_see_financials(auth.uid()));

DROP POLICY IF EXISTS "orcamento item custos financeiro all" ON public.orcamento_item_custos;
CREATE POLICY "orcamento item custos financeiro all" ON public.orcamento_item_custos FOR ALL TO authenticated
  USING (public.can_see_financials(auth.uid())) WITH CHECK (public.can_see_financials(auth.uid()));

DROP POLICY IF EXISTS "item os custos financeiro all" ON public.item_os_custos;
CREATE POLICY "item os custos financeiro all" ON public.item_os_custos FOR ALL TO authenticated
  USING (public.can_see_financials(auth.uid())) WITH CHECK (public.can_see_financials(auth.uid()));

-- 2) Espelhos automáticos para compatibilidade de escrita atual ------------------
CREATE OR REPLACE FUNCTION public.tg_sync_orcamento_custos()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.orcamento_custos (orcamento_id, valor_subtotal, valor_total, desconto_percentual, custo_estimado, margem_estimada, updated_at)
  VALUES (NEW.id, NEW.valor_subtotal, NEW.valor_total, NEW.desconto_percentual, NEW.custo_estimado, NEW.margem_estimada, now())
  ON CONFLICT (orcamento_id) DO UPDATE SET
    valor_subtotal = EXCLUDED.valor_subtotal,
    valor_total = EXCLUDED.valor_total,
    desconto_percentual = EXCLUDED.desconto_percentual,
    custo_estimado = EXCLUDED.custo_estimado,
    margem_estimada = EXCLUDED.margem_estimada,
    updated_at = now();
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.tg_sync_os_resultados_financeiros()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.os_resultados_financeiros (os_id, valor_total, custo_previsto, custo_real, margem_real, updated_at)
  VALUES (NEW.id, NEW.valor_total, NEW.custo_previsto, NEW.custo_real, NEW.margem_real, now())
  ON CONFLICT (os_id) DO UPDATE SET
    valor_total = EXCLUDED.valor_total,
    custo_previsto = EXCLUDED.custo_previsto,
    custo_real = EXCLUDED.custo_real,
    margem_real = EXCLUDED.margem_real,
    updated_at = now();
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.tg_sync_produto_precificacao()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.produto_precificacao (produto_id, preco_base, updated_at)
  VALUES (NEW.id, NEW.preco_base, now())
  ON CONFLICT (produto_id) DO UPDATE SET preco_base = EXCLUDED.preco_base, updated_at = now();
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.tg_sync_material_custos()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.material_custos (material_id, custo_unitario, updated_at)
  VALUES (NEW.id, NEW.custo_unitario, now())
  ON CONFLICT (material_id) DO UPDATE SET custo_unitario = EXCLUDED.custo_unitario, updated_at = now();
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.tg_sync_orcamento_item_custos()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.orcamento_item_custos (orcamento_item_id, valor_unitario, custo_unitario, valor_total, updated_at)
  VALUES (NEW.id, NEW.valor_unitario, NEW.custo_unitario, NEW.valor_total, now())
  ON CONFLICT (orcamento_item_id) DO UPDATE SET
    valor_unitario = EXCLUDED.valor_unitario,
    custo_unitario = EXCLUDED.custo_unitario,
    valor_total = EXCLUDED.valor_total,
    updated_at = now();
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.tg_sync_item_os_custos()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.item_os_custos (item_os_id, valor_unitario, custo_unitario, valor_total, updated_at)
  VALUES (NEW.id, NEW.valor_unitario, NEW.custo_unitario, NEW.valor_total, now())
  ON CONFLICT (item_os_id) DO UPDATE SET
    valor_unitario = EXCLUDED.valor_unitario,
    custo_unitario = EXCLUDED.custo_unitario,
    valor_total = EXCLUDED.valor_total,
    updated_at = now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tg_sync_orcamento_custos ON public.orcamentos;
CREATE TRIGGER tg_sync_orcamento_custos AFTER INSERT OR UPDATE OF valor_subtotal, valor_total, desconto_percentual, custo_estimado, margem_estimada
ON public.orcamentos FOR EACH ROW EXECUTE FUNCTION public.tg_sync_orcamento_custos();

DROP TRIGGER IF EXISTS tg_sync_os_resultados_financeiros ON public.ordens_servico;
CREATE TRIGGER tg_sync_os_resultados_financeiros AFTER INSERT OR UPDATE OF valor_total, custo_previsto, custo_real, margem_real
ON public.ordens_servico FOR EACH ROW EXECUTE FUNCTION public.tg_sync_os_resultados_financeiros();

DROP TRIGGER IF EXISTS tg_sync_produto_precificacao ON public.produtos;
CREATE TRIGGER tg_sync_produto_precificacao AFTER INSERT OR UPDATE OF preco_base
ON public.produtos FOR EACH ROW EXECUTE FUNCTION public.tg_sync_produto_precificacao();

DROP TRIGGER IF EXISTS tg_sync_material_custos ON public.materiais;
CREATE TRIGGER tg_sync_material_custos AFTER INSERT OR UPDATE OF custo_unitario
ON public.materiais FOR EACH ROW EXECUTE FUNCTION public.tg_sync_material_custos();

DROP TRIGGER IF EXISTS tg_sync_orcamento_item_custos ON public.orcamento_itens;
CREATE TRIGGER tg_sync_orcamento_item_custos AFTER INSERT OR UPDATE OF valor_unitario, custo_unitario, valor_total
ON public.orcamento_itens FOR EACH ROW EXECUTE FUNCTION public.tg_sync_orcamento_item_custos();

DROP TRIGGER IF EXISTS tg_sync_item_os_custos ON public.itens_os;
CREATE TRIGGER tg_sync_item_os_custos AFTER INSERT OR UPDATE OF valor_unitario, custo_unitario, valor_total
ON public.itens_os FOR EACH ROW EXECUTE FUNCTION public.tg_sync_item_os_custos();

-- 3) RLS e grants das tabelas originais revisados: financeiro enxerga dados sensíveis;
--    demais perfis devem consumir as views operacionais sem campos financeiros.
DROP POLICY IF EXISTS "orc staff read" ON public.orcamentos;
CREATE POLICY "orc staff read" ON public.orcamentos FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
DROP POLICY IF EXISTS "orc_itens staff all" ON public.orcamento_itens;
CREATE POLICY "orc_itens staff all" ON public.orcamento_itens FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
DROP POLICY IF EXISTS "os staff read" ON public.ordens_servico;
CREATE POLICY "os staff read" ON public.ordens_servico FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
DROP POLICY IF EXISTS "itens_os staff all" ON public.itens_os;
CREATE POLICY "itens_os staff all" ON public.itens_os FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
DROP POLICY IF EXISTS "mat staff read" ON public.materiais;
CREATE POLICY "mat staff read" ON public.materiais FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
DROP POLICY IF EXISTS "prod staff read" ON public.produtos;
CREATE POLICY "prod staff read" ON public.produtos FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));


-- 3.1) Privilégios por coluna: perfis operacionais não recebem SELECT direto
--      sobre colunas financeiras das tabelas transacionais. As rotas devem usar
--      as views abaixo; perfis financeiros leem os valores nas tabelas sensíveis.
REVOKE SELECT ON public.orcamentos FROM authenticated;
GRANT SELECT (
  id, numero, cliente_id, vendedor_id, status, titulo, descricao, validade_dias,
  observacoes, enviado_em, aprovado_em, os_id, created_by, created_at, updated_at
) ON public.orcamentos TO authenticated;

REVOKE SELECT ON public.orcamento_itens FROM authenticated;
GRANT SELECT (
  id, orcamento_id, descricao, quantidade, unidade, ordem, created_at
) ON public.orcamento_itens TO authenticated;

REVOKE SELECT ON public.ordens_servico FROM authenticated;
GRANT SELECT (
  id, numero, cliente_id, orcamento_id, vendedor_id, responsavel_id, designer_id,
  operador_id, status, titulo, briefing, observacoes, prioridade, prazo_entrega,
  data_entrega_real, ordem_kanban, created_by, created_at, updated_at
) ON public.ordens_servico TO authenticated;

REVOKE SELECT ON public.itens_os FROM authenticated;
GRANT SELECT (
  id, os_id, descricao, quantidade, unidade, ordem, created_at
) ON public.itens_os TO authenticated;

REVOKE SELECT ON public.materiais FROM authenticated;
GRANT SELECT (
  id, nome, unidade, estoque, created_at
) ON public.materiais TO authenticated;

REVOKE SELECT ON public.produtos FROM authenticated;
GRANT SELECT (
  id, nome, descricao, ativo, created_at
) ON public.produtos TO authenticated;

-- 4) Views operacionais (security_invoker preserva RLS das tabelas base) --------
CREATE OR REPLACE VIEW public.orcamentos_operacional WITH (security_invoker = true) AS
SELECT
  o.id, o.numero, o.cliente_id, c.nome AS cliente_nome, o.vendedor_id, o.status,
  o.titulo, o.descricao, o.validade_dias, o.observacoes, o.enviado_em,
  o.aprovado_em, o.os_id, o.created_by, o.created_at, o.updated_at
FROM public.orcamentos o
JOIN public.clientes c ON c.id = o.cliente_id;

CREATE OR REPLACE VIEW public.orcamentos_financeiro WITH (security_invoker = true) AS
SELECT
  o.id, o.numero, o.cliente_id, c.nome AS cliente_nome, o.vendedor_id, o.status,
  o.titulo, o.descricao, o.validade_dias, oc.desconto_percentual,
  oc.valor_subtotal, oc.valor_total, oc.custo_estimado, oc.margem_estimada,
  o.observacoes, o.enviado_em, o.aprovado_em, o.os_id, o.created_by,
  o.created_at, o.updated_at
FROM public.orcamentos o
JOIN public.clientes c ON c.id = o.cliente_id
LEFT JOIN public.orcamento_custos oc ON oc.orcamento_id = o.id
WHERE public.can_see_financials(auth.uid());

CREATE OR REPLACE VIEW public.orcamento_itens_operacional WITH (security_invoker = true) AS
SELECT id, orcamento_id, descricao, quantidade, unidade, ordem, created_at
FROM public.orcamento_itens;

CREATE OR REPLACE VIEW public.orcamento_itens_financeiro WITH (security_invoker = true) AS
SELECT oi.id, oi.orcamento_id, oi.descricao, oi.quantidade, oi.unidade,
       oic.valor_unitario, oic.custo_unitario, oic.valor_total,
       oi.ordem, oi.created_at
FROM public.orcamento_itens oi
LEFT JOIN public.orcamento_item_custos oic ON oic.orcamento_item_id = oi.id
WHERE public.can_see_financials(auth.uid());

CREATE OR REPLACE VIEW public.ordens_servico_operacional WITH (security_invoker = true) AS
SELECT
  os.id, os.numero, os.cliente_id, c.nome AS cliente_nome, c.logo_url AS cliente_logo_url,
  os.orcamento_id, os.vendedor_id, os.responsavel_id, os.designer_id, os.operador_id,
  os.status, os.titulo, os.briefing, os.observacoes, os.prioridade, os.prazo_entrega,
  os.data_entrega_real, os.ordem_kanban, os.created_by, os.created_at, os.updated_at
FROM public.ordens_servico os
JOIN public.clientes c ON c.id = os.cliente_id;

CREATE OR REPLACE VIEW public.ordens_servico_financeiro WITH (security_invoker = true) AS
SELECT
  os.id, os.numero, os.cliente_id, c.nome AS cliente_nome, c.logo_url AS cliente_logo_url,
  os.orcamento_id, os.vendedor_id, os.responsavel_id, os.designer_id, os.operador_id,
  os.status, os.titulo, os.briefing, os.observacoes, os.prioridade, os.prazo_entrega,
  os.data_entrega_real, osf.valor_total, osf.custo_previsto, osf.custo_real, osf.margem_real,
  os.ordem_kanban, os.created_by, os.created_at, os.updated_at
FROM public.ordens_servico os
JOIN public.clientes c ON c.id = os.cliente_id
LEFT JOIN public.os_resultados_financeiros osf ON osf.os_id = os.id
WHERE public.can_see_financials(auth.uid());

CREATE OR REPLACE VIEW public.itens_os_operacional WITH (security_invoker = true) AS
SELECT id, os_id, descricao, quantidade, unidade, ordem, created_at
FROM public.itens_os;

CREATE OR REPLACE VIEW public.itens_os_financeiro WITH (security_invoker = true) AS
SELECT io.id, io.os_id, io.descricao, io.quantidade, io.unidade,
       ioc.valor_unitario, ioc.custo_unitario, ioc.valor_total,
       io.ordem, io.created_at
FROM public.itens_os io
LEFT JOIN public.item_os_custos ioc ON ioc.item_os_id = io.id
WHERE public.can_see_financials(auth.uid());

CREATE OR REPLACE VIEW public.materiais_operacional WITH (security_invoker = true) AS
SELECT id, nome, unidade, estoque, created_at
FROM public.materiais;

CREATE OR REPLACE VIEW public.materiais_financeiro WITH (security_invoker = true) AS
SELECT m.id, m.nome, m.unidade, m.estoque, mc.custo_unitario, m.created_at
FROM public.materiais m
LEFT JOIN public.material_custos mc ON mc.material_id = m.id
WHERE public.can_see_financials(auth.uid());

CREATE OR REPLACE VIEW public.produtos_operacional WITH (security_invoker = true) AS
SELECT id, nome, descricao, ativo, created_at
FROM public.produtos;

CREATE OR REPLACE VIEW public.produtos_financeiro WITH (security_invoker = true) AS
SELECT p.id, p.nome, p.descricao, pp.preco_base, pp.custo_base, p.ativo, p.created_at
FROM public.produtos p
LEFT JOIN public.produto_precificacao pp ON pp.produto_id = p.id
WHERE public.can_see_financials(auth.uid());

GRANT SELECT ON public.orcamentos_operacional TO authenticated;
GRANT SELECT ON public.orcamentos_financeiro TO authenticated;
GRANT SELECT ON public.orcamento_itens_operacional TO authenticated;
GRANT SELECT ON public.orcamento_itens_financeiro TO authenticated;
GRANT SELECT ON public.ordens_servico_operacional TO authenticated;
GRANT SELECT ON public.ordens_servico_financeiro TO authenticated;
GRANT SELECT ON public.itens_os_operacional TO authenticated;
GRANT SELECT ON public.itens_os_financeiro TO authenticated;
GRANT SELECT ON public.materiais_operacional TO authenticated;
GRANT SELECT ON public.materiais_financeiro TO authenticated;
GRANT SELECT ON public.produtos_operacional TO authenticated;
GRANT SELECT ON public.produtos_financeiro TO authenticated;
