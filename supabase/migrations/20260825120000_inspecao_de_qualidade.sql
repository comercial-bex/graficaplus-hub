-- Inspeção de qualidade: o guarda que agora vai disparar.
--
-- `fechar_os` exige inspeção aprovada quando a OS tem item com `requer_qualidade`
-- — e essa coluna nasce `true`. Ou seja: TODA OS real precisa de inspeção para
-- fechar. Nada no sistema cria inspeção, então até agora isso não aparecia por um
-- motivo pior — a própria função estava quebrada e falhava antes de chegar aqui.
--
-- Corrigido o `fechar_os`, este bloqueio passa a valer de verdade. Sem a tela de
-- inspeção, nenhuma OS com item fecharia. É o elo mais urgente da lista.
--
-- Há duas modelagens no banco para a mesma ideia: a normalizada
-- (checklist_modelos → checklist_itens_modelo → checklists_os →
-- checklist_respostas) e esta, em jsonb. Implementamos ESTA porque é a que
-- `fechar_os` consulta — a outra continuaria morta de qualquer jeito. As quatro
-- tabelas da família normalizada ficam sem uso e valem uma decisão à parte.

-- ---------------------------------------------------------------------------
-- Vocabulário do resultado.
--
-- Sem CHECK, um "Aprovado" com maiúscula ou um "ok" nunca satisfaria o guarda —
-- e a OS ficaria travada sem ninguém entender por quê.
-- ---------------------------------------------------------------------------
update public.qualidade_inspecoes
   set resultado = 'aprovado'
 where resultado is not null
   and resultado not in ('aprovado','aprovado_com_ressalva','reprovado','retrabalho');

alter table public.qualidade_inspecoes
  drop constraint if exists qualidade_inspecoes_resultado_check;

alter table public.qualidade_inspecoes
  add constraint qualidade_inspecoes_resultado_check
  check (resultado in ('aprovado','aprovado_com_ressalva','reprovado','retrabalho'));

-- ---------------------------------------------------------------------------
-- Quem inspeciona.
--
-- `qualidade.manage` estava só com o admin. Quem confere a peça é quem produz e
-- quem gerencia — mesmo padrão já corrigido em arquivos, tarefas e produção.
-- ---------------------------------------------------------------------------
insert into public.perfil_permissoes (perfil, permissao)
select papel, p
from unnest(array['gestor','operador']) as papel
cross join unnest(array['qualidade.read','qualidade.manage']) as p
on conflict do nothing;

alter table public.qualidade_inspecoes enable row level security;
alter table public.qualidade_checklists enable row level security;

drop policy if exists "inspecao read" on public.qualidade_inspecoes;
create policy "inspecao read" on public.qualidade_inspecoes
  for select using (has_permission((select auth.uid()), 'qualidade.read'));

drop policy if exists "inspecao write" on public.qualidade_inspecoes;
create policy "inspecao write" on public.qualidade_inspecoes
  for all using (has_permission((select auth.uid()), 'qualidade.manage'))
  with check (has_permission((select auth.uid()), 'qualidade.manage'));

drop policy if exists "checklist qualidade read" on public.qualidade_checklists;
create policy "checklist qualidade read" on public.qualidade_checklists
  for select using (is_staff((select auth.uid())));

drop policy if exists "checklist qualidade manage" on public.qualidade_checklists;
create policy "checklist qualidade manage" on public.qualidade_checklists
  for all using (has_permission((select auth.uid()), 'qualidade.manage'))
  with check (has_permission((select auth.uid()), 'qualidade.manage'));

create index if not exists idx_inspecao_os on public.qualidade_inspecoes (os_id, data desc);

-- ---------------------------------------------------------------------------
-- Registrar a inspeção.
--
-- Reprovado e retrabalho não são só um carimbo: devolvem a OS para retrabalho,
-- senão a peça reprovada seguiria para a entrega enquanto alguém "lembra" de
-- mudar o status na mão.
-- ---------------------------------------------------------------------------
create or replace function public.registrar_inspecao(
  p_os_id uuid,
  p_resultado text,
  p_respostas jsonb default '[]'::jsonb,
  p_fotos jsonb default '[]'::jsonb,
  p_observacao text default null,
  p_os_item_id uuid default null,
  p_checklist_id uuid default null
) returns public.qualidade_inspecoes
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid;
  v_inspecao public.qualidade_inspecoes%rowtype;
