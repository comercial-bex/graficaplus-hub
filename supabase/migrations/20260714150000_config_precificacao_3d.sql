-- Base de precificação 3D: parâmetros padrão herdados por novos orçamentos e
-- futuras máquinas. Começa com a tarifa de energia REAL (talão Equatorial Amapá
-- 06/2026), substituindo o default hardcoded 0,95.
--
-- tarifa_kwh_padrao = custo marginal de energia = (energia com tributos +
-- adicional de bandeira) / consumo = (284,89 + 6,50) / 257 = 1,1339 R$/kWh.

CREATE TABLE IF NOT EXISTS public.config_precificacao_3d (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),  -- single-row
  tarifa_kwh_padrao numeric(10,4) NOT NULL DEFAULT 0.95,
  -- snapshot do talão de referência (para auditoria/atualização futura)
  energia_distribuidora text,
  energia_referencia text,
  energia_consumo_kwh numeric,
  energia_total_fatura numeric,
  energia_tarifa_com_tributos numeric(10,6),
  energia_tarifa_sem_tributos numeric(10,6),
  energia_adicional_bandeira numeric,
  energia_icms_pct numeric,
  energia_pis_pct numeric,
  energia_cofins_pct numeric,
  observacao text,
  atualizado_por uuid REFERENCES public.usuarios(id),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.config_precificacao_3d TO authenticated;
GRANT ALL ON public.config_precificacao_3d TO service_role;
ALTER TABLE public.config_precificacao_3d ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "config 3d read" ON public.config_precificacao_3d;
CREATE POLICY "config 3d read" ON public.config_precificacao_3d
  FOR SELECT TO authenticated USING (require_permission('impressao3d.read') IS NOT NULL);
DROP POLICY IF EXISTS "config 3d manage" ON public.config_precificacao_3d;
CREATE POLICY "config 3d manage" ON public.config_precificacao_3d
  FOR ALL TO authenticated
  USING (require_permission('impressao3d.settings.manage') IS NOT NULL)
  WITH CHECK (require_permission('impressao3d.settings.manage') IS NOT NULL);

-- Seed com o talão real (Equatorial Amapá 06/2026)
INSERT INTO public.config_precificacao_3d (
  id, tarifa_kwh_padrao, energia_distribuidora, energia_referencia,
  energia_consumo_kwh, energia_total_fatura, energia_tarifa_com_tributos,
  energia_tarifa_sem_tributos, energia_adicional_bandeira,
  energia_icms_pct, energia_pis_pct, energia_cofins_pct, observacao
) VALUES (
  true, 1.1339, 'Equatorial Amapá', '06/2026',
  257, 317.26, 1.108521, 0.825150, 6.50, 18.0, 1.6823, 7.5441,
  'Tarifa marginal = (energia c/ tributos 284,89 + bandeira 6,50) / 257 kWh. B1 residencial normal, bifásico.'
) ON CONFLICT (id) DO NOTHING;
