
CREATE TABLE public.produto_materiais (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  produto_id uuid NOT NULL REFERENCES public.produtos(id) ON DELETE CASCADE,
  material_id uuid NOT NULL REFERENCES public.materiais(id) ON DELETE CASCADE,
  quantidade_por_unidade numeric NOT NULL DEFAULT 1,
  observacao text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (produto_id, material_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.produto_materiais TO authenticated;
GRANT ALL ON public.produto_materiais TO service_role;

ALTER TABLE public.produto_materiais ENABLE ROW LEVEL SECURITY;

CREATE POLICY "prodmat staff read" ON public.produto_materiais
  FOR SELECT TO authenticated USING (is_staff(auth.uid()));

CREATE POLICY "prodmat admin write" ON public.produto_materiais
  FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'gestor') OR has_role(auth.uid(),'estoque'))
  WITH CHECK (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'gestor') OR has_role(auth.uid(),'estoque'));

CREATE INDEX idx_produto_materiais_produto ON public.produto_materiais(produto_id);
CREATE INDEX idx_produto_materiais_material ON public.produto_materiais(material_id);

-- Add produto_id reference on itens_os to track which product was used (optional)
ALTER TABLE public.itens_os ADD COLUMN IF NOT EXISTS produto_id uuid REFERENCES public.produtos(id) ON DELETE SET NULL;
ALTER TABLE public.orcamento_itens ADD COLUMN IF NOT EXISTS produto_id uuid REFERENCES public.produtos(id) ON DELETE SET NULL;

-- Track which OS already had stock decremented to prevent double consumption
ALTER TABLE public.ordens_servico ADD COLUMN IF NOT EXISTS estoque_baixado boolean NOT NULL DEFAULT false;
ALTER TABLE public.ordens_servico ADD COLUMN IF NOT EXISTS estoque_baixado_em timestamp with time zone;
