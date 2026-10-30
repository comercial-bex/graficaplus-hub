-- Contatos do WhatsApp sem ruído, e o lead que acompanha o atendimento (diagnóstico final de 29/10/2026,
-- verificações 1.1 e 1.2 do sistema e 1.1 e 1.2 da operação).
--
-- O que a medição de 29/10 achou, e o que a leitura de 30/10 corrigiu:
--   * Dos 25 leads, 6 eram telefones da própria equipe e 5 já eram clientes cadastrados. O atendimento já ignora
--     o telefone da equipe desde 21/10 (`_wa_telefone_da_equipe`), mas `whatsapp_registrar_mensagem` continuava
--     criando lead para ele (os leads de 23/10 e 27/10 nasceram depois dessa data).
--   * "Nenhum com responsável nem próxima ação" era o REGISTRO do lead, parado em 'novo'. Na conversa, 9 dos 14
--     contatos de verdade já estavam sendo atendidos por gente (respostas humanas, responsável na conversa). O lead
--     nunca andava porque ninguém o atualiza: o trabalho acontece na caixa do WhatsApp.
--   * O aviso "Clientes esperando resposta no WhatsApp" já existia e cobre quem escreveu e espera. Faltava o
--     contrário: o contato dado como resolvido sem NENHUMA resposta da equipe (28/10, 22/10 e 06/10).
--
-- O que muda:
--   1. `whatsapp_registrar_mensagem` não cria lead para telefone da equipe (a conversa continua registrada).
--   2. `_wa_mensagem_antes_inserir`: a primeira resposta humana passa o lead de 'novo' para 'em_atendimento' e
--      grava quem respondeu como responsável (não mexe em lead já ganho ou perdido).
--   3. `pendencias_do_sistema` ganha 'whatsapp_encerrado_sem_resposta'.
--   4. Dados: lead de telefone da equipe vira 'perdido' com o motivo (não se apaga nada; os leads automáticos são
--      'temporario' e já ficam fora do funil); lead de quem já é cliente é ligado ao cliente e marcado 'ganho';
--      conversa de cliente cadastrado ganha o vínculo; lead com resposta humana vai para 'em_atendimento' com o
--      responsável que mais respondeu.
-- Idempotente: a segunda execução não acha mais nada a trocar nem a atualizar.
DO $migracao$
DECLARE
  v_oid oid;
  v_def text;
  v_antes int;
  v_ancora text;
  v_alerta text := $alerta$  -- Contato que escreveu e foi dado como resolvido sem nenhuma resposta da equipe (30/10/2026):
  -- três contatos reais (06/10, 22/10 e 28/10) ficaram assim e nenhum aviso olhava.
  RETURN QUERY SELECT 'whatsapp_encerrado_sem_resposta', 'Contatos de WhatsApp encerrados sem nenhuma resposta', count(*)::int,
    NULL::int, 'atencao', 'atendimento',
    'Encerrados sem resposta: ' || string_agg(
      coalesce(nullif(btrim(c.nome_contato), ''), c.telefone)
        || ' (' || to_char(u.ultima AT TIME ZONE 'America/Belem', 'DD/MM') || ')',
      ', ' ORDER BY u.ultima DESC)
      || '. Abra a conversa e responda; se não for cliente, marque o contato como perdido.',
    '/whatsapp-fila-humana'
  FROM public.whatsapp_conversas c
  CROSS JOIN LATERAL (
    SELECT max(m.recebido_em) AS ultima FROM public.whatsapp_mensagens m
     WHERE m.conversa_id = c.id AND m.direcao = 'entrada' AND m.tipo <> 'sistema'
       AND coalesce(m.origem, 'humano') <> 'automacao'
  ) u
  WHERE c.status IN ('resolvida', 'arquivada')
    AND u.ultima > now() - interval '30 days'
    AND NOT public._wa_telefone_da_equipe(c.telefone_normalizado)
    AND NOT EXISTS (SELECT 1 FROM public.whatsapp_mensagens m
                     WHERE m.conversa_id = c.id AND m.direcao = 'saida'
                       AND coalesce(m.origem, 'humano') IN ('humano', 'celular'))
    AND NOT EXISTS (SELECT 1 FROM public.leads l WHERE l.id = c.lead_id AND l.status IN ('ganho', 'perdido'))
  HAVING count(*) > 0;

