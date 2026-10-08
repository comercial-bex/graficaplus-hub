-- ============================================================================
-- Itens da OS, itens do orçamento e versões do orçamento: a equipe toda lê,
-- mas só grava quem pode mexer na venda
-- ============================================================================
--
-- POR QUÊ
--   Em 31/05/2026 duas migrações nasceram com o MESMO prefixo, 20260531203000:
--     _permission_matrix_rls        tirou "itens_os staff all" e "orc_itens
--                                   staff all" (ALL is_staff) e pôs no lugar
--                                   regras por permissão;
--     _separate_financial_rls_views roda DEPOIS (ordem alfabética) e RECRIOU
--                                   as duas regras ALL is_staff. A intenção
--                                   dela era a equipe LER item (o dinheiro já
--                                   fica de fora pelo grant por coluna e pelas
--                                   views operacional/comercial/financeiro),
--                                   mas ALL também abre gravação.
--   As versões do orçamento nasceram em 11/07 com a mesma regra ALL is_staff.
--   As regras permissivas somam por OU; resultado, hoje:
--     itens_os                "itens_os permission all"  ALL kanban.move OU orcamentos.create
--                             "itens_os staff all"       ALL is_staff        ← abre para todos
--     orcamento_itens         "orc_itens permission all" ALL orcamentos.create
--                             "orc_itens staff all"      ALL is_staff        ← abre para todos
--     orcamento_versoes       "orc_versoes staff all"    ALL is_staff
--     orcamento_versao_itens  "orc_versoes_itens staff all" ALL is_staff
--   Qualquer pessoa da equipe (operador, designer, instalador, estoque,
--   financeiro) criava, alterava e apagava item de OS e de orçamento pela API,
--   preço inclusive (o grant da tabela dá UPDATE em todas as colunas; os
--   gatilhos refazem o total da OS e do orçamento), e criava versão de
--   orçamento. A aprovar_orcamento aprova a ÚLTIMA versão: uma versão falsa
--   vira a versão aprovada.
--
--   Medido em 08/10/2026 com as contas simuladas (claims + SET LOCAL ROLE;
--   montagem como postgres: item de R$ 100 na OS 49, versão 1 do orçamento 75
--   de R$ 700; cada tentativa num sub-bloco desfeito, o bloco inteiro desfeito
--   no fim):
--                              ANTES                          DEPOIS
--     Harison  (admin)         lê, grava item e versão        lê, grava item; versão só pela função
--     Yvens    (gestor)        lê, grava item e versão        lê, grava item; versão só pela função
--     Leonardo (vendedor+op.)  lê, grava item e versão        lê, grava item; versão só pela função
--     Cibele   (financeiro)    lê, grava item e versão        lê, NÃO grava
--     Sergio   (operador)      lê, grava item e versão        lê, NÃO grava
--     visitante (anon)         lê nada (sem regra)            sem grant nenhum
--   O que o Sergio fazia antes: mudar o preço do item da OS 49 (total da OS
--   de R$ 100 para R$ 1), apagar o item (total R$ 0), mudar o preço do item do
--   orçamento 75 (total de R$ 700 para R$ 1) e criar uma "versão 99" que a
--   aprovar_orcamento aprovava no lugar da verdadeira.
--   As views que a tela usa (itens_os_* e orcamento_itens_*, nos três níveis)
--   devolveram o MESMO para as 6 contas antes e depois; aprovar_orcamento e
--   converter_orcamento_em_os também (admin e gestor conseguem; os outros são
--   recusados pela guarda da função).
--
-- QUEM LÊ E QUEM GRAVA (mapa medido antes de mexer)
--   Gravam pela tela:
--     itens_os         aba Itens da OS (os.$id.tsx: inserir e apagar item).
--                      A aba aparecia para todos; o mesmo commit passa a
--                      mostrar os botões só a quem tem kanban.move ou
--                      orcamentos.create (a mesma regra daqui).
--     orcamento_itens  editor do orçamento e "Layouts do item"
--                      (orcamentos.$id.tsx, layouts-do-item.tsx), que a tela
--                      já só libera com orcamentos.update — pelos papéis, as
--                      mesmas pessoas de orcamentos.create (admin, gestor,
--                      vendedor).
--   Gravam por função SECURITY DEFINER (não passam por regra nem por grant):
--     converter_orcamento_em_os, converter_orcamento_3d_em_os (itens_os),
--     catalogo_adicionar_ao_orcamento, parceiro_enviar_pedido (orcamento_itens),
--     aprovar_orcamento (orcamento_versoes). Ninguém grava orcamento_versao_itens.
--   Gatilhos nas duas tabelas de item: os de soma e espelho de custo são
--   DEFINER; os de precificar por área rodam como quem grava e não mudam.
--   Leem como quem chama: itens_os_operacional, itens_os_financeiro,
--   orcamento_itens_operacional, orcamento_itens_financeiro, rel_margem_por_produto
--   (security_invoker) — continuam lendo, a leitura pela equipe fica.
--   As views _comercial, vw_metragem_cliente e vw_aprovacoes_orcamento rodam
--   como dona. Portal do parceiro usa parceiro_orcamento_itens (outra tabela).
--   Nenhuma página pública lê estas tabelas; nenhuma regra de outra tabela as
--   consulta; nenhum cron.
--
-- O QUE ESTA MIGRAÇÃO FAZ
--   1. Troca "itens_os staff all" e "orc_itens staff all" (ALL) por regras de
--      LEITURA para a equipe. A gravação fica com as regras por permissão que
--      já existem e não mudam: kanban.move ou orcamentos.create (item da OS),
--      orcamentos.create (item do orçamento) — admin, gestor e vendedor.
--   2. Versões do orçamento: sem regra de escrita e sem grant de escrita (só a
--      aprovar_orcamento grava). Lê quem vê preço (can_see_prices: precos.read
--      ou financeiro.read), porque a versão guarda o orçamento inteiro com valor.
--   3. Tira o grant do anon nas quatro tabelas (no Supabase anon tem grant
--      próprio; REVOKE de PUBLIC não basta).
--
-- O QUE FICA DE FORA, DE PROPÓSITO
--   * O grant de authenticated em itens_os e orcamento_itens NÃO é refeito:
--     o SELECT é por coluna (sem dinheiro) e as views invoker dependem dele.
--     REVOKE ALL do authenticated apagaria esses grants por coluna e mataria
--     a lista de itens de todo mundo. O que protege a escrita é a regra.
--   * orcamento_item_arquivos ("orcamento_item_arquivos_equipe", ALL is_staff)
--     liga arte a item de orçamento, sem dinheiro; fica como está.
--   * custos_operacionais_os está em outra sessão/migração.
--
-- ORDEM
--   Independente de 20261007201500 e 20261007221500 (outras tabelas). O
--   front (botões da aba Itens da OS) pode ir antes ou depois: com o banco
--   fechado e o front velho, quem não pode gravar vê o erro da regra ao
--   tentar incluir item.
--
-- COMO CONFERIR DEPOIS DE APLICAR
--   select tablename, policyname, cmd from pg_policies
--    where tablename in ('itens_os','orcamento_itens','orcamento_versoes','orcamento_versao_itens')
--    order by 1, 2;
--     → itens_os                "itens_os permission all"              ALL
--       itens_os                "itens_os: le a equipe"                SELECT
--       orcamento_itens         "orc_itens permission all"             ALL
--       orcamento_itens         "orc_itens: le a equipe"               SELECT
--       orcamento_versao_itens  "orc_versoes_itens: le quem ve preco"  SELECT
--       orcamento_versoes       "orc_versoes: le quem ve preco"        SELECT
--   select table_name, grantee, privilege_type from information_schema.role_table_grants
--    where table_name in ('itens_os','orcamento_itens','orcamento_versoes','orcamento_versao_itens')
--      and grantee = 'anon';
--     → nenhuma linha.
-- ============================================================================

