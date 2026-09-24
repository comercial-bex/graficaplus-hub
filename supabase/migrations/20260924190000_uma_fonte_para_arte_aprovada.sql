-- ============================================================================
-- Onda 4 — uma fonte só para "a arte foi aprovada"
-- ============================================================================
--
-- Havia DOIS caminhos legítimos para aprovar uma arte, cada um escrevendo numa
-- tabela que o outro não lia:
--
--   o cliente clica no link       -> registrar_decisao_aprovacao
--                                 -> arquivo_aprovacoes
--                                 -> arquivos.status, e AVANÇA a OS
--
--   o cliente aceita por telefone -> a tela gravava direto em `aprovacoes`
--   / WhatsApp / balcão,             com `aprovado: true` fixo
--   e a equipe registra           -> e mais nada
--
-- E `os_bloqueios_para`, que é quem barra a entrada em produção, perguntava
-- só pela segunda:
--
--   IF NOT EXISTS (SELECT 1 FROM aprovacoes WHERE ... AND aprovado = true)
--   THEN bloqueio 'arte_nao_aprovada'
--
-- O resultado é um impasse: o cliente aprovava pelo link, a OS ia para
-- `arte_aprovada`, e a produção continuava barrada com "Arte ainda não
-- aprovada" — até alguém registrar a MESMA aprovação de novo, na mão. E o
-- caminho manual, por sua vez, não movia o status: registrar a aprovação
-- deixava a OS parada em `aguardando_aprovacao_arte`.
--
-- Cada metade fazia metade do trabalho, e nenhuma das duas sabia da outra.
--
-- Um terceiro detalhe, do mesmo tamanho: o diálogo "registrar aprovação"
-- existia inteiro na tela da OS, com canal, contato e observação — e NENHUMA
-- linha do código chamava `setAprovar` com um arquivo. A porta nunca existiu.
--
-- Retrato do banco vivo: aplicado e ensaiado com reversão.

