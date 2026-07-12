
-- Portal do cliente: acesso de leitura a documentos e pesquisas de pós-venda vinculadas
ALTER TABLE public.pos_venda_pesquisas ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.pos_venda_pesquisas TO authenticated;
GRANT ALL ON public.pos_venda_pesquisas TO service_role;

DROP POLICY IF EXISTS "pesquisa_cliente_read" ON public.pos_venda_pesquisas;
CREATE POLICY "pesquisa_cliente_read" ON public.pos_venda_pesquisas FOR SELECT TO authenticated
USING (
  public.is_staff(auth.uid())
  OR EXISTS (SELECT 1 FROM public.portal_cliente_acessos a WHERE a.usuario_id=auth.uid() AND a.cliente_id=pos_venda_pesquisas.cliente_id AND a.ativo)
);

DROP POLICY IF EXISTS "pesquisa_staff_write" ON public.pos_venda_pesquisas;
CREATE POLICY "pesquisa_staff_write" ON public.pos_venda_pesquisas FOR ALL TO authenticated
USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

-- Documentos: permitir leitura ao cliente do portal quando o documento referencia uma OS/orçamento do próprio cliente
DROP POLICY IF EXISTS "docs portal cliente read" ON public.documentos_gerados;
CREATE POLICY "docs portal cliente read" ON public.documentos_gerados FOR SELECT TO authenticated
USING (
  (tipo='os' AND EXISTS (
    SELECT 1 FROM public.ordens_servico o
    JOIN public.portal_cliente_acessos a ON a.cliente_id=o.cliente_id AND a.usuario_id=auth.uid() AND a.ativo
    WHERE o.id=documentos_gerados.referencia_id AND documentos_gerados.variante='cliente'
  ))
  OR
  (tipo='orcamento' AND EXISTS (
    SELECT 1 FROM public.orcamentos oc
    JOIN public.portal_cliente_acessos a ON a.cliente_id=oc.cliente_id AND a.usuario_id=auth.uid() AND a.ativo
    WHERE oc.id=documentos_gerados.referencia_id AND documentos_gerados.variante='cliente'
  ))
);

-- Grants para portal cliente enviar solicitações (já tem policy)
GRANT SELECT, INSERT ON public.portal_cliente_solicitacoes TO authenticated;
GRANT ALL ON public.portal_cliente_solicitacoes TO service_role;
