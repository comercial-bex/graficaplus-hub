-- Tabelas operacionais usadas pelas telas que antes dependiam de src/lib/mock-data.ts

-- Leads / clientes temporários
CREATE TABLE IF NOT EXISTS public.leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  origem TEXT,
  interesse TEXT,
  responsavel TEXT,
  status TEXT NOT NULL DEFAULT 'novo' CHECK (status IN ('novo','em_atendimento','orcamento','ganho','perdido')),
  cliente_id UUID REFERENCES public.clientes(id) ON DELETE SET NULL,
  observacoes TEXT,
  concluido_em TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.leads TO authenticated;
GRANT ALL ON public.leads TO service_role;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "leads staff all" ON public.leads;
CREATE POLICY "leads staff all" ON public.leads FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
DROP TRIGGER IF EXISTS tg_leads_updated ON public.leads;
CREATE TRIGGER tg_leads_updated BEFORE UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Completa ocorrências para custos/retrabalho/setor/conclusão
ALTER TABLE public.ocorrencias ADD COLUMN IF NOT EXISTS setor TEXT;
ALTER TABLE public.ocorrencias ADD COLUMN IF NOT EXISTS custo NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.ocorrencias ADD COLUMN IF NOT EXISTS retrabalho BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.ocorrencias ADD COLUMN IF NOT EXISTS resolvida_em TIMESTAMPTZ;
ALTER TABLE public.ocorrencias ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
DROP TRIGGER IF EXISTS tg_ocorrencias_updated ON public.ocorrencias;
CREATE TRIGGER tg_ocorrencias_updated BEFORE UPDATE ON public.ocorrencias FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Manutenção
CREATE TABLE IF NOT EXISTS public.manutencoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  maquina_id UUID REFERENCES public.maquinas(id) ON DELETE SET NULL,
  maquina_nome TEXT,
  tipo TEXT NOT NULL,
  data_prevista DATE,
  data_conclusao DATE,
  status TEXT NOT NULL DEFAULT 'agendada' CHECK (status IN ('agendada','em_andamento','concluida','cancelada')),
  custo NUMERIC(12,2) NOT NULL DEFAULT 0,
  observacoes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.manutencoes TO authenticated;
GRANT ALL ON public.manutencoes TO service_role;
ALTER TABLE public.manutencoes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "manutencoes staff all" ON public.manutencoes;
CREATE POLICY "manutencoes staff all" ON public.manutencoes FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
DROP TRIGGER IF EXISTS tg_manutencoes_updated ON public.manutencoes;
CREATE TRIGGER tg_manutencoes_updated BEFORE UPDATE ON public.manutencoes FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Agenda de máquinas
CREATE TABLE IF NOT EXISTS public.maquinas_agenda (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  maquina_id UUID NOT NULL REFERENCES public.maquinas(id) ON DELETE CASCADE,
  os_id UUID REFERENCES public.ordens_servico(id) ON DELETE SET NULL,
  titulo TEXT NOT NULL,
  inicio TIMESTAMPTZ NOT NULL,
  fim TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'agendado' CHECK (status IN ('agendado','em_producao','concluido','cancelado')),
  observacoes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.maquinas_agenda TO authenticated;
GRANT ALL ON public.maquinas_agenda TO service_role;
ALTER TABLE public.maquinas_agenda ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "maquinas agenda staff all" ON public.maquinas_agenda;
CREATE POLICY "maquinas agenda staff all" ON public.maquinas_agenda FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
DROP TRIGGER IF EXISTS tg_maquinas_agenda_updated ON public.maquinas_agenda;
CREATE TRIGGER tg_maquinas_agenda_updated BEFORE UPDATE ON public.maquinas_agenda FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Respostas rápidas
CREATE TABLE IF NOT EXISTS public.respostas_rapidas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  categoria TEXT NOT NULL DEFAULT 'Geral',
  titulo TEXT NOT NULL,
  texto TEXT NOT NULL,
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.respostas_rapidas TO authenticated;
GRANT ALL ON public.respostas_rapidas TO service_role;
ALTER TABLE public.respostas_rapidas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "respostas rapidas staff all" ON public.respostas_rapidas;
CREATE POLICY "respostas rapidas staff all" ON public.respostas_rapidas FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
DROP TRIGGER IF EXISTS tg_respostas_rapidas_updated ON public.respostas_rapidas;
CREATE TRIGGER tg_respostas_rapidas_updated BEFORE UPDATE ON public.respostas_rapidas FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Automações
CREATE TABLE IF NOT EXISTS public.automacoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gatilho TEXT NOT NULL,
  mensagem TEXT NOT NULL,
  ativo BOOLEAN NOT NULL DEFAULT true,
  ultima_execucao_em TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.automacoes TO authenticated;
GRANT ALL ON public.automacoes TO service_role;
ALTER TABLE public.automacoes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "automacoes staff all" ON public.automacoes;
CREATE POLICY "automacoes staff all" ON public.automacoes FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
DROP TRIGGER IF EXISTS tg_automacoes_updated ON public.automacoes;
CREATE TRIGGER tg_automacoes_updated BEFORE UPDATE ON public.automacoes FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Relatórios configuráveis
CREATE TABLE IF NOT EXISTS public.relatorios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grupo TEXT NOT NULL,
  nome TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','gerado','arquivado')),
  descricao TEXT,
  gerado_em TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.relatorios TO authenticated;
GRANT ALL ON public.relatorios TO service_role;
ALTER TABLE public.relatorios ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "relatorios staff all" ON public.relatorios;
CREATE POLICY "relatorios staff all" ON public.relatorios FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
DROP TRIGGER IF EXISTS tg_relatorios_updated ON public.relatorios;
CREATE TRIGGER tg_relatorios_updated BEFORE UPDATE ON public.relatorios FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Conversas/mensagens para WhatsApp interno
CREATE TABLE IF NOT EXISTS public.whatsapp_conversas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  numero TEXT,
  ultima_mensagem TEXT,
  etiqueta TEXT,
  nao_lidas INT NOT NULL DEFAULT 0,
  ultima_interacao TIMESTAMPTZ NOT NULL DEFAULT now(),
  cliente_id UUID REFERENCES public.clientes(id) ON DELETE SET NULL,
  lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_conversas TO authenticated;
GRANT ALL ON public.whatsapp_conversas TO service_role;
ALTER TABLE public.whatsapp_conversas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "whatsapp conversas staff all" ON public.whatsapp_conversas;
CREATE POLICY "whatsapp conversas staff all" ON public.whatsapp_conversas FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
DROP TRIGGER IF EXISTS tg_whatsapp_conversas_updated ON public.whatsapp_conversas;
CREATE TRIGGER tg_whatsapp_conversas_updated BEFORE UPDATE ON public.whatsapp_conversas FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE IF NOT EXISTS public.whatsapp_mensagens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversa_id UUID NOT NULL REFERENCES public.whatsapp_conversas(id) ON DELETE CASCADE,
  direcao TEXT NOT NULL DEFAULT 'out' CHECK (direcao IN ('in','out')),
  texto TEXT NOT NULL,
  enviada_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_mensagens TO authenticated;
GRANT ALL ON public.whatsapp_mensagens TO service_role;
ALTER TABLE public.whatsapp_mensagens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "whatsapp mensagens staff all" ON public.whatsapp_mensagens;
CREATE POLICY "whatsapp mensagens staff all" ON public.whatsapp_mensagens FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
ALTER TABLE public.ocorrencias ALTER COLUMN os_id DROP NOT NULL;
ALTER TABLE public.entregas_instalacoes ALTER COLUMN os_id DROP NOT NULL;
