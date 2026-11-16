-- =====================================================================================================
-- CONTAS DE CONSUMO: UNIDADE CONSUMIDORA E FATURA MENSAL (16/11/2026)
--
-- APLICADA em 16/11/2026 pelo conector do banco, a partir DESTE arquivo (do BEGIN ao COMMIT, sem alteração).
-- RETRATO logo depois de aplicada, md5(prosrc) em pg_proc igual ao corpo abaixo; anon não executa nenhuma:
--   lancar_fatura_consumo          83d85fc8203759c8d72a35d0f7341604
--   corrigir_dados_fatura_consumo  24c303e72e340e0b4c07574cd4ce8636
-- Ensaio no banco vivo antes de aplicar (docs/ensaio-contas-de-consumo.sql, com esta migração dentro da mesma
-- transação, desfeita): 26 de 26 OK. Impressão digital antes e depois de aplicar, igual em contas a pagar
-- (111, R$ 193.262,31), caixa (94, R$ 37.567,14), anexos (2), histórico (5), extrato (91), compromissos (3),
-- reembolsos (0), funções de pagar/estornar/baixa/quitar/saldo e as 18 policies dessas tabelas. Única mudança
-- fora das tabelas novas: o fornecedor CEA (4 -> 5 fornecedores).
--
-- O QUE EXISTIA
--   Conta de energia, água, internet, telefone ou gás era uma conta a pagar solta, sem dizer de qual
--   unidade nem de qual mês. A única lançada até hoje: "Energia CEA — UC 228.739.007-85 — competência
--   09/2026" (R$ 731,46, vencimento 07/10/2026, paga em 16/11/2026 pelo Itaú, com fatura e comprovante).
--   Compromissos ficam de fora: são contratos de valor fixo (decisão do dono, 16/11/2026).
--
-- O QUE ESTA MIGRAÇÃO FAZ (só acrescenta; nenhuma tabela, função, policy ou gatilho que já existe muda)
--   1. unidades_consumo: tipo, fornecedor (o cadastro de fornecedores que já existe), número da unidade ou
--      contrato, endereço, dia habitual de vencimento, conta bancária de onde costuma sair, observações.
--      Lê quem vê o financeiro. Cria e edita SÓ admin e gestor, pelo papel, conferido no banco (RLS).
--      Ninguém apaga: unidade que acabou é desativada. A mesma unidade não entra duas vezes no mesmo
--      fornecedor, nem escrita com pontuação diferente.
--   2. faturas_consumo: o que a fatura tem além da conta a pagar (competência, consumo, bandeira/taxas,
--      iluminação pública, nota fiscal), uma linha por conta, e UMA fatura por unidade e competência
--      (UNIQUE). A conta a pagar continua a mesma de sempre: valor, vencimento, pagar, estornar, anexos,
--      histórico e Conferência valem igual. Apagar uma conta em aberto apaga junto a linha da fatura.
--      Lê quem vê o financeiro; grava só por função.
--   3. lancar_fatura_consumo: cria a conta a pagar e a fatura numa transação, com a descrição no padrão
--      que já existe. Mesma permissão do "Nova conta a pagar" de hoje (admin, ou ver o financeiro E
--      pagamentos.create). Fatura repetida da mesma unidade e competência é recusada com a fatura que já
--      existe na mensagem. Competência de mês que ainda não começou é recusada.
--   4. corrigir_dados_fatura_consumo: muda só consumo, bandeira/taxas, iluminação pública e nota fiscal.
--      Valor e vencimento continuam na conta a pagar. Recusa vira tentativa negada no histórico da conta.
--   5. Dados: fornecedor CEA, a unidade 228.739.007-85 e o vínculo da conta de 09/2026. Só INSERT nas
--      tabelas novas e em fornecedores; a conta a pagar, os anexos e o caixa não são tocados. Consumo,
--      bandeira, iluminação pública, nota fiscal e endereço ficam vazios (estão no PDF; sem leitura
--      automática nesta fase).
-- =====================================================================================================
BEGIN;
SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------------------------------
-- 0. O que esta migração pressupõe do banco vivo (conferido em 16/11/2026).
-- ---------------------------------------------------------------------------------------------------
DO $guarda$
BEGIN
  IF to_regclass('public.unidades_consumo') IS NOT NULL OR to_regclass('public.faturas_consumo') IS NOT NULL THEN
    RAISE EXCEPTION 'unidades_consumo ou faturas_consumo já existem no banco';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.contas_pagar
     WHERE id = '0e5a297c-e0db-4b0c-ae11-076377930d39'
       AND descricao = 'Energia CEA — UC 228.739.007-85 — competência 09/2026'
       AND categoria = 'energia' AND valor = 731.46 AND status = 'paga'
       AND vencimento = '2026-10-07' AND data_pagamento = '2026-11-16') THEN
    RAISE EXCEPTION 'a conta de energia de 09/2026 não está como foi conferida em 16/11/2026';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.contas_bancarias
                  WHERE id = 'd91b5d74-e754-48aa-8444-2f30ceb86eb2' AND ativo) THEN
    RAISE EXCEPTION 'a conta bancária do Itaú não está ativa';
  END IF;
  IF to_regprocedure('public._negar_conta_pagar(uuid, text, text)') IS NULL THEN
    RAISE EXCEPTION '_negar_conta_pagar não existe: aplique 20261116210000 antes';
  END IF;
  IF to_regprocedure('public.tg_fornecedor_criado_por()') IS NULL OR to_regprocedure('public.tg_set_updated_at()') IS NULL THEN
    RAISE EXCEPTION 'tg_fornecedor_criado_por ou tg_set_updated_at não existe';
  END IF;
