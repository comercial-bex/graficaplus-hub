-- Parte 1: fundação comercial, permissões, CRM, orçamento, OS, financeiro e auditoria.

CREATE TABLE IF NOT EXISTS public.permissoes (
  chave TEXT PRIMARY KEY,
  dominio TEXT NOT NULL,
  descricao TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.perfil_permissoes (
  perfil TEXT NOT NULL,
  permissao TEXT NOT NULL REFERENCES public.permissoes(chave) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (perfil, permissao)
);

INSERT INTO public.permissoes (chave, dominio, descricao) VALUES
('leads.read','crm','Ler leads'),('leads.create','crm','Criar leads'),('leads.update','crm','Atualizar leads'),('leads.assign','crm','Atribuir leads'),('leads.convert','crm','Converter leads'),('leads.delete','crm','Excluir leads'),
('clientes.read','crm','Ler clientes'),('clientes.create','crm','Criar clientes'),('clientes.update','crm','Atualizar clientes'),('clientes.delete','crm','Excluir clientes'),('clientes.sensitive.read','crm','Ler dados sensíveis'),
('whatsapp.read','whatsapp','Ler atendimento'),('whatsapp.reply','whatsapp','Responder'),('whatsapp.assign','whatsapp','Atribuir'),('whatsapp.transfer','whatsapp','Transferir'),('whatsapp.manage','whatsapp','Gerenciar'),('automacoes.read','whatsapp','Ler automações'),('automacoes.manage','whatsapp','Gerenciar automações'),('templates.manage','whatsapp','Gerenciar templates'),
('orcamentos.read','orcamentos','Ler orçamentos'),('orcamentos.create','orcamentos','Criar orçamentos'),('orcamentos.update','orcamentos','Atualizar orçamentos'),('orcamentos.send','orcamentos','Enviar orçamentos'),('orcamentos.approve','orcamentos','Aprovar orçamentos'),('orcamentos.cancel','orcamentos','Cancelar orçamentos'),('orcamentos.convert','orcamentos','Converter em OS'),('desconto.request','orcamentos','Solicitar desconto'),('desconto.approve','orcamentos','Aprovar desconto'),('margem.read','orcamentos','Ler margem'),
('os.read','os','Ler OS'),('os.create','os','Criar OS'),('os.update','os','Atualizar OS'),('os.assign','os','Atribuir OS'),('os.status.advance','os','Avançar status'),('os.status.override','os','Forçar status'),('os.close','os','Fechar OS'),('kanban.move','os','Compatibilidade: movimentar Kanban'),('instalacao.update','os','Compatibilidade: atualizar instalação'),('arquivos.approve','os','Compatibilidade: aprovar arquivos'),
('financeiro.read','financeiro','Ler financeiro'),('financeiro.sensitive.read','financeiro','Ler financeiro sensível'),('pagamentos.create','financeiro','Criar pagamentos'),('pagamentos.update','financeiro','Atualizar pagamentos'),('pagamentos.confirm','financeiro','Confirmar pagamentos'),('pagamentos.reverse','financeiro','Estornar pagamentos'),('custos.read','financeiro','Ler custos'),('resultado.read','financeiro','Ler resultado'),('estoque.cost.read','financeiro','Compatibilidade: ler custos de estoque'),
('usuarios.read','admin','Ler usuários'),('usuarios.manage','admin','Gerenciar usuários'),('permissoes.manage','admin','Gerenciar permissões'),('logs.read','admin','Ler logs'),('configuracoes.manage','admin','Gerenciar configurações')
ON CONFLICT (chave) DO UPDATE SET dominio = EXCLUDED.dominio, descricao = EXCLUDED.descricao;

INSERT INTO public.perfil_permissoes (perfil, permissao)
SELECT p.perfil, pe.chave
FROM (VALUES ('administrador'),('admin')) AS p(perfil)
CROSS JOIN public.permissoes pe
ON CONFLICT DO NOTHING;

INSERT INTO public.perfil_permissoes (perfil, permissao) VALUES
('gerente','leads.read'),('gerente','leads.create'),('gerente','leads.update'),('gerente','leads.assign'),('gerente','leads.convert'),('gerente','clientes.read'),('gerente','clientes.create'),('gerente','clientes.update'),('gerente','clientes.sensitive.read'),('gerente','whatsapp.read'),('gerente','whatsapp.reply'),('gerente','whatsapp.assign'),('gerente','whatsapp.transfer'),('gerente','orcamentos.read'),('gerente','orcamentos.create'),('gerente','orcamentos.update'),('gerente','orcamentos.send'),('gerente','orcamentos.approve'),('gerente','orcamentos.convert'),('gerente','margem.read'),('gerente','os.read'),('gerente','os.create'),('gerente','os.update'),('gerente','os.assign'),('gerente','os.status.advance'),('gerente','financeiro.read'),('gerente','logs.read'),
('gestor','leads.read'),('gestor','leads.create'),('gestor','leads.update'),('gestor','leads.assign'),('gestor','leads.convert'),('gestor','clientes.read'),('gestor','clientes.create'),('gestor','clientes.update'),('gestor','clientes.sensitive.read'),('gestor','orcamentos.read'),('gestor','orcamentos.create'),('gestor','orcamentos.update'),('gestor','orcamentos.send'),('gestor','orcamentos.approve'),('gestor','orcamentos.convert'),('gestor','os.read'),('gestor','os.status.advance'),('gestor','financeiro.read'),('gestor','logs.read'),
('financeiro','clientes.read'),('financeiro','orcamentos.read'),('financeiro','os.read'),('financeiro','financeiro.read'),('financeiro','financeiro.sensitive.read'),('financeiro','pagamentos.create'),('financeiro','pagamentos.update'),('financeiro','pagamentos.confirm'),('financeiro','pagamentos.reverse'),('financeiro','custos.read'),('financeiro','resultado.read'),
('vendedor','leads.read'),('vendedor','leads.create'),('vendedor','leads.update'),('vendedor','leads.assign'),('vendedor','leads.convert'),('vendedor','clientes.read'),('vendedor','clientes.create'),('vendedor','clientes.update'),('vendedor','whatsapp.read'),('vendedor','whatsapp.reply'),('vendedor','orcamentos.read'),('vendedor','orcamentos.create'),('vendedor','orcamentos.update'),('vendedor','orcamentos.send'),
('designer','clientes.read'),('designer','os.read'),('designer','os.update'),('designer','os.status.advance'),
('operador','os.read'),('operador','os.update'),('operador','os.status.advance'),
('estoque','os.read'),('estoque','custos.read'),
('instalador','clientes.read'),('instalador','os.read'),('instalador','os.status.advance'),
('cliente','clientes.read')
ON CONFLICT DO NOTHING;

INSERT INTO public.perfil_permissoes (perfil, permissao) VALUES
('gerente','kanban.move'),('gerente','instalacao.update'),('gerente','arquivos.approve'),('gerente','estoque.cost.read'),
('gestor','kanban.move'),('gestor','instalacao.update'),('gestor','arquivos.approve'),('gestor','estoque.cost.read'),
('financeiro','estoque.cost.read'),
('vendedor','kanban.move'),
('designer','kanban.move'),('designer','arquivos.approve'),
('operador','kanban.move'),
('estoque','estoque.cost.read'),
('instalador','instalacao.update')
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.has_permission(_user_id UUID, _permission TEXT)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    JOIN public.perfil_permissoes pp ON pp.perfil = ur.role::text OR (ur.role::text='admin' AND pp.perfil='administrador') OR (ur.role::text='gestor' AND pp.perfil='gerente')
    WHERE ur.user_id = _user_id AND pp.permissao = _permission
  );
