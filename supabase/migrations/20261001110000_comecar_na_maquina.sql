-- ============================================================================
-- "Começar" acende a máquina: a porta do apontamento
-- ============================================================================
--
-- A TV da Oficina só escreve RODANDO quando existe apontamento aberto na
-- máquina. E em 01/10/2026 a tabela `apontamentos_producao` tinha ZERO linhas
-- na história. Não era a oficina parada: eram duas portas quebradas.
--
-- 1. `iniciar_apontamento` falhava sem etapa. A coluna `etapa` é NOT NULL sem
--    default, a função inseria `nullif(btrim(p_etapa),'')`, e a tela
--    (`apontamento-card.tsx`) manda `null` quando o campo — rotulado "Opcional"
--    — fica vazio. Executado na função viva antes desta migração:
--      null value in column "etapa" of relation "apontamentos_producao"
--      violates not-null constraint   (23502)
--    O campo opcional era obrigatório, e quem não escolhia etapa não apontava.
--    Agora, sem etapa, vale a etapa padrão do TIPO da máquina
--    (`tipos_de_maquina()`); tipo fora do mapa cai no setor da máquina e, por
--    último, em 'Produção'. Quem manda etapa continua mandando.
--
-- 2. O botão "Começar" do painel do impressor chama `avancar_os_status` com o
--    status genérico `em_producao` e não abre apontamento. O status muda, a
--    máquina não acende, e a parede não tem como saber em qual das cinco a
--    peça está.
--
-- DUAS PORTAS PARA O MESMO FATO
-- "Comecei a rodar a OS na máquina" é um fato só, e o sistema guardava em três
-- lugares que ninguém gravava juntos: o status da OS, `ordens_servico.maquina_id`
-- e o apontamento. As funções novas gravam os três numa transação:
--
--   comecar_na_maquina(os, máquina)
--       leva a OS ao status ESPECÍFICO da máquina pelo mesmo caminho do Kanban
--       (`avancar_os_status`, com todas as travas: pagamento, arte aprovada,
--       arquivo final, material) → grava a máquina na OS → abre o apontamento
--       reaproveitando `iniciar_apontamento`. Se o Kanban recusaria, aqui
--       também recusa, com a MESMA mensagem, e nada é gravado.
--       Máquina ocupada: erro dizendo QUAL OS está nela.
--       A mesma OS pode rodar em duas máquinas (um item na impressão, outro no
--       recorte); o retorno avisa quais outras continuam abertas.
--
--   terminar_na_maquina(os, quantidade)
--       fecha o que estiver aberto daquela OS reaproveitando
--       `finalizar_apontamento` (que lança o custo de máquina). NÃO muda o
--       status. Sem nada aberto devolve `fechados: 0` em vez de erro — a OS
--       que começou pelo caminho antigo não tem o que fechar.
--
--   mandar_para_acabamento(os, quantidade)
--       terminar + avançar para `em_acabamento`, atômico. Existe porque as
--       duas chamadas soltas falham pela metade: fechar e não avançar deixa a
--       OS "na máquina" sem apontamento; avançar e não fechar deixa a máquina
--       RODANDO uma OS que já está no acabamento, até virar NÃO FECHOU. Com
--       uma transação só, se a trava do acabamento recusar, o apontamento
--       continua aberto. Sem apontamento aberto exige só o que o Kanban exige
--       (ser da equipe); com apontamento aberto exige `producao.finish`.
--
--   maquinas_para_comecar(os)
--       os botões grandes do painel: máquinas ativas na ordem das colunas da
--       TV, qual está ocupada e por qual OS, e a sugerida.
--
--   maquina_padrao_da_os(os)
--       a regra da "sugerida", escrita uma vez para o painel e para a TV: a
--       máquina padrão do produto, só quando TODOS os itens com produto
--       apontam para a mesma máquina ativa. Serviço sem máquina (instalação,
--       arte) não conta; produto sem máquina padrão anula a sugestão — melhor
--       não sugerir do que sugerir meia OS.
--
-- SEM DINHEIRO PARA QUEM APONTA
-- `finalizar_apontamento` devolve o custo lançado, e o cartão antigo mostra
-- R$/h no seletor. As funções novas devolvem lista fechada: número da OS,
-- máquina, status, etapa, hora e minutos. Nenhum custo, nenhum valor, nenhum
-- nome de cliente, nenhum texto digitado. O custo continua sendo lançado — só
-- não é devolvido a quem aperta o botão.
--
-- ERROS
-- Mensagem em português para mostrar como está. Os erros próprios levam um
-- código estável em DETAIL (o PostgREST entrega em `error.details`):
--   os_nao_informada · os_nao_encontrada · os_encerrada
--   maquina_nao_encontrada · maquina_inativa · maquina_sem_status
--   maquina_ocupada · ja_rodando_aqui · quantidade_invalida
--   os_fora_do_balcao (cliente_retirou numa OS que não está aguardando retirada)
-- Os erros de `avancar_os_status` e de `require_permission` sobem como são.
--
-- O QUE A VERIFICAÇÃO ACHOU, E ESTE ARQUIVO FECHA (seções 7 a 11)
-- Três lentes passaram pela porta nova no mesmo dia, cada uma com ensaio, e o
-- que reproduziu foi corrigido aqui:
--   · o status mudava por fora (Kanban, seletor da ficha, "Pronta", cancelar,
--     UPDATE direto do admin) e o apontamento ficava aberto: máquina RODANDO uma
--     OS que já estava no acabamento, pronta ou cancelada  → seção 8
--   · apontamento esquecido virava custo cheio (20 h de máquina numa OS)  → 7
--   · o ERRO de `comecar_na_maquina` levava a margem ao operador  → 10
--   · "Cliente retirou" exigia os.close, que só o admin tem  → 11
--   · apontamento sem OS pegava o bloqueio da máquina e não fechava nunca  → 1, 7, 9
--   · iniciar_apontamento e finalizar_apontamento com EXECUTE para anon  → 12
--
-- Depende de 20261001100000 (tipos_de_maquina, status_da_maquina,
-- os_esta_encerrada, bloco_da_tv, teto_do_apontamento).
--
-- Retrato do banco vivo: aplicado e conferido em 01/10/2026. `comecar_na_maquina`
-- foi redefinida depois em 20261001150000 (acerta o status de quem apontou
-- pela ficha); a versão abaixo é a deste momento e aquela vale no banco.

