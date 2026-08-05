-- Fase 1 — destravar a leitura operacional (views de proteção de custo quebradas).
--
-- Contexto: 20260531203000_separate_financial_rls_views.sql revogou o SELECT de
-- tabela em ordens_servico / itens_os / orcamentos para `authenticated` e
-- reconcedeu SELECT *coluna a coluna* (só as não-financeiras). A leitura passa
-- pelas views _operacional / _financeiro, que são security_invoker=true — ou
-- seja, executam com as permissões de quem chama.
--
-- Regressão: colunas adicionadas às views DEPOIS daquela migração nunca ganharam
-- o grant correspondente. Como a view é security_invoker, ela esbarra no mesmo
-- bloqueio e falha inteira com "permission denied for table <base>".
--
--   ordens_servico  -> faltava estoque_baixado
--   itens_os        -> faltava produto_id
--   orcamentos      -> faltavam contato_nome, contato_email, contato_telefone
--
-- Impacto medido (SELECT * como authenticated, antes desta migração):
--   quebradas: ordens_servico_operacional, itens_os_operacional,
--              orcamentos_operacional, orcamentos_financeiro,
--              vw_dashboard_comercial, vw_dashboard_financeiro,
--              vw_dashboard_prazos, vw_resultado_os
--   e, por consequência, as telas Dashboard, Kanban, OS (lista e detalhe),
--   Orçamentos (lista e detalhe), Financeiro, Cliente e a geração de PDF.
--
-- Correção: conceder SELECT apenas nas colunas que faltam. Nenhuma coluna
-- financeira é exposta (valor_total, custo_real, margem_real seguem revogadas —
-- a view _financeiro as lê de os_resultados_financeiros, sob can_see_financials).
-- Como as views continuam security_invoker, a RLS das tabelas base segue valendo.
--
-- Ao adicionar uma coluna a uma view _operacional/_financeiro, conceda o SELECT
-- da coluna na tabela base na mesma migração, ou a view volta a quebrar inteira.

GRANT SELECT (estoque_baixado) ON public.ordens_servico TO authenticated;

GRANT SELECT (produto_id) ON public.itens_os TO authenticated;

GRANT SELECT (contato_nome, contato_email, contato_telefone) ON public.orcamentos TO authenticated;
