-- NÃO APLICADA. Roteiro de ensaio: docs/ensaio-agente-escolhe.md.
-- ORDEM: depois de 20261114120000_agente_base_de_respostas.sql (a base, o validador do agente) e da Onda B inteira
-- (20261113130000, 20261113131000 e 20261113132000: configuração da triagem, estado, bloqueios, funções de envio).
--
-- O AGENTE QUE ESCOLHE RESPOSTAS (Bex Print, C3)
--
-- O QUE É: um dono novo da conversa, 'agente', entre a triagem de boas-vindas e a assistente de texto livre. Quando a triagem
-- TERMINOU e o contato continua mandando mensagem, o agente lê a pergunta, acha na base de respostas APROVADAS (C2) a que casa pelas
-- frases gatilho e manda exatamente o texto que o dono aprovou. Ou entrega a conversa à equipe. NUNCA escreve texto livre,
-- nunca cita preço, prazo, desconto nem orçamento: o código de quem chama (src/lib/api/agente-escolhe.server.ts) só diz QUAL
-- resposta, e é esta migração que lê o texto da linha da base, roda o validador de novo e enfileira. O servidor não consegue
-- mandar um texto próprio nem se quiser.
--
-- O QUE CRIA
--  1. agente_config: uma linha só, nasce DESLIGADA, com os mesmos degraus da triagem (desligada, ensaio, teste, parcial,
--     ligada; o tipo triagem_estado é reaproveitado, nenhum valor novo de enum), percentual, números de teste, teto de
--     mensagens do agente por conversa, freios (falhas de envio, erros por hora, respostas por hora e por dia) e retenção.
--  2. agente_eventos: o rastro, SÓ com códigos e contagens (escolheu, entregou, barrado, enviado, ensaio, erro, pausado, freio).
--     Nenhuma coluna de texto de mensagem, nome, telefone ou CEP, e um CHECK recusa chave de detalhe com cara de conteúdo. A frase
--     do contato que ficou sem resposta NÃO é guardada: só vira um evento 'entregou' com motivo 'sem_resposta', e a contagem
--     desses eventos é o "contador de perguntas sem resposta".
--  3. Funções SECURITY DEFINER, executáveis só por service_role:
--       agente_contexto        lê tudo que o agente precisa numa chamada (só lê)
--       agente_registrar       a única que grava a decisão e enfileira a mensagem (ver abaixo)
--       agente_evento          erro e pausado, só com códigos
--       agente_conferir_envio  o consumidor da fila confere antes de despachar, inclusive se a resposta ainda está aprovada
--       agente_config_salvar   whatsapp.manage para estado, percentual, números de teste, teto e freios
--       agente_desligar        desliga e cancela o que está na fila (whatsapp.manage ou configuracoes.manage)
--       agente_varrer          freios por contagem e retenção do rastro (a rodada do despachante chama), que nunca apaga os
--                              eventos entregou, enviado e escolheu de uma conversa: são o estado que decide dono, teto e preço
--       agente_resumo          contagens por tipo, motivo e tema, sem frase nenhuma
--     mais as internas _agente_triagem_liberou, _agente_degrau_permite, _agente_cobre, _agente_cancelar_pendentes,
--     _agente_desligar_config, _agente_avisar_equipe e o gatilho da configuração.
--  4. triagem_dono_da_conversa passa a devolver 'agente' (POR TROCA NA DEFINIÇÃO VIVA, ver "DONO DA CONVERSA").
--
-- COMO O AGENTE ENVIA (a regra de saída)
--   agente_registrar grava a mensagem com origem 'automacao' (nenhuma origem nova, nenhum CHECK de origem mexido) e a linha
--   da fila com triagem_id e agente = true no payload, chave 'triagem:<id da triagem>:agente:<id da mensagem de entrada>'.
--   O consumidor da fila (whatsapp-enviar.server.ts) já deixa passar chave 'triagem:'; conferirLinhaDeTriagem, ao ver
--   agente = true, confere o AGENTE (agente_conferir_envio) e não a triagem. A mesma chave nunca gera segunda mensagem.
--   No ENSAIO só se grava o evento 'ensaio': nenhuma mensagem, nenhuma fila, nenhum aviso, nenhum bloqueio.
--
-- DONO DA CONVERSA E A CHAVE ANTIGA agente_apos_triagem (LEIA)
--   whatsapp_triagem_config.agente_apos_triagem continua existindo e continua liberando a assistente de TEXTO LIVRE depois
--   que a triagem termina. O dono NÃO deve ligá-la: ela é o caminho em que uma IA escreve o que quiser, que as regras do
--   dono proíbem. Com o agente ligado e cobrindo a conversa, 'agente' vence 'assistente'. Depois que o agente ENTREGA a
--   conversa à equipe ela fica 'ninguem' para sempre, mesmo com agente_apos_triagem ligada. Se o dono ligar a chave antiga
--   por engano, a assistente de texto livre volta a falar nas conversas que o agente não cobre (degrau teste ou parcial
--   deixa de fora quem não é de teste nem sorteado).
--
-- O QUE NÃO MUDA: nenhuma outra função viva, nenhuma tabela viva, nenhuma coluna nova em tabela viva (sobretudo as que
-- têm GRANT por coluna), nenhum gatilho vivo. Com o estado 'desligada' o agente só lê agente_config e sai.
--
-- DECISÕES DE INTEGRIDADE (com motivo)
--   * agente_eventos.conversa_id tem chave estrangeira para whatsapp_conversas (ON DELETE CASCADE, como a triagem). Isso pede
--     uma trava curta em whatsapp_conversas no CREATE TABLE: a migração abre com lock_timeout de 5 s e desiste inteira.
--   * agente_eventos.mensagem_id e saida_id NÃO têm chave estrangeira para whatsapp_mensagens: é a tabela mais quente do
--     sistema, e o id da entrada só serve de chave de idempotência (índice único). A retenção apaga o rastro, MENOS os eventos
--     entregou, enviado e escolheu de uma conversa (ver agente_varrer).
--   * UPDATE e DELETE todos com WHERE (safeupdate). Nenhum UPDATE em tabela viva fora de whatsapp_conversas.ultima_mensagem*
--     (a mesma escrita que triagem_enviar faz) e whatsapp_fila_envio (cancelar o que o agente enfileirou).
--
-- A conferência no fim desfaz tudo se algo estiver fora do esperado.

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $pre$
DECLARE v_falta text;
BEGIN
  SELECT string_agg(x, ', ') INTO v_falta FROM (
    SELECT 'tabela whatsapp_triagem_config' AS x WHERE to_regclass('public.whatsapp_triagem_config') IS NULL
    UNION ALL SELECT 'tabela whatsapp_triagens' WHERE to_regclass('public.whatsapp_triagens') IS NULL
    UNION ALL SELECT 'tabela whatsapp_conversas' WHERE to_regclass('public.whatsapp_conversas') IS NULL
    UNION ALL SELECT 'tabela whatsapp_mensagens' WHERE to_regclass('public.whatsapp_mensagens') IS NULL
    UNION ALL SELECT 'tabela whatsapp_fila_envio' WHERE to_regclass('public.whatsapp_fila_envio') IS NULL
    UNION ALL SELECT 'tabela whatsapp_automacao_bloqueios' WHERE to_regclass('public.whatsapp_automacao_bloqueios') IS NULL
    UNION ALL SELECT 'tabela agente_base_respostas' WHERE to_regclass('public.agente_base_respostas') IS NULL
    UNION ALL SELECT 'tabela usuarios' WHERE to_regclass('public.usuarios') IS NULL
    UNION ALL SELECT 'coluna whatsapp_triagens.perguntas_de_preco' WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_schema = 'public' AND table_name = 'whatsapp_triagens' AND column_name = 'perguntas_de_preco')
    UNION ALL SELECT 'tipo triagem_estado' WHERE to_regtype('public.triagem_estado') IS NULL
    UNION ALL SELECT 'função triagem_dono_da_conversa' WHERE to_regprocedure('public.triagem_dono_da_conversa(uuid)') IS NULL
    UNION ALL SELECT 'função _agente_problemas_de_texto' WHERE to_regprocedure('public._agente_problemas_de_texto(text, public.triagem_ramo[])') IS NULL
    UNION ALL SELECT 'função _triagem_humano_na_conversa' WHERE to_regprocedure('public._triagem_humano_na_conversa(uuid)') IS NULL
    UNION ALL SELECT 'função _triagem_bloqueado' WHERE to_regprocedure('public._triagem_bloqueado(uuid)') IS NULL
    UNION ALL SELECT 'função _triagem_sorteio' WHERE to_regprocedure('public._triagem_sorteio(uuid)') IS NULL
    UNION ALL SELECT 'função _triagem_hash' WHERE to_regprocedure('public._triagem_hash(text)') IS NULL
    UNION ALL SELECT 'função _triagem_recompor_ultima' WHERE to_regprocedure('public._triagem_recompor_ultima(uuid[], text[])') IS NULL
    UNION ALL SELECT 'função _triagem_numeros_validos' WHERE to_regprocedure('public._triagem_numeros_validos(text[])') IS NULL
    UNION ALL SELECT 'função _triagem_lista_limpa' WHERE to_regprocedure('public._triagem_lista_limpa(jsonb, text)') IS NULL
    UNION ALL SELECT 'função has_permission' WHERE to_regprocedure('public.has_permission(uuid, text)') IS NULL
    UNION ALL SELECT 'função is_staff' WHERE to_regprocedure('public.is_staff(uuid)') IS NULL
    UNION ALL SELECT 'função enfileirar_notificacao' WHERE to_regprocedure('public.enfileirar_notificacao(text, text, uuid, text, text, uuid, text, jsonb, text)') IS NULL
    UNION ALL SELECT 'função grupo_equipe_destino' WHERE to_regprocedure('public.grupo_equipe_destino()') IS NULL
  ) q;
  IF v_falta IS NOT NULL THEN
    RAISE EXCEPTION 'Faltam pré-requisitos (aplique antes a Onda B e a base do agente): %', v_falta;
  END IF;
  IF to_regclass('public.agente_config') IS NOT NULL OR to_regclass('public.agente_eventos') IS NOT NULL THEN
    RAISE EXCEPTION 'O agente que escolhe respostas já existe: esta migração só cria, nunca refaz.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace
               AND proname IN ('agente_contexto', 'agente_registrar', 'agente_evento', 'agente_conferir_envio', 'agente_config_salvar',
                               'agente_desligar', 'agente_varrer', 'agente_resumo')) THEN
    RAISE EXCEPTION 'Já existe alguma função agente_* desta migração: não reaplique.';
  END IF;
  -- LIÇÃO ler-funcao-viva-nao-migracao: a troca de triagem_dono_da_conversa abaixo foi escrita sobre o corpo VIVO lido em
  -- 14/11/2026 (md5 do corpo 4632f793e72ba4d6d4b824fffcec6b5a). Se o corpo vivo for outro, alguém mexeu depois: pare e releia.
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.triagem_dono_da_conversa(uuid)'::regprocedure) <> '4632f793e72ba4d6d4b824fffcec6b5a' THEN
    RAISE EXCEPTION 'triagem_dono_da_conversa mudou desde 14/11/2026: releia o corpo vivo antes de trocar';
  END IF;
  -- a fila aceita o status novo sem migração e a chave única existe (a idempotência do envio depende dela)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.whatsapp_fila_envio'::regclass AND contype = 'u'
                  AND pg_get_constraintdef(oid) = 'UNIQUE (idempotency_key)') THEN
    RAISE EXCEPTION 'whatsapp_fila_envio perdeu a chave única de idempotency_key';
  END IF;
  -- a premissa central da saída: origem automacao não zera aguardando_desde nem põe a conversa em modo humano
  IF EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = '_wa_mensagem_antes_inserir'
               AND prosrc ~ 'automacao' AND prosrc ~ 'aguardando_desde = NULL') IS NOT TRUE THEN
    RAISE EXCEPTION '_wa_mensagem_antes_inserir mudou: releia a definição viva antes de confiar em origem automacao';
  END IF;
