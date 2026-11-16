-- =====================================================================================================
-- PARCEIRO NUNCA ESQUECIDO (16/11/2026) — NAO APLICADA
-- Proposta. Nada e enviado na aplicacao: so cria colunas, funcoes e dois jobs do pg_cron. As mensagens
-- saem nos horarios abaixo, se houver lista.
--
-- 1) parceiros.e_teste (padrao false). Marca TESTE Parceiro (76340bf3-...). Parceiro de teste fica fora
--    dos publicos de aviso (_parceiro_aviso_publico), dos dois lembretes e da lista de atendimento.
--    parceiro_marcar_teste(p_parceiro, p_teste) com parceiros.manage.
-- 2) parceiros_sem_contato(): leitura com parceiros.read. Por parceiro ativo, nao teste, com chamado aberto.
--    MENSAGEM HUMANA DA EQUIPE (conferido no banco em 16/11/2026, whatsapp_mensagens):
--      direcao='saida' e status<>'falha' e
--        (origem='humano' E enviada_por preenchido)  -> digitada por pessoa no sistema (1.391 no banco)
--        OU origem='celular'                         -> digitada no celular da empresa (9 no banco)
--      Fica de fora origem='automacao' (fila de avisos, robo: 126) e origem='ia'.
--    Entrada do parceiro: direcao='entrada' e origem<>'automacao'.
--    Sem contato = nenhuma mensagem humana da equipe desde que o chamado abriu (desde = aberto_em),
--    OU o parceiro escreveu depois da ultima resposta (desde = ultima entrada), ha mais de N horas
--    (parceiro_programa.lembrete_equipe_horas, padrao 48).
-- 3) lembrete_parceiros_sem_contato(): cron 12:10 UTC (09:10 Macapa), seg a sab. UMA mensagem no grupo
--    da equipe, agrupada por responsavel, citando responsaveis e gestor, ate 15 linhas e 'E mais N.'.
--    Chave 'parceiros_sem_contato:grupo:<data>'. Lista vazia = nao manda nada (para sozinho).
-- 4) lembrete_credito_vencendo(): cron 13:15 UTC (10:15 Macapa), seg a sab. Template novo
--    parceiro_credito_vencendo, chave 'parceiro_credito_vencendo:<lancamento>' (uma vez por credito).
--    Conta na regra de 1 aviso por semana: _parceiro_aviso_publico passa a ver esse envio em ultimo_aviso.
-- 5) CORRECAO (achado ao conferir): parceiro_aviso_enviar gravava entidade 'parceiro_aviso' na fila, que o
--    CHECK notificacoes_fila_entidade_check recusa; o 1o aviso real daria erro e nada sairia. Passa a
--    gravar entidade 'parceiro' com o id do parceiro. Linha marcada [entidade].
--
-- Funcoes existentes que mudam (md5 de btrim(regexp_replace(prosrc,'\s+',' ','g')), vivo em 16/11/2026):
--   _parceiro_aviso_publico(text)   fa9221d356e550d335ab657601c05124
--   parceiro_aviso_enviar(uuid,uuid[]) 91818ac5da8a0499e1807ef23c117d35
-- Nao toca em lembretes_da_equipe, nem em funcao do WhatsApp ou da triagem, nem em permissoes.
-- =====================================================================================================

-- 1) Colunas -------------------------------------------------------------------------------------------
ALTER TABLE public.parceiros ADD COLUMN IF NOT EXISTS e_teste boolean NOT NULL DEFAULT false;
UPDATE public.parceiros SET e_teste = true WHERE id = '76340bf3-1c0c-40fd-84dc-cf3176a4e57c';

ALTER TABLE public.parceiro_programa
  ADD COLUMN IF NOT EXISTS lembrete_equipe_ativo boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS lembrete_equipe_horas integer NOT NULL DEFAULT 48
    CHECK (lembrete_equipe_horas BETWEEN 1 AND 720),
  ADD COLUMN IF NOT EXISTS lembrete_credito_ativo boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS lembrete_credito_dias integer NOT NULL DEFAULT 7
    CHECK (lembrete_credito_dias BETWEEN 1 AND 60);

