-- ============================================================================
-- WhatsApp, onda 1 (06/10/2026): entrada que não perde, saída que fica
-- registrada, telas que não mentem
-- ============================================================================
--
-- Diagnóstico de 06/10/2026 no banco vivo (46 eventos de webhook, 5
-- mensagens, 5 conversas, 3 avisos enviados, 0 mensagens de saída):
--
--   1. Os três avisos "orçamento aprovado" que SAÍRAM (05 e 06/10, entregues
--      segundo o Z-API) não existiam em whatsapp_mensagens: a conversa do
--      cliente não mostrava o que o sistema mandou, e o recibo não tinha linha
--      para marcar. → `whatsapp_registrar_mensagem` passa a ser chamada pelo
--      envio (lado do app) e ganha, aqui, o status de saída pelo recibo que já
--      chegou; a seção 6 reconstrói os três.
--   2. Três leads nasceram de mensagens de MODELO (template de empresa — Claro,
--      Renova Be, Kwai), gravadas como tipo 'sistema' sem texto. Um deles com
--      "telefone" 62895426250367 (14 dígitos: é o lid, não um número). → lead
--      só para mensagem humana; o receptor recusa mais de 13 dígitos (TS); a
--      seção 6 recupera o texto das três.
--   3. Um PDF de cliente está no bucket (977.421 bytes) sem linha em `arquivos`
--      e sem ponteiro na mensagem — a falha só voltou ao Z-API na resposta
--      HTTP. → o receptor (TS) grava o motivo e reprocessa sem duplicar; o
--      Monitor ganha a medida permanente (`whatsapp_medidas_de_entrada`).
--   4. `whatsapp_fila_envio` aceitava INSERT de qualquer pessoa da equipe com
--      `payload.para` apontando para qualquer número, e o consumidor mandava;
--      `whatsapp_webhook_eventos` aceitava INSERT/UPDATE/DELETE da equipe; e
--      `anon` tinha DML nas tabelas whatsapp_*. → seção 4.
--   5. O despachante só rodava no navegador de quem atende: 36 min a 2 h 14
--      de atraso, nada à noite. → pg_cron + pg_net chamam a rota do servidor a
--      cada 2 minutos (seção 5), com o token no Vault.
--   6. "Gerar novo endereço do webhook" e o cadastro inicial eram a mesma
--      chamada: um clique errado trocava o segredo e derrubava a recepção. →
--      `p_trocar_segredo` (seção 2).
--
-- CAIXA v3 (Lovable, 07/10/2026, drizzle/migrations/0001 e 0002 — fora de
-- supabase/migrations). O banco vivo ganhou filas, atendimentos (WA-AAMM-NNNN),
-- leituras, eventos, configurações e o gatilho `whatsapp_mensagens_atendimento`
-- (BEFORE INSERT → `_wa_mensagem_antes_inserir`), que abre um atendimento para
-- TODA mensagem de entrada e trata TODA saída sem `enviada_por` como resposta
-- digitada no celular (origem 'celular': zera a espera do cliente e põe a
-- conversa em modo humano). Esta onda convive com isso assim:
--   - o aviso automático que vira mensagem da conversa entra com
--     origem = 'automacao' (valor que o CHECK do dono já aceita e que o gatilho
--     dele ignora de propósito): não é resposta humana;
--   - mensagem de MODELO de empresa (hydratedTemplate: Claro, Kwai) entra com
--     origem = 'automacao' também, e nem a função nem o gatilho abrem lead ou
--     atendimento para ela — só para gente.
--
-- As funções alteradas foram copiadas de pg_proc.prosrc do banco vivo em
-- 07/10/2026 (md5 antes: whatsapp_registrar_mensagem
-- 73546bf690dd0c6c5d03f2c7166c53c0; whatsapp_configurar_instancia
-- 2cbd680aee828fb9730075d3e35c8518; _wa_mensagem_antes_inserir
-- bde1445fb363e2b3fbecbdaf0ccbec85) e só os blocos indicados mudam.
--
-- ORDEM DE APLICAÇÃO. Tudo aqui é seguro com o front antigo ou com o novo:
--   - seções 1, 3, 4 e 6 não dependem do front;
--   - seção 2: o front antigo chama sem p_trocar_segredo (default false) e só
--     o botão "Gerar novo endereço" fica recusado até o front novo subir —
--     que é exatamente o clique que a mudança protege;
--   - seção 4: o "Reenviar" do Monitor antigo (sem created_by) passa a ser
--     recusado pela policy até o front novo subir; o do novo grava created_by;
--   - seção 5: o job chama uma rota que, sem o front novo, responde 404 e,
--     sem DESPACHANTE_TOKEN no servidor, responde 503 — nos dois casos nada
--     muda e o despachante do navegador continua levando os avisos.
--
-- Ensaiado em 06/10/2026 com DO … RAISE EXCEPTION 'ENSAIO' (tudo desfeito):
-- ver o relatório da onda.

