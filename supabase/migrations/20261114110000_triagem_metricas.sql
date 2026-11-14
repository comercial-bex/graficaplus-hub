-- APLICADA em 14/11/2026 (views só de leitura, conferidas). Triagem de boas-vindas, B10: métricas só de leitura.
--
-- Só views e GRANTs. Nenhuma tabela, função, gatilho ou dado muda. As views são security_invoker (leem com o poder de
-- quem pergunta, não do dono da view) e só devolvem CONTAGENS e tempos: nenhuma coluna de nome, CEP, telefone,
-- endereço ou texto de mensagem sai delas. Quem lê é o servidor (service_role), depois de conferir a permissão da
-- tela da triagem; o navegador não recebe GRANT, porque a tela precisa de quem pode ligar OU editar o robô, e a RLS
-- das tabelas pede outra permissão (whatsapp.read): ler pelo navegador mostraria zero para quem tem uma permissão e
-- não a outra, e zero se lê como "sem dados".
--
-- Regras de contagem (valem para as três views):
--  * Só modo 'real'. Simulação (modo 'ensaio') nunca envia nada ao contato e não entra em número nenhum.
--  * "Triadas" = real e status diferente de 'pulada'. Pulada é conversa que o portão deixou de fora (cliente cadastrado,
--    robô de empresa, quem já foi atendido): a triagem nem começou. Aparece à parte, fora do denominador.
--  * O dia é o de Macapá (America/Belem, o mesmo de hoje_br()), pelo início da triagem (iniciada_em).
--  * "Abandonadas" = status 'expirada': o robô perguntou e o contato não voltou dentro do prazo.
--  * "Respondeu ao nome" = chegou a gravar um nome (nome_informado preenchido), sobre quem recebeu ao menos uma mensagem
--    do robô (mensagens_enviadas > 0). O valor do nome nunca sai: só a contagem.
--  * "Pediu preço" = a pessoa perguntou preço em algum momento (pediu_preco). O robô nunca responde valor.
--  * Pausa por humano: status 'pausada_humano' (estado de agora) e, nos eventos, a pausa por humano já feita, mesmo das
--    triagens que depois foram retomadas. Evento de pausa por humano é o do banco (detalhe.status = 'pausada_humano') OU o
--    do motor em TypeScript (detalhe.motivo = 'humano', ver maquina.ts). Cada triagem conta UMA vez, não importa em quantos
--    eventos ou de que lado a pausa foi gravada.
--  * Todo número da janela de 30 dias fala da MESMA população: triagens iniciadas nos últimos 30 dias.

BEGIN;

DO $pre$
BEGIN
  IF to_regclass('public.whatsapp_triagens') IS NULL OR to_regclass('public.whatsapp_triagem_eventos') IS NULL THEN
    RAISE EXCEPTION 'Aplique antes 20261113132000_triagem_estado_e_envio.sql: as tabelas da triagem não existem';
  END IF;
  IF to_regprocedure('public.hoje_br()') IS NULL THEN
    RAISE EXCEPTION 'public.hoje_br() não existe (migração 20261030810000_relogio_de_macapa.sql): o recorte de 30 dias depende dela';
  END IF;
END
$pre$;

-- 1. Uma linha por dia e ramo -----------------------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.triagem_metricas_dia WITH (security_invoker = true) AS
SELECT
  (t.iniciada_em AT TIME ZONE 'America/Belem')::date AS dia,
  t.ramo::text AS ramo,
  count(*) FILTER (WHERE t.status <> 'pulada') AS triadas,
  count(*) FILTER (WHERE t.status = 'pulada') AS puladas,
  count(*) FILTER (WHERE t.status = 'ativa') AS em_andamento,
  count(*) FILTER (WHERE t.status = 'concluida') AS concluidas,
  count(*) FILTER (WHERE t.status = 'entregue_equipe') AS entregues_equipe,
  count(*) FILTER (WHERE t.status = 'expirada') AS abandonadas,
  count(*) FILTER (WHERE t.status = 'pausada_humano') AS pausadas_humano,
  count(*) FILTER (WHERE t.status = 'pausada_desligada') AS pausadas_desligada,
  count(*) FILTER (WHERE t.status = 'parada_pelo_contato') AS paradas_pelo_contato,
  count(*) FILTER (WHERE t.status <> 'pulada' AND t.mensagens_enviadas > 0) AS enviou_boas_vindas,
  count(*) FILTER (WHERE t.status <> 'pulada' AND t.mensagens_enviadas > 0 AND t.nome_informado IS NOT NULL) AS respondeu_nome,
  count(*) FILTER (WHERE t.status <> 'pulada' AND t.pediu_preco) AS pediu_preco,
  count(*) FILTER (WHERE t.status = 'concluida' AND t.concluida_em IS NOT NULL) AS concluidas_com_tempo,
  coalesce(sum(extract(epoch FROM (t.concluida_em - t.iniciada_em)))
           FILTER (WHERE t.status = 'concluida' AND t.concluida_em IS NOT NULL), 0)::bigint AS soma_segundos_ate_concluir
FROM public.whatsapp_triagens t
WHERE t.modo = 'real'
GROUP BY 1, 2;
COMMENT ON VIEW public.triagem_metricas_dia IS
  'Triagem de boas-vindas por dia (Macapá) e ramo, só modo real. Só contagens: sem nome, CEP, telefone ou texto. Lida pelo servidor.';

