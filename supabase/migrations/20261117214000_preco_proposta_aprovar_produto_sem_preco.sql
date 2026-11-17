-- =====================================================================================================
-- APROVAR PROPOSTA DE PREÇO DE PRODUTO SEM PREÇO DE BALCÃO (17/11/2026)
--
-- O defeito. preco_proposta_criar grava preco_atual = COALESCE(produtos.preco_base, 0): produto sem preço fica com
-- preco_atual 0. preco_proposta_aprovar compara `v_prod.preco_base IS DISTINCT FROM v_prop.preco_atual`. Com o preço
-- do produto NULO contra 0, o resultado é verdadeiro e a função levanta "O preço do produto mudou depois da
-- proposta", embora nada tenha mudado. O produto ativo "Impressão 3D (serviço)" está exatamente assim hoje, a tela
-- Preços por produto o conta em Sem preço e deixa propor. A proposta nasceria e nunca poderia ser aprovada: só
-- recusada.
--
-- A correção. Nos dois lados da comparação, COALESCE(preço, 0). Nulo e zero valem "sem preço" nas duas pontas, como
-- já valem na criação. Mais nada muda: trava de piso, auditoria, números gravados e permissões ficam IGUAIS.
--
-- Como a troca é feita. Pela definição viva (pg_get_functiondef) com uma troca de texto cuja âncora precisa aparecer
-- exatamente uma vez; se o corpo vivo for outro, a migração para sem mexer em nada. CREATE OR REPLACE preserva os
-- GRANTs da função.
--
-- Ensaio no banco vivo, com RAISE EXCEPTION final: docs/ensaio-preco-proposta-aprovar-produto-sem-preco.md.
-- APLICADA no banco vivo em 17/11/2026, depois do ensaio com RAISE EXCEPTION.
--
-- Como desfazer (fora desta migração; rode no SQL editor se precisar voltar):
--   DO $d$
--   DECLARE v_def text := pg_get_functiondef('public.preco_proposta_aprovar(uuid)'::regprocedure);
--   BEGIN
--     EXECUTE replace(v_def,
--       'IF COALESCE(v_prod.preco_base, 0) IS DISTINCT FROM COALESCE(v_prop.preco_atual, 0) THEN',
--       'IF v_prod.preco_base IS DISTINCT FROM v_prop.preco_atual THEN');
--   END $d$;
-- =====================================================================================================
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $troca$
DECLARE
  v_def  text := pg_get_functiondef('public.preco_proposta_aprovar(uuid)'::regprocedure);
  v_de   text := 'IF v_prod.preco_base IS DISTINCT FROM v_prop.preco_atual THEN';
  v_para text := 'IF COALESCE(v_prod.preco_base, 0) IS DISTINCT FROM COALESCE(v_prop.preco_atual, 0) THEN';
  n int;
BEGIN
  n := (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de);
  IF n <> 1 THEN
    RAISE EXCEPTION 'preco_proposta_aprovar: a comparação do preço apareceu % vezes (esperado 1). Releia a definição viva antes de trocar.', n;
  END IF;
  EXECUTE replace(v_def, v_de, v_para);
END
$troca$;

-- Prova dentro da própria migração: a função viva agora tem a comparação nova e não tem a antiga.
DO $prova$
DECLARE
  v_def text := pg_get_functiondef('public.preco_proposta_aprovar(uuid)'::regprocedure);
BEGIN
  IF position('IF COALESCE(v_prod.preco_base, 0) IS DISTINCT FROM COALESCE(v_prop.preco_atual, 0) THEN' IN v_def) = 0
     OR position('IF v_prod.preco_base IS DISTINCT FROM v_prop.preco_atual THEN' IN v_def) > 0 THEN
    RAISE EXCEPTION 'preco_proposta_aprovar: a troca não ficou no corpo vivo';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.preco_proposta_aprovar(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.preco_proposta_aprovar(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'preco_proposta_aprovar: os GRANTs mudaram (esperado: authenticated sim, anon não)';
  END IF;
END
$prova$;

COMMIT;
