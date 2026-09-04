CREATE TABLE IF NOT EXISTS public.orcamento_item_arquivos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES public.orcamento_itens(id) ON DELETE CASCADE,
  arquivo_id uuid NOT NULL REFERENCES public.arquivos(id) ON DELETE CASCADE,
  capa boolean NOT NULL DEFAULT false,
  ordem integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_id, arquivo_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.orcamento_item_arquivos TO authenticated;
GRANT ALL ON public.orcamento_item_arquivos TO service_role;

ALTER TABLE public.orcamento_item_arquivos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "orcamento_item_arquivos_all" ON public.orcamento_item_arquivos
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS orcamento_item_arquivos_item_idx ON public.orcamento_item_arquivos(item_id, ordem);

CREATE TRIGGER update_orcamento_item_arquivos_updated_at
  BEFORE UPDATE ON public.orcamento_item_arquivos
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.orcamentos
  ADD COLUMN IF NOT EXISTS aprovado_em timestamptz,
  ADD COLUMN IF NOT EXISTS aprovado_por_nome text,
  ADD COLUMN IF NOT EXISTS aprovado_ip text,
  ADD COLUMN IF NOT EXISTS token_publico text UNIQUE;

INSERT INTO public.orcamento_item_arquivos (item_id, arquivo_id, capa, ordem)
SELECT id, arquivo_id, true, 0 FROM public.orcamento_itens WHERE arquivo_id IS NOT NULL
ON CONFLICT DO NOTHING;