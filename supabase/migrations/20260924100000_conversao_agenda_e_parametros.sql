-- A venda fechada passa a chegar na oficina sozinha.
--
-- Investigando o que faltava, descobri que DUAS coisas que eu tinha listado
-- como pendentes já existiam e funcionavam:
--   * a previsão de material JÁ é explodida (gatilho em itens_os + chamada na
--     conversão);
--   * a conta a receber e as parcelas JÁ nascem na conversão.
-- O que faltava de verdade era outra coisa, e está aqui.
--
-- 1. ORÇAMENTO APROVADO NÃO VIRAVA OS SOZINHO, nem pelo link do cliente. A
--    venda ficava fechada e o sistema inteiro não sabia: sem material previsto,
--    sem reserva de estoque, sem máquina, sem conta a receber. Converter segue
--    sendo um ato humano de propósito — a conversão cria registro financeiro, e
--    a casa não gera cobrança sozinha — mas agora vira PENDÊNCIA CRÍTICA, com o
--    caminho escrito.
--
-- 2. A OS NASCIA SEM HORA DE MÁQUINA. `converter_orcamento_em_os` fazia tudo,
--    menos reservar a máquina. Passa a chamar o agendamento. Como agendar é
--    acessório (a OS tem de existir mesmo que a agenda falhe), vai em bloco de
--    exceção com RAISE WARNING e o motivo volta no retorno, em vez de sumir.
--
-- 3. O AGENDAMENTO EXIGIA PERMISSÃO QUE QUEM CONVERTE PODE NÃO TER. Um vendedor
--    com `orcamentos.convert` e sem `os.update` derrubaria a conversão inteira.
--    O núcleo virou `agendar_os_interno`, sem checagem, não concedido a
--    ninguém; a RPC pública continua checando e delega. Mesmo padrão de
--    `reservar_materiais_os_interno`, que já existia.
--
-- 4. DOIS GATILHOS FAZIAM O MESMO TRABALHO em `itens_os`: `tg_prever_materiais`
--    (com guarda de produto_id) e `trg_itens_os_prev` (sem guarda). Cada item
--    inserido disparava a explosão duas vezes, e a função varre a OS inteira a
--    cada chamada. Ficou o que tem guarda.
--
-- 5. A CONVERSÃO ANUNCIAVA "0 materiais previstos" COM A PREVISÃO FEITA. O
--    gatilho do item já tinha inserido tudo, então a chamada seguinte não
--    encontrava nada novo e devolvia 0 — e a tela mostrava zero. Agora conta o
--    que a OS TEM, não o que aquela chamada inseriu. Medido: 6 m² de lona 440g
--    geram 6,30 m² de lona (com a perda de 5%) e 84 ml de tinta, R$ 109,81.
--
-- COMO DESFAZER: recriar trg_itens_os_prev, remover o bloco da agenda de
-- converter_orcamento_em_os e a pendência orcamento_aprovado_sem_os, e apagar
-- agendar_os_interno / proximo_horario_livre_interno.

-- ----------------------------------------- 1. o núcleo, sem porteiro na porta
-- Não é concedido a ninguém: só quem já autorizou o chamador usa (a RPC
-- pública e a conversão, ambas SECURITY DEFINER com guarda própria).
CREATE OR REPLACE FUNCTION public.proximo_horario_livre_interno(
  p_maquina_id uuid, p_minutos int, p_a_partir_de timestamptz DEFAULT now())
RETURNS timestamptz
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_tz text := 'America/Belem';
  v_abre time := '08:00'; v_fecha time := '18:00';
  v_dia date; v_cursor timestamptz; v_fim_dia timestamptz;
  v_ocupado_ate timestamptz; v_i int := 0;
BEGIN
  IF p_minutos IS NULL OR p_minutos <= 0 THEN RETURN NULL; END IF;
  v_dia := (p_a_partir_de AT TIME ZONE v_tz)::date;
  WHILE v_i < 90 LOOP
    IF extract(isodow FROM v_dia) < 6 THEN
      v_cursor := GREATEST(p_a_partir_de, ((v_dia + v_abre) AT TIME ZONE v_tz));
      v_fim_dia := (v_dia + v_fecha) AT TIME ZONE v_tz;
      WHILE v_cursor + make_interval(mins => p_minutos) <= v_fim_dia LOOP
        SELECT max(COALESCE(a.fim_previsto, a.fim)) INTO v_ocupado_ate
        FROM public.maquinas_agenda a
        WHERE a.maquina_id = p_maquina_id AND a.status IN ('agendado', 'em_producao')
          AND tstzrange(COALESCE(a.inicio_previsto, a.inicio), COALESCE(a.fim_previsto, a.fim), '[)')
              && tstzrange(v_cursor, v_cursor + make_interval(mins => p_minutos), '[)');
        IF v_ocupado_ate IS NULL THEN RETURN v_cursor; END IF;
        v_cursor := v_ocupado_ate;
      END LOOP;
    END IF;
    v_dia := v_dia + 1; v_i := v_i + 1;
  END LOOP;
  RETURN NULL;
END $function$;

