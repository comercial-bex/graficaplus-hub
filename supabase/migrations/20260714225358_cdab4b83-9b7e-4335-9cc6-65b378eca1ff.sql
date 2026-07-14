
ALTER TABLE public.orcamentos_3d
  ADD COLUMN IF NOT EXISTS peso_suporte_g numeric,
  ADD COLUMN IF NOT EXISTS peso_purga_g numeric,
  ADD COLUMN IF NOT EXISTS pecas_por_placa integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS filamento_tipo_detectado text,
  ADD COLUMN IF NOT EXISTS altura_camada_mm numeric,
  ADD COLUMN IF NOT EXISTS infill_pct numeric;
