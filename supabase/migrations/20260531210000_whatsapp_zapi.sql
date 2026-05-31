-- =========================================================================
-- WhatsApp / Z-API integration
-- =========================================================================

CREATE TYPE public.whatsapp_instancia_status AS ENUM ('desconectada','conectando','conectada','erro');
CREATE TYPE public.whatsapp_conversa_status AS ENUM ('aberta','pendente','resolvida','arquivada');
CREATE TYPE public.whatsapp_mensagem_direcao AS ENUM ('entrada','saida');
CREATE TYPE public.whatsapp_mensagem_tipo AS ENUM ('texto','imagem','documento','audio','video','sticker','localizacao','contato','sistema');
CREATE TYPE public.whatsapp_mensagem_status AS ENUM ('recebida','pendente','enviada','entregue','lida','falha');
CREATE TYPE public.whatsapp_automacao_gatilho AS ENUM ('mensagem_recebida','palavra_chave','fora_horario','primeiro_contato','status_conexao');
CREATE TYPE public.whatsapp_log_tipo AS ENUM ('envio_texto','envio_imagem','envio_documento','webhook_mensagem','webhook_status','webhook_conexao','erro');

CREATE OR REPLACE FUNCTION public.normalize_whatsapp_phone(_phone TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT NULLIF(regexp_replace(COALESCE(_phone, ''), '\\D', '', 'g'), '')
$$;

CREATE TABLE IF NOT EXISTS public.leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  telefone TEXT,
  telefone_normalizado TEXT GENERATED ALWAYS AS (public.normalize_whatsapp_phone(telefone)) STORED,
  email TEXT,
  origem TEXT NOT NULL DEFAULT 'manual',
  interesse TEXT,
  responsavel_id UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'novo',
  temporario BOOLEAN NOT NULL DEFAULT false,
  cliente_id UUID REFERENCES public.clientes(id) ON DELETE SET NULL,
  observacoes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT leads_status_check CHECK (status IN ('novo','em_atendimento','orcamento','ganho','perdido'))
);

CREATE UNIQUE INDEX IF NOT EXISTS leads_telefone_temporario_unique
  ON public.leads (telefone_normalizado) WHERE temporario IS TRUE AND telefone_normalizado IS NOT NULL;
CREATE INDEX IF NOT EXISTS leads_status_idx ON public.leads(status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.leads TO authenticated;
GRANT ALL ON public.leads TO service_role;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "leads staff read" ON public.leads FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "leads staff insert" ON public.leads FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "leads staff update" ON public.leads FOR UPDATE TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "leads admin delete" ON public.leads FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'gestor'));
DROP TRIGGER IF EXISTS tg_leads_updated ON public.leads;
CREATE TRIGGER tg_leads_updated BEFORE UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS telefone_normalizado TEXT GENERATED ALWAYS AS (public.normalize_whatsapp_phone(telefone)) STORED;
CREATE INDEX IF NOT EXISTS clientes_telefone_normalizado_idx ON public.clientes(telefone_normalizado);

CREATE TABLE public.whatsapp_instancias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  zapi_instance_id TEXT NOT NULL,
  numero TEXT,
  numero_normalizado TEXT GENERATED ALWAYS AS (public.normalize_whatsapp_phone(numero)) STORED,
  status public.whatsapp_instancia_status NOT NULL DEFAULT 'desconectada',
  conectado BOOLEAN NOT NULL DEFAULT false,
  ultimo_evento_at TIMESTAMPTZ,
  webhook_secret_hash TEXT,
  metadados JSONB NOT NULL DEFAULT '{}'::jsonb,
  ativa BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (zapi_instance_id)
);

CREATE TABLE public.whatsapp_conversas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instancia_id UUID NOT NULL REFERENCES public.whatsapp_instancias(id) ON DELETE CASCADE,
  telefone TEXT NOT NULL,
  telefone_normalizado TEXT GENERATED ALWAYS AS (public.normalize_whatsapp_phone(telefone)) STORED,
  nome_contato TEXT,
  cliente_id UUID REFERENCES public.clientes(id) ON DELETE SET NULL,
  lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  os_id UUID REFERENCES public.ordens_servico(id) ON DELETE SET NULL,
  status public.whatsapp_conversa_status NOT NULL DEFAULT 'aberta',
  etiquetas TEXT[] NOT NULL DEFAULT '{}',
  ultima_mensagem TEXT,
  ultima_mensagem_at TIMESTAMPTZ,
  nao_lidas INT NOT NULL DEFAULT 0,
  atribuido_para UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  metadados JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (instancia_id, telefone_normalizado)
);