-- 1b) Marcar conta de teste ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.parceiro_marcar_teste(p_parceiro uuid, p_teste boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$
BEGIN
  PERFORM public.require_permission('parceiros.manage');
  UPDATE public.parceiros SET e_teste = COALESCE(p_teste, false), updated_at = now() WHERE id = p_parceiro;
  IF NOT FOUND THEN RAISE EXCEPTION 'Parceiro não encontrado.'; END IF;
END $f$;
REVOKE ALL ON FUNCTION public.parceiro_marcar_teste(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.parceiro_marcar_teste(uuid, boolean) TO authenticated, service_role;

-- 1c) Publico dos avisos: sem teste [teste] e com o lembrete de credito na janela de 7 dias [credito] -----
CREATE OR REPLACE FUNCTION public._parceiro_aviso_publico(p_publico text)
 RETURNS TABLE(id uuid, nome text, telefone text, credito numeric, comprou boolean, ultimo_aviso timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
 SELECT p.id, coalesce(nullif(btrim(p.marca_nome),''),c.nome,'Parceiro'),
 public._parceiro_celular(p.id), s.disponivel, b.comprou,
 GREATEST( -- [credito]
 (SELECT max(coalesce(f.enviado_em,f.created_at)) FROM public.parceiro_aviso_envios e
 JOIN public.notificacoes_fila f ON f.id=e.notificacao_id
 WHERE e.parceiro_id=p.id AND f.status<>'cancelado'),
 (SELECT max(coalesce(f.enviado_em,f.created_at)) FROM public.notificacoes_fila f -- [credito]
 WHERE f.entidade='parceiro' AND f.entidade_id=p.id AND f.evento='parceiro_credito_vencendo' AND f.status<>'cancelado'))
 FROM public.parceiros p LEFT JOIN public.clientes c ON c.id=p.cliente_id
 CROSS JOIN LATERAL (SELECT EXISTS(SELECT 1 FROM public.orcamentos o
 WHERE o.cliente_id=p.cliente_id AND o.status::text IN ('aprovado','convertido')) AS comprou) b
 CROSS JOIN LATERAL (SELECT greatest(coalesce(sum(pc.valor),0)-greatest(least(coalesce(sum(pc.valor),0),
  coalesce(sum(pc.valor) FILTER(WHERE pc.valor>0 AND pc.expira_em<=now()),0)
 -coalesce(-sum(pc.valor) FILTER(WHERE pc.valor<0 AND pc.tipo<>'expirado'),0)
 -coalesce(-sum(pc.valor) FILTER(WHERE pc.tipo='expirado'),0)),0),0) AS disponivel
 FROM public.parceiro_creditos pc WHERE pc.parceiro_id=p.id) s
 WHERE p.status='ativo' AND p.nao_receber_avisos_em IS NULL
 AND NOT p.e_teste -- [teste]
 AND public._parceiro_celular(p.id) IS NOT NULL
 AND (p_publico='ativos' OR (p_publico='sem_compra' AND NOT b.comprou)
 OR (p_publico='com_credito' AND s.disponivel>0)
 OR (p_publico='terceirizados' AND b.comprou))
 ORDER BY 2,p.id
$function$;
REVOKE ALL ON FUNCTION public._parceiro_aviso_publico(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._parceiro_aviso_publico(text) TO service_role;

-- 5) parceiro_aviso_enviar: entidade aceita pela fila [entidade] ---------------------------------------
CREATE OR REPLACE FUNCTION public.parceiro_aviso_enviar(p_aviso uuid, p_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid:=public.require_permission('parceiros.manage'); a public.parceiro_avisos%ROWTYPE;
 r record; v_id uuid; v_fila uuid; v_texto text; v_motivo text;
 enviados jsonb:='[]'; recusados jsonb:='[]'; v_total integer:=0;
BEGIN
 SELECT * INTO a FROM public.parceiro_avisos WHERE id=p_aviso FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Aviso não encontrado.'; END IF;
 IF cardinality(p_ids) IS NULL OR cardinality(p_ids)=0 OR cardinality(p_ids)>50 THEN
 RAISE EXCEPTION 'Escolha entre 1 e 50 parceiros por aviso.'; END IF;
 IF a.status<>'rascunho' THEN RAISE EXCEPTION 'Este aviso já foi enviado ou cancelado.'; END IF;
 FOR v_id IN SELECT DISTINCT unnest(p_ids) LOOP
  -- Serializa avisos distintos para o mesmo parceiro: a janela de 7 dias não pode ser contornada.
  PERFORM pg_advisory_xact_lock(hashtext('parceiro_aviso'),hashtext(v_id::text));
  PERFORM 1 FROM public.parceiros WHERE id=v_id FOR UPDATE;
  SELECT * INTO r FROM public._parceiro_aviso_publico(a.publico) WHERE id=v_id;
  v_motivo:=NULL;
  IF NOT FOUND THEN v_motivo:='Fora do público, inativo, sem celular válido ou pediu para sair.';
  ELSIF r.ultimo_aviso>now()-interval '7 days' THEN v_motivo:='Já recebeu aviso há menos de 7 dias.'; END IF;
  IF v_motivo IS NOT NULL THEN
   recusados:=recusados||jsonb_build_array(jsonb_build_object('parceiro_id',v_id,'motivo',v_motivo)); CONTINUE;
  END IF;
  -- Substituição única: valores inseridos não são reinterpretados como variáveis.
  v_texto:=replace(a.texto,'{{credito}}','R$ '||replace(to_char(r.credito,'FM999999990.00'),'.',','));
  v_texto:=replace(v_texto,'{{link}}','https://bexprint.com.br/login?como=parceiro');
  v_texto:=regexp_replace(v_texto,'\{\{nome\}\}',replace(split_part(btrim(r.nome),' ',1),'\','\\'),'g');
  v_texto:=v_texto||E'\n\nPara não receber estes avisos, responda SAIR.';
  v_fila:=public.enfileirar_notificacao('whatsapp',r.telefone,
   (SELECT cliente_id FROM public.parceiros WHERE id=v_id),'parceiro_aviso','parceiro',v_id, -- [entidade]
   'parceiro_aviso',jsonb_build_object('texto',v_texto),'parceiro_aviso:'||a.id||':'||v_id);
  IF v_fila IS NULL THEN
   recusados:=recusados||jsonb_build_array(jsonb_build_object('parceiro_id',v_id,'motivo','Aviso já enfileirado.')); CONTINUE;
  END IF;
  INSERT INTO public.parceiro_aviso_envios VALUES(a.id,v_id,v_fila);
  enviados:=enviados||jsonb_build_array(jsonb_build_object('parceiro_id',v_id,'notificacao_id',v_fila));
  v_total:=v_total+1;
 END LOOP;
 UPDATE public.parceiro_avisos SET status='enviado',enviado_por=v_uid,enviado_em=now(),total=v_total WHERE id=a.id;
 RETURN jsonb_build_object('enviados',enviados,'recusados',recusados);
END $function$;

-- 2) Quem esta sem contato -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._parceiros_sem_contato()
RETURNS TABLE (parceiro_id uuid, nome text, responsavel_id uuid, responsavel_nome text, responsavel_tel text,
               conversa_id uuid, atendimento_id uuid, aberto_em timestamptz, ultima_saida_equipe timestamptz,
               ultima_entrada timestamptz, desde timestamptz, horas_sem_contato integer, sem_contato boolean,
               credito numeric, credito_vence_em timestamptz, comprou boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $f$
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
    SELECT b.*, a.id AS at_id, a.conversa_id AS conv, a.aberto_em AS aberto, a.resp
      FROM base b
      JOIN LATERAL (
        SELECT t.id, t.conversa_id, t.aberto_em, COALESCE(t.responsavel_id, w.responsavel_id) AS resp
          FROM public.whatsapp_conversas w
          JOIN public.whatsapp_atendimentos t ON t.conversa_id = w.id AND t.fechado_em IS NULL
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
           WHEN msg.entrada > msg.saida THEN msg.entrada END AS desde_
      FROM msg
  )
  SELECT k.id, k.nome, k.resp, u.nome,
         CASE WHEN public.normalize_whatsapp_phone(u.telefone) ~ '^[0-9]{10,11}$' THEN public.normalize_whatsapp_phone(u.telefone) END,
         k.conv, k.at_id, k.aberto, k.saida, k.entrada, k.desde_,
         CASE WHEN k.desde_ IS NOT NULL THEN floor(extract(epoch FROM now() - k.desde_) / 3600)::integer END,
         COALESCE(k.desde_ < now() - make_interval(hours => (SELECT h FROM prog)), false),
         s.disponivel, e.vence, b2.comprou
    FROM calc k
    LEFT JOIN public.usuarios u ON u.id = k.resp
    CROSS JOIN LATERAL (SELECT EXISTS (SELECT 1 FROM public.orcamentos o
                         WHERE o.cliente_id = k.cliente_id AND o.status::text IN ('aprovado','convertido')) AS comprou) b2
    CROSS JOIN LATERAL (SELECT min(pc.expira_em) AS vence FROM public.parceiro_creditos pc
                         WHERE pc.parceiro_id = k.id AND pc.tipo = 'entrada' AND pc.expira_em > now()) e
    CROSS JOIN LATERAL (SELECT greatest(coalesce(sum(pc.valor),0)-greatest(least(coalesce(sum(pc.valor),0),
       coalesce(sum(pc.valor) FILTER(WHERE pc.valor>0 AND pc.expira_em<=now()),0)
      -coalesce(-sum(pc.valor) FILTER(WHERE pc.valor<0 AND pc.tipo<>'expirado'),0)
      -coalesce(-sum(pc.valor) FILTER(WHERE pc.tipo='expirado'),0)),0),0) AS disponivel
       FROM public.parceiro_creditos pc WHERE pc.parceiro_id = k.id) s
$f$;
REVOKE ALL ON FUNCTION public._parceiros_sem_contato() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._parceiros_sem_contato() TO service_role;

CREATE OR REPLACE FUNCTION public.parceiros_sem_contato()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $f$
BEGIN
  PERFORM public.require_permission('parceiros.read');
  RETURN jsonb_build_object(
    'horas', COALESCE((SELECT g.lembrete_equipe_horas FROM public.parceiro_programa g LIMIT 1), 48),
    'lista', COALESCE((SELECT jsonb_agg(to_jsonb(t) - 'responsavel_tel'
                         ORDER BY t.sem_contato DESC, t.responsavel_nome NULLS LAST, t.horas_sem_contato DESC NULLS LAST, t.nome)
                         FROM public._parceiros_sem_contato() t), '[]'::jsonb));
END $f$;
REVOKE ALL ON FUNCTION public.parceiros_sem_contato() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.parceiros_sem_contato() TO authenticated, service_role;

-- 3) Lembrete a equipe ---------------------------------------------------------------------------------
-- Texto (espelhado em src/domain/parceiros/sem-contato.ts, montarLembreteEquipe):
--   Bom dia! {n} parceiro(s) sem contato da equipe há mais de {H} horas:
--   (linha vazia)
--   {Responsável} @{tel}
--   - {Nome} · {h}h[ · crédito R$ X até dd/mm]
--   ...                     (no máximo 15 linhas de parceiro; o resto vira "E mais N.")
--   (linha vazia)
--   Gestor @{tel} acompanhe.
--   Ver a lista: https://bexprint.com.br/parceiros
CREATE OR REPLACE FUNCTION public.lembrete_parceiros_sem_contato(p_enfileirar boolean DEFAULT true, p_hoje date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$
DECLARE
  c_limite constant integer := 15;
  v_hoje date := COALESCE(p_hoje, public.hoje_br());
  v_ativo boolean;
  v_horas integer;
  v_grupo text := public.grupo_equipe_destino();
  v_n integer := 0;
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

  FOR r IN
    SELECT t.* FROM public._parceiros_sem_contato() t WHERE t.sem_contato
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
  IF v_n > c_limite THEN
    v_corpo := v_corpo || E'\nE mais ' || (v_n - c_limite) || '.';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT '55' || x.tel), ARRAY[]::text[]) INTO v_ger_tel
    FROM (SELECT public.normalize_whatsapp_phone(u.telefone) AS tel FROM public.usuarios u
           WHERE u.ativo IS NOT FALSE AND EXISTS (SELECT 1 FROM public.user_roles ur
                 WHERE ur.user_id = u.id AND ur.role = 'gestor'::public.app_role)) x
   WHERE x.tel ~ '^[0-9]{10,11}$';

  v_texto := 'Bom dia! ' || v_n || CASE WHEN v_n = 1 THEN ' parceiro' ELSE ' parceiros' END
             || ' sem contato da equipe há mais de ' || v_horas || E' horas:\n\n' || v_corpo || E'\n\n'
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
END $f$;
REVOKE ALL ON FUNCTION public.lembrete_parceiros_sem_contato(boolean, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lembrete_parceiros_sem_contato(boolean, date) TO service_role;

-- 4) Lembrete do credito ao parceiro -------------------------------------------------------------------
INSERT INTO public.notificacao_templates (evento, canal, descricao, corpo, ativo)
VALUES ('parceiro_credito_vencendo', 'whatsapp', 'Lembrete ao parceiro de que o crédito de entrada vai vencer',
        E'Oi, {{nome}}! Seu crédito de {{credito}} na Bex Print vence em {{data}}. Ele vale na sua 1ª compra a partir de {{minimo}} em produtos. Tem algum serviço na mão? É só responder aqui.\n\nPara não receber estes avisos, responda SAIR.',
        true)
ON CONFLICT (evento) DO NOTHING;

CREATE OR REPLACE FUNCTION public.lembrete_credito_vencendo(p_enfileirar boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$
DECLARE
  v_ativo boolean;
  v_dias integer;
  v_minimo numeric;
  v_fila uuid;
  v_vars jsonb;
  v_enviados integer := 0;
  v_lista jsonb := '[]'::jsonb;
  r record;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'Só o agendamento roda o lembrete de crédito.' USING ERRCODE = '42501';
  END IF;
  SELECT g.lembrete_credito_ativo, g.lembrete_credito_dias, g.entrada_pedido_minimo
    INTO v_ativo, v_dias, v_minimo FROM public.parceiro_programa g LIMIT 1;
  v_ativo := COALESCE(v_ativo, true); v_dias := COALESCE(v_dias, 7); v_minimo := COALESCE(v_minimo, 150);
  IF NOT v_ativo THEN
    RETURN jsonb_build_object('enviou', false, 'motivo', 'desligado');
  END IF;

  -- _parceiro_aviso_publico('sem_compra') ja filtra: ativo, nao teste, sem nao_receber_avisos_em,
  -- celular valido e nenhum orcamento aprovado ou convertido. ultimo_aviso inclui este lembrete.
  FOR r IN
    SELECT DISTINCT ON (a.id) a.id AS parceiro_id, a.nome, a.telefone, a.credito, pc.id AS lancamento,
           pc.expira_em, p.cliente_id
      FROM public._parceiro_aviso_publico('sem_compra') a
      JOIN public.parceiros p ON p.id = a.id
      JOIN public.parceiro_creditos pc ON pc.parceiro_id = a.id AND pc.tipo = 'entrada'
       AND pc.expira_em > now() AND pc.expira_em <= now() + make_interval(days => v_dias)
     WHERE a.credito > 0
       AND (a.ultimo_aviso IS NULL OR a.ultimo_aviso <= now() - interval '7 days')
       AND NOT EXISTS (SELECT 1 FROM public.notificacoes_fila f
                        WHERE f.idempotency_key = 'parceiro_credito_vencendo:' || pc.id)
     ORDER BY a.id, pc.expira_em
  LOOP
    v_vars := jsonb_build_object(
      'nome', split_part(btrim(r.nome), ' ', 1),
      'credito', 'R$ ' || replace(to_char(r.credito, 'FM999999990.00'), '.', ','),
      'data', to_char(r.expira_em AT TIME ZONE 'America/Belem', 'DD/MM'),
      'minimo', 'R$ ' || replace(to_char(v_minimo, 'FM999999990.00'), '.', ','));
    v_lista := v_lista || jsonb_build_array(jsonb_build_object('parceiro_id', r.parceiro_id) || v_vars);
    IF p_enfileirar THEN
      PERFORM pg_advisory_xact_lock(hashtext('parceiro_aviso'), hashtext(r.parceiro_id::text));
      v_fila := public.enfileirar_notificacao('whatsapp', r.telefone, r.cliente_id, 'parceiro_credito_vencendo',
                  'parceiro', r.parceiro_id, 'parceiro_credito_vencendo', v_vars,
                  'parceiro_credito_vencendo:' || r.lancamento);
      IF v_fila IS NOT NULL THEN v_enviados := v_enviados + 1; END IF;
    END IF;
  END LOOP;

  IF NOT p_enfileirar THEN
    RETURN jsonb_build_object('modo', 'seco', 'lista', v_lista);
  END IF;
  IF v_enviados > 0 THEN
    INSERT INTO public.logs_auditoria (usuario_id, entidade, entidade_id, acao, detalhes)
    VALUES (NULL, 'parceiros', NULL, 'lembrete_credito_vencendo', jsonb_build_object('enfileirados', v_enviados));
  END IF;
  RETURN jsonb_build_object('modo', 'enviando', 'enfileirados', v_enviados);
END $f$;
REVOKE ALL ON FUNCTION public.lembrete_credito_vencendo(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lembrete_credito_vencendo(boolean) TO service_role;

-- 3 e 4) Agendamento. O banco roda em UTC: 12:10 e 13:15 sao 09:10 e 10:15 em Macapa. --------------------
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'parceiros-sem-contato') THEN
    PERFORM cron.unschedule('parceiros-sem-contato');
  END IF;
  PERFORM cron.schedule('parceiros-sem-contato', '10 12 * * 1-6', 'SELECT public.lembrete_parceiros_sem_contato()');
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'parceiro-credito-vencendo') THEN
    PERFORM cron.unschedule('parceiro-credito-vencendo');
  END IF;
  PERFORM cron.schedule('parceiro-credito-vencendo', '15 13 * * 1-6', 'SELECT public.lembrete_credito_vencendo()');
END
$cron$;

-- Conferencia final: a migracao para (e desfaz tudo) se algo nao ficou como deveria. ---------------------
DO $confere$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['public._parceiros_sem_contato()', 'public.lembrete_parceiros_sem_contato(boolean, date)',
                           'public.lembrete_credito_vencendo(boolean)', 'public._parceiro_aviso_publico(text)'] LOOP
    IF has_function_privilege('anon', f, 'EXECUTE') OR has_function_privilege('authenticated', f, 'EXECUTE')
       OR NOT has_function_privilege('service_role', f, 'EXECUTE') THEN
      RAISE EXCEPTION 'ACL errada em %', f;
    END IF;
  END LOOP;
  FOREACH f IN ARRAY ARRAY['public.parceiros_sem_contato()', 'public.parceiro_marcar_teste(uuid, boolean)',
                           'public.parceiro_aviso_enviar(uuid, uuid[])'] LOOP
    IF has_function_privilege('anon', f, 'EXECUTE') OR NOT has_function_privilege('authenticated', f, 'EXECUTE') THEN
      RAISE EXCEPTION 'ACL errada em %', f;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'parceiros-sem-contato' AND active AND schedule = '10 12 * * 1-6')
     OR NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'parceiro-credito-vencendo' AND active AND schedule = '15 13 * * 1-6') THEN
    RAISE EXCEPTION 'agendamento não ficou ativo';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.parceiros WHERE id = '76340bf3-1c0c-40fd-84dc-cf3176a4e57c' AND e_teste) THEN
    RAISE EXCEPTION 'parceiro de teste não ficou marcado';
  END IF;
