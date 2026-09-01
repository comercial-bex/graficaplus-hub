-- Baixa de estoque: parar de dizer "deu certo" sem mover material.
--
-- Dois defeitos silenciosos na mesma função, achados rodando o fluxo:
--
-- 1. Sem reserva, o laço percorre uma lista vazia — o que para o Postgres é
--    sucesso. A OS era marcada como "material baixado", a tela mostrava
--    confirmação, e ZERO movimentação era gravada. O estoque ficava intacto no
--    sistema e furado na prateleira.
--
-- 2. O parâmetro `p_consumos` era declarado e nunca lido. A tela deixa a pessoa
--    ajustar a quantidade de cada material antes de confirmar, e esses números
--    eram descartados no caminho — baixava-se sempre o reservado, não o
--    informado.
--
-- Erro que não aparece é pior que erro que aparece: ninguém procura o que o
-- sistema afirma ter feito.

create or replace function public.baixar_estoque_os(p_os_id uuid, p_consumos jsonb default null::jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid;
  r record;
  l record;
  v_qtd numeric;
  v_movs jsonb := '[]'::jsonb;
  v_mov uuid;
  v_reservas int;
  v_pedido numeric;
  v_restante numeric;
  v_total_baixado numeric := 0;
begin
  v_uid := public.require_permission('estoque.exit');

  perform 1 from public.ordens_servico o where o.id = p_os_id for update;
  if not found then raise exception 'OS não encontrada'; end if;

  if exists (
    select 1 from public.movimentacoes_estoque m
    where m.os_id = p_os_id and m.tipo = 'saida' and m.origem = 'baixa_os'
  ) then
    raise exception 'Estoque desta OS já foi baixado.';
  end if;

  select count(*) into v_reservas
  from public.estoque_reservas res
  where res.os_id = p_os_id and res.status in ('reservada','parcial');

  -- A recusa que faltava. Antes daqui, esta situação devolvia sucesso.
  if v_reservas = 0 then
    raise exception 'Não há material reservado para esta OS, então não há o que baixar. Gere a previsão de materiais e reserve o estoque antes de dar baixa.'
      using errcode = 'P0001';
  end if;

  for r in
    select * from public.estoque_reservas res
    where res.os_id = p_os_id and res.status in ('reservada','parcial')
    order by res.material_id
    for update
  loop
    v_restante := r.quantidade - r.quantidade_baixada;
    if v_restante <= 0 then continue; end if;

    -- Quantidade informada na tela para este material, quando houver. O que a
    -- pessoa conferiu no balcão vale mais que o previsto pela ficha técnica.
    if p_consumos is not null then
      select coalesce(sum((c->>'quantidade')::numeric), 0) into v_pedido
      from jsonb_array_elements(p_consumos) c
      where (c->>'material_id')::uuid = r.material_id;

      -- Já baixado deste material nesta rodada, para não repetir a quantidade
      -- pedida a cada lote do mesmo material.
      select coalesce(sum((m->>'quantidade')::numeric), 0) into v_total_baixado
      from jsonb_array_elements(v_movs) m
      where (m->>'material_id')::uuid = r.material_id;

      v_qtd := least(v_restante, greatest(v_pedido - v_total_baixado, 0));
    else
      v_qtd := v_restante;
    end if;

    -- Linha zerada na tela é linha ignorada de propósito.
    if v_qtd <= 0 then continue; end if;

    select * into l from public.material_lotes ml where ml.id = r.lote_id for update;
    if not found then raise exception 'Lote do material não encontrado.'; end if;
    if l.quantidade < v_qtd then
      raise exception 'O lote de % tem % e a baixa pede %.',
        (select nome from public.materiais where id = r.material_id), l.quantidade, v_qtd;
    end if;

    update public.material_lotes
       set quantidade = quantidade - v_qtd,
           quantidade_reservada = greatest(quantidade_reservada - v_qtd, 0)
     where id = r.lote_id;

    update public.estoque_reservas
       set quantidade_baixada = quantidade_baixada + v_qtd,
           status = case when quantidade_baixada + v_qtd >= quantidade then 'baixada' else 'parcial' end
     where id = r.id;

    insert into public.movimentacoes_estoque
      (material_id, lote_id, tipo, quantidade, unidade, custo_unitario_snapshot,
       os_id, os_item_id, tarefa_id, usuario_id, origem, motivo)
    values
      (r.material_id, r.lote_id, 'saida', v_qtd, l.unidade, l.custo_unitario_snapshot,
       p_os_id, r.os_item_id, r.tarefa_id, v_uid, 'baixa_os', 'Baixa transacional da OS')
    returning id into v_mov;

    insert into public.custos_operacionais_os
      (os_id, os_item_id, tarefa_id, categoria, origem, quantidade, valor_unitario, usuario_id)
    values
      (p_os_id, r.os_item_id, r.tarefa_id, 'material', 'baixa_estoque', v_qtd,
       l.custo_unitario_snapshot, v_uid);

    v_movs := v_movs || jsonb_build_object(
      'movimentacao_id', v_mov, 'material_id', r.material_id, 'quantidade', v_qtd);
  end loop;

  -- Todas as linhas zeradas: nada saiu, e dizer que saiu seria o mesmo erro de
  -- antes com outra roupa.
  if jsonb_array_length(v_movs) = 0 then
    raise exception 'Nenhuma quantidade foi informada para baixa. Ajuste os valores e confirme de novo.'
      using errcode = 'P0001';
  end if;

  update public.ordens_servico set status_producao = 'material_baixado' where id = p_os_id;
  perform public.registrar_evento_os(p_os_id, 'os', p_os_id, 'baixa_estoque',
                                     'Baixa de estoque', null,
                                     jsonb_build_object('movimentacoes', v_movs));

  return jsonb_build_object('os_id', p_os_id, 'movimentacoes', v_movs);
end;
$function$;

comment on function public.baixar_estoque_os is
  'Baixa o estoque reservado da OS. Recusa quando não há reserva ou quando nada foi informado — antes devolvia sucesso com zero movimentação.';
