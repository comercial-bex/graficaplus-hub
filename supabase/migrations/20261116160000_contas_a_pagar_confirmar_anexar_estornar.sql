-- =====================================================================================================
-- CONTAS A PAGAR, FASE 1 (16/11/2026): pagar com confirmação, anexos e estorno com histórico
-- NÃO APLICADA. Quem aplica é o dono. Depois de aplicar, rode docs/ensaio-contas-a-pagar-fase-1.sql no editor SQL:
-- ele simula admin, financeiro, gestor, alguém sem financeiro e o anon, confere os critérios de aceite e desfaz tudo.
-- Ensaiada em 16/11/2026 num Postgres 16 descartável com o esqueleto do banco vivo (definições lidas por consulta
-- somente leitura): ensaio OK, migração reaplicada sem erro, e quatro defeitos injetados de propósito (saída na data
-- do clique, financeiro estornando, estorno que não apaga a saída, reembolso que não volta) foram todos reprovados.
--
-- O QUE ESTAVA ERRADO (lido no código e no banco vivo em 16/11/2026)
--   1. "Pagar" em Financeiro > Caixa e contas a pagar gravava no clique, sem confirmar, e em DUAS escritas
--      soltas do navegador: UPDATE em contas_pagar e depois INSERT em caixa_movimentos. Se a segunda falhasse,
--      a conta ficava paga sem saída no caixa. A data era sempre a do clique.
--   2. Não havia como desfazer um pagamento nem saber quem pagou: contas_pagar não entra na trilha
--      (tg_auditar só cobre caixa_movimentos) e created_by está vazio nas 110 contas.
--   3. Fatura e comprovante da conta avulsa não tinham onde ficar. Só a parcela de compromisso tem
--      comprovante_url (um arquivo, no bucket comprovantes).
--
-- O QUE ESTA MIGRAÇÃO FAZ (só acrescenta; nenhuma policy, view ou função existente é alterada)
--   1. contas_pagar.created_by passa a ter DEFAULT auth.uid(). Nenhuma linha antiga é reescrita.
--   2. contas_pagar_historico: uma linha por fato (criada, paga, estornada, reaberta, cancelada, excluída,
--      anexo enviado, anexo removido), com quem, quando, valor, data do pagamento e motivo. Só gatilho
--      grava; ler é de quem vê o financeiro. Sem chave estrangeira de propósito: o histórico sobrevive à
--      exclusão da conta.
--   3. contas_pagar_anexos: vários arquivos por conta, tipo 'fatura' (fatura/boleto) ou 'comprovante'.
--      PDF, JPG ou PNG até 10 MB, conferidos três vezes: na tela, no bucket (limite e tipos do próprio
--      Storage) e na função que registra (lê tamanho e tipo do objeto gravado, não o que a tela diz).
--   4. Bucket PRIVADO contas-pagar-anexos, separado de comprovantes (que também atende o portal do
--      cliente e não tem limite de tamanho nem de tipo — mexer nele mudaria o portal). Policies:
--        ver/baixar   admin ou financeiro.read (can_see_financials): financeiro, gestor e admin
--        enviar       admin ou pagamentos.create/update/confirm, as chaves que já valem para comprovante
--        apagar       só admin
--      Sem policy de UPDATE: arquivo não se sobrescreve.
--   5. Funções (SECURITY DEFINER, EXECUTE só para authenticated e service_role):
--        pagar_conta_pagar(conta, data, conta_bancaria, forma)
--          admin ou (pagamentos.confirm E pagamentos.create): exatamente o que a tela e o banco cobram hoje
--          do botão Pagar. Uma transação: marca paga com a data informada e lança a saída no caixa NESSA
--          data, com a conta bancária de onde saiu (caixa_movimentos.conta_id, coluna que já existe e
--          aponta para contas_bancarias). Recusa data futura, conta já paga, cancelada ou sem valor.
--        estornar_conta_pagar(conta, motivo)
--          SÓ admin (decisão de 16/11/2026: quem paga não desfaz o próprio pagamento, e o gestor segue só
--          vendo o financeiro, como decidido em 03/10). Motivo obrigatório. Reabre a conta, apaga a saída
--          que o pagamento lançou (tg_auditar guarda a linha inteira em logs_auditoria), devolve à fila de
--          conciliação a linha de extrato que estivesse casada com ela, desliga sem apagar uma linha de
--          extrato que alguém tenha ligado à conta, e volta para 'aprovado' os reembolsos que o pagamento
--          tinha marcado como pagos (tg_reembolso_pago_com_a_conta não desfaz sozinho).
--        anexar_arquivo_conta_pagar(conta, tipo, caminho, nome)   mesmas chaves do upload
--        remover_anexo_conta_pagar(anexo, motivo)                 só admin
--
-- O QUE ESTA MIGRAÇÃO NÃO MEXE (conferido)
--   vw_fluxo_caixa, saldo_contas_bancarias, vw_saldo_conta, compromissos (baixar_parcela_compromisso,
--   quitar_parcelas_ate, gerar_parcelas_compromisso, anexar_comprovante_parcela), financiamentos, locações,
--   custos fixos e as policies de contas_pagar e caixa_movimentos. Saldo em conta vem de banco_transacoes;
--   esta migração não escreve lá, só desmarca conciliado no estorno.
--   A view do fluxo põe a conta a pagar na data do VENCIMENTO, paga ou não, e ignora o movimento de caixa
--   ligado a ela. Por isso a data do pagamento aparece em Movimentos e no histórico, mas a curva de projeção
--   continua posicionando a conta no vencimento. Mudar isso é mudar o cálculo do fluxo: fica para decisão.
--
-- ORDEM: independente das migrações de 16/11 anteriores. Precisa de caixa_movimentos.conta_id, hoje_br(),
-- has_role, has_permission e can_see_financials (o bloco 0 confere e recusa se faltar).
-- O fim da transação confere que anon não executa nada daqui e não lê as tabelas novas; se falhar, desfaz.
-- =====================================================================================================
BEGIN;
SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------------------------------
-- 0. O que esta migração pressupõe do banco vivo.
-- ---------------------------------------------------------------------------------------------------
DO $guarda$
BEGIN
  IF to_regprocedure('public.hoje_br()') IS NULL
     OR to_regprocedure('public.has_role(uuid, public.app_role)') IS NULL
     OR to_regprocedure('public.has_permission(uuid, text)') IS NULL
     OR to_regprocedure('public.can_see_financials(uuid)') IS NULL THEN
    RAISE EXCEPTION 'faltam hoje_br, has_role, has_permission ou can_see_financials';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute a
                  WHERE a.attrelid = 'public.caixa_movimentos'::regclass AND a.attname = 'conta_id' AND NOT a.attisdropped) THEN
    RAISE EXCEPTION 'caixa_movimentos.conta_id não existe: a conta bancária do pagamento não tem onde ficar';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute a
                  WHERE a.attrelid = 'public.banco_transacoes'::regclass AND a.attname = 'caixa_movimento_id' AND NOT a.attisdropped) THEN
    RAISE EXCEPTION 'banco_transacoes.caixa_movimento_id não existe';
  END IF;
