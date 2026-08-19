-- Contato avulso do orçamento vira cliente — destrava a conversão em OS.
--
-- O orçamento aceita contato avulso (contato_nome/telefone/email) para o
-- vendedor atender rápido, sem parar para cadastrar. Só que
-- converter_orcamento_em_os exige cliente cadastrado e recusa com "Vincule um
-- cliente cadastrado antes de converter este orçamento em OS". Ou seja: o
-- caminho rápido levava a um beco sem saída. Ninguém tinha percebido porque
-- nenhum orçamento havia sido convertido antes de 09/08.
--
-- Agora o contato vira cliente na hora da conversão, e o cliente entra na base
-- com `origem` preenchida — que é o que permite achá-lo depois para uma promoção.
--
-- Deduplicação: `clientes.telefone_normalizado` é coluna GERADA por
-- normalize_whatsapp_phone(telefone), a mesma função usada aqui. Isso resolve o
-- nono dígito (o mesmo número escrito com 12 ou 13 dígitos cai na mesma chave) e
-- garante que a comparação seja idêntica à que o banco gravou. Sem isso, o
-- mesmo cliente entraria de novo a cada orçamento avulso.

CREATE OR REPLACE FUNCTION public.vincular_cliente_do_contato(p_orcamento_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_orc public.orcamentos%ROWTYPE;
  v_cliente_id uuid;
  v_tel text;
  v_email text;
BEGIN
  SELECT * INTO v_orc FROM public.orcamentos WHERE id = p_orcamento_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orçamento não encontrado';
  END IF;

  -- Já tem cliente: nada a fazer. Mantém a função idempotente para poder ser
  -- chamada de novo sem duplicar nada.
  IF v_orc.cliente_id IS NOT NULL THEN
    RETURN v_orc.cliente_id;
  END IF;

  IF coalesce(btrim(v_orc.contato_nome), '') = '' THEN
    RAISE EXCEPTION 'Informe o nome do contato ou selecione um cliente para converter este orçamento';
  END IF;

  v_tel   := public.normalize_whatsapp_phone(v_orc.contato_telefone);
  v_email := lower(nullif(btrim(v_orc.contato_email), ''));

  -- 1) Mesmo telefone é o mesmo cliente. É a chave mais confiável no balcão:
  --    o nome vem escrito de um jeito a cada vez, o número não.
  IF v_tel IS NOT NULL AND v_tel <> '' THEN
    SELECT id INTO v_cliente_id
    FROM public.clientes
    WHERE telefone_normalizado = v_tel
    ORDER BY created_at
    LIMIT 1;
  END IF;

  -- 2) Sem telefone, tenta e-mail.
  IF v_cliente_id IS NULL AND v_email IS NOT NULL THEN
    SELECT id INTO v_cliente_id
    FROM public.clientes
    WHERE lower(email) = v_email
    ORDER BY created_at
    LIMIT 1;
  END IF;

  -- 3) Não achou: cria. `tipo` entra como 'pf' porque contato avulso com nome de
  --    pessoa é o caso comum no balcão; quem cadastra corrige se for empresa.
  --    `origem` marca de onde veio, que é o que permite segmentar depois.
  IF v_cliente_id IS NULL THEN
    INSERT INTO public.clientes (nome, tipo, telefone, email, origem, vendedor_id, created_by)
    VALUES (
      btrim(v_orc.contato_nome),
      'pf',
      nullif(btrim(v_orc.contato_telefone), ''),
      v_email,
      'orcamento_avulso',
      v_orc.vendedor_id,
      coalesce(v_orc.created_by, auth.uid())
    )
    RETURNING id INTO v_cliente_id;
  END IF;

  UPDATE public.orcamentos SET cliente_id = v_cliente_id WHERE id = p_orcamento_id;

  RETURN v_cliente_id;
END $function$;

