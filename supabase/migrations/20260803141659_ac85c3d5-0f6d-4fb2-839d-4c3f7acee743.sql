DROP VIEW IF EXISTS public.orcamentos_operacional;
DROP VIEW IF EXISTS public.orcamentos_financeiro;

CREATE VIEW public.orcamentos_operacional
WITH (security_invoker = true) AS
SELECT o.id, o.numero, o.cliente_id, c.nome AS cliente_nome,
       o.contato_nome, o.contato_telefone, o.contato_email,
       o.vendedor_id, o.status, o.titulo, o.descricao, o.validade_dias,
       o.observacoes, o.enviado_em, o.aprovado_em, o.os_id, o.created_by,
       o.created_at, o.updated_at
FROM public.orcamentos o
LEFT JOIN public.clientes c ON c.id = o.cliente_id;

CREATE VIEW public.orcamentos_financeiro
WITH (security_invoker = true) AS
SELECT o.id, o.numero, o.cliente_id, c.nome AS cliente_nome,
       o.contato_nome, o.contato_telefone, o.contato_email,
       o.vendedor_id, o.status, o.titulo, o.descricao, o.validade_dias,
       oc.desconto_percentual, oc.valor_subtotal, oc.valor_total,
       oc.custo_estimado, oc.margem_estimada,
       o.observacoes, o.enviado_em, o.aprovado_em, o.os_id, o.created_by,
       o.created_at, o.updated_at
FROM public.orcamentos o
LEFT JOIN public.clientes c ON c.id = o.cliente_id
LEFT JOIN public.orcamento_custos oc ON oc.orcamento_id = o.id
WHERE public.can_see_financials(auth.uid());

GRANT SELECT ON public.orcamentos_operacional TO authenticated;
GRANT SELECT ON public.orcamentos_financeiro TO authenticated;