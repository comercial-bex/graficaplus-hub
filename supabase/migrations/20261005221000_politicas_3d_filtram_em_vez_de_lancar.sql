-- ============================================================================
-- Impressão 3D: policy de leitura que FILTRA em vez de lançar exceção
-- ============================================================================
--
-- POR QUÊ
--   `require_permission(x)` lança exceção quando falta a permissão. Dentro do
--   USING de uma policy, isso não esconde a linha: derruba a consulta inteira
--   de quem não tem a chave, na primeira linha que o banco examinar.
--   Duas tabelas do módulo 3D tinham esse desenho na LEITURA:
--
--   1. producao_3d_apontamentos — só a policy ALL
--      impressao3d_producao_manage_apont (impressao3d.production.update), sem
--      policy de leitura. Hoje a tabela está vazia, então nada quebra. Medido
--      em 05/10/2026 com um job e um apontamento criados dentro do ensaio:
--      gestor (Yvens) e financeiro (Cibele), que têm impressao3d.read e abrem
--      /producao-3d e /impressao-3d, recebem P0001 "Permissão necessária:
--      impressao3d.production.update" na lista de jobs (o embed
--      producao_3d_apontamentos(count) leva a lista INTEIRA junto), na lista
--      de apontamentos e no painel vw_dashboard_impressao_3d (view invoker que
--      lê a tabela). As três telas descartam o erro: no dia do primeiro
--      apontamento 3D, os dois passariam a ver a produção 3D vazia.
--   2. orcamento_3d_calculos — impressao3d_cost_read_calculos
--      (impressao3d.cost.read). Operador e vendedor abrem /orcamento-3d/$id e
--      recebiam P0001; a tela jogava o erro fora e mostrava custo R$ 0,00,
--      margem 0,0% e lucro R$ 0,00 ao lado do preço real. A tela agora nem
--      pede o cálculo a quem não vê custo; a policy passa a filtrar para que
--      nenhuma outra leitura (o PDF, um embed futuro) volte a explodir.
--
-- O QUE FAZ
--   - producao_3d_apontamentos: USING da policy ALL troca require_permission
--     por has_permission (filtra). O WITH CHECK fica como está: na ESCRITA,
--     lançar é o certo — a mensagem diz qual permissão faltou.
--     Policy nova impressao3d_producao_read_apont (SELECT, impressao3d.read),
--     a mesma chave que já libera a leitura de producao_3d_jobs.
--   - orcamento_3d_calculos: USING de impressao3d_cost_read_calculos troca
--     require_permission por has_permission. Quem lê continua o mesmo (admin,
--     gestor, financeiro); quem não pode passa a receber 0 linhas.
--   Nada é apagado. Quem pode gravar continua exatamente o mesmo.
--
-- ENSAIO (05/10/2026, DO $ensaio$ ... RAISE EXCEPTION, tudo desfeito; um job e
-- um apontamento 'em_andamento' criados dentro do ensaio na OS mais antiga —
-- 'em_andamento' não dispara a baixa de filamento; nenhuma OS nova)
--   As 6 leituras das telas, como cada conta, antes e depois:
--     /producao-3d jobs + producao_3d_apontamentos(count), apontamentos do job,
--     /impressao-3d jobs, apontamentos + job, vw_dashboard_impressao_3d,
--     orcamento_3d_calculos do orçamento 3D que existe.
--   Antes  Yvens e Cibele: P0001 em 4 das 6 (jobs+count, apontamentos,
--          apontamentos+job, painel). Sergio e Leonardo: P0001 no cálculo.
--   Depois as 5 contas leem as 6 sem erro; Sergio e Leonardo recebem 0
--          linhas de cálculo; Harison, Yvens e Cibele, 1.
--   Gravar apontamento: Harison, Sergio e Leonardo gravam antes e depois;
--   Yvens e Cibele recusados antes e depois com a mesma mensagem
--   ("Permissão necessária: impressao3d.production.update").
--
-- RETRATO
--   Aplicada pelo MCP em 05/10/2026 a partir DESTE arquivo. pg_policy depois:
--     producao_3d_apontamentos
--       impressao3d_producao_manage_apont  ALL     USING has_permission(production.update)
--                                                  WITH CHECK require_permission(production.update)
--       impressao3d_producao_read_apont    SELECT  USING has_permission(impressao3d.read)
--     orcamento_3d_calculos
--       impressao3d_cost_read_calculos     SELECT  USING has_permission(impressao3d.cost.read)
--       impressao3d_cost_insert_calculos   INSERT  (intocada)
--   Idempotente: ALTER POLICY reaplica o mesmo USING; a policy nova só é
--   criada se ainda não existe.
--
-- FICA DE FORA (anotado no relatório)
--   - As outras policies com require_permission no USING. producao_3d_jobs
--     tem a policy de leitura irmã e passou no ensaio com linha; ficou como
--     está.
--   - producao_3d_fechamentos só tem a policy ALL com
--     require_permission('impressao3d.close') (só o admin). A tabela está
--     vazia; no primeiro fechamento, vw_dashboard_impressao_3d (invoker, faz
--     LEFT JOIN nela) passa a lançar para todo mundo que não é admin.
-- ============================================================================

ALTER POLICY impressao3d_producao_manage_apont ON public.producao_3d_apontamentos
  USING (public.has_permission((SELECT auth.uid()), 'impressao3d.production.update'));

DO $politica$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                 AND tablename = 'producao_3d_apontamentos'
                 AND policyname = 'impressao3d_producao_read_apont') THEN
    CREATE POLICY impressao3d_producao_read_apont ON public.producao_3d_apontamentos
      FOR SELECT TO authenticated
      USING (public.has_permission((SELECT auth.uid()), 'impressao3d.read'));
  END IF;
END $politica$;

ALTER POLICY impressao3d_cost_read_calculos ON public.orcamento_3d_calculos
  USING (public.has_permission((SELECT auth.uid()), 'impressao3d.cost.read'));
