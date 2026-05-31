-- =========================================================================
-- BEX PRINT OS — Relatórios prioritários
-- =========================================================================

-- Dados operacionais que ainda não existiam no schema base.
CREATE TABLE IF NOT EXISTS public.apontamentos_producao (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  os_id UUID REFERENCES public.ordens_servico(id) ON DELETE SET NULL,
  maquina_id UUID REFERENCES public.maquinas(id) ON DELETE SET NULL,
  etapa TEXT NOT NULL,
  setor TEXT,
  quantidade NUMERIC(12,2) NOT NULL DEFAULT 0,
  iniciado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  finalizado_em TIMESTAMPTZ,
  operador_id UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  observacoes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.apontamentos_producao TO authenticated;
GRANT ALL ON public.apontamentos_producao TO service_role;
ALTER TABLE public.apontamentos_producao ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "apontamentos staff read" ON public.apontamentos_producao;
DROP POLICY IF EXISTS "apontamentos staff write" ON public.apontamentos_producao;
CREATE POLICY "apontamentos staff read" ON public.apontamentos_producao FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "apontamentos staff write" ON public.apontamentos_producao FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

ALTER TABLE public.ocorrencias ADD COLUMN IF NOT EXISTS setor TEXT;
ALTER TABLE public.ocorrencias ADD COLUMN IF NOT EXISTS retrabalho BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.ocorrencias ADD COLUMN IF NOT EXISTS custo NUMERIC(12,2) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.conversas_whatsapp (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id UUID REFERENCES public.clientes(id) ON DELETE SET NULL,
  contato_nome TEXT NOT NULL,
  telefone TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'aberta',
  atendente_id UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  etiqueta TEXT,
  aberta_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  fechada_em TIMESTAMPTZ,
  ultima_mensagem_em TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversas_whatsapp TO authenticated;
GRANT ALL ON public.conversas_whatsapp TO service_role;
ALTER TABLE public.conversas_whatsapp ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "conv whatsapp staff read" ON public.conversas_whatsapp;
DROP POLICY IF EXISTS "conv whatsapp staff write" ON public.conversas_whatsapp;
CREATE POLICY "conv whatsapp staff read" ON public.conversas_whatsapp FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "conv whatsapp staff write" ON public.conversas_whatsapp FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
DROP TRIGGER IF EXISTS tg_conversas_whatsapp_updated ON public.conversas_whatsapp;
CREATE TRIGGER tg_conversas_whatsapp_updated BEFORE UPDATE ON public.conversas_whatsapp FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE IF NOT EXISTS public.mensagens_whatsapp (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversa_id UUID NOT NULL REFERENCES public.conversas_whatsapp(id) ON DELETE CASCADE,
  direcao TEXT NOT NULL CHECK (direcao IN ('entrada','saida')),
  texto TEXT,
  enviada_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  usuario_id UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.mensagens_whatsapp TO authenticated;
GRANT ALL ON public.mensagens_whatsapp TO service_role;
ALTER TABLE public.mensagens_whatsapp ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "msg whatsapp staff read" ON public.mensagens_whatsapp;
DROP POLICY IF EXISTS "msg whatsapp staff write" ON public.mensagens_whatsapp;
CREATE POLICY "msg whatsapp staff read" ON public.mensagens_whatsapp FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "msg whatsapp staff write" ON public.mensagens_whatsapp FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE INDEX IF NOT EXISTS idx_pagamentos_status_data ON public.pagamentos(status, data_pagamento, created_at);
CREATE INDEX IF NOT EXISTS idx_ordens_servico_prazo_status ON public.ordens_servico(prazo_entrega, status);
CREATE INDEX IF NOT EXISTS idx_itens_os_os ON public.itens_os(os_id);
CREATE INDEX IF NOT EXISTS idx_custos_os_os ON public.custos_os(os_id);
CREATE INDEX IF NOT EXISTS idx_ocorrencias_setor_retrabalho ON public.ocorrencias(setor, retrabalho, created_at);
CREATE INDEX IF NOT EXISTS idx_apontamentos_periodo ON public.apontamentos_producao(iniciado_em, finalizado_em);
CREATE INDEX IF NOT EXISTS idx_apontamentos_maquina ON public.apontamentos_producao(maquina_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_status_periodo ON public.conversas_whatsapp(status, aberta_em, fechada_em);
CREATE INDEX IF NOT EXISTS idx_whatsapp_msg_conversa_tempo ON public.mensagens_whatsapp(conversa_id, enviada_em);

-- Views prioritárias. security_invoker mantém as regras RLS das tabelas base.
CREATE OR REPLACE VIEW public.rel_faturamento_por_periodo
WITH (security_invoker = true) AS
SELECT
  COALESCE(p.data_pagamento, p.created_at::date) AS periodo,
  COUNT(*) AS pagamentos,
  COUNT(DISTINCT p.os_id) AS ordens_servico,
  SUM(p.valor)::NUMERIC(12,2) AS faturamento
FROM public.pagamentos p
WHERE p.status = 'pago'
GROUP BY 1;

CREATE OR REPLACE VIEW public.rel_lucro_por_os
WITH (security_invoker = true) AS
SELECT
  os.id AS os_id,
  os.numero,
  os.titulo,
  c.nome AS cliente,
  os.created_at::date AS criada_em,
  os.status,
  COALESCE(pg.receita, os.valor_total, 0)::NUMERIC(12,2) AS receita,
  COALESCE(NULLIF(co.custos_lancados, 0), os.custo_real, os.custo_previsto, 0)::NUMERIC(12,2) AS custo,
  (COALESCE(pg.receita, os.valor_total, 0) - COALESCE(NULLIF(co.custos_lancados, 0), os.custo_real, os.custo_previsto, 0))::NUMERIC(12,2) AS lucro,
  CASE WHEN COALESCE(pg.receita, os.valor_total, 0) > 0 THEN
    ROUND(((COALESCE(pg.receita, os.valor_total, 0) - COALESCE(NULLIF(co.custos_lancados, 0), os.custo_real, os.custo_previsto, 0)) / COALESCE(pg.receita, os.valor_total, 0)) * 100, 2)
  ELSE NULL END AS margem_percentual
FROM public.ordens_servico os
JOIN public.clientes c ON c.id = os.cliente_id
LEFT JOIN LATERAL (
  SELECT SUM(valor) AS receita FROM public.pagamentos p WHERE p.os_id = os.id AND p.status = 'pago'
) pg ON true
LEFT JOIN LATERAL (
  SELECT SUM(valor) AS custos_lancados FROM public.custos_os co WHERE co.os_id = os.id
) co ON true;

CREATE OR REPLACE VIEW public.rel_margem_por_produto
WITH (security_invoker = true) AS
SELECT
  io.descricao AS produto,
  SUM(io.quantidade)::NUMERIC(12,2) AS quantidade,
  SUM(io.valor_total)::NUMERIC(12,2) AS receita,
  SUM(io.quantidade * io.custo_unitario)::NUMERIC(12,2) AS custo,
  (SUM(io.valor_total) - SUM(io.quantidade * io.custo_unitario))::NUMERIC(12,2) AS margem_valor,
  CASE WHEN SUM(io.valor_total) > 0 THEN ROUND(((SUM(io.valor_total) - SUM(io.quantidade * io.custo_unitario)) / SUM(io.valor_total)) * 100, 2) ELSE NULL END AS margem_percentual,
  MIN(os.created_at)::date AS primeira_venda,
  MAX(os.created_at)::date AS ultima_venda
FROM public.itens_os io
JOIN public.ordens_servico os ON os.id = io.os_id
GROUP BY io.descricao;

CREATE OR REPLACE VIEW public.rel_os_atrasadas
WITH (security_invoker = true) AS
SELECT
  os.id AS os_id,
  os.numero,
  os.titulo,
  c.nome AS cliente,
  os.status,
  os.prazo_entrega,
  (CURRENT_DATE - os.prazo_entrega)::INT AS dias_atraso,
  os.valor_total
FROM public.ordens_servico os
JOIN public.clientes c ON c.id = os.cliente_id
WHERE os.prazo_entrega < CURRENT_DATE
  AND os.status NOT IN ('concluido','faturado','cancelado');

CREATE OR REPLACE VIEW public.rel_retrabalho_por_setor
WITH (security_invoker = true) AS
SELECT
  COALESCE(NULLIF(o.setor, ''), 'Sem setor') AS setor,
  COUNT(*) FILTER (WHERE o.retrabalho) AS retrabalhos,
  COUNT(*) AS ocorrencias,
  SUM(o.custo)::NUMERIC(12,2) AS custo_total,
  MIN(o.created_at)::date AS primeira_ocorrencia,
  MAX(o.created_at)::date AS ultima_ocorrencia
FROM public.ocorrencias o
WHERE o.retrabalho = true OR lower(o.tipo) LIKE '%retrabalho%'
GROUP BY 1;

CREATE OR REPLACE VIEW public.rel_producao_por_maquina
WITH (security_invoker = true) AS
SELECT
  m.id AS maquina_id,
  m.nome AS maquina,
  m.tipo,
  COUNT(ap.id) AS apontamentos,
  COUNT(DISTINCT ap.os_id) AS ordens_servico,
  COALESCE(SUM(ap.quantidade), 0)::NUMERIC(12,2) AS quantidade_produzida,
  ROUND(COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(ap.finalizado_em, now()) - ap.iniciado_em))) / 3600, 0)::NUMERIC, 2) AS horas_produzidas,
  MIN(ap.iniciado_em)::date AS primeiro_apontamento,
  MAX(COALESCE(ap.finalizado_em, ap.iniciado_em))::date AS ultimo_apontamento
