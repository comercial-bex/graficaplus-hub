-- As contas que as telas de capacidade, meta e agenda leem.
--
-- Todas são SECURITY DEFINER com guarda no corpo e o dinheiro separado por
-- nível: `capacidade_das_maquinas` devolve custo/hora só para quem passa em
-- `can_see_financials`, `meta_por_produto` exige `can_see_prices` e esconde o
-- custo de quem não é financeiro, e `ponto_de_equilibrio` é só do financeiro.
--
-- COMO DESFAZER: drop function ponto_de_equilibrio(date), capacidade_das_maquinas(date,date),
--   onde_o_trabalho_para(), meta_por_produto(date), agendar_os_na_maquina(uuid,timestamptz),
--   proximo_horario_livre(uuid,int,timestamptz);

-- --------------------------------------------------------- ponto de equilíbrio
-- Quanto a gráfica precisa faturar no mês para empatar. Custo fixo pela visão
-- de caixa (tudo que vence no mês, o que já inclui as parcelas de máquina),
-- dividido pela margem de contribuição calculada do catálogo real e dos
-- parâmetros da casa (perda, falha, imposto, cartão).
CREATE OR REPLACE FUNCTION public.ponto_de_equilibrio(p_mes date DEFAULT date_trunc('month', CURRENT_DATE)::date)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_ini date := date_trunc('month', COALESCE(p_mes, CURRENT_DATE))::date;
  v_fim date := (v_ini + INTERVAL '1 month')::date;
  v_custo_fixo numeric;
  v_material_pct numeric;
  v_perda numeric; v_falha numeric; v_imposto numeric; v_cartao numeric;
  v_cv numeric; v_mc numeric;
  v_meta numeric; v_realizado numeric; v_em_aberto numeric; v_backlog numeric;
BEGIN
  IF NOT public.can_see_financials(auth.uid()) THEN
    RAISE EXCEPTION 'Este número é do financeiro.' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(sum(valor), 0) INTO v_custo_fixo
  FROM public.contas_pagar WHERE vencimento >= v_ini AND vencimento < v_fim;

  SELECT COALESCE(avg(pp.custo_medio / NULLIF(pp.preco_base, 0)), 0.40) INTO v_material_pct
  FROM public.produto_precos pp JOIN public.produtos p ON p.id = pp.produto_id
  WHERE p.ativo AND pp.preco_base > 0 AND pp.custo_medio > 0;

  SELECT COALESCE(max(valor) FILTER (WHERE codigo = 'pct_perda_material'), 0) / 100,
         COALESCE(max(valor) FILTER (WHERE codigo = 'pct_falha_producao'), 0) / 100,
         COALESCE(max(valor) FILTER (WHERE codigo = 'impostos_venda'), 0) / 100,
         COALESCE(max(valor) FILTER (WHERE codigo = 'taxa_cartao'), 0) / 100
    INTO v_perda, v_falha, v_imposto, v_cartao
  FROM public.custos_tabela WHERE ativo;

  v_cv := v_material_pct * (1 + v_perda + v_falha) + v_imposto + (v_cartao / 2);
  v_mc := 1 - v_cv;
  v_meta := CASE WHEN v_mc > 0 THEN v_custo_fixo / v_mc ELSE NULL END;

  -- Quando a OS fechou. `updated_at` NÃO serve: é carimbo de última alteração,
  -- então uma OS de agosto tocada em setembro entrava no realizado de setembro,
  -- e uma de setembro tocada em outubro saía dele depois. Usa data_fechamento
  -- e, quando ela falta, o momento em que a OS entrou no status final pelo
  -- histórico — que é o carimbo que ninguém reescreve.
  SELECT COALESCE(sum(f.valor_total), 0) INTO v_realizado
  FROM public.ordens_servico os
  JOIN public.os_resultados_financeiros f ON f.os_id = os.id
  WHERE os.status IN ('faturado', 'concluido')
    AND COALESCE(os.data_fechamento,
          (SELECT max(h.mudou_em)::date FROM public.os_status_historico h
            WHERE h.os_id = os.id AND h.status_novo IN ('faturado', 'concluido')),
          os.updated_at::date) >= v_ini
    AND COALESCE(os.data_fechamento,
          (SELECT max(h.mudou_em)::date FROM public.os_status_historico h
            WHERE h.os_id = os.id AND h.status_novo IN ('faturado', 'concluido')),
          os.updated_at::date) < v_fim;

  -- Vendido e ainda não faturado, em duas medidas de propósito: o que nasceu
  -- DENTRO do mês (única que pode entrar na barra do mês sem inflar) e o
  -- backlog inteiro, que é fôlego, não progresso mensal. Somar backlog de
  -- meses anteriores à barra de outubro fazia o mês parecer adiantado.
  SELECT COALESCE(sum(f.valor_total) FILTER (WHERE os.created_at >= v_ini AND os.created_at < v_fim), 0),
         COALESCE(sum(f.valor_total), 0)
    INTO v_em_aberto, v_backlog
  FROM public.ordens_servico os
  JOIN public.os_resultados_financeiros f ON f.os_id = os.id
  WHERE os.status NOT IN ('faturado', 'concluido', 'cancelado');

  RETURN jsonb_build_object(
    'mes', v_ini, 'custo_fixo', round(v_custo_fixo, 2),
    'material_pct', round(v_material_pct * 100, 1), 'perda_pct', round(v_perda * 100, 1),
    'falha_pct', round(v_falha * 100, 1), 'imposto_pct', round(v_imposto * 100, 1),
    'cartao_pct', round(v_cartao * 100, 1), 'custo_variavel_pct', round(v_cv * 100, 1),
    'margem_contribuicao_pct', round(v_mc * 100, 1), 'meta_faturamento', round(v_meta, 2),
    'realizado', round(v_realizado, 2),
    'em_producao', round(v_em_aberto, 2),
    'backlog_total', round(v_backlog, 2),
    'falta', round(GREATEST(v_meta - v_realizado, 0), 2),
    'atingido_pct', CASE WHEN v_meta > 0 THEN round(100 * v_realizado / v_meta, 1) ELSE 0 END,
    'dias_no_mes', (v_fim - v_ini),
    'dias_corridos', LEAST(GREATEST(CURRENT_DATE - v_ini, 0), (v_fim - v_ini))
  );
