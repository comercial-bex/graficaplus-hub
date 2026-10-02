-- ============================================================================
-- A base única da parede: "aberta", "etapa", "bloco", "hoje" e "qual máquina"
-- ============================================================================
--
-- A TV da Oficina vai mostrar números em letra de parede, e número de parede
-- não pode discordar da lista que está embaixo dele. Na TV2 da agência o
-- defeito nº 1 foi exatamente esse: o cartão contava com um conjunto de status
-- e a lista com outro (faltava `aprovado` no "aberto"), e os dois estavam na
-- mesma tela se desmentindo.
--
-- Aqui o risco é o mesmo, com mais portas. Antes desta migração o banco não
-- tinha NENHUMA função para "a OS está encerrada" nem para "em que etapa a OS
-- está": cada consulta escrevia a sua lista `NOT IN ('concluido','faturado',
-- 'cancelado')` (há pelo menos quatro em `pendencias_do_sistema`,
-- `tg_automacao_os_eventos`, `tg_entrega_conclui_a_os` e
-- `previsoes_desatualizadas`), e a divisão em etapas só existia em TypeScript
-- (`src/domain/os/etapas.ts`). A função da TV seria a quinta cópia.
--
-- Então, antes da tela, uma fonte só:
--
--   hoje_local()            o dia em Macapá. O banco roda em UTC: `current_date`
--                           vira o dia às 21h de lá, e "prazo hoje" passaria a
--                           ser "prazo amanhã" no fim do expediente.
--   os_esta_encerrada(s)    concluido, faturado, cancelado. Espelho de
--                           `osEstaEncerrada`.
--   etapa_da_os(s)          ESPELHO EXATO de `etapaDe` em etapas.ts: as seis
--                           etapas, os 26 status.
--   bloco_da_tv(s)          derivada de `etapa_da_os`, com as três exceções da
--                           parede escritas UMA vez:
--                             aguardando_producao  é pré-impressão no quadro,
--                                                  mas na parede já é fila da
--                                                  oficina
--                             pausado              vira 'pausada' — quem monta
--                                                  a tela devolve a OS ao bloco
--                                                  do status anterior
--                             concluido, faturado, cancelado   'fora'
--                           7 + 8 + 3 + 4 + 1 + 3 = 26. Sem ELSE de propósito:
--                           um valor novo no enum devolve NULL, e a conferência
--                           R1 da TV (abertas = soma dos blocos) acusa, em vez
--                           de a OS sumir da parede em silêncio.
--   os_saiu_fisicamente(id) a peça já foi entregue, instalada ou retirada e a
--                           OS só não fechou (falta quitar). Sai da parede:
--                           senão o mini "NA SAÍDA" vira a lista de quem deve.
--   tipos_de_maquina()      o mapa único tipo da máquina → status de produção,
--                           ordem das colunas e etapa padrão do apontamento.
--   status_da_maquina(tipo) o status específico que a máquina grava.
--   maquina_do_status(s)    o tipo de máquina que o status identifica — só
--                           quando identifica UMA. `em_laser_cnc` devolve NULL
--                           porque a casa tem dois lasers (CO2 e Fiber) e o
--                           status não diz qual; `em_uv` também, porque a casa
--                           não tem UV.
--   teto_do_apontamento(iniciado_em, tipo)
--                           o instante em que um apontamento aberto deixa de
--                           valer: fim do dia local OU 10 h corridas, o que
--                           vier primeiro; na impressora 3D, 24 h corridas
--                           (decisão do dono, 01/10). Escrito UMA vez porque
--                           dois lugares precisam do mesmo número: a parede
--                           (RODANDO x NÃO FECHOU) e o fechamento do
--                           apontamento (até onde o tempo vira custo de
--                           máquina). Medido antes: a TV dizia NÃO FECHOU
--                           há 10 h e o fechamento lançava 20 h.
--
-- `maquinas.tipo` é texto livre, não enum. Tipo fora do mapa devolve NULL e
-- quem chama tem de tratar — `comecar_na_maquina` recusa com mensagem, em vez
-- de inventar um status.
--
-- O teste `tests/tv-bloco-espelha-etapas.test.ts` lê ESTE arquivo e etapas.ts e
-- falha se um status ficar sem bloco, se a etapa do SQL divergir da do
-- TypeScript ou se o mapa de máquinas divergir de `identidade-da-maquina.ts`.
-- Mexeu no enum, na lista de etapas ou no cadastro de tipos? Os dois lados
-- mudam na mesma migração.
--
-- Nenhuma destas funções é SECURITY DEFINER. Sete não leem tabela nenhuma;
-- `os_saiu_fisicamente` lê `entregas_instalacoes` com a permissão de quem
-- chama (a RLS da tabela continua valendo). Mesmo assim: sem EXECUTE para
-- PUBLIC nem para anon.
--
-- Retrato do banco vivo: aplicado e conferido em 01/10/2026.

-- ------------------------------------------------------------ 1. hoje, em Macapá
CREATE OR REPLACE FUNCTION public.hoje_local()
 RETURNS date
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT (now() AT TIME ZONE 'America/Belem')::date
$function$;

-- ------------------------------------------------------------ 2. encerrada
CREATE OR REPLACE FUNCTION public.os_esta_encerrada(p_status public.status_os)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(p_status IN ('concluido', 'faturado', 'cancelado'), false)
$function$;

-- ------------------------------------------------------------ 3. a etapa
CREATE OR REPLACE FUNCTION public.etapa_da_os(p_status public.status_os)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN p_status IN ('entrada', 'aguardando_briefing', 'briefing_ok') THEN 'entrada'
    WHEN p_status IN ('design', 'aguardando_aprovacao_arte', 'arte_aprovada', 'arte_rejeitada', 'aguardando_producao') THEN 'pre_impressao'
    WHEN p_status IN ('em_impressao', 'em_corte', 'em_laser_cnc', 'em_3d', 'em_uv', 'em_producao', 'producao') THEN 'producao'
    WHEN p_status IN ('em_acabamento', 'controle_qualidade', 'retrabalho') THEN 'acabamento'
    WHEN p_status IN ('aguardando_retirada', 'aguardando_entrega', 'em_entrega', 'em_instalacao', 'concluido', 'faturado') THEN 'saida'
    WHEN p_status IN ('pausado', 'cancelado') THEN 'fora_do_fluxo'
  END
$function$;

-- ------------------------------------------------------------ 4. o bloco da parede
CREATE OR REPLACE FUNCTION public.bloco_da_tv(p_status public.status_os)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN p_status = 'pausado' THEN 'pausada'
    WHEN public.os_esta_encerrada(p_status) THEN 'fora'
    WHEN p_status = 'aguardando_producao' THEN 'oficina'
    ELSE CASE public.etapa_da_os(p_status)
      WHEN 'entrada' THEN 'entrada_arte'
      WHEN 'pre_impressao' THEN 'entrada_arte'
      WHEN 'producao' THEN 'oficina'
      WHEN 'acabamento' THEN 'acabamento'
      WHEN 'saida' THEN 'saida'
    END
  END
$function$;

-- ------------------------------------------------------------ 5. já saiu da casa
CREATE OR REPLACE FUNCTION public.os_saiu_fisicamente(p_os_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.entregas_instalacoes e WHERE e.os_id = p_os_id AND e.status = 'concluida')
     AND NOT EXISTS (SELECT 1 FROM public.entregas_instalacoes e WHERE e.os_id = p_os_id AND e.status IN ('agendada', 'em_rota'))
$function$;

-- ------------------------------------------------------------ 6. máquina ↔ status
CREATE OR REPLACE FUNCTION public.tipos_de_maquina()
 RETURNS TABLE(tipo text, status_producao public.status_os, ordem integer, etapa_padrao text)
 LANGUAGE sql
 IMMUTABLE ROWS 5
 SET search_path TO 'public'
AS $function$
  VALUES
    ('plotter_impressao'::text, 'em_impressao'::public.status_os, 1, 'Impressão'::text),
    ('plotter_recorte', 'em_corte', 2, 'Recorte'),
    ('laser_co2', 'em_laser_cnc', 3, 'Laser'),
    ('laser_fiber', 'em_laser_cnc', 4, 'Laser'),
    ('impressora_3d', 'em_3d', 5, 'Impressão 3D')
$function$;

CREATE OR REPLACE FUNCTION public.status_da_maquina(p_tipo text)
 RETURNS public.status_os
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT t.status_producao FROM public.tipos_de_maquina() t WHERE t.tipo = p_tipo
$function$;

CREATE OR REPLACE FUNCTION public.maquina_do_status(p_status public.status_os)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE WHEN count(*) = 1 THEN min(t.tipo) END FROM public.tipos_de_maquina() t WHERE t.status_producao = p_status
$function$;

-- ------------------------------------------------------------ 7. até quando o apontamento vale
-- Um número só, lido pela parede (RODANDO x NÃO FECHOU) e pelo fechamento (até
-- onde o tempo vira custo de máquina). Devolve o INSTANTE em que o apontamento
-- passa do teto.
CREATE OR REPLACE FUNCTION public.teto_do_apontamento(p_iniciado_em timestamp with time zone, p_tipo text)
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE WHEN public.status_da_maquina(p_tipo) = 'em_3d'
              THEN p_iniciado_em + interval '24 hours'
              ELSE LEAST(p_iniciado_em + interval '10 hours',
                         ((p_iniciado_em AT TIME ZONE 'America/Belem')::date + 1)::timestamp AT TIME ZONE 'America/Belem')
         END
$function$;

-- ------------------------------------------------------------ 8. quem pode chamar
REVOKE ALL ON FUNCTION public.hoje_local() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.os_esta_encerrada(public.status_os) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.etapa_da_os(public.status_os) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bloco_da_tv(public.status_os) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.os_saiu_fisicamente(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tipos_de_maquina() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.status_da_maquina(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.maquina_do_status(public.status_os) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.teto_do_apontamento(timestamp with time zone, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hoje_local() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.os_esta_encerrada(public.status_os) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.etapa_da_os(public.status_os) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bloco_da_tv(public.status_os) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.os_saiu_fisicamente(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.tipos_de_maquina() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.status_da_maquina(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.maquina_do_status(public.status_os) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.teto_do_apontamento(timestamp with time zone, text) TO authenticated, service_role;

-- CONFERIDO, em ensaio com rollback e depois no banco vivo (01/10/2026):
--   os 26 valores do enum, um bloco cada, nenhum NULL:
--     entrada_arte 7 · oficina 8 · acabamento 3 · saida 4 · pausada 1 · fora 3
--   por etapa (igual a etapas.ts):
--     entrada 3 · pre_impressao 5 · producao 7 · acabamento 3 · saida 6 · fora_do_fluxo 2
--   encerradas: concluido, faturado, cancelado; os_esta_encerrada(NULL) = false
--   as 5 máquinas ativas têm status: impressão → em_impressao, recorte → em_corte,
--     os dois lasers → em_laser_cnc, 3D → em_3d; tipo desconhecido → NULL
--   maquina_do_status: em_impressao, em_corte e em_3d identificam; em_laser_cnc → NULL
--   os_saiu_fisicamente: sem linha = não · só agendada = não · em rota = não ·
--     concluída + outra em rota = não · concluída + cancelada = SIM ·
--     concluída + não necessária = SIM
--   as duas OS reais (#44 e #49): bloco entrada_arte, não saíram
--   teto_do_apontamento (01/10, 20:50 de Macapá): começou 09:00 → 19:00 do
--     mesmo dia; começou 23:55 → 00:00 do dia seguinte; 3D às 18:00 → 18:00
--     do dia seguinte; tipo nulo (máquina apagada) → vale a regra geral
--   hoje_local() na virada do dia UTC: às 21:06 de Macapá (00:06 UTC de 02/10)
--     a parede devolveu hoje_local = 2026-10-01 — o dia é o de Macapá
-- NÃO MEDIDO: hoje_local() na virada do dia LOCAL (00:00 de Macapá).
