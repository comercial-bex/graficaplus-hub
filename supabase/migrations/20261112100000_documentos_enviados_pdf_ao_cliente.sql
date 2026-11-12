-- PDF ao cliente (12/11/2026): o registro de cada envio do orçamento, da OS e do orçamento 3D.
--
-- Pedido do dono (11/11): "o orçamento ou ordem de serviço tem que ser enviado o arquivo em PDF na
-- conversa com cliente". O envio sai por enviarDocumentoAoCliente (src/lib/api/documento-whatsapp.functions.ts),
-- que confere a permissão de quem chama e depois chama, com a chave de serviço:
--   whatsapp_responder_arquivo (já existe, NÃO muda) e registrar_envio_documento (esta migração).
-- O wa.me e o "Link do cliente" registram INTENÇÃO (canais wa_me e link_copiado), não prova de envio.
--
-- Regras da casa seguidas aqui:
--   * tabela nova nasce com GRANT de tudo para anon e authenticated: REVOKE por extenso;
--   * função SECURITY DEFINER com SET search_path = public, REVOKE de PUBLIC, anon e authenticated,
--     EXECUTE só para service_role;
--   * vista com WITH (security_invoker = true) escrito por extenso; não lê orcamentos nem
--     ordens_servico (GRANT por coluna: coluna sem grant derrubaria a vista para todos);
--   * enviado_por e usuario_id usam o id de login, o mesmo de whatsapp_mensagens.enviada_por;
--   * status e enviado_em do orçamento pelo sistema só mudam quando a mensagem SAIU (confirmar_envio_documento);
--   * zz_orcamento_congela_versao grava o autor por auth.uid(): com a chave de serviço seria nulo,
--     então a função preenche request.jwt.claim.sub antes de mudar o status (precedente:
--     20261102163000 e 20261026800000).
-- Ordem: aplicar e conferir no banco ANTES do Publish do front que chama registrar_envio_documento.

