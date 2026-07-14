
DROP POLICY IF EXISTS "portal_acesso_cliente" ON public.portal_cliente_acessos;
CREATE POLICY "portal_acesso_cliente" ON public.portal_cliente_acessos
  FOR SELECT TO authenticated
  USING (usuario_id = auth.uid());

DROP POLICY IF EXISTS "portal_solicitacao_cliente" ON public.portal_cliente_solicitacoes;
CREATE POLICY "portal_solicitacao_cliente" ON public.portal_cliente_solicitacoes
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM portal_cliente_acessos a
    WHERE a.usuario_id = auth.uid()
      AND a.cliente_id = portal_cliente_solicitacoes.cliente_id
      AND a.ativo
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM portal_cliente_acessos a
    WHERE a.usuario_id = auth.uid()
      AND a.cliente_id = portal_cliente_solicitacoes.cliente_id
      AND a.ativo
  ));

DROP POLICY IF EXISTS "pos_venda_resposta_cliente" ON public.pos_venda_respostas;
CREATE POLICY "pos_venda_resposta_cliente" ON public.pos_venda_respostas
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM portal_cliente_acessos a
    WHERE a.usuario_id = auth.uid()
      AND a.cliente_id = pos_venda_respostas.cliente_id
      AND a.ativo
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM portal_cliente_acessos a
    WHERE a.usuario_id = auth.uid()
      AND a.cliente_id = pos_venda_respostas.cliente_id
      AND a.ativo
  ));

CREATE POLICY "arquivos permission delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'arquivos-clientes'
    AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'gestor'::app_role))
  );
