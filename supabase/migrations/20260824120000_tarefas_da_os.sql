-- Tarefas da OS: destravar o elo morto.
--
-- Diagnóstico: `fechar_os` recusa fechar a OS enquanto houver tarefa obrigatória
-- pendente. A trava está correta e bem escrita — e NADA no sistema cria tarefa.
-- Nem tela, nem gatilho, nem a conversão do orçamento. O guarda vigia uma porta
-- que ninguém consegue trancar.
--
-- Trava que nunca dispara é pior que trava ausente: alguém lê o código, vê a
-- verificação e conclui que existe controle de tarefa.

-- ---------------------------------------------------------------------------
-- O gestor não tinha NENHUMA das seis permissões de tarefa — nem para ler.
--
-- Quem distribui trabalho na oficina é justamente ele. Sem isto, a tela nasceria
-- invisível para o papel que mais precisa dela, repetindo o padrão que esta
-- auditoria já encontrou no designer (cinco permissões de arquivo e nenhum
-- arquivo legível) e no instalador.
-- ---------------------------------------------------------------------------
insert into public.perfil_permissoes (perfil, permissao)
select 'gestor', p
from unnest(array[
  'tarefas.read','tarefas.create','tarefas.assign',
  'tarefas.update','tarefas.complete','tarefas.reopen'
]) as p
on conflict do nothing;

-- Quem recebe tarefa precisa ao menos ver e concluir a própria.
insert into public.perfil_permissoes (perfil, permissao)
select papel, p
from unnest(array['instalador','estoque']) as papel
cross join unnest(array['tarefas.read','tarefas.complete','tarefas.update']) as p
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Concluir e reabrir em uma operação, com carimbo de quem e quando.
--
-- Fazer isso por UPDATE solto na tela deixaria `fim_real` e `completed_by` a
-- cargo de quem lembrar de preenchê-los — e o relatório de tempo de tarefa
-- nasceria furado.
-- ---------------------------------------------------------------------------
create or replace function public.concluir_tarefa_os(p_tarefa_id uuid, p_concluir boolean default true)
returns public.os_tarefas
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid;
  v_tarefa public.os_tarefas%rowtype;
begin
  v_uid := public.require_permission(
    case when p_concluir then 'tarefas.complete' else 'tarefas.reopen' end
  );

  select * into v_tarefa from public.os_tarefas where id = p_tarefa_id for update;
  if not found then raise exception 'Tarefa não encontrada'; end if;

  if p_concluir then
    update public.os_tarefas
       set status = 'concluida',
           fim_real = coalesce(fim_real, now()),
           completed_by = v_uid,
           -- Sem início marcado, o tempo realizado seria nulo e o previsto x
           -- realizado nunca fecharia. Assume que começou quando foi criada.
           inicio_real = coalesce(inicio_real, created_at),
           minutos_realizados = coalesce(
             minutos_realizados,
             greatest(0, extract(epoch from (now() - coalesce(inicio_real, created_at)))::int / 60)
           ),
           updated_at = now()
     where id = p_tarefa_id
     returning * into v_tarefa;
  else
    update public.os_tarefas
       set status = 'pendente',
           fim_real = null,
           completed_by = null,
           updated_at = now()
     where id = p_tarefa_id
     returning * into v_tarefa;
  end if;

  return v_tarefa;
end;
$$;

comment on function public.concluir_tarefa_os is
  'Conclui ou reabre a tarefa carimbando quem, quando e o tempo realizado.';

revoke all on function public.concluir_tarefa_os(uuid, boolean) from public;
grant execute on function public.concluir_tarefa_os(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- O que ainda segura o fechamento desta OS.
--
-- `fechar_os` já devolve os bloqueios, mas só na hora de tentar fechar. A tela
-- precisa mostrar antes — descobrir o impedimento no clique final é o jeito mais
-- rápido de a equipe passar a fechar OS por fora do sistema.
-- ---------------------------------------------------------------------------
create or replace function public.tarefas_que_bloqueiam_os(p_os_id uuid)
returns integer
language sql
stable
security definer
set search_path to 'public'
as $$
  select count(*)::int
  from public.os_tarefas
  where os_id = p_os_id
    and obrigatoria
    and status not in ('concluida','cancelada')
$$;

comment on function public.tarefas_que_bloqueiam_os is
  'Quantas tarefas obrigatórias ainda impedem o fechamento da OS.';

grant execute on function public.tarefas_que_bloqueiam_os(uuid) to authenticated;

create index if not exists idx_os_tarefas_os on public.os_tarefas (os_id, status);
create index if not exists idx_os_tarefas_responsavel
  on public.os_tarefas (responsavel_id) where status not in ('concluida','cancelada');