$$;

CREATE OR REPLACE FUNCTION public.require_permission(_permission TEXT)
RETURNS UUID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Usuário não autenticado'; END IF;
  IF NOT public.has_permission(v_uid, _permission) THEN RAISE EXCEPTION 'Permissão necessária: %', _permission; END IF;
  RETURN v_uid;
END; $$;

CREATE OR REPLACE FUNCTION public.normalize_phone(_phone TEXT) RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$ SELECT NULLIF(regexp_replace(coalesce(_phone,''), '\D', '', 'g'), '') $$;
CREATE OR REPLACE FUNCTION public.normalize_email(_email TEXT) RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$ SELECT NULLIF(lower(trim(coalesce(_email,''))), '') $$;
CREATE OR REPLACE FUNCTION public.normalize_document(_doc TEXT) RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$ SELECT NULLIF(regexp_replace(coalesce(_doc,''), '\D', '', 'g'), '') $$;

ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS empresa TEXT;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS telefone_original TEXT;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS telefone_normalizado TEXT;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS documento TEXT;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS campanha TEXT;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS interesse TEXT;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS valor_potencial NUMERIC(12,2);
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS etapa TEXT NOT NULL DEFAULT 'novo';
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS responsavel_id UUID REFERENCES public.usuarios(id) ON DELETE SET NULL;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS conversa_id UUID;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS motivo_perda TEXT;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS proxima_acao TEXT;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS proxima_acao_em TIMESTAMPTZ;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES public.usuarios(id) ON DELETE SET NULL;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS cliente_id UUID REFERENCES public.clientes(id) ON DELETE SET NULL;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS convertido_em TIMESTAMPTZ;
UPDATE public.leads SET telefone_original = COALESCE(telefone_original, telefone), telefone_normalizado = COALESCE(telefone_normalizado, public.normalize_phone(telefone)) WHERE telefone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_telefone_normalizado ON public.leads(telefone_normalizado);
CREATE INDEX IF NOT EXISTS idx_leads_cliente_id ON public.leads(cliente_id);

