-- AINDA NÃO APLICADA. O dono ensaia (docs/ensaio-triagem-dados.md) e aplica; depois troca esta linha por "APLICADA em <data>".
-- ORDEM: depois da 20261113130000_triagem_dados.sql e antes da 20261113132000_triagem_estado_e_envio.sql.
--
-- ATENÇÃO, UM GATILHO DESTA MIGRAÇÃO FAZ TRABALHO DE VERDADE: tg_whatsapp_config_sincroniza_horario fica em
-- whatsapp_configuracoes e, quando alguém salva na tela antiga de configuração um horário de início, de fim ou dias da
-- semana diferentes dos que estavam, ele REESCREVE os 7 dias de whatsapp_horarios_atendimento com o que a tela mandou.
-- Salvar sem mexer no horário, ou com valores iguais, não toca na tabela nova. Ele existe até o PR B5 removê-lo. Ele nunca
-- trava o salvamento da tela: qualquer erro dentro dele vira RAISE WARNING no log do banco e o salvamento segue.
--
-- HORÁRIO DE ATENDIMENTO, UMA ÚNICA PORTA (Bex Print, Onda B, B3)
--
-- O QUE CRIA
--  1. whatsapp_horarios_atendimento: um registro por dia da semana (0 = domingo a 6 = sábado) com abre, fecha e ativo.
--     Semeada UMA vez a partir das colunas antigas de whatsapp_configuracoes (horario_inicio, horario_fim, dias_semana),
--     então o horário real de hoje (segunda a sexta, 8h às 18h) é copiado, sábado e domingo ficam inativos até o dono
--     decidir.
--  2. whatsapp_feriados: data, nome, fechado (ou horário próprio). Criada porque NÃO existe nenhuma tabela de feriado
--     ou horário no banco vivo (conferido em 13/11/2026 por consulta ao catálogo).
--  3. whatsapp_dentro_do_horario(momento): no fuso America/Belem, a mesma regra de dentroDoHorario em
--     src/domain/whatsapp/triagem/horario.ts e em src/domain/whatsapp/assistente.ts: abre inclusive, fecha exclusivo,
--     feriado fechado ou com horário próprio vence a semana.
--  4. whatsapp_horario_em_texto(): devolve { abre, fecha, dias } em palavras ("8h", "18h", "de segunda a sexta"),
--     as variáveis dos textos da triagem. Dias com horários diferentes são agrupados por horário (o grupo maior vira
--     abre e fecha, os outros entram em dias), para o texto nunca dar a um dia o horário de outro.
--  5. whatsapp_horario_salvar e whatsapp_feriado_salvar: a escrita, só service_role, com a permissão de quem pediu
--     conferida dentro (whatsapp.manage ou configuracoes.manage).
--
-- O QUE NÃO MUDA (retrocompatível)
--  * A assistente existente continua lendo as colunas antigas de whatsapp_configuracoes pelo TypeScript
--    (assistente.ts, dentroDoHorario). NENHUMA função viva é alterada: whatsapp_salvar_configuracoes, que a tela de
--    configuração do WhatsApp chama hoje, fica como está.
--  * A seção 2.3 do projeto manda a assistente passar a ler a função nova. Isso é TypeScript e fica para o PR B5.
--    Até lá, para o horário nunca divergir, um gatilho TEMPORÁRIO copia as colunas antigas para a tabela nova quando
--    elas MUDAM de verdade (IS DISTINCT FROM: salvar a configuração sem mexer no horário não toca a tabela nova).
--    O gatilho some no B5, quando a leitura do TypeScript passar para a função. Se o dono editar dia a dia na tabela
--    nova antes disso e depois mexer na tela antiga, a tela antiga ganha: é o risco declarado no PR. Exemplo medido no
--    ensaio local: sábado editado na tabela nova (9h às 12h) volta a ser o que a tela antiga manda (8h às 17h) no
--    primeiro salvamento da tela antiga que mudar o horário. Ou seja, aplicar esta migração NÃO é "sem comportamento
--    novo" neste ponto: a tela antiga passa a escrever também na tabela nova (só quando o horário muda).
--  * A conferência no fim compara a função nova com a regra antiga em 49 momentos da semana. Se não bater, desfaz.
--
-- LIÇÕES APLICADAS
--  * REVOKE de PUBLIC não fecha o anon: revoga de PUBLIC, anon e authenticated pelo nome e só depois concede.
--  * O fuso é sempre America/Belem (sem horário de verão desde 2019), nunca o do servidor.

