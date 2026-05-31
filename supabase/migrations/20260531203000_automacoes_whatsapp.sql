-- =========================================================================
-- Automações reais + fila de execução + integração WhatsApp/Z-API
-- =========================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'automacao_gatilho') THEN
    CREATE TYPE public.automacao_gatilho AS ENUM (
      'status_os_alterado',
      'pagamento_atrasado',
      'estoque_minimo',
      'margem_abaixo_minimo',
      'os_atrasada',
      'os_concluida'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'automacao_acao') THEN
    CREATE TYPE public.automacao_acao AS ENUM ('whatsapp');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'automacao_execucao_status') THEN
    CREATE TYPE public.automacao_execucao_status AS ENUM ('pendente','processando','sucesso','erro','ignorado');
  END IF;
END $$;

ALTER TABLE public.materiais
  ADD COLUMN IF NOT EXISTS estoque_minimo NUMERIC(12,2) NOT NULL DEFAULT 10;

CREATE TABLE IF NOT EXISTS public.automacoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  gatilho public.automacao_gatilho NOT NULL,
  condicao JSONB NOT NULL DEFAULT '{}'::jsonb,
  acao public.automacao_acao NOT NULL DEFAULT 'whatsapp',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  ativo BOOLEAN NOT NULL DEFAULT true,
  delay_segundos INT NOT NULL DEFAULT 0 CHECK (delay_segundos >= 0),
  cooldown_segundos INT NOT NULL DEFAULT 3600 CHECK (cooldown_segundos >= 0),
  created_by UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.automacoes TO authenticated;
GRANT ALL ON public.automacoes TO service_role;
ALTER TABLE public.automacoes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "automacoes staff read" ON public.automacoes;
DROP POLICY IF EXISTS "automacoes admin write" ON public.automacoes;
CREATE POLICY "automacoes staff read" ON public.automacoes FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "automacoes admin write" ON public.automacoes FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'gestor'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'gestor'));
DROP TRIGGER IF EXISTS tg_automacoes_updated ON public.automacoes;
CREATE TRIGGER tg_automacoes_updated BEFORE UPDATE ON public.automacoes FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE IF NOT EXISTS public.automacao_execucoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  automacao_id UUID NOT NULL REFERENCES public.automacoes(id) ON DELETE CASCADE,
  gatilho public.automacao_gatilho NOT NULL,
  entidade TEXT NOT NULL,
  entidade_id UUID,
  status public.automacao_execucao_status NOT NULL DEFAULT 'pendente',
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processado_em TIMESTAMPTZ,
  tentativas INT NOT NULL DEFAULT 0,
  dedupe_key TEXT NOT NULL,
  contexto JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  erro TEXT,
  resposta JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS automacao_execucoes_dedupe_pendentes_idx
  ON public.automacao_execucoes (dedupe_key)
  WHERE status IN ('pendente','processando');
CREATE INDEX IF NOT EXISTS automacao_execucoes_pendentes_idx
  ON public.automacao_execucoes (status, scheduled_at);
CREATE INDEX IF NOT EXISTS automacao_execucoes_automacao_idx
  ON public.automacao_execucoes (automacao_id, created_at DESC);

GRANT SELECT ON public.automacao_execucoes TO authenticated;
GRANT ALL ON public.automacao_execucoes TO service_role;
ALTER TABLE public.automacao_execucoes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "automacao_execucoes admin read" ON public.automacao_execucoes;
CREATE POLICY "automacao_execucoes admin read" ON public.automacao_execucoes FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'gestor'));
DROP TRIGGER IF EXISTS tg_automacao_execucoes_updated ON public.automacao_execucoes;
CREATE TRIGGER tg_automacao_execucoes_updated BEFORE UPDATE ON public.automacao_execucoes FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE IF NOT EXISTS public.whatsapp_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  automacao_execucao_id UUID REFERENCES public.automacao_execucoes(id) ON DELETE SET NULL,
  automacao_id UUID REFERENCES public.automacoes(id) ON DELETE SET NULL,
  telefone TEXT NOT NULL,
  mensagem TEXT NOT NULL,
  status TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'z-api',
  request_payload JSONB,
  response_payload JSONB,
  erro TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS whatsapp_logs_automacao_idx ON public.whatsapp_logs (automacao_id, created_at DESC);
