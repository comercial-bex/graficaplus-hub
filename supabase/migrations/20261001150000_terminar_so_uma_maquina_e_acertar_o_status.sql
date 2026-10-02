-- ============================================================================
-- Terminar só UMA máquina, e acertar o status de quem apontou pela ficha
-- ============================================================================
--
-- Dois becos que a verificação do "Começar por máquina" (20261001110000)
-- achou, os dois reproduzidos em ensaio antes de mexer.
--
-- 1. OS ABERTA EM DUAS MÁQUINAS NÃO TINHA COMO TERMINAR SÓ UMA
--    A peça sai da impressão e vai para o recorte: o gesto natural é tocar
--    direto na próxima máquina. `comecar_na_maquina` permite (um item na
--    impressão, outro no recorte) e avisa que a primeira continua aberta. Só
--    que o único jeito de fechar era `terminar_na_maquina(os)`, que fecha TODAS
--    as abertas da OS — inclusive a que ainda está rodando. A primeira ficava
--    contando tempo (e custo: fechar lança horas × custo/hora) e ocupada para a
--    próxima OS da fila, até a OS inteira ir para o acabamento.
--
--    `terminar_so_esta_maquina(os, máquina, quantidade)` fecha o apontamento
--    aberto daquela OS NAQUELA máquina e mais nada. Reaproveita
--    `finalizar_apontamento` (o custo é lançado do mesmo jeito) e devolve o
--    que continua aberto, para a tela dizer "continua rodando em: Recorte".
--    Sem nada aberto ali devolve `fechados: 0`, como `terminar_na_maquina` —
--    não fecha apontamento de OUTRA OS que esteja na máquina.
--    Função nova, e não um terceiro parâmetro em `terminar_na_maquina`: mudar
--    a assinatura criaria uma segunda sobrecarga, e a chamada só com
--    `p_os_id` ficaria ambígua para o PostgREST.
--
-- 2. APONTAR PELA FICHA DEIXAVA A OS NA FILA COM A MÁQUINA ACESA — SEM SAÍDA
--    A ficha da OS abre apontamento por `iniciar_apontamento`, que não muda o
--    status nem grava a máquina na OS (é a porta que aponta Laminação, por
--    exemplo). Feito numa OS em "Fila de produção", o painel do impressor
--    oferecia "Começar", a máquina certa vinha desabilitada ("esta OS já roda
--    aqui") e `comecar_na_maquina` recusava com `ja_rodando_aqui` ANTES de
--    chegar em `avancar_os_status`. O status nunca alcançava o apontamento, e
--    "Mandar p/ acabamento" não aparecia. A única saída era terminar e começar
--    de novo, partindo o tempo em dois.
--
--    Agora, quando a máquina já está aberta para a MESMA OS:
--      - se o status da OS já é o de uma das máquinas em que ela está aberta,
--        continua `ja_rodando_aqui` (toque repetido, nada a acertar — e a OS
--        aberta em duas máquinas não troca de status a cada toque);
--      - senão, a função leva a OS ao status da máquina pelo mesmo caminho do
--        Kanban (com as travas), grava a máquina na OS e devolve o apontamento
--        QUE JÁ EXISTE, com `ja_estava_rodando: true`. Nenhum apontamento novo,
--        o tempo continua contando desde o início de verdade.
--    Máquina ocupada por OUTRA OS segue recusada (`maquina_ocupada`).
--
-- SEM DINHEIRO: as duas devolvem lista fechada (OS, máquina, status, etapa,
-- hora, minutos). `finalizar_apontamento` devolve o custo lançado; a função
-- nova não repassa.
--
-- Depende de 20261001100000 e 20261001110000.
-- Retrato do banco vivo: aplicado e conferido em 01/10/2026.

-- ------------------------------------- 1. começar também acerta o status
CREATE OR REPLACE FUNCTION public.comecar_na_maquina(p_os_id uuid, p_maquina_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_nome text; v_tipo text; v_ativa boolean;
  v_destino public.status_os;
  v_os_numero integer; v_status_antes public.status_os;
  v_ocup_id uuid; v_ocup_os uuid; v_ocup_numero integer; v_ocup_desde timestamptz;
  v_ja boolean := false;
  v_ap public.apontamentos_producao%rowtype;
  v_outras jsonb;
begin
  perform public.require_permission('producao.start');

  if p_os_id is null then
    raise exception 'Informe a OS.' using detail = 'os_nao_informada';
  end if;

  select m.nome, m.tipo, m.ativa into v_nome, v_tipo, v_ativa
    from public.maquinas m where m.id = p_maquina_id
     for no key update;
  if not found then
    raise exception 'Máquina não encontrada.' using detail = 'maquina_nao_encontrada';
  end if;
  if not v_ativa then
    raise exception 'A máquina % está inativa.', v_nome using detail = 'maquina_inativa';
  end if;

  v_destino := public.status_da_maquina(v_tipo);
  if v_destino is null then
    raise exception 'A máquina % é de um tipo (%) que ainda não tem etapa de produção no sistema. Avise o gestor.',
      v_nome, coalesce(v_tipo, 'sem tipo') using detail = 'maquina_sem_status';
  end if;

  select o.numero, o.status into v_os_numero, v_status_antes
    from public.ordens_servico o where o.id = p_os_id;
  if not found then
    raise exception 'OS não encontrada.' using detail = 'os_nao_encontrada';
  end if;
  if public.os_esta_encerrada(v_status_antes) then
    raise exception 'A OS #% já está encerrada (%). Não dá para começar produção nela.', v_os_numero, v_status_antes
      using detail = 'os_encerrada';
  end if;

  select a.id, a.os_id, o.numero, a.iniciado_em into v_ocup_id, v_ocup_os, v_ocup_numero, v_ocup_desde
    from public.apontamentos_producao a
    left join public.ordens_servico o on o.id = a.os_id
   where a.maquina_id = p_maquina_id and a.finalizado_em is null;
  if found then
    if v_ocup_os is distinct from p_os_id then
      raise exception 'A máquina % está ocupada com %. Termine lá antes de começar outra.', v_nome,
        case when v_ocup_numero is not null then 'a OS #' || v_ocup_numero else 'um apontamento sem OS' end
        using detail = 'maquina_ocupada';
    end if;
    -- A OS já roda aqui. Se o status dela já é o de uma das máquinas em que
    -- ela está aberta, não há o que acertar: é toque repetido.
    if exists (select 1 from public.apontamentos_producao a
                 join public.maquinas mq on mq.id = a.maquina_id
                where a.os_id = p_os_id and a.finalizado_em is null
                  and public.status_da_maquina(mq.tipo) = v_status_antes) then
      raise exception 'A OS #% já está rodando nesta máquina desde %.', v_os_numero,
        to_char(v_ocup_desde at time zone 'America/Belem', 'DD/MM HH24:MI') using detail = 'ja_rodando_aqui';
    end if;
    -- O apontamento foi aberto pela porta antiga (iniciar_apontamento), que
    -- não mexe no status: alinha status e máquina e devolve o que já existe.
    v_ja := true;
  end if;

  perform public.avancar_os_status(p_os_id, v_destino);

  update public.ordens_servico set maquina_id = p_maquina_id
   where id = p_os_id and maquina_id is distinct from p_maquina_id;

  if v_ja then
    select * into v_ap from public.apontamentos_producao where id = v_ocup_id;
  else
    v_ap := public.iniciar_apontamento(p_os_id, p_maquina_id, null);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'apontamento_id', a.id, 'maquina_id', a.maquina_id, 'maquina_tipo', m.tipo) order by a.iniciado_em), '[]'::jsonb)
    into v_outras
    from public.apontamentos_producao a
    left join public.maquinas m on m.id = a.maquina_id
   where a.os_id = p_os_id and a.finalizado_em is null and a.id <> v_ap.id;

  return jsonb_build_object(
    'apontamento_id', v_ap.id,
    'os_id', p_os_id,
    'os_numero', v_os_numero,
    'maquina_id', p_maquina_id,
    'maquina_tipo', v_tipo,
    'maquina_nome', v_nome,
    'status_anterior', v_status_antes,
    'status', v_destino,
    'etapa', v_ap.etapa,
    'agenda_id', v_ap.agenda_id,
    'iniciado_em', v_ap.iniciado_em,
    'iniciado_local', to_char(v_ap.iniciado_em at time zone 'America/Belem', 'HH24:MI'),
    'ja_estava_rodando', v_ja,
    'outras_maquinas_abertas', v_outras);