END $pre$;

-- 1. Configuração: uma linha só ---------------------------------------------------------------------------------------
CREATE TABLE public.agente_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  estado public.triagem_estado NOT NULL DEFAULT 'desligada',
  percentual integer NOT NULL DEFAULT 0 CHECK (percentual BETWEEN 0 AND 100),
  numeros_teste text[] NOT NULL DEFAULT '{}' CHECK (public._triagem_numeros_validos(numeros_teste)),
  -- preenchida na primeira saída de 'desligada' e nunca mais muda: só conversa cuja triagem terminou DEPOIS disto é do agente
  vale_a_partir_de timestamptz,
  -- teto de mensagens do AGENTE por conversa (a triagem tem o dela, em whatsapp_triagem_config.max_mensagens)
  max_mensagens integer NOT NULL DEFAULT 3 CHECK (max_mensagens BETWEEN 1 AND 6),
  atraso_min_s integer NOT NULL DEFAULT 3,
  atraso_max_s integer NOT NULL DEFAULT 8,
  max_por_hora integer NOT NULL DEFAULT 20 CHECK (max_por_hora BETWEEN 1 AND 200),
  max_por_dia integer NOT NULL DEFAULT 100 CHECK (max_por_dia BETWEEN 1 AND 2000),
  freio_falhas_envio integer NOT NULL DEFAULT 3 CHECK (freio_falhas_envio BETWEEN 1 AND 20),
  freio_erros_hora integer NOT NULL DEFAULT 10 CHECK (freio_erros_hora BETWEEN 1 AND 200),
  avisar_grupo boolean NOT NULL DEFAULT true,
  retencao_eventos_dias integer NOT NULL DEFAULT 90 CHECK (retencao_eventos_dias BETWEEN 7 AND 730),
  desligada_por text,
  desligada_em timestamptz,
  atualizado_por uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agente_config_atraso_check CHECK (atraso_min_s BETWEEN 1 AND 15 AND atraso_max_s BETWEEN atraso_min_s AND 15)
);
COMMENT ON TABLE public.agente_config IS
  'Uma linha só. estado nasce desligada. Escrita só por agente_config_salvar, agente_desligar e pelo freio. O agente só ESCOLHE respostas aprovadas da base; nunca escreve texto livre.';

INSERT INTO public.agente_config (id) VALUES (true);

CREATE OR REPLACE FUNCTION public._agente_config_antes_gravar()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'A linha de configuração do agente não pode ser apagada.';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.vale_a_partir_de IS NOT NULL THEN
      NEW.vale_a_partir_de := OLD.vale_a_partir_de;
    ELSIF OLD.estado = 'desligada' AND NEW.estado <> 'desligada' THEN
      NEW.vale_a_partir_de := now();
    ELSE
      NEW.vale_a_partir_de := NULL;
    END IF;
    -- a escada sobe um degrau por vez também aqui; descer, inclusive para desligada, sempre passa
    IF NEW.estado IS DISTINCT FROM OLD.estado
       AND array_position(ARRAY['desligada', 'ensaio', 'teste', 'parcial', 'ligada'], NEW.estado::text)
           > array_position(ARRAY['desligada', 'ensaio', 'teste', 'parcial', 'ligada'], OLD.estado::text) + 1 THEN
      RAISE EXCEPTION 'O agente só sobe um degrau de cada vez, na ordem.';
    END IF;
    IF NEW.estado = 'desligada' AND OLD.estado <> 'desligada' AND NEW.desligada_em IS NOT DISTINCT FROM OLD.desligada_em THEN
      NEW.desligada_em := now();
    END IF;
    NEW.atualizado_em := now();
  END IF;
  RETURN NEW;
END $function$;

CREATE TRIGGER tg_agente_config_antes_gravar BEFORE UPDATE OR DELETE ON public.agente_config
  FOR EACH ROW EXECUTE FUNCTION public._agente_config_antes_gravar();
CREATE TRIGGER tg_agente_config_sem_truncate BEFORE TRUNCATE ON public.agente_config
  FOR EACH STATEMENT EXECUTE FUNCTION public._agente_config_antes_gravar();

-- 2. Eventos: só códigos e contagens ----------------------------------------------------------------------------------
-- tipo escolheu   o agente decidiu mandar uma resposta aprovada (acao escolher)
--      entregou   a conversa foi à equipe (acao entregar), com o motivo: sem_resposta, preco_de_novo, empate, texto_reprovado...
--      barrado    o agente é o dono mas não falou (acao barrar ou parar), com o motivo
--      enviado    a mensagem entrou na fila (saida_id é a mensagem de saída); é o que conta no teto
--      ensaio     o que o agente FARIA no degrau de ensaio (qualquer acao); nada saiu
--      erro       falha de leitura ou de gravação, só etapa e código
--      pausado    a linha do agente foi cancelada na fila (equipe entrou, degrau desceu...), só o motivo
--      freio      o agente foi desligado por contagem ou à mão
CREATE TABLE public.agente_eventos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversa_id uuid REFERENCES public.whatsapp_conversas(id) ON DELETE CASCADE,
  mensagem_id uuid,
  saida_id uuid,
  tipo text NOT NULL CHECK (tipo IN ('escolheu', 'entregou', 'barrado', 'enviado', 'ensaio', 'erro', 'pausado', 'freio')),
  acao text CHECK (acao IS NULL OR acao IN ('escolher', 'entregar', 'barrar', 'parar')),
  motivo text CHECK (motivo IS NULL OR motivo ~ '^[a-z][a-z0-9_]{1,40}$'),
  codigo text CHECK (codigo IS NULL OR codigo ~ '^[a-z][a-z0-9_]{2,60}$'),
  resposta_id uuid REFERENCES public.agente_base_respostas(id) ON DELETE RESTRICT,
  versao integer CHECK (versao IS NULL OR versao >= 1),
  ramo text CHECK (ramo IS NULL OR ramo IN ('cliente', 'parceiro')),
  -- pergunta de preço: a pergunta que a casa nunca responde com número. O nome evita a palavra de dinheiro de propósito.
  sensivel boolean NOT NULL DEFAULT false,
  detalhe jsonb NOT NULL DEFAULT '{}',
  criado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agente_evento_sem_conversa CHECK (conversa_id IS NOT NULL OR tipo IN ('freio', 'erro')),
  CONSTRAINT agente_evento_detalhe_objeto CHECK (jsonb_typeof(detalhe) = 'object'),
  CONSTRAINT agente_evento_detalhe_pequeno CHECK (octet_length(detalhe::text) <= 1000),
  -- sem conteúdo de mensagem: nenhuma chave com cara de texto, nome, telefone, CEP ou endereço, em qualquer nível
  CONSTRAINT agente_evento_detalhe_sem_conteudo CHECK (NOT jsonb_path_exists(detalhe,
    'strict $.** ? (@.type() == "object").keyvalue() ? (@.key like_regex "^(texto|text|mensagem|conteudo|body|nome|telefone|phone|cep|endereco|email|resposta|frase|pergunta)$")')),
  -- regras guarda só CÓDIGOS de regra do validador, nunca o trecho
  CONSTRAINT agente_evento_regras_so_codigos CHECK (
    NOT (detalhe ? 'regras')
    OR (jsonb_typeof(detalhe -> 'regras') = 'array'
        AND NOT jsonb_path_exists(detalhe, '$.regras[*] ? (@.type() != "string" || !(@ like_regex "^[a-z][a-z0-9_]{0,40}$"))'))),
  -- a escolha traz o código e a versão da resposta; quem não escolheu não traz resposta
  CONSTRAINT agente_evento_escolha_com_codigo CHECK (acao IS DISTINCT FROM 'escolher' OR tipo = 'ensaio' OR (codigo IS NOT NULL AND resposta_id IS NOT NULL AND versao IS NOT NULL))
);
COMMENT ON TABLE public.agente_eventos IS
  'Rastro das decisões do agente. NUNCA guarda texto de mensagem, nome, telefone nem a frase do contato: só códigos, ids e contagens. Apagado por agente_varrer depois de agente_config.retencao_eventos_dias, exceto os eventos entregou, enviado e escolheu de conversa, que decidem dono, teto e pergunta de preço.';
