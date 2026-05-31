
-- =========================================================================
-- BEX PRINT OS — Fase 1: Fundação
-- =========================================================================

-- ------------------------- ENUMS -----------------------------------------
CREATE TYPE public.app_role AS ENUM (
  'admin','gestor','financeiro','vendedor','designer',
  'operador','estoque','instalador','cliente'
);

CREATE TYPE public.tipo_cliente AS ENUM ('pf','pj');

CREATE TYPE public.status_orcamento AS ENUM (
  'rascunho','enviado','aprovado','rejeitado','expirado','convertido'
);

CREATE TYPE public.status_os AS ENUM (
  'novo','aguardando_briefing','briefing_ok',
  'em_design','aguardando_aprovacao_arte','arte_aprovada','arte_rejeitada',
  'aguardando_producao','em_producao','em_impressao','em_corte','em_acabamento',
  'em_uv','em_laser_cnc','em_3d','controle_qualidade',
  'aguardando_retirada','aguardando_entrega','em_entrega','em_instalacao',
  'concluido','faturado','cancelado','retrabalho','pausado'
);

CREATE TYPE public.tipo_aprovacao AS ENUM ('arte','orcamento');
CREATE TYPE public.canal_aprovacao AS ENUM ('sistema','whatsapp','email','presencial','telefone');

CREATE TYPE public.status_pagamento AS ENUM ('pendente','parcial','pago','atrasado','cancelado');

-- ------------------------- updated_at trigger ---------------------------
CREATE OR REPLACE FUNCTION public.tg_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

-- ------------------------- USUARIOS / ROLES -----------------------------
CREATE TABLE public.usuarios (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  email TEXT NOT NULL,
  telefone TEXT,
  avatar_url TEXT,
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.usuarios TO authenticated;
GRANT ALL ON public.usuarios TO service_role;
ALTER TABLE public.usuarios ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=_user_id AND role=_role)
$$;

CREATE OR REPLACE FUNCTION public.is_staff(_user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id=_user_id
      AND role IN ('admin','gestor','financeiro','vendedor','designer','operador','estoque','instalador')
  )
$$;

CREATE OR REPLACE FUNCTION public.can_see_financials(_user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id=_user_id AND role IN ('admin','gestor','financeiro')
  )
$$;

-- ------------------------- handle_new_user trigger ----------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_is_first BOOLEAN;
BEGIN
  INSERT INTO public.usuarios (id, nome, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'nome', split_part(NEW.email,'@',1)),
    NEW.email
  );

  -- Se for o primeiro usuário do sistema, vira admin automaticamente
  SELECT (COUNT(*) = 0) INTO v_is_first FROM public.user_roles;
  IF v_is_first THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- RLS: usuarios
CREATE POLICY "usuarios self select" ON public.usuarios FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'gestor'));
CREATE POLICY "usuarios self update" ON public.usuarios FOR UPDATE TO authenticated
  USING (id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "usuarios admin insert" ON public.usuarios FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid() OR public.has_role(auth.uid(),'admin'));

-- RLS: user_roles
CREATE POLICY "roles self select" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "roles admin all" ON public.user_roles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TRIGGER tg_usuarios_updated BEFORE UPDATE ON public.usuarios FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ------------------------- CLIENTES -------------------------------------
CREATE TABLE public.clientes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo public.tipo_cliente NOT NULL DEFAULT 'pj',
  nome TEXT NOT NULL,
  razao_social TEXT,
  documento TEXT,
  email TEXT,
  telefone TEXT,
  endereco TEXT,
  cidade TEXT,
  estado TEXT,
  cep TEXT,
  observacoes TEXT,
  vendedor_id UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clientes TO authenticated;
GRANT ALL ON public.clientes TO service_role;
ALTER TABLE public.clientes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "clientes staff read" ON public.clientes FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "clientes staff write" ON public.clientes FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "clientes staff update" ON public.clientes FOR UPDATE TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "clientes admin delete" ON public.clientes FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'gestor'));
CREATE TRIGGER tg_clientes_updated BEFORE UPDATE ON public.clientes FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE public.cliente_contatos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id UUID NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  cargo TEXT,
  email TEXT,
  telefone TEXT,
  principal BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cliente_contatos TO authenticated;
GRANT ALL ON public.cliente_contatos TO service_role;
ALTER TABLE public.cliente_contatos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "contatos staff all" ON public.cliente_contatos FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

