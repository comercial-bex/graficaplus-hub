-- ============================================================================
-- Custos da OS: lança quem a aba Financeiro deixa lançar, em nome próprio;
-- ninguém altera nem apaga lançamento pela API; a leitura fica pela chave
-- ============================================================================
--
-- POR QUÊ
--   custos_operacionais_os é o custo REALIZADO da OS: a vw_resultado_os soma
--   a tabela (custo realizado, lucro e margem realizados), e dela saem
--   rel_lucro_por_os, rel_previsto_realizado, os painéis e o snapshot que a
--   fechar_os grava. A fechar_os também se recusa a fechar OS sem nenhum
--   lançamento ("custos_operacionais"). Tinha duas regras:
--     "custos op read"   SELECT  custos.read OR resultado.read
--     "custos op write"  ALL     is_staff
--   e GRANT de tudo (arwdDxtm) para anon e authenticated. ALL vale também
--   para SELECT, e as regras permissivas somam por OU. Então QUALQUER pessoa
--   da equipe (operador, designer, instalador, vendedor):
--     * lia o custo lançado em todas as OS (a regra de leitura virava enfeite);
--     * lançava custo em qualquer OS, assinando em nome de outra pessoa e com
--       a data que quisesse;
--     * zerava ou apagava o custo que a baixa de estoque, o apontamento de
--       máquina e a perda gravaram (o lucro realizado sobe na mesma hora);
--     * destravava o fechamento: numa OS sem custo, um lançamento de R$ 0,01
--       tira a trava "custos_operacionais" da fechar_os.
--
--   Diferente das vizinhas de estoque (20261007201500 e 20261007221500), aqui
--   a TELA grava: o addCusto da aba Financeiro da OS (os.$id.tsx, FinanceiroTab)
--   faz .from("custos_operacionais_os").insert(...). Não dá para fechar a
--   escrita; dá para deixá-la do tamanho da tela.
--
--   Medido em 07/10/2026 na OS 49 (ac27e850), com um lançamento de 2 m² de
--   lona 440 a R$ 16,23 (R$ 32,46, como a baixa grava), a previsão e a reserva
--   desses 2 m² e um apontamento aberto há 2 h na plotter (R$ 14,4313/h),
--   montados como postgres; contas simuladas com claims + SET LOCAL ROLE;
--   cada tentativa num sub-bloco desfeito, e o bloco inteiro desfeito no fim:
--                               ANTES                     DEPOIS
--     Harison  (admin)          lê; lança; assina por     lê; lança em nome
--     Yvens    (gestor)         outro; retroage a data;   próprio; não assina
--     Cibele   (financeiro)     zera; apaga               por outro, não
--                                                         retroage, não altera,
--                                                         não apaga
--     Leonardo (vendedor+oper.) lê; lança; assina por     não lê (a view mostra
--     Sergio   (operador)       outro; retroage; zera;    custo 0, sem erro);
--                               apaga; destrava o         não lança, não altera,
--                               fechamento com R$ 0,01    não apaga
--     visitante (anon)          lê nada (sem regra); a    sem grant nenhum
--                               RLS recusa escrever
--   O caminho certo deu o MESMO resultado antes e depois, para as 6 contas:
--     baixar_estoque_os       admin e gestor baixam 2 m² e o custo de material
--                             da OS vai a R$ 64,92; os demais: "Permissão
--                             necessária: estoque.exit"
--     finalizar_apontamento   admin, Leonardo e Sergio fecham e lançam R$ 28,86
--                             de máquina; Yvens e Cibele: producao.finish
--     perda (tela de Perdas)  admin, gestor, Leonardo e Sergio registram e o
--                             gatilho lança R$ 16,23 de perda; Cibele é
--                             recusada pela regra de os_perdas (já era)
--     fechar_os               admin e gestor: enxerga o custo lançado; os
--                             demais: os.close
--     vw_dashboard_prazos     1 OS atrasada para a equipe toda, 0 para anon
--   As contas foram SIMULADAS: o ensaio mostra o que cada uma PODIA fazer,
--   não o que alguém fez. Uso real até 08/10/2026: a tabela nunca teve
--   lançamento que ficasse (0 linhas), só existem 2 OS, nenhuma fechada, sem
--   baixa, apontamento ou perda. Um lançamento feito e apagado em seguida não
--   deixa linha; só o log de API do Supabase mostraria.
--   Ensaiado também com 20261007201500 + 20261007221500 + esta, nessa ordem:
--   para a Cibele, custo previsto, reservado e realizado da OS continuam
--   R$ 32,46 cada; para Leonardo e Sergio, zero nos três, sem erro.
--
-- QUEM LÊ E QUEM GRAVA (mapa medido antes de mexer)
--   Gravam, como DEFINER donas postgres (dona da tabela, sem FORCE RLS), sem
--   passar por regra nem por grant:
--     baixar_estoque_os            'material' / 'baixa_estoque' (estoque.exit)
--     fechar_apontamento_interno   'maquina' / 'apontamento'; chamada por
--                                  finalizar_apontamento (producao.finish) e
--                                  pelo gatilho tg_os_saiu_da_oficina
--     tg_perda_vira_custo_da_os    'perda' / 'os_perdas'; gatilho AFTER INSERT
--                                  de os_perdas
--   Grava como quem chama: só o addCusto da aba Financeiro, que manda os_id,
--   origem (a descrição digitada), categoria, quantidade 1, valor_unitario e
--   usuario_id = a própria pessoa. A aba só abre com canSeeFinancials, que é
--   has_permission('financeiro.read'), o mesmo que can_see_financials no
--   banco: admin, financeiro e gestor. O formulário não tem outra trava. A
--   tela não altera nem apaga lançamento em lugar nenhum.
--   Leem, como DEFINER (não mudam): fechar_os (trava e snapshot),
--   custo_real_por_peca (PDF do orçamento; guarda custos.read/resultado.read),
--   get_relatorios_prioritarios (via rel_*; guarda is_staff + can_see_financials).
--   Leem como quem chama, todas security_invoker:
--     vw_resultado_os (e por ela vw_dashboard_financeiro, vw_dashboard_prazos,
--     rel_previsto_realizado), rel_lucro_por_os, vw_resultado_operacional_os,
--     vw_dashboard_custos_categoria, vw_dashboard_retrabalho. Citam os_id,
--     total e categoria.
--   Na tela: a aba Financeiro lê a tabela e a vw_resultado_os; o Início lê
--   vw_dashboard_financeiro, vw_dashboard_custos_categoria e vw_resultado_os
--   só com canSeeFinancials; vw_dashboard_prazos (só conta atraso) para todos.
--   Edge functions: nenhuma. Cron: nenhum. Nenhuma regra de outra tabela
--   consulta esta.
--
-- O QUE ESTA MIGRAÇÃO FAZ
--   1. Tira "custos op write" (ALL is_staff). "custos op read" fica como está:
--      lê quem tem custos.read ou resultado.read (admin, estoque, financeiro,
--      gestor).
--   2. Cria "custos: lanca quem ve o financeiro", só INSERT: can_see_financials
--      (a mesma porta da aba) E usuario_id = auth.uid() (o lançamento leva o
--      nome de quem lançou, como a tela já manda).
--   3. Tira de anon e authenticated todo privilégio e devolve ao authenticated
--      SELECT da tabela inteira e INSERT só das seis colunas que a tela manda.
--      id, total (gerada), data e created_at nascem do banco; os_item_id e
--      tarefa_id ficam para as funções. Sem UPDATE, DELETE nem TRUNCATE: a
--      tentativa morre no grant ("permission denied"). REVOKE de PUBLIC não
--      basta: no Supabase anon e authenticated têm grant próprio.
--      service_role e o papel da plataforma (sandbox_exec) ficam como estão.
--
-- O QUE FICA DE FORA, DE PROPÓSITO
--   * Quem lança é quem vê o financeiro, porque é quem a tela deixa lançar
--     hoje (o financeiro inclusive). A chave custos.create (admin, gestor)
--     tiraria o lançamento da Cibele; se o dono quiser "financeiro vê e não
--     lança custo", troca-se can_see_financials por custos.create aqui E se
--     esconde o formulário na aba, no mesmo PR.
--   * O GRANT SELECT continua na tabela inteira: as views security_invoker
--     citam as colunas, e coluna sem grant mata a view INTEIRA para todo mundo.
--     Protege-se a LINHA (a regra de leitura), não a coluna.
--   * Lido direto pela API, o custo realizado das views sai zero para quem não
--     tem custos.read/resultado.read. Nenhuma tela mostra essas views a eles.
--   * Corrigir lançamento errado: não há tela para isso hoje. Quando houver,
--     função SECURITY DEFINER com motivo e rastro (como estornar_pagamento),
--     não UPDATE/DELETE direto.
--   * Quem vê o financeiro ainda destrava a fechar_os com qualquer lançamento:
--     ela só confere que existe custo. É o fluxo da tela; mudar é outra decisão.
--   * Perda: a tela de Perdas deixa quem tem os.update (operador, designer)
--     digitar o custo unitário, e o gatilho DEFINER o lança na OS. Porta lateral
--     conhecida, fica.
--   * estornar_baixa_estoque_os devolve o material ao lote mas não mexe no
--     custo lançado pela baixa: o custo realizado fica com o material estornado.
--     Defeito à parte.
--   * Mesma regra ALL is_staff em itens_os ("itens_os staff all"),
--     orcamento_itens, orcamento_versao_itens e apontamentos_producao
--     ("apontamentos staff write", "producao write"). Fica para outra
--     migração, com o mapa de cada uma.
--
-- ORDEM
--   Independente de 20261007201500 e 20261007221500 (cada uma mexe nas suas
--   tabelas); ensaiada sozinha e depois das duas. Pode ir antes, depois ou
--   junto.
--
-- COMO CONFERIR DEPOIS DE APLICAR
--   select policyname, cmd from pg_policies
--    where tablename = 'custos_operacionais_os' order by 1;
--     → "custos op read"                      SELECT
--       "custos: lanca quem ve o financeiro"  INSERT
--   select grantee, privilege_type from information_schema.role_table_grants
--    where table_name = 'custos_operacionais_os' and grantee in ('anon','authenticated');
--     → authenticated SELECT, e mais nada
--   select column_name from information_schema.column_privileges
--    where table_name = 'custos_operacionais_os' and grantee = 'authenticated'
--      and privilege_type = 'INSERT' order by 1;
--     → categoria, origem, os_id, quantidade, usuario_id, valor_unitario
-- ============================================================================

