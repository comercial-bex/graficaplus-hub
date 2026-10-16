-- ============================================================================
-- Perdas: o custo digitado só vale de quem vê custo; ninguém altera nem apaga
-- perda pela API; quem vê financeiro lê o custo por uma view própria
-- (parte 1 de 2 — compatível com a tela antiga e com a nova)
-- ============================================================================
--
-- POR QUÊ
--   Toda perda registrada com OS vira custo da OS: o gatilho DEFINER
--   tg_perda_vira_custo_da_os lança quantidade × custo_unitario em
--   custos_operacionais_os (e baixa o material do lote). A tela /perdas abre
--   para os.read (toda a equipe) e mostrava o campo "Custo unitário" a todos.
--   O gatilho tg_perda_custo_do_material só busca o custo do cadastro quando
--   chega ZERO; qualquer valor digitado era aceito. E a regra "os_perdas write"
--   era FOR ALL (os.update OR custos.create): quem mexe na OS também alterava e
--   apagava perda direto pela API — a perda sumia e o custo e a baixa ficavam.
--   Na leitura, a tabela entregava custo_unitario/custo_total a toda a equipe:
--   custo total ÷ quantidade é o custo do material, que a tabela `materiais`
--   esconde de quem não vê financeiro (a parte 2, 20261015172000, fecha isso).
--
--   Medido em 15/10/2026 na OS 49 (ac27e850), partes 1 e 2 juntas, contas
--   simuladas com claims + SET LOCAL ROLE, cada tentativa num sub-bloco
--   desfeito e o bloco inteiro desfeito no fim. Lona 440: cadastro R$ 16,23.
--                                   ANTES                   DEPOIS
--     Leonardo (vendedor+operador, não vê custo):
--       R$ 500 digitado, sem material   custo na OS R$ 500    nenhum custo
--       R$ 500 digitado, lona 440       custo na OS R$ 500    R$ 16,23 (cadastro)
--       zero, lona 440 (tela)           R$ 16,23              R$ 16,23
--     Harison / Yvens, R$ 500 digitado  R$ 500                R$ 500 (veem custo)
--     autor do custo lançado            vazio                 quem registrou
--     alterar / apagar perda            Harison, Yvens,       ninguém (sem grant)
--                                       Leonardo
--     Cibele (financeiro) registrar     recusado (sem         igual
--                                       os.update)
--     ler a perda (colunas sem custo)   quem tem os.read      igual
--     ler o custo na tabela             quem tem os.read      ninguém
--     ler o custo pela view nova        (não existia)         Harison, Yvens,
--                                                             Cibele; Leonardo 0
--     tela ANTIGA (select *)            funciona              recusada para todos
--                                                             (por isso a ordem)
--     visitante (anon)                  nada                  nada (sem grant)
--   Sergio (operador) aparece recusado em tudo nos dois lados: a conta dele
--   está desativada (usuarios.ativo = false) desde antes do ensaio.
--   Uso real até 15/10: nenhuma perda na base.
--
-- QUEM LÊ E QUEM GRAVA (mapa medido antes de mexer)
--   Grava: só a tela /perdas (INSERT; nunca altera nem apaga). Nenhuma função
--   grava em os_perdas. Gatilhos: tg_perda_custo (BEFORE, este arquivo) e
--   tg_perda_custo_os (AFTER, lança o custo e baixa o lote), os dois DEFINER.
--   Lê: /perdas (lista, cartões, gráfico) e /materiais (perda por material; o
--   custo só aparece para quem vê financeiro). Nenhuma view, nenhuma edge
--   function, nenhum cron, nenhuma regra de outra tabela.
--
-- O QUE ESTA MIGRAÇÃO FAZ
--   1. tg_perda_custo_do_material (a viva + duas linhas):
--      a) no INSERT feito por alguém logado, created_by = auth.uid() — o custo
--         lançado na OS passa a ter autor (antes saía vazio: a tela não manda);
--      b) se quem grava NÃO vê financeiro, o custo_unitario que veio é
--         ignorado e o gatilho usa o do cadastro (lote mais recente com custo,
--         depois custo do material). Sem material, fica zero: perda sem
--         material não tem custo a buscar. Sem auth.uid() (funções, chave de
--         serviço) nada muda.
--   2. "os_perdas write" (ALL) vira "perdas: registra quem mexe na OS", só
--      INSERT, com a mesma condição (os.update OR custos.create).
--   3. View os_perdas_financeiro: todas as colunas, DEFINER com
--      security_barrier, só para is_staff E can_see_financials — o mesmo
--      desenho de materiais_financeiro. É por ela que a tela lê o custo.
--   4. Grants: tira tudo de anon e authenticated; devolve SELECT e INSERT ao
--      authenticated (sem UPDATE, DELETE, TRUNCATE). A parte 2 troca o SELECT
--      da tabela por SELECT só das colunas sem custo — DEPOIS de a tela nova
--      estar publicada, porque a antiga pede `*` e morreria.
--
-- O QUE FICA DE FORA
--   * Quantidade: quem registra a perda diz quanto perdeu, e isso baixa o
--     estoque e vira custo (pelo cadastro). É o fluxo de propósito.
--   * Desfazer perda registrada errada: não há tela. Quando houver, função
--     DEFINER que estorne custo e baixa juntos (ver estorno de baixa).
--
-- ORDEM: esta parte antes do Publish da tela nova; a parte 2 depois.
--
-- COMO CONFERIR DEPOIS DE APLICAR
--   select policyname, cmd from pg_policies where tablename = 'os_perdas' order by 1;
--     → "os_perdas read" SELECT; "perdas: registra quem mexe na OS" INSERT
--   select grantee, privilege_type from information_schema.role_table_grants
--    where table_name in ('os_perdas','os_perdas_financeiro') and grantee in ('anon','authenticated')
--    order by 1, 2;
--     → authenticated INSERT e SELECT em os_perdas; SELECT em os_perdas_financeiro
--   select reloptions from pg_class where relname = 'os_perdas_financeiro';
--     → {security_invoker=false,security_barrier=true}
-- ============================================================================

