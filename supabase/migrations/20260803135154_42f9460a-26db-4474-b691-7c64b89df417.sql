DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', r.sig);
  END LOOP;
END $$;

REVOKE EXECUTE ON FUNCTION public.require_permission(text) FROM authenticated;

DROP POLICY IF EXISTS "arqtoken staff" ON public.arquivo_tokens_externos;
CREATE POLICY "arqtoken admin gestor" ON public.arquivo_tokens_externos
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'gestor'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'gestor'));

DROP POLICY IF EXISTS "avatar authenticated read" ON storage.objects;
CREATE POLICY "avatar authenticated read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'avatares');

DROP POLICY IF EXISTS "slicer read" ON storage.objects;
DROP POLICY IF EXISTS "slicer write" ON storage.objects;
DROP POLICY IF EXISTS "slicer update" ON storage.objects;
DROP POLICY IF EXISTS "slicer delete" ON storage.objects;
CREATE POLICY "slicer read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'slicer-imports' AND (public.has_permission(auth.uid(),'impressao3d.quote.read') OR public.has_permission(auth.uid(),'impressao3d.quote.update')));
CREATE POLICY "slicer write" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'slicer-imports' AND public.has_permission(auth.uid(),'impressao3d.quote.update'));
CREATE POLICY "slicer update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'slicer-imports' AND public.has_permission(auth.uid(),'impressao3d.quote.update'));
CREATE POLICY "slicer delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'slicer-imports' AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'gestor')));