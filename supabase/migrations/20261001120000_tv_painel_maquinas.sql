-- ============================================================================
-- A parede da oficina: tv_painel_maquinas()
-- ============================================================================
--
-- A TV da Oficina é uma tela só, na parede, com as cinco máquinas lado a lado.
-- Ela não tem sessão, não clica em nada e fica virada para o balcão, onde o
-- cliente enxerga. Esta migração é a ÚNICA fonte de dados dela: uma função que
-- devolve um jsonb com tudo, pronta para uma rota de servidor entregar.
--
-- UMA RESPOSTA, UM NÚMERO
-- Na TV2 da agência o cartão dizia um número e a lista embaixo dizia outro,
-- porque cada um vinha de uma consulta. Aqui é uma chamada e uma linha: todo
-- bloco é {total, itens}, e o total é o count(*) da MESMA lista de que os itens
-- são o topo (12 primeiros). O corte de 1.000 linhas do PostgREST não alcança
-- um jsonb escalar. "Hoje" é o dia de Macapá (hoje_local), e toda hora sai
-- pronta em America/Belem — o banco roda em UTC e viraria o dia às 21h de lá.
--
-- O QUE CADA COLUNA DIZ (precedência fixa, escrita uma vez)
--   rodando       apontamento aberto dentro do teto
--   nao_fechou    apontamento aberto que passou do teto. O teto é
--                 teto_do_apontamento (20261001100000): fim do dia local OU
--                 10 h, o que vier primeiro; na impressora 3D, que vira a
--                 noite, 24 h corridas. O mesmo número que o fechamento usa
--                 para dizer até onde o tempo vira custo. Nada no banco fecha
--                 apontamento sozinho por tempo; sem isto, um esquecido
--                 ficaria RODANDO para sempre.
--   bloqueada     agora está dentro de uma reserva ativa SEM OS feita à mão
--                 na agenda (origem 'manual'). Reserva que nasceu de uma OS e
--                 ficou sem ela (OS apagada) não bloqueia máquina nenhuma.
--   reservada     agora está dentro de uma reserva "agendado" de OS que já
--                 está na oficina. Reserva de OS ainda em entrada ou arte NÃO
--                 gera este estado (nasce sozinha na conversão do orçamento):
--                 vira só o contador a_caminho. Reserva de fim vencido também
--                 não: vira o contador reservas_vencidas.
--   pelo_status   sem apontamento, mas a OS está nesta máquina pelo status
--                 (em_impressao, em_corte, em_3d) ou por ordens_servico.maquina_id
--   livre         nada acima e houve apontamento finalizado HOJE (na 3D vale
--                 também registro de job 3D de hoje)
--   sem_registro  nada acima. Nunca "livre" sem prova: reserva não é sinal de
--                 vida — só apontamento é.
-- Não existe o estado manutenção: hoje nada grava início e fim de manutenção.
--
-- CADA OS EM UM LUGAR SÓ
-- OS aberta na parede = não encerrada (os_esta_encerrada), menos a que já saiu
-- fisicamente (os_saiu_fisicamente) E continua em status de saída: entregue,
-- só falta quitar — essa SAI da parede, senão o bloco "na saída" viraria a
-- lista de quem deve. A que saiu e VOLTOU (retrabalho depois da entrega)
-- está na parede: o status diz onde. Medido antes da correção: a OS em
-- retrabalho com uma entrega concluída sumia da parede inteira, sem falha.
-- Cada uma cai em um bloco (bloco_da_tv); a pausada volta ao bloco de onde
-- veio, lido do histórico. As da oficina são distribuídas pelas colunas na
-- ordem: 1. apontamento aberto · 2. reservas ativas, de qualquer data ·
-- 3. ordens_servico.maquina_id, só quando não contradiz o status (status
-- genérico, ou o status daquela máquina — o Começar grava a máquina e nada a
-- limpa quando o Kanban leva a OS para outra) · 4. o status que identifica UMA
-- máquina · 5. a máquina padrão do produto (maquina_padrao_da_os, a mesma
-- regra do painel do impressor) · 6. senão, "sem máquina", com o motivo.
-- As regras 3 e 4 valem para a OS em produção mesmo que ela tenha reserva em
-- OUTRA máquina (a reserva continua na fila de lá): a máquina onde o status
-- diz que a peça está não fica muda porque a conversão do orçamento reservou
-- a Impressão. Para a OS que está só na fila, 3 e 4 valem quando não há par
-- nenhum. Uma OS com itens em duas máquinas aparece nas duas colunas e conta
-- UMA vez no total da oficina.
--
-- APONTAMENTO ABERTO DE OS FORA DA OFICINA
-- Apontar pela ficha numa OS do acabamento (Laminação, por exemplo) é fato da
-- operação, não erro de conta: a coluna mostra a OS com agora.fora_da_oficina,
-- os totais da oficina e das atrasadas fecham sem ela, e o número vai em
-- consistencia.avisos (apontamento_aberto_fora_da_oficina), não em falhas. O
-- caso em que o status saía da oficina pelo Kanban com a máquina ainda acesa
-- deixou de existir: o gatilho de 20261001110000 fecha o apontamento junto.
--
-- A CONFERÊNCIA PODE FALHAR — É PARA ISSO QUE ELA EXISTE
-- consistencia.falhas não é um "ok: true" fixo. Cada regra é calculada por
-- dois caminhos e comparada; o que divergir volta nomeado e acende a faixa
-- "número inconsistente" na tela:
--   R1  abertas = soma dos quatro blocos. O outro caminho não reusa o filtro
--       da parede: conta as não encerradas e tira as que saíram lendo a
--       tabela das entregas direto. Falha quando um status novo no enum fica
--       sem bloco, ou quando uma OS está pausada sem linha de histórico
--       dizendo de onde veio.
--   R2  oficina (pelos blocos) = OS da oficina distintas nas colunas (pela
--       alocação) + sem máquina.
--   R3  atrasadas = nas máquinas (pela alocação, só oficina) + fora (pelos
--       blocos).
--   R4  colunas no estado rodando = apontamentos abertos dentro do teto.
--       Apontamento aberto em máquina nula ou inativa (a FK é ON DELETE SET
--       NULL) não some: vira falha com o número da OS.
--   R5  prontas de hoje ≤ na saída; nenhuma lista maior que o seu total.
--   R6  máquinas ativas ≤ 5 — a tela foi desenhada para cinco colunas; a sexta
--       aparece no retorno e a falha avisa, em vez de a máquina sumir.
--
-- SEM DINHEIRO E SEM NOME NA PAREDE
-- Lista fechada de colunas em toda leitura, jsonb montado chave por chave.
-- O único texto que vem de tabela é produtos.nome. Nunca cliente, título,
-- descrição digitada do item, observação, briefing, endereço, custo, preço,
-- valor ou pagamento — nem por subtração: os eventos são cinco tipos fechados
-- (concluir e faturar só acontecem com a OS quitada, então não viram evento) e
-- "atrasada" não conta a OS pronta esperando o cliente no balcão. O tipo da
-- máquina sai do mapa tipos_de_maquina(), não da coluna de texto livre.
-- As views *_operacional TÊM cliente_nome, briefing, observacoes e titulo: ler
-- por elas protege de dinheiro, não de privacidade — por isso a lista fechada.
-- O teste tests/tv-painel-sem-dinheiro.test.ts lê ESTE arquivo e falha se o
-- corpo das funções citar qualquer uma dessas palavras.
--
-- QUEM PODE CHAMAR
-- Só service_role: a TV chega por uma rota de servidor com a chave de serviço.
-- A função é SECURITY INVOKER de propósito:
--   · as tabelas lidas têm RLS de equipe, e service_role tem BYPASSRLS — não
--     precisa do privilégio do dono para ler;
--   · como invoker, current_user é o papel REAL de quem chama, e a guarda no
--     corpo é uma comparação que não se forja. Em função definer current_user
--     é sempre o dono e a guarda teria de confiar no que o pedido diz de si;
--   · se um GRANT errado um dia abrir o EXECUTE, a função não empresta
--     privilégio a ninguém: a guarda recusa e, sem ela, a RLS ainda valeria.
-- EXECUTE revogado de PUBLIC, anon e authenticated — nem o admin logado chama.
--
-- tv_hora_local(quando) é a outra metade de hoje_local(): "14:05" quando é
-- hoje, "28/09 17:10" quando não é.
--
-- ENTRADA/ARTE E SAÍDA SÃO SÓ CONTAGEM
-- cartoes.atrasadas, prazo_hoje e prazo_amanha contam os quatro blocos no
-- total, mas a lista só numera oficina e acabamento. Uma OS com arte aprovada
-- que não anda, listada com número e dias, seria lida no balcão como
-- "esperando o sinal" (a fila exige pagamento registrado). Decidido no SQL,
-- não na tela.
--
-- Depende de 20261001100000 (hoje_local, os_esta_encerrada, etapa_da_os,
-- bloco_da_tv, os_saiu_fisicamente, tipos_de_maquina, maquina_do_status,
-- teto_do_apontamento) e de 20261001110000 (maquina_padrao_da_os).
--
-- Retrato do banco vivo: aplicado e conferido em 01/10/2026; corrigido e
-- reaplicado no mesmo dia (verificação adversarial — ver o fim do arquivo).
-- O corpo abaixo é byte a byte o que está em pg_proc (md5 de prosrc
-- conferido: c143e9605dec27509f902b85439cbc97).