-- 1. Tabela
CREATE TABLE IF NOT EXISTS public.documentos_enviados (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo text NOT NULL CHECK (tipo IN ('orcamento', 'os', 'orcamento_3d')),
  referencia_id uuid NOT NULL,  -- polimórfico (orçamento, OS ou 3D): sem FK, como owner_id
  documento_id uuid REFERENCES public.documentos_gerados(id) ON DELETE SET NULL,
  mensagem_id uuid REFERENCES public.whatsapp_mensagens(id) ON DELETE SET NULL,
  conversa_id uuid REFERENCES public.whatsapp_conversas(id) ON DELETE SET NULL,
  canal text NOT NULL CHECK (canal IN ('whatsapp_sistema', 'whatsapp_celular', 'wa_me', 'link_copiado', 'balcao')),
  enviado_por uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,  -- o mesmo id de whatsapp_mensagens.enviada_por (id de login)
  enviado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS documentos_enviados_referencia_idx
  ON public.documentos_enviados (tipo, referencia_id, enviado_em DESC);
CREATE INDEX IF NOT EXISTS documentos_enviados_mensagem_idx
  ON public.documentos_enviados (mensagem_id) WHERE mensagem_id IS NOT NULL;
-- Sem CHECK "whatsapp_sistema exige mensagem_id": o ON DELETE SET NULL da mensagem quebraria a exclusão
-- da conversa. A função abaixo exige.

ALTER TABLE public.documentos_enviados ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.documentos_enviados FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.documentos_enviados TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.documentos_enviados TO service_role;

DROP POLICY IF EXISTS "documentos_enviados le quem le o documento" ON public.documentos_enviados;
CREATE POLICY "documentos_enviados le quem le o documento" ON public.documentos_enviados
  FOR SELECT TO authenticated
  USING (
    (tipo = 'orcamento' AND public.has_permission((SELECT auth.uid()), 'orcamentos.read'))
    OR (tipo = 'os' AND public.has_permission((SELECT auth.uid()), 'os.read'))
    OR (tipo = 'orcamento_3d' AND public.has_permission((SELECT auth.uid()), 'impressao3d.read'))
  );
-- Nenhuma policy de escrita: só registrar_envio_documento grava.

-- 2. Função (único escritor)
CREATE OR REPLACE FUNCTION public.registrar_envio_documento(
  p_usuario uuid,
  p_tipo text,
  p_referencia_id uuid,
  p_canal text,
  p_documento_id uuid DEFAULT NULL,
  p_mensagem_id uuid DEFAULT NULL,
  p_conversa_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_intencao boolean := p_canal IN ('wa_me', 'link_copiado');
  v_numero text; v_cliente uuid; v_os uuid; v_do text;
  v_doc public.documentos_gerados%ROWTYPE;
  v_msg public.whatsapp_mensagens%ROWTYPE;
  v_id uuid; v_em timestamptz;
  v_status text; v_sem_data boolean;
  v_status_mudou boolean := false; v_gravou_data boolean := false;
BEGIN
  IF p_usuario IS NULL THEN RAISE EXCEPTION 'Quem mandou não foi informado.'; END IF;
  IF p_tipo IS NULL OR p_tipo NOT IN ('orcamento', 'os', 'orcamento_3d') THEN
    RAISE EXCEPTION 'Tipo de documento inválido.';
  END IF;
  -- Esta onda abre três portas; whatsapp_celular (A3.5) e balcao entram por CREATE OR REPLACE depois.
  IF p_canal IS NULL OR p_canal NOT IN ('whatsapp_sistema', 'wa_me', 'link_copiado') THEN
    RAISE EXCEPTION 'Canal sem porta de registro: %.', coalesce(p_canal, 'vazio');
  END IF;

  -- Segunda tranca: a mesma regra de src/domain/whatsapp/envio-de-documento.ts.
  IF p_canal = 'whatsapp_sistema' AND NOT public.has_permission(p_usuario, 'whatsapp.reply') THEN
    RAISE EXCEPTION 'Seu perfil não pode mandar mensagem pelo WhatsApp: falta a permissão whatsapp › reply.';
  END IF;
  IF p_tipo = 'orcamento' AND NOT public.has_permission(p_usuario, 'orcamentos.send') THEN
    RAISE EXCEPTION 'Seu perfil não pode mandar orçamento ao cliente: falta a permissão orcamentos › send.';
  ELSIF p_tipo = 'os' AND NOT (public.has_permission(p_usuario, 'os.read') AND public.can_see_prices(p_usuario)) THEN
    RAISE EXCEPTION 'Só quem vê o preço da OS manda a via do cliente.';
  ELSIF p_tipo = 'orcamento_3d' AND NOT public.has_permission(p_usuario, 'impressao3d.quote.update') THEN
    RAISE EXCEPTION 'Seu perfil não pode mandar o orçamento 3D: falta a permissão impressao3d › quote.update.';
  END IF;

  IF v_intencao AND (p_tipo <> 'orcamento' OR p_mensagem_id IS NOT NULL OR p_documento_id IS NOT NULL) THEN
    RAISE EXCEPTION 'wa.me e link copiado valem só para o orçamento, sem mensagem e sem PDF.';
  END IF;
  IF p_canal = 'whatsapp_sistema' AND (p_mensagem_id IS NULL OR p_conversa_id IS NULL) THEN
    RAISE EXCEPTION 'Envio pelo sistema sem a mensagem da conversa.';
  END IF;
  IF p_tipo <> 'orcamento' AND p_documento_id IS NULL THEN
    RAISE EXCEPTION 'A OS e o orçamento 3D só vão com o PDF.';
  END IF;

  -- A referência
  IF p_tipo = 'orcamento' THEN
    SELECT o.numero::text, o.cliente_id, o.os_id INTO v_numero, v_cliente, v_os
      FROM public.orcamentos o WHERE o.id = p_referencia_id;
  ELSIF p_tipo = 'os' THEN
    SELECT s.numero::text, s.cliente_id, s.id INTO v_numero, v_cliente, v_os
      FROM public.ordens_servico s WHERE s.id = p_referencia_id;
  ELSE
    SELECT coalesce(o.numero::text, upper(left(t.id::text, 8))), t.cliente_id, t.os_id
      INTO v_numero, v_cliente, v_os
      FROM public.orcamentos_3d t LEFT JOIN public.orcamentos o ON o.id = t.orcamento_id
     WHERE t.id = p_referencia_id;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'Documento não encontrado.'; END IF;
  v_do := CASE p_tipo WHEN 'orcamento' THEN 'do orçamento nº ' WHEN 'os' THEN 'da ordem de serviço nº '
                      ELSE 'do orçamento 3D nº ' END || v_numero;

  IF p_documento_id IS NOT NULL THEN
    SELECT * INTO v_doc FROM public.documentos_gerados WHERE id = p_documento_id;
    IF NOT FOUND OR v_doc.tipo <> p_tipo OR v_doc.referencia_id <> p_referencia_id
       OR v_doc.variante <> 'cliente' OR v_doc.gerado_por IS DISTINCT FROM p_usuario THEN
      RAISE EXCEPTION 'O PDF informado não é a via do cliente deste documento gerada por você.';
    END IF;
  END IF;

  IF p_mensagem_id IS NOT NULL THEN
    SELECT * INTO v_msg FROM public.whatsapp_mensagens WHERE id = p_mensagem_id;
    IF NOT FOUND OR v_msg.direcao::text <> 'saida' OR v_msg.conversa_id IS DISTINCT FROM p_conversa_id
       OR v_msg.enviada_por IS DISTINCT FROM p_usuario THEN
      RAISE EXCEPTION 'A mensagem informada não é um envio seu nesta conversa.';
    END IF;
  END IF;

  INSERT INTO public.documentos_enviados (tipo, referencia_id, documento_id, mensagem_id, conversa_id, canal, enviado_por)
  VALUES (p_tipo, p_referencia_id, p_documento_id, p_mensagem_id, p_conversa_id, p_canal, p_usuario)
  RETURNING id, enviado_em INTO v_id, v_em;

  -- A mensagem passa a dizer o que levou (sem trocar whatsapp_responder_arquivo).
  IF p_mensagem_id IS NOT NULL THEN
    UPDATE public.whatsapp_mensagens
       SET payload = coalesce(payload, '{}'::jsonb) || jsonb_build_object(
             CASE p_tipo WHEN 'orcamento' THEN 'orcamento_id' WHEN 'os' THEN 'os_id' ELSE 'orcamento_3d_id' END,
             p_referencia_id, 'documento_enviado_id', v_id),
           os_id = CASE WHEN p_tipo = 'os' THEN coalesce(os_id, p_referencia_id) ELSE os_id END
     WHERE id = p_mensagem_id;
  END IF;

  -- Orçamento pelo wa.me (intenção, como a tela fazia): rascunho vira enviado e o 1º envio fica em
  -- enviado_em, só quando nulo e só em rascunho ou enviado (aprovado, convertido, expirado e rejeitado
  -- não ganham data). Link copiado não mexe. Pelo sistema, status e enviado_em esperam a mensagem SAIR:
  -- confirmar_envio_documento, abaixo.
  IF p_tipo = 'orcamento' AND p_canal = 'wa_me' THEN
    -- zz_orcamento_congela_versao grava o autor da versão por auth.uid(); com a chave de serviço seria nulo.
    PERFORM set_config('request.jwt.claim.sub', p_usuario::text, true);
    SELECT o.status::text, o.enviado_em IS NULL INTO v_status, v_sem_data
      FROM public.orcamentos o WHERE o.id = p_referencia_id FOR UPDATE;
    IF v_status = 'rascunho' THEN
      UPDATE public.orcamentos SET status = 'enviado', enviado_em = coalesce(enviado_em, v_em)
       WHERE id = p_referencia_id;
      v_status_mudou := true;
      v_gravou_data := v_sem_data;
    ELSIF v_status = 'enviado' AND v_sem_data THEN
      UPDATE public.orcamentos SET enviado_em = v_em WHERE id = p_referencia_id;
      v_gravou_data := true;
    END IF;
  END IF;

  -- Liga a conversa ao documento quando ainda não está ligada (regra de _wa_mensagem_liga_entidade).
  IF p_canal = 'whatsapp_sistema' THEN
    IF p_tipo = 'orcamento' THEN
      UPDATE public.orcamentos SET conversa_id = p_conversa_id WHERE id = p_referencia_id AND conversa_id IS NULL;
    ELSIF p_tipo = 'os' THEN
      UPDATE public.whatsapp_conversas SET os_id = p_referencia_id WHERE id = p_conversa_id AND os_id IS NULL;
    END IF;
  END IF;

  INSERT INTO public.eventos_negocio
    (entidade, entidade_id, os_id, cliente_id, tipo, titulo, descricao, dados_posteriores, usuario_id, origem)
  VALUES (
    p_tipo, p_referencia_id, v_os, v_cliente,
    CASE WHEN v_intencao THEN 'documento_intencao_de_envio' ELSE 'documento_na_fila_do_whatsapp' END,
    CASE p_canal
      WHEN 'whatsapp_sistema' THEN
        CASE WHEN p_documento_id IS NULL THEN 'Link ' || v_do || ' na fila do WhatsApp da gráfica, sem o PDF'
             ELSE 'PDF ' || v_do || ' na fila do WhatsApp da gráfica' END
      WHEN 'wa_me' THEN 'Mensagem ' || v_do || ' aberta no WhatsApp do aparelho, sem prova de envio'
      ELSE 'Link ' || v_do || ' copiado, sem prova de envio'
    END,
    NULL,
    jsonb_build_object('envio_id', v_id, 'canal', p_canal, 'documento_id', p_documento_id,
                       'mensagem_id', p_mensagem_id, 'conversa_id', p_conversa_id),
    p_usuario, 'sistema');

  RETURN jsonb_build_object('envio_id', v_id, 'enviado_em', v_em,
                            'status_mudou', v_status_mudou, 'enviado_em_gravado', v_gravou_data);
END
$$;

REVOKE ALL ON FUNCTION public.registrar_envio_documento(uuid, text, uuid, text, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_envio_documento(uuid, text, uuid, text, uuid, uuid, uuid) TO service_role;

-- 2b. Confirmação: só depois que a mensagem SAIU o orçamento passa de rascunho a enviado, ganha
--     enviado_em (só quando nulo, e só em rascunho ou enviado) e o evento "enviado" é gravado.
--     Quem chama é o servidor, quando o despachante confirma a saída. A função confere a situação da
--     mensagem no banco: não confia na tela. Idempotente.
CREATE OR REPLACE FUNCTION public.confirmar_envio_documento(
  p_usuario uuid,
  p_envio_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_env public.documentos_enviados%ROWTYPE;
  v_msg_status text; v_msg_em timestamptz;
  v_numero text; v_cliente uuid; v_os uuid; v_do text;
  v_status text; v_sem_data boolean;
  v_status_mudou boolean := false; v_gravou_data boolean := false;
BEGIN
  IF p_usuario IS NULL OR p_envio_id IS NULL THEN RAISE EXCEPTION 'Faltou informar quem confirma ou o envio.'; END IF;
  SELECT * INTO v_env FROM public.documentos_enviados WHERE id = p_envio_id;
  IF NOT FOUND OR v_env.canal <> 'whatsapp_sistema' OR v_env.enviado_por IS DISTINCT FROM p_usuario THEN
    RAISE EXCEPTION 'Este envio não é seu pelo WhatsApp da gráfica.';
  END IF;
  SELECT m.status::text, coalesce(m.enviado_em, now()) INTO v_msg_status, v_msg_em
    FROM public.whatsapp_mensagens m WHERE m.id = v_env.mensagem_id;
  IF v_msg_status IS NULL OR v_msg_status NOT IN ('enviada', 'entregue', 'lida') THEN
    RAISE EXCEPTION 'A mensagem ainda não saiu pelo WhatsApp.';
  END IF;

  IF v_env.tipo = 'orcamento' THEN
    SELECT o.numero::text, o.cliente_id, o.os_id INTO v_numero, v_cliente, v_os
      FROM public.orcamentos o WHERE o.id = v_env.referencia_id;
  ELSIF v_env.tipo = 'os' THEN
    SELECT s.numero::text, s.cliente_id, s.id INTO v_numero, v_cliente, v_os
      FROM public.ordens_servico s WHERE s.id = v_env.referencia_id;
  ELSE
    SELECT coalesce(o.numero::text, upper(left(t.id::text, 8))), t.cliente_id, t.os_id
      INTO v_numero, v_cliente, v_os
      FROM public.orcamentos_3d t LEFT JOIN public.orcamentos o ON o.id = t.orcamento_id
     WHERE t.id = v_env.referencia_id;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'Documento não encontrado.'; END IF;
  v_do := CASE v_env.tipo WHEN 'orcamento' THEN 'do orçamento nº ' WHEN 'os' THEN 'da ordem de serviço nº '
                          ELSE 'do orçamento 3D nº ' END || v_numero;

  IF v_env.tipo = 'orcamento' THEN
    PERFORM set_config('request.jwt.claim.sub', p_usuario::text, true);
    SELECT o.status::text, o.enviado_em IS NULL INTO v_status, v_sem_data
      FROM public.orcamentos o WHERE o.id = v_env.referencia_id FOR UPDATE;
    IF v_status = 'rascunho' THEN
      UPDATE public.orcamentos SET status = 'enviado', enviado_em = coalesce(enviado_em, v_msg_em)
       WHERE id = v_env.referencia_id;
      v_status_mudou := true;
      v_gravou_data := v_sem_data;
    ELSIF v_status = 'enviado' AND v_sem_data THEN
      UPDATE public.orcamentos SET enviado_em = v_msg_em WHERE id = v_env.referencia_id;
      v_gravou_data := true;
    END IF;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.eventos_negocio e
     WHERE e.entidade = v_env.tipo AND e.entidade_id = v_env.referencia_id
       AND e.tipo = 'documento_enviado_ao_cliente' AND e.dados_posteriores->>'envio_id' = p_envio_id::text
  ) THEN
    INSERT INTO public.eventos_negocio
      (entidade, entidade_id, os_id, cliente_id, tipo, titulo, descricao, dados_posteriores, usuario_id, origem)
    VALUES (
      v_env.tipo, v_env.referencia_id, v_os, v_cliente, 'documento_enviado_ao_cliente',
      CASE WHEN v_env.documento_id IS NULL THEN 'Link ' ELSE 'PDF ' END || v_do || ' enviado pelo WhatsApp da gráfica',
      NULL,
      jsonb_build_object('envio_id', p_envio_id, 'mensagem_id', v_env.mensagem_id, 'situacao', v_msg_status),
      p_usuario, 'sistema');
  END IF;

  RETURN jsonb_build_object('status_mudou', v_status_mudou, 'enviado_em_gravado', v_gravou_data);
END
$$;

REVOKE ALL ON FUNCTION public.confirmar_envio_documento(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirmar_envio_documento(uuid, uuid) TO service_role;

-- 2c. O objeto do PDF no Storage, lido pela chave de serviço: dono (owner_id) e criação (created_at) são
--     do Storage, o navegador não escolhe. O servidor confere os dois antes de copiar o arquivo, porque a
--     linha de documentos_gerados (policy "docs insert", só orcamentos.create) pode ser forjada por quem
--     insere: variante, gerado_por e created_at são campos dele.
CREATE OR REPLACE FUNCTION public.arquivo_do_pdf_gerado(p_caminho text) RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    (SELECT jsonb_build_object('owner_id', o.owner_id, 'created_at', o.created_at)
       FROM storage.objects o
      WHERE o.bucket_id = 'documentos-pdf' AND o.name = p_caminho
      LIMIT 1),
    jsonb_build_object('owner_id', NULL, 'created_at', NULL));
$$;

REVOKE ALL ON FUNCTION public.arquivo_do_pdf_gerado(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.arquivo_do_pdf_gerado(text) TO service_role;

-- 3. Vista (security_invoker: a RLS de documentos_enviados e de whatsapp_mensagens vale para quem lê).
--    NÃO lê orcamentos nem ordens_servico (GRANT por coluna: coluna sem grant derruba a vista para todos).
CREATE OR REPLACE VIEW public.vw_envio_dos_documentos
WITH (security_invoker = true) AS
WITH base AS (
  SELECT d.id, d.tipo, d.referencia_id, d.mensagem_id, d.canal, d.enviado_por, d.enviado_em,
         m.status::text AS situacao_da_mensagem, m.enviado_em AS mensagem_saiu_em,
         m.entregue_em, m.lido_em, m.erro AS erro_da_mensagem,
         -- Efetivo: não é só intenção (wa.me, link) e, quando foi pela fila, a mensagem saiu. Na fila ou com
         -- falha não conta. Os campos da mensagem são informativos, não prova de entrega.
         (d.canal NOT IN ('wa_me', 'link_copiado')
          AND (d.mensagem_id IS NULL OR m.status::text IN ('enviada', 'entregue', 'lida'))) AS efetivo
    FROM public.documentos_enviados d
    LEFT JOIN public.whatsapp_mensagens m ON m.id = d.mensagem_id
), ultima_no_whatsapp AS (
  SELECT DISTINCT ON (b.tipo, b.referencia_id)
         b.tipo, b.referencia_id, b.mensagem_id, b.situacao_da_mensagem, b.mensagem_saiu_em,
         b.entregue_em, b.lido_em, b.erro_da_mensagem
    FROM base b
   WHERE b.mensagem_id IS NOT NULL
   ORDER BY b.tipo, b.referencia_id, b.enviado_em DESC, b.id DESC
)
SELECT b.tipo,
       b.referencia_id,
       count(*)::int AS envios,
       min(b.enviado_em) AS primeiro_envio_em,
       max(b.enviado_em) AS ultimo_envio_em,
       min(b.enviado_em) FILTER (WHERE b.efetivo) AS primeiro_envio_efetivo_em,
       max(b.enviado_em) FILTER (WHERE b.efetivo) AS ultimo_envio_efetivo_em,
       (array_agg(b.canal ORDER BY b.enviado_em DESC, b.id DESC))[1] AS ultimo_canal,
       (array_agg(b.enviado_por ORDER BY b.enviado_em DESC, b.id DESC))[1] AS ultimo_enviado_por,
       u.mensagem_id AS ultima_mensagem_id,
       u.situacao_da_mensagem, u.mensagem_saiu_em, u.entregue_em, u.lido_em, u.erro_da_mensagem
  FROM base b
  LEFT JOIN ultima_no_whatsapp u ON u.tipo = b.tipo AND u.referencia_id = b.referencia_id
 GROUP BY b.tipo, b.referencia_id, u.mensagem_id, u.situacao_da_mensagem, u.mensagem_saiu_em,
          u.entregue_em, u.lido_em, u.erro_da_mensagem;

REVOKE ALL ON public.vw_envio_dos_documentos FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.vw_envio_dos_documentos TO authenticated, service_role;
