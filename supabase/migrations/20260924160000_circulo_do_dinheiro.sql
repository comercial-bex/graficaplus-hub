-- Onda 1 do plano: fechar o círculo do dinheiro.
--
-- O raio-X de 24/09 mostrou que o caminho "dinheiro entrando" fecha 45% dos
-- passos, e que o buraco não é falta de peça: é falta de LIGAÇÃO.
--
--   * `confirmar_pagamento` existe, está completa e correta — trava a parcela,
--     recusa pagamento em duplicidade, registra o pagamento ligado à parcela e
--     grava o evento de negócio. NENHUMA TELA A CHAMA. A tela do financeiro
--     insere direto em `pagamentos`, sem `parcela_id`, então a parcela nunca
--     fecha e caixa, financeiro e faturamento mostram R$ 0,00 para sempre.
--   * `contas_receber` nasce com status 'previsto' e NADA no sistema inteiro
--     muda esse status. A ficha de cobrança do cliente nunca é encerrada.
--   * Nenhuma tela lê `contas_receber` nem `parcelas_receber`: a cobrança só
--     existia dentro do PDF da OS.
--   * Não havia aviso nenhum de parcela vencida. Há R$ 121,15 vencidos desde
--     04/09 e o sistema se calava.
--
-- Esta migração entrega as três peças de banco que faltavam. A tela vem no
-- mesmo PR.
--
-- COMO DESFAZER:
--   drop trigger tg_conta_receber_segue_parcelas on public.parcelas_receber;
--   drop function public.tg_conta_receber_segue_parcelas(), public.contas_a_receber(boolean);
--   e remover a pendência parcela_vencida_sem_baixa.

-- ------------------------------------------ 1. a conta segue as parcelas
-- Status da parcela: 'prevista' (nascença) e 'paga' (confirmar_pagamento).
-- Status da conta: 'previsto' · 'parcial' · 'recebido'. Antes disto, a conta
-- morria em 'previsto' mesmo quitada, e qualquer relatório de inadimplência
-- contaria como devendo quem já pagou.
CREATE OR REPLACE FUNCTION public.tg_conta_receber_segue_parcelas()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_conta uuid; v_total int; v_pagas int; v_novo text;
BEGIN
  v_conta := COALESCE(NEW.conta_id, OLD.conta_id);
  IF v_conta IS NULL THEN RETURN NULL; END IF;

  SELECT count(*), count(*) FILTER (WHERE status = 'paga')
    INTO v_total, v_pagas
  FROM public.parcelas_receber WHERE conta_id = v_conta;

  v_novo := CASE WHEN v_total = 0 THEN 'previsto'
                 WHEN v_pagas = 0 THEN 'previsto'
                 WHEN v_pagas < v_total THEN 'parcial'
                 ELSE 'recebido' END;

  -- IS DISTINCT FROM evita reescrever o mesmo valor e disparar auditoria à toa
  UPDATE public.contas_receber SET status = v_novo
   WHERE id = v_conta AND status IS DISTINCT FROM v_novo;

  RETURN NULL;
END $function$;

DROP TRIGGER IF EXISTS tg_conta_receber_segue_parcelas ON public.parcelas_receber;
CREATE TRIGGER tg_conta_receber_segue_parcelas
  AFTER INSERT OR UPDATE OF status OR DELETE ON public.parcelas_receber
  FOR EACH ROW EXECUTE FUNCTION public.tg_conta_receber_segue_parcelas();

