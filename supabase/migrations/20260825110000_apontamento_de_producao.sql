-- Apontamento de produção por máquina: fechar o ciclo do custo.
--
-- Diagnóstico: `apontamentos_producao` guarda OS, máquina, etapa, operador e
-- horário — e nada nunca escreveu nela. Sem apontamento, o custo de máquina não
-- existe, o previsto do orçamento nunca ganha um realizado para comparar, e
-- `fechar_os` fica travado em "custos_operacionais" para sempre.
--
-- O apontamento fechado VIRA custo: horas × custo/hora da máquina, gravado em
-- custos_operacionais_os na categoria 'maquina'. É esse elo que faz o orçamento
-- e a produção falarem a mesma língua.

-- O gestor precisa enxergar a produção que ele cobra; a leitura da máquina
-- também estava só com o admin, e sem ela nem a lista de máquinas abre.
insert into public.perfil_permissoes (perfil, permissao)
select 'gestor', p
from unnest(array['producao.read','maquinas.read']) as p
on conflict do nothing;

insert into public.perfil_permissoes (perfil, permissao)
values ('operador','maquinas.read')
on conflict do nothing;

alter table public.apontamentos_producao enable row level security;

drop policy if exists "apontamento read" on public.apontamentos_producao;
create policy "apontamento read" on public.apontamentos_producao
  for select using (
    has_permission((select auth.uid()), 'producao.read')
    or has_permission((select auth.uid()), 'custos.read')
  );

drop policy if exists "apontamento write" on public.apontamentos_producao;
create policy "apontamento write" on public.apontamentos_producao
  for all using (has_permission((select auth.uid()), 'producao.start'))
  with check (has_permission((select auth.uid()), 'producao.start'));

create index if not exists idx_apontamento_os on public.apontamentos_producao (os_id, iniciado_em desc);
-- Um apontamento aberto por máquina: o índice é o que garante a regra, não só a
-- verificação na função — duas telas simultâneas passariam pela verificação.
create unique index if not exists idx_apontamento_maquina_aberto
  on public.apontamentos_producao (maquina_id) where finalizado_em is null;

-- ---------------------------------------------------------------------------
-- Começar a produzir.
-- ---------------------------------------------------------------------------
create or replace function public.iniciar_apontamento(
  p_os_id uuid,
  p_maquina_id uuid,
  p_etapa text default null
) returns public.apontamentos_producao
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid;
  v_maquina public.maquinas%rowtype;
  v_apontamento public.apontamentos_producao%rowtype;
begin
  v_uid := public.require_permission('producao.start');

  select * into v_maquina from public.maquinas where id = p_maquina_id;
  if not found then raise exception 'Máquina não encontrada'; end if;
  if not v_maquina.ativa then raise exception 'A máquina % está inativa.', v_maquina.nome; end if;

  -- Máquina faz um trabalho por vez. Sem esta trava, duas OS marcariam a mesma
  -- máquina no mesmo horário e o custo sairia dobrado.
  if exists (
    select 1 from public.apontamentos_producao a
    where a.maquina_id = p_maquina_id and a.finalizado_em is null
  ) then
    raise exception 'A máquina % já está com um apontamento aberto. Finalize antes de começar outro.', v_maquina.nome;
  end if;

  insert into public.apontamentos_producao (os_id, maquina_id, etapa, setor, operador_id, iniciado_em)
  values (p_os_id, p_maquina_id, nullif(btrim(p_etapa), ''), v_maquina.setor, v_uid, now())
  returning * into v_apontamento;

  return v_apontamento;
end;
$$;

comment on function public.iniciar_apontamento is
  'Abre o apontamento de produção. Recusa se a máquina já tiver um aberto.';

revoke all on function public.iniciar_apontamento(uuid, uuid, text) from public;
grant execute on function public.iniciar_apontamento(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Terminar — e virar custo.
-- ---------------------------------------------------------------------------
create or replace function public.finalizar_apontamento(
  p_apontamento_id uuid,
  p_quantidade numeric default null,
  p_observacoes text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid;
  v_a public.apontamentos_producao%rowtype;
  v_maquina public.maquinas%rowtype;
  v_horas numeric;
  v_custo numeric;
begin
  v_uid := public.require_permission('producao.finish');

  select * into v_a from public.apontamentos_producao where id = p_apontamento_id for update;
  if not found then raise exception 'Apontamento não encontrado'; end if;
  if v_a.finalizado_em is not null then raise exception 'Este apontamento já foi finalizado.'; end if;

  update public.apontamentos_producao
     set finalizado_em = now(),
         quantidade = coalesce(p_quantidade, quantidade),
         observacoes = coalesce(nullif(btrim(p_observacoes), ''), observacoes)
   where id = p_apontamento_id
   returning * into v_a;

  select * into v_maquina from public.maquinas where id = v_a.maquina_id;
  v_horas := round(extract(epoch from (v_a.finalizado_em - v_a.iniciado_em))::numeric / 3600, 4);

  -- Máquina sem custo/hora cadastrado NÃO gera lançamento de R$ 0,00: um custo
  -- zerado no resultado da OS mente pior que um custo ausente, porque parece
  -- que a conta foi feita. Devolve o aviso para a tela cobrar o cadastro.
  if coalesce(v_maquina.custo_hora, 0) <= 0 then
    return jsonb_build_object(
      'apontamento_id', v_a.id,
      'horas', v_horas,
      'custo_gerado', false,
      'aviso', format('A máquina %s não tem custo/hora cadastrado — o tempo foi registrado, mas não virou custo.', v_maquina.nome)
    );
  end if;

  v_custo := round(v_horas * v_maquina.custo_hora, 2);

  insert into public.custos_operacionais_os
    (os_id, categoria, origem, quantidade, valor_unitario, usuario_id, data)
  values
    (v_a.os_id, 'maquina', 'apontamento', v_horas, v_maquina.custo_hora, v_uid, v_a.finalizado_em);

  return jsonb_build_object(
    'apontamento_id', v_a.id,
    'horas', v_horas,
    'custo_gerado', true,
    'custo', v_custo,
    'maquina', v_maquina.nome
  );
end;
$$;

comment on function public.finalizar_apontamento is
  'Fecha o apontamento e lança o custo de máquina (horas × custo/hora) na OS.';

revoke all on function public.finalizar_apontamento(uuid, numeric, text) from public;
grant execute on function public.finalizar_apontamento(uuid, numeric, text) to authenticated;
