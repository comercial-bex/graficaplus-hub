-- ============================================================================
-- Reservas, inventário e materiais previstos da OS: ninguém grava direto pela
-- API; a previsão (que traz custo) só lê quem vê custo
-- ============================================================================
--
-- POR QUÊ
--   As três tabelas vizinhas de `material_lotes` tinham a mesma porta que a
--   migração 20261007201500 fechou lá: uma regra FOR ALL aberta por is_staff
--   e GRANT de tudo (INSERT, UPDATE, DELETE, TRUNCATE) para anon e
--   authenticated.
--     estoque_reservas        "estoque reservas read"  SELECT estoque.read
--                             "estoque reservas write" ALL    is_staff
--     estoque_inventarios     "inv staff"              ALL    is_staff
--     os_materiais_previstos  "os mat prev staff"      ALL    is_staff
--   ALL vale também para SELECT, e as regras permissivas somam por OU. Então
--   QUALQUER pessoa da equipe (operador, designer, instalador, vendedor):
--     * criava, alterava e apagava RESERVA de material direto pela API. A
--       baixar_estoque_os baixa exatamente o que está reservado: reserva falsa
--       vira saída de estoque e custo lançado na OS;
--     * forjava ou apagava o registro de auditoria do AJUSTE DE INVENTÁRIO;
--     * lia e gravava a PREVISÃO de material da OS, com custo_unitario_previsto
--       em toda linha (é dela que sai o custo previsto da vw_resultado_os e o
--       custo_previsto que recalcular_previsao_custos grava na OS).
--
--   Medido em 07/10/2026 na OS 49 (ac27e850), com 2 m² de lona 440 previstos
--   e reservados, 1 m² de lona 280 previsto e um registro de inventário,
--   montados como postgres; contas simuladas com claims + SET LOCAL ROLE;
--   cada tentativa num sub-bloco desfeito, e o bloco inteiro desfeito no fim:
--                               ANTES                       DEPOIS
--     Harison  (admin)          lê tudo, grava nas 3        lê tudo, não grava
--     Yvens    (gestor)         lê tudo, grava nas 3        lê tudo, não grava
--     Cibele   (financeiro)     lê tudo, grava nas 3        lê reserva e previsão
--                                                           (custo da view igual),
--                                                           não lê inventário,
--                                                           não grava
--     Leonardo (vendedor+oper.) lê tudo, grava nas 3        lê só reserva (sem
--                                                           custo), não grava
--     Sergio   (operador)       lê tudo, grava nas 3        lê só reserva (sem
--                                                           custo), não grava
--     visitante (anon)          lê nada (sem regra)         sem grant nenhum
--   A cadeia do ataque, antes: Sergio cria uma reserva falsa de 10 m² de lona
--   440 e o gestor baixa a OS → saem 12 m² do estoque e R$ 194,76 de custo
--   entra na OS, em vez de 2 m² e R$ 32,46. Depois: a reserva falsa é recusada.
--   O caminho certo deu o MESMO resultado antes e depois para as 6 contas:
--   reservar_materiais_os, baixar_estoque_os, estornar_baixa_estoque_os,
--   ajustar_estoque_material, recalcular_previsao_custos, previsoes_desatualizadas,
--   materiais_faltantes_os e o gatilho que monta a previsão quando entra item
--   na OS. Quem tem a chave consegue; quem não tem é recusado pela guarda da
--   própria função ("Permissão necessária: estoque.reserve" etc.), que não
--   depende destas regras.
--
-- QUEM LÊ E QUEM GRAVA (mapa medido antes de mexer)
--   Gravam: só funções SECURITY DEFINER, donas postgres (dona das tabelas, sem
--   FORCE RLS), que não passam por regra nem por grant:
--     estoque_reservas        reservar_materiais_os_interno (chamada por
--                             reservar_materiais_os e converter_orcamento_em_os),
--                             baixar_estoque_os
--     estoque_inventarios     ajustar_estoque_material (só ela)
--     os_materiais_previstos  gerar_materiais_previstos_os (chamada pelo
--                             gatilho tg_prever_materiais de itens_os e por
--                             converter_orcamento_em_os), recalcular_previsao_custos
--   As apagadas em cascata (ON DELETE CASCADE de ordens_servico e itens_os)
--   rodam como dona da tabela e não dependem de regra.
--   Tela (src/): ninguém grava nenhuma das três. Lê direto só o card
--   "Materiais da OS" (materiais-previstos-card.tsx), que pede de
--   estoque_reservas material, quantidade, quantidade_baixada e status, para
--   QUALQUER pessoa da equipe que abre a OS. Edge functions: nenhuma. Cron:
--   nenhum. Nenhuma regra de outra tabela consulta as três.
--   Leem, como quem chama: vw_resultado_os (security_invoker), com LEFT JOIN:
--     previsto_material = os_materiais_previstos (quantidade × custo previsto)
--     reservado         = estoque_reservas × material_lotes.custo_unitario_snapshot
--   Linha que a RLS esconde vira custo ZERO em silêncio, não erro. A tela só
--   lê a view para quem vê financeiro (aba Financeiro da OS e dashboard).
--   As demais leem como DEFINER e não mudam: fechar_os, pendencias_do_sistema,
--   previsoes_desatualizadas (filtra por custos.read), materiais_faltantes_os,
--   materiais_faltantes_da_os.
--
-- O QUE ESTA MIGRAÇÃO FAZ
--   1. Tira as três regras ALL is_staff. Sem regra de escrita, a RLS recusa
--      INSERT/UPDATE/DELETE de authenticated.
--   2. Leitura, tabela por tabela:
--      estoque_reservas: continua para a equipe toda ("reservas: le a equipe",
--        SELECT is_staff; "estoque reservas read" fica como está). A linha não
--        tem custo; o card da OS mostra "reservado" a quem produz; o custo da
--        reserva só aparece cruzando com o lote, que a 20261007201500 já
--        restringe a quem vê custo. E a Cibele (financeiro, sem estoque.read)
--        lia reserva SÓ pela regra ALL: restringir à chave de estoque zeraria o
--        custo reservado da vw_resultado_os para ela, sem erro.
--      estoque_inventarios: lê quem lê movimentação de estoque (estoque.read
--        ou estoque.cost.read, a mesma regra de movimentacoes_estoque). Todo
--        ajuste vira uma movimentação com origem 'inventario'; o registro de
--        auditoria não deve ser mais aberto que o fato que ele documenta.
--        Nenhuma tela lê esta tabela.
--      os_materiais_previstos: lê quem vê custo, pelas mesmas duas portas de
--        `materiais` e de `material_lotes`: estoque.cost.read ou
--        can_see_financials. Toda linha traz custo_unitario_previsto. O
--        financeiro continua lendo, e é isso que mantém o custo previsto da
--        vw_resultado_os certo para ele. Nenhuma tela lê a tabela direto; a
--        quantidade que o operador vê no card vem de materiais_faltantes_os
--        (DEFINER), que não muda.
--   3. Tira de anon e authenticated todo privilégio nas três e devolve só
--      SELECT ao authenticated (o card e a view invoker precisam). REVOKE de
--      PUBLIC não basta: no Supabase anon e authenticated têm grant próprio.
--      service_role e o papel da plataforma (sandbox_exec) ficam como estão.
--
-- O QUE FICA DE FORA, DE PROPÓSITO
--   * A coluna custo_unitario_previsto continua no GRANT SELECT. A
--     vw_resultado_os é security_invoker e cita a coluna: sem grant, a view
--     morre INTEIRA para todo mundo, admin inclusive (mesmo caso de
--     material_lotes). Protege-se a LINHA, não a coluna.
--   * Para vendedor e operador, a vw_resultado_os passa a mostrar custo
--     previsto de material zero se lida direto pela API. Nenhuma tela mostra a
--     view a eles.
--   * custos_operacionais_os ("custos op write") e itens_os ("itens_os staff
--     all") têm a mesma regra ALL is_staff, mas a TELA grava nelas (lançar
--     custo na aba Financeiro, itens da OS): precisam de regra por chave, não
--     de fechar. Fica para outra migração, com o mapa delas.
--   * recalcular_previsao_custos tem EXECUTE para PUBLIC e anon; a guarda
--     (custos.update) recusa o visitante ("Usuário não autenticado").
--
-- ORDEM
--   Aplicar DEPOIS de 20261007201500_lotes_sem_escrita_direta.sql. As duas
--   são independentes no banco (cada uma mexe nas suas tabelas), mas o custo
--   reservado da vw_resultado_os só fica restrito a quem vê custo quando as
--   duas estão no ar: a reserva não tem custo, o lote tem.
--
-- COMO CONFERIR DEPOIS DE APLICAR
--   select tablename, policyname, cmd from pg_policies
--    where tablename in ('estoque_reservas','estoque_inventarios','os_materiais_previstos')
--    order by 1, 2;
--     → estoque_inventarios     "inventario: le quem le estoque"  SELECT
--       estoque_reservas        "estoque reservas read"           SELECT
--       estoque_reservas        "reservas: le a equipe"           SELECT
--       os_materiais_previstos  "previstos: le quem ve custo"     SELECT
--   select table_name, grantee, privilege_type from information_schema.role_table_grants
--    where table_name in ('estoque_reservas','estoque_inventarios','os_materiais_previstos')
--      and grantee in ('anon','authenticated');
--     → authenticated SELECT nas três, e mais nada.
-- ============================================================================

