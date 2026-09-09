-- Desconto negativo inflava a receita — e nada impedia.
--
-- Achado rodando um ciclo de vida completo. A conversão deriva o desconto por
-- subtração:
--
--   desconto = COALESCE(valor_subtotal, 0) - COALESCE(valor_total, 0)
--
-- `valor_subtotal` é NOT NULL DEFAULT 0, então basta gravar só o total para o
-- desconto sair NEGATIVO. E aí, na vw_resultado_os:
--
--   receita_liquida = valor_total - desconto  ->  330 - (-330) = 660
--
-- A receita DOBRA e a margem vira 100%. Foi o que a OS de teste informou:
-- R$ 330 cobrados, R$ 660 líquidos, margem 1,0.
--
-- Alcance real, para não exagerar o diagnóstico: a tela de orçamento preenche os
-- dois valores, e o único orçamento real do sistema tem valor_subtotal igual ao
-- valor_total — desconto zero. NÃO há dado de produção corrompido. O que existe
-- é uma via de dinheiro sem guarda: qualquer gravação parcial (importação,
-- integração, correção em SQL, linha antiga) dobra a receita em silêncio. E o
-- desconto é impresso no documento do cliente (src/lib/pdf/generate.ts).
--
-- A função abaixo é a mesma de 20260819120000, com UMA linha alterada. Foi
-- copiada inteira de propósito: reescrevê-la de memória apagaria a idempotência
-- por `os_id`, a checagem de versão aprovada e o laço de parcelas.

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
    -- greatest(0, ...): desconto é ABATIMENTO, nunca acréscimo. Subtotal menor
    -- que o total significa subtotal não informado — e o negativo virava
    -- receita a mais, porque receita_liquida = valor_total - desconto.
    GREATEST(0, COALESCE(v_orc.valor_subtotal, 0) - COALESCE(v_orc.valor_total, 0)),
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

REVOKE ALL ON FUNCTION public.converter_orcamento_em_os(uuid, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.converter_orcamento_em_os(uuid, jsonb) TO authenticated;

comment on function public.converter_orcamento_em_os is
  'Orçamento aprovado vira OS, itens, conta a receber e parcelas. O desconto derivado nunca é negativo — negativo inflava a receita líquida.';

-- Trava de banco. Hoje nenhuma outra via grava `ordens_servico.desconto` (o
-- front apenas o LÊ, para o PDF), então a restrição não quebra caminho algum.
-- Ela existe para o dia em que alguém escrever por outra porta.
UPDATE public.ordens_servico SET desconto = 0 WHERE desconto < 0;

ALTER TABLE public.ordens_servico
  DROP CONSTRAINT IF EXISTS ordens_servico_desconto_nao_negativo;
ALTER TABLE public.ordens_servico
  ADD CONSTRAINT ordens_servico_desconto_nao_negativo CHECK (desconto >= 0);

COMMENT ON COLUMN public.ordens_servico.desconto IS
  'Abatimento em reais, nunca negativo. Acréscimo se modela subindo o valor_total — senão a receita líquida (valor_total - desconto) fica maior que o valor cobrado.';
