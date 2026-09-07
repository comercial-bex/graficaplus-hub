-- Custo/hora calculado do contrato, em vez de digitado de cabeça.
--
-- As 5 máquinas estão com `custo_hora` = 0. O efeito é o pior tipo de zero: a
-- hora de máquina e a energia saem ZERO do orçamento, a peça é vendida sem o
-- custo do equipamento, e o número parece um número.
--
-- Pedir para você digitar não resolve — ninguém sabe de cabeça quanto custa a
-- hora de uma máquina. Mas o sistema agora tem os insumos:
--
--   i1600      Locação Especial 36 meses · R$ 2.309,00/mês
--   CNC 10060  Financiado · R$ 66.979,68
--   Bambu A1   já calculada por depreciação em maquinas_3d_config (R$ 1,375/h)
--
-- São dois regimes diferentes e a conta muda entre eles:
--
--   LOCAÇÃO      a parcela é custo mensal recorrente. Custo/hora = parcela
--                dividida pelas horas produtivas do mês. Parar a máquina não
--                reduz o custo — por isso a hora ociosa encarece a hora usada.
--
--   COMPRA       o valor é gasto de uma vez e se dilui pela vida útil.
--                Custo/hora = (valor - residual) / vida útil em horas.
--
-- Usar depreciação numa máquina alugada subestima; usar aluguel numa comprada
-- superestima. Por isso a função escolhe pelo tipo de contrato, e diz qual
-- método usou.

-- `to_char` sozinho segue o lc_numeric do servidor, que aqui está em inglês:
-- a memória de cálculo sairia "66,979.68" para quem lê em português.
create or replace function public.fmt_brl(p numeric)
returns text language sql immutable as $$
  select translate(to_char(coalesce(p,0), 'FM9G999G999G990D00'), '.,', ',.')
$$;

comment on function public.fmt_brl is
  'Número em pt-BR (1.234,56), independente do lc_numeric do servidor.';

alter table public.maquinas
  add column if not exists horas_produtivas_mensais numeric,
  add column if not exists vida_util_horas numeric,
  add column if not exists valor_residual numeric;

comment on column public.maquinas.horas_produtivas_mensais is
  'Horas que a máquina realmente produz por mês. Não é a jornada da oficina: é o tempo com a máquina rodando.';
comment on column public.maquinas.vida_util_horas is
  'Horas de vida útil estimada. Usada para diluir o valor de máquina comprada.';

grant select (horas_produtivas_mensais, vida_util_horas, valor_residual) on public.maquinas to authenticated;
grant insert (horas_produtivas_mensais, vida_util_horas, valor_residual) on public.maquinas to authenticated;
grant update (horas_produtivas_mensais, vida_util_horas, valor_residual) on public.maquinas to authenticated;

-- ---------------------------------------------------------------------------
-- A sugestão, com a conta à mostra.
--
-- Devolve o valor E a memória de cálculo. Número de custo sem a conta ao lado é
-- número que ninguém confere — e este vai para dentro do preço de venda.
--
-- SECURITY DEFINER porque lê `maquinas_contrato`, que é restrita a financeiro:
-- a função é quem decide, e ela só devolve o custo/hora, nunca o valor do
-- contrato. Assim o gestor que parametriza a máquina vê a hora sem ver a
-- parcela.
-- ---------------------------------------------------------------------------
create or replace function public.custo_hora_sugerido(p_maquina_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_m public.maquinas%rowtype;
  v_c public.maquinas_contrato%rowtype;
  v_horas numeric;
  v_vida numeric;
  v_valor numeric;
  v_custo numeric;
  v_metodo text;
  v_conta text;
begin
  perform public.require_permission('maquinas.read');

  select * into v_m from public.maquinas where id = p_maquina_id;
  if not found then raise exception 'Máquina não encontrada'; end if;
  select * into v_c from public.maquinas_contrato where maquina_id = p_maquina_id;

  -- 160 h/mês é o padrão de uma jornada de 8 h em 20 dias. É chute explícito, e
  -- a resposta diz que é: com a hora real, o custo muda proporcionalmente.
  v_horas := coalesce(nullif(v_m.horas_produtivas_mensais, 0), 160);
  v_vida  := coalesce(nullif(v_m.vida_util_horas, 0), 10000);

  if v_c.valor_parcela is not null and v_c.valor_parcela > 0
     and coalesce(v_c.condicao_comercial, '') ilike '%loca%' then
    v_metodo := 'locacao';
    v_custo := round(v_c.valor_parcela / v_horas, 4);
    v_conta := format('R$ %s de parcela ÷ %s h produtivas por mês',
                      public.fmt_brl(v_c.valor_parcela), public.fmt_brl(v_horas));

  elsif coalesce(v_c.valor_total, 0) > 0 then
    v_metodo := 'depreciacao';
    v_valor := v_c.valor_total - coalesce(v_m.valor_residual, 0);
    v_custo := round(v_valor / v_vida, 4);
    v_conta := format('R$ %s de aquisição ÷ %s h de vida útil',
                      public.fmt_brl(v_valor), public.fmt_brl(v_vida));

  else
    -- Sem contrato não há de onde tirar. Melhor dizer isso que devolver zero
    -- com cara de resposta.
    return jsonb_build_object(
      'maquina_id', p_maquina_id,
      'custo_hora', null,
      'metodo', 'sem_dados',
      'conta', 'Sem contrato cadastrado — informe o valor de aquisição ou a parcela.',
      'horas_produtivas_mensais', v_horas,
      'horas_presumidas', v_m.horas_produtivas_mensais is null);
  end if;

  return jsonb_build_object(
    'maquina_id', p_maquina_id,
    'custo_hora', v_custo,
    'metodo', v_metodo,
    'conta', v_conta,
    'horas_produtivas_mensais', v_horas,
    'horas_presumidas', v_m.horas_produtivas_mensais is null,
    'atual', v_m.custo_hora);
end;
$$;

comment on function public.custo_hora_sugerido is
  'Custo/hora sugerido a partir do contrato: locação divide a parcela pelas horas do mês, compra dilui o valor pela vida útil. Devolve a memória de cálculo junto — número de custo sem a conta ao lado ninguém confere.';

grant execute on function public.custo_hora_sugerido(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Aplicar a sugestão.
--
-- Escrita separada da leitura de propósito: ver a sugestão é uma coisa, mandar
-- ela virar o custo que entra no preço de venda é outra, e essa segunda exige
-- gestão.
-- ---------------------------------------------------------------------------
create or replace function public.aplicar_custo_hora_sugerido(p_maquina_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_sug jsonb; v_valor numeric;
begin
  perform public.require_permission('maquinas.manage');

  v_sug := public.custo_hora_sugerido(p_maquina_id);
  v_valor := (v_sug->>'custo_hora')::numeric;

  if v_valor is null or v_valor <= 0 then
    raise exception 'Não há contrato para calcular o custo/hora desta máquina.';
  end if;

  update public.maquinas set custo_hora = v_valor, updated_at = now()
   where id = p_maquina_id;

  return v_sug || jsonb_build_object('aplicado', true);
end;
$$;

grant execute on function public.aplicar_custo_hora_sugerido(uuid) to authenticated;
