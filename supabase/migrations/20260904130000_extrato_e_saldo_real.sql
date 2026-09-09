-- Extrato bancário de verdade, e saldo que é saldo.
--
-- `contas_bancarias` e `banco_transacoes` existem, são bem modeladas — a segunda
-- até tem índice único em (conta_id, fitid), que é a trava certa contra importar
-- o mesmo lançamento duas vezes. E as duas têm ZERO uso no front: nenhuma tela
-- lê, nenhuma escreve. Peça modelada que nada preenche, de novo.
--
-- Enquanto isso, o "saldo real" do Fluxo de Caixa é
--
--   entradas - saídas   (só de `caixa_movimentos`)
--
-- Isso não é o saldo da conta: ignora o saldo inicial e ignora tudo que passou
-- pelo banco sem alguém lançar no sistema. É movimento líquido registrado, com
-- nome de saldo.

-- ---------------------------------------------------------------------------
-- 1. Importar extrato sem somar duas vezes.
--
-- Extrato se reimporta o tempo todo: baixa-se "últimos 30 dias" toda semana e as
-- janelas se sobrepõem. O `fitid` é a chave que o BANCO dá a cada lançamento;
-- o índice único faz o resto. `on conflict do nothing` transforma reimportação
-- em operação segura — e a função devolve quantos entraram e quantos já
-- existiam, para a tela poder dizer isso em vez de fingir que importou tudo.
-- ---------------------------------------------------------------------------
create or replace function public.importar_extrato(p_conta_id uuid, p_lancamentos jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid;
  v_total int;
  v_novos int;
begin
  v_uid := public.require_permission('financeiro.read');

  if not exists (select 1 from public.contas_bancarias c where c.id = p_conta_id and c.ativo) then
    raise exception 'Conta bancária não encontrada ou inativa';
  end if;

  v_total := coalesce(jsonb_array_length(p_lancamentos), 0);
  if v_total = 0 then
    return jsonb_build_object('recebidos', 0, 'novos', 0, 'ja_existiam', 0);
  end if;

  with entrada as (
    select (l->>'fitid') as fitid,
           (l->>'data')::date as data,
           coalesce(nullif(l->>'descricao',''), 'Lançamento sem descrição') as descricao,
           (l->>'valor')::numeric as valor,
           nullif(l->>'documento','') as documento
    from jsonb_array_elements(p_lancamentos) l
  ), inserido as (
    insert into public.banco_transacoes
      (conta_id, data, descricao, valor, tipo, documento, fitid, origem, conciliado, created_by)
    select p_conta_id, e.data, e.descricao, e.valor,
           case when e.valor >= 0 then 'credito' else 'debito' end,
           e.documento, e.fitid, 'importacao', false, v_uid
    from entrada e
    where e.fitid is not null and e.data is not null and e.valor is not null and e.valor <> 0
    on conflict (conta_id, fitid) where fitid is not null do nothing
    returning 1
  )
  select count(*)::int into v_novos from inserido;

  return jsonb_build_object(
    'recebidos', v_total,
    'novos', v_novos,
    'ja_existiam', v_total - v_novos
  );
end;
$$;

comment on function public.importar_extrato is
  'Importa lançamentos de extrato numa conta. Reimportar o mesmo arquivo é seguro: o índice único (conta_id, fitid) descarta repetidos, e a resposta diz quantos já existiam.';

grant execute on function public.importar_extrato(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Saldo real por conta.
--
--   saldo inicial + tudo que o extrato registrou a partir da data dele
--
-- `saldo_inicial_data` importa: sem ela, um extrato antigo importado depois
-- somaria movimento que o saldo inicial já continha, e a conta ficaria com
-- dinheiro que não existe.
-- ---------------------------------------------------------------------------
create or replace function public.saldo_contas_bancarias()
returns table (
  conta_id uuid, nome text, banco text, agencia text, conta text,
  saldo_inicial numeric, saldo_inicial_data date,
  lancamentos integer, entradas numeric, saidas numeric,
  saldo_atual numeric, nao_conciliados integer, ultimo_lancamento date
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select c.id, c.nome, c.banco, c.agencia, c.conta,
         coalesce(c.saldo_inicial, 0),
         c.saldo_inicial_data,
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
  group by c.id, c.nome, c.banco, c.agencia, c.conta, c.saldo_inicial, c.saldo_inicial_data
  order by c.nome
$$;

comment on function public.saldo_contas_bancarias is
  'Saldo por conta = saldo inicial + extrato a partir da data do saldo inicial. É o saldo do banco, não o movimento líquido lançado no sistema.';

grant execute on function public.saldo_contas_bancarias() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Conciliar: ligar um lançamento do banco a um movimento do caixa.
--
-- Sem isso, o mesmo dinheiro aparece duas vezes — uma no extrato e outra no
-- caixa — e somar os dois dobra o valor. A ligação é o que permite dizer "este
-- pagamento do sistema é aquela linha do banco".
-- ---------------------------------------------------------------------------
create or replace function public.conciliar_transacao(p_transacao_id uuid, p_caixa_movimento_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_uid uuid; v_t public.banco_transacoes%rowtype; v_valor numeric;
begin
  v_uid := public.require_permission('pagamentos.confirm');

  select * into v_t from public.banco_transacoes where id = p_transacao_id for update;
  if not found then raise exception 'Lançamento não encontrado'; end if;
  if v_t.conciliado then
    return jsonb_build_object('transacao_id', p_transacao_id, 'idempotent', true);
  end if;

  select valor into v_valor from public.caixa_movimentos where id = p_caixa_movimento_id;
  if not found then raise exception 'Movimento de caixa não encontrado'; end if;

  -- Valores têm que bater em módulo. Conciliar linhas de valores diferentes é
  -- esconder uma diferença, não resolvê-la.
  if round(abs(v_valor), 2) <> round(abs(v_t.valor), 2) then
    raise exception 'Valores não batem: extrato % x caixa %', v_t.valor, v_valor;
  end if;

  update public.banco_transacoes
     set conciliado = true, caixa_movimento_id = p_caixa_movimento_id
   where id = p_transacao_id;

  return jsonb_build_object('transacao_id', p_transacao_id, 'caixa_movimento_id', p_caixa_movimento_id);
end;
$$;

comment on function public.conciliar_transacao is
  'Liga um lançamento do extrato a um movimento do caixa, exigindo que os valores batam.';

grant execute on function public.conciliar_transacao(uuid, uuid) to authenticated;
