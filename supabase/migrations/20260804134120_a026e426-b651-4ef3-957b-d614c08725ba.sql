-- ============ BLOCO 1: custo de máquina e mão de obra ============
ALTER TABLE public.maquinas
  ADD COLUMN IF NOT EXISTS custo_hora numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS potencia_kw numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS setup_min integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS velocidade_m2_h numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS disponibilidade_pct numeric NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS setor text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS public.custos_mao_de_obra (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  funcao text NOT NULL,
  custo_hora numeric NOT NULL DEFAULT 0,
  encargos_pct numeric NOT NULL DEFAULT 0,
  setor text,
  ativo boolean NOT NULL DEFAULT true,
  observacoes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.custos_mao_de_obra TO authenticated;
GRANT ALL ON public.custos_mao_de_obra TO service_role;
ALTER TABLE public.custos_mao_de_obra ENABLE ROW LEVEL SECURITY;
CREATE POLICY "custos_mao_de_obra_read" ON public.custos_mao_de_obra
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "custos_mao_de_obra_write" ON public.custos_mao_de_obra
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.can_see_financials(auth.uid()))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.can_see_financials(auth.uid()));

-- ============ BLOCO 2: desperdício ============
DO $$ BEGIN
  CREATE TYPE public.motivo_perda AS ENUM ('refile','erro_arte','falha_impressao','teste_cor','material_defeituoso','outro');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.os_perdas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  os_id uuid REFERENCES public.ordens_servico(id) ON DELETE CASCADE,
  os_item_id uuid REFERENCES public.itens_os(id) ON DELETE SET NULL,
  material_id uuid REFERENCES public.materiais(id) ON DELETE SET NULL,
  maquina_id uuid REFERENCES public.maquinas(id) ON DELETE SET NULL,
  operador_id uuid,
  quantidade_planejada numeric NOT NULL DEFAULT 0,
  quantidade_produzida numeric NOT NULL DEFAULT 0,
  quantidade_perdida numeric NOT NULL DEFAULT 0,
  unidade text NOT NULL DEFAULT 'un',
  motivo public.motivo_perda NOT NULL DEFAULT 'outro',
  custo_unitario numeric NOT NULL DEFAULT 0,
  custo_total numeric GENERATED ALWAYS AS (quantidade_perdida * custo_unitario) STORED,
  observacoes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.os_perdas TO authenticated;
GRANT ALL ON public.os_perdas TO service_role;
ALTER TABLE public.os_perdas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "os_perdas_all" ON public.os_perdas
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_os_perdas_os ON public.os_perdas(os_id);
CREATE INDEX IF NOT EXISTS idx_os_perdas_maquina ON public.os_perdas(maquina_id);

-- ============ BLOCO 3: fluxo de caixa ============
DO $$ BEGIN
  CREATE TYPE public.status_conta_pagar AS ENUM ('aberta','paga','atrasada','cancelada');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.contas_pagar (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  descricao text NOT NULL,
  fornecedor text,
  categoria text NOT NULL DEFAULT 'geral',
  valor numeric NOT NULL DEFAULT 0,
  vencimento date NOT NULL DEFAULT current_date,
  data_pagamento date,
  status public.status_conta_pagar NOT NULL DEFAULT 'aberta',
  forma_pagamento text,
  recorrente boolean NOT NULL DEFAULT false,
  periodicidade text,
  os_id uuid REFERENCES public.ordens_servico(id) ON DELETE SET NULL,
  material_id uuid REFERENCES public.materiais(id) ON DELETE SET NULL,
  comprovante_url text,
  observacoes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contas_pagar TO authenticated;
GRANT ALL ON public.contas_pagar TO service_role;
ALTER TABLE public.contas_pagar ENABLE ROW LEVEL SECURITY;
CREATE POLICY "contas_pagar_fin" ON public.contas_pagar
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.can_see_financials(auth.uid()))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.can_see_financials(auth.uid()));
CREATE INDEX IF NOT EXISTS idx_contas_pagar_venc ON public.contas_pagar(vencimento);

CREATE TABLE IF NOT EXISTS public.caixa_movimentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo text NOT NULL DEFAULT 'entrada',
  origem text NOT NULL DEFAULT 'manual',
  descricao text NOT NULL,
  categoria text,
  valor numeric NOT NULL DEFAULT 0,
  data date NOT NULL DEFAULT current_date,
  realizado boolean NOT NULL DEFAULT true,
  os_id uuid REFERENCES public.ordens_servico(id) ON DELETE SET NULL,
  pagamento_id uuid REFERENCES public.pagamentos(id) ON DELETE SET NULL,
  conta_pagar_id uuid REFERENCES public.contas_pagar(id) ON DELETE SET NULL,
  observacoes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.caixa_movimentos TO authenticated;
GRANT ALL ON public.caixa_movimentos TO service_role;
ALTER TABLE public.caixa_movimentos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "caixa_movimentos_fin" ON public.caixa_movimentos
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.can_see_financials(auth.uid()))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.can_see_financials(auth.uid()));
CREATE INDEX IF NOT EXISTS idx_caixa_mov_data ON public.caixa_movimentos(data);

CREATE OR REPLACE VIEW public.vw_fluxo_caixa
WITH (security_invoker = true) AS
SELECT
  p.data_vencimento::date AS data,
  'entrada'::text AS tipo,
  'pagamento'::text AS origem,
  p.valor,
  (p.status = 'pago') AS realizado,
  p.os_id,
  COALESCE(p.forma_pagamento, 'nao_informado') AS categoria
FROM public.pagamentos p
UNION ALL
SELECT
  cp.vencimento AS data,
  'saida'::text,
  'conta_pagar'::text,
  cp.valor,
  (cp.status = 'paga'),
  cp.os_id,
  cp.categoria
FROM public.contas_pagar cp
UNION ALL
SELECT
  cm.data,
  cm.tipo,
  cm.origem,
  cm.valor,
  cm.realizado,
  cm.os_id,
  COALESCE(cm.categoria, 'geral')
FROM public.caixa_movimentos cm
WHERE cm.pagamento_id IS NULL AND cm.conta_pagar_id IS NULL;

GRANT SELECT ON public.vw_fluxo_caixa TO authenticated;

-- ============ BLOCO 5 (schema): tarefas tipadas ============
DO $$ BEGIN
  CREATE TYPE public.tipo_tarefa AS ENUM ('tarefa','checklist','comentario','visita','reuniao','whatsapp','ligacao');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.os_tarefas
  ADD COLUMN IF NOT EXISTS tipo public.tipo_tarefa NOT NULL DEFAULT 'tarefa',
  ADD COLUMN IF NOT EXISTS cliente_id uuid REFERENCES public.clientes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS local text;

ALTER TABLE public.os_tarefas ALTER COLUMN os_id DROP NOT NULL;

-- updated_at triggers
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $fn$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $fn$;

DROP TRIGGER IF EXISTS trg_custos_mo_updated ON public.custos_mao_de_obra;
CREATE TRIGGER trg_custos_mo_updated BEFORE UPDATE ON public.custos_mao_de_obra
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS trg_contas_pagar_updated ON public.contas_pagar;
CREATE TRIGGER trg_contas_pagar_updated BEFORE UPDATE ON public.contas_pagar
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();