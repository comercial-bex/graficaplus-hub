-- Funções da equipe que só LEEM, fechadas para quem não entrou no sistema
-- (08/10/2026). Complementa 20261008040000_funcoes_que_gravam_fechadas_para_anon.
--
-- A 20261008040000 fechou as doze SECURITY DEFINER que gravam; a guarda dela
-- procura só quem tem insert/update/delete no corpo. Sobraram duas da equipe
-- que só leem e ainda têm EXECUTE para PUBLIC e anon:
--   custo_hora_sugerido(uuid)               custo/hora da máquina (é custo)
--   get_relatorios_prioritarios(date, date) os relatórios do sistema
-- As duas conferem permissão por dentro (require_permission('maquinas.read');
-- is_staff), então hoje recusam o anônimo ("Usuário não autenticado", "Acesso
-- negado aos relatórios"). Mesmo motivo da 20261008040000: a porta não tem por
-- que estar aberta atrás da tranca.
--
-- Ensaiado (claims + SET LOCAL ROLE, desfeito; função chamada no FROM, para o
-- Postgres não pular a chamada de função STABLE): depois, o anônimo leva
-- "permission denied for function" nas duas; admin e operador têm o mesmo
-- resultado de antes.
--
-- Quem chama: só telas com login (maquinas.tsx, simulador de precificação,
-- relatorios.tsx) e aplicar_custo_hora_sugerido, que é DEFINER e roda como
-- dona. Nenhuma política de RLS, view, cron ou página pública.
--
-- Ficam abertas de propósito as mesmas cinco do portal sem login (aprovação
-- por link e convite de parceiro) e can_see_prices (só responde se a pessoa
-- vê preço; para o anônimo, falso).
DO $fechar$
DECLARE
  v_funcao regprocedure;
BEGIN
  FOREACH v_funcao IN ARRAY ARRAY[
    'public.custo_hora_sugerido(uuid)',
    'public.get_relatorios_prioritarios(date, date)'
  ]::regprocedure[] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', v_funcao);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', v_funcao);
    -- O REVOKE não reclama quando não surte efeito: conferir de verdade.
    IF has_function_privilege('anon', v_funcao, 'EXECUTE') THEN
      RAISE EXCEPTION 'anon ainda executa %', v_funcao;
    END IF;
    IF NOT has_function_privilege('authenticated', v_funcao, 'EXECUTE') THEN
      RAISE EXCEPTION 'authenticated perdeu %', v_funcao;
    END IF;
  END LOOP;
END
$fechar$;

-- Guarda: deve voltar SÓ as cinco do portal sem login e can_see_prices.
--
--   SELECT p.oid::regprocedure
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.prosecdef AND p.prokind = 'f'
--      AND p.prorettype <> 'trigger'::regtype
--      AND has_function_privilege('anon', p.oid, 'EXECUTE')
--    ORDER BY 1;
