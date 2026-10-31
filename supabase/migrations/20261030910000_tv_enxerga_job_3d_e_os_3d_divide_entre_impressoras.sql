-- A TV enxerga o job 3D, e a OS 3D se divide entre as impressoras (30/10/2026).
--
-- 1. OS 170 a 173 (impressão 3D, status genérico "produção") estavam há 4 dias na oficina e não apareciam em
--    máquina nenhuma da TV: a parede decide a máquina pela máquina gravada na OS, pelo status ou pela máquina
--    padrão do produto, e nenhuma dessas olha `producao_3d_jobs`. Caíam em "sem máquina", que é só um número.
--    Agora o job 3D aberto (planejado, aguardando material, em impressão ou pausado) coloca a OS na coluna da
--    impressora dele, e ela sai de "sem máquina" (a conferência R2 exige que nenhuma OS esteja nos dois).
--
-- 2. `criar_jobs_3d_da_os` dava a TODAS as rodadas a impressora gravada na placa, e para uma placa só com
--    repetições = 1 criava UM job mesmo quando o pedido era de 100 peças (o motor de custo já conta 100 rodadas:
--    100 kits de 110 min = 183 h). Agora o número de rodadas de uma placa única é o maior entre as repetições e
--    peças ÷ peças por placa, e o que passa de uma rodada é repartido entre as impressoras ativas, sempre na menos
--    carregada (a carga já em fila entra na conta). Uma rodada só continua indo para a impressora da placa.
--    Pedido acima de 300 rodadas é recusado dizendo quanto pede, em vez de criar job de menos em silêncio.
--
-- 3. `redistribuir_jobs_3d_da_os(os, impressoras)` refaz a repartição dos jobs ainda planejados (sem horário na
--    agenda) quando a pessoa quer escolher as impressoras ou quando entrou trabalho novo na fila.

DO $m$
DECLARE
  v_def text := pg_get_functiondef('public.tv_painel_maquinas()'::regprocedure);
  v_novo text;
BEGIN
  v_novo := replace(v_def,
    E'  sem_maq as (\n    select x.os_id, u.numero, u.pausada, u.atrasada, u.prazo,',
    E'  -- job 3D aberto de OS na oficina: a impressora do job é onde a OS aparece\n'
    E'  jobs3d as (\n'
    E'    select distinct j.os_id, j.maquina_id\n'
    E'      from public.producao_3d_jobs j\n'
    E'      join w u on u.id = j.os_id and u.bloco = ''oficina''\n'
    E'      join maq m on m.id = j.maquina_id\n'
    E'     where j.status in (''planejado'', ''aguardando_material'', ''em_impressao'', ''pausado'')\n'
    E'  ),\n'
    E'  sem_maq as (\n    select x.os_id, u.numero, u.pausada, u.atrasada, u.prazo,');
  IF v_novo = v_def THEN RAISE EXCEPTION 'trecho do sem_maq não encontrado'; END IF;
  v_def := v_novo;

  v_novo := replace(v_def,
    E'     where x.maquina_id is null\n  ),\n  -- todo trabalho que aparece em coluna',
    E'     where x.maquina_id is null\n       and not exists (select 1 from jobs3d y where y.os_id = x.os_id)\n  ),\n  -- todo trabalho que aparece em coluna');
  IF v_novo = v_def THEN RAISE EXCEPTION 'filtro do sem_maq não encontrado'; END IF;
  v_def := v_novo;

  v_novo := replace(v_def,
    E'          from aloc x where x.maquina_id is not null\n      ) z',
    E'          from aloc x where x.maquina_id is not null\n'
    E'        union all\n'
    E'        select ''maquina_id'', y.maquina_id, y.os_id, null, null, null, null, null, null, null, null\n'
    E'          from jobs3d y\n'
    E'         where not exists (select 1 from par c where c.os_id = y.os_id and c.maquina_id = y.maquina_id)\n'
    E'           and not exists (select 1 from aloc a2 where a2.os_id = y.os_id and a2.maquina_id = y.maquina_id)\n'
    E'      ) z');
  IF v_novo = v_def THEN RAISE EXCEPTION 'união do trab não encontrada'; END IF;
  EXECUTE v_novo;