-- ---------------------------------------------------------------- 1
-- whatsapp_registrar_mensagem: lead só para mensagem humana; saída nasce com
-- o status do recibo que já chegou; quem mandou fica em `origem`.
--
-- A assinatura ganha `p_origem text DEFAULT 'humano'` (12º parâmetro). A
-- antiga, de 11, é APAGADA: com as duas, o PostgREST não saberia escolher. As
-- chamadas existentes (webhook) não passam o parâmetro e seguem iguais.
--
-- Mudanças em relação ao corpo vivo (e só elas):
--   (a) `IF v_lead_id IS NULL AND p_direcao = 'entrada'` ganha
--       `AND p_tipo IN ('texto','imagem','documento','audio','video',
--       'localizacao','contato') AND COALESCE(p_origem,'humano') <> 'automacao'`:
--       mensagem de sistema, figurinha e MODELO de empresa não abrem lead.
--       Cliente e conversa continuam sendo resolvidos como antes.
--   (b) para `p_direcao = 'saida'`, o status, `entregue_em` e `lido_em` vêm do
--       aviso de `notificacoes_fila` com o mesmo provider_message_id, quando
--       existe: o recibo do Z-API chega segundos depois do envio e pode
--       chegar ANTES de o remetente registrar a mensagem — sem isto a linha
--       nasceria "enviada" para sempre. Sem aviso correspondente (resposta da
--       caixa de entrada, mensagem digitada no celular), 'enviada' como antes.
--   (c) o INSERT grava `origem = COALESCE(p_origem, 'humano')` — a coluna da
--       caixa v3 (CHECK: humano | celular | automacao | ia). O gatilho do dono
--       continua convertendo 'humano' sem `enviada_por` em 'celular'.
DROP FUNCTION IF EXISTS public.whatsapp_registrar_mensagem(uuid, text, text, whatsapp_mensagem_direcao, whatsapp_mensagem_tipo, text, text, text, text, jsonb, timestamptz);