-- ------------------------------------- 1. apontar sem etapa deixa de falhar
-- O padrão da etapa mudou, e a porta passou a exigir OS: apontamento sem OS se
-- ligava a um BLOQUEIO de máquina (nulo casa com nulo no gatilho da agenda) e,
-- em máquina com custo/hora, não fechava nunca — o lançamento do custo cai no
-- NOT NULL de os_id. OS encerrada também não abre apontamento.
CREATE OR REPLACE FUNCTION public.iniciar_apontamento(p_os_id uuid, p_maquina_id uuid, p_etapa text DEFAULT NULL::text)
 RETURNS public.apontamentos_producao
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid; v_maquina public.maquinas%rowtype; v_apontamento public.apontamentos_producao%rowtype;
        v_etapa text; v_os_numero integer; v_os_status public.status_os;
begin
  v_uid := public.require_permission('producao.start');
  if p_os_id is null then
    raise exception 'Informe a OS.' using detail = 'os_nao_informada';
  end if;
  select o.numero, o.status into v_os_numero, v_os_status from public.ordens_servico o where o.id = p_os_id;
  if not found then
    raise exception 'OS não encontrada.' using detail = 'os_nao_encontrada';
  end if;
  if public.os_esta_encerrada(v_os_status) then
    raise exception 'A OS #% já está encerrada (%). Não dá para apontar produção nela.', v_os_numero, v_os_status
      using detail = 'os_encerrada';
  end if;
  select * into v_maquina from public.maquinas where id = p_maquina_id;
  if not found then raise exception 'Máquina não encontrada'; end if;
  if not v_maquina.ativa then raise exception 'A máquina % está inativa.', v_maquina.nome; end if;
  if exists (select 1 from public.apontamentos_producao a where a.maquina_id = p_maquina_id and a.finalizado_em is null) then
    raise exception 'A máquina % já está com um apontamento aberto. Finalize antes de começar outro.', v_maquina.nome;
  end if;
  -- `etapa` é NOT NULL sem default, e a tela manda null quando o campo
  -- "Opcional" fica vazio: sem este padrão a chamada caía no INSERT.
  v_etapa := coalesce(
    nullif(btrim(p_etapa), ''),
    (select t.etapa_padrao from public.tipos_de_maquina() t where t.tipo = v_maquina.tipo),
    nullif(btrim(v_maquina.setor), ''),
    'Produção');
  insert into public.apontamentos_producao (os_id, maquina_id, etapa, setor, operador_id, iniciado_em)
  values (p_os_id, p_maquina_id, v_etapa, v_maquina.setor, v_uid, now())
  returning * into v_apontamento;
  return v_apontamento;
end; $function$;

-- ------------------------------------- 2. começar: status + máquina + apontamento
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
  v_ocup_os uuid; v_ocup_numero integer; v_ocup_desde timestamptz;
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

  select a.os_id, o.numero, a.iniciado_em into v_ocup_os, v_ocup_numero, v_ocup_desde
    from public.apontamentos_producao a
    left join public.ordens_servico o on o.id = a.os_id
   where a.maquina_id = p_maquina_id and a.finalizado_em is null;
  if found then
    if v_ocup_os = p_os_id then
      raise exception 'A OS #% já está rodando nesta máquina desde %.', v_os_numero,
        to_char(v_ocup_desde at time zone 'America/Belem', 'DD/MM HH24:MI') using detail = 'ja_rodando_aqui';
    end if;
    raise exception 'A máquina % está ocupada com %. Termine lá antes de começar outra.', v_nome,
      case when v_ocup_numero is not null then 'a OS #' || v_ocup_numero else 'um apontamento sem OS' end
      using detail = 'maquina_ocupada';
  end if;

  perform public.avancar_os_status(p_os_id, v_destino);

  update public.ordens_servico set maquina_id = p_maquina_id
   where id = p_os_id and maquina_id is distinct from p_maquina_id;

  v_ap := public.iniciar_apontamento(p_os_id, p_maquina_id, null);

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
    'outras_maquinas_abertas', v_outras);
end; $function$;

