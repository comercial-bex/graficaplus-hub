-- ============================================================================
-- Parceiro nunca esquecido: REABRIR o chamado FECHADO SEM ATENDIMENTO (22/11/2026).
--
-- Função nova, que só ACRESCENTA. Não altera `whatsapp_resolver` nem nenhum gatilho ou regra de fechamento da caixa do
-- WhatsApp: quem fecha continua fechando como sempre. Ela só abre um chamado novo (ligado ao fechado por `reaberto_de`)
-- para o parceiro que a equipe nunca atendeu, que é o que se fez à mão em 19/11/2026 com 8 parceiros.
--
-- `parceiro_reabrir_chamado(p_parceiro)`:
--   * quem pode: `parceiros.manage` (admin e gestor) OU o responsável do próprio parceiro (que também lê parceiros);
--   * só parceiro ativo, que não seja conta de teste, com responsável, com conversa e celular válido;
--   * só reabre se o chamado MAIS RECENTE está fechado E foi fechado sem nenhuma mensagem da equipe
--     (`fechado_sem_contato` de `_parceiros_sem_contato()`, a mesma conta do cartão e do aviso do grupo);
--   * chamado já aberto: não faz nada e diz `ja_aberto`; fechado DEPOIS de a equipe falar: recusa com a frase;
--   * abre pelo caminho já em uso (`_parceiro_garantir_chamado` → `_wa_abrir_atendimento`, origem 'manual',
--     `reaberto_de` = o chamado fechado), sem enviar mensagem nenhuma;
--   * CONFERE no banco que o chamado novo existe, está aberto, é da mesma conversa e vem do fechado; se não, erro e nada
--     fica gravado ("a tela afirma o que o banco não tem" é o defeito que isto evita);
--   * registra quem reabriu em `logs_auditoria` (ação `parceiro_chamado_reaberto`).
-- Depois de reabrir, o chamado é "aberto agora": o prazo de 48 h do aviso recomeça (regra de `_parceiros_sem_contato`).
--
-- Segurança: grava, então nasce fechada: REVOKE ALL de PUBLIC, anon e authenticated e só `authenticated` recebe EXECUTE de
-- volta; a função confere a permissão por dentro (`auth.uid()`). A conferência no fim da migração prova isso.
-- Pré-requisito: migração 20261119120000 (coluna `fechado_sem_contato`), aplicada em 19/11/2026.
-- ============================================================================

DO $guarda$
BEGIN
  IF to_regprocedure('public._parceiros_sem_contato()') IS NULL
     OR pg_get_function_result('public._parceiros_sem_contato()'::regprocedure) NOT LIKE '%fechado_sem_contato%' THEN
    RAISE EXCEPTION 'A migração 20261119120000 (fechado_sem_contato) precisa estar aplicada antes desta.';
  END IF;
  IF to_regprocedure('public._parceiro_garantir_chamado(uuid)') IS NULL
     OR to_regprocedure('public.require_permission(text)') IS NULL THEN
    RAISE EXCEPTION 'Faltam funções de base (_parceiro_garantir_chamado ou require_permission).';
  END IF;
END
$guarda$;