FROM public.maquinas m
LEFT JOIN public.apontamentos_producao ap ON ap.maquina_id = m.id
GROUP BY m.id, m.nome, m.tipo;

CREATE OR REPLACE VIEW public.rel_tempo_medio_por_etapa
WITH (security_invoker = true) AS
SELECT
  ap.etapa,
  COUNT(*) FILTER (WHERE ap.finalizado_em IS NOT NULL) AS apontamentos_concluidos,
  ROUND(AVG(EXTRACT(EPOCH FROM (ap.finalizado_em - ap.iniciado_em))) FILTER (WHERE ap.finalizado_em IS NOT NULL) / 3600, 2) AS horas_media,
  ROUND(MIN(EXTRACT(EPOCH FROM (ap.finalizado_em - ap.iniciado_em))) FILTER (WHERE ap.finalizado_em IS NOT NULL) / 3600, 2) AS horas_minima,
  ROUND(MAX(EXTRACT(EPOCH FROM (ap.finalizado_em - ap.iniciado_em))) FILTER (WHERE ap.finalizado_em IS NOT NULL) / 3600, 2) AS horas_maxima
FROM public.apontamentos_producao ap
GROUP BY ap.etapa;

CREATE OR REPLACE VIEW public.rel_whatsapp_conversas_abertas
WITH (security_invoker = true) AS
SELECT
  cw.id AS conversa_id,
  cw.contato_nome,
  cw.telefone,
  cw.etiqueta,
  u.nome AS atendente,
  cw.aberta_em,
  COALESCE(cw.ultima_mensagem_em, MAX(mw.enviada_em), cw.aberta_em) AS ultima_mensagem_em,
  COUNT(mw.id) FILTER (WHERE mw.direcao = 'entrada') AS mensagens_entrada,
  COUNT(mw.id) FILTER (WHERE mw.direcao = 'saida') AS mensagens_saida
