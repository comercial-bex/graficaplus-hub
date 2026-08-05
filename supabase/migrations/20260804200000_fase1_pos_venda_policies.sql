-- Fase 1 (parte 3) — pós-venda: 4 tabelas com RLS ligada e nenhuma policy.
--
-- pos_venda_tickets, _garantias, _oportunidades e _retornos tinham RLS ativa e
-- zero policies: RLS sem policy nega tudo, então nem staff nem cliente conseguia
-- ler ou escrever. Na prática o backend do módulo existia e era inalcançável.
--
-- As policies seguem o padrão já usado em pos_venda_pesquisas: staff opera,
-- cliente enxerga o que é dele via portal_cliente_acessos. A distinção é o
-- conteúdo financeiro:
--
--   tickets, retornos      -> sem colunas de custo; cliente pode ler os seus
--   garantias              -> tem custo_previsto/custo_real  -> só staff
--   oportunidades          -> pipeline comercial (valor_estimado) -> só staff
--
-- Usa (select auth.uid()) para que o valor seja avaliado uma vez por query em
-- vez de uma vez por linha.

-- tickets: staff opera, cliente lê os seus
DROP POLICY IF EXISTS pos_venda_tickets_staff_all ON public.pos_venda_tickets;
CREATE POLICY pos_venda_tickets_staff_all ON public.pos_venda_tickets
  FOR ALL TO authenticated
  USING (is_staff((select auth.uid())))
  WITH CHECK (is_staff((select auth.uid())));

DROP POLICY IF EXISTS pos_venda_tickets_cliente_read ON public.pos_venda_tickets;
CREATE POLICY pos_venda_tickets_cliente_read ON public.pos_venda_tickets
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.portal_cliente_acessos a
    WHERE a.usuario_id = (select auth.uid())
      AND a.cliente_id = pos_venda_tickets.cliente_id
      AND a.ativo
  ));

-- retornos: staff opera, cliente lê os seus
DROP POLICY IF EXISTS pos_venda_retornos_staff_all ON public.pos_venda_retornos;
CREATE POLICY pos_venda_retornos_staff_all ON public.pos_venda_retornos
  FOR ALL TO authenticated
  USING (is_staff((select auth.uid())))
  WITH CHECK (is_staff((select auth.uid())));

DROP POLICY IF EXISTS pos_venda_retornos_cliente_read ON public.pos_venda_retornos;
CREATE POLICY pos_venda_retornos_cliente_read ON public.pos_venda_retornos
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.portal_cliente_acessos a
    WHERE a.usuario_id = (select auth.uid())
      AND a.cliente_id = pos_venda_retornos.cliente_id
      AND a.ativo
  ));

-- garantias: expõe custo previsto/real, então fica restrita ao staff
DROP POLICY IF EXISTS pos_venda_garantias_staff_all ON public.pos_venda_garantias;
CREATE POLICY pos_venda_garantias_staff_all ON public.pos_venda_garantias
  FOR ALL TO authenticated
  USING (is_staff((select auth.uid())))
  WITH CHECK (is_staff((select auth.uid())));

-- oportunidades: pipeline comercial interno, não vai para o portal do cliente
DROP POLICY IF EXISTS pos_venda_oportunidades_staff_all ON public.pos_venda_oportunidades;
CREATE POLICY pos_venda_oportunidades_staff_all ON public.pos_venda_oportunidades
  FOR ALL TO authenticated
  USING (is_staff((select auth.uid())))
  WITH CHECK (is_staff((select auth.uid())));