-- 1. Itens: a equipe lê; grava quem já podia pela regra por permissão.
DROP POLICY IF EXISTS "itens_os staff all" ON public.itens_os;
DROP POLICY IF EXISTS "itens_os: le a equipe" ON public.itens_os;

CREATE POLICY "itens_os: le a equipe" ON public.itens_os
  FOR SELECT TO authenticated
  USING (public.is_staff((select auth.uid())));

DROP POLICY IF EXISTS "orc_itens staff all" ON public.orcamento_itens;
DROP POLICY IF EXISTS "orc_itens: le a equipe" ON public.orcamento_itens;

CREATE POLICY "orc_itens: le a equipe" ON public.orcamento_itens
  FOR SELECT TO authenticated
  USING (public.is_staff((select auth.uid())));

-- 2. Versões: só a aprovar_orcamento grava; lê quem vê preço.
DROP POLICY IF EXISTS "orc_versoes staff all" ON public.orcamento_versoes;
DROP POLICY IF EXISTS "orc_versoes: le quem ve preco" ON public.orcamento_versoes;

CREATE POLICY "orc_versoes: le quem ve preco" ON public.orcamento_versoes
  FOR SELECT TO authenticated
  USING (public.can_see_prices((select auth.uid())));

DROP POLICY IF EXISTS "orc_versoes_itens staff all" ON public.orcamento_versao_itens;
DROP POLICY IF EXISTS "orc_versoes_itens: le quem ve preco" ON public.orcamento_versao_itens;

CREATE POLICY "orc_versoes_itens: le quem ve preco" ON public.orcamento_versao_itens
  FOR SELECT TO authenticated
  USING (public.can_see_prices((select auth.uid())));

REVOKE ALL ON public.orcamento_versoes FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.orcamento_versao_itens FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.orcamento_versoes TO authenticated;
GRANT SELECT ON public.orcamento_versao_itens TO authenticated;

-- 3. Visitante: nada nas tabelas de item. O authenticated de itens_os e
--    orcamento_itens fica como está (SELECT por coluna, sem dinheiro).
REVOKE ALL ON public.itens_os FROM PUBLIC, anon;
REVOKE ALL ON public.orcamento_itens FROM PUBLIC, anon;

COMMENT ON TABLE public.orcamento_versoes IS
  'Versão congelada do orçamento (snapshot com valor). Sem regra nem grant de escrita para anon/authenticated DE PROPÓSITO: a aprovar_orcamento aprova a última versão, então só ela (SECURITY DEFINER) grava. Lê quem vê preço (can_see_prices). Migração 20261008043700.';

COMMENT ON TABLE public.orcamento_versao_itens IS
  'Itens congelados de uma versão do orçamento (snapshot com valor). Sem regra nem grant de escrita para anon/authenticated DE PROPÓSITO. Lê quem vê preço (can_see_prices). Migração 20261008043700.';