END $guarda$;

-- ---------------------------------------------------------------------------------------------------
-- 1. Unidade consumidora.
-- ---------------------------------------------------------------------------------------------------
CREATE TABLE public.unidades_consumo (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo              text NOT NULL CHECK (tipo IN ('energia', 'agua', 'internet', 'telefone', 'gas', 'outro')),
  fornecedor_id     uuid NOT NULL REFERENCES public.fornecedores(id) ON DELETE RESTRICT,
  identificador     text NOT NULL CHECK (length(btrim(identificador)) BETWEEN 1 AND 60),
  endereco          text CHECK (endereco IS NULL OR length(endereco) <= 300),
  dia_vencimento    smallint CHECK (dia_vencimento BETWEEN 1 AND 31),
  conta_bancaria_id uuid REFERENCES public.contas_bancarias(id) ON DELETE SET NULL,
  observacoes       text CHECK (observacoes IS NULL OR length(observacoes) <= 1000),
  ativo             boolean NOT NULL DEFAULT true,
  criado_por        uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.unidades_consumo IS
  'Unidade consumidora (energia, água, internet, telefone, gás): de quem, qual número, quando vence e de onde costuma sair. Cria e edita só admin e gestor (RLS). A fatura de cada mês é uma conta a pagar ligada por faturas_consumo.';
-- A mesma unidade não entra duas vezes no fornecedor, nem com pontuação diferente ("228.739.007-85" e "22873900785").
CREATE UNIQUE INDEX unidades_consumo_fornecedor_identificador_key
  ON public.unidades_consumo (fornecedor_id, lower(regexp_replace(identificador, '[^0-9A-Za-z]', '', 'g')));

CREATE TRIGGER tg_unidades_consumo_criado_por BEFORE INSERT ON public.unidades_consumo
  FOR EACH ROW EXECUTE FUNCTION public.tg_fornecedor_criado_por();
CREATE TRIGGER tg_unidades_consumo_updated BEFORE UPDATE ON public.unidades_consumo
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE public.unidades_consumo ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.unidades_consumo FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.unidades_consumo TO authenticated;
GRANT ALL ON TABLE public.unidades_consumo TO service_role;

CREATE POLICY "unidades de consumo: quem ve o financeiro le" ON public.unidades_consumo
  FOR SELECT TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role)
         OR public.can_see_financials((SELECT auth.uid())));
