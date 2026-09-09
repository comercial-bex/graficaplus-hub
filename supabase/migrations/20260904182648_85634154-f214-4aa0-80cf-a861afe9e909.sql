
-- 1. Planilha de custos
CREATE TABLE public.custos_tabela (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  categoria text NOT NULL DEFAULT 'geral',
  codigo text NOT NULL UNIQUE,
  descricao text NOT NULL,
  unidade text NOT NULL DEFAULT 'un',
  valor numeric NOT NULL DEFAULT 0,
  observacao text,
  ativo boolean NOT NULL DEFAULT true,
  atualizado_por uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.custos_tabela TO authenticated;
GRANT ALL ON public.custos_tabela TO service_role;
ALTER TABLE public.custos_tabela ENABLE ROW LEVEL SECURITY;
CREATE POLICY "custos_tabela_read" ON public.custos_tabela FOR SELECT TO authenticated USING (true);
CREATE POLICY "custos_tabela_write" ON public.custos_tabela FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.custos_tabela_historico (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  custo_id uuid NOT NULL REFERENCES public.custos_tabela(id) ON DELETE CASCADE,
  codigo text NOT NULL,
  valor_anterior numeric,
  valor_novo numeric,
  alterado_por uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.custos_tabela_historico TO authenticated;
GRANT ALL ON public.custos_tabela_historico TO service_role;
ALTER TABLE public.custos_tabela_historico ENABLE ROW LEVEL SECURITY;
CREATE POLICY "custos_hist_read" ON public.custos_tabela_historico FOR SELECT TO authenticated USING (true);
CREATE POLICY "custos_hist_insert" ON public.custos_tabela_historico FOR INSERT TO authenticated WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.custos_tabela_log()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.updated_at = now();
  IF TG_OP = 'UPDATE' AND NEW.valor IS DISTINCT FROM OLD.valor THEN
    INSERT INTO public.custos_tabela_historico (custo_id, codigo, valor_anterior, valor_novo, alterado_por)
    VALUES (NEW.id, NEW.codigo, OLD.valor, NEW.valor, auth.uid());
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_custos_tabela_log BEFORE UPDATE ON public.custos_tabela
FOR EACH ROW EXECUTE FUNCTION public.custos_tabela_log();

INSERT INTO public.custos_tabela (categoria, codigo, descricao, unidade, valor, observacao) VALUES
 ('energia','energia_tarifa_kwh','Tarifa de energia (com tributos)','R$/kWh',1.1339,'Calculada da fatura da distribuidora'),
 ('mao_de_obra','mo_custo_hora','Mão de obra - custo por hora','R$/h',40.00,'Operador padrão'),
 ('mao_de_obra','mo_encargos_pct','Encargos sobre mão de obra','%',80,'Percentual sobre o custo/hora'),
 ('markup','markup_padrao','Markup padrão de venda','%',60,null),
 ('markup','markup_atacado','Markup para atacado','%',35,null),
 ('perdas','pct_perda_material','Perda média de material (refile)','%',8,null),
 ('perdas','pct_falha_producao','Falha de produção','%',5,null),
 ('geral','custo_admin_hora','Custo administrativo por hora','R$/h',12.00,'Aluguel, internet, software rateados'),
 ('taxas','taxa_cartao','Taxa média de cartão','%',3.5,null),
 ('taxas','impostos_venda','Impostos sobre venda','%',6,null);

-- 2. Prazos/projeto no orçamento
ALTER TABLE public.orcamentos
  ADD COLUMN IF NOT EXISTS data_inicio date,
  ADD COLUMN IF NOT EXISTS data_entrega_prometida date;

-- 3. Contas bancárias e extrato
CREATE TABLE public.contas_bancarias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  banco text,
  agencia text,
  conta text,
  tipo text NOT NULL DEFAULT 'corrente',
  saldo_inicial numeric NOT NULL DEFAULT 0,
  saldo_inicial_data date NOT NULL DEFAULT current_date,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contas_bancarias TO authenticated;
GRANT ALL ON public.contas_bancarias TO service_role;
ALTER TABLE public.contas_bancarias ENABLE ROW LEVEL SECURITY;
CREATE POLICY "contas_bancarias_all" ON public.contas_bancarias FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.banco_transacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conta_id uuid NOT NULL REFERENCES public.contas_bancarias(id) ON DELETE CASCADE,
  data date NOT NULL,
  descricao text NOT NULL DEFAULT '',
  valor numeric NOT NULL,
  tipo text NOT NULL DEFAULT 'credito',
  documento text,
  fitid text,
  origem text NOT NULL DEFAULT 'manual',
  conciliado boolean NOT NULL DEFAULT false,
  caixa_movimento_id uuid REFERENCES public.caixa_movimentos(id) ON DELETE SET NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX banco_transacoes_fitid_uk ON public.banco_transacoes (conta_id, fitid) WHERE fitid IS NOT NULL;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.banco_transacoes TO authenticated;
GRANT ALL ON public.banco_transacoes TO service_role;
ALTER TABLE public.banco_transacoes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "banco_transacoes_all" ON public.banco_transacoes FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.caixa_movimentos ADD COLUMN IF NOT EXISTS conta_id uuid REFERENCES public.contas_bancarias(id) ON DELETE SET NULL;

CREATE OR REPLACE VIEW public.vw_saldo_contas
WITH (security_invoker = true) AS
SELECT c.id AS conta_id, c.nome, c.banco, c.saldo_inicial, c.saldo_inicial_data, c.ativo,
  c.saldo_inicial + COALESCE((SELECT sum(t.valor) FROM public.banco_transacoes t WHERE t.conta_id = c.id AND t.data >= c.saldo_inicial_data), 0) AS saldo_real,
  (SELECT max(t.data) FROM public.banco_transacoes t WHERE t.conta_id = c.id) AS ultima_movimentacao,
  (SELECT count(*) FROM public.banco_transacoes t WHERE t.conta_id = c.id AND NOT t.conciliado) AS pendentes_conciliacao
FROM public.contas_bancarias c;
GRANT SELECT ON public.vw_saldo_contas TO authenticated;
