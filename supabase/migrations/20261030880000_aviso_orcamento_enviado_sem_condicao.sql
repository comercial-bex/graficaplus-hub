-- A medição da camada Operação de 30/10/2026 (verificação 2.1) achou o que a de 29/10 não via: dos 4 orçamentos novos
-- enviados ou aprovados desde a regra de 29/10, dois (157 "JESUS", R$ 1.699,50, e 158 "Pedido pelo WhatsApp", R$ 64,90)
-- foram AO CLIENTE sem forma e divisão do pagamento. A tela lista a condição entre as pendências do envio, mas o
-- orçamento sai por mais de uma porta (a conversa do WhatsApp, o envio rápido) e o banco só recusa na CONVERSÃO. Sem
-- a condição, o Pix não é pedido ao cliente e a OS não nasce.
-- Em vez de barrar o envio no banco (as portas de partner e da conversa dependem dele e o dono não decidiu isso), o
-- aviso mostra o orçamento enviado incompleto ao atendimento, com os números, enquanto dá tempo de reenviar.
DO $migracao$
DECLARE
  v_oid oid;
  v_def text;
  v_antes int;
  v_ancora text := $a$  -- Reembolsos esperando decisão (15/10/2026): a gerência$a$;
  v_aviso text := $aviso$  -- Orçamento enviado sem a condição de pagamento completa (30/10/2026): 157 e 158 foram ao cliente assim.
  RETURN QUERY SELECT 'orcamento_enviado_sem_condicao', 'Orçamentos enviados sem a condição de pagamento completa', count(*)::int,
    (SELECT count(*)::int FROM public.orcamentos WHERE status = 'enviado'), 'atencao', 'atendimento',
    'Foram ao cliente sem a forma e a divisão do pagamento; sem elas o Pix não é pedido e a OS não nasce: orçamentos nº ' ||
      string_agg(o.numero::text, ', ' ORDER BY o.numero) ||
      '. Abra cada um, preencha a condição de pagamento e envie de novo.',
    '/orcamentos'
  FROM public.orcamentos o
  WHERE o.status = 'enviado' AND o.created_at >= '2026-10-29'
    AND NOT (nullif(btrim(coalesce(o.condicao_pagamento->>'forma', '')), '') IS NOT NULL
             AND coalesce(o.condicao_pagamento->>'modelo', '') IN ('a_vista', 'metade_metade', 'entrada', 'parcelado'))
  HAVING count(*) > 0;

$aviso$;
BEGIN
  SELECT p.oid INTO v_oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'pendencias_do_sistema';
  v_def := pg_get_functiondef(v_oid);
  IF position('orcamento_enviado_sem_condicao' IN v_def) = 0 THEN
    v_antes := (length(v_def) - length(replace(v_def, v_ancora, ''))) / length(v_ancora);
    IF v_antes <> 1 THEN RAISE EXCEPTION 'pendencias_do_sistema: esperava 1 âncora, achei %', v_antes; END IF;
    EXECUTE replace(v_def, v_ancora, v_aviso || v_ancora);
  END IF;
END
$migracao$;
