-- PROPOSTA SOMENTE: NÃO APLICADA. Primeiro bloco sem controle de transação.
-- Função abaixo obtida por pg_get_functiondef em 11/11/2026, não da migração 0010.
-- Somente a lista de colunas/valores do INSERT de lead novo foi modificada.
-- Origem, campanha, assinatura, idempotência e demais operações permanecem intactas.
-- Limite preservado: contato que já é cliente pode não gerar lead; conversa sem
-- lead ligado permanece visualmente cliente. Este SQL não cria leads para esses contatos.
-- ACL atual de leads: privilégios de tabela arwdDxtm para postgres/anon/authenticated/
-- service_role e ar para sandbox_exec; colunas atuais não têm ACL específica.
-- Os grants abaixo repetem SOMENTE leitura/escrita de coluna já permitidas pela tabela;
-- RLS existente de leads continua valendo, inclusive para anon (nenhuma policy anon).

ALTER TABLE public.leads ADD COLUMN tipo text NOT NULL DEFAULT 'cliente' CHECK (tipo IN ('cliente','parceiro'));
GRANT SELECT (tipo), INSERT (tipo), UPDATE (tipo) ON public.leads TO anon, authenticated, service_role;
GRANT SELECT (tipo), INSERT (tipo) ON public.leads TO sandbox_exec;

CREATE TABLE public.anuncios_de_parceiro (
  anuncio_id text PRIMARY KEY,
  nome text,
  criado_em timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.anuncios_de_parceiro TO authenticated;
GRANT ALL ON public.anuncios_de_parceiro TO service_role;
ALTER TABLE public.anuncios_de_parceiro ENABLE ROW LEVEL SECURITY;
CREATE POLICY anuncios_de_parceiro_gestao ON public.anuncios_de_parceiro
  FOR ALL TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role)
      OR public.has_role((SELECT auth.uid()), 'gestor'::public.app_role))
  WITH CHECK (public.has_role((SELECT auth.uid()), 'admin'::public.app_role)
      OR public.has_role((SELECT auth.uid()), 'gestor'::public.app_role));

CREATE OR REPLACE FUNCTION public._wa_telefone_de_parceiro(p_telefone text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.parceiros p
    LEFT JOIN public.clientes c ON c.id = p.cliente_id
    WHERE public.normalize_whatsapp_phone(p_telefone) IS NOT NULL
      AND (public.normalize_whatsapp_phone(p.marca_telefone) = public.normalize_whatsapp_phone(p_telefone)
        OR public.normalize_whatsapp_phone(c.telefone) = public.normalize_whatsapp_phone(p_telefone)
        OR public.normalize_whatsapp_phone(c.whatsapp_principal) = public.normalize_whatsapp_phone(p_telefone))
  );