-- ------------------------- ORCAMENTOS -----------------------------------
CREATE TABLE public.orcamentos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero SERIAL UNIQUE,
  cliente_id UUID NOT NULL REFERENCES public.clientes(id) ON DELETE RESTRICT,
  vendedor_id UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  status public.status_orcamento NOT NULL DEFAULT 'rascunho',
  titulo TEXT NOT NULL,
  descricao TEXT,
  validade_dias INT NOT NULL DEFAULT 7,
  desconto_percentual NUMERIC(5,2) NOT NULL DEFAULT 0,
  valor_subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  valor_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  custo_estimado NUMERIC(12,2) NOT NULL DEFAULT 0,
  margem_estimada NUMERIC(5,2),
  observacoes TEXT,
  enviado_em TIMESTAMPTZ,
  aprovado_em TIMESTAMPTZ,
  os_id UUID,
  created_by UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.orcamentos TO authenticated;
GRANT ALL ON public.orcamentos TO service_role;
ALTER TABLE public.orcamentos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "orc staff read" ON public.orcamentos FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "orc staff insert" ON public.orcamentos FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "orc staff update" ON public.orcamentos FOR UPDATE TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "orc admin delete" ON public.orcamentos FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'gestor'));
CREATE TRIGGER tg_orcamentos_updated BEFORE UPDATE ON public.orcamentos FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE public.orcamento_itens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  orcamento_id UUID NOT NULL REFERENCES public.orcamentos(id) ON DELETE CASCADE,
  descricao TEXT NOT NULL,
  quantidade NUMERIC(12,2) NOT NULL DEFAULT 1,
  unidade TEXT NOT NULL DEFAULT 'un',
  valor_unitario NUMERIC(12,2) NOT NULL DEFAULT 0,
  custo_unitario NUMERIC(12,2) NOT NULL DEFAULT 0,
  valor_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  ordem INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.orcamento_itens TO authenticated;
GRANT ALL ON public.orcamento_itens TO service_role;
ALTER TABLE public.orcamento_itens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "orc_itens staff all" ON public.orcamento_itens FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

-- ------------------------- ORDENS DE SERVICO ----------------------------
CREATE TABLE public.ordens_servico (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero SERIAL UNIQUE,
  cliente_id UUID NOT NULL REFERENCES public.clientes(id) ON DELETE RESTRICT,
  orcamento_id UUID REFERENCES public.orcamentos(id) ON DELETE SET NULL,
  vendedor_id UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  responsavel_id UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  designer_id UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  operador_id UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  status public.status_os NOT NULL DEFAULT 'novo',
  titulo TEXT NOT NULL,
  briefing TEXT,
  observacoes TEXT,
  prioridade INT NOT NULL DEFAULT 3, -- 1 mais alta, 5 mais baixa
  prazo_entrega DATE,
  data_entrega_real TIMESTAMPTZ,
  valor_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  custo_previsto NUMERIC(12,2) NOT NULL DEFAULT 0,
  custo_real NUMERIC(12,2) NOT NULL DEFAULT 0,
  margem_real NUMERIC(5,2),
  ordem_kanban INT NOT NULL DEFAULT 0,
  created_by UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.orcamentos
  ADD CONSTRAINT orcamentos_os_fk FOREIGN KEY (os_id) REFERENCES public.ordens_servico(id) ON DELETE SET NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ordens_servico TO authenticated;
GRANT ALL ON public.ordens_servico TO service_role;
ALTER TABLE public.ordens_servico ENABLE ROW LEVEL SECURITY;
CREATE POLICY "os staff read" ON public.ordens_servico FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "os staff insert" ON public.ordens_servico FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "os staff update" ON public.ordens_servico FOR UPDATE TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "os admin delete" ON public.ordens_servico FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'gestor'));
CREATE TRIGGER tg_os_updated BEFORE UPDATE ON public.ordens_servico FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE public.itens_os (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  os_id UUID NOT NULL REFERENCES public.ordens_servico(id) ON DELETE CASCADE,
  descricao TEXT NOT NULL,
  quantidade NUMERIC(12,2) NOT NULL DEFAULT 1,
  unidade TEXT NOT NULL DEFAULT 'un',
  valor_unitario NUMERIC(12,2) NOT NULL DEFAULT 0,
  custo_unitario NUMERIC(12,2) NOT NULL DEFAULT 0,
  valor_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  ordem INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.itens_os TO authenticated;
GRANT ALL ON public.itens_os TO service_role;
ALTER TABLE public.itens_os ENABLE ROW LEVEL SECURITY;
CREATE POLICY "itens_os staff all" ON public.itens_os FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

-- ------------------------- TAREFAS --------------------------------------
CREATE TABLE public.tarefas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  os_id UUID NOT NULL REFERENCES public.ordens_servico(id) ON DELETE CASCADE,
  titulo TEXT NOT NULL,
  descricao TEXT,
  responsavel_id UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  concluida BOOLEAN NOT NULL DEFAULT false,
  prazo DATE,
  concluida_em TIMESTAMPTZ,
  created_by UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tarefas TO authenticated;
GRANT ALL ON public.tarefas TO service_role;
ALTER TABLE public.tarefas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tarefas staff all" ON public.tarefas FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE TRIGGER tg_tarefas_updated BEFORE UPDATE ON public.tarefas FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE public.comentarios_tarefa (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tarefa_id UUID NOT NULL REFERENCES public.tarefas(id) ON DELETE CASCADE,
  autor_id UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  texto TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.comentarios_tarefa TO authenticated;
GRANT ALL ON public.comentarios_tarefa TO service_role;
ALTER TABLE public.comentarios_tarefa ENABLE ROW LEVEL SECURITY;
CREATE POLICY "coment staff all" ON public.comentarios_tarefa FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

-- ------------------------- ARQUIVOS -------------------------------------
CREATE TABLE public.arquivos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  os_id UUID REFERENCES public.ordens_servico(id) ON DELETE CASCADE,
  cliente_id UUID REFERENCES public.clientes(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  caminho TEXT NOT NULL, -- path no storage
  mime_type TEXT,
  tamanho_bytes BIGINT,
  versao INT NOT NULL DEFAULT 1,
  substituido_por UUID REFERENCES public.arquivos(id) ON DELETE SET NULL,
  final_producao BOOLEAN NOT NULL DEFAULT false,
  enviado_por UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.arquivos TO authenticated;
GRANT ALL ON public.arquivos TO service_role;
ALTER TABLE public.arquivos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "arquivos staff all" ON public.arquivos FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

-- ------------------------- APROVACOES -----------------------------------
CREATE TABLE public.aprovacoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo public.tipo_aprovacao NOT NULL,
  os_id UUID REFERENCES public.ordens_servico(id) ON DELETE CASCADE,
  orcamento_id UUID REFERENCES public.orcamentos(id) ON DELETE CASCADE,
  arquivo_id UUID REFERENCES public.arquivos(id) ON DELETE SET NULL,
  aprovado BOOLEAN NOT NULL,
  canal public.canal_aprovacao NOT NULL DEFAULT 'sistema',
  usuario_id UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  cliente_contato_id UUID REFERENCES public.cliente_contatos(id) ON DELETE SET NULL,
  observacao TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.aprovacoes TO authenticated;
GRANT ALL ON public.aprovacoes TO service_role;
ALTER TABLE public.aprovacoes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "aprov staff read" ON public.aprovacoes FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "aprov staff insert" ON public.aprovacoes FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()));