BEGIN;

DO $pre$
BEGIN
  IF to_regclass('public.whatsapp_configuracoes') IS NULL THEN
    RAISE EXCEPTION 'whatsapp_configuracoes não existe';
  END IF;
  IF to_regclass('public.whatsapp_horarios_atendimento') IS NOT NULL OR to_regclass('public.whatsapp_feriados') IS NOT NULL THEN
    RAISE EXCEPTION 'as tabelas de horário já existem: reaproveite e adapte a função, não reaplique esta migração';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'
               AND relname ~* '(feriad|expedient|calendario)') THEN
    RAISE EXCEPTION 'já existe uma tabela de feriado ou calendário: reaproveite em vez de criar outra';
  END IF;
  IF to_regprocedure('public.has_permission(uuid, text)') IS NULL OR to_regprocedure('public.is_staff(uuid)') IS NULL THEN
    RAISE EXCEPTION 'faltam has_permission e is_staff';
  END IF;
END
$pre$;

-- 1. Tabelas ---------------------------------------------------------------------------------------------------------
CREATE TABLE public.whatsapp_horarios_atendimento (
  dia_semana smallint PRIMARY KEY CHECK (dia_semana BETWEEN 0 AND 6),
  abre time NOT NULL DEFAULT '08:00',
  fecha time NOT NULL DEFAULT '18:00',
  ativo boolean NOT NULL DEFAULT false,
  atualizado_por uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT horarios_fecha_depois_de_abrir CHECK (fecha > abre)
);
COMMENT ON TABLE public.whatsapp_horarios_atendimento IS
  'Atendimento presencial por dia da semana, 0 = domingo. Fonte única do horário (triagem e, a partir do B5, a assistente).';

CREATE TABLE public.whatsapp_feriados (
  data date PRIMARY KEY,
  nome text NOT NULL CHECK (btrim(nome) <> ''),
  fechado boolean NOT NULL DEFAULT true,
  abre time,
  fecha time,
  atualizado_por uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT feriado_horario_proprio CHECK (fechado OR (abre IS NOT NULL AND fecha IS NOT NULL AND fecha > abre))
);

-- Semente única, a partir do que o dono já tem na tela antiga. Legado com fim <= início nunca ficava dentro do horário:
-- vira "sem dia ativo", que dá o mesmo resultado.
INSERT INTO public.whatsapp_horarios_atendimento (dia_semana, abre, fecha, ativo)
SELECT d,
       CASE WHEN c.horario_fim > c.horario_inicio THEN c.horario_inicio ELSE time '08:00' END,
       CASE WHEN c.horario_fim > c.horario_inicio THEN c.horario_fim ELSE time '18:00' END,
       (c.horario_fim > c.horario_inicio) AND ((CASE WHEN d = 0 THEN 7 ELSE d END) = ANY (c.dias_semana))
  FROM generate_series(0, 6) AS d
  CROSS JOIN (SELECT horario_inicio, horario_fim, dias_semana FROM public.whatsapp_configuracoes ORDER BY id DESC LIMIT 1) AS c;

-- Se a configuração antiga não tinha linha, semeia o horário que o dono descreveu: segunda a sexta, 8h às 18h.
INSERT INTO public.whatsapp_horarios_atendimento (dia_semana, abre, fecha, ativo)
SELECT d, time '08:00', time '18:00', d BETWEEN 1 AND 5
  FROM generate_series(0, 6) AS d
 WHERE NOT EXISTS (SELECT 1 FROM public.whatsapp_horarios_atendimento);

