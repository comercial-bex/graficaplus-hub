-- Portas abertas: o que qualquer conta — e parte até sem login — lia e alterava.
--
-- Encontrado em 16/09/2026 ao preparar o painel de parceiros, que traz gente de
-- fora para dentro do sistema. A varredura rodou como uma conta recém-criada pela
-- tela pública de cadastro, SEM papel nenhum, e ela conseguia:
--   * ler, criar, alterar e apagar contas bancárias e lançamentos de extrato
--     (policies `*_all` com USING true);
--   * alterar a tabela de custos que forma o preço dos orçamentos;
--   * ler o custo da hora de mão de obra.
-- Sem login algum, só com a chave pública que vai no JavaScript do site:
--   * ler o saldo das contas (`saldo_contas_bancarias`);
--   * ler custo, preço e margem de TODAS as peças de todas as OS
--     (`custo_real_por_peca()` sem argumento);
--   * ler o funil comercial, a produtividade e o custo das peças 3D;
--   * pôr mensagem de WhatsApp na fila de envio para qualquer número, com o texto
--     que quisesse nas variáveis (`enfileirar_notificacao`) — a fila não é drenada
--     hoje, mas passaria a ser no dia em que o envio automático for ligado;
--   * alterar nome de produto e estoque de material pelas views `_operacional`,
--     que rodavam como o dono da tabela e passavam por cima do RLS.
--
-- Regra aplicada: a mesma que as tabelas vizinhas já usam.
--   * banco: admin ou can_see_financials — igual a `contas_pagar`;
--   * custo: leitura pela equipe, escrita por `custos.update`;
--   * relatório: a permissão da própria tela que o consome;
--   * função interna (gatilho, fila): só quem é SECURITY DEFINER ou service_role.
-- Todas as consumidoras são telas da equipe e passam nas mesmas condições de antes.

-- ─── 1. Banco ────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS contas_bancarias_all ON public.contas_bancarias;
CREATE POLICY contas_bancarias_financeiro ON public.contas_bancarias
  FOR ALL TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'::app_role) OR public.can_see_financials((SELECT auth.uid())))
  WITH CHECK (public.has_role((SELECT auth.uid()), 'admin'::app_role) OR public.can_see_financials((SELECT auth.uid())));

DROP POLICY IF EXISTS banco_transacoes_all ON public.banco_transacoes;
CREATE POLICY banco_transacoes_financeiro ON public.banco_transacoes
  FOR ALL TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'::app_role) OR public.can_see_financials((SELECT auth.uid())))
  WITH CHECK (public.has_role((SELECT auth.uid()), 'admin'::app_role) OR public.can_see_financials((SELECT auth.uid())));

-- ─── 2. Custos ───────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS custos_tabela_read ON public.custos_tabela;
DROP POLICY IF EXISTS custos_tabela_write ON public.custos_tabela;
CREATE POLICY custos_tabela_leitura_equipe ON public.custos_tabela
  FOR SELECT TO authenticated
  USING (public.is_staff((SELECT auth.uid())));
CREATE POLICY custos_tabela_escrita ON public.custos_tabela
  FOR ALL TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'::app_role) OR public.has_permission((SELECT auth.uid()), 'custos.update'))
  WITH CHECK (public.has_role((SELECT auth.uid()), 'admin'::app_role) OR public.has_permission((SELECT auth.uid()), 'custos.update'));

-- O histórico é escrito só pelo gatilho `custos_tabela_log`, que é SECURITY
-- DEFINER. Sem policy de INSERT ninguém forja uma linha de "quem alterou o custo".
DROP POLICY IF EXISTS custos_hist_read ON public.custos_tabela_historico;
DROP POLICY IF EXISTS custos_hist_insert ON public.custos_tabela_historico;
CREATE POLICY custos_hist_leitura_equipe ON public.custos_tabela_historico
  FOR SELECT TO authenticated
  USING (public.is_staff((SELECT auth.uid())));

DROP POLICY IF EXISTS custos_mao_de_obra_read ON public.custos_mao_de_obra;
CREATE POLICY custos_mao_de_obra_leitura_equipe ON public.custos_mao_de_obra
  FOR SELECT TO authenticated
  USING (public.is_staff((SELECT auth.uid())));

-- ─── 3. Artes ligadas aos itens do orçamento ────────────────────────────────
-- A página pública do orçamento lê pelo servidor com a chave de serviço, então
-- não depende desta policy.

