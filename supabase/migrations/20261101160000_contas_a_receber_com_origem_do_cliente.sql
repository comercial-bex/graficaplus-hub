-- Contas a receber com a origem do cliente (01/11/2026).
--
-- O Holdprint filtra a lista de contas a receber por "Origem" e por cliente, para
-- responder quanto entra de cada canal. Aqui a conta a receber só trazia o nome
-- do cliente; a origem (Instagram, indicação, balcão...) mora na ficha do cliente
-- (`clientes.origem`) e não chegava à tela.
--
-- A única mudança é acrescentar `cliente_origem` a cada conta devolvida. O resto
-- da função é o que estava no banco (definição viva lida em 01/11/2026): mesmos
-- totais, mesma ordem, mesma permissão (só quem vê financeiro, senão 42501).
-- `CREATE OR REPLACE` mantém as permissões de execução que a função já tinha.

CREATE OR REPLACE FUNCTION public.contas_a_receber(p_incluir_quitadas boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_linhas jsonb; v_hoje date := public.hoje_br();
BEGIN
  IF NOT public.can_see_financials(auth.uid()) THEN
    RAISE EXCEPTION 'A cobrança é do financeiro.' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(x ORDER BY x.vencimento_mais_antigo NULLS LAST), '[]'::jsonb) INTO v_linhas
  FROM (
    SELECT cr.id AS conta_id, cr.status, cr.valor_total, cr.created_at,
           cr.os_id, os.numero AS os_numero, os.titulo AS os_titulo,
           cr.cliente_id, public.nome_do_cliente(cr.cliente_id) AS cliente,
           (SELECT c.origem FROM public.clientes c WHERE c.id = cr.cliente_id) AS cliente_origem,
           (SELECT min(p.vencimento) FROM public.parcelas_receber p
             WHERE p.conta_id = cr.id AND p.status <> 'paga') AS vencimento_mais_antigo,
           COALESCE((SELECT sum(p.valor) FROM public.parcelas_receber p
                      WHERE p.conta_id = cr.id AND p.status = 'paga'), 0) AS recebido,
           COALESCE((SELECT sum(p.valor) FROM public.parcelas_receber p
                      WHERE p.conta_id = cr.id AND p.status <> 'paga'), 0) AS a_receber,
           COALESCE((SELECT sum(p.valor) FROM public.parcelas_receber p
                      WHERE p.conta_id = cr.id AND p.status <> 'paga' AND p.vencimento < v_hoje), 0) AS vencido,
           COALESCE((SELECT jsonb_agg(jsonb_build_object(
                       'parcela_id', p.id, 'numero', p.parcela, 'valor', p.valor,
                       'vencimento', p.vencimento, 'status', p.status,
                       'atrasada', (p.status <> 'paga' AND p.vencimento < v_hoje))
                     ORDER BY p.parcela) FROM public.parcelas_receber p WHERE p.conta_id = cr.id), '[]'::jsonb) AS parcelas
    FROM public.contas_receber cr
    LEFT JOIN public.ordens_servico os ON os.id = cr.os_id
    WHERE p_incluir_quitadas OR cr.status <> 'recebido'
  ) x;

  RETURN jsonb_build_object(
    'hoje', v_hoje,
    'contas', v_linhas,
    'total_a_receber', COALESCE((SELECT sum((c->>'a_receber')::numeric) FROM jsonb_array_elements(v_linhas) c), 0),
    'total_vencido', COALESCE((SELECT sum((c->>'vencido')::numeric) FROM jsonb_array_elements(v_linhas) c), 0),
    'total_recebido', COALESCE((SELECT sum((c->>'recebido')::numeric) FROM jsonb_array_elements(v_linhas) c), 0)
  );
END $function$;