-- 2. RLS e GRANTs ----------------------------------------------------------------------------------------------------
ALTER TABLE public.whatsapp_horarios_atendimento ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_feriados ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_horarios_atendimento FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.whatsapp_feriados FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.whatsapp_horarios_atendimento TO authenticated;
GRANT SELECT ON public.whatsapp_feriados TO authenticated;
GRANT ALL ON public.whatsapp_horarios_atendimento TO service_role;
GRANT ALL ON public.whatsapp_feriados TO service_role;

CREATE POLICY "whatsapp_horarios leitura equipe" ON public.whatsapp_horarios_atendimento
  FOR SELECT TO authenticated
  USING (public.is_staff((SELECT auth.uid()))
         AND (public.has_permission((SELECT auth.uid()), 'whatsapp.read')
              OR public.has_permission((SELECT auth.uid()), 'configuracoes.manage')));
CREATE POLICY "whatsapp_feriados leitura equipe" ON public.whatsapp_feriados
  FOR SELECT TO authenticated
  USING (public.is_staff((SELECT auth.uid()))
         AND (public.has_permission((SELECT auth.uid()), 'whatsapp.read')
              OR public.has_permission((SELECT auth.uid()), 'configuracoes.manage')));

-- 3. A porta única ---------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.whatsapp_dentro_do_horario(p_momento timestamptz DEFAULT now())
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_local timestamp := p_momento AT TIME ZONE 'America/Belem';
  v_data date := v_local::date;
  v_dow integer := extract(dow FROM v_local)::integer;
  v_hora time := v_local::time;
  f public.whatsapp_feriados%ROWTYPE;
  h public.whatsapp_horarios_atendimento%ROWTYPE;
BEGIN
  IF p_momento IS NULL THEN
    RETURN false;
  END IF;
  SELECT * INTO f FROM public.whatsapp_feriados WHERE data = v_data;
  IF FOUND THEN
    IF f.fechado THEN
      RETURN false;
    END IF;
    RETURN v_hora >= f.abre AND v_hora < f.fecha;
  END IF;
  SELECT * INTO h FROM public.whatsapp_horarios_atendimento WHERE dia_semana = v_dow;
  IF NOT FOUND OR NOT h.ativo THEN
    RETURN false;
  END IF;
  RETURN v_hora >= h.abre AND v_hora < h.fecha;
END $function$;

-- "8h" ou "8h30".
CREATE OR REPLACE FUNCTION public._whatsapp_hora_em_texto(p_hora time)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT extract(hour FROM p_hora)::integer::text || 'h'
         || CASE WHEN extract(minute FROM p_hora)::integer = 0 THEN ''
                 ELSE lpad(extract(minute FROM p_hora)::integer::text, 2, '0') END
$function$;

