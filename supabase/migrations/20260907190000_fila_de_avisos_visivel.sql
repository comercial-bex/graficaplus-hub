-- A fila de avisos existia, enchia sozinha, e NENHUMA tela do sistema lia ela.
--
-- `notificacoes_fila` recebe uma linha a cada arte pronta para aprovar, OS
-- concluída e orçamento aprovado. Doze linhas se acumularam desde 22/08 com
-- ZERO tentativa de envio — não há instância de WhatsApp conectada nem função
-- que drene a fila (o projeto tem uma única edge function, process-automations,
-- e pg_cron não está instalado).
--
-- Fila que só enche é pior que fila que falha: a que falha deixa erro, a que
-- nunca é tentada não deixa rastro nenhum. Enquanto o canal automático não
-- existe, este módulo transforma a fila no que ela é hoje de verdade — a lista
-- de quem precisa ser avisado À MÃO.
--
-- `enviado_manualmente` é coluna separada de propósito: marcar como 'enviado'
-- sem ela faria o sistema reivindicar um envio que ele não fez, e a diferença
-- importa no dia em que alguém for auditar por que o cliente não foi avisado.

alter table public.notificacoes_fila
  add column if not exists enviado_manualmente boolean not null default false,
  add column if not exists observacao text;

comment on column public.notificacoes_fila.enviado_manualmente is
  'Alguém avisou o cliente à mão. Diferente de enviado pelo sistema: marcar como "enviado" sem isto faria o sistema reivindicar um envio que não fez.';

grant select (enviado_manualmente, observacao) on public.notificacoes_fila to authenticated;
grant insert (enviado_manualmente, observacao) on public.notificacoes_fila to authenticated;
grant update (enviado_manualmente, observacao) on public.notificacoes_fila to authenticated;

drop view if exists public.vw_avisos_pendentes;
create view public.vw_avisos_pendentes with (security_invoker = true) as
select
  f.id, f.canal, f.destinatario, f.evento, f.entidade, f.entidade_id,
  f.status, f.tentativas, f.ultimo_erro, f.created_at, f.observacao,
  coalesce(c.nome, f.variaveis->>'cliente') as cliente,
  c.id as cliente_id,
  f.variaveis->>'os_titulo' as titulo,
  f.variaveis->>'os_numero' as os_numero,
  (current_date - f.created_at::date) as dias_parado,
  -- "Nunca tentado" e "tentou e falhou" são problemas diferentes: o primeiro é
  -- ausência de canal, o segundo é erro de envio. A tela precisa separar, senão
  -- alguém vai caçar bug de integração onde não há integração nenhuma.
  (f.tentativas = 0) as nunca_tentado,
  -- Fila de teste aponta para cadastro apagado, e cobrar retorno de um cliente
  -- que não existe mais é ruído que esconde os avisos de verdade.
  (c.id is not null) as cliente_existe,
  exists (select 1 from public.whatsapp_instancias w where w.ativa) as whatsapp_configurado
from public.notificacoes_fila f
left join public.clientes c on c.id = f.cliente_id
where f.status in ('pendente','falhou','enviando');

comment on view public.vw_avisos_pendentes is
  'Avisos que o sistema quis mandar e não saíram, com o cliente resolvido e há quantos dias estão parados.';

grant select on public.vw_avisos_pendentes to authenticated;

-- ---------------------------------------------------------------------------
-- Dar baixa à mão.
-- ---------------------------------------------------------------------------
create or replace function public.avisar_manualmente(p_id uuid, p_observacao text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_qtd integer;
begin
  if not public.is_staff(auth.uid()) then
    raise exception 'Sem permissão para dar baixa em aviso';
  end if;

  update public.notificacoes_fila
     set status = 'enviado',
         enviado_manualmente = true,
         enviado_em = now(),
         observacao = coalesce(p_observacao, observacao),
         updated_at = now()
   where id = p_id and status in ('pendente','falhou','enviando');

  -- Contar o que a escrita fez: um UPDATE que não achou linha devolve sucesso,
  -- e a tela diria "avisado" sem ter mudado nada.
  get diagnostics v_qtd = row_count;
  if v_qtd = 0 then raise exception 'Aviso não encontrado ou já resolvido'; end if;
  return jsonb_build_object('id', p_id, 'avisado_manualmente', true);
end; $$;

grant execute on function public.avisar_manualmente(uuid, text) to authenticated;

create or replace function public.cancelar_aviso(p_id uuid, p_motivo text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_qtd integer;
begin
  if not public.is_staff(auth.uid()) then
    raise exception 'Sem permissão para cancelar aviso';
  end if;

  update public.notificacoes_fila
     set status = 'cancelado',
         observacao = coalesce(p_motivo, observacao),
         updated_at = now()
   where id = p_id and status in ('pendente','falhou','enviando');

  get diagnostics v_qtd = row_count;
  if v_qtd = 0 then raise exception 'Aviso não encontrado ou já resolvido'; end if;
  return jsonb_build_object('id', p_id, 'cancelado', true);
end; $$;

grant execute on function public.cancelar_aviso(uuid, text) to authenticated;

-- Cinco dos doze avisos apontam para cliente de teste que foi apagado. Limpar em
-- lote pelo VÍNCULO QUEBRADO, não por nome parecido com teste: "Comitê Teste" é
-- um nome, e um dia pode ser cliente de verdade.
create or replace function public.cancelar_avisos_orfaos()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_qtd integer;
begin
  if not (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'gestor')) then
    raise exception 'Sem permissão';
  end if;

  update public.notificacoes_fila f
     set status = 'cancelado',
         observacao = coalesce(f.observacao || ' · ','') || 'cancelado em lote: cliente não existe mais',
         updated_at = now()
   where f.status in ('pendente','falhou','enviando')
     and f.cliente_id is not null
     and not exists (select 1 from public.clientes c where c.id = f.cliente_id);

  get diagnostics v_qtd = row_count;
  return jsonb_build_object('cancelados', v_qtd);
end; $$;

grant execute on function public.cancelar_avisos_orfaos() to authenticated;
