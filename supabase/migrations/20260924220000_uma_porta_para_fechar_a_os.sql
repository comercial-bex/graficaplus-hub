-- ============================================================================
-- Uma porta só para fechar a OS
-- ============================================================================
--
-- A Onda 3 fez a baixa da entrega fechar a OS. Mas quem NÃO entrega — a
-- retirada no balcão, que é o caso mais comum da gráfica — continuava com dois
-- problemas.
--
-- PRIMEIRO: não havia botão. O painel de produção tem o passo "Começar",
-- "Mandar p/ acabamento" e "Pronta"; na etapa de SAÍDA, `proximoPasso`
-- devolvia `null`. A OS chegava em "Aguardando retirada" e o painel parava
-- ali. O cliente vinha, levava o banner, e a OS ficava aberta — a menos que
-- alguém abrisse a tela de detalhe e trocasse o status no seletor.
--
-- SEGUNDO, e pior: havia DUAS portas para "concluída", e uma fazia metade.
--
--   tela de detalhe -> fechar_os          -> status + status_geral
--                                            + data_fechamento + custo_real
--                                            + margem_real + snapshot
--                                            + pesquisa de pós-venda
--
--   Kanban / painel -> avancar_os_status  -> só o status
--
-- Medido, com reversão, arrastando o cartão até "Concluído":
--
--   status=concluido | status_geral=entrada | data_fechamento=NULO
--   snapshot=0 | pós-venda=0
--
-- Ou seja: a OS "fechava" pelo quadro sem gravar o resultado, sem data de
-- fechamento e sem pós-venda. `custo_real` e `margem_real` ficavam em branco
-- PARA SEMPRE, porque quem os grava é `fechar_os`. É o mesmo formato do
-- defeito da arte aprovada: dois caminhos para o mesmo fato, um deles cego
-- para o outro.
--
-- Retrato do banco vivo: aplicado e ensaiado com reversão.

DO $patch$
DECLARE src text; novo text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO src FROM pg_proc p
  JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='avancar_os_status';

  IF position('fechar_os' in src) > 0 THEN RETURN; END IF;

  novo := replace(src,
    $old$  v_bloqueios := public.os_bloqueios_para(avancar_os_status.os_id, novo_status);$old$,
    $new$  -- Concluir e fechar sao o MESMO fato, e havia duas portas para ele.
  -- Arrastar o cartao ate "Concluido" no Kanban escrevia so o status:
  -- status_geral ficava em 'entrada', data_fechamento nulo, e nao nascia nem o
  -- snapshot de resultado nem a pesquisa de pos-venda. `custo_real` e
  -- `margem_real` da OS ficavam em branco PARA SEMPRE, porque quem os grava e
  -- `fechar_os` — que so era chamado pelo seletor da tela de detalhe.
  --
  -- Agora ha uma porta so: venha do Kanban, do painel de producao ou da tela
  -- da OS, concluir passa por `fechar_os`, com as oito travas e o resultado.
  IF novo_status IN ('concluido','faturado') THEN
    DECLARE v_res jsonb;
    BEGIN
      v_res := public.fechar_os(avancar_os_status.os_id);
      IF NOT COALESCE((v_res->>'fechada')::boolean, false) THEN
        SELECT string_agg(b #>> '{}', '; ') INTO v_texto
          FROM jsonb_array_elements(v_res->'bloqueios') b;
        RAISE EXCEPTION 'A OS nao pode fechar ainda: %.', v_texto;
      END IF;
      IF novo_status = 'faturado' THEN
        PERFORM set_config('app.avancar_os_status', 'on', true);
        UPDATE public.ordens_servico SET status = 'faturado' WHERE id = avancar_os_status.os_id;
        PERFORM set_config('app.avancar_os_status', '', true);
      END IF;
      SELECT * INTO v_os_atualizada FROM public.ordens_servico WHERE id = avancar_os_status.os_id;
      RETURN v_os_atualizada;
    END;
  END IF;

  v_bloqueios := public.os_bloqueios_para(avancar_os_status.os_id, novo_status);$new$);

  IF novo = src THEN RAISE EXCEPTION 'chamada a os_bloqueios_para nao encontrada'; END IF;
  EXECUTE novo;
END $patch$;

-- ENSAIADO, com reversão:
--   OS limpa, arrastada até "Concluído" pelo Kanban ->
--     status=concluido | status_geral=fechada | data_fechamento preenchida
--     snapshot=1 | pós-venda=1
--   OS travada, mesmo caminho ->
--     "A OS nao pode fechar ainda: custos_operacionais; pagamentos_pendentes."
--     (a tela traduz os códigos; ver ROTULO_BLOQUEIO em domain/os/etapas.ts)
