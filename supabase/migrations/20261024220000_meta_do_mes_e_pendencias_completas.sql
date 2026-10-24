-- Dashboard do administrador: a Meta do mês mostrava só o que foi CONCLUÍDO (1 OS,
-- R$ 121,15) enquanto o mês tem R$ 5,4 mil em orçamentos aprovados e R$ 3,1 mil
-- recebidos; e "O que falta de mim" não cobria produção (esquecimento de
-- apontamento), atendimento (OS vencida, arte sem aceite, cotação do catálogo),
-- gerência (parceiro sem atendente) nem financeiro (parcela sem vencimento).
-- 24/10/2026. Duas funções, por substituição ancorada no corpo vivo.
-- Desfazer: recriar ponto_de_equilibrio e pendencias_do_sistema das migrações
-- anteriores (a primeira em 20260920…, a segunda em 20261019…).

-- 1. ponto_de_equilibrio: vendido, recebido e aprovado ----------------------------
DO $meta$
DECLARE
  v_def text := pg_get_functiondef('public.ponto_de_equilibrio(date)'::regprocedure);
  v_de text := E'    ''dias_corridos'', LEAST(GREATEST(CURRENT_DATE - v_ini, 0), (v_fim - v_ini))\n  );';
  v_para text := E'    ''dias_corridos'', LEAST(GREATEST(CURRENT_DATE - v_ini, 0), (v_fim - v_ini)),\n'
    -- Vendido = orçamentos aprovados no mês + OS do mês que não nasceram de orçamento.
    || E'    ''vendido'', round(\n'
    || E'      COALESCE((SELECT sum(o.valor_total) FROM public.orcamentos o\n'
    || E'                 WHERE o.status::text IN (''aprovado'', ''convertido'')\n'
    || E'                   AND COALESCE(o.aprovado_em, o.updated_at) >= v_ini AND COALESCE(o.aprovado_em, o.updated_at) < v_fim), 0)\n'
    || E'      + COALESCE((SELECT sum(f.valor_total) FROM public.ordens_servico os\n'
    || E'                   JOIN public.os_resultados_financeiros f ON f.os_id = os.id\n'
    || E'                  WHERE os.finalidade = ''venda'' AND os.status <> ''cancelado'' AND os.orcamento_id IS NULL\n'
    || E'                    AND os.created_at >= v_ini AND os.created_at < v_fim), 0), 2),\n'
    || E'    ''orcamentos_aprovados_n'', (SELECT count(*) FROM public.orcamentos o\n'
    || E'                 WHERE o.status::text IN (''aprovado'', ''convertido'')\n'
    || E'                   AND COALESCE(o.aprovado_em, o.updated_at) >= v_ini AND COALESCE(o.aprovado_em, o.updated_at) < v_fim),\n'
    || E'    ''recebido'', round(COALESCE((SELECT sum(p.valor) FROM public.pagamentos p\n'
    || E'                 WHERE p.status = ''pago'' AND p.pagamento_estornado_id IS NULL\n'
    || E'                   AND p.data_pagamento >= v_ini AND p.data_pagamento < v_fim), 0), 2),\n'
    || E'    ''os_concluidas_n'', (SELECT count(*) FROM public.ordens_servico os\n'
    || E'                 WHERE os.status IN (''faturado'', ''concluido'')),\n'
    || E'    ''os_abertas_n'', (SELECT count(*) FROM public.ordens_servico os\n'
    || E'                 WHERE os.finalidade = ''venda'' AND os.status NOT IN (''faturado'', ''concluido'', ''cancelado''))\n'
    || E'  );';
BEGIN
  IF position('''recebido''' IN v_def) > 0 THEN RETURN; END IF; -- já aplicada
  IF (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de) <> 1 THEN
    RAISE EXCEPTION 'ponto_de_equilibrio: o fim do JSON não está como esperado';
  END IF;
  EXECUTE replace(v_def, v_de, v_para);
END
$meta$;

-- 2. pendencias_do_sistema: o que faltava cobrir ---------------------------------
DO $pend$
DECLARE
  v_def text := pg_get_functiondef('public.pendencias_do_sistema()'::regprocedure);
  v_de text := E'  RETURN;\nEND;\n';
  v_blocos text;
