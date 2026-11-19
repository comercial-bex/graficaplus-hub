-- ============================================================================
-- Parceiro nunca esquecido: chamados FECHADOS sem nenhuma mensagem da equipe.
-- APLICADA em 19/11/2026, direto no banco, a pedido do dono
-- regras de fechamento da caixa do WhatsApp.
--
-- 1) _parceiros_sem_contato(): olha o atendimento MAIS RECENTE da conversa do
--    parceiro, aberto ou fechado. Fechado sem nenhuma mensagem humana da equipe
--    (origem 'humano' com enviada_por, ou 'celular') desde aberto_em => continua
--    sem contato (desde = aberto_em) com fechado_sem_contato = true e
--    fechado_por_nome. Fechado depois de mensagem da equipe: regra de antes.
--    Novas colunas no fim do retorno: fechado_sem_contato, fechado_por_nome, fechado_em.
--    O tipo de retorno muda => DROP + CREATE, e o wrapper parceiros_sem_contato()
--    é recriado (mesmo corpo) com as mesmas permissões.
-- 2) lembrete_parceiros_sem_contato(): bloco separado 'Chamados fechados sem
--    nenhuma mensagem'. Uma mensagem por dia, no máximo 15 linhas no total.
--
-- md5 vivos (pg_get_functiondef) em 19/11/2026, corpos no DESFAZER:
--   _parceiros_sem_contato()                    32b616f1407013f79d35b9a9e35c6557
--   parceiros_sem_contato()                     3e173889f623fbd80e85d433204b01d9
--   lembrete_parceiros_sem_contato(boolean,date) 85c9bf9476772e79ac2c0e7e319520a0
-- ============================================================================

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('public._parceiros_sem_contato()'::regprocedure, '32b616f1407013f79d35b9a9e35c6557'),
    ('public.parceiros_sem_contato()'::regprocedure, '3e173889f623fbd80e85d433204b01d9'),
    ('public.lembrete_parceiros_sem_contato(boolean, date)'::regprocedure, '85c9bf9476772e79ac2c0e7e319520a0')) v(f, h)
  LOOP
    IF md5(pg_get_functiondef(r.f)) <> r.h THEN
      RAISE EXCEPTION 'A função % mudou desde a revisão; pare e revise.', r.f;
    END IF;
  END LOOP;
END $$;

DROP FUNCTION public._parceiros_sem_contato();

