-- A agenda divide o item que não cabe num dia, e o aviso enxerga o item que ela não consegue reservar
-- (diagnóstico final de 29/10/2026, verificações 5.3 e 5.4 do sistema).
--
-- 5.3. `proximo_horario_livre_interno` oferece blocos de um dia só (08:00 às 18:00, 600 min, sem atravessar a
--      noite). Item acima disso nunca achava lugar e o agendamento o recusava com "agende em partes na agenda de
--      máquinas": o trabalho de dividir ficava para a pessoa. Agora o item que cabe num dia vai inteiro, como
--      antes; o que não cabe (ou não acha uma folga contínua do tamanho dele) é reservado em partes de até 240
--      min (meio expediente), uma depois da outra, nos horários livres da máquina. Ou entram todas as partes,
--      ou nenhuma: reserva pela metade esconderia o atraso. O primeiro horário e o setup valem pelo item todo.
--      A trava `maquinas_agenda_sem_sobreposicao` continua mandando: as partes só entram onde a máquina está livre.
--
-- 5.4. O aviso "OS em andamento sem horário na máquina" só contava OS cujo produto TEM máquina padrão: a medição
--      de 29/10 achou 1 aviso para 8 OS sem reserva, porque o resto não podia ser agendado por falta de cadastro
--      e esse caso, o mais útil de avisar, ficava calado. O aviso novo `item_sem_maquina_ou_tempo` lista o item
--      que a agenda não consegue reservar e diz por quê: digitado à mão sem produto do catálogo, produto sem
--      máquina padrão ou produto sem tempo de produção (e a máquina sem velocidade). Fora dele ficam o que não
--      se agenda de propósito: serviço, taxa, serviço terceirizado, OS de impressão 3D e OS que já tem reserva.
CREATE OR REPLACE FUNCTION public.agendar_os_interno(p_os_id uuid, p_a_partir_de timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_os public.ordens_servico%ROWTYPE;
  r RECORD; v_min int; v_inicio timestamptz; v_cursor timestamptz := p_a_partir_de;
  v_criadas int := 0; v_puladas jsonb := '[]'::jsonb; v_reservas jsonb := '[]'::jsonb; v_id uuid;
  v_ini_p timestamptz[]; v_min_p int[]; v_parte int; v_partes int; v_resto int; v_c timestamptz; v_ok boolean;
BEGIN
  SELECT * INTO v_os FROM public.ordens_servico WHERE id = p_os_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'OS não encontrada.' USING ERRCODE = 'P0002'; END IF;

  FOR r IN
    SELECT i.id AS item_id, i.descricao, i.quantidade, i.area_cobrada,
           p.id AS produto_id, p.nome AS produto, p.tempo_producao_min, p.unidade::text AS unidade_produto,
           COALESCE(p.maquina_padrao_id, v_os.maquina_id) AS maquina_id,
           m.nome AS maquina, m.velocidade_m2_h, m.setup_min, m.tempo_minimo_min
    FROM public.itens_os i
    LEFT JOIN public.produtos p ON p.id = i.produto_id
    LEFT JOIN public.maquinas m ON m.id = COALESCE(p.maquina_padrao_id, v_os.maquina_id)
    WHERE i.os_id = p_os_id
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
      -- `tempo_producao_min` é por UNIDADE do produto (a mesma leitura de `custo_cheio_do_produto`): produto
      -- em m² gasta aquele tempo por m², não por peça. Multiplicar pelas peças fazia 50 adesivos de 21 × 5 cm
      -- (0,55 m²) pedirem 35 × 50 = 1.750 min e nunca caberem num dia (OS 212, 29/10/2026).
      v_min := ceil(r.tempo_producao_min * CASE
          WHEN lower(replace(COALESCE(r.unidade_produto, ''), '²', '2')) = 'm2' AND COALESCE(r.area_cobrada, 0) > 0
            THEN r.area_cobrada
          ELSE GREATEST(COALESCE(r.quantidade, 1), 1) END)::int;
    ELSE
      v_puladas := v_puladas || jsonb_build_object('item', COALESCE(r.produto, r.descricao),
        'motivo', 'produto sem tempo de produção e máquina sem velocidade');
      CONTINUE;
    END IF;

    v_min := GREATEST(v_min + COALESCE(r.setup_min, 0), COALESCE(r.tempo_minimo_min, 0), 1);

    -- O dia que `proximo_horario_livre_interno` oferece vai das 08:00 às 18:00 (600 min) e o bloco não
    -- atravessa a noite. O que cabe num dia vai inteiro; o que não cabe, ou não acha uma folga contínua do
    -- tamanho dele, é reservado em partes de até 240 min (meio expediente), uma depois da outra. Ou entram
    -- todas as partes, ou nenhuma.
    v_ini_p := ARRAY[]::timestamptz[];
    v_min_p := ARRAY[]::int[];
    IF v_min <= 600 THEN
      v_inicio := public.proximo_horario_livre_interno(r.maquina_id, v_min, v_cursor);
      IF v_inicio IS NOT NULL THEN
        v_ini_p := ARRAY[v_inicio];
        v_min_p := ARRAY[v_min];
      END IF;
    END IF;

    IF cardinality(v_ini_p) = 0 THEN
      v_partes := ceil(v_min / 240.0)::int;
      IF v_partes > 60 THEN
        v_puladas := v_puladas || jsonb_build_object('item', COALESCE(r.produto, r.descricao),
          'motivo', 'precisa de ' || v_min || ' min de máquina (mais de 60 blocos de 4 h): divida o pedido ou reserve na agenda de máquinas');
        CONTINUE;
      END IF;
      v_resto := v_min; v_c := v_cursor; v_ok := true;
      FOR v_parte IN 1..v_partes LOOP
        v_inicio := public.proximo_horario_livre_interno(r.maquina_id, LEAST(v_resto, 240), v_c);
        IF v_inicio IS NULL THEN v_ok := false; EXIT; END IF;
        v_ini_p := v_ini_p || v_inicio;
        v_min_p := v_min_p || LEAST(v_resto, 240);
        v_c := v_inicio + make_interval(mins => LEAST(v_resto, 240));
        v_resto := v_resto - LEAST(v_resto, 240);
      END LOOP;
      IF NOT v_ok THEN
        v_puladas := v_puladas || jsonb_build_object('item', COALESCE(r.produto, r.descricao),
          'motivo', 'sem horário livre nos próximos 90 dias nesta máquina');
        CONTINUE;
      END IF;
    END IF;

    v_partes := cardinality(v_ini_p);
    FOR v_parte IN 1..v_partes LOOP
      INSERT INTO public.maquinas_agenda
        (maquina_id, os_id, os_item_id, titulo, inicio, fim, inicio_previsto, fim_previsto,
         minutos_previstos, status, origem, prioridade, operador_id, created_by)
      VALUES (r.maquina_id, p_os_id, r.item_id,
         'OS #' || v_os.numero || ' · ' || COALESCE(r.produto, r.descricao)
           || CASE WHEN v_partes > 1 THEN ' (parte ' || v_parte || '/' || v_partes || ')' ELSE '' END,
         v_ini_p[v_parte], v_ini_p[v_parte] + make_interval(mins => v_min_p[v_parte]),
         v_ini_p[v_parte], v_ini_p[v_parte] + make_interval(mins => v_min_p[v_parte]),
         v_min_p[v_parte], 'agendado', 'os', COALESCE(v_os.prioridade, 3), v_os.operador_id, auth.uid())
      RETURNING id INTO v_id;

      v_criadas := v_criadas + 1;
      v_reservas := v_reservas || jsonb_build_object('id', v_id, 'maquina', r.maquina,
        'item', COALESCE(r.produto, r.descricao), 'inicio', v_ini_p[v_parte], 'minutos', v_min_p[v_parte],
        'parte', v_parte, 'partes', v_partes);
    END LOOP;
    v_cursor := v_ini_p[v_partes] + make_interval(mins => v_min_p[v_partes]);
  END LOOP;

  RETURN jsonb_build_object('os', v_os.numero, 'criadas', v_criadas,
    'reservas', v_reservas, 'puladas', v_puladas);
END $function$;

-- 5.4. O aviso do item que a agenda não consegue reservar.
DO $migracao$
DECLARE
  v_oid oid;
  v_def text;
  v_antes int;
  v_ancora text := $a$  -- Reembolsos esperando decisão (15/10/2026): a gerência$a$;
  v_aviso text := $aviso$  -- Item de OS aberta que a agenda não consegue reservar (30/10/2026): a conta de 29/10 achou 8 OS sem
  -- horário e o aviso de OS sem horário via 1, porque só contava produto que já tem máquina padrão.
  RETURN QUERY SELECT 'item_sem_maquina_ou_tempo', 'Itens de OS aberta que a agenda não consegue reservar', count(*)::int,
    (SELECT count(*)::int FROM public.itens_os i2 JOIN public.ordens_servico o2 ON o2.id = i2.os_id
      WHERE o2.finalidade::text = 'venda' AND o2.status::text NOT IN ('concluido','faturado','cancelado')),
    'atencao', 'gestao',
    'Sem produto do catálogo, sem máquina padrão ou sem tempo de produção a agenda não reserva a máquina e a capacidade parece livre: ' ||
      string_agg(DISTINCT 'OS nº ' || o.numero::text || ' (' || COALESCE(nullif(btrim(p.nome), ''), nullif(btrim(i.descricao), ''), 'item') || ': ' ||
        CASE WHEN i.produto_id IS NULL THEN 'item digitado à mão, sem produto do catálogo'
             WHEN p.maquina_padrao_id IS NULL AND o.maquina_id IS NULL THEN 'produto sem máquina padrão'
             ELSE 'produto sem tempo de produção' END || ')', '; ') ||
      '. Ligue o item a um produto do catálogo, ou cadastre a máquina e o tempo na ficha do produto; se o serviço é feito fora, pode ignorar.',
    '/produtos'
  FROM public.itens_os i
  JOIN public.ordens_servico o ON o.id = i.os_id
  LEFT JOIN public.produtos p ON p.id = i.produto_id
  LEFT JOIN public.maquinas m ON m.id = COALESCE(p.maquina_padrao_id, o.maquina_id)
  WHERE o.finalidade::text = 'venda'
    AND o.status::text IN ('entrada','aguardando_briefing','briefing_ok','design','aguardando_aprovacao_arte','arte_aprovada',
                           'arte_rejeitada','aguardando_producao','producao','em_producao','em_impressao','em_corte',
                           'em_acabamento','em_uv','em_laser_cnc','controle_qualidade','retrabalho')
    AND COALESCE(p.tipo::text, 'produto') <> 'servico'
    AND COALESCE(p.nome, i.descricao, '') !~* '(terceiriz|^taxa)'
    AND NOT EXISTS (SELECT 1 FROM public.maquinas_agenda a
                     WHERE a.os_id = o.id AND a.status IN ('agendado', 'em_producao', 'concluido'))
    AND NOT EXISTS (SELECT 1 FROM public.producao_3d_jobs j WHERE j.os_id = o.id)
    AND (i.produto_id IS NULL
         OR (p.maquina_padrao_id IS NULL AND o.maquina_id IS NULL)
         OR (COALESCE(p.tempo_producao_min, 0) = 0
             AND NOT (COALESCE(m.velocidade_m2_h, 0) > 0 AND COALESCE(i.area_cobrada, 0) > 0)))
  HAVING count(*) > 0;

$aviso$;
BEGIN
  SELECT p.oid INTO v_oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'pendencias_do_sistema';
  v_def := pg_get_functiondef(v_oid);
  IF position('item_sem_maquina_ou_tempo' IN v_def) = 0 THEN
    v_antes := (length(v_def) - length(replace(v_def, v_ancora, ''))) / length(v_ancora);
    IF v_antes <> 1 THEN RAISE EXCEPTION 'pendencias_do_sistema: esperava 1 âncora, achei %', v_antes; END IF;
    EXECUTE replace(v_def, v_ancora, v_aviso || v_ancora);
  END IF;
END
$migracao$;