-- 1. Reservas: sem escrita direta; a leitura continua para a equipe.
DROP POLICY IF EXISTS "estoque reservas write" ON public.estoque_reservas;
DROP POLICY IF EXISTS "reservas: le a equipe" ON public.estoque_reservas;

CREATE POLICY "reservas: le a equipe" ON public.estoque_reservas
  FOR SELECT TO authenticated
  USING (public.is_staff((select auth.uid())));

-- 2. Inventário: sem escrita direta; lê quem lê movimentação de estoque.
DROP POLICY IF EXISTS "inv staff" ON public.estoque_inventarios;
DROP POLICY IF EXISTS "inventario: le quem le estoque" ON public.estoque_inventarios;

CREATE POLICY "inventario: le quem le estoque" ON public.estoque_inventarios
  FOR SELECT TO authenticated
  USING (
    public.has_permission((select auth.uid()), 'estoque.read')
    OR public.has_permission((select auth.uid()), 'estoque.cost.read')
  );

-- 3. Materiais previstos: sem escrita direta; lê quem vê custo.
DROP POLICY IF EXISTS "os mat prev staff" ON public.os_materiais_previstos;
DROP POLICY IF EXISTS "previstos: le quem ve custo" ON public.os_materiais_previstos;

CREATE POLICY "previstos: le quem ve custo" ON public.os_materiais_previstos
  FOR SELECT TO authenticated
  USING (
    public.has_permission((select auth.uid()), 'estoque.cost.read')
    OR public.can_see_financials((select auth.uid()))
  );