CREATE OR REPLACE FUNCTION public._parceiros_sem_contato()
 RETURNS TABLE(parceiro_id uuid, nome text, responsavel_id uuid, responsavel_nome text, responsavel_tel text, conversa_id uuid, atendimento_id uuid, aberto_em timestamp with time zone, ultima_saida_equipe timestamp with time zone, ultima_entrada timestamp with time zone, desde timestamp with time zone, horas_sem_contato integer, sem_contato boolean, credito numeric, credito_vence_em timestamp with time zone, comprou boolean, fechado_sem_contato boolean, fechado_por_nome text, fechado_em timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH prog AS (
    SELECT COALESCE((SELECT g.lembrete_equipe_horas FROM public.parceiro_programa g LIMIT 1), 48) AS h
  ),
  base AS (
    SELECT p.id, coalesce(nullif(btrim(p.marca_nome),''), c.nome, 'Parceiro') AS nome, p.cliente_id,
           public._parceiro_celular(p.id) AS cel
      FROM public.parceiros p LEFT JOIN public.clientes c ON c.id = p.cliente_id
     WHERE p.status = 'ativo' AND NOT p.e_teste
  ),
  ch AS (
    SELECT b.*, a.id AS at_id, a.conversa_id AS conv, a.aberto_em AS aberto, a.resp, a.fechado_em AS fechado, a.fechado_por AS fech_por
      FROM base b
      JOIN LATERAL (
        SELECT t.id, t.conversa_id, t.aberto_em, t.fechado_em, t.fechado_por, COALESCE(t.responsavel_id, w.responsavel_id) AS resp
          FROM public.whatsapp_conversas w
          JOIN public.whatsapp_atendimentos t ON t.conversa_id = w.id
         WHERE w.telefone_normalizado = b.cel
         ORDER BY t.aberto_em DESC LIMIT 1
      ) a ON true
     WHERE b.cel IS NOT NULL
  ),
  msg AS (
    SELECT ch.*,
      (SELECT max(COALESCE(m.enviado_em, m.created_at)) FROM public.whatsapp_mensagens m
        WHERE m.conversa_id = ch.conv AND m.direcao::text = 'saida' AND m.status::text <> 'falha'
          AND (m.origem = 'celular' OR (m.origem = 'humano' AND m.enviada_por IS NOT NULL))) AS saida,
      (SELECT max(COALESCE(m.recebido_em, m.created_at)) FROM public.whatsapp_mensagens m
        WHERE m.conversa_id = ch.conv AND m.direcao::text = 'entrada'
          AND COALESCE(m.origem, 'humano') <> 'automacao') AS entrada
      FROM ch
  ),
  calc AS (
    SELECT msg.*,
      CASE WHEN msg.saida IS NULL OR msg.saida < msg.aberto THEN msg.aberto
           WHEN msg.entrada > msg.saida THEN msg.entrada END AS desde_,
      (msg.fechado IS NOT NULL AND (msg.saida IS NULL OR msg.saida < msg.aberto)) AS fsc
      FROM msg
  )
  SELECT k.id, k.nome, k.resp, u.nome,
         CASE WHEN public.normalize_whatsapp_phone(u.telefone) ~ '^[0-9]{10,11}$' THEN public.normalize_whatsapp_phone(u.telefone) END,
         k.conv, k.at_id, k.aberto, k.saida, k.entrada, k.desde_,
         CASE WHEN k.desde_ IS NOT NULL THEN floor(extract(epoch FROM now() - k.desde_) / 3600)::integer END,
         (k.fsc OR COALESCE(k.desde_ < now() - make_interval(hours => (SELECT h FROM prog)), false)),
         s.disponivel, e.vence, b2.comprou,
         k.fsc, CASE WHEN k.fsc THEN COALESCE(uf.nome, 'automação') END, k.fechado
    FROM calc k
    LEFT JOIN public.usuarios u ON u.id = k.resp
    LEFT JOIN public.usuarios uf ON uf.id = k.fech_por
    CROSS JOIN LATERAL (SELECT EXISTS (SELECT 1 FROM public.orcamentos o
                         WHERE o.cliente_id = k.cliente_id AND o.status::text IN ('aprovado','convertido')) AS comprou) b2
    CROSS JOIN LATERAL (SELECT min(pc.expira_em) AS vence FROM public.parceiro_creditos pc
                         WHERE pc.parceiro_id = k.id AND pc.tipo = 'entrada' AND pc.expira_em > now()) e
    CROSS JOIN LATERAL (SELECT greatest(coalesce(sum(pc.valor),0)-greatest(least(coalesce(sum(pc.valor),0),
       coalesce(sum(pc.valor) FILTER(WHERE pc.valor>0 AND pc.expira_em<=now()),0)
      -coalesce(-sum(pc.valor) FILTER(WHERE pc.valor<0 AND pc.tipo<>'expirado'),0)
      -coalesce(-sum(pc.valor) FILTER(WHERE pc.tipo='expirado'),0)),0),0) AS disponivel
       FROM public.parceiro_creditos pc WHERE pc.parceiro_id = k.id) s
$function$;

REVOKE ALL ON FUNCTION public._parceiros_sem_contato() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._parceiros_sem_contato() TO service_role;

CREATE OR REPLACE FUNCTION public.parceiros_sem_contato()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.require_permission('parceiros.read');
  RETURN jsonb_build_object(
    'horas', COALESCE((SELECT g.lembrete_equipe_horas FROM public.parceiro_programa g LIMIT 1), 48),
    'lista', COALESCE((SELECT jsonb_agg(to_jsonb(t) - 'responsavel_tel'
                         ORDER BY t.sem_contato DESC, t.responsavel_nome NULLS LAST, t.horas_sem_contato DESC NULLS LAST, t.nome)
                         FROM public._parceiros_sem_contato() t), '[]'::jsonb));
END $function$;

REVOKE ALL ON FUNCTION public.parceiros_sem_contato() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.parceiros_sem_contato() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.lembrete_parceiros_sem_contato(p_enfileirar boolean DEFAULT true, p_hoje date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c_limite constant integer := 15;
  v_hoje date := COALESCE(p_hoje, public.hoje_br());
  v_ativo boolean;
  v_horas integer;
  v_grupo text := public.grupo_equipe_destino();
  v_n integer := 0;
  v_a integer := 0;
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
  FOR r IN
    SELECT t.* FROM public._parceiros_sem_contato() t WHERE t.sem_contato AND NOT t.fechado_sem_contato
     ORDER BY COALESCE(t.responsavel_nome, 'Sem responsável'), t.responsavel_id, t.horas_sem_contato DESC, t.nome
  LOOP
    v_i := v_i + 1;
    EXIT WHEN v_i > c_limite;
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
  -- Bloco separado: chamados fechados sem nenhuma mensagem da equipe. Mesmo limite total de linhas.
  v_i := LEAST(v_i, c_limite);
  IF v_n > v_a AND v_i < c_limite THEN
    v_bloco := 'Chamados fechados sem nenhuma mensagem:';
    FOR r IN
      SELECT t.* FROM public._parceiros_sem_contato() t WHERE t.sem_contato AND t.fechado_sem_contato
       ORDER BY t.fechado_em, t.nome
    LOOP
      EXIT WHEN v_i >= c_limite;
      v_i := v_i + 1;
      v_bloco := v_bloco || E'\n- ' || r.nome || ' · fechado por ' || r.fechado_por_nome
                 || ' em ' || to_char(r.fechado_em AT TIME ZONE 'America/Belem', 'DD/MM');
      IF r.responsavel_tel IS NOT NULL THEN v_tel := v_tel || ('55' || r.responsavel_tel); END IF;
    END LOOP;
    v_corpo := CASE WHEN v_corpo = '' THEN v_bloco ELSE v_corpo || E'\n\n' || v_bloco END;
  END IF;
  IF v_n > c_limite THEN
    v_corpo := v_corpo || E'\nE mais ' || (v_n - c_limite) || '.';
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

-- Conferência de permissões no fim.
DO $$
BEGIN
  IF has_function_privilege('anon', 'public._parceiros_sem_contato()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public._parceiros_sem_contato()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.parceiros_sem_contato()', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.parceiros_sem_contato()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.lembrete_parceiros_sem_contato(boolean, date)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.lembrete_parceiros_sem_contato(boolean, date)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.lembrete_parceiros_sem_contato(boolean, date)', 'EXECUTE')
  THEN
    RAISE EXCEPTION 'Permissões das funções de parceiros sem contato fora do esperado.';
  END IF;
END $$;

-- ============================================================================
-- DESFAZER (corpos vivos de 19/11/2026)
-- ============================================================================
-- DROP FUNCTION public._parceiros_sem_contato();
-- CREATE OR REPLACE FUNCTION public._parceiros_sem_contato()
--  RETURNS TABLE(parceiro_id uuid, nome text, responsavel_id uuid, responsavel_nome text, responsavel_tel text, conversa_id uuid, atendimento_id uuid, aberto_em timestamp with time zone, ultima_saida_equipe timestamp with time zone, ultima_entrada timestamp with time zone, desde timestamp with time zone, horas_sem_contato integer, sem_contato boolean, credito numeric, credito_vence_em timestamp with time zone, comprou boolean)
--  LANGUAGE sql
--  STABLE SECURITY DEFINER
--  SET search_path TO 'public'
-- AS $function$
--   WITH prog AS (
--     SELECT COALESCE((SELECT g.lembrete_equipe_horas FROM public.parceiro_programa g LIMIT 1), 48) AS h
--   ),
--   base AS (
--     SELECT p.id, coalesce(nullif(btrim(p.marca_nome),''), c.nome, 'Parceiro') AS nome, p.cliente_id,
--            public._parceiro_celular(p.id) AS cel
--       FROM public.parceiros p LEFT JOIN public.clientes c ON c.id = p.cliente_id
--      WHERE p.status = 'ativo' AND NOT p.e_teste
--   ),
--   ch AS (
--     SELECT b.*, a.id AS at_id, a.conversa_id AS conv, a.aberto_em AS aberto, a.resp
--       FROM base b
--       JOIN LATERAL (
--         SELECT t.id, t.conversa_id, t.aberto_em, COALESCE(t.responsavel_id, w.responsavel_id) AS resp
--           FROM public.whatsapp_conversas w
--           JOIN public.whatsapp_atendimentos t ON t.conversa_id = w.id AND t.fechado_em IS NULL
--          WHERE w.telefone_normalizado = b.cel
--          ORDER BY t.aberto_em DESC LIMIT 1
--       ) a ON true
--      WHERE b.cel IS NOT NULL
--   ),
--   msg AS (
--     SELECT ch.*,
--       (SELECT max(COALESCE(m.enviado_em, m.created_at)) FROM public.whatsapp_mensagens m
--         WHERE m.conversa_id = ch.conv AND m.direcao::text = 'saida' AND m.status::text <> 'falha'
--           AND (m.origem = 'celular' OR (m.origem = 'humano' AND m.enviada_por IS NOT NULL))) AS saida,
--       (SELECT max(COALESCE(m.recebido_em, m.created_at)) FROM public.whatsapp_mensagens m
--         WHERE m.conversa_id = ch.conv AND m.direcao::text = 'entrada'
--           AND COALESCE(m.origem, 'humano') <> 'automacao') AS entrada
--       FROM ch
--   ),
--   calc AS (
--     SELECT msg.*,
--       CASE WHEN msg.saida IS NULL OR msg.saida < msg.aberto THEN msg.aberto
--            WHEN msg.entrada > msg.saida THEN msg.entrada END AS desde_
--       FROM msg
--   )
--   SELECT k.id, k.nome, k.resp, u.nome,
--          CASE WHEN public.normalize_whatsapp_phone(u.telefone) ~ '^[0-9]{10,11}$' THEN public.normalize_whatsapp_phone(u.telefone) END,
--          k.conv, k.at_id, k.aberto, k.saida, k.entrada, k.desde_,
--          CASE WHEN k.desde_ IS NOT NULL THEN floor(extract(epoch FROM now() - k.desde_) / 3600)::integer END,
--          COALESCE(k.desde_ < now() - make_interval(hours => (SELECT h FROM prog)), false),
--          s.disponivel, e.vence, b2.comprou
--     FROM calc k
--     LEFT JOIN public.usuarios u ON u.id = k.resp
--     CROSS JOIN LATERAL (SELECT EXISTS (SELECT 1 FROM public.orcamentos o
--                          WHERE o.cliente_id = k.cliente_id AND o.status::text IN ('aprovado','convertido')) AS comprou) b2
--     CROSS JOIN LATERAL (SELECT min(pc.expira_em) AS vence FROM public.parceiro_creditos pc
--                          WHERE pc.parceiro_id = k.id AND pc.tipo = 'entrada' AND pc.expira_em > now()) e
--     CROSS JOIN LATERAL (SELECT greatest(coalesce(sum(pc.valor),0)-greatest(least(coalesce(sum(pc.valor),0),
--        coalesce(sum(pc.valor) FILTER(WHERE pc.valor>0 AND pc.expira_em<=now()),0)
--       -coalesce(-sum(pc.valor) FILTER(WHERE pc.valor<0 AND pc.tipo<>'expirado'),0)
--       -coalesce(-sum(pc.valor) FILTER(WHERE pc.tipo='expirado'),0)),0),0) AS disponivel
--        FROM public.parceiro_creditos pc WHERE pc.parceiro_id = k.id) s
-- $function$;
-- REVOKE ALL ON FUNCTION public._parceiros_sem_contato() FROM PUBLIC, anon, authenticated;
-- GRANT EXECUTE ON FUNCTION public._parceiros_sem_contato() TO service_role;
--
-- CREATE OR REPLACE FUNCTION public.parceiros_sem_contato()
--  RETURNS jsonb
--  LANGUAGE plpgsql
--  STABLE SECURITY DEFINER
--  SET search_path TO 'public'
-- AS $function$
-- BEGIN
--   PERFORM public.require_permission('parceiros.read');
--   RETURN jsonb_build_object(
--     'horas', COALESCE((SELECT g.lembrete_equipe_horas FROM public.parceiro_programa g LIMIT 1), 48),
--     'lista', COALESCE((SELECT jsonb_agg(to_jsonb(t) - 'responsavel_tel'
--                          ORDER BY t.sem_contato DESC, t.responsavel_nome NULLS LAST, t.horas_sem_contato DESC NULLS LAST, t.nome)
--                          FROM public._parceiros_sem_contato() t), '[]'::jsonb));
-- END $function$;
-- REVOKE ALL ON FUNCTION public.parceiros_sem_contato() FROM PUBLIC, anon, authenticated;
-- GRANT EXECUTE ON FUNCTION public.parceiros_sem_contato() TO authenticated, service_role;
--
-- CREATE OR REPLACE FUNCTION public.lembrete_parceiros_sem_contato(p_enfileirar boolean DEFAULT true, p_hoje date DEFAULT NULL::date)
--  RETURNS jsonb
--  LANGUAGE plpgsql
--  SECURITY DEFINER
--  SET search_path TO 'public'
-- AS $function$
-- DECLARE
--   c_limite constant integer := 15;
--   v_hoje date := COALESCE(p_hoje, public.hoje_br());
--   v_ativo boolean;
--   v_horas integer;
--   v_grupo text := public.grupo_equipe_destino();
--   v_n integer := 0;
--   v_i integer := 0;
--   v_resp text := NULL;
--   v_primeiro boolean := true;
--   v_corpo text := '';
--   v_tel text[] := ARRAY[]::text[];
--   v_ger_tel text[];
--   v_ger uuid;
--   v_texto text;
--   v_fila uuid;
--   v_res text;
--   r record;
-- BEGIN
--   IF auth.uid() IS NOT NULL THEN
--     RAISE EXCEPTION 'Só o agendamento roda o lembrete de parceiros.' USING ERRCODE = '42501';
--   END IF;
--   SELECT g.lembrete_equipe_ativo, g.lembrete_equipe_horas INTO v_ativo, v_horas FROM public.parceiro_programa g LIMIT 1;
--   v_ativo := COALESCE(v_ativo, true); v_horas := COALESCE(v_horas, 48);
--   IF NOT v_ativo THEN
--     RETURN jsonb_build_object('enviou', false, 'motivo', 'desligado');
--   END IF;
--   IF extract(isodow FROM v_hoje) = 7 THEN
--     RETURN jsonb_build_object('enviou', false, 'motivo', 'domingo');
--   END IF;
-- 
--   SELECT count(*) INTO v_n FROM public._parceiros_sem_contato() t WHERE t.sem_contato;
--   IF v_n = 0 THEN
--     RETURN jsonb_build_object('enviou', false, 'motivo', 'ninguém sem contato', 'dia', v_hoje);
--   END IF;
-- 
--   FOR r IN
--     SELECT t.* FROM public._parceiros_sem_contato() t WHERE t.sem_contato
--      ORDER BY COALESCE(t.responsavel_nome, 'Sem responsável'), t.responsavel_id, t.horas_sem_contato DESC, t.nome
--   LOOP
--     v_i := v_i + 1;
--     EXIT WHEN v_i > c_limite;
--     IF v_primeiro OR COALESCE(r.responsavel_id::text, '') IS DISTINCT FROM COALESCE(v_resp, '') THEN
--       v_corpo := v_corpo || CASE WHEN v_primeiro THEN '' ELSE E'\n\n' END
--                  || COALESCE(r.responsavel_nome, 'Sem responsável')
--                  || CASE WHEN r.responsavel_tel IS NOT NULL THEN ' @55' || r.responsavel_tel ELSE '' END;
--       IF r.responsavel_tel IS NOT NULL THEN v_tel := v_tel || ('55' || r.responsavel_tel); END IF;
--       v_resp := COALESCE(r.responsavel_id::text, '');
--       v_primeiro := false;
--     END IF;
--     v_corpo := v_corpo || E'\n- ' || r.nome || ' · ' || r.horas_sem_contato || 'h'
--                || CASE WHEN COALESCE(r.credito, 0) > 0 AND r.credito_vence_em IS NOT NULL
--                        THEN ' · crédito R$ ' || replace(to_char(r.credito, 'FM999999990.00'), '.', ',')
--                             || ' até ' || to_char(r.credito_vence_em AT TIME ZONE 'America/Belem', 'DD/MM')
--                        ELSE '' END;
--   END LOOP;
--   IF v_n > c_limite THEN
--     v_corpo := v_corpo || E'\nE mais ' || (v_n - c_limite) || '.';
--   END IF;
-- 
--   SELECT COALESCE(array_agg(DISTINCT '55' || x.tel), ARRAY[]::text[]) INTO v_ger_tel
--     FROM (SELECT public.normalize_whatsapp_phone(u.telefone) AS tel FROM public.usuarios u
--            WHERE u.ativo IS NOT FALSE AND EXISTS (SELECT 1 FROM public.user_roles ur
--                  WHERE ur.user_id = u.id AND ur.role = 'gestor'::public.app_role)) x
--    WHERE x.tel ~ '^[0-9]{10,11}$';
-- 
--   v_texto := 'Bom dia! ' || v_n || CASE WHEN v_n = 1 THEN ' parceiro' ELSE ' parceiros' END
--              || ' sem contato da equipe há mais de ' || v_horas || E' horas:\n\n' || v_corpo || E'\n\n'
--              || CASE WHEN cardinality(v_ger_tel) > 0
--                      THEN 'Gestor ' || (SELECT string_agg('@' || g, ' ' ORDER BY g) FROM unnest(v_ger_tel) g) || E' acompanhe.\n'
--                      ELSE '' END
--              || 'Ver a lista: https://bexprint.com.br/parceiros';
--   SELECT COALESCE(array_agg(DISTINCT x), ARRAY[]::text[]) INTO v_tel FROM unnest(v_tel || v_ger_tel) x;
-- 
--   IF NOT p_enfileirar THEN
--     RETURN jsonb_build_object('modo', 'seco', 'dia', v_hoje, 'parceiros', v_n, 'grupo_ativo', v_grupo IS NOT NULL,
--                               'mencionando', to_jsonb(v_tel), 'texto', v_texto);
--   END IF;
-- 
--   IF v_grupo IS NULL THEN
--     v_res := 'sem_grupo';
--   ELSE
--     SELECT u.id INTO v_ger FROM public.usuarios u JOIN public.user_roles ur ON ur.user_id = u.id
--      WHERE ur.role IN ('gestor'::public.app_role, 'admin'::public.app_role) AND u.ativo IS NOT FALSE
--      ORDER BY (ur.role = 'gestor'::public.app_role) DESC, u.nome LIMIT 1;
--     v_fila := public.enfileirar_notificacao('whatsapp', v_grupo, NULL, 'aviso_grupo_equipe', 'usuario',
--                 COALESCE(v_ger, md5('parceiros_sem_contato')::uuid), 'aviso_grupo_equipe',
--                 jsonb_build_object('texto', v_texto, 'mencionar', to_jsonb(v_tel)),
--                 'parceiros_sem_contato:grupo:' || v_hoje);
--     v_res := CASE WHEN v_fila IS NULL THEN 'ja_na_fila' ELSE 'enfileirado' END;
--   END IF;
-- 
--   INSERT INTO public.logs_auditoria (usuario_id, entidade, entidade_id, acao, detalhes)
--   VALUES (NULL, 'parceiros', NULL, CASE WHEN v_res = 'sem_grupo' THEN 'lembrete_sem_contato_falha' ELSE 'lembrete_sem_contato' END,
--           jsonb_build_object('dia', v_hoje, 'parceiros', v_n, 'resultado', v_res));
--   IF v_res = 'sem_grupo' THEN
--     RAISE WARNING 'lembrete de parceiros: grupo da equipe desligado ou inválido';
--   END IF;
--   RETURN jsonb_build_object('modo', 'enviando', 'dia', v_hoje, 'parceiros', v_n, 'resultado', v_res);
-- END $function$;
-- REVOKE ALL ON FUNCTION public.lembrete_parceiros_sem_contato(boolean, date) FROM PUBLIC, anon, authenticated;
-- GRANT EXECUTE ON FUNCTION public.lembrete_parceiros_sem_contato(boolean, date) TO service_role;