-- 1. Gatilho: autor da sessão; custo digitado só de quem vê custo.
CREATE OR REPLACE FUNCTION public.tg_perda_custo_do_material()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_custo numeric; v_uid uuid := auth.uid();
begin
  -- Quem registra fica registrado: o autor é a sessão, não o que a tela manda.
  if tg_op = 'INSERT' and v_uid is not null then
    new.created_by := v_uid;
  end if;
  -- Custo digitado só vale de quem vê custo; os demais registram a perda e o
  -- custo sai do cadastro do material (20261015171000).
  if v_uid is not null and not public.can_see_financials(v_uid) then
    new.custo_unitario := 0;
  end if;
  if coalesce(new.custo_unitario, 0) > 0 then return new; end if;
  select coalesce(
           (select l.custo_unitario_snapshot from public.material_lotes l
             where l.material_id = new.material_id and l.custo_unitario_snapshot > 0
             order by l.created_at desc limit 1),
           m.custo_unitario, m.custo_medio, 0)
    into v_custo
  from public.materiais m where m.id = new.material_id;
  new.custo_unitario := coalesce(v_custo, 0);
  return new;
end $function$;

-- 2. Escrita: só registrar; ninguém altera nem apaga pela API.
DROP POLICY IF EXISTS "os_perdas write" ON public.os_perdas;
DROP POLICY IF EXISTS "perdas: registra quem mexe na OS" ON public.os_perdas;
CREATE POLICY "perdas: registra quem mexe na OS" ON public.os_perdas
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_permission((select auth.uid()), 'os.update')
    OR public.has_permission((select auth.uid()), 'custos.create')
  );

-- 3. Custo da perda para quem vê financeiro (mesmo desenho de materiais_financeiro).
CREATE OR REPLACE VIEW public.os_perdas_financeiro
  WITH (security_invoker = false, security_barrier = true) AS
SELECT p.id, p.os_id, p.os_item_id, p.material_id, p.maquina_id, p.operador_id,
       p.quantidade_planejada, p.quantidade_produzida, p.quantidade_perdida,
       p.unidade, p.motivo, p.custo_unitario, p.custo_total, p.observacoes,
       p.created_by, p.created_at
  FROM public.os_perdas p
 WHERE public.is_staff((select auth.uid())) AND public.can_see_financials((select auth.uid()));

REVOKE ALL ON public.os_perdas_financeiro FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.os_perdas_financeiro TO authenticated;

-- 4. Tabela: registrar e ler; nada para anon.
REVOKE ALL ON public.os_perdas FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.os_perdas TO authenticated;

COMMENT ON VIEW public.os_perdas_financeiro IS
  'Perdas com custo (custo_unitario, custo_total), só para is_staff E can_see_financials. DEFINER com security_barrier, como materiais_financeiro: custo da perda ÷ quantidade é o custo do material. Migração 20261015171000.';
COMMENT ON TABLE public.os_perdas IS
  'Perda/refugo por OS. Registra quem mexe na OS (os.update ou custos.create); ninguém altera nem apaga pela API. O custo digitado só vale de quem vê financeiro; para os demais o gatilho usa o custo do cadastro do material. Custo se lê por os_perdas_financeiro. Migrações 20261015171000 e 20261015172000.';