CREATE OR REPLACE FUNCTION public.whatsapp_registrar_mensagem(
  p_instancia_id uuid,
  p_zapi_message_id text,
  p_telefone text,
  p_direcao whatsapp_mensagem_direcao,
  p_tipo whatsapp_mensagem_tipo,
  p_texto text DEFAULT NULL,
  p_legenda text DEFAULT NULL,
  p_media_url text DEFAULT NULL,
  p_nome_contato text DEFAULT NULL,
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_momento timestamptz DEFAULT NULL,
  p_origem text DEFAULT 'humano'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tel text := public.normalize_whatsapp_phone(p_telefone);
  v_quando timestamptz := COALESCE(p_momento, now());
  v_nome text := NULLIF(btrim(p_nome_contato), '');
  v_resumo text;
  v_clientes uuid[];
  v_cliente_id uuid;
  v_lead_id uuid;
  v_lead_criado boolean := false;
  v_conversa public.whatsapp_conversas%ROWTYPE;
  v_mensagem_id uuid;
  v_status_saida public.whatsapp_mensagem_status;
  v_entregue_em timestamptz;
  v_lido_em timestamptz;
BEGIN
  IF v_tel IS NULL THEN
    RAISE EXCEPTION 'Telefone vazio: %', p_telefone;
  END IF;
  IF NULLIF(btrim(p_zapi_message_id), '') IS NULL THEN
    RAISE EXCEPTION 'Mensagem sem id do Z-API';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_instancia_id::text || ':' || p_zapi_message_id));

  IF EXISTS (
    SELECT 1 FROM public.whatsapp_mensagens
    WHERE instancia_id = p_instancia_id AND zapi_message_id = p_zapi_message_id
  ) THEN
    RETURN jsonb_build_object('duplicada', true);
  END IF;

  SELECT array_agg(DISTINCT c.id) INTO v_clientes
  FROM (
    SELECT id FROM public.clientes WHERE telefone_normalizado = v_tel
    UNION
    SELECT cliente_id FROM public.cliente_contatos
    WHERE public.normalize_whatsapp_phone(telefone) = v_tel
  ) c;
  IF COALESCE(array_length(v_clientes, 1), 0) = 1 THEN
    v_cliente_id := v_clientes[1];
  END IF;

  IF v_cliente_id IS NULL THEN
    SELECT id INTO v_lead_id
    FROM public.leads
    WHERE telefone_normalizado = v_tel AND temporario IS TRUE;

    IF v_lead_id IS NULL THEN
      SELECT CASE WHEN count(*) = 1 THEN (array_agg(id))[1] END INTO v_lead_id
      FROM public.leads
      WHERE telefone_normalizado = v_tel AND cliente_id IS NULL AND status NOT IN ('ganho','perdido');
    END IF;

    -- (a) Só quem ESCREVE para a empresa, com mensagem de gente, vira lead.
    -- Aviso de sistema (tipo 'sistema') e mensagem de MODELO de empresa
    -- (Claro, Kwai, Renova Be — origem 'automacao') não são interesse de
    -- ninguém: em 06/10/2026 três delas tinham virado lead.
    IF v_lead_id IS NULL AND p_direcao = 'entrada'
       AND p_tipo IN ('texto','imagem','documento','audio','video','localizacao','contato')
       AND COALESCE(p_origem, 'humano') <> 'automacao' THEN
      INSERT INTO public.leads (nome, telefone, telefone_original, origem, interesse, status, temporario)
      VALUES (
        COALESCE(v_nome, 'Lead WhatsApp ' || v_tel),
        p_telefone,
        p_telefone,
        'whatsapp',
        'Atendimento iniciado via WhatsApp',
        'novo',
        true
      )
      ON CONFLICT (telefone_normalizado) WHERE (temporario IS TRUE AND telefone_normalizado IS NOT NULL)
      DO NOTHING
      RETURNING id INTO v_lead_id;

      IF v_lead_id IS NOT NULL THEN
        v_lead_criado := true;
      ELSE
        SELECT id INTO v_lead_id
        FROM public.leads
        WHERE telefone_normalizado = v_tel AND temporario IS TRUE;
      END IF;
    END IF;
  END IF;

  v_resumo := left(COALESCE(p_texto, p_legenda, '[' || p_tipo::text || ']'), 500);

  INSERT INTO public.whatsapp_conversas AS c (
    instancia_id, telefone, nome_contato, cliente_id, lead_id,
    ultima_mensagem, ultima_mensagem_at, nao_lidas, status
  )
  VALUES (
    p_instancia_id, p_telefone, v_nome, v_cliente_id, v_lead_id,
    v_resumo, v_quando, CASE WHEN p_direcao = 'entrada' THEN 1 ELSE 0 END, 'aberta'
  )
  ON CONFLICT (instancia_id, telefone_normalizado) DO UPDATE SET
    nome_contato = COALESCE(c.nome_contato, EXCLUDED.nome_contato),
    cliente_id = COALESCE(c.cliente_id, EXCLUDED.cliente_id),
    lead_id = COALESCE(c.lead_id, EXCLUDED.lead_id),
    ultima_mensagem = CASE
      WHEN c.ultima_mensagem_at IS NULL OR EXCLUDED.ultima_mensagem_at >= c.ultima_mensagem_at
      THEN EXCLUDED.ultima_mensagem ELSE c.ultima_mensagem END,
    ultima_mensagem_at = GREATEST(c.ultima_mensagem_at, EXCLUDED.ultima_mensagem_at),
    nao_lidas = COALESCE(c.nao_lidas, 0) + EXCLUDED.nao_lidas,
    status = CASE
      WHEN p_direcao = 'entrada' AND c.status IN ('resolvida', 'arquivada') THEN 'aberta'::whatsapp_conversa_status
      ELSE c.status END
  RETURNING * INTO v_conversa;

  IF v_lead_criado THEN
    UPDATE public.leads SET conversa_id = v_conversa.id WHERE id = v_lead_id AND conversa_id IS NULL;
  END IF;

  -- (b) Saída: o recibo pode ter chegado antes do registro. O aviso da fila
  -- guarda o que o Z-API já disse desta mensagem.
  IF p_direcao = 'saida' THEN
    SELECT CASE n.provider_status
             WHEN 'lida' THEN 'lida'::public.whatsapp_mensagem_status
             WHEN 'entregue' THEN 'entregue'::public.whatsapp_mensagem_status
             ELSE 'enviada'::public.whatsapp_mensagem_status END,
           n.entregue_em, n.lido_em
      INTO v_status_saida, v_entregue_em, v_lido_em
    FROM public.notificacoes_fila n
    WHERE n.provider_message_id = p_zapi_message_id
    ORDER BY n.enviado_em DESC NULLS LAST
    LIMIT 1;
  END IF;

  INSERT INTO public.whatsapp_mensagens (
    conversa_id, instancia_id, zapi_message_id, direcao, tipo, status,
    texto, legenda, media_url, cliente_id, os_id, payload, recebido_em, enviado_em,
    entregue_em, lido_em, origem
  )
  VALUES (
    v_conversa.id, p_instancia_id, p_zapi_message_id, p_direcao, p_tipo,
    CASE WHEN p_direcao = 'entrada' THEN 'recebida'::public.whatsapp_mensagem_status
         ELSE COALESCE(v_status_saida, 'enviada'::public.whatsapp_mensagem_status) END,
    p_texto, p_legenda, p_media_url, v_conversa.cliente_id, v_conversa.os_id, p_payload,
    CASE WHEN p_direcao = 'entrada' THEN v_quando END,
    CASE WHEN p_direcao = 'saida' THEN v_quando END,
    CASE WHEN p_direcao = 'saida' THEN v_entregue_em END,
    CASE WHEN p_direcao = 'saida' THEN v_lido_em END,
    COALESCE(p_origem, 'humano')
  )
  ON CONFLICT (instancia_id, zapi_message_id) DO NOTHING
  RETURNING id INTO v_mensagem_id;

  RETURN jsonb_build_object(
    'duplicada', v_mensagem_id IS NULL,
    'mensagem_id', v_mensagem_id,
    'conversa_id', v_conversa.id,
    'cliente_id', v_conversa.cliente_id,
    'lead_id', v_conversa.lead_id,
    'os_id', v_conversa.os_id,
    'lead_criado', v_lead_criado,
    'telefone_normalizado', v_tel
  );