-- "de segunda a sexta", "segunda, quarta e sexta", "às segundas": o mesmo texto de diasEmTexto em horario.ts.
CREATE OR REPLACE FUNCTION public._whatsapp_dias_em_texto(p_dias integer[])
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_nomes constant text[] := ARRAY['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  v_ord integer[];
  v_n integer;
  v_seguidos boolean := true;
  i integer;
  v_lista text[] := '{}';
BEGIN
  SELECT coalesce(array_agg(DISTINCT d ORDER BY d), '{}'::integer[]) INTO v_ord FROM unnest(p_dias) AS d;
  v_n := coalesce(array_length(v_ord, 1), 0);
  IF v_n = 0 THEN
    RETURN '';
  END IF;
  IF v_n = 1 THEN
    RETURN CASE v_ord[1] WHEN 6 THEN 'aos sábados' WHEN 0 THEN 'aos domingos'
                         ELSE 'às ' || v_nomes[v_ord[1] + 1] || 's' END;
  END IF;
  FOR i IN 2..v_n LOOP
    IF v_ord[i] <> v_ord[i - 1] + 1 THEN
      v_seguidos := false;
    END IF;
  END LOOP;
  IF v_seguidos THEN
    RETURN 'de ' || v_nomes[v_ord[1] + 1] || ' a ' || v_nomes[v_ord[v_n] + 1];
  END IF;
  FOR i IN 1..v_n LOOP
    v_lista := array_append(v_lista, v_nomes[v_ord[i] + 1]);
  END LOOP;
  RETURN array_to_string(v_lista[1:v_n - 1], ', ') || ' e ' || v_lista[v_n];
END $function$;

-- As variáveis abre, fecha e dias. Nulo se nenhum dia está ativo.
-- Dias ativos com horários diferentes são AGRUPADOS por horário: abre e fecha são os do grupo com mais dias (empate: o que
-- tem dia útil, depois o que começa mais cedo na semana) e os outros grupos entram em dias, para o texto nunca dizer ao
-- cliente que o sábado abre às 8h e fecha às 18h quando o sábado fecha ao meio-dia. Exemplo:
--   {abre: "8h", fecha: "18h", dias: "de segunda a sexta, e aos sábados das 8h às 12h"}
-- Com um grupo só (o caso de hoje) a saída é a mesma de antes. Espelho: horarioEmTexto em horario.ts.
CREATE OR REPLACE FUNCTION public.whatsapp_horario_em_texto()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_prim record;
  v_g record;
  v_extra text := '';
BEGIN
  SELECT h.abre, h.fecha, array_agg(h.dia_semana::integer ORDER BY h.dia_semana) AS dias INTO v_prim
    FROM public.whatsapp_horarios_atendimento h
   WHERE h.ativo
   GROUP BY h.abre, h.fecha
   ORDER BY count(*) DESC, bool_or(h.dia_semana BETWEEN 1 AND 5) DESC, min(h.dia_semana)
   LIMIT 1;
  IF v_prim.dias IS NULL THEN
    RETURN NULL;
  END IF;
  FOR v_g IN
    SELECT h.abre, h.fecha, array_agg(h.dia_semana::integer ORDER BY h.dia_semana) AS dias
      FROM public.whatsapp_horarios_atendimento h
     WHERE h.ativo AND NOT (h.abre = v_prim.abre AND h.fecha = v_prim.fecha)
     GROUP BY h.abre, h.fecha
     ORDER BY min(h.dia_semana)
  LOOP
    v_extra := v_extra || ', e ' || public._whatsapp_dias_em_texto(v_g.dias)
               || ' das ' || public._whatsapp_hora_em_texto(v_g.abre) || ' às ' || public._whatsapp_hora_em_texto(v_g.fecha);
  END LOOP;
  RETURN jsonb_build_object(
    'abre', public._whatsapp_hora_em_texto(v_prim.abre),
    'fecha', public._whatsapp_hora_em_texto(v_prim.fecha),
    'dias', public._whatsapp_dias_em_texto(v_prim.dias) || v_extra);
END $function$;

-- 4. Escrita ---------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.whatsapp_horario_salvar(p_usuario uuid, p_dia integer, p_abre time, p_fecha time, p_ativo boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_usuario IS NULL OR NOT (public.has_permission(p_usuario, 'whatsapp.manage')
                               OR public.has_permission(p_usuario, 'configuracoes.manage')) THEN
    RAISE EXCEPTION 'Mudar o horário de atendimento exige a permissão whatsapp.manage ou configuracoes.manage.';
  END IF;
  IF p_dia IS NULL OR p_dia NOT BETWEEN 0 AND 6 THEN
    RAISE EXCEPTION 'Dia da semana inválido: use 0 (domingo) a 6 (sábado).';
  END IF;
  IF p_abre IS NULL OR p_fecha IS NULL OR p_fecha <= p_abre THEN
    RAISE EXCEPTION 'A hora de fechar precisa ser depois da hora de abrir.';
  END IF;
  UPDATE public.whatsapp_horarios_atendimento
     SET abre = p_abre, fecha = p_fecha, ativo = coalesce(p_ativo, ativo), atualizado_por = p_usuario, atualizado_em = now()
   WHERE dia_semana = p_dia;
  RETURN jsonb_build_object('ok', true, 'dia', p_dia, 'horario', public.whatsapp_horario_em_texto());
END $function$;

CREATE OR REPLACE FUNCTION public.whatsapp_feriado_salvar(
  p_usuario uuid, p_data date, p_nome text, p_fechado boolean DEFAULT true,
  p_abre time DEFAULT NULL, p_fecha time DEFAULT NULL, p_remover boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_usuario IS NULL OR NOT (public.has_permission(p_usuario, 'whatsapp.manage')
                               OR public.has_permission(p_usuario, 'configuracoes.manage')) THEN
    RAISE EXCEPTION 'Mudar os feriados exige a permissão whatsapp.manage ou configuracoes.manage.';
  END IF;
  IF p_data IS NULL THEN
    RAISE EXCEPTION 'Informe a data do feriado.';
  END IF;
  IF coalesce(p_remover, false) THEN
    DELETE FROM public.whatsapp_feriados WHERE data = p_data;
    RETURN jsonb_build_object('ok', true, 'removido', FOUND, 'data', p_data);
  END IF;
  IF nullif(btrim(coalesce(p_nome, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Dê um nome ao feriado.';
  END IF;
  INSERT INTO public.whatsapp_feriados (data, nome, fechado, abre, fecha, atualizado_por)
  VALUES (p_data, btrim(p_nome), coalesce(p_fechado, true),
          CASE WHEN coalesce(p_fechado, true) THEN NULL ELSE p_abre END,
          CASE WHEN coalesce(p_fechado, true) THEN NULL ELSE p_fecha END, p_usuario)
  ON CONFLICT (data) DO UPDATE
    SET nome = EXCLUDED.nome, fechado = EXCLUDED.fechado, abre = EXCLUDED.abre, fecha = EXCLUDED.fecha,
        atualizado_por = EXCLUDED.atualizado_por, atualizado_em = now();
  RETURN jsonb_build_object('ok', true, 'data', p_data);
END $function$;

-- 5. Gatilho TEMPORÁRIO: a tela antiga continua mandando, a tabela nova acompanha -----------------------------------------
CREATE OR REPLACE FUNCTION public.tg_whatsapp_config_sincroniza_horario()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_valido boolean := NEW.horario_fim > NEW.horario_inicio;
BEGIN
  -- Este gatilho FAZ TRABALHO (copia o horário da tela antiga para a tabela nova quando as colunas mudam) e roda dentro do
  -- salvamento da tela de configuração. Se falhar um dia, o aviso vai para o log do banco e o salvamento da tela NÃO trava:
  -- a tabela nova fica com o horário anterior até o próximo salvamento. A tela antiga continua sendo a fonte da assistente.
  BEGIN
    UPDATE public.whatsapp_horarios_atendimento h
       SET abre = CASE WHEN v_valido THEN NEW.horario_inicio ELSE h.abre END,
           fecha = CASE WHEN v_valido THEN NEW.horario_fim ELSE h.fecha END,
           ativo = v_valido AND ((CASE WHEN h.dia_semana = 0 THEN 7 ELSE h.dia_semana END) = ANY (NEW.dias_semana)),
           atualizado_em = now()
     WHERE h.dia_semana BETWEEN 0 AND 6;  -- o banco vivo carrega safeupdate: UPDATE sem WHERE seria barrado
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'tg_whatsapp_config_sincroniza_horario falhou, o salvamento segue: % [%]', SQLERRM, SQLSTATE;
  END;
  RETURN NULL;
END $function$;

CREATE TRIGGER tg_whatsapp_config_sincroniza_horario
  AFTER UPDATE ON public.whatsapp_configuracoes
  FOR EACH ROW
  WHEN (OLD.horario_inicio IS DISTINCT FROM NEW.horario_inicio
        OR OLD.horario_fim IS DISTINCT FROM NEW.horario_fim
        OR OLD.dias_semana IS DISTINCT FROM NEW.dias_semana)
  EXECUTE FUNCTION public.tg_whatsapp_config_sincroniza_horario();

-- 6. ACL -------------------------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.whatsapp_dentro_do_horario(timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._whatsapp_hora_em_texto(time) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._whatsapp_dias_em_texto(integer[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.whatsapp_horario_em_texto() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.whatsapp_horario_salvar(uuid, integer, time, time, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.whatsapp_feriado_salvar(uuid, date, text, boolean, time, time, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_whatsapp_config_sincroniza_horario() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_dentro_do_horario(timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public._whatsapp_hora_em_texto(time) TO service_role;
GRANT EXECUTE ON FUNCTION public._whatsapp_dias_em_texto(integer[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.whatsapp_horario_em_texto() TO service_role;
GRANT EXECUTE ON FUNCTION public.whatsapp_horario_salvar(uuid, integer, time, time, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.whatsapp_feriado_salvar(uuid, date, text, boolean, time, time, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.tg_whatsapp_config_sincroniza_horario() TO service_role;

-- 7. Conferência ----------------------------------------------------------------------------------------------------
DO $conferencia$
DECLARE
  v_n integer;
  v_t text;
  v_f text;
  v_dia date;
  v_min text;
  v_momento timestamptz;
  v_antigo boolean;
  v_novo boolean;
  v_cfg record;
  v_txt jsonb;
  v_comparados integer := 0;
BEGIN
  FOREACH v_t IN ARRAY ARRAY['public.whatsapp_horarios_atendimento', 'public.whatsapp_feriados'] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = v_t::regclass) THEN
      RAISE EXCEPTION 'RLS desligada em %', v_t;
    END IF;
    IF has_table_privilege('anon', v_t, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
      RAISE EXCEPTION 'anon tem privilégio em %', v_t;
    END IF;
    IF has_table_privilege('authenticated', v_t, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       OR NOT has_table_privilege('authenticated', v_t, 'SELECT') THEN
      RAISE EXCEPTION 'authenticated deve só ler %', v_t;
    END IF;
    SELECT count(*) INTO v_n FROM pg_policies WHERE schemaname = 'public' AND tablename = split_part(v_t, '.', 2) AND cmd = 'SELECT';
    IF v_n <> 1 OR EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = split_part(v_t, '.', 2) AND cmd <> 'SELECT') THEN
      RAISE EXCEPTION '% deve ter só a política de leitura', v_t;
    END IF;
  END LOOP;

  FOREACH v_f IN ARRAY ARRAY['whatsapp_dentro_do_horario', '_whatsapp_hora_em_texto', '_whatsapp_dias_em_texto',
                             'whatsapp_horario_em_texto', 'whatsapp_horario_salvar', 'whatsapp_feriado_salvar',
                             'tg_whatsapp_config_sincroniza_horario'] LOOP
    SELECT count(*) INTO v_n FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = v_f;
    IF v_n <> 1 THEN RAISE EXCEPTION '% tem % versões (esperado 1)', v_f, v_n; END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = v_f
                  AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))) THEN
      RAISE EXCEPTION 'anon ou authenticated executa %', v_f;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = v_f
                      AND has_function_privilege('service_role', p.oid, 'EXECUTE')) THEN
      RAISE EXCEPTION 'service_role perdeu o EXECUTE de %', v_f;
    END IF;
  END LOOP;

  SELECT count(*) INTO v_n FROM public.whatsapp_horarios_atendimento;
  IF v_n <> 7 THEN RAISE EXCEPTION 'horários: % de 7 dias', v_n; END IF;

  -- a função nova dá a mesma resposta que a regra antiga (colunas de whatsapp_configuracoes) em 49 momentos da semana
  SELECT horario_inicio, horario_fim, dias_semana INTO v_cfg FROM public.whatsapp_configuracoes ORDER BY id DESC LIMIT 1;
  IF v_cfg.horario_inicio IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.whatsapp_feriados) THEN
    FOR v_dia IN SELECT d::date FROM generate_series(date '2026-11-16', date '2026-11-22', interval '1 day') AS d LOOP
      FOREACH v_min IN ARRAY ARRAY['00:00', '07:59', '08:00', '12:00', '17:59', '18:00', '23:59'] LOOP
        v_momento := (v_dia::text || ' ' || v_min)::timestamp AT TIME ZONE 'America/Belem';
        v_antigo := extract(isodow FROM (v_momento AT TIME ZONE 'America/Belem'))::integer = ANY (v_cfg.dias_semana)
                    AND (v_momento AT TIME ZONE 'America/Belem')::time >= v_cfg.horario_inicio
                    AND (v_momento AT TIME ZONE 'America/Belem')::time < v_cfg.horario_fim;
        v_novo := public.whatsapp_dentro_do_horario(v_momento);
        IF v_antigo IS DISTINCT FROM v_novo THEN
          RAISE EXCEPTION 'a função nova diverge da regra antiga em % %: antiga %, nova %', v_dia, v_min, v_antigo, v_novo;
        END IF;
        v_comparados := v_comparados + 1;
      END LOOP;
    END LOOP;
    IF v_comparados <> 49 THEN RAISE EXCEPTION 'comparou % momentos, esperava 49', v_comparados; END IF;
  END IF;

  -- o texto do horário sai da tabela
  v_txt := public.whatsapp_horario_em_texto();
  IF v_txt IS NULL OR v_txt ->> 'abre' IS NULL OR v_txt ->> 'fecha' IS NULL OR v_txt ->> 'dias' IS NULL THEN
    RAISE EXCEPTION 'whatsapp_horario_em_texto devolveu %', v_txt;
  END IF;
  IF public._whatsapp_dias_em_texto(ARRAY[1, 2, 3, 4, 5]) <> 'de segunda a sexta'
     OR public._whatsapp_dias_em_texto(ARRAY[1, 3, 5]) <> 'segunda, quarta e sexta'
     OR public._whatsapp_dias_em_texto(ARRAY[6]) <> 'aos sábados'
     OR public._whatsapp_dias_em_texto(ARRAY[1, 2, 3, 4, 5, 6]) <> 'de segunda a sábado'
     OR public._whatsapp_hora_em_texto(time '08:00') <> '8h'
     OR public._whatsapp_hora_em_texto(time '12:30') <> '12h30' THEN
    RAISE EXCEPTION 'o texto de dias ou de horas saiu diferente do TypeScript';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.whatsapp_configuracoes'::regclass
                  AND tgname = 'tg_whatsapp_config_sincroniza_horario' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'gatilho de sincronização não existe';
  END IF;
  -- o gatilho faz trabalho dentro do salvamento da tela: nunca pode travar o salvamento
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace
                    AND proname = 'tg_whatsapp_config_sincroniza_horario'
                    AND prosrc ~ 'EXCEPTION WHEN OTHERS' AND prosrc ~ 'RAISE WARNING') THEN
    RAISE EXCEPTION 'o gatilho de sincronização precisa capturar erro e virar aviso, sem travar o salvamento da tela';
  END IF;
  -- a função viva que a tela antiga chama não foi tocada
  IF EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace
                AND proname = 'whatsapp_salvar_configuracoes' AND prosrc ~ 'whatsapp_horarios_atendimento') THEN
    RAISE EXCEPTION 'whatsapp_salvar_configuracoes não deveria conhecer a tabela nova';
  END IF;
END
$conferencia$;

COMMIT;
