-- Resultados financeiros e operacionais calculados no fechamento da OS
CREATE TABLE public.os_resultados (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  os_id UUID NOT NULL UNIQUE REFERENCES public.ordens_servico(id) ON DELETE CASCADE,
  custo_previsto NUMERIC(12,2) NOT NULL DEFAULT 0,
  custo_real NUMERIC(12,2) NOT NULL DEFAULT 0,
  lucro_previsto NUMERIC(12,2) NOT NULL DEFAULT 0,
  lucro_real NUMERIC(12,2) NOT NULL DEFAULT 0,
  margem_prevista NUMERIC(5,2),
  margem_real NUMERIC(5,2),
  tempo_previsto NUMERIC(12,2),
  tempo_real NUMERIC(12,2),
  material_previsto NUMERIC(12,2),
  material_consumido NUMERIC(12,2) NOT NULL DEFAULT 0,
  motivo_divergencia TEXT,
  fechado_por UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  fechado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.os_resultados TO authenticated;
GRANT ALL ON public.os_resultados TO service_role;
ALTER TABLE public.os_resultados ENABLE ROW LEVEL SECURITY;

CREATE POLICY "os_resultados financeiro read" ON public.os_resultados
FOR SELECT TO authenticated USING (public.can_see_financials(auth.uid()));

CREATE TRIGGER tg_os_resultados_updated
BEFORE UPDATE ON public.os_resultados
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE public.ocorrencias
ADD COLUMN IF NOT EXISTS custo_real NUMERIC(12,2) NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.fechar_os(os_id UUID)
RETURNS public.os_resultados
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_os public.ordens_servico%ROWTYPE;
  v_custos_lancados NUMERIC(12,2) := 0;
  v_custo_material NUMERIC(12,2) := 0;
  v_custo_ocorrencias NUMERIC(12,2) := 0;
  v_material_consumido NUMERIC(12,2) := 0;
  v_material_previsto NUMERIC(12,2) := 0;
  v_custo_previsto NUMERIC(12,2) := 0;
  v_custo_real NUMERIC(12,2) := 0;
  v_lucro_previsto NUMERIC(12,2) := 0;
  v_lucro_real NUMERIC(12,2) := 0;
  v_margem_prevista NUMERIC(5,2);
  v_margem_real NUMERIC(5,2);
  v_tempo_real NUMERIC(12,2);
  v_missing_material_costs INT := 0;
  v_real_cost_sources INT := 0;
  v_result public.os_resultados%ROWTYPE;
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Usuário sem permissão para fechar OS';
  END IF;

  SELECT * INTO v_os
  FROM public.ordens_servico
  WHERE id = fechar_os.os_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'OS % não encontrada', fechar_os.os_id;
  END IF;

  SELECT COALESCE(SUM(valor), 0), COUNT(*)
    INTO v_custos_lancados, v_real_cost_sources
  FROM public.custos_os
  WHERE custos_os.os_id = fechar_os.os_id;

  SELECT
    COALESCE(SUM(CASE WHEN m.tipo IN ('saida', 'perda') THEN ABS(m.quantidade) * mat.custo_unitario ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN m.tipo IN ('saida', 'perda') THEN ABS(m.quantidade) ELSE 0 END), 0),
    COUNT(*) FILTER (WHERE m.tipo IN ('saida', 'perda') AND mat.custo_unitario IS NULL)
    INTO v_custo_material, v_material_consumido, v_missing_material_costs
  FROM public.movimentacoes_estoque m
  JOIN public.materiais mat ON mat.id = m.material_id
  WHERE m.os_id = fechar_os.os_id;

  IF v_missing_material_costs > 0 THEN
    RAISE EXCEPTION 'Existem movimentações de estoque sem custo unitário do material';
  END IF;

  SELECT COALESCE(SUM(custo_real), 0)
    INTO v_custo_ocorrencias
  FROM public.ocorrencias
  WHERE ocorrencias.os_id = fechar_os.os_id;

  SELECT COALESCE(SUM(quantidade), 0), COALESCE(SUM(quantidade * custo_unitario), 0)
    INTO v_material_previsto, v_custo_previsto
  FROM public.itens_os
  WHERE itens_os.os_id = fechar_os.os_id;

  v_custo_previsto := COALESCE(NULLIF(v_os.custo_previsto, 0), v_custo_previsto, 0);
  v_custo_real := COALESCE(v_custos_lancados, 0) + COALESCE(v_custo_material, 0) + COALESCE(v_custo_ocorrencias, 0);

  IF v_custo_real <= 0 THEN
    RAISE EXCEPTION 'Custo real obrigatório ausente para fechamento da OS';
  END IF;

  v_lucro_previsto := COALESCE(v_os.valor_total, 0) - v_custo_previsto;
  v_lucro_real := COALESCE(v_os.valor_total, 0) - v_custo_real;

  IF COALESCE(v_os.valor_total, 0) > 0 THEN
    v_margem_prevista := ROUND((v_lucro_previsto / v_os.valor_total) * 100, 2);
    v_margem_real := ROUND((v_lucro_real / v_os.valor_total) * 100, 2);
  END IF;

  IF v_os.data_entrega_real IS NOT NULL THEN
    v_tempo_real := ROUND(EXTRACT(EPOCH FROM (v_os.data_entrega_real - v_os.created_at)) / 3600, 2);
  END IF;

  INSERT INTO public.os_resultados (
    os_id, custo_previsto, custo_real, lucro_previsto, lucro_real,
    margem_prevista, margem_real, tempo_previsto, tempo_real,
    material_previsto, material_consumido, motivo_divergencia,
    fechado_por, fechado_em
  ) VALUES (
    fechar_os.os_id, v_custo_previsto, v_custo_real, v_lucro_previsto, v_lucro_real,
    v_margem_prevista, v_margem_real, NULL, v_tempo_real,
    v_material_previsto, v_material_consumido,
    CASE
      WHEN ABS(v_custo_real - v_custo_previsto) > 0.01 THEN
        'Custo real diferente do previsto: previsto R$ ' || v_custo_previsto || ', real R$ ' || v_custo_real
      ELSE NULL
    END,
    auth.uid(), now()
  )
  ON CONFLICT (os_id) DO UPDATE SET
    custo_previsto = EXCLUDED.custo_previsto,
    custo_real = EXCLUDED.custo_real,
    lucro_previsto = EXCLUDED.lucro_previsto,
    lucro_real = EXCLUDED.lucro_real,
    margem_prevista = EXCLUDED.margem_prevista,
    margem_real = EXCLUDED.margem_real,
    tempo_previsto = EXCLUDED.tempo_previsto,
    tempo_real = EXCLUDED.tempo_real,
    material_previsto = EXCLUDED.material_previsto,
    material_consumido = EXCLUDED.material_consumido,
    motivo_divergencia = EXCLUDED.motivo_divergencia,
    fechado_por = EXCLUDED.fechado_por,
    fechado_em = EXCLUDED.fechado_em
  RETURNING * INTO v_result;

  UPDATE public.ordens_servico
  SET status = 'concluido',
      custo_previsto = v_custo_previsto,
      custo_real = v_custo_real,
      margem_real = v_margem_real,
      data_entrega_real = COALESCE(data_entrega_real, now())
  WHERE id = fechar_os.os_id;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fechar_os(UUID) TO authenticated;
