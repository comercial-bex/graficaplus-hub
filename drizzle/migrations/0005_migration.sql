DROP POLICY IF EXISTS "prazos_ler" ON public.prazos_de_entrega;
CREATE POLICY "prazos_ler" ON public.prazos_de_entrega FOR SELECT TO authenticated
USING (public.is_staff(auth.uid()) OR public.has_role(auth.uid(), 'parceiro'::app_role));
DROP POLICY IF EXISTS "foto produto leitura publica" ON storage.objects;
DROP POLICY IF EXISTS "foto maquina leitura publica" ON storage.objects;