-- Agendamento honesto: parar de gravar o elo ERRADO.
--
-- As duas telas de agendamento não deixavam de ligar o registro à OS — elas
-- ligavam ao registro errado, em silêncio:
--
--   entregas.tsx:      os_id: (a PRIMEIRA OS que a consulta devolvesse)
--   maquinas-agenda:   maquina_id: maquinas[0]  (sempre a primeira máquina)
--
-- Isso é pior que campo vazio. Campo vazio se vê; entrega pendurada na OS de
-- outro cliente parece dado bom e vai para o relatório como se fosse.
--
-- Nenhuma das duas telas pedia data: gravavam `new Date()`, ou seja, tudo
-- agendado para agora. Uma agenda que só sabe dizer "agora" não é agenda.

-- ---------------------------------------------------------------------------
-- Nota para quem for procurar a agenda: existem DOIS nomes.
--
-- `maquinas_agenda` é a tabela real. `agenda_maquinas` é só uma view de
-- compatibilidade sobre ela, que renomeia `os_item_id` para `item_os_id` e
-- `observacoes` para `descricao`. A view não tem uso no repositório, mas fica —
-- é barata e algo fora daqui pode lê-la. Auditar pela view engana: ela esconde
-- `tarefa_id`, `inicio_real`, `fim_real` e `minutos_reais`, que são justamente
-- as colunas que interessam abaixo.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 2. Entrega sem OS não deveria existir.
--
-- A coluna era anulável, então uma entrega podia ficar solta, sem dono. O
-- endereço sozinho não diz de quem é a peça nem o que entregar.
-- ---------------------------------------------------------------------------
alter table public.entregas_instalacoes
  alter column os_id set not null;

-- `status` e `tipo` eram texto livre: cada tela escrevia o que quisesse e o
-- filtro do painel deixava de encontrar. As listas abaixo incluem tudo que o
-- front publicado já grava hoje ('agendada', 'em_rota', 'concluido'), para a
-- trava não quebrar produção no intervalo entre a migração e o deploy.
alter table public.entregas_instalacoes
  drop constraint if exists entregas_instalacoes_status_check;
alter table public.entregas_instalacoes
  add constraint entregas_instalacoes_status_check
  check (status in ('agendada','em_rota','concluido','cancelada'));

alter table public.entregas_instalacoes
  drop constraint if exists entregas_instalacoes_tipo_check;
alter table public.entregas_instalacoes
  add constraint entregas_instalacoes_tipo_check
  check (tipo in ('entrega','instalacao','retirada'));

comment on column public.entregas_instalacoes.responsavel_id is
  'Quem leva. A coluna existia e nenhuma tela preenchia: entrega sem responsável não cobra ninguém.';

-- ---------------------------------------------------------------------------
-- 3. Agenda de máquina: o que foi planejado × o que aconteceu.
--
-- `inicio_real`, `fim_real` e `minutos_reais` existem e nada os preenchia. Sem
-- eles a agenda só guarda intenção, e não dá para saber se a máquina atrasou —
-- que é a única razão de manter agenda de máquina.
--
-- O apontamento de produção já registra início e fim reais. Ligar os dois aqui
-- evita digitar a mesma hora duas vezes: quem aponta a produção alimenta a
-- agenda sem saber que alimentou.
-- ---------------------------------------------------------------------------
alter table public.apontamentos_producao
  add column if not exists agenda_id uuid references public.maquinas_agenda(id) on delete set null;

create index if not exists idx_apontamentos_agenda
  on public.apontamentos_producao (agenda_id) where agenda_id is not null;

grant select (agenda_id), insert (agenda_id), update (agenda_id)
  on public.apontamentos_producao to authenticated;

comment on column public.apontamentos_producao.agenda_id is
  'Reserva de máquina que este apontamento cumpriu. Preenchido pelo gatilho quando há reserva compatível.';

-- Ao abrir ou fechar o apontamento, a reserva correspondente anda junto.
create or replace function public.tg_apontamento_alimenta_agenda()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_agenda uuid;
begin
  v_agenda := new.agenda_id;

  -- Sem reserva informada, procura uma da mesma OS e máquina que ainda não
  -- terminou. É o caso comum: o operador aponta pela tela da OS e não escolhe
  -- reserva nenhuma.
  if v_agenda is null and new.maquina_id is not null then
    select a.id into v_agenda
    from public.maquinas_agenda a
    where a.maquina_id = new.maquina_id
      and a.os_id is not distinct from new.os_id
      and a.status in ('agendado','em_producao')
    order by coalesce(a.inicio_previsto, a.inicio) nulls last
    limit 1;
    if v_agenda is not null then
      new.agenda_id := v_agenda;
    end if;
  end if;

  if v_agenda is null then return new; end if;

  if new.finalizado_em is not null then
    update public.maquinas_agenda
       set status = 'concluido',
           inicio_real = coalesce(inicio_real, new.iniciado_em),
           fim_real = new.finalizado_em,
           minutos_reais = greatest(0, round(extract(epoch from (new.finalizado_em - coalesce(inicio_real, new.iniciado_em))) / 60))::int
     where id = v_agenda;
  else
    update public.maquinas_agenda
       set status = 'em_producao',
           inicio_real = coalesce(inicio_real, new.iniciado_em)
     where id = v_agenda;
  end if;

  return new;
end;
$$;

drop trigger if exists tg_apontamento_agenda on public.apontamentos_producao;
create trigger tg_apontamento_agenda
  before insert or update of finalizado_em on public.apontamentos_producao
  for each row execute function public.tg_apontamento_alimenta_agenda();

comment on function public.tg_apontamento_alimenta_agenda is
  'Apontamento de produção alimenta a reserva de máquina: início real, fim real e minutos reais deixam de ser digitados duas vezes.';