END;
$function$;

COMMENT ON FUNCTION public.whatsapp_registrar_mensagem(uuid, text, text, whatsapp_mensagem_direcao, whatsapp_mensagem_tipo, text, text, text, text, jsonb, timestamptz, text) IS
  'Grava mensagem do WhatsApp (entrada ou saída) resolvendo cliente/lead/conversa com normalize_whatsapp_phone — a MESMA regra das colunas geradas. Idempotente pelo id do Z-API. Lead só para mensagem humana de entrada (nunca para origem automacao). Saída nasce com o status do recibo já recebido (notificacoes_fila). p_origem: humano | automacao | ia. Só o service_role chama.';

REVOKE ALL ON FUNCTION public.whatsapp_registrar_mensagem(uuid, text, text, whatsapp_mensagem_direcao, whatsapp_mensagem_tipo, text, text, text, text, jsonb, timestamptz, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_registrar_mensagem(uuid, text, text, whatsapp_mensagem_direcao, whatsapp_mensagem_tipo, text, text, text, text, jsonb, timestamptz, text) TO service_role;

-- ---------------------------------------------------------------- 1b
-- _wa_mensagem_antes_inserir (gatilho da caixa v3, do dono): atendimento só
-- para mensagem de GENTE.
--
-- Corpo vivo copiado (md5 bde1445fb363e2b3fbecbdaf0ccbec85). Mudança, e só
-- ela: no ramo de entrada, o atendimento só abre (e a espera só começa) quando
-- a mensagem não é de sistema nem de origem 'automacao' (modelo de empresa).
-- Em 06/10/2026 os atendimentos WA-2610-0001, -0003 e -0004 nasceram de
-- modelos da Renova Be, da Claro e do Kwai — ninguém para atender. Tudo o
-- mais (saída humana, celular, IA, atendimento_id) fica como o dono escreveu.
CREATE OR REPLACE FUNCTION public._wa_mensagem_antes_inserir()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE c public.whatsapp_conversas%ROWTYPE; v_at uuid; v_quando timestamptz;
BEGIN
  SELECT * INTO c FROM public.whatsapp_conversas WHERE id = NEW.conversa_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NEW; END IF;
  v_quando := coalesce(NEW.recebido_em, NEW.enviado_em, now());
  IF NEW.direcao = 'entrada' THEN
    IF NEW.tipo <> 'sistema' AND coalesce(NEW.origem, 'humano') <> 'automacao' THEN
      v_at := coalesce(c.atendimento_ativo_id, public._wa_abrir_atendimento(c.id, 'mensagem_recebida', NULL));
      UPDATE public.whatsapp_conversas SET aguardando_desde = coalesce(aguardando_desde, v_quando) WHERE id = c.id;
    ELSE
      -- Sistema ou modelo de empresa: entra na conversa, não abre atendimento.
      v_at := c.atendimento_ativo_id;
    END IF;
  ELSE
    IF NEW.enviada_por IS NULL AND coalesce(NEW.origem,'humano') = 'humano' THEN NEW.origem := 'celular'; END IF;
    v_at := c.atendimento_ativo_id;
    IF NEW.origem IN ('humano','celular') THEN
      IF v_at IS NOT NULL THEN
        UPDATE public.whatsapp_atendimentos
           SET primeira_resposta_em = coalesce(primeira_resposta_em, v_quando),
               responsavel_id = coalesce(responsavel_id, NEW.enviada_por)
         WHERE id = v_at;
      END IF;
      UPDATE public.whatsapp_conversas
         SET aguardando_desde = NULL, modo = 'humano',
             responsavel_id = coalesce(responsavel_id, NEW.enviada_por)
       WHERE id = c.id;
    ELSIF NEW.origem = 'ia' THEN
      UPDATE public.whatsapp_conversas SET aguardando_desde = NULL WHERE id = c.id;
    END IF;
  END IF;
  NEW.atendimento_id := coalesce(NEW.atendimento_id, v_at);
  RETURN NEW;
END $function$;

REVOKE ALL ON FUNCTION public._wa_mensagem_antes_inserir() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------- 2
-- whatsapp_configurar_instancia: trocar o segredo é decisão explícita.
--
-- A assinatura ganha `p_trocar_segredo boolean DEFAULT false`. A antiga (4
-- parâmetros) é APAGADA: com as duas, o PostgREST não saberia escolher
-- ("Could not choose the best candidate function") e as DUAS chamadas
-- falhariam. Mudança no corpo vivo, e só ela: antes do INSERT … ON CONFLICT,
-- recusa quando a instância já tem hash e veio hash novo sem p_trocar_segredo.
DROP FUNCTION IF EXISTS public.whatsapp_configurar_instancia(text, text, text, text);

CREATE OR REPLACE FUNCTION public.whatsapp_configurar_instancia(
  p_zapi_instance_id text,
  p_nome text,
  p_numero text,
  p_webhook_secret_hash text,
  p_trocar_segredo boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_zapi text := NULLIF(btrim(p_zapi_instance_id), '');
BEGIN
  PERFORM public.require_permission('whatsapp.manage');

  IF v_zapi IS NULL THEN
    RAISE EXCEPTION 'Informe o ID da instância, como aparece no painel do Z-API.';
  END IF;
  IF p_webhook_secret_hash IS NOT NULL AND p_webhook_secret_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Hash do segredo em formato inválido.';
  END IF;

  -- Instância que já tem endereço de webhook só troca o segredo de propósito:
  -- trocar sem querer derruba a recepção até o endereço novo ser colado no
  -- painel do Z-API.
  IF p_webhook_secret_hash IS NOT NULL AND NOT COALESCE(p_trocar_segredo, false)
     AND EXISTS (
       SELECT 1 FROM public.whatsapp_instancias
       WHERE zapi_instance_id = v_zapi AND webhook_secret_hash IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'Esta instância já tem um endereço de webhook. Para trocar o segredo, use "Gerar novo endereço do webhook" — o endereço atual deixa de valer.';
  END IF;

  INSERT INTO public.whatsapp_instancias (nome, zapi_instance_id, numero, webhook_secret_hash, ativa, status, conectado)
  VALUES (
    COALESCE(NULLIF(btrim(p_nome), ''), 'WhatsApp da empresa'),
    v_zapi,
    NULLIF(btrim(p_numero), ''),
    p_webhook_secret_hash,
    true,
    'desconectada',
    false
  )
  ON CONFLICT (zapi_instance_id) DO UPDATE SET
    nome = COALESCE(NULLIF(btrim(p_nome), ''), whatsapp_instancias.nome),
    numero = COALESCE(NULLIF(btrim(p_numero), ''), whatsapp_instancias.numero),
    webhook_secret_hash = COALESCE(p_webhook_secret_hash, whatsapp_instancias.webhook_secret_hash),
    ativa = true
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

COMMENT ON FUNCTION public.whatsapp_configurar_instancia(text, text, text, text, boolean) IS
  'Cadastra ou atualiza a instância do Z-API. Exige whatsapp.manage. Recebe só o HASH do segredo do webhook — o segredo em si nunca chega ao banco. Trocar o hash de uma instância que já tem um exige p_trocar_segredo = true.';

REVOKE ALL ON FUNCTION public.whatsapp_configurar_instancia(text, text, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.whatsapp_configurar_instancia(text, text, text, text, boolean) TO authenticated;

-- ---------------------------------------------------------------- 3
-- As duas medidas permanentes da entrada, para o cartão do Monitor.
--
--   recibos_sem_mensagem  READ_BY_ME (a empresa leu no celular) fora de
--                         status@broadcast cujo id não tem evento `msg:<id>`:
--                         mensagem que chegou no aparelho e nunca chegou ao
--                         sistema. Em 06/10/2026: 1 (3EB0824240D4323CD37480,
--                         "Gratidão", 17:35 UTC — a loteria de DNS que havia).
--   midias_sem_copia      mensagens com link de mídia do Z-API (vale 30 dias)
--                         e sem cópia no nosso armazenamento. Em 06/10: 1.
--
-- `momment` do READ_BY_ME vem em microssegundos (16 dígitos); dos outros, em
-- milissegundos (13). Os dois viram timestamp.
CREATE OR REPLACE FUNCTION public.whatsapp_medidas_de_entrada()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_recibos jsonb;
  v_midias int;
BEGIN
  IF v_uid IS NULL
     OR NOT (public.has_permission(v_uid, 'whatsapp.read') OR public.has_permission(v_uid, 'whatsapp.manage')) THEN
    RAISE EXCEPTION 'Permissão necessária: whatsapp.read ou whatsapp.manage';
  END IF;

  SELECT COALESCE(
           jsonb_agg(jsonb_build_object('id', r.id, 'telefone', r.telefone, 'momento', r.momento)
                     ORDER BY r.momento DESC NULLS LAST),
           '[]'::jsonb)
    INTO v_recibos
  FROM (
    SELECT DISTINCT ON (i.id)
           i.id,
           e.payload->>'phone' AS telefone,
           CASE WHEN (e.payload->>'momment') ~ '^\d+$'
                THEN to_timestamp((e.payload->>'momment')::numeric
                                  / CASE WHEN length(e.payload->>'momment') > 13 THEN 1000000 ELSE 1000 END)
           END AS momento
    FROM public.whatsapp_webhook_eventos e
    CROSS JOIN LATERAL jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(e.payload->'ids') = 'array' THEN e.payload->'ids' ELSE '[]'::jsonb END
    ) AS i(id)
    WHERE e.provedor = 'zapi'
      AND e.payload->>'type' = 'MessageStatusCallback'
      AND e.payload->>'status' = 'READ_BY_ME'
      AND COALESCE(e.payload->>'phone', '') <> 'status@broadcast'
      AND NOT EXISTS (
        SELECT 1 FROM public.whatsapp_webhook_eventos m
        WHERE m.provedor = 'zapi' AND m.external_id = 'msg:' || i.id
      )
    ORDER BY i.id, e.created_at
  ) r;

  SELECT count(*) INTO v_midias
  FROM public.whatsapp_mensagens
  WHERE media_url IS NOT NULL AND storage_path IS NULL;

  RETURN jsonb_build_object(
    'recibos_sem_mensagem', jsonb_array_length(v_recibos),
    'midias_sem_copia', v_midias,
    'recibos', v_recibos,
    'medido_em', now()
  );
END;
$function$;

COMMENT ON FUNCTION public.whatsapp_medidas_de_entrada() IS
  'Cartão do Monitor: recibos READ_BY_ME sem mensagem gravada e mídias sem cópia no bucket. Exige whatsapp.read ou whatsapp.manage.';

REVOKE ALL ON FUNCTION public.whatsapp_medidas_de_entrada() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.whatsapp_medidas_de_entrada() TO authenticated;

-- ---------------------------------------------------------------- 4
-- A porta lateral fechada.
--
-- whatsapp_fila_envio: a policy era `is_staff` para TUDO. Qualquer pessoa da
-- equipe (operador, financeiro) inseria uma linha com `payload.para` apontando
-- para qualquer número, e o consumidor mandava. Agora: a equipe lê; quem tem
-- whatsapp.reply enfileira, e só em nome próprio (created_by = auth.uid());
-- quem tem whatsapp.manage altera e apaga. `whatsapp_responder` é SECURITY
-- INVOKER e grava created_by = auth.uid(): passa pela policy nova sem mudar.
-- O consumidor (TS) completa: ignora `payload.para`, usa o telefone da
-- conversa, e recusa linha sem conversa ou sem autor.
DROP POLICY IF EXISTS "wa staff all" ON public.whatsapp_fila_envio;
DROP POLICY IF EXISTS "whatsapp_fila_envio equipe le" ON public.whatsapp_fila_envio;
DROP POLICY IF EXISTS "whatsapp_fila_envio quem responde enfileira" ON public.whatsapp_fila_envio;
DROP POLICY IF EXISTS "whatsapp_fila_envio quem gerencia altera" ON public.whatsapp_fila_envio;
DROP POLICY IF EXISTS "whatsapp_fila_envio quem gerencia apaga" ON public.whatsapp_fila_envio;

CREATE POLICY "whatsapp_fila_envio equipe le" ON public.whatsapp_fila_envio
  FOR SELECT TO authenticated
  USING (public.is_staff((SELECT auth.uid())));

CREATE POLICY "whatsapp_fila_envio quem responde enfileira" ON public.whatsapp_fila_envio
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_permission((SELECT auth.uid()), 'whatsapp.reply')
    AND created_by = (SELECT auth.uid())
  );

CREATE POLICY "whatsapp_fila_envio quem gerencia altera" ON public.whatsapp_fila_envio
  FOR UPDATE TO authenticated
  USING (public.has_permission((SELECT auth.uid()), 'whatsapp.manage'))
  WITH CHECK (public.has_permission((SELECT auth.uid()), 'whatsapp.manage'));

CREATE POLICY "whatsapp_fila_envio quem gerencia apaga" ON public.whatsapp_fila_envio
  FOR DELETE TO authenticated
  USING (public.has_permission((SELECT auth.uid()), 'whatsapp.manage'));

-- whatsapp_webhook_eventos: a equipe lê (o Monitor); só o receptor escreve,
-- com a chave de serviço (service_role ignora RLS e tem os grants).
DROP POLICY IF EXISTS "wa staff all" ON public.whatsapp_webhook_eventos;
DROP POLICY IF EXISTS "whatsapp_webhook_eventos equipe le" ON public.whatsapp_webhook_eventos;

CREATE POLICY "whatsapp_webhook_eventos equipe le" ON public.whatsapp_webhook_eventos
  FOR SELECT TO authenticated
  USING (public.is_staff((SELECT auth.uid())));

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.whatsapp_webhook_eventos FROM authenticated;

-- anon não tem o que fazer em tabela nenhuma do WhatsApp (as rotas públicas
-- usam a chave de serviço). REVOKE de PUBLIC não fecha o anon — o grant dele
-- é direto; por isso o REVOKE é nominal, tabela por tabela.
DO $anon$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename LIKE 'whatsapp\_%'
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', t);
  END LOOP;
END $anon$;

-- ---------------------------------------------------------------- 5
-- O despachante do servidor: pg_cron chama POST /api/whatsapp/despachar a
-- cada 2 minutos, 24 h.
--
-- O token NÃO está neste arquivo nem em cron.job: o comando do job lê
-- `vault.decrypted_secrets` na hora de rodar. O dono cria o segredo
-- `despachante_token` no Vault e a variável DESPACHANTE_TOKEN no servidor,
-- com o mesmo valor. Sem o segredo no Vault, o job NÃO é criado (um job que
-- manda cabeçalho vazio só geraria 401 a cada 2 minutos) — fica o NOTICE com
-- o passo que falta, e esta seção é reaplicável.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $job$
DECLARE
  v_tem_segredo boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'despachante_token')
    INTO v_tem_segredo;

  IF NOT v_tem_segredo THEN
    RAISE NOTICE 'despachante: o segredo "despachante_token" não existe no Vault — o job whatsapp-despachar NÃO foi criado. Crie o segredo (Vault → despachante_token, o MESMO valor de DESPACHANTE_TOKEN no servidor) e rode de novo a seção 5 desta migração.';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'whatsapp-despachar') THEN
    PERFORM cron.unschedule('whatsapp-despachar');
  END IF;

  PERFORM cron.schedule(
    'whatsapp-despachar',
    '*/2 * * * *',
    $cmd$
      SELECT net.http_post(
        url := 'https://bexprint.com.br/api/whatsapp/despachar',
        headers := jsonb_build_object(
          'x-despachante-token', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'despachante_token'),
          'content-type', 'application/json'
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 60000
      )
    $cmd$
  );
  RAISE NOTICE 'despachante: job whatsapp-despachar agendado (*/2 * * * *).';
