-- O custo de material 3D aparecia MULTIPLICADO pelo número de impressões.
--
-- Medido: orçamento de 3 peças, consumo real de 203,66 g (145,47 g da que deu
-- certo + 58,19 g da que falhou aos 40%). As duas telas 3D relatavam 610,98 g —
-- exatamente 3×, o número de jobs.
--
-- A causa está nas duas, igual:
--
--   from public.movimentacoes_estoque me
--   join public.producao_3d_jobs j on j.os_id = me.os_id
--
-- Uma OS de três impressões tem três jobs, então cada movimentação casava com
-- três linhas e era somada três vezes. Junção que multiplica linha é o tipo de
-- erro que não parece erro: o número sai plausível, só que grande demais. Aqui
-- ele triplicaria o custo de material de toda peça 3D — e é esse custo que
-- decide o preço.
--
-- A correção de fundo não é ajustar a soma, é parar de adivinhar de qual
-- impressão veio o consumo. O gatilho que grava a movimentação JÁ SABE o job;
-- ele só não estava registrando.

alter table public.movimentacoes_estoque
  add column if not exists job_3d_id uuid references public.producao_3d_jobs(id) on delete set null;

create index if not exists idx_movimentacoes_job_3d
  on public.movimentacoes_estoque (job_3d_id) where job_3d_id is not null;

grant select (job_3d_id), insert (job_3d_id) on public.movimentacoes_estoque to authenticated;

comment on column public.movimentacoes_estoque.job_3d_id is
  'Impressão que consumiu este filamento. Sem ela, o consumo só podia ser ligado pela OS — e uma OS com várias impressões multiplicava o total.';

-- O gatilho passa a registrar o job.
create or replace function public.tg_consumir_filamento_do_apontamento()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_job public.producao_3d_jobs%rowtype;
  v_consumo record;
  v_fracao numeric;
  v_gramas numeric;
  v_restante numeric;
  v_lote record;
  v_baixa numeric;
begin
  if new.resultado is null or new.resultado not in ('concluido','falha','sucesso','concluida') then
    return new;
  end if;

  select * into v_job from public.producao_3d_jobs where id = new.job_id;
  if not found then return new; end if;

  -- Falha consome só a fração extrudada; sucesso consome tudo. Filamento de
  -- peça que falhou é perda real — ignorá-la é dizer que retrabalho é de graça.
  v_fracao := case
    when new.resultado = 'falha'
      then least(greatest(coalesce(new.percentual_consumido_antes_falha, 0) / 100.0, 0), 1)
    else 1
  end;
  if v_fracao <= 0 then return new; end if;

  for v_consumo in
    select c.material_id, c.gramas_totais, c.custo_por_grama_snapshot
    from public.orcamento_3d_consumos c
    where c.placa_id = v_job.placa_id
  loop
    v_gramas := round(coalesce(v_consumo.gramas_totais, 0) * v_fracao, 4);
    if v_gramas <= 0 then continue; end if;

    v_restante := v_gramas;
    for v_lote in
      select * from public.material_lotes
      where material_id = v_consumo.material_id and quantidade > 0
      order by validade nulls last, created_at
      for update
    loop
      exit when v_restante <= 0;
      v_baixa := least(v_restante, v_lote.quantidade);
      update public.material_lotes set quantidade = quantidade - v_baixa where id = v_lote.id;
      v_restante := v_restante - v_baixa;
    end loop;

    insert into public.movimentacoes_estoque
      (material_id, tipo, quantidade, unidade, custo_unitario_snapshot,
       os_id, os_item_id, job_3d_id, usuario_id, origem, motivo)
    values
      (v_consumo.material_id, 'saida', v_gramas, 'g', v_consumo.custo_por_grama_snapshot,
       v_job.os_id, v_job.os_item_id, v_job.id, new.operador_id, 'producao_3d',
       case
         when v_restante > 0 then
           format('Impressão 3D (%s) — %s g sem lote cadastrado', new.resultado, round(v_restante, 2))
         else format('Impressão 3D (%s)', new.resultado)
       end);
  end loop;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- As duas telas passam a somar pelo job, sem multiplicar.
-- ---------------------------------------------------------------------------
create or replace function public.produtividade_3d(
  p_inicio date default ((current_date - '30 days'::interval))::date,
  p_fim date default current_date)
returns table (
  maquina_id uuid, maquina text, custo_hora numeric,
  jobs_concluidos int, jobs_falha int, taxa_falha_pct numeric,
  horas_impressas numeric, horas_previstas numeric, pecas_produzidas int,
  minutos_por_peca numeric, custo_maquina numeric, custo_energia numeric,
  gramas_consumidas numeric, custo_material numeric,
  custo_total numeric, custo_por_peca numeric
)
language sql
stable
security definer
set search_path to 'public'
as $$
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
    -- Pelo JOB, não pela OS: uma OS com três impressões triplicava o total.
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
  order by b.horas desc, b.nome
$$;

create or replace function public.breakdown_3d(
  p_inicio date default ((current_date - '90 days'::interval))::date,
  p_fim date default current_date)
returns table (
  orcamento_id uuid, titulo text, cliente text, status text, quantidade integer,
  custo_material numeric, custo_maquina numeric, custo_energia numeric,
  custo_mao_obra numeric, custo_acabamento numeric, custo_indireto numeric,
  custo_operacional numeric, markup numeric, margem numeric, preco numeric,
  valor_unitario numeric, gramas_reais numeric, custo_material_real numeric,
  horas_reais numeric, custo_maquina_real numeric, produzido boolean,
  divergencia_material numeric
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with ultimo_calculo as (
    select distinct on (c.orcamento_3d_id) c.* from public.orcamento_3d_calculos c
    order by c.orcamento_3d_id, c.versao desc, c.created_at desc),
  real_material as (
    -- Pelo JOB, não pela OS. Ver produtividade_3d.
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
  order by o.created_at desc
$$;

-- Movimentações 3D já gravadas não sabem o job. Só dá para recuperar quando a
-- OS tem uma impressão só — com mais de uma, adivinhar seria inventar.
update public.movimentacoes_estoque me
   set job_3d_id = j.id
  from public.producao_3d_jobs j
 where me.job_3d_id is null
   and me.origem = 'producao_3d'
   and j.os_id = me.os_id
   and (select count(*) from public.producao_3d_jobs j2 where j2.os_id = me.os_id) = 1;