ALTER TABLE public.clientes ADD COLUMN IF NOT EXISTS telefone_normalizado TEXT;
ALTER TABLE public.clientes ADD COLUMN IF NOT EXISTS documento_normalizado TEXT;
UPDATE public.clientes SET documento_normalizado = COALESCE(documento_normalizado, public.normalize_document(documento));
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'clientes' AND column_name = 'telefone_normalizado' AND is_generated = 'NEVER'
  ) THEN
    UPDATE public.clientes SET telefone_normalizado = COALESCE(telefone_normalizado, public.normalize_phone(telefone));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_clientes_documento_normalizado ON public.clientes(documento_normalizado);

CREATE TABLE IF NOT EXISTS public.eventos_negocio (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), entidade TEXT NOT NULL, entidade_id UUID NOT NULL, os_id UUID, cliente_id UUID,
  tipo TEXT NOT NULL, titulo TEXT NOT NULL, descricao TEXT, dados_anteriores JSONB, dados_posteriores JSONB,
  usuario_id UUID REFERENCES public.usuarios(id) ON DELETE SET NULL, origem TEXT NOT NULL DEFAULT 'sistema', created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.eventos_negocio ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "eventos permission read" ON public.eventos_negocio;
CREATE POLICY "eventos permission read" ON public.eventos_negocio FOR SELECT TO authenticated USING (public.has_permission(auth.uid(),'logs.read') OR public.has_permission(auth.uid(),'os.read') OR public.has_permission(auth.uid(),'clientes.read'));
DROP POLICY IF EXISTS "eventos system insert" ON public.eventos_negocio;
CREATE POLICY "eventos system insert" ON public.eventos_negocio FOR INSERT TO authenticated WITH CHECK (auth.uid() = usuario_id OR public.has_permission(auth.uid(),'logs.read'));

ALTER TABLE public.whatsapp_conversas ADD COLUMN IF NOT EXISTS telefone_normalizado TEXT;
ALTER TABLE public.whatsapp_conversas ADD COLUMN IF NOT EXISTS responsavel_id UUID REFERENCES public.usuarios(id) ON DELETE SET NULL;
ALTER TABLE public.whatsapp_conversas ADD COLUMN IF NOT EXISTS unread_count INT NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS public.whatsapp_contatos (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), nome TEXT, telefone_original TEXT, telefone_normalizado TEXT NOT NULL UNIQUE, cliente_id UUID REFERENCES public.clientes(id) ON DELETE SET NULL, lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.whatsapp_anexos (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), mensagem_id UUID REFERENCES public.whatsapp_mensagens(id) ON DELETE CASCADE, bucket TEXT NOT NULL DEFAULT 'whatsapp-midias', caminho TEXT NOT NULL, mime_type TEXT, tamanho_bytes BIGINT, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.whatsapp_participantes (conversa_id UUID REFERENCES public.whatsapp_conversas(id) ON DELETE CASCADE, usuario_id UUID REFERENCES public.usuarios(id) ON DELETE CASCADE, papel TEXT NOT NULL DEFAULT 'atendente', created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (conversa_id, usuario_id));
CREATE TABLE IF NOT EXISTS public.whatsapp_fila_envio (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), conversa_id UUID REFERENCES public.whatsapp_conversas(id) ON DELETE CASCADE, mensagem_id UUID REFERENCES public.whatsapp_mensagens(id) ON DELETE SET NULL, payload JSONB NOT NULL, status TEXT NOT NULL DEFAULT 'pendente', tentativas INT NOT NULL DEFAULT 0, idempotency_key TEXT NOT NULL UNIQUE, erro TEXT, created_by UUID REFERENCES public.usuarios(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.whatsapp_webhook_eventos (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), provedor TEXT NOT NULL, external_id TEXT NOT NULL, payload JSONB NOT NULL, processado_em TIMESTAMPTZ, erro TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE (provedor, external_id));

