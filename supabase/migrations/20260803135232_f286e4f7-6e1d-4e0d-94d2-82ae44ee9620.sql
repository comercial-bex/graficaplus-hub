DROP POLICY IF EXISTS "avatar authenticated read" ON storage.objects;
CREATE POLICY "avatar scoped read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'avatares'
    AND (
      (auth.uid())::text = (storage.foldername(name))[1]
      OR public.is_staff(auth.uid())
    )
  );