END $guarda$;

-- ---------------------------------------------------------------------------------------------------
-- 1. Quem criou: dali para frente, sempre preenchido.
-- ---------------------------------------------------------------------------------------------------
ALTER TABLE public.contas_pagar ALTER COLUMN created_by SET DEFAULT auth.uid();

-- ---------------------------------------------------------------------------------------------------
-- 2. Histórico.
-- ---------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.contas_pagar_historico (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conta_pagar_id uuid NOT NULL,
  evento         text NOT NULL CHECK (evento IN ('criada', 'paga', 'estornada', 'reaberta', 'cancelada',
                                                 'excluida', 'anexo_enviado', 'anexo_removido')),
  usuario_id     uuid,
  usuario_nome   text,
  ocorrido_em    timestamptz NOT NULL DEFAULT now(),
  valor          numeric,
  data_pagamento date,
  motivo         text,
  detalhes       jsonb NOT NULL DEFAULT '{}'::jsonb
);
COMMENT ON TABLE public.contas_pagar_historico IS
  'Quem criou, pagou, estornou, anexou e removeu, e quando. Só os gatilhos de contas_pagar e contas_pagar_anexos gravam. Sem chave estrangeira: sobrevive à exclusão da conta.';
CREATE INDEX IF NOT EXISTS contas_pagar_historico_conta_idx
  ON public.contas_pagar_historico (conta_pagar_id, ocorrido_em DESC);