ALTER TABLE public.orcamentos ADD COLUMN IF NOT EXISTS lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL;
ALTER TABLE public.orcamentos ADD COLUMN IF NOT EXISTS contato_id UUID REFERENCES public.cliente_contatos(id) ON DELETE SET NULL;
ALTER TABLE public.orcamentos ADD COLUMN IF NOT EXISTS conversa_id UUID;
ALTER TABLE public.orcamentos ADD COLUMN IF NOT EXISTS prazo DATE;
ALTER TABLE public.orcamentos ADD COLUMN IF NOT EXISTS briefing TEXT;
ALTER TABLE public.orcamentos ADD COLUMN IF NOT EXISTS condicao_pagamento JSONB NOT NULL DEFAULT '{"parcelas":1}'::jsonb;
ALTER TABLE public.orcamentos ADD COLUMN IF NOT EXISTS endereco_entrega JSONB;
ALTER TABLE public.orcamentos ADD COLUMN IF NOT EXISTS precisa_entrega BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.orcamentos ADD COLUMN IF NOT EXISTS precisa_instalacao BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.orcamentos ADD COLUMN IF NOT EXISTS observacao_interna TEXT;
ALTER TABLE public.orcamentos ADD COLUMN IF NOT EXISTS observacao_cliente TEXT;
ALTER TABLE public.orcamentos ADD COLUMN IF NOT EXISTS versao_aprovada_id UUID;

ALTER TABLE public.orcamento_itens ADD COLUMN IF NOT EXISTS desconto NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.orcamento_itens ADD COLUMN IF NOT EXISTS custo_previsto NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.orcamento_itens ADD COLUMN IF NOT EXISTS margem_prevista NUMERIC(8,4);
ALTER TABLE public.orcamento_itens ADD COLUMN IF NOT EXISTS parametros JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.orcamento_itens ADD COLUMN IF NOT EXISTS produto_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.orcamento_itens ADD COLUMN IF NOT EXISTS origem_calculo TEXT;

CREATE TABLE IF NOT EXISTS public.orcamento_versoes (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), orcamento_id UUID NOT NULL REFERENCES public.orcamentos(id) ON DELETE CASCADE, numero_versao INT NOT NULL, status TEXT NOT NULL DEFAULT 'rascunho', snapshot JSONB NOT NULL, valor_total NUMERIC(12,2) NOT NULL DEFAULT 0, pdf_url TEXT, destinatario TEXT, canal TEXT, enviada_em TIMESTAMPTZ, aprovada_em TIMESTAMPTZ, aprovado_por UUID REFERENCES public.usuarios(id) ON DELETE SET NULL, created_by UUID REFERENCES public.usuarios(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE (orcamento_id, numero_versao));
CREATE TABLE IF NOT EXISTS public.orcamento_versao_itens (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), versao_id UUID NOT NULL REFERENCES public.orcamento_versoes(id) ON DELETE CASCADE, orcamento_item_id UUID REFERENCES public.orcamento_itens(id) ON DELETE SET NULL, snapshot JSONB NOT NULL, ordem INT NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT now());

