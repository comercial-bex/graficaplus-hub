-- =========================================================================
-- GraficaPlus Hub — expansão incremental do schema PRD
-- =========================================================================
-- Convenções de nomenclatura:
-- - Mantém created_at/updated_at como padrão técnico do projeto (não cria criado_em).
-- - Adiciona nomes canônicos do PRD sem remover legados ainda usados pelo app:
--   clientes.cpf_cnpj espelha clientes.documento;
--   clientes.tipo_cliente espelha clientes.tipo;
--   ordens_servico.numero_os espelha ordens_servico.numero.

-- ------------------------- EXPANSÃO: CLIENTES ----------------------------
ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS nome_fantasia TEXT,
  ADD COLUMN IF NOT EXISTS cpf_cnpj TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp_principal TEXT,
  ADD COLUMN IF NOT EXISTS bairro TEXT,
  ADD COLUMN IF NOT EXISTS origem TEXT,
  ADD COLUMN IF NOT EXISTS tipo_cliente public.tipo_cliente,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ativo',
  ADD COLUMN IF NOT EXISTS ultima_interacao TIMESTAMPTZ;

UPDATE public.clientes
SET cpf_cnpj = COALESCE(cpf_cnpj, documento),
    tipo_cliente = COALESCE(tipo_cliente, tipo),
    nome_fantasia = COALESCE(nome_fantasia, nome),
    whatsapp_principal = COALESCE(whatsapp_principal, telefone),
    status = CASE WHEN ativo THEN COALESCE(NULLIF(status, ''), 'ativo') ELSE 'inativo' END
WHERE cpf_cnpj IS NULL
   OR tipo_cliente IS NULL
   OR nome_fantasia IS NULL
   OR whatsapp_principal IS NULL
   OR status IS NULL
   OR status = '';

ALTER TABLE public.clientes
  ALTER COLUMN tipo_cliente SET DEFAULT 'pj',
  ALTER COLUMN tipo_cliente SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_clientes_cpf_cnpj ON public.clientes(cpf_cnpj);
CREATE INDEX IF NOT EXISTS idx_clientes_status ON public.clientes(status);
CREATE INDEX IF NOT EXISTS idx_clientes_ultima_interacao ON public.clientes(ultima_interacao DESC);