-- Função de gatilho nasce com EXECUTE para PUBLIC no Postgres: revogar sempre.
REVOKE ALL ON FUNCTION public.tg_conta_receber_segue_parcelas() FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------- 2. o carnê, para a tela
-- Uma chamada devolve tudo que a tela de cobrança precisa: a conta, o cliente,
-- a OS de origem e as parcelas com a marca de atrasada. Guardada por
-- can_see_financials — cobrança é do financeiro.
CREATE OR REPLACE FUNCTION public.contas_a_receber(p_incluir_quitadas boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_linhas jsonb; v_hoje date := CURRENT_DATE;
BEGIN
  IF NOT public.can_see_financials(auth.uid()) THEN
    RAISE EXCEPTION 'A cobrança é do financeiro.' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(x ORDER BY x.vencimento_mais_antigo NULLS LAST), '[]'::jsonb) INTO v_linhas
  FROM (
    SELECT cr.id AS conta_id, cr.status, cr.valor_total, cr.created_at,
           cr.os_id, os.numero AS os_numero, os.titulo AS os_titulo,
           cr.cliente_id, public.nome_do_cliente(cr.cliente_id) AS cliente,
           (SELECT min(p.vencimento) FROM public.parcelas_receber p
             WHERE p.conta_id = cr.id AND p.status <> 'paga') AS vencimento_mais_antigo,
           COALESCE((SELECT sum(p.valor) FROM public.parcelas_receber p
                      WHERE p.conta_id = cr.id AND p.status = 'paga'), 0) AS recebido,
           COALESCE((SELECT sum(p.valor) FROM public.parcelas_receber p
                      WHERE p.conta_id = cr.id AND p.status <> 'paga'), 0) AS a_receber,
           COALESCE((SELECT sum(p.valor) FROM public.parcelas_receber p
                      WHERE p.conta_id = cr.id AND p.status <> 'paga' AND p.vencimento < v_hoje), 0) AS vencido,
           COALESCE((SELECT jsonb_agg(jsonb_build_object(
                       'parcela_id', p.id, 'numero', p.parcela, 'valor', p.valor,
                       'vencimento', p.vencimento, 'status', p.status,
                       'atrasada', (p.status <> 'paga' AND p.vencimento < v_hoje))
                     ORDER BY p.parcela) FROM public.parcelas_receber p WHERE p.conta_id = cr.id), '[]'::jsonb) AS parcelas
    FROM public.contas_receber cr
    LEFT JOIN public.ordens_servico os ON os.id = cr.os_id
    WHERE p_incluir_quitadas OR cr.status <> 'recebido'
  ) x;

  RETURN jsonb_build_object(
    'hoje', v_hoje,
    'contas', v_linhas,
    'total_a_receber', COALESCE((SELECT sum((c->>'a_receber')::numeric) FROM jsonb_array_elements(v_linhas) c), 0),
    'total_vencido', COALESCE((SELECT sum((c->>'vencido')::numeric) FROM jsonb_array_elements(v_linhas) c), 0),
    'total_recebido', COALESCE((SELECT sum((c->>'recebido')::numeric) FROM jsonb_array_elements(v_linhas) c), 0)
  );
END $function$;

