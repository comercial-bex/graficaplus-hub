-- ============================================================================
-- Aviso do grupo: o chamado FECHADO SEM ATENDIMENTO não pode ficar escondido atrás dos abertos (22/11/2026).
--
-- O defeito, achado ao conferir (ensaio no banco vivo, desfeito): o aviso tem no máximo 15 linhas. A lista dos chamados
-- ABERTOS sem contato era escrita primeiro e podia gastar as 15, então o bloco "Chamados fechados sem nenhuma mensagem"
-- (o caso mais grave: alguém fechou o chamado sem falar com o parceiro) caía em "E mais N" e nunca aparecia. Hoje há 16
-- abertos sem contato: um chamado fechado sem atendimento não apareceria no aviso.
--
-- A correção só mexe na conta das linhas de `lembrete_parceiros_sem_contato(boolean, date)`:
--   * até 5 das 15 linhas ficam GUARDADAS para os fechados sem mensagem (c_reserva); a lista dos abertos usa o resto;
--   * o "E mais N" passa a contar o que de fato não coube (total menos as linhas mostradas).
-- O texto continua igual: "· fechado em dd/mm", SEM o nome de quem fechou (pedido do dono, 19/11/2026); a mesma mensagem por
-- dia, no máximo 15 linhas, domingo não envia, e as menções e o link como antes. Não mexe em nenhuma regra de fechamento
-- da caixa do WhatsApp.
--
-- Guarda: só troca a função se ela ainda é a de 19/11/2026 (md5 abaixo, o corpo está no DESFAZER).
--   lembrete_parceiros_sem_contato(boolean, date)   a8f57adf9a48d9dfe031c6290d8b8d1b
-- ============================================================================

DO $guarda$
BEGIN
  IF md5(pg_get_functiondef('public.lembrete_parceiros_sem_contato(boolean, date)'::regprocedure)) <> 'a8f57adf9a48d9dfe031c6290d8b8d1b' THEN
    RAISE EXCEPTION 'A função lembrete_parceiros_sem_contato mudou desde a revisão; pare e revise.';
  END IF;
END
$guarda$;