-- ------------------------- EXPANSÃO: ORDENS DE SERVIÇO -------------------
ALTER TABLE public.ordens_servico
  ADD COLUMN IF NOT EXISTS numero_os INTEGER,
  ADD COLUMN IF NOT EXISTS contato_id UUID REFERENCES public.cliente_contatos(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS status_financeiro public.status_pagamento NOT NULL DEFAULT 'pendente',
  ADD COLUMN IF NOT EXISTS status_arte TEXT NOT NULL DEFAULT 'pendente',
  ADD COLUMN IF NOT EXISTS status_producao TEXT NOT NULL DEFAULT 'aguardando',
  ADD COLUMN IF NOT EXISTS prazo_cliente TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS prazo_interno TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS valor_venda NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lucro_previsto NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lucro_real NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS margem_prevista NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS precisa_entrega BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS precisa_instalacao BOOLEAN NOT NULL DEFAULT false;

UPDATE public.ordens_servico
SET numero_os = COALESCE(numero_os, numero),
    prazo_cliente = COALESCE(prazo_cliente, prazo_entrega::timestamptz),
    prazo_interno = COALESCE(prazo_interno, prazo_entrega::timestamptz),
    valor_venda = COALESCE(NULLIF(valor_venda, 0), valor_total),
    lucro_previsto = COALESCE(NULLIF(lucro_previsto, 0), valor_total - custo_previsto),
    lucro_real = COALESCE(NULLIF(lucro_real, 0), valor_total - custo_real),
    margem_prevista = COALESCE(margem_prevista, CASE WHEN valor_total > 0 THEN ROUND(((valor_total - custo_previsto) / valor_total) * 100, 2) END)
WHERE numero_os IS NULL
   OR prazo_cliente IS NULL
   OR prazo_interno IS NULL
   OR valor_venda = 0
   OR lucro_previsto = 0
   OR lucro_real = 0
   OR margem_prevista IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ordens_servico_numero_os ON public.ordens_servico(numero_os);
CREATE INDEX IF NOT EXISTS idx_ordens_servico_contato_id ON public.ordens_servico(contato_id);
CREATE INDEX IF NOT EXISTS idx_ordens_servico_status_financeiro ON public.ordens_servico(status_financeiro);
CREATE INDEX IF NOT EXISTS idx_ordens_servico_prazos ON public.ordens_servico(prazo_interno, prazo_cliente);

-- ------------------------- EXPANSÃO: PRODUTOS ----------------------------
ALTER TABLE public.produtos
  ADD COLUMN IF NOT EXISTS categoria TEXT,
  ADD COLUMN IF NOT EXISTS maquina_padrao_id UUID REFERENCES public.maquinas(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS material_principal_id UUID REFERENCES public.materiais(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS exigencias TEXT,
  ADD COLUMN IF NOT EXISTS margem_minima NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS margem_sugerida NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS preco_minimo NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS preco_sugerido NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS preco_publico NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

UPDATE public.produtos
SET preco_minimo = COALESCE(preco_minimo, preco_base),
    preco_sugerido = COALESCE(preco_sugerido, preco_base),
    preco_publico = COALESCE(preco_publico, preco_base)
WHERE preco_base IS NOT NULL
  AND (preco_minimo IS NULL OR preco_sugerido IS NULL OR preco_publico IS NULL);

DROP TRIGGER IF EXISTS tg_produtos_updated ON public.produtos;
CREATE TRIGGER tg_produtos_updated BEFORE UPDATE ON public.produtos FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE INDEX IF NOT EXISTS idx_produtos_categoria ON public.produtos(categoria);
CREATE INDEX IF NOT EXISTS idx_produtos_maquina_padrao_id ON public.produtos(maquina_padrao_id);
CREATE INDEX IF NOT EXISTS idx_produtos_material_principal_id ON public.produtos(material_principal_id);

-- ------------------------- EXPANSÃO: MATERIAIS ---------------------------
ALTER TABLE public.materiais
  ADD COLUMN IF NOT EXISTS fornecedor TEXT,
  ADD COLUMN IF NOT EXISTS custo_medio NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS estoque_minimo NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS estoque_maximo NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS localizacao TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ativo',
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

UPDATE public.materiais
SET custo_medio = COALESCE(custo_medio, custo_unitario)
WHERE custo_medio IS NULL AND custo_unitario IS NOT NULL;

DROP TRIGGER IF EXISTS tg_materiais_updated ON public.materiais;
CREATE TRIGGER tg_materiais_updated BEFORE UPDATE ON public.materiais FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE INDEX IF NOT EXISTS idx_materiais_fornecedor ON public.materiais(fornecedor);
CREATE INDEX IF NOT EXISTS idx_materiais_status ON public.materiais(status);
CREATE INDEX IF NOT EXISTS idx_materiais_localizacao ON public.materiais(localizacao);

-- ------------------------- AGENDA DE MÁQUINAS ----------------------------
CREATE TABLE IF NOT EXISTS public.agenda_maquinas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  maquina_id UUID NOT NULL REFERENCES public.maquinas(id) ON DELETE CASCADE,
  os_id UUID REFERENCES public.ordens_servico(id) ON DELETE SET NULL,
  item_os_id UUID REFERENCES public.itens_os(id) ON DELETE SET NULL,
  operador_id UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  titulo TEXT NOT NULL,
  descricao TEXT,
  inicio TIMESTAMPTZ NOT NULL,
  fim TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'agendado',
  prioridade INT NOT NULL DEFAULT 3,
  observacoes TEXT,
  created_by UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT agenda_maquinas_periodo_valido CHECK (fim > inicio)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agenda_maquinas TO authenticated;
GRANT ALL ON public.agenda_maquinas TO service_role;
ALTER TABLE public.agenda_maquinas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "agenda maq staff read" ON public.agenda_maquinas FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "agenda maq staff write" ON public.agenda_maquinas FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
DROP TRIGGER IF EXISTS tg_agenda_maquinas_updated ON public.agenda_maquinas;
CREATE TRIGGER tg_agenda_maquinas_updated BEFORE UPDATE ON public.agenda_maquinas FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE INDEX IF NOT EXISTS idx_agenda_maquinas_maquina_periodo ON public.agenda_maquinas(maquina_id, inicio, fim);
CREATE INDEX IF NOT EXISTS idx_agenda_maquinas_os_id ON public.agenda_maquinas(os_id);

-- ------------------------- MANUTENÇÕES ----------------------------------
CREATE TABLE IF NOT EXISTS public.manutencoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  maquina_id UUID NOT NULL REFERENCES public.maquinas(id) ON DELETE CASCADE,
  responsavel_id UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  tipo TEXT NOT NULL DEFAULT 'preventiva',
  titulo TEXT NOT NULL,
  descricao TEXT,
  status TEXT NOT NULL DEFAULT 'agendada',
  data_programada TIMESTAMPTZ,
  data_inicio TIMESTAMPTZ,
  data_conclusao TIMESTAMPTZ,
  custo_previsto NUMERIC(12,2) NOT NULL DEFAULT 0,
  custo_real NUMERIC(12,2) NOT NULL DEFAULT 0,
  observacoes TEXT,
  created_by UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.manutencoes TO authenticated;
GRANT ALL ON public.manutencoes TO service_role;
ALTER TABLE public.manutencoes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "manutencoes staff read" ON public.manutencoes FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "manutencoes staff write" ON public.manutencoes FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
DROP TRIGGER IF EXISTS tg_manutencoes_updated ON public.manutencoes;
CREATE TRIGGER tg_manutencoes_updated BEFORE UPDATE ON public.manutencoes FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE INDEX IF NOT EXISTS idx_manutencoes_maquina_id ON public.manutencoes(maquina_id);
CREATE INDEX IF NOT EXISTS idx_manutencoes_status_data ON public.manutencoes(status, data_programada);

-- ------------------------- PRECIFICAÇÃO DE PRODUTOS ----------------------
CREATE TABLE IF NOT EXISTS public.produto_precificacao (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  produto_id UUID NOT NULL REFERENCES public.produtos(id) ON DELETE CASCADE,
  material_id UUID REFERENCES public.materiais(id) ON DELETE SET NULL,
  maquina_id UUID REFERENCES public.maquinas(id) ON DELETE SET NULL,
  nome TEXT NOT NULL,
  unidade TEXT NOT NULL DEFAULT 'un',
  quantidade_base NUMERIC(12,4) NOT NULL DEFAULT 1,
  custo_material NUMERIC(12,2) NOT NULL DEFAULT 0,
  custo_maquina NUMERIC(12,2) NOT NULL DEFAULT 0,
  custo_mao_obra NUMERIC(12,2) NOT NULL DEFAULT 0,
  custo_indireto NUMERIC(12,2) NOT NULL DEFAULT 0,
  margem_percentual NUMERIC(5,2) NOT NULL DEFAULT 0,
  preco_calculado NUMERIC(12,2) NOT NULL DEFAULT 0,
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.produto_precificacao TO authenticated;
GRANT ALL ON public.produto_precificacao TO service_role;
ALTER TABLE public.produto_precificacao ENABLE ROW LEVEL SECURITY;
CREATE POLICY "prod prec staff read" ON public.produto_precificacao FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "prod prec admin write" ON public.produto_precificacao FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'gestor'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'gestor'));
DROP TRIGGER IF EXISTS tg_produto_precificacao_updated ON public.produto_precificacao;
CREATE TRIGGER tg_produto_precificacao_updated BEFORE UPDATE ON public.produto_precificacao FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE INDEX IF NOT EXISTS idx_produto_precificacao_produto_id ON public.produto_precificacao(produto_id);
CREATE INDEX IF NOT EXISTS idx_produto_precificacao_ativo ON public.produto_precificacao(ativo);

-- ------------------------- CHECKLISTS -----------------------------------
CREATE TABLE IF NOT EXISTS public.checklist_modelos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  descricao TEXT,
  tipo TEXT NOT NULL DEFAULT 'producao',
  produto_id UUID REFERENCES public.produtos(id) ON DELETE SET NULL,
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.checklist_itens_modelo (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  modelo_id UUID NOT NULL REFERENCES public.checklist_modelos(id) ON DELETE CASCADE,
  titulo TEXT NOT NULL,
  descricao TEXT,
  obrigatorio BOOLEAN NOT NULL DEFAULT true,
  ordem INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.checklists_os (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  os_id UUID NOT NULL REFERENCES public.ordens_servico(id) ON DELETE CASCADE,
  modelo_id UUID REFERENCES public.checklist_modelos(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pendente',
  responsavel_id UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  concluido_em TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.checklist_respostas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  checklist_id UUID NOT NULL REFERENCES public.checklists_os(id) ON DELETE CASCADE,
  item_modelo_id UUID REFERENCES public.checklist_itens_modelo(id) ON DELETE SET NULL,
  valor BOOLEAN NOT NULL DEFAULT false,
  observacao TEXT,
  respondido_por UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  respondido_em TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.checklist_modelos, public.checklist_itens_modelo, public.checklists_os, public.checklist_respostas TO authenticated;
GRANT ALL ON public.checklist_modelos, public.checklist_itens_modelo, public.checklists_os, public.checklist_respostas TO service_role;
ALTER TABLE public.checklist_modelos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checklist_itens_modelo ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checklists_os ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checklist_respostas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "checklist modelos staff all" ON public.checklist_modelos FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "checklist itens staff all" ON public.checklist_itens_modelo FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "checklists os staff all" ON public.checklists_os FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "checklist respostas staff all" ON public.checklist_respostas FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
DROP TRIGGER IF EXISTS tg_checklist_modelos_updated ON public.checklist_modelos;
CREATE TRIGGER tg_checklist_modelos_updated BEFORE UPDATE ON public.checklist_modelos FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
DROP TRIGGER IF EXISTS tg_checklists_os_updated ON public.checklists_os;
CREATE TRIGGER tg_checklists_os_updated BEFORE UPDATE ON public.checklists_os FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE INDEX IF NOT EXISTS idx_checklists_os_os_id ON public.checklists_os(os_id);
CREATE INDEX IF NOT EXISTS idx_checklist_respostas_checklist_id ON public.checklist_respostas(checklist_id);

-- ------------------------- AUTOMAÇÕES -----------------------------------
CREATE TABLE IF NOT EXISTS public.automacoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  descricao TEXT,
  gatilho TEXT NOT NULL,
  canal TEXT NOT NULL DEFAULT 'sistema',
  condicoes JSONB NOT NULL DEFAULT '{}'::jsonb,
  acoes JSONB NOT NULL DEFAULT '[]'::jsonb,
  ativa BOOLEAN NOT NULL DEFAULT true,
  ultima_execucao TIMESTAMPTZ,
  created_by UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.automacao_execucoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  automacao_id UUID REFERENCES public.automacoes(id) ON DELETE SET NULL,
  referencia_tipo TEXT,
  referencia_id UUID,
  status TEXT NOT NULL DEFAULT 'pendente',
  entrada JSONB NOT NULL DEFAULT '{}'::jsonb,
  resultado JSONB NOT NULL DEFAULT '{}'::jsonb,
  erro TEXT,
  executado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.automacoes, public.automacao_execucoes TO authenticated;
GRANT ALL ON public.automacoes, public.automacao_execucoes TO service_role;
ALTER TABLE public.automacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automacao_execucoes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "automacoes staff all" ON public.automacoes FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "automacao exec staff all" ON public.automacao_execucoes FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
DROP TRIGGER IF EXISTS tg_automacoes_updated ON public.automacoes;
CREATE TRIGGER tg_automacoes_updated BEFORE UPDATE ON public.automacoes FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE INDEX IF NOT EXISTS idx_automacoes_gatilho_ativa ON public.automacoes(gatilho, ativa);
CREATE INDEX IF NOT EXISTS idx_automacao_execucoes_ref ON public.automacao_execucoes(referencia_tipo, referencia_id);

-- ------------------------- WHATSAPP -------------------------------------
CREATE TABLE IF NOT EXISTS public.whatsapp_contas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  numero TEXT NOT NULL,
  provedor TEXT NOT NULL DEFAULT 'meta',
  phone_number_id TEXT,
  business_account_id TEXT,
  status TEXT NOT NULL DEFAULT 'desconectado',
  configuracoes JSONB NOT NULL DEFAULT '{}'::jsonb,
  ultimo_sync TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.whatsapp_contatos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id UUID REFERENCES public.clientes(id) ON DELETE SET NULL,
  contato_id UUID REFERENCES public.cliente_contatos(id) ON DELETE SET NULL,
  nome TEXT,
  telefone TEXT NOT NULL,
  wa_id TEXT,
  opt_in BOOLEAN NOT NULL DEFAULT true,
  ultima_interacao TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.whatsapp_conversas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conta_id UUID REFERENCES public.whatsapp_contas(id) ON DELETE SET NULL,
  whatsapp_contato_id UUID NOT NULL REFERENCES public.whatsapp_contatos(id) ON DELETE CASCADE,
  cliente_id UUID REFERENCES public.clientes(id) ON DELETE SET NULL,
  os_id UUID REFERENCES public.ordens_servico(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'aberta',
  assunto TEXT,
  responsavel_id UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  ultima_mensagem_em TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.whatsapp_mensagens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversa_id UUID NOT NULL REFERENCES public.whatsapp_conversas(id) ON DELETE CASCADE,
  conta_id UUID REFERENCES public.whatsapp_contas(id) ON DELETE SET NULL,
  remetente_tipo TEXT NOT NULL DEFAULT 'cliente',
  direcao TEXT NOT NULL DEFAULT 'entrada',
  tipo TEXT NOT NULL DEFAULT 'texto',
  conteudo TEXT,
  media_url TEXT,
  template_nome TEXT,
  provider_message_id TEXT,
  status TEXT NOT NULL DEFAULT 'recebida',
  erro TEXT,
  enviado_por UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  enviado_em TIMESTAMPTZ,
  entregue_em TIMESTAMPTZ,
  lido_em TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.whatsapp_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conta_id UUID REFERENCES public.whatsapp_contas(id) ON DELETE SET NULL,
  nome TEXT NOT NULL,
  categoria TEXT,
  idioma TEXT NOT NULL DEFAULT 'pt_BR',
  corpo TEXT NOT NULL,
  parametros JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'rascunho',
  provider_template_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.whatsapp_disparos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID REFERENCES public.whatsapp_templates(id) ON DELETE SET NULL,
  automacao_id UUID REFERENCES public.automacoes(id) ON DELETE SET NULL,
  nome TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'rascunho',
  filtros JSONB NOT NULL DEFAULT '{}'::jsonb,
  total_destinatarios INT NOT NULL DEFAULT 0,
  total_enviados INT NOT NULL DEFAULT 0,
  total_falhas INT NOT NULL DEFAULT 0,
  agendado_para TIMESTAMPTZ,
  iniciado_em TIMESTAMPTZ,
  concluido_em TIMESTAMPTZ,
  created_by UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.whatsapp_webhooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conta_id UUID REFERENCES public.whatsapp_contas(id) ON DELETE SET NULL,
  provider_event_id TEXT,
  evento TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  processado BOOLEAN NOT NULL DEFAULT false,
  erro TEXT,
  recebido_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  processado_em TIMESTAMPTZ
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_contas, public.whatsapp_contatos, public.whatsapp_conversas, public.whatsapp_mensagens, public.whatsapp_templates, public.whatsapp_disparos, public.whatsapp_webhooks TO authenticated;
GRANT ALL ON public.whatsapp_contas, public.whatsapp_contatos, public.whatsapp_conversas, public.whatsapp_mensagens, public.whatsapp_templates, public.whatsapp_disparos, public.whatsapp_webhooks TO service_role;
ALTER TABLE public.whatsapp_contas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_contatos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_conversas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_mensagens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_disparos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_webhooks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "whatsapp contas staff all" ON public.whatsapp_contas FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "whatsapp contatos staff all" ON public.whatsapp_contatos FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "whatsapp conversas staff all" ON public.whatsapp_conversas FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "whatsapp mensagens staff all" ON public.whatsapp_mensagens FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "whatsapp templates staff all" ON public.whatsapp_templates FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "whatsapp disparos staff all" ON public.whatsapp_disparos FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "whatsapp webhooks staff all" ON public.whatsapp_webhooks FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
DROP TRIGGER IF EXISTS tg_whatsapp_contas_updated ON public.whatsapp_contas;
CREATE TRIGGER tg_whatsapp_contas_updated BEFORE UPDATE ON public.whatsapp_contas FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
DROP TRIGGER IF EXISTS tg_whatsapp_contatos_updated ON public.whatsapp_contatos;
CREATE TRIGGER tg_whatsapp_contatos_updated BEFORE UPDATE ON public.whatsapp_contatos FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
DROP TRIGGER IF EXISTS tg_whatsapp_conversas_updated ON public.whatsapp_conversas;
CREATE TRIGGER tg_whatsapp_conversas_updated BEFORE UPDATE ON public.whatsapp_conversas FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
DROP TRIGGER IF EXISTS tg_whatsapp_templates_updated ON public.whatsapp_templates;
CREATE TRIGGER tg_whatsapp_templates_updated BEFORE UPDATE ON public.whatsapp_templates FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
DROP TRIGGER IF EXISTS tg_whatsapp_disparos_updated ON public.whatsapp_disparos;
CREATE TRIGGER tg_whatsapp_disparos_updated BEFORE UPDATE ON public.whatsapp_disparos FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_contatos_telefone ON public.whatsapp_contatos(telefone);
CREATE INDEX IF NOT EXISTS idx_whatsapp_conversas_status ON public.whatsapp_conversas(status, ultima_mensagem_em DESC);
CREATE INDEX IF NOT EXISTS idx_whatsapp_mensagens_conversa_created ON public.whatsapp_mensagens(conversa_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_whatsapp_webhooks_processado ON public.whatsapp_webhooks(processado, recebido_em);

-- ------------------------- PÓS-CÁLCULO E HISTÓRICO -----------------------
CREATE TABLE IF NOT EXISTS public.pos_calculos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  os_id UUID NOT NULL REFERENCES public.ordens_servico(id) ON DELETE CASCADE,
  valor_venda NUMERIC(12,2) NOT NULL DEFAULT 0,
  custo_previsto NUMERIC(12,2) NOT NULL DEFAULT 0,
  custo_real NUMERIC(12,2) NOT NULL DEFAULT 0,
  lucro_previsto NUMERIC(12,2) NOT NULL DEFAULT 0,
  lucro_real NUMERIC(12,2) NOT NULL DEFAULT 0,
  margem_prevista NUMERIC(5,2),
  margem_real NUMERIC(5,2),
  divergencias JSONB NOT NULL DEFAULT '[]'::jsonb,
  observacoes TEXT,
  calculado_por UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  calculado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pos_calculo_itens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pos_calculo_id UUID NOT NULL REFERENCES public.pos_calculos(id) ON DELETE CASCADE,
  item_os_id UUID REFERENCES public.itens_os(id) ON DELETE SET NULL,
  descricao TEXT NOT NULL,
  custo_previsto NUMERIC(12,2) NOT NULL DEFAULT 0,
  custo_real NUMERIC(12,2) NOT NULL DEFAULT 0,
  quantidade NUMERIC(12,2) NOT NULL DEFAULT 1,
  observacoes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.historico_alteracoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entidade TEXT NOT NULL,
  entidade_id UUID NOT NULL,
  acao TEXT NOT NULL,
  campo TEXT,
  valor_anterior JSONB,
  valor_novo JSONB,
  usuario_id UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  origem TEXT NOT NULL DEFAULT 'sistema',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.historico_os_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  os_id UUID NOT NULL REFERENCES public.ordens_servico(id) ON DELETE CASCADE,
  status_anterior public.status_os,
  status_novo public.status_os NOT NULL,
  usuario_id UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  observacao TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pos_calculos, public.pos_calculo_itens TO authenticated;
GRANT SELECT, INSERT ON public.historico_alteracoes, public.historico_os_status TO authenticated;
GRANT ALL ON public.pos_calculos, public.pos_calculo_itens, public.historico_alteracoes, public.historico_os_status TO service_role;
ALTER TABLE public.pos_calculos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_calculo_itens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.historico_alteracoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.historico_os_status ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pos calculos staff all" ON public.pos_calculos FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "pos calculo itens staff all" ON public.pos_calculo_itens FOR ALL TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "historico alteracoes staff read" ON public.historico_alteracoes FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "historico alteracoes staff insert" ON public.historico_alteracoes FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "historico os staff read" ON public.historico_os_status FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "historico os staff insert" ON public.historico_os_status FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()));
DROP TRIGGER IF EXISTS tg_pos_calculos_updated ON public.pos_calculos;
CREATE TRIGGER tg_pos_calculos_updated BEFORE UPDATE ON public.pos_calculos FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE INDEX IF NOT EXISTS idx_pos_calculos_os_id ON public.pos_calculos(os_id);
CREATE INDEX IF NOT EXISTS idx_historico_alteracoes_entidade ON public.historico_alteracoes(entidade, entidade_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_historico_os_status_os_id ON public.historico_os_status(os_id, created_at DESC);
