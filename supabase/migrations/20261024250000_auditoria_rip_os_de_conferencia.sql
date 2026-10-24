-- Auditoria do RIP (24/10/2026): 13 OS de conferência e o que elas não podem bagunçar.
--
-- DADOS (feitos por SQL no mesmo dia, fora desta migração): as 38 linhas do print da
-- fila do FlexiPRINT entraram em rip_jobs (importar_flexi_jobs) e, para cada trabalho
-- concluído SEM OS nem orçamento que o explicasse, foi criada uma OS (#175 a #187) no
-- cliente da casa, finalidade 'uso_interno', com o job do Flexi na observação e o que
-- falta preencher. Nasceram em 'entrada' e foram para 'concluido': o trabalho já foi
-- impresso, e 'entrada' inflava a TV da oficina (14 → 27 OS na parede).
--
-- ESTA MIGRAÇÃO impede que OS que não é venda vire ruído de cobrança:
--   * "Trabalhos entregues sem nenhuma cobrança" (painel) e o bloco 5 do lembrete do
--     financeiro: só OS de venda — OS de uso interno não se cobra;
--   * "OS concluídas" da Meta do mês: só venda;
--   * "Ordens em produção sem material previsto": só venda (OS interna não tem produto).
-- Ficam de propósito: "Ordens concluídas sem baixa de material" (14 de 14) — é o
-- retrato fiel: a mídia dessas impressões ainda não saiu do estoque.
-- Desfazer: recriar as 3 funções das migrações 20261013090000, 20261024220000 e a
-- pendencias_do_sistema anterior; as OS 175–187 podem ser canceladas.
DO $m$
DECLARE d text; a text; n int;
BEGIN
  d := pg_get_functiondef('public.pendencias_do_sistema()'::regprocedure);
  a := E'  FROM public.ordens_servico os WHERE os.status NOT IN (''concluido'',''faturado'',''cancelado'')\n    AND NOT EXISTS (SELECT 1 FROM public.os_materiais_previstos m WHERE m.os_id=os.id)\n    -- so de servico';
  IF position('só venda: a OS de uso interno' IN d) = 0 THEN
    n := (length(d) - length(replace(d, a, ''))) / length(a);
    IF n <> 1 THEN RAISE EXCEPTION 'pendencias (material previsto): âncora aparece % vezes', n; END IF;
    EXECUTE replace(d, a, E'  FROM public.ordens_servico os WHERE os.status NOT IN (''concluido'',''faturado'',''cancelado'')\n    -- só venda: a OS de uso interno (inclusive as da auditoria do RIP, 24/10/2026) não tem produto para prever\n    AND os.finalidade = ''venda''\n    AND NOT EXISTS (SELECT 1 FROM public.os_materiais_previstos m WHERE m.os_id=os.id)\n    -- so de servico');
    d := pg_get_functiondef('public.pendencias_do_sistema()'::regprocedure);
  END IF;

  a := E'    FROM public.ordens_servico os WHERE os.status IN (''concluido'',''faturado'')\n      AND NOT EXISTS (SELECT 1 FROM public.contas_receber cr WHERE cr.os_id=os.id) HAVING count(*)>0;';
  IF position('os.finalidade = ''venda'' AND os.status IN (''concluido'',''faturado'')' IN d) = 0 THEN
    n := (length(d) - length(replace(d, a, ''))) / length(a);
    IF n <> 1 THEN RAISE EXCEPTION 'pendencias (sem cobrança): âncora aparece % vezes', n; END IF;
    EXECUTE replace(d, a, E'    FROM public.ordens_servico os WHERE os.finalidade = ''venda'' AND os.status IN (''concluido'',''faturado'')\n      AND NOT EXISTS (SELECT 1 FROM public.contas_receber cr WHERE cr.os_id=os.id) HAVING count(*)>0;');
  END IF;

  d := pg_get_functiondef('public.lembretes_da_equipe()'::regprocedure);
  a := E'    WHERE os.status::text IN (''concluido'', ''faturado'')\n      AND NOT EXISTS (SELECT 1 FROM public.contas_receber cr WHERE cr.os_id = os.id)';
  IF position('WHERE os.finalidade = ''venda'' AND os.status::text IN (''concluido'', ''faturado'')' IN d) = 0 THEN
    n := (length(d) - length(replace(d, a, ''))) / length(a);
    IF n <> 1 THEN RAISE EXCEPTION 'lembretes: âncora aparece % vezes', n; END IF;
    EXECUTE replace(d, a, E'    WHERE os.finalidade = ''venda'' AND os.status::text IN (''concluido'', ''faturado'')\n      AND NOT EXISTS (SELECT 1 FROM public.contas_receber cr WHERE cr.os_id = os.id)');
  END IF;

  d := pg_get_functiondef('public.ponto_de_equilibrio(date)'::regprocedure);
  a := E'    ''os_concluidas_n'', (SELECT count(*) FROM public.ordens_servico os\n                 WHERE os.status IN (''faturado'', ''concluido'')),';
  IF position('WHERE os.finalidade = ''venda'' AND os.status IN (''faturado'', ''concluido'')' IN d) = 0 THEN
    n := (length(d) - length(replace(d, a, ''))) / length(a);
    IF n <> 1 THEN RAISE EXCEPTION 'meta: âncora aparece % vezes', n; END IF;
    EXECUTE replace(d, a, E'    ''os_concluidas_n'', (SELECT count(*) FROM public.ordens_servico os\n                 WHERE os.finalidade = ''venda'' AND os.status IN (''faturado'', ''concluido'')),');
  END IF;
END $m$;