-- a mesma mensagem de entrada nunca tem duas decisões: é isto que torna o webhook repetido idempotente
CREATE UNIQUE INDEX agente_eventos_decisao_unica ON public.agente_eventos (mensagem_id)
  WHERE mensagem_id IS NOT NULL AND tipo IN ('escolheu', 'entregou', 'barrado', 'ensaio');
CREATE INDEX agente_eventos_conversa ON public.agente_eventos (conversa_id, tipo, criado_em);
CREATE INDEX agente_eventos_tipo_hora ON public.agente_eventos (tipo, criado_em);
CREATE INDEX agente_eventos_criado ON public.agente_eventos (criado_em);
CREATE INDEX agente_eventos_resposta ON public.agente_eventos (resposta_id) WHERE resposta_id IS NOT NULL;

-- 3. RLS e permissões de tabela: leitura da equipe da configuração, escrita só pelas funções ---------------------------
ALTER TABLE public.agente_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agente_eventos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agente_config FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.agente_eventos FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.agente_config TO authenticated, service_role;
GRANT SELECT ON public.agente_eventos TO authenticated, service_role;

CREATE POLICY "agente_config leitura equipe" ON public.agente_config
  FOR SELECT TO authenticated
  USING (public.is_staff((SELECT auth.uid()))
         AND (public.has_permission((SELECT auth.uid()), 'configuracoes.manage')
              OR public.has_permission((SELECT auth.uid()), 'whatsapp.manage')));
CREATE POLICY "agente_eventos leitura equipe" ON public.agente_eventos
  FOR SELECT TO authenticated
  USING (public.is_staff((SELECT auth.uid()))
         AND (public.has_permission((SELECT auth.uid()), 'configuracoes.manage')
              OR public.has_permission((SELECT auth.uid()), 'whatsapp.manage')));

-- 4. Funções internas -------------------------------------------------------------------------------------------------

-- A triagem desta conversa TERMINOU de um jeito que deixa o agente falar? Só lê.
--   concluida: terminou o roteiro. entregue_equipe: só quando o motivo foi etapa esgotada ou texto livre (o contato fala, e a equipe
--   ainda não pegou). NUNCA depois de pediu_valor_de_novo (a segunda pergunta de preço: a casa já respondeu uma vez e decidiu passar
--   à equipe), pediu_equipe, reclamou, texto_barrado, limite_mensagens, segundo_audio, texto_repetido ou sem_numero_alcancavel: ali o
--   contato pediu gente, o robô errou, a casa decidiu passar, ou a triagem já estourou o teto.
--   Triagem em ensaio (modo ensaio) nunca libera. Só vale triagem que terminou DEPOIS de o agente sair de desligada.
CREATE OR REPLACE FUNCTION public._agente_triagem_liberou(p_conversa uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM public.whatsapp_triagens t
      JOIN public.agente_config g ON g.id
     WHERE t.conversa_id = p_conversa
       AND t.modo = 'real'
       AND g.vale_a_partir_de IS NOT NULL
       AND coalesce(t.concluida_em, t.atualizado_em) >= g.vale_a_partir_de
       AND (t.status = 'concluida'
            OR (t.status = 'entregue_equipe' AND t.motivo_fim IN ('etapa_esgotada', 'texto_livre'))))
$function$;