-- ------------------------------------------------- 1. a hora, em Macapá
CREATE OR REPLACE FUNCTION public.tv_hora_local(p_quando timestamp with time zone)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE WHEN (p_quando AT TIME ZONE 'America/Belem')::date = public.hoje_local()
              THEN to_char(p_quando AT TIME ZONE 'America/Belem', 'HH24:MI')
              ELSE to_char(p_quando AT TIME ZONE 'America/Belem', 'DD/MM HH24:MI') END
$function$;

-- ------------------------------------------------- 2. a parede inteira, em uma chamada
CREATE OR REPLACE FUNCTION public.tv_painel_maquinas()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  c_fuso        constant text := 'America/Belem';
  c_topo        constant integer := 12;
  c_topo_ev     constant integer := 30;
  c_intervalo_s constant integer := 60;
  c_abre        constant time := time '08:00';
  c_fecha       constant time := time '18:00';
  c_colunas     constant integer := 5;
  v_agora  timestamptz := now();
  v_hoje   date := public.hoje_local();
  v_dia0   timestamptz;
  v_local  timestamp;
  v_blocos jsonb; v_cartoes jsonb; v_maquinas jsonb; v_saidas jsonb;
  v_abertas integer; v_soma_blocos integer; v_sem_bloco integer;
  v_oficina integer; v_nas_colunas integer; v_sem_maquina integer; v_nos_dois integer;
  v_fora_da_oficina jsonb; v_avisos jsonb := '[]'::jsonb;
  v_nao_encerradas integer; v_sairam integer;
  v_atr integer; v_atr_maquinas integer; v_atr_fora integer;
  v_rodando integer; v_no_teto integer; v_sem_maq_ativa jsonb;
  v_ja_prontas integer; v_saida integer;
  v_ativas integer; v_abertas_direto integer; v_ativas_direto integer;
  v_ap_hoje integer; v_ap_abertos integer; v_ap_ultimo timestamptz;
  v_j3_hoje integer; v_j3_ultimo timestamptz; v_vida timestamptz;
  v_ev_total integer; v_ev_itens jsonb; v_ev_ultimo jsonb;
  v_falhas jsonb := '[]'::jsonb;
  v_linha record;
