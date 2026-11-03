-- Preço especial para clientes (plano de 02/11/2026, decisão 5, OK do dono):
-- o "Preço especial para clientes" da aba Preço do Holdprint. Um preço de
-- venda do produto combinado com UM cliente, que o item do orçamento usa no
-- lugar do preço de tabela quando o orçamento é desse cliente (fora do modo
-- parceiro, que tem a própria tabela).
--
-- Leitura: preço é informação de quem vê preço (can_see_prices). Escrita: admin
-- e gestor, na pasta do produto. Nada para anon.

CREATE TABLE IF NOT EXISTS public.produto_precos_cliente (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  produto_id uuid NOT NULL REFERENCES public.produtos(id) ON DELETE CASCADE,
  cliente_id uuid NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  preco numeric NOT NULL CHECK (preco >= 0),
  observacao text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL,
  UNIQUE (produto_id, cliente_id)
);

CREATE INDEX IF NOT EXISTS produto_precos_cliente_cliente_idx ON public.produto_precos_cliente (cliente_id);

COMMENT ON TABLE public.produto_precos_cliente IS
  'Preço de venda do produto combinado com um cliente. O item do orçamento desse cliente entra com este preço no lugar do de tabela (fora do modo parceiro).';

ALTER TABLE public.produto_precos_cliente ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "preco especial quem ve preco le" ON public.produto_precos_cliente;
CREATE POLICY "preco especial quem ve preco le" ON public.produto_precos_cliente
  FOR SELECT TO authenticated
  USING (public.can_see_prices((select auth.uid())));

DROP POLICY IF EXISTS "preco especial admin escreve" ON public.produto_precos_cliente;
CREATE POLICY "preco especial admin escreve" ON public.produto_precos_cliente
  FOR ALL TO authenticated
  USING (
    public.has_role((select auth.uid()), 'admin'::public.app_role)
    OR public.has_role((select auth.uid()), 'gestor'::public.app_role)
  )
  WITH CHECK (
    public.has_role((select auth.uid()), 'admin'::public.app_role)
    OR public.has_role((select auth.uid()), 'gestor'::public.app_role)
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.produto_precos_cliente TO authenticated;
REVOKE ALL ON public.produto_precos_cliente FROM anon;
