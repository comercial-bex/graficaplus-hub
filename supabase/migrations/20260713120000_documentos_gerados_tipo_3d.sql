-- Achado de homologação: o CHECK de documentos_gerados.tipo só permitia
-- ('orcamento','os') e barrava o registro do PDF de orçamento 3D (tipo
-- 'orcamento_3d', introduzido na PR #33).
ALTER TABLE public.documentos_gerados DROP CONSTRAINT IF EXISTS documentos_gerados_tipo_check;
ALTER TABLE public.documentos_gerados ADD CONSTRAINT documentos_gerados_tipo_check
  CHECK (tipo = ANY (ARRAY['orcamento'::text, 'os'::text, 'orcamento_3d'::text]));
