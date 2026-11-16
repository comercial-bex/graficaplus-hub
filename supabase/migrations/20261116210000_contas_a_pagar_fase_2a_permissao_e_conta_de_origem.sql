-- =====================================================================================================
-- CONTAS A PAGAR — FASE 2A: PERMISSÃO NO BANCO, TENTATIVA NEGADA NO HISTÓRICO E CONTA DE ORIGEM (16/11/2026)
--
-- APLICADA em 16/11/2026 pelo conector do banco, a partir DESTE arquivo (do BEGIN ao COMMIT, sem alteração).
-- RETRATO logo depois de aplicada, md5(prosrc) em pg_proc igual ao corpo abaixo; anon não executa nenhuma:
--   _negar_conta_pagar          e80cc42d76890b2dd993c4bc350bf83b
--   pagar_conta_pagar           27ced737bf7849eccf8b54f712ef725b
--   estornar_conta_pagar        26bea7633fec40790db3ba5c3b019a77
--   remover_anexo_conta_pagar   1eb0920125e710e51efb8084b95408ad
--   anexar_arquivo_conta_pagar  3e66126ab73fc25f237ce1ab67e3209f
--   anexar_comprovante_parcela  19eb2460cff1a3b0784d1b82f6245de1
--   baixar_parcela_compromisso  e31e117f2e29d2edb3b19eb2f4b13c16
--   quitar_parcelas_ate         0f46b72aa9d8dd864e3728af0e3de0af
-- Ensaio no banco vivo antes de aplicar (docs/ensaio-contas-a-pagar-fase-2a.sql, com esta migração dentro da
-- mesma transação, desfeita): 29 de 29 OK. Impressão digital dos dados antes e depois de aplicar, idêntica:
-- 111 contas a pagar (R$ 193.262,31), 7 pagas (R$ 10.320,89), 94 movimentos de caixa (R$ 37.567,14),
-- 2 anexos, 5 linhas de histórico, 91 linhas de extrato. Nenhum valor, status ou data mudou.
--
-- O QUE ESTAVA ABERTO (medido no banco vivo em 16/11, numa transação desfeita)
--   - Estornar e remover anexo: já eram só do admin no banco (função, gatilhos da trava e policy do Storage).
--     O financeiro foi recusado nos cinco caminhos. Continua igual: decisão do dono, só admin.
--   - Pagar pelo diálogo (pagar_conta_pagar): admin, ou quem vê o financeiro E tem pagamentos.confirm E
--     pagamentos.create. Hoje: Harison (admin), Cibele (financeiro), Raymison (gestor + vendedor).
--   - FURO: as funções de Despesas fixas e contratos só conferiam a chave. As duas vendedoras (confirm e
--     create, sem financeiro.read) davam baixa em parcela (com saída no caixa), quitavam em lote e trocavam o
--     comprovante, pela API: as três passaram no ensaio. A tela não deixava (a rota pede financeiro.read).
--   - Nenhuma tentativa negada ficava registrada.
--   - Pagar aceitava "Não informar" a conta de origem; dar baixa em parcela nem perguntava.
--
-- O QUE ESTA MIGRAÇÃO FAZ
--   1. contas_pagar_historico aceita o evento 'tentativa_negada'. Nenhuma linha existente muda.
--   2. _negar_conta_pagar: grava a tentativa negada no histórico da conta e devolve
--      {negado: true, acao, mensagem}. As funções de pagar, estornar, remover anexo, anexar arquivo, dar
--      baixa, quitar em lote e anexar comprovante de parcela, quando negam, DEVOLVEM isso em vez de disparar
--      erro: no Postgres o erro desfaz tudo o que a transação gravou, inclusive a linha de histórico.
--      As telas tratam negado como erro (mesma mensagem de antes).
--      Editar a tabela por fora das funções (UPDATE/DELETE direto pela API) continua recusado pelos gatilhos
--      da trava e pelas regras de 05/10, sem registro: nenhuma tela usa esse caminho.
--   3. Quem pode, sem mudar papel de ninguém: dar baixa em parcela, quitar em lote e anexar comprovante de
--      parcela passam a exigir também ver o financeiro (financeiro.read), como pagar e anexar desde
--      20261116170000. Quem usa hoje (admin, financeiro, gestor+vendedor) continua; as vendedoras saem.
--   4. Conta de origem obrigatória para pagar:
--      - pagar_conta_pagar: conta bancária ativa, ou forma 'Dinheiro' com comprovante já anexado (enviado
--        depois do último estorno da conta). Sem os dois, recusa.
--      - baixar_parcela_compromisso ganha p_conta_bancaria_id e a mesma regra quando lança a saída no caixa
--        (o comprovante do dinheiro é o desta baixa). A saída nasce com a conta de origem. Baixa sem lançar no
--        caixa (parcela paga antes do sistema) e "Quitar até" seguem sem conta: não há dinheiro saindo aqui.
--   Nada é recalculado nem regravado: contas já pagas sem conta de origem continuam como estão.
-- =====================================================================================================
BEGIN;
SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------------------------------
-- 0. Só troca o que está vivo como conferido em 16/11 (md5 do corpo em pg_proc).
-- ---------------------------------------------------------------------------------------------------
DO $guarda$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public.pagar_conta_pagar(uuid, date, uuid, text)',                          'fccf5d2b13904c9dac5be20f8435d0ff'),
      ('public.estornar_conta_pagar(uuid, text)',                                   '665dd1fb4925a87013bc79a0a827b120'),
      ('public.remover_anexo_conta_pagar(uuid, text)',                              'fcad31fd1099d3038af5453ffe6ff659'),
      ('public.anexar_arquivo_conta_pagar(uuid, text, text, text)',                 'd254a5a1dcbff46fdd8b6e9e6e874f1b'),
      ('public.anexar_comprovante_parcela(uuid, text)',                             '6281ad1e5b199c641b8dd2357d58dbb5'),
      ('public.baixar_parcela_compromisso(uuid, date, text, text, boolean)',        'f2a2cddb8a8cf4186f10a12feb41c95e'),
      ('public.quitar_parcelas_ate(uuid, date)',                                    'eccaf5c1be49f5cee23b140a7a2eeb8b')
    ) AS t(funcao, md5)
  LOOP
    IF to_regprocedure(r.funcao) IS NULL THEN
      RAISE EXCEPTION '% não existe no banco', r.funcao;
    END IF;
    IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure(r.funcao)) IS DISTINCT FROM r.md5 THEN
      RAISE EXCEPTION '% mudou no banco desde 16/11: releia a definição viva antes de trocar.', r.funcao;
    END IF;
  END LOOP;
