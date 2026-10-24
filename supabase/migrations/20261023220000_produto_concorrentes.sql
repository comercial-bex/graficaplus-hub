-- Preço dos concorrentes por produto (23/10/2026), para a tabela de preços de
-- Administração, Gerência e Financeiro: custo, venda final, venda parceiro,
-- lucro e 2–3 concorrentes lado a lado. Só quem vê financeiro (permissão
-- financeiro.read, a mesma de custo e margem) lê ou escreve: preço de
-- concorrente anotado ao lado do custo da casa não é assunto de vendedor.
-- Desfazer: DROP TABLE public.produto_concorrentes;
CREATE TABLE IF NOT EXISTS public.produto_concorrentes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  produto_id uuid NOT NULL REFERENCES public.produtos(id) ON DELETE CASCADE,
  concorrente text NOT NULL CHECK (length(btrim(concorrente)) > 0),
  preco numeric(12,2) NOT NULL CHECK (preco > 0),
  fonte text,
  coletado_em date NOT NULL DEFAULT current_date,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS produto_concorrentes_unico
  ON public.produto_concorrentes (produto_id, lower(btrim(concorrente)));

ALTER TABLE public.produto_concorrentes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS produto_concorrentes_financeiro ON public.produto_concorrentes;
CREATE POLICY produto_concorrentes_financeiro ON public.produto_concorrentes
  FOR ALL TO authenticated
  USING (public.can_see_financials(auth.uid()))
  WITH CHECK (public.can_see_financials(auth.uid()));
REVOKE ALL ON public.produto_concorrentes FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.produto_concorrentes TO authenticated;

-- 24/10/2026: o preço anotado pode ser de venda FINAL ou de TERCEIRIZADO/parceiro
-- (a primeira tabela anotada, do "Concorrente 1", é de terceirizados). Comparar
-- preço de parceiro deles com a venda final nossa enganava; cada preço agora
-- diz o que é e só se compara com o nosso do mesmo tipo.
ALTER TABLE public.produto_concorrentes ADD COLUMN IF NOT EXISTS tipo_preco text NOT NULL DEFAULT 'final' CHECK (tipo_preco IN ('final','parceiro'));
DROP INDEX IF EXISTS public.produto_concorrentes_unico;
CREATE UNIQUE INDEX produto_concorrentes_unico ON public.produto_concorrentes (produto_id, lower(btrim(concorrente)), tipo_preco);
