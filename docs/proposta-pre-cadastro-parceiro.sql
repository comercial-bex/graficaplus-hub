-- PROPOSTA SOMENTE: NÃO APLICADA. Pré-cadastro de parceiros pelo agente do WhatsApp.
-- Depende de docs/proposta-tipo-do-lead-parceiro.sql (leads.tipo e anuncios_de_parceiro):
-- aplicar aquela primeiro. Este SQL não altera leads.tipo nem a função de mensagens.
-- Primeiro bloco sem controle de transação (a ferramenta de migração roda como bloco único).

-- 1) Tabela do pré-cadastro por partes: uma linha por conversa, gravada a cada resposta.
CREATE TABLE public.parceiro_pre_cadastros (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversa_id uuid REFERENCES public.whatsapp_conversas(id) ON DELETE SET NULL,
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  telefone_conversa text NOT NULL,
  etapa_atual text NOT NULL DEFAULT 'consentimento'
    CHECK (etapa_atual IN ('consentimento','nome','telefone','email','empresa','ramo','cidade',
                           'instagram','documento','volume','promocoes','conferencia','fim')),
  situacao text NOT NULL DEFAULT 'coletando'
    CHECK (situacao IN ('coletando','minimo_completo','enviado','aprovado','recusado','saiu','transferido','pausado')),
  respondidos text[] NOT NULL DEFAULT '{}',
  tentativas_invalidas smallint NOT NULL DEFAULT 0,
  ultimo_contato_em timestamptz NOT NULL DEFAULT now(),
  lembrete_enviado_em timestamptz,
  aceite_lgpd_em timestamptz,
  nome text,
  telefone_confirmado boolean,
  telefone_cadastro text,
  email text,
  empresa text,
  ramo_atuacao text CHECK (ramo_atuacao IN ('comunicacao_visual','agencia','designer','revendedor_brindes','outro')),
  ramo_outro text,
  cidade text,
  uf text CHECK (uf IS NULL OR uf ~ '^[A-Z]{2}$'),
  instagram_ou_site text,
  documento text CHECK (documento IS NULL OR documento ~ '^([0-9]{11}|[0-9]{14})$'),
  volume_mensal text CHECK (volume_mensal IN ('ate_5','6_20','mais_20')),
  aceita_promocoes boolean,
  aceite_promocoes_em timestamptz,
  fonte text NOT NULL DEFAULT 'texto' CHECK (fonte IN ('anuncio','convite','texto','telefone')),
  anuncio_id text,
  codigo_convite text,
  aprovado_por uuid,
  aprovado_em timestamptz,
  parceiro_id uuid REFERENCES public.parceiros(id) ON DELETE SET NULL,
  motivo_recusa text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT aceite_promocoes_com_data CHECK (aceita_promocoes IS NULL OR aceite_promocoes_em IS NOT NULL)
);
-- Um pré-cadastro em aberto por telefone.
CREATE UNIQUE INDEX parceiro_pre_cadastros_aberto_por_telefone
  ON public.parceiro_pre_cadastros (telefone_conversa)
  WHERE situacao IN ('coletando','minimo_completo','pausado','enviado');
CREATE INDEX parceiro_pre_cadastros_situacao ON public.parceiro_pre_cadastros (situacao, created_at DESC);

-- Leitura só para a equipe de parceiros; escrita só pelo sistema (service_role) e pelas funções abaixo.
GRANT SELECT ON public.parceiro_pre_cadastros TO authenticated;
GRANT ALL ON public.parceiro_pre_cadastros TO service_role;
ALTER TABLE public.parceiro_pre_cadastros ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Equipe de parceiros lê pré-cadastros" ON public.parceiro_pre_cadastros
  FOR SELECT TO authenticated
  USING (public.has_permission(auth.uid(), 'parceiros.read') OR public.has_permission(auth.uid(), 'parceiros.manage'));

-- 2) Colunas complementares em parceiros, preenchidas só na aprovação (opção B).
ALTER TABLE public.parceiros
  ADD COLUMN instagram_ou_site text,
  ADD COLUMN aceita_promocoes boolean,
  ADD COLUMN aceite_promocoes_em timestamptz,
  ADD COLUMN volume_mensal text CHECK (volume_mensal IN ('ate_5','6_20','mais_20')),
  ADD COLUMN pre_cadastro_id uuid REFERENCES public.parceiro_pre_cadastros(id) ON DELETE SET NULL;
-- Sem GRANT de coluna: a ACL de tabela de parceiros já cobre as colunas novas.

-- 3) Aprovar com um clique: cria cliente + parceiro; NÃO cria conta nem senha.
CREATE OR REPLACE FUNCTION public.aprovar_pre_cadastro_parceiro(p_id uuid, p_validar_ramo boolean DEFAULT false)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v public.parceiro_pre_cadastros%ROWTYPE;
  v_cliente uuid;
  v_parceiro uuid;