END $guarda$;

-- ---------------------------------------------------------------------------------------------------
-- 1. Histórico aceita 'tentativa_negada'.
-- ---------------------------------------------------------------------------------------------------
ALTER TABLE public.contas_pagar_historico DROP CONSTRAINT IF EXISTS contas_pagar_historico_evento_check;
ALTER TABLE public.contas_pagar_historico ADD CONSTRAINT contas_pagar_historico_evento_check
  CHECK (evento = ANY (ARRAY['criada'::text, 'paga'::text, 'estornada'::text, 'reaberta'::text,
                             'cancelada'::text, 'excluida'::text, 'anexo_enviado'::text,
                             'anexo_removido'::text, 'tentativa_negada'::text]));

-- ---------------------------------------------------------------------------------------------------
-- 2. Registrar a recusa. Só as funções abaixo (SECURITY DEFINER, rodam como dono) chamam; ninguém
--    logado executa direto, senão qualquer um encheria o histórico de linhas.
-- ---------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._negar_conta_pagar(p_conta_id uuid, p_acao text, p_mensagem text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid  uuid := auth.uid();
  v_nome text;
BEGIN
  IF p_conta_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.contas_pagar WHERE id = p_conta_id) THEN
    SELECT u.nome INTO v_nome FROM public.usuarios u WHERE u.id = v_uid;
    INSERT INTO public.contas_pagar_historico (conta_pagar_id, evento, usuario_id, usuario_nome, motivo, detalhes)
    VALUES (p_conta_id, 'tentativa_negada', v_uid, v_nome, p_mensagem, jsonb_build_object('acao', p_acao));
  END IF;
  RETURN jsonb_build_object('negado', true, 'acao', p_acao, 'mensagem', p_mensagem, 'conta_id', p_conta_id);
END
$function$;

COMMENT ON FUNCTION public._negar_conta_pagar(uuid, text, text) IS
  'Fase 2A: grava tentativa_negada no histórico da conta (se ela existe) e devolve {negado, acao, mensagem}. Interna: só as funções de contas a pagar chamam.';

