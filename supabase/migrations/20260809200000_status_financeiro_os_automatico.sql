-- status_financeiro da OS nunca saía de 'pendente'.
--
-- Achado na homologação ponta a ponta da OS #11: com R$ 264,00 registrados em
-- `pagamentos` (metade de R$ 528,00), `ordens_servico.status_financeiro`
-- continuava 'pendente'. Os dois triggers existentes em `pagamentos` cuidam de
-- updated_at e de enfileirar automação — nenhum recalculava o status da OS, e
-- nenhum outro ponto do sistema o fazia.
--
-- Consequência: o campo era decorativo. O cartão do Kanban mostrava
-- "Fin.: Não lançado" para OS já paga em parte, e qualquer relatório ou alerta
-- baseado em status_financeiro tratava cliente que pagou metade como
-- inadimplente. É o mesmo padrão de duas tabelas sem gatilho entre elas.
--
-- Passa a ser derivado do que foi efetivamente pago:
--   nada pago                    -> pendente
--   pago > 0 e menor que o total -> parcial
--   pago >= total                -> pago
--
-- Estornos entram como valor negativo em `pagamentos`, então a soma volta a
-- refletir a realidade sozinha. 'atrasado' e 'cancelado' continuam sendo
-- decisão humana: não são deriváveis do valor pago e não são sobrescritos aqui.

CREATE OR REPLACE FUNCTION public.recalcular_status_financeiro_os(p_os_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_total NUMERIC;
  v_pago NUMERIC;
  v_novo public.status_pagamento;
BEGIN
  SELECT COALESCE(valor_total, 0) INTO v_total
  FROM public.ordens_servico WHERE id = p_os_id;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT COALESCE(SUM(valor), 0) INTO v_pago
  FROM public.pagamentos
  WHERE os_id = p_os_id AND status IN ('pago', 'parcial');

  v_novo := CASE
    WHEN v_pago <= 0 THEN 'pendente'::public.status_pagamento
    WHEN v_total > 0 AND v_pago >= v_total THEN 'pago'::public.status_pagamento
    ELSE 'parcial'::public.status_pagamento
  END;

  -- Não mexe em decisão humana ('atrasado' / 'cancelado') enquanto o valor pago
  -- não contradiz o estado: OS marcada como atrasada segue atrasada até ser paga.
  UPDATE public.ordens_servico
  SET status_financeiro = v_novo, updated_at = now()
  WHERE id = p_os_id
    AND status_financeiro IS DISTINCT FROM v_novo
    AND (status_financeiro NOT IN ('atrasado', 'cancelado') OR v_novo = 'pago');
END $function$;

CREATE OR REPLACE FUNCTION public.tg_pagamento_status_financeiro()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Em UPDATE de os_id, os dois lados precisam ser recalculados.
  IF TG_OP = 'DELETE' THEN
    PERFORM public.recalcular_status_financeiro_os(OLD.os_id);
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.os_id IS DISTINCT FROM NEW.os_id THEN
    PERFORM public.recalcular_status_financeiro_os(OLD.os_id);
  END IF;

  PERFORM public.recalcular_status_financeiro_os(NEW.os_id);
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS tg_pagamentos_status_financeiro ON public.pagamentos;
CREATE TRIGGER tg_pagamentos_status_financeiro
  AFTER INSERT OR UPDATE OR DELETE ON public.pagamentos
  FOR EACH ROW EXECUTE FUNCTION public.tg_pagamento_status_financeiro();

-- O valor total da OS também muda o veredicto (item novo, desconto aplicado).
CREATE OR REPLACE FUNCTION public.tg_os_valor_status_financeiro()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.valor_total IS DISTINCT FROM OLD.valor_total THEN
    PERFORM public.recalcular_status_financeiro_os(NEW.id);
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS tg_os_valor_status_financeiro ON public.ordens_servico;
CREATE TRIGGER tg_os_valor_status_financeiro
  AFTER UPDATE OF valor_total ON public.ordens_servico
  FOR EACH ROW EXECUTE FUNCTION public.tg_os_valor_status_financeiro();

-- Backfill das OS já existentes.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.ordens_servico LOOP
    PERFORM public.recalcular_status_financeiro_os(r.id);
  END LOOP;
END $$;
