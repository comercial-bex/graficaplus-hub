-- Desperdício ligado ao custo real do material — e chegando ao custo da peça.
--
-- `os_perdas.custo_total` é coluna gerada: `quantidade_perdida * custo_unitario`.
-- Só que `custo_unitario` tem DEFAULT 0 e é digitado à mão, e a tela de Perdas
-- carrega os materiais com `select id, nome, unidade` — sem o custo. Ou seja:
-- quem registra o refugo precisa lembrar de cor quanto vale o metro de lona, e
-- se não digitar, a perda custa R$ 0,00.
--
-- O efeito é o pior tipo de número errado: a tela de Perdas soma R$ 0,00 e
-- parece dizer "não há desperdício", quando na verdade diz "ninguém digitou o
-- preço". E o custo perdido nunca chegava ao resultado da OS, então a margem
-- ignorava o material jogado fora.

-- ---------------------------------------------------------------------------
-- 1. O custo vem do material, não da memória.
--
-- Quando `custo_unitario` não for informado, busca o do cadastro. Continua
-- possível informar um valor diferente — refugo de lote comprado mais caro
-- acontece — mas o padrão deixa de ser zero.
-- ---------------------------------------------------------------------------
create or replace function public.tg_perda_custo_do_material()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_custo numeric;
begin
  if coalesce(new.custo_unitario, 0) > 0 then
    return new;
  end if;

  -- Preferência pelo custo do lote de onde a peça saiu, quando dá para saber:
  -- é o preço que realmente foi pago por aquele material.
  select coalesce(
           (select l.custo_unitario_snapshot
              from public.material_lotes l
             where l.material_id = new.material_id and l.custo_unitario_snapshot > 0
             order by l.created_at desc limit 1),
           m.custo_unitario,
           m.custo_medio,
           0)
    into v_custo
  from public.materiais m where m.id = new.material_id;

  new.custo_unitario := coalesce(v_custo, 0);
  return new;
end;
$$;

drop trigger if exists tg_perda_custo on public.os_perdas;
create trigger tg_perda_custo
  before insert or update of material_id, custo_unitario on public.os_perdas
  for each row execute function public.tg_perda_custo_do_material();

comment on function public.tg_perda_custo_do_material is
  'Preenche o custo unitário da perda com o preço real do material (lote mais recente, senão o cadastro). Sem isso o padrão era zero e o desperdício somava R$ 0,00.';

-- ---------------------------------------------------------------------------
-- 2. A perda entra no custo REALIZADO da OS.
--
-- `custos_operacionais_os` é a origem do custo realizado em `vw_resultado_os`, e
-- portanto da margem. Material perdido é custo que a OS teve: deixá-lo de fora
-- faz a peça parecer mais lucrativa do que foi, justamente nas OS que deram
-- problema — que são as que mais precisam aparecer.
-- ---------------------------------------------------------------------------
create or replace function public.tg_perda_vira_custo_da_os()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_total numeric;
begin
  v_total := round(coalesce(new.quantidade_perdida,0) * coalesce(new.custo_unitario,0), 2);
  if new.os_id is null or v_total <= 0 then
    return new;
  end if;

  -- `total` é coluna GERADA (quantidade * valor_unitario): informá-la é erro.
  insert into public.custos_operacionais_os
    (os_id, os_item_id, categoria, origem, quantidade, valor_unitario, data, usuario_id)
  values
    (new.os_id, new.os_item_id, 'perda', 'os_perdas',
     new.quantidade_perdida, new.custo_unitario, now(),
     coalesce(new.operador_id, new.created_by));

  return new;
end;
$$;

drop trigger if exists tg_perda_custo_os on public.os_perdas;
create trigger tg_perda_custo_os
  after insert on public.os_perdas
  for each row execute function public.tg_perda_vira_custo_da_os();

comment on function public.tg_perda_vira_custo_da_os is
  'Lança a perda como custo operacional da OS, categoria `perda`. Sem isso o material jogado fora não aparecia na margem.';

-- ---------------------------------------------------------------------------
-- 3. Quanto a peça custou de verdade, com o desperdício dentro.
--
-- O orçamento diz o custo que se esperava por peça. Esta função diz o que a peça
-- custou depois de tudo — material baixado, mão de obra apontada e o que foi
-- para o lixo. É a comparação que mostra se o preço estava errado ou se a
-- produção é que escapou.
-- ---------------------------------------------------------------------------
create or replace function public.custo_real_por_peca(p_os_id uuid default null)
returns table (
  os_id uuid, numero integer, titulo text, os_item_id uuid, descricao text,
  quantidade numeric, custo_previsto_unitario numeric,
  custo_material numeric, custo_perda numeric, custo_mao_obra numeric, custo_outros numeric,
  custo_real_total numeric, custo_real_unitario numeric,
  preco_unitario numeric, margem_real numeric, divergencia_unitaria numeric
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with custos as (
    select c.os_item_id, c.os_id,
           sum(c.total) filter (where c.categoria = 'material') as material,
           sum(c.total) filter (where c.categoria = 'perda') as perda,
           sum(c.total) filter (where c.categoria in ('mao_de_obra','maquina')) as mao_obra,
           sum(c.total) filter (where c.categoria not in ('material','perda','mao_de_obra','maquina')) as outros,
           sum(c.total) as total
    from public.custos_operacionais_os c
    group by c.os_item_id, c.os_id
  )
  select o.id, o.numero, o.titulo, i.id, i.descricao,
         coalesce(i.quantidade, 1),
         coalesce(i.custo_unitario, 0),
         round(coalesce(k.material, 0), 2),
         round(coalesce(k.perda, 0), 2),
         round(coalesce(k.mao_obra, 0), 2),
         round(coalesce(k.outros, 0), 2),
         round(coalesce(k.total, 0), 2),
         round(coalesce(k.total, 0) / greatest(coalesce(i.quantidade, 1), 1), 2),
         coalesce(i.valor_unitario, 0),
         case when coalesce(i.valor_unitario, 0) > 0
              then round((coalesce(i.valor_unitario,0)
                          - coalesce(k.total,0) / greatest(coalesce(i.quantidade,1),1))
                         / coalesce(i.valor_unitario,0), 4)
         end,
         -- Positivo = a peça custou mais do que o orçamento previa.
         round(coalesce(k.total, 0) / greatest(coalesce(i.quantidade, 1), 1)
               - coalesce(i.custo_unitario, 0), 2)
  from public.itens_os i
  join public.ordens_servico o on o.id = i.os_id
  left join custos k on k.os_item_id = i.id
  where (p_os_id is null or i.os_id = p_os_id)
  order by o.numero desc, i.ordem
$$;

comment on function public.custo_real_por_peca is
  'O que cada peça custou de verdade — material, perda, mão de obra — contra o custo unitário que o orçamento previu.';

grant execute on function public.custo_real_por_peca(uuid) to authenticated;
