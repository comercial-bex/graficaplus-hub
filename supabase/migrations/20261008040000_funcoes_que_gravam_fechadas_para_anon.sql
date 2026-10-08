-- Funções que gravam, fechadas para quem não entrou no sistema (08/10/2026).
--
-- A chave `anon` está no aplicativo publicado — é pública por desenho. Doze
-- funções SECURITY DEFINER que gravam ainda tinham EXECUTE para `anon`
-- (herdado de PUBLIC e dos privilégios padrão do schema). Todas conferem
-- `auth.uid()` / permissão por dentro, então hoje recusam o anônimo — mas a
-- porta não tem por que estar aberta: um descuido no corpo de qualquer uma
-- vira escrita aberta na internet.
--
-- Conferido antes: nenhuma é chamada por política de RLS nem por job do
-- pg_cron; a única chamada de dentro do banco é `receber_pedido_compra →
-- receber_item_compra`, que roda como o usuário logado (authenticated, que
-- continua com EXECUTE). As telas que as chamam estão todas em
-- `_authenticated` (leads, avisos, OS, compras, portal do cliente).
--
-- Ficam ABERTAS de propósito (portal sem login): abrir_aprovacao,
-- registrar_decisao_aprovacao, arquivo_em_aprovacao_aberta, convite_de_parceiro
-- e parceiro_cadastrar_por_convite (cadastro do parceiro antes de confirmar o
-- e-mail; só aceita conta criada há menos de 15 min e convite ativo).
--
-- `REVOKE ... FROM PUBLIC, anon` sozinho tiraria o authenticated que vem de
-- PUBLIC; por isso o GRANT explícito logo em seguida. Conferência no fim.

DO $fechar$
DECLARE
  v_funcao regprocedure;
BEGIN
  FOREACH v_funcao IN ARRAY ARRAY[
    'public.aplicar_custo_hora_sugerido(uuid)',
    'public.avisar_manualmente(uuid, text)',
    'public.buscar_usuario_para_portal(text)',
    'public.cancelar_aviso(uuid, text)',
    'public.cancelar_avisos_orfaos()',
    'public.concluir_tarefa_os(uuid, boolean)',
    'public.criar_link_aprovacao(uuid, integer)',
    'public.marcar_lead_perdido(uuid, text)',
    'public.recalcular_previsao_custos(uuid)',
    'public.receber_item_compra(uuid, numeric, numeric, text)',
    'public.registrar_inspecao(uuid, text, jsonb, jsonb, text, uuid, uuid)',
    'public.vincular_usuario_ao_portal(uuid, uuid)'
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

-- Guarda: deve voltar VAZIA. Função SECURITY DEFINER que grava e que o anônimo
-- executa, fora das cinco do portal sem login.
--
--   SELECT p.oid::regprocedure
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.prosecdef AND p.prokind = 'f'
--      AND p.prorettype <> 'trigger'::regtype
--      AND has_function_privilege('anon', p.oid, 'EXECUTE')
--      AND pg_get_functiondef(p.oid) ~* '\m(insert|update|delete)\M'
--      AND p.proname NOT IN ('abrir_aprovacao', 'registrar_decisao_aprovacao',
--        'arquivo_em_aprovacao_aberta', 'convite_de_parceiro',
--        'parceiro_cadastrar_por_convite');