ALTER TABLE public.contas_pagar_historico ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.contas_pagar_historico FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.contas_pagar_historico TO authenticated;
GRANT ALL ON TABLE public.contas_pagar_historico TO service_role;
DROP POLICY IF EXISTS "historico: quem ve o financeiro le" ON public.contas_pagar_historico;
CREATE POLICY "historico: quem ve o financeiro le" ON public.contas_pagar_historico
  FOR SELECT TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role)
         OR public.can_see_financials((SELECT auth.uid())));

-- ---------------------------------------------------------------------------------------------------
-- 3. Anexos.
-- ---------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.contas_pagar_anexos (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conta_pagar_id   uuid NOT NULL REFERENCES public.contas_pagar(id) ON DELETE CASCADE,
  tipo             text NOT NULL CHECK (tipo IN ('fatura', 'comprovante')),
  caminho          text NOT NULL UNIQUE,
  nome_arquivo     text NOT NULL CHECK (length(btrim(nome_arquivo)) BETWEEN 1 AND 200),
  mime             text NOT NULL CHECK (mime IN ('application/pdf', 'image/jpeg', 'image/png')),
  tamanho_bytes    bigint NOT NULL CHECK (tamanho_bytes > 0 AND tamanho_bytes <= 10485760),
  enviado_por      uuid,
  enviado_por_nome text,
  enviado_em       timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.contas_pagar_anexos IS
  'Fatura/boleto e comprovante de pagamento da conta a pagar. O arquivo fica no bucket privado contas-pagar-anexos; grava e apaga só por função.';
CREATE INDEX IF NOT EXISTS contas_pagar_anexos_conta_idx ON public.contas_pagar_anexos (conta_pagar_id);

ALTER TABLE public.contas_pagar_anexos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.contas_pagar_anexos FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.contas_pagar_anexos TO authenticated;
GRANT ALL ON TABLE public.contas_pagar_anexos TO service_role;
DROP POLICY IF EXISTS "anexos: quem ve o financeiro le" ON public.contas_pagar_anexos;
CREATE POLICY "anexos: quem ve o financeiro le" ON public.contas_pagar_anexos
  FOR SELECT TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role)
         OR public.can_see_financials((SELECT auth.uid())));

-- ---------------------------------------------------------------------------------------------------
-- 4. Bucket privado e as três portas dele.
-- ---------------------------------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('contas-pagar-anexos', 'contas-pagar-anexos', false, 10485760,
        ARRAY['application/pdf', 'image/jpeg', 'image/png'])
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "contas a pagar: quem ve o financeiro le o anexo" ON storage.objects;
CREATE POLICY "contas a pagar: quem ve o financeiro le o anexo" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'contas-pagar-anexos'
         AND (public.has_role((SELECT auth.uid()), 'admin'::public.app_role)
              OR public.can_see_financials((SELECT auth.uid()))));

-- <id da conta>/<id do arquivo>.<extensão>: o nome que o usuário deu ao arquivo fica só na tabela.
DROP POLICY IF EXISTS "contas a pagar: quem lanca ou da baixa envia o anexo" ON storage.objects;
CREATE POLICY "contas a pagar: quem lanca ou da baixa envia o anexo" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'contas-pagar-anexos'
              AND name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(pdf|jpg|png)$'
              AND (public.has_role((SELECT auth.uid()), 'admin'::public.app_role)
                   OR public.has_permission((SELECT auth.uid()), 'pagamentos.create')
                   OR public.has_permission((SELECT auth.uid()), 'pagamentos.update')
                   OR public.has_permission((SELECT auth.uid()), 'pagamentos.confirm')));

DROP POLICY IF EXISTS "contas a pagar: so o admin apaga o anexo" ON storage.objects;
CREATE POLICY "contas a pagar: so o admin apaga o anexo" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'contas-pagar-anexos'
         AND public.has_role((SELECT auth.uid()), 'admin'::public.app_role));