$function$;
REVOKE ALL ON FUNCTION public._wa_telefone_de_parceiro(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._wa_telefone_de_parceiro(text) TO service_role;

CREATE OR REPLACE FUNCTION public.whatsapp_registrar_mensagem(p_instancia_id uuid, p_zapi_message_id text, p_telefone text, p_direcao whatsapp_mensagem_direcao, p_tipo whatsapp_mensagem_tipo, p_texto text DEFAULT NULL::text, p_legenda text DEFAULT NULL::text, p_media_url text DEFAULT NULL::text, p_nome_contato text DEFAULT NULL::text, p_payload jsonb DEFAULT '{}'::jsonb, p_momento timestamp with time zone DEFAULT NULL::timestamp with time zone, p_origem text DEFAULT 'humano'::text)
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

  -- Só cliente ATIVO conta (21/10/2026): cadastro repetido e desligado não
  -- pode impedir a ligação automática. Se só houver inativo, ele ainda é o
  -- cliente — quem volta a escrever depois de desligado continua conhecido.
  SELECT array_agg(DISTINCT c.id) INTO v_clientes
  FROM (
    SELECT id FROM public.clientes WHERE telefone_normalizado = v_tel AND ativo IS NOT FALSE
    UNION
    SELECT id FROM public.clientes WHERE public.normalize_whatsapp_phone(whatsapp_principal) = v_tel AND ativo IS NOT FALSE
    UNION
    SELECT cc.cliente_id FROM public.cliente_contatos cc
      JOIN public.clientes cl ON cl.id = cc.cliente_id AND cl.ativo IS NOT FALSE
    WHERE public.normalize_whatsapp_phone(cc.telefone) = v_tel
  ) c;
  IF v_clientes IS NULL THEN
    SELECT array_agg(DISTINCT c.id) INTO v_clientes
    FROM (
      SELECT id FROM public.clientes WHERE telefone_normalizado = v_tel
      UNION
      SELECT id FROM public.clientes WHERE public.normalize_whatsapp_phone(whatsapp_principal) = v_tel
      UNION
      SELECT cliente_id FROM public.cliente_contatos
      WHERE public.normalize_whatsapp_phone(telefone) = v_tel
    ) c;
  END IF;
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
       AND COALESCE(p_origem, 'humano') <> 'automacao'
       AND NOT public._wa_telefone_da_equipe(v_tel) THEN
      INSERT INTO public.leads (nome, telefone, telefone_original, origem, campanha, interesse, status, temporario, tipo)
      VALUES (
        COALESCE(v_nome, 'Lead WhatsApp ' || v_tel),
        p_telefone,
        p_telefone,
        -- Click-to-WhatsApp: origem real quando o contato veio do Instagram/Facebook.
        CASE p_payload->>'canal_origem'
          WHEN 'instagram' THEN 'Instagram'
          WHEN 'facebook'  THEN 'Facebook'
          ELSE 'whatsapp'
        END,
        CASE WHEN NULLIF(btrim(p_payload->>'anuncio_id'), '') IS NOT NULL
          THEN 'Anúncio ' || btrim(p_payload->>'anuncio_id')
          ELSE NULL  -- como hoje: o INSERT atual não preenche campanha
        END,
        'Atendimento iniciado via WhatsApp',
        'novo',
        true,
        CASE WHEN EXISTS (
          SELECT 1 FROM public.anuncios_de_parceiro a
          WHERE a.anuncio_id = p_payload->>'anuncio_id'
        ) OR public._wa_telefone_de_parceiro(v_tel)
          THEN 'parceiro' ELSE 'cliente'
        END
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
REVOKE ALL ON FUNCTION public.whatsapp_registrar_mensagem(uuid, text, text, public.whatsapp_mensagem_direcao, public.whatsapp_mensagem_tipo, text, text, text, text, jsonb, timestamptz, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_registrar_mensagem(uuid, text, text, public.whatsapp_mensagem_direcao, public.whatsapp_mensagem_tipo, text, text, text, text, jsonb, timestamptz, text) TO service_role;

-- BACKFILL OPCIONAL E SEPARADO: NÃO EXECUTAR SEM NOVA AUTORIZAÇÃO.
-- Execute primeiro apenas o SELECT e confira os IDs; não modifica origem/campanha.
/*
SELECT id, nome, telefone, tipo AS tipo_atual, 'parceiro' AS tipo_proposto
FROM public.leads
WHERE tipo <> 'parceiro' AND public._wa_telefone_de_parceiro(telefone);

UPDATE public.leads SET tipo = 'parceiro'
WHERE tipo <> 'parceiro' AND public._wa_telefone_de_parceiro(telefone);
*/

-- TESTES MANUAIS: somente em ambiente ISOLADO, nunca em produção.
-- 1. Como postgres/service_role: SELECT public._wa_telefone_de_parceiro('5596000000000');
--    Esperado false se esse telefone fictício não estiver cadastrado.
-- 2. No ambiente isolado, cadastre anúncio fictício 999000111 e parceiro fictício;
--    envie pelo webhook mensagem de entrada com anúncio cadastrado: lead novo parceiro.
-- 3. Repita sem anúncio, com telefone de parceiro: lead novo parceiro.
-- 4. Telefone fictício desconhecido e anúncio fora da lista: lead novo cliente.
-- 5. Reenvie o mesmo id de mensagem: duplicada, sem novo lead nem mensagem.
-- 6. Reenvie para lead existente: tipo, origem e campanha existentes não se alteram.
-- 7. Confira que temporários seguem fora do Funil; qualifique para testar selo/filtro.
-- 8. Abra Funil quadro/lista, Leads e WhatsApp, temas claro/escuro e celular.
-- 9. Perfil vendedor não pode ler/gravar anuncios_de_parceiro; admin/gestor podem.
-- 10. EXECUTE das duas funções apenas postgres/service_role; DEFINER e search_path public.
-- Consultas de conferência (somente leitura, depois da futura aplicação):
/*
SELECT pg_get_functiondef('public.whatsapp_registrar_mensagem(uuid,text,text,public.whatsapp_mensagem_direcao,public.whatsapp_mensagem_tipo,text,text,text,text,jsonb,timestamptz,text)'::regprocedure);
SELECT proname, prosecdef, proconfig, proacl FROM pg_proc
WHERE oid IN ('public._wa_telefone_de_parceiro(text)'::regprocedure,
 'public.whatsapp_registrar_mensagem(uuid,text,text,public.whatsapp_mensagem_direcao,public.whatsapp_mensagem_tipo,text,text,text,text,jsonb,timestamptz,text)'::regprocedure);
*/

-- REVERSÃO SEPARADA, COMENTADA: restaura primeiro a função exatamente como lida hoje.
-- DROP da coluna/tabela elimina classificações/lista futuras; requer autorização explícita.
/*
CREATE OR REPLACE FUNCTION public.whatsapp_registrar_mensagem(p_instancia_id uuid, p_zapi_message_id text, p_telefone text, p_direcao whatsapp_mensagem_direcao, p_tipo whatsapp_mensagem_tipo, p_texto text DEFAULT NULL::text, p_legenda text DEFAULT NULL::text, p_media_url text DEFAULT NULL::text, p_nome_contato text DEFAULT NULL::text, p_payload jsonb DEFAULT '{}'::jsonb, p_momento timestamp with time zone DEFAULT NULL::timestamp with time zone, p_origem text DEFAULT 'humano'::text)
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

  -- Só cliente ATIVO conta (21/10/2026): cadastro repetido e desligado não
  -- pode impedir a ligação automática. Se só houver inativo, ele ainda é o
  -- cliente — quem volta a escrever depois de desligado continua conhecido.
  SELECT array_agg(DISTINCT c.id) INTO v_clientes
  FROM (
    SELECT id FROM public.clientes WHERE telefone_normalizado = v_tel AND ativo IS NOT FALSE
    UNION
    SELECT id FROM public.clientes WHERE public.normalize_whatsapp_phone(whatsapp_principal) = v_tel AND ativo IS NOT FALSE
    UNION
    SELECT cc.cliente_id FROM public.cliente_contatos cc
      JOIN public.clientes cl ON cl.id = cc.cliente_id AND cl.ativo IS NOT FALSE
    WHERE public.normalize_whatsapp_phone(cc.telefone) = v_tel
  ) c;
  IF v_clientes IS NULL THEN
    SELECT array_agg(DISTINCT c.id) INTO v_clientes
    FROM (
      SELECT id FROM public.clientes WHERE telefone_normalizado = v_tel
      UNION
      SELECT id FROM public.clientes WHERE public.normalize_whatsapp_phone(whatsapp_principal) = v_tel
      UNION
      SELECT cliente_id FROM public.cliente_contatos
      WHERE public.normalize_whatsapp_phone(telefone) = v_tel
    ) c;
  END IF;
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
       AND COALESCE(p_origem, 'humano') <> 'automacao'
       AND NOT public._wa_telefone_da_equipe(v_tel) THEN
      INSERT INTO public.leads (nome, telefone, telefone_original, origem, campanha, interesse, status, temporario)
      VALUES (
        COALESCE(v_nome, 'Lead WhatsApp ' || v_tel),
        p_telefone,
        p_telefone,
        -- Click-to-WhatsApp: origem real quando o contato veio do Instagram/Facebook.
        CASE p_payload->>'canal_origem'
          WHEN 'instagram' THEN 'Instagram'
          WHEN 'facebook'  THEN 'Facebook'
          ELSE 'whatsapp'
        END,
        CASE WHEN NULLIF(btrim(p_payload->>'anuncio_id'), '') IS NOT NULL
          THEN 'Anúncio ' || btrim(p_payload->>'anuncio_id')
          ELSE NULL  -- como hoje: o INSERT atual não preenche campanha
        END,
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
REVOKE ALL ON FUNCTION public.whatsapp_registrar_mensagem(uuid, text, text, public.whatsapp_mensagem_direcao, public.whatsapp_mensagem_tipo, text, text, text, text, jsonb, timestamptz, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_registrar_mensagem(uuid, text, text, public.whatsapp_mensagem_direcao, public.whatsapp_mensagem_tipo, text, text, text, text, jsonb, timestamptz, text) TO service_role;
DROP FUNCTION public._wa_telefone_de_parceiro(text);
DROP TABLE public.anuncios_de_parceiro;
ALTER TABLE public.leads DROP COLUMN tipo;
*/