CREATE POLICY "unidades de consumo: so admin e gestor cadastram" ON public.unidades_consumo
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role((SELECT auth.uid()), 'admin'::public.app_role)
              OR public.has_role((SELECT auth.uid()), 'gestor'::public.app_role));
CREATE POLICY "unidades de consumo: so admin e gestor editam" ON public.unidades_consumo
  FOR UPDATE TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role)
         OR public.has_role((SELECT auth.uid()), 'gestor'::public.app_role))
  WITH CHECK (public.has_role((SELECT auth.uid()), 'admin'::public.app_role)
              OR public.has_role((SELECT auth.uid()), 'gestor'::public.app_role));

-- ---------------------------------------------------------------------------------------------------
-- 2. Fatura do mês: o que ela tem além da conta a pagar.
-- ---------------------------------------------------------------------------------------------------
CREATE TABLE public.faturas_consumo (
  conta_pagar_id     uuid PRIMARY KEY REFERENCES public.contas_pagar(id) ON DELETE CASCADE,
  unidade_id         uuid NOT NULL REFERENCES public.unidades_consumo(id) ON DELETE RESTRICT,
  competencia        date NOT NULL CHECK (competencia = date_trunc('month', competencia)::date),
  consumo            numeric(14,3) CHECK (consumo IS NULL OR consumo >= 0),
  bandeira_taxas     numeric(12,2) CHECK (bandeira_taxas IS NULL OR bandeira_taxas >= 0),
  iluminacao_publica numeric(12,2) CHECK (iluminacao_publica IS NULL OR iluminacao_publica >= 0),
  numero_nf          text CHECK (numero_nf IS NULL OR length(numero_nf) BETWEEN 1 AND 60),
  lancada_por        uuid,
  lancada_em         timestamptz NOT NULL DEFAULT now(),
  corrigida_por      uuid,
  corrigida_em       timestamptz,
  CONSTRAINT faturas_consumo_unidade_competencia_key UNIQUE (unidade_id, competencia)
);
COMMENT ON TABLE public.faturas_consumo IS
  'Fatura de consumo: competência, consumo (kWh na energia, m³ na água e no gás), bandeira/taxas, iluminação pública e nota fiscal da conta a pagar ligada. Uma por unidade e competência. Grava só por lancar_fatura_consumo e corrigir_dados_fatura_consumo.';

ALTER TABLE public.faturas_consumo ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.faturas_consumo FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.faturas_consumo TO authenticated;
GRANT ALL ON TABLE public.faturas_consumo TO service_role;

CREATE POLICY "faturas de consumo: quem ve o financeiro le" ON public.faturas_consumo
  FOR SELECT TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role)
         OR public.can_see_financials((SELECT auth.uid())));