CREATE OR REPLACE FUNCTION public.lembrete_parceiros_sem_contato(p_enfileirar boolean DEFAULT true, p_hoje date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c_limite constant integer := 15;
  -- Linhas do aviso guardadas para os chamados fechados sem nenhuma mensagem (o caso mais grave).
  c_reserva constant integer := 5;
  v_hoje date := COALESCE(p_hoje, public.hoje_br());
  v_ativo boolean;
  v_horas integer;
  v_grupo text := public.grupo_equipe_destino();
  v_n integer := 0;
  v_a integer := 0;
  v_f integer := 0;
  v_max_abertos integer;
  v_bloco text;
  v_i integer := 0;
  v_resp text := NULL;
  v_primeiro boolean := true;
  v_corpo text := '';
  v_tel text[] := ARRAY[]::text[];
  v_ger_tel text[];
  v_ger uuid;
  v_texto text;
  v_fila uuid;
  v_res text;
  r record;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'Só o agendamento roda o lembrete de parceiros.' USING ERRCODE = '42501';
  END IF;
  SELECT g.lembrete_equipe_ativo, g.lembrete_equipe_horas INTO v_ativo, v_horas FROM public.parceiro_programa g LIMIT 1;
  v_ativo := COALESCE(v_ativo, true); v_horas := COALESCE(v_horas, 48);
  IF NOT v_ativo THEN
    RETURN jsonb_build_object('enviou', false, 'motivo', 'desligado');
  END IF;
  IF extract(isodow FROM v_hoje) = 7 THEN
    RETURN jsonb_build_object('enviou', false, 'motivo', 'domingo');
  END IF;

  SELECT count(*) INTO v_n FROM public._parceiros_sem_contato() t WHERE t.sem_contato;
  IF v_n = 0 THEN
    RETURN jsonb_build_object('enviou', false, 'motivo', 'ninguém sem contato', 'dia', v_hoje);
  END IF;

  SELECT count(*) INTO v_a FROM public._parceiros_sem_contato() t WHERE t.sem_contato AND NOT t.fechado_sem_contato;
  v_f := v_n - v_a;
  -- Os abertos usam o que sobra depois de guardar a reserva dos fechados (no máximo c_reserva linhas).
  v_max_abertos := c_limite - LEAST(v_f, c_reserva);
  FOR r IN
    SELECT t.* FROM public._parceiros_sem_contato() t WHERE t.sem_contato AND NOT t.fechado_sem_contato
     ORDER BY COALESCE(t.responsavel_nome, 'Sem responsável'), t.responsavel_id, t.horas_sem_contato DESC, t.nome
  LOOP
    v_i := v_i + 1;
    EXIT WHEN v_i > v_max_abertos;
    IF v_primeiro OR COALESCE(r.responsavel_id::text, '') IS DISTINCT FROM COALESCE(v_resp, '') THEN
      v_corpo := v_corpo || CASE WHEN v_primeiro THEN '' ELSE E'\n\n' END
                 || COALESCE(r.responsavel_nome, 'Sem responsável')
                 || CASE WHEN r.responsavel_tel IS NOT NULL THEN ' @55' || r.responsavel_tel ELSE '' END;
      IF r.responsavel_tel IS NOT NULL THEN v_tel := v_tel || ('55' || r.responsavel_tel); END IF;
      v_resp := COALESCE(r.responsavel_id::text, '');
      v_primeiro := false;
    END IF;
    v_corpo := v_corpo || E'\n- ' || r.nome || ' · ' || r.horas_sem_contato || 'h'
               || CASE WHEN COALESCE(r.credito, 0) > 0 AND r.credito_vence_em IS NOT NULL
                       THEN ' · crédito R$ ' || replace(to_char(r.credito, 'FM999999990.00'), '.', ',')
                            || ' até ' || to_char(r.credito_vence_em AT TIME ZONE 'America/Belem', 'DD/MM')
                       ELSE '' END;
  END LOOP;
  -- Linhas mostradas até aqui (o laço sai um passo depois do limite).
  v_i := LEAST(v_i, v_max_abertos);
  -- Bloco separado: chamados fechados sem nenhuma mensagem da equipe. Mesmo limite total de linhas.
  IF v_f > 0 AND v_i < c_limite THEN
    v_bloco := 'Chamados fechados sem nenhuma mensagem:';
    FOR r IN
      SELECT t.* FROM public._parceiros_sem_contato() t WHERE t.sem_contato AND t.fechado_sem_contato
       ORDER BY t.fechado_em, t.nome
    LOOP
      EXIT WHEN v_i >= c_limite;
      v_i := v_i + 1;
      v_bloco := v_bloco || E'\n- ' || r.nome || ' · fechado em ' || to_char(r.fechado_em AT TIME ZONE 'America/Belem', 'DD/MM');
      IF r.responsavel_tel IS NOT NULL THEN v_tel := v_tel || ('55' || r.responsavel_tel); END IF;
    END LOOP;
    v_corpo := CASE WHEN v_corpo = '' THEN v_bloco ELSE v_corpo || E'\n\n' || v_bloco END;
  END IF;
  IF v_n > v_i THEN
    v_corpo := v_corpo || E'\nE mais ' || (v_n - v_i) || '.';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT '55' || x.tel), ARRAY[]::text[]) INTO v_ger_tel
    FROM (SELECT public.normalize_whatsapp_phone(u.telefone) AS tel FROM public.usuarios u
           WHERE u.ativo IS NOT FALSE AND EXISTS (SELECT 1 FROM public.user_roles ur
                 WHERE ur.user_id = u.id AND ur.role = 'gestor'::public.app_role)) x
   WHERE x.tel ~ '^[0-9]{10,11}$';

  v_texto := 'Bom dia! ' || CASE WHEN v_a > 0
               THEN v_a || CASE WHEN v_a = 1 THEN ' parceiro' ELSE ' parceiros' END
                    || ' sem contato da equipe há mais de ' || v_horas || ' horas:'
               ELSE '' END || E'\n\n' || v_corpo || E'\n\n'
             || CASE WHEN cardinality(v_ger_tel) > 0
                     THEN 'Gestor ' || (SELECT string_agg('@' || g, ' ' ORDER BY g) FROM unnest(v_ger_tel) g) || E' acompanhe.\n'
                     ELSE '' END
             || 'Ver a lista: https://bexprint.com.br/parceiros';
  SELECT COALESCE(array_agg(DISTINCT x), ARRAY[]::text[]) INTO v_tel FROM unnest(v_tel || v_ger_tel) x;

  IF NOT p_enfileirar THEN
    RETURN jsonb_build_object('modo', 'seco', 'dia', v_hoje, 'parceiros', v_n, 'grupo_ativo', v_grupo IS NOT NULL,
                              'mencionando', to_jsonb(v_tel), 'texto', v_texto);
  END IF;

  IF v_grupo IS NULL THEN
    v_res := 'sem_grupo';
  ELSE
    SELECT u.id INTO v_ger FROM public.usuarios u JOIN public.user_roles ur ON ur.user_id = u.id
     WHERE ur.role IN ('gestor'::public.app_role, 'admin'::public.app_role) AND u.ativo IS NOT FALSE
     ORDER BY (ur.role = 'gestor'::public.app_role) DESC, u.nome LIMIT 1;
    v_fila := public.enfileirar_notificacao('whatsapp', v_grupo, NULL, 'aviso_grupo_equipe', 'usuario',
                COALESCE(v_ger, md5('parceiros_sem_contato')::uuid), 'aviso_grupo_equipe',
                jsonb_build_object('texto', v_texto, 'mencionar', to_jsonb(v_tel)),
                'parceiros_sem_contato:grupo:' || v_hoje);
    v_res := CASE WHEN v_fila IS NULL THEN 'ja_na_fila' ELSE 'enfileirado' END;
  END IF;

  INSERT INTO public.logs_auditoria (usuario_id, entidade, entidade_id, acao, detalhes)
  VALUES (NULL, 'parceiros', NULL, CASE WHEN v_res = 'sem_grupo' THEN 'lembrete_sem_contato_falha' ELSE 'lembrete_sem_contato' END,
          jsonb_build_object('dia', v_hoje, 'parceiros', v_n, 'resultado', v_res));
  IF v_res = 'sem_grupo' THEN
    RAISE WARNING 'lembrete de parceiros: grupo da equipe desligado ou inválido';
  END IF;
  RETURN jsonb_build_object('modo', 'enviando', 'dia', v_hoje, 'parceiros', v_n, 'resultado', v_res);