FROM public.conversas_whatsapp cw
LEFT JOIN public.usuarios u ON u.id = cw.atendente_id
LEFT JOIN public.mensagens_whatsapp mw ON mw.conversa_id = cw.id
WHERE cw.status IN ('aberta','em_atendimento','novo')
GROUP BY cw.id, cw.contato_nome, cw.telefone, cw.etiqueta, u.nome, cw.aberta_em, cw.ultima_mensagem_em;

CREATE OR REPLACE VIEW public.rel_whatsapp_tempo_medio_resposta
WITH (security_invoker = true) AS
WITH respostas AS (
  SELECT
    entrada.conversa_id,
    entrada.enviada_em AS recebida_em,
    (
      SELECT MIN(saida.enviada_em)
      FROM public.mensagens_whatsapp saida
      WHERE saida.conversa_id = entrada.conversa_id
        AND saida.direcao = 'saida'
        AND saida.enviada_em > entrada.enviada_em
    ) AS respondida_em
  FROM public.mensagens_whatsapp entrada
  WHERE entrada.direcao = 'entrada'
)
SELECT
  cw.id AS conversa_id,
  cw.contato_nome,
  u.nome AS atendente,
  COUNT(*) FILTER (WHERE r.respondida_em IS NOT NULL) AS respostas,
  ROUND(AVG(EXTRACT(EPOCH FROM (r.respondida_em - r.recebida_em))) FILTER (WHERE r.respondida_em IS NOT NULL) / 60, 2) AS minutos_media_resposta