CREATE INDEX IF NOT EXISTS whatsapp_logs_execucao_idx ON public.whatsapp_logs (automacao_execucao_id);
GRANT SELECT ON public.whatsapp_logs TO authenticated;
GRANT ALL ON public.whatsapp_logs TO service_role;
ALTER TABLE public.whatsapp_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "whatsapp_logs admin read" ON public.whatsapp_logs;
CREATE POLICY "whatsapp_logs admin read" ON public.whatsapp_logs FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'gestor'));

CREATE OR REPLACE FUNCTION public.automacao_condicao_ok(
  p_gatilho public.automacao_gatilho,
  p_condicao JSONB,
  p_contexto JSONB
)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  v_statuses TEXT[];
  v_min NUMERIC;
  v_val NUMERIC;
BEGIN
  IF p_gatilho = 'status_os_alterado' THEN
    IF p_condicao ? 'status' THEN
      v_statuses := ARRAY(SELECT jsonb_array_elements_text(CASE jsonb_typeof(p_condicao->'status') WHEN 'array' THEN p_condicao->'status' ELSE jsonb_build_array(p_condicao->>'status') END));
      RETURN COALESCE(p_contexto #>> '{os,status}', p_contexto->>'status') = ANY(v_statuses);
    END IF;
    RETURN true;
  ELSIF p_gatilho = 'os_concluida' THEN
    RETURN COALESCE(p_contexto #>> '{os,status}', p_contexto->>'status') = 'concluido';
  ELSIF p_gatilho = 'estoque_minimo' THEN
    v_min := COALESCE(NULLIF(p_condicao->>'estoque_minimo','')::numeric, NULLIF(p_contexto #>> '{material,estoque_minimo}','')::numeric, 10);
    v_val := NULLIF(p_contexto #>> '{material,estoque}','')::numeric;
    RETURN v_val IS NOT NULL AND v_val <= v_min;
  ELSIF p_gatilho = 'margem_abaixo_minimo' THEN
    v_min := COALESCE(NULLIF(p_condicao->>'margem_minima','')::numeric, 30);
    v_val := NULLIF(p_contexto #>> '{os,margem_real}','')::numeric;
    RETURN v_val IS NOT NULL AND v_val < v_min;
  ELSIF p_gatilho IN ('pagamento_atrasado','os_atrasada') THEN
    RETURN true;
  END IF;

  RETURN false;
EXCEPTION WHEN invalid_text_representation THEN
  RETURN false;
END $$;

CREATE OR REPLACE FUNCTION public.enqueue_automacoes(
  p_gatilho public.automacao_gatilho,
  p_entidade TEXT,
  p_entidade_id UUID,
  p_contexto JSONB DEFAULT '{}'::jsonb
)
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_automacao public.automacoes%ROWTYPE;
  v_dedupe TEXT;
  v_count INT := 0;
BEGIN
  FOR v_automacao IN
    SELECT * FROM public.automacoes WHERE ativo = true AND gatilho = p_gatilho
  LOOP
    IF NOT public.automacao_condicao_ok(p_gatilho, v_automacao.condicao, p_contexto) THEN
      CONTINUE;
    END IF;

    v_dedupe := concat_ws(':', v_automacao.id::text, p_entidade, COALESCE(p_entidade_id::text, 'sem-id'), md5(p_contexto::text));

    IF EXISTS (
      SELECT 1
      FROM public.automacao_execucoes e
      WHERE e.automacao_id = v_automacao.id
        AND e.entidade = p_entidade
        AND e.entidade_id IS NOT DISTINCT FROM p_entidade_id
        AND e.status = 'sucesso'
        AND e.processado_em > now() - make_interval(secs => v_automacao.cooldown_segundos)
    ) THEN
      CONTINUE;
    END IF;

    INSERT INTO public.automacao_execucoes (automacao_id, gatilho, entidade, entidade_id, scheduled_at, dedupe_key, contexto, payload)
    VALUES (
      v_automacao.id,
      p_gatilho,
      p_entidade,
      p_entidade_id,
      now() + make_interval(secs => v_automacao.delay_segundos),
      v_dedupe,
      p_contexto,
      v_automacao.payload
    )
    ON CONFLICT (dedupe_key) WHERE status IN ('pendente','processando') DO NOTHING;

    IF FOUND THEN
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN v_count;
END $$;

CREATE OR REPLACE FUNCTION public.automacao_contexto_os(p_os public.ordens_servico)
RETURNS JSONB LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT jsonb_build_object(
    'os', to_jsonb(p_os),
    'cliente', COALESCE(to_jsonb(c), '{}'::jsonb),
    'telefone', c.telefone
  )
  FROM public.clientes c
  WHERE c.id = p_os.cliente_id
$$;

CREATE OR REPLACE FUNCTION public.tg_automacao_os_eventos()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_contexto JSONB;
BEGIN
  v_contexto := public.automacao_contexto_os(NEW);

  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    v_contexto := v_contexto || jsonb_build_object('status_anterior', OLD.status, 'status_novo', NEW.status);
    PERFORM public.enqueue_automacoes('status_os_alterado', 'ordens_servico', NEW.id, v_contexto);

    IF NEW.status = 'concluido' THEN
      PERFORM public.enqueue_automacoes('os_concluida', 'ordens_servico', NEW.id, v_contexto);
    END IF;
  END IF;

  IF NEW.margem_real IS NOT NULL THEN
    IF TG_OP = 'INSERT' OR NEW.margem_real IS DISTINCT FROM OLD.margem_real THEN
      PERFORM public.enqueue_automacoes('margem_abaixo_minimo', 'ordens_servico', NEW.id, v_contexto);
    END IF;
  END IF;

  IF NEW.prazo_entrega IS NOT NULL
     AND NEW.prazo_entrega < CURRENT_DATE
     AND NEW.status NOT IN ('concluido','faturado','cancelado') THEN
    PERFORM public.enqueue_automacoes('os_atrasada', 'ordens_servico', NEW.id, v_contexto);
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tg_automacao_os_eventos ON public.ordens_servico;
CREATE TRIGGER tg_automacao_os_eventos
  AFTER INSERT OR UPDATE ON public.ordens_servico
  FOR EACH ROW EXECUTE FUNCTION public.tg_automacao_os_eventos();

CREATE OR REPLACE FUNCTION public.tg_automacao_pagamento_eventos()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_os public.ordens_servico%ROWTYPE;
  v_contexto JSONB;
BEGIN
  IF (NEW.status = 'atrasado' OR (NEW.status IN ('pendente','parcial') AND NEW.data_vencimento IS NOT NULL AND NEW.data_vencimento < CURRENT_DATE)) THEN
    SELECT * INTO v_os FROM public.ordens_servico WHERE id = NEW.os_id;
    v_contexto := COALESCE(public.automacao_contexto_os(v_os), '{}'::jsonb) || jsonb_build_object('pagamento', to_jsonb(NEW));
    PERFORM public.enqueue_automacoes('pagamento_atrasado', 'pagamentos', NEW.id, v_contexto);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tg_automacao_pagamento_eventos ON public.pagamentos;
CREATE TRIGGER tg_automacao_pagamento_eventos
  AFTER INSERT OR UPDATE ON public.pagamentos
  FOR EACH ROW EXECUTE FUNCTION public.tg_automacao_pagamento_eventos();

CREATE OR REPLACE FUNCTION public.tg_automacao_material_eventos()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_contexto JSONB;
BEGIN
  v_contexto := jsonb_build_object('material', to_jsonb(NEW));
  PERFORM public.enqueue_automacoes('estoque_minimo', 'materiais', NEW.id, v_contexto);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tg_automacao_material_eventos ON public.materiais;
CREATE TRIGGER tg_automacao_material_eventos
  AFTER INSERT OR UPDATE ON public.materiais
  FOR EACH ROW EXECUTE FUNCTION public.tg_automacao_material_eventos();

CREATE OR REPLACE FUNCTION public.criar_eventos_automacoes_recorrentes()
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count INT := 0;
  v_pag public.pagamentos%ROWTYPE;
  v_os public.ordens_servico%ROWTYPE;
  v_mat public.materiais%ROWTYPE;
BEGIN
  FOR v_pag IN
    SELECT * FROM public.pagamentos
    WHERE status IN ('pendente','parcial','atrasado')
      AND data_vencimento IS NOT NULL
      AND data_vencimento < CURRENT_DATE
  LOOP
    SELECT * INTO v_os FROM public.ordens_servico WHERE id = v_pag.os_id;
    v_count := v_count + public.enqueue_automacoes('pagamento_atrasado', 'pagamentos', v_pag.id, COALESCE(public.automacao_contexto_os(v_os), '{}'::jsonb) || jsonb_build_object('pagamento', to_jsonb(v_pag)));
  END LOOP;

  FOR v_mat IN SELECT * FROM public.materiais WHERE estoque <= estoque_minimo LOOP
    v_count := v_count + public.enqueue_automacoes('estoque_minimo', 'materiais', v_mat.id, jsonb_build_object('material', to_jsonb(v_mat)));
  END LOOP;

  FOR v_os IN
    SELECT * FROM public.ordens_servico
    WHERE prazo_entrega IS NOT NULL
      AND prazo_entrega < CURRENT_DATE
      AND status NOT IN ('concluido','faturado','cancelado')
  LOOP
    v_count := v_count + public.enqueue_automacoes('os_atrasada', 'ordens_servico', v_os.id, public.automacao_contexto_os(v_os));
  END LOOP;

  RETURN v_count;
END $$;

INSERT INTO public.automacoes (nome, gatilho, condicao, acao, payload, ativo, delay_segundos, cooldown_segundos)
VALUES
  ('WhatsApp: mudança de status da OS', 'status_os_alterado', '{}'::jsonb, 'whatsapp', '{"mensagem":"Olá {{cliente.nome}}, a OS #{{os.numero}} ({{os.titulo}}) mudou para: {{status_novo}}."}'::jsonb, true, 0, 1800),
  ('WhatsApp: pagamento atrasado', 'pagamento_atrasado', '{}'::jsonb, 'whatsapp', '{"mensagem":"Olá {{cliente.nome}}, identificamos pagamento em aberto da OS #{{os.numero}} vencido em {{pagamento.data_vencimento}}. Pode nos chamar para regularizar."}'::jsonb, true, 0, 86400),
  ('WhatsApp interno: estoque mínimo', 'estoque_minimo', '{}'::jsonb, 'whatsapp', '{"mensagem":"Alerta de estoque: {{material.nome}} está com {{material.estoque}} {{material.unidade}}, abaixo do mínimo {{material.estoque_minimo}}.", "telefone":"{{admin_telefone}}"}'::jsonb, true, 0, 86400),
  ('WhatsApp interno: margem abaixo do mínimo', 'margem_abaixo_minimo', '{"margem_minima":30}'::jsonb, 'whatsapp', '{"mensagem":"Alerta: OS #{{os.numero}} está com margem real de {{os.margem_real}}%, abaixo do mínimo configurado."}'::jsonb, true, 0, 86400),
  ('WhatsApp: OS atrasada', 'os_atrasada', '{}'::jsonb, 'whatsapp', '{"mensagem":"Olá {{cliente.nome}}, a OS #{{os.numero}} está com prazo em revisão. Nossa equipe atualizará você em breve."}'::jsonb, true, 0, 86400),
  ('WhatsApp: conclusão da OS', 'os_concluida', '{}'::jsonb, 'whatsapp', '{"mensagem":"Olá {{cliente.nome}}, sua OS #{{os.numero}} foi concluída. Obrigado por escolher a BEX PRINT!"}'::jsonb, true, 0, 3600)
ON CONFLICT DO NOTHING;
