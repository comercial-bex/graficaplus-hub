-- Patrimônio em máquinas: o que é da casa, o que ela deve, e o que é alugado.
--
-- Harison perguntou quanto a gráfica tem de patrimônio contra quanto deve. A
-- conta não sai somando o que foi pago, porque as máquinas entraram de três
-- jeitos que não se somam:
--
--   LOCADA       o bem é do LOCADOR. A i1600 custa R$ 2.309 por 36 meses e no
--                fim volta para a Blips. Contar isso como ativo faria a casa
--                achar que tem R$ 83 mil que não tem. Continua sendo
--                compromisso a pagar — mas aparece à parte, nunca somado ao
--                patrimônio.
--
--   FINANCIADA   o bem é da casa desde a entrega, com dívida em cima (o CNC
--                está alienado em garantia fiduciária). Entra no ativo pelo
--                valor; a dívida entra no passivo.
--
--   QUITADA      bem da casa, sem dívida.
--
-- Situação declarada por ele em 07/09/2026: recorte e Bambu QUITADAS; CNC e
-- fiber FINANCIADAS; i1600 LOCADA. Existe ainda uma SEGUNDA plotter de
-- impressão financiada que não está cadastrada em lugar nenhum do sistema.

alter table public.maquinas
  add column if not exists forma_aquisicao text not null default 'quitada'
    check (forma_aquisicao in ('quitada','financiada','locada','comodato')),
  add column if not exists valor_aquisicao numeric,
  add column if not exists data_aquisicao date;

comment on column public.maquinas.forma_aquisicao is
  'Como a máquina entrou. LOCADA não é patrimônio da casa: o bem é do locador e a parcela é despesa, não amortização de ativo.';
comment on column public.maquinas.valor_aquisicao is
  'Quanto a máquina vale como bem. Nulo em locação (não é nossa) e a preencher nas quitadas.';

grant select (forma_aquisicao, valor_aquisicao, data_aquisicao) on public.maquinas to authenticated;
grant insert (forma_aquisicao, valor_aquisicao, data_aquisicao) on public.maquinas to authenticated;
grant update (forma_aquisicao, valor_aquisicao, data_aquisicao) on public.maquinas to authenticated;

update public.maquinas set forma_aquisicao='locada',     valor_aquisicao=null     where numero_serie='12608505';
update public.maquinas set forma_aquisicao='financiada', valor_aquisicao=66979.68 where numero_serie='FD2D54';
update public.maquinas set forma_aquisicao='financiada'                           where modelo='V30W20-LG';
update public.maquinas set forma_aquisicao='quitada'                              where modelo='VCUT120CAM';

-- O valor da Bambu já existia em maquinas_3d_config e ninguém tinha ligado os
-- dois cadastros: R$ 5.500 de aquisição, que é patrimônio e não aparecia.
update public.maquinas m set forma_aquisicao='quitada', valor_aquisicao=c.custo_aquisicao
  from public.maquinas_3d_config c
 where c.maquina_id = m.id and m.nome = 'Bambu Lab A1' and m.valor_aquisicao is null;

drop view if exists public.vw_patrimonio_maquinas;
create view public.vw_patrimonio_maquinas with (security_invoker = true) as
select
  m.id, m.nome, m.modelo, m.numero_serie, m.ativa,
  m.forma_aquisicao, m.valor_aquisicao, m.data_aquisicao, m.custo_hora,
  k.id as compromisso_id,
  k.descricao as compromisso,
  k.cronograma_confirmado,
  case when m.forma_aquisicao = 'locada' then 0 else coalesce(m.valor_aquisicao, 0) end as patrimonio,
  -- greatest(0, ...): pagar a mais não vira dívida negativa abatendo as outras.
  case when k.total_parcelas is not null
       then greatest(0, k.total_parcelas * k.valor_parcela
            - coalesce((select sum(p.valor) from public.contas_pagar p
                         where p.compromisso_id = k.id and p.status = 'paga'), 0))
       else 0 end as divida,
  -- O que falta para o número fechar, dito por máquina em vez de deixar o
  -- total sair redondo e errado para menos.
  case
    when m.forma_aquisicao = 'locada' then null
    when m.valor_aquisicao is null then 'falta o valor do bem'
  end as pendencia_patrimonio,
  case
    when m.forma_aquisicao = 'financiada' and k.id is null then 'financiada e sem compromisso cadastrado'
  end as pendencia_divida
from public.maquinas m
left join public.compromissos_financeiros k on k.maquina_id = m.id and k.ativo;

comment on view public.vw_patrimonio_maquinas is
  'Patrimônio e dívida por máquina. Locada entra com patrimônio ZERO: o bem é do locador.';

grant select on public.vw_patrimonio_maquinas to authenticated;
