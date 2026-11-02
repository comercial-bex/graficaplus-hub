-- O resultado da réplica do atendente: cada mensagem real do cliente, o que a IA responderia e o que a equipe
-- respondeu de verdade (02/11/2026). Nada aqui vai para o cliente. Quem vê as conversas é quem pode ver a réplica,
-- porque ela repete o texto delas.

CREATE TABLE IF NOT EXISTS public.atendente_ensaios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversa_id uuid NOT NULL REFERENCES public.whatsapp_conversas(id) ON DELETE CASCADE,
  ordem integer NOT NULL,
  mensagem_cliente text NOT NULL,
  tipo_mensagem text NOT NULL DEFAULT 'texto',
  resposta_ia text NOT NULL,
  resposta_equipe text,
  acao text NOT NULL CHECK (acao IN ('responder', 'transferir')),
  motivo text,
  itens jsonb NOT NULL DEFAULT '[]'::jsonb,
  valor numeric,
  confianca numeric,
  avaliacao text CHECK (avaliacao IS NULL OR avaliacao IN ('certo', 'errado')),
  observacao text,
  criado_por uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conversa_id, ordem)
);

ALTER TABLE public.atendente_ensaios ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.atendente_ensaios FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.atendente_ensaios TO authenticated;

CREATE POLICY "atendente_ensaios leitura" ON public.atendente_ensaios FOR SELECT TO authenticated
  USING (public.has_permission((SELECT auth.uid()), 'whatsapp.read'));
CREATE POLICY "atendente_ensaios escrita" ON public.atendente_ensaios FOR ALL TO authenticated
  USING (public.has_permission((SELECT auth.uid()), 'whatsapp.read') AND public.has_permission((SELECT auth.uid()), 'orcamentos.create'))
  WITH CHECK (public.has_permission((SELECT auth.uid()), 'whatsapp.read') AND public.has_permission((SELECT auth.uid()), 'orcamentos.create'));
