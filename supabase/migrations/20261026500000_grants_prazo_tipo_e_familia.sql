-- A tela "Condições" do orçamento mostrava "Não foi possível carregar prazos e pagamento: Você não tem
-- permissão para realizar esta ação." (25/10/2026, orçamento #132, até para o administrador).
--
-- Causa: `orcamentos` e `produtos` têm SELECT por COLUNA (as de dinheiro ficam fechadas e saem pelas views
-- do nível de visão). As colunas novas `orcamentos.prazo_tipo` (prazo normal/expresso) e `produtos.familia`
-- nasceram sem o GRANT, e a consulta do quadro de acordo, que pede `prazo_tipo`, falhava INTEIRA com
-- "permission denied". A família falhava em silêncio: a tela caía no nome da categoria.
-- Nenhuma das duas é dinheiro: abrir a leitura é seguro. Regra para coluna nova nessas tabelas: conferir
-- `has_column_privilege('authenticated', tabela, coluna, 'select')` antes de publicar.
GRANT SELECT (prazo_tipo) ON public.orcamentos TO authenticated;
GRANT SELECT (familia) ON public.produtos TO authenticated;