-- ---------------------------------------------------------------------------------------------------
-- 3. Pagar: a recusa vai para o histórico e a origem do dinheiro é obrigatória.
-- ---------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pagar_conta_pagar(
  p_conta_id uuid,
  p_data_pagamento date,
  p_conta_bancaria_id uuid DEFAULT NULL,
  p_forma_pagamento text DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  v_c     public.contas_pagar%ROWTYPE;
  v_banco text;
  v_forma text := nullif(btrim(coalesce(p_forma_pagamento, '')), '');
  v_dinheiro boolean := lower(coalesce(nullif(btrim(coalesce(p_forma_pagamento, '')), ''), '')) = 'dinheiro';
  v_mov   uuid := gen_random_uuid();
  v_qtd   integer;
BEGIN
  -- A regra que já valia no botão Pagar: ver o financeiro (o RLS de contas_pagar) E dar baixa (confirm)
  -- E lançar no caixa (create). Sem o primeiro, o vendedor, que tem as duas chaves, pagaria pela API.
  IF v_uid IS NULL OR NOT (public.has_role(v_uid, 'admin'::public.app_role)
                           OR (public.can_see_financials(v_uid)
                               AND public.has_permission(v_uid, 'pagamentos.confirm')
                               AND public.has_permission(v_uid, 'pagamentos.create'))) THEN
    -- Fase 2A: a recusa fica no histórico da conta. Erro desfaria o registro junto; por isso devolve.
    RETURN public._negar_conta_pagar(p_conta_id, 'pagar', 'Sem permissão para pagar: dar baixa é com o financeiro.');
  END IF;
  IF p_data_pagamento IS NULL THEN
    RAISE EXCEPTION 'Informe a data do pagamento.';
  END IF;
  IF p_data_pagamento > public.hoje_br() THEN
    RAISE EXCEPTION 'A data do pagamento (%) é futura. Pagamento agendado ainda não é pagamento.',
      to_char(p_data_pagamento, 'DD/MM/YYYY');
  END IF;

  SELECT * INTO v_c FROM public.contas_pagar WHERE id = p_conta_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conta a pagar não encontrada.'; END IF;
  IF v_c.status = 'paga' THEN
    RAISE EXCEPTION 'Esta conta já está paga (em %).', coalesce(to_char(v_c.data_pagamento, 'DD/MM/YYYY'), 'data não informada');
  END IF;
  IF v_c.status = 'cancelada' THEN RAISE EXCEPTION 'Conta cancelada não se paga.'; END IF;
  IF coalesce(v_c.valor, 0) <= 0 THEN RAISE EXCEPTION 'A conta está sem valor. Corrija o valor antes de pagar.'; END IF;

  -- Conta em aberto com saída já no caixa é um estado que alguém precisa olhar antes: pagar de novo
  -- lançaria a saída duas vezes.
  IF EXISTS (SELECT 1 FROM public.caixa_movimentos WHERE conta_pagar_id = p_conta_id) THEN
    RAISE EXCEPTION 'Já existe movimento de caixa ligado a esta conta em aberto. Confira em Movimentos antes de pagar.';
  END IF;

  -- Fase 2A: de onde saiu o dinheiro é obrigatório. Ou a conta bancária, ou Dinheiro / caixa físico, e o
  -- dinheiro só com comprovante já anexado (enviado depois do último estorno, se houve, para o comprovante
  -- do pagamento desfeito não valer pelo novo).
  IF p_conta_bancaria_id IS NOT NULL THEN
    IF v_dinheiro THEN
      RAISE EXCEPTION 'Escolha a conta bancária ou Dinheiro / caixa físico, não os dois.';
    END IF;
    SELECT b.nome INTO v_banco FROM public.contas_bancarias b WHERE b.id = p_conta_bancaria_id AND b.ativo;
    IF NOT FOUND THEN RAISE EXCEPTION 'Conta bancária não encontrada ou inativa.'; END IF;
  ELSIF NOT v_dinheiro THEN
    RAISE EXCEPTION 'Escolha de onde saiu o dinheiro: a conta bancária ou Dinheiro / caixa físico.';
  ELSIF NOT EXISTS (
    SELECT 1 FROM public.contas_pagar_anexos a
     WHERE a.conta_pagar_id = p_conta_id AND a.tipo = 'comprovante'
       AND a.enviado_em > coalesce((SELECT max(h.ocorrido_em) FROM public.contas_pagar_historico h
                                     WHERE h.conta_pagar_id = p_conta_id AND h.evento = 'estornada'),
                                    '-infinity'::timestamptz)) THEN
    RAISE EXCEPTION 'Pagamento em dinheiro exige o comprovante anexado antes de pagar.';
  ELSE
    v_forma := 'Dinheiro';
  END IF;

  PERFORM set_config('bex.conta_pagar_contexto',
    jsonb_strip_nulls(jsonb_build_object('conta_id', p_conta_id, 'movimento_id', v_mov,
      'conta_bancaria_id', p_conta_bancaria_id, 'conta_bancaria', v_banco, 'forma_pagamento', v_forma))::text,
    true);

  UPDATE public.contas_pagar
     SET status = 'paga',
         data_pagamento = p_data_pagamento,
         forma_pagamento = coalesce(v_forma, forma_pagamento),
         updated_at = now()
   WHERE id = p_conta_id AND status NOT IN ('paga', 'cancelada');
  GET DIAGNOSTICS v_qtd = ROW_COUNT;
  IF v_qtd <> 1 THEN RAISE EXCEPTION 'A conta não foi marcada como paga.'; END IF;

  -- A saída nasce na data INFORMADA, não na do clique.
  INSERT INTO public.caixa_movimentos
    (id, tipo, origem, descricao, categoria, valor, data, realizado, conta_pagar_id, conta_id, created_by)
  VALUES (v_mov, 'saida', 'conta_pagar', v_c.descricao, v_c.categoria, v_c.valor, p_data_pagamento, true,
          p_conta_id, p_conta_bancaria_id, v_uid);

  PERFORM set_config('bex.conta_pagar_contexto', '', true);

  RETURN jsonb_build_object('conta_id', p_conta_id, 'data_pagamento', p_data_pagamento,
                            'valor', v_c.valor, 'movimento_id', v_mov, 'conta_bancaria_id', p_conta_bancaria_id);
END
$function$;

COMMENT ON FUNCTION public.pagar_conta_pagar(uuid, date, uuid, text) IS
  'Paga a conta numa transação: marca paga com a data informada e lança a saída no caixa nessa data. Origem obrigatória: conta bancária ativa, ou forma Dinheiro com comprovante já anexado. Exige admin, ou financeiro.read E pagamentos.confirm E pagamentos.create; sem isso devolve negado e registra a tentativa no histórico. Recusa data futura e conta já paga.';

-- ---------------------------------------------------------------------------------------------------
-- 4. Estornar: só admin, como antes; a recusa vai para o histórico.
-- ---------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.estornar_conta_pagar(p_conta_id uuid, p_motivo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid           uuid := auth.uid();
  v_motivo        text := btrim(coalesce(p_motivo, ''));
  v_c             public.contas_pagar%ROWTYPE;
  v_desconciliadas jsonb;
  v_removidos     jsonb;
  v_desligados    jsonb;
  v_reembolsos    integer;
  v_qtd           integer;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::public.app_role) THEN
    -- Fase 2A: só admin, como antes; agora a recusa fica no histórico da conta.
    RETURN public._negar_conta_pagar(p_conta_id, 'estornar', 'Só o administrador estorna pagamento de conta a pagar.');
  END IF;
  IF length(v_motivo) < 5 THEN
    RAISE EXCEPTION 'Escreva o motivo do estorno (pelo menos 5 caracteres).';
  END IF;

  SELECT * INTO v_c FROM public.contas_pagar WHERE id = p_conta_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conta a pagar não encontrada.'; END IF;
  IF v_c.status <> 'paga' THEN RAISE EXCEPTION 'Só conta paga pode ser estornada.'; END IF;

  -- 1. Linha do extrato que estava conciliada com a saída deste pagamento volta para a fila de conciliação.
  WITH alvo AS (
    SELECT m.id FROM public.caixa_movimentos m
     WHERE m.conta_pagar_id = p_conta_id AND m.origem = 'conta_pagar'
  ), t AS (
    UPDATE public.banco_transacoes b
       SET conciliado = false, caixa_movimento_id = NULL
     WHERE b.caixa_movimento_id IN (SELECT id FROM alvo)
    RETURNING b.id
  )
  SELECT coalesce(jsonb_agg(t.id), '[]'::jsonb) INTO v_desconciliadas FROM t;

  -- 2. A saída que o pagamento lançou sai do caixa. tg_auditar guarda a linha inteira em logs_auditoria.
  WITH d AS (
    DELETE FROM public.caixa_movimentos m
     WHERE m.conta_pagar_id = p_conta_id AND m.origem = 'conta_pagar'
    RETURNING m.id, m.data, m.valor, m.conta_id
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'data', d.data, 'valor', d.valor,
                                               'conta_bancaria_id', d.conta_id)), '[]'::jsonb)
    INTO v_removidos FROM d;

  -- 3. Linha de extrato (ou outra origem) ligada à conta: extrato não se apaga, só se desliga.
  WITH u AS (
    UPDATE public.caixa_movimentos m SET conta_pagar_id = NULL
     WHERE m.conta_pagar_id = p_conta_id
    RETURNING m.id
  )
  SELECT coalesce(jsonb_agg(u.id), '[]'::jsonb) INTO v_desligados FROM u;

  -- 4. tg_reembolso_pago_com_a_conta marcou os reembolsos como pagos junto com a conta; aqui eles voltam.
  UPDATE public.reembolsos
     SET status = 'aprovado', pago_em = NULL
   WHERE conta_pagar_id = p_conta_id AND status = 'pago';
  GET DIAGNOSTICS v_reembolsos = ROW_COUNT;

  -- 5. A conta reabre. Atraso continua vindo da data de vencimento, não do status.
  PERFORM set_config('bex.conta_pagar_contexto',
    jsonb_build_object('conta_id', p_conta_id, 'motivo', v_motivo,
                       'movimentos_removidos', v_removidos, 'extrato_desligado', v_desligados,
                       'transacoes_desconciliadas', v_desconciliadas,
                       'reembolsos_reabertos', v_reembolsos)::text,
    true);

  UPDATE public.contas_pagar
     SET status = 'aberta', data_pagamento = NULL, updated_at = now()
   WHERE id = p_conta_id AND status = 'paga';
  GET DIAGNOSTICS v_qtd = ROW_COUNT;
  IF v_qtd <> 1 THEN RAISE EXCEPTION 'A conta não foi reaberta.'; END IF;

  PERFORM set_config('bex.conta_pagar_contexto', '', true);

  RETURN jsonb_build_object('conta_id', p_conta_id, 'valor', v_c.valor,
                            'data_pagamento_estornada', v_c.data_pagamento,
                            'movimentos_removidos', jsonb_array_length(v_removidos),
                            'extrato_desligado', jsonb_array_length(v_desligados),
                            'transacoes_desconciliadas', jsonb_array_length(v_desconciliadas),
                            'reembolsos_reabertos', v_reembolsos);