END $function$;

-- ------------------------------------------------------ capacidade da oficina
-- Ocupação de cada máquina na janela. `horas_produtivas_mensais` vale para 20
-- dias úteis; a janela recebe a fatia proporcional, senão uma semana seria
-- comparada com a capacidade do mês e toda ocupação daria 25%.
CREATE OR REPLACE FUNCTION public.capacidade_das_maquinas(
  p_inicio date DEFAULT date_trunc('week', CURRENT_DATE)::date,
  p_fim date DEFAULT (date_trunc('week', CURRENT_DATE) + INTERVAL '7 days')::date
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_ini timestamptz := COALESCE(p_inicio, CURRENT_DATE)::timestamptz;
  v_fim timestamptz := COALESCE(p_fim, CURRENT_DATE + 7)::timestamptz;
  v_uteis int;
  v_ver_dinheiro boolean := public.can_see_financials(auth.uid());
  v_linhas jsonb;
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Acesso negado à capacidade.' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_uteis
  FROM generate_series(v_ini::date, (v_fim - INTERVAL '1 day')::date, '1 day') d
  WHERE extract(isodow FROM d) < 6;

  SELECT COALESCE(jsonb_agg(x ORDER BY x.ocupacao_pct DESC NULLS LAST), '[]'::jsonb) INTO v_linhas
  FROM (
    SELECT m.id AS maquina_id, m.nome, m.tipo, m.setor, m.horas_produtivas_mensais,
           round(m.horas_produtivas_mensais * (v_uteis::numeric / 20), 1) AS horas_disponiveis,
           round(COALESCE(ag.minutos_reservados, 0) / 60.0, 1) AS horas_reservadas,
           round(COALESCE(ag.minutos_reais, 0) / 60.0, 1) AS horas_realizadas,
           COALESCE(ag.reservas, 0) AS reservas, COALESCE(ag.em_producao, 0) AS em_producao,
           CASE WHEN m.horas_produtivas_mensais > 0 AND v_uteis > 0
                THEN round(100 * (COALESCE(ag.minutos_reservados, 0) / 60.0)
                     / (m.horas_produtivas_mensais * (v_uteis::numeric / 20)), 1) END AS ocupacao_pct,
           CASE WHEN v_ver_dinheiro THEN m.custo_hora END AS custo_hora,
           m.velocidade_m2_h, m.base_cobranca,
           (m.custo_hora IS NULL OR m.custo_hora = 0) AS sem_custo_hora,
           (COALESCE(m.velocidade_m2_h, 0) = 0) AS sem_velocidade
    FROM public.maquinas m
    LEFT JOIN (
      SELECT a.maquina_id,
             sum(GREATEST(COALESCE(NULLIF(a.minutos_previstos, 0),
                 EXTRACT(epoch FROM (COALESCE(a.fim_previsto, a.fim) - COALESCE(a.inicio_previsto, a.inicio))) / 60), 0)) AS minutos_reservados,
             sum(COALESCE(a.minutos_reais, 0)) AS minutos_reais,
             count(*) AS reservas,
             count(*) FILTER (WHERE a.status = 'em_producao') AS em_producao
      FROM public.maquinas_agenda a
      WHERE a.status IN ('agendado', 'em_producao', 'concluido')
        AND COALESCE(a.inicio_previsto, a.inicio) < v_fim
        AND COALESCE(a.fim_previsto, a.fim) > v_ini
      GROUP BY a.maquina_id
    ) ag ON ag.maquina_id = m.id
    WHERE m.ativa
  ) x;

  RETURN jsonb_build_object('inicio', v_ini::date, 'fim', v_fim::date, 'dias_uteis', v_uteis,
    'ver_dinheiro', v_ver_dinheiro, 'maquinas', v_linhas);
END $function$;

-- ------------------------------------------------------- onde o trabalho para
-- Cada OS viva na etapa em que está, parada desde que entrou nela. O tempo sai
-- de `os_status_historico`, não de `updated_at`, que suja a cada edição.
CREATE OR REPLACE FUNCTION public.onde_o_trabalho_para()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_etapas jsonb; v_presas jsonb; v_gargalo jsonb;
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;

  WITH atual AS (
    SELECT os.id, os.numero, os.titulo, os.status, os.prazo_entrega,
           os.responsavel_id, os.operador_id, os.designer_id, os.cliente_id,
           COALESCE((SELECT max(h.mudou_em) FROM public.os_status_historico h
                      WHERE h.os_id = os.id AND h.status_novo = os.status), os.created_at) AS entrou_em
    FROM public.ordens_servico os
    WHERE os.status NOT IN ('concluido', 'faturado', 'cancelado')
  ), com_tempo AS (
    SELECT a.*, EXTRACT(epoch FROM (now() - a.entrou_em)) / 86400.0 AS dias_parada,
           (a.prazo_entrega IS NOT NULL AND a.prazo_entrega < CURRENT_DATE) AS atrasada
    FROM atual a
  )
  SELECT
    COALESCE((SELECT jsonb_agg(e ORDER BY e.paradas DESC) FROM (
      SELECT status, count(*) AS paradas,
             round(percentile_cont(0.5) WITHIN GROUP (ORDER BY dias_parada)::numeric, 1) AS mediana_dias,
             count(*) FILTER (WHERE dias_parada > 7) AS mais_de_7_dias,
             count(*) FILTER (WHERE atrasada) AS atrasadas,
             round(max(dias_parada)::numeric, 1) AS pior_caso
      FROM com_tempo GROUP BY status) e), '[]'::jsonb),
    COALESCE((SELECT jsonb_agg(p ORDER BY p.dias_parada DESC) FROM (
      SELECT numero, titulo, status, round(dias_parada::numeric, 1) AS dias_parada,
             atrasada, prazo_entrega, id AS os_id, public.nome_do_cliente(cliente_id) AS cliente
      FROM com_tempo ORDER BY dias_parada DESC LIMIT 20) p), '[]'::jsonb)
  INTO v_etapas, v_presas;

  -- Espera com o cliente não conta como gargalo: quem destrava é de fora.
  SELECT COALESCE(to_jsonb(g), 'null'::jsonb) INTO v_gargalo FROM (
    SELECT (e->>'status') AS status, (e->>'mais_de_7_dias')::int AS travadas,
           (e->>'mediana_dias')::numeric AS mediana_dias, (e->>'atrasadas')::int AS atrasadas
    FROM jsonb_array_elements(v_etapas) e
    WHERE (e->>'status') NOT IN ('aguardando_aprovacao_arte', 'aguardando_retirada', 'aguardando_entrega')
      AND (e->>'mais_de_7_dias')::int > 0
    ORDER BY (e->>'mais_de_7_dias')::int DESC LIMIT 1) g;

  RETURN jsonb_build_object('etapas', v_etapas, 'mais_presas', v_presas, 'gargalo', v_gargalo, 'gerado_em', now());
END $function$;

-- ---------------------------------------------------------- meta por produto
-- O ranking que o comercial precisa: margem em reais por HORA DE MÁQUINA.
-- Dois produtos com a mesma margem percentual rendem diferente se um ocupa o
-- dobro do tempo da plotter, que é única.
--
-- CUIDADO COM O QUE SAI DAQUI: margem_hora e margem_pct SÃO custo disfarçado.
-- Na mesma linha vão preco_base e tempo_producao_min, então quem tiver os três
-- reconstrói o custo exato por subtração (custo = preço − R$/h × min ÷ 60).
-- Por isso os três campos de dinheiro só saem para `can_see_financials`, e
-- quem tem só preço recebe `faixa` (o terço do ranking), que orienta a venda
-- sem abrir conta nenhuma.
CREATE OR REPLACE FUNCTION public.meta_por_produto(p_mes date DEFAULT date_trunc('month', CURRENT_DATE)::date)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_ini date := date_trunc('month', COALESCE(p_mes, CURRENT_DATE))::date;
  v_fim date := (v_ini + INTERVAL '1 month')::date;
  v_ver_custo boolean := public.can_see_financials(auth.uid());
  v_linhas jsonb;
BEGIN
  IF NOT public.can_see_prices(auth.uid()) THEN
    RAISE EXCEPTION 'Preço de venda não é do seu perfil.' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(
           CASE WHEN v_ver_custo THEN to_jsonb(x)
                ELSE to_jsonb(x) - 'margem_hora' - 'margem_pct' - 'custo_medio' END
           ORDER BY x.ordem), '[]'::jsonb) INTO v_linhas
  FROM (
    SELECT p.id AS produto_id, p.nome, p.categoria, p.unidade, p.tempo_producao_min, pp.preco_base,
           CASE WHEN p.tempo_producao_min > 0 AND pp.custo_medio > 0
                THEN round((pp.preco_base - pp.custo_medio) * 60.0 / p.tempo_producao_min, 2) END AS margem_hora,
           CASE WHEN v_ver_custo THEN pp.custo_medio END AS custo_medio,
           CASE WHEN pp.preco_base > 0 AND pp.custo_medio > 0
                THEN round(100 * (pp.preco_base - pp.custo_medio) / pp.preco_base, 1) END AS margem_pct,
           -- 1 = rende mais, 2 = no meio, 3 = rende menos. Vai para todo mundo.
           CASE WHEN p.tempo_producao_min > 0 AND pp.custo_medio > 0
                THEN ntile(3) OVER (
                       PARTITION BY (p.tempo_producao_min > 0 AND pp.custo_medio > 0)
                       ORDER BY (pp.preco_base - pp.custo_medio) * 60.0 / p.tempo_producao_min DESC)
                END AS faixa,
           row_number() OVER (ORDER BY
             CASE WHEN p.tempo_producao_min > 0 AND pp.custo_medio > 0
                  THEN (pp.preco_base - pp.custo_medio) * 60.0 / p.tempo_producao_min END DESC NULLS LAST) AS ordem,
           COALESCE((SELECT sum(ic.valor_total) FROM public.itens_os i
                       JOIN public.item_os_custos ic ON ic.item_os_id = i.id
                       JOIN public.ordens_servico o ON o.id = i.os_id
                      WHERE i.produto_id = p.id AND o.status <> 'cancelado'
                        AND o.created_at >= v_ini AND o.created_at < v_fim), 0) AS vendido_no_mes,
           (p.tempo_producao_min IS NULL OR p.tempo_producao_min = 0) AS sem_tempo,
           (pp.custo_medio IS NULL OR pp.custo_medio = 0) AS sem_custo,
           p.maquina_padrao_id IS NOT NULL AS tem_maquina
    FROM public.produtos p JOIN public.produto_precos pp ON pp.produto_id = p.id
    WHERE p.ativo AND pp.preco_base > 0
  ) x;

  RETURN jsonb_build_object('mes', v_ini, 'ver_custo', v_ver_custo, 'produtos', v_linhas);