DROP POLICY IF EXISTS orcamento_item_arquivos_all ON public.orcamento_item_arquivos;
CREATE POLICY orcamento_item_arquivos_equipe ON public.orcamento_item_arquivos
  FOR ALL TO authenticated
  USING (public.is_staff((SELECT auth.uid())))
  WITH CHECK (public.is_staff((SELECT auth.uid())));

-- ─── 4. Views que rodavam como o dono ───────────────────────────────────────
-- `produtos` e `materiais` já liberam leitura à equipe (is_staff) e já concedem
-- a `authenticated` exatamente as colunas que estas views expõem. Com
-- security_invoker a view entrega à equipe o mesmo que entregava — e deixa de
-- entregar a quem não é da equipe, e de aceitar escrita por cima do RLS.

ALTER VIEW public.produtos_operacional SET (security_invoker = true);
ALTER VIEW public.materiais_operacional SET (security_invoker = true);

-- Nenhuma destas é gravável de propósito, e nenhuma serve a visitante sem login.
REVOKE ALL ON public.produtos_operacional, public.materiais_operacional,
              public.vw_aprovacoes_orcamento, public.vw_metragem_cliente FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
    ON public.produtos_operacional, public.materiais_operacional,
       public.vw_aprovacoes_orcamento, public.vw_metragem_cliente FROM authenticated;

-- ─── 5. Funções de leitura: a permissão da tela que as consome ──────────────
-- Continuam em SQL e com a mesma assinatura; quem não tem a permissão recebe a
-- lista vazia, como receberia da tabela.

