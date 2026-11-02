-- Família do produto nas três views do catálogo (01/11/2026).
--
-- A escolha do produto no orçamento lê o catálogo pela view do nível de quem
-- olha (operacional, comercial, financeiro). `produtos.familia` existe desde
-- 25/10 (17 famílias, nenhuma vazia), mas nenhuma view a entregava, então a
-- tela não tinha como filtrar "Adesivos de carroceria" dentro de "Adesivo".
--
-- CREATE OR REPLACE VIEW descarta as opções da view: por isso cada uma volta
-- com as suas (`security_invoker` e `security_barrier` como estão no banco
-- vivo em 01/11). A coluna nova entra no FIM da lista, que é o único lugar
-- que o REPLACE aceita. Os GRANTs ficam como estão.

CREATE OR REPLACE VIEW public.produtos_operacional
WITH (security_invoker = true) AS
 SELECT id, nome, descricao, ativo, created_at, sku, categoria, tipo, unidade,
        tempo_producao_min, imagem_url, observacoes_internas, updated_at,
        maquina_padrao_id, material_principal_id, exigencias, sugestoes_operacionais,
        area_minima_cobrada, espacamento_pecas_m,
        familia
   FROM public.produtos;

CREATE OR REPLACE VIEW public.produtos_comercial
WITH (security_invoker = false, security_barrier = true) AS
 SELECT p.id, p.nome, p.descricao, p.ativo, p.created_at, p.sku, p.categoria, p.tipo, p.unidade,
        p.tempo_producao_min, p.imagem_url, p.observacoes_internas, p.updated_at,
        p.maquina_padrao_id, p.material_principal_id, p.exigencias, p.sugestoes_operacionais,
        p.area_minima_cobrada, p.espacamento_pecas_m,
        pp.preco_base, pp.preco_publico, pp.preco_sugerido, pp.preco_parceiro,
        p.familia
   FROM public.produtos p
   LEFT JOIN public.produto_precos pp ON pp.produto_id = p.id
  WHERE public.is_staff(auth.uid()) AND public.can_see_prices(auth.uid());

CREATE OR REPLACE VIEW public.produtos_financeiro
WITH (security_invoker = true) AS
 SELECT p.id, p.nome, p.descricao, p.ativo, p.created_at, p.sku, p.categoria, p.tipo, p.unidade,
        p.tempo_producao_min, p.imagem_url, p.observacoes_internas, p.updated_at,
        p.maquina_padrao_id, p.material_principal_id, p.exigencias, p.sugestoes_operacionais,
        pp.preco_base, pp.custo_medio, pp.margem_minima, pp.margem_sugerida, pp.preco_minimo,
        pp.preco_sugerido, pp.preco_publico, pp.area_minima_cobrada, pp.preco_parceiro,
        p.familia
   FROM public.produtos p
   LEFT JOIN public.produto_precos pp ON pp.produto_id = p.id
  WHERE public.can_see_financials(( SELECT auth.uid() AS uid));

-- Achado da mesma leitura: a view financeira tinha GRANT para `anon` (até de
-- escrita). A RLS de `produtos` já barrava, mas visitante não tem o que fazer
-- numa view de custo e margem.
REVOKE ALL ON public.produtos_financeiro FROM anon;