FROM public.conversas_whatsapp cw
LEFT JOIN public.usuarios u ON u.id = cw.atendente_id
JOIN respostas r ON r.conversa_id = cw.id
GROUP BY cw.id, cw.contato_nome, u.nome;

GRANT SELECT ON public.rel_faturamento_por_periodo TO authenticated;
GRANT SELECT ON public.rel_lucro_por_os TO authenticated;
GRANT SELECT ON public.rel_margem_por_produto TO authenticated;
GRANT SELECT ON public.rel_os_atrasadas TO authenticated;
GRANT SELECT ON public.rel_retrabalho_por_setor TO authenticated;
GRANT SELECT ON public.rel_producao_por_maquina TO authenticated;
GRANT SELECT ON public.rel_tempo_medio_por_etapa TO authenticated;
GRANT SELECT ON public.rel_whatsapp_conversas_abertas TO authenticated;
GRANT SELECT ON public.rel_whatsapp_tempo_medio_resposta TO authenticated;

CREATE OR REPLACE FUNCTION public.get_relatorios_prioritarios(p_inicio DATE DEFAULT (CURRENT_DATE - INTERVAL '30 days')::date, p_fim DATE DEFAULT CURRENT_DATE)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_inicio DATE := COALESCE(p_inicio, (CURRENT_DATE - INTERVAL '30 days')::date);
  v_fim DATE := COALESCE(p_fim, CURRENT_DATE);
  v_can_fin BOOLEAN := public.can_see_financials(auth.uid());
  v_result JSONB;
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Acesso negado aos relatórios';
  END IF;

  SELECT jsonb_build_object(
    'canSeeFinancials', v_can_fin,
    'periodo', jsonb_build_object('inicio', v_inicio, 'fim', v_fim),
    'financeiro', CASE WHEN v_can_fin THEN jsonb_build_object(
      'faturamentoPorPeriodo', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.periodo) FROM (
        SELECT * FROM public.rel_faturamento_por_periodo WHERE periodo BETWEEN v_inicio AND v_fim
      ) x), '[]'::jsonb),
      'lucroPorOs', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.lucro DESC) FROM (
        SELECT * FROM public.rel_lucro_por_os WHERE criada_em BETWEEN v_inicio AND v_fim LIMIT 100
      ) x), '[]'::jsonb),
      'margemPorProduto', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.margem_valor DESC) FROM (
        SELECT * FROM public.rel_margem_por_produto WHERE ultima_venda BETWEEN v_inicio AND v_fim LIMIT 100
      ) x), '[]'::jsonb)
    ) ELSE NULL END,
    'operacional', jsonb_build_object(
      'osAtrasadas', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.dias_atraso DESC) FROM (
        SELECT * FROM public.rel_os_atrasadas LIMIT 100
      ) x), '[]'::jsonb),
      'retrabalhoPorSetor', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.retrabalhos DESC) FROM (
        SELECT * FROM public.rel_retrabalho_por_setor WHERE ultima_ocorrencia BETWEEN v_inicio AND v_fim
      ) x), '[]'::jsonb),
      'producaoPorMaquina', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.quantidade_produzida DESC) FROM (
        SELECT * FROM public.rel_producao_por_maquina WHERE ultimo_apontamento IS NULL OR ultimo_apontamento BETWEEN v_inicio AND v_fim
      ) x), '[]'::jsonb),
      'tempoMedioPorEtapa', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.horas_media DESC NULLS LAST) FROM (
        SELECT * FROM public.rel_tempo_medio_por_etapa
      ) x), '[]'::jsonb)
    ),
    'whatsapp', jsonb_build_object(
      'conversasAbertas', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.ultima_mensagem_em DESC) FROM (
        SELECT * FROM public.rel_whatsapp_conversas_abertas WHERE aberta_em::date <= v_fim LIMIT 100
      ) x), '[]'::jsonb),
      'tempoMedioResposta', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.minutos_media_resposta DESC NULLS LAST) FROM (
        SELECT * FROM public.rel_whatsapp_tempo_medio_resposta LIMIT 100
      ) x), '[]'::jsonb)
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_relatorios_prioritarios(DATE, DATE) TO authenticated;