REVOKE ALL ON FUNCTION public.contas_a_receber(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contas_a_receber(boolean) TO authenticated;

-- --------------------------------- 3. o aviso do dinheiro que já venceu
DO $patch$
DECLARE src text; novo text; marca text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'pendencias_do_sistema';

  marca := '  RETURN QUERY SELECT ''cliente_sem_contato''';

  novo := replace(src, marca,
'  -- Dinheiro que a gráfica já entregou e ainda não recebeu. Não existia aviso
  -- nenhum para isto: a parcela vencia e o sistema inteiro se calava. O status
  -- gravado é ''prevista'' (não ''pendente''), e é por ele que se procura.
  RETURN QUERY SELECT ''parcela_vencida_sem_baixa'',''Parcelas vencidas e ainda não recebidas'', count(*)::int,
    (SELECT count(*)::int FROM public.parcelas_receber WHERE status <> ''paga''),''critico'',''financeiro'',
    ''O cliente já levou a peça e a parcela venceu. Abra Contas a receber, confirme quem pagou e cobre quem não pagou.'',''/a-receber''
  FROM public.parcelas_receber
  WHERE status <> ''paga'' AND vencimento < CURRENT_DATE
  HAVING count(*) > 0;

' || marca);
  IF novo = src THEN RAISE EXCEPTION 'ponto de inserção da pendência não encontrado'; END IF;
  EXECUTE novo;
END $patch$;

-- ================================================================ CORREÇÕES
-- Achadas pelos verificadores adversariais e por varredura própria, na mesma
-- onda. Ficam aqui, e não em migração separada, porque nenhuma chegou a rodar
-- em produção antes do conserto.

-- --------------- 4. o aviso do dinheiro é do financeiro, não de todo mundo
-- O bloco da pendência acima nasceu FORA do `IF v_ve_dinheiro THEN`, o portão
-- que separa quem vê dinheiro. Qualquer autenticado — impressor, designer,
-- estoque — recebia a contagem e o valor vencido. Depois do conserto, ensaiado:
-- impressor vê nenhuma pendência de dinheiro; financeiro vê a dele e as contas
-- a pagar, cada uma uma vez.
--
-- ATENÇÃO para quem mexer nisto: a função tem DOIS portões `IF v_ve_dinheiro`,
-- e um replace ingênuo insere o bloco nos dois, duplicando o aviso.
DO $patch$
DECLARE src text; novo text; bloco text; pos int;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'pendencias_do_sistema';

  -- já está no lugar certo? então não faz nada
  IF position('parcela_vencida_sem_baixa' in src) > position('IF v_ve_dinheiro THEN' in src) THEN
    RETURN;
  END IF;

  SELECT substr(src, position('  -- Dinheiro que a gráfica já entregou' in src),
                position('HAVING count(*) > 0;' in substr(src, position('  -- Dinheiro que a gráfica já entregou' in src)))
                + length('HAVING count(*) > 0;') + 1)
    INTO bloco;

  novo := replace(src, bloco, '');
  IF novo = src THEN RAISE EXCEPTION 'bloco da pendência não encontrado'; END IF;
  src := novo;

  novo := replace(src, '  IF v_ve_dinheiro THEN', '  IF v_ve_dinheiro THEN' || E'\n' || bloco);
  pos := position(bloco in novo);
  novo := left(novo, pos + length(bloco) - 1) || replace(substr(novo, pos + length(bloco)), bloco, '');

  EXECUTE novo;
END $patch$;

-- ------------------------- 5. as colunas do acordo comercial sem permissão
-- `orcamentos` dá SELECT por coluna ao papel `authenticated`, e prazo,
-- data_inicio, data_entrega_prometida e condicao_pagamento estavam de fora. O
-- card de prazo e o bloco de condição de pagamento leriam a tabela base e
-- tomariam "permission denied": a consulta inteira morre e a tela fica vazia
-- sem erro. Mesmo padrão que matou as views de OS por 13 dias.
GRANT SELECT (data_inicio, prazo, data_entrega_prometida, condicao_pagamento) ON public.orcamentos TO authenticated;
GRANT UPDATE (data_inicio, prazo, data_entrega_prometida, condicao_pagamento) ON public.orcamentos TO authenticated;

-- --------------------- 6. recebimento parcial deixa de sumir com dinheiro
-- `confirmar_pagamento` marcava a parcela como paga por QUALQUER valor: receber
-- R$ 50 de uma parcela de R$ 121,15 quitava a parcela inteira e os R$ 71,15
-- restantes desapareciam da cobrança. E `pagamentos.os_id` é NOT NULL enquanto
-- `contas_receber.os_id` é opcional, então a baixa de conta sem OS estourava
-- com erro cru do banco.
--
-- Ensaiado com reversão: valor zero recusado; R$ 50 deixa quitou=false,
-- falta=71,15, parcela 'prevista' e conta 'previsto'; os R$ 71,15 seguintes
-- fecham parcela e conta.
CREATE OR REPLACE FUNCTION public.confirmar_pagamento(
  p_parcela_id uuid, p_valor numeric, p_meio text, p_taxa numeric DEFAULT 0,
  p_data date DEFAULT CURRENT_DATE, p_comprovante text DEFAULT NULL::text,
  p_referencia_externa text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid UUID; v_pag UUID;
  v_parcela public.parcelas_receber%ROWTYPE;
  v_conta public.contas_receber%ROWTYPE;
  v_ja_pago numeric; v_total_pago numeric; v_quitou boolean;
BEGIN
  v_uid := public.require_permission('pagamentos.confirm');

  IF p_valor IS NULL OR p_valor <= 0 THEN
    RAISE EXCEPTION 'O valor recebido precisa ser maior que zero.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_parcela FROM public.parcelas_receber WHERE id = p_parcela_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Parcela não encontrada'; END IF;
  IF v_parcela.status = 'paga' THEN RAISE EXCEPTION 'Parcela já paga'; END IF;

  SELECT * INTO v_conta FROM public.contas_receber WHERE id = v_parcela.conta_id;

  -- Quanto já entrou nesta parcela em recebimentos anteriores.
  SELECT COALESCE(sum(valor), 0) INTO v_ja_pago
  FROM public.pagamentos
  WHERE parcela_id = p_parcela_id AND status = 'pago' AND pagamento_estornado_id IS NULL;

  v_total_pago := v_ja_pago + p_valor;
  -- Tolerância de um centavo: a divisão da parcela arredonda e a última sobra.
  v_quitou := v_total_pago >= (v_parcela.valor - 0.01);

  INSERT INTO public.pagamentos(
    os_id, parcela_id, valor, data_pagamento, status, forma_pagamento,
    taxa, comprovante_url, referencia_externa, registrado_por)
  VALUES (
    COALESCE(v_conta.os_id, v_parcela.conta_id), p_parcela_id, p_valor, p_data, 'pago', p_meio,
    COALESCE(p_taxa, 0), p_comprovante, p_referencia_externa, v_uid)
  RETURNING id INTO v_pag;

  -- Só quita quando o somado alcança a parcela. Recebimento parcial fica
  -- registrado e a parcela continua aberta, que é a verdade.
  IF v_quitou THEN
    UPDATE public.parcelas_receber SET status = 'paga' WHERE id = p_parcela_id;
  END IF;

  INSERT INTO public.eventos_negocio(
    entidade, entidade_id, os_id, cliente_id, tipo, titulo, dados_posteriores, usuario_id)
  VALUES ('pagamento', v_pag, v_conta.os_id, v_conta.cliente_id, 'pagamento_confirmado',
    CASE WHEN v_quitou THEN 'Pagamento confirmado' ELSE 'Pagamento parcial recebido' END,
    jsonb_build_object('valor', p_valor, 'parcela_id', p_parcela_id,
                       'ja_pago_antes', v_ja_pago, 'total_pago', v_total_pago,
                       'valor_da_parcela', v_parcela.valor, 'quitou', v_quitou), v_uid);

  RETURN jsonb_build_object(
    'pagamento_id', v_pag, 'parcela_id', p_parcela_id,
    'valor_recebido', p_valor, 'total_pago', v_total_pago,
    'valor_da_parcela', v_parcela.valor,
    'falta', GREATEST(v_parcela.valor - v_total_pago, 0),
    'quitou', v_quitou);
END $function$;

-- ------------------- 7. o aviso de conta em aberto procurava palavra morta
-- `receber_em_aberto` filtrava status IN ('pendente','parcial','atrasado'), e o
-- sistema só escreve 'previsto' | 'parcial' | 'recebido'. Duas das três
-- palavras nunca existiram: o aviso era cego para toda conta em aberto que
-- ainda não venceu.
DO $patch$
DECLARE src text; novo text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'pendencias_do_sistema';

  novo := replace(src, 'status IN (''pendente'',''parcial'',''atrasado'')', 'status <> ''recebido''');
  IF novo = src THEN
    novo := replace(src, 'status IN (''pendente'', ''parcial'', ''atrasado'')', 'status <> ''recebido''');
  END IF;
  IF novo = src THEN RAISE EXCEPTION 'filtro de status de receber_em_aberto não encontrado'; END IF;
  EXECUTE novo;
END $patch$;
