-- O preço de parceiro cadastrado no produto (`produtos.preco_parceiro`) passa a
-- valer também no painel do parceiro e no pedido dele (`parceiro_precos`).
-- Antes só valia no orçamento interno; o painel ignorava a coluna e mostrava o
-- desconto do nível — duas telas, dois preços para o mesmo parceiro.
-- Regra: preço fixo do produto ganha do desconto do nível e do piso de margem
-- (é decisão de preço da casa); oferta ainda pode ficar abaixo dele; faixa de
-- quantidade continua mandando quando existe. Origem devolvida: 'tabela'.
-- Aplicada por substituição ancorada no corpo vivo da função (contou 3 + 1 + 1
-- ocorrências antes de trocar). Desfazer: recriar parceiro_precos de
-- 20260916120000/20260917100000 sem `preco_fixo`.
-- Dados (fora desta migração): preço de parceiro de 4 produtos, 1,50 abaixo do
-- Concorrente 1 — Adesivo vinil recortado 43,50; Adesivo perfurado (one way)
-- 53,50; Banner com bastão e corda 36,50 (era 40); Lona 440g 33,50.

DO $m$
DECLARE d text := pg_get_functiondef('public.parceiro_precos(uuid)'::regprocedure);
  e1 text := 'GREATEST(round(b.preco_base * (1 - v_desc / 100), 2), COALESCE(b.piso, 0))';
  a3 text := 'COALESCE(pp.preco_base, p.preco_base) AS preco_base,';
  a4 text := 'WHEN fx.lista IS NOT NULL THEN ''faixa''';
  n int; r text;
BEGIN
  IF position('preco_fixo' IN d) > 0 THEN RETURN; END IF; -- já aplicada
  n := (length(d) - length(replace(d, e1, ''))) / length(e1);
  IF n <> 3 THEN RAISE EXCEPTION 'e1 aparece % vezes (esperava 3)', n; END IF;
  FOREACH r IN ARRAY ARRAY[a3, a4] LOOP
    IF (length(d) - length(replace(d, r, ''))) / length(r) <> 1 THEN RAISE EXCEPTION 'âncora % não única', r; END IF;
  END LOOP;
  d := replace(d, e1, 'COALESCE(b.preco_fixo, ' || e1 || ')');
  d := replace(d, a3, a3 || E'\n           p.preco_parceiro AS preco_fixo,');
  d := replace(d, a4, a4 || E'\n           WHEN b.preco_fixo IS NOT NULL THEN ''tabela''');
  EXECUTE d;
END $m$;
