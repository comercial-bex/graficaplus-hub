-- Bucket privado para PDFs gerados
INSERT INTO storage.buckets (id, name, public) 
VALUES ('documentos-pdf', 'documentos-pdf', false)
ON CONFLICT (id) DO NOTHING;

-- Policies de storage para staff
CREATE POLICY "pdf staff read"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'documentos-pdf' AND public.is_staff(auth.uid()));

CREATE POLICY "pdf staff insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'documentos-pdf' AND public.is_staff(auth.uid()));

CREATE POLICY "pdf staff delete"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'documentos-pdf' AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'gestor')));

-- Tabela de histórico de documentos gerados
CREATE TABLE public.documentos_gerados (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo text NOT NULL CHECK (tipo IN ('orcamento','os')),
  referencia_id uuid NOT NULL,
  variante text NOT NULL DEFAULT 'cliente' CHECK (variante IN ('cliente','producao')),
  numero integer,
  caminho text NOT NULL,
  tamanho_bytes bigint,
  gerado_por uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX idx_documentos_gerados_ref ON public.documentos_gerados(tipo, referencia_id, created_at DESC);

GRANT SELECT, INSERT, DELETE ON public.documentos_gerados TO authenticated;
GRANT ALL ON public.documentos_gerados TO service_role;

ALTER TABLE public.documentos_gerados ENABLE ROW LEVEL SECURITY;

CREATE POLICY "docs staff read" ON public.documentos_gerados
FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

CREATE POLICY "docs staff insert" ON public.documentos_gerados
FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()));

CREATE POLICY "docs admin delete" ON public.documentos_gerados
FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'gestor'));
