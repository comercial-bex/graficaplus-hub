-- Produtividade da impressão 3D.
--
-- Os dados existiam espalhados: tempo real no apontamento, peças na placa,
-- custo/hora na configuração da máquina, gramas no consumo. Ninguém os juntava,
-- então não dava para responder a pergunta que decide comprar máquina nova:
-- quanto sai de peça por hora, e a que custo.
--
-- A taxa de falha entra junto de propósito. Numa gráfica 3D ela é o número que
-- mais mexe no custo: cada falha queima filamento e hora de máquina sem produzir
-- peça, e uma taxa que sobe de 5% para 15% muda o preço de tudo.

create or replace function public.produtividade_3d(
  p_inicio date default (current_date - interval '30 days')::date,
  p_fim date default current_date
)
returns table (
  maquina_id uuid,
  maquina text,
  custo_hora numeric,
  jobs_concluidos integer,
  jobs_falha integer,
  taxa_falha_pct numeric,
  horas_impressas numeric,
  horas_previstas numeric,
  pecas_produzidas integer,
  minutos_por_peca numeric,
  custo_maquina numeric,
  custo_energia numeric,
  gramas_consumidas numeric,
  custo_material numeric,
  custo_total numeric,
  custo_por_peca numeric
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with tarifa as (
    select coalesce(tarifa_kwh_padrao, 0) as kwh from public.config_precificacao_3d limit 1
  ),
  ap as (
    select j.maquina_id,
           a.resultado,
           a.tempo_real_segundos,
           p.tempo_estimado_segundos,
           -- Só conta peça de impressão que terminou bem. Placa que falhou
           -- gastou hora e filamento e não entregou nada — é isso que faz a
           -- taxa de falha doer no custo por peça.
           case when a.resultado in ('concluido','concluida','sucesso')
                then coalesce(p.quantidade_pecas, 0) else 0 end as pecas
    from public.producao_3d_apontamentos a
    join public.producao_3d_jobs j on j.id = a.job_id
    left join public.orcamento_3d_placas p on p.id = j.placa_id
    where a.fim::date between p_inicio and p_fim
  ),
  consumo as (
    select j.maquina_id,
           sum(me.quantidade) as gramas,
           sum(me.quantidade * coalesce(me.custo_unitario_snapshot, 0)) as custo
    from public.movimentacoes_estoque me
    join public.producao_3d_jobs j on j.os_id = me.os_id
    where me.origem = 'producao_3d' and me.created_at::date between p_inicio and p_fim
    group by j.maquina_id
  ),
  base as (
    select m.id as maquina_id,
           m.nome,
           -- Custo/hora manual vence o calculado quando alguém o definiu: é uma
           -- decisão explícita, e o cálculo por depreciação é a estimativa.
           coalesce(c.custo_hora_manual, c.custo_hora_calculado, 0) as custo_hora,
           coalesce(c.potencia_media_w, 0) / 1000.0 as kw,
           count(*) filter (where ap.resultado in ('concluido','concluida','sucesso'))::int as ok,
           count(*) filter (where ap.resultado = 'falha')::int as falhou,
           coalesce(sum(ap.tempo_real_segundos), 0) / 3600.0 as horas,
           coalesce(sum(ap.tempo_estimado_segundos), 0) / 3600.0 as horas_prev,
           coalesce(sum(ap.pecas), 0)::int as pecas
    from public.maquinas m
    join public.maquinas_3d_config c on c.maquina_id = m.id
    left join ap on ap.maquina_id = m.id
    group by m.id, m.nome, c.custo_hora_manual, c.custo_hora_calculado, c.potencia_media_w
  )
  select b.maquina_id,
         b.nome,
         round(b.custo_hora, 4),
         b.ok,
         b.falhou,
         case when b.ok + b.falhou > 0
              then round(b.falhou::numeric * 100 / (b.ok + b.falhou), 1) end,
         round(b.horas, 2),
         round(b.horas_prev, 2),
         b.pecas,
         case when b.pecas > 0 then round(b.horas * 60 / b.pecas, 1) end,
         round(b.horas * b.custo_hora, 2),
         round(b.horas * b.kw * (select kwh from tarifa), 2),
         round(coalesce(co.gramas, 0), 2),
         round(coalesce(co.custo, 0), 2),
         round(b.horas * b.custo_hora + b.horas * b.kw * (select kwh from tarifa) + coalesce(co.custo, 0), 2),
         case when b.pecas > 0
              then round((b.horas * b.custo_hora + b.horas * b.kw * (select kwh from tarifa)
                          + coalesce(co.custo, 0)) / b.pecas, 2) end
  from base b
  left join consumo co on co.maquina_id = b.maquina_id
  order by b.horas desc, b.nome
$$;

comment on function public.produtividade_3d is
  'Horas, peças, tempo por peça, taxa de falha e custo por máquina 3D no período.';

grant execute on function public.produtividade_3d(date, date) to authenticated;
