-- 29/10/2026 — a OS nasce com prazo de entrega, e a 2ª parcela nasce com vencimento.
--
-- A OS 212 (Marcela, orçamento 150) nasceu em 29/10 sem prazo: o orçamento nunca teve data de entrega (o botão
-- "Sugerir entrega" é opcional) e a conversão copiava `orcamentos.prazo` como estava. Consequências: a 2ª parcela
-- do 50% + 50% nasceu sem vencimento (só ganha data quando o pedido sai), a OS nunca aparece como atrasada e
-- a agenda de máquina fica sem base. Os avisos `os_sem_prazo` e `parcela_sem_vencimento` já mostravam isso,
-- mas depois que a OS existia.
--
-- O que muda em `converter_orcamento_em_os` (corpo vivo de 29/10; bloco novo b5 e dois usos de `v_prazo`):
--   1. a OS herda o prazo do orçamento; sem ele, a data de entrega prometida ao cliente;
--   2. sem nenhuma das duas, e sendo pedido NORMAL, o prazo padrão da casa (`custos_tabela.prazo_entrega_padrao_dias`,
--      5 dias úteis confirmados pelo dono em 26/10) contado de hoje: é o mesmo que o botão "Sugerir entrega" propõe;
--   3. pedido EXPRESSO sem data continua sem prazo, de propósito: o padrão de 5 dias não vale para ele e o
--      aviso "OS sem prazo" cobra a data.
-- A 2ª parcela herda esse prazo pelo gatilho que já existe (`tg_parcela_nasce_com_o_prazo_da_os`). O evento
-- "orçamento convertido em OS" passa a guardar o prazo e de onde ele veio.
--
-- As parcelas por modelo seguem iguais (`tests/parcelas-iguais-ao-banco` lê esta migração).

CREATE OR REPLACE FUNCTION public.converter_orcamento_em_os(p_orcamento_id uuid, p_opcoes jsonb DEFAULT '{}'::jsonb)
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
  v_previstos INT := 0;
  v_reserva JSONB := '{}'::jsonb;
  v_custo_materiais NUMERIC := 0;
  v_agenda JSONB := '{}'::jsonb;
  v_desconto JSONB;
  v_soma_itens NUMERIC;
  v_desconto_os NUMERIC := 0;
  v_jobs_3d INT := 0;
  v_prazo DATE;
  v_prazo_origem TEXT;