begin
  v_uid := public.require_permission('qualidade.manage');

  if p_resultado not in ('aprovado','aprovado_com_ressalva','reprovado','retrabalho') then
    raise exception 'Resultado inválido.';
  end if;
  -- Reprovar sem dizer o motivo deixa quem vai refazer sem saber o que corrigir.
  if p_resultado in ('reprovado','retrabalho')
     and coalesce(length(btrim(p_observacao)), 0) < 3 then
    raise exception 'Descreva o que reprovou para a produção saber o que refazer.';
  end if;
  if not exists (select 1 from public.ordens_servico o where o.id = p_os_id) then
    raise exception 'OS não encontrada';
  end if;

  insert into public.qualidade_inspecoes
    (os_id, os_item_id, checklist_id, responsavel_id, data, respostas, fotos, observacao, resultado)
  values
    -- clock_timestamp, não now(): `now()` é fixo na transação, e duas inspeções
    -- gravadas na mesma requisição empatariam — o desempate do "veredito mais
    -- recente" viraria sorteio, e uma reprovação antiga poderia vencer a
    -- aprovação nova.
    (p_os_id, p_os_item_id, p_checklist_id, v_uid, clock_timestamp(),
     coalesce(p_respostas, '[]'::jsonb), coalesce(p_fotos, '[]'::jsonb),
     nullif(btrim(p_observacao), ''), p_resultado)
  returning * into v_inspecao;

  if p_resultado in ('reprovado','retrabalho') then
    -- tg_bloquear_update_status_os recusa UPDATE direto de status; esta é uma
    -- transição legítima e auditada pela própria inspeção.
    perform set_config('app.avancar_os_status', 'on', true);
    update public.ordens_servico o
       set status = 'retrabalho'
     where o.id = p_os_id
       and o.status not in ('concluido','faturado','cancelado');
    perform set_config('app.avancar_os_status', 'off', true);
  end if;

  return v_inspecao;
end;
$$;

comment on function public.registrar_inspecao is
  'Grava a inspeção e devolve a OS para retrabalho quando reprovada.';