REVOKE ALL ON FUNCTION public.vincular_cliente_do_contato(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.vincular_cliente_do_contato(uuid) TO authenticated;

-- A conversão passa a resolver o contato em vez de recusar.
CREATE OR REPLACE FUNCTION public.converter_orcamento_em_os(
  p_orcamento_id uuid,
  p_opcoes jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid UUID;
  v_orc public.orcamentos%ROWTYPE;
  v_os_id UUID;
  v_conta_id UUID;
  v_parcelas INT;
  v_intervalo INT;
  v_primeiro DATE;
  v_valor_parcela NUMERIC;
  v_acumulado NUMERIC := 0;
  v_i INT;
  v_cliente_criado BOOLEAN := false;
BEGIN
  v_uid := public.require_permission('orcamentos.convert');

  SELECT * INTO v_orc FROM public.orcamentos WHERE id = p_orcamento_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Orçamento não encontrado'; END IF;

  IF v_orc.os_id IS NOT NULL THEN
    RETURN jsonb_build_object('orcamento_id', p_orcamento_id, 'os_id', v_orc.os_id, 'idempotent', true);
  END IF;

  IF v_orc.versao_aprovada_id IS NULL AND v_orc.status::text <> 'aprovado' THEN
    RAISE EXCEPTION 'Orçamento sem versão aprovada';
  END IF;

  -- Contato avulso vira cliente aqui, em vez de barrar a conversão.
  IF v_orc.cliente_id IS NULL THEN
    PERFORM public.vincular_cliente_do_contato(p_orcamento_id);
    SELECT * INTO v_orc FROM public.orcamentos WHERE id = p_orcamento_id;
    v_cliente_criado := true;
  END IF;

  INSERT INTO public.ordens_servico(
    cliente_id, orcamento_id, vendedor_id, titulo, briefing, observacoes,
    prazo_entrega, valor_total, custo_previsto, desconto, created_by, status_geral,
    endereco_entrega, condicao_pagamento, precisa_entrega, precisa_instalacao,
    responsavel_id
  )
  VALUES (
    v_orc.cliente_id, p_orcamento_id, v_orc.vendedor_id, v_orc.titulo, v_orc.briefing,
    v_orc.observacoes, v_orc.prazo, v_orc.valor_total, v_orc.custo_estimado,
    COALESCE(v_orc.valor_subtotal, 0) - COALESCE(v_orc.valor_total, 0),
    v_uid, 'entrada',
    v_orc.endereco_entrega, v_orc.condicao_pagamento,
    COALESCE(v_orc.precisa_entrega, false), COALESCE(v_orc.precisa_instalacao, false),
    COALESCE(v_orc.vendedor_id, v_uid)
  )
  RETURNING id INTO v_os_id;

  INSERT INTO public.itens_os(
    os_id, orcamento_item_id, produto_id, descricao, quantidade, unidade,
    valor_unitario, custo_unitario, ordem, produto_snapshot, parametros,
    largura, altura, acabamento, preco_m2, arquivo_id
  )
  SELECT
    v_os_id, id, produto_id, descricao, quantidade, unidade,
    valor_unitario, custo_unitario, ordem, produto_snapshot, parametros,
    largura, altura, acabamento, preco_m2, arquivo_id
  FROM public.orcamento_itens
  WHERE orcamento_id = p_orcamento_id
  ORDER BY ordem;

  UPDATE public.orcamentos SET os_id = v_os_id WHERE id = p_orcamento_id;

  INSERT INTO public.contas_receber(cliente_id, orcamento_id, os_id, valor_total)
  VALUES (v_orc.cliente_id, p_orcamento_id, v_os_id, v_orc.valor_total)
  RETURNING id INTO v_conta_id;

  v_parcelas  := GREATEST(1, COALESCE((v_orc.condicao_pagamento->>'parcelas')::int, 1));
  v_intervalo := GREATEST(0, COALESCE((v_orc.condicao_pagamento->>'intervalo_dias')::int, 30));
  v_primeiro  := COALESCE((v_orc.condicao_pagamento->>'primeiro_vencimento')::date, CURRENT_DATE);

  v_valor_parcela := round(COALESCE(v_orc.valor_total, 0) / v_parcelas, 2);
  FOR v_i IN 1..v_parcelas LOOP
    INSERT INTO public.parcelas_receber(conta_id, parcela, valor, vencimento)
    VALUES (
      v_conta_id, v_i,
      CASE WHEN v_i < v_parcelas THEN v_valor_parcela
           ELSE COALESCE(v_orc.valor_total, 0) - v_acumulado END,
      v_primeiro + ((v_i - 1) * v_intervalo)
    );
    v_acumulado := v_acumulado + v_valor_parcela;
  END LOOP;

  INSERT INTO public.eventos_negocio(
    entidade, entidade_id, os_id, cliente_id, tipo, titulo, dados_posteriores, usuario_id
  )
  VALUES (
    'orcamento', p_orcamento_id, v_os_id, v_orc.cliente_id, 'orcamento_convertido_os',
    'Orçamento convertido em OS',
    jsonb_build_object('os_id', v_os_id, 'conta_id', v_conta_id, 'parcelas', v_parcelas,
                       'cliente_criado_do_contato', v_cliente_criado),
    v_uid
  );

  RETURN jsonb_build_object(
    'orcamento_id', p_orcamento_id, 'os_id', v_os_id, 'conta_id', v_conta_id,
    'parcelas', v_parcelas, 'cliente_id', v_orc.cliente_id,
    'cliente_criado_do_contato', v_cliente_criado
  );
END; $function$;
