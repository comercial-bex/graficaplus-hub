-- =====================================================================================================
-- A EPSON ECOTANK A4 VIRA IMPRESSORA DE PRODUÇÃO, E A TV AGRUPA AS DUAS IMPRESSORAS NUMA COLUNA (19/11/2026)
--
-- O achado (16/11/2026, conferindo a TV da Oficina). A "Epson EcoTank L3250 (A4)" está ativa, com o tipo em texto
-- livre "Impressão jato de tinta A4", que não existe em tipos_de_maquina(). Resultado:
--   * ninguém consegue "Começar nesta máquina" nela nem pô-la na fila da OS: comecar_na_maquina e
--     definir_maquina_da_os recusam com "tipo que ainda não tem etapa de produção";
--   * a TV da Oficina contava seis colunas numa parede desenhada para cinco, e a conferência R6 acusava.
--
-- Ela NÃO pode ser desativada (a alternativa que o dono podia escolher): é a máquina padrão do produto ativo
-- "Certificado A4 papel texturizado vergê 180g" e a OS 232, que leva esse produto, tem a reserva dela na agenda.
-- Desativar deixaria essa OS sem máquina. A máquina é real e está em uso; faltava o cadastro dizer o que ela é.
--
-- O que esta migração faz:
-- 1) tipos_de_maquina() ganha 'impressora_a4', na MESMA etapa da plotter (em_impressao, etapa "Impressão"), logo
--    depois dela. As ordens são renumeradas de 1 a 6 só para a Epson ficar ao lado da plotter nas listas de máquina;
--    não existe `ordem` gravada em nenhuma tabela. O tipo da plotter NÃO é reaproveitado: a tela de importar Flexi
--    lista as máquinas de plotter_impressao, e a Epson não é Flexi.
-- 2) A Epson passa do texto livre para o tipo 'impressora_a4'. O texto antigo fica em especificacoes.tipo_anterior.
-- 3) A R6 da TV conta colunas da PAREDE: as impressoras 3D (em_3d) já dividiam uma coluna; agora as de impressão
--    (em_impressao: a plotter e a Epson) dividem outra. A tela agrupa do mesmo jeito (src/domain/tv/tela.ts,
--    organizarParede). Com isso a parede continua com cinco colunas e a legenda do quadro continua com cinco itens.
--    A função é alterada pelo mesmo caminho das migrações 20261028400000 e 20261030910000: o texto vivo, uma troca
--    que tem de achar o trecho uma vez só, e EXECUTE.
--
-- O que muda de comportamento, dito às claras. Com duas impressoras na etapa, o status em_impressao deixa de
-- identificar UMA máquina (como em_laser_cnc, com os dois lasers). Uma OS em em_impressao sem máquina gravada, sem
-- apontamento, sem reserva e sem máquina padrão no produto passa a aparecer em "sem máquina" na TV, em vez de ser
-- posta na plotter por palpite. Em 19/11/2026 nenhuma OS estava em em_impressao. As OS com máquina gravada, com
-- apontamento, com reserva ou com a máquina padrão do produto (a Plotter nas lonas e adesivos, a Epson no certificado)
-- continuam onde estavam.
--
-- Nenhum preço, custo ou orçamento muda. Ensaio no banco vivo, com RAISE EXCEPTION final:
-- docs/ensaio-epson-a4-impressora-de-producao-19-11-2026.md.
-- =====================================================================================================
BEGIN;
SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------------------------------
-- 0. As funções que vamos trocar são as que o banco tem hoje, e a Epson está como foi lida.
-- ---------------------------------------------------------------------------------------------------
DO $guarda$
DECLARE
  v_h text;
  v_tipo text;
