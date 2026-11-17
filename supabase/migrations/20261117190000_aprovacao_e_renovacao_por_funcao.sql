-- =====================================================================================================
-- APROVAR SÓ DE ENVIADO E RENOVAR POR FUNÇÃO (17/11/2026)
--
-- ENSAIADA no banco vivo em 17/11/2026, desfeita por RAISE EXCEPTION final (ver docs/ensaio-aprovacao-e-renovacao-por-funcao.md).
-- APLICADA no banco vivo em 17/11/2026 (a 100000, da área cobrada, ficou de fora até o dono dar o OK).
--
-- O QUE ESTAVA ERRADO (lido no banco vivo em 17/11/2026)
--   1. aprovar_orcamento não conferia o status de origem: aprovava rascunho, recusado, expirado e até
--      orçamento que já tinha OS. A tela só a usa no botão "Cliente aprovou: converter em OS", que só
--      aparece com o orçamento ENVIADO; por isso a regra certa é só de enviado.
--   2. Renovar um orçamento vencido era um UPDATE direto do navegador (status enviado e enviado_em agora):
--      qualquer um com orcamentos.create escrevia enviado_em, não havia conferência de origem nem de OS, e
--      a versão congelada não nascia (a faixa "mudou depois de enviado" ficava acesa).
--
-- O QUE ESTA MIGRAÇÃO FAZ (aditiva: o front antigo continua funcionando)
--   A. aprovar_orcamento (troca guardada, md5 do corpo conferido antes, c0d686195881973ba42b2e93708ee71a):
--      mesma assinatura, mesmo GRANT, mesmo corpo, mais a guarda de origem:
--        - já aprovado: devolve o que existe, com ja_aprovado = true, sem repetir evento nem versão;
--        - com OS ou convertido: erro tem_os;  - qualquer outro status que não seja enviado: erro origem_invalida.
--      DECISÃO DE ORIGEM: SÓ de enviado. Conferido na tela: o único chamador é o botão "Cliente aprovou:
--      converter em OS" (CabecalhoIdentificacao.tsx, status enviado) e a função que ele chama (converterEmOS com
--      aprovarAntes); rascunho nunca chega lá.
--   B. renovar_orcamento_vencido(uuid), função NOVA: exige orcamentos.create e orcamentos.send; só de expirado
--      ou de enviado que já passou da validade, sem OS e com valor; volta a enviado, grava enviado_em agora,
--      congela a versão (orcamento_congelar_versao, da 180000) e registra o evento orcamento_renovado.
--      "Vencido" usa a régua do link do cliente (dia de Brasília, último dia inteiro), não o instante. Expirado que
--      nunca foi enviado (sem enviado_em e sem documento enviado) é recusado com o código nunca_enviado: em 17/11/2026
--      9 dos 10 expirados são assim e não podem virar "enviado" sem que o cliente tenha recebido nada.
--      Não manda mensagem nenhuma ao cliente: reenviar continua sendo o botão da tela.
--   Não troca tg_orcamento_notificar_cliente, não cria o gatilho de transição de status, não toca api_executar.
--
-- COMO DESFAZER (comentado): DROP FUNCTION public.renovar_orcamento_vencido(uuid); recriar aprovar_orcamento com o
--   corpo de md5 c0d686195881973ba42b2e93708ee71a (retirar o bloco "Guarda de origem").
-- =====================================================================================================
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $g$
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.aprovar_orcamento(uuid, uuid, text)'::regprocedure)
       IS DISTINCT FROM 'c0d686195881973ba42b2e93708ee71a' THEN
    RAISE EXCEPTION 'aprovar_orcamento mudou desde a revisão: refazer o ensaio';
  END IF;
  IF to_regprocedure('public.orcamento_congelar_versao(public.orcamentos, boolean, uuid)') IS NULL THEN
    RAISE EXCEPTION 'orcamento_congelar_versao não existe: aplicar antes a 20261117180000_congelar_versao_no_reenvio';
  END IF;
END $g$;