END $job$;

-- ---------------------------------------------------------------- 6
-- Acertos nos dados (idempotentes: rodar duas vezes não muda nada na segunda).

-- 6a. Os avisos já enviados viram mensagem da conversa.
--
-- Todo aviso 'enviado' com provider_message_id e sem linha correspondente em
-- whatsapp_mensagens é registrado pela própria `whatsapp_registrar_mensagem`
-- (direção saída, status pelo recibo — os três de 06/10 estão 'entregue'). O
-- texto é o modelo com as variáveis trocadas, com a mesma limpeza de
-- `renderizarTemplate` (src/domain/whatsapp/zapi-envio.ts). Em 06/10/2026:
-- 3 avisos (982AEE43…, A48B870D…, 6E2A1033…).
--
-- pai-arbitrario-ok: o aviso não guarda instância; a gráfica opera UMA ativa,
-- a mesma que o envio usa. Se um dia houver duas, o aviso precisa guardar
-- a sua.
DO $fix$
DECLARE
  r record;
  v_instancia uuid;
  v_texto text;
  v_chave text;
  v_valor text;
  v_antes int;
  v_depois int;
  v_feitos int := 0;
BEGIN
  SELECT id INTO v_instancia FROM public.whatsapp_instancias WHERE ativa ORDER BY created_at LIMIT 1;
  IF v_instancia IS NULL THEN
    RAISE NOTICE 'avisos → mensagens: nenhuma instância ativa; nada a reconstruir.';
    RETURN;
  END IF;

  SELECT count(*) INTO v_antes FROM public.whatsapp_mensagens
  WHERE direcao = 'saida' AND payload->>'fonte' = 'notificacoes_fila';

  FOR r IN
    SELECT n.id, n.destinatario, n.provider_message_id, n.variaveis, n.enviado_em,
           COALESCE(t_modelo.corpo, t_evento.corpo) AS corpo
    FROM public.notificacoes_fila n
    LEFT JOIN public.notificacao_templates t_modelo
      ON t_modelo.canal = 'whatsapp' AND t_modelo.evento = n.template
    LEFT JOIN public.notificacao_templates t_evento
      ON t_evento.canal = 'whatsapp' AND t_evento.evento = n.evento
    WHERE n.canal = 'whatsapp'
      AND n.status = 'enviado'
      AND n.provider_message_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.whatsapp_mensagens m
        WHERE m.instancia_id = v_instancia AND m.zapi_message_id = n.provider_message_id
      )
    ORDER BY n.enviado_em
  LOOP
    IF r.corpo IS NULL THEN
      RAISE NOTICE 'aviso % sem modelo: pulado', r.id;
      CONTINUE;
    END IF;
    -- {{ chave }} → {{chave}}, depois troca simples (sem regexp no valor).
    v_texto := regexp_replace(r.corpo, '\{\{\s*([a-z_0-9]+)\s*\}\}', '{{\1}}', 'gi');
    FOR v_chave, v_valor IN SELECT key, value FROM jsonb_each_text(COALESCE(r.variaveis, '{}'::jsonb)) LOOP
      IF v_valor ~ '^\d{4}-\d{2}-\d{2}$' THEN
        v_valor := substr(v_valor, 9, 2) || '/' || substr(v_valor, 6, 2) || '/' || substr(v_valor, 1, 4);
      END IF;
      v_texto := replace(v_texto, '{{' || v_chave || '}}', COALESCE(v_valor, ''));
    END LOOP;
    v_texto := regexp_replace(v_texto, ':\s*\.', '.', 'g');
    v_texto := regexp_replace(v_texto, '\s*\(\s*\)', '', 'g');
    v_texto := regexp_replace(v_texto, '[ \t]{2,}', ' ', 'g');
    v_texto := regexp_replace(v_texto, '\s+([.,!?;:])', '\1', 'g');
    v_texto := btrim(v_texto);

    PERFORM public.whatsapp_registrar_mensagem(
      v_instancia,
      r.provider_message_id,
      '55' || r.destinatario,
      'saida',
      'texto',
      v_texto,
      NULL, NULL, NULL,
      jsonb_build_object('fonte', 'notificacoes_fila', 'id', r.id),
      r.enviado_em,
      'automacao'
    );
    v_feitos := v_feitos + 1;
  END LOOP;

  SELECT count(*) INTO v_depois FROM public.whatsapp_mensagens
  WHERE direcao = 'saida' AND payload->>'fonte' = 'notificacoes_fila';
  RAISE NOTICE 'avisos → mensagens: % reconstruído(s); linhas de saída vindas da fila: % antes, % depois', v_feitos, v_antes, v_depois;
