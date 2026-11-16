-- =====================================================================================================
-- SALDO EM CONTA SUBTRAI OS DÉBITOS (16/11/2026)
--
-- APLICADA em 16/11/2026 pelo conector do banco, a partir DESTE arquivo (do BEGIN ao COMMIT, sem alteração).
-- RETRATO logo depois de aplicada: md5(prosrc) de saldo_contas_bancarias() = 253bc1b099da373e3c4873c136daec27;
-- EXECUTE só para postgres, authenticated e service_role (anon não). Conta à mão no banco vivo em seguida:
-- 225,00 + 30.836,22 (créditos) - 3.052,16 (débitos) = R$ 28.009,06, último lançamento em 29/10/2026.
-- Ensaio antes, numa transação desfeita: card = conta à mão = 28.009,06; quem não vê o financeiro, 0 linhas.
--
-- O QUE ESTAVA ERRADO
--   O card "Saldo em conta" do Fluxo de caixa e o do Funil leem saldo_contas_bancarias(). A função soma
--   banco_transacoes.valor, mas importar_extrato grava o valor SEMPRE positivo e diz se entrou ou saiu
--   pelo tipo ('credito' ou 'debito'). Resultado: todo débito do extrato era SOMADO ao saldo.
--   Medido no banco vivo em 16/11/2026: card R$ 34.113,38; saldo inicial + créditos - débitos
--   R$ 28.009,06. A diferença, R$ 6.104,32, é exatamente o dobro dos 16 débitos (R$ 3.052,16).
--   vw_saldo_conta já fazia a conta certa (crédito soma, débito subtrai); só a função errava.
--
-- O QUE ESTA MIGRAÇÃO FAZ
--   Troca só a conta da função: crédito soma, débito subtrai (pelo tipo, com abs no valor, então serve
--   para linha gravada com sinal ou sem). Linha sem tipo continua como era (soma o valor com o sinal que
--   tiver). 'saidas' volta a ser negativa, como na definição de 04/09. Mesma assinatura, mesmo retorno,
--   mesmo filtro de quem vê (can_see_financials) e mesma data de corte (saldo_inicial_data):
--   CREATE OR REPLACE mantém o EXECUTE de hoje (authenticated e service_role; anon não).
--
-- O QUE ELA NÃO RESOLVE (anotado no roadmap)
--   - O extrato parou em 29/10/2026 (uma importação só, em 28/10): o saldo é o do dia 29/10.
--   - 10 lançamentos com mesmo dia, valor, tipo e descrição (R$ 543,03 a mais, se forem repetidos): podem
--     ser dois Pix iguais legítimos; só o extrato do banco decide. Nada é apagado aqui.
-- =====================================================================================================
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $guarda$
DECLARE
  v_md5 text := (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.saldo_contas_bancarias()'::regprocedure);
BEGIN
  IF v_md5 IS DISTINCT FROM '0b6545c0db77b809434c5fba652dbda6' THEN
    RAISE EXCEPTION 'saldo_contas_bancarias mudou no banco (md5 %). Releia a definição viva antes de trocar.', v_md5;
  END IF;
END $guarda$;

CREATE OR REPLACE FUNCTION public.saldo_contas_bancarias()
 RETURNS TABLE(conta_id uuid, nome text, banco text, agencia text, conta text, saldo_inicial numeric, saldo_inicial_data date, lancamentos integer, entradas numeric, saidas numeric, saldo_atual numeric, nao_conciliados integer, ultimo_lancamento date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select c.id, c.nome, c.banco, c.agencia, c.conta,
         coalesce(c.saldo_inicial, 0), c.saldo_inicial_data,
         count(t.id)::int,
         coalesce(sum(case t.tipo when 'debito' then 0 when 'credito' then abs(t.valor) else greatest(t.valor, 0) end), 0),
         coalesce(sum(case t.tipo when 'debito' then -abs(t.valor) when 'credito' then 0 else least(t.valor, 0) end), 0),
         coalesce(c.saldo_inicial, 0)
           + coalesce(sum(case t.tipo when 'debito' then -abs(t.valor) when 'credito' then abs(t.valor) else t.valor end), 0),
         count(t.id) filter (where not t.conciliado)::int,
         max(t.data)
  from public.contas_bancarias c
  left join public.banco_transacoes t
    on t.conta_id = c.id
   and (c.saldo_inicial_data is null or t.data >= c.saldo_inicial_data)
  where c.ativo
    and public.can_see_financials(auth.uid())
  group by c.id, c.nome, c.banco, c.agencia, c.conta, c.saldo_inicial, c.saldo_inicial_data
  order by c.nome
$function$;

COMMENT ON FUNCTION public.saldo_contas_bancarias() IS
  'Saldo por conta = saldo inicial + créditos - débitos do extrato a partir da data do saldo inicial (o valor vem positivo; quem diz o sentido é o tipo). É o saldo do banco, não o movimento lançado no sistema.';

DO $confere$
BEGIN
  IF has_function_privilege('anon', 'public.saldo_contas_bancarias()'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'anon executa saldo_contas_bancarias';
  END IF;
END $confere$;

COMMIT;

-- =====================================================================================================
-- DESFAZER: reaplicar o corpo de 20260916100000_fecha_portas_abertas.sql (seção 5), que é o que estava
-- vivo antes desta (md5 0b6545c0db77b809434c5fba652dbda6).
-- =====================================================================================================