BEGIN
  SELECT md5(prosrc) INTO v_h FROM pg_proc
   WHERE pronamespace = 'public'::regnamespace AND proname = 'tipos_de_maquina';
  IF v_h IS DISTINCT FROM '7f0504c31265408dd5dad767ff6980ba' THEN
    RAISE EXCEPTION 'tipos_de_maquina mudou no banco (md5 %). Releia a definição viva antes de trocar.', v_h;
  END IF;

  SELECT md5(prosrc) INTO v_h FROM pg_proc
   WHERE pronamespace = 'public'::regnamespace AND proname = 'tv_painel_maquinas';
  IF v_h IS DISTINCT FROM '0b4c9dc00c71f34f583ff645d31d2160' THEN
    RAISE EXCEPTION 'tv_painel_maquinas mudou no banco (md5 %). Releia a definição viva antes de trocar.', v_h;
  END IF;

  SELECT tipo INTO v_tipo FROM public.maquinas WHERE id = 'eb76a98b-8555-4a5b-b0ab-00c3a22e6c95';
  IF v_tipo IS DISTINCT FROM 'Impressão jato de tinta A4' THEN
    RAISE EXCEPTION 'A Epson não está com o tipo que a migração espera: %', COALESCE(v_tipo, 'máquina não encontrada');
  END IF;
END
$guarda$;

-- ---------------------------------------------------------------------------------------------------
-- 1. O vocabulário de tipos: a Epson entra na etapa de impressão, ao lado da plotter.
-- ---------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tipos_de_maquina()
 RETURNS TABLE(tipo text, status_producao status_os, ordem integer, etapa_padrao text)
 LANGUAGE sql
 IMMUTABLE ROWS 6
 SET search_path TO 'public'
AS $function$
  VALUES
    ('plotter_impressao'::text, 'em_impressao'::public.status_os, 1, 'Impressão'::text),
    ('impressora_a4', 'em_impressao', 2, 'Impressão'),
    ('plotter_recorte', 'em_corte', 3, 'Recorte'),
    ('laser_co2', 'em_laser_cnc', 4, 'Laser'),
    ('laser_fiber', 'em_laser_cnc', 5, 'Laser'),
    ('impressora_3d', 'em_3d', 6, 'Impressão 3D')
$function$;

-- ---------------------------------------------------------------------------------------------------
-- 2. A Epson passa a ter um tipo que o sistema conhece.
-- ---------------------------------------------------------------------------------------------------
DO $epson$
DECLARE
  v_n integer;
BEGIN
  UPDATE public.maquinas
     SET tipo = 'impressora_a4',
         especificacoes = COALESCE(especificacoes, '{}'::jsonb) || jsonb_build_object('tipo_anterior', 'Impressão jato de tinta A4')
   WHERE id = 'eb76a98b-8555-4a5b-b0ab-00c3a22e6c95' AND tipo = 'Impressão jato de tinta A4';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'a Epson não foi atualizada (% linhas)', v_n;
  END IF;

  INSERT INTO public.logs_auditoria (usuario_id, entidade, entidade_id, acao, detalhes)
  VALUES (NULL, 'maquinas', 'eb76a98b-8555-4a5b-b0ab-00c3a22e6c95', 'tipo_da_maquina_corrigido',
          jsonb_build_object('de', 'Impressão jato de tinta A4', 'para', 'impressora_a4', 'migracao', '20261119210000'));
END
$epson$;

-- ---------------------------------------------------------------------------------------------------
-- 3. A R6 da TV: as impressoras de impressão dividem uma coluna, como as 3D.
-- ---------------------------------------------------------------------------------------------------
DO $m$
DECLARE
  v_def text := pg_get_functiondef('public.tv_painel_maquinas()'::regprocedure);
  v_velho constant text := E'  select (count(*) filter (where t.status_producao is distinct from ''em_3d'')\n          + case when count(*) filter (where t.status_producao = ''em_3d'') > 0 then 1 else 0 end)::integer\n    into v_colunas_da_parede';
  v_novo text;
