-- Motor de pendências do Bex Print.
--
-- O sistema sabia muita coisa e não contava para ninguém: 3 orçamentos sem uma
-- única linha de item, 2 OS sem material previsto, nenhuma baixa de estoque
-- desde sempre. Cada um desses é um pedido que não anda, e nenhuma tela dizia
-- isso a quem podia resolver.
--
-- Cada linha traz QUEM resolve, porque o painel de cada papel filtra por aí.
-- O organograma real da gráfica (20/09/2026):
--   atendimento → recepção: recebe arquivo, faz orçamento, manda para produção
--   producao    → impressão + acabamento + entrega (impressor e auxiliar)
--   gestao      → gerente de vendas E produção; é quem confirma a baixa de material
--   financeiro  → financeiro/administrativo
--   admin (CEO) → vê tudo
--
-- Contas de valor só aparecem para quem pode ver dinheiro; para os demais a
-- linha nem é devolvida.
--
-- COMO DESFAZER: drop function public.pendencias_do_sistema();

CREATE OR REPLACE FUNCTION public.pendencias_do_sistema()
RETURNS TABLE(
  chave text,
  titulo text,
  quantidade integer,
  total integer,
  severidade text,
  quem_resolve text,
  o_que_fazer text,
  link text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_ve_dinheiro boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado' USING ERRCODE = '42501';
  END IF;

  v_ve_dinheiro := public.has_role(v_uid, 'admin')
                OR public.has_permission(v_uid, 'financeiro.read')
                OR public.has_permission(v_uid, 'custos.read');

  -- ---------------------------------------------------------------- atendimento
  RETURN QUERY
  SELECT 'orcamento_sem_item',
         'Orçamentos sem nenhum item',
         count(*)::int,
         (SELECT count(*)::int FROM public.orcamentos),
         'critico', 'atendimento',
         'Orçamento sem linha de item não tem valor, não dá para enviar ao cliente e nunca vira OS. Abra o orçamento e acrescente os itens.',
         '/orcamentos'
  FROM public.orcamentos o
  WHERE NOT EXISTS (SELECT 1 FROM public.orcamento_itens i WHERE i.orcamento_id = o.id)
  HAVING count(*) > 0;

  RETURN QUERY
  SELECT 'orcamento_parado',
         'Orçamentos enviados sem resposta há mais de 7 dias',
         count(*)::int,
         (SELECT count(*)::int FROM public.orcamentos WHERE status IN ('rascunho','enviado')),
         'atencao', 'atendimento',
         'O cliente recebeu e não respondeu. Ligue ou mande mensagem antes de o orçamento expirar.',
         '/orcamentos'
  FROM public.orcamentos
  WHERE status = 'enviado' AND coalesce(enviado_em, created_at) < now() - interval '7 days'
  HAVING count(*) > 0;

  RETURN QUERY
  SELECT 'arte_aguardando_cliente',
         'Artes esperando a aprovação do cliente há mais de 2 dias',
         count(*)::int, NULL::int,
         'atencao', 'atendimento',
         'A produção não começa sem o aceite. Reenvie o link de aprovação ou confirme por telefone.',
         '/os'
  FROM public.ordens_servico
  WHERE status = 'aguardando_aprovacao_arte' AND updated_at < now() - interval '2 days'
  HAVING count(*) > 0;

  RETURN QUERY
  SELECT 'cliente_sem_contato',
         'Clientes ativos sem telefone nem e-mail',
         count(*)::int,
         (SELECT count(*)::int FROM public.clientes WHERE ativo),
         'atencao', 'atendimento',
         'Sem contato não há aviso de orçamento, de arte nem de entrega pronta. Complete o cadastro.',
         '/clientes'
  FROM public.clientes
  WHERE ativo
    AND coalesce(telefone, whatsapp_principal, '') = ''
    AND coalesce(email, '') = ''
  HAVING count(*) > 0;

  -- ------------------------------------------------------------------ produção
  RETURN QUERY
  SELECT 'os_na_fila_de_producao',
         'Ordens de serviço esperando impressão ou acabamento',
         count(*)::int, NULL::int,
         'ok', 'producao',
         'É a sua fila de hoje. Comece pela mais antiga ou pela de menor prazo.',
         '/kanban'
  FROM public.ordens_servico
  WHERE status IN ('aguardando_producao','producao','em_producao','em_impressao',
                   'em_corte','em_acabamento','em_uv','em_laser_cnc','em_3d')
  HAVING count(*) > 0;

  RETURN QUERY
  SELECT 'os_pronta_para_sair',
         'Trabalhos prontos esperando retirada ou entrega',
         count(*)::int, NULL::int,
         'atencao', 'producao',
         'Já está pronto e ocupando espaço. Avise o cliente para retirar ou programe a entrega.',
         '/os'
  FROM public.ordens_servico
  WHERE status IN ('aguardando_retirada','aguardando_entrega')
  HAVING count(*) > 0;

  -- -------------------------------------------------------------------- gestão
  RETURN QUERY
  SELECT 'os_parada',
         'Ordens de serviço sem nenhum movimento há mais de 5 dias',
         count(*)::int,
         (SELECT count(*)::int FROM public.ordens_servico
           WHERE status NOT IN ('concluido','faturado','cancelado')),
         'critico', 'gestao',
         'Trabalho represado. Abra a OS e veja o que trava: material, arte ou máquina.',
         '/os'
  FROM public.ordens_servico
  WHERE status NOT IN ('concluido','faturado','cancelado')
    AND updated_at < now() - interval '5 days'
  HAVING count(*) > 0;

  RETURN QUERY
  SELECT 'os_sem_material_previsto',
         'Ordens em produção sem material previsto',
         count(*)::int,
         (SELECT count(*)::int FROM public.ordens_servico
           WHERE status NOT IN ('concluido','faturado','cancelado')),
         'critico', 'gestao',
         'Sem material previsto a OS não reserva estoque e o custo real fica zero — o resultado mostra lucro que não existe. Confira se o produto tem ficha técnica.',
         '/os'
  FROM public.ordens_servico os
  WHERE os.status NOT IN ('concluido','faturado','cancelado')
    AND NOT EXISTS (SELECT 1 FROM public.os_materiais_previstos m WHERE m.os_id = os.id)
  HAVING count(*) > 0;

  RETURN QUERY
  SELECT 'baixa_de_estoque_pendente',
         'Ordens concluídas sem baixa de material',
         count(*)::int,
         (SELECT count(*)::int FROM public.ordens_servico WHERE status IN ('concluido','faturado')),
         'critico', 'gestao',
         'O impressor aponta a produção e a baixa é sua. Enquanto não baixar, o estoque mostra material que já foi usado e o custo da OS fica menor que o real.',
         '/os'
  FROM public.ordens_servico
  WHERE status IN ('concluido','faturado') AND coalesce(estoque_baixado, false) = false
  HAVING count(*) > 0;

  RETURN QUERY
  SELECT 'produto_sem_ficha',
         'Produtos ativos sem ficha técnica de material',
         count(*)::int,
         (SELECT count(*)::int FROM public.produtos WHERE ativo),
         'atencao', 'gestao',
         'Sem ficha, a OS desse produto nasce sem material previsto, o estoque não baixa e o custo real fica zero.',
         '/produtos'
  FROM public.produtos p
  WHERE p.ativo
    AND NOT EXISTS (SELECT 1 FROM public.produto_materiais pm WHERE pm.produto_id = p.id)
  HAVING count(*) > 0;

  -- Duas contas diferentes, de propósito. Em 20/09/2026 os 17 materiais estavam
  -- com estoque zero e mínimo definido: uma única regra diria "17 de 17 abaixo
  -- do mínimo", que é verdade literal e conselho errado — não é caso de repor,
  -- é que o estoque nunca foi carregado. Aviso que dispara para 100% das linhas
  -- vira moldura e ninguém lê.
  RETURN QUERY
  SELECT 'estoque_nunca_carregado',
         'Materiais que nunca receberam entrada no estoque',
         count(*)::int,
         (SELECT count(*)::int FROM public.materiais),
         'critico', 'gestao',
         'Enquanto o estoque estiver zerado, a OS não reserva material, a baixa não acontece e o custo real não fecha. Faça a entrada inicial do que já está na prateleira.',
         '/materiais'
  FROM public.materiais m
  WHERE coalesce(m.estoque, 0) <= 0
    AND NOT EXISTS (SELECT 1 FROM public.movimentacoes_estoque mv WHERE mv.material_id = m.id)
  HAVING count(*) > 0;

  RETURN QUERY
  SELECT 'estoque_abaixo_minimo',
         'Materiais no mínimo ou abaixo',
         count(*)::int,
         (SELECT count(*)::int FROM public.materiais WHERE coalesce(estoque, 0) > 0),
         'atencao', 'gestao',
         'Repor antes de faltar no meio de um trabalho. Confira o fornecedor no cadastro do material.',
         '/materiais'
  FROM public.materiais
  WHERE coalesce(estoque, 0) > 0
    AND coalesce(estoque, 0) <= coalesce(estoque_minimo, 0)
  HAVING count(*) > 0;

  -- Custo é dinheiro: só para quem pode ver.
  IF v_ve_dinheiro THEN
    RETURN QUERY
    SELECT 'material_sem_custo',
           'Materiais em ficha técnica sem custo de compra',
           count(DISTINCT m.id)::int,
           (SELECT count(*)::int FROM public.materiais),
           'critico', 'gestao',
           'O custo dos produtos que usam esse material fica congelado no valor digitado à mão — o sistema se recusa a recalcular com material a zero, para não derrubar preço e margem.',
           '/materiais'
    FROM public.materiais m
    WHERE coalesce(m.custo_medio, m.custo_unitario, 0) <= 0
      AND EXISTS (SELECT 1 FROM public.produto_materiais pm WHERE pm.material_id = m.id)
    HAVING count(DISTINCT m.id) > 0;

    -- ------------------------------------------------------------- financeiro
    RETURN QUERY
    SELECT 'os_entregue_sem_cobranca',
           'Trabalhos entregues sem nenhuma cobrança',
           count(*)::int,
           (SELECT count(*)::int FROM public.ordens_servico WHERE status IN ('concluido','faturado')),
           'critico', 'financeiro',
           'Serviço prestado que nunca virou conta a receber. Gere a cobrança a partir da OS.',
           '/financeiro'
    FROM public.ordens_servico os
    WHERE os.status IN ('concluido','faturado')
      AND NOT EXISTS (SELECT 1 FROM public.contas_receber cr WHERE cr.os_id = os.id)
    HAVING count(*) > 0;

    RETURN QUERY
    SELECT 'conta_pagar_vencida',
           'Contas a pagar vencidas',
           count(*)::int,
           (SELECT count(*)::int FROM public.contas_pagar WHERE status IN ('aberta','atrasada')),
           'critico', 'financeiro',
           'Vencidas e ainda abertas. Pague ou renegocie; se já foi paga, registre o pagamento para sair daqui.',
           '/financeiro'
    FROM public.contas_pagar
    WHERE status IN ('aberta','atrasada') AND vencimento < current_date
    HAVING count(*) > 0;

    RETURN QUERY
    SELECT 'receber_em_aberto',
           'Contas a receber ainda em aberto',
           count(*)::int,
           (SELECT count(*)::int FROM public.contas_receber),
           'atencao', 'financeiro',
           'Contas a receber ainda não têm data de vencimento no sistema, então não dá para saber quais estão atrasadas — confira uma a uma.',
           '/financeiro'
    FROM public.contas_receber
    WHERE status IN ('pendente','parcial','atrasado')
    HAVING count(*) > 0;
  END IF;

  RETURN;
END;
$function$;

REVOKE ALL ON FUNCTION public.pendencias_do_sistema() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pendencias_do_sistema() TO authenticated;
