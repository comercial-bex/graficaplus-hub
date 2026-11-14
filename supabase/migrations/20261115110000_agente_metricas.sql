-- NÃO APLICADA. Roteiro de ensaio: docs/ensaio-agente-escolhe.md, seção 8.
-- ORDEM: depois de 20261115100000_agente_escolhe_respostas.sql (as tabelas agente_eventos e agente_config) e de
-- 20261114120000_agente_base_de_respostas.sql (agente_base_respostas). Também usa public.hoje_br() (relógio de Macapá).
--
-- AS MÉTRICAS DO AGENTE (Bex Print, C4): só views e GRANTs. Nenhuma tabela, função, gatilho, coluna ou dado muda.
--
-- O QUE SÃO: quatro views de LEITURA sobre o rastro do agente (agente_eventos) e sobre a base de respostas, para a tela
-- /configuracoes-agente mostrar cobertura, volta à equipe por motivo, respostas mais usadas e nunca usadas, e perguntas sem
-- resposta. Mesmo molde das views da triagem (20261114110000_triagem_metricas.sql):
--   * security_invoker (leem com o poder de quem pergunta, não do dono da view);
--   * SÓ CONTAGENS, códigos de motivo, códigos de tema, ids de RESPOSTA da base e datas. Nenhum nome, telefone, CEP, texto de
--     mensagem, id de conversa nem id de mensagem sai delas. A frase do contato sem resposta nunca foi guardada: o que existe é
--     o evento 'entregou' com motivo 'sem_resposta', e aqui só se conta quantos foram, por dia;
--   * só o service_role lê. O navegador não recebe GRANT: a tela precisa de quem tem configuracoes.manage OU whatsapp.manage, e
--     a RLS das tabelas aceita as duas, mas ler pelo navegador mostraria zero para quem tem só uma "permissão de tela" e uma
--     falha que se lê como vazio é pior que um erro. O servidor confere a permissão e lê com a chave de serviço.
--
-- REGRAS DE CONTAGEM (valem para as quatro views; a tela repete o denominador de cada taxa):
--   * REAL e ENSAIO NUNCA se misturam: a coluna modo vale 'real' para os eventos que o agente gravou ao decidir de verdade
--     (escolheu, entregou, barrado) e 'ensaio' para o evento tipo 'ensaio' (o que o agente FARIA; nada saiu).
--   * UMA DECISÃO é um evento com mensagem_id (a mensagem de entrada do contato). O evento 'enviado' (a saída na fila) e os
--     eventos sem mensagem_id (erro, pausado, freio) não são decisão e não entram em agente_metricas_dia.
--   * agente_metricas_dia: por dia (Macapá), modo e ramo: decisoes (todas), escolhidas (acao escolher), entregues (acao entregar),
--     barradas (acao barrar ou parar, o silêncio) e sensiveis (as escolhidas ou entregues que eram pergunta de preço; o nome
--     evita a palavra de dinheiro de propósito, como a coluna do evento). "Perguntas" = escolhidas + entregues: o que o agente
--     chegou a ler como pergunta. Cobertura = escolhidas sobre perguntas.
--   * agente_metricas_motivos_30_dias: por modo, ramo, acao e motivo, nos últimos 30 dias (hoje de Macapá e os 29 antes). Inclui
--     o evento 'entregou' com motivo 'passou_com_a_resposta' (a resposta aprovada saiu E a conversa foi à equipe), que não tem
--     mensagem_id e por isso a tela usa os motivos como a sua própria base: o denominador de "volta por motivo" é a soma desta
--     view, nunca o total de decisoes de outra.
--   * agente_metricas_respostas: UMA linha por resposta NÃO arquivada da base (inclusive as que nunca foram usadas, de propósito:
--     é o que torna "nunca usada" visível), com o uso real e o uso em ensaio nos últimos 30 dias, o total guardado (a retenção
--     do rastro apaga o antigo) e o último uso. Uso real é o evento 'escolheu'; uso em ensaio é o 'ensaio' com acao 'escolher'.
--   * agente_metricas_sem_resposta_dia: por dia, modo e ramo, quantas perguntas o agente entregou por motivo 'sem_resposta'.
--
-- NADA DISTO FALA COM TABELA QUENTE: views não travam as tabelas que leem. A migração abre com lock_timeout de 5 s por hábito e
-- porque CREATE VIEW pega uma trava curta no catálogo. Todo UPDATE e DELETE de outras migrações continua com WHERE; esta não tem nenhum.
-- A conferência no fim desfaz tudo se algo estiver fora do esperado, inclusive se alguma view ficar com privilégio de escrita para o
-- service_role (o default do Supabase concede tudo a ele, e o REVOKE desta migração tira).

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $pre$
DECLARE v_falta text;
BEGIN
  SELECT string_agg(x, ', ') INTO v_falta FROM (
    SELECT 'tabela agente_eventos (aplique antes 20261115100000_agente_escolhe_respostas.sql)' AS x WHERE to_regclass('public.agente_eventos') IS NULL
    UNION ALL SELECT 'tabela agente_config' WHERE to_regclass('public.agente_config') IS NULL
    UNION ALL SELECT 'tabela agente_base_respostas (aplique antes 20261114120000_agente_base_de_respostas.sql)' WHERE to_regclass('public.agente_base_respostas') IS NULL
    UNION ALL SELECT 'função hoje_br (20261030810000_relogio_de_macapa.sql)' WHERE to_regprocedure('public.hoje_br()') IS NULL
  ) q;
  IF v_falta IS NOT NULL THEN
    RAISE EXCEPTION 'Falta antes desta migração: %', v_falta;
  END IF;
  -- migração aplicada duas vezes: para, em vez de trocar a definição de uma view que a tela já lê
  SELECT string_agg(c.relname, ', ') INTO v_falta FROM pg_class c
   WHERE c.relnamespace = 'public'::regnamespace
     AND c.relname IN ('agente_metricas_dia', 'agente_metricas_motivos_30_dias', 'agente_metricas_respostas', 'agente_metricas_sem_resposta_dia');
  IF v_falta IS NOT NULL THEN
    RAISE EXCEPTION 'Já existe: %. Esta migração só cria; confira se ela já foi aplicada.', v_falta;
  END IF;
  -- o servidor lê as views com o service_role: sem SELECT nas tabelas de baixo a view devolveria erro de permissão
  IF NOT has_table_privilege('service_role', 'public.agente_eventos', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.agente_base_respostas', 'SELECT') THEN
    RAISE EXCEPTION 'o service_role não lê agente_eventos ou agente_base_respostas: as views não funcionariam para o servidor';
  END IF;
END $pre$;

-- 1. Uma linha por dia, modo e ramo -------------------------------------------------------------------------------------
CREATE VIEW public.agente_metricas_dia WITH (security_invoker = true) AS
SELECT
  (e.criado_em AT TIME ZONE 'America/Belem')::date AS dia,
  CASE WHEN e.tipo = 'ensaio' THEN 'ensaio' ELSE 'real' END AS modo,
  e.ramo AS ramo,
  count(*) AS decisoes,
  count(*) FILTER (WHERE e.acao = 'escolher') AS escolhidas,
  count(*) FILTER (WHERE e.acao = 'entregar') AS entregues,
  count(*) FILTER (WHERE e.acao IN ('barrar', 'parar')) AS barradas,
  count(*) FILTER (WHERE e.acao IN ('escolher', 'entregar') AND e.sensivel) AS sensiveis
FROM public.agente_eventos e
WHERE e.tipo IN ('escolheu', 'entregou', 'barrado', 'ensaio')
  AND e.mensagem_id IS NOT NULL
GROUP BY 1, 2, 3;
COMMENT ON VIEW public.agente_metricas_dia IS
  'Decisões do agente por dia (Macapá), modo (real ou ensaio) e ramo. Só contagens. Perguntas = escolhidas + entregues. Lida pelo servidor.';

-- 2. Motivos, últimos 30 dias ---------------------------------------------------------------------------------------------
CREATE VIEW public.agente_metricas_motivos_30_dias WITH (security_invoker = true) AS
SELECT
  CASE WHEN e.tipo = 'ensaio' THEN 'ensaio' ELSE 'real' END AS modo,
  e.ramo AS ramo,
  e.acao AS acao,
  e.motivo AS motivo,
  count(*) AS n
FROM public.agente_eventos e
WHERE e.tipo IN ('entregou', 'barrado', 'ensaio')
  AND e.acao IN ('entregar', 'barrar', 'parar')
  AND e.motivo IS NOT NULL
  AND (e.criado_em AT TIME ZONE 'America/Belem')::date >= public.hoje_br() - 29
GROUP BY 1, 2, 3, 4;
COMMENT ON VIEW public.agente_metricas_motivos_30_dias IS
  'Por que o agente entregou à equipe ou ficou em silêncio, por modo, ramo e motivo, nos últimos 30 dias (hoje de Macapá e os 29 antes). Só códigos e contagens. Lida pelo servidor.';

-- 3. Uso de cada resposta da base -----------------------------------------------------------------------------------------
CREATE VIEW public.agente_metricas_respostas WITH (security_invoker = true) AS
SELECT
  r.id AS resposta_id,
  r.tema AS tema,
  r.status::text AS status,
  r.versao AS versao,
  count(e.id) FILTER (WHERE e.tipo = 'escolheu'
                        AND (e.criado_em AT TIME ZONE 'America/Belem')::date >= public.hoje_br() - 29) AS usos_real_30_dias,
  count(e.id) FILTER (WHERE e.tipo = 'ensaio'
                        AND (e.criado_em AT TIME ZONE 'America/Belem')::date >= public.hoje_br() - 29) AS usos_ensaio_30_dias,
  count(e.id) AS usos_total,
  max(e.criado_em) AS ultimo_uso
FROM public.agente_base_respostas r
LEFT JOIN public.agente_eventos e
       ON e.resposta_id = r.id
      AND (e.tipo = 'escolheu' OR (e.tipo = 'ensaio' AND e.acao = 'escolher'))
WHERE r.status <> 'arquivada'
GROUP BY r.id, r.tema, r.status, r.versao;
COMMENT ON VIEW public.agente_metricas_respostas IS
  'Uso de cada resposta não arquivada da base: real e ensaio nos últimos 30 dias, total guardado e último uso. Resposta nunca usada aparece com zero. Só contagens. Lida pelo servidor.';

-- 4. Perguntas sem resposta, por dia ------------------------------------------------------------------------------------------
-- Só a CONTAGEM. A frase que o contato escreveu não é guardada em lugar nenhum.
CREATE VIEW public.agente_metricas_sem_resposta_dia WITH (security_invoker = true) AS
SELECT
  (e.criado_em AT TIME ZONE 'America/Belem')::date AS dia,
  CASE WHEN e.tipo = 'ensaio' THEN 'ensaio' ELSE 'real' END AS modo,
  e.ramo AS ramo,
  count(*) AS perguntas_sem_resposta
FROM public.agente_eventos e
WHERE e.tipo IN ('entregou', 'ensaio')
  AND e.acao = 'entregar'
  AND e.motivo = 'sem_resposta'
  AND e.mensagem_id IS NOT NULL
GROUP BY 1, 2, 3;
COMMENT ON VIEW public.agente_metricas_sem_resposta_dia IS
  'Quantas perguntas o agente entregou por não haver resposta aprovada, por dia (Macapá), modo e ramo. Só a contagem: a frase do contato não é guardada. Lida pelo servidor.';

-- 5. Acesso: só o servidor lê, e só LÊ. REVOKE pelo nome, porque revogar de PUBLIC não fecha o anon nem o authenticated. -------
-- O Supabase concede por padrão (ALTER DEFAULT PRIVILEGES no esquema public) todos os privilégios de tabela ao anon, ao
-- authenticated e ao service_role em todo objeto novo, view inclusive. Por isso o REVOKE inclui o service_role: sem isso a view
-- nasceria com INSERT, UPDATE, DELETE e TRUNCATE para o servidor, e só o GRANT SELECT abaixo não os tira.
REVOKE ALL ON public.agente_metricas_dia FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.agente_metricas_motivos_30_dias FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.agente_metricas_respostas FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.agente_metricas_sem_resposta_dia FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.agente_metricas_dia TO service_role;
GRANT SELECT ON public.agente_metricas_motivos_30_dias TO service_role;
GRANT SELECT ON public.agente_metricas_respostas TO service_role;
GRANT SELECT ON public.agente_metricas_sem_resposta_dia TO service_role;

-- 6. Conferência: tudo o que a migração prometeu, ou desfaz. --------------------------------------------------------------------
DO $conferencia$
DECLARE
  v text;
  v_n integer;
  v_esperadas CONSTANT text[] := ARRAY[
    'agente_metricas_dia', 'agente_metricas_motivos_30_dias', 'agente_metricas_respostas', 'agente_metricas_sem_resposta_dia'];
BEGIN
  SELECT count(*) INTO v_n FROM pg_class c
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'v' AND c.relname LIKE 'agente\_metricas\_%';
  IF v_n <> 4 THEN RAISE EXCEPTION 'esperava 4 views agente_metricas_*, achei %', v_n; END IF;

  FOREACH v IN ARRAY v_esperadas LOOP
    IF NOT coalesce((SELECT c.reloptions @> ARRAY['security_invoker=true'] FROM pg_class c
                      WHERE c.oid = ('public.' || v)::regclass), false) THEN
      RAISE EXCEPTION 'a view % não ficou security_invoker', v;
    END IF;
    IF has_table_privilege('anon', 'public.' || v, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       OR has_table_privilege('authenticated', 'public.' || v, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       OR has_table_privilege('public', 'public.' || v, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
      RAISE EXCEPTION 'a view % está aberta para anon, authenticated ou PUBLIC', v;
    END IF;
    IF NOT has_table_privilege('service_role', 'public.' || v, 'SELECT') THEN
      RAISE EXCEPTION 'a view % não está aberta para o servidor', v;
    END IF;
    -- o servidor LÊ e só lê. has_table_privilege com lista devolve true se QUALQUER um dos privilégios existe
    IF has_table_privilege('service_role', 'public.' || v, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
      RAISE EXCEPTION 'a view % aceita escrita ou outro privilégio além da leitura para o servidor', v;
    END IF;
    -- a lista de acesso da view (ACL) por inteiro: sem nenhum privilégio de ninguém além do dono e do SELECT do service_role. O sandbox_exec é papel da plataforma e os privilégios padrão do projeto o concedem a toda relação nova, então fica de fora
    IF EXISTS (SELECT 1 FROM pg_class c, LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
                WHERE c.oid = ('public.' || v)::regclass AND a.grantee <> c.relowner
                  AND a.grantee::regrole::text <> 'sandbox_exec'
                  AND NOT (a.grantee = 'service_role'::regrole AND a.privilege_type = 'SELECT')) THEN
      RAISE EXCEPTION 'a lista de acesso da view % tem privilégio além do SELECT do servidor', v;
    END IF;
    -- a escrita pela view falha para o servidor. As quatro views têm GROUP BY, então o INSERT falha por isso MESMO com o privilégio
    -- concedido: a prova de que o privilégio não existe são as duas conferências acima, e esta só garante que nada passa.
    BEGIN
      SET LOCAL ROLE service_role;
      EXECUTE format('INSERT INTO public.%I SELECT * FROM public.%I LIMIT 0', v, v);
      RESET ROLE;
      RAISE EXCEPTION 'o INSERT na view % passou para o servidor', v;
    EXCEPTION WHEN insufficient_privilege OR feature_not_supported OR object_not_in_prerequisite_state THEN
      RESET ROLE;
    END;
    -- nada que identifique conversa, mensagem ou pessoa, e nada com cara de texto ou de dinheiro
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = v
                  AND (column_name ~ '^(nome|texto|text|mensagem|conteudo|body|telefone|phone|cep|endereco|email|frase|pergunta|resposta|detalhe|conversa_id|mensagem_id|saida_id|chat_lid|lid)$'
                       OR column_name ~ 'preco|valor|custo|desconto|orcamento|revend')) THEN
      RAISE EXCEPTION 'a view % tem coluna com cara de dado pessoal, de texto ou de dinheiro', v;
    END IF;
    -- a view responde para quem a lê (o servidor): se faltasse permissão em alguma tabela de baixo, aqui daria erro
    EXECUTE format('SELECT count(*) FROM public.%I', v);
  END LOOP;

  -- as colunas que a tela lê existem, com os nomes que o servidor pede
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'agente_metricas_dia'
         AND column_name IN ('dia', 'modo', 'ramo', 'decisoes', 'escolhidas', 'entregues', 'barradas', 'sensiveis')) <> 8
     OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'agente_metricas_motivos_30_dias'
         AND column_name IN ('modo', 'ramo', 'acao', 'motivo', 'n')) <> 5
     OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'agente_metricas_respostas'
         AND column_name IN ('resposta_id', 'tema', 'status', 'versao', 'usos_real_30_dias', 'usos_ensaio_30_dias', 'usos_total', 'ultimo_uso')) <> 8
     OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'agente_metricas_sem_resposta_dia'
         AND column_name IN ('dia', 'modo', 'ramo', 'perguntas_sem_resposta')) <> 4 THEN
    RAISE EXCEPTION 'as colunas das views de métricas do agente não são as combinadas';
  END IF;

  -- nada mais mudou: nenhuma função nova e nenhuma tabela nova com este prefixo
  SELECT count(*) INTO v_n FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname LIKE '%agente\_metricas%';
  IF v_n <> 0 THEN RAISE EXCEPTION 'esta migração não cria função, achei %', v_n; END IF;
  SELECT count(*) INTO v_n FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' AND relname LIKE 'agente\_metricas%';
  IF v_n <> 0 THEN RAISE EXCEPTION 'esta migração não cria tabela, achei %', v_n; END IF;
END
$conferencia$;

COMMIT;