END $m$;

CREATE OR REPLACE FUNCTION public.criar_jobs_3d_da_os(p_orcamento_3d_id uuid, p_os_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_placa record; v_orc record; v_n int; v_i int; v_criados int := 0; v_custo jsonb; v_seg bigint;
  v_placas int; v_ids uuid[]; v_carga bigint[]; v_pos int; v_k int; v_maq uuid;
begin
  select * into v_orc from public.orcamentos_3d where id = p_orcamento_3d_id;
  select count(*) into v_placas from public.orcamento_3d_placas where orcamento_3d_id = p_orcamento_3d_id;

  -- as impressoras ativas e a carga que cada uma já tem em fila (segundos de jobs abertos)
  select coalesce(array_agg(m.id order by m.nome), '{}'::uuid[]),
         coalesce(array_agg((select coalesce(sum(coalesce(pl.tempo_estimado_segundos, 0)
                               + (coalesce(pl.setup_minutos, 0) + coalesce(pl.resfriamento_minutos, 0)
                                  + coalesce(pl.retirada_minutos, 0)) * 60), 0)
                               from public.producao_3d_jobs j
                               join public.orcamento_3d_placas pl on pl.id = j.placa_id
                              where j.maquina_id = m.id
                                and j.status in ('planejado', 'aguardando_material', 'em_impressao', 'pausado'))::bigint
                            order by m.nome), '{}'::bigint[])
    into v_ids, v_carga
    from public.maquinas m where m.ativa and m.tipo = 'impressora_3d';

  for v_placa in select * from public.orcamento_3d_placas where orcamento_3d_id = p_orcamento_3d_id loop
    select jsonb_build_object(
             'custo_material', coalesce(sum(c.custo_total),0),
             'gramas_previstas', coalesce(sum(c.gramas_totais),0),
             'tempo_estimado_segundos', v_placa.tempo_estimado_segundos,
             'materiais', coalesce(jsonb_agg(jsonb_build_object(
                 'material_id', c.material_id, 'gramas', c.gramas_totais,
                 'custo_por_grama', c.custo_por_grama_snapshot))
               filter (where c.material_id is not null), '[]'::jsonb))
      into v_custo
      from public.orcamento_3d_consumos c where c.placa_id = v_placa.id;

    v_n := greatest(coalesce(v_placa.repeticoes, 1), 1);
    if v_placas = 1 and v_orc.id is not null then
      v_n := greatest(v_n, ceil(coalesce(v_orc.quantidade, 1)
                                / greatest(coalesce(v_orc.pecas_por_placa, 1), 1))::int);
    end if;
    if v_n > 300 then
      raise exception 'O pedido pede % rodadas de impressão; o máximo por OS é 300. Divida o pedido em mais de uma OS.', v_n;
    end if;
    v_seg := coalesce(v_placa.tempo_estimado_segundos, 0)
             + (coalesce(v_placa.setup_minutos, 0) + coalesce(v_placa.resfriamento_minutos, 0)
                + coalesce(v_placa.retirada_minutos, 0)) * 60;

    for v_i in 1..v_n loop
      v_maq := v_placa.maquina_id;
      if (v_n > 1 or v_maq is null) and coalesce(array_length(v_ids, 1), 0) > 0 then
        v_pos := 1;
        for v_k in 2..array_length(v_ids, 1) loop
          if v_carga[v_k] < v_carga[v_pos] then v_pos := v_k; end if;
        end loop;
        v_maq := v_ids[v_pos];
      end if;
      if v_maq is not null then
        v_pos := array_position(v_ids, v_maq);
        if v_pos is not null then v_carga[v_pos] := v_carga[v_pos] + v_seg; end if;
      end if;
      insert into public.producao_3d_jobs
        (os_id, orcamento_3d_id, placa_id, maquina_id, status, repeticao, custo_previsto_snapshot)
      values (p_os_id, p_orcamento_3d_id, v_placa.id, v_maq, 'planejado', v_i, v_custo);
      v_criados := v_criados + 1;
    end loop;
  end loop;
  return v_criados;
end; $function$;

CREATE OR REPLACE FUNCTION public.redistribuir_jobs_3d_da_os(p_os_id uuid, p_maquinas uuid[] DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_ids uuid[]; v_carga bigint[]; v_job record; v_pos int; v_k int; v_movidos int := 0;
  v_cont int[]; v_resumo jsonb;
begin
  select coalesce(array_agg(m.id order by m.nome), '{}'::uuid[]) into v_ids
    from public.maquinas m
   where m.ativa and m.tipo = 'impressora_3d'
     and (p_maquinas is null or m.id = any (p_maquinas));
  if coalesce(array_length(v_ids, 1), 0) = 0 then
    raise exception 'Nenhuma impressora 3D ativa entre as escolhidas.';
  end if;
  if p_maquinas is not null and cardinality(p_maquinas) <> array_length(v_ids, 1) then
    raise exception 'Alguma das máquinas escolhidas não é uma impressora 3D ativa.';
  end if;

  -- carga em fila de cada impressora: jobs abertos de OUTRAS OS e os desta OS que já andaram
  select array_agg((select coalesce(sum(coalesce(pl.tempo_estimado_segundos, 0)
                               + (coalesce(pl.setup_minutos, 0) + coalesce(pl.resfriamento_minutos, 0)
                                  + coalesce(pl.retirada_minutos, 0)) * 60), 0)
                      from public.producao_3d_jobs j
                      join public.orcamento_3d_placas pl on pl.id = j.placa_id
                     where j.maquina_id = x.id
                       and j.status in ('planejado', 'aguardando_material', 'em_impressao', 'pausado')
                       and not (j.os_id = p_os_id and j.status = 'planejado' and j.agenda_id is null))::bigint
                  order by x.ord)
    into v_carga from unnest(v_ids) with ordinality as x(id, ord);
  v_cont := array_fill(0, array[array_length(v_ids, 1)]);

  for v_job in
    select j.id, j.maquina_id, coalesce(pl.tempo_estimado_segundos, 0)
             + (coalesce(pl.setup_minutos, 0) + coalesce(pl.resfriamento_minutos, 0)
                + coalesce(pl.retirada_minutos, 0)) * 60 as seg
      from public.producao_3d_jobs j
      join public.orcamento_3d_placas pl on pl.id = j.placa_id
     where j.os_id = p_os_id and j.status = 'planejado' and j.agenda_id is null
     order by j.repeticao, j.id
  loop
    v_pos := 1;
    for v_k in 2..array_length(v_ids, 1) loop
      if v_carga[v_k] < v_carga[v_pos] then v_pos := v_k; end if;
    end loop;
    v_carga[v_pos] := v_carga[v_pos] + v_job.seg;
    v_cont[v_pos] := v_cont[v_pos] + 1;
    if v_job.maquina_id is distinct from v_ids[v_pos] then
      update public.producao_3d_jobs set maquina_id = v_ids[v_pos] where id = v_job.id;
      v_movidos := v_movidos + 1;
    end if;
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object('maquina_id', x.id, 'nome', m.nome, 'jobs', v_cont[x.ord::int])
                            order by x.ord), '[]'::jsonb)
    into v_resumo from unnest(v_ids) with ordinality as x(id, ord) join public.maquinas m on m.id = x.id;
  return jsonb_build_object('movidos', v_movidos, 'por_maquina', v_resumo);
end; $function$;

REVOKE ALL ON FUNCTION public.redistribuir_jobs_3d_da_os(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.redistribuir_jobs_3d_da_os(uuid, uuid[]) TO authenticated, service_role;
