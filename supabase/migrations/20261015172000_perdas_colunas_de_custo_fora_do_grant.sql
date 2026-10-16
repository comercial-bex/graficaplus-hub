-- ============================================================================
-- Perdas: as colunas de custo saem do SELECT de quem está logado
-- (parte 2 de 2 — aplicar SÓ depois de a tela nova estar publicada)
-- ============================================================================
--
-- POR QUÊ
--   custo_total ÷ quantidade_perdida = custo unitário do material, número que
--   a tabela `materiais` não entrega a quem não vê financeiro. Com a regra de
--   leitura os.read, a equipe toda lia esse custo em os_perdas (pela tela
--   /perdas e direto pela API). Regra de linha não resolve: o operador precisa
--   ver a perda (quanto, de quê, por quê), só não o custo. E grant por coluna
--   vale para o papel authenticated inteiro, admin inclusive — por isso quem
--   vê financeiro lê o custo pela view os_perdas_financeiro (parte 1,
--   20261015171000), que confere can_see_financials.
--
-- ORDEM — IMPORTANTE
--   A tela antiga pedia `select("*")` em os_perdas. Com esta migração, `*`
--   inclui coluna sem grant e a consulta inteira morre ("permission denied"),
--   para todo mundo. A tela nova (PR desta migração) pede só as colunas sem
--   custo e lê o custo pela view. Aplicar DEPOIS do Publish e de conferir o
--   marcador da tela nova no pacote publicado.
--   Nenhuma view security_invoker cita os_perdas (conferido via pg_depend em
--   15/10/2026), então nenhuma view morre por coluna sem grant. Os gatilhos são
--   DEFINER e leem a linha inteira como donos.
--
-- COMO CONFERIR DEPOIS DE APLICAR
--   select column_name from information_schema.column_privileges
--    where table_name = 'os_perdas' and grantee = 'authenticated' and privilege_type = 'SELECT'
--    order by 1;
--     → todas menos custo_unitario e custo_total
--   select has_table_privilege('authenticated', 'public.os_perdas', 'SELECT');
--     → false (só por coluna)
-- ============================================================================

REVOKE SELECT ON public.os_perdas FROM authenticated;
GRANT SELECT (id, os_id, os_item_id, material_id, maquina_id, operador_id,
              quantidade_planejada, quantidade_produzida, quantidade_perdida,
              unidade, motivo, observacoes, created_by, created_at)
  ON public.os_perdas TO authenticated;
