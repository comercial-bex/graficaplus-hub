-- Histórico do cliente com notas (01/11/2026).
--
-- O Holdprint tem na ficha do cliente a aba Histórico: "Registrar nota" e, embaixo, a linha do tempo
-- ("Cliente cadastrado", quem e quando). Aqui o que a equipe sabe do cliente (combinou entrega às
-- sextas, só paga em Pix, o dono se chama Fulano) ia para "observações", um campo só, que quem edita
-- sobrescreve. A nota é uma linha por registro, com quem escreveu e quando, e ninguém reescreve a
-- nota dos outros.
--
-- Regras de acesso, as mesmas do cliente:
--   ler       quem vê o cliente (equipe com clientes.read);
--   escrever  admin, gestor e vendedor (quem edita o cliente), sempre em nome próprio;
--   apagar    admin e gestor;
--   alterar   ninguém: nota registrada não se reescreve (errou, apaga e escreve outra).
-- Nenhuma regra é "ALL": policy de escrita genérica abre a leitura junto.

CREATE TABLE IF NOT EXISTS public.cliente_notas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id uuid NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  autor_id uuid NOT NULL DEFAULT auth.uid(),
  texto text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cliente_notas_texto_check CHECK (length(btrim(texto)) BETWEEN 1 AND 2000)
);

CREATE INDEX IF NOT EXISTS idx_cliente_notas_cliente ON public.cliente_notas (cliente_id, created_at DESC);

ALTER TABLE public.cliente_notas ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.cliente_notas FROM PUBLIC, anon;
GRANT SELECT, INSERT, DELETE ON public.cliente_notas TO authenticated;
GRANT ALL ON public.cliente_notas TO service_role;

DROP POLICY IF EXISTS "cliente notas read" ON public.cliente_notas;
CREATE POLICY "cliente notas read" ON public.cliente_notas
  FOR SELECT TO authenticated
  USING (is_staff((SELECT auth.uid())) AND has_permission((SELECT auth.uid()), 'clientes.read'::text));

DROP POLICY IF EXISTS "cliente notas insert" ON public.cliente_notas;
CREATE POLICY "cliente notas insert" ON public.cliente_notas
  FOR INSERT TO authenticated
  WITH CHECK (
    autor_id = (SELECT auth.uid())
    AND (has_role((SELECT auth.uid()), 'admin'::app_role)
         OR has_role((SELECT auth.uid()), 'gestor'::app_role)
         OR has_role((SELECT auth.uid()), 'vendedor'::app_role))
  );

DROP POLICY IF EXISTS "cliente notas delete" ON public.cliente_notas;
CREATE POLICY "cliente notas delete" ON public.cliente_notas
  FOR DELETE TO authenticated
  USING (has_role((SELECT auth.uid()), 'admin'::app_role) OR has_role((SELECT auth.uid()), 'gestor'::app_role));