-- O degrau ATUAL da escada do agente deixa esta conversa receber resposta de verdade? Só lê.
--   desligada e ensaio nunca (o ensaio anota, não envia); ligada sempre; teste só número de teste; parcial número de teste
--   ou o mesmo sorteio da triagem (_triagem_sorteio) dentro do percentual.
CREATE OR REPLACE FUNCTION public._agente_degrau_permite(p_conversa uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  g public.agente_config%ROWTYPE;
  v_tel text;
  v_teste boolean;
BEGIN
  SELECT * INTO g FROM public.agente_config WHERE id;
  IF g.estado IN ('desligada', 'ensaio') THEN RETURN false; END IF;
  IF g.estado = 'ligada' THEN RETURN true; END IF;
  SELECT telefone_normalizado INTO v_tel FROM public.whatsapp_conversas WHERE id = p_conversa;
  v_teste := v_tel IS NOT NULL AND v_tel = ANY (g.numeros_teste);
  IF g.estado = 'teste' THEN RETURN v_teste; END IF;
  RETURN v_teste OR public._triagem_sorteio(p_conversa) < g.percentual;
END $function$;

-- O agente É o dono desta conversa agora? Só lê. Usada por triagem_dono_da_conversa.
CREATE OR REPLACE FUNCTION public._agente_cobre(p_conversa uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public._agente_triagem_liberou(p_conversa)
     AND public._agente_degrau_permite(p_conversa)
     AND NOT public._triagem_humano_na_conversa(p_conversa)
     AND NOT public._triagem_bloqueado(p_conversa)
$function$;

-- Cancela o que o agente enfileirou e ainda não saiu (uma conversa, ou todas se nulo) e apaga a mensagem pendente que nunca
-- saiu. Em dois comandos, como _triagem_cancelar_pendentes. A "última mensagem" da conversa volta a ser a última que existe.
CREATE OR REPLACE FUNCTION public._agente_cancelar_pendentes(p_conversa uuid DEFAULT NULL)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_msgs uuid[];
  v_convs uuid[];
  v_textos text[];
  v_n integer;
BEGIN
  WITH canc AS (
    UPDATE public.whatsapp_fila_envio
       SET status = 'cancelada', erro = 'cancelada pelo agente', updated_at = now()
     WHERE status = 'pendente' AND payload ? 'agente' AND (p_conversa IS NULL OR conversa_id = p_conversa)
    RETURNING mensagem_id)
  SELECT coalesce(array_agg(mensagem_id) FILTER (WHERE mensagem_id IS NOT NULL), '{}'::uuid[]), count(*)
    INTO v_msgs, v_n FROM canc;
  IF cardinality(v_msgs) > 0 THEN
    WITH apagadas AS (
      DELETE FROM public.whatsapp_mensagens WHERE id = ANY (v_msgs) AND status = 'pendente' AND direcao = 'saida'
      RETURNING conversa_id, left(texto, 500) AS texto)
    SELECT array_agg(conversa_id), array_agg(texto) INTO v_convs, v_textos FROM apagadas;
    IF v_textos IS NOT NULL THEN
      PERFORM public._triagem_recompor_ultima(v_convs, v_textos);
    END IF;
  END IF;
  RETURN v_n;
END $function$;

-- Desliga SÓ a configuração (uma linha). Devolve true se mudou o estado.
CREATE OR REPLACE FUNCTION public._agente_desligar_config(p_motivo text, p_usuario uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_n integer;
BEGIN
  UPDATE public.agente_config
     SET estado = 'desligada', desligada_por = left(p_motivo, 120), desligada_em = now(),
         atualizado_por = coalesce(p_usuario, atualizado_por)
   WHERE id AND estado <> 'desligada';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n > 0;
END $function$;

-- O aviso ao grupo da equipe quando o agente entrega uma conversa. Mesma fila e mesmo modelo de texto da triagem, SEM nome,
-- telefone nem a frase do contato. A chave agente_aviso:<conversa> torna o reenvio seguro: enfileirar_notificacao devolve NULL
-- quando a chave já existe (ou o destino não é válido), e então o código é ja_enviado, nunca enfileirado. Devolve um código:
-- enfileirado, ja_enviado, sem_grupo, desligado ou falhou. Nunca levanta erro: o aviso é acessório, a entrega já está gravada.
CREATE OR REPLACE FUNCTION public._agente_avisar_equipe(p_conversa uuid, p_entidade uuid, p_motivo text, p_ligado boolean)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_grupo text;
  v_texto text;
  v_id uuid;
BEGIN
  IF NOT p_ligado THEN RETURN 'desligado'; END IF;
  v_grupo := public.grupo_equipe_destino();
  IF v_grupo IS NULL THEN RETURN 'sem_grupo'; END IF;
  v_texto := concat_ws(E'\n',
    '🤖 Agente: passou a conversa para a equipe',
    '📌 Motivo: ' || replace(coalesce(p_motivo, 'sem_motivo'), '_', ' '),
    '👉 Responder: https://bexprint.com.br/whatsapp?conversa=' || p_conversa);
  BEGIN
    SELECT public.enfileirar_notificacao('whatsapp', v_grupo, NULL, 'aviso_grupo_equipe', 'whatsapp_atendimento', p_entidade,
                                         'aviso_grupo_equipe', jsonb_build_object('texto', v_texto), 'agente_aviso:' || p_conversa)
      INTO v_id;
    IF v_id IS NULL THEN RETURN 'ja_enviado'; END IF;
    RETURN 'enfileirado';
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'aviso do agente para o grupo, conversa %, falhou: % [%]', p_conversa, SQLERRM, SQLSTATE;
    RETURN 'falhou';
  END;
END $function$;

-- 5. DONO DA CONVERSA: troca na definição viva ---------------------------------------------------------------------------
-- O corpo abaixo é o corpo VIVO lido em 14/11/2026 (md5 4632f793e72ba4d6d4b824fffcec6b5a, conferido no começo desta migração)
-- com UMA mudança, no ramo "triagem concluída ou entregue à equipe":
--   antes:  CASE WHEN cfg.agente_apos_triagem THEN 'assistente' ELSE 'ninguem' END
--   agora:  1) o agente já entregou a conversa à equipe  ->  'ninguem' (para sempre);
--           2) o agente cobre a conversa                 ->  'agente';
--           3) o resto igual ao de antes (agente_apos_triagem libera a assistente de texto livre; o dono não deve ligá-la).
-- Nenhum outro ramo mudou: sem triagem, em andamento (ensaio incluído) e pausada_humano devolvida à IA seguem como estavam.
-- O ENSAIO DO AGENTE NÃO É DONO: no degrau de ensaio _agente_cobre é falso, então a assistente (se estiver ligada) segue igual.
CREATE OR REPLACE FUNCTION public.triagem_dono_da_conversa(p_conversa_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  cfg public.whatsapp_triagem_config%ROWTYPE;
  t public.whatsapp_triagens%ROWTYPE;
  c public.whatsapp_conversas%ROWTYPE;
BEGIN
  SELECT * INTO cfg FROM public.whatsapp_triagem_config WHERE id;
  SELECT * INTO t FROM public.whatsapp_triagens WHERE conversa_id = p_conversa_id;
  IF NOT FOUND THEN
    -- sem linha de triagem: a assistente responde, EXCETO conversa que nenhuma automação deve responder
    SELECT * INTO c FROM public.whatsapp_conversas WHERE id = p_conversa_id;
    IF NOT FOUND THEN
      RETURN 'ninguem';
    END IF;
    IF c.telefone ~* '(-group|@g\.us)' OR public._triagem_bloqueado(c.id) THEN
      RETURN 'ninguem';
    END IF;
    IF public._triagem_parece_robo((SELECT m.texto FROM public.whatsapp_mensagens m
                                     WHERE m.conversa_id = c.id AND m.direcao = 'entrada' AND coalesce(m.origem, 'humano') <> 'automacao'
                                       AND m.tipo <> 'sistema'
                                     ORDER BY m.created_at, m.id LIMIT 1)) IS NOT NULL THEN
      RETURN 'ninguem';
    END IF;
    RETURN 'assistente';
  END IF;
  IF public._triagem_em_andamento(p_conversa_id) THEN
    RETURN CASE WHEN t.modo = 'ensaio' OR cfg.estado = 'ensaio' THEN 'assistente' ELSE 'triagem' END;
  END IF;
  IF t.status IN ('concluida', 'entregue_equipe') THEN
    -- C3: o agente que escolhe respostas aprovadas vem ANTES da assistente de texto livre
    IF EXISTS (SELECT 1 FROM public.agente_eventos e WHERE e.conversa_id = p_conversa_id AND e.tipo = 'entregou') THEN
      RETURN 'ninguem';
    END IF;
    IF public._agente_cobre(p_conversa_id) THEN
      RETURN 'agente';
    END IF;
    RETURN CASE WHEN cfg.agente_apos_triagem THEN 'assistente' ELSE 'ninguem' END;
  END IF;
  IF t.status = 'pausada_humano' THEN
    -- whatsapp_devolver_ia põe modo auto e tira o responsável: a conversa voltou para a IA, não fica sem dono
    SELECT * INTO c FROM public.whatsapp_conversas WHERE id = p_conversa_id;
    IF FOUND AND c.modo = 'auto' AND c.responsavel_id IS NULL AND c.atribuido_para IS NULL AND c.status <> 'arquivada' THEN
      RETURN 'assistente';
    END IF;
  END IF;
  RETURN 'ninguem';
END $function$;

-- 6. agente_contexto: tudo que o agente precisa, numa chamada. SÓ LÊ. -------------------------------------------------------
-- Devolve a configuração, a conversa, o dono, a triagem, a mensagem de entrada (o texto vai ao servidor para ser lido e NUNCA
-- é guardado), as contagens e, só quando a conversa pode ser do agente, as respostas APROVADAS da base.
CREATE OR REPLACE FUNCTION public.agente_contexto(p_conversa_id uuid, p_mensagem_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  g public.agente_config%ROWTYPE;
  c public.whatsapp_conversas%ROWTYPE;
  t public.whatsapp_triagens%ROWTYPE;
  m public.whatsapp_mensagens%ROWTYPE;
  v_cfg jsonb;
  v_tem_t boolean := false;
  v_tem_m boolean := false;
  v_fim timestamptz;
  v_liberou boolean := false;
  v_posterior boolean := false;
  v_base jsonb := '[]'::jsonb;
  v_ultima timestamptz;
BEGIN
  SELECT * INTO g FROM public.agente_config WHERE id;
  v_cfg := jsonb_build_object('estado', g.estado, 'percentual', g.percentual, 'numeros_teste', to_jsonb(g.numeros_teste),
                              'vale_a_partir_de', g.vale_a_partir_de, 'max_mensagens', g.max_mensagens,
                              'atraso_min_s', g.atraso_min_s, 'atraso_max_s', g.atraso_max_s,
                              'max_por_hora', g.max_por_hora, 'max_por_dia', g.max_por_dia, 'avisar_grupo', g.avisar_grupo);
  SELECT * INTO c FROM public.whatsapp_conversas WHERE id = p_conversa_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('config', v_cfg, 'conversa', NULL, 'triagem', NULL, 'mensagem', NULL);
  END IF;
  SELECT * INTO t FROM public.whatsapp_triagens WHERE conversa_id = c.id;
  v_tem_t := FOUND;
  SELECT * INTO m FROM public.whatsapp_mensagens WHERE id = p_mensagem_id AND conversa_id = c.id AND direcao = 'entrada';
  v_tem_m := FOUND;
  IF v_tem_t THEN
    v_fim := coalesce(t.concluida_em, t.atualizado_em);
    v_liberou := public._agente_triagem_liberou(c.id);
    v_posterior := v_tem_m AND m.created_at > v_fim;
  END IF;
  -- a base só viaja quando a conversa pode ser do agente (o resto sai em silêncio e não precisa dela)
  IF v_liberou AND v_posterior AND g.estado <> 'desligada' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'tema', b.tema, 'pergunta', b.pergunta, 'frases_gatilho', to_jsonb(b.frases_gatilho),
                                                  'ramos', to_jsonb(b.ramos), 'produto_id', b.produto_id, 'familia', b.familia,
                                                  'texto_aprovado', b.texto_aprovado, 'versao', b.versao,
                                                  'contagem_ocorrencias', b.contagem_ocorrencias)), '[]'::jsonb)
      INTO v_base
      FROM public.agente_base_respostas b
     WHERE b.status = 'aprovada' AND b.texto_aprovado IS NOT NULL;
  END IF;
  SELECT max(coalesce(x.enviado_em, x.created_at)) INTO v_ultima FROM public.whatsapp_mensagens x
   WHERE x.conversa_id = c.id AND x.direcao = 'saida' AND x.origem = 'automacao';

  RETURN jsonb_build_object(
    'config', v_cfg,
    'conversa', jsonb_build_object('id', c.id, 'telefone', c.telefone, 'telefone_normalizado', c.telefone_normalizado,
                                   'eh_de_grupo', coalesce(c.telefone ~* '(-group|@g\.us)', false),
                                   'humano', public._triagem_humano_na_conversa(c.id),
                                   'bloqueado', public._triagem_bloqueado(c.id)),
    'dono', public.triagem_dono_da_conversa(c.id),
    'triagem', CASE WHEN v_tem_t THEN jsonb_build_object('id', t.id, 'ramo', t.ramo, 'status', t.status, 'liberou', v_liberou) ELSE NULL END,
    'mensagem', CASE WHEN v_tem_m THEN jsonb_build_object('id', m.id, 'tipo', m.tipo, 'texto', m.texto, 'legenda', m.legenda,
                                                           'origem', m.origem, 'posterior_a_triagem', v_posterior) ELSE NULL END,
    'ja_decidida', EXISTS (SELECT 1 FROM public.agente_eventos e WHERE e.mensagem_id = p_mensagem_id
                            AND e.tipo IN ('escolheu', 'entregou', 'barrado', 'ensaio')),
    'contagens', jsonb_build_object(
      'enviadas', (SELECT count(*) FROM public.agente_eventos e WHERE e.conversa_id = c.id AND e.tipo = 'enviado'),
      'enviadas_na_hora', (SELECT count(*) FROM public.agente_eventos e WHERE e.tipo = 'enviado' AND e.criado_em > now() - interval '1 hour'),
      'enviadas_no_dia', (SELECT count(*) FROM public.agente_eventos e WHERE e.tipo = 'enviado' AND e.criado_em > now() - interval '1 day'),
      -- perguntas de preço desta conversa: as que a TRIAGEM já contou (whatsapp_triagens.perguntas_de_preco) mais as decisões do
      -- agente com a marca sensivel. No envio real só contam eventos reais; no degrau de ensaio contam também os de ensaio
      -- (é o que o agente faria), e só ali.
      'perguntas_de_preco', coalesce(t.perguntas_de_preco, 0)
                            + (SELECT count(*) FROM public.agente_eventos e WHERE e.conversa_id = c.id AND e.sensivel
                                AND e.tipo = ANY (CASE WHEN g.estado = 'ensaio' THEN ARRAY['escolheu', 'entregou', 'ensaio']
                                                       ELSE ARRAY['escolheu', 'entregou'] END)),
      'envio_pendente', EXISTS (SELECT 1 FROM public.whatsapp_fila_envio f WHERE f.conversa_id = c.id
                                 AND f.status IN ('pendente', 'enviando') AND f.payload ? 'agente'),
      'ultima_automatica_em', v_ultima),
    'base', v_base);
END $function$;

