-- O 3D passa a mexer no estoque.
--
-- O motor de custo 3D é a peça mais bem construída do sistema: calcula gramas de
-- modelo, suporte, purga, torre e preparação separadas, aplica fator de
-- aproveitamento, precifica energia com tributos e reserva falha. Só que o
-- filamento consumido nunca saiu do estoque — imprimir não descontava nada.
--
-- Três coisas faltavam, nesta ordem de dependência:
--   1. unidade: filamento cadastrado em ROLO e consumido em GRAMA;
--   2. o job de produção nunca era criado — `producao_3d_jobs` não tinha produtor;
--   3. o apontamento não consumia filamento.

-- ---------------------------------------------------------------------------
-- 1. Filamento passa a ser medido em gramas.
--
-- O custo já é por grama (R$ 0,09 a R$ 0,17) e o rolo tem peso líquido conhecido.
-- Manter o estoque em rolo obrigaria a baixar fração de unidade a cada peça — e a
-- conta de desperdício, que é toda em grama, nunca fecharia com o saldo.
--
-- Momento sem risco: o estoque dos cinco filamentos está zerado, então não há
-- saldo a converter. Entrar um rolo agora é entrar `peso_liquido` gramas.
-- ---------------------------------------------------------------------------
update public.materiais m
   set unidade = 'g',
       custo_unitario = coalesce(f.custo_por_grama_calculado, m.custo_unitario),
       custo_medio = coalesce(f.custo_por_grama_calculado, m.custo_medio)
from public.materiais_3d_filamento f
where f.material_id = m.id
  and m.unidade <> 'g'
  -- Trava de segurança: só converte o que está zerado. Material com saldo em
  -- rolo precisaria de conversão explícita, e adivinhar aqui seria pior.
  and coalesce(m.estoque, 0) = 0;

-- ---------------------------------------------------------------------------
-- 2. A conversão do orçamento 3D passa a criar o job de produção.
--
-- `converter_orcamento_3d_em_os` criava OS, item, conta a receber e evento — e
-- parava aí. A tela de Produção 3D lê e atualiza job, mas nunca criou nenhum:
-- a fila de impressão nascia sempre vazia, e o apontamento não tinha em que se
-- pendurar.
--
-- Um job por placa, respeitando as repetições: a mesma placa impressa três vezes
-- é três jobs, porque cada um consome filamento e tempo de máquina próprios.
-- ---------------------------------------------------------------------------
create or replace function public.criar_jobs_3d_da_os(p_orcamento_3d_id uuid, p_os_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_placa record;
  v_repeticao int;
  v_criados int := 0;
  v_custo jsonb;
begin
  for v_placa in
    select * from public.orcamento_3d_placas
    where orcamento_3d_id = p_orcamento_3d_id
  loop
    -- `custo_previsto_snapshot` é jsonb: guarda o retrato do que se esperava
    -- gastar, não só o total. Depois da impressão dá para comparar grama a grama
    -- com o que saiu de verdade — e é essa comparação que mostra se a peça foi
    -- mal orçada ou mal impressa.
    select jsonb_build_object(
             'custo_material', coalesce(sum(c.custo_total), 0),
             'gramas_previstas', coalesce(sum(c.gramas_totais), 0),
             'tempo_estimado_segundos', v_placa.tempo_estimado_segundos,
             'materiais', coalesce(jsonb_agg(jsonb_build_object(
                 'material_id', c.material_id,
                 'gramas', c.gramas_totais,
                 'custo_por_grama', c.custo_por_grama_snapshot))
               filter (where c.material_id is not null), '[]'::jsonb)
           ) into v_custo
    from public.orcamento_3d_consumos c
    where c.placa_id = v_placa.id;

    for v_repeticao in 1..greatest(coalesce(v_placa.repeticoes, 1), 1) loop
      insert into public.producao_3d_jobs
        (os_id, orcamento_3d_id, placa_id, maquina_id, status, repeticao, custo_previsto_snapshot)
      values
        (p_os_id, p_orcamento_3d_id, v_placa.id, v_placa.maquina_id, 'planejado', v_repeticao, v_custo);
      v_criados := v_criados + 1;
    end loop;
  end loop;

  return v_criados;
end;
$$;

comment on function public.criar_jobs_3d_da_os is
  'Cria um job de produção por placa × repetição. Era o elo que faltava entre o orçamento 3D e a fila de impressão.';

grant execute on function public.criar_jobs_3d_da_os(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. O apontamento consome filamento.
--
-- Impressão concluída consome o que a placa previa. Impressão que FALHOU consome
-- o que já tinha sido extrudado até parar — e é para isso que existe
-- `percentual_consumido_antes_falha`. Filamento de peça que falhou é perda real,
-- e ignorá-la é o mesmo que dizer que retrabalho é de graça.
--
-- Gatilho, e não chamada da tela: o apontamento já é gravado direto pelo front, e
-- pendurar aqui garante que todo caminho passe pelo consumo.
-- ---------------------------------------------------------------------------
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
  -- Só consome quando a impressão terminou, de um jeito ou de outro.
  if new.resultado is null or new.resultado not in ('concluido','falha','sucesso','concluida') then
    return new;
  end if;

  select * into v_job from public.producao_3d_jobs where id = new.job_id;
  if not found then return new; end if;

  -- Falha consome só a fração extrudada; sucesso consome tudo.
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

    -- Baixa dos lotes por ordem de chegada, até onde houver.
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

    -- A movimentação registra o consumo REAL, mesmo que não houvesse lote para
    -- descontar. O filamento saiu do rolo de qualquer forma; esconder isso
    -- deixaria o histórico mentindo. O que sobra em `v_restante` é justamente o
    -- que foi consumido sem estoque registrado, e o motivo diz isso.
    insert into public.movimentacoes_estoque
      (material_id, tipo, quantidade, unidade, custo_unitario_snapshot,
       os_id, usuario_id, origem, motivo)
    values
      (v_consumo.material_id, 'saida', v_gramas, 'g', v_consumo.custo_por_grama_snapshot,
       v_job.os_id, new.operador_id, 'producao_3d',
       case
         when v_restante > 0 then
           format('Impressão 3D (%s) — %s g sem lote cadastrado', new.resultado, round(v_restante, 2))
         else format('Impressão 3D (%s)', new.resultado)
       end);

    -- Custo do material entra no resultado da OS, como na baixa da produção 2D.
    if v_job.os_id is not null then
      insert into public.custos_operacionais_os
        (os_id, categoria, origem, quantidade, valor_unitario, usuario_id)
      values
        (v_job.os_id, 'material', 'producao_3d', v_gramas,
         coalesce(v_consumo.custo_por_grama_snapshot, 0), new.operador_id);
    end if;
  end loop;

  return new;
end;
$$;

comment on function public.tg_consumir_filamento_do_apontamento is
  'Baixa o filamento ao fim da impressão. Falha consome a fração extrudada antes de parar.';

drop trigger if exists tg_consumo_filamento on public.producao_3d_apontamentos;
create trigger tg_consumo_filamento
  after insert on public.producao_3d_apontamentos
  for each row execute function public.tg_consumir_filamento_do_apontamento();

create index if not exists idx_jobs_3d_os on public.producao_3d_jobs (os_id, status);
create index if not exists idx_consumos_placa on public.orcamento_3d_consumos (placa_id);
