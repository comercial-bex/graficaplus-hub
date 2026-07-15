-- Expande a base de precificação 3D com os demais defaults herdados por novos
-- orçamentos: mão de obra (calculada de salário + encargos + horas), markups
-- padrão (varejo/atacado) e percentuais/adm padrão.
ALTER TABLE public.config_precificacao_3d
  ADD COLUMN IF NOT EXISTS mo_custo_hora_padrao numeric NOT NULL DEFAULT 40,
  ADD COLUMN IF NOT EXISTS mo_salario_mensal numeric,
  ADD COLUMN IF NOT EXISTS mo_encargos_pct numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS mo_horas_mensais numeric NOT NULL DEFAULT 220,
  ADD COLUMN IF NOT EXISTS markup_padrao numeric NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS markup_atacado_padrao numeric NOT NULL DEFAULT 1.5,
  ADD COLUMN IF NOT EXISTS pct_acabamento_padrao numeric NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS pct_falha_padrao numeric NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS custo_admin_padrao numeric NOT NULL DEFAULT 0;