-- ---------------------------------------------------------------------------------------------------
-- 3. Lançar a fatura: conta a pagar + fatura, numa transação.
-- ---------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lancar_fatura_consumo(
  p_unidade_id uuid,
  p_competencia date,
  p_vencimento date,
  p_valor numeric,
  p_consumo numeric DEFAULT NULL,
  p_bandeira_taxas numeric DEFAULT NULL,
  p_iluminacao_publica numeric DEFAULT NULL,
  p_numero_nf text DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid    uuid := auth.uid();
  v_comp   date := date_trunc('month', p_competencia)::date;
  v_u      public.unidades_consumo%ROWTYPE;
  v_f      public.fornecedores%ROWTYPE;
  v_ja     record;
  v_conta  uuid;
  v_desc   text;
BEGIN
  -- A mesma porta do "Nova conta a pagar": ver o financeiro (RLS de contas_pagar) E pagamentos.create.
  IF v_uid IS NULL OR NOT (public.has_role(v_uid, 'admin'::public.app_role)
                           OR (public.can_see_financials(v_uid)
                               AND public.has_permission(v_uid, 'pagamentos.create'))) THEN
    RAISE EXCEPTION 'Sem permissão para lançar fatura: lançar conta a pagar é com o financeiro.' USING ERRCODE = '42501';
  END IF;
  IF p_competencia IS NULL THEN RAISE EXCEPTION 'Informe a competência (mês e ano da fatura).'; END IF;
  IF v_comp > date_trunc('month', public.hoje_br())::date THEN
    RAISE EXCEPTION 'A competência % ainda não começou.', to_char(v_comp, 'MM/YYYY');
  END IF;
  IF p_vencimento IS NULL THEN RAISE EXCEPTION 'Informe o vencimento.'; END IF;
  IF p_valor IS NULL OR p_valor <= 0 THEN RAISE EXCEPTION 'Informe o valor da fatura.'; END IF;
  IF coalesce(p_consumo, 0) < 0 OR coalesce(p_bandeira_taxas, 0) < 0 OR coalesce(p_iluminacao_publica, 0) < 0 THEN
    RAISE EXCEPTION 'Consumo, bandeira/taxas e iluminação pública não podem ser negativos.';
  END IF;

  SELECT * INTO v_u FROM public.unidades_consumo WHERE id = p_unidade_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unidade consumidora não encontrada.'; END IF;
  IF NOT v_u.ativo THEN RAISE EXCEPTION 'Esta unidade está desativada.'; END IF;
  SELECT * INTO v_f FROM public.fornecedores WHERE id = v_u.fornecedor_id;

  -- Duplicidade: a fatura que já existe vai na mensagem.
  SELECT c.valor, c.vencimento, c.status, c.data_pagamento INTO v_ja
    FROM public.faturas_consumo fc JOIN public.contas_pagar c ON c.id = fc.conta_pagar_id
   WHERE fc.unidade_id = p_unidade_id AND fc.competencia = v_comp;
  IF FOUND THEN
    RAISE EXCEPTION 'Já existe a fatura de % desta unidade: R$ %, vencimento %, %.',
      to_char(v_comp, 'MM/YYYY'),
      translate(to_char(v_ja.valor, 'FM999,999,990.00'), ',.', '.,'),
      to_char(v_ja.vencimento, 'DD/MM/YYYY'),
      CASE WHEN v_ja.status = 'paga'
           THEN 'paga em ' || coalesce(to_char(v_ja.data_pagamento, 'DD/MM/YYYY'), 'data não informada')
           ELSE 'em aberto' END
      USING ERRCODE = '23505';
  END IF;

  v_desc := format('%s %s — %s %s — competência %s',
    CASE v_u.tipo WHEN 'energia' THEN 'Energia' WHEN 'agua' THEN 'Água' WHEN 'internet' THEN 'Internet'
                  WHEN 'telefone' THEN 'Telefone' WHEN 'gas' THEN 'Gás' ELSE 'Conta' END,
    v_f.nome,
    CASE WHEN v_u.tipo IN ('energia', 'agua', 'gas') THEN 'UC' ELSE 'contrato' END,
    v_u.identificador,
    to_char(v_comp, 'MM/YYYY'));

  INSERT INTO public.contas_pagar (descricao, fornecedor, categoria, valor, vencimento, created_by)
  VALUES (v_desc, coalesce(nullif(btrim(v_f.razao_social), ''), v_f.nome),
          CASE WHEN v_u.tipo = 'outro' THEN 'geral' ELSE v_u.tipo END,
          round(p_valor, 2), p_vencimento, v_uid)
  RETURNING id INTO v_conta;

  INSERT INTO public.faturas_consumo
    (conta_pagar_id, unidade_id, competencia, consumo, bandeira_taxas, iluminacao_publica, numero_nf, lancada_por)
  VALUES (v_conta, p_unidade_id, v_comp, p_consumo, p_bandeira_taxas, p_iluminacao_publica,
          nullif(btrim(coalesce(p_numero_nf, '')), ''), v_uid);

  RETURN jsonb_build_object('conta_id', v_conta, 'descricao', v_desc, 'competencia', v_comp,
                            'valor', round(p_valor, 2), 'vencimento', p_vencimento);
END
$function$;

COMMENT ON FUNCTION public.lancar_fatura_consumo(uuid, date, date, numeric, numeric, numeric, numeric, text) IS
  'Cria a conta a pagar da fatura de consumo e a liga à unidade e à competência, numa transação. Exige admin, ou financeiro.read E pagamentos.create. Recusa fatura repetida (mesma unidade e competência) dizendo qual já existe, e competência que ainda não começou.';

-- ---------------------------------------------------------------------------------------------------
-- 4. Corrigir os dados da fatura (não o valor nem o vencimento, que são da conta a pagar).
-- ---------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.corrigir_dados_fatura_consumo(
  p_conta_pagar_id uuid,
  p_consumo numeric,
  p_bandeira_taxas numeric,
  p_iluminacao_publica numeric,
  p_numero_nf text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_qtd integer;
BEGIN
  IF v_uid IS NULL OR NOT (public.has_role(v_uid, 'admin'::public.app_role)
                           OR (public.can_see_financials(v_uid)
                               AND (public.has_permission(v_uid, 'pagamentos.create')
                                    OR public.has_permission(v_uid, 'pagamentos.update')))) THEN
    RETURN public._negar_conta_pagar(p_conta_pagar_id, 'corrigir dados da fatura de consumo',
                                     'Sem permissão para corrigir os dados da fatura.');
  END IF;
  IF coalesce(p_consumo, 0) < 0 OR coalesce(p_bandeira_taxas, 0) < 0 OR coalesce(p_iluminacao_publica, 0) < 0 THEN
    RAISE EXCEPTION 'Consumo, bandeira/taxas e iluminação pública não podem ser negativos.';
  END IF;

  UPDATE public.faturas_consumo
     SET consumo = p_consumo,
         bandeira_taxas = p_bandeira_taxas,
         iluminacao_publica = p_iluminacao_publica,
         numero_nf = nullif(btrim(coalesce(p_numero_nf, '')), ''),
         corrigida_por = v_uid,
         corrigida_em = now()
   WHERE conta_pagar_id = p_conta_pagar_id;
  GET DIAGNOSTICS v_qtd = ROW_COUNT;
  IF v_qtd <> 1 THEN RAISE EXCEPTION 'Esta conta não é uma fatura de consumo.'; END IF;

  RETURN jsonb_build_object('conta_id', p_conta_pagar_id, 'corrigida', true);
END
$function$;

COMMENT ON FUNCTION public.corrigir_dados_fatura_consumo(uuid, numeric, numeric, numeric, text) IS
  'Muda consumo, bandeira/taxas, iluminação pública e nota fiscal da fatura de consumo. Exige admin, ou financeiro.read E (pagamentos.create ou .update); sem isso devolve negado e registra a tentativa no histórico da conta.';

-- ---------------------------------------------------------------------------------------------------
-- 5. Dados: CEA, a unidade 228.739.007-85 e a conta de 09/2026 ligada a ela. Só INSERT em tabela nova e
--    em fornecedores; a conta a pagar, os anexos e o caixa não são tocados.
-- ---------------------------------------------------------------------------------------------------
DO $dados$
DECLARE
  v_forn    uuid;
  v_unidade uuid;
BEGIN
  SELECT id INTO v_forn FROM public.fornecedores
   WHERE razao_social ILIKE '%ELETRICIDADE DO AMAPA%' OR nome IN ('CEA', 'CEA Equatorial')
   ORDER BY created_at LIMIT 1;
  IF v_forn IS NULL THEN
    INSERT INTO public.fornecedores (nome, razao_social, categorias, observacoes)
    VALUES ('CEA', 'COMPANHIA DE ELETRICIDADE DO AMAPA CEA', ARRAY['servicos'],
            'Energia elétrica. Cadastrada em 16/11/2026 junto com a unidade consumidora 228.739.007-85.')
    RETURNING id INTO v_forn;
  END IF;

  INSERT INTO public.unidades_consumo
    (tipo, fornecedor_id, identificador, dia_vencimento, conta_bancaria_id, observacoes)
  VALUES ('energia', v_forn, '228.739.007-85', 7, 'd91b5d74-e754-48aa-8444-2f30ceb86eb2',
          'Criada em 16/11/2026 a partir da conta de 09/2026. Endereço e os dados da fatura de 09/2026 (kWh, bandeira, iluminação pública, nota fiscal) estão no PDF e ficam para preencher.')
  RETURNING id INTO v_unidade;

  INSERT INTO public.faturas_consumo (conta_pagar_id, unidade_id, competencia, lancada_em)
  SELECT c.id, v_unidade, DATE '2026-09-01', c.created_at
    FROM public.contas_pagar c WHERE c.id = '0e5a297c-e0db-4b0c-ae11-076377930d39';
END $dados$;

-- ---------------------------------------------------------------------------------------------------
-- 6. EXECUTE: função nasce aberta a PUBLIC, e no Supabase anon e authenticated têm grant próprio.
-- ---------------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.lancar_fatura_consumo(uuid, date, date, numeric, numeric, numeric, numeric, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.corrigir_dados_fatura_consumo(uuid, numeric, numeric, numeric, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lancar_fatura_consumo(uuid, date, date, numeric, numeric, numeric, numeric, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.corrigir_dados_fatura_consumo(uuid, numeric, numeric, numeric, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------
-- 7. Conferência antes do COMMIT.
-- ---------------------------------------------------------------------------------------------------
DO $confere$
BEGIN
  IF has_function_privilege('anon', 'public.lancar_fatura_consumo(uuid, date, date, numeric, numeric, numeric, numeric, text)'::regprocedure, 'EXECUTE')
     OR has_function_privilege('anon', 'public.corrigir_dados_fatura_consumo(uuid, numeric, numeric, numeric, text)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'anon executa função de contas de consumo';
  END IF;
  IF has_table_privilege('anon', 'public.unidades_consumo', 'SELECT') OR has_table_privilege('anon', 'public.faturas_consumo', 'SELECT')
     OR has_table_privilege('authenticated', 'public.faturas_consumo', 'INSERT')
     OR has_table_privilege('authenticated', 'public.faturas_consumo', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.unidades_consumo', 'DELETE') THEN
    RAISE EXCEPTION 'grant de tabela aberto demais';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.unidades_consumo'::regclass)
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.faturas_consumo'::regclass) THEN
    RAISE EXCEPTION 'RLS desligado';
  END IF;
  IF (SELECT count(*) FROM public.faturas_consumo fc JOIN public.unidades_consumo u ON u.id = fc.unidade_id
       WHERE fc.conta_pagar_id = '0e5a297c-e0db-4b0c-ae11-076377930d39'
         AND fc.competencia = '2026-09-01' AND u.identificador = '228.739.007-85') <> 1 THEN
    RAISE EXCEPTION 'a conta de 09/2026 não ficou ligada à unidade';
  END IF;
  -- A conta continua exatamente como estava.
  IF NOT EXISTS (
    SELECT 1 FROM public.contas_pagar
     WHERE id = '0e5a297c-e0db-4b0c-ae11-076377930d39' AND valor = 731.46 AND status = 'paga'
       AND vencimento = '2026-10-07' AND data_pagamento = '2026-11-16') THEN
    RAISE EXCEPTION 'a conta de 09/2026 mudou';
  END IF;
END $confere$;

COMMIT;

-- =====================================================================================================
-- DESFAZER (não roda): DROP FUNCTION public.corrigir_dados_fatura_consumo(uuid, numeric, numeric, numeric, text);
-- DROP FUNCTION public.lancar_fatura_consumo(uuid, date, date, numeric, numeric, numeric, numeric, text);
-- DROP TABLE public.faturas_consumo; DROP TABLE public.unidades_consumo; e, se ninguém mais usar, apagar o
-- fornecedor CEA criado aqui. As contas a pagar lançadas por lancar_fatura_consumo continuam (são contas
-- comuns); só perdem a ligação com a unidade.
-- =====================================================================================================
