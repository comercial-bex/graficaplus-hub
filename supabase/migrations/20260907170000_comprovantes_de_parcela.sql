-- Comprovante de parcela: o sistema não emite boleto, ele guarda a prova.
--
-- Harison esclareceu o papel deste módulo, e ele é mais estreito e mais útil do
-- que eu tinha construído: quem emite boleto é a financeira, quem publica o
-- cronograma é o portal do fornecedor (Blips). O Bex Print espelha esse
-- cronograma para responder quanto a casa deve, guardar o comprovante de cada
-- parcela e ir baixando até quitar.
--
-- E ao conferir o portal apareceu o motivo de esse espelho existir:
--
--   O CONTRATO ASSINADO DIZ         O BOLETO COBRA
--   parcela R$ 1.750,38             R$ 1.726,74
--   1ª em junho (inferido)          1ª em 15/08/2026
--   valor de venda R$ 66.979,68     R$ 62.162,64 financiados
--
-- Nenhum dos três é erro de digitação: o contrato registra a venda, a
-- financeira registra a dívida, e são números diferentes. Quem paga segue o
-- boleto. Por isso a coluna `cronograma_confirmado`: enquanto ela for false, os
-- valores são os do contrato e ainda não foram batidos com o título.

alter table public.compromissos_financeiros
  add column if not exists financeira text,
  add column if not exists portal_url text,
  add column if not exists cronograma_confirmado boolean not null default false;

comment on column public.compromissos_financeiros.financeira is
  'Quem emite o boleto (Bradesco, etc). O credor vende; a financeira cobra — no CNC são empresas diferentes.';
comment on column public.compromissos_financeiros.cronograma_confirmado is
  'true quando as parcelas foram conferidas no portal do fornecedor. false = valores do contrato, ainda não batidos com o boleto.';

alter table public.contas_pagar
  add column if not exists nosso_numero text;

comment on column public.contas_pagar.nosso_numero is
  'Identificador do boleto na financeira. É por ele que se acha o título no portal e se confere o comprovante.';

grant select (nosso_numero) on public.contas_pagar to authenticated;
grant insert (nosso_numero) on public.contas_pagar to authenticated;
grant update (nosso_numero) on public.contas_pagar to authenticated;