-- ------------------------- FINANCEIRO -----------------------------------
CREATE TABLE public.pagamentos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  os_id UUID NOT NULL REFERENCES public.ordens_servico(id) ON DELETE CASCADE,
  valor NUMERIC(12,2) NOT NULL,
  data_vencimento DATE,
  data_pagamento DATE,
  status public.status_pagamento NOT NULL DEFAULT 'pendente',
  forma_pagamento TEXT,
  parcela INT NOT NULL DEFAULT 1,
  total_parcelas INT NOT NULL DEFAULT 1,
  comprovante_url TEXT,
  observacoes TEXT,
  registrado_por UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pagamentos TO authenticated;
GRANT ALL ON public.pagamentos TO service_role;
ALTER TABLE public.pagamentos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pag financeiro all" ON public.pagamentos FOR ALL TO authenticated
  USING (public.can_see_financials(auth.uid())) WITH CHECK (public.can_see_financials(auth.uid()));
CREATE TRIGGER tg_pag_updated BEFORE UPDATE ON public.pagamentos FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE public.custos_os (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  os_id UUID NOT NULL REFERENCES public.ordens_servico(id) ON DELETE CASCADE,
  descricao TEXT NOT NULL,
  categoria TEXT,
  valor NUMERIC(12,2) NOT NULL,
  data DATE NOT NULL DEFAULT CURRENT_DATE,
  registrado_por UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.custos_os TO authenticated;
GRANT ALL ON public.custos_os TO service_role;
ALTER TABLE public.custos_os ENABLE ROW LEVEL SECURITY;
CREATE POLICY "custos financeiro all" ON public.custos_os FOR ALL TO authenticated
  USING (public.can_see_financials(auth.uid())) WITH CHECK (public.can_see_financials(auth.uid()));

-- ------------------------- LOGS AUDITORIA -------------------------------
CREATE TABLE public.logs_auditoria (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  entidade TEXT NOT NULL,
  entidade_id UUID,
  acao TEXT NOT NULL,
  detalhes JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.logs_auditoria TO authenticated;
GRANT ALL ON public.logs_auditoria TO service_role;
ALTER TABLE public.logs_auditoria ENABLE ROW LEVEL SECURITY;
CREATE POLICY "logs admin read" ON public.logs_auditoria FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'gestor'));
CREATE POLICY "logs staff insert" ON public.logs_auditoria FOR INSERT TO authenticated
  WITH CHECK (public.is_staff(auth.uid()));