-- -------------------------------------------------------- 1. uma pergunta só
CREATE OR REPLACE FUNCTION public.arte_aprovada_da_os(p_os_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $f$
  SELECT EXISTS (
    SELECT 1 FROM public.aprovacoes a
     WHERE a.os_id = p_os_id AND a.tipo::text = 'arte' AND a.aprovado = true
  ) OR EXISTS (
    SELECT 1 FROM public.arquivo_aprovacoes aa
      JOIN public.arquivos ar ON ar.id = aa.arquivo_id
     WHERE ar.os_id = p_os_id AND aa.decisao = 'aprovado'
  );
$f$;

REVOKE ALL ON FUNCTION public.arte_aprovada_da_os(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.arte_aprovada_da_os(uuid) TO authenticated;

-- `os_bloqueios_para` passa a fazer essa pergunta, em vez de olhar uma tabela.
DO $patch$
DECLARE src text; novo text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public' AND p.proname='os_bloqueios_para';

  IF position('arte_aprovada_da_os' in src) > 0 THEN RETURN; END IF;

  novo := replace(src,
    $old$    IF NOT EXISTS (
      SELECT 1 FROM public.aprovacoes
      WHERE aprovacoes.os_id = os_bloqueios_para.os_id AND tipo = 'arte' AND aprovado = true
    ) THEN$old$,
    $new$    -- Uma pergunta so, para os dois caminhos de aprovacao. Ver
    -- `arte_aprovada_da_os`: lendo so `aprovacoes`, a aprovacao que o cliente
    -- dava pelo link nao contava aqui e a producao ficava barrada.
    IF NOT public.arte_aprovada_da_os(os_bloqueios_para.os_id) THEN$new$);

  IF novo = src THEN RAISE EXCEPTION 'bloco arte_nao_aprovada nao encontrado'; END IF;
  EXECUTE novo;
END $patch$;


-- ------------------------- 2. registrar na mão faz o mesmo que clicar no link
-- Antes era um INSERT solto em `aprovacoes` com `aprovado: true` fixo. Não
-- havia como dizer "o cliente pediu ajuste": só existia o sim. E o status não
-- se mexia.
CREATE OR REPLACE FUNCTION public.registrar_aprovacao_interna(
  p_os_id uuid, p_arquivo_id uuid, p_decisao text,
  p_canal text DEFAULT 'sistema', p_cliente_contato_id uuid DEFAULT NULL,
  p_observacao text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $f$
DECLARE v_uid uuid; v_os_do_arquivo uuid;
BEGIN
  v_uid := public.require_permission('os.update');

  IF p_decisao NOT IN ('aprovado','ajuste') THEN
    RAISE EXCEPTION 'Decisao invalida: use aprovado ou ajuste.' USING ERRCODE='22023';
  END IF;
  IF p_canal NOT IN ('sistema','whatsapp','email','presencial','telefone') THEN
    RAISE EXCEPTION 'Canal invalido: use sistema, whatsapp, email, presencial ou telefone.' USING ERRCODE='22023';
  END IF;

  -- Pedir ajuste sem dizer o ajuste devolve a arte para o designer sem a
  -- informacao de que ele precisa. O link ja exige; registrar na mao nao podia
  -- ser a porta dos fundos dessa regra.
  IF p_decisao = 'ajuste' AND COALESCE(length(btrim(p_observacao)),0) < 3 THEN
    RAISE EXCEPTION 'Descreva o ajuste pedido para a equipe saber o que corrigir.' USING ERRCODE='22023';
  END IF;

  SELECT os_id INTO v_os_do_arquivo FROM public.arquivos WHERE id = p_arquivo_id;
  IF v_os_do_arquivo IS NULL THEN RAISE EXCEPTION 'Arquivo nao encontrado.' USING ERRCODE='P0002'; END IF;
  IF v_os_do_arquivo <> p_os_id THEN
    RAISE EXCEPTION 'Este arquivo e de outra OS.' USING ERRCODE='22023';
  END IF;

  -- As duas tabelas, porque as duas sao lidas: `aprovacoes` guarda o canal e o
  -- contato do cliente que aceitou; `arquivo_aprovacoes` e o historico da peca.
  -- Escrever so numa deixaria meia tela cega, e foi esse o defeito.
  INSERT INTO public.aprovacoes (tipo, os_id, arquivo_id, aprovado, canal, usuario_id,
                                 cliente_contato_id, observacao)
  VALUES ('arte'::tipo_aprovacao, p_os_id, p_arquivo_id, p_decisao = 'aprovado',
          p_canal::canal_aprovacao, v_uid, p_cliente_contato_id, NULLIF(btrim(p_observacao),''));

  INSERT INTO public.arquivo_aprovacoes (arquivo_id, decisao, usuario_id, comentario, canal)
  VALUES (p_arquivo_id, p_decisao, v_uid, NULLIF(btrim(p_observacao),''), p_canal);

  UPDATE public.arquivos
     SET status = (CASE WHEN p_decisao='aprovado' THEN 'aprovado' ELSE 'rejeitado' END)::status_arquivo,
         data_aprovacao = CASE WHEN p_decisao='aprovado' THEN now() END,
         observacao = COALESCE(NULLIF(btrim(p_observacao),''), observacao)
   WHERE id = p_arquivo_id;

  -- O mesmo avanco que o link faz. Sem isto a OS ficava em
  -- aguardando_aprovacao_arte mesmo com a aprovacao registrada.
  PERFORM set_config('app.avancar_os_status', 'on', true);
  UPDATE public.ordens_servico
     SET status = (CASE WHEN p_decisao='aprovado' THEN 'arte_aprovada' ELSE 'arte_rejeitada' END)::status_os
   WHERE id = p_os_id AND status NOT IN ('concluido','faturado','cancelado');
  PERFORM set_config('app.avancar_os_status', 'off', true);

  RETURN jsonb_build_object('ok', true, 'decisao', p_decisao, 'os_id', p_os_id);
END $f$;

REVOKE ALL ON FUNCTION public.registrar_aprovacao_interna(uuid,uuid,text,text,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_aprovacao_interna(uuid,uuid,text,text,uuid,text) TO authenticated;

-- ENSAIADO, tudo com reversão:
--   registro manual  -> some `arte_nao_aprovada`, OS vai a `arte_aprovada`,
--                       arquivo vira `aprovado`
--   só o link        -> some `arte_nao_aprovada` (era o impasse)
--   trocado p/ ajuste-> `arte_nao_aprovada` volta
--   avancar_os_status com a arte não aprovada -> recusa, com o motivo escrito
--   ajuste sem texto -> "Descreva o ajuste pedido..."
--   arquivo de outra OS -> "Este arquivo e de outra OS."
--   sem os.update    -> "Permissão necessária: os.update"
