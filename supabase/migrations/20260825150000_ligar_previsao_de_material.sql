-- Ligar a previsão de material: a ponte que existia e ninguém atravessava.
--
-- `gerar_materiais_previstos_os` explode a ficha técnica dos itens da OS em
-- necessidade de material. Está pronta, correta e idempotente — e nenhuma tela
-- ou função a chamava. Sem ela não há previsão; sem previsão não há reserva; sem
-- reserva a baixa saía zerada.
--
-- Por gatilho, e não dentro da conversão do orçamento, porque item de OS também
-- nasce à mão na tela da OS. O gatilho cobre todos os caminhos; remendar só a
-- conversão deixaria o caminho manual de fora — que é justamente o do serviço
-- urgente, o que mais some do estoque.

create or replace function public.tg_prever_materiais_do_item()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  -- Só faz sentido para item ligado a produto: é do produto que vem a ficha.
  if new.produto_id is null then
    return new;
  end if;

  -- A função ignora o que já existe, então chamar por item é seguro: o segundo
  -- item da mesma OS não duplica a necessidade do primeiro.
  perform public.gerar_materiais_previstos_os(new.os_id);
  return new;
end;
$$;

comment on function public.tg_prever_materiais_do_item is
  'Explode a ficha técnica em necessidade de material a cada item de OS criado.';

drop trigger if exists tg_prever_materiais on public.itens_os;
create trigger tg_prever_materiais
  after insert on public.itens_os
  for each row execute function public.tg_prever_materiais_do_item();

-- ---------------------------------------------------------------------------
-- O que falta comprar para esta OS.
--
-- `reservar_materiais_os` já devolve os faltantes, mas só depois de reservar. A
-- tela precisa mostrar a falta ANTES — descobrir que faltou lona na hora de
-- separar é tarde para comprar.
-- ---------------------------------------------------------------------------
create or replace function public.materiais_faltantes_os(p_os_id uuid)
returns table (
  material_id uuid,
  material text,
  unidade text,
  necessario numeric,
  disponivel numeric,
  faltante numeric
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select p.material_id,
         m.nome,
         coalesce(p.unidade, m.unidade),
         sum(p.quantidade) as necessario,
         coalesce((
           select sum(l.quantidade - l.quantidade_reservada)
           from public.material_lotes l
           where l.material_id = p.material_id
             and l.quantidade - l.quantidade_reservada > 0
         ), 0) as disponivel,
         greatest(
           sum(p.quantidade) - coalesce((
             select sum(l.quantidade - l.quantidade_reservada)
             from public.material_lotes l
             where l.material_id = p.material_id
               and l.quantidade - l.quantidade_reservada > 0
           ), 0), 0) as faltante
  from public.os_materiais_previstos p
  join public.materiais m on m.id = p.material_id
  where p.os_id = p_os_id
  group by p.material_id, m.nome, p.unidade, m.unidade
$$;

comment on function public.materiais_faltantes_os is
  'Necessário x disponível por material da OS, para avisar a falta antes de separar.';

grant execute on function public.materiais_faltantes_os(uuid) to authenticated;

create index if not exists idx_previstos_os on public.os_materiais_previstos (os_id);
create index if not exists idx_lotes_material_disponivel
  on public.material_lotes (material_id) where quantidade > quantidade_reservada;