END $function$;

REVOKE ALL ON FUNCTION public.lembrete_parceiros_sem_contato(boolean, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lembrete_parceiros_sem_contato(boolean, date) TO service_role;

-- Conferência de permissões no fim: continua só do agendamento.
DO $conferencia$
DECLARE v_oid oid := 'public.lembrete_parceiros_sem_contato(boolean, date)'::regprocedure;
BEGIN
  IF has_function_privilege('anon', v_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE p.oid = v_oid AND a.grantee = 0)
     OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_oid AND p.prosecdef AND p.proconfig @> ARRAY['search_path=public']) THEN
    RAISE EXCEPTION 'Permissões de lembrete_parceiros_sem_contato fora do esperado.';
  END IF;
END
$conferencia$;

-- ============================================================================
-- DESFAZER: restaura o corpo de 19/11/2026 (md5 a8f57adf9a48d9dfe031c6290d8b8d1b). É o `CREATE OR REPLACE` acima SEM
-- `c_reserva`, `v_f` e `v_max_abertos`, com estas quatro diferenças:
--   * o laço dos abertos sai com `EXIT WHEN v_i > c_limite;`;
--   * depois dele, `v_i := LEAST(v_i, c_limite);`;
--   * o bloco dos fechados abre com `IF v_n > v_a AND v_i < c_limite THEN`;
--   * o fim é `IF v_n > c_limite THEN ... E mais (v_n - c_limite)`.
-- Para restaurar byte a byte, pegue o corpo em `git show <commit-anterior>:supabase/migrations/20261119120000_parceiro_fechado_sem_contato.sql`
-- (a seção do lembrete) e troque `' · fechado por ' || r.fechado_por_nome || ' em '` por `' · fechado em '`, como fez a migração 20261119130000.
-- ============================================================================
