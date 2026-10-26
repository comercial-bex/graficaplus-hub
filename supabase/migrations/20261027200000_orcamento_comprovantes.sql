-- Comprovante de pagamento POR ORÇAMENTO (27/10/2026).
--
-- Pix pago por fora do QR do sistema (ou direto na conta) não deixava rastro: a equipe marcava
-- "O Pix chegou" de memória. Agora o comprovante é anexado ao orçamento, pela equipe ou pelo
-- cliente (página pública do orçamento), e a baixa do Pix pede o comprovante.
--
-- O arquivo fica no bucket privado `comprovantes` (pasta orcamento/<id>/). A tabela só guarda a
-- referência; quem grava é o servidor (chave de serviço) depois de conferir a permissão ou o
-- link do cliente. A equipe lê pela policy abaixo.
CREATE TABLE IF NOT EXISTS public.orcamento_comprovantes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  orcamento_id uuid NOT NULL REFERENCES public.orcamentos(id) ON DELETE CASCADE,
  caminho text NOT NULL,
  nome text NOT NULL,
  mime_type text,
  tamanho_bytes integer,
  origem text NOT NULL CHECK (origem IN ('cliente', 'equipe')),
  enviado_por uuid,
  conferido_em timestamptz,
  conferido_por uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS orcamento_comprovantes_orcamento_idx ON public.orcamento_comprovantes (orcamento_id, created_at DESC);

ALTER TABLE public.orcamento_comprovantes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "equipe le comprovantes do orcamento" ON public.orcamento_comprovantes;
CREATE POLICY "equipe le comprovantes do orcamento" ON public.orcamento_comprovantes
  FOR SELECT TO authenticated
  USING (public.has_permission(auth.uid(), 'orcamentos.update') OR public.has_permission(auth.uid(), 'pagamentos.confirm'));

REVOKE ALL ON public.orcamento_comprovantes FROM PUBLIC, anon;
GRANT SELECT ON public.orcamento_comprovantes TO authenticated;
GRANT ALL ON public.orcamento_comprovantes TO service_role;

COMMENT ON TABLE public.orcamento_comprovantes IS 'Comprovantes de pagamento anexados ao orçamento (equipe ou cliente). Só o servidor grava.';