END $function$;

-- ----------------------------------------------------- capacidade das pessoas
-- O mesmo cálculo da máquina, para gente. `usuarios.horas_semanais` nasce em
-- 40 e é editável (meio período entra como 20). O trabalho da pessoa vem de
-- duas fontes e elas não podem contar duas vezes: as tarefas da OS em que ela
-- é responsável, mais as reservas de máquina em que ela é a operadora E que
-- não estão ligadas a uma tarefa (`tarefa_id IS NULL`).
ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS horas_semanais numeric NOT NULL DEFAULT 40;

COMMENT ON COLUMN public.usuarios.horas_semanais IS 'Horas de trabalho por semana desta pessoa. É o denominador da ocupação dela. Padrão 40 h; meio período entra como 20.';

CREATE OR REPLACE FUNCTION public.capacidade_das_pessoas(
  p_inicio date DEFAULT date_trunc('week', CURRENT_DATE)::date,
  p_fim date DEFAULT (date_trunc('week', CURRENT_DATE) + INTERVAL '7 days')::date
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_ini timestamptz := COALESCE(p_inicio, CURRENT_DATE)::timestamptz;
  v_fim timestamptz := COALESCE(p_fim, CURRENT_DATE + 7)::timestamptz;
  v_uteis int; v_linhas jsonb;
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Acesso negado à capacidade.' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_uteis
  FROM generate_series(v_ini::date, (v_fim - INTERVAL '1 day')::date, '1 day') d
  WHERE extract(isodow FROM d) < 6;

  SELECT COALESCE(jsonb_agg(x ORDER BY x.ocupacao_pct DESC NULLS LAST), '[]'::jsonb) INTO v_linhas
  FROM (
    SELECT u.id AS usuario_id, u.nome, u.cargo_pretendido AS cargo,
           (SELECT string_agg(r.role::text, '+') FROM public.user_roles r WHERE r.user_id = u.id) AS papeis,
           u.horas_semanais,
           round(u.horas_semanais * (v_uteis::numeric / 5), 1) AS horas_disponiveis,
           round((COALESCE(t.min_previstos, 0) + COALESCE(a.min_previstos, 0)) / 60.0, 1) AS horas_reservadas,
           round((COALESCE(t.min_reais, 0) + COALESCE(ap.min_reais, 0)) / 60.0, 1) AS horas_realizadas,
           COALESCE(t.tarefas, 0) AS tarefas_abertas,
           COALESCE(t.atrasadas, 0) AS tarefas_atrasadas,
           COALESCE(a.reservas, 0) AS reservas_de_maquina,
           CASE WHEN u.horas_semanais > 0 AND v_uteis > 0
                THEN round(100 * ((COALESCE(t.min_previstos, 0) + COALESCE(a.min_previstos, 0)) / 60.0)
                     / (u.horas_semanais * (v_uteis::numeric / 5)), 1) END AS ocupacao_pct
    FROM public.usuarios u
    LEFT JOIN (
      SELECT responsavel_id AS uid,
             sum(COALESCE(minutos_previstos, 0)) AS min_previstos,
             sum(COALESCE(minutos_realizados, 0)) AS min_reais,
             count(*) FILTER (WHERE status <> 'concluida') AS tarefas,
             count(*) FILTER (WHERE prazo IS NOT NULL AND prazo < CURRENT_DATE AND status <> 'concluida') AS atrasadas
      FROM public.os_tarefas
      WHERE COALESCE(inicio_previsto, created_at) < v_fim
        AND COALESCE(fim_previsto, inicio_previsto, created_at) > v_ini
      GROUP BY responsavel_id
    ) t ON t.uid = u.id
    LEFT JOIN (
      SELECT operador_id AS uid, sum(COALESCE(minutos_previstos, 0)) AS min_previstos, count(*) AS reservas
      FROM public.maquinas_agenda
      WHERE status IN ('agendado', 'em_producao', 'concluido') AND tarefa_id IS NULL
        AND COALESCE(inicio_previsto, inicio) < v_fim AND COALESCE(fim_previsto, fim) > v_ini
      GROUP BY operador_id
    ) a ON a.uid = u.id
    LEFT JOIN (
      SELECT operador_id AS uid,
             sum(GREATEST(EXTRACT(epoch FROM (COALESCE(finalizado_em, now()) - iniciado_em)) / 60, 0)) AS min_reais
      FROM public.apontamentos_producao
      WHERE iniciado_em < v_fim AND COALESCE(finalizado_em, now()) > v_ini
      GROUP BY operador_id
    ) ap ON ap.uid = u.id
    WHERE u.ativo AND public.is_staff(u.id)
  ) x;

  RETURN jsonb_build_object('inicio', v_ini::date, 'fim', v_fim::date, 'dias_uteis', v_uteis, 'pessoas', v_linhas);
END $function$;

-- --------------------------------------------- achar buraco livre na máquina
-- Caminha dia útil a dia útil dentro da janela 8h–18h do Amapá (UTC-3 o ano
-- inteiro) e devolve o primeiro horário em que cabe o serviço inteiro.
CREATE OR REPLACE FUNCTION public.proximo_horario_livre(
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
  -- Guarda: a ocupação da máquina é informação da oficina, não do mundo.
  IF NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';
  END IF;
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

-- ------------------------------------------- a tarefa nasce na agenda sozinha
-- Para cada item da OS: pega a máquina padrão do produto, calcula o tempo
-- (pela velocidade da máquina quando a peça é por área, senão pelo tempo do
-- produto), soma setup, acha o primeiro buraco livre e reserva. O que não dá
-- para agendar volta em `puladas` com o motivo, em vez de sumir.
CREATE OR REPLACE FUNCTION public.agendar_os_na_maquina(p_os_id uuid, p_a_partir_de timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_os public.ordens_servico%ROWTYPE;
  r RECORD; v_min int; v_inicio timestamptz; v_cursor timestamptz := p_a_partir_de;
  v_criadas int := 0; v_puladas jsonb := '[]'::jsonb; v_reservas jsonb := '[]'::jsonb; v_id uuid;
BEGIN
  IF NOT public.has_permission(auth.uid(), 'kanban.move')
     AND NOT public.has_permission(auth.uid(), 'os.update') THEN
    RAISE EXCEPTION 'Você não pode agendar produção.' USING ERRCODE = '42501';
  END IF;

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
    v_inicio := public.proximo_horario_livre(r.maquina_id, v_min, v_cursor);

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

REVOKE ALL ON FUNCTION public.ponto_de_equilibrio(date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.capacidade_das_maquinas(date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.capacidade_das_pessoas(date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.onde_o_trabalho_para() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.meta_por_produto(date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.proximo_horario_livre(uuid, int, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.agendar_os_na_maquina(uuid, timestamptz) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.ponto_de_equilibrio(date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.capacidade_das_maquinas(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.capacidade_das_pessoas(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.onde_o_trabalho_para() TO authenticated;
GRANT EXECUTE ON FUNCTION public.meta_por_produto(date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.proximo_horario_livre(uuid, int, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.agendar_os_na_maquina(uuid, timestamptz) TO authenticated;

-- Função de gatilho não é para ser chamada por ninguém: o Postgres a executa
-- sozinho. Sem este REVOKE ela nasce com EXECUTE para PUBLIC e anon, que é o
-- padrão do Postgres e o furo que a auditoria de RPC sem guarda pega.
REVOKE ALL ON FUNCTION public.tg_os_status_historico() FROM PUBLIC, anon, authenticated;
