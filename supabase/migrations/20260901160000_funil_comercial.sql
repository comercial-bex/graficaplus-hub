-- Funil comercial: do lead até a peça entregue.
--
-- Os elos existiam todos — `orcamentos.lead_id`, `ordens_servico.orcamento_id`,
-- `leads.cliente_id` — e a função oficial `converter_lead_em_cliente` está
-- pronta há tempo. Só que a tela de Leads apenas CRIA lead: nunca converte, e
-- nunca liga o lead ao orçamento que ele gerou.
--
-- O efeito é que a origem comercial se perde. Não dá para dizer quanto o
-- Instagram trouxe, quanto veio de indicação, nem quantos orçamentos morreram
-- sem resposta — que é a pergunta que decide onde gastar em divulgação.

create or replace function public.funil_comercial(
  p_inicio date default (current_date - interval '90 days')::date,
  p_fim date default current_date
)
returns table (
  lead_id uuid,
  nome text,
  origem text,
  campanha text,
  etapa text,
  status text,
  valor_potencial numeric,
  criado_em timestamptz,
  cliente_id uuid,
  cliente text,
  orcamentos integer,
  valor_orcado numeric,
  orcamentos_aprovados integer,
  ordens integer,
  valor_fechado numeric,
  ordens_concluidas integer,
  estagio text,
  dias_parado integer
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
           count(*) filter (where o.status in ('aprovado','convertido'))::int as aprovados
    from public.orcamentos o
    where o.lead_id is not null
    group by o.lead_id
  ),
  os as (
    select o.lead_id,
           count(distinct s.id)::int as qtd,
           coalesce(sum(distinct s.valor_total), 0) as valor,
           count(distinct s.id) filter (where s.status in ('concluido','faturado'))::int as concluidas
    from public.orcamentos o
    join public.ordens_servico s on s.orcamento_id = o.id
    where o.lead_id is not null
    group by o.lead_id
  )
  select l.id,
         l.nome,
         coalesce(l.origem, 'Não informada'),
         l.campanha,
         l.etapa,
         l.status,
         coalesce(l.valor_potencial, 0),
         l.created_at,
         l.cliente_id,
         c.nome,
         coalesce(orc.qtd, 0),
         round(coalesce(orc.valor, 0), 2),
         coalesce(orc.aprovados, 0),
         coalesce(os.qtd, 0),
         round(coalesce(os.valor, 0), 2),
         coalesce(os.concluidas, 0),
         -- O estágio é o ponto mais avançado que o lead alcançou. Ler pelo
         -- `status` do lead sozinho mentiria: ninguém volta na tela de leads
         -- para marcar "virou cliente" depois que o orçamento foi aprovado.
         case
           when coalesce(os.concluidas, 0) > 0 then 'entregue'
           when coalesce(os.qtd, 0) > 0 then 'em producao'
           when coalesce(orc.aprovados, 0) > 0 then 'fechado'
           when coalesce(orc.qtd, 0) > 0 then 'orcado'
           when l.status = 'perdido' or l.motivo_perda is not null then 'perdido'
           when l.cliente_id is not null then 'cliente'
           else 'lead'
         end,
         -- Quantos dias sem nenhum movimento. É o número que mostra o que está
         -- apodrecendo no funil.
         greatest(0, (current_date - coalesce(l.updated_at, l.created_at)::date))::int
  from public.leads l
  left join public.clientes c on c.id = l.cliente_id
  left join orc on orc.lead_id = l.id
  left join os on os.lead_id = l.id
  where l.created_at::date between p_inicio and p_fim
    and coalesce(l.temporario, false) = false
  order by l.created_at desc
$$;

comment on function public.funil_comercial is
  'Do lead à peça entregue: o que entrou, o que virou venda e o que parou no caminho.';

grant execute on function public.funil_comercial(date, date) to authenticated;

-- O vendedor precisa enxergar o funil que ele alimenta.
insert into public.perfil_permissoes (perfil, permissao)
values ('vendedor','leads.convert'), ('gestor','leads.convert')
on conflict do nothing;

create index if not exists idx_orcamentos_lead on public.orcamentos (lead_id) where lead_id is not null;
create index if not exists idx_leads_periodo on public.leads (created_at desc);