begin
  -- Guarda: a parede chega por uma rota de servidor, com a chave de servico.
  -- A funcao roda com a permissao de quem chama (nao e definer), entao
  -- current_user e o papel real da chamada.
  if current_user <> 'service_role' then
    raise exception 'A parede da oficina só é lida pela rota da TV.'
      using errcode = '42501', detail = 'somente_service_role';
  end if;

  v_dia0  := v_hoje::timestamp at time zone c_fuso;
  v_local := v_agora at time zone c_fuso;

  with
  -- os 26 status, cada um com o seu bloco: a fonte e a base unica (F0)
  st as (
    select s as status, public.bloco_da_tv(s) as bloco, public.etapa_da_os(s) as etapa,
           public.os_esta_encerrada(s) as encerrada, public.maquina_do_status(s) as tipo_maq
      from unnest(enum_range(null::public.status_os)) as s
  ),
  -- as colunas: maquinas ativas, na ordem do tipo e depois do nome
  maq as (
    select m.id, t.tipo, coalesce(t.ordem, 99) as ordem,
           row_number() over (order by coalesce(t.ordem, 99), m.nome, m.id) as pos,
           (t.tipo is not null and count(*) over (partition by t.tipo) = 1) as unica,
           t.status_producao as status_maq,
           coalesce(t.status_producao = 'em_3d', false) as eh_3d
      from public.maquinas m
      left join public.tipos_de_maquina() t on t.tipo = m.tipo
     where m.ativa
  ),
  -- toda OS nao encerrada, com o status efetivo (a pausada, o de onde veio)
  w0 as (
    select o.id, o.numero, o.status, o.prazo_entrega as prazo, o.maquina_id,
           coalesce(s1.bloco = 'pausada', false) as pausada,
           case when s1.bloco = 'pausada'
                then (select h.status_anterior from public.os_status_historico h
                       where h.os_id = o.id and h.status_novo = o.status
                       order by h.mudou_em desc, h.id limit 1)
                else o.status end as status_ef,
           (select max(h.mudou_em) from public.os_status_historico h
             where h.os_id = o.id and h.status_novo = o.status) as entrou_em,
           public.os_saiu_fisicamente(o.id) as saiu
      from public.ordens_servico_operacional o
      left join st s1 on s1.status = o.status
     where o.status = any (array(select x.status from st x where not x.encerrada))
  ),
  -- regra (b): aberta na parede = nao encerrada, menos a que ja saiu E continua em status
  -- de saida (entregue, falta encerrar). A que saiu e VOLTOU (retrabalho, de novo na
  -- oficina) esta na parede: o status dela diz onde.
  -- A pausada volta ao bloco de onde veio; status sem bloco fica com bloco nulo (R1 acusa).
  w as (
    select p.id, p.numero, p.status, p.status_ef, p.prazo, p.maquina_id, p.pausada, p.entrou_em,
           b.bloco, s2.etapa as etapa_ef, s2.tipo_maq,
           (p.prazo < v_hoje and (b.bloco in ('entrada_arte', 'oficina', 'acabamento')
                                  or (b.bloco = 'saida' and p.status_ef <> 'aguardando_retirada'))) is true as atrasada
      from w0 p
      left join st s2 on s2.status = p.status_ef
      left join lateral (select case when s2.bloco in ('entrada_arte', 'oficina', 'acabamento', 'saida')
                                     then s2.bloco end as bloco) b on true
     where not (p.saiu and b.bloco is not distinct from 'saida')
  ),
  atr as (select x.numero, v_hoje - x.prazo as dias, x.bloco, x.pausada from w x where x.atrasada),
  ph  as (select x.numero, x.bloco, x.pausada from w x where x.prazo = v_hoje),
  pa  as (select x.numero, x.bloco, x.pausada from w x where x.prazo = v_hoje + 1),
  -- apontamentos abertos (todos, inclusive os de maquina nula ou inativa).
  -- O teto e o mesmo que o fechamento usa: teto_do_apontamento.
  apa as (
    select a.id, a.os_id, a.maquina_id, a.agenda_id, a.iniciado_em,
           (m.id is not null) as maquina_ativa,
           v_agora < public.teto_do_apontamento(a.iniciado_em, m.tipo) as no_teto
      from public.apontamentos_producao a
      left join maq m on m.id = a.maquina_id
     where a.finalizado_em is null
  ),
  -- reserva ativa: definicao unica (estado, fila, pe e letreiro).
  -- Bloqueio e a reserva sem OS feita a mao na agenda. Reserva que nasceu de uma OS
  -- e ficou sem ela (a OS foi apagada) nao e bloqueio de ninguem: fica fora da parede.
  res as (
    select g.id, g.maquina_id, g.os_id, g.os_item_id, g.inicio, g.fim, g.status,
           nullif(g.minutos_previstos, 0) as minutos,
           case when g.os_id is not null then x.bloco
                when g.origem = 'manual' then 'bloqueio' end as classe
      from public.maquinas_agenda g
      join maq m on m.id = g.maquina_id
      left join w x on x.id = g.os_id
     where g.status in ('agendado', 'em_producao')
  ),
  -- regras 1 e 2 da alocacao: os pares OS x maquina que ja existem
  par as (
    select a.os_id, a.maquina_id from apa a where a.maquina_ativa and a.os_id is not null
    union
    select r.os_id, r.maquina_id from res r where r.classe = 'oficina'
  ),
  -- onde o status diz que a OS esta. A maquina gravada na OS so vale quando nao
  -- contradiz o status (status generico, ou o status daquela maquina); quando
  -- contradiz, vale o status que identifica UMA maquina.
  onde as (
    select u.id as os_id,
           coalesce(m3.id, m4.id) as maquina_id,
           case when m3.id is not null then 'maquina_id' when m4.id is not null then 'status' end as origem
      from w u
      left join maq m3 on m3.id = u.maquina_id
           and (u.status_ef in ('aguardando_producao', 'em_producao', 'producao') or m3.status_maq = u.status_ef)
      left join maq m4 on m4.tipo = u.tipo_maq and m4.unica
     where u.bloco = 'oficina'
  ),
  -- regras 3 e 4: a OS que esta em producao pelo status aparece na maquina do status
  -- mesmo tendo reserva em OUTRA maquina (a reserva continua na fila de la); a que
  -- esta so na fila, apenas quando nao tem par nenhum.
  -- regras 5 e 6, para quem nao tem par nem maquina pelo status: a maquina padrao
  -- do produto; senao, sem maquina.
  aloc as (
    select d.os_id,
           coalesce(d.maquina_id, m5.id) as maquina_id,
           coalesce(d.origem, case when m5.id is not null then 'produto' end) as origem
      from onde d
      join w u on u.id = d.os_id
      left join lateral (select case when d.maquina_id is null
                                      and not exists (select 1 from par c where c.os_id = d.os_id)
                                     then public.maquina_padrao_da_os(d.os_id) end as id) f on true
      left join maq m5 on m5.id = f.id
     where not exists (select 1 from par c
                        where c.os_id = d.os_id
                          and (d.maquina_id is null
                               or u.etapa_ef is distinct from 'producao'
                               or c.maquina_id = d.maquina_id))
  ),
  sem_maq as (
    select x.os_id, u.numero, u.pausada, u.atrasada, u.prazo,
           case when u.atrasada then v_hoje - u.prazo end as dias,
           case u.status_ef when 'em_laser_cnc' then 'laser_sem_maquina'
                            when 'em_uv' then 'terceiro_uv'
                            when 'aguardando_producao' then 'fila_sem_reserva'
                            else 'generico' end as motivo
      from aloc x join w u on u.id = x.os_id
     where x.maquina_id is null
  ),
  -- todo trabalho que aparece em coluna: uma linha por par OS x maquina
  trab as (
    select row_number() over () as tid, z.origem, z.maquina_id, z.os_id, z.agenda_id, z.os_item_id,
           z.iniciado_em, z.inicio, z.fim, z.minutos, z.res_status, z.no_teto
      from (
        select 'apontamento'::text as origem, a.maquina_id, a.os_id, a.agenda_id, g.os_item_id,
               a.iniciado_em, g.inicio, g.fim, nullif(g.minutos_previstos, 0) as minutos,
               null::text as res_status, a.no_teto
          from apa a left join public.maquinas_agenda g on g.id = a.agenda_id
         where a.maquina_ativa
        union all
        select 'reserva', r.maquina_id, r.os_id, r.id, r.os_item_id,
               null, r.inicio, r.fim, r.minutos, r.status, null
          from res r
         where r.classe = 'oficina'
           and not exists (select 1 from apa a where a.agenda_id = r.id)
        union all
        select x.origem, x.maquina_id, x.os_id, null, null, null, null, null, null, null, null
          from aloc x where x.maquina_id is not null
      ) z
  ),
  trab2 as (
    select t.tid, t.origem, t.maquina_id, t.os_id, t.iniciado_em, t.inicio, t.fim, t.minutos,
           t.res_status, t.no_teto,
           o.numero as os_numero, x.bloco, coalesce(x.pausada, false) as pausada, x.prazo, x.entrou_em,
           case when x.atrasada then v_hoje - x.prazo end as dias_atraso,
           (t.os_id is not null and x.bloco is distinct from 'oficina') as fora_da_oficina,
           (x.etapa_ef = 'producao' and not x.pausada and d.maquina_id = t.maquina_id) is true as fato,
           d.origem as fato_origem,
           case when t.os_id is null then null else it.n end as itens_na_os,
           case when ii.id is not null then pr.nome when it.n = 1 then it.nome_unico end as produto,
           case when t.os_id is null then null
                when ii.id is not null then case when pr.id is not null then 'produto' else 'sob_medida' end
                when it.n = 1 then case when it.nome_unico is not null then 'produto' else 'sob_medida' end
                when it.n > 1 then 'varios'
                else 'sem_item' end as item
      from trab t
      join maq m on m.id = t.maquina_id
      left join public.ordens_servico_operacional o on o.id = t.os_id
      left join w x on x.id = t.os_id
      left join onde d on d.os_id = t.os_id
      left join public.itens_os_operacional ii on ii.id = t.os_item_id and ii.os_id = t.os_id
      left join public.produtos pr on pr.id = ii.produto_id
      left join lateral (
        select count(*)::integer as n, min(p2.nome) as nome_unico
          from public.itens_os_operacional i2
          left join public.produtos p2 on p2.id = i2.produto_id
         where i2.os_id = t.os_id) it on true
  ),
  -- sinal de vida 3D: os registros de job contam para a coluna da impressora 3D
  j3 as (
    select coalesce(j.maquina_id, (select m.id from maq m where m.eh_3d and m.unica)) as maquina_id,
           max(coalesce(p.fim, p.inicio)) as ultimo_em,
           count(*) filter (where coalesce(p.fim, p.inicio) >= v_dia0) as hoje
      from public.producao_3d_apontamentos p
      join public.producao_3d_jobs j on j.id = p.job_id
     group by 1
  ),
  est0 as (
    select m.id, m.tipo, m.ordem, m.pos,
           a.tid as a_tid, a.no_teto as a_no_teto, a.iniciado_em as a_desde,
           b.inicio as b_inicio, b.fim as b_fim,
           rv.tid as r_tid, rv.inicio as r_inicio, rv.fim as r_fim,
           f.tid as f_tid, f.entrou_em as f_desde,
           (select max(q.finalizado_em) from public.apontamentos_producao q
             where q.maquina_id = m.id and q.finalizado_em >= v_dia0) as fim_hoje,
           u.ultimo_em, u.ultimo_os,
           j.ultimo_em as j3_ultimo, coalesce(j.hoje, 0) as j3_hoje
      from maq m
      left join trab2 a on a.maquina_id = m.id and a.origem = 'apontamento'
      left join lateral (
        select g.inicio, g.fim from res g
         where g.maquina_id = m.id and g.classe = 'bloqueio' and g.inicio <= v_agora and g.fim > v_agora
         order by g.inicio, g.id limit 1) b on true
      left join lateral (
        select t.tid, t.inicio, t.fim from trab2 t
         where t.maquina_id = m.id and t.origem = 'reserva' and t.res_status = 'agendado'
           and not t.pausada and t.inicio <= v_agora and t.fim > v_agora
         order by t.inicio, t.tid limit 1) rv on true
      left join lateral (
        select t.tid, t.entrou_em from trab2 t
         where t.maquina_id = m.id and t.fato and t.origem <> 'apontamento'
         order by t.entrou_em nulls last, t.os_numero, t.tid limit 1) f on true
      left join lateral (
        select greatest(q.iniciado_em, q.finalizado_em) as ultimo_em, o2.numero as ultimo_os
          from public.apontamentos_producao q
          left join public.ordens_servico_operacional o2 on o2.id = q.os_id
         where q.maquina_id = m.id
         order by greatest(q.iniciado_em, q.finalizado_em) desc limit 1) u on true
      left join j3 j on j.maquina_id = m.id
  ),
  -- precedencia: rodando > nao fechou > bloqueada > reservada > pelo status > livre > sem registro
  est as (
    select e.id, e.tipo, e.ordem, e.pos, e.a_tid, e.a_desde, e.b_inicio, e.b_fim, e.r_tid, e.r_inicio, e.r_fim,
           e.f_tid, e.f_desde, e.fim_hoje, e.ultimo_em, e.ultimo_os, e.j3_ultimo, e.j3_hoje,
           case when e.a_tid is not null and e.a_no_teto then 'rodando'
                when e.a_tid is not null then 'nao_fechou'
                when e.b_inicio is not null then 'bloqueada'
                when e.r_tid is not null then 'reservada'
                when e.f_tid is not null then 'pelo_status'
                when e.fim_hoje is not null or e.j3_hoje > 0 then 'livre'
                else 'sem_registro' end as estado
      from est0 e
  ),
  est2 as (
    select e.id, e.tipo, e.ordem, e.pos, e.estado, e.b_inicio, e.b_fim, e.r_inicio, e.r_fim,
           e.ultimo_em, e.ultimo_os, e.j3_ultimo,
           -- de onde veio a prova do livre: a tela nao pode juntar a hora do job 3D
           -- com o numero da OS do ultimo apontamento
           case when e.estado = 'livre' then
             case when e.fim_hoje is not null and (e.j3_hoje = 0 or e.fim_hoje >= e.j3_ultimo)
                  then 'apontamento' else 'job_3d' end end as livre_por,
           case e.estado when 'rodando' then e.a_tid when 'nao_fechou' then e.a_tid
                         when 'reservada' then e.r_tid when 'pelo_status' then e.f_tid end as agora_tid,
           case e.estado when 'rodando' then e.a_desde when 'nao_fechou' then e.a_desde
                         when 'bloqueada' then e.b_inicio when 'reservada' then e.r_inicio
                         when 'pelo_status' then e.f_desde
                         when 'livre' then greatest(e.fim_hoje, case when e.j3_hoje > 0 then e.j3_ultimo end)
           end as desde_em
      from est e
  ),
  -- a fila DEPOIS: tudo da coluna menos o trabalho de agora
  fila as (
    select t.maquina_id, t.os_id,
           row_number() over (partition by t.maquina_id order by
             case when t.dias_atraso is not null then 0 when t.prazo = v_hoje then 1 else 2 end,
             case when t.dias_atraso is not null then t.prazo end,
             t.inicio nulls last, t.prazo nulls last, t.os_numero, t.tid) as rn,
           jsonb_build_object(
             'os_numero', t.os_numero,
             'produto', t.produto,
             'item', t.item,
             'itens_na_os', t.itens_na_os,
             'dias_atraso', t.dias_atraso,
             'prazo', case when t.prazo = v_hoje then 'hoje' when t.prazo = v_hoje + 1 then 'amanha' end,
             'reserva_local', case
               when t.origem <> 'reserva' then null
               when (t.inicio at time zone c_fuso)::date = v_hoje then to_char(t.inicio at time zone c_fuso, 'HH24:MI')
               when (t.inicio at time zone c_fuso)::date between v_hoje + 1 and v_hoje + 6
                 then (array['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'])[extract(dow from t.inicio at time zone c_fuso)::integer + 1]
               else to_char(t.inicio at time zone c_fuso, 'DD/MM') end,
             'reserva_vencida', (t.origem = 'reserva' and t.res_status = 'agendado' and t.fim < v_agora),
             'origem', t.origem,
             'pausada', t.pausada) as linha
      from trab2 t
      join est2 e on e.id = t.maquina_id
     where t.tid is distinct from e.agora_tid
  ),
  filas as (
    select f.maquina_id, count(*)::integer as total,
           jsonb_agg(f.linha order by f.rn) filter (where f.rn <= c_topo) as itens
      from fila f group by f.maquina_id
  ),
  -- o pe da coluna: reservas vencidas (contador) e vendidas com arte pendente
  pe as (
    select r.maquina_id,
           count(distinct r.os_id) filter (where r.classe = 'entrada_arte')::integer as a_caminho,
           count(*) filter (where r.classe = 'oficina' and r.status = 'agendado' and r.fim < v_agora)::integer as vencidas,
           min(r.fim) filter (where r.classe = 'oficina' and r.status = 'agendado' and r.fim < v_agora) as mais_antiga
      from res r group by r.maquina_id
  ),
  -- o letreiro: saidas e reservas de hoje e de amanha
  sai0 as (
    select e.tipo, (coalesce(e.janela_inicio, e.data_agendada) at time zone c_fuso)::date as dia,
           case when e.janela_inicio is not null then to_char(e.janela_inicio at time zone c_fuso, 'HH24:MI') end as hora,
           x.numero, null::uuid as maquina_id
      from public.entregas_instalacoes e
      join w x on x.id = e.os_id
     where e.status in ('agendada', 'em_rota') and e.tipo in ('entrega', 'instalacao')
    union all
    select 'retirada', x.prazo, null, x.numero, null
      from w x where x.status = 'aguardando_retirada'
    union all
    select case when r.classe = 'bloqueio' then 'bloqueio' else 'reserva' end,
           (r.inicio at time zone c_fuso)::date, to_char(r.inicio at time zone c_fuso, 'HH24:MI'),
           x.numero, r.maquina_id
      from res r left join w x on x.id = r.os_id
     where r.classe in ('bloqueio', 'oficina') and r.inicio >= v_agora
  ),
  sai as (
    select s.tipo, s.dia, s.hora, s.numero, s.maquina_id,
           row_number() over (order by s.dia, s.hora nulls first, s.tipo, s.numero) as rn
      from sai0 s where s.dia in (v_hoje, v_hoje + 1)
  ),
  tot as (
    select count(*)::integer as abertas,
           count(*) filter (where x.bloco is null)::integer as sem_bloco,
           count(*) filter (where x.bloco = 'entrada_arte')::integer as ea,
           count(*) filter (where x.bloco = 'entrada_arte' and x.atrasada)::integer as ea_atr,
           count(*) filter (where x.bloco = 'entrada_arte' and not x.pausada and x.status_ef = 'aguardando_aprovacao_arte')::integer as ea_esp,
           count(*) filter (where x.bloco = 'oficina')::integer as ofi,
           count(*) filter (where x.bloco = 'acabamento')::integer as ac,
           count(*) filter (where x.bloco = 'acabamento' and x.atrasada)::integer as ac_atr,
           count(*) filter (where x.bloco = 'acabamento' and x.status_ef = 'retrabalho')::integer as ac_ret,
           count(*) filter (where x.bloco = 'saida')::integer as sa,
           count(*) filter (where x.bloco = 'saida' and x.status_ef = 'aguardando_retirada')::integer as sa_balcao,
           count(*) filter (where x.bloco = 'saida' and x.status_ef in ('aguardando_entrega', 'em_entrega'))::integer as sa_entrega,
           count(*) filter (where x.bloco = 'saida' and x.status_ef = 'em_instalacao')::integer as sa_inst,
           count(*) filter (where x.bloco = 'saida' and x.atrasada)::integer as sa_atr,
           count(*) filter (where x.prazo is null)::integer as sem_prazo
      from w x
  )
  select
    jsonb_build_object(
      'abertas_na_parede', t.abertas,
      'entrada_arte', jsonb_build_object('total', t.ea, 'atrasadas', t.ea_atr, 'com_cliente', t.ea_esp),
      'oficina', jsonb_build_object('total', t.ofi,
        'nas_colunas', (select count(distinct y.os_id)::integer from trab2 y where y.bloco = 'oficina')),
      'sem_maquina', jsonb_build_object(
        'total', (select count(*)::integer from sem_maq),
        'atrasadas', (select count(*)::integer from sem_maq y where y.atrasada),
        'itens', (select coalesce(jsonb_agg(jsonb_build_object(
                      'os_numero', y.numero, 'motivo', y.motivo, 'dias_atraso', y.dias, 'pausada', y.pausada)
                    order by y.rn), '[]'::jsonb)
                    from (select z.numero, z.motivo, z.dias, z.pausada,
                                 row_number() over (order by z.dias desc nulls last, z.numero) as rn
                            from sem_maq z) y
                   where y.rn <= c_topo)),
      'acabamento', jsonb_build_object('total', t.ac, 'atrasadas', t.ac_atr, 'retrabalho', t.ac_ret),
      'saida', jsonb_build_object('total', t.sa, 'no_balcao', t.sa_balcao, 'entrega', t.sa_entrega,
                                  'instalacao', t.sa_inst, 'atrasadas', t.sa_atr)),
    jsonb_build_object(
      'atrasadas', jsonb_build_object(
        'total', (select count(*)::integer from atr),
        -- so as da oficina: a OS de outro bloco com apontamento aberto ja conta em "fora"
        'nas_maquinas', (select count(distinct y.os_id)::integer from (
                           select y1.os_id from trab2 y1 where y1.dias_atraso is not null and y1.bloco = 'oficina'
                           union all
                           select y2.os_id from sem_maq y2 where y2.atrasada) y),
        'fora', t.ea_atr + t.ac_atr + t.sa_atr,
        -- o total conta os quatro blocos; a lista so numera oficina e acabamento:
        -- entrada/arte e saida sao so contagem na parede
        'itens', (select coalesce(jsonb_agg(jsonb_build_object(
                      'os_numero', y.numero, 'dias_atraso', y.dias, 'bloco', y.bloco, 'pausada', y.pausada)
                    order by y.rn), '[]'::jsonb)
                    from (select z.numero, z.dias, z.bloco, z.pausada,
                                 row_number() over (order by z.dias desc, z.numero) as rn
                            from atr z where z.bloco in ('oficina', 'acabamento')) y
                   where y.rn <= c_topo)),
      'prazo_hoje', jsonb_build_object(
        'total', (select count(*)::integer from ph),
        'ja_prontas', (select count(*)::integer from ph y where y.bloco = 'saida'),
        'itens', (select coalesce(jsonb_agg(jsonb_build_object(
                      'os_numero', y.numero, 'bloco', y.bloco, 'pausada', y.pausada) order by y.rn), '[]'::jsonb)
                    from (select z.numero, z.bloco, z.pausada, row_number() over (order by z.numero) as rn
                            from ph z where z.bloco in ('oficina', 'acabamento')) y
                   where y.rn <= c_topo)),
      'prazo_amanha', jsonb_build_object(
        'total', (select count(*)::integer from pa),
        'ja_prontas', (select count(*)::integer from pa y where y.bloco = 'saida'),
        'itens', (select coalesce(jsonb_agg(jsonb_build_object(
                      'os_numero', y.numero, 'bloco', y.bloco, 'pausada', y.pausada) order by y.rn), '[]'::jsonb)
                    from (select z.numero, z.bloco, z.pausada, row_number() over (order by z.numero) as rn
                            from pa z where z.bloco in ('oficina', 'acabamento')) y
                   where y.rn <= c_topo)),
      'abertas_sem_prazo', t.sem_prazo),
    (select coalesce(jsonb_agg(jsonb_build_object(
        'id', e.id,
        'tipo', e.tipo,
        'ordem', e.ordem,
        'estado', e.estado,
        'desde_em', e.desde_em,
        'desde_local', public.tv_hora_local(e.desde_em),
        'livre_por', e.livre_por,
        'agora', case when g.tid is not null then jsonb_build_object(
            'os_numero', g.os_numero,
            'produto', g.produto,
            'item', g.item,
            'itens_na_os', g.itens_na_os,
            'origem', case e.estado when 'reservada' then 'reserva' when 'pelo_status' then g.fato_origem else 'apontamento' end,
            'minutos_previstos', g.minutos,
            'dias_atraso', g.dias_atraso,
            'pausada', g.pausada,
            'fora_da_oficina', g.fora_da_oficina) end,
        'janela', case e.estado
            when 'bloqueada' then jsonb_build_object('inicio_local', public.tv_hora_local(e.b_inicio), 'fim_local', public.tv_hora_local(e.b_fim))
            when 'reservada' then jsonb_build_object('inicio_local', public.tv_hora_local(e.r_inicio), 'fim_local', public.tv_hora_local(e.r_fim))
          end,
        'fila', jsonb_build_object('total', coalesce(fl.total, 0), 'itens', coalesce(fl.itens, '[]'::jsonb)),
        'a_caminho', coalesce(pe.a_caminho, 0),
        'reservas_vencidas', jsonb_build_object(
            'total', coalesce(pe.vencidas, 0),
            'mais_antiga_local', to_char(pe.mais_antiga at time zone c_fuso, 'DD/MM')),
        'ultimo_apontamento_local', public.tv_hora_local(e.ultimo_em),
        'ultimo_apontamento_os_numero', e.ultimo_os,
        'ultimo_job_3d_local', public.tv_hora_local(e.j3_ultimo)
      ) order by e.pos), '[]'::jsonb)
       from est2 e
       left join trab2 g on g.tid = e.agora_tid
       left join filas fl on fl.maquina_id = e.id
       left join pe on pe.maquina_id = e.id),
    jsonb_build_object(
      'total', (select count(*)::integer from sai),
      'itens', (select coalesce(jsonb_agg(jsonb_build_object(
                    'tipo', y.tipo,
                    'quando', case when y.dia = v_hoje then 'hoje' else 'amanha' end,
                    'hora_local', y.hora,
                    'os_numero', y.numero,
                    'maquina_id', y.maquina_id) order by y.rn), '[]'::jsonb)
                  from sai y where y.rn <= c_topo)),
    t.abertas, t.ea + t.ofi + t.ac + t.sa, t.sem_bloco, t.ofi,
    (select count(distinct y.os_id)::integer from trab2 y where y.bloco = 'oficina'),
    (select count(*)::integer from sem_maq),
    (select count(*)::integer from sem_maq y where exists (select 1 from trab2 z where z.os_id = y.os_id)),
    (select coalesce(jsonb_agg(distinct y.os_numero), '[]'::jsonb) from trab2 y where y.fora_da_oficina),
    (select count(*)::integer from est y where y.estado = 'rodando'),
    (select count(*)::integer from apa y where y.no_teto),
    (select coalesce(jsonb_agg(jsonb_build_object('os_numero', o3.numero, 'maquina_id', y.maquina_id)), '[]'::jsonb)
       from apa y left join public.ordens_servico_operacional o3 on o3.id = y.os_id
      where not y.maquina_ativa),
    (select count(*)::integer from maq)
    into v_blocos, v_cartoes, v_maquinas, v_saidas,
         v_abertas, v_soma_blocos, v_sem_bloco, v_oficina,
         v_nas_colunas, v_sem_maquina, v_nos_dois, v_fora_da_oficina,
         v_rodando, v_no_teto, v_sem_maq_ativa, v_ativas
    from tot t;

  -- o registro: prova de vida e so apontamento (reserva nao conta)
  select count(*) filter (where a.iniciado_em >= v_dia0 or a.finalizado_em >= v_dia0)::integer,
         count(*) filter (where a.finalizado_em is null)::integer,
         max(greatest(a.iniciado_em, a.finalizado_em))
    into v_ap_hoje, v_ap_abertos, v_ap_ultimo
    from public.apontamentos_producao a;

  select count(*) filter (where coalesce(p.fim, p.inicio) >= v_dia0)::integer, max(coalesce(p.fim, p.inicio))
    into v_j3_hoje, v_j3_ultimo
    from public.producao_3d_apontamentos p;

  v_vida := greatest(v_ap_ultimo, v_j3_ultimo);

  -- eventos: lista fechada de cinco tipos, id estavel
  with ev as (
    select 'apt-ini:' || a.id::text as id, 'apontamento_iniciado'::text as tipo, a.maquina_id, a.os_id, a.iniciado_em as em
      from public.apontamentos_producao a where a.iniciado_em >= v_dia0
    union all
    select 'apt-fim:' || a.id::text, 'apontamento_finalizado', a.maquina_id, a.os_id, a.finalizado_em
      from public.apontamentos_producao a where a.finalizado_em >= v_dia0
    union all
    select 'hist:' || h.id::text,
           case h.status_novo when 'aguardando_producao' then 'os_entrou_na_fila'
                              when 'em_acabamento' then 'os_foi_para_acabamento'
                              else 'os_ficou_pronta' end,
           null, h.os_id, h.mudou_em
      from public.os_status_historico h
     where h.mudou_em >= v_dia0
       and h.status_novo in ('aguardando_producao', 'em_acabamento', 'aguardando_retirada', 'aguardando_entrega')
  ),
  evn as (
    select e.id, e.tipo, e.maquina_id, o.numero, e.em,
           row_number() over (order by e.em desc, e.id) as rn
      from ev e left join public.ordens_servico_operacional o on o.id = e.os_id
  )
  select count(*)::integer,
         coalesce(jsonb_agg(jsonb_build_object(
           'id', n.id, 'tipo', n.tipo, 'maquina_id', n.maquina_id, 'os_numero', n.numero,
           'ocorrido_em', n.em,
           'hora_local', to_char(n.em at time zone c_fuso, 'HH24:MI'),
           'dia_local', to_char(n.em at time zone c_fuso, 'DD/MM')) order by n.rn)
           filter (where n.rn <= c_topo_ev), '[]'::jsonb)
    into v_ev_total, v_ev_itens
    from evn n;

  -- o ultimo evento, de qualquer dia: o mais recente de cada fonte, e o maior dos tres
  select jsonb_build_object(
           'id', u.id, 'tipo', u.tipo, 'maquina_id', u.maquina_id, 'os_numero', o.numero,
           'ocorrido_em', u.em,
           'hora_local', to_char(u.em at time zone c_fuso, 'HH24:MI'),
           'dia_local', to_char(u.em at time zone c_fuso, 'DD/MM'))
    into v_ev_ultimo
    from (
      (select 'apt-ini:' || a.id::text as id, 'apontamento_iniciado'::text as tipo, a.maquina_id, a.os_id, a.iniciado_em as em
         from public.apontamentos_producao a order by a.iniciado_em desc, a.id limit 1)
      union all
      (select 'apt-fim:' || a.id::text, 'apontamento_finalizado', a.maquina_id, a.os_id, a.finalizado_em
         from public.apontamentos_producao a where a.finalizado_em is not null
        order by a.finalizado_em desc, a.id limit 1)
      union all
      (select 'hist:' || h.id::text,
              case h.status_novo when 'aguardando_producao' then 'os_entrou_na_fila'
                                 when 'em_acabamento' then 'os_foi_para_acabamento'
                                 else 'os_ficou_pronta' end,
              null, h.os_id, h.mudou_em
         from public.os_status_historico h
        where h.status_novo in ('aguardando_producao', 'em_acabamento', 'aguardando_retirada', 'aguardando_entrega')
        order by h.mudou_em desc, h.id limit 1)
    ) u
    left join public.ordens_servico_operacional o on o.id = u.os_id
   order by u.em desc, u.id limit 1;

  -- CONFERENCIA: cada regra por dois caminhos; o que divergir vira falha nomeada.
  -- R1: abertas = soma dos quatro blocos (falha quando um status fica sem bloco).
  -- O outro caminho nao reusa o filtro de cima: conta as nao encerradas e tira as
  -- que sairam, lendo a tabela das entregas direto, e so quando o status e de saida.
  select count(*)::integer into v_nao_encerradas
    from public.ordens_servico_operacional o
   where not public.os_esta_encerrada(o.status);
  select count(*)::integer into v_sairam
    from public.ordens_servico_operacional o
   where not public.os_esta_encerrada(o.status)
     and public.bloco_da_tv(case when o.status = 'pausado'
           then (select h.status_anterior from public.os_status_historico h
                  where h.os_id = o.id and h.status_novo = o.status
                  order by h.mudou_em desc, h.id limit 1)
           else o.status end) = 'saida'
     and exists (select 1 from public.entregas_instalacoes e where e.os_id = o.id and e.status = 'concluida')
     and not exists (select 1 from public.entregas_instalacoes e where e.os_id = o.id and e.status in ('agendada', 'em_rota'));
  v_abertas_direto := v_nao_encerradas - v_sairam;
  if v_abertas_direto <> v_soma_blocos then
    v_falhas := v_falhas || jsonb_build_object('regra', 'R1', 'esperado', v_abertas_direto, 'obtido', v_soma_blocos,
      'detalhe', 'os_sem_bloco', 'quantas', v_sem_bloco);
  end if;
  if v_abertas_direto <> v_abertas then
    v_falhas := v_falhas || jsonb_build_object('regra', 'R1', 'esperado', v_abertas_direto, 'obtido', v_abertas,
      'detalhe', 'abertas_divergem');
  end if;

  -- R2: oficina = OS da oficina distintas nas colunas + sem maquina; nenhuma nos dois lugares
  if v_oficina <> v_nas_colunas + v_sem_maquina then
    v_falhas := v_falhas || jsonb_build_object('regra', 'R2', 'esperado', v_oficina, 'obtido', v_nas_colunas + v_sem_maquina,
      'detalhe', 'oficina_diverge_das_colunas');
  end if;
  -- Apontamento aberto de OS que o status diz estar em outro bloco (aberto pela
  -- ficha numa OS do acabamento, por exemplo) e fato da operacao, nao conta
  -- errada: a coluna mostra, os totais fecham sem ela, e sai aqui como aviso.
  if jsonb_array_length(v_fora_da_oficina) > 0 then
    v_avisos := v_avisos || jsonb_build_object('aviso', 'apontamento_aberto_fora_da_oficina',
      'os_numeros', v_fora_da_oficina);
  end if;
  if v_nos_dois > 0 then
    v_falhas := v_falhas || jsonb_build_object('regra', 'R2', 'esperado', 0, 'obtido', v_nos_dois,
      'detalhe', 'os_em_coluna_e_sem_maquina');
  end if;

  -- R3: atrasadas = nas maquinas (pela alocacao) + fora (pelos blocos)
  v_atr := (v_cartoes #>> '{atrasadas,total}')::integer;
  v_atr_maquinas := (v_cartoes #>> '{atrasadas,nas_maquinas}')::integer;
  v_atr_fora := (v_cartoes #>> '{atrasadas,fora}')::integer;
  if v_atr <> v_atr_maquinas + v_atr_fora then
    v_falhas := v_falhas || jsonb_build_object('regra', 'R3', 'esperado', v_atr, 'obtido', v_atr_maquinas + v_atr_fora,
      'detalhe', 'atrasadas_divergem');
  end if;

  -- R4: rodando = colunas no estado rodando; apontamento aberto sem maquina ativa nao some
  if v_rodando <> v_no_teto then
    v_falhas := v_falhas || jsonb_build_object('regra', 'R4', 'esperado', v_no_teto, 'obtido', v_rodando,
      'detalhe', 'rodando_diverge');
  end if;
  for v_linha in select x.value as ap from jsonb_array_elements(v_sem_maq_ativa) x loop
    v_falhas := v_falhas || jsonb_build_object('regra', 'R4', 'esperado', 0, 'obtido', 1,
      'detalhe', 'apontamento_aberto_sem_maquina_ativa',
      'os_numero', v_linha.ap -> 'os_numero', 'maquina_id', v_linha.ap -> 'maquina_id');
  end loop;

  -- R5: prontas de hoje cabem na saida; nenhuma lista maior que o seu total
  v_ja_prontas := (v_cartoes #>> '{prazo_hoje,ja_prontas}')::integer;
  v_saida := (v_blocos #>> '{saida,total}')::integer;
  if v_ja_prontas > v_saida then
    v_falhas := v_falhas || jsonb_build_object('regra', 'R5', 'esperado', v_saida, 'obtido', v_ja_prontas,
      'detalhe', 'prontas_maior_que_saida');
  end if;
  for v_linha in select m.value as maq from jsonb_array_elements(v_maquinas) m
            where (m.value #>> '{fila,total}')::integer < jsonb_array_length(m.value #> '{fila,itens}') loop
    v_falhas := v_falhas || jsonb_build_object('regra', 'R5',
      'esperado', jsonb_array_length(v_linha.maq #> '{fila,itens}'), 'obtido', (v_linha.maq #>> '{fila,total}')::integer,
      'detalhe', 'fila_menor_que_a_lista', 'maquina_id', v_linha.maq -> 'id');
  end loop;

  -- R6: a tela foi desenhada para cinco colunas
  select count(*)::integer into v_ativas_direto from public.maquinas m where m.ativa;
  if v_ativas_direto > c_colunas then
    v_falhas := v_falhas || jsonb_build_object('regra', 'R6', 'esperado', c_colunas, 'obtido', v_ativas_direto,
      'detalhe', 'maquinas_ativas_demais');
  end if;
  if v_ativas_direto <> jsonb_array_length(v_maquinas) then
    v_falhas := v_falhas || jsonb_build_object('regra', 'R6', 'esperado', v_ativas_direto,
      'obtido', jsonb_array_length(v_maquinas), 'detalhe', 'colunas_divergem_das_ativas');
  end if;

  return jsonb_build_object(
    'versao', 2,
    'gerado_em', v_agora,
    'hoje_local', v_hoje,
    'fuso', c_fuso,
    'intervalo_s', c_intervalo_s,
    'dentro_do_expediente', (extract(isodow from v_local) between 1 and 5
                             and v_local::time >= c_abre and v_local::time < c_fecha),
    'registro', jsonb_build_object(
      'apontamentos_hoje', v_ap_hoje,
      'apontamentos_abertos', v_ap_abertos,
      'ultimo_apontamento_local', public.tv_hora_local(v_ap_ultimo),
      'ultimo_registro_local', public.tv_hora_local(v_vida),
      'sem_apontamento_em_7_dias', coalesce((v_vida at time zone c_fuso)::date < v_hoje - 7, true),
      'jobs_3d_hoje', v_j3_hoje,
      'ultimo_job_3d_local', public.tv_hora_local(v_j3_ultimo)),
    'rodando', jsonb_build_object('total', v_rodando, 'de', v_ativas),
    'cartoes', v_cartoes,
    'blocos', v_blocos,
    'maquinas', v_maquinas,
    'saidas', v_saidas,
    'eventos', jsonb_build_object('ultimo', v_ev_ultimo, 'total_de_hoje', v_ev_total, 'itens_de_hoje', v_ev_itens),
    'consistencia', jsonb_build_object('ok', jsonb_array_length(v_falhas) = 0, 'falhas', v_falhas, 'avisos', v_avisos));
end;
$function$;

-- ------------------------------------------------- 3. quem pode chamar
-- As duas rodam com a permissão de quem chama. Mesmo assim: sem EXECUTE para
-- PUBLIC, para anon nem para authenticated.
REVOKE ALL ON FUNCTION public.tv_hora_local(timestamp with time zone) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tv_painel_maquinas() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tv_hora_local(timestamp with time zone) TO service_role;
GRANT EXECUTE ON FUNCTION public.tv_painel_maquinas() TO service_role;

-- CONFERIDO, em ensaios com rollback (DO ... RAISE EXCEPTION no fim) e depois
-- na função viva, em 01/10/2026 (19:37 a 19:55 de Macapá):
--   banco de hoje: as 5 colunas sem_registro · atrasadas 1 (a OS #49, 22 dias,
--     em entrada_arte) · entrada_arte 2 · abertas sem prazo 1 · rodando 0 de 5 ·
--     sem_apontamento_em_7_dias true · nenhum evento · consistência ok
--   quem chama: service_role passa · authenticated (admin) e anon →
--     "permission denied for function" · com EXECUTE dado só dentro do ensaio,
--     authenticated e postgres → 42501 "A parede da oficina só é lida pela
--     rota da TV." (somente_service_role)
--   um estado por máquina, com 25 OS de teste: rodando (previsto 120 min) ·
--     nao_fechou (apontamento de ontem) · bloqueada (reserva sem OS, com
--     janela) · reservada · pelo_status (em_3d; e por maquina_id num laser) ·
--     livre (apontamento finalizado hoje; e 3D com job de hoje) · sem_registro
--   teto: 11 h hoje → nao_fechou · 9 h → rodando · 3D com 20 h → rodando ·
--     3D com 25 h → nao_fechou
--   reserva vencida → não muda o estado; conta em reservas_vencidas e a linha
--     da fila vem com reserva_vencida
--   reserva de OS em entrada cobrindo agora → sem_registro, a_caminho 1
--   reserva de OS pausada cobrindo agora → não vira reservada; fila com pausada
--   OS com 2 itens em 2 máquinas → nas duas colunas, 1 vez no total da oficina
--   OS pausada vinda da oficina → na coluna dela, com pausada
--   OS entregue e não encerrada, e OS concluída com reserva → fora da parede
--   sem máquina: generico, laser_sem_maquina, terceiro_uv, fila_sem_reserva
--   letreiro: retirada, entrega (com hora só quando há janela), instalação,
--     reserva e bloqueio de hoje e de amanhã; cancelada, de anteontem, de
--     depois de amanhã e de OS encerrada ficam fora
--   falhas que TÊM de aparecer, e apareceram: R1 os_sem_bloco (OS criada já
--     pausada) · R2 os_na_coluna_fora_da_oficina (apontamento aberto de OS do
--     acabamento) · R3 atrasadas_divergem (a mesma OS) · R4 rodando_diverge +
--     apontamento_aberto_sem_maquina_ativa (máquina inativa) · R6
--     maquinas_ativas_demais (6ª máquina, que sai como 6ª coluna de tipo nulo)
--   apontamento aberto sem OS → rodando, com os_numero nulo
--   "R$ 150,00 Zuleica Plantada" plantado em título, briefing e observações da
--     OS, descrição do item, título e observações da reserva, observações do
--     apontamento e do job 3D, endereço e observações da entrega: nenhum valor
--     de texto do retorno casou com R$, com \d+,\d{2} nem com o nome; nenhuma
--     chave com palavra de dinheiro ou de cliente (fora com_cliente, que é
--     contagem); estados, tipos de evento, de saída, de origem e de item só
--     das listas fechadas. O detector foi provado contra 3 textos plantados.
--   empate de horário entre eventos: eventos.ultimo saía diferente de
--     itens_de_hoje[0]; com o desempate por id ficou igual e estável
--   tempo: banco de hoje 74 ms na 1ª chamada da sessão e 18 ms na 2ª · com
--     510 OS (186 abertas), 502 apontamentos, 2.042 linhas de histórico e
--     8 reservas: 54, 34 e 32 ms; retorno de 21 KB
--   depois dos ensaios: 2 OS, 0 apontamentos, 0 reservas, 5 máquinas — nada de
--     teste ficou
-- NÃO MEDIDO: a chamada pelo PostgREST com a chave de serviço (a rota é da
--   fase seguinte; a guarda foi ensaiada com SET LOCAL ROLE) · a virada do dia
--   às 00:00 de Macapá e dentro_do_expediente = true (os ensaios rodaram entre
--   19h e 20h de uma quinta) · R5 falhando (não há dado que a provoque) ·
--   custo em pg_stat_statements com a TV chamando a cada 60 s.
--
-- CORRIGIDO em 01/10/2026 (20:35 a 21:10 de Macapá) depois da verificação
-- adversarial, cada defeito reproduzido ANTES na função viva e a correção
-- ensaiada com rollback (a definição viva remendada dentro do DO, md5 do
-- corpo conferido contra este arquivo) e só depois aplicada:
--   OS em retrabalho com entrega concluída: antes sumia (acabamento 1,
--     atrasadas 2, consistência ok); agora acabamento 2, retrabalho 1,
--     atrasadas 5 — e a OS no balcão com retirada registrada continua fora
--   OS do acabamento com apontamento aberto: antes atrasadas {2, 1, 2} com
--     falhas R2 e R3; agora {5, 2, 3} fecha, ok=true, aviso
--     apontamento_aberto_fora_da_oficina [nº], agora.fora_da_oficina true
--   OS em_corte com maquina_id do Recorte e reserva vencida na Impressão:
--     antes o Recorte ficava sem_registro; agora Recorte pelo_status
--     (maquina_id) E a reserva na fila da Impressão (vencida, 29/09)
--   OS em_impressao com maquina_id velho do Recorte: antes o Recorte dizia
--     NA MÁQUINA e a Impressão calava; agora a Impressão pelo_status (status)
--   em_laser_cnc com maquina_id da Impressão → sem máquina, laser_sem_maquina;
--     com maquina_id do CO2 → fila do CO2 (maquina_id)
--   OS em produção com reserva em outra máquina; fila com reserva em outra;
--     fila só com maquina_id → cada uma no lugar da regra
--   uma OS em design com 3 reservas → a_caminho 1 (era 3)
--   reserva órfã (os_id nulo, origem 'os') cobrindo agora → não é bloqueada;
--     bloqueio manual → bloqueada
--   cartoes: atrasadas total 5 com 4 itens (a #49 em entrada_arte só conta);
--     prazo_hoje total 1, itens []
--   livre por apontamento → livre_por 'apontamento'; 3D livre por job de hoje
--     com apontamento antigo → livre_por 'job_3d'; registro.ultimo_registro_local
--   teto pela função: 11 h → nao_fechou; 9 h → rodando; R1 os_sem_bloco com a
--     OS criada pausada; texto plantado em todos os campos livres → nada vazou;
--     22 ms na 2ª chamada
--   oficina 7 = nas_colunas 6 + sem_maquina 1; R2 sem falha
--   depois: OS [44, 49], 0 apontamentos, 0 reservas, 0 entregas — nada ficou
-- NÃO MEDIDO: R2 falhando depois da correção (não há dado que a provoque:
--   apontamento aberto de OS fora da oficina virou aviso).
