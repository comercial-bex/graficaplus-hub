-- =====================================================================================================
-- CONTAS A PAGAR, FASE 1 — CORREÇÃO (16/11/2026): pagar e anexar só para quem VÊ o financeiro
--
-- APLICADA em 16/11/2026 pelo conector do banco, a partir DESTE arquivo (do BEGIN ao COMMIT, sem alteração).
-- RETRATO logo depois de aplicada, md5(prosrc) em pg_proc igual ao corpo abaixo:
--   pagar_conta_pagar                 fccf5d2b13904c9dac5be20f8435d0ff
--   anexar_arquivo_conta_pagar        d254a5a1dcbff46fdd8b6e9e6e874f1b
-- Ensaio no banco vivo em seguida (docs/ensaio-contas-a-pagar-fase-1.sql): ENSAIO OK, nada gravado. Com os
-- números reais, saídas realizadas R$ 15.074,89 -> 16.309,45 com a conta do ensaio paga -> 15.074,89 depois do
-- estorno; movimento na data retroativa informada; o "sem financeiro" simulado era um vendedor com as duas
-- chaves de pagamento, e foi recusado em pagar, enviar e anexar.
--
-- O QUE ESTAVA ERRADO NA 20261116160000 (aplicada em 16/11/2026, minutos antes desta)
--   O ensaio no banco vivo parou numa pré-condição e mostrou o furo: o perfil VENDEDOR tem
--   pagamentos.confirm e pagamentos.create (para registrar o recebimento do cliente na OS), mas NÃO tem
--   financeiro.read. Antes da 20261116160000 o vendedor não pagava conta a pagar: a policy permissiva de
--   contas_pagar exige admin ou can_see_financials, e as restritivas pedem a chave. As funções novas são
--   SECURITY DEFINER (passam por cima do RLS) e conferiam só a chave; a policy de envio do bucket também.
--   Resultado: pela API, um vendedor pagava ou anexava arquivo numa conta cujo id conhecesse. Medido em
--   16/11/2026: 2 vendedores ativos nessa situação; contas_pagar_historico com 0 linhas, ou seja, nenhuma
--   chamada às funções novas antes desta correção.
--
-- O QUE ESTA MIGRAÇÃO FAZ (só estreita; volta exatamente à regra que já valia)
--   pagar_conta_pagar           admin, ou (financeiro.read E pagamentos.confirm E pagamentos.create)
--   anexar_arquivo_conta_pagar  admin, ou (financeiro.read E pagamentos.create/update/confirm)
--   envio ao bucket             admin, ou (financeiro.read E pagamentos.create/update/confirm)
--   É a mesma regra do comprovante de hoje: no bucket comprovantes, a policy permissiva pede
--   can_see_financials e a restritiva pede a chave. Estornar e remover anexo (só admin) não mudam.
--   Corpos iguais aos da 20261116160000, exceto a guarda e o comentário dela. O bloco 0 confere o md5 do
--   corpo vivo antes de trocar; se alguém mudou as funções depois, recusa.
--
-- O QUE CONTINUA (anotado, não é desta correção)
--   Quem tem DOIS papéis soma as chaves: o único gestor ativo também é vendedor, então vê o financeiro
--   (gestor) e tem confirm+create (vendedor), e por isso já pagava conta pela tela antiga. Continua pagando.
--   Isso contraria a decisão de 03/10 ("gestor só vê"), mas mudar é mexer em papel, que é decisão do dono.
-- =====================================================================================================
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $guarda$
DECLARE
  v_pagar  text := (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.pagar_conta_pagar(uuid, date, uuid, text)'::regprocedure);
  v_anexar text := (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.anexar_arquivo_conta_pagar(uuid, text, text, text)'::regprocedure);
BEGIN
  IF v_pagar IS DISTINCT FROM '8ef6a7e336ac6f0be469f32027c2e80e' THEN
    RAISE EXCEPTION 'pagar_conta_pagar mudou no banco (md5 %). Releia a definição viva antes de trocar.', v_pagar;
  END IF;
  IF v_anexar IS DISTINCT FROM 'b9c50c416194a42d4e1309194bc513b5' THEN
    RAISE EXCEPTION 'anexar_arquivo_conta_pagar mudou no banco (md5 %). Releia a definição viva antes de trocar.', v_anexar;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
                  AND policyname = 'contas a pagar: quem lanca ou da baixa envia o anexo') THEN
    RAISE EXCEPTION 'a policy de envio da 20261116160000 não está no banco';
  END IF;
END $guarda$;

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
  -- A regra que já valia no botão Pagar: ver o financeiro (o RLS de contas_pagar) E dar baixa (confirm)
  -- E lançar no caixa (create). Sem o primeiro, o vendedor, que tem as duas chaves, pagaria pela API.
  IF v_uid IS NULL OR NOT (public.has_role(v_uid, 'admin'::public.app_role)
                           OR (public.can_see_financials(v_uid)
                               AND public.has_permission(v_uid, 'pagamentos.confirm')
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
  'Paga a conta numa transação: marca paga com a data informada e lança a saída no caixa nessa data, com a conta bancária de origem. Exige admin, ou financeiro.read E pagamentos.confirm E pagamentos.create. Recusa data futura e conta já paga.';

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
  'Registra um arquivo já enviado ao bucket contas-pagar-anexos. Exige admin, ou financeiro.read E pagamentos.create/update/confirm. Confere tipo e tamanho no objeto gravado.';

DROP POLICY IF EXISTS "contas a pagar: quem lanca ou da baixa envia o anexo" ON storage.objects;
CREATE POLICY "contas a pagar: quem lanca ou da baixa envia o anexo" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'contas-pagar-anexos'
              AND name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(pdf|jpg|png)$'
              AND (public.has_role((SELECT auth.uid()), 'admin'::public.app_role)
                   OR (public.can_see_financials((SELECT auth.uid()))
                       AND (public.has_permission((SELECT auth.uid()), 'pagamentos.create')
                            OR public.has_permission((SELECT auth.uid()), 'pagamentos.update')
                            OR public.has_permission((SELECT auth.uid()), 'pagamentos.confirm')))));

-- CREATE OR REPLACE mantém o EXECUTE de antes; reafirmado aqui para quem ler só este arquivo.
REVOKE ALL ON FUNCTION public.pagar_conta_pagar(uuid, date, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.anexar_arquivo_conta_pagar(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pagar_conta_pagar(uuid, date, uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.anexar_arquivo_conta_pagar(uuid, text, text, text) TO authenticated, service_role;

DO $confere$
BEGIN
  IF has_function_privilege('anon', 'public.pagar_conta_pagar(uuid, date, uuid, text)'::regprocedure, 'EXECUTE')
     OR has_function_privilege('anon', 'public.anexar_arquivo_conta_pagar(uuid, text, text, text)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'anon executa pagar ou anexar';
  END IF;
END $confere$;

COMMIT;

-- =====================================================================================================
-- DESFAZER: reaplicar os corpos e a policy da 20261116160000 (seções 4, 6 e 8 daquele arquivo). Não há
-- motivo para isso: esta correção só devolve a regra que valia antes.
-- =====================================================================================================