end; $function$;

-- ------------------------------------- 2. terminar só uma máquina
CREATE OR REPLACE FUNCTION public.terminar_so_esta_maquina(p_os_id uuid, p_maquina_id uuid, p_quantidade numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_os_numero integer; v_tipo text; v_ap uuid; v_res jsonb;
  v_lista jsonb := '[]'::jsonb; v_restam jsonb;
begin
  perform public.require_permission('producao.finish');

  select o.numero into v_os_numero from public.ordens_servico o where o.id = p_os_id;
  if not found then
    raise exception 'OS não encontrada.' using detail = 'os_nao_encontrada';
  end if;
  select m.tipo into v_tipo from public.maquinas m where m.id = p_maquina_id;
  if not found then
    raise exception 'Máquina não encontrada.' using detail = 'maquina_nao_encontrada';
  end if;
  if p_quantidade is not null and p_quantidade < 0 then
    raise exception 'A quantidade não pode ser negativa.' using detail = 'quantidade_invalida';
  end if;

  select a.id into v_ap
    from public.apontamentos_producao a
   where a.os_id = p_os_id and a.maquina_id = p_maquina_id and a.finalizado_em is null
     for update;
  if found then
    v_res := public.finalizar_apontamento(v_ap, p_quantidade, null);
    v_lista := jsonb_build_array(jsonb_build_object(
      'apontamento_id', v_ap, 'maquina_id', p_maquina_id, 'maquina_tipo', v_tipo,
      'minutos', round(coalesce((v_res->>'horas')::numeric, 0) * 60)::integer,
      'passou_do_teto', coalesce((v_res->>'passou_do_teto')::boolean, false)));
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'apontamento_id', a.id, 'maquina_id', a.maquina_id, 'maquina_tipo', m.tipo) order by a.iniciado_em), '[]'::jsonb)
    into v_restam
    from public.apontamentos_producao a
    left join public.maquinas m on m.id = a.maquina_id
   where a.os_id = p_os_id and a.finalizado_em is null;

  return jsonb_build_object('os_id', p_os_id, 'os_numero', v_os_numero,
    'maquina_id', p_maquina_id, 'maquina_tipo', v_tipo,
    'fechados', jsonb_array_length(v_lista), 'apontamentos', v_lista,
    'continuam_abertas', v_restam);
