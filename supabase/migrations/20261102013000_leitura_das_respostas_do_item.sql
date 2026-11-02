-- A coluna `orcamento_itens.respostas` (20261102003000) nasceu sem SELECT para `authenticated`.
-- A tabela dá leitura coluna a coluna (preço e custo ficam de fora), e coluna nova não entra sozinha. As views
-- `_financeiro` e `_operacional` são security_invoker: com a coluna nova nelas, a leitura caiu em "permissão negada" e o
-- orçamento mostrou "Não foi possível carregar os itens" para admin, gestor, financeiro e operador (visto ao vivo em
-- 02/11/2026). A `_comercial` é definer e por isso o vendedor não sentiu. Respostas não têm dinheiro: podem ser lidas.
GRANT SELECT (respostas) ON public.orcamento_itens TO authenticated;
