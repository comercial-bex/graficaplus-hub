-- ============================================================================
-- Onda 17 — o que o cliente vê: /portal-cliente (logado) e /publico/$token (link)
-- ============================================================================
--
-- O QUE ESTAVA ERRADO (medido em 02/10/2026)
--   /portal-cliente   lia `ordens_servico_financeiro`, que só devolve linha para
--                     quem tem financeiro.read: a conta de cliente (só
--                     portal.read) via sempre "Nenhuma OS registrada". Mostrava
--                     ao cliente a RECEITA LÍQUIDA da OS (número interno de
--                     resultado) e o envio de arquivo estava desligado.
--   /publico/$token   era DEMONSTRAÇÃO: qualquer token abria o mesmo cliente e o
--                     mesmo orçamento fictícios ('orc-245'), e Aprovar orçamento /
--                     Enviar arquivo / Aprovar ou Reprovar arte / Enviar
--                     comprovante respondiam "Recebemos sua solicitação… A equipe
--                     foi notificada." SEM gravar nada. O token era assinado com
--                     um segredo que, sem variável de ambiente, caía num texto
--                     fixo escrito no código.
--
-- O MOLDE: o mesmo do link de aprovação de arte e do crachá da TV
--   token   32 bytes aleatórios em base64url, sorteados AQUI (portal_gerar_link)
--           e devolvidos em claro uma vez só, para quem gerou na ficha
--   banco   guarda só o SHA-256, com validade (padrão 30, teto 90 dias) e
--           cancelamento; um link vivo por cliente — gerar outro cancela o
--           anterior
--   rota    de servidor (/api/portal/*) manda ao banco só o hash e repassa o
--           jsonb que as funções portal_link_* montaram — lista fechada
--
-- O QUE O CLIENTE VÊ (portal_painel_do_cliente — uma função para as duas portas)
--   número, título, status, prazo e VALOR DO PEDIDO (o preço do que comprou);
--   as artes que a equipe mandou para aprovação; os PDFs gerados para o
--   cliente; os arquivos que ele mesmo mandou; os orçamentos enviados com o
--   link de resposta; o que ele já mandou. Custo, margem, resultado e receita
--   líquida não existem na resposta. Arquivo de produção (imposição, que pode
--   ter peça de outro cliente) não aparece: só arte, o que tem pedido de
--   aprovação e o que o próprio cliente mandou (portal_arquivo_visivel).
--
-- O QUE O CLIENTE MANDA, E PARA ONDE VAI
--   arquivo      Storage arquivos-clientes, pasta portal/<cliente>/<os>/, e linha
--                em `arquivos` — aparece para a equipe na ficha da OS, aba Arquivos
--   comprovante  Storage comprovantes (só quem vê dinheiro lê) e linha em
--                `portal_comprovantes` (RLS can_see_financials). NÃO entra em
--                `arquivos`: lá o impressor veria o valor pago
--   mensagem     `portal_cliente_solicitacoes`
--   Os três abrem uma solicitação que a equipe vê na ficha do cliente e em
--   "O que falta de mim" (pendencias_do_sistema, mais abaixo).
--   O banco confere que o objeto EXISTE em storage.objects antes de registrar:
--   registrar o que não subiu poria na OS um arquivo que não abre.
--
-- A ARTE: uma regra só para três portas
--   O miolo de `registrar_decisao_aprovacao` (travar o pedido, gravar a
--   decisão, mudar o arquivo, andar a OS) virou `decidir_arte_por_token`, e a
--   função antiga passou a chamá-lo — mesmas validações, mesmas mensagens,
--   mesmos efeitos (ensaiado). O portal logado e o portal por link decidem pelo
--   mesmo miolo, só sobre a arte que a equipe mandou para aprovação
--   (pedido aberto em arquivo_tokens_externos), de uma OS do cliente.
--
-- QUEM CHAMA O QUÊ
--   equipe (authenticated, guarda no corpo)  portal_gerar_link e
--       portal_revogar_link (clientes.update), portal_links_do_cliente
--       (clientes.read), portal_conferir_comprovante (pagamentos.confirm)
--   cliente logado (authenticated, vínculo ativo em portal_cliente_acessos +
--       portal.read)  portal_meu_painel, portal_meu_objeto,
--       portal_registrar_envio, portal_enviar_mensagem, portal_decidir_arte,
--       e as duas funções das policies de storage
--   servidor (só service_role)  portal_link_abrir, portal_link_abrir_envio,
--       portal_link_registrar_envio, portal_link_enviar_mensagem,
--       portal_link_decidir_arte, portal_link_objeto
--   peças de dentro (ninguém tem EXECUTE)  o resto
--
-- Retrato do banco vivo: cada bloco foi ensaiado com reversão (RAISE EXCEPTION
-- no fim do DO) antes de aplicado. Ensaios no fim do arquivo.

-- ---------------------------------------------------------------- 1. tabelas
CREATE TABLE IF NOT EXISTS public.portal_cliente_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id uuid NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  expira_em timestamptz NOT NULL,
  criado_por uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  revogado_em timestamptz,
  revogado_por uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  ultimo_acesso_em timestamptz,
  CONSTRAINT portal_cliente_links_vence_depois CHECK (expira_em > criado_em)
);
CREATE INDEX IF NOT EXISTS portal_cliente_links_cliente_idx
  ON public.portal_cliente_links (cliente_id, criado_em DESC);
ALTER TABLE public.portal_cliente_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.portal_cliente_links FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.portal_comprovantes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id uuid NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  os_id uuid REFERENCES public.ordens_servico(id) ON DELETE SET NULL,
  caminho text NOT NULL UNIQUE,
  nome text NOT NULL CHECK (length(btrim(nome)) BETWEEN 1 AND 200),
  mime_type text,
  tamanho_bytes bigint,
  observacao text CHECK (observacao IS NULL OR length(observacao) <= 1000),
  origem text NOT NULL CHECK (origem IN ('portal', 'link')),
  enviado_por uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  link_id uuid REFERENCES public.portal_cliente_links(id) ON DELETE SET NULL,
  solicitacao_id uuid REFERENCES public.portal_cliente_solicitacoes(id) ON DELETE SET NULL,
  situacao text NOT NULL DEFAULT 'a_conferir' CHECK (situacao IN ('a_conferir', 'conferido', 'recusado')),
  conferido_por uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  conferido_em timestamptz,
  nota_da_conferencia text CHECK (nota_da_conferencia IS NULL OR length(nota_da_conferencia) <= 500),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS portal_comprovantes_cliente_idx
  ON public.portal_comprovantes (cliente_id, created_at DESC);
CREATE INDEX IF NOT EXISTS portal_comprovantes_a_conferir_idx
  ON public.portal_comprovantes (cliente_id) WHERE situacao = 'a_conferir';
ALTER TABLE public.portal_comprovantes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.portal_comprovantes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.portal_comprovantes TO authenticated;

DO $p$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                  AND tablename = 'portal_comprovantes'
                  AND policyname = 'comprovante do portal: so quem ve dinheiro') THEN
    CREATE POLICY "comprovante do portal: so quem ve dinheiro" ON public.portal_comprovantes
      FOR SELECT TO authenticated
      USING (public.can_see_financials((SELECT auth.uid())));
  END IF;
END $p$;

-- ----------------------------------------------------- 2. peças de dentro
CREATE OR REPLACE FUNCTION public.portal_situacao_do_link(p_token_hash text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $f$
DECLARE l public.portal_cliente_links%ROWTYPE;
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('situacao', 'invalido');
  END IF;
  SELECT * INTO l FROM public.portal_cliente_links WHERE token_hash = p_token_hash;
  IF NOT FOUND THEN RETURN jsonb_build_object('situacao', 'invalido'); END IF;
  IF l.revogado_em IS NOT NULL THEN RETURN jsonb_build_object('situacao', 'revogado'); END IF;
  IF l.expira_em <= now() THEN RETURN jsonb_build_object('situacao', 'vencido'); END IF;
  RETURN jsonb_build_object('situacao', 'aberto', 'link_id', l.id, 'cliente_id', l.cliente_id,
                            'vence_em', l.expira_em);
END $f$;

CREATE OR REPLACE FUNCTION public.portal_arquivo_visivel(p_arquivo_id uuid, p_cliente_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $f$
  SELECT EXISTS (
    SELECT 1
      FROM public.arquivos a
      JOIN public.ordens_servico o ON o.id = a.os_id
     WHERE a.id = p_arquivo_id
       AND o.cliente_id = p_cliente_id
       AND coalesce(a.ativo, true)
       AND a.status::text NOT IN ('inativo', 'substituido')
       AND coalesce(a.bucket, 'arquivos-clientes') = 'arquivos-clientes'
       AND (a.caminho LIKE 'portal/' || p_cliente_id::text || '/%'
            OR a.tipo::text = 'arte'
            OR EXISTS (SELECT 1 FROM public.arquivo_tokens_externos t WHERE t.arquivo_id = a.id))
  )
$f$;

CREATE OR REPLACE FUNCTION public.portal_documento_visivel(p_documento_id uuid, p_cliente_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $f$
  SELECT EXISTS (
    SELECT 1
      FROM public.documentos_gerados d
     WHERE d.id = p_documento_id
       AND d.variante = 'cliente'
       AND ((d.tipo = 'os' AND EXISTS (
              SELECT 1 FROM public.ordens_servico o
               WHERE o.id = d.referencia_id AND o.cliente_id = p_cliente_id))
         OR (d.tipo = 'orcamento' AND EXISTS (
              SELECT 1 FROM public.orcamentos oc
               WHERE oc.id = d.referencia_id AND oc.cliente_id = p_cliente_id
                 AND oc.status::text <> 'rascunho')))
  )
$f$;

CREATE OR REPLACE FUNCTION public.portal_cliente_da_conta(p_cliente_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $f$
  SELECT auth.uid() IS NOT NULL
     AND p_cliente_id IS NOT NULL
     AND public.has_permission(auth.uid(), 'portal.read')
     AND EXISTS (SELECT 1 FROM public.portal_cliente_acessos pa
                  WHERE pa.usuario_id = auth.uid() AND pa.cliente_id = p_cliente_id AND pa.ativo)
$f$;

REVOKE ALL ON FUNCTION public.portal_situacao_do_link(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.portal_arquivo_visivel(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.portal_documento_visivel(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.portal_cliente_da_conta(uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.portal_painel_do_cliente(p_cliente_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $f$
DECLARE
  v_cliente jsonb; v_empresa jsonb; v_ordens jsonb; v_orcamentos jsonb;
  v_solicitacoes jsonb; v_comprovantes jsonb;
BEGIN
  SELECT jsonb_build_object('id', c.id, 'nome', coalesce(nullif(btrim(c.nome_fantasia), ''), c.nome))
    INTO v_cliente FROM public.clientes c WHERE c.id = p_cliente_id;
  IF v_cliente IS NULL THEN RETURN NULL; END IF;

  SELECT jsonb_build_object(
           'nome', coalesce(nullif(btrim(e.nome), ''), nullif(btrim(e.razao_social), ''), 'Bex Print'),
           'telefones', e.telefones, 'email', e.email)
    INTO v_empresa FROM public.empresa_config e LIMIT 1;

  SELECT coalesce(jsonb_agg(x.item ORDER BY x.encerrada, x.criado_em DESC), '[]'::jsonb)
    INTO v_ordens
    FROM (
      SELECT o.status::text IN ('concluido', 'faturado', 'cancelado') AS encerrada,
             o.created_at AS criado_em,
             jsonb_build_object(
               'id', o.id,
               'numero', o.numero,
               'titulo', o.titulo,
               'status', o.status::text,
               'prazo_entrega', o.prazo_entrega,
               'entregue_em', o.data_entrega_real,
               'criado_em', o.created_at,
               'precisa_entrega', coalesce(o.precisa_entrega, false),
               'precisa_instalacao', coalesce(o.precisa_instalacao, false),
               'valor_pedido', coalesce(f.valor_total, o.valor_total),
               'artes_para_aprovar', coalesce((
                  SELECT jsonb_agg(jsonb_build_object(
                           'arquivo_id', a.id, 'nome', a.nome, 'mime', coalesce(a.mime_type, a.mime),
                           'pedida_em', t.created_at, 'vence_em', t.expira_em) ORDER BY t.created_at)
                    FROM public.arquivo_tokens_externos t
                    JOIN public.arquivos a ON a.id = t.arquivo_id
                   WHERE t.os_id = o.id AND a.os_id = o.id
                     AND t.revogado_em IS NULL AND t.usado_em IS NULL AND t.expira_em > now()
                     AND public.portal_arquivo_visivel(a.id, p_cliente_id)), '[]'::jsonb),
               'arquivos', coalesce((
                  SELECT jsonb_agg(z.item ORDER BY z.criado_em DESC)
                    FROM (SELECT a.created_at AS criado_em,
                                 jsonb_build_object(
                                   'id', a.id, 'nome', a.nome, 'tipo', a.tipo::text,
                                   'situacao', a.status::text, 'criado_em', a.created_at,
                                   'tamanho_bytes', coalesce(a.tamanho_bytes, a.tamanho),
                                   'mime', coalesce(a.mime_type, a.mime),
                                   'do_cliente', a.caminho LIKE 'portal/%') AS item
                            FROM public.arquivos a
                           WHERE a.os_id = o.id AND public.portal_arquivo_visivel(a.id, p_cliente_id)
                           ORDER BY a.created_at DESC LIMIT 50) z), '[]'::jsonb),
               'documentos', coalesce((
                  SELECT jsonb_agg(jsonb_build_object(
                           'id', d.id, 'tipo', d.tipo, 'numero', d.numero,
                           'criado_em', d.created_at, 'tamanho_bytes', d.tamanho_bytes)
                           ORDER BY d.created_at DESC)
                    FROM public.documentos_gerados d
                   WHERE ((d.tipo = 'os' AND d.referencia_id = o.id)
                       OR (d.tipo = 'orcamento' AND d.referencia_id = o.orcamento_id))
                     AND public.portal_documento_visivel(d.id, p_cliente_id)), '[]'::jsonb)
             ) AS item
        FROM public.ordens_servico o
        LEFT JOIN public.os_resultados_financeiros f ON f.os_id = o.id
       WHERE o.cliente_id = p_cliente_id
       ORDER BY o.created_at DESC
       LIMIT 50
    ) x;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', oc.id, 'numero', oc.numero, 'titulo', oc.titulo, 'status', oc.status::text,
           'valor_total', oc.valor_total, 'criado_em', oc.created_at, 'enviado_em', oc.enviado_em,
           'validade_dias', oc.validade_dias, 'token_publico', oc.token_publico)
           ORDER BY oc.created_at DESC), '[]'::jsonb)
    INTO v_orcamentos
    FROM public.orcamentos oc
   WHERE oc.cliente_id = p_cliente_id
     AND oc.status::text IN ('enviado', 'aprovado')
     AND oc.os_id IS NULL;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'tipo', s.tipo, 'mensagem', s.mensagem, 'status', s.status,
           'criado_em', s.created_at, 'os_numero', o.numero) ORDER BY s.created_at DESC), '[]'::jsonb)
    INTO v_solicitacoes
    FROM (SELECT id, tipo, mensagem, status, created_at, os_id
            FROM public.portal_cliente_solicitacoes
           WHERE cliente_id = p_cliente_id
           ORDER BY created_at DESC LIMIT 20) s
    LEFT JOIN public.ordens_servico o ON o.id = s.os_id;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', pc.id, 'nome', pc.nome, 'situacao', pc.situacao, 'criado_em', pc.created_at,
           'os_numero', o.numero,
           'motivo', CASE WHEN pc.situacao = 'recusado' THEN pc.nota_da_conferencia END)
           ORDER BY pc.created_at DESC), '[]'::jsonb)
    INTO v_comprovantes
    FROM (SELECT id, nome, situacao, created_at, os_id, nota_da_conferencia
            FROM public.portal_comprovantes
           WHERE cliente_id = p_cliente_id
           ORDER BY created_at DESC LIMIT 10) pc
    LEFT JOIN public.ordens_servico o ON o.id = pc.os_id;

  RETURN jsonb_build_object(
    'versao', 1,
    'gerado_em', now(),
    'cliente', v_cliente,
    'empresa', coalesce(v_empresa, jsonb_build_object('nome', 'Bex Print', 'telefones', NULL, 'email', NULL)),
    'ordens', v_ordens,
    'orcamentos', v_orcamentos,
    'solicitacoes', v_solicitacoes,
    'comprovantes', v_comprovantes);
END $f$;

CREATE OR REPLACE FUNCTION public.portal_objeto_do_cliente(p_cliente_id uuid, p_tipo text, p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $f$
DECLARE v jsonb;
BEGIN
  IF p_tipo = 'arquivo' THEN
    IF NOT public.portal_arquivo_visivel(p_id, p_cliente_id) THEN RETURN jsonb_build_object('ok', false); END IF;
    SELECT jsonb_build_object('ok', true, 'bucket', 'arquivos-clientes', 'caminho', a.caminho,
                              'nome', a.nome, 'mime', coalesce(a.mime_type, a.mime))
      INTO v FROM public.arquivos a WHERE a.id = p_id;
    RETURN v;
  ELSIF p_tipo = 'documento' THEN
    IF NOT public.portal_documento_visivel(p_id, p_cliente_id) THEN RETURN jsonb_build_object('ok', false); END IF;
    SELECT jsonb_build_object('ok', true, 'bucket', 'documentos-pdf', 'caminho', d.caminho,
                              'nome', CASE WHEN d.tipo = 'os' THEN 'OS-' ELSE 'Orcamento-' END
                                      || coalesce(d.numero::text, left(d.id::text, 8)) || '.pdf',
                              'mime', 'application/pdf')
      INTO v FROM public.documentos_gerados d WHERE d.id = p_id;
    RETURN v;
  END IF;
  RETURN jsonb_build_object('ok', false);
END $f$;

REVOKE ALL ON FUNCTION public.portal_painel_do_cliente(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.portal_objeto_do_cliente(uuid, text, uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.portal_validar_envio(p_cliente_id uuid, p_os_id uuid, p_tipo text)
RETURNS integer
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $f$
DECLARE v_numero integer; v_status text;
BEGIN
  IF p_tipo IS NULL OR p_tipo NOT IN ('arte', 'referencia', 'outro', 'comprovante') THEN
    RAISE EXCEPTION 'Tipo de envio inválido.';
  END IF;
  IF p_os_id IS NULL THEN
    IF p_tipo <> 'comprovante' THEN
      RAISE EXCEPTION 'Escolha a qual pedido (OS) o arquivo pertence.';
    END IF;
    RETURN NULL;
  END IF;
  SELECT numero, status::text INTO v_numero, v_status
    FROM public.ordens_servico WHERE id = p_os_id AND cliente_id = p_cliente_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Este pedido não está na sua lista.'; END IF;
  IF v_status = 'cancelado' THEN
    RAISE EXCEPTION 'Este pedido foi cancelado. Fale com a equipe antes de mandar arquivo.';
  END IF;
  RETURN v_numero;
END $f$;

CREATE OR REPLACE FUNCTION public.portal_gravar_envio(
  p_cliente_id uuid, p_os_id uuid, p_tipo text, p_caminho text, p_nome text, p_mensagem text,
  p_origem text, p_usuario_id uuid, p_link_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $f$
DECLARE
  v_numero integer;
  v_nome text := btrim(coalesce(p_nome, ''));
  v_msg text := nullif(btrim(coalesce(p_mensagem, '')), '');
  v_bucket text; v_prefixo text; v_meta jsonb; v_texto text; v_versao integer;
  v_solicitacao uuid; v_arquivo uuid; v_comprovante uuid;
BEGIN
  v_numero := public.portal_validar_envio(p_cliente_id, p_os_id, p_tipo);
  IF v_nome = '' OR length(v_nome) > 200 THEN
    RAISE EXCEPTION 'Nome de arquivo inválido: use até 200 caracteres.';
  END IF;
  IF v_msg IS NOT NULL AND length(v_msg) > 1000 THEN
    RAISE EXCEPTION 'Mensagem longa demais: o limite é 1.000 caracteres.';
  END IF;

  v_bucket := CASE WHEN p_tipo = 'comprovante' THEN 'comprovantes' ELSE 'arquivos-clientes' END;
  v_prefixo := 'portal/' || p_cliente_id::text || '/' || coalesce(p_os_id::text, 'sem-os') || '/';
  IF p_caminho IS NULL
     OR left(p_caminho, length(v_prefixo)) <> v_prefixo
     OR p_caminho !~ '^portal/[0-9a-f-]{36}/([0-9a-f-]{36}|sem-os)/[A-Za-z0-9._-]{1,160}$' THEN
    RAISE EXCEPTION 'Caminho do arquivo inválido.';
  END IF;

  -- O arquivo tem de ter chegado ao armazenamento: registrar o que não subiu
  -- poria na OS um arquivo que não abre.
  SELECT o.metadata INTO v_meta FROM storage.objects o
   WHERE o.bucket_id = v_bucket AND o.name = p_caminho;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'O arquivo não chegou ao armazenamento. Envie de novo.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.arquivos WHERE caminho = p_caminho)
     OR EXISTS (SELECT 1 FROM public.portal_comprovantes WHERE caminho = p_caminho) THEN
    RAISE EXCEPTION 'Este arquivo já foi registrado.';
  END IF;

  IF p_tipo = 'comprovante' THEN
    -- Sem nome de arquivo nem recado no texto: a solicitação é lida por quem
    -- tem clientes.read, e comprovante é assunto do financeiro.
    v_texto := 'Comprovante de pagamento enviado pelo portal'
               || coalesce(' para a OS #' || v_numero, '') || '. Quem confere é o financeiro.';
  ELSE
    v_texto := 'Arquivo enviado pelo portal para a OS #' || v_numero || ': ' || v_nome
               || '. Já está na OS, aba Arquivos.'
               || coalesce(E'\nRecado do cliente: ' || v_msg, '');
  END IF;

  INSERT INTO public.portal_cliente_solicitacoes (cliente_id, os_id, tipo, mensagem, status)
  VALUES (p_cliente_id, p_os_id, CASE WHEN p_tipo = 'comprovante' THEN 'pagamento' ELSE 'arquivo' END,
          v_texto, 'aberta')
  RETURNING id INTO v_solicitacao;

  IF p_tipo = 'comprovante' THEN
    INSERT INTO public.portal_comprovantes (cliente_id, os_id, caminho, nome, mime_type, tamanho_bytes,
                                            observacao, origem, enviado_por, link_id, solicitacao_id)
    VALUES (p_cliente_id, p_os_id, p_caminho, v_nome, v_meta ->> 'mimetype',
            nullif(v_meta ->> 'size', '')::bigint, v_msg, p_origem, p_usuario_id, p_link_id, v_solicitacao)
    RETURNING id INTO v_comprovante;
  ELSE
    SELECT count(*) + 1 INTO v_versao FROM public.arquivos WHERE os_id = p_os_id AND nome = v_nome;
    INSERT INTO public.arquivos (os_id, cliente_id, nome, caminho, bucket, mime_type, tamanho_bytes,
                                 tipo, status, versao, enviado_por, observacao)
    VALUES (p_os_id, p_cliente_id, v_nome, p_caminho, 'arquivos-clientes', v_meta ->> 'mimetype',
            nullif(v_meta ->> 'size', '')::bigint, p_tipo::public.tipo_arquivo, 'ativo', v_versao,
            p_usuario_id, left('Enviado pelo cliente pelo portal' || coalesce(': ' || v_msg, '.'), 1000))
    RETURNING id INTO v_arquivo;
  END IF;

  INSERT INTO public.logs_auditoria (usuario_id, entidade, entidade_id, acao, detalhes)
  VALUES (p_usuario_id,
          CASE WHEN p_tipo = 'comprovante' THEN 'portal_comprovantes' ELSE 'arquivos' END,
          coalesce(v_comprovante, v_arquivo), 'envio_pelo_portal',
          jsonb_build_object('origem', p_origem, 'link_id', p_link_id, 'cliente_id', p_cliente_id,
                             'os_id', p_os_id, 'tipo', p_tipo, 'nome', v_nome,
                             'solicitacao_id', v_solicitacao));

  RETURN jsonb_build_object('ok', true,
                            'protocolo', upper(left(replace(v_solicitacao::text, '-', ''), 8)),
                            'os_numero', v_numero, 'tipo', p_tipo);
END $f$;

CREATE OR REPLACE FUNCTION public.portal_gravar_mensagem(
  p_cliente_id uuid, p_os_id uuid, p_tipo text, p_mensagem text,
  p_origem text, p_usuario_id uuid, p_link_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $f$
DECLARE v_msg text := btrim(coalesce(p_mensagem, '')); v_numero integer; v_id uuid;
BEGIN
  IF p_tipo IS NULL OR p_tipo NOT IN ('duvida', 'alteracao', 'entrega', 'outro') THEN
    RAISE EXCEPTION 'Tipo de mensagem inválido.';
  END IF;
  IF length(v_msg) < 3 THEN RAISE EXCEPTION 'Escreva a mensagem antes de enviar.'; END IF;
  IF length(v_msg) > 1000 THEN RAISE EXCEPTION 'Mensagem longa demais: o limite é 1.000 caracteres.'; END IF;
  IF p_os_id IS NOT NULL THEN
    SELECT numero INTO v_numero FROM public.ordens_servico WHERE id = p_os_id AND cliente_id = p_cliente_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Este pedido não está na sua lista.'; END IF;
  END IF;

  INSERT INTO public.portal_cliente_solicitacoes (cliente_id, os_id, tipo, mensagem, status)
  VALUES (p_cliente_id, p_os_id, p_tipo, v_msg, 'aberta')
  RETURNING id INTO v_id;

  INSERT INTO public.logs_auditoria (usuario_id, entidade, entidade_id, acao, detalhes)
  VALUES (p_usuario_id, 'portal_cliente_solicitacoes', v_id, 'mensagem_pelo_portal',
          jsonb_build_object('origem', p_origem, 'link_id', p_link_id, 'cliente_id', p_cliente_id,
                             'os_id', p_os_id, 'tipo', p_tipo));

  RETURN jsonb_build_object('ok', true, 'protocolo', upper(left(replace(v_id::text, '-', ''), 8)),
                            'os_numero', v_numero);
END $f$;

REVOKE ALL ON FUNCTION public.portal_validar_envio(uuid, uuid, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.portal_gravar_envio(uuid, uuid, text, text, text, text, text, uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.portal_gravar_mensagem(uuid, uuid, text, text, text, uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

-- ------------------------------------- 3. a arte: um miolo, três portas
CREATE OR REPLACE FUNCTION public.decidir_arte_por_token(
  p_token_id uuid, p_decisao text, p_comentario text, p_canal text, p_usuario_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $f$
declare t public.arquivo_tokens_externos%rowtype; a public.arquivos%rowtype;
begin
  if p_decisao not in ('aprovado','ajuste') then raise exception 'Decisão inválida'; end if;
  if p_decisao = 'ajuste' and coalesce(length(btrim(p_comentario)),0) < 3 then
    raise exception 'Descreva o ajuste desejado para a equipe saber o que corrigir.';
  end if;
  select * into t from public.arquivo_tokens_externos where id = p_token_id for update;
  if not found then raise exception 'Link inválido'; end if;
  if t.revogado_em is not null then raise exception 'Este link foi cancelado pela gráfica.'; end if;
  if t.usado_em is not null then raise exception 'Este link já foi respondido.'; end if;
  if t.expira_em < now() then raise exception 'Este link venceu. Peça um novo à gráfica.'; end if;
  select * into a from public.arquivos where id = t.arquivo_id;
  update public.arquivo_tokens_externos set usado_em = now() where id = t.id;
  insert into public.arquivo_aprovacoes (arquivo_id, decisao, usuario_id, cliente_id, comentario, canal)
  values (t.arquivo_id, p_decisao, p_usuario_id, a.cliente_id, nullif(btrim(p_comentario),''), p_canal);
  update public.arquivos
     set status = (case when p_decisao='aprovado' then 'aprovado' else 'rejeitado' end)::status_arquivo,
         data_aprovacao = case when p_decisao='aprovado' then now() else null end,
         observacao = coalesce(nullif(btrim(p_comentario),''), observacao)
   where id = t.arquivo_id;
  perform set_config('app.avancar_os_status', 'on', true);
  update public.ordens_servico
     set status = (case when p_decisao='aprovado' then 'arte_aprovada' else 'arte_rejeitada' end)::status_os
   where id = t.os_id and status not in ('concluido','faturado','cancelado');
  perform set_config('app.avancar_os_status', 'off', true);
  return jsonb_build_object('ok', true, 'decisao', p_decisao);
end $f$;

CREATE OR REPLACE FUNCTION public.portal_decidir_arte_do_cliente(
  p_cliente_id uuid, p_arquivo_id uuid, p_decisao text, p_comentario text,
  p_canal text, p_usuario_id uuid, p_link_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $f$
DECLARE v_token uuid; v_numero integer; v_res jsonb;
BEGIN
  -- Só a arte que a equipe mandou para aprovação (pedido de aprovação aberto),
  -- da OS deste cliente, na versão vigente.
  SELECT t.id, o.numero INTO v_token, v_numero
    FROM public.arquivo_tokens_externos t
    JOIN public.arquivos a ON a.id = t.arquivo_id
    JOIN public.ordens_servico o ON o.id = t.os_id
   WHERE t.arquivo_id = p_arquivo_id
     AND a.os_id = t.os_id
     AND o.cliente_id = p_cliente_id
     AND t.revogado_em IS NULL AND t.usado_em IS NULL AND t.expira_em > now()
     AND coalesce(a.ativo, true) AND a.status::text NOT IN ('inativo', 'substituido')
   ORDER BY t.created_at DESC
   LIMIT 1;
  IF v_token IS NULL THEN
    RAISE EXCEPTION 'Esta arte não está mais esperando a sua resposta: ela já foi respondida ou a equipe mandou uma versão nova.';
  END IF;

  v_res := public.decidir_arte_por_token(v_token, p_decisao, p_comentario, p_canal, p_usuario_id);

  INSERT INTO public.logs_auditoria (usuario_id, entidade, entidade_id, acao, detalhes)
  VALUES (p_usuario_id, 'arquivos', p_arquivo_id, 'decisao_de_arte_pelo_portal',
          jsonb_build_object('canal', p_canal, 'link_id', p_link_id, 'cliente_id', p_cliente_id,
                             'decisao', p_decisao, 'os_numero', v_numero));

  RETURN v_res || jsonb_build_object('os_numero', v_numero);
END $f$;

REVOKE ALL ON FUNCTION public.decidir_arte_por_token(uuid, text, text, text, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.portal_decidir_arte_do_cliente(uuid, uuid, text, text, text, uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

-- A porta antiga (/aprovar/$token) passa a usar o miolo. Lida VIVA antes
-- (md5 0c0b80face1e59ff78889207486cf08d): mesmas validações na mesma ordem,
-- mesmas mensagens; o canal gravado continua 'link'. Os GRANTs dela (anon,
-- authenticated, service_role) ficam como estavam: CREATE OR REPLACE mantém.
CREATE OR REPLACE FUNCTION public.registrar_decisao_aprovacao(p_token text, p_decisao text, p_comentario text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- A porta do link de aprovação (/aprovar/$token). O miolo — travar o pedido,
-- gravar a decisão, mudar o arquivo e andar a OS — mora em
-- decidir_arte_por_token, o mesmo que o portal do cliente usa: duas portas
-- para o mesmo fato, uma regra só.
declare v_token_id uuid;
begin
  if p_decisao not in ('aprovado','ajuste') then raise exception 'Decisão inválida'; end if;
  if p_decisao = 'ajuste' and coalesce(length(btrim(p_comentario)),0) < 3 then
    raise exception 'Descreva o ajuste desejado para a equipe saber o que corrigir.';
  end if;
  select id into v_token_id from public.arquivo_tokens_externos
   where token_hash = public.hash_token_aprovacao(p_token);
  if not found then raise exception 'Link inválido'; end if;
  return public.decidir_arte_por_token(v_token_id, p_decisao, p_comentario, 'link', null);
end; $function$;

-- ------------------------------------------------- 4. as portas do cliente logado
CREATE OR REPLACE FUNCTION public.portal_meu_painel(p_cliente_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $f$
DECLARE v_uid uuid := auth.uid(); v_clientes jsonb; v_cliente uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Usuário não autenticado.' USING ERRCODE = '28000'; END IF;
  IF NOT public.has_permission(v_uid, 'portal.read') THEN
    RETURN jsonb_build_object('situacao', 'sem_acesso');
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'nome', coalesce(nullif(btrim(c.nome_fantasia), ''), c.nome)) ORDER BY c.nome), '[]'::jsonb)
    INTO v_clientes
    FROM public.portal_cliente_acessos pa
    JOIN public.clientes c ON c.id = pa.cliente_id
   WHERE pa.usuario_id = v_uid AND pa.ativo;
  IF jsonb_array_length(v_clientes) = 0 THEN
    RETURN jsonb_build_object('situacao', 'sem_acesso');
  END IF;
  IF p_cliente_id IS NULL THEN
    v_cliente := (v_clientes -> 0 ->> 'id')::uuid;
  ELSIF public.portal_cliente_da_conta(p_cliente_id) THEN
    v_cliente := p_cliente_id;
  ELSE
    RAISE EXCEPTION 'Este cliente não está liberado para a sua conta.';
  END IF;
  RETURN jsonb_build_object('situacao', 'aberto', 'clientes', v_clientes)
         || public.portal_painel_do_cliente(v_cliente);
END $f$;

CREATE OR REPLACE FUNCTION public.portal_meu_objeto(p_tipo text, p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $f$
DECLARE v_uid uuid := auth.uid(); v_cliente uuid; v_res jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Usuário não autenticado.' USING ERRCODE = '28000'; END IF;
  IF public.has_permission(v_uid, 'portal.read') THEN
    FOR v_cliente IN
      SELECT cliente_id FROM public.portal_cliente_acessos WHERE usuario_id = v_uid AND ativo
    LOOP
      v_res := public.portal_objeto_do_cliente(v_cliente, p_tipo, p_id);
      IF coalesce((v_res ->> 'ok')::boolean, false) THEN RETURN v_res; END IF;
    END LOOP;
  END IF;
  RAISE EXCEPTION 'Arquivo não encontrado entre os seus pedidos.';
END $f$;

CREATE OR REPLACE FUNCTION public.portal_registrar_envio(
  p_cliente_id uuid, p_os_id uuid, p_tipo text, p_caminho text, p_nome text, p_mensagem text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $f$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Usuário não autenticado.' USING ERRCODE = '28000'; END IF;
  IF NOT public.portal_cliente_da_conta(p_cliente_id) THEN
    RAISE EXCEPTION 'Este cliente não está liberado para a sua conta.';
  END IF;
  RETURN public.portal_gravar_envio(p_cliente_id, p_os_id, p_tipo, p_caminho, p_nome, p_mensagem,
                                    'portal', auth.uid(), NULL);
END $f$;

CREATE OR REPLACE FUNCTION public.portal_enviar_mensagem(
  p_cliente_id uuid, p_os_id uuid, p_tipo text, p_mensagem text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $f$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Usuário não autenticado.' USING ERRCODE = '28000'; END IF;
  IF NOT public.portal_cliente_da_conta(p_cliente_id) THEN
    RAISE EXCEPTION 'Este cliente não está liberado para a sua conta.';
  END IF;
  RETURN public.portal_gravar_mensagem(p_cliente_id, p_os_id, p_tipo, p_mensagem,
                                       'portal', auth.uid(), NULL);
END $f$;

CREATE OR REPLACE FUNCTION public.portal_decidir_arte(p_arquivo_id uuid, p_decisao text, p_comentario text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $f$
DECLARE v_cliente uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Usuário não autenticado.' USING ERRCODE = '28000'; END IF;
  SELECT o.cliente_id INTO v_cliente
    FROM public.arquivos a JOIN public.ordens_servico o ON o.id = a.os_id
   WHERE a.id = p_arquivo_id;
  IF v_cliente IS NULL OR NOT public.portal_cliente_da_conta(v_cliente) THEN
    RAISE EXCEPTION 'Esta arte não é de um pedido seu.';
  END IF;
  RETURN public.portal_decidir_arte_do_cliente(v_cliente, p_arquivo_id, p_decisao, p_comentario,
                                               'portal', auth.uid(), NULL);
END $f$;

-- Para as policies de storage.objects. Rodam em TODA leitura e escrita de
-- arquivo de quem está logado, inclusive da equipe: a primeira pergunta é a
-- mais barata e já dispensa quem não é cliente de portal.
CREATE OR REPLACE FUNCTION public.portal_pode_ler_objeto(p_bucket text, p_nome text)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $f$
DECLARE v_uid uuid := auth.uid(); v_pasta text[];
BEGIN
  IF v_uid IS NULL OR p_nome IS NULL THEN RETURN false; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.portal_cliente_acessos WHERE usuario_id = v_uid AND ativo) THEN
    RETURN false;
  END IF;
  IF NOT public.has_permission(v_uid, 'portal.read') THEN RETURN false; END IF;

  -- 1. O que o próprio cliente mandou pelo portal.
  v_pasta := regexp_match(p_nome, '^portal/([0-9a-f-]{36})/');
  IF v_pasta IS NOT NULL AND p_bucket IN ('arquivos-clientes', 'comprovantes') THEN
    RETURN EXISTS (SELECT 1 FROM public.portal_cliente_acessos
                    WHERE usuario_id = v_uid AND ativo AND cliente_id::text = v_pasta[1]);
  END IF;

  -- 2. Arte e arquivo da OS que a equipe mostrou ao cliente.
  IF p_bucket = 'arquivos-clientes' THEN
    RETURN EXISTS (
      SELECT 1
        FROM public.arquivos a
        JOIN public.ordens_servico o ON o.id = a.os_id
        JOIN public.portal_cliente_acessos pa
          ON pa.cliente_id = o.cliente_id AND pa.usuario_id = v_uid AND pa.ativo
       WHERE a.caminho = p_nome
         AND public.portal_arquivo_visivel(a.id, o.cliente_id));
  END IF;

  -- 3. PDF gerado para o cliente (OS e orçamento).
  IF p_bucket = 'documentos-pdf' THEN
    RETURN EXISTS (
      SELECT 1
        FROM public.documentos_gerados d
        JOIN public.portal_cliente_acessos pa ON pa.usuario_id = v_uid AND pa.ativo
       WHERE d.caminho = p_nome
         AND public.portal_documento_visivel(d.id, pa.cliente_id));
  END IF;
  RETURN false;
END $f$;

CREATE OR REPLACE FUNCTION public.portal_pode_enviar_objeto(p_bucket text, p_nome text)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $f$
DECLARE v_uid uuid := auth.uid(); v_partes text[];
BEGIN
  IF v_uid IS NULL OR p_nome IS NULL OR p_bucket NOT IN ('arquivos-clientes', 'comprovantes') THEN
    RETURN false;
  END IF;
  v_partes := regexp_match(p_nome,
    '^portal/([0-9a-f-]{36})/([0-9a-f-]{36}|sem-os)/[A-Za-z0-9._-]{1,160}$');
  IF v_partes IS NULL THEN RETURN false; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.portal_cliente_acessos
                  WHERE usuario_id = v_uid AND ativo AND cliente_id::text = v_partes[1]) THEN
    RETURN false;
  END IF;
  IF NOT public.has_permission(v_uid, 'portal.read') THEN RETURN false; END IF;
  IF v_partes[2] = 'sem-os' THEN RETURN p_bucket = 'comprovantes'; END IF;
  RETURN EXISTS (SELECT 1 FROM public.ordens_servico
                  WHERE id::text = v_partes[2] AND cliente_id::text = v_partes[1]
                    AND status::text <> 'cancelado');
END $f$;

REVOKE ALL ON FUNCTION public.portal_meu_painel(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.portal_meu_objeto(text, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.portal_registrar_envio(uuid, uuid, text, text, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.portal_enviar_mensagem(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.portal_decidir_arte(uuid, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.portal_pode_ler_objeto(text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.portal_pode_enviar_objeto(text, text) FROM PUBLIC, anon, authenticated, service_role;

-- ------------------------------------------- 5. as portas do portal por link
-- Só a rota de servidor chama (service_role), sempre com o SHA-256 do token —
-- o token em claro nunca chega ao banco. Respostas:
--   {situacao:'invalido'|'revogado'|'vencido'}  fecha a porta (a rota dá 401)
--   {situacao:'aberto', ok:false, mensagem}       recusa com motivo (422)

CREATE OR REPLACE FUNCTION public.portal_link_abrir(p_token_hash text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $f$
DECLARE v jsonb; v_painel jsonb;
BEGIN
  v := public.portal_situacao_do_link(p_token_hash);
  IF v ->> 'situacao' <> 'aberto' THEN RETURN v; END IF;
  v_painel := public.portal_painel_do_cliente((v ->> 'cliente_id')::uuid);
  IF v_painel IS NULL THEN RETURN jsonb_build_object('situacao', 'invalido'); END IF;
  -- Último acesso no máximo uma vez por minuto: a ficha mostra se o cliente
  -- abriu o link, e regravar a cada recarga só geraria escrita à toa.
  UPDATE public.portal_cliente_links
     SET ultimo_acesso_em = now()
   WHERE id = (v ->> 'link_id')::uuid
     AND (ultimo_acesso_em IS NULL OR ultimo_acesso_em < now() - interval '1 minute');
  RETURN jsonb_build_object('situacao', 'aberto', 'vence_em', v -> 'vence_em') || v_painel;
END $f$;

CREATE OR REPLACE FUNCTION public.portal_link_abrir_envio(p_token_hash text, p_os_id uuid, p_tipo text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $f$
DECLARE v jsonb;
BEGIN
  v := public.portal_situacao_do_link(p_token_hash);
  IF v ->> 'situacao' <> 'aberto' THEN RETURN v; END IF;
  BEGIN
    PERFORM public.portal_validar_envio((v ->> 'cliente_id')::uuid, p_os_id, p_tipo);
  EXCEPTION WHEN raise_exception THEN
    RETURN jsonb_build_object('situacao', 'aberto', 'ok', false, 'mensagem', SQLERRM);
  END;
  RETURN jsonb_build_object('situacao', 'aberto', 'ok', true, 'cliente_id', v -> 'cliente_id');
END $f$;

CREATE OR REPLACE FUNCTION public.portal_link_registrar_envio(
  p_token_hash text, p_os_id uuid, p_tipo text, p_caminho text, p_nome text, p_mensagem text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $f$
DECLARE v jsonb; v_res jsonb;
BEGIN
  v := public.portal_situacao_do_link(p_token_hash);
  IF v ->> 'situacao' <> 'aberto' THEN RETURN v; END IF;
  BEGIN
    v_res := public.portal_gravar_envio((v ->> 'cliente_id')::uuid, p_os_id, p_tipo, p_caminho,
                                        p_nome, p_mensagem, 'link', NULL, (v ->> 'link_id')::uuid);
  EXCEPTION WHEN raise_exception THEN
    RETURN jsonb_build_object('situacao', 'aberto', 'ok', false, 'mensagem', SQLERRM);
  END;
  RETURN jsonb_build_object('situacao', 'aberto') || v_res;
END $f$;

CREATE OR REPLACE FUNCTION public.portal_link_enviar_mensagem(
  p_token_hash text, p_os_id uuid, p_tipo text, p_mensagem text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $f$
DECLARE v jsonb; v_res jsonb;
BEGIN
  v := public.portal_situacao_do_link(p_token_hash);
  IF v ->> 'situacao' <> 'aberto' THEN RETURN v; END IF;
  BEGIN
    v_res := public.portal_gravar_mensagem((v ->> 'cliente_id')::uuid, p_os_id, p_tipo, p_mensagem,
                                           'link', NULL, (v ->> 'link_id')::uuid);
  EXCEPTION WHEN raise_exception THEN
    RETURN jsonb_build_object('situacao', 'aberto', 'ok', false, 'mensagem', SQLERRM);
  END;
  RETURN jsonb_build_object('situacao', 'aberto') || v_res;
END $f$;

CREATE OR REPLACE FUNCTION public.portal_link_decidir_arte(
  p_token_hash text, p_arquivo_id uuid, p_decisao text, p_comentario text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $f$
DECLARE v jsonb; v_res jsonb;
BEGIN
  v := public.portal_situacao_do_link(p_token_hash);
  IF v ->> 'situacao' <> 'aberto' THEN RETURN v; END IF;
  BEGIN
    v_res := public.portal_decidir_arte_do_cliente((v ->> 'cliente_id')::uuid, p_arquivo_id, p_decisao,
                                                   p_comentario, 'portal_link', NULL, (v ->> 'link_id')::uuid);
  EXCEPTION WHEN raise_exception THEN
    RETURN jsonb_build_object('situacao', 'aberto', 'ok', false, 'mensagem', SQLERRM);
  END;
  RETURN jsonb_build_object('situacao', 'aberto') || v_res;
END $f$;

CREATE OR REPLACE FUNCTION public.portal_link_objeto(p_token_hash text, p_tipo text, p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $f$
DECLARE v jsonb;
BEGIN
  v := public.portal_situacao_do_link(p_token_hash);
  IF v ->> 'situacao' <> 'aberto' THEN RETURN v; END IF;
  RETURN jsonb_build_object('situacao', 'aberto')
         || public.portal_objeto_do_cliente((v ->> 'cliente_id')::uuid, p_tipo, p_id);
END $f$;

REVOKE ALL ON FUNCTION public.portal_link_abrir(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.portal_link_abrir_envio(text, uuid, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.portal_link_registrar_envio(text, uuid, text, text, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.portal_link_enviar_mensagem(text, uuid, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.portal_link_decidir_arte(text, uuid, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.portal_link_objeto(text, text, uuid) FROM PUBLIC, anon, authenticated, service_role;

-- --------------------------------------------------- 6. as portas da equipe
CREATE OR REPLACE FUNCTION public.portal_gerar_link(p_cliente_id uuid, p_dias integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $f$
DECLARE
  v_uid uuid;
  v_dias integer := greatest(1, least(coalesce(p_dias, 30), 90));
  v_token text; v_id uuid; v_expira timestamptz; v_cancelados integer;
BEGIN
  v_uid := public.require_permission('clientes.update');
  IF NOT EXISTS (SELECT 1 FROM public.clientes WHERE id = p_cliente_id) THEN
    RAISE EXCEPTION 'Cliente não encontrado.';
  END IF;

  -- Um link vivo por cliente: gerar outro cancela o anterior. O banco só guarda
  -- o hash, então um link perdido não se recupera — gera-se outro, e o perdido
  -- deixa de abrir.
  UPDATE public.portal_cliente_links
     SET revogado_em = now(), revogado_por = v_uid
   WHERE cliente_id = p_cliente_id AND revogado_em IS NULL AND expira_em > now();
  GET DIAGNOSTICS v_cancelados = ROW_COUNT;

  -- 32 bytes aleatórios em base64url (43 caracteres), o mesmo formato do
  -- crachá da TV. Em claro só nesta resposta.
  v_token := translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/=', '-_');
  v_expira := now() + make_interval(days => v_dias);

  INSERT INTO public.portal_cliente_links (cliente_id, token_hash, expira_em, criado_por)
  VALUES (p_cliente_id, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), v_expira, v_uid)
  RETURNING id INTO v_id;

  INSERT INTO public.logs_auditoria (usuario_id, entidade, entidade_id, acao, detalhes)
  VALUES (v_uid, 'portal_cliente_links', v_id, 'gerar_link',
          jsonb_build_object('cliente_id', p_cliente_id, 'dias', v_dias, 'cancelados', v_cancelados));

  RETURN jsonb_build_object('link_id', v_id, 'token', v_token, 'expira_em', v_expira,
                            'cancelados', v_cancelados);
END $f$;

CREATE OR REPLACE FUNCTION public.portal_revogar_link(p_link_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $f$
DECLARE v_uid uuid; v_cliente uuid; v_quando timestamptz;
BEGIN
  v_uid := public.require_permission('clientes.update');
  UPDATE public.portal_cliente_links
     SET revogado_em = now(), revogado_por = v_uid
   WHERE id = p_link_id AND revogado_em IS NULL
  RETURNING cliente_id, revogado_em INTO v_cliente, v_quando;
  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM public.portal_cliente_links WHERE id = p_link_id) THEN
      RAISE EXCEPTION 'Este link já estava cancelado.';
    END IF;
    RAISE EXCEPTION 'Link não encontrado.';
  END IF;

  INSERT INTO public.logs_auditoria (usuario_id, entidade, entidade_id, acao, detalhes)
  VALUES (v_uid, 'portal_cliente_links', p_link_id, 'revogar_link',
          jsonb_build_object('cliente_id', v_cliente));

  RETURN jsonb_build_object('ok', true, 'revogado_em', v_quando);
END $f$;

CREATE OR REPLACE FUNCTION public.portal_links_do_cliente(p_cliente_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $f$
DECLARE v_links jsonb;
BEGIN
  PERFORM public.require_permission('clientes.read');
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', l.id, 'criado_em', l.criado_em, 'criado_por', u.nome, 'expira_em', l.expira_em,
           'revogado_em', l.revogado_em, 'ultimo_acesso_em', l.ultimo_acesso_em)
           ORDER BY l.criado_em DESC), '[]'::jsonb)
    INTO v_links
    FROM (SELECT id, criado_em, criado_por, expira_em, revogado_em, ultimo_acesso_em
            FROM public.portal_cliente_links
           WHERE cliente_id = p_cliente_id
           ORDER BY criado_em DESC LIMIT 10) l
    LEFT JOIN public.usuarios u ON u.id = l.criado_por;
  RETURN jsonb_build_object('agora', now(), 'links', v_links);
END $f$;

CREATE OR REPLACE FUNCTION public.portal_conferir_comprovante(p_id uuid, p_situacao text, p_nota text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $f$
DECLARE v_uid uuid; v_solicitacao uuid; v_nota text := nullif(btrim(coalesce(p_nota, '')), '');
BEGIN
  v_uid := public.require_permission('pagamentos.confirm');
  IF p_situacao IS NULL OR p_situacao NOT IN ('conferido', 'recusado') THEN
    RAISE EXCEPTION 'Situação inválida: use conferido ou recusado.';
  END IF;
  IF p_situacao = 'recusado' AND coalesce(length(v_nota), 0) < 3 THEN
    RAISE EXCEPTION 'Diga ao cliente por que o comprovante foi recusado.';
  END IF;
  IF v_nota IS NOT NULL AND length(v_nota) > 500 THEN
    RAISE EXCEPTION 'Nota longa demais: o limite é 500 caracteres.';
  END IF;

  UPDATE public.portal_comprovantes
     SET situacao = p_situacao, conferido_por = v_uid, conferido_em = now(), nota_da_conferencia = v_nota
   WHERE id = p_id AND situacao = 'a_conferir'
  RETURNING solicitacao_id INTO v_solicitacao;
  IF NOT FOUND THEN RAISE EXCEPTION 'Comprovante não encontrado ou já conferido.'; END IF;

  UPDATE public.portal_cliente_solicitacoes SET status = 'resolvida'
   WHERE id = v_solicitacao AND status <> 'resolvida';

  INSERT INTO public.logs_auditoria (usuario_id, entidade, entidade_id, acao, detalhes)
  VALUES (v_uid, 'portal_comprovantes', p_id, 'conferir_comprovante',
          jsonb_build_object('situacao', p_situacao));

  RETURN jsonb_build_object('ok', true, 'situacao', p_situacao);
END $f$;

REVOKE ALL ON FUNCTION public.portal_gerar_link(uuid, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.portal_revogar_link(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.portal_links_do_cliente(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.portal_conferir_comprovante(uuid, text, text) FROM PUBLIC, anon, authenticated, service_role;

-- ------------------------------------------------------------------ 7. GRANTs
GRANT EXECUTE ON FUNCTION public.portal_gerar_link(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.portal_revogar_link(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.portal_links_do_cliente(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.portal_conferir_comprovante(uuid, text, text) TO authenticated;

GRANT EXECUTE ON FUNCTION public.portal_meu_painel(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.portal_meu_objeto(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.portal_registrar_envio(uuid, uuid, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.portal_enviar_mensagem(uuid, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.portal_decidir_arte(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.portal_pode_ler_objeto(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.portal_pode_enviar_objeto(text, text) TO authenticated;

GRANT EXECUTE ON FUNCTION public.portal_link_abrir(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.portal_link_abrir_envio(text, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.portal_link_registrar_envio(text, uuid, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.portal_link_enviar_mensagem(text, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.portal_link_decidir_arte(text, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.portal_link_objeto(text, text, uuid) TO service_role;

-- ------------------------------------------- 8. Storage: a pasta do cliente
-- Só ACRESCENTAM acesso (policies permissivas somam): a equipe continua lendo
-- e gravando pelas policies de antes. Para quem não é cliente de portal, a
-- função sai na primeira pergunta (vínculo ativo), numa leitura de índice.
DO $p$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
                  AND policyname = 'portal cliente le o que e dele') THEN
    CREATE POLICY "portal cliente le o que e dele" ON storage.objects
      FOR SELECT TO authenticated
      USING (bucket_id IN ('arquivos-clientes', 'comprovantes', 'documentos-pdf')
             AND public.portal_pode_ler_objeto(bucket_id, name));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
                  AND policyname = 'portal cliente envia para a propria pasta') THEN
    CREATE POLICY "portal cliente envia para a propria pasta" ON storage.objects
      FOR INSERT TO authenticated
      WITH CHECK (bucket_id IN ('arquivos-clientes', 'comprovantes')
                  AND public.portal_pode_enviar_objeto(bucket_id, name));
  END IF;
END $p$;

-- ------------------------------------- 9. o aviso para a equipe: pendências
-- Duas linhas novas em pendencias_do_sistema(), acrescentadas na função VIVA
-- (lida antes, md5 8ba25c7c97747ba7201c90a5c62b43a1) pela mesma técnica de
-- 20260924190000: substitui o fecho `RETURN; END;` pelo bloco novo + o fecho.
-- Não reescreve o resto — outra sessão que mexa na função não é desfeita.
--   portal_cliente_aguardando        atendimento: mensagem ou arquivo do
--                                    cliente sem resposta (comprovante fora)
--   comprovante_do_portal_a_conferir financeiro (só para quem vê dinheiro)
-- O link leva direto à ficha quando é um cliente só; com vários, a Clientes.
DO $patch$
DECLARE
  src text; novo text; anchor text := E'\n  RETURN;\nEND;\n$function$'; bloco text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO src FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'pendencias_do_sistema';
  IF position('portal_cliente_aguardando' in src) > 0 THEN RETURN; END IF;
  IF (length(src) - length(replace(src, anchor, ''))) / length(anchor) <> 1 THEN
    RAISE EXCEPTION 'fecho de pendencias_do_sistema nao encontrado (ou repetido)';
  END IF;
  bloco := $bloco$

  -- Portal do cliente: o que o cliente mandou (mensagem ou arquivo) e ninguém
  -- respondeu. O arquivo enviado já está na OS, aba Arquivos; a solicitação é o
  -- aviso de que ele chegou. Comprovante fica de fora: é do financeiro, logo abaixo.
  RETURN QUERY SELECT 'portal_cliente_aguardando', 'Mensagens e arquivos do cliente pelo portal esperando resposta', count(*)::int,
    NULL::int, 'atencao', 'atendimento',
    'Chegou pelo portal de: ' || string_agg(DISTINCT c.nome, ', ') || '. Abra Clientes › nome do cliente › aba Portal, responda e marque como resolvida. Arquivo enviado já está na OS, aba Arquivos.',
    CASE WHEN count(DISTINCT s.cliente_id) = 1 THEN '/clientes/' || min(s.cliente_id::text) ELSE '/clientes' END
  FROM public.portal_cliente_solicitacoes s JOIN public.clientes c ON c.id = s.cliente_id
  WHERE s.status NOT IN ('resolvida', 'cancelada') AND s.tipo <> 'pagamento'
  HAVING count(*) > 0;

  IF v_ve_dinheiro THEN
    RETURN QUERY SELECT 'comprovante_do_portal_a_conferir', 'Comprovantes de pagamento enviados pelo cliente a conferir', count(*)::int,
      NULL::int, 'atencao', 'financeiro',
      'O cliente mandou comprovante pelo portal: ' || string_agg(DISTINCT c.nome, ', ') || '. Abra Clientes › nome do cliente › aba Portal, confira o pagamento, dê a baixa onde for o caso e marque como conferido.',
      CASE WHEN count(DISTINCT pc.cliente_id) = 1 THEN '/clientes/' || min(pc.cliente_id::text) ELSE '/clientes' END
    FROM public.portal_comprovantes pc JOIN public.clientes c ON c.id = pc.cliente_id
    WHERE pc.situacao = 'a_conferir'
    HAVING count(*) > 0;
  END IF;
$bloco$;
  novo := replace(src, anchor, bloco || anchor);
  EXECUTE novo;
END $patch$;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- ENSAIADO (todos com RAISE EXCEPTION no fim; clientes, OS 9901/9902/9903,
-- usuário-cliente e objetos de Storage de teste criados e desfeitos no ensaio)
--
--   tabelas      anon e authenticated sem acesso a portal_cliente_links (nem
--                admin lê direto); portal_comprovantes: financeiro lê,
--                operador lê 0
--   link         admin e vendedor geram (43 caracteres base64url); o 2º
--                cancela o 1º; validade com teto de 90 dias; operador recusado
--                ("Permissão necessária: clientes.update"); anon negado
--                (42501); financeiro lista sem hash; logado não abre por link
--   abrir        service_role: aberto, Guilherme Menezes, 1 OS (#44, valor
--                121.15), chaves fechadas, nenhuma com custo/margem/lucro/
--                receita/resultado; link cancelado → revogado; vencido →
--                vencido; lixo e desconhecido → invalido; último acesso gravado
--   logado       cliente vê só o próprio cliente (outro: recusado), a arte da
--                OS e NÃO o arquivo de produção (imposição); objeto alheio
--                recusado; Storage: lê a arte, sobe na própria pasta (com
--                RETURNING), recusado na pasta de outro cliente, na OS de outro
--                cliente, na OS cancelada e em "sem-os" fora de comprovantes;
--                registra o envio (protocolo de 8), recusa duplicado e arquivo
--                que não subiu; comprovante e mensagem gravam; mensagem para
--                cliente alheio recusada; INSERT direto em arquivos negado
--   equipe       operador vê o arquivo do cliente na OS (aba Arquivos), 0
--                comprovantes e 0 no bucket comprovantes; painel do operador
--                = sem_acesso; financeiro recusa o comprovante com motivo →
--                solicitação resolvida e o cliente vê o motivo; anon negado
--   link grava   pedido de outro cliente, sem OS e tipo inválido recusados com
--                motivo; caminho de outro cliente recusado; envio, mensagem e
--                objeto gravam/abrem; documento de outro link recusado; o
--                objeto recusado não devolve caminho; auditoria com o link_id;
--                link cancelado → revogado em todas as portas
--   arte         pedido de aprovação aberto aparece no portal (inclusive
--                arquivo de tipo 'outro'); ajuste curto recusado com a mensagem
--                da regra; link de outro cliente recusado; ajuste grava
--                (canal portal_link), OS → arte_rejeitada, e o link do WhatsApp
--                passa a dizer "respondido: ajuste"; 2ª decisão recusada
--   porta antiga registrar_decisao_aprovacao com o miolo: 'Decisão inválida',
--                'Link inválido', aprova (OS → arte_aprovada, canal link,
--                arte_aprovada_da_os = true) e 'Este link já foi respondido.'
--   logado arte  vê 1 para aprovar; arte de outro cliente recusada; aprova
--                (canal portal, usuario_id = o cliente)
--   pendências   vendedor: 1 (dúvida aberta; pagamento e resolvida fora), link
--                para a ficha; financeiro vê também a do comprovante; operador
--                não vê a do comprovante; admin com os dados reais: sem erro
--   storage      equipe: admin 7/14, operador 7/0, financeiro 0/0, vendedor
--                7/14 (arquivos-clientes/documentos-pdf) — igual a antes
-- ============================================================================