END $fix$;

-- 6b. (RETIRADO) O texto das três mensagens de modelo (ad7eeb4d…, adaceb88…,
-- 5ee12e5f…) é refeito pela função do dono `whatsapp_reprocessar_sistema`,
-- que a caixa v3 trouxe com o botão "Reprocessar sem texto" no Monitor — um
-- clique, idempotente. Esta migração não a duplica.

-- ---------------------------------------------------------------- 7
-- NÃO EXECUTADO — depende do OK do dono (regra: listar antes de apagar).
--
-- Os três leads nascidos de mensagem de modelo em 05 e 06/10/2026 (Renova Be,
-- Claro, Kwai) não são pedidos. O lead "Gratidão" (30f47d4b…, telefone
-- 559684327152, mandou um PDF) FICA. Para fechar os três como perdidos,
-- rodar à mão, depois do OK:
--
--   UPDATE public.leads
--      SET status = 'perdido',
--          etapa = 'perdido',
--          motivo_perda = 'mensagem automática de empresa (modelo/template), não é pedido de cliente',
--          updated_at = now()
--    WHERE id IN (
--      'af87b46e-b448-4247-a361-d0f4dda880e5',  -- Lead WhatsApp 19958714824 (Renova Be)
--      'b6640870-3ce1-4f5f-8ab9-b78eda0e0ed8',  -- Claro (11999910621)
--      '405123f9-59b2-4bbf-a079-a54189363c23'   -- Lead WhatsApp 62895426250367 (Kwai; "telefone" é o lid)
--    )
--      AND status <> 'perdido';
--
-- (Opcional, mesmo OK: as três conversas correspondentes — cd879e7f…,
--  08adbc7d…, dc6b2565… — podem ser concluídas pela caixa de entrada, botão
--  "Concluir atendimento".)
