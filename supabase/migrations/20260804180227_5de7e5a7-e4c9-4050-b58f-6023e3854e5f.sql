-- 1) Matriz de permissões: RLS explícita + grants
GRANT SELECT, INSERT, UPDATE, DELETE ON public.perfil_permissoes TO authenticated;
GRANT ALL ON public.perfil_permissoes TO service_role;
GRANT SELECT ON public.role_permission_matrix TO authenticated;
GRANT SELECT ON public.role_permission_matrix TO service_role;

DROP POLICY IF EXISTS "perfil_permissoes read" ON public.perfil_permissoes;
CREATE POLICY "perfil_permissoes read" ON public.perfil_permissoes
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "perfil_permissoes admin insert" ON public.perfil_permissoes;
CREATE POLICY "perfil_permissoes admin insert" ON public.perfil_permissoes
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_permission(auth.uid(), 'permissoes.manage'));

DROP POLICY IF EXISTS "perfil_permissoes admin update" ON public.perfil_permissoes;
CREATE POLICY "perfil_permissoes admin update" ON public.perfil_permissoes
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_permission(auth.uid(), 'permissoes.manage'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_permission(auth.uid(), 'permissoes.manage'));

DROP POLICY IF EXISTS "perfil_permissoes admin delete" ON public.perfil_permissoes;
CREATE POLICY "perfil_permissoes admin delete" ON public.perfil_permissoes
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_permission(auth.uid(), 'permissoes.manage'));

-- 2) Leads e WhatsApp: exigir permissão específica em vez de is_staff amplo
DROP POLICY IF EXISTS "leads staff read" ON public.leads;
CREATE POLICY "leads permission read" ON public.leads
  FOR SELECT TO authenticated USING (public.has_permission(auth.uid(), 'leads.read'));

DROP POLICY IF EXISTS "leads staff insert" ON public.leads;
CREATE POLICY "leads permission insert" ON public.leads
  FOR INSERT TO authenticated WITH CHECK (public.has_permission(auth.uid(), 'leads.create'));

DROP POLICY IF EXISTS "leads staff update" ON public.leads;
CREATE POLICY "leads permission update" ON public.leads
  FOR UPDATE TO authenticated
  USING (public.has_permission(auth.uid(), 'leads.update'))
  WITH CHECK (public.has_permission(auth.uid(), 'leads.update'));

DROP POLICY IF EXISTS "whatsapp_conversas staff all" ON public.whatsapp_conversas;
CREATE POLICY "whatsapp_conversas permission read" ON public.whatsapp_conversas
  FOR SELECT TO authenticated USING (public.has_permission(auth.uid(), 'whatsapp.read'));
CREATE POLICY "whatsapp_conversas permission write" ON public.whatsapp_conversas
  FOR ALL TO authenticated
  USING (public.has_permission(auth.uid(), 'whatsapp.reply'))
  WITH CHECK (public.has_permission(auth.uid(), 'whatsapp.reply'));

DROP POLICY IF EXISTS "whatsapp_mensagens staff all" ON public.whatsapp_mensagens;
CREATE POLICY "whatsapp_mensagens permission read" ON public.whatsapp_mensagens
  FOR SELECT TO authenticated USING (public.has_permission(auth.uid(), 'whatsapp.read'));
CREATE POLICY "whatsapp_mensagens permission write" ON public.whatsapp_mensagens
  FOR ALL TO authenticated
  USING (public.has_permission(auth.uid(), 'whatsapp.reply'))
  WITH CHECK (public.has_permission(auth.uid(), 'whatsapp.reply'));

-- 3) slicer_imports: políticas explícitas por ação
DROP POLICY IF EXISTS impressao3d_quote_children_manage ON public.slicer_imports;
CREATE POLICY slicer_imports_insert ON public.slicer_imports
  FOR INSERT TO authenticated
  WITH CHECK (public.has_permission(auth.uid(), 'impressao3d.quote.update'));
CREATE POLICY slicer_imports_update ON public.slicer_imports
  FOR UPDATE TO authenticated
  USING (public.has_permission(auth.uid(), 'impressao3d.quote.update'))
  WITH CHECK (public.has_permission(auth.uid(), 'impressao3d.quote.update'));
CREATE POLICY slicer_imports_delete ON public.slicer_imports
  FOR DELETE TO authenticated
  USING (public.has_permission(auth.uid(), 'impressao3d.quote.update'));
