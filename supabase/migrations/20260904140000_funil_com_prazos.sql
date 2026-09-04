-- Prazos no funil, e saldo de caixa ao lado do que está em jogo.
--
-- `orcamentos` tem `data_inicio`, `prazo` e `data_entrega_prometida` desde
-- sempre — os três com ZERO preenchimento, porque NENHUMA tela os capturava.
-- O funil sabia quanto cada oportunidade vale e não sabia quando ela vence: o
-- orçamento esfriava e ninguém percebia, porque não havia data para comparar.
--
-- `validade_dias` era o único preenchido, e sozinho não diz nada — a validade
-- corre a partir do envio, que também não era gravado.
--
-- A tela de orçamento ganhou o card de Prazos (a captura), e a função abaixo
-- passa a devolver início, prazo, dias que faltam e `atrasado`.
--
-- `atrasado` é prazo vencido COM a peça ainda não entregue. Prazo passado numa
-- OS já concluída é história, não pendência — misturar os dois encheria a tela
-- de alarme falso, e alarme falso é como se para de olhar o alarme.
--
-- DROP antes: a função ganha colunas de retorno, e CREATE OR REPLACE não muda
-- assinatura de RETURNS TABLE.
drop function if exists public.funil_comercial(date, date);

create or replace function public.funil_comercial(
  p_inicio date default (current_date - interval '90 days')::date,
  p_fim date default current_date
) returns table (
  lead_id uuid, nome text, origem text, campanha text, etapa text, status text,
  valor_potencial numeric, criado_em timestamptz, cliente_id uuid, cliente text,
  orcamentos integer, valor_orcado numeric, orcamentos_aprovados integer,
  ordens integer, valor_fechado numeric, ordens_concluidas integer,
  estagio text, dias_parado integer,
  data_inicio date, prazo date, dias_para_prazo integer, atrasado boolean
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with orc as (
    select o.lead_id,
           count(*)::int as qtd,
           coalesce(sum(o.valor_total), 0) as valor,
           count(*) filter (where o.status in ('aprovado','convertido'))::int as aprovados,
           min(o.data_inicio) as data_inicio,
           -- Cai na entrega prometida quando não há prazo: para o cliente, a
           -- data que vale é a que foi combinada com ele.
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
         -- O estágio é o ponto mais avançado que o lead alcançou, lido da cadeia
         -- real: ninguém volta na tela de leads marcar "virou cliente" depois
         -- que a peça já saiu.
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
         (orc.prazo is not null and orc.prazo < current_date and coalesce(os.concluidas,0) = 0)
  from public.leads l
  left join public.clientes c on c.id = l.cliente_id
  left join orc on orc.lead_id = l.id
  left join os on os.lead_id = l.id
  where l.created_at::date between p_inicio and p_fim
    and coalesce(l.temporario,false) = false
  order by l.created_at desc
$$;

comment on function public.funil_comercial is
  'Do lead à peça entregue, com prazo. `atrasado` é prazo vencido com a peça ainda não entregue.';

grant execute on function public.funil_comercial(date, date) to authenticated;
