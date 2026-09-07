-- Compromissos: o que a casa deve TODO MÊS, e por quantos meses ainda.
--
-- O sistema tinha `contas_pagar` com um par de campos `recorrente` e
-- `periodicidade`. Marcar "recorrente" não fazia nada: nenhuma função, nenhum
-- cron, nenhum gatilho lia esses campos. A próxima parcela simplesmente nunca
-- aparecia. É a trava que só existe na tela — a caixinha dá a sensação de que
-- o sistema vai lembrar, e ninguém lembra.
--
-- Também não havia como responder as perguntas que um financiamento faz:
--
--   quanto ainda devo?          não existia saldo devedor
--   estou na parcela quantos?   não existia número de parcela
--   quando acaba?               não existia total de parcelas
--   quanto sai por mês?         só somando linhas soltas na mão
--
-- Este módulo separa o COMPROMISSO (o contrato: 36 × R$ 1.750,38, todo dia 15)
-- da PARCELA (a conta a pagar de setembro). O compromisso é o que se assina; a
-- parcela é o que se paga. Sem essa separação, um financiamento de 36 meses são
-- 36 linhas soltas que ninguém sabe que pertencem à mesma dívida.

-- ---------------------------------------------------------------------------
-- 1. O compromisso.
-- ---------------------------------------------------------------------------
create table if not exists public.compromissos_financeiros (
  id uuid primary key default gen_random_uuid(),
  descricao text not null,
  credor text not null,
  credor_documento text,
  tipo text not null default 'outro'
    check (tipo in ('financiamento','locacao','aluguel','assinatura','emprestimo','imposto','consorcio','outro')),
  categoria text,
  numero_contrato text,

  valor_parcela numeric not null check (valor_parcela > 0),
  -- NULL = sem fim (aluguel, assinatura). Um financiamento sempre tem número.
  total_parcelas integer check (total_parcelas is null or total_parcelas > 0),
  primeira_parcela date not null,
  periodicidade text not null default 'mensal'
    check (periodicidade in ('semanal','quinzenal','mensal','bimestral','trimestral','semestral','anual')),

  valor_entrada numeric not null default 0,
  -- Coluna gerada: entrada + parcelas. Deixar alguém digitar o total abre a
  -- porta para o total não bater com as parcelas — e aí não se sabe em qual
  -- dos dois acreditar.
  valor_total numeric generated always as
    (valor_entrada + (coalesce(total_parcelas, 0) * valor_parcela)) stored,

  maquina_id uuid references public.maquinas(id) on delete set null,
  documento_url text,
  observacoes text,

  ativo boolean not null default true,
  encerrado_em date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

comment on table public.compromissos_financeiros is
  'Obrigação recorrente ou parcelada: financiamento, locação, aluguel, assinatura. Gera as contas a pagar; não é uma conta a pagar.';
comment on column public.compromissos_financeiros.total_parcelas is
  'NULL para compromisso sem fim (aluguel, assinatura). Financiamento e locação sempre têm número.';
comment on column public.compromissos_financeiros.primeira_parcela is
  'Data de vencimento da PRIMEIRA parcela. As demais saem dela pela periodicidade — o dia do mês vem daqui.';
comment on column public.compromissos_financeiros.maquina_id is
  'Quando o compromisso paga um equipamento. É o que liga a parcela do mês à hora-máquina do orçamento.';

create index if not exists compromissos_ativo_idx on public.compromissos_financeiros (ativo, primeira_parcela);
create index if not exists compromissos_maquina_idx on public.compromissos_financeiros (maquina_id);
create unique index if not exists compromissos_contrato_unico
  on public.compromissos_financeiros (numero_contrato) where numero_contrato is not null;

alter table public.compromissos_financeiros enable row level security;

-- Leitura acompanha o resto do financeiro; escrita é mais estreita: assumir uma
-- obrigação de 36 meses não é lançar a conta de luz.
drop policy if exists "compromissos leitura financeiro" on public.compromissos_financeiros;
create policy "compromissos leitura financeiro" on public.compromissos_financeiros
  for select using (
    public.has_role((select auth.uid()),'admin') or public.can_see_financials((select auth.uid()))
  );

drop policy if exists "compromissos escrita gestao" on public.compromissos_financeiros;
create policy "compromissos escrita gestao" on public.compromissos_financeiros
  for all using (
    public.has_role((select auth.uid()),'admin')
    or public.has_role((select auth.uid()),'gestor')
    or public.has_role((select auth.uid()),'financeiro')
  ) with check (
    public.has_role((select auth.uid()),'admin')
    or public.has_role((select auth.uid()),'gestor')
    or public.has_role((select auth.uid()),'financeiro')
  );

grant select, insert, update, delete on public.compromissos_financeiros to authenticated;

drop trigger if exists tg_compromissos_updated_at on public.compromissos_financeiros;
create trigger tg_compromissos_updated_at
  before update on public.compromissos_financeiros
  for each row execute function public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- 2. A parcela sabe de qual compromisso veio.
--
-- O índice único é o que impede a falha mais cara deste módulo: clicar duas
-- vezes em "gerar parcelas" e duplicar 36 contas a pagar. Sem ele a geração
-- teria que confiar em quem clica.
-- ---------------------------------------------------------------------------
alter table public.contas_pagar
  add column if not exists compromisso_id uuid references public.compromissos_financeiros(id) on delete set null,
  add column if not exists parcela_numero integer;

create unique index if not exists contas_pagar_parcela_unica
  on public.contas_pagar (compromisso_id, parcela_numero)
  where compromisso_id is not null;

create index if not exists contas_pagar_compromisso_idx on public.contas_pagar (compromisso_id);

comment on column public.contas_pagar.parcela_numero is
  'Qual parcela do compromisso é esta. Junto com compromisso_id tem índice único: gerar duas vezes não duplica.';

grant select (compromisso_id, parcela_numero) on public.contas_pagar to authenticated;
grant insert (compromisso_id, parcela_numero) on public.contas_pagar to authenticated;
grant update (compromisso_id, parcela_numero) on public.contas_pagar to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Gerar as parcelas.
--
-- Idempotente por construção: insere só o que falta. Rodar de novo depois de
-- pagar metade não desfaz nada nem duplica.
-- ---------------------------------------------------------------------------
create or replace function public.gerar_parcelas_compromisso(
  p_compromisso_id uuid,
  p_ate date default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_c public.compromissos_financeiros%rowtype;
  v_passo interval;
  v_limite date;
  v_i integer;
  v_venc date;
  v_criadas integer := 0;
  v_ajustadas integer := 0;
  v_total integer;
begin
  if not (public.has_role(auth.uid(),'admin')
          or public.has_role(auth.uid(),'gestor')
          or public.has_role(auth.uid(),'financeiro')) then
    raise exception 'Sem permissão para gerar parcelas de compromisso';
  end if;

  select * into v_c from public.compromissos_financeiros where id = p_compromisso_id;
  if not found then raise exception 'Compromisso não encontrado'; end if;

  v_passo := case v_c.periodicidade
    when 'semanal'    then interval '7 days'
    when 'quinzenal'  then interval '15 days'
    when 'mensal'     then interval '1 month'
    when 'bimestral'  then interval '2 months'
    when 'trimestral' then interval '3 months'
    when 'semestral'  then interval '6 months'
    when 'anual'      then interval '1 year'
  end;

  -- Compromisso sem fim precisa de um horizonte, senão o laço não para. Doze
  -- meses à frente é o que o fluxo de caixa consegue usar.
  v_limite := coalesce(p_ate, current_date + interval '12 months');
  v_total := v_c.total_parcelas;

  if v_total is null then
    -- Quantos passos cabem entre a primeira parcela e o horizonte.
    v_total := 1;
    while (v_c.primeira_parcela + (v_total * v_passo))::date <= v_limite loop
      v_total := v_total + 1;
    end loop;
  end if;

  for v_i in 1..v_total loop
    v_venc := (v_c.primeira_parcela + ((v_i - 1) * v_passo))::date;

    insert into public.contas_pagar
      (descricao, fornecedor, categoria, valor, vencimento, status,
       recorrente, periodicidade, compromisso_id, parcela_numero, observacoes)
    values (
      v_c.descricao || ' — parcela ' || v_i ||
        case when v_c.total_parcelas is not null then '/' || v_c.total_parcelas else '' end,
      v_c.credor,
      coalesce(v_c.categoria, v_c.tipo),
      v_c.valor_parcela,
      v_venc,
      -- Enum status_conta_pagar: aberta | paga | atrasada | cancelada.
      -- 'pendente' parece o nome certo e não existe — o INSERT estourava.
      'aberta'::status_conta_pagar,
      true,
      v_c.periodicidade,
      v_c.id,
      v_i,
      v_c.numero_contrato
    )
    -- O índice único faz o trabalho: a parcela que já existe é ignorada, tenha
    -- ela sido paga, editada ou cancelada. Gerar de novo nunca mexe no passado.
    on conflict (compromisso_id, parcela_numero) where compromisso_id is not null
    do nothing;

    if found then
      v_criadas := v_criadas + 1;
    else
      -- Data ou valor corrigidos depois de gerar? As parcelas EM ABERTO seguem
      -- o contrato. As pagas e as canceladas ficam como estão: o que já saiu do
      -- caixa não se reescreve. É o que faz "corrija a data e gere de novo"
      -- funcionar de verdade, em vez de deixar 36 linhas com a data velha.
      update public.contas_pagar
         set vencimento = v_venc, valor = v_c.valor_parcela, updated_at = now()
       where compromisso_id = v_c.id
         and parcela_numero = v_i
         and status not in ('paga','cancelada')
         and (vencimento <> v_venc or valor <> v_c.valor_parcela);
      if found then v_ajustadas := v_ajustadas + 1; end if;
    end if;
  end loop;

  return jsonb_build_object(
    'compromisso_id', v_c.id,
    'parcelas_criadas', v_criadas,
    'parcelas_ajustadas', v_ajustadas,
    'parcelas_previstas', v_total,
    'horizonte', v_limite,
    'sem_fim', v_c.total_parcelas is null
  );
end;
$$;

comment on function public.gerar_parcelas_compromisso is
  'Materializa as parcelas do compromisso em contas_pagar. Idempotente: insere o que falta e realinha as EM ABERTO ao contrato; nunca reescreve parcela paga.';

grant execute on function public.gerar_parcelas_compromisso(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Marcar como pagas as parcelas anteriores à entrada no sistema.
--
-- Um contrato assinado em maio chega ao sistema em setembro com quatro parcelas
-- já pagas. Sem isso elas nasceriam TODAS atrasadas e o painel gritaria por uma
-- dívida que não existe.
--
-- NÃO cria movimento de caixa. Aquele dinheiro saiu de uma conta bancária que
-- este sistema nunca acompanhou; inventar lançamento retroativo faria o saldo e
-- a conciliação mentirem. Marca a obrigação como cumprida e para por aí.
-- ---------------------------------------------------------------------------
create or replace function public.quitar_parcelas_ate(
  p_compromisso_id uuid,
  p_ate date
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_qtd integer;
begin
  if not (public.has_role(auth.uid(),'admin')
          or public.has_role(auth.uid(),'gestor')
          or public.has_role(auth.uid(),'financeiro')) then
    raise exception 'Sem permissão para quitar parcelas';
  end if;

  update public.contas_pagar
     set status = 'paga',
         data_pagamento = vencimento,
         observacoes = coalesce(observacoes || ' · ', '') || 'quitada antes da entrada no sistema',
         updated_at = now()
   where compromisso_id = p_compromisso_id
     and vencimento <= p_ate
     and status not in ('paga','cancelada');

  get diagnostics v_qtd = row_count;

  -- Contar o que a escrita fez, não supor que fez: policy ou filtro podem
  -- deixar o UPDATE atingir zero linha e devolver sucesso do mesmo jeito.
  return jsonb_build_object('parcelas_quitadas', v_qtd, 'ate', p_ate);
end;
$$;

comment on function public.quitar_parcelas_ate is
  'Marca como pagas as parcelas vencidas até a data. Não cria movimento de caixa: o dinheiro saiu antes do sistema existir e inventar lançamento faria a conciliação mentir.';

grant execute on function public.quitar_parcelas_ate(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. A visão que responde as quatro perguntas.
-- ---------------------------------------------------------------------------
drop view if exists public.vw_compromissos;
create view public.vw_compromissos
with (security_invoker = true) as
select
  c.id,
  c.descricao,
  c.credor,
  c.tipo,
  c.categoria,
  c.numero_contrato,
  c.valor_parcela,
  c.total_parcelas,
  c.primeira_parcela,
  c.periodicidade,
  c.valor_entrada,
  c.valor_total,
  c.maquina_id,
  m.nome as maquina_nome,
  c.documento_url,
  c.observacoes,
  c.ativo,
  c.encerrado_em,

  count(p.id)                                            as parcelas_geradas,
  count(p.id) filter (where p.status = 'paga')           as parcelas_pagas,
  coalesce(sum(p.valor) filter (where p.status = 'paga'), 0) as valor_pago,
  -- Cancelada não é dívida: fica fora de aberto e de atrasado.
  count(p.id) filter (where p.status not in ('paga','cancelada')) as parcelas_abertas,
  coalesce(sum(p.valor) filter (where p.status not in ('paga','cancelada')), 0) as valor_aberto,
  -- Atraso vem da DATA, não do status: nada no sistema promove 'aberta' para
  -- 'atrasada', então confiar no status esconderia todo vencido.
  count(p.id) filter (where p.status not in ('paga','cancelada') and p.vencimento < current_date) as parcelas_atrasadas,
  coalesce(sum(p.valor) filter (where p.status not in ('paga','cancelada') and p.vencimento < current_date), 0) as valor_atrasado,
  min(p.vencimento) filter (where p.status not in ('paga','cancelada')) as proximo_vencimento,
  max(p.vencimento) filter (where p.status not in ('paga','cancelada')) as ultimo_vencimento,

  -- Saldo devedor é o que FALTA pagar do contrato, não o que ainda não foi
  -- gerado: num compromisso sem fim as duas coisas não são a mesma.
  case when c.total_parcelas is not null
       then c.total_parcelas * c.valor_parcela
            - coalesce(sum(p.valor) filter (where p.status = 'paga'), 0)
  end as saldo_devedor

from public.compromissos_financeiros c
left join public.maquinas m on m.id = c.maquina_id
left join public.contas_pagar p on p.compromisso_id = c.id
group by c.id, m.nome;

comment on view public.vw_compromissos is
  'Compromisso com o que já foi pago, o que está em aberto, o que atrasou e quanto ainda falta.';

grant select on public.vw_compromissos to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Os dois contratos que já estão correndo.
--
-- Datas da primeira parcela INFERIDAS do contrato: nenhum dos dois traz o
-- cronograma, só o dia do vencimento. Assumi o primeiro dia de vencimento
-- depois da assinatura. Se estiver errado, corrigir aqui muda todas as
-- parcelas — por isso está escrito na observação do próprio registro, e não só
-- num comentário de migração que ninguém abre.
-- ---------------------------------------------------------------------------
insert into public.compromissos_financeiros
  (descricao, credor, credor_documento, tipo, categoria, numero_contrato,
   valor_parcela, total_parcelas, primeira_parcela, periodicidade,
   valor_entrada, maquina_id, observacoes)
select
  'Locação Plotter de Impressão i1600 180 Eco',
  'BLIPS SOLUCOES EM ATIVOS LTDA',
  '35.914.008/0001-48',
  'locacao',
  'equipamento',
  '12608505',
  2309.00, 36, date '2026-06-05', 'mensal',
  2309.00,
  (select id from public.maquinas where numero_serie = '12608505'),
  'Contrato de 25/05/2026, vencimento todo dia 05, sinal de R$ 2.309,00 por PIX. Fiador: Hermerson Harison Rodrigues Pinheiro. Total da locação R$ 83.124,00. PRIMEIRA PARCELA INFERIDA (05/06/2026): o contrato traz só o dia do vencimento, não o cronograma — confira no boleto e corrija se preciso.'
where not exists (select 1 from public.compromissos_financeiros where numero_contrato = '12608505');

insert into public.compromissos_financeiros
  (descricao, credor, credor_documento, tipo, categoria, numero_contrato,
   valor_parcela, total_parcelas, primeira_parcela, periodicidade,
   valor_entrada, maquina_id, observacoes)
select
  'Financiamento CNC Laser 10060 + Ruida + Chiller 5000 + Exaustor',
  'IDEAL COMMERCE LTDA',
  '28.780.537/0001-30',
  'financiamento',
  'equipamento',
  '12608350',
  1750.38, 36, date '2026-06-15', 'mensal',
  3966.00,
  (select id from public.maquinas where numero_serie = 'FD2D54'),
  'Contrato de 22/05/2026, vencimento todo dia 15, 1º sinal de R$ 3.966,00 por PIX. Saldo pré-aprovado na instituição financeira R$ 27.529,81; equipamento em garantia fiduciária (retomada em caso de inadimplência). 36 × R$ 1.750,38 + sinal = R$ 66.979,68. PRIMEIRA PARCELA INFERIDA (15/06/2026): o contrato traz só o dia do vencimento, não o cronograma — confira no boleto e corrija se preciso.'
where not exists (select 1 from public.compromissos_financeiros where numero_contrato = '12608350');

-- Os contratos também completam a ficha das máquinas, que estava pela metade:
-- a do CNC não tinha parcela e a da impressora não tinha total.
update public.maquinas_contrato c
   set valor_parcela = 1750.38,
       parcelas = 36,
       entrada_valor = 3966.00,
       entrada_forma = 'PIX',
       numero_contrato = coalesce(numero_contrato, '12608350'),
       atualizado_em = now()
  from public.maquinas m
 where m.id = c.maquina_id and m.numero_serie = 'FD2D54'
   and c.valor_parcela is null;

update public.maquinas_contrato c
   set valor_total = 83124.00,
       parcelas = 36,
       entrada_valor = 2309.00,
       entrada_forma = 'PIX',
       numero_contrato = coalesce(numero_contrato, '12608505'),
       atualizado_em = now()
  from public.maquinas m
 where m.id = c.maquina_id and m.numero_serie = '12608505'
   and c.valor_total is null;

-- A observação do i1600 carrega uma ambiguidade real do contrato, e ela mora no
-- registro em vez de num comentário de migração que ninguém abre.
update public.compromissos_financeiros
   set observacoes = observacoes || ' ATENÇÃO — DUAS LEITURAS POSSÍVEIS: o contrato diz "valor total da locação R$ 83.124,00", que é exatamente 36 × R$ 2.309,00. O sinal de R$ 2.309,00 é do mesmo valor de uma parcela: ou é a 1ª parcela adiantada (total 36 pagamentos = R$ 83.124,00), ou é entrada por cima (total 37 pagamentos = R$ 85.433,00). O sistema está com a segunda leitura. A diferença é uma parcela inteira — confira no boleto.'
 where numero_contrato = '12608505'
   and observacoes not like '%DUAS LEITURAS%';

-- ---------------------------------------------------------------------------
-- 7. As 72 parcelas dos dois contratos.
--
-- Mesma regra da função, escrita aqui porque a função checa `auth.uid()` e uma
-- migração roda sem sessão. Nascem TODAS em aberto de propósito: sete já
-- venceram, e marcar como paga o que talvez esteja atrasado esconderia dívida
-- real. A tela mostra quantas venceram e oferece quitar de uma vez.
-- ---------------------------------------------------------------------------
insert into public.contas_pagar
  (descricao, fornecedor, categoria, valor, vencimento, status,
   recorrente, periodicidade, compromisso_id, parcela_numero, observacoes)
select c.descricao || ' — parcela ' || i || '/' || c.total_parcelas, c.credor,
       coalesce(c.categoria, c.tipo), c.valor_parcela,
       (c.primeira_parcela + ((i - 1) * interval '1 month'))::date,
       'aberta'::status_conta_pagar, true, 'mensal', c.id, i, c.numero_contrato
from public.compromissos_financeiros c cross join generate_series(1, 36) as i
where c.numero_contrato in ('12608505','12608350')
on conflict (compromisso_id, parcela_numero) where compromisso_id is not null do nothing;