-- Consumidores: /fluxo-caixa e /funil (este só chama quando can_see_financials).
CREATE OR REPLACE FUNCTION public.saldo_contas_bancarias()
 RETURNS TABLE(conta_id uuid, nome text, banco text, agencia text, conta text, saldo_inicial numeric, saldo_inicial_data date, lancamentos integer, entradas numeric, saidas numeric, saldo_atual numeric, nao_conciliados integer, ultimo_lancamento date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select c.id, c.nome, c.banco, c.agencia, c.conta,
         coalesce(c.saldo_inicial, 0), c.saldo_inicial_data,
         count(t.id)::int,
         coalesce(sum(t.valor) filter (where t.valor > 0), 0),
         coalesce(sum(t.valor) filter (where t.valor < 0), 0),
         coalesce(c.saldo_inicial, 0) + coalesce(sum(t.valor), 0),
         count(t.id) filter (where not t.conciliado)::int,
         max(t.data)
  from public.contas_bancarias c
  left join public.banco_transacoes t
    on t.conta_id = c.id
   and (c.saldo_inicial_data is null or t.data >= c.saldo_inicial_data)
  where c.ativo
    and public.can_see_financials(auth.uid())
  group by c.id, c.nome, c.banco, c.agencia, c.conta, c.saldo_inicial, c.saldo_inicial_data
  order by c.nome
$function$;

-- Consumidor: via interna do orçamento (PDF). Mesma regra de `custos_operacionais_os`.
CREATE OR REPLACE FUNCTION public.custo_real_por_peca(p_os_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(os_id uuid, numero integer, titulo text, os_item_id uuid, descricao text, quantidade numeric, custo_previsto_unitario numeric, custo_material numeric, custo_perda numeric, custo_mao_obra numeric, custo_outros numeric, custo_real_total numeric, custo_real_unitario numeric, preco_unitario numeric, margem_real numeric, divergencia_unitaria numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with custos as (
    select c.os_item_id, c.os_id,
           sum(c.total) filter (where c.categoria = 'material') as material,
           sum(c.total) filter (where c.categoria = 'perda') as perda,
           -- A categoria é `mao_obra` (sem o "de"). Filtrar por 'mao_de_obra'
           -- não casava com nada e a mão de obra saía sempre zero.
           sum(c.total) filter (where c.categoria in ('mao_obra','maquina')) as mao_obra,
           sum(c.total) filter (where c.categoria not in ('material','perda','mao_obra','maquina')) as outros,
           sum(c.total) as total
    from public.custos_operacionais_os c group by c.os_item_id, c.os_id
  )
  select o.id, o.numero, o.titulo, i.id, i.descricao,
         coalesce(i.quantidade, 1), coalesce(i.custo_unitario, 0),
         round(coalesce(k.material, 0), 2), round(coalesce(k.perda, 0), 2),
         round(coalesce(k.mao_obra, 0), 2), round(coalesce(k.outros, 0), 2),
         round(coalesce(k.total, 0), 2),
         round(coalesce(k.total, 0) / greatest(coalesce(i.quantidade, 1), 1), 2),
         coalesce(i.valor_unitario, 0),
         case when coalesce(i.valor_unitario, 0) > 0
              then round((coalesce(i.valor_unitario,0)
                          - coalesce(k.total,0) / greatest(coalesce(i.quantidade,1),1))
                         / coalesce(i.valor_unitario,0), 4) end,
         round(coalesce(k.total, 0) / greatest(coalesce(i.quantidade, 1), 1)
               - coalesce(i.custo_unitario, 0), 2)
  from public.itens_os i
  join public.ordens_servico o on o.id = i.os_id
  left join custos k on k.os_item_id = i.id
  where (p_os_id is null or i.os_id = p_os_id)
    and (public.has_permission(auth.uid(), 'custos.read') or public.has_permission(auth.uid(), 'resultado.read'))
  order by o.numero desc, i.ordem
$function$;

-- Consumidor: /funil (leads.read).
CREATE OR REPLACE FUNCTION public.funil_comercial(p_inicio date DEFAULT ((CURRENT_DATE - '90 days'::interval))::date, p_fim date DEFAULT CURRENT_DATE)
 RETURNS TABLE(lead_id uuid, nome text, origem text, campanha text, etapa text, status text, valor_potencial numeric, criado_em timestamp with time zone, cliente_id uuid, cliente text, orcamentos integer, valor_orcado numeric, orcamentos_aprovados integer, ordens integer, valor_fechado numeric, ordens_concluidas integer, estagio text, dias_parado integer, data_inicio date, prazo date, dias_para_prazo integer, atrasado boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with orc as (
    select o.lead_id,
           count(*)::int as qtd,
           coalesce(sum(o.valor_total), 0) as valor,
           count(*) filter (where o.status in ('aprovado','convertido'))::int as aprovados,
           min(o.data_inicio) as data_inicio,
           min(coalesce(o.prazo, o.data_entrega_prometida)) as prazo
    from public.orcamentos o where o.lead_id is not null group by o.lead_id
  ),
  os as (
    select o.lead_id, count(distinct s.id)::int as qtd,
           coalesce(sum(distinct s.valor_total), 0) as valor,
           count(distinct s.id) filter (where s.status in ('concluido','faturado'))::int as concluidas
    from public.orcamentos o join public.ordens_servico s on s.orcamento_id = o.id
    where o.lead_id is not null group by o.lead_id
  )
  select l.id, l.nome, coalesce(l.origem,'Não informada'), l.campanha, l.etapa, l.status,
         coalesce(l.valor_potencial,0), l.created_at, l.cliente_id, c.nome,
         coalesce(orc.qtd,0), round(coalesce(orc.valor,0),2), coalesce(orc.aprovados,0),
         coalesce(os.qtd,0), round(coalesce(os.valor,0),2), coalesce(os.concluidas,0),
         case
           when coalesce(os.concluidas,0) > 0 then 'entregue'
           when coalesce(os.qtd,0) > 0 then 'em producao'
           when coalesce(orc.aprovados,0) > 0 then 'fechado'
           when coalesce(orc.qtd,0) > 0 then 'orcado'
           when l.status = 'perdido' or l.motivo_perda is not null then 'perdido'
           when l.cliente_id is not null then 'cliente'
           else 'lead'
         end,
         greatest(0, (current_date - coalesce(l.updated_at, l.created_at)::date))::int,
         orc.data_inicio,
         orc.prazo,
         (orc.prazo - current_date)::int,
         -- Atrasado é prazo vencido com a peça ainda não entregue.
         (orc.prazo is not null and orc.prazo < current_date and coalesce(os.concluidas,0) = 0)
  from public.leads l
  left join public.clientes c on c.id = l.cliente_id
  left join orc on orc.lead_id = l.id
  left join os on os.lead_id = l.id
  where l.created_at::date between p_inicio and p_fim
    and coalesce(l.temporario,false) = false
    and public.has_permission(auth.uid(), 'leads.read')
  order by l.created_at desc
$function$;

-- Consumidor: /breakdown-3d (impressao3d.cost.read ou impressao3d.reports.read).
CREATE OR REPLACE FUNCTION public.breakdown_3d(p_inicio date DEFAULT ((CURRENT_DATE - '90 days'::interval))::date, p_fim date DEFAULT CURRENT_DATE)
 RETURNS TABLE(orcamento_id uuid, titulo text, cliente text, status text, quantidade integer, custo_material numeric, custo_maquina numeric, custo_energia numeric, custo_mao_obra numeric, custo_acabamento numeric, custo_indireto numeric, custo_operacional numeric, markup numeric, margem numeric, preco numeric, valor_unitario numeric, gramas_reais numeric, custo_material_real numeric, horas_reais numeric, custo_maquina_real numeric, produzido boolean, divergencia_material numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with ultimo_calculo as (
    select distinct on (c.orcamento_3d_id) c.* from public.orcamento_3d_calculos c
    order by c.orcamento_3d_id, c.versao desc, c.created_at desc),
  real_material as (
    select j.orcamento_3d_id, sum(me.quantidade) as gramas,
           sum(me.quantidade * coalesce(me.custo_unitario_snapshot,0)) as custo
    from public.movimentacoes_estoque me
    join public.producao_3d_jobs j on j.id = me.job_3d_id
    where me.origem='producao_3d' group by j.orcamento_3d_id),
  real_maquina as (
    select j.orcamento_3d_id, sum(a.tempo_real_segundos)/3600.0 as horas,
           sum(a.tempo_real_segundos)/3600.0 * coalesce(mc.custo_hora_manual, mc.custo_hora_calculado, 0) as custo
    from public.producao_3d_apontamentos a
    join public.producao_3d_jobs j on j.id = a.job_id
    left join public.maquinas_3d_config mc on mc.maquina_id = j.maquina_id
    group by j.orcamento_3d_id, mc.custo_hora_manual, mc.custo_hora_calculado)
  select o.id, o.titulo, coalesce(cl.nome, o.contato_nome, 'Sem cliente'), o.status::text,
         coalesce(o.quantidade,1)::int,
         round(coalesce(k.custo_material,0),2), round(coalesce(k.custo_maquina,0),2),
         round(coalesce(k.custo_energia,0),2), round(coalesce(k.custo_mao_obra,0),2),
         round(coalesce(k.custo_acabamento,0),2), round(coalesce(k.custo_indireto,0),2),
         round(coalesce(k.custo_operacional,0),2), round(coalesce(k.markup,0),3),
         round(coalesce(k.margem,0),4), round(coalesce(o.preco_comercial, k.preco_sugerido, 0),2),
         round(coalesce(k.valor_unitario,0),2),
         round(coalesce(rm.gramas,0),2), round(coalesce(rm.custo,0),2),
         round(coalesce(rq.horas,0),2), round(coalesce(rq.custo,0),2),
         (rm.gramas is not null or rq.horas is not null),
         case when rm.custo is not null then round(rm.custo - coalesce(k.custo_material,0),2) end
  from public.orcamentos_3d o
  left join ultimo_calculo k on k.orcamento_3d_id = o.id
  left join public.clientes cl on cl.id = o.cliente_id
  left join real_material rm on rm.orcamento_3d_id = o.id
  left join real_maquina rq on rq.orcamento_3d_id = o.id
  where o.created_at::date between p_inicio and p_fim
    and (public.has_permission(auth.uid(), 'impressao3d.cost.read')
         or public.has_permission(auth.uid(), 'impressao3d.reports.read'))
  order by o.created_at desc
$function$;

-- Consumidor: /produtividade-3d (impressao3d.reports.read ou impressao3d.read).
CREATE OR REPLACE FUNCTION public.produtividade_3d(p_inicio date DEFAULT ((CURRENT_DATE - '30 days'::interval))::date, p_fim date DEFAULT CURRENT_DATE)
 RETURNS TABLE(maquina_id uuid, maquina text, custo_hora numeric, jobs_concluidos integer, jobs_falha integer, taxa_falha_pct numeric, horas_impressas numeric, horas_previstas numeric, pecas_produzidas integer, minutos_por_peca numeric, custo_maquina numeric, custo_energia numeric, gramas_consumidas numeric, custo_material numeric, custo_total numeric, custo_por_peca numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with tarifa as (select coalesce(tarifa_kwh_padrao,0) as kwh from public.config_precificacao_3d limit 1),
  ap as (
    select j.maquina_id, a.resultado, a.tempo_real_segundos, p.tempo_estimado_segundos,
           case when a.resultado in ('concluido','concluida','sucesso')
                then coalesce(p.quantidade_pecas,0) else 0 end as pecas
    from public.producao_3d_apontamentos a
    join public.producao_3d_jobs j on j.id = a.job_id
    left join public.orcamento_3d_placas p on p.id = j.placa_id
    where a.fim::date between p_inicio and p_fim),
  consumo as (
    select j.maquina_id, sum(me.quantidade) as gramas,
           sum(me.quantidade * coalesce(me.custo_unitario_snapshot,0)) as custo
    from public.movimentacoes_estoque me
    join public.producao_3d_jobs j on j.id = me.job_3d_id
    where me.origem='producao_3d' and me.created_at::date between p_inicio and p_fim
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
  select b.maquina_id, b.nome, round(b.custo_hora,4), b.ok, b.falhou,
         case when b.ok + b.falhou > 0 then round(b.falhou::numeric*100/(b.ok+b.falhou),1) end,
         round(b.horas,2), round(b.horas_prev,2), b.pecas,
         case when b.pecas > 0 then round(b.horas*60/b.pecas,1) end,
         round(b.horas*b.custo_hora,2),
         round(b.horas*b.kw*(select kwh from tarifa),2),
         round(coalesce(co.gramas,0),2), round(coalesce(co.custo,0),2),
         round(b.horas*b.custo_hora + b.horas*b.kw*(select kwh from tarifa) + coalesce(co.custo,0),2),
         case when b.pecas > 0 then round((b.horas*b.custo_hora + b.horas*b.kw*(select kwh from tarifa)
              + coalesce(co.custo,0))/b.pecas,2) end
  from base b left join consumo co on co.maquina_id = b.maquina_id
  where public.has_permission(auth.uid(), 'impressao3d.reports.read')
     or public.has_permission(auth.uid(), 'impressao3d.read')
  order by b.horas desc, b.nome
$function$;

-- Consumidor: /planilha-custos (custos.read).
CREATE OR REPLACE FUNCTION public.previsoes_desatualizadas()
 RETURNS TABLE(os_id uuid, numero integer, titulo text, material text, custo_previsto numeric, custo_atual numeric, quantidade numeric, diferenca numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select o.id, o.numero, o.titulo, m.nome,
         p.custo_unitario_previsto, m.custo_unitario, p.quantidade,
         round(p.quantidade * (m.custo_unitario - coalesce(p.custo_unitario_previsto,0)), 2)
  from public.os_materiais_previstos p
  join public.materiais m on m.id = p.material_id
  join public.ordens_servico o on o.id = p.os_id
  where o.status::text not in ('concluido','faturado','cancelado')
    and coalesce(p.custo_unitario_previsto, -1) is distinct from m.custo_unitario
    and not exists (select 1 from public.estoque_reservas r
                     where r.os_id = p.os_id and r.material_id = p.material_id)
    and not exists (select 1 from public.movimentacoes_estoque mv
                     where mv.os_id = p.os_id and mv.material_id = p.material_id)
    and public.has_permission(auth.uid(), 'custos.read')
  order by abs(p.quantidade * (m.custo_unitario - coalesce(p.custo_unitario_previsto,0))) desc
$function$;

-- ─── 6. Quem pode chamar ─────────────────────────────────────────────────────

-- Nenhuma tela serve a visitante sem login por estas funções: a página pública do
-- orçamento e a de aprovação de arte leem pelo servidor, com a chave de serviço.
REVOKE EXECUTE ON FUNCTION
  public.saldo_contas_bancarias(),
  public.custo_real_por_peca(uuid),
  public.funil_comercial(date, date),
  public.breakdown_3d(date, date),
  public.produtividade_3d(date, date),
  public.previsoes_desatualizadas(),
  public.materiais_faltantes_os(uuid),
  public.sugerir_compra_da_os(uuid),
  public.identificacao_legal_os(uuid),
  public.situacao_qualidade_os(uuid),
  public.veredito_qualidade_os(uuid),
  public.tarefas_que_bloqueiam_os(uuid),
  public.preco_da_faixa(uuid, integer)
FROM PUBLIC, anon;

-- Só uso interno. Quem chama é gatilho ou função SECURITY DEFINER (rodam como o
-- dono) ou a edge function process-automations (service_role). Ninguém de fora
-- enfileira WhatsApp, reserva a fila, marca envio ou cria job de produção.
REVOKE EXECUTE ON FUNCTION
  public.enfileirar_notificacao(text, text, uuid, text, text, uuid, text, jsonb, text),
  public.reservar_notificacoes(integer),
  public.concluir_notificacao(uuid, boolean, text, text),
  public.criar_jobs_3d_da_os(uuid, uuid),
  public.recalcular_estoque_material(uuid),
  public.recalcular_status_financeiro_os(uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.enfileirar_notificacao(text, text, uuid, text, text, uuid, text, jsonb, text),
  public.reservar_notificacoes(integer),
  public.concluir_notificacao(uuid, boolean, text, text)
TO service_role;