-- ---------------------------------------------------------------------------------------------------
-- 5. Os gatilhos que escrevem o histórico.
--
-- As funções de pagar, estornar e remover passam o que só elas sabem (motivo, movimento lançado ou
-- removido, conta bancária) pela configuração local bex.conta_pagar_contexto, marcada com o id da conta.
-- Vale só até o fim da transação. Qualquer outro caminho que mude a situação (baixa de parcela de
-- compromisso, quitar em lote, UPDATE direto) também vira linha, sem esse detalhe.
-- ---------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._contexto_conta_pagar(p_conta_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_txt text := nullif(current_setting('bex.conta_pagar_contexto', true), '');
  v_ctx jsonb;
BEGIN
  IF v_txt IS NULL THEN RETURN NULL; END IF;
  v_ctx := v_txt::jsonb;
  IF v_ctx->>'conta_id' IS DISTINCT FROM p_conta_id::text THEN RETURN NULL; END IF;
  RETURN v_ctx - 'conta_id';
EXCEPTION WHEN others THEN
  RETURN NULL;
END
$function$;

CREATE OR REPLACE FUNCTION public.tg_contas_pagar_historico()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid    uuid := auth.uid();
  v_nome   text;
  v_ctx    jsonb;
  v_evento text;
BEGIN
  SELECT u.nome INTO v_nome FROM public.usuarios u WHERE u.id = v_uid;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.contas_pagar_historico (conta_pagar_id, evento, usuario_id, usuario_nome, valor, detalhes)
    VALUES (NEW.id, 'criada', v_uid, v_nome, NEW.valor,
            jsonb_strip_nulls(jsonb_build_object('descricao', NEW.descricao, 'fornecedor', NEW.fornecedor,
                                                 'vencimento', NEW.vencimento, 'compromisso_id', NEW.compromisso_id)));
    RETURN NULL;
  END IF;

  IF TG_OP = 'DELETE' THEN
    INSERT INTO public.contas_pagar_historico (conta_pagar_id, evento, usuario_id, usuario_nome, valor, data_pagamento, detalhes)
    VALUES (OLD.id, 'excluida', v_uid, v_nome, OLD.valor, OLD.data_pagamento,
            jsonb_strip_nulls(jsonb_build_object('descricao', OLD.descricao, 'status', OLD.status,
                                                 'vencimento', OLD.vencimento)));
    RETURN NULL;
  END IF;

  -- UPDATE: só mudança de situação vira linha (aberta <-> atrasada não conta).
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NULL; END IF;
  v_ctx := public._contexto_conta_pagar(NEW.id);
  v_evento := CASE
    WHEN NEW.status = 'paga' THEN 'paga'
    WHEN OLD.status = 'paga' AND v_ctx ? 'motivo' THEN 'estornada'
    WHEN OLD.status = 'paga' THEN 'reaberta'
    WHEN NEW.status = 'cancelada' THEN 'cancelada'
  END;
  IF v_evento IS NULL THEN RETURN NULL; END IF;

  INSERT INTO public.contas_pagar_historico
    (conta_pagar_id, evento, usuario_id, usuario_nome, valor, data_pagamento, motivo, detalhes)
  VALUES (NEW.id, v_evento, v_uid, v_nome, NEW.valor,
          CASE WHEN v_evento = 'paga' THEN NEW.data_pagamento ELSE OLD.data_pagamento END,
          v_ctx->>'motivo',
          jsonb_strip_nulls(coalesce(v_ctx - 'motivo', '{}'::jsonb)
                            || jsonb_build_object('status_anterior', OLD.status, 'status_novo', NEW.status)));
  RETURN NULL;
END
$function$;

DROP TRIGGER IF EXISTS tg_contas_pagar_historico ON public.contas_pagar;
CREATE TRIGGER tg_contas_pagar_historico
  AFTER INSERT OR DELETE OR UPDATE OF status ON public.contas_pagar
  FOR EACH ROW EXECUTE FUNCTION public.tg_contas_pagar_historico();

CREATE OR REPLACE FUNCTION public.tg_contas_pagar_anexos_historico()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid  uuid := auth.uid();
  v_nome text;
  v_a    public.contas_pagar_anexos%ROWTYPE;
  v_ctx  jsonb;
BEGIN
  SELECT u.nome INTO v_nome FROM public.usuarios u WHERE u.id = v_uid;
  IF TG_OP = 'INSERT' THEN v_a := NEW; ELSE v_a := OLD; END IF;
  v_ctx := public._contexto_conta_pagar(v_a.conta_pagar_id);

  INSERT INTO public.contas_pagar_historico (conta_pagar_id, evento, usuario_id, usuario_nome, motivo, detalhes)
  VALUES (v_a.conta_pagar_id,
          CASE WHEN TG_OP = 'INSERT' THEN 'anexo_enviado' ELSE 'anexo_removido' END,
          v_uid, v_nome,
          CASE WHEN TG_OP = 'DELETE' THEN v_ctx->>'motivo' END,
          jsonb_build_object('anexo_id', v_a.id, 'tipo', v_a.tipo, 'nome_arquivo', v_a.nome_arquivo,
                             'tamanho_bytes', v_a.tamanho_bytes, 'caminho', v_a.caminho));
  RETURN NULL;
END
$function$;

DROP TRIGGER IF EXISTS tg_contas_pagar_anexos_historico ON public.contas_pagar_anexos;
CREATE TRIGGER tg_contas_pagar_anexos_historico
  AFTER INSERT OR DELETE ON public.contas_pagar_anexos
  FOR EACH ROW EXECUTE FUNCTION public.tg_contas_pagar_anexos_historico();

-- ---------------------------------------------------------------------------------------------------
-- 6. Pagar: confirmação na tela, uma transação aqui.
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
  v_mov   uuid := gen_random_uuid();
  v_qtd   integer;
BEGIN
  -- As mesmas chaves que o botão Pagar cobra desde 05/10: dar baixa (confirm) e lançar no caixa (create).
  IF v_uid IS NULL OR NOT (public.has_role(v_uid, 'admin'::public.app_role)
                           OR (public.has_permission(v_uid, 'pagamentos.confirm')
                               AND public.has_permission(v_uid, 'pagamentos.create'))) THEN
    RAISE EXCEPTION 'Sem permissão para pagar: dar baixa é com o financeiro.' USING ERRCODE = '42501';
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

  IF p_conta_bancaria_id IS NOT NULL THEN
    SELECT b.nome INTO v_banco FROM public.contas_bancarias b WHERE b.id = p_conta_bancaria_id AND b.ativo;
    IF NOT FOUND THEN RAISE EXCEPTION 'Conta bancária não encontrada ou inativa.'; END IF;
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
  'Paga a conta numa transação: marca paga com a data informada e lança a saída no caixa nessa data, com a conta bancária de origem. Exige admin ou pagamentos.confirm e pagamentos.create. Recusa data futura e conta já paga.';

-- ---------------------------------------------------------------------------------------------------
-- 7. Estornar: só admin, com motivo, desfazendo tudo o que o pagamento fez.
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
    RAISE EXCEPTION 'Só o administrador estorna pagamento de conta a pagar.' USING ERRCODE = '42501';
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
  'Só admin. Reabre a conta paga, apaga a saída que o pagamento lançou, devolve à conciliação o extrato casado com ela e volta reembolsos a aprovado. Motivo obrigatório, gravado em contas_pagar_historico.';

-- ---------------------------------------------------------------------------------------------------
-- 8. Anexar: o arquivo já subiu para o bucket; aqui ele ganha linha, tipo e dono.
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
  IF v_uid IS NULL OR NOT (public.has_role(v_uid, 'admin'::public.app_role)
                           OR public.has_permission(v_uid, 'pagamentos.create')
                           OR public.has_permission(v_uid, 'pagamentos.update')
                           OR public.has_permission(v_uid, 'pagamentos.confirm')) THEN
    RAISE EXCEPTION 'Sem permissão para anexar arquivo à conta a pagar.' USING ERRCODE = '42501';
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
  'Registra um arquivo já enviado ao bucket contas-pagar-anexos. Exige admin ou pagamentos.create/update/confirm. Confere tipo e tamanho no objeto gravado.';

-- ---------------------------------------------------------------------------------------------------
-- 9. Remover: só admin. A linha sai aqui; o arquivo, a tela apaga pela API do Storage (o Supabase
--    recusa DELETE direto em storage.objects), com a policy de DELETE só para admin.
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
    RAISE EXCEPTION 'Só o administrador remove anexo de conta a pagar.' USING ERRCODE = '42501';
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
  'Só admin. Apaga a linha do anexo e devolve o caminho para a tela apagar o arquivo pela API do Storage.';

-- ---------------------------------------------------------------------------------------------------
-- 10. EXECUTE: função nasce aberta a PUBLIC, e no Supabase anon e authenticated têm grant próprio.
-- ---------------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public._contexto_conta_pagar(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_contas_pagar_historico() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_contas_pagar_anexos_historico() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pagar_conta_pagar(uuid, date, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.estornar_conta_pagar(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.anexar_arquivo_conta_pagar(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.remover_anexo_conta_pagar(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pagar_conta_pagar(uuid, date, uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.estornar_conta_pagar(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.anexar_arquivo_conta_pagar(uuid, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.remover_anexo_conta_pagar(uuid, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------
-- 11. Conferência antes do COMMIT: o REVOKE não reclama quando não surte efeito.
-- ---------------------------------------------------------------------------------------------------
DO $confere$
DECLARE
  v_fn text;
  v_tab text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public._contexto_conta_pagar(uuid)',
    'public.tg_contas_pagar_historico()',
    'public.tg_contas_pagar_anexos_historico()',
    'public.pagar_conta_pagar(uuid, date, uuid, text)',
    'public.estornar_conta_pagar(uuid, text)',
    'public.anexar_arquivo_conta_pagar(uuid, text, text, text)',
    'public.remover_anexo_conta_pagar(uuid, text)'
  ] LOOP
    IF has_function_privilege('anon', v_fn::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION 'anon ainda executa %', v_fn;
    END IF;
  END LOOP;
  FOREACH v_fn IN ARRAY ARRAY[
    'public._contexto_conta_pagar(uuid)',
    'public.tg_contas_pagar_historico()',
    'public.tg_contas_pagar_anexos_historico()'
  ] LOOP
    IF has_function_privilege('authenticated', v_fn::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION 'authenticated executa a função interna %', v_fn;
    END IF;
  END LOOP;
  FOREACH v_tab IN ARRAY ARRAY['public.contas_pagar_historico', 'public.contas_pagar_anexos'] LOOP
    IF has_table_privilege('anon', v_tab, 'SELECT') OR has_table_privilege('anon', v_tab, 'INSERT')
       OR has_table_privilege('authenticated', v_tab, 'INSERT')
       OR has_table_privilege('authenticated', v_tab, 'UPDATE')
       OR has_table_privilege('authenticated', v_tab, 'DELETE') THEN
      RAISE EXCEPTION 'privilégio de escrita ou de anon sobrou em %', v_tab;
    END IF;
    IF NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = v_tab::regclass) THEN
      RAISE EXCEPTION 'RLS desligado em %', v_tab;
    END IF;
  END LOOP;
  IF (SELECT b.public FROM storage.buckets b WHERE b.id = 'contas-pagar-anexos') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'o bucket contas-pagar-anexos não está privado';
  END IF;
END $confere$;

COMMIT;

-- =====================================================================================================
-- DESFAZER (não roda; copie e rode inteiro se precisar voltar atrás). Antes, baixe os anexos que quiser
-- guardar: o Supabase não deixa apagar bucket com arquivo dentro, esvazie pela API do Storage.
--
-- BEGIN;
-- DROP FUNCTION IF EXISTS public.remover_anexo_conta_pagar(uuid, text);
-- DROP FUNCTION IF EXISTS public.anexar_arquivo_conta_pagar(uuid, text, text, text);
-- DROP FUNCTION IF EXISTS public.estornar_conta_pagar(uuid, text);
-- DROP FUNCTION IF EXISTS public.pagar_conta_pagar(uuid, date, uuid, text);
-- DROP TRIGGER IF EXISTS tg_contas_pagar_anexos_historico ON public.contas_pagar_anexos;
-- DROP TRIGGER IF EXISTS tg_contas_pagar_historico ON public.contas_pagar;
-- DROP FUNCTION IF EXISTS public.tg_contas_pagar_anexos_historico();
-- DROP FUNCTION IF EXISTS public.tg_contas_pagar_historico();
-- DROP FUNCTION IF EXISTS public._contexto_conta_pagar(uuid);
-- DROP POLICY IF EXISTS "contas a pagar: quem ve o financeiro le o anexo" ON storage.objects;
-- DROP POLICY IF EXISTS "contas a pagar: quem lanca ou da baixa envia o anexo" ON storage.objects;
-- DROP POLICY IF EXISTS "contas a pagar: so o admin apaga o anexo" ON storage.objects;
-- DROP TABLE IF EXISTS public.contas_pagar_anexos;
-- DROP TABLE IF EXISTS public.contas_pagar_historico;
-- DELETE FROM storage.buckets WHERE id = 'contas-pagar-anexos';
-- ALTER TABLE public.contas_pagar ALTER COLUMN created_by DROP DEFAULT;
-- COMMIT;
-- =====================================================================================================
