DROP POLICY IF EXISTS "empresa_config_leitura" ON public.empresa_config;
CREATE POLICY "empresa_config_leitura" ON public.empresa_config FOR SELECT TO authenticated USING (public.is_staff((SELECT auth.uid())));
DROP POLICY IF EXISTS "perfil_permissoes read" ON public.perfil_permissoes;
DROP POLICY IF EXISTS "perfil_permissoes read all" ON public.perfil_permissoes;
CREATE POLICY "perfil_permissoes read" ON public.perfil_permissoes FOR SELECT TO authenticated USING (public.is_staff((SELECT auth.uid())));
DROP POLICY IF EXISTS "permissoes read all" ON public.permissoes;
CREATE POLICY "permissoes read" ON public.permissoes FOR SELECT TO authenticated USING (public.is_staff((SELECT auth.uid())));
DROP POLICY IF EXISTS "produto_tamanhos_leitura" ON public.produto_tamanhos;
CREATE POLICY "produto_tamanhos_leitura" ON public.produto_tamanhos FOR SELECT TO authenticated USING (public.is_staff((SELECT auth.uid())));