CREATE TABLE public.whatsapp_mensagens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversa_id UUID NOT NULL REFERENCES public.whatsapp_conversas(id) ON DELETE CASCADE,
  instancia_id UUID NOT NULL REFERENCES public.whatsapp_instancias(id) ON DELETE CASCADE,
  zapi_message_id TEXT,
  direcao public.whatsapp_mensagem_direcao NOT NULL,
  tipo public.whatsapp_mensagem_tipo NOT NULL DEFAULT 'texto',
  status public.whatsapp_mensagem_status NOT NULL DEFAULT 'recebida',
  texto TEXT,
  legenda TEXT,
  media_url TEXT,
  storage_bucket TEXT,
  storage_path TEXT,
  arquivo_id UUID REFERENCES public.arquivos(id) ON DELETE SET NULL,
  cliente_id UUID REFERENCES public.clientes(id) ON DELETE SET NULL,
  os_id UUID REFERENCES public.ordens_servico(id) ON DELETE SET NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  erro TEXT,
  enviada_por UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  recebido_em TIMESTAMPTZ,
  enviado_em TIMESTAMPTZ,
  entregue_em TIMESTAMPTZ,
  lido_em TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (instancia_id, zapi_message_id)
);

CREATE TABLE public.whatsapp_automacoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instancia_id UUID REFERENCES public.whatsapp_instancias(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  gatilho public.whatsapp_automacao_gatilho NOT NULL,
  condicoes JSONB NOT NULL DEFAULT '{}'::jsonb,
  acoes JSONB NOT NULL DEFAULT '[]'::jsonb,
  ativa BOOLEAN NOT NULL DEFAULT true,
  prioridade INT NOT NULL DEFAULT 100,
  created_by UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.whatsapp_respostas_rapidas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo TEXT NOT NULL,
  atalho TEXT,
  conteudo TEXT NOT NULL,
  categoria TEXT,
  anexos JSONB NOT NULL DEFAULT '[]'::jsonb,
  ativa BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (atalho)
);

CREATE TABLE public.whatsapp_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instancia_id UUID REFERENCES public.whatsapp_instancias(id) ON DELETE SET NULL,
  conversa_id UUID REFERENCES public.whatsapp_conversas(id) ON DELETE SET NULL,
  mensagem_id UUID REFERENCES public.whatsapp_mensagens(id) ON DELETE SET NULL,
  tipo public.whatsapp_log_tipo NOT NULL,
  sucesso BOOLEAN NOT NULL DEFAULT true,
  request JSONB,
  response JSONB,
  erro TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX whatsapp_conversas_ultima_idx ON public.whatsapp_conversas(ultima_mensagem_at DESC NULLS LAST);
CREATE INDEX whatsapp_conversas_cliente_idx ON public.whatsapp_conversas(cliente_id);
CREATE INDEX whatsapp_conversas_lead_idx ON public.whatsapp_conversas(lead_id);
CREATE INDEX whatsapp_mensagens_conversa_created_idx ON public.whatsapp_mensagens(conversa_id, created_at);
CREATE INDEX whatsapp_mensagens_zapi_idx ON public.whatsapp_mensagens(zapi_message_id);
CREATE INDEX whatsapp_logs_created_idx ON public.whatsapp_logs(created_at DESC);

DO $$
DECLARE tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['whatsapp_instancias','whatsapp_conversas','whatsapp_mensagens','whatsapp_automacoes','whatsapp_respostas_rapidas','whatsapp_logs'] LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', tbl);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', tbl);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('CREATE POLICY "%s staff all" ON public.%I FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()))', tbl, tbl);
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS tg_whatsapp_instancias_updated ON public.whatsapp_instancias;
CREATE TRIGGER tg_whatsapp_instancias_updated BEFORE UPDATE ON public.whatsapp_instancias FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
DROP TRIGGER IF EXISTS tg_whatsapp_conversas_updated ON public.whatsapp_conversas;
CREATE TRIGGER tg_whatsapp_conversas_updated BEFORE UPDATE ON public.whatsapp_conversas FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
DROP TRIGGER IF EXISTS tg_whatsapp_mensagens_updated ON public.whatsapp_mensagens;
CREATE TRIGGER tg_whatsapp_mensagens_updated BEFORE UPDATE ON public.whatsapp_mensagens FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
DROP TRIGGER IF EXISTS tg_whatsapp_automacoes_updated ON public.whatsapp_automacoes;
CREATE TRIGGER tg_whatsapp_automacoes_updated BEFORE UPDATE ON public.whatsapp_automacoes FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
DROP TRIGGER IF EXISTS tg_whatsapp_respostas_rapidas_updated ON public.whatsapp_respostas_rapidas;
CREATE TRIGGER tg_whatsapp_respostas_rapidas_updated BEFORE UPDATE ON public.whatsapp_respostas_rapidas FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

INSERT INTO storage.buckets (id, name, public) VALUES ('whatsapp-midias','whatsapp-midias', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "whatsapp midias staff read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id='whatsapp-midias' AND public.is_staff(auth.uid()));
CREATE POLICY "whatsapp midias staff write" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id='whatsapp-midias' AND public.is_staff(auth.uid()));
CREATE POLICY "whatsapp midias staff update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id='whatsapp-midias' AND public.is_staff(auth.uid()));