END
$function$;

COMMENT ON FUNCTION public.estornar_conta_pagar(uuid, text) IS
  'Só admin (quem não é devolve negado e a tentativa vai para o histórico). Reabre a conta paga, apaga a saída que o pagamento lançou, devolve à conciliação o extrato casado com ela e volta reembolsos a aprovado. Motivo obrigatório, gravado em contas_pagar_historico.';

-- ---------------------------------------------------------------------------------------------------
-- 5. Remover anexo: só admin, como antes; a recusa vai para o histórico.
-- ---------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.remover_anexo_conta_pagar(p_anexo_id uuid, p_motivo text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_a   public.contas_pagar_anexos%ROWTYPE;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::public.app_role) THEN
    -- Fase 2A: só admin, como antes; agora a recusa fica no histórico da conta do anexo.
    RETURN public._negar_conta_pagar(
      (SELECT a.conta_pagar_id FROM public.contas_pagar_anexos a WHERE a.id = p_anexo_id),
      'remover anexo', 'Só o administrador remove anexo de conta a pagar.');
  END IF;

  SELECT * INTO v_a FROM public.contas_pagar_anexos WHERE id = p_anexo_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Anexo não encontrado.'; END IF;

  PERFORM set_config('bex.conta_pagar_contexto',
    jsonb_strip_nulls(jsonb_build_object('conta_id', v_a.conta_pagar_id,
                                         'motivo', nullif(btrim(coalesce(p_motivo, '')), '')))::text,
    true);
  DELETE FROM public.contas_pagar_anexos WHERE id = p_anexo_id;
  PERFORM set_config('bex.conta_pagar_contexto', '', true);

  RETURN jsonb_build_object('anexo_id', v_a.id, 'conta_id', v_a.conta_pagar_id,
                            'bucket', 'contas-pagar-anexos', 'caminho', v_a.caminho);