-- 2. Uma linha por ramo, últimos 30 dias, com a mediana do tempo até concluir ----------------------------------------
-- A mediana não se soma entre dias, por isso mora numa view própria. Mesma regra de contagem da view por dia.
CREATE OR REPLACE VIEW public.triagem_metricas_30_dias WITH (security_invoker = true) AS
SELECT
  t.ramo::text AS ramo,
  count(*) FILTER (WHERE t.status <> 'pulada') AS triadas,
  count(*) FILTER (WHERE t.status = 'pulada') AS puladas,
  count(*) FILTER (WHERE t.status = 'concluida') AS concluidas,
  count(*) FILTER (WHERE t.status = 'entregue_equipe') AS entregues_equipe,
  count(*) FILTER (WHERE t.status = 'expirada') AS abandonadas,
  count(*) FILTER (WHERE t.status = 'pausada_humano') AS pausadas_humano,
  count(*) FILTER (
    WHERE t.status <> 'pulada'
      AND EXISTS (SELECT 1 FROM public.whatsapp_triagem_eventos e
                   WHERE e.triagem_id = t.id AND e.tipo = 'pausa'
                     AND (e.detalhe ->> 'status' = 'pausada_humano' OR e.detalhe ->> 'motivo' = 'humano'))
  ) AS triagens_com_pausa_humano,
  count(*) FILTER (WHERE t.status <> 'pulada' AND t.mensagens_enviadas > 0) AS enviou_boas_vindas,
  count(*) FILTER (WHERE t.status <> 'pulada' AND t.mensagens_enviadas > 0 AND t.nome_informado IS NOT NULL) AS respondeu_nome,
  count(*) FILTER (WHERE t.status <> 'pulada' AND t.pediu_preco) AS pediu_preco,
  count(*) FILTER (WHERE t.status = 'concluida' AND t.concluida_em IS NOT NULL) AS concluidas_com_tempo,
  (percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (t.concluida_em - t.iniciada_em)))
     FILTER (WHERE t.status = 'concluida' AND t.concluida_em IS NOT NULL))::bigint AS mediana_segundos_ate_concluir
FROM public.whatsapp_triagens t
WHERE t.modo = 'real'
  AND (t.iniciada_em AT TIME ZONE 'America/Belem')::date >= public.hoje_br() - 29
GROUP BY 1;
COMMENT ON VIEW public.triagem_metricas_30_dias IS
  'Triagem de boas-vindas nos últimos 30 dias (hoje de Macapá e os 29 dias antes) por ramo, só modo real, com a mediana do tempo até concluir. Só contagens. Lida pelo servidor.';

-- 3. Pausas por humano por dia, contadas nos eventos (inclui as triagens que depois foram retomadas) ----------------------
-- Aceita os dois jeitos de gravar a pausa (banco: detalhe.status; motor TypeScript: detalhe.motivo = 'humano') e conta cada
-- triagem uma vez por dia, mesmo que os dois eventos existam. A mesma triagem em dias diferentes aparece em cada dia (é o
-- que aconteceu naquele dia); por isso esta view NÃO se soma entre dias: o total da janela vem da view de 30 dias.
CREATE OR REPLACE VIEW public.triagem_metricas_pausas_dia WITH (security_invoker = true) AS
SELECT
  (e.criado_em AT TIME ZONE 'America/Belem')::date AS dia,
  count(DISTINCT e.triagem_id) AS triagens_com_pausa_humano
FROM public.whatsapp_triagem_eventos e
JOIN public.whatsapp_triagens t ON t.id = e.triagem_id
WHERE e.tipo = 'pausa'
  AND (e.detalhe ->> 'status' = 'pausada_humano' OR e.detalhe ->> 'motivo' = 'humano')
  AND t.modo = 'real'
GROUP BY 1;
COMMENT ON VIEW public.triagem_metricas_pausas_dia IS
  'Triagens com pausa causada por gente da equipe, por dia (Macapá), só modo real, cada triagem uma vez por dia. Não se soma entre dias. Só contagens. Lida pelo servidor.';

-- 4. Acesso: só o servidor lê. REVOKE pelo nome, porque revogar de PUBLIC não fecha o anon nem o authenticated. --------
REVOKE ALL ON public.triagem_metricas_dia FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.triagem_metricas_30_dias FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.triagem_metricas_pausas_dia FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.triagem_metricas_dia TO service_role;
GRANT SELECT ON public.triagem_metricas_30_dias TO service_role;
GRANT SELECT ON public.triagem_metricas_pausas_dia TO service_role;

-- 5. Conferência: tudo o que a migração prometeu, ou desfaz. ------------------------------------------------------------
DO $conferencia$
DECLARE
  v text;
BEGIN
  FOREACH v IN ARRAY ARRAY['triagem_metricas_dia', 'triagem_metricas_30_dias', 'triagem_metricas_pausas_dia'] LOOP
    IF NOT coalesce((SELECT c.reloptions @> ARRAY['security_invoker=true'] FROM pg_class c
                      WHERE c.oid = ('public.' || v)::regclass), false) THEN
      RAISE EXCEPTION 'a view % não ficou security_invoker', v;
    END IF;
    IF has_table_privilege('anon', 'public.' || v, 'SELECT') OR has_table_privilege('authenticated', 'public.' || v, 'SELECT') THEN
      RAISE EXCEPTION 'a view % está aberta para anon ou authenticated', v;
    END IF;
    IF NOT has_table_privilege('service_role', 'public.' || v, 'SELECT') THEN
      RAISE EXCEPTION 'a view % não está aberta para o servidor', v;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = v
                  AND column_name ~ '^nome|(^|_)(cep|telefone|phone|endereco|texto|email|lid)(_|$)') THEN
      RAISE EXCEPTION 'a view % tem coluna com cara de dado pessoal', v;
    END IF;
  END LOOP;
END
$conferencia$;

COMMIT;