-- A. aprovar_orcamento: igual ao vivo, com a guarda de origem logo depois de achar o orçamento.
CREATE OR REPLACE FUNCTION public.aprovar_orcamento(p_orcamento_id uuid, p_versao_id uuid DEFAULT NULL::uuid, p_observacao text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid UUID; v_versao UUID; v_orc public.orcamentos%ROWTYPE;
BEGIN
  v_uid := public.require_permission('orcamentos.approve');
  SELECT * INTO v_orc FROM public.orcamentos WHERE id = p_orcamento_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Orçamento não encontrado'; END IF;
  -- Guarda de origem: aprovar só vale para orçamento enviado ao cliente.
  IF v_orc.status::text = 'aprovado' THEN
    RETURN jsonb_build_object('orcamento_id', p_orcamento_id, 'versao_id', v_orc.versao_aprovada_id, 'ja_aprovado', true);
  END IF;
  IF v_orc.os_id IS NOT NULL OR v_orc.status::text = 'convertido' THEN
    RAISE EXCEPTION 'Este orçamento já virou ordem de serviço e não pode ser aprovado de novo.' USING DETAIL = 'tem_os';
  END IF;
  IF v_orc.status::text <> 'enviado' THEN
    RAISE EXCEPTION 'Só um orçamento enviado ao cliente pode ser aprovado. Este está como %.',
      CASE v_orc.status::text WHEN 'rejeitado' THEN 'recusado' ELSE v_orc.status::text END USING DETAIL = 'origem_invalida';
  END IF;
  v_versao := p_versao_id;
  IF v_versao IS NULL THEN SELECT id INTO v_versao FROM public.orcamento_versoes WHERE orcamento_id=p_orcamento_id ORDER BY numero_versao DESC LIMIT 1; END IF;
  IF v_versao IS NULL THEN
    INSERT INTO public.orcamento_versoes(orcamento_id, numero_versao, status, snapshot, valor_total, aprovada_em, aprovado_por, created_by)
    VALUES (p_orcamento_id, 1, 'aprovada', public.jsonb_sem_custo(to_jsonb(v_orc) - 'token_publico' - 'aprovado_ip'), v_orc.valor_total, now(), v_uid, v_uid) RETURNING id INTO v_versao;
  ELSE UPDATE public.orcamento_versoes SET status='aprovada', aprovada_em=COALESCE(aprovada_em, now()), aprovado_por=COALESCE(aprovado_por, v_uid) WHERE id=v_versao; END IF;
  UPDATE public.orcamentos SET status='aprovado', aprovado_em=COALESCE(aprovado_em, now()), versao_aprovada_id=v_versao WHERE id=p_orcamento_id;
  INSERT INTO public.eventos_negocio(entidade, entidade_id, cliente_id, tipo, titulo, descricao, usuario_id) VALUES ('orcamento', p_orcamento_id, v_orc.cliente_id, 'orcamento_aprovado', 'Orçamento aprovado', p_observacao, v_uid);
  RETURN jsonb_build_object('orcamento_id', p_orcamento_id, 'versao_id', v_versao);
END; $function$;

REVOKE ALL ON FUNCTION public.aprovar_orcamento(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.aprovar_orcamento(uuid, uuid, text) TO authenticated, service_role;

-- B. renovar_orcamento_vencido: a única porta de renovação.
CREATE OR REPLACE FUNCTION public.renovar_orcamento_vencido(p_orcamento_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $f$
DECLARE
  v_uid uuid;
  v_orc public.orcamentos%ROWTYPE;
  v_anterior text;
  v_versao uuid;
  v_vencido boolean;
BEGIN
  PERFORM public.require_permission('orcamentos.create');
  v_uid := public.require_permission('orcamentos.send');
  SELECT * INTO v_orc FROM public.orcamentos WHERE id = p_orcamento_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orçamento não encontrado.' USING DETAIL = 'nao_encontrado';
  END IF;
  v_anterior := v_orc.status::text;
  IF v_orc.os_id IS NOT NULL OR v_anterior = 'convertido' THEN
    RAISE EXCEPTION 'Este orçamento já virou ordem de serviço e não pode ser renovado.' USING DETAIL = 'tem_os';
  END IF;
  IF v_anterior NOT IN ('expirado', 'enviado') THEN
    RAISE EXCEPTION 'Só um orçamento expirado ou enviado e vencido pode ser renovado. Este está como %.',
      CASE v_anterior WHEN 'rejeitado' THEN 'recusado' ELSE v_anterior END USING DETAIL = 'origem_invalida';
  END IF;
  -- Vencido é a régua do link do cliente (responder_orcamento_publico): dia de Brasília, último dia inteiro.
  v_vencido := coalesce(v_orc.validade_dias, 0) > 0
           AND (now() AT TIME ZONE 'America/Sao_Paulo')::date
               > (coalesce(v_orc.enviado_em, v_orc.created_at) AT TIME ZONE 'America/Sao_Paulo')::date + v_orc.validade_dias;
  IF v_anterior = 'enviado' AND NOT v_vencido THEN
    RAISE EXCEPTION 'Este orçamento ainda está dentro da validade, não precisa renovar.' USING DETAIL = 'ainda_valido';
  END IF;
  -- Expirado que nunca foi enviado (veio de rascunho) não tem o que renovar: renovar só vale para o que já saiu.
  IF v_anterior = 'expirado' AND v_orc.enviado_em IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.documentos_enviados d WHERE d.tipo = 'orcamento' AND d.referencia_id = p_orcamento_id) THEN
    RAISE EXCEPTION 'Este orçamento nunca foi enviado ao cliente, então não há o que renovar. Envie pelo botão Enviar.' USING DETAIL = 'nunca_enviado';
  END IF;
  IF NOT (coalesce(v_orc.valor_total, 0) > 0) THEN
    RAISE EXCEPTION 'Orçamento sem valor não pode ser reenviado. Preencha os itens antes.' USING DETAIL = 'sem_valor';
  END IF;

  UPDATE public.orcamentos SET status = 'enviado', enviado_em = now() WHERE id = p_orcamento_id;
  SELECT * INTO v_orc FROM public.orcamentos WHERE id = p_orcamento_id;
  v_versao := public.orcamento_congelar_versao(v_orc, false, v_uid);
  INSERT INTO public.eventos_negocio (entidade, entidade_id, cliente_id, tipo, titulo, descricao, usuario_id)
  VALUES ('orcamento', p_orcamento_id, v_orc.cliente_id, 'orcamento_renovado', 'Validade renovada',
          'Voltou para enviado com a validade contando de novo. Estava como ' || CASE v_anterior WHEN 'expirado' THEN 'expirado' ELSE 'enviado e vencido' END || '.', v_uid);

  RETURN jsonb_build_object(
    'ok', true,
    'orcamento_id', p_orcamento_id,
    'status', 'enviado',
    'status_anterior', v_anterior,
    'enviado_em', v_orc.enviado_em,
    'valido_ate', (v_orc.enviado_em AT TIME ZONE 'America/Sao_Paulo')::date + v_orc.validade_dias,
    'versao_id', v_versao);
END
$f$;

REVOKE ALL ON FUNCTION public.renovar_orcamento_vencido(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.renovar_orcamento_vencido(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.renovar_orcamento_vencido(uuid) IS
  'Renova orçamento expirado ou enviado e vencido (sem OS, com valor): volta a enviado, grava enviado_em agora, congela a versão. Exige orcamentos.create e orcamentos.send. Não manda mensagem ao cliente.';

DO $v$
BEGIN
  IF has_function_privilege('anon', 'public.renovar_orcamento_vencido(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.aprovar_orcamento(uuid, uuid, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'função de orçamento ficou executável por anon';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.renovar_orcamento_vencido(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.aprovar_orcamento(uuid, uuid, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated perdeu o EXECUTE';
  END IF;
END $v$;

COMMIT;
