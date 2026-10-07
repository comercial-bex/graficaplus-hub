-- ============================================================================
-- Lotes de material: ninguém grava direto pela API, e lê lote só quem vê custo
-- ============================================================================
--
-- POR QUÊ
--   `material_lotes` tinha duas regras de acesso:
--     "estoque canon read"  SELECT  has_permission(uid, 'estoque.read')
--     "estoque canon write" ALL     is_staff(uid)  (USING e WITH CHECK)
--   ALL vale também para SELECT, e as regras permissivas somam por OU. Então
--   QUALQUER pessoa da equipe (operador, designer, instalador, vendedor) lia
--   todos os lotes, com o preço de compra (custo_unitario_snapshot e
--   custo_total), e criava, alterava e apagava lote direto pela API REST: o
--   authenticated tinha GRANT de INSERT, UPDATE, DELETE e TRUNCATE na tabela.
--   Mudar a quantidade de um lote muda o saldo do material (o gatilho
--   tg_material_lotes_saldo recalcula), e mudar o custo do lote muda o custo
--   que a baixa lança na OS.
--
--   Medido em 07/10/2026 com as contas simuladas (claims + SET LOCAL ROLE,
--   tudo desfeito por RAISE EXCEPTION), 7 lotes, R$ 3.559,98 em custo:
--                                ANTES                      DEPOIS
--     Harison  (admin)           lê 7, cria/altera/apaga    lê 7, não grava
--     Yvens    (gestor)          lê 7, cria/altera/apaga    lê 7, não grava
--     Cibele   (financeiro)      lê 7, cria/altera/apaga    lê 7, não grava
--     Leonardo (vendedor+oper.)  lê 7, cria/altera/apaga    lê 0, não grava
--     Sergio   (operador)        lê 7, cria/altera/apaga    lê 0, não grava
--     visitante (anon)           lê 0 (sem policy)          sem grant nenhum
--   Entrada, saída, ajuste de inventário, baixa da OS com estorno e "material
--   nasce com lote" deram o MESMO resultado antes e depois para as 5 pessoas:
--   admin e gestor conseguem; financeiro, vendedor e operador são recusados
--   pela guarda da própria função ("Permissão necessária: estoque.exit" etc.),
--   que não depende destas regras.
--
-- QUEM LÊ E QUEM GRAVA (mapa medido antes de mexer)
--   Tela (src/): NINGUÉM lê nem grava material_lotes direto; a tabela só
--   aparece em src/integrations/supabase/types.ts. Edge functions: nenhuma.
--   Gravam: só funções SECURITY DEFINER, donas postgres (dona da tabela, sem
--   FORCE RLS), que não passam por policy nem por grant:
--     baixar_estoque_os, estornar_baixa_estoque_os, ajustar_estoque_material,
--     registrar_entrada_material, registrar_saida_material,
--     recalcular_estoque_material, reservar_materiais_os_interno,
--     materiais_faltantes_os e os gatilhos tg_lote_recalcular_estoque,
--     tg_material_nasce_com_lote, tg_perda_vira_custo_da_os,
--     tg_perda_custo_do_material, tg_consumir_filamento_do_apontamento.
--   Leem, como quem chama (views security_invoker):
--     vw_resultado_os         custo reservado = reserva × custo do lote.
--                             A tela de detalhe da OS lê esta view para
--                             QUALQUER pessoa da equipe: com a regra antiga o
--                             operador alcançava o custo do lote por ela.
--     vw_movimentacoes_estoque  código do lote (LEFT JOIN). Só quem tem
--                             estoque.read/estoque.cost.read vê movimentação.
--     vw_estoque_critico      soma das quantidades. Nenhuma tela, função ou
--                             cron lê esta view.
--   Nenhuma policy de outra tabela consulta material_lotes; nenhum cron.
--
-- O QUE ESTA MIGRAÇÃO FAZ
--   1. Tira "estoque canon write" (ALL is_staff). Sem regra de escrita, a RLS
--      recusa INSERT/UPDATE/DELETE de anon e authenticated.
--   2. Troca "estoque canon read" por "lotes: le quem ve custo": lote traz o
--      preço de compra em TODA linha, então lê quem já vê custo de material,
--      pelas mesmas duas portas que `materiais` usa:
--        estoque.cost.read   (policy "mat estoque permission read")
--        can_see_financials  (= financeiro.read; view materiais_financeiro)
--      Pelos papéis de hoje: admin, gestor, estoque e financeiro. A chave
--      estoque.read sozinha deixa de abrir custo; pelos papéis ela é um
--      subconjunto de estoque.cost.read (admin, estoque, gestor) e não há
--      exceção por pessoa em nenhuma chave de estoque, então ninguém que lia
--      por estoque.read perde a leitura. O financeiro continua lendo, e é
--      isso que mantém o custo reservado da vw_resultado_os certo para ele.
--   3. Tira de anon e authenticated todo privilégio na tabela e devolve só
--      SELECT ao authenticated (as views invoker precisam). REVOKE de PUBLIC
--      não basta: no Supabase anon e authenticated têm grant próprio.
--      service_role e o papel da plataforma (sandbox_exec) ficam como estão.
--
-- O QUE FICA DE FORA, DE PROPÓSITO
--   * As colunas de custo continuam no GRANT SELECT do authenticated. Ensaiado:
--     tirar custo_unitario_snapshot do grant mata a vw_resultado_os INTEIRA
--     (view invoker que cita coluna sem grant → "permission denied for table
--     material_lotes"), inclusive para o admin, e com ela o detalhe da OS e o
--     dashboard. Quem não pode ver custo agora não vê a LINHA, que é o que
--     protege o número.
--   * Para quem não lê lote (vendedor, operador), vw_estoque_critico passa a
--     somar zero e marcar tudo como crítico (21 de 21). Nenhuma tela usa a
--     view; quem a usar deve ler pelo papel de estoque.
--   * estoque_reservas ("estoque reservas write") e estoque_inventarios
--     ("inv staff") têm a MESMA regra ALL is_staff: o operador cria reserva
--     direto pela API (ensaiado: cria, antes e depois). Fica para outra
--     migração, com o mapa de consumidores delas.
--
-- COMO CONFERIR DEPOIS DE APLICAR
--   select policyname, cmd, qual from pg_policies where tablename = 'material_lotes';
--     → uma linha só: "lotes: le quem ve custo", SELECT.
--   select grantee, privilege_type from information_schema.role_table_grants
--    where table_name = 'material_lotes' and grantee in ('anon','authenticated');
--     → authenticated SELECT, e mais nada.
-- ============================================================================

DROP POLICY IF EXISTS "estoque canon write" ON public.material_lotes;
DROP POLICY IF EXISTS "estoque canon read" ON public.material_lotes;
DROP POLICY IF EXISTS "lotes: le quem ve custo" ON public.material_lotes;

CREATE POLICY "lotes: le quem ve custo" ON public.material_lotes
  FOR SELECT TO authenticated
  USING (
    public.has_permission((select auth.uid()), 'estoque.cost.read')
    OR public.can_see_financials((select auth.uid()))
  );

REVOKE ALL ON public.material_lotes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.material_lotes TO authenticated;

COMMENT ON TABLE public.material_lotes IS
  'Lotes de material (quantidade e custo de compra). Sem regra nem grant de escrita para anon/authenticated DE PROPÓSITO: quem grava é função SECURITY DEFINER (entrada, saída, ajuste, baixa, estorno e os gatilhos de estoque). Lê quem vê custo: estoque.cost.read ou can_see_financials. Migração 20261007201500.';
