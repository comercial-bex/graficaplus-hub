-- Dois restos do diagnóstico final de 29/10/2026 (verificações 9.5 e 9.7).
--
-- 1. Função de gatilho com EXECUTE aberto. O Supabase entrega `EXECUTE` a PUBLIC, anon e authenticated em
--    toda função nova, e o PostgREST publica como /rpc/ o que o anônimo consegue executar. Quatro funções de
--    gatilho estavam assim (`_wa_mensagem_liga_entidade`, `tg_os_prazo_vira_vencimento`,
--    `tg_parcela_nasce_com_o_prazo_da_os`, `tg_pagamento_forma_minuscula`). Sem exposição real (uma função
--    de gatilho chamada fora de um gatilho dá erro), mas a porta nem devia existir. O gatilho não precisa
--    de EXECUTE para disparar: a permissão é conferida só ao criá-lo. Fecha todas as funções de gatilho do
--    schema public de uma vez, e para se alguma continuar executável.
--    `os_bloqueios_do_quadro()` é do quadro da equipe: só quem está logado a chama.
--
-- 2. `ordens_servico.status_arte`: 33 de 33 OS com 'pendente' (o padrão), nenhuma função, visão, política,
--    restrição, índice ou gatilho a cita, e a tela nunca a leu. A arte aprovada vem de `arte_aprovada_da_os`
--    (link do cliente em `arquivo_aprovacoes`, aceite da equipe em `aprovacoes`). A migração só remove se
--    todos os valores forem o padrão; se alguém passar a usá-la, para em vez de apagar.
DO $migracao$
DECLARE
  f record;
  v_abertas text;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS assinatura
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.prorettype = 'trigger'::regtype
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.assinatura);
  END LOOP;

  -- O REVOKE não reclama quando não adianta: confere de verdade.
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v_abertas
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.prorettype = 'trigger'::regtype
     AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
     AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  IF v_abertas IS NOT NULL THEN
    RAISE EXCEPTION 'função de gatilho ainda executável por anon/authenticated: %', v_abertas;
  END IF;

  REVOKE ALL ON FUNCTION public.os_bloqueios_do_quadro() FROM PUBLIC, anon;
  GRANT EXECUTE ON FUNCTION public.os_bloqueios_do_quadro() TO authenticated, service_role;

  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'ordens_servico' AND column_name = 'status_arte') THEN
    IF EXISTS (SELECT 1 FROM public.ordens_servico
                WHERE status_arte IS DISTINCT FROM 'pendente' AND status_arte IS DISTINCT FROM 'nao_iniciada') THEN
      RAISE EXCEPTION 'status_arte tem valor que não é o padrão: não removo sem olhar';
    END IF;
    ALTER TABLE public.ordens_servico DROP COLUMN status_arte;
  END IF;
END
$migracao$;