$alerta$;
  v_lead_da_resposta text := $lead$      -- O lead acompanha o atendimento (30/10/2026): quem respondeu é o responsável e o contato
      -- deixa de ser "novo". Lead já ganho ou perdido não é mexido.
      IF c.lead_id IS NOT NULL THEN
        UPDATE public.leads
           SET status = CASE WHEN status = 'novo' THEN 'em_atendimento' ELSE status END,
               etapa = CASE WHEN status = 'novo' THEN 'em_atendimento' ELSE etapa END,
               responsavel_id = coalesce(responsavel_id, NEW.enviada_por)
         WHERE id = c.lead_id AND status NOT IN ('ganho', 'perdido');
      END IF;
    ELSIF NEW.origem = 'ia' THEN$lead$;
BEGIN
  -- 1. Telefone da equipe não vira lead.
  SELECT p.oid INTO v_oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'whatsapp_registrar_mensagem';
  v_def := pg_get_functiondef(v_oid);
  IF position('NOT public._wa_telefone_da_equipe(v_tel)' IN v_def) = 0 THEN
    v_ancora := $a$AND COALESCE(p_origem, 'humano') <> 'automacao' THEN$a$;
    v_antes := (length(v_def) - length(replace(v_def, v_ancora, ''))) / length(v_ancora);
    IF v_antes <> 1 THEN RAISE EXCEPTION 'whatsapp_registrar_mensagem: esperava 1 âncora, achei %', v_antes; END IF;
    EXECUTE replace(v_def, v_ancora, $n$AND COALESCE(p_origem, 'humano') <> 'automacao'
       AND NOT public._wa_telefone_da_equipe(v_tel) THEN$n$);
  END IF;

  -- 2. O lead acompanha a primeira resposta humana.
  SELECT p.oid INTO v_oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = '_wa_mensagem_antes_inserir';
  v_def := pg_get_functiondef(v_oid);
  IF position('c.lead_id IS NOT NULL' IN v_def) = 0 THEN
    v_ancora := $a$    ELSIF NEW.origem = 'ia' THEN$a$;
    v_antes := (length(v_def) - length(replace(v_def, v_ancora, ''))) / length(v_ancora);
    IF v_antes <> 1 THEN RAISE EXCEPTION '_wa_mensagem_antes_inserir: esperava 1 âncora, achei %', v_antes; END IF;
    EXECUTE replace(v_def, v_ancora, v_lead_da_resposta);
  END IF;

  -- 3. O aviso do contato encerrado sem resposta.
  SELECT p.oid INTO v_oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'pendencias_do_sistema';
  v_def := pg_get_functiondef(v_oid);
  IF position('whatsapp_encerrado_sem_resposta' IN v_def) = 0 THEN
    v_ancora := $a$  -- Reembolsos esperando decisão (15/10/2026): a gerência$a$;
    v_antes := (length(v_def) - length(replace(v_def, v_ancora, ''))) / length(v_ancora);
    IF v_antes <> 1 THEN RAISE EXCEPTION 'pendencias_do_sistema: esperava 1 âncora, achei %', v_antes; END IF;
    EXECUTE replace(v_def, v_ancora, v_alerta || v_ancora);
  END IF;

  -- 4. Dados.
  -- 4a. Telefone da equipe não é cliente novo (não se apaga: o lead automático é 'temporario' e já fica fora do funil).
  UPDATE public.leads l
     SET status = 'perdido', etapa = 'perdido',
         motivo_perda = coalesce(l.motivo_perda, 'Telefone da equipe: não é cliente novo')
   WHERE l.temporario IS TRUE AND l.status = 'novo' AND l.cliente_id IS NULL
     AND public._wa_telefone_da_equipe(l.telefone_normalizado);

  -- 4b. Quem já é cliente cadastrado (um só, ativo): o lead liga ao cliente e fecha como ganho.
  WITH telefones AS (
    SELECT c.id AS cliente_id, c.telefone_normalizado AS tel FROM public.clientes c WHERE c.ativo IS NOT FALSE
    UNION
    SELECT c.id, public.normalize_whatsapp_phone(c.whatsapp_principal) FROM public.clientes c WHERE c.ativo IS NOT FALSE
    UNION
    SELECT cc.cliente_id, public.normalize_whatsapp_phone(cc.telefone)
      FROM public.cliente_contatos cc JOIN public.clientes cl ON cl.id = cc.cliente_id AND cl.ativo IS NOT FALSE
  ), achados AS (
    SELECT l.id AS lead_id, (array_agg(DISTINCT t.cliente_id))[1] AS cliente_id, count(DISTINCT t.cliente_id) AS n
      FROM public.leads l JOIN telefones t ON t.tel = l.telefone_normalizado
     WHERE l.status = 'novo' AND l.cliente_id IS NULL AND l.telefone_normalizado IS NOT NULL
     GROUP BY l.id
  )
  UPDATE public.leads l
     SET cliente_id = a.cliente_id, status = 'ganho', etapa = 'ganho', convertido_em = coalesce(l.convertido_em, now())
    FROM achados a WHERE a.lead_id = l.id AND a.n = 1;

  -- 4c. Conversa de cliente cadastrado, sem o vínculo.
  WITH telefones AS (
    SELECT c.id AS cliente_id, c.telefone_normalizado AS tel FROM public.clientes c WHERE c.ativo IS NOT FALSE
    UNION
    SELECT c.id, public.normalize_whatsapp_phone(c.whatsapp_principal) FROM public.clientes c WHERE c.ativo IS NOT FALSE
    UNION
    SELECT cc.cliente_id, public.normalize_whatsapp_phone(cc.telefone)
      FROM public.cliente_contatos cc JOIN public.clientes cl ON cl.id = cc.cliente_id AND cl.ativo IS NOT FALSE
  ), achados AS (
    SELECT cv.id AS conversa_id, (array_agg(DISTINCT t.cliente_id))[1] AS cliente_id, count(DISTINCT t.cliente_id) AS n
      FROM public.whatsapp_conversas cv JOIN telefones t ON t.tel = cv.telefone_normalizado
     WHERE cv.cliente_id IS NULL
     GROUP BY cv.id
  )
  UPDATE public.whatsapp_conversas cv SET cliente_id = a.cliente_id
    FROM achados a WHERE a.conversa_id = cv.id AND a.n = 1;

  -- 4d. Lead que já está sendo atendido por gente: 'em_atendimento', com o responsável que mais respondeu.
  UPDATE public.leads l
     SET status = 'em_atendimento', etapa = 'em_atendimento',
         responsavel_id = coalesce(l.responsavel_id, r.responsavel)
    FROM (
      SELECT cv.lead_id,
             (SELECT m.enviada_por FROM public.whatsapp_mensagens m
               WHERE m.conversa_id = cv.id AND m.direcao = 'saida' AND m.enviada_por IS NOT NULL
               GROUP BY m.enviada_por ORDER BY count(*) DESC, max(m.enviado_em) DESC LIMIT 1) AS responsavel
        FROM public.whatsapp_conversas cv
       WHERE cv.lead_id IS NOT NULL
         AND EXISTS (SELECT 1 FROM public.whatsapp_mensagens m
                      WHERE m.conversa_id = cv.id AND m.direcao = 'saida'
                        AND coalesce(m.origem, 'humano') IN ('humano', 'celular'))
    ) r
   WHERE l.id = r.lead_id AND l.status = 'novo';
END
$migracao$;