-- 1. Sai a regra ALL de is_staff. "custos op read" (SELECT custos.read OR
--    resultado.read) fica como está: é a leitura que vale daqui para a frente.
DROP POLICY IF EXISTS "custos op write" ON public.custos_operacionais_os;
DROP POLICY IF EXISTS "custos: lanca quem ve o financeiro" ON public.custos_operacionais_os;

-- 2. Lançar: só quem a aba Financeiro da OS deixa lançar, e em nome próprio.
CREATE POLICY "custos: lanca quem ve o financeiro" ON public.custos_operacionais_os
  FOR INSERT TO authenticated
  WITH CHECK (
    public.can_see_financials((select auth.uid()))
    AND usuario_id = (select auth.uid())
  );

-- 3. Grants: leitura da tabela inteira (as views invoker citam as colunas) e
--    lançamento só das colunas que a tela manda. Nada de UPDATE, DELETE ou
--    TRUNCATE; nada para anon.
REVOKE ALL ON public.custos_operacionais_os FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.custos_operacionais_os TO authenticated;
GRANT INSERT (os_id, categoria, origem, quantidade, valor_unitario, usuario_id)
  ON public.custos_operacionais_os TO authenticated;

COMMENT ON TABLE public.custos_operacionais_os IS
  'Custo realizado da OS (soma em vw_resultado_os, rel_lucro_por_os e painéis; fechar_os exige ao menos um). Lê quem tem custos.read ou resultado.read. Lança pela API só quem vê o financeiro (can_see_financials, a mesma porta da aba Financeiro da OS), em nome próprio (usuario_id = auth.uid()) e só as colunas que a tela manda (os_id, categoria, origem, quantidade, valor_unitario, usuario_id). Ninguém altera nem apaga pela API, DE PROPÓSITO: baixa de estoque, apontamento de máquina e perda gravam por função SECURITY DEFINER e não dependem destas regras. Migração 20261007233000.';