BEGIN
  IF NOT public.has_permission(auth.uid(), 'parceiros.manage') THEN
    RAISE EXCEPTION 'Sem permissão para aprovar parceiros.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v FROM public.parceiro_pre_cadastros WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pré-cadastro não encontrado.'; END IF;
  IF v.situacao NOT IN ('minimo_completo','enviado','pausado','transferido') OR v.nome IS NULL
     OR v.telefone_cadastro IS NULL OR v.email IS NULL THEN
    RAISE EXCEPTION 'Pré-cadastro sem o mínimo (nome, telefone confirmado e e-mail) ou já decidido.';
  END IF;

  INSERT INTO public.clientes (nome, telefone, email)
  VALUES (COALESCE(v.empresa, v.nome), v.telefone_cadastro, v.email)
  RETURNING id INTO v_cliente;

  INSERT INTO public.parceiros (
    cliente_id, marca_nome, marca_documento, marca_telefone, marca_email, marca_cidade, marca_estado,
    ramo_atuacao, ramo_outro, comprovacao_url, origem_cadastro, validado_em, created_by,
    instagram_ou_site, aceita_promocoes, aceite_promocoes_em, volume_mensal, pre_cadastro_id
  ) VALUES (
    v_cliente, COALESCE(v.empresa, v.nome), v.documento, v.telefone_cadastro, v.email, v.cidade, v.uf,
    v.ramo_atuacao, v.ramo_outro, v.instagram_ou_site,
    jsonb_build_object('canal','whatsapp','fonte',v.fonte,'anuncio_id',v.anuncio_id,'codigo_convite',v.codigo_convite),
    CASE WHEN p_validar_ramo THEN now() END, auth.uid(),
    v.instagram_ou_site, v.aceita_promocoes, v.aceite_promocoes_em, v.volume_mensal, v.id
  ) RETURNING id INTO v_parceiro;

  UPDATE public.parceiro_pre_cadastros
     SET situacao = 'aprovado', aprovado_por = auth.uid(), aprovado_em = now(),
         parceiro_id = v_parceiro, updated_at = now()
   WHERE id = p_id;
  RETURN v_parceiro;
END;
$$;

CREATE OR REPLACE FUNCTION public.recusar_pre_cadastro_parceiro(p_id uuid, p_motivo text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_permission(auth.uid(), 'parceiros.manage') THEN
    RAISE EXCEPTION 'Sem permissão para recusar parceiros.' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(btrim(p_motivo), '') IS NULL THEN RAISE EXCEPTION 'Informe o motivo da recusa.'; END IF;
  UPDATE public.parceiro_pre_cadastros
     SET situacao = 'recusado', motivo_recusa = btrim(p_motivo), aprovado_por = auth.uid(),
         aprovado_em = now(), updated_at = now()
   WHERE id = p_id AND situacao NOT IN ('aprovado','recusado');
  IF NOT FOUND THEN RAISE EXCEPTION 'Pré-cadastro não encontrado ou já decidido.'; END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.aprovar_pre_cadastro_parceiro(uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.recusar_pre_cadastro_parceiro(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.aprovar_pre_cadastro_parceiro(uuid, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.recusar_pre_cadastro_parceiro(uuid, text) TO authenticated, service_role;

-- Observações:
-- * O e-mail do pré-cadastro NÃO cria conta: a equipe libera o acesso pelo cadastro rápido existente
--   ou envia /convite/<codigo>. codigo_convite fica a cargo da rotina atual de convites.
-- * Clientes exige só "nome"; telefone/email são gravados como vieram, já validados no agente.
-- * O agente nunca altera leads.tipo: a cor/selo de parceiro vem só da proposta de tipo do lead.

-- TESTES MANUAIS: somente em ambiente ISOLADO, nunca em produção.
-- 1. Como service_role, inserir pré-cadastro fictício (telefone 5596000000000) com nome/email e
--    situacao 'minimo_completo'; segundo insert aberto com o mesmo telefone deve falhar (índice único).
-- 2. Vendedor sem parceiros.read: SELECT retorna 0 linhas; gestor com parceiros.read vê a linha.
-- 3. aceita_promocoes = true sem aceite_promocoes_em: deve falhar (constraint).
-- 4. aprovar_pre_cadastro_parceiro como usuário sem parceiros.manage: erro 42501.
-- 5. Aprovar como gestor: cria 1 cliente e 1 parceiro com pre_cadastro_id; situacao 'aprovado'.
--    Aprovar de novo: erro "já decidido". Nenhuma conta em auth.users é criada.
-- 6. recusar sem motivo: erro; com motivo: situacao 'recusado'.

-- REVERSÃO SEPARADA, COMENTADA (apaga pré-cadastros; exige autorização explícita):
-- DROP FUNCTION IF EXISTS public.recusar_pre_cadastro_parceiro(uuid, text);
-- DROP FUNCTION IF EXISTS public.aprovar_pre_cadastro_parceiro(uuid, boolean);
-- ALTER TABLE public.parceiros DROP COLUMN IF EXISTS pre_cadastro_id, DROP COLUMN IF EXISTS volume_mensal,
--   DROP COLUMN IF EXISTS aceite_promocoes_em, DROP COLUMN IF EXISTS aceita_promocoes,
--   DROP COLUMN IF EXISTS instagram_ou_site;
-- DROP TABLE IF EXISTS public.parceiro_pre_cadastros;