END
$function$;

COMMENT ON FUNCTION public.remover_anexo_conta_pagar(uuid, text) IS
  'Só admin (quem não é devolve negado e a tentativa vai para o histórico). Apaga a linha do anexo e devolve o caminho para a tela apagar o arquivo pela API do Storage.';

-- ---------------------------------------------------------------------------------------------------
-- 6. Anexar arquivo: mesma regra de 20261116170000; a recusa vai para o histórico.
-- ---------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.anexar_arquivo_conta_pagar(
  p_conta_id uuid,
  p_tipo text,
  p_caminho text,
  p_nome_arquivo text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid  uuid := auth.uid();
  v_nome text;
  v_meta jsonb;
  v_mime text;
  v_tam  bigint;
  v_id   uuid;
BEGIN
  -- A regra do comprovante de hoje: ver o financeiro E uma chave de pagamento.
  IF v_uid IS NULL OR NOT (public.has_role(v_uid, 'admin'::public.app_role)
                           OR (public.can_see_financials(v_uid)
                               AND (public.has_permission(v_uid, 'pagamentos.create')
                                    OR public.has_permission(v_uid, 'pagamentos.update')
                                    OR public.has_permission(v_uid, 'pagamentos.confirm')))) THEN
    -- Fase 2A: a recusa fica no histórico da conta.
    RETURN public._negar_conta_pagar(p_conta_id, 'anexar arquivo', 'Sem permissão para anexar arquivo à conta a pagar.');
  END IF;
  IF p_tipo IS NULL OR p_tipo NOT IN ('fatura', 'comprovante') THEN
    RAISE EXCEPTION 'Tipo de anexo inválido: use fatura ou comprovante.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.contas_pagar WHERE id = p_conta_id) THEN
    RAISE EXCEPTION 'Conta a pagar não encontrada.';
  END IF;
  IF p_caminho IS NULL OR p_caminho NOT LIKE p_conta_id::text || '/%' THEN
    RAISE EXCEPTION 'O arquivo não está na pasta desta conta.';
  END IF;

  -- Tamanho e tipo vêm do objeto gravado pelo Storage, não do que a tela declarou.
  SELECT o.metadata INTO v_meta
    FROM storage.objects o
   WHERE o.bucket_id = 'contas-pagar-anexos' AND o.name = p_caminho;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'O arquivo não chegou ao armazenamento. Envie de novo.';
  END IF;
  v_mime := lower(coalesce(v_meta->>'mimetype', ''));
  v_tam := coalesce(nullif(v_meta->>'size', ''), nullif(v_meta->>'contentLength', ''))::bigint;
  IF v_mime NOT IN ('application/pdf', 'image/jpeg', 'image/png') THEN
    RAISE EXCEPTION 'Tipo de arquivo não aceito (%). Use PDF, JPG ou PNG.', v_mime;
  END IF;
  IF v_tam IS NULL OR v_tam <= 0 OR v_tam > 10485760 THEN
    RAISE EXCEPTION 'O arquivo passa de 10 MB ou está vazio.';
  END IF;

  SELECT u.nome INTO v_nome FROM public.usuarios u WHERE u.id = v_uid;
  INSERT INTO public.contas_pagar_anexos
    (conta_pagar_id, tipo, caminho, nome_arquivo, mime, tamanho_bytes, enviado_por, enviado_por_nome)
  VALUES (p_conta_id, p_tipo, p_caminho, left(coalesce(nullif(btrim(p_nome_arquivo), ''), 'arquivo'), 200),
          v_mime, v_tam, v_uid, v_nome)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('anexo_id', v_id, 'conta_id', p_conta_id, 'tipo', p_tipo, 'tamanho_bytes', v_tam);
END
$function$;

COMMENT ON FUNCTION public.anexar_arquivo_conta_pagar(uuid, text, text, text) IS
  'Registra um arquivo já enviado ao bucket contas-pagar-anexos. Exige admin, ou financeiro.read E pagamentos.create/update/confirm. Confere tipo e tamanho no objeto gravado. Sem permissão, devolve negado e registra a tentativa no histórico.';

-- ---------------------------------------------------------------------------------------------------
-- 7. Anexar comprovante de parcela: passa a exigir ver o financeiro; a recusa vai para o histórico.
-- ---------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.anexar_comprovante_parcela(p_conta_id uuid, p_comprovante_url text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_qtd integer;
BEGIN
  -- Anexar o comprovante é corrigir o lançamento: pagamentos.update ou pagamentos.confirm, como desde 05/10,
  -- e desde a Fase 2A também ver o financeiro (a vendedora tem confirm e não vê o financeiro).
  IF v_uid IS NULL OR NOT (public.has_role(v_uid, 'admin'::public.app_role)
                           OR (public.can_see_financials(v_uid)
                               AND (public.has_permission(v_uid, 'pagamentos.update')
                                    OR public.has_permission(v_uid, 'pagamentos.confirm')))) THEN
    RETURN public._negar_conta_pagar(p_conta_id, 'anexar comprovante de parcela', 'Sem permissão para anexar comprovante.');
  END IF;

  UPDATE public.contas_pagar
     SET comprovante_url = p_comprovante_url, updated_at = now()
   WHERE id = p_conta_id AND compromisso_id IS NOT NULL;

  GET DIAGNOSTICS v_qtd = ROW_COUNT;
  IF v_qtd = 0 THEN RAISE EXCEPTION 'Parcela de compromisso não encontrada'; END IF;
  RETURN jsonb_build_object('conta_id', p_conta_id, 'anexado', true);
END
$function$;

COMMENT ON FUNCTION public.anexar_comprovante_parcela(uuid, text) IS
  'Grava o caminho do comprovante na parcela. Exige admin, ou financeiro.read E (pagamentos.update ou confirm); sem isso devolve negado e registra a tentativa no histórico.';

-- ---------------------------------------------------------------------------------------------------
-- 8. Dar baixa em parcela: ver o financeiro, conta de origem quando lança no caixa, recusa no histórico.
--    A assinatura ganha p_conta_bancaria_id: a de 5 argumentos sai (duas versões deixariam a chamada
--    por nome ambígua).
-- ---------------------------------------------------------------------------------------------------
DROP FUNCTION public.baixar_parcela_compromisso(uuid, date, text, text, boolean);

CREATE FUNCTION public.baixar_parcela_compromisso(
  p_conta_id uuid,
  p_data_pagamento date,
  p_comprovante_url text DEFAULT NULL::text,
  p_forma_pagamento text DEFAULT NULL::text,
  p_lancar_caixa boolean DEFAULT true,
  p_conta_bancaria_id uuid DEFAULT NULL::uuid
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid         uuid := auth.uid();
  v_p           public.contas_pagar%ROWTYPE;
  v_forma       text := nullif(btrim(coalesce(p_forma_pagamento, '')), '');
  v_dinheiro    boolean := lower(coalesce(nullif(btrim(coalesce(p_forma_pagamento, '')), ''), '')) = 'dinheiro';
  v_banco       text;
  v_ja_no_caixa integer;
  v_lancou      boolean := false;
BEGIN
  -- Dar baixa pede pagamentos.confirm (desde 05/10) e, desde a Fase 2A, ver o financeiro.
  IF v_uid IS NULL OR NOT (public.has_role(v_uid, 'admin'::public.app_role)
                           OR (public.can_see_financials(v_uid)
                               AND public.has_permission(v_uid, 'pagamentos.confirm'))) THEN
    RETURN public._negar_conta_pagar(p_conta_id, 'dar baixa em parcela', 'Sem permissão para dar baixa em parcela.');
  END IF;

  SELECT * INTO v_p FROM public.contas_pagar WHERE id = p_conta_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Parcela não encontrada'; END IF;
  IF v_p.compromisso_id IS NULL THEN
    RAISE EXCEPTION 'Esta conta não pertence a um compromisso';
  END IF;

  -- Movimento de caixa só se pedido E se ainda não existe: dar baixa duas vezes na mesma parcela (corrigir
  -- a data, anexar o comprovante depois) não pode lançar a saída duas vezes.
  SELECT count(*) INTO v_ja_no_caixa FROM public.caixa_movimentos WHERE conta_pagar_id = p_conta_id;
  v_lancou := p_lancar_caixa AND v_ja_no_caixa = 0;

  -- Fase 2A: a saída que nasce aqui tem origem. Conta bancária ativa, ou Dinheiro com o comprovante desta baixa.
  IF v_lancou THEN
    IF p_conta_bancaria_id IS NOT NULL THEN
      IF v_dinheiro THEN
        RAISE EXCEPTION 'Escolha a conta bancária ou Dinheiro / caixa físico, não os dois.';
      END IF;
      SELECT b.nome INTO v_banco FROM public.contas_bancarias b WHERE b.id = p_conta_bancaria_id AND b.ativo;
      IF NOT FOUND THEN RAISE EXCEPTION 'Conta bancária não encontrada ou inativa.'; END IF;
    ELSIF NOT v_dinheiro THEN
      RAISE EXCEPTION 'Escolha de onde saiu o dinheiro: a conta bancária ou Dinheiro / caixa físico.';
    ELSIF p_comprovante_url IS NULL THEN
      RAISE EXCEPTION 'Pagamento em dinheiro exige o comprovante nesta baixa.';
    ELSE
      v_forma := 'Dinheiro';
    END IF;
  END IF;

  PERFORM set_config('bex.conta_pagar_contexto',
    jsonb_strip_nulls(jsonb_build_object('conta_id', p_conta_id,
      'conta_bancaria_id', CASE WHEN v_lancou THEN p_conta_bancaria_id END,
      'conta_bancaria', v_banco, 'forma_pagamento', v_forma))::text,
    true);

  UPDATE public.contas_pagar
     SET status = 'paga',
         data_pagamento = p_data_pagamento,
         comprovante_url = coalesce(p_comprovante_url, comprovante_url),
         forma_pagamento = coalesce(v_forma, forma_pagamento),
         updated_at = now()
   WHERE id = p_conta_id;

  IF v_lancou THEN
    INSERT INTO public.caixa_movimentos
      (tipo, origem, descricao, categoria, valor, data, realizado, conta_pagar_id, conta_id, created_by)
    VALUES ('saida', 'conta_pagar', v_p.descricao, v_p.categoria, v_p.valor,
            p_data_pagamento, true, p_conta_id, p_conta_bancaria_id, v_uid);
  END IF;

  PERFORM set_config('bex.conta_pagar_contexto', '', true);

  RETURN jsonb_build_object(
    'conta_id', p_conta_id,
    'data_pagamento', p_data_pagamento,
    'com_comprovante', coalesce(p_comprovante_url, v_p.comprovante_url) IS NOT NULL,
    'lancado_no_caixa', v_lancou,
    'conta_bancaria_id', CASE WHEN v_lancou THEN p_conta_bancaria_id END
  );
END
$function$;

COMMENT ON FUNCTION public.baixar_parcela_compromisso(uuid, date, text, text, boolean, uuid) IS
  'Dá baixa na parcela. Exige admin, ou financeiro.read E pagamentos.confirm; sem isso devolve negado e registra a tentativa. Quando lança a saída no caixa, exige a origem: conta bancária ativa, ou Dinheiro com o comprovante desta baixa.';

-- ---------------------------------------------------------------------------------------------------
-- 9. Quitar em lote: ver o financeiro; a recusa vai para o histórico de cada parcela que seria quitada.
-- ---------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.quitar_parcelas_ate(p_compromisso_id uuid, p_ate date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_qtd integer;
  v_id  uuid;
BEGIN
  -- Quitar em lote é dar baixa sem lançar no caixa: pagamentos.confirm (desde 05/10) e ver o financeiro.
  IF v_uid IS NULL OR NOT (public.has_role(v_uid, 'admin'::public.app_role)
                           OR (public.can_see_financials(v_uid)
                               AND public.has_permission(v_uid, 'pagamentos.confirm'))) THEN
    FOR v_id IN SELECT c.id FROM public.contas_pagar c
                 WHERE c.compromisso_id = p_compromisso_id AND c.vencimento <= p_ate
                   AND c.status NOT IN ('paga', 'cancelada') LOOP
      PERFORM public._negar_conta_pagar(v_id, 'quitar em lote', 'Sem permissão para quitar parcelas.');
    END LOOP;
    RETURN jsonb_build_object('negado', true, 'acao', 'quitar em lote',
                              'mensagem', 'Sem permissão para quitar parcelas.');
  END IF;
  UPDATE public.contas_pagar
     SET status = 'paga', data_pagamento = vencimento,
         observacoes = coalesce(observacoes || ' · ', '') || 'quitada antes da entrada no sistema',
         updated_at = now()
   WHERE compromisso_id = p_compromisso_id AND vencimento <= p_ate
     AND status NOT IN ('paga', 'cancelada');
  GET DIAGNOSTICS v_qtd = ROW_COUNT;
  RETURN jsonb_build_object('parcelas_quitadas', v_qtd, 'ate', p_ate);
END
$function$;

COMMENT ON FUNCTION public.quitar_parcelas_ate(uuid, date) IS
  'Marca pagas, sem lançar no caixa, as parcelas vencidas até a data (pagas antes do sistema). Exige admin, ou financeiro.read E pagamentos.confirm; sem isso devolve negado e registra a tentativa em cada parcela.';

-- ---------------------------------------------------------------------------------------------------
-- 10. EXECUTE. Função nasce aberta a PUBLIC, e no Supabase anon e authenticated têm grant próprio.
--     CREATE OR REPLACE mantém o grant de hoje; a baixa de parcela é nova (DROP + CREATE) e a de negar
--     não é de ninguém.
-- ---------------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public._negar_conta_pagar(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.baixar_parcela_compromisso(uuid, date, text, text, boolean, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.baixar_parcela_compromisso(uuid, date, text, text, boolean, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.pagar_conta_pagar(uuid, date, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.estornar_conta_pagar(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.remover_anexo_conta_pagar(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.anexar_arquivo_conta_pagar(uuid, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.anexar_comprovante_parcela(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.quitar_parcelas_ate(uuid, date) FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------------------------------
-- 11. Conferência antes do COMMIT: o REVOKE não reclama quando não surte efeito.
-- ---------------------------------------------------------------------------------------------------
DO $confere$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public._negar_conta_pagar(uuid, text, text)',
    'public.pagar_conta_pagar(uuid, date, uuid, text)',
    'public.estornar_conta_pagar(uuid, text)',
    'public.remover_anexo_conta_pagar(uuid, text)',
    'public.anexar_arquivo_conta_pagar(uuid, text, text, text)',
    'public.anexar_comprovante_parcela(uuid, text)',
    'public.baixar_parcela_compromisso(uuid, date, text, text, boolean, uuid)',
    'public.quitar_parcelas_ate(uuid, date)'
  ] LOOP
    IF has_function_privilege('anon', f::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION 'anon executa %', f;
    END IF;
  END LOOP;
  IF has_function_privilege('authenticated', 'public._negar_conta_pagar(uuid, text, text)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated executa _negar_conta_pagar direto';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.baixar_parcela_compromisso(uuid, date, text, text, boolean, uuid)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'a tela (authenticated) perdeu a baixa de parcela';
  END IF;
  IF to_regprocedure('public.baixar_parcela_compromisso(uuid, date, text, text, boolean)') IS NOT NULL THEN
    RAISE EXCEPTION 'a baixa de parcela de 5 argumentos continua no banco';
  END IF;
END $confere$;

COMMIT;

-- =====================================================================================================
-- DESFAZER (não roda): reaplicar os corpos de 20261116170000 (pagar, anexar arquivo), 20261116160000
-- (estornar, remover anexo) e 20261005100000 (anexar comprovante de parcela, quitar em lote e a baixa de
-- parcela de 5 argumentos, depois de DROP FUNCTION da de 6, com o REVOKE/GRANT de lá); DROP FUNCTION
-- public._negar_conta_pagar(uuid, text, text); e voltar o CHECK do histórico sem 'tentativa_negada'
-- (só depois de apagar as linhas com esse evento).
-- =====================================================================================================