revoke all on function public.registrar_inspecao(uuid, text, jsonb, jsonb, text, uuid, uuid) from public;
grant execute on function public.registrar_inspecao(uuid, text, jsonb, jsonb, text, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Situação da qualidade da OS, para a tela avisar antes do clique de fechar.
-- ---------------------------------------------------------------------------
create or replace function public.situacao_qualidade_os(p_os_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select jsonb_build_object(
    'exige', exists (
      select 1 from public.itens_os i where i.os_id = p_os_id and i.requer_qualidade
    ),
    'aprovada', exists (
      select 1 from public.qualidade_inspecoes q
      where q.os_id = p_os_id and q.resultado in ('aprovado','aprovado_com_ressalva')
    ),
    'reprovada', exists (
      select 1 from public.qualidade_inspecoes q
      where q.os_id = p_os_id and q.resultado in ('reprovado','retrabalho')
    )
  )
$$;

comment on function public.situacao_qualidade_os is
  'Se a OS exige inspeção, se já tem aprovação e se há reprovação pendente.';

grant execute on function public.situacao_qualidade_os(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Um checklist inicial para os adesivos do catálogo de campanha.
--
-- Sem nenhum modelo cadastrado a tela nasceria vazia e a inspeção viraria um
-- campo de texto livre — que é como se perde o histórico do que foi conferido.
-- ---------------------------------------------------------------------------
insert into public.qualidade_checklists (produto_id, categoria, operacao, itens, ativo)
select null, 'adesivos', 'impressao',
  jsonb_build_array(
    'Cor confere com a prova aprovada pelo cliente',
    'Nome e número legíveis a 3 metros',
    'Sem falha de impressão, risco ou bolha',
    'Recorte no contorno acompanha a arte',
    'Quantidade bate com a OS'
  ), true
where not exists (
  select 1 from public.qualidade_checklists q
  where q.categoria = 'adesivos' and q.operacao = 'impressao'
);

-- ---------------------------------------------------------------------------
-- fechar_os: a reprovação que valia para sempre.
--
-- A verificação era "existe ALGUMA inspeção reprovada?". Uma OS reprovada,
-- corrigida e reaprovada continuaria bloqueada pelo registro antigo — para
-- sempre, sem nada na tela explicando o porquê. O histórico da reprovação tem
-- que ficar; o que não pode é ele valer como veredito atual.
--
-- Passa a valer a inspeção MAIS RECENTE, que é como a oficina raciocina: a peça
-- foi refeita e a última conferência aprovou.
-- ---------------------------------------------------------------------------
create or replace function public.veredito_qualidade_os(p_os_id uuid)
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select q.resultado
  from public.qualidade_inspecoes q
  where q.os_id = p_os_id
  order by q.data desc, q.created_at desc
  limit 1
$$;

comment on function public.veredito_qualidade_os is
  'Resultado da inspeção mais recente da OS. Reprovação antiga não vale como veredito.';

grant execute on function public.veredito_qualidade_os(uuid) to authenticated;

create or replace function public.situacao_qualidade_os(p_os_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select jsonb_build_object(
    'exige', exists (
      select 1 from public.itens_os i where i.os_id = p_os_id and i.requer_qualidade
    ),
    'veredito', public.veredito_qualidade_os(p_os_id),
    'aprovada', public.veredito_qualidade_os(p_os_id) in ('aprovado','aprovado_com_ressalva'),
    'reprovada', public.veredito_qualidade_os(p_os_id) in ('reprovado','retrabalho'),
    'total_inspecoes', (select count(*) from public.qualidade_inspecoes q where q.os_id = p_os_id)
  )
$$;

grant execute on function public.situacao_qualidade_os(uuid) to authenticated;

-- fechar_os passa a olhar o veredito mais recente em vez do histórico inteiro.
create or replace function public.fechar_os(os_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
DECLARE
  v_uid uuid; v_result jsonb; v_cliente uuid; v_bloqueios jsonb := '[]'::jsonb;
  v_receita numeric; v_pago numeric; v_veredito text;
BEGIN
  v_uid := public.require_permission('os.close');

  SELECT o.cliente_id, COALESCE(o.valor_total,0) - COALESCE(o.desconto,0)
    INTO v_cliente, v_receita
  FROM public.ordens_servico o WHERE o.id = fechar_os.os_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OS não encontrada'; END IF;

  IF EXISTS (SELECT 1 FROM public.os_tarefas t
             WHERE t.os_id = fechar_os.os_id AND t.obrigatoria
               AND t.status NOT IN ('concluida','cancelada'))
  THEN v_bloqueios := v_bloqueios || '"tarefas_obrigatorias"'::jsonb; END IF;

  v_veredito := public.veredito_qualidade_os(fechar_os.os_id);

  IF EXISTS (SELECT 1 FROM public.itens_os i WHERE i.os_id = fechar_os.os_id AND i.requer_qualidade)
     AND COALESCE(v_veredito,'') NOT IN ('aprovado','aprovado_com_ressalva')
  THEN v_bloqueios := v_bloqueios || '"qualidade_aprovada"'::jsonb; END IF;

  IF v_veredito IN ('reprovado','retrabalho')
  THEN v_bloqueios := v_bloqueios || '"qualidade_reprovada_ou_retrabalho"'::jsonb; END IF;

  IF EXISTS (SELECT 1 FROM public.os_materiais_previstos mp WHERE mp.os_id = fechar_os.os_id)
     AND NOT EXISTS (SELECT 1 FROM public.movimentacoes_estoque me
                     WHERE me.os_id = fechar_os.os_id AND me.tipo='saida' AND me.origem='baixa_os')
  THEN v_bloqueios := v_bloqueios || '"materiais_baixados"'::jsonb; END IF;

  IF EXISTS (SELECT 1 FROM public.ocorrencias oc WHERE oc.os_id = fechar_os.os_id
               AND COALESCE(oc.status,'aberta') NOT IN ('tratada','fechada','cancelada'))
  THEN v_bloqueios := v_bloqueios || '"ocorrencias_tratadas"'::jsonb; END IF;

  IF EXISTS (SELECT 1 FROM public.entregas_instalacoes ei WHERE ei.os_id = fechar_os.os_id
               AND ei.status NOT IN ('concluida','cancelada','nao_necessaria'))
  THEN v_bloqueios := v_bloqueios || '"logistica_concluida"'::jsonb; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.custos_operacionais_os co WHERE co.os_id = fechar_os.os_id)
  THEN v_bloqueios := v_bloqueios || '"custos_operacionais"'::jsonb; END IF;

  SELECT COALESCE(SUM(pg.valor),0) INTO v_pago FROM public.pagamentos pg
   WHERE pg.os_id = fechar_os.os_id AND pg.status='pago';

  IF v_receita > 0 AND v_pago < v_receita
     AND COALESCE((SELECT o2.status_financeiro::text FROM public.ordens_servico o2
                    WHERE o2.id = fechar_os.os_id),'pendente') <> 'pago'
  THEN v_bloqueios := v_bloqueios || '"pagamentos_pendentes"'::jsonb; END IF;

  SELECT to_jsonb(r) INTO v_result FROM public.vw_resultado_os r WHERE r.os_id = fechar_os.os_id;

  IF jsonb_array_length(v_bloqueios) > 0 THEN
    RETURN jsonb_build_object('os_id', fechar_os.os_id, 'fechada', false,
                              'bloqueios', v_bloqueios, 'resultado', v_result);
  END IF;

  INSERT INTO public.os_resultado_snapshots(os_id, resultado_json, created_by)
  VALUES (fechar_os.os_id, v_result, v_uid);
  UPDATE public.ordens_servico o SET status='concluido', status_geral='fechada',
         data_fechamento=now(),
         custo_real=COALESCE((v_result->>'custo_realizado')::numeric,0),
         margem_real=COALESCE((v_result->>'margem_realizada')::numeric,0)
   WHERE o.id = fechar_os.os_id;
  INSERT INTO public.pos_venda_pesquisas(os_id, cliente_id) VALUES (fechar_os.os_id, v_cliente);
  PERFORM public.registrar_evento_os(fechar_os.os_id,'os',fechar_os.os_id,'fechamento','OS fechada',NULL,v_result);
  RETURN jsonb_build_object('os_id', fechar_os.os_id, 'fechada', true, 'resultado', v_result);
END
$function$;
