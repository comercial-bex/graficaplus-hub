-- APLICADA em 10/11/2026, em produção, depois de ensaio na mesma base (transação desfeita, 8 contas reais e o visitante,
-- antes e depois). Conferido depois de aplicar, por conta: vendedor lê 0 linhas de mão de obra (eram 5), 0 parâmetros de
-- custo (eram 11; o prazo padrão segue chegando), 0 de histórico (eram 3), 0 de patrimônio das máquinas (eram 9) e
-- custo nulo na produtividade 3D (eram 4); o estoque segue lendo mão de obra e parâmetros e sai de patrimônio e
-- produtividade; o financeiro passa a abrir a sugestão de custo/hora (era recusado); admin e gestor não mudaram;
-- o visitante perde o privilégio de tabela nas 11 tabelas de custo.

-- Ajuste no mesmo dia: os valores padrão do período da produtividade 3D passaram de CURRENT_DATE para public.hoje_br()
-- (o dia de Macapá, regra do tests/relogio-de-macapa.test.ts). Aplicado em produção logo depois, trocando só os dois
-- valores padrão sobre a definição viva; este arquivo já traz a versão final.

-- Privacidade do custo, onda A: o que fecha SEM mexer em tela nenhuma (10/11/2026).
--
-- POR QUÊ
--   Quem só é da equipe (vendedor, operador, designer...) lê hoje, direto do banco, o custo da mão de obra e das
--   máquinas. Medido em 05/11/2026 com a conta do vendedor (claims + SET LOCAL ROLE, tudo desfeito):
--     - custos_mao_de_obra: 5 funções com salário, custo/hora e encargo (policy is_staff);
--     - custos_tabela: 11 dos 13 parâmetros são custo, taxa ou margem (policy is_staff); só 2 são interruptores;
--     - vw_patrimonio_maquinas: valor de compra e custo/hora das máquinas (view invoker sobre maquinas, que a equipe lê);
--     - produtividade_3d(): devolvia custo/hora, custo de máquina, energia, material, total e por peça a quem tem
--       impressao3d.read (vendedor e operador), embora a tela esconda;
--     - custo_hora_sugerido(): exigia só maquinas.read (operador) e devolve a conta do contrato; o financeiro, que
--       precisa dela, era recusado (a tela engolia o erro);
--     - orcamento_3d_servicos: a policy "ALL" de gravar também lê (permissivas somam por OU);
--     - eventos_negocio: o gatilho audit_maquina_3d_manual grava a linha inteira de maquinas_3d_config e quem tem
--       os.read ou clientes.read lê o evento (hoje 0 eventos; fica trancado antes do primeiro).
--   Nenhuma tela de quem não vê custo lê estas tabelas (conferido arquivo por arquivo); as de quem vê continuam iguais.
--
-- O QUE FAZ
--   1. pode_ver_custo(uid): custos.read OU financeiro.read OU impressao3d.cost.read (admin, gestor, financeiro, estoque).
--      pode_ver_custo_de_maquina(uid): financeiro.read OU impressao3d.cost.read (admin, gestor, financeiro). O estoque
--      lê mão de obra e parâmetros (as telas Custos de produção e Planilha de custos abrem para ele), mas fica fora de
--      máquina, patrimônio e 3D. (O arquivo de pesquisa de 05/11 só definia a primeira; as migrações B1, C1 e C3 usam a segunda.)
--   2. custos_mao_de_obra: leitura só de quem vê custo.
--   3. custos_tabela: a equipe lê só categoria 'chave' (prazo padrão, converter sozinho); o resto, só quem vê custo.
--      custos_tabela_historico: só quem vê custo.
--   4. custo_hora_sugerido: exige financeiro.read em vez de maquinas.read (troca por âncora na definição viva).
--   5. produtividade_3d: custo e total saem NULOS para quem não vê custo de máquina; horas, peças e falhas continuam.
--   6. vw_patrimonio_maquinas: só devolve linhas a quem vê custo de máquina (a tela é do financeiro).
--   7. orcamento_3d_servicos: gravar continua com quote.update; ler, só impressao3d.cost.read.
--      eventos_negocio: o evento de custo/hora manual 3D só para quem vê custo de máquina.
--   8. anon perde o privilégio de tabela nestas tabelas (defesa em profundidade; nenhuma tela pública as usa).
--
-- IDEMPOTENTE: rodar de novo é inofensivo. As trocas sobre função e visão VIVAS param em voz alta se a definição mudou
-- (md5 conferido de novo em 10/11/2026: produtividade_3d b2fc940e..., vw_patrimonio_maquinas 35136f0f..., policy
-- "eventos permission read" b09477ce...).
-- ORDEM: pode ir já (não depende de front). Depois: A2, B1, C1, front, B3, C3.

