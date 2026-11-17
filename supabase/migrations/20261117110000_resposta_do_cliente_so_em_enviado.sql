-- =====================================================================================================
-- RESPOSTA DO CLIENTE PELO LINK SÓ EM ORÇAMENTO ENVIADO E DENTRO DA VALIDADE (17/11/2026)
--
-- ENSAIADA no banco vivo em 17/11/2026, desfeita por RAISE EXCEPTION final (ver docs/ensaio-resposta-do-cliente-so-em-enviado.md).
-- APLICADA no banco vivo em 17/11/2026 (a 100000, da área cobrada, ficou de fora até o dono dar o OK).
-- O QUE ESTAVA ERRADO (lido no banco e no código em 17/11/2026)
--   O cliente responde por uma server function (responderOrcamentoPublico) que usa a chave de serviço e
--   gravava o status direto: a única trava era "não é convertido e não tem OS". Quem tinha o link de um
--   orçamento APROVADO sem OS podia mandar "ajuste" e derrubá-lo para recusado; um rascunho com link podia
--   ser aprovado; a validade só era mostrada, nunca barrava; e duas respostas ao mesmo tempo passavam as duas.
--
-- O QUE ESTA MIGRAÇÃO FAZ
--   Cria a função NOVA responder_orcamento_publico, a única porta de escrita da resposta do cliente.
--   Decide tudo dentro de uma transação, com a linha travada (FOR UPDATE):
--     - só responde quem está em enviado, sem OS e dentro da validade;
--     - validade conta do envio (enviado_em, e na falta dele a criação) mais validade_dias, e o último dia
--       vale inteiro, no horário de Brasília (o mesmo "Válido até" que o cliente lê);
--     - aprovar grava aprovado_em, nome e IP; ajuste grava recusado; a observação do cliente é anotada.
--   Devolve sempre um jsonb com ok e codigo; nunca lança erro por causa do estado do orçamento.
--   Executável SÓ por service_role: o navegador nunca chama. Nenhuma função viva é trocada, nenhuma tabela,
--   view, policy ou GRANT por coluna é tocado. A conversão automática (converter_aprovado_pelo_cliente)
--   continua sendo chamada pelo servidor DEPOIS da aprovação, como hoje.
--
-- ORDEM OBRIGATÓRIA: aplicar esta migração ANTES do Publish do front. O front novo (responderOrcamentoPublico em
--   src/lib/api/orcamento-publico.functions.ts) NÃO tem plano B: se a função não existir, ele falha fechado, não grava
--   nada e o cliente que clica Aprovar ou Pedir ajuste no link lê "indisponível". Em 17/11/2026 há 9 orçamentos
--   enviados e dentro da validade com o link aberto para resposta.
--
-- COMO DESFAZER (comentado): NÃO basta o DROP. Primeiro volte o front (Publish da versão anterior, que grava a resposta
--   por conta própria); só depois DROP FUNCTION public.responder_orcamento_publico(text, text, text, text, text);
--   Dar o DROP com o front novo no ar deixa todo link de cliente sem como responder.
-- =====================================================================================================
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.responder_orcamento_publico(
  p_token text, p_decisao text, p_nome text, p_observacao text, p_ip text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_orc public.orcamentos%ROWTYPE;
  v_ate date;
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_obs text;
  v_novo text;
BEGIN
  IF p_decisao IS NULL OR p_decisao NOT IN ('aprovado', 'ajuste') THEN
    RETURN jsonb_build_object('ok', false, 'codigo', 'decisao_invalida');
  END IF;
  IF p_token IS NULL OR length(p_token) < 10 OR length(btrim(coalesce(p_nome, ''))) < 3 THEN
    RETURN jsonb_build_object('ok', false, 'codigo', 'dados_invalidos');
  END IF;

  SELECT * INTO v_orc FROM public.orcamentos WHERE token_publico = p_token FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'codigo', 'nao_encontrado');
  END IF;

  IF v_orc.os_id IS NOT NULL OR v_orc.status::text = 'convertido' THEN
    RETURN jsonb_build_object('ok', false, 'codigo', 'ja_virou_pedido', 'status', v_orc.status::text);
  END IF;
  IF v_orc.status::text = 'aprovado' THEN
    RETURN jsonb_build_object('ok', false, 'codigo', 'ja_aprovado', 'status', v_orc.status::text);
  END IF;
  IF v_orc.status::text = 'rascunho' THEN
    RETURN jsonb_build_object('ok', false, 'codigo', 'nao_liberado', 'status', v_orc.status::text);
  END IF;

  v_ate := (coalesce(v_orc.enviado_em, v_orc.created_at) AT TIME ZONE 'America/Sao_Paulo')::date + coalesce(v_orc.validade_dias, 7);

  IF v_orc.status::text = 'expirado' OR (v_orc.status::text = 'enviado' AND v_hoje > v_ate) THEN
    RETURN jsonb_build_object('ok', false, 'codigo', 'vencido', 'status', v_orc.status::text, 'valido_ate', v_ate);
  END IF;
  IF v_orc.status::text <> 'enviado' THEN
    RETURN jsonb_build_object('ok', false, 'codigo', 'encerrado', 'status', v_orc.status::text);
  END IF;

  v_obs := v_orc.observacoes;
  IF btrim(coalesce(p_observacao, '')) <> '' THEN
    v_obs := coalesce(v_orc.observacoes || E'\n', '')
          || '[' || to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI:SS') || '] '
          || btrim(p_nome) || ': ' || btrim(p_observacao);
  END IF;

  v_novo := CASE p_decisao WHEN 'aprovado' THEN 'aprovado' ELSE 'rejeitado' END;
  IF v_novo = 'aprovado' THEN
    UPDATE public.orcamentos
       SET status = 'aprovado', aprovado_em = now(), aprovado_por_nome = btrim(p_nome),
           aprovado_ip = p_ip, observacoes = v_obs
     WHERE id = v_orc.id AND status::text = 'enviado';
  ELSE
    UPDATE public.orcamentos SET status = 'rejeitado', observacoes = v_obs
     WHERE id = v_orc.id AND status::text = 'enviado';
  END IF;

  RETURN jsonb_build_object('ok', true, 'codigo', 'ok', 'status', v_novo, 'orcamento_id', v_orc.id);
END
$fn$;

REVOKE ALL ON FUNCTION public.responder_orcamento_publico(text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.responder_orcamento_publico(text, text, text, text, text) TO service_role;
COMMENT ON FUNCTION public.responder_orcamento_publico(text, text, text, text, text) IS
  'Única porta de escrita da resposta do cliente pelo link: só em enviado, sem OS e dentro da validade (conta do envio, último dia inteiro). Só service_role.';

DO $v$
BEGIN
  IF has_function_privilege('anon', 'public.responder_orcamento_publico(text, text, text, text, text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.responder_orcamento_publico(text, text, text, text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'responder_orcamento_publico ficou executável por anon ou authenticated';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.responder_orcamento_publico(text, text, text, text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role perdeu o EXECUTE de responder_orcamento_publico';
  END IF;
END $v$;

COMMIT;