-- ---------------------------------------------------------------------------
-- Dar baixa com data real e comprovante.
-- ---------------------------------------------------------------------------
create or replace function public.baixar_parcela_compromisso(
  p_conta_id uuid,
  p_data_pagamento date,
  p_comprovante_url text default null,
  p_forma_pagamento text default null,
  p_lancar_caixa boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_p public.contas_pagar%rowtype;
  v_ja_no_caixa integer;
begin
  if not (public.has_role(auth.uid(),'admin')
          or public.has_role(auth.uid(),'gestor')
          or public.has_role(auth.uid(),'financeiro')) then
    raise exception 'Sem permissão para dar baixa em parcela';
  end if;

  select * into v_p from public.contas_pagar where id = p_conta_id;
  if not found then raise exception 'Parcela não encontrada'; end if;
  if v_p.compromisso_id is null then
    raise exception 'Esta conta não pertence a um compromisso';
  end if;

  update public.contas_pagar
     set status = 'paga',
         data_pagamento = p_data_pagamento,
         -- coalesce e não atribuição direta: dar baixa de novo para corrigir a
         -- data não pode apagar o comprovante já anexado.
         comprovante_url = coalesce(p_comprovante_url, comprovante_url),
         forma_pagamento = coalesce(p_forma_pagamento, forma_pagamento),
         updated_at = now()
   where id = p_conta_id;

  -- Movimento de caixa só se pedido E se ainda não existe. Dar baixa duas vezes
  -- na mesma parcela (corrigir a data, anexar o comprovante depois) lançaria a
  -- saída duas vezes e o saldo passaria a mentir.
  if p_lancar_caixa then
    select count(*) into v_ja_no_caixa
      from public.caixa_movimentos where conta_pagar_id = p_conta_id;
    if v_ja_no_caixa = 0 then
      insert into public.caixa_movimentos
        (tipo, origem, descricao, categoria, valor, data, realizado, conta_pagar_id)
      values ('saida', 'conta_pagar', v_p.descricao, v_p.categoria, v_p.valor,
              p_data_pagamento, true, p_conta_id);
    end if;
  end if;

  return jsonb_build_object(
    'conta_id', p_conta_id,
    'data_pagamento', p_data_pagamento,
    'com_comprovante', coalesce(p_comprovante_url, v_p.comprovante_url) is not null,
    'lancado_no_caixa', p_lancar_caixa and coalesce(v_ja_no_caixa, 0) = 0
  );
end;
$$;

comment on function public.baixar_parcela_compromisso is
  'Dá baixa numa parcela de compromisso com data real e comprovante. Só lança no caixa se pedido e se ainda não houver lançamento para essa parcela.';

grant execute on function public.baixar_parcela_compromisso(uuid, date, text, text, boolean) to authenticated;

-- Anexar comprovante SEM dar baixa: parcela já paga antes de o sistema existir
-- recebe a prova depois, e isso não é um pagamento novo.
create or replace function public.anexar_comprovante_parcela(
  p_conta_id uuid,
  p_comprovante_url text
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
    raise exception 'Sem permissão para anexar comprovante';
  end if;

  update public.contas_pagar
     set comprovante_url = p_comprovante_url, updated_at = now()
   where id = p_conta_id and compromisso_id is not null;

  -- Contar o que a escrita fez: um UPDATE que não achou linha devolve sucesso.
  get diagnostics v_qtd = row_count;
  if v_qtd = 0 then raise exception 'Parcela de compromisso não encontrada'; end if;
  return jsonb_build_object('conta_id', p_conta_id, 'anexado', true);
end;
$$;

grant execute on function public.anexar_comprovante_parcela(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- A view ganha a contagem de comprovantes.
--
-- DROP e não CREATE OR REPLACE: replace só aceita coluna nova no FIM, e as
-- novas entram no meio.
-- ---------------------------------------------------------------------------
drop view if exists public.vw_compromissos;
create view public.vw_compromissos with (security_invoker = true) as
select
  c.id, c.descricao, c.credor, c.tipo, c.categoria, c.numero_contrato,
  c.valor_parcela, c.total_parcelas, c.primeira_parcela, c.periodicidade,
  c.valor_entrada, c.valor_total, c.maquina_id, m.nome as maquina_nome,
  c.documento_url, c.observacoes, c.ativo, c.encerrado_em,
  c.financeira, c.portal_url, c.cronograma_confirmado,
  count(p.id) as parcelas_geradas,
  count(p.id) filter (where p.status = 'paga') as parcelas_pagas,
  coalesce(sum(p.valor) filter (where p.status = 'paga'), 0) as valor_pago,
  count(p.id) filter (where p.status not in ('paga','cancelada')) as parcelas_abertas,
  coalesce(sum(p.valor) filter (where p.status not in ('paga','cancelada')), 0) as valor_aberto,
  -- Atraso vem da DATA, não do status: nada promove 'aberta' para 'atrasada'.
  count(p.id) filter (where p.status not in ('paga','cancelada') and p.vencimento < current_date) as parcelas_atrasadas,
  coalesce(sum(p.valor) filter (where p.status not in ('paga','cancelada') and p.vencimento < current_date), 0) as valor_atrasado,
  -- O ponto do módulo: parcela paga sem comprovante é afirmação sem prova.
  count(p.id) filter (where p.status = 'paga' and coalesce(p.comprovante_url,'') <> '') as com_comprovante,
  count(p.id) filter (where p.status = 'paga' and coalesce(p.comprovante_url,'') = '') as sem_comprovante,
  min(p.vencimento) filter (where p.status not in ('paga','cancelada')) as proximo_vencimento,
  max(p.vencimento) filter (where p.status not in ('paga','cancelada')) as ultimo_vencimento,
  case when c.total_parcelas is not null
       then c.total_parcelas * c.valor_parcela - coalesce(sum(p.valor) filter (where p.status = 'paga'), 0)
  end as saldo_devedor
from public.compromissos_financeiros c
left join public.maquinas m on m.id = c.maquina_id
left join public.contas_pagar p on p.compromisso_id = c.id
group by c.id, m.nome;

grant select on public.vw_compromissos to authenticated;

-- ---------------------------------------------------------------------------
-- O CNC, agora com o cronograma do portal.
-- ---------------------------------------------------------------------------
update public.compromissos_financeiros
   set valor_parcela = 1726.74,
       primeira_parcela = date '2026-08-15',
       financeira = 'Bradesco',
       cronograma_confirmado = true,
       observacoes = 'Contrato de 22/05/2026, vencimento todo dia 15, entrada de R$ 3.966,00 por PIX. Equipamento em garantia fiduciária (retomada em caso de inadimplência). CRONOGRAMA CONFERIDO NO PORTAL BLIPS em 07/09/2026: 36 × R$ 1.726,74 = R$ 62.162,64 financiados, boleto Bradesco, 1ª em 15/08/2026 e última em 15/07/2029. O contrato assinado trazia parcela de R$ 1.750,38 e valor de venda R$ 66.979,68 — a financeira cobra R$ 1.726,74. Prevalece o boleto.'
 where numero_contrato = '12608350';

-- Realinha as parcelas em aberto ao cronograma real e grava o nosso número do
-- boleto: é por ele que se acha o título no portal e se confere o comprovante.
update public.contas_pagar p
   set vencimento = (c.primeira_parcela + ((p.parcela_numero - 1) * interval '1 month'))::date,
       valor = c.valor_parcela,
       forma_pagamento = 'Boleto Pix',
       nosso_numero = '5130499' || lpad(p.parcela_numero::text, 2, '0'),
       descricao = c.descricao || ' — parcela ' || p.parcela_numero || '/' || c.total_parcelas,
       updated_at = now()
  from public.compromissos_financeiros c
 where p.compromisso_id = c.id and c.numero_contrato = '12608350'
   and p.status not in ('paga','cancelada');

update public.contas_pagar p
   set status = 'paga', data_pagamento = date '2026-08-15',
       observacoes = coalesce(p.observacoes || ' · ','') || 'baixa conferida no portal Blips em 07/09/2026',
       updated_at = now()
  from public.compromissos_financeiros c
 where p.compromisso_id = c.id and c.numero_contrato = '12608350' and p.parcela_numero = 1;

-- ---------------------------------------------------------------------------
-- A ficha comercial das máquinas segue o boleto.
--
-- Estava pela metade: a do CNC sem parcela, a da impressora sem total. E a
-- parcela do CNC tem que ser a do boleto, não a do contrato.
--
-- Nenhuma das duas mexe no custo/hora: `custo_hora_sugerido` decide o método
-- pela condição comercial, e "PRONTA ENTREGA - FINANCIAMENTO" continua caindo
-- em depreciação, "Locação Especial" continua caindo em locação.
-- ---------------------------------------------------------------------------
update public.maquinas_contrato c
   set valor_parcela = 1726.74, parcelas = 36, entrada_valor = 3966.00, entrada_forma = 'PIX',
       observacoes = coalesce(c.observacoes || ' · ','') || 'parcela conferida no portal Blips (Bradesco): R$ 1.726,74; o contrato assinado trazia R$ 1.750,38',
       atualizado_em = now()
  from public.maquinas m
 where m.id = c.maquina_id and m.numero_serie = 'FD2D54'
   and coalesce(c.valor_parcela, 0) <> 1726.74;

update public.maquinas_contrato c
   set valor_total = 83124.00, parcelas = 36, entrada_valor = 2309.00, entrada_forma = 'PIX',
       atualizado_em = now()
  from public.maquinas m
 where m.id = c.maquina_id and m.numero_serie = '12608505' and c.valor_total is null;