-- 1. Quem vê custo --------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pode_ver_custo(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT public.has_permission(_user_id, 'custos.read')
      OR public.has_permission(_user_id, 'financeiro.read')
      OR public.has_permission(_user_id, 'impressao3d.cost.read')
$function$;
REVOKE ALL ON FUNCTION public.pode_ver_custo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pode_ver_custo(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.pode_ver_custo(uuid) IS
  'Quem pode ler custo (mão de obra, máquina, parâmetros): custos.read, financeiro.read ou impressao3d.cost.read. Usada nas policies e views de custo; respeita as exceções por pessoa de has_permission.';

-- 1b. Quem vê custo de MÁQUINA e de impressão 3D: só financeiro.read ou impressao3d.cost.read (admin, gestor, financeiro).
-- O estoque (custos.read) lê mão de obra e parâmetros, mas fica fora de máquina, patrimônio e 3D.
CREATE OR REPLACE FUNCTION public.pode_ver_custo_de_maquina(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT public.has_permission(_user_id, 'financeiro.read')
      OR public.has_permission(_user_id, 'impressao3d.cost.read')
$function$;
REVOKE ALL ON FUNCTION public.pode_ver_custo_de_maquina(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pode_ver_custo_de_maquina(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.pode_ver_custo_de_maquina(uuid) IS
  'Quem pode ler custo de máquina, patrimônio e impressão 3D: financeiro.read ou impressao3d.cost.read. Mais estreita que pode_ver_custo: o estoque (custos.read) fica de fora.';

-- 2. Mão de obra (salário e custo/hora por função) só para quem vê custo ----------------------------------
DROP POLICY IF EXISTS custos_mao_de_obra_leitura_equipe ON public.custos_mao_de_obra;
DROP POLICY IF EXISTS custos_mao_de_obra_leitura_custo ON public.custos_mao_de_obra;
CREATE POLICY custos_mao_de_obra_leitura_custo ON public.custos_mao_de_obra
  FOR SELECT TO authenticated
  USING (public.pode_ver_custo((SELECT auth.uid())));

-- 3. Parâmetros da casa: a equipe lê os interruptores; custo, taxa e margem só quem vê custo --------------
DROP POLICY IF EXISTS custos_tabela_leitura_equipe ON public.custos_tabela;
DROP POLICY IF EXISTS custos_tabela_leitura ON public.custos_tabela;
CREATE POLICY custos_tabela_leitura ON public.custos_tabela
  FOR SELECT TO authenticated
  USING (public.is_staff((SELECT auth.uid()))
         AND (categoria = 'chave' OR public.pode_ver_custo((SELECT auth.uid()))));
COMMENT ON POLICY custos_tabela_leitura ON public.custos_tabela IS
  'categoria chave = interruptor ou padrão que a equipe lê (prazo padrão, converter sozinho). Qualquer outra categoria é custo, taxa ou margem: só quem vê custo.';
DROP POLICY IF EXISTS custos_hist_leitura_equipe ON public.custos_tabela_historico;
DROP POLICY IF EXISTS custos_hist_leitura ON public.custos_tabela_historico;
CREATE POLICY custos_hist_leitura ON public.custos_tabela_historico
  FOR SELECT TO authenticated
  USING (public.pode_ver_custo((SELECT auth.uid())));

-- 4. custo_hora_sugerido: a conta do contrato é do financeiro ---------------------------------------------
DO $m$
DECLARE
  v_def text := pg_get_functiondef('public.custo_hora_sugerido(uuid)'::regprocedure);
  v_ancora constant text := 'require_permission(''maquinas.read'')';
  v_n integer;
BEGIN
  IF position('require_permission(''financeiro.read'')' IN v_def) > 0 THEN
    RAISE NOTICE 'custo_hora_sugerido já exige financeiro.read';
    RETURN;
  END IF;
  v_n := (length(v_def) - length(replace(v_def, v_ancora, ''))) / length(v_ancora);
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'custo_hora_sugerido: a âncora % aparece % vez(es), esperado 1; a função mudou, reler antes de trocar', v_ancora, v_n;
  END IF;
  EXECUTE replace(v_def, v_ancora, 'require_permission(''financeiro.read'')');
END $m$;

-- 5. produtividade_3d: custo só para quem vê custo (horas, peças e falhas seguem para quem tem impressao3d.read) --
DO $m$
DECLARE
  v_def text := pg_get_functiondef('public.produtividade_3d(date,date)'::regprocedure);
BEGIN
  IF position('custo so para quem ve custo' IN v_def) > 0 THEN
    RAISE NOTICE 'produtividade_3d já esconde o custo';
    RETURN;
  END IF;
  IF md5(v_def) <> 'b2fc940e6aa7c8f92a10546841154d78' THEN
    RAISE EXCEPTION 'produtividade_3d mudou desde a leitura de 05/11/2026 (md5 %); reler a definição viva antes de trocar', md5(v_def);
  END IF;
  EXECUTE $def$
CREATE OR REPLACE FUNCTION public.produtividade_3d(p_inicio date DEFAULT (public.hoje_br() - 30), p_fim date DEFAULT public.hoje_br())
 RETURNS TABLE(maquina_id uuid, maquina text, custo_hora numeric, jobs_concluidos integer, jobs_falha integer, taxa_falha_pct numeric, horas_impressas numeric, horas_previstas numeric, pecas_produzidas integer, minutos_por_peca numeric, custo_maquina numeric, custo_energia numeric, gramas_consumidas numeric, custo_material numeric, custo_total numeric, custo_por_peca numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
  -- custo so para quem ve custo (05/11/2026): quem tem impressao3d.read recebe horas, pecas e falhas, e os campos de dinheiro nulos
  with ve as (
    select (public.has_permission(auth.uid(), 'impressao3d.reports.read') or public.pode_ver_custo_de_maquina(auth.uid())) as custo),
  tarifa as (select coalesce(tarifa_kwh_padrao,0) as kwh from public.config_precificacao_3d limit 1),
  ap as (
    select j.maquina_id, a.resultado, a.tempo_real_segundos, p.tempo_estimado_segundos,
           case when a.resultado in ('concluido','concluida','sucesso')
                then coalesce(p.quantidade_pecas,0) else 0 end as pecas
    from public.producao_3d_apontamentos a
    join public.producao_3d_jobs j on j.id = a.job_id
    left join public.orcamento_3d_placas p on p.id = j.placa_id
    where (a.fim AT TIME ZONE 'America/Belem')::date between p_inicio and p_fim),
  consumo as (
    select j.maquina_id, sum(me.quantidade) as gramas,
           sum(me.quantidade * coalesce(me.custo_unitario_snapshot,0)) as custo
    from public.movimentacoes_estoque me
    join public.producao_3d_jobs j on j.id = me.job_3d_id
    where me.origem='producao_3d' and (me.created_at AT TIME ZONE 'America/Belem')::date between p_inicio and p_fim
    group by j.maquina_id),
  base as (
    select m.id as maquina_id, m.nome,
           coalesce(c.custo_hora_manual, c.custo_hora_calculado, 0) as custo_hora,
           coalesce(c.potencia_media_w,0)/1000.0 as kw,
           count(*) filter (where ap.resultado in ('concluido','concluida','sucesso'))::int as ok,
           count(*) filter (where ap.resultado='falha')::int as falhou,
           coalesce(sum(ap.tempo_real_segundos),0)/3600.0 as horas,
           coalesce(sum(ap.tempo_estimado_segundos),0)/3600.0 as horas_prev,
           coalesce(sum(ap.pecas),0)::int as pecas
    from public.maquinas m
    join public.maquinas_3d_config c on c.maquina_id = m.id
    left join ap on ap.maquina_id = m.id
    group by m.id, m.nome, c.custo_hora_manual, c.custo_hora_calculado, c.potencia_media_w)
  select b.maquina_id, b.nome,
         case when ve.custo then round(b.custo_hora,4) end,
         b.ok, b.falhou,
         case when b.ok + b.falhou > 0 then round(b.falhou::numeric*100/(b.ok+b.falhou),1) end,
         round(b.horas,2), round(b.horas_prev,2), b.pecas,
         case when b.pecas > 0 then round(b.horas*60/b.pecas,1) end,
         case when ve.custo then round(b.horas*b.custo_hora,2) end,
         case when ve.custo then round(b.horas*b.kw*(select kwh from tarifa),2) end,
         round(coalesce(co.gramas,0),2),
         case when ve.custo then round(coalesce(co.custo,0),2) end,
         case when ve.custo then round(b.horas*b.custo_hora + b.horas*b.kw*(select kwh from tarifa) + coalesce(co.custo,0),2) end,
         case when ve.custo and b.pecas > 0 then round((b.horas*b.custo_hora + b.horas*b.kw*(select kwh from tarifa)
              + coalesce(co.custo,0))/b.pecas,2) end
  from base b left join consumo co on co.maquina_id = b.maquina_id
  cross join ve
  where public.has_permission(auth.uid(), 'impressao3d.reports.read')
     or public.has_permission(auth.uid(), 'impressao3d.read')
  order by b.horas desc, b.nome
$fn$
  $def$;
END $m$;

-- 6. vw_patrimonio_maquinas: valor de compra, forma de aquisição e custo/hora só para quem vê custo de máquina --
DO $m$
DECLARE
  v_def text := pg_get_viewdef('public.vw_patrimonio_maquinas'::regclass, true);
BEGIN
  IF position('pode_ver_custo' IN v_def) > 0 THEN
    RAISE NOTICE 'vw_patrimonio_maquinas já tem a guarda';
  ELSIF md5(v_def) <> '35136f0f94ed0bec3a64ef1cac5fbaad' THEN
    RAISE EXCEPTION 'vw_patrimonio_maquinas mudou desde a leitura de 05/11/2026 (md5 %); reler antes de trocar', md5(v_def);
  ELSE
    EXECUTE $v$
CREATE OR REPLACE VIEW public.vw_patrimonio_maquinas AS
 SELECT m.id,
    m.nome,
    m.modelo,
    m.numero_serie,
    m.ativa,
    m.forma_aquisicao,
    m.valor_aquisicao,
    m.data_aquisicao,
    m.custo_hora,
    k.id AS compromisso_id,
    k.descricao AS compromisso,
    k.cronograma_confirmado,
        CASE
            WHEN m.forma_aquisicao = 'locada'::text THEN 0::numeric
            ELSE COALESCE(m.valor_aquisicao, 0::numeric)
        END AS patrimonio,
        CASE
            WHEN k.total_parcelas IS NOT NULL THEN GREATEST(0::numeric, k.total_parcelas::numeric * k.valor_parcela - COALESCE(( SELECT sum(p.valor) AS sum
               FROM contas_pagar p
              WHERE p.compromisso_id = k.id AND p.status = 'paga'::status_conta_pagar), 0::numeric))
            ELSE 0::numeric
        END AS divida,
        CASE
            WHEN m.forma_aquisicao = 'locada'::text THEN NULL::text
            WHEN m.valor_aquisicao IS NULL THEN 'falta o valor do bem'::text
            ELSE NULL::text
        END AS pendencia_patrimonio,
        CASE
            WHEN m.forma_aquisicao = 'financiada'::text AND k.id IS NULL THEN 'financiada e sem compromisso cadastrado'::text
            ELSE NULL::text
        END AS pendencia_divida
   FROM maquinas m
     LEFT JOIN compromissos_financeiros k ON k.maquina_id = m.id AND k.ativo
  WHERE public.pode_ver_custo_de_maquina(auth.uid())
    $v$;
  END IF;
  -- CREATE OR REPLACE VIEW zera as opções: religar (nota create-or-replace-view-descarta-as-opcoes)
  ALTER VIEW public.vw_patrimonio_maquinas SET (security_invoker = true);
END $m$;
REVOKE ALL ON public.vw_patrimonio_maquinas FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.vw_patrimonio_maquinas TO authenticated;

-- 7. orcamento_3d_servicos e o evento de custo/hora manual ------------------------------------------------
-- A policy "ALL" de gravar também vale para leitura (permissivas somam por OU): quem edita orçamento 3D lia custo e hora de serviço.
DROP POLICY IF EXISTS impressao3d_servicos_manage ON public.orcamento_3d_servicos;
DROP POLICY IF EXISTS impressao3d_servicos_read ON public.orcamento_3d_servicos;
DROP POLICY IF EXISTS impressao3d_servicos_leitura_custo ON public.orcamento_3d_servicos;
DROP POLICY IF EXISTS impressao3d_servicos_insert ON public.orcamento_3d_servicos;
DROP POLICY IF EXISTS impressao3d_servicos_update ON public.orcamento_3d_servicos;
DROP POLICY IF EXISTS impressao3d_servicos_delete ON public.orcamento_3d_servicos;
CREATE POLICY impressao3d_servicos_leitura_custo ON public.orcamento_3d_servicos
  FOR SELECT TO authenticated
  USING (public.has_permission((SELECT auth.uid()), 'impressao3d.cost.read'));
CREATE POLICY impressao3d_servicos_insert ON public.orcamento_3d_servicos
  FOR INSERT TO authenticated
  WITH CHECK (public.require_permission('impressao3d.quote.update') IS NOT NULL);
CREATE POLICY impressao3d_servicos_update ON public.orcamento_3d_servicos
  FOR UPDATE TO authenticated
  USING (public.has_permission((SELECT auth.uid()), 'impressao3d.quote.update'))
  WITH CHECK (public.require_permission('impressao3d.quote.update') IS NOT NULL);
CREATE POLICY impressao3d_servicos_delete ON public.orcamento_3d_servicos
  FOR DELETE TO authenticated
  USING (public.has_permission((SELECT auth.uid()), 'impressao3d.quote.update'));

DO $m$
DECLARE
  v_qual text;
BEGIN
  SELECT qual INTO v_qual FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'eventos_negocio' AND policyname = 'eventos permission read';
  IF v_qual IS NULL THEN
    RAISE EXCEPTION 'eventos_negocio: a policy "eventos permission read" não existe mais; reler antes de trocar';
  ELSIF position('maquinas_3d_config' IN v_qual) > 0 THEN
    RAISE NOTICE 'eventos_negocio já trava o evento de custo/hora manual';
  ELSIF md5(v_qual) <> 'b09477ce224340888306bda561add2d9' THEN
    RAISE EXCEPTION 'eventos_negocio: a policy mudou desde a leitura de 05/11/2026 (md5 %); reler antes de trocar', md5(v_qual);
  ELSE
    ALTER POLICY "eventos permission read" ON public.eventos_negocio
      USING (
        (has_permission((SELECT auth.uid()), 'logs.read'::text)
         OR has_permission((SELECT auth.uid()), 'os.read'::text)
         OR has_permission((SELECT auth.uid()), 'clientes.read'::text))
        AND (entidade <> 'maquinas_3d_config' OR public.pode_ver_custo_de_maquina((SELECT auth.uid())))
      );
  END IF;
END $m$;

-- 8. Defesa em profundidade: o visitante (anon) não lê nem grava nestas tabelas -----------------------------
-- (REVOKE de PUBLIC não fecha o anon: ele tem privilégio próprio. Nenhuma página pública toca estas tabelas.)
REVOKE ALL ON public.custos_mao_de_obra, public.custos_tabela, public.custos_tabela_historico,
              public.config_precificacao_3d, public.materiais_3d_filamento, public.maquinas_3d_config,
              public.maquinas_contrato, public.producao_3d_jobs, public.orcamento_3d_servicos,
              public.orcamento_3d_calculos, public.orcamento_3d_consumos
  FROM anon;

NOTIFY pgrst, 'reload schema';