BEGIN
  IF position('os_prazo_vencido' IN v_def) > 0 THEN RETURN; END IF; -- já aplicada
  IF (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de) <> 1 THEN
    RAISE EXCEPTION 'pendencias_do_sistema: o fim da função não está como esperado';
  END IF;
  v_blocos := $blocos$
  -- ===== 24/10/2026: o que o painel não via =====
  RETURN QUERY SELECT 'os_prazo_vencido', 'Ordens de serviço com o prazo vencido', count(*)::int,
    (SELECT count(*)::int FROM public.ordens_servico WHERE finalidade = 'venda' AND status NOT IN ('concluido','faturado','cancelado')),
    'critico', 'atendimento',
    'O prazo prometido passou e a OS segue aberta. Fale com o cliente, combine um novo prazo e leve a OS adiante no quadro.', '/kanban'
  FROM public.ordens_servico WHERE finalidade = 'venda' AND status NOT IN ('concluido','faturado','cancelado')
    AND prazo_entrega < now() HAVING count(*) > 0;

  RETURN QUERY SELECT 'arte_aprovada_sem_aceite', 'Arte marcada como aprovada sem o aceite do cliente', count(*)::int,
    NULL::int, 'critico', 'atendimento',
    'A OS está como "arte aprovada", mas não há aceite do cliente nem arquivo final: o banco não deixa entrar na fila de produção. Envie a arte pelo link de aprovação e anexe o arquivo final.', '/os'
  FROM public.ordens_servico os WHERE os.finalidade = 'venda' AND os.status::text = 'arte_aprovada'
    AND NOT public.arte_aprovada_da_os(os.id) HAVING count(*) > 0;

  RETURN QUERY SELECT 'catalogo_cotacao_sem_atendimento', 'Pedidos de cotação do catálogo de brindes sem atendimento', count(*)::int,
    NULL::int, 'critico', 'atendimento',
    'Alguém montou uma cotação no catálogo de brindes e ninguém respondeu. Abra Catálogos › Pedidos, fale com o cliente e marque como atendido.', '/catalogos/pedidos'
  FROM public.catalogo_cotacoes WHERE atendido_em IS NULL HAVING count(*) > 0;

  RETURN QUERY SELECT 'parceiro_sem_atendente', 'Parceiros que entraram sozinhos e ainda não têm atendente', count(*)::int,
    (SELECT count(*)::int FROM public.parceiros WHERE status = 'ativo'), 'atencao', 'gestao',
    'O primeiro pedido do parceiro só sai com atendente. Abra Parceiros, toque em "Assumir" e chame no WhatsApp para apresentar o painel.', '/parceiros'
  FROM public.parceiros WHERE status = 'ativo' AND responsavel_id IS NULL AND usuario_id IS NOT NULL HAVING count(*) > 0;

  RETURN QUERY SELECT 'apontamento_aberto_esquecido', 'Apontamentos de máquina abertos há mais de 12 horas', count(*)::int,
    (SELECT count(*)::int FROM public.apontamentos_producao WHERE finalizado_em IS NULL), 'critico', 'producao',
    'Alguém começou na máquina e não finalizou: o tempo e o custo da máquina continuam correndo e a TV mostra a máquina ocupada. Abra a OS e finalize o apontamento.', '/os'
  FROM public.apontamentos_producao WHERE finalizado_em IS NULL AND iniciado_em < now() - interval '12 hours' HAVING count(*) > 0;

  IF v_ve_dinheiro THEN
    RETURN QUERY SELECT 'parcela_sem_vencimento', 'Parcelas a receber sem data de vencimento', count(*)::int,
      (SELECT count(*)::int FROM public.parcelas_receber WHERE status <> 'paga'), 'atencao', 'financeiro',
      'Sem vencimento a parcela nunca aparece como atrasada nem no lembrete diário. Abra Contas a receber e defina a data de cada uma.', '/a-receber'
    FROM public.parcelas_receber WHERE status <> 'paga' AND vencimento IS NULL HAVING count(*) > 0;
  END IF;

$blocos$;
  EXECUTE replace(v_def, v_de, v_blocos || v_de);
END
$pend$;