end; $function$;

-- ------------------------------------- 3. quem pode chamar
-- SECURITY DEFINER nasce com EXECUTE para PUBLIC. `comecar_na_maquina` mantém
-- os grants de 20261001110000 (CREATE OR REPLACE não os refaz).
REVOKE ALL ON FUNCTION public.terminar_so_esta_maquina(uuid, uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.terminar_so_esta_maquina(uuid, uuid, numeric) TO authenticated, service_role;

-- CONFERIDO em ensaio com rollback (DO ... RAISE EXCEPTION), simulando o
-- operador real (papel `operador`), com três OS de teste de número explícito
-- (9201–9203) criadas e desfeitas no próprio ensaio:
--   porta antiga numa OS em aguardando_producao → status continua
--     aguardando_producao; maquinas_para_comecar diz ocupada_por_esta_os no
--     Recorte, pode_comecar false                                (o beco)
--   comecar_na_maquina(OS, Recorte) → aguardando_producao → em_corte,
--     ja_estava_rodando true, o MESMO apontamento, máquina gravada na OS
--   de novo → ja_rodando_aqui
--   segunda máquina (Impressão) com o Recorte aberto → em_impressao, 1 em
--     outras_maquinas_abertas; toque no Recorte de novo → ja_rodando_aqui e o
--     status fica em_impressao
--   outra OS no Recorte → "…está ocupada com a OS #9201…" (maquina_ocupada)
--   terminar_so_esta_maquina(OS, Recorte) → fechados 1, continuam_abertas
--     [Impressão], status igual; de novo → fechados 0
--   terminar_so_esta_maquina(OS, CO2) com OUTRA OS no CO2 → fechados 0 e o
--     apontamento da outra OS continua aberto
--   máquina inexistente, OS inexistente, quantidade negativa → cada um com o
--     seu código
--   terminar a última com quantidade 12 → gravada; mandar_para_acabamento em
--     seguida → fechados 0, e a OS tem 2 apontamentos finalizados
--   OS travada (sem pagamento, arte, arquivo) com apontamento da porta antiga:
--     o acerto recusa com a frase do Kanban, status intacto, apontamento aberto
--   financeiro → "Permissão necessária: producao.finish"
--   grants: authenticated e service_role; sem PUBLIC, sem anon
--   depois do ensaio: OS [44, 49], 0 apontamentos, sequência 152 — nada ficou