-- ------------------------------------- 3. terminar: fecha o que estiver aberto
CREATE OR REPLACE FUNCTION public.terminar_na_maquina(p_os_id uuid, p_quantidade numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_os_numero integer; v_res jsonb; v_lista jsonb := '[]'::jsonb; r record;
  v_ids uuid[] := '{}'; v_maqs uuid[] := '{}'; v_tipos text[] := '{}'; i integer;
begin
  perform public.require_permission('producao.finish');

  select o.numero into v_os_numero from public.ordens_servico o where o.id = p_os_id;
  if not found then
    raise exception 'OS não encontrada.' using detail = 'os_nao_encontrada';
  end if;
  if p_quantidade is not null and p_quantidade < 0 then
    raise exception 'A quantidade não pode ser negativa.' using detail = 'quantidade_invalida';
  end if;

  for r in
    select a.id, a.maquina_id, m.tipo
      from public.apontamentos_producao a
      left join public.maquinas m on m.id = a.maquina_id
     where a.os_id = p_os_id and a.finalizado_em is null
     order by a.iniciado_em
       for update of a
  loop
    v_ids := v_ids || r.id; v_maqs := v_maqs || r.maquina_id; v_tipos := v_tipos || r.tipo;
  end loop;

  for i in 1 .. coalesce(array_length(v_ids, 1), 0) loop
    v_res := public.finalizar_apontamento(v_ids[i], p_quantidade, null);
    v_lista := v_lista || jsonb_build_object(
      'apontamento_id', v_ids[i], 'maquina_id', v_maqs[i], 'maquina_tipo', v_tipos[i],
      'minutos', round(coalesce((v_res->>'horas')::numeric, 0) * 60)::integer,
      'passou_do_teto', coalesce((v_res->>'passou_do_teto')::boolean, false));
  end loop;

  return jsonb_build_object('os_id', p_os_id, 'os_numero', v_os_numero,
    'fechados', jsonb_array_length(v_lista), 'apontamentos', v_lista);
end; $function$;

-- ------------------------------------- 4. a sugerida, escrita uma vez
CREATE OR REPLACE FUNCTION public.maquina_padrao_da_os(p_os_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE WHEN count(*) > 0 AND count(*) = count(m.id) AND count(DISTINCT m.id) = 1
              THEN (array_agg(m.id))[1] END
    FROM public.itens_os_operacional i
    JOIN public.produtos p ON p.id = i.produto_id
    LEFT JOIN public.maquinas m ON m.id = p.maquina_padrao_id AND m.ativa
   WHERE i.os_id = p_os_id
     AND (p.tipo <> 'servico' OR p.maquina_padrao_id IS NOT NULL)
$function$;

-- ------------------------------------- 5. os botões do painel
CREATE OR REPLACE FUNCTION public.maquinas_para_comecar(p_os_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_numero integer; v_status public.status_os; v_sugerida uuid; v_lista jsonb;
begin
  perform public.require_permission('producao.start');

  select o.numero, o.status into v_numero, v_status
    from public.ordens_servico o where o.id = p_os_id;
  if not found then
    raise exception 'OS não encontrada.' using detail = 'os_nao_encontrada';
  end if;

  v_sugerida := public.maquina_padrao_da_os(p_os_id);

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', m.id,
           'nome', m.nome,
           'tipo', m.tipo,
           'ordem', coalesce(t.ordem, 99),
           'status_destino', t.status_producao,
           'sugerida', (m.id = v_sugerida) is true,
           'ocupada', a.id is not null,
           'ocupada_por_os_numero', o.numero,
           'ocupada_por_esta_os', (a.os_id = p_os_id) is true,
           'ocupada_desde', a.iniciado_em,
           'pode_comecar', (t.status_producao is not null and a.id is null and not public.os_esta_encerrada(v_status))
         ) order by coalesce(t.ordem, 99), m.nome), '[]'::jsonb)
    into v_lista
    from public.maquinas m
    left join public.tipos_de_maquina() t on t.tipo = m.tipo
    left join public.apontamentos_producao a on a.maquina_id = m.id and a.finalizado_em is null
    left join public.ordens_servico o on o.id = a.os_id
   where m.ativa;

  return jsonb_build_object(
    'os_id', p_os_id,
    'os_numero', v_numero,
    'os_status', v_status,
    'os_encerrada', public.os_esta_encerrada(v_status),
    'sugerida_maquina_id', v_sugerida,
    'maquinas', v_lista);
end; $function$;