END
$confere$;

-- =====================================================================================================
-- DESFAZER (comentado). Rodar na ordem, removendo o "-- " do inicio de cada linha.
-- =====================================================================================================
-- SELECT cron.unschedule('parceiros-sem-contato');
-- SELECT cron.unschedule('parceiro-credito-vencendo');
-- DROP FUNCTION IF EXISTS public.lembrete_credito_vencendo(boolean);
-- DROP FUNCTION IF EXISTS public.lembrete_parceiros_sem_contato(boolean, date);
-- DROP FUNCTION IF EXISTS public.parceiros_sem_contato();
-- DROP FUNCTION IF EXISTS public._parceiros_sem_contato();
-- DROP FUNCTION IF EXISTS public.parceiro_marcar_teste(uuid, boolean);
-- UPDATE public.notificacao_templates SET ativo = false WHERE evento = 'parceiro_credito_vencendo';
--
-- Corpo vivo de _parceiro_aviso_publico(text), md5 fa9221d356e550d335ab657601c05124:
-- CREATE OR REPLACE FUNCTION public._parceiro_aviso_publico(p_publico text)
--  RETURNS TABLE(id uuid, nome text, telefone text, credito numeric, comprou boolean, ultimo_aviso timestamp with time zone)
--  LANGUAGE sql
--  STABLE SECURITY DEFINER
--  SET search_path TO 'public'
-- AS $function$
--  SELECT p.id, coalesce(nullif(btrim(p.marca_nome),''),c.nome,'Parceiro'),
--  public._parceiro_celular(p.id), s.disponivel, b.comprou,
--  (SELECT max(coalesce(f.enviado_em,f.created_at)) FROM public.parceiro_aviso_envios e
--  JOIN public.notificacoes_fila f ON f.id=e.notificacao_id
--  WHERE e.parceiro_id=p.id AND f.status<>'cancelado')
--  FROM public.parceiros p LEFT JOIN public.clientes c ON c.id=p.cliente_id
--  CROSS JOIN LATERAL (SELECT EXISTS(SELECT 1 FROM public.orcamentos o
--  WHERE o.cliente_id=p.cliente_id AND o.status::text IN ('aprovado','convertido')) AS comprou) b
--  CROSS JOIN LATERAL (SELECT greatest(coalesce(sum(pc.valor),0)-greatest(least(coalesce(sum(pc.valor),0),
--   coalesce(sum(pc.valor) FILTER(WHERE pc.valor>0 AND pc.expira_em<=now()),0)
--  -coalesce(-sum(pc.valor) FILTER(WHERE pc.valor<0 AND pc.tipo<>'expirado'),0)
--  -coalesce(-sum(pc.valor) FILTER(WHERE pc.tipo='expirado'),0)),0),0) AS disponivel
--  FROM public.parceiro_creditos pc WHERE pc.parceiro_id=p.id) s
--  WHERE p.status='ativo' AND p.nao_receber_avisos_em IS NULL
--  AND public._parceiro_celular(p.id) IS NOT NULL
--  AND (p_publico='ativos' OR (p_publico='sem_compra' AND NOT b.comprou)
--  OR (p_publico='com_credito' AND s.disponivel>0)
--  OR (p_publico='terceirizados' AND b.comprou))
--  ORDER BY 2,p.id
-- $function$
-- 
-- ;
--
-- Corpo vivo de parceiro_aviso_enviar(uuid,uuid[]), md5 91818ac5da8a0499e1807ef23c117d35:
-- CREATE OR REPLACE FUNCTION public.parceiro_aviso_enviar(p_aviso uuid, p_ids uuid[])
--  RETURNS jsonb
--  LANGUAGE plpgsql
--  SECURITY DEFINER
--  SET search_path TO 'public'
-- AS $function$
-- DECLARE v_uid uuid:=public.require_permission('parceiros.manage'); a public.parceiro_avisos%ROWTYPE;
--  r record; v_id uuid; v_fila uuid; v_texto text; v_motivo text;
--  enviados jsonb:='[]'; recusados jsonb:='[]'; v_total integer:=0;
-- BEGIN
--  SELECT * INTO a FROM public.parceiro_avisos WHERE id=p_aviso FOR UPDATE;
--  IF NOT FOUND THEN RAISE EXCEPTION 'Aviso não encontrado.'; END IF;
--  IF cardinality(p_ids) IS NULL OR cardinality(p_ids)=0 OR cardinality(p_ids)>50 THEN
--  RAISE EXCEPTION 'Escolha entre 1 e 50 parceiros por aviso.'; END IF;
--  IF a.status<>'rascunho' THEN RAISE EXCEPTION 'Este aviso já foi enviado ou cancelado.'; END IF;
--  FOR v_id IN SELECT DISTINCT unnest(p_ids) LOOP
--   -- Serializa avisos distintos para o mesmo parceiro: a janela de 7 dias não pode ser contornada.
--   PERFORM pg_advisory_xact_lock(hashtext('parceiro_aviso'),hashtext(v_id::text));
--   PERFORM 1 FROM public.parceiros WHERE id=v_id FOR UPDATE;
--   SELECT * INTO r FROM public._parceiro_aviso_publico(a.publico) WHERE id=v_id;
--   v_motivo:=NULL;
--   IF NOT FOUND THEN v_motivo:='Fora do público, inativo, sem celular válido ou pediu para sair.';
--   ELSIF r.ultimo_aviso>now()-interval '7 days' THEN v_motivo:='Já recebeu aviso há menos de 7 dias.'; END IF;
--   IF v_motivo IS NOT NULL THEN
--    recusados:=recusados||jsonb_build_array(jsonb_build_object('parceiro_id',v_id,'motivo',v_motivo)); CONTINUE;
--   END IF;
--   -- Substituição única: valores inseridos não são reinterpretados como variáveis.
--   v_texto:=replace(a.texto,'{{credito}}','R$ '||replace(to_char(r.credito,'FM999999990.00'),'.',','));
--   v_texto:=replace(v_texto,'{{link}}','https://bexprint.com.br/login?como=parceiro');
--   v_texto:=regexp_replace(v_texto,'\{\{nome\}\}',replace(split_part(btrim(r.nome),' ',1),'\','\\'),'g');
--   v_texto:=v_texto||E'\n\nPara não receber estes avisos, responda SAIR.';
--   v_fila:=public.enfileirar_notificacao('whatsapp',r.telefone,
--    (SELECT cliente_id FROM public.parceiros WHERE id=v_id),'parceiro_aviso','parceiro_aviso',a.id,
--    'parceiro_aviso',jsonb_build_object('texto',v_texto),'parceiro_aviso:'||a.id||':'||v_id);
--   IF v_fila IS NULL THEN
--    recusados:=recusados||jsonb_build_array(jsonb_build_object('parceiro_id',v_id,'motivo','Aviso já enfileirado.')); CONTINUE;
--   END IF;
--   INSERT INTO public.parceiro_aviso_envios VALUES(a.id,v_id,v_fila);
--   enviados:=enviados||jsonb_build_array(jsonb_build_object('parceiro_id',v_id,'notificacao_id',v_fila));
--   v_total:=v_total+1;
--  END LOOP;
--  UPDATE public.parceiro_avisos SET status='enviado',enviado_por=v_uid,enviado_em=now(),total=v_total WHERE id=a.id;
--  RETURN jsonb_build_object('enviados',enviados,'recusados',recusados);
-- END $function$
-- 
-- ;
--
-- As colunas novas (parceiros.e_teste, parceiro_programa.lembrete_*) ficam: nao sao lidas por mais nada.
-- Se quiser apagar: ALTER TABLE public.parceiros DROP COLUMN e_teste; ALTER TABLE public.parceiro_programa
--   DROP COLUMN lembrete_equipe_ativo, DROP COLUMN lembrete_equipe_horas, DROP COLUMN lembrete_credito_ativo,
--   DROP COLUMN lembrete_credito_dias;
