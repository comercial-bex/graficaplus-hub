ALTER TABLE public.parceiro_orcamentos ADD COLUMN IF NOT EXISTS total_pedido numeric;
COMMENT ON COLUMN public.parceiro_orcamentos.total_pedido IS 'Total do pedido recalculado pelo banco no envio (venda direta), visível ao parceiro.';
DO $m$
DECLARE v text := pg_get_functiondef('public.parceiro_venda_direta(jsonb,text,text)'::regprocedure);
BEGIN
  v := replace(v, 'UPDATE public.parceiro_orcamentos SET os_id = v_os_id WHERE id = v_q;',
                  'UPDATE public.parceiro_orcamentos SET os_id = v_os_id, total_pedido = v_total WHERE id = v_q;');
  IF position('total_pedido = v_total' in v) = 0 THEN RAISE EXCEPTION 'âncora não encontrada'; END IF;
  EXECUTE v;
END $m$;