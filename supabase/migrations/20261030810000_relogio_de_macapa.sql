-- O banco roda em UTC: `current_date` é a data de Greenwich e, entre 21h e meia-noite em Macapá,
-- já é "amanhã". Na noite de 29/10 o painel mostrou 9 OS atrasadas e 2 parcelas vencidas; as reais
-- eram 1 e 0. A mesma causa datava um estorno com o dia seguinte, antecipava o "atraso" da OS em um
-- dia inteiro (`prazo_entrega < now()` compara uma DATE com um instante: a data vira meia-noite UTC)
-- e, na virada do mês, jogava o pedido das 21h do último dia no mês seguinte.
--
-- Um só relógio: `public.hoje_br()` é a data de hoje em Macapá, qualquer que seja o fuso da sessão.
-- A migração troca, nas definições que estão VIVAS no banco, tudo o que lia a data do servidor:
--   1. `current_date` por `public.hoje_br()` (22 funções; as visões rel_os_atrasadas,
--      vw_avisos_pendentes e vw_compromissos);
--   2. `prazo_entrega < now()` por `prazo_entrega < public.hoje_br()` (lembretes_da_equipe,
--      pendencias_do_sistema e vw_resultado_os);
--   3. `coluna_timestamptz::date` por `(coluna AT TIME ZONE 'America/Belem')::date` (7 funções de
--      relatório e 7 visões), a janela de capacidade_das_maquinas/pessoas (meia-noite de Macapá, não
--      a de Greenwich) e a data dos códigos de lote e do texto de validade do bônus de parceiro;
--   4. `date_trunc('month'|'year', now())` por o início do mês/ano em Macapá (parceiro_painel e
--      minhas_comissoes);
--   5. os padrões `DEFAULT CURRENT_DATE` de 4 colunas.
-- Antes de aplicar, o ensaio (transação desfeita) rodou 59 visões e 102 funções de leitura em dois
-- fusos (UTC e UTC+14) e conferiu que, depois da migração, nenhuma muda de resposta com o fuso;
-- as únicas diferenças contra a versão antiga foram o atraso da OS que vence hoje (9 -> 4 hoje).
-- Parte de transformar o que está vivo, e não de recopiar o corpo, para não reverter nenhuma
-- mudança posterior; é idempotente (a segunda execução não acha mais nada a trocar) e termina
-- conferindo que nenhum `current_date` sobrou em função ou visão do schema public.
-- Nada muda para quem usa a tela de dia: das 0h às 21h os dois relógios davam o mesmo dia.
DO $migracao$
DECLARE
  alvo record;
  v_def text;
  v_novo text;
  v_par jsonb;
  v_antes int;
  v_opcoes text;
  v_restantes text;
  -- [objeto, texto antigo, texto novo, quantas vezes aparece]
  v_funcoes jsonb := $pares$[
    ["ajustar_estoque_material", "to_char(now(),'YYMMDD')", "to_char(public.hoje_br(),'YYMMDD')", 1],
    ["breakdown_3d", "o.created_at::date", "(o.created_at AT TIME ZONE 'America/Belem')::date", 1],
    ["capacidade_das_maquinas", "COALESCE(p_inicio, public.hoje_br())::timestamptz", "(COALESCE(p_inicio, public.hoje_br())::timestamp AT TIME ZONE 'America/Belem')", 1],
    ["capacidade_das_maquinas", "COALESCE(p_fim, public.hoje_br() + 7)::timestamptz", "(COALESCE(p_fim, public.hoje_br() + 7)::timestamp AT TIME ZONE 'America/Belem')", 1],
    ["capacidade_das_maquinas", "(v_fim - INTERVAL '1 day')::date", "((v_fim - INTERVAL '1 day') AT TIME ZONE 'America/Belem')::date", 1],
    ["capacidade_das_maquinas", "v_ini::date", "(v_ini AT TIME ZONE 'America/Belem')::date", 2],
    ["capacidade_das_maquinas", "v_fim::date", "(v_fim AT TIME ZONE 'America/Belem')::date", 1],
    ["capacidade_das_pessoas", "COALESCE(p_inicio, public.hoje_br())::timestamptz", "(COALESCE(p_inicio, public.hoje_br())::timestamp AT TIME ZONE 'America/Belem')", 1],
    ["capacidade_das_pessoas", "COALESCE(p_fim, public.hoje_br() + 7)::timestamptz", "(COALESCE(p_fim, public.hoje_br() + 7)::timestamp AT TIME ZONE 'America/Belem')", 1],
    ["capacidade_das_pessoas", "(v_fim - INTERVAL '1 day')::date", "((v_fim - INTERVAL '1 day') AT TIME ZONE 'America/Belem')::date", 1],
    ["capacidade_das_pessoas", "v_ini::date", "(v_ini AT TIME ZONE 'America/Belem')::date", 2],
    ["capacidade_das_pessoas", "v_fim::date", "(v_fim AT TIME ZONE 'America/Belem')::date", 1],
    ["funil_comercial", "coalesce(l.updated_at, l.created_at)::date", "(coalesce(l.updated_at, l.created_at) AT TIME ZONE 'America/Belem')::date", 1],
    ["funil_comercial", "l.created_at::date between", "(l.created_at AT TIME ZONE 'America/Belem')::date between", 1],
    ["get_relatorios_prioritarios", "aberta_em::date <= v_fim", "(aberta_em AT TIME ZONE 'America/Belem')::date <= v_fim", 1],
    ["lembretes_da_equipe", "os.prazo_entrega < now()", "os.prazo_entrega < public.hoje_br()", 1],
    ["lembretes_da_equipe", "p.prazo_entrega >= now()", "p.prazo_entrega >= public.hoje_br()", 1],
    ["minhas_comissoes", "pago_em >= date_trunc('year', now())", "pago_em >= (date_trunc('year', now() AT TIME ZONE 'America/Belem') AT TIME ZONE 'America/Belem')", 1],
    ["parceiro_compras", "o.created_at::date BETWEEN", "(o.created_at AT TIME ZONE 'America/Belem')::date BETWEEN", 1],
    ["parceiro_painel", "q.created_at >= date_trunc('month', now())", "q.created_at >= (date_trunc('month', now() AT TIME ZONE 'America/Belem') AT TIME ZONE 'America/Belem')", 1],
    ["parceiros_contador_periodo", "c.created_at::date", "(c.created_at AT TIME ZONE 'America/Belem')::date", 5],
    ["parceiros_contador_periodo", "o.created_at::date", "(o.created_at AT TIME ZONE 'America/Belem')::date", 2],
    ["parceiros_contador_periodo", "co.entregue_em::date", "(co.entregue_em AT TIME ZONE 'America/Belem')::date", 2],
    ["parceiros_resumo", "max(o.created_at)::date", "(max(o.created_at) AT TIME ZONE 'America/Belem')::date", 2],
    ["pendencias_do_sistema", "prazo_entrega < now()", "prazo_entrega < public.hoje_br()", 1],
    ["produtividade_3d", "a.fim::date", "(a.fim AT TIME ZONE 'America/Belem')::date", 1],
    ["produtividade_3d", "me.created_at::date", "(me.created_at AT TIME ZONE 'America/Belem')::date", 1],
    ["registrar_entrada_material", "to_char(now(),'YYMMDD')", "to_char(public.hoje_br(),'YYMMDD')", 1],
    ["tg_parceiro_bonus_indicacao", "to_char(now() + (v_cfg.boas_vindas_validade_dias || ' days')::interval,", "to_char((now() AT TIME ZONE 'America/Belem') + (v_cfg.boas_vindas_validade_dias || ' days')::interval,", 1]
  ]$pares$::jsonb;
  v_visoes jsonb := $pares$[
    ["rel_faturamento_por_periodo", "(created_at)::date", "(created_at AT TIME ZONE 'America/Belem')::date", 2],
    ["rel_lucro_por_os", "(os.created_at)::date", "(os.created_at AT TIME ZONE 'America/Belem')::date", 1],
    ["rel_margem_por_produto", "(max(os.created_at))::date", "(max(os.created_at) AT TIME ZONE 'America/Belem')::date", 1],
    ["rel_margem_por_produto", "(min(os.created_at))::date", "(min(os.created_at) AT TIME ZONE 'America/Belem')::date", 1],
    ["rel_previsto_realizado", "(o.created_at)::date", "(o.created_at AT TIME ZONE 'America/Belem')::date", 1],
    ["rel_producao_por_maquina", "(max(COALESCE(ap.finalizado_em, ap.iniciado_em)))::date", "(max(COALESCE(ap.finalizado_em, ap.iniciado_em)) AT TIME ZONE 'America/Belem')::date", 1],
    ["rel_producao_por_maquina", "(min(ap.iniciado_em))::date", "(min(ap.iniciado_em) AT TIME ZONE 'America/Belem')::date", 1],
    ["rel_retrabalho_por_setor", "(max(created_at))::date", "(max(created_at) AT TIME ZONE 'America/Belem')::date", 1],
    ["rel_retrabalho_por_setor", "(min(created_at))::date", "(min(created_at) AT TIME ZONE 'America/Belem')::date", 1],
    ["vw_avisos_pendentes", "(f.created_at)::date", "(f.created_at AT TIME ZONE 'America/Belem')::date", 1],
    ["vw_resultado_os", "os.prazo_entrega < now()", "os.prazo_entrega < public.hoje_br()", 1]
  ]$pares$::jsonb;
BEGIN
  -- 1. O relógio único.
  CREATE OR REPLACE FUNCTION public.hoje_br() RETURNS date
    LANGUAGE sql STABLE PARALLEL SAFE
    SET search_path TO 'public'
  AS $f$ SELECT (now() AT TIME ZONE 'America/Belem')::date $f$;
  REVOKE ALL ON FUNCTION public.hoje_br() FROM PUBLIC, anon;
  GRANT EXECUTE ON FUNCTION public.hoje_br() TO authenticated, service_role;
  COMMENT ON FUNCTION public.hoje_br() IS
    'Data de hoje em Macapá (America/Belem), qualquer que seja o fuso da sessão. O banco roda em UTC: current_date vira "amanhã" às 21h daqui. Use esta, nunca current_date.';

  -- 2. Padrões de coluna que gravavam a data de Greenwich.
  ALTER TABLE public.caixa_movimentos ALTER COLUMN data SET DEFAULT public.hoje_br();
  ALTER TABLE public.contas_bancarias ALTER COLUMN saldo_inicial_data SET DEFAULT public.hoje_br();
  ALTER TABLE public.contas_pagar ALTER COLUMN vencimento SET DEFAULT public.hoje_br();
  ALTER TABLE public.produto_concorrentes ALTER COLUMN coletado_em SET DEFAULT public.hoje_br();

  -- 3. Funções: current_date -> hoje_br().
  FOR alvo IN
    SELECT p.oid
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.prosrc ~* '\mcurrent_date\M'
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
  LOOP
    EXECUTE regexp_replace(pg_get_functiondef(alvo.oid), '\mcurrent_date\M', 'public.hoje_br()', 'gi');
  END LOOP;

  -- 4. Funções: as trocas pontuais (conta quantas vezes o texto antigo aparece; se não for o
  --    número esperado, para tudo em vez de trocar o que não conhece).
  FOR v_par IN SELECT * FROM jsonb_array_elements(v_funcoes) LOOP
    SELECT p.oid INTO alvo
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.proname = v_par->>0;
    IF NOT FOUND THEN RAISE EXCEPTION 'função % não encontrada', v_par->>0; END IF;
    v_def := pg_get_functiondef(alvo.oid);
    v_antes := (length(v_def) - length(replace(v_def, v_par->>1, ''))) / length(v_par->>1);
    IF v_antes = 0 AND position(v_par->>2 IN v_def) > 0 THEN CONTINUE; END IF;  -- já trocado
    IF v_antes <> (v_par->>3)::int THEN
      RAISE EXCEPTION '% tem % ocorrência(s) de [%], esperava %', v_par->>0, v_antes, v_par->>1, v_par->>3;
    END IF;
    EXECUTE replace(v_def, v_par->>1, v_par->>2);
  END LOOP;

  -- 5. Visões: current_date -> hoje_br() e as trocas pontuais; as opções (security_invoker) voltam.
  FOR alvo IN
    SELECT c.oid, c.relname, c.reloptions
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'v'
       AND (pg_get_viewdef(c.oid) ~* '\mcurrent_date\M'
            OR c.relname IN (SELECT e->>0 FROM jsonb_array_elements(v_visoes) e))
  LOOP
    v_novo := regexp_replace(pg_get_viewdef(alvo.oid), '\mcurrent_date\M', 'public.hoje_br()', 'gi');
    FOR v_par IN SELECT * FROM jsonb_array_elements(v_visoes) e WHERE e->>0 = alvo.relname LOOP
      v_antes := (length(v_novo) - length(replace(v_novo, v_par->>1, ''))) / length(v_par->>1);
      IF v_antes = 0 AND position(v_par->>2 IN v_novo) > 0 THEN CONTINUE; END IF;
      IF v_antes <> (v_par->>3)::int THEN
        RAISE EXCEPTION 'visão % tem % ocorrência(s) de [%], esperava %', alvo.relname, v_antes, v_par->>1, v_par->>3;
      END IF;
      v_novo := replace(v_novo, v_par->>1, v_par->>2);
    END LOOP;
    v_opcoes := CASE WHEN alvo.reloptions IS NULL THEN '' ELSE ' WITH (' || array_to_string(alvo.reloptions, ', ') || ')' END;
    EXECUTE format('CREATE OR REPLACE VIEW public.%I%s AS %s', alvo.relname, v_opcoes, rtrim(btrim(v_novo), ';'));
  END LOOP;

  -- 6. Conferência: nada pode ter sobrado.
  SELECT string_agg(p.proname, ', ') INTO v_restantes
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.prosrc ~* '\mcurrent_date\M'
     AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e');
  IF v_restantes IS NOT NULL THEN RAISE EXCEPTION 'current_date ainda em funções: %', v_restantes; END IF;
  SELECT string_agg(c.relname, ', ') INTO v_restantes
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm') AND pg_get_viewdef(c.oid) ~* '\mcurrent_date\M';
  IF v_restantes IS NOT NULL THEN RAISE EXCEPTION 'current_date ainda em visões: %', v_restantes; END IF;
END
$migracao$;