CREATE OR REPLACE FUNCTION public.agendar_os_interno(p_os_id uuid, p_a_partir_de timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_os public.ordens_servico%ROWTYPE;
  r RECORD; v_min int; v_inicio timestamptz; v_cursor timestamptz := p_a_partir_de;
  v_criadas int := 0; v_puladas jsonb := '[]'::jsonb; v_reservas jsonb := '[]'::jsonb; v_id uuid;
BEGIN
  SELECT * INTO v_os FROM public.ordens_servico WHERE id = p_os_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'OS não encontrada.' USING ERRCODE = 'P0002'; END IF;

  FOR r IN
    SELECT i.id AS item_id, i.descricao, i.quantidade, i.area_cobrada,
           p.id AS produto_id, p.nome AS produto, p.tempo_producao_min,
           COALESCE(p.maquina_padrao_id, v_os.maquina_id) AS maquina_id,
           m.nome AS maquina, m.velocidade_m2_h, m.setup_min, m.tempo_minimo_min
    FROM public.itens_os i
    LEFT JOIN public.produtos p ON p.id = i.produto_id
    LEFT JOIN public.maquinas m ON m.id = COALESCE(p.maquina_padrao_id, v_os.maquina_id)
    WHERE i.os_id = p_os_id
      -- item já reservado não ganha segunda reserva: torna a chamada repetível
      AND NOT EXISTS (SELECT 1 FROM public.maquinas_agenda a
                       WHERE a.os_item_id = i.id AND a.status IN ('agendado', 'em_producao'))
    ORDER BY i.ordem NULLS LAST, i.created_at
  LOOP
    IF r.maquina_id IS NULL THEN
      v_puladas := v_puladas || jsonb_build_object('item', COALESCE(r.produto, r.descricao),
        'motivo', 'produto sem máquina padrão e a OS não tem máquina definida');
      CONTINUE;
    END IF;

    IF COALESCE(r.velocidade_m2_h, 0) > 0 AND COALESCE(r.area_cobrada, 0) > 0 THEN
      v_min := ceil((r.area_cobrada / r.velocidade_m2_h) * 60)::int;
    ELSIF COALESCE(r.tempo_producao_min, 0) > 0 THEN
      v_min := ceil(r.tempo_producao_min * GREATEST(COALESCE(r.quantidade, 1), 1))::int;
    ELSE
      v_puladas := v_puladas || jsonb_build_object('item', COALESCE(r.produto, r.descricao),
        'motivo', 'produto sem tempo de produção e máquina sem velocidade');
      CONTINUE;
    END IF;

    v_min := GREATEST(v_min + COALESCE(r.setup_min, 0), COALESCE(r.tempo_minimo_min, 0), 1);
    v_inicio := public.proximo_horario_livre_interno(r.maquina_id, v_min, v_cursor);

    IF v_inicio IS NULL THEN
      v_puladas := v_puladas || jsonb_build_object('item', COALESCE(r.produto, r.descricao),
        'motivo', 'sem horário livre nos próximos 90 dias nesta máquina');
      CONTINUE;
    END IF;

    INSERT INTO public.maquinas_agenda
      (maquina_id, os_id, os_item_id, titulo, inicio, fim, inicio_previsto, fim_previsto,
       minutos_previstos, status, origem, prioridade, operador_id, created_by)
    VALUES (r.maquina_id, p_os_id, r.item_id,
       'OS #' || v_os.numero || ' · ' || COALESCE(r.produto, r.descricao),
       v_inicio, v_inicio + make_interval(mins => v_min),
       v_inicio, v_inicio + make_interval(mins => v_min),
       v_min, 'agendado', 'os', COALESCE(v_os.prioridade, 3), v_os.operador_id, auth.uid())
    RETURNING id INTO v_id;

    v_criadas := v_criadas + 1;
    v_cursor := v_inicio + make_interval(mins => v_min);
    v_reservas := v_reservas || jsonb_build_object('id', v_id, 'maquina', r.maquina,
      'item', COALESCE(r.produto, r.descricao), 'inicio', v_inicio, 'minutos', v_min);
  END LOOP;

  RETURN jsonb_build_object('os', v_os.numero, 'criadas', v_criadas,
    'reservas', v_reservas, 'puladas', v_puladas);
END $function$;

REVOKE ALL ON FUNCTION public.agendar_os_interno(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.proximo_horario_livre_interno(uuid, int, timestamptz) FROM PUBLIC, anon, authenticated;

-- ------------------------------------- 2. as RPCs públicas viram porteiras
CREATE OR REPLACE FUNCTION public.agendar_os_na_maquina(p_os_id uuid, p_a_partir_de timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_permission(auth.uid(), 'kanban.move')
     AND NOT public.has_permission(auth.uid(), 'os.update') THEN
    RAISE EXCEPTION 'Você não pode agendar produção.' USING ERRCODE = '42501';
  END IF;
  RETURN public.agendar_os_interno(p_os_id, p_a_partir_de);
END $function$;

CREATE OR REPLACE FUNCTION public.proximo_horario_livre(
  p_maquina_id uuid, p_minutos int, p_a_partir_de timestamptz DEFAULT now())
RETURNS timestamptz
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
  RETURN public.proximo_horario_livre_interno(p_maquina_id, p_minutos, p_a_partir_de);
END $function$;

-- ------------------------------------------ 3. um gatilho só para a previsão
DROP TRIGGER IF EXISTS trg_itens_os_prev ON public.itens_os;

COMMENT ON TRIGGER tg_prever_materiais ON public.itens_os IS
  'Único gatilho de previsão de material. Havia um segundo (trg_itens_os_prev) fazendo a mesma chamada sem o guarda de produto_id: dois disparos por item, e a função varre a OS inteira a cada um.';

-- ---------------------- 4. a conversão reserva a máquina e conta certo o material
DO $patch$
DECLARE src text; novo text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'converter_orcamento_em_os';

  novo := replace(src, '  v_custo_materiais NUMERIC := 0;',
    '  v_custo_materiais NUMERIC := 0;' || E'\n  v_agenda JSONB := ''{}''::jsonb;');
  IF novo = src THEN RAISE EXCEPTION 'declaração de v_custo_materiais não encontrada'; END IF;
  src := novo;

  novo := replace(src,
'  SELECT COALESCE(SUM(quantidade * COALESCE(custo_unitario_previsto, 0)), 0)
    INTO v_custo_materiais
    FROM public.os_materiais_previstos WHERE os_id = v_os_id;',
'  -- Quantos materiais a OS TEM previstos, não quantos esta chamada inseriu.
  -- O gatilho de item já explode a receita na inserção, então a chamada a
  -- gerar_materiais_previstos_os acima encontra tudo pronto e devolve 0 — e a
  -- tela anunciava "0 materiais previstos" com a previsão inteira feita.
  SELECT count(*)::int, COALESCE(SUM(quantidade * COALESCE(custo_unitario_previsto, 0)), 0)
    INTO v_previstos, v_custo_materiais
    FROM public.os_materiais_previstos WHERE os_id = v_os_id;');
  IF novo = src THEN RAISE EXCEPTION 'soma do custo de materiais não encontrada'; END IF;
  src := novo;

  novo := replace(src, '  INSERT INTO public.eventos_negocio(',
    '  -- A OS nasce com a máquina reservada: é o passo que faltava entre vender' || E'\n' ||
    '  -- e produzir. Acessório de propósito — se o agendamento falhar, a OS' || E'\n' ||
    '  -- continua de pé e o motivo volta no retorno em vez de sumir.' || E'\n' ||
    '  BEGIN' || E'\n' ||
    '    v_agenda := public.agendar_os_interno(v_os_id);' || E'\n' ||
    '  EXCEPTION WHEN OTHERS THEN' || E'\n' ||
    '    v_agenda := jsonb_build_object(''erro'', SQLERRM);' || E'\n' ||
    '    RAISE WARNING ''Não deu para agendar a OS % na máquina: %'', v_os_id, SQLERRM;' || E'\n' ||
    '  END;' || E'\n\n' ||
    '  INSERT INTO public.eventos_negocio(');
  IF novo = src THEN RAISE EXCEPTION 'ponto do evento não encontrado'; END IF;
  src := novo;

  novo := replace(src, '''materiais_previstos'', v_previstos, ''reserva'', v_reserva),',
    '''materiais_previstos'', v_previstos, ''reserva'', v_reserva, ''agenda'', v_agenda),');
  IF novo = src THEN RAISE EXCEPTION 'payload do evento não encontrado'; END IF;
  src := novo;

  novo := replace(src, '    ''reserva'', v_reserva' || E'\n  );',
    '    ''reserva'', v_reserva,' || E'\n    ''agenda'', v_agenda' || E'\n  );');
  IF novo = src THEN RAISE EXCEPTION 'retorno não encontrado'; END IF;

  EXECUTE novo;
END $patch$;

-- ------------------------- 5. a venda fechada que a oficina ainda não soube
DO $patch$
DECLARE src text; novo text; marca text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'pendencias_do_sistema';

  marca := '  RETURN QUERY SELECT ''arte_aguardando_cliente''';

  novo := replace(src, marca,
'  -- O cliente já disse sim e a peça não entrou na fila. Enquanto o orçamento
  -- não vira OS não existe material previsto, reserva de máquina nem conta a
  -- receber: a venda está fechada e o sistema inteiro ainda não sabe.
  RETURN QUERY SELECT ''orcamento_aprovado_sem_os'',''Orçamentos aprovados que ainda não viraram OS'', count(*)::int,
    (SELECT count(*)::int FROM public.orcamentos WHERE status = ''aprovado''),''critico'',''atendimento'',
    ''O cliente aprovou e a produção não foi avisada. Abra o orçamento e use "Converter em OS" — a OS já nasce com o material previsto e a máquina reservada.'',''/orcamentos''
  FROM public.orcamentos WHERE status = ''aprovado'' AND os_id IS NULL HAVING count(*) > 0;

' || marca);
  IF novo = src THEN RAISE EXCEPTION 'ponto de inserção da pendência não encontrado'; END IF;

  EXECUTE novo;
END $patch$;