BEGIN
  IF (length(v_def) - length(replace(v_def, v_velho, ''))) <> length(v_velho) THEN
    RAISE EXCEPTION 'o trecho da R6 não aparece exatamente uma vez na tv_painel_maquinas';
  END IF;
  v_novo := replace(v_def, v_velho,
    E'  -- e as de impressão (em_impressao: a plotter e a Epson A4) dividem outra coluna\n'
    '  select (count(*) filter (where t.status_producao is distinct from ''em_3d'' and t.status_producao is distinct from ''em_impressao'')\n'
    '          + case when count(*) filter (where t.status_producao = ''em_3d'') > 0 then 1 else 0 end\n'
    '          + case when count(*) filter (where t.status_producao = ''em_impressao'') > 0 then 1 else 0 end)::integer\n'
    '    into v_colunas_da_parede');
  IF v_novo = v_def THEN RAISE EXCEPTION 'R6 não encontrado'; END IF;
  EXECUTE v_novo;
END $m$;

-- ---------------------------------------------------------------------------------------------------
-- Conferência final: a migração para se algo não ficou como deveria.
-- ---------------------------------------------------------------------------------------------------
DO $confere$
DECLARE
  v_colunas integer;
  v_ativas_sem_etapa integer;
BEGIN
  IF (SELECT count(*) FROM public.tipos_de_maquina()) <> 6
     OR public.status_da_maquina('impressora_a4') IS DISTINCT FROM 'em_impressao'
     OR public.status_da_maquina('plotter_impressao') IS DISTINCT FROM 'em_impressao'
     OR public.maquina_do_status('em_corte') IS DISTINCT FROM 'plotter_recorte' THEN
    RAISE EXCEPTION 'o vocabulário de tipos de máquina não ficou como deveria';
  END IF;

  SELECT count(*) INTO v_ativas_sem_etapa
    FROM public.maquinas m LEFT JOIN public.tipos_de_maquina() t ON t.tipo = m.tipo
   WHERE m.ativa AND t.tipo IS NULL;
  IF v_ativas_sem_etapa <> 0 THEN
    RAISE EXCEPTION '% máquina(s) ativa(s) continuam com um tipo que não tem etapa de produção', v_ativas_sem_etapa;
  END IF;

  SELECT (count(*) FILTER (WHERE t.status_producao IS DISTINCT FROM 'em_3d' AND t.status_producao IS DISTINCT FROM 'em_impressao')
          + CASE WHEN count(*) FILTER (WHERE t.status_producao = 'em_3d') > 0 THEN 1 ELSE 0 END
          + CASE WHEN count(*) FILTER (WHERE t.status_producao = 'em_impressao') > 0 THEN 1 ELSE 0 END)::integer
    INTO v_colunas
    FROM public.maquinas m LEFT JOIN public.tipos_de_maquina() t ON t.tipo = m.tipo WHERE m.ativa;
  IF v_colunas > 5 THEN
    RAISE EXCEPTION 'a parede ainda teria % colunas', v_colunas;
  END IF;

  -- O que foi ensaiado é o que ficou: o md5 dos dois corpos depois da troca (ensaio de 19/11/2026).
  IF (SELECT md5(prosrc) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'tipos_de_maquina')
       IS DISTINCT FROM 'b720ff2751c005fca3dda9dac304f81a'
     OR (SELECT md5(prosrc) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'tv_painel_maquinas')
       IS DISTINCT FROM '3dedfd97cef70d65d02d364d90c09df4' THEN
    RAISE EXCEPTION 'o corpo de tipos_de_maquina ou de tv_painel_maquinas não é o que foi ensaiado';
  END IF;

  IF has_function_privilege('anon', 'public.tv_painel_maquinas()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.tv_painel_maquinas()', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.tv_painel_maquinas()', 'EXECUTE') THEN
    RAISE EXCEPTION 'EXECUTE de tv_painel_maquinas deveria ser só de service_role';
  END IF;
  IF has_function_privilege('anon', 'public.tipos_de_maquina()', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.tipos_de_maquina()', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.tipos_de_maquina()', 'EXECUTE') THEN
    RAISE EXCEPTION 'EXECUTE de tipos_de_maquina mudou';
  END IF;
END
$confere$;

COMMIT;
