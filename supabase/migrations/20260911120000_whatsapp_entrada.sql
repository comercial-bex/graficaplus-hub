-- WhatsApp: a entrada que o Z-API consegue alimentar.
--
-- Conferido em 11/09/2026: zero instâncias, zero conversas, zero mensagens,
-- zero leads. O receptor antigo, além de inalcançável (era createServerFn, sem
-- URL fixa), tinha três defeitos que apareceriam no primeiro dia de uso:
--
--   1. TELEFONE COMPARADO POR DUAS REGRAS. As colunas `telefone_normalizado`
--      de clientes, leads e conversas são geradas por normalize_whatsapp_phone,
--      que tira o 55 e repõe o nono dígito. O receptor comparava com o número
--      só sem símbolos. "559681234567" (como o WhatsApp entrega Macapá) nunca
--      casaria com "96981234567" (como o banco guarda). E os índices únicos de
--      conversa e de lead temporário transformariam isso em erro: a SEGUNDA
--      mensagem de qualquer pessoa estouraria "duplicate key". Só a primeira
--      mensagem de cada contato seria gravada, e todo cliente viraria lead.
--   2. INSTÂNCIA PELO ID ERRADO. O Z-API manda o id DELE (`instanceId`); o
--      receptor usava esse valor como a chave primária da nossa tabela.
--   3. REENVIO DUPLICAVA. Sem idempotência, o reenvio do Z-API (quando não
--      recebe 200 a tempo) somaria a mensagem de novo.
--
-- Aqui a gravação é UMA função: normaliza com a mesma regra das colunas
-- geradas, resolve cliente/lead/conversa, e é idempotente pelo messageId.

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
  p_momento timestamptz DEFAULT NULL
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
BEGIN
  IF v_tel IS NULL THEN
    RAISE EXCEPTION 'Telefone vazio: %', p_telefone;
  END IF;
  IF NULLIF(btrim(p_zapi_message_id), '') IS NULL THEN
    RAISE EXCEPTION 'Mensagem sem id do Z-API';
  END IF;

  -- Duas entregas simultâneas da mesma mensagem esperam uma pela outra: a
  -- checagem de repetida abaixo só é segura com esta trava.
  PERFORM pg_advisory_xact_lock(hashtext(p_instancia_id::text || ':' || p_zapi_message_id));

  IF EXISTS (
    SELECT 1 FROM public.whatsapp_mensagens
    WHERE instancia_id = p_instancia_id AND zapi_message_id = p_zapi_message_id
  ) THEN
    RETURN jsonb_build_object('duplicada', true);
  END IF;

  -- Cliente: pelo telefone principal OU por um contato cadastrado do cliente.
  -- Só vale quando aponta para UM cliente. Dois clientes com o mesmo número é
  -- ambiguidade, e escolher um seria gravar o vínculo errado em silêncio.
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
    -- O lead temporário é único por telefone (índice parcial).
    SELECT id INTO v_lead_id
    FROM public.leads
    WHERE telefone_normalizado = v_tel AND temporario IS TRUE;

    IF v_lead_id IS NULL THEN
      -- Lead já trabalhado com esse telefone: só se for um só.
      SELECT CASE WHEN count(*) = 1 THEN (array_agg(id))[1] END INTO v_lead_id
      FROM public.leads
      WHERE telefone_normalizado = v_tel AND cliente_id IS NULL AND status NOT IN ('ganho','perdido');
    END IF;

    -- Só quem ESCREVE para a empresa vira lead. Mensagem enviada do celular da
    -- empresa (saída) para um número desconhecido não é interesse de ninguém.
    IF v_lead_id IS NULL AND p_direcao = 'entrada' THEN
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
    -- Nome já definido fica: alguém pode tê-lo corrigido na tela.
    nome_contato = COALESCE(c.nome_contato, EXCLUDED.nome_contato),
    cliente_id = COALESCE(c.cliente_id, EXCLUDED.cliente_id),
    lead_id = COALESCE(c.lead_id, EXCLUDED.lead_id),
    -- Mensagem que chega fora de ordem não sobrescreve a mais recente.
    ultima_mensagem = CASE
      WHEN c.ultima_mensagem_at IS NULL OR EXCLUDED.ultima_mensagem_at >= c.ultima_mensagem_at
      THEN EXCLUDED.ultima_mensagem ELSE c.ultima_mensagem END,
    ultima_mensagem_at = GREATEST(c.ultima_mensagem_at, EXCLUDED.ultima_mensagem_at),
    nao_lidas = COALESCE(c.nao_lidas, 0) + EXCLUDED.nao_lidas,
    -- Cliente que volta a escrever reabre a conversa encerrada.
    status = CASE
      WHEN p_direcao = 'entrada' AND c.status IN ('resolvida', 'arquivada') THEN 'aberta'::whatsapp_conversa_status
      ELSE c.status END
  RETURNING * INTO v_conversa;

  IF v_lead_criado THEN
    UPDATE public.leads SET conversa_id = v_conversa.id WHERE id = v_lead_id AND conversa_id IS NULL;
  END IF;

  INSERT INTO public.whatsapp_mensagens (
    conversa_id, instancia_id, zapi_message_id, direcao, tipo, status,
    texto, legenda, media_url, cliente_id, os_id, payload, recebido_em, enviado_em
  )
  VALUES (
    v_conversa.id, p_instancia_id, p_zapi_message_id, p_direcao, p_tipo,
    CASE WHEN p_direcao = 'entrada' THEN 'recebida' ELSE 'enviada' END::whatsapp_mensagem_status,
    p_texto, p_legenda, p_media_url, v_conversa.cliente_id, v_conversa.os_id, p_payload,
    CASE WHEN p_direcao = 'entrada' THEN v_quando END,
    CASE WHEN p_direcao = 'saida' THEN v_quando END
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

COMMENT ON FUNCTION public.whatsapp_registrar_mensagem IS
  'Grava mensagem do WhatsApp (entrada ou saída) resolvendo cliente/lead/conversa com normalize_whatsapp_phone — a MESMA regra das colunas geradas. Idempotente pelo id do Z-API. Só o service_role chama.';

-- Recibo de entrega/leitura. Atualiza as duas pontas que guardam o id do
-- WhatsApp: a mensagem do chat e o aviso da fila de notificações (o remetente
-- de avisos grava `messageId` em provider_message_id).
--
-- Nunca rebaixa: recibo de "entregue" que chega depois do de "lida" não desfaz
-- a leitura. E "lida" preenche também a entrega, porque quem leu recebeu.
CREATE OR REPLACE FUNCTION public.whatsapp_registrar_status(
  p_instancia_id uuid,
  p_ids text[],
  p_status whatsapp_mensagem_status,
  p_momento timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_quando timestamptz := COALESCE(p_momento, now());
  v_peso int := CASE p_status WHEN 'enviada' THEN 1 WHEN 'entregue' THEN 2 WHEN 'lida' THEN 3 ELSE 0 END;
  v_mensagens int := 0;
  v_avisos int := 0;
BEGIN
  IF p_ids IS NULL OR cardinality(p_ids) = 0 THEN
    RETURN jsonb_build_object('mensagens', 0, 'avisos', 0);
  END IF;

  UPDATE public.whatsapp_mensagens m
  SET status = p_status,
      entregue_em = CASE WHEN p_status IN ('entregue','lida') THEN COALESCE(m.entregue_em, v_quando) ELSE m.entregue_em END,
      lido_em = CASE WHEN p_status = 'lida' THEN COALESCE(m.lido_em, v_quando) ELSE m.lido_em END
  WHERE m.instancia_id = p_instancia_id
    AND m.zapi_message_id = ANY (p_ids)
    AND m.direcao = 'saida'
    AND (
      -- falha só marca o que ainda não foi confirmado como entregue
      (p_status = 'falha' AND m.status IN ('pendente','enviada'))
      OR v_peso > CASE m.status WHEN 'enviada' THEN 1 WHEN 'entregue' THEN 2 WHEN 'lida' THEN 3 ELSE 0 END
    );
  GET DIAGNOSTICS v_mensagens = ROW_COUNT;

  UPDATE public.notificacoes_fila n
  SET provider_status = p_status::text,
      entregue_em = CASE WHEN p_status IN ('entregue','lida') THEN COALESCE(n.entregue_em, v_quando) ELSE n.entregue_em END,
      lido_em = CASE WHEN p_status = 'lida' THEN COALESCE(n.lido_em, v_quando) ELSE n.lido_em END
  WHERE n.provider_message_id = ANY (p_ids)
    AND (
      (p_status = 'falha' AND COALESCE(n.provider_status, 'enviada') IN ('pendente','enviada'))
      OR v_peso > CASE n.provider_status WHEN 'enviada' THEN 1 WHEN 'entregue' THEN 2 WHEN 'lida' THEN 3 ELSE 0 END
    );
  GET DIAGNOSTICS v_avisos = ROW_COUNT;

  RETURN jsonb_build_object('mensagens', v_mensagens, 'avisos', v_avisos);
END;
$function$;

COMMENT ON FUNCTION public.whatsapp_registrar_status IS
  'Recibo do Z-API (ids = messageId do WhatsApp). Atualiza whatsapp_mensagens e notificacoes_fila sem nunca rebaixar o status. Só o service_role chama.';

-- As duas são chamadas pelo receptor do servidor, com a chave de serviço.
-- Ninguém do navegador deve conseguir fabricar mensagem ou recibo.
REVOKE ALL ON FUNCTION public.whatsapp_registrar_mensagem(uuid, text, text, whatsapp_mensagem_direcao, whatsapp_mensagem_tipo, text, text, text, text, jsonb, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.whatsapp_registrar_status(uuid, text[], whatsapp_mensagem_status, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_registrar_mensagem(uuid, text, text, whatsapp_mensagem_direcao, whatsapp_mensagem_tipo, text, text, text, text, jsonb, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.whatsapp_registrar_status(uuid, text[], whatsapp_mensagem_status, timestamptz) TO service_role;

-- ---------------------------------------------------------------------------
-- Cadastro da instância.
--
-- Não havia tela nem caminho para cadastrar a instância do Z-API: mesmo com
-- conta aberta, não dava para conectar. E a política da tabela era "qualquer
-- pessoa da equipe faz tudo" — um vendedor podia trocar o id da instância ou o
-- segredo do webhook e desviar a entrada.
--
-- O segredo nunca chega ao banco: o navegador sorteia, mostra UMA vez para
-- colar no painel do Z-API, e manda só o hash SHA-256. O receptor compara o
-- hash do que o Z-API envia na URL.
CREATE OR REPLACE FUNCTION public.whatsapp_configurar_instancia(
  p_zapi_instance_id text,
  p_nome text,
  p_numero text,
  p_webhook_secret_hash text
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
    -- Gerar nova URL troca o segredo; sem hash novo, o antigo continua valendo.
    webhook_secret_hash = COALESCE(p_webhook_secret_hash, whatsapp_instancias.webhook_secret_hash),
    ativa = true
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

COMMENT ON FUNCTION public.whatsapp_configurar_instancia IS
  'Cadastra ou atualiza a instância do Z-API. Exige whatsapp.manage. Recebe só o HASH do segredo do webhook — o segredo em si nunca chega ao banco.';

REVOKE ALL ON FUNCTION public.whatsapp_configurar_instancia(text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.whatsapp_configurar_instancia(text, text, text, text) TO authenticated;

-- A equipe continua VENDO a instância (status da conexão, último evento), mas
-- escrever passa a exigir whatsapp.manage — e o hash do segredo sai da leitura.
DROP POLICY IF EXISTS "whatsapp_instancias staff all" ON public.whatsapp_instancias;

CREATE POLICY "whatsapp_instancias equipe le" ON public.whatsapp_instancias
  FOR SELECT TO authenticated
  USING (public.is_staff((SELECT auth.uid())));

CREATE POLICY "whatsapp_instancias quem gerencia escreve" ON public.whatsapp_instancias
  FOR ALL TO authenticated
  USING (public.has_permission((SELECT auth.uid()), 'whatsapp.manage'))
  WITH CHECK (public.has_permission((SELECT auth.uid()), 'whatsapp.manage'));

REVOKE SELECT ON public.whatsapp_instancias FROM anon, authenticated;
GRANT SELECT (id, nome, zapi_instance_id, numero, numero_normalizado, status, conectado, ultimo_evento_at, ativa, created_at, updated_at)
  ON public.whatsapp_instancias TO authenticated;