BEGIN
  v_uid := public.require_permission('orcamentos.convert');

  SELECT * INTO v_orc FROM public.orcamentos WHERE id = p_orcamento_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Orçamento não encontrado'; END IF;

  IF v_orc.os_id IS NOT NULL THEN
    RETURN jsonb_build_object('orcamento_id', p_orcamento_id, 'os_id', v_orc.os_id, 'idempotent', true);
  END IF;

  -- Orçamento com 3D vinculado converte pela porta do 3D (13/10/2026): pela
  -- porta comum nascia uma OS e o 3D, sem OS, oferecia "Converter" de novo.
  -- Só o 3D LEGADO (sem item no orçamento) converte pela porta do 3D. A peça embutida (27/10/2026)
  -- é um item como os outros: converte aqui e ganha os jobs de impressão mais abaixo.
  IF EXISTS (SELECT 1 FROM public.orcamentos_3d t3 WHERE t3.orcamento_id = p_orcamento_id AND NOT COALESCE(t3.embutido, false)) THEN
    RETURN public.converter_orcamento_3d_em_os(
      (SELECT t3.id FROM public.orcamentos_3d t3 WHERE t3.orcamento_id = p_orcamento_id AND NOT COALESCE(t3.embutido, false)
        ORDER BY t3.created_at DESC LIMIT 1));
  END IF;

  IF v_orc.versao_aprovada_id IS NULL AND v_orc.status::text <> 'aprovado' THEN
    RAISE EXCEPTION 'Orçamento sem versão aprovada';
  END IF;

  -- (a) o gatilho de totais refaz subtotal, desconto e total sobre os itens de agora
  UPDATE public.orcamentos SET updated_at = now() WHERE id = p_orcamento_id;
  SELECT * INTO v_orc FROM public.orcamentos WHERE id = p_orcamento_id;

  -- (a2) o valor de hoje é o que o cliente aprovou? (22/10/2026)
  DECLARE v_aprov numeric;
  BEGIN
    SELECT v.valor_total INTO v_aprov FROM public.orcamento_versoes v WHERE v.id = v_orc.versao_aprovada_id;
    IF v_aprov IS NOT NULL AND v_aprov IS DISTINCT FROM v_orc.valor_total THEN
      RAISE EXCEPTION 'O orçamento mudou depois de aprovado: o cliente aprovou R$ % e hoje está R$ %. Volte o valor ou peça nova aprovação (marque como enviado e aprovado de novo) antes de converter.',
        to_char(v_aprov, 'FM999G999G990D00'), to_char(v_orc.valor_total, 'FM999G999G990D00')
        USING ERRCODE = 'P0001';
    END IF;
  END;

  -- (b) desconto que passou da alçada precisa de aprovação válida
  v_desconto := public.desconto_situacao_interna(p_orcamento_id);
  IF (v_desconto->>'pendente')::boolean THEN
    RAISE EXCEPTION 'O desconto deste orçamento passou da alçada de quem vende e não tem aprovação para os valores de agora. Quem tem a permissão "Aprovar desconto" aprova no quadro Desconto do orçamento; depois converta.'
      USING ERRCODE = '42501';
  END IF;

  -- (b3) Sinal em Pix (decisão do dono, 27/10/2026): pagamento combinado em Pix só vira OS com o
  -- sinal marcado como recebido ("O Pix chegou" no orçamento, com extrato ou comprovante conferido).
  IF lower(COALESCE(v_orc.condicao_pagamento->>'forma', '')) = 'pix'
     AND COALESCE((v_orc.condicao_pagamento->'pix_recebido'->>'valor')::numeric, 0) <= 0 THEN
    RAISE EXCEPTION 'Sinal em Pix ainda não marcado como recebido. Confira o extrato ou o comprovante e marque "O Pix chegou" no orçamento; depois converta.'
      USING ERRCODE = 'P0001';
  END IF;

  -- (b4) Condição de pagamento obrigatória (decisão do dono, 28/10/2026; fechada em 29/10/2026): não
  -- existe OS sem combinar como se paga. Vale a forma (Pix, cartão…) E a divisão ESCOLHIDA: `modelo` à
  -- vista, 50% + 50%, entrada ou parcelado. `parcelas` sozinho não vale — o `{"parcelas": 1}` com que o
  -- orçamento nasce deixava passar forma sem divisão (orçamento 152, 29/10).
  IF NULLIF(btrim(COALESCE(v_orc.condicao_pagamento->>'forma', '')), '') IS NULL
     OR COALESCE(v_orc.condicao_pagamento->>'modelo', '') NOT IN ('a_vista', 'metade_metade', 'entrada', 'parcelado') THEN
    RAISE EXCEPTION 'Orçamento sem condição de pagamento: combine a forma (Pix, cartão…) e como divide (à vista, 50%% + 50%%, entrada ou parcelado) no quadro Pagamento antes de converter.'
      USING ERRCODE = 'P0001';
  END IF;

  -- (b2) item livre sem custo não vira OS (22/10/2026)
  DECLARE v_sem_custo text;
  BEGIN
    SELECT string_agg(btrim(i.descricao), '; ' ORDER BY i.ordem) INTO v_sem_custo
      FROM public.orcamento_itens i
     WHERE i.orcamento_id = p_orcamento_id AND i.produto_id IS NULL AND COALESCE(i.custo_unitario, 0) <= 0
       AND i.origem_calculo IS DISTINCT FROM 'taxa_prazo';
    IF v_sem_custo IS NOT NULL THEN
      RAISE EXCEPTION 'Item fora do catálogo sem custo: %. Troque por um produto do catálogo ou informe o custo do item no orçamento; sem isso a OS nasce sem material e com margem inventada.', v_sem_custo
        USING ERRCODE = 'P0001';
    END IF;
  END;

  -- (b5) Prazo da OS (29/10/2026). A OS herda o prazo do orçamento; sem ele, a data de entrega prometida ao
  -- cliente; sem nenhuma das duas, e sendo pedido NORMAL, o prazo padrão da casa (chave
  -- prazo_entrega_padrao_dias, 5 dias úteis: o que o botão "Sugerir entrega" propõe) contado de hoje.
  -- Pedido EXPRESSO sem data fica sem prazo de propósito: o padrão não vale para ele e o aviso "OS sem prazo" cobra.
  v_prazo := COALESCE(v_orc.prazo, v_orc.data_entrega_prometida);
  v_prazo_origem := CASE WHEN v_orc.prazo IS NOT NULL THEN 'orcamento'
                         WHEN v_orc.data_entrega_prometida IS NOT NULL THEN 'entrega_prometida'
                         ELSE NULL END;
  IF v_prazo IS NULL AND v_orc.prazo_tipo IS NOT DISTINCT FROM 'normal' THEN
    v_prazo := public.somar_dias_uteis(
      (now() AT TIME ZONE 'America/Belem')::date,
      COALESCE(NULLIF((SELECT max(c.valor) FROM public.custos_tabela c
                        WHERE c.ativo AND c.codigo = 'prazo_entrega_padrao_dias')::int, 0), 5));
    v_prazo_origem := 'padrao_da_casa';
  END IF;

  IF v_orc.cliente_id IS NULL THEN
    PERFORM public.vincular_cliente_do_contato(p_orcamento_id);
    SELECT * INTO v_orc FROM public.orcamentos WHERE id = p_orcamento_id;
    v_cliente_criado := true;
  END IF;

  INSERT INTO public.ordens_servico(
    cliente_id, orcamento_id, vendedor_id, titulo, briefing, observacoes,
    prazo_entrega, valor_total, custo_previsto, desconto, created_by, status_geral,
    endereco_entrega, condicao_pagamento, precisa_entrega, precisa_instalacao,
    responsavel_id, prioridade
  )
  VALUES (
    v_orc.cliente_id, p_orcamento_id, v_orc.vendedor_id, v_orc.titulo, v_orc.briefing,
    CASE WHEN v_orc.prazo_tipo IS DISTINCT FROM 'normal'
         THEN 'PRAZO ' || upper(COALESCE((SELECT pz.nome FROM public.prazos_de_entrega pz WHERE pz.chave = v_orc.prazo_tipo), v_orc.prazo_tipo))
              || ': produção prioritária.'
              || CASE WHEN NULLIF(btrim(v_orc.observacoes), '') IS NOT NULL THEN E'\n' || v_orc.observacoes ELSE '' END
         ELSE v_orc.observacoes END,
    v_prazo, v_orc.valor_total, v_orc.custo_estimado,
    GREATEST(0, COALESCE(v_orc.valor_subtotal, 0) - COALESCE(v_orc.valor_total, 0)),
    v_uid, 'entrada',
    v_orc.endereco_entrega, v_orc.condicao_pagamento,
    COALESCE(v_orc.precisa_entrega, false), COALESCE(v_orc.precisa_instalacao, false),
    COALESCE(v_orc.vendedor_id, v_uid),
    COALESCE((SELECT pz.prioridade_os FROM public.prazos_de_entrega pz WHERE pz.chave = v_orc.prazo_tipo), 3)
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

  -- (c) A OS guarda o que o cliente paga (o total do orçamento, com desconto e
  -- crédito) e, ao lado, o desconto que leva da soma dos itens da OS até ele.
  -- O gatilho dos itens (tg_os_soma_os_itens) mantém total = itens − desconto
  -- daqui em diante. Orçamento sem itens fica como a versão anterior fazia.
  IF EXISTS (SELECT 1 FROM public.itens_os WHERE os_id = v_os_id) THEN
    SELECT COALESCE(sum(valor_total), 0) INTO v_soma_itens FROM public.itens_os WHERE os_id = v_os_id;
    v_desconto_os := GREATEST(v_soma_itens - COALESCE(v_orc.valor_total, 0), 0);
    UPDATE public.ordens_servico
       SET desconto = v_desconto_os,
           valor_total = GREATEST(v_soma_itens - v_desconto_os, 0)
     WHERE id = v_os_id;
  END IF;

  UPDATE public.orcamentos SET os_id = v_os_id WHERE id = p_orcamento_id;

  -- Peças 3D embutidas (27/10/2026): cada uma ganha os jobs de impressão da OS, ligados ao item
  -- da OS que a representa. Acessório: a OS nasce mesmo que um job falhe, e o motivo fica no log.
  DECLARE v_t3 record; v_os_item uuid;
  BEGIN
    FOR v_t3 IN SELECT * FROM public.orcamentos_3d
                 WHERE orcamento_id = p_orcamento_id AND COALESCE(embutido, false) AND os_id IS NULL LOOP
      BEGIN
        UPDATE public.orcamentos_3d SET os_id = v_os_id, status = 'convertido' WHERE id = v_t3.id;
        v_jobs_3d := v_jobs_3d + public.criar_jobs_3d_da_os(v_t3.id, v_os_id);
        SELECT id INTO v_os_item FROM public.itens_os WHERE os_id = v_os_id AND orcamento_item_id = v_t3.item_id LIMIT 1;
        IF v_os_item IS NOT NULL THEN
          UPDATE public.producao_3d_jobs SET os_item_id = v_os_item
           WHERE os_id = v_os_id AND orcamento_3d_id = v_t3.id AND os_item_id IS NULL;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'Peça 3D % da OS % ficou sem jobs de impressão: %', v_t3.id, v_os_id, SQLERRM;
      END;
    END LOOP;
  END;

  -- Entrega/instalação nasce com a OS quando o pedido pede (25/10/2026). Acessório: nunca derruba a conversão.
  IF COALESCE(v_orc.precisa_instalacao, false) OR COALESCE(v_orc.precisa_entrega, false) THEN
    BEGIN
      INSERT INTO public.entregas_instalacoes(os_id, tipo, endereco, status)
      VALUES (v_os_id, CASE WHEN COALESCE(v_orc.precisa_instalacao, false) THEN 'instalacao' ELSE 'entrega' END,
              COALESCE(v_orc.endereco_entrega->>'descricao', v_orc.endereco_entrega::text), 'agendada');
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Não deu para criar a entrega da OS %: %', v_os_id, SQLERRM;
    END;
  END IF;

  -- Previsão de materiais + reserva do estoque real.
  -- Nunca derruba a conversão: se o estoque estiver inconsistente, a OS nasce
  -- mesmo assim e a falta é informada de volta para a tela.
  BEGIN
    v_previstos := public.gerar_materiais_previstos_os(v_os_id);
    v_reserva := public.reservar_materiais_os_interno(v_os_id, v_uid);
  EXCEPTION WHEN OTHERS THEN
    v_reserva := jsonb_build_object('erro', SQLERRM);
  END;

  -- Quantos materiais a OS TEM previstos, não quantos esta chamada inseriu.
  -- O gatilho de item já explode a receita na inserção, então a chamada a
  -- gerar_materiais_previstos_os logo acima encontra tudo pronto e devolve 0 —
  -- e a tela anunciava "0 materiais previstos" com a previsão inteira feita.
  SELECT count(*)::int, COALESCE(SUM(quantidade * COALESCE(custo_unitario_previsto, 0)), 0)
    INTO v_previstos, v_custo_materiais
    FROM public.os_materiais_previstos WHERE os_id = v_os_id;

  UPDATE public.ordens_servico
     SET custo_previsto = GREATEST(COALESCE(v_orc.custo_estimado, 0), v_custo_materiais)
   WHERE id = v_os_id;

  INSERT INTO public.contas_receber(cliente_id, orcamento_id, os_id, valor_total)
  VALUES (v_orc.cliente_id, p_orcamento_id, v_os_id, v_orc.valor_total)
  RETURNING id INTO v_conta_id;

  -- As parcelas conforme a condição combinada (28/10/2026): entrada na aprovação + saldo.
  -- A mesma conta de `parcelasDoOrcamento` (domínio): a tela, o PDF e a conta a receber
  -- não podem discordar em um centavo.
  DECLARE
    v_modelo text := COALESCE(v_orc.condicao_pagamento->>'modelo', '');
    v_total numeric := COALESCE(v_orc.valor_total, 0);
    v_entrada numeric := 0;
    v_saldo numeric;
    v_hoje date := (now() AT TIME ZONE 'America/Belem')::date;
    v_n int := 0;
  BEGIN
    v_parcelas  := GREATEST(1, COALESCE((v_orc.condicao_pagamento->>'parcelas')::int, 1));
    v_intervalo := GREATEST(0, COALESCE((v_orc.condicao_pagamento->>'intervalo_dias')::int, 30));

    IF v_modelo = 'a_vista' THEN
      v_entrada := v_total;
    ELSIF v_modelo = 'metade_metade' THEN
      v_entrada := round(v_total * 0.5, 2);
    ELSIF v_modelo = 'entrada' THEN
      IF COALESCE((v_orc.condicao_pagamento->>'entrada_valor')::numeric, 0) > 0 THEN
        v_entrada := LEAST(v_total, round((v_orc.condicao_pagamento->>'entrada_valor')::numeric, 2));
      ELSE
        v_entrada := round(v_total * LEAST(100, GREATEST(0, COALESCE((v_orc.condicao_pagamento->>'entrada_pct')::numeric, 0))) / 100, 2);
      END IF;
    END IF;
    v_saldo := v_total - v_entrada;

    -- A entrada vence HOJE: é o dia em que o cliente aprovou e o pedido vira OS.
    IF v_entrada > 0 THEN
      v_n := v_n + 1;
      INSERT INTO public.parcelas_receber(conta_id, parcela, valor, vencimento)
      VALUES (v_conta_id, v_n, v_entrada, v_hoje);
    END IF;

    -- O saldo: uma parcela sem data vence no prazo da OS (tg_parcela_nasce_com_o_prazo_da_os) ou
    -- na saída do pedido (tg_os_parcela_vence_na_saida). Várias: a partir do 1º vencimento
    -- combinado; sem ele, nos modelos com entrada, a partir do prazo de entrega; no acordo
    -- antigo, de hoje — como sempre foi.
    IF v_saldo > 0 OR v_n = 0 THEN
      v_primeiro := COALESCE((v_orc.condicao_pagamento->>'primeiro_vencimento')::date,
                             CASE WHEN v_parcelas = 1 THEN NULL
                                  WHEN v_modelo IN ('entrada', 'metade_metade') THEN COALESCE(v_prazo, v_hoje)
                                  ELSE v_hoje END);
      v_valor_parcela := round(v_saldo / v_parcelas, 2);
      v_acumulado := 0;
      FOR v_i IN 1..v_parcelas LOOP
        v_n := v_n + 1;
        INSERT INTO public.parcelas_receber(conta_id, parcela, valor, vencimento)
        VALUES (
          v_conta_id, v_n,
          CASE WHEN v_i < v_parcelas THEN v_valor_parcela ELSE v_saldo - v_acumulado END,
          v_primeiro + ((v_i - 1) * v_intervalo)
        );
        v_acumulado := v_acumulado + v_valor_parcela;
      END LOOP;
    END IF;
    -- O evento e o retorno contam as parcelas que a conta ganhou de fato (entrada + saldo).
    v_parcelas := v_n;
  END;

  -- Pix já recebido na hora de combinar o pagamento (marcado no orçamento): vira baixa das parcelas, da
  -- primeira para a última. Só quando quem converte pode confirmar pagamento; senão fica o aviso e o
  -- financeiro dá a baixa. Acessório: nunca derruba a conversão.
  IF COALESCE((v_orc.condicao_pagamento->'pix_recebido'->>'valor')::numeric, 0) > 0
     AND COALESCE((v_orc.condicao_pagamento->'pix_recebido'->>'lancado')::boolean, false) = false THEN
    BEGIN
      IF public.has_permission(v_uid, 'pagamentos.confirm') THEN
        DECLARE v_resto numeric := (v_orc.condicao_pagamento->'pix_recebido'->>'valor')::numeric; v_p record; v_aplica numeric;
        BEGIN
          FOR v_p IN SELECT id, valor FROM public.parcelas_receber WHERE conta_id = v_conta_id ORDER BY parcela LOOP
            EXIT WHEN v_resto <= 0.009;
            v_aplica := LEAST(v_resto, v_p.valor);
            PERFORM public.confirmar_pagamento(v_p.id, v_aplica, 'pix', 0, COALESCE((v_orc.condicao_pagamento->'pix_recebido'->>'em')::date, CURRENT_DATE), NULL, 'orcamento');
            v_resto := v_resto - v_aplica;
          END LOOP;
          IF v_resto > 0.009 THEN RAISE WARNING 'Pix marcado maior que a conta da OS %: sobraram R$ %', v_os_id, v_resto; END IF;
        END;
        UPDATE public.orcamentos SET condicao_pagamento = jsonb_set(condicao_pagamento, '{pix_recebido,lancado}', 'true'::jsonb) WHERE id = p_orcamento_id;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Não deu para lançar o Pix recebido da OS %: %', v_os_id, SQLERRM;
    END;
  END IF;

  -- A OS nasce com a máquina reservada: é o passo que faltava entre vender
  -- e produzir. Acessório de propósito — se o agendamento falhar, a OS
  -- continua de pé e o motivo volta no retorno em vez de sumir.
  BEGIN
    v_agenda := public.agendar_os_interno(v_os_id);
  EXCEPTION WHEN OTHERS THEN
    v_agenda := jsonb_build_object('erro', SQLERRM);
    RAISE WARNING 'Não deu para agendar a OS % na máquina: %', v_os_id, SQLERRM;
  END;

  INSERT INTO public.eventos_negocio(
    entidade, entidade_id, os_id, cliente_id, tipo, titulo, dados_posteriores, usuario_id
  )
  VALUES (
    'orcamento', p_orcamento_id, v_os_id, v_orc.cliente_id, 'orcamento_convertido_os',
    'Orçamento convertido em OS',
    jsonb_build_object('os_id', v_os_id, 'conta_id', v_conta_id, 'parcelas', v_parcelas,
                       'cliente_criado_do_contato', v_cliente_criado,
                       'materiais_previstos', v_previstos, 'reserva', v_reserva, 'agenda', v_agenda,
                       'desconto', v_desconto_os,
                       'desconto_aprovado_por', v_orc.desconto_aprovado_por,
                       'prazo', v_prazo, 'prazo_origem', COALESCE(v_prazo_origem, 'sem_prazo')),
    v_uid
  );

  RETURN jsonb_build_object(
    'orcamento_id', p_orcamento_id, 'os_id', v_os_id, 'conta_id', v_conta_id,
    'parcelas', v_parcelas, 'cliente_id', v_orc.cliente_id,
    'cliente_criado_do_contato', v_cliente_criado,
    'materiais_previstos', v_previstos,
    'custo_materiais_previsto', v_custo_materiais,
    'reserva', v_reserva,
    'agenda', v_agenda,
    'desconto', v_desconto_os,
    'jobs_3d', v_jobs_3d
  );
END;
$function$;