ALTER TABLE public.ordens_servico ADD COLUMN IF NOT EXISTS status_comercial TEXT NOT NULL DEFAULT 'aprovada';
ALTER TABLE public.ordens_servico ADD COLUMN IF NOT EXISTS status_financeiro TEXT NOT NULL DEFAULT 'pendente';
ALTER TABLE public.ordens_servico ADD COLUMN IF NOT EXISTS status_arte TEXT NOT NULL DEFAULT 'nao_iniciada';
ALTER TABLE public.ordens_servico ADD COLUMN IF NOT EXISTS status_producao TEXT NOT NULL DEFAULT 'nao_iniciada';
ALTER TABLE public.ordens_servico ADD COLUMN IF NOT EXISTS status_logistica TEXT NOT NULL DEFAULT 'nao_iniciada';
ALTER TABLE public.ordens_servico ADD COLUMN IF NOT EXISTS status_geral TEXT NOT NULL DEFAULT 'entrada';
ALTER TABLE public.itens_os ADD COLUMN IF NOT EXISTS orcamento_item_id UUID REFERENCES public.orcamento_itens(id) ON DELETE SET NULL;
ALTER TABLE public.itens_os ADD COLUMN IF NOT EXISTS produto_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.itens_os ADD COLUMN IF NOT EXISTS parametros JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS public.contas_receber (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), cliente_id UUID NOT NULL REFERENCES public.clientes(id) ON DELETE RESTRICT, orcamento_id UUID REFERENCES public.orcamentos(id) ON DELETE SET NULL, os_id UUID REFERENCES public.ordens_servico(id) ON DELETE SET NULL, valor_total NUMERIC(12,2) NOT NULL, status TEXT NOT NULL DEFAULT 'previsto', created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.parcelas_receber (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), conta_id UUID NOT NULL REFERENCES public.contas_receber(id) ON DELETE CASCADE, parcela INT NOT NULL, valor NUMERIC(12,2) NOT NULL, vencimento DATE, status TEXT NOT NULL DEFAULT 'prevista', created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(conta_id, parcela));
ALTER TABLE public.pagamentos ADD COLUMN IF NOT EXISTS parcela_id UUID REFERENCES public.parcelas_receber(id) ON DELETE SET NULL;
ALTER TABLE public.pagamentos ADD COLUMN IF NOT EXISTS taxa NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.pagamentos ADD COLUMN IF NOT EXISTS referencia_externa TEXT;
ALTER TABLE public.pagamentos ADD COLUMN IF NOT EXISTS pagamento_estornado_id UUID REFERENCES public.pagamentos(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.converter_lead_em_cliente(p_lead_id UUID, p_dados JSONB, p_criar_orcamento BOOLEAN DEFAULT false)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid UUID; v_lead public.leads%ROWTYPE; v_cliente_id UUID; v_orcamento_id UUID; v_existing UUID;
BEGIN
  v_uid := public.require_permission('leads.convert');
  SELECT * INTO v_lead FROM public.leads WHERE id = p_lead_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lead não encontrado'; END IF;
  IF v_lead.cliente_id IS NOT NULL THEN RETURN jsonb_build_object('lead_id', p_lead_id, 'cliente_id', v_lead.cliente_id, 'orcamento_id', NULL, 'idempotent', true); END IF;
  v_existing := NULLIF(p_dados->>'cliente_id','')::uuid;
  IF v_existing IS NULL THEN
    SELECT id INTO v_existing FROM public.clientes WHERE (documento_normalizado IS NOT NULL AND documento_normalizado = public.normalize_document(COALESCE(p_dados->>'documento', v_lead.documento))) OR (telefone_normalizado IS NOT NULL AND telefone_normalizado = COALESCE(v_lead.telefone_normalizado, public.normalize_phone(v_lead.telefone_original))) LIMIT 1;
  END IF;
  IF v_existing IS NULL THEN
    INSERT INTO public.clientes (nome, razao_social, documento, documento_normalizado, email, telefone, vendedor_id, created_by, observacoes)
    VALUES (COALESCE(p_dados->>'nome', v_lead.nome), COALESCE(p_dados->>'empresa', v_lead.empresa), COALESCE(p_dados->>'documento', v_lead.documento), public.normalize_document(COALESCE(p_dados->>'documento', v_lead.documento)), public.normalize_email(COALESCE(p_dados->>'email', v_lead.email)), COALESCE(p_dados->>'telefone', v_lead.telefone_original), v_lead.responsavel_id, v_uid, 'Criado por conversão de lead') RETURNING id INTO v_cliente_id;
  ELSE v_cliente_id := v_existing; END IF;
  UPDATE public.leads SET cliente_id = v_cliente_id, convertido_em = now(), status = 'ganho', etapa = 'convertido' WHERE id = p_lead_id;
  IF p_criar_orcamento THEN
    INSERT INTO public.orcamentos (cliente_id, lead_id, vendedor_id, titulo, descricao, created_by, conversa_id, valor_total)
    VALUES (v_cliente_id, p_lead_id, v_lead.responsavel_id, COALESCE(v_lead.interesse,'Orçamento do lead'), v_lead.interesse, v_uid, v_lead.conversa_id, COALESCE(v_lead.valor_potencial,0)) RETURNING id INTO v_orcamento_id;
  END IF;
  INSERT INTO public.eventos_negocio(entidade, entidade_id, cliente_id, tipo, titulo, dados_posteriores, usuario_id) VALUES ('lead', p_lead_id, v_cliente_id, 'lead_convertido', 'Lead convertido em cliente', jsonb_build_object('cliente_id', v_cliente_id, 'orcamento_id', v_orcamento_id), v_uid);
  RETURN jsonb_build_object('lead_id', p_lead_id, 'cliente_id', v_cliente_id, 'orcamento_id', v_orcamento_id);
END; $$;

CREATE OR REPLACE FUNCTION public.aprovar_orcamento(p_orcamento_id UUID, p_versao_id UUID DEFAULT NULL, p_observacao TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid UUID; v_versao UUID; v_orc public.orcamentos%ROWTYPE;
BEGIN
  v_uid := public.require_permission('orcamentos.approve');
  SELECT * INTO v_orc FROM public.orcamentos WHERE id = p_orcamento_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Orçamento não encontrado'; END IF;
  v_versao := p_versao_id;
  IF v_versao IS NULL THEN SELECT id INTO v_versao FROM public.orcamento_versoes WHERE orcamento_id=p_orcamento_id ORDER BY numero_versao DESC LIMIT 1; END IF;
  IF v_versao IS NULL THEN
    INSERT INTO public.orcamento_versoes(orcamento_id, numero_versao, status, snapshot, valor_total, aprovada_em, aprovado_por, created_by)
    VALUES (p_orcamento_id, 1, 'aprovada', to_jsonb(v_orc), v_orc.valor_total, now(), v_uid, v_uid) RETURNING id INTO v_versao;
  ELSE UPDATE public.orcamento_versoes SET status='aprovada', aprovada_em=COALESCE(aprovada_em, now()), aprovado_por=COALESCE(aprovado_por, v_uid) WHERE id=v_versao; END IF;
  UPDATE public.orcamentos SET status='aprovado', aprovado_em=COALESCE(aprovado_em, now()), versao_aprovada_id=v_versao WHERE id=p_orcamento_id;
  INSERT INTO public.eventos_negocio(entidade, entidade_id, cliente_id, tipo, titulo, descricao, usuario_id) VALUES ('orcamento', p_orcamento_id, v_orc.cliente_id, 'orcamento_aprovado', 'Orçamento aprovado', p_observacao, v_uid);
  RETURN jsonb_build_object('orcamento_id', p_orcamento_id, 'versao_id', v_versao);
END; $$;

CREATE OR REPLACE FUNCTION public.converter_orcamento_em_os(p_orcamento_id UUID, p_opcoes JSONB DEFAULT '{}'::jsonb)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid UUID; v_orc public.orcamentos%ROWTYPE; v_os_id UUID; v_conta_id UUID; v_parcelas INT; v_i INT;
BEGIN
  v_uid := public.require_permission('orcamentos.convert');
  SELECT * INTO v_orc FROM public.orcamentos WHERE id = p_orcamento_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Orçamento não encontrado'; END IF;
  IF v_orc.os_id IS NOT NULL THEN RETURN jsonb_build_object('orcamento_id', p_orcamento_id, 'os_id', v_orc.os_id, 'idempotent', true); END IF;
  IF v_orc.versao_aprovada_id IS NULL AND v_orc.status::text <> 'aprovado' THEN RAISE EXCEPTION 'Orçamento sem versão aprovada'; END IF;
  INSERT INTO public.ordens_servico(cliente_id, orcamento_id, vendedor_id, titulo, briefing, observacoes, prazo_entrega, valor_total, custo_previsto, created_by, status_geral)
  VALUES (v_orc.cliente_id, p_orcamento_id, v_orc.vendedor_id, v_orc.titulo, v_orc.briefing, v_orc.observacoes, v_orc.prazo, v_orc.valor_total, v_orc.custo_estimado, v_uid, 'entrada') RETURNING id INTO v_os_id;
  INSERT INTO public.itens_os(os_id, orcamento_item_id, produto_id, descricao, quantidade, unidade, valor_unitario, custo_unitario, valor_total, ordem, produto_snapshot, parametros)
  SELECT v_os_id, id, produto_id, descricao, quantidade, unidade, valor_unitario, custo_unitario, valor_total, ordem, produto_snapshot, parametros FROM public.orcamento_itens WHERE orcamento_id=p_orcamento_id ORDER BY ordem;
  UPDATE public.orcamentos SET os_id=v_os_id WHERE id=p_orcamento_id;
  INSERT INTO public.contas_receber(cliente_id, orcamento_id, os_id, valor_total) VALUES (v_orc.cliente_id, p_orcamento_id, v_os_id, v_orc.valor_total) RETURNING id INTO v_conta_id;
  v_parcelas := GREATEST(1, COALESCE((v_orc.condicao_pagamento->>'parcelas')::int, 1));
  FOR v_i IN 1..v_parcelas LOOP INSERT INTO public.parcelas_receber(conta_id, parcela, valor, vencimento) VALUES (v_conta_id, v_i, round(v_orc.valor_total / v_parcelas, 2), CURRENT_DATE + ((v_i-1) * 30)); END LOOP;
  INSERT INTO public.eventos_negocio(entidade, entidade_id, os_id, cliente_id, tipo, titulo, dados_posteriores, usuario_id) VALUES ('orcamento', p_orcamento_id, v_os_id, v_orc.cliente_id, 'orcamento_convertido_os', 'Orçamento convertido em OS', jsonb_build_object('os_id', v_os_id, 'conta_id', v_conta_id), v_uid);
  RETURN jsonb_build_object('orcamento_id', p_orcamento_id, 'os_id', v_os_id, 'conta_id', v_conta_id);
END; $$;

CREATE OR REPLACE FUNCTION public.avancar_os_status(p_os_id UUID, p_novo_status TEXT, p_justificativa TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid UUID; v_antigo TEXT; v_status_geral TEXT;
BEGIN
  v_uid := public.require_permission('os.status.advance');
  SELECT status INTO v_antigo FROM public.ordens_servico WHERE id=p_os_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OS não encontrada'; END IF;
  IF p_novo_status NOT IN ('novo','aguardando_briefing','briefing_ok','em_design','aguardando_aprovacao_arte','arte_aprovada','arte_rejeitada','aguardando_producao','em_producao','em_impressao','em_corte','em_acabamento','em_uv','em_laser_cnc','em_3d','controle_qualidade','aguardando_retirada','aguardando_entrega','em_entrega','em_instalacao','concluido','faturado','cancelado','retrabalho','pausado') THEN RAISE EXCEPTION 'Status inválido: %', p_novo_status; END IF;
  v_status_geral := CASE
    WHEN p_novo_status IN ('novo','aguardando_briefing','briefing_ok') THEN 'entrada'
    WHEN p_novo_status IN ('em_design','aguardando_aprovacao_arte','arte_aprovada','arte_rejeitada') THEN 'design'
    WHEN p_novo_status IN ('aguardando_producao','em_producao','em_impressao','em_corte','em_uv','em_laser_cnc','em_3d') THEN 'producao'
    WHEN p_novo_status IN ('em_acabamento','controle_qualidade') THEN 'acabamento'
    WHEN p_novo_status IN ('aguardando_retirada','aguardando_entrega') THEN 'pronto'
    WHEN p_novo_status IN ('em_entrega','em_instalacao') THEN 'entregue'
    WHEN p_novo_status IN ('concluido','faturado') THEN 'finalizado'
    ELSE COALESCE((SELECT status_geral FROM public.ordens_servico WHERE id=p_os_id), 'entrada')
  END;
  UPDATE public.ordens_servico SET status=p_novo_status, status_geral=v_status_geral WHERE id=p_os_id;
  INSERT INTO public.eventos_negocio(entidade, entidade_id, os_id, tipo, titulo, descricao, dados_anteriores, dados_posteriores, usuario_id) VALUES ('os', p_os_id, p_os_id, 'status_alterado', 'Status da OS alterado', p_justificativa, jsonb_build_object('status', v_antigo), jsonb_build_object('status', p_novo_status), v_uid);
  RETURN jsonb_build_object('os_id', p_os_id, 'status_anterior', v_antigo, 'status_novo', p_novo_status);
END; $$;

CREATE OR REPLACE FUNCTION public.forcar_transicao_os(p_os_id UUID, p_novo_status TEXT, p_motivo TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid UUID; v_antigo TEXT; v_status_geral TEXT;
BEGIN
  IF NULLIF(trim(p_motivo),'') IS NULL THEN RAISE EXCEPTION 'Motivo obrigatório'; END IF;
  v_uid := public.require_permission('os.status.override');
  SELECT status INTO v_antigo FROM public.ordens_servico WHERE id=p_os_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OS não encontrada'; END IF;
  v_status_geral := CASE
    WHEN p_novo_status IN ('novo','aguardando_briefing','briefing_ok','entrada') THEN 'entrada'
    WHEN p_novo_status IN ('em_design','aguardando_aprovacao_arte','arte_aprovada','arte_rejeitada','design') THEN 'design'
    WHEN p_novo_status IN ('aguardando_producao','em_producao','em_impressao','em_corte','em_uv','em_laser_cnc','em_3d','producao') THEN 'producao'
    WHEN p_novo_status IN ('em_acabamento','controle_qualidade','acabamento') THEN 'acabamento'
    WHEN p_novo_status IN ('aguardando_retirada','aguardando_entrega','pronto') THEN 'pronto'
    WHEN p_novo_status IN ('em_entrega','em_instalacao','entregue') THEN 'entregue'
    WHEN p_novo_status IN ('concluido','faturado','finalizado') THEN 'finalizado'
    ELSE COALESCE((SELECT status_geral FROM public.ordens_servico WHERE id=p_os_id), 'entrada')
  END;
  UPDATE public.ordens_servico SET status=p_novo_status, status_geral=v_status_geral WHERE id=p_os_id;
  INSERT INTO public.eventos_negocio(entidade, entidade_id, os_id, tipo, titulo, descricao, dados_anteriores, dados_posteriores, usuario_id) VALUES ('os', p_os_id, p_os_id, 'excecao_status', 'Transição excepcional forçada', p_motivo, jsonb_build_object('status', v_antigo), jsonb_build_object('status', p_novo_status, 'validacoes_ignoradas', true), v_uid);
  RETURN jsonb_build_object('os_id', p_os_id, 'status_anterior', v_antigo, 'status_novo', p_novo_status);
END; $$;

CREATE OR REPLACE FUNCTION public.confirmar_pagamento(p_parcela_id UUID, p_valor NUMERIC, p_meio TEXT, p_taxa NUMERIC DEFAULT 0, p_data DATE DEFAULT CURRENT_DATE, p_comprovante TEXT DEFAULT NULL, p_referencia_externa TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid UUID; v_pag UUID; v_parcela public.parcelas_receber%ROWTYPE; v_conta public.contas_receber%ROWTYPE;
BEGIN
  v_uid := public.require_permission('pagamentos.confirm');
  SELECT * INTO v_parcela FROM public.parcelas_receber WHERE id=p_parcela_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Parcela não encontrada'; END IF;
  IF v_parcela.status='paga' THEN RAISE EXCEPTION 'Parcela já paga'; END IF;
  SELECT * INTO v_conta FROM public.contas_receber WHERE id=v_parcela.conta_id;
  INSERT INTO public.pagamentos(os_id, parcela_id, valor, data_pagamento, status, forma_pagamento, taxa, comprovante_url, referencia_externa, registrado_por) VALUES (v_conta.os_id, p_parcela_id, p_valor, p_data, 'pago', p_meio, COALESCE(p_taxa,0), p_comprovante, p_referencia_externa, v_uid) RETURNING id INTO v_pag;
  UPDATE public.parcelas_receber SET status='paga' WHERE id=p_parcela_id;
  UPDATE public.ordens_servico SET status_financeiro='pago' WHERE id=v_conta.os_id AND NOT EXISTS (SELECT 1 FROM public.parcelas_receber pr WHERE pr.conta_id=v_conta.id AND pr.status <> 'paga');
  INSERT INTO public.eventos_negocio(entidade, entidade_id, os_id, cliente_id, tipo, titulo, dados_posteriores, usuario_id) VALUES ('pagamento', v_pag, v_conta.os_id, v_conta.cliente_id, 'pagamento_confirmado', 'Pagamento confirmado', jsonb_build_object('valor', p_valor, 'parcela_id', p_parcela_id), v_uid);
  RETURN jsonb_build_object('pagamento_id', v_pag, 'parcela_id', p_parcela_id);
END; $$;

CREATE OR REPLACE FUNCTION public.estornar_pagamento(p_pagamento_id UUID, p_motivo TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid UUID; v_pag public.pagamentos%ROWTYPE; v_estorno UUID;
BEGIN
  IF NULLIF(trim(p_motivo),'') IS NULL THEN RAISE EXCEPTION 'Motivo obrigatório'; END IF;
  v_uid := public.require_permission('pagamentos.reverse');
  SELECT * INTO v_pag FROM public.pagamentos WHERE id=p_pagamento_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pagamento não encontrado'; END IF;
  IF v_pag.status <> 'pago' THEN RAISE EXCEPTION 'Somente pagamento confirmado pode ser estornado'; END IF;
  INSERT INTO public.pagamentos(os_id, parcela_id, valor, data_pagamento, status, forma_pagamento, taxa, observacoes, pagamento_estornado_id, registrado_por) VALUES (v_pag.os_id, v_pag.parcela_id, -v_pag.valor, CURRENT_DATE, 'cancelado', v_pag.forma_pagamento, -COALESCE(v_pag.taxa,0), p_motivo, p_pagamento_id, v_uid) RETURNING id INTO v_estorno;
  UPDATE public.parcelas_receber SET status='prevista' WHERE id=v_pag.parcela_id;
  INSERT INTO public.eventos_negocio(entidade, entidade_id, os_id, tipo, titulo, descricao, dados_anteriores, dados_posteriores, usuario_id) VALUES ('pagamento', p_pagamento_id, v_pag.os_id, 'pagamento_estornado', 'Pagamento estornado', p_motivo, to_jsonb(v_pag), jsonb_build_object('estorno_id', v_estorno), v_uid);
  RETURN jsonb_build_object('pagamento_id', p_pagamento_id, 'estorno_id', v_estorno);
END; $$;

GRANT SELECT ON public.permissoes, public.perfil_permissoes TO authenticated;
GRANT EXECUTE ON FUNCTION public.converter_lead_em_cliente(UUID, JSONB, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.aprovar_orcamento(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.converter_orcamento_em_os(UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.avancar_os_status(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.forcar_transicao_os(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirmar_pagamento(UUID, NUMERIC, TEXT, NUMERIC, DATE, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.estornar_pagamento(UUID, TEXT) TO authenticated;