CREATE OR REPLACE FUNCTION public.parceiro_reabrir_chamado(p_parceiro uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_p public.parceiros%ROWTYPE;
  v_l record;
  v_novo uuid;
  v_conf record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado';
  END IF;
  IF p_parceiro IS NULL THEN
    RAISE EXCEPTION 'Parceiro não informado.';
  END IF;
  SELECT * INTO v_p FROM public.parceiros WHERE id = p_parceiro;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Parceiro não encontrado.';
  END IF;
  IF NOT (public.has_permission(v_uid, 'parceiros.manage')
          OR (public.has_permission(v_uid, 'parceiros.read') AND v_p.responsavel_id = v_uid)) THEN
    RAISE EXCEPTION 'Permissão necessária: parceiros.manage';
  END IF;
  IF v_p.status <> 'ativo' THEN
    RAISE EXCEPTION 'Só parceiro ativo tem chamado.';
  END IF;
  IF COALESCE(v_p.e_teste, false) THEN
    RAISE EXCEPTION 'Conta de teste não tem chamado.';
  END IF;
  IF v_p.responsavel_id IS NULL THEN
    RAISE EXCEPTION 'Este parceiro está sem responsável: escolha o responsável antes de reabrir o chamado.';
  END IF;

  -- A mesma conta do cartão e do aviso do grupo: o chamado mais recente do parceiro.
  SELECT * INTO v_l FROM public._parceiros_sem_contato() t WHERE t.parceiro_id = p_parceiro;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Este parceiro ainda não tem conversa no WhatsApp (ou o celular dele não é válido): não há chamado para reabrir.';
  END IF;
  IF v_l.fechado_em IS NULL THEN
    RETURN jsonb_build_object('reaberto', false, 'motivo', 'ja_aberto', 'atendimento_id', v_l.atendimento_id);
  END IF;
  IF NOT v_l.fechado_sem_contato THEN
    RAISE EXCEPTION 'Este chamado foi fechado depois de a equipe falar com o parceiro. Só se reabre chamado fechado sem atendimento.';
  END IF;

  -- Abre pelo caminho de sempre. Ele não envia mensagem e devolve nulo (com aviso) se não conseguir.
  v_novo := public._parceiro_garantir_chamado(p_parceiro);

  -- Confere no banco: o chamado novo existe, está aberto, é da mesma conversa e vem do chamado fechado.
  SELECT t.id, t.numero, t.fechado_em, t.conversa_id, t.reaberto_de INTO v_conf
    FROM public.whatsapp_atendimentos t WHERE t.id = v_novo;
  IF v_novo IS NULL OR NOT FOUND OR v_conf.fechado_em IS NOT NULL
     OR v_conf.conversa_id IS DISTINCT FROM v_l.conversa_id
     OR v_conf.reaberto_de IS DISTINCT FROM v_l.atendimento_id THEN
    RAISE EXCEPTION 'O banco não confirmou a reabertura do chamado. Nada foi alterado: avise a gerência.';
  END IF;

  INSERT INTO public.logs_auditoria (usuario_id, entidade, entidade_id, acao, detalhes)
  VALUES (v_uid, 'parceiros', p_parceiro, 'parceiro_chamado_reaberto',
          jsonb_build_object('atendimento_anterior', v_l.atendimento_id, 'atendimento_novo', v_novo,
                             'numero', v_conf.numero, 'fechado_em', v_l.fechado_em, 'origem', 'cartao'));

  RETURN jsonb_build_object('reaberto', true, 'atendimento_id', v_novo, 'atendimento_anterior', v_l.atendimento_id,
                            'numero', v_conf.numero, 'conversa_id', v_l.conversa_id);
END
$function$;

REVOKE ALL ON FUNCTION public.parceiro_reabrir_chamado(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.parceiro_reabrir_chamado(uuid) TO authenticated;

-- Conferência final: fechada para anon e public, aberta só a quem entra, e com o search_path fixo.
DO $conferencia$
DECLARE v_oid oid := 'public.parceiro_reabrir_chamado(uuid)'::regprocedure;
BEGIN
  IF has_function_privilege('anon', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                 WHERE p.oid = v_oid AND a.grantee = 0)
     OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_oid AND p.prosecdef AND p.proconfig @> ARRAY['search_path=public']) THEN
    RAISE EXCEPTION 'Permissões ou search_path de parceiro_reabrir_chamado fora do esperado.';
  END IF;
END
$conferencia$;

-- ============================================================================
-- DESFAZER (os chamados que a função já reabriu ficam como estão; cada um tem o log `parceiro_chamado_reaberto`)
-- ============================================================================
-- DROP FUNCTION public.parceiro_reabrir_chamado(uuid);