-- ------------------------------------- 6. mandar para o acabamento, atômico
CREATE OR REPLACE FUNCTION public.mandar_para_acabamento(p_os_id uuid, p_quantidade numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_numero integer; v_antes public.status_os; v_depois public.status_os;
  v_term jsonb := jsonb_build_object('fechados', 0, 'apontamentos', '[]'::jsonb);
begin
  if v_uid is null or not public.is_staff(v_uid) then
    raise exception 'Usuário sem permissão para alterar status de OS.' using errcode = '42501';
  end if;

  select o.numero, o.status into v_numero, v_antes
    from public.ordens_servico o where o.id = p_os_id;
  if not found then
    raise exception 'OS não encontrada.' using detail = 'os_nao_encontrada';
  end if;
  if public.os_esta_encerrada(v_antes) then
    raise exception 'A OS #% já está encerrada (%).', v_numero, v_antes using detail = 'os_encerrada';
  end if;

  if exists (select 1 from public.apontamentos_producao a
              where a.os_id = p_os_id and a.finalizado_em is null) then
    v_term := public.terminar_na_maquina(p_os_id, p_quantidade);
  end if;

  select (public.avancar_os_status(p_os_id, 'em_acabamento')).status into v_depois;

  return jsonb_build_object(
    'os_id', p_os_id,
    'os_numero', v_numero,
    'status_anterior', v_antes,
    'status', v_depois,
    'fechados', v_term->'fechados',
    'apontamentos', v_term->'apontamentos');
end; $function$;

-- ------------------------------------- 7. fechar tem o mesmo teto da parede
-- O corpo do fechamento, sem a checagem de permissão: é o que
-- `finalizar_apontamento` faz depois de conferir `producao.finish`, e o que o
-- gatilho da seção 8 chama quando a OS sai da oficina. Uma conta só.
--
-- O que mudou na conta:
--   · passou do teto (`teto_do_apontamento`, o mesmo número da TV): o registro
--     fecha AGORA, mas o tempo que vira custo de máquina vai só até o teto, e o
--     apontamento ganha uma nota para o gestor conferir. Ninguém sabe quando a
--     máquina parou; lançar as horas corridas punha 20 h de máquina numa OS
--     esquecida de um dia para o outro.
--   · apontamento sem OS (os antigos, ou de OS apagada): fecha sem lançar
--     custo, em vez de cair no NOT NULL de `custos_operacionais_os.os_id` e
--     deixar a máquina presa para sempre.
CREATE OR REPLACE FUNCTION public.fechar_apontamento_interno(p_apontamento_id uuid, p_quantidade numeric, p_observacoes text, p_usuario_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_a public.apontamentos_producao%rowtype; v_maquina public.maquinas%rowtype;
        v_horas numeric; v_horas_custo numeric; v_teto timestamptz; v_passou boolean; v_custo numeric;
begin
  select * into v_a from public.apontamentos_producao where id = p_apontamento_id for update;
  if not found then raise exception 'Apontamento não encontrado'; end if;
  if v_a.finalizado_em is not null then raise exception 'Este apontamento já foi finalizado.'; end if;
  select * into v_maquina from public.maquinas where id = v_a.maquina_id;
  v_teto := public.teto_do_apontamento(v_a.iniciado_em, v_maquina.tipo);
  v_passou := now() > v_teto;
  update public.apontamentos_producao
     set finalizado_em = now(), quantidade = coalesce(p_quantidade, quantidade),
         observacoes = nullif(concat_ws(' · ',
           coalesce(nullif(btrim(p_observacoes), ''), nullif(btrim(observacoes), '')),
           case when v_passou then 'Fechado depois do teto: tempo contado até '
             || to_char(v_teto at time zone 'America/Belem', 'DD/MM HH24:MI') || '. Conferir.' end), '')
   where id = p_apontamento_id returning * into v_a;
  v_horas := round(extract(epoch from (v_a.finalizado_em - v_a.iniciado_em))::numeric / 3600, 4);
  v_horas_custo := case when v_passou
                        then round(extract(epoch from (v_teto - v_a.iniciado_em))::numeric / 3600, 4)
                        else v_horas end;
  if v_a.os_id is null then
    return jsonb_build_object('apontamento_id', v_a.id, 'horas', v_horas, 'horas_lancadas', 0,
      'passou_do_teto', v_passou, 'custo_gerado', false,
      'aviso', 'Apontamento sem OS — o tempo foi registrado, mas não virou custo.');
  end if;
  if coalesce(v_maquina.custo_hora, 0) <= 0 then
    return jsonb_build_object('apontamento_id', v_a.id, 'horas', v_horas, 'horas_lancadas', 0,
      'passou_do_teto', v_passou, 'custo_gerado', false,
      'aviso', format('A máquina %s não tem custo/hora cadastrado — o tempo foi registrado, mas não virou custo.', v_maquina.nome));
  end if;
  v_custo := round(v_horas_custo * v_maquina.custo_hora, 2);
  insert into public.custos_operacionais_os (os_id, categoria, origem, quantidade, valor_unitario, usuario_id, data)
  values (v_a.os_id, 'maquina', 'apontamento', v_horas_custo, v_maquina.custo_hora, p_usuario_id, v_a.finalizado_em);
  return jsonb_build_object('apontamento_id', v_a.id, 'horas', v_horas, 'horas_lancadas', v_horas_custo,
                            'passou_do_teto', v_passou, 'custo_gerado', true,
                            'custo', v_custo, 'maquina', v_maquina.nome);
end; $function$;

-- A porta de sempre: mesma assinatura, mesma permissão, mesmas mensagens. O
-- retorno ganhou `horas_lancadas` e `passou_do_teto`; `horas` continua sendo o
-- tempo corrido do registro.
CREATE OR REPLACE FUNCTION public.finalizar_apontamento(p_apontamento_id uuid, p_quantidade numeric DEFAULT NULL::numeric, p_observacoes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid;
begin
  v_uid := public.require_permission('producao.finish');
  return public.fechar_apontamento_interno(p_apontamento_id, p_quantidade, p_observacoes, v_uid);
end; $function$;

-- ------------------------------------- 8. saiu da oficina, a máquina apaga
-- DUAS PORTAS PARA O MESMO FATO, de novo. `mandar_para_acabamento` fecha o
-- apontamento e avança o status juntos — mas o Kanban, o seletor de status da
-- ficha, o botão "Pronta" e o cancelamento mudam o status por
-- `avancar_os_status`, que não toca em apontamento (e admin e gestor ainda
-- podem dar UPDATE direto). A máquina ficava RODANDO uma OS que já estava no
-- acabamento, pronta ou cancelada, e recusava a próxima da fila.
--
-- A regra fica no banco, do lado de quem grava o status, por qualquer porta:
-- quando a OS deixa o bloco da oficina, os apontamentos abertos dela fecham
-- pela mesma conta de sempre (seção 7). Pausar não fecha: a peça continua na
-- máquina. Status que a base não conhece (bloco nulo) também não fecha.
--
-- É gatilho que É o efeito: sem EXCEPTION. Se o fechamento falhar, a mudança
-- de status cai junto — status de um lado e máquina acesa do outro é
-- exatamente o mundo pela metade que ele existe para impedir.
CREATE OR REPLACE FUNCTION public.tg_os_saiu_da_oficina()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r record;
begin
  if new.status is not distinct from old.status then return null; end if;
  if coalesce(public.bloco_da_tv(new.status), 'oficina') in ('oficina', 'pausada') then return null; end if;
  for r in
    select a.id from public.apontamentos_producao a
     where a.os_id = new.id and a.finalizado_em is null
     order by a.iniciado_em
       for update
  loop
    perform public.fechar_apontamento_interno(r.id, null, null, auth.uid());
  end loop;
  return null;
end; $function$;

CREATE OR REPLACE TRIGGER tg_os_saiu_da_oficina
  AFTER UPDATE OF status ON public.ordens_servico
  FOR EACH ROW EXECUTE FUNCTION public.tg_os_saiu_da_oficina();

-- Concluir é o único caminho em que o gatilho chegaria tarde: `fechar_os`
-- calcula o resultado e tira o retrato ANTES de gravar o status, e o custo do
-- apontamento fechado depois ficaria fora do resultado já gravado. Então
-- máquina rodando vira a nona trava do fechamento. O resto é a função viva.
CREATE OR REPLACE FUNCTION public.fechar_os(os_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid; v_result jsonb; v_cliente uuid; v_bloqueios jsonb := '[]'::jsonb;
        v_receita numeric; v_pago numeric; v_veredito text;
BEGIN
  v_uid := public.require_permission('os.close');
  SELECT o.cliente_id, COALESCE(o.valor_total,0)-COALESCE(o.desconto,0)
    INTO v_cliente, v_receita
  FROM public.ordens_servico o WHERE o.id = fechar_os.os_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OS não encontrada'; END IF;

  IF EXISTS (SELECT 1 FROM public.os_tarefas t WHERE t.os_id = fechar_os.os_id
               AND t.obrigatoria AND t.status NOT IN ('concluida','cancelada'))
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

  IF EXISTS (SELECT 1 FROM public.apontamentos_producao ap WHERE ap.os_id = fechar_os.os_id
               AND ap.finalizado_em IS NULL)
  THEN v_bloqueios := v_bloqueios || '"apontamento_aberto"'::jsonb; END IF;

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
  UPDATE public.ordens_servico o SET status='concluido', status_geral='fechada', data_fechamento=now(),
         custo_real=COALESCE((v_result->>'custo_realizado')::numeric,0),
         margem_real=COALESCE((v_result->>'margem_realizada')::numeric,0)
   WHERE o.id = fechar_os.os_id;
  INSERT INTO public.pos_venda_pesquisas(os_id, cliente_id) VALUES (fechar_os.os_id, v_cliente);
  PERFORM public.registrar_evento_os(fechar_os.os_id,'os',fechar_os.os_id,'fechamento','OS fechada',NULL,v_result);
  RETURN jsonb_build_object('os_id', fechar_os.os_id, 'fechada', true, 'resultado', v_result);
END
$function$;

-- ------------------------------------- 9. apontamento sem OS não pega bloqueio
-- O gatilho procurava a reserva com `os_id IS NOT DISTINCT FROM new.os_id`:
-- apontamento sem OS casava com o BLOQUEIO de máquina (reserva sem OS), que
-- virava "em produção" e, ao fechar, "concluído" — a máquina aparecia livre com
-- horas de bloqueio pela frente. Agora só procura reserva quando há OS.
CREATE OR REPLACE FUNCTION public.tg_apontamento_alimenta_agenda()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_agenda uuid;
begin
  v_agenda := new.agenda_id;
  if v_agenda is null and new.maquina_id is not null and new.os_id is not null then
    select a.id into v_agenda from public.maquinas_agenda a
    where a.maquina_id = new.maquina_id
      and a.os_id = new.os_id
      and a.status in ('agendado','em_producao')
    order by coalesce(a.inicio_previsto, a.inicio) nulls last limit 1;
    if v_agenda is not null then new.agenda_id := v_agenda; end if;
  end if;
  if v_agenda is null then return new; end if;
  if new.finalizado_em is not null then
    update public.maquinas_agenda set status='concluido',
      inicio_real=coalesce(inicio_real, new.iniciado_em), fim_real=new.finalizado_em,
      minutos_reais=greatest(0, round(extract(epoch from (new.finalizado_em - coalesce(inicio_real, new.iniciado_em)))/60))::int
     where id=v_agenda;
  else
    update public.maquinas_agenda set status='em_producao',
      inicio_real=coalesce(inicio_real, new.iniciado_em) where id=v_agenda;
  end if;
  return new;
end $function$;

-- ------------------------------------- 10. a trava não leva a margem a quem aponta
-- MARGEM É CUSTO DISFARÇADO. `comecar_na_maquina` e `mandar_para_acabamento`
-- devolvem jsonb sem dinheiro, mas o ERRO delas é a frase das travas do Kanban,
-- e duas travas escreviam número no título: "Margem de 5.00% abaixo do mínimo
-- de 20.00%" e "Desconto de 15% acima do limite de 10%". Medido como operador
-- (sem financeiro.read nem precos.read): a margem chegava ao navegador dele,
-- enquanto o SELECT direto da mesma coluna dava permission denied. Esconder na
-- tela o que o navegador já recebeu não esconde nada.
--
-- O corte passa a ser aqui, uma vez, para Kanban, ficha, painel do impressor e
-- quadro: quem não tem `financeiro.read` lê a margem sem número; quem não tem
-- `financeiro.read` nem `precos.read` lê o desconto sem número. São as mesmas
-- duas permissões que a tela usa (canSeeFinancials, canSeePrices), e as frases
-- sem número são as de `bloqueio-sem-dinheiro.ts`. O `codigo` não muda.
-- O resto é a função viva.
CREATE OR REPLACE FUNCTION public.os_bloqueios_para(os_id uuid, novo_status public.status_os)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_os public.ordens_servico%ROWTYPE;
  v_bloqueios jsonb := '[]'::jsonb;
  v_margem_minima NUMERIC(5,2) := 20;
  v_desconto_limite NUMERIC(5,2) := 10;
  v_margem NUMERIC(10,2);
  v_desconto NUMERIC(10,2);
  v_total_pago NUMERIC(12,2);
  v_faltando TEXT;
  v_ve_financeiro BOOLEAN;
  v_ve_precos BOOLEAN;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Usuário sem permissão para consultar a OS.' USING ERRCODE = '42501';
  END IF;

  v_ve_financeiro := public.has_permission(auth.uid(), 'financeiro.read');
  v_ve_precos := v_ve_financeiro OR public.has_permission(auth.uid(), 'precos.read');

  SELECT * INTO v_os FROM public.ordens_servico WHERE id = os_bloqueios_para.os_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OS % não encontrada.', os_bloqueios_para.os_id USING ERRCODE = 'P0002';
  END IF;

  IF v_os.status = novo_status THEN
    RETURN '[]'::jsonb;
  END IF;

  IF v_os.responsavel_id IS NULL THEN
    v_bloqueios := v_bloqueios || jsonb_build_object(
      'codigo', 'sem_responsavel',
      'titulo', 'Sem responsável definido',
      'resolver', 'Escolha quem responde por esta OS antes de mudar o status.'
    );
  END IF;

  IF public.status_os_exige_validacoes_producao(novo_status) THEN
    SELECT COALESCE(SUM(valor), 0) INTO v_total_pago
    FROM public.pagamentos
    WHERE pagamentos.os_id = os_bloqueios_para.os_id
      AND status IN ('parcial','pago')
      AND valor > 0;

    IF v_total_pago <= 0 THEN
      v_bloqueios := v_bloqueios || jsonb_build_object(
        'codigo', 'sem_pagamento',
        'titulo', 'Nenhum pagamento registrado',
        'resolver', 'Registre ao menos a entrada no financeiro da OS.'
      );
    END IF;

    -- Uma pergunta so, para os dois caminhos de aprovacao. Ver
    -- `arte_aprovada_da_os`: lendo so `aprovacoes`, a aprovacao que o cliente
    -- dava pelo link nao contava aqui e a producao ficava barrada.
    IF NOT public.arte_aprovada_da_os(os_bloqueios_para.os_id) THEN
      v_bloqueios := v_bloqueios || jsonb_build_object(
        'codigo', 'arte_nao_aprovada',
        'titulo', 'Arte ainda não aprovada',
        'resolver', 'Envie a arte para aprovação e registre o aceite do cliente.'
      );
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.arquivos
      WHERE arquivos.os_id = os_bloqueios_para.os_id AND final_producao = true
    ) THEN
      v_bloqueios := v_bloqueios || jsonb_build_object(
        'codigo', 'sem_arquivo_final',
        'titulo', 'Sem arquivo final de produção',
        'resolver', 'Anexe o arquivo fechado e marque-o como final de produção.'
      );
    END IF;

    SELECT string_agg(m.nome || ' (falta ' || ROUND(omo.quantidade - m.estoque, 2) || ')', ', ')
    INTO v_faltando
    FROM public.os_materiais_obrigatorios omo
    JOIN public.materiais m ON m.id = omo.material_id
    WHERE omo.os_id = os_bloqueios_para.os_id AND m.estoque < omo.quantidade;

    IF v_faltando IS NOT NULL THEN
      v_bloqueios := v_bloqueios || jsonb_build_object(
        'codigo', 'material_insuficiente',
        'titulo', 'Material obrigatório em falta',
        'resolver', 'Sem saldo de: ' || v_faltando || '. Dê entrada no estoque ou compre.'
      );
    END IF;
  END IF;

  SELECT margem_estimada, desconto_percentual INTO v_margem, v_desconto
  FROM public.orcamentos WHERE id = v_os.orcamento_id;

  IF v_margem IS NULL THEN
    v_margem := COALESCE(
      v_os.margem_real,
      CASE
        WHEN v_os.valor_total > 0 THEN ROUND(((v_os.valor_total - COALESCE(NULLIF(v_os.custo_real, 0), v_os.custo_previsto, 0)) / v_os.valor_total) * 100, 2)
        ELSE NULL
      END
    );
  END IF;

  IF v_margem IS NOT NULL AND v_margem < v_margem_minima AND NOT EXISTS (
    SELECT 1 FROM public.aprovacoes a
    JOIN public.user_roles ur ON ur.user_id = a.usuario_id AND ur.role IN ('admin','gestor')
    WHERE a.os_id = os_bloqueios_para.os_id AND a.tipo::text = 'margem_baixa' AND a.aprovado = true
  ) THEN
    v_bloqueios := v_bloqueios || jsonb_build_object(
      'codigo', 'margem_baixa',
      'titulo', CASE WHEN v_ve_financeiro
                     THEN 'Margem de ' || v_margem || '% abaixo do mínimo de ' || v_margem_minima || '%'
                     ELSE 'Margem abaixo do mínimo — precisa de aprovação do gestor' END,
      'resolver', 'Peça aprovação de um gestor ou revise o preço.'
    );
  END IF;

  IF COALESCE(v_desconto, 0) > v_desconto_limite AND NOT EXISTS (
    SELECT 1 FROM public.aprovacoes a
    JOIN public.user_roles ur ON ur.user_id = a.usuario_id AND ur.role IN ('admin','gestor')
    WHERE (a.os_id = os_bloqueios_para.os_id OR a.orcamento_id = v_os.orcamento_id)
      AND a.tipo::text = 'desconto_alto' AND a.aprovado = true
  ) THEN
    v_bloqueios := v_bloqueios || jsonb_build_object(
      'codigo', 'desconto_alto',
      'titulo', CASE WHEN v_ve_precos
                     THEN 'Desconto de ' || v_desconto || '% acima do limite de ' || v_desconto_limite || '%'
                     ELSE 'Desconto acima do limite — precisa de aprovação do gestor' END,
      'resolver', 'Peça aprovação de um gestor ou reduza o desconto.'
    );
  END IF;

  RETURN v_bloqueios;
END;
$function$;

-- ------------------------------------- 11. cliente retirou
-- O botão "Cliente retirou" do painel chamava `avancar_os_status(os,
-- 'concluido')`, que passa por `fechar_os` e exige `os.close` — permissão que
-- só o admin tem. Para o impressor o botão devolvia erro, e a OS retirada
-- ficava contada em "na saída" na parede até um admin fechar.
--
-- Retirar e encerrar são dois fatos. Esta função grava o primeiro: uma linha
-- de retirada concluída em `entregas_instalacoes`. A OS sai da parede
-- (`os_saiu_fisicamente`) e, se ainda não puder ser encerrada, fica para o
-- gestor — sem dizer na parede quem falta quitar.
-- A linha nasce 'agendada' e é concluída em seguida, de propósito: é o UPDATE
-- de status que dispara `tg_entrega_conclui_a_os`, a porta que já TENTA fechar
-- a OS quando a última entrega termina. Ela continua exigindo `os.close` de
-- quem está na sessão: com o admin a OS fecha junto (se as travas deixarem);
-- com o impressor, não fecha e não dá erro.
CREATE OR REPLACE FUNCTION public.cliente_retirou(p_os_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_numero integer; v_antes public.status_os; v_depois public.status_os;
  v_linha uuid; v_ja boolean := false;
begin
  if v_uid is null or not public.is_staff(v_uid) then
    raise exception 'Usuário sem permissão para registrar a retirada.' using errcode = '42501';
  end if;
  if p_os_id is null then
    raise exception 'Informe a OS.' using detail = 'os_nao_informada';
  end if;

  select o.numero, o.status into v_numero, v_antes
    from public.ordens_servico o where o.id = p_os_id
     for update;
  if not found then
    raise exception 'OS não encontrada.' using detail = 'os_nao_encontrada';
  end if;
  if public.os_esta_encerrada(v_antes) then
    raise exception 'A OS #% já está encerrada (%).', v_numero, v_antes using detail = 'os_encerrada';
  end if;
  if v_antes <> 'aguardando_retirada' then
    raise exception 'A OS #% não está aguardando retirada (%).', v_numero, v_antes using detail = 'os_fora_do_balcao';
  end if;

  select e.id into v_linha from public.entregas_instalacoes e
   where e.os_id = p_os_id and e.tipo = 'retirada' and e.status = 'concluida'
   limit 1;
  if found then
    v_ja := true;
  else
    select e.id into v_linha from public.entregas_instalacoes e
     where e.os_id = p_os_id and e.tipo = 'retirada' and e.status in ('agendada', 'em_rota')
     order by e.created_at limit 1;
    if not found then
      insert into public.entregas_instalacoes (os_id, tipo, status, data_agendada, responsavel_id)
      values (p_os_id, 'retirada', 'agendada', now(), v_uid)
      returning id into v_linha;
    end if;
    update public.entregas_instalacoes
       set status = 'concluida', data_realizada = now(), responsavel_id = coalesce(responsavel_id, v_uid)
     where id = v_linha;
  end if;

  select o.status into v_depois from public.ordens_servico o where o.id = p_os_id;

  return jsonb_build_object(
    'os_id', p_os_id,
    'os_numero', v_numero,
    'status_anterior', v_antes,
    'status', v_depois,
    'ja_estava_registrada', v_ja,
    'fechou', public.os_esta_encerrada(v_depois),
    'saiu_da_parede', public.os_esta_encerrada(v_depois) or public.os_saiu_fisicamente(p_os_id));
end; $function$;

-- ------------------------------------- 12. quem pode chamar
-- Função SECURITY DEFINER nasce com EXECUTE para PUBLIC. As de porta têm guarda
-- no corpo, e mesmo assim o anônimo não chega nem a chamar.
-- `maquina_padrao_da_os` roda com a permissão de quem chama e só interessa à
-- função da TV (service_role) e às definer acima: nem authenticated a chama.
-- `iniciar_apontamento` e `finalizar_apontamento` vinham de antes com EXECUTE
-- para anon, e `os_bloqueios_para` para PUBLIC e anon: a guarda do corpo
-- segurava sozinha. Agora a porta também fecha.
-- `fechar_apontamento_interno` e a função de gatilho não são porta de ninguém:
-- só as definer acima as chamam, como dono.
REVOKE ALL ON FUNCTION public.iniciar_apontamento(uuid, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.finalizar_apontamento(uuid, numeric, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.os_bloqueios_para(uuid, public.status_os) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fechar_apontamento_interno(uuid, numeric, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_os_saiu_da_oficina() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cliente_retirou(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.iniciar_apontamento(uuid, uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.finalizar_apontamento(uuid, numeric, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.os_bloqueios_para(uuid, public.status_os) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fechar_apontamento_interno(uuid, numeric, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.cliente_retirou(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.comecar_na_maquina(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.terminar_na_maquina(uuid, numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.maquinas_para_comecar(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mandar_para_acabamento(uuid, numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.maquina_padrao_da_os(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.comecar_na_maquina(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.terminar_na_maquina(uuid, numeric) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.maquinas_para_comecar(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mandar_para_acabamento(uuid, numeric) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.maquina_padrao_da_os(uuid) TO service_role;

-- CONFERIDO, em ensaios com rollback (RAISE EXCEPTION no fim), simulando o
-- operador real (papel `operador`) com OS de teste criadas dentro do ensaio:
--   começar em cada uma das 5 máquinas: status em_impressao / em_corte /
--     em_laser_cnc (CO2 e Fiber) / em_3d, máquina gravada na OS, 1 apontamento
--     aberto por máquina, etapa Impressão / Recorte / Laser / Laser / Impressão 3D
--   máquina ocupada → "…está ocupada com a OS #90. Termine lá…" (maquina_ocupada)
--   a mesma OS de novo na mesma máquina → ja_rodando_aqui
--   a mesma OS numa segunda máquina → permitido, 1 em outras_maquinas_abertas
--   OS que o Kanban recusaria → "A OS não pode avançar ainda: Nenhum pagamento
--     registrado; Arte ainda não aprovada; Sem arquivo final de produção." e
--     nada gravado (status igual, máquina nula, 0 apontamentos)
--   OS encerrada, máquina inativa, tipo sem mapa, máquina e OS inexistentes,
--     quantidade negativa → cada um com a sua mensagem e o seu código
--   sem permissão: financeiro → "Permissão necessária: producao.start" /
--     "producao.finish"; sessão sem usuário → "Usuário não autenticado";
--     anon → permission denied for function
--   terminar: fecha 2 abertas, status não muda; de novo → fechados 0
--   mandar para acabamento: fecha 2 e vai a em_acabamento; recusado pela trava
--     → o apontamento CONTINUA aberto e o status não muda
--   reserva da agenda: começar liga o apontamento à reserva; terminar a conclui
--   caminho antigo: iniciar_apontamento com etapa ('Laminação' fica), sem etapa
--     ('Impressão'), etapa em branco ('Laser'), tipo fora do mapa (setor) e
--     máquina sem tipo ('Produção'); avancar_os_status pelo Kanban → em_producao
--   sugerida: sem item, item sem produto, produto sem máquina e duas máquinas
--     → nula; lona → Impressão; lona + serviço sem máquina → Impressão
--   nenhum retorno com R$, valor, custo, nome de cliente ou texto digitado
--     (plantados "R$ 150,00" no título, observação, briefing, item e reserva)
--   depois dos ensaios: 2 OS, 0 apontamentos, 5 máquinas — nada de teste ficou
--
-- CONFERIDO de novo em 01/10/2026 (20:55 a 21:05 de Macapá), seções 7 a 12,
-- em UM ensaio com rollback (DO ... RAISE EXCEPTION), reproduzindo antes nas
-- funções vivas cada defeito (margem no erro; Kanban com a máquina rodando →
-- 1 apontamento aberto; esquecido 20 h → 20,0 h de custo; "Cliente retirou"
-- como operador → "Permissão necessária: os.close"; apontamento sem OS →
-- abriu e não fechou, 23502 em os_id; anon com EXECUTE nas duas):
--   Kanban (em_acabamento), "Pronta" (aguardando_retirada), admin cancelando
--     uma OS pausada e UPDATE direto do admin → 0 apontamentos abertos, 1
--     fechado e 1 linha de custo em cada; pausar NÃO fechou (1 aberto); a
--     reserva ligada ao apontamento ficou 'concluido'
--   esquecido 20 h, por mandar_para_acabamento → minutos 1200,
--     passou_do_teto true, 10,0000 h de custo, nota no apontamento ("Fechado
--     depois do teto: tempo contado até 01/10 11:02. Conferir."); esquecido de
--     ontem 22:00, por terminar_na_maquina → 1383 min, 2,0000 h de custo (até a
--     meia-noite)
--   cliente_retirou como operador → fechou false, saiu_da_parede true, 1 linha
--     retirada/concluida; de novo → ja_estava_registrada true, sem 2ª linha;
--     OS no acabamento → "não está aguardando retirada"; como admin numa OS
--     quitada e sem travas → fechou true, status concluido
--   concluir com a máquina rodando → "A OS nao pode fechar ainda:
--     apontamento_aberto; custos_operacionais; pagamentos_pendentes."
--   porta antiga: sem OS → "Informe a OS."; OS cancelada → "já está encerrada";
--     etapa 'Laminação' numa OS do acabamento → abriu (a TV: ok=true e aviso
--     apontamento_aberto_fora_da_oficina [nº]); fechar → horas, horas_lancadas,
--     passou_do_teto, custo_gerado false (Fiber sem custo/hora)
--   apontamento sem OS (inserido direto) com bloqueio manual cobrindo agora →
--     agenda_id nulo, bloqueio continuou 'agendado'; fechar → aviso
--     "Apontamento sem OS", sem erro
--   margem: operador → "Margem abaixo do mínimo — precisa de aprovação do
--     gestor"; financeiro → "Margem de 5.00% abaixo do mínimo de 20.00%"
--   anon: iniciar, finalizar, os_bloqueios_para, cliente_retirou e
--     fechar_apontamento_interno → sem EXECUTE; authenticated: as quatro
--     portas sim, a interna e a de gatilho não
--   a parede no fim: consistência ok, sem falhas, sem avisos
--   depois do ensaio e da aplicação: OS [44, 49], 0 apontamentos, 0 reservas,
--     0 entregas, 0 custos, sequência 154 — nada ficou
-- NÃO MEDIDO: desconto sem número (não há orçamento livre com desconto acima
--   de 10% para ligar à OS de teste; lido na função) · a chamada pelo
--   PostgREST · dois operadores ao mesmo tempo.