-- 7. agente_registrar: a ÚNICA que grava a decisão e enfileira a mensagem ----------------------------------------------------
-- p_decisao (só códigos, ids e contagens; o texto da resposta NÃO vem de fora):
--   acao       escolher | entregar | barrar | parar
--   motivo     código (entregar, barrar, parar)
--   resposta_id, versao   a resposta escolhida: o banco lê o texto_aprovado da linha e CONFERE a versão
--   sensivel (é pergunta de preço), candidatas, especificidade, passar_para_equipe, atraso_s, regras
-- O QUE CONFERE DE NOVO, dentro da transação e com a conversa travada (a equipe pode ter entrado entre ler e gravar):
--   agente ligado, mensagem de entrada desta conversa, ainda sem decisão, conversa que o agente ainda não entregou (ja_entregue),
--   triagem que libera, mensagem DEPOIS do fim da triagem, degrau (no envio real), gente na conversa, bloqueio, teto do agente,
--   freio de volume (entrega, motivo freio_de_volume), resposta ainda na fila (entrega, motivo rajada), resposta aprovada, geral
--   (sem produto) e na versão que o servidor viu, o validador do agente sobre o texto que o BANCO leu, e a segunda pergunta de preço
--   (a conta é do banco: eventos reais sensíveis mais o contador da triagem). Qualquer falha troca a decisão (entrega à equipe ou
--   barra) e deixa o motivo; nunca envia por sorte. Toda entrega cancela o que o agente ainda tinha na fila da conversa, e o
--   pedido de parar também.
-- ENSAIO: só o evento 'ensaio'. Nenhuma mensagem, fila, aviso nem bloqueio.
CREATE OR REPLACE FUNCTION public.agente_registrar(p_conversa_id uuid, p_mensagem_id uuid, p_decisao jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  g public.agente_config%ROWTYPE;
  c public.whatsapp_conversas%ROWTYPE;
  t public.whatsapp_triagens%ROWTYPE;
  m public.whatsapp_mensagens%ROWTYPE;
  r public.agente_base_respostas%ROWTYPE;
  v_acao text;
  v_motivo text;
  v_sensivel boolean;
  v_regras text[];
  v_ensaio boolean;
  v_passar boolean;
  v_chave text;
  v_texto text;
  v_atraso integer;
  v_msg uuid;
  v_fila uuid;
  v_enviadas integer;
  v_na_hora integer;
  v_no_dia integer;
  v_aviso text;
  v_hash_tel text;
  v_hash_lid text;
  v_bloqueio text := NULL;
  v_enviado boolean := false;
  v_tipo text;
  v_detalhe jsonb;
BEGIN
  IF jsonb_typeof(coalesce(p_decisao, 'null'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'Decisão do agente inválida.';
  END IF;
  v_acao := p_decisao ->> 'acao';
  IF v_acao IS NULL OR v_acao NOT IN ('escolher', 'entregar', 'barrar', 'parar') THEN
    RAISE EXCEPTION 'Ação do agente desconhecida.';
  END IF;
  v_motivo := nullif(p_decisao ->> 'motivo', '');
  IF v_motivo IS NOT NULL AND v_motivo !~ '^[a-z][a-z0-9_]{1,40}$' THEN
    RAISE EXCEPTION 'Motivo do agente fora do formato de código.';
  END IF;
  v_sensivel := coalesce((p_decisao ->> 'sensivel')::boolean, false);
  v_passar := coalesce((p_decisao ->> 'passar_para_equipe')::boolean, false);
  v_regras := CASE WHEN jsonb_typeof(p_decisao -> 'regras') = 'array'
                   THEN coalesce((SELECT array_agg(x) FROM jsonb_array_elements_text(p_decisao -> 'regras') AS x
                                   WHERE x ~ '^[a-z][a-z0-9_]{0,40}$'), '{}'::text[])
                   ELSE '{}'::text[] END;

  -- ordem de travas de sempre: advisory, conversa
  PERFORM pg_advisory_xact_lock(hashtextextended('agente:' || p_conversa_id::text, 0));
  SELECT * INTO c FROM public.whatsapp_conversas WHERE id = p_conversa_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('registrado', false, 'motivo', 'conversa_inexistente'); END IF;
  SELECT * INTO g FROM public.agente_config WHERE id;
  IF g.estado = 'desligada' THEN RETURN jsonb_build_object('registrado', false, 'motivo', 'desligada'); END IF;
  v_ensaio := g.estado = 'ensaio';

  SELECT * INTO m FROM public.whatsapp_mensagens WHERE id = p_mensagem_id AND conversa_id = c.id AND direcao = 'entrada';
  IF NOT FOUND OR coalesce(m.origem, 'humano') = 'automacao' OR m.tipo = 'sistema' THEN
    RETURN jsonb_build_object('registrado', false, 'motivo', 'mensagem_inexistente');
  END IF;
  IF EXISTS (SELECT 1 FROM public.agente_eventos e WHERE e.mensagem_id = m.id AND e.tipo IN ('escolheu', 'entregou', 'barrado', 'ensaio')) THEN
    RETURN jsonb_build_object('registrado', false, 'duplicada', true, 'motivo', 'ja_decidida');
  END IF;
  -- conversa que o agente já entregou à equipe nunca recebe outra decisão (dentro da trava da conversa, então duas mensagens que
  -- chegam juntas não passam as duas: a segunda vê a entrega da primeira)
  IF EXISTS (SELECT 1 FROM public.agente_eventos e WHERE e.conversa_id = c.id AND e.tipo = 'entregou') THEN
    RETURN jsonb_build_object('registrado', false, 'motivo', 'ja_entregue');
  END IF;
  SELECT * INTO t FROM public.whatsapp_triagens WHERE conversa_id = c.id;
  IF NOT FOUND OR NOT public._agente_triagem_liberou(c.id) OR m.created_at <= coalesce(t.concluida_em, t.atualizado_em) THEN
    RETURN jsonb_build_object('registrado', false, 'motivo', 'triagem_nao_liberou');
  END IF;
  IF NOT v_ensaio AND NOT public._agente_degrau_permite(c.id) THEN
    RETURN jsonb_build_object('registrado', false, 'motivo', 'fora_do_degrau');
  END IF;

  -- gente na conversa e bloqueio mandam mais que qualquer decisão (menos "parar", que só reforça o bloqueio)
  IF v_acao <> 'parar' THEN
    IF public._triagem_humano_na_conversa(c.id) THEN
      v_acao := 'barrar'; v_motivo := 'humano_na_conversa';
    ELSIF public._triagem_bloqueado(c.id) THEN
      v_acao := 'barrar'; v_motivo := 'bloqueado';
    END IF;
  END IF;

  -- no envio real, o teto, o freio de volume e a fila são conferidos aqui de novo
  IF v_acao = 'escolher' AND NOT v_ensaio THEN
    SELECT count(*) INTO v_enviadas FROM public.agente_eventos e WHERE e.conversa_id = c.id AND e.tipo = 'enviado';
    IF v_enviadas >= g.max_mensagens THEN
      v_acao := 'entregar'; v_motivo := 'teto_de_mensagens';
    ELSE
      SELECT count(*) INTO v_na_hora FROM public.agente_eventos e WHERE e.tipo = 'enviado' AND e.criado_em > now() - interval '1 hour';
      SELECT count(*) INTO v_no_dia FROM public.agente_eventos e WHERE e.tipo = 'enviado' AND e.criado_em > now() - interval '1 day';
      -- freio de volume e rajada NÃO são silêncio: o contato fez uma pergunta e ficaria sem resposta e sem ninguém sabendo.
      -- Vão à equipe (o aviso ao grupo já deduplica por conversa).
      IF v_na_hora >= g.max_por_hora OR v_no_dia >= g.max_por_dia THEN
        v_acao := 'entregar'; v_motivo := 'freio_de_volume';
      ELSIF EXISTS (SELECT 1 FROM public.whatsapp_fila_envio f WHERE f.conversa_id = c.id
                     AND f.status IN ('pendente', 'enviando') AND f.payload ? 'agente') THEN
        v_acao := 'entregar'; v_motivo := 'rajada';
      END IF;
    END IF;
  END IF;

  -- a resposta escolhida: o texto vem da linha da base, na versão que o servidor viu, e passa pelo validador do agente
  IF v_acao = 'escolher' THEN
    SELECT * INTO r FROM public.agente_base_respostas WHERE id = (p_decisao ->> 'resposta_id')::uuid;
    -- pergunta de preço é a que a resposta do tema valor_do_produto responde, venha ou não a marca do servidor: o banco não
    -- confia só no que o código disse
    IF FOUND THEN v_sensivel := v_sensivel OR r.tema = 'valor_do_produto'; END IF;
    -- o agente só manda resposta geral: a de produto específico tem mais risco de citar o que a casa não cita
    IF NOT FOUND OR r.status <> 'aprovada' OR r.texto_aprovado IS NULL OR NOT (t.ramo = ANY (r.ramos))
       OR r.versao IS DISTINCT FROM (p_decisao ->> 'versao')::integer OR r.produto_id IS NOT NULL THEN
      v_acao := 'entregar'; v_motivo := 'resposta_mudou';
    ELSE
      v_regras := public._agente_problemas_de_texto(r.texto_aprovado, r.ramos);
      IF cardinality(v_regras) > 0 THEN
        v_acao := 'entregar'; v_motivo := 'texto_reprovado';
      ELSIF v_sensivel
            AND (EXISTS (SELECT 1 FROM public.agente_eventos e WHERE e.conversa_id = c.id AND e.sensivel
                          AND e.tipo IN ('escolheu', 'entregou'))
                 OR coalesce(t.perguntas_de_preco, 0) >= 1) THEN
        -- a segunda pergunta de preço da conversa vai à equipe, mesmo que o servidor tenha mandado escolher: a conta é do banco
        -- (eventos reais, nunca os de ensaio, mais o que a triagem já contou)
        v_acao := 'entregar'; v_motivo := 'preco_de_novo';
      END IF;
    END IF;
  END IF;
  IF v_acao IN ('entregar', 'barrar', 'parar') AND v_motivo IS NULL THEN
    v_motivo := 'sem_motivo';
  END IF;

  -- ENSAIO: só o evento
  IF v_ensaio THEN
    INSERT INTO public.agente_eventos (conversa_id, mensagem_id, tipo, acao, motivo, codigo, resposta_id, versao, ramo, sensivel, detalhe)
    VALUES (c.id, m.id, 'ensaio', v_acao, v_motivo,
            CASE WHEN v_acao = 'escolher' THEN r.tema END, CASE WHEN v_acao = 'escolher' THEN r.id END,
            CASE WHEN v_acao = 'escolher' THEN r.versao END, t.ramo::text, v_sensivel,
            jsonb_build_object('regras', to_jsonb(v_regras), 'passar_para_equipe', v_passar,
                               'candidatas', coalesce((p_decisao ->> 'candidatas')::integer, 0),
                               'especificidade', coalesce((p_decisao ->> 'especificidade')::integer, 0)));
    RETURN jsonb_build_object('registrado', true, 'ensaio', true, 'enviado', false, 'acao', v_acao, 'motivo', v_motivo);
  END IF;

  IF v_acao = 'escolher' THEN
    v_chave := 'triagem:' || t.id::text || ':agente:' || m.id::text;
    IF EXISTS (SELECT 1 FROM public.whatsapp_fila_envio WHERE idempotency_key = v_chave) THEN
      RETURN jsonb_build_object('registrado', false, 'duplicada', true, 'motivo', 'ja_enfileirada');
    END IF;
    v_texto := r.texto_aprovado;
    v_atraso := least(15, greatest(1, coalesce((p_decisao ->> 'atraso_s')::integer, g.atraso_min_s)));
    INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, direcao, tipo, status, texto, cliente_id, os_id, enviada_por, origem, payload)
    VALUES (c.id, c.instancia_id, 'saida', 'texto', 'pendente', left(v_texto, 4096), c.cliente_id, c.os_id, NULL, 'automacao',
            jsonb_build_object('agente', jsonb_build_object('triagem_id', t.id, 'codigo', r.tema, 'versao', r.versao, 'ramo', t.ramo)))
    RETURNING id INTO v_msg;
    INSERT INTO public.whatsapp_fila_envio (conversa_id, mensagem_id, payload, status, idempotency_key)
    VALUES (c.id, v_msg,
            jsonb_build_object('tipo', 'texto', 'texto', left(v_texto, 4096), 'atraso_s', v_atraso, 'triagem_id', t.id,
                               'agente', true, 'passo', 'agente', 'resposta_id', r.id, 'versao', r.versao),
            'pendente', v_chave)
    RETURNING id INTO v_fila;
    UPDATE public.whatsapp_conversas SET ultima_mensagem = left(v_texto, 500), ultima_mensagem_at = now() WHERE id = c.id;
    INSERT INTO public.agente_eventos (conversa_id, mensagem_id, saida_id, tipo, acao, motivo, codigo, resposta_id, versao, ramo, sensivel, detalhe)
    VALUES (c.id, m.id, v_msg, 'escolheu', 'escolher', NULL, r.tema, r.id, r.versao, t.ramo::text, v_sensivel,
            jsonb_build_object('candidatas', coalesce((p_decisao ->> 'candidatas')::integer, 0),
                               'especificidade', coalesce((p_decisao ->> 'especificidade')::integer, 0),
                               'passar_para_equipe', v_passar, 'atraso_s', v_atraso));
    INSERT INTO public.agente_eventos (conversa_id, mensagem_id, saida_id, tipo, codigo, resposta_id, versao, ramo, sensivel)
    VALUES (c.id, m.id, v_msg, 'enviado', r.tema, r.id, r.versao, t.ramo::text, v_sensivel);
    v_enviado := true;
    v_tipo := 'escolheu';
    IF v_passar THEN
      -- a resposta promete avisar a equipe: depois de enfileirá-la o agente entrega a conversa (o texto sai, o dono vira ninguem)
      v_aviso := public._agente_avisar_equipe(c.id, coalesce(t.atendimento_id, t.id), 'pediu_equipe', g.avisar_grupo);
      INSERT INTO public.agente_eventos (conversa_id, tipo, acao, motivo, codigo, ramo, detalhe)
      VALUES (c.id, 'entregou', 'entregar', 'passou_com_a_resposta', r.tema, t.ramo::text, jsonb_build_object('aviso', v_aviso));
    END IF;
  ELSIF v_acao = 'entregar' THEN
    -- entregue à equipe, o agente não fala mais: o que ele ainda tinha na fila desta conversa não sai
    PERFORM public._agente_cancelar_pendentes(c.id);
    v_aviso := public._agente_avisar_equipe(c.id, coalesce(t.atendimento_id, t.id), v_motivo, g.avisar_grupo);
    v_detalhe := jsonb_build_object('regras', to_jsonb(v_regras), 'aviso', v_aviso);
    INSERT INTO public.agente_eventos (conversa_id, mensagem_id, tipo, acao, motivo, ramo, sensivel, detalhe)
    VALUES (c.id, m.id, 'entregou', 'entregar', v_motivo, t.ramo::text, v_sensivel, v_detalhe);
    v_tipo := 'entregou';
  ELSIF v_acao = 'parar' THEN
    v_hash_tel := public._triagem_hash(c.telefone_normalizado);
    v_hash_lid := public._triagem_hash(c.chat_lid);
    IF v_hash_tel IS NULL AND v_hash_lid IS NULL THEN
      v_bloqueio := 'sem_chave';
    ELSE
      INSERT INTO public.whatsapp_automacao_bloqueios (telefone_hash, lid_hash, conversa_id, motivo, origem)
      VALUES (v_hash_tel, v_hash_lid, c.id, 'parar', 'agente')
      ON CONFLICT DO NOTHING;
      UPDATE public.whatsapp_automacao_bloqueios b
         SET telefone_hash = coalesce(b.telefone_hash, v_hash_tel), lid_hash = coalesce(b.lid_hash, v_hash_lid)
       WHERE b.conversa_id = c.id
         AND (b.telefone_hash IS NULL OR b.lid_hash IS NULL)
         AND NOT EXISTS (SELECT 1 FROM public.whatsapp_automacao_bloqueios o WHERE o.id <> b.id
                            AND (o.telefone_hash = v_hash_tel OR o.lid_hash = v_hash_lid));
      v_bloqueio := 'gravado';
    END IF;
    -- quem pediu para parar não recebe o que o agente ainda tinha na fila desta conversa
    PERFORM public._agente_cancelar_pendentes(c.id);
    INSERT INTO public.agente_eventos (conversa_id, mensagem_id, tipo, acao, motivo, ramo, detalhe)
    VALUES (c.id, m.id, 'barrado', 'parar', 'parar', t.ramo::text, jsonb_build_object('bloqueio', v_bloqueio));
    v_tipo := 'barrado';
  ELSE
    INSERT INTO public.agente_eventos (conversa_id, mensagem_id, tipo, acao, motivo, ramo)
    VALUES (c.id, m.id, 'barrado', 'barrar', v_motivo, t.ramo::text);
    v_tipo := 'barrado';
  END IF;
  RETURN jsonb_build_object('registrado', true, 'ensaio', false, 'enviado', v_enviado, 'tipo', v_tipo, 'acao', v_acao,
                            'motivo', v_motivo, 'aviso', v_aviso, 'bloqueio', v_bloqueio);
END $function$;

-- 8. agente_evento: erro e pausado, só com códigos -----------------------------------------------------------------------------
-- O CHECK da tabela recusa chave com cara de conteúdo. Depois de um erro, confere o freio por contagem (erros na última hora,
-- contados só depois de desligada_em) e desliga SÓ a configuração se passou.
CREATE OR REPLACE FUNCTION public.agente_evento(p_conversa_id uuid, p_mensagem_id uuid, p_tipo text, p_detalhe jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  g public.agente_config%ROWTYPE;
  v_motivo text;
  v_erros integer;
  v_freio boolean := false;
BEGIN
  IF p_tipo IS NULL OR p_tipo NOT IN ('erro', 'pausado') THEN
    RAISE EXCEPTION 'Só os eventos erro e pausado entram por aqui.';
  END IF;
  v_motivo := coalesce(nullif(p_detalhe ->> 'etapa', ''), nullif(p_detalhe ->> 'motivo', ''));
  IF v_motivo IS NOT NULL AND v_motivo !~ '^[a-z][a-z0-9_]{1,40}$' THEN v_motivo := NULL; END IF;
  INSERT INTO public.agente_eventos (conversa_id, mensagem_id, tipo, motivo, detalhe)
  VALUES (p_conversa_id, p_mensagem_id, p_tipo, v_motivo, coalesce(p_detalhe, '{}'::jsonb));
  IF p_tipo = 'erro' THEN
    SELECT * INTO g FROM public.agente_config WHERE id;
    IF g.estado <> 'desligada' THEN
      SELECT count(*) INTO v_erros FROM public.agente_eventos e
       WHERE e.tipo = 'erro' AND e.criado_em > greatest(now() - interval '1 hour', coalesce(g.desligada_em, '-infinity'::timestamptz));
      IF v_erros >= g.freio_erros_hora AND public._agente_desligar_config('freio_erros_de_leitura', NULL) THEN
        v_freio := true;
        PERFORM public._agente_cancelar_pendentes(NULL);
        INSERT INTO public.agente_eventos (tipo, motivo, detalhe)
        VALUES ('freio', 'freio_erros_de_leitura', jsonb_build_object('erros', v_erros, 'manual', false));
      END IF;
    END IF;
  END IF;
  RETURN jsonb_build_object('ok', true, 'freio', v_freio);
END $function$;

-- 9. agente_conferir_envio: o que o consumidor da fila confere antes de despachar. SÓ LÊ. ------------------------------------------
-- Recebe também a resposta e a versão que o agente gravou no payload da linha: se a resposta foi arquivada, editada (a edição
-- volta a rascunho e sobe a versão), ganhou produto ou já não passa no validador, o consumidor cancela com o motivo
-- resposta_mudou. Linha antiga sem esses dois valores também cancela: na dúvida, não sai.
CREATE OR REPLACE FUNCTION public.agente_conferir_envio(p_conversa_id uuid, p_resposta_id uuid, p_versao integer)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'estado', (SELECT g.estado FROM public.agente_config g WHERE g.id),
    'triagem_liberou', public._agente_triagem_liberou(p_conversa_id),
    'degrau_permite', public._agente_degrau_permite(p_conversa_id),
    'humano', public._triagem_humano_na_conversa(p_conversa_id),
    'bloqueado', public._triagem_bloqueado(p_conversa_id),
    'resposta_aprovada', coalesce((SELECT b.status = 'aprovada' AND b.texto_aprovado IS NOT NULL AND b.produto_id IS NULL
                                          AND cardinality(public._agente_problemas_de_texto(b.texto_aprovado, b.ramos)) = 0
                                     FROM public.agente_base_respostas b
                                    WHERE b.id = p_resposta_id AND p_versao IS NOT NULL AND b.versao = p_versao), false))
$function$;

-- 10. agente_config_salvar ---------------------------------------------------------------------------------------------------
-- configuracoes.manage ou whatsapp.manage para abrir; whatsapp.manage (hoje só o admin) para mexer em estado, percentual, números
-- de teste, teto de mensagens, freios, aviso ao grupo, atraso e guarda do rastro. Sobe um degrau por vez. Para desligar use
-- agente_desligar. As frases das recusas são escritas para o dono ler na tela: com acento, sem parênteses e sem sublinhado.
CREATE OR REPLACE FUNCTION public.agente_config_salvar(p_usuario uuid, p_config jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c public.agente_config%ROWTYPE;
  v_estado public.triagem_estado;
  v_numeros text[];
  v_percentual integer;
  v_mexe_em_freio boolean;
  v_degraus constant text[] := ARRAY['desligada', 'ensaio', 'teste', 'parcial', 'ligada'];
  v_de integer;
  v_para integer;
BEGIN
  IF p_usuario IS NULL OR NOT (public.has_permission(p_usuario, 'configuracoes.manage')
                               OR public.has_permission(p_usuario, 'whatsapp.manage')) THEN
    RAISE EXCEPTION 'Seu perfil não tem a permissão para configurar o agente.';
  END IF;
  IF jsonb_typeof(coalesce(p_config, 'null'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'Configuração inválida.';
  END IF;
  SELECT * INTO c FROM public.agente_config WHERE id FOR UPDATE;

  v_estado := c.estado;
  IF p_config ? 'estado' THEN
    v_estado := (p_config ->> 'estado')::public.triagem_estado;
    IF v_estado = 'desligada' AND c.estado <> 'desligada' THEN
      RAISE EXCEPTION 'Para desligar, use o botão Desligar tudo, que também cancela as mensagens que ainda não saíram.';
    END IF;
    v_de := array_position(v_degraus, c.estado::text);
    v_para := array_position(v_degraus, v_estado::text);
    IF v_para > v_de + 1 THEN
      RAISE EXCEPTION 'O agente só sobe um degrau de cada vez, na ordem.';
    END IF;
  END IF;
  IF p_config ? 'numeros_teste' THEN
    SELECT coalesce(array_agg(DISTINCT n ORDER BY n), '{}'::text[]) INTO v_numeros
      FROM (SELECT public.normalize_whatsapp_phone(x) AS n FROM jsonb_array_elements_text(p_config -> 'numeros_teste') AS x) q
     WHERE n IS NOT NULL;
    IF cardinality(v_numeros) <> (SELECT count(*) FROM jsonb_array_elements_text(p_config -> 'numeros_teste')) THEN
      RAISE EXCEPTION 'Um dos números de teste está vazio ou repetido.';
    END IF;
  ELSE
    v_numeros := c.numeros_teste;
  END IF;
  v_percentual := CASE WHEN p_config ? 'percentual' THEN (p_config ->> 'percentual')::integer ELSE c.percentual END;

  IF (v_estado IS DISTINCT FROM c.estado OR v_percentual IS DISTINCT FROM c.percentual
      OR NOT (v_numeros <@ c.numeros_teste AND c.numeros_teste <@ v_numeros))
     AND NOT public.has_permission(p_usuario, 'whatsapp.manage') THEN
    RAISE EXCEPTION 'Mudar o estado, a porcentagem ou os números de teste do agente exige a permissão de gerenciar o WhatsApp.';
  END IF;

  v_mexe_em_freio :=
       ((p_config ? 'freio_falhas_envio') AND (p_config ->> 'freio_falhas_envio')::integer IS DISTINCT FROM c.freio_falhas_envio)
    OR ((p_config ? 'freio_erros_hora') AND (p_config ->> 'freio_erros_hora')::integer IS DISTINCT FROM c.freio_erros_hora)
    OR ((p_config ? 'max_mensagens') AND (p_config ->> 'max_mensagens')::integer IS DISTINCT FROM c.max_mensagens)
    OR ((p_config ? 'max_por_hora') AND (p_config ->> 'max_por_hora')::integer IS DISTINCT FROM c.max_por_hora)
    OR ((p_config ? 'max_por_dia') AND (p_config ->> 'max_por_dia')::integer IS DISTINCT FROM c.max_por_dia)
    -- o aviso ao grupo, o atraso de digitação e a guarda do rastro também decidem o que o contato vê e quanto se guarda
    OR ((p_config ? 'avisar_grupo') AND (p_config ->> 'avisar_grupo')::boolean IS DISTINCT FROM c.avisar_grupo)
    OR ((p_config ? 'retencao_eventos_dias') AND (p_config ->> 'retencao_eventos_dias')::integer IS DISTINCT FROM c.retencao_eventos_dias)
    OR ((p_config ? 'atraso_min_s') AND (p_config ->> 'atraso_min_s')::integer IS DISTINCT FROM c.atraso_min_s)
    OR ((p_config ? 'atraso_max_s') AND (p_config ->> 'atraso_max_s')::integer IS DISTINCT FROM c.atraso_max_s);
  IF v_mexe_em_freio AND NOT public.has_permission(p_usuario, 'whatsapp.manage') THEN
    RAISE EXCEPTION 'Mudar o teto, os freios, o aviso ao grupo, o atraso ou a guarda do rastro exige a permissão de gerenciar o WhatsApp.';
  END IF;

  UPDATE public.agente_config SET
    estado = v_estado,
    numeros_teste = v_numeros,
    percentual = v_percentual,
    max_mensagens = CASE WHEN p_config ? 'max_mensagens' THEN (p_config ->> 'max_mensagens')::integer ELSE max_mensagens END,
    atraso_min_s = CASE WHEN p_config ? 'atraso_min_s' THEN (p_config ->> 'atraso_min_s')::integer ELSE atraso_min_s END,
    atraso_max_s = CASE WHEN p_config ? 'atraso_max_s' THEN (p_config ->> 'atraso_max_s')::integer ELSE atraso_max_s END,
    max_por_hora = CASE WHEN p_config ? 'max_por_hora' THEN (p_config ->> 'max_por_hora')::integer ELSE max_por_hora END,
    max_por_dia = CASE WHEN p_config ? 'max_por_dia' THEN (p_config ->> 'max_por_dia')::integer ELSE max_por_dia END,
    freio_falhas_envio = CASE WHEN p_config ? 'freio_falhas_envio' THEN (p_config ->> 'freio_falhas_envio')::integer ELSE freio_falhas_envio END,
    freio_erros_hora = CASE WHEN p_config ? 'freio_erros_hora' THEN (p_config ->> 'freio_erros_hora')::integer ELSE freio_erros_hora END,
    avisar_grupo = CASE WHEN p_config ? 'avisar_grupo' THEN (p_config ->> 'avisar_grupo')::boolean ELSE avisar_grupo END,
    retencao_eventos_dias = CASE WHEN p_config ? 'retencao_eventos_dias' THEN (p_config ->> 'retencao_eventos_dias')::integer ELSE retencao_eventos_dias END,
    atualizado_por = p_usuario
  WHERE id;

  SELECT * INTO c FROM public.agente_config WHERE id;
  RETURN jsonb_build_object('ok', true, 'estado', c.estado, 'percentual', c.percentual, 'vale_a_partir_de', c.vale_a_partir_de);
END $function$;

-- 11. agente_desligar ---------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.agente_desligar(p_motivo text, p_usuario uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_motivo text := left(coalesce(nullif(btrim(coalesce(p_motivo, '')), ''), 'sem_motivo'), 120);
  v_mudou boolean;
  v_canceladas integer;
BEGIN
  IF p_usuario IS NULL OR NOT (public.has_permission(p_usuario, 'whatsapp.manage')
                               OR public.has_permission(p_usuario, 'configuracoes.manage')) THEN
    RAISE EXCEPTION 'Seu perfil não tem a permissão para desligar o agente.';
  END IF;
  v_mudou := public._agente_desligar_config(v_motivo, p_usuario);
  v_canceladas := public._agente_cancelar_pendentes(NULL);
  INSERT INTO public.agente_eventos (tipo, motivo, detalhe)
  VALUES ('freio', 'desligado_a_mao', jsonb_build_object('manual', true, 'mudou_o_estado', v_mudou, 'canceladas_na_fila', v_canceladas));
  RETURN jsonb_build_object('ok', true, 'estado', 'desligada', 'canceladas_na_fila', v_canceladas);
END $function$;

-- 12. agente_varrer: freio por contagem de falhas de envio e retenção dos eventos ------------------------------------------------
-- A rodada do despachante chama, só com o agente ligado em algum degrau. Devolve só contagens.
CREATE OR REPLACE FUNCTION public.agente_varrer()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  g public.agente_config%ROWTYPE;
  v_falhas integer := 0;
  v_freio text;
  v_apagados integer := 0;
  v_canceladas integer := 0;
BEGIN
  SELECT * INTO g FROM public.agente_config WHERE id;
  IF g.estado <> 'desligada' THEN
    SELECT count(*) INTO v_falhas FROM public.whatsapp_fila_envio f
     WHERE f.payload ? 'agente' AND f.status = 'falha'
       AND f.updated_at > greatest(now() - interval '30 minutes', coalesce(g.desligada_em, '-infinity'::timestamptz));
    IF v_falhas >= g.freio_falhas_envio THEN
      v_freio := 'freio_falhas_de_envio';
      IF public._agente_desligar_config(v_freio, NULL) THEN
        v_canceladas := public._agente_cancelar_pendentes(NULL);
        INSERT INTO public.agente_eventos (tipo, motivo, detalhe)
        VALUES ('freio', v_freio, jsonb_build_object('falhas', v_falhas, 'manual', false, 'canceladas_na_fila', v_canceladas));
      END IF;
    END IF;
  END IF;
  -- A retenção NUNCA apaga o que decide o dono, o teto e a segunda pergunta de preço: os eventos entregou, enviado e escolheu de uma
  -- conversa. Apagados, a conversa entregue voltaria a ter o agente como dono (triagem_dono_da_conversa olha o evento entregou), o
  -- teto de mensagens zeraria e a pergunta de preço seria a primeira de novo. Eles saem junto com a conversa (ON DELETE CASCADE).
  DELETE FROM public.agente_eventos
   WHERE criado_em < now() - g.retencao_eventos_dias * interval '1 day'
     AND NOT (tipo IN ('entregou', 'enviado', 'escolheu') AND conversa_id IS NOT NULL);
  GET DIAGNOSTICS v_apagados = ROW_COUNT;
  RETURN jsonb_build_object('freio', v_freio, 'falhas_de_envio_30min', v_falhas, 'eventos_apagados', v_apagados,
                            'canceladas_na_fila', v_canceladas);
END $function$;

-- 13. agente_resumo: contagens por tipo, motivo e tema. Nenhuma frase. ---------------------------------------------------------------
-- 'sem_resposta' é o contador das perguntas que a base não soube responder: o dono lê para saber que resposta falta escrever.
CREATE OR REPLACE FUNCTION public.agente_resumo(p_dias integer DEFAULT 7)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'dias', least(greatest(coalesce(p_dias, 7), 1), 365),
    'por_tipo', coalesce((SELECT jsonb_object_agg(tipo, n) FROM (
        SELECT e.tipo, count(*) AS n FROM public.agente_eventos e
         WHERE e.criado_em > now() - least(greatest(coalesce(p_dias, 7), 1), 365) * interval '1 day' GROUP BY e.tipo) q), '{}'::jsonb),
    'por_motivo', coalesce((SELECT jsonb_object_agg(tipo || ':' || motivo, n) FROM (
        SELECT e.tipo, e.motivo, count(*) AS n FROM public.agente_eventos e
         WHERE e.motivo IS NOT NULL AND e.tipo IN ('entregou', 'barrado', 'ensaio')
           AND e.criado_em > now() - least(greatest(coalesce(p_dias, 7), 1), 365) * interval '1 day' GROUP BY e.tipo, e.motivo) q), '{}'::jsonb),
    'por_tema', coalesce((SELECT jsonb_object_agg(codigo, n) FROM (
        SELECT e.codigo, count(*) AS n FROM public.agente_eventos e
         WHERE e.codigo IS NOT NULL AND e.tipo IN ('escolheu', 'ensaio')
           AND e.criado_em > now() - least(greatest(coalesce(p_dias, 7), 1), 365) * interval '1 day' GROUP BY e.codigo) q), '{}'::jsonb),
    'perguntas_sem_resposta', (SELECT count(*) FROM public.agente_eventos e
         WHERE e.motivo = 'sem_resposta' AND e.tipo IN ('entregou', 'ensaio')
           AND e.criado_em > now() - least(greatest(coalesce(p_dias, 7), 1), 365) * interval '1 day'))
$function$;

-- 14. ACL: nada para anon nem authenticated, EXECUTE só do service_role. A função de gatilho também (gatilho nasce aberto). ---------
REVOKE ALL ON FUNCTION public._agente_config_antes_gravar() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._agente_triagem_liberou(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._agente_degrau_permite(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._agente_cobre(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._agente_cancelar_pendentes(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._agente_desligar_config(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._agente_avisar_equipe(uuid, uuid, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agente_contexto(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agente_registrar(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agente_evento(uuid, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agente_conferir_envio(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agente_config_salvar(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agente_desligar(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agente_varrer() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agente_resumo(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._agente_triagem_liberou(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public._agente_degrau_permite(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public._agente_cobre(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public._agente_cancelar_pendentes(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public._agente_desligar_config(text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public._agente_avisar_equipe(uuid, uuid, text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.agente_contexto(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.agente_registrar(uuid, uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.agente_evento(uuid, uuid, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.agente_conferir_envio(uuid, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.agente_config_salvar(uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.agente_desligar(text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.agente_varrer() TO service_role;
GRANT EXECUTE ON FUNCTION public.agente_resumo(integer) TO service_role;
-- triagem_dono_da_conversa: CREATE OR REPLACE preserva a ACL; a conferência abaixo prova que continua só do service_role.

-- 15. Conferência: se algo estiver fora do esperado, desfaz tudo -----------------------------------------------------------------
DO $confere$
DECLARE
  v_n integer;
  v_x text;
  v_t text;
  v_f text;
BEGIN
  -- configuração: uma linha, nasce desligada, números de teste vazios, vale_a_partir_de vazio
  SELECT count(*) INTO v_n FROM public.agente_config;
  IF v_n <> 1 THEN RAISE EXCEPTION 'esperava 1 linha em agente_config, achei %', v_n; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.agente_config WHERE estado = 'desligada' AND percentual = 0 AND numeros_teste = '{}'
                    AND vale_a_partir_de IS NULL AND max_mensagens = 3 AND avisar_grupo) THEN
    RAISE EXCEPTION 'a configuração do agente não nasceu desligada e com os padrões combinados';
  END IF;
  SELECT count(*) INTO v_n FROM public.agente_eventos;
  IF v_n <> 0 THEN RAISE EXCEPTION 'agente_eventos deveria nascer vazia, tem % linhas', v_n; END IF;

  -- tabelas: RLS ligada, ninguém de fora escreve, nem o service_role (escreve pelas funções)
  FOREACH v_t IN ARRAY ARRAY['public.agente_config', 'public.agente_eventos'] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = v_t::regclass) THEN RAISE EXCEPTION 'RLS desligada em %', v_t; END IF;
    IF has_table_privilege('anon', v_t, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
      RAISE EXCEPTION 'anon tem privilégio em %', v_t; END IF;
    IF has_table_privilege('authenticated', v_t, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
      RAISE EXCEPTION 'authenticated escreve em %', v_t; END IF;
    IF has_table_privilege('service_role', v_t, 'INSERT,UPDATE,DELETE,TRUNCATE') THEN
      RAISE EXCEPTION 'service_role escreve direto em % (deve escrever só pelas funções)', v_t; END IF;
    IF NOT has_table_privilege('service_role', v_t, 'SELECT') OR NOT has_table_privilege('authenticated', v_t, 'SELECT') THEN
      RAISE EXCEPTION 'faltou a leitura de % para a equipe ou para o servidor', v_t; END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('agente_config', 'agente_eventos') AND cmd <> 'SELECT') THEN
    RAISE EXCEPTION 'política de escrita nas tabelas do agente'; END IF;

  -- funções: uma de cada, definer, search_path, ACL
  FOREACH v_f IN ARRAY ARRAY[
    '_agente_config_antes_gravar', '_agente_triagem_liberou', '_agente_degrau_permite', '_agente_cobre', '_agente_cancelar_pendentes',
    '_agente_desligar_config', '_agente_avisar_equipe', 'agente_contexto', 'agente_registrar', 'agente_evento',
    'agente_conferir_envio', 'agente_config_salvar', 'agente_desligar', 'agente_varrer', 'agente_resumo', 'triagem_dono_da_conversa'
  ] LOOP
    SELECT count(*) INTO v_n FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = v_f;
    IF v_n <> 1 THEN RAISE EXCEPTION '% tem % versões (esperado 1): sobrecarga quebra o PostgREST', v_f, v_n; END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = v_f
                  AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
                       OR has_function_privilege('public', p.oid, 'EXECUTE'))) THEN
      RAISE EXCEPTION 'anon, authenticated ou PUBLIC executa %', v_f; END IF;
    IF v_f <> '_agente_config_antes_gravar' AND NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = v_f
                      AND p.prosecdef AND p.proconfig IS NOT NULL AND ('search_path=public' = ANY (p.proconfig))
                      AND has_function_privilege('service_role', p.oid, 'EXECUTE')) THEN
      RAISE EXCEPTION '% sem SECURITY DEFINER, search_path ou EXECUTE do service_role', v_f; END IF;
  END LOOP;
  SELECT count(*) INTO v_n FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname ~ '^_?agente_' AND proname !~ '^agente_resposta_' AND proname NOT IN
    ('_agente_frases_ok', '_agente_problemas_de_texto', '_agente_base_antes_gravar', '_agente_base_historico', '_agente_base_sem_apagar', '_agente_base_uma_por_vez');
  IF v_n <> 15 THEN RAISE EXCEPTION 'esperava 15 funções novas do agente, achei %', v_n; END IF;

  -- a troca do dono: o corpo novo tem o agente e mantém a chave antiga; os outros ramos continuam
  SELECT prosrc INTO v_x FROM pg_proc WHERE oid = 'public.triagem_dono_da_conversa(uuid)'::regprocedure;
  IF v_x NOT LIKE '%_agente_cobre%' OR v_x NOT LIKE '%agente_apos_triagem%' OR v_x NOT LIKE '%pausada_humano%' OR v_x NOT LIKE '%_triagem_parece_robo%' THEN
    RAISE EXCEPTION 'a troca de triagem_dono_da_conversa saiu diferente do combinado'; END IF;

  -- gatilhos: 2 na configuração, nenhum em tabela viva
  SELECT count(*) INTO v_n FROM pg_trigger WHERE NOT tgisinternal AND tgrelid = 'public.agente_config'::regclass;
  IF v_n <> 2 THEN RAISE EXCEPTION 'esperava 2 gatilhos na configuração, achei %', v_n; END IF;

  -- nenhuma coluna de texto, nome, telefone, CEP ou preço nas tabelas novas
  SELECT string_agg(table_name || '.' || column_name, ', ') INTO v_x FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name IN ('agente_config', 'agente_eventos')
     AND (column_name ~ '^(texto|text|mensagem|conteudo|body|nome|telefone|phone|cep|endereco|email|frase|pergunta|resposta)$'
          OR column_name ~ 'preco|valor|custo|desconto|orcamento' OR column_name LIKE '%revend%');
  IF v_x IS NOT NULL THEN RAISE EXCEPTION 'coluna que não deveria existir: %', v_x; END IF;

  -- o CHECK do detalhe recusa chave com cara de conteúdo (prova no próprio banco, desfeita pela subtransação)
  BEGIN
    INSERT INTO public.agente_eventos (tipo, motivo, detalhe) VALUES ('erro', 'prova', '{"frase": "x"}'::jsonb);
    RAISE EXCEPTION 'o CHECK do detalhe não recusou a chave frase';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
  SELECT count(*) INTO v_n FROM public.agente_eventos;
  IF v_n <> 0 THEN RAISE EXCEPTION 'a conferência deixou evento para trás'; END IF;

  -- o dono de uma conversa que não existe continua ninguem, e o auxiliar não libera conversa nenhuma
  IF public.triagem_dono_da_conversa('00000000-0000-4000-8000-000000000000') <> 'ninguem'
     OR public._agente_triagem_liberou('00000000-0000-4000-8000-000000000000') THEN
    RAISE EXCEPTION 'dono ou liberação de conversa inexistente fora do esperado'; END IF;
END $confere$;

COMMIT;