-- 4. Grants: só leitura para authenticated, nada para anon.
REVOKE ALL ON public.estoque_reservas FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.estoque_inventarios FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.os_materiais_previstos FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.estoque_reservas TO authenticated;
GRANT SELECT ON public.estoque_inventarios TO authenticated;
GRANT SELECT ON public.os_materiais_previstos TO authenticated;

COMMENT ON TABLE public.estoque_reservas IS
  'Reserva de material para a OS. Sem regra nem grant de escrita para anon/authenticated DE PROPÓSITO: a baixar_estoque_os baixa o que está reservado, então só função SECURITY DEFINER grava (reservar_materiais_os_interno, baixar_estoque_os). Lê a equipe (sem custo na linha; o custo vem do lote). Migração 20261007221500.';

COMMENT ON TABLE public.estoque_inventarios IS
  'Registro de auditoria do ajuste de inventário. Sem regra nem grant de escrita para anon/authenticated DE PROPÓSITO: só ajustar_estoque_material (SECURITY DEFINER) grava. Lê quem lê movimentação de estoque (estoque.read ou estoque.cost.read). Migração 20261007221500.';

COMMENT ON TABLE public.os_materiais_previstos IS
  'Material previsto para a OS, com custo unitário previsto. Sem regra nem grant de escrita para anon/authenticated DE PROPÓSITO: só função SECURITY DEFINER grava (gerar_materiais_previstos_os, recalcular_previsao_custos). Lê quem vê custo: estoque.cost.read ou can_see_financials. Migração 20261007221500.';