-- ------------------------- STUBS (Fase 2+) ------------------------------
CREATE TABLE public.maquinas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  tipo TEXT,
  ativa BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.maquinas TO authenticated;
GRANT ALL ON public.maquinas TO service_role;
ALTER TABLE public.maquinas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "maq staff read" ON public.maquinas FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "maq admin write" ON public.maquinas FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'gestor'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'gestor'));

CREATE TABLE public.produtos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  descricao TEXT,
  preco_base NUMERIC(12,2),
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.produtos TO authenticated;
GRANT ALL ON public.produtos TO service_role;
ALTER TABLE public.produtos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "prod staff read" ON public.produtos FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "prod admin write" ON public.produtos FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'gestor'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'gestor'));

CREATE TABLE public.materiais (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  unidade TEXT NOT NULL DEFAULT 'un',
  estoque NUMERIC(12,2) NOT NULL DEFAULT 0,
  custo_unitario NUMERIC(12,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.materiais TO authenticated;
GRANT ALL ON public.materiais TO service_role;
ALTER TABLE public.materiais ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mat staff read" ON public.materiais FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "mat estoque write" ON public.materiais FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'gestor') OR public.has_role(auth.uid(),'estoque'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'gestor') OR public.has_role(auth.uid(),'estoque'));

CREATE TABLE public.movimentacoes_estoque (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  material_id UUID NOT NULL REFERENCES public.materiais(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL, -- entrada / saida
  quantidade NUMERIC(12,2) NOT NULL,
  os_id UUID REFERENCES public.ordens_servico(id) ON DELETE SET NULL,
  observacao TEXT,
  usuario_id UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.movimentacoes_estoque TO authenticated;
GRANT ALL ON public.movimentacoes_estoque TO service_role;
ALTER TABLE public.movimentacoes_estoque ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mov estoque read" ON public.movimentacoes_estoque FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "mov estoque insert" ON public.movimentacoes_estoque FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'gestor') OR public.has_role(auth.uid(),'estoque'));

CREATE TABLE public.entregas_instalacoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  os_id UUID NOT NULL REFERENCES public.ordens_servico(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL DEFAULT 'entrega', -- entrega / instalacao
  instalador_id UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  endereco TEXT,
  data_agendada TIMESTAMPTZ,
  data_realizada TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'agendada',
  observacoes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.entregas_instalacoes TO authenticated;
GRANT ALL ON public.entregas_instalacoes TO service_role;
ALTER TABLE public.entregas_instalacoes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ent staff read" ON public.entregas_instalacoes FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "ent staff write" ON public.entregas_instalacoes FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'gestor') OR public.has_role(auth.uid(),'instalador'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'gestor') OR public.has_role(auth.uid(),'instalador'));

CREATE TABLE public.ocorrencias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  os_id UUID NOT NULL REFERENCES public.ordens_servico(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,
  descricao TEXT NOT NULL,
  resolvida BOOLEAN NOT NULL DEFAULT false,
  registrado_por UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.ocorrencias TO authenticated;
GRANT ALL ON public.ocorrencias TO service_role;
ALTER TABLE public.ocorrencias ENABLE ROW LEVEL SECURITY;
CREATE POLICY "oco staff all" ON public.ocorrencias FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

-- ------------------------- STORAGE BUCKETS ------------------------------
INSERT INTO storage.buckets (id, name, public) VALUES
  ('arquivos-clientes','arquivos-clientes', false),
  ('comprovantes','comprovantes', false),
  ('avatares','avatares', true)
ON CONFLICT (id) DO NOTHING;

-- Policies storage (staff pode tudo nos buckets privados)
CREATE POLICY "arquivos staff read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id='arquivos-clientes' AND public.is_staff(auth.uid()));
CREATE POLICY "arquivos staff write" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id='arquivos-clientes' AND public.is_staff(auth.uid()));
CREATE POLICY "arquivos staff update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id='arquivos-clientes' AND public.is_staff(auth.uid()));

CREATE POLICY "compr fin read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id='comprovantes' AND public.can_see_financials(auth.uid()));
CREATE POLICY "compr fin write" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id='comprovantes' AND public.can_see_financials(auth.uid()));

CREATE POLICY "avatar read" ON storage.objects FOR SELECT TO authenticated USING (bucket_id='avatares');
CREATE POLICY "avatar self write" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id='avatares' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "avatar self update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id='avatares' AND auth.uid()::text = (storage.foldername(name))[1]);
