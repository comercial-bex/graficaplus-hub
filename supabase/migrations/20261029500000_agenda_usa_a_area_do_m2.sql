-- 29/10/2026 — a agenda de máquina lê o tempo do produto por m², não por peça.
--
-- A OS 212 (Marcela, 50 adesivos de 21 × 5 cm = 0,55 m²) nasceu sem horário no recorte: a conversão devolveu
-- "sem horário livre nos próximos 90 dias nesta máquina". Não faltava horário. O produto "Adesivo vinil
-- recortado" tem 35 min cadastrados e é vendido em m²; `custo_cheio_do_produto` lê esse tempo POR UNIDADE do
-- produto (por m²), mas `agendar_os_interno` multiplicava pelas PEÇAS: 35 × 50 = 1.750 min, quase três
-- dias de expediente seguidos. `proximo_horario_livre_interno` só oferece blocos que cabem num dia (08:00 às
-- 18:00, 600 min), então nenhum dos 90 dias servia. O mesmo valia para qualquer pedido de adesivo recortado
-- com 18 peças ou mais, e para todo produto em m² cuja máquina não tem velocidade cadastrada (recorte, laser).
--
-- O que muda em `agendar_os_interno` (corpo vivo de 29/10):
--   1. produto em m² e item com área cobrada: minutos = tempo do produto × área cobrada (35 × 0,55 = 20 min);
--      os demais continuam tempo × quantidade (copo, chaveiro, hora de serviço);
--   2. item que precisa de mais minutos seguidos do que o dia tem deixa de dizer "sem horário livre nos
--      próximos 90 dias" (mandava procurar folga que não existe) e passa a dizer quanto precisa e o que fazer.
--
-- A máquina com velocidade (impressora) segue pela velocidade, como antes.

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
    -- atravessa a noite. Item maior que isso nunca acha lugar: antes caía em "sem horário livre nos
    -- próximos 90 dias", que mandava procurar folga que não existe. Agora diz quanto precisa e o que fazer.
    IF v_min > 600 THEN
      v_puladas := v_puladas || jsonb_build_object('item', COALESCE(r.produto, r.descricao),
        'motivo', 'precisa de ' || v_min || ' min seguidos, mais que o dia de 600 min (08:00 às 18:00): agende em partes na agenda de máquinas');
      CONTINUE;
    END IF;

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
