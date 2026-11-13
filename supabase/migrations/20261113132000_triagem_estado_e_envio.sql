-- AINDA NÃO APLICADA. O dono ensaia (docs/ensaio-triagem-dados.md) e aplica; depois troca esta linha por "APLICADA em <data>".
-- ORDEM: depois da 20261113130000_triagem_dados.sql (B1) e da 20261113131000_horario_unico.sql (B3).
-- NADA CHAMA ESTAS FUNÇÕES AINDA: nenhuma rota, tela ou webhook. A configuração nasce 'desligada' (B1), então os dois
-- gatilhos novos (pausa por humano) acham zero triagens e saem na primeira consulta. Esta migração em si não muda
-- comportamento. (Quem FAZ trabalho de verdade é o gatilho de horário da B3, tg_whatsapp_config_sincroniza_horario: ele
-- copia o horário da tela antiga para a tabela nova quando as colunas mudam, até o B5 removê-lo. Está dito no cabeçalho da B3.)
--
-- TRIAGEM DE BOAS-VINDAS DO WHATSAPP, B4: ESTADO POR CONVERSA E ENVIO (Bex Print, Onda B)
--
-- O QUE CRIA
--  1. whatsapp_triagens: o estado da triagem de cada conversa (uma linha por conversa) e o que a pessoa disse.
--  2. whatsapp_triagem_eventos: o registro das decisões, SEM conteúdo de mensagem: só códigos, ids e contagens
--     (CHECK recusa chave com cara de texto, nome, telefone ou CEP).
--  3. whatsapp_automacao_bloqueios: "não incomodar", guardado só como HASH do telefone e do lid.
--  4. Funções, todas SECURITY DEFINER com search_path público e EXECUTE só para service_role:
--       triagem_ler_ou_abrir, triagem_aplicar, triagem_enviar, triagem_dono_da_conversa, triagem_pausar_por_humano
--       (gatilho), triagem_varrer, triagem_desligar, mais as internas _triagem_*.
--  5. Dois gatilhos AFTER que pausam a triagem quando gente da equipe responde ou assume a conversa.
--  6. Índices nas cinco chaves estrangeiras novas que apontam para mensagem e atendimento (apagar mensagem ou atendimento
--     não varre as tabelas da triagem inteiras).
--
-- O QUE FOI LIDO NO BANCO VIVO em 13/11/2026 (pg_get_functiondef, não migração antiga)
--  * _wa_mensagem_antes_inserir: entrada só zera/abre atendimento se origem <> 'automacao'; saída com enviada_por nulo e
--    origem 'humano' vira 'celular'; só origem 'humano' e 'celular' zeram aguardando_desde e põem modo 'humano'; só 'ia'
--    zera aguardando_desde sem mudar o modo. Saída com origem 'automacao' NÃO mexe em nada. Por isso a mensagem da
--    triagem sai com origem 'automacao' e a marca payload.triagem: o contato continua na fila de espera da equipe.
--  * Origem 'triagem' NÃO foi criada, ao contrário do que uma crítica sugeria: caixa-de-entrada.ts (autorDoBalao) e
--    visao-geral.ts (quemEnviou) tratam qualquer origem desconhecida como "Celular"/equipe, então a mensagem do robô
--    apareceria como se fosse gente. A marca payload.triagem separa a triagem dos avisos de pedido sem tocar no CHECK.
--  * whatsapp_ia_enviar: grava a mensagem (pendente) e a linha da fila (payload {tipo, texto}, chave 'ia:<id>'),
--    atualiza ultima_mensagem. triagem_enviar copia isso, muda origem, payload e chave.
--  * whatsapp_fila_envio.status é text SEM CHECK (valores vivos: enviada, falha), então o status 'cancelada' não precisa
--    de migração, e não existe coluna de atraso: o atraso humanizado vai em payload.atraso_s (o PR B5 lê de lá).
--  * whatsapp_registrar_mensagem: telefone/lid, cliente por telefone_normalizado, whatsapp_principal e cliente_contatos
--    (NÃO olha telefone_2): por isso o portão desta migração procura cliente também em telefone_2 e telefone_3.
--  * Origens vivas de saída: humano, celular, automacao, ia. O gatilho de pausa dispara para tudo que NÃO é
--    automacao nem ia, então vale também para uma origem humana que apareça no futuro.
--  * Eco da própria API (fromMe + fromApi) é ignorado em evento-zapi.ts, então a mensagem da triagem não pausa a triagem.
--
-- CRÍTICAS DE ALTA GRAVIDADE INCORPORADAS AQUI (as de TypeScript ficam para o B5)
--  * Equipe, grupo, robô de empresa, cliente cadastrado (inclusive telefone_2, cliente_contatos, lead ganho, conversa
--    antiga atendida e o mesmo chat_lid) e bloqueado ficam FORA do portão, dentro da transação.
--  * Qualquer saída anterior (humano, celular, ia, aviso de pedido ou cobrança) impede abrir a triagem; "sim" sem triagem
--    ativa nunca é interpretado (a função devolve dono diferente de 'triagem').
--  * Pausa por humano só olha origem humano/celular: as saídas 'automacao' de aviso de pedido não pausam nem confundem.
--    O teto de mensagens conta TODAS as saídas automáticas da conversa, inclusive aviso de pedido e cobrança.
--  * Nome só é gravado se passar numa validação forte (2 a 20 letras por palavra, até 4 palavras, sem link, sem emoji,
--    sem casar com o quadro, sem termo proibido nem palavrão). Nome recusado gera o evento nome_nao_gravado.
--  * O número alternativo nasce NÃO verificado e esta migração não escreve em clientes nem em cliente_contatos.
--  * Eventos sem conteúdo de mensagem, com retenção (config.retencao_eventos_dias) aplicada por triagem_varrer;
--    bloqueio por hash de conversa, lid e telefone (parar vale para contato só com lid).
--  * O texto montado é revalidado aqui contra os termos proibidos ANTES de entrar na fila. Se barrar: não envia, grava
--    texto_barrado e desliga a triagem (freio automático).
--  * Concorrência: advisory lock por conversa, mesma ordem de travas do gatilho de mensagem (conversa e depois triagem),
--    versão da triagem, idempotência da entrada por índice único e do envio pela chave da fila.
--
-- TERCEIRA REVISÃO (13/11, duas revisões finais), o que mudou nesta migração
--  * DESCER A ESCADA PARA A TRIAGEM EM CURSO: antes, baixar de ligada para teste ou parcial só valia para conversas novas; a que
--    já estava aberta continuava enviando. Agora triagem_ler_ou_abrir, triagem_aplicar e triagem_enviar conferem o degrau ATUAL
--    para aquela conversa (_triagem_degrau_permite): em teste só número de teste; em parcial, número de teste ou sorteio
--    dentro do percentual atual; em ensaio nada sai de verdade; desligada para tudo. Quem não passar vira pausada_desligada
--    (motivo fora_do_degrau) e NADA é enviado. Triagem em modo ensaio não envia, então não é pausada por isto.
--  * O gatilho de pausa por humano não espera mais trava de outra sessão (FOR UPDATE SKIP LOCKED, lock_timeout curto na
--    própria função, e QUERY_CANCELED também capturado): a mensagem de saída da equipe é gravada em qualquer caso. Triagem
--    travada por outro processo não é pausada na hora; triagem_ler_ou_abrir, triagem_aplicar e triagem_enviar conferem gente
--    na conversa antes de interpretar e de enviar e pegam a pausa na mensagem seguinte.
--  * triagem_dono_da_conversa devolve ninguem para grupo, bloqueado e robô de empresa também quando NÃO existe linha de
--    triagem (e para conversa inexistente), do mesmo jeito que triagem_ler_ou_abrir.
--  * Os DELETE em lote de _triagem_desligar_interno e de triagem_varrer (passo 4) recompõem ultima_mensagem e
--    ultima_mensagem_at da conversa, como _triagem_cancelar_pendentes já fazia (função comum _triagem_recompor_ultima).
--  * Cinco índices novos nas chaves estrangeiras; a conferência final falha se uma chave estrangeira das tabelas novas ficar
--    sem índice.
--
-- PRÉ-REQUISITOS DO B5 (o PR que liga as funções ao webhook), registrados aqui para não se perderem
--  * O PR B0 (vocabulário: só as modalidades cliente e parceiro, sem a outra palavra do mercado; já na main como #451) é
--    pré-requisito do B5. O B5 não sobe antes de o texto que o cliente lê estar nesse vocabulário.
--  * A página seja-parceiro hoje fala de tabela e de preço de parceiro. Isto é decisão do dono (não foi alterada neste diff).
--    Seja qual for a decisão, o B5 só sobe com PROVA POR REQUISIÇÃO SEM SESSÃO (curl ou fetch sem cookie, contra a página
--    publicada) de que a página não mostra preço nem tabela para quem não está logado.
--
-- NÃO INCORPORADO AQUI (lista completa; a mesma está em docs/ensaio-triagem-dados.md)
--  1. max_mensagens continua 8 (regra do dono; uma crítica pediu 4).
--  2. Origem própria 'triagem' no CHECK de whatsapp_mensagens: recusada. autorDoBalao (caixa-de-entrada.ts) e quemEnviou
--     (visao-geral.ts) tratam origem desconhecida como "Celular", então o robô apareceria como gente. A marca é
--     payload.triagem.
--  3. Nome em whatsapp_conversas: nenhuma coluna nova em tabela existente; o B7 decide.
--  4. Equipe devolve a conversa ao ramo cliente: NÃO existe. O ramo só sobe (cliente para parceiro) e não há função nem
--     tela para descer. Decisão do dono, ainda aberta.
--  5. Página de privacidade cobrindo triagens, eventos e bloqueios: PENDENTE, fora deste diff (é página, não banco).
--  6. Página seja-parceiro ainda diz "tabela de parceiro" e "preço de parceiro": pergunta ao dono. A página NÃO foi
--     alterada aqui. Pré-requisito do B5: prova por requisição sem sessão de que ela não mostra preço (ver acima).
--  7. Regra de dono na assistente (a assistente consultar triagem_dono_da_conversa antes de responder): B5.
--  8. Resposta pelo chat_lid quando o contato só tem lid: B5.
--  9. Medir no ensaio as 16 conversas de robô de empresa (entrada com origem automacao) e exigir zero respostas: B5.
-- 10. Retenção das triagens (nome, CEP, telefone que a pessoa disse): hoje só os EVENTOS têm retenção
--     (retencao_eventos_dias). Quanto tempo guardar a triagem em si é decisão do dono.
-- 11. O gatilho TEMPORÁRIO de sincronização de horário (B3, tg_whatsapp_config_sincroniza_horario) sai no B5, quando a
--     assistente passar a ler whatsapp_dentro_do_horario.
--
-- SEGUNDA REVISÃO (13/11, três revisores independentes), o que mudou nesta migração
--  * Rajada: triagem_aplicar aceita mensagens_ids e grava um evento 'entrada' por mensagem; entrada mais antiga que uma já
--    processada conta como repetida (ler_ou_abrir e aplicar).
--  * Aviso ao grupo: enfileirado em notificacoes_fila por triagem_varrer (chave triagem_aviso:<id>, reenvio seguro), em vez
--    de "reservado" e entregue a quem não existe.
--  * Portão: atendimento reaberto ou qualquer atendimento fechado da conversa conta como ja_atendida; bloqueio manual novo
--    e cliente vinculado no meio do fluxo param a triagem em curso.
--  * Travas: desligar e a expiração do varrer travam a conversa antes de tocar na triagem; o freio automático não percorre
--    outras conversas de dentro de triagem_aplicar (só muda a configuração); ordem sempre advisory, conversa, triagem.
--  * Modo ensaio exercita o tempo real (grava ultimo_envio_em), NÃO é dono da conversa e não grava bloqueio real.
--  * triagem_dono_da_conversa: ninguem para pulada e robô; assistente para pausada_humano depois de whatsapp_devolver_ia.
--  * Expiração não leva resposta recebida e ainda não aplicada; retomada limpa motivo_fim; aviso decidido por expiração é
--    refeito na retomada (segundo aviso, no máximo 3 por triagem); a decisão de aviso é a mesma do TypeScript.
--  * Freio conta só o que aconteceu depois de desligada_em. Texto barrado pausa só aquela triagem; o freio global dispara por
--    contagem (3 textos barrados em 30 minutos).
--  * triagem_desligar só apaga mensagem cuja fila ele mesmo cancelou; função interna do freio separada da pública, que exige
--    usuário e permissão; 'parar' sem telefone nem lid não dá exceção.
--  * CHECK de eventos recursivo; variaveis e codigos só casam ^[a-z_]+$.
--  * Nome: até 6 palavras (4 fora de, da, do...), sem ponto, como no TypeScript.
--
-- LIÇÕES APLICADAS
--  * REVOKE de PUBLIC não fecha o anon: revoga de PUBLIC, anon e authenticated pelo nome e só depois concede.
--  * Gatilho nasce aberto para PUBLIC: as funções de gatilho também revogam.
--  * Nada de COALESCE solto: cada campo diz se é de escrita única, se só sobe ou se pode ser trocado, e onde.

BEGIN;

DO $pre$
BEGIN
  IF to_regclass('public.whatsapp_triagem_config') IS NULL OR to_regclass('public.whatsapp_triagem_passos') IS NULL
     OR to_regprocedure('public._triagem_problemas_de_texto(text, public.triagem_ramo, boolean)') IS NULL THEN
    RAISE EXCEPTION 'aplique antes a 20261113130000_triagem_dados.sql';
  END IF;
  IF to_regprocedure('public.whatsapp_dentro_do_horario(timestamptz)') IS NULL
     OR to_regprocedure('public.whatsapp_horario_em_texto()') IS NULL THEN
    RAISE EXCEPTION 'aplique antes a 20261113131000_horario_unico.sql';
  END IF;
  -- Onda A: o ramo parceiro por anúncio lê leads.tipo e o mapa de anúncios.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'leads' AND column_name = 'tipo')
     OR to_regclass('public.conjuntos_anuncio') IS NULL OR to_regclass('public.anuncios_origem') IS NULL THEN
    RAISE EXCEPTION 'sem_onda_a: leads.tipo ou o mapa de anúncios não existe; aplique a Onda A antes (o ramo parceiro nasceria sem fonte)';
  END IF;
  IF to_regprocedure('public._wa_telefone_da_equipe(text)') IS NULL OR to_regprocedure('public.normalize_whatsapp_phone(text)') IS NULL
     OR to_regprocedure('public.hoje_br()') IS NULL THEN
    RAISE EXCEPTION 'faltam _wa_telefone_da_equipe, normalize_whatsapp_phone e hoje_br';
  END IF;
  IF to_regprocedure('public.enfileirar_notificacao(text, text, uuid, text, text, uuid, text, jsonb, text)') IS NULL
     OR to_regprocedure('public.grupo_equipe_destino()') IS NULL THEN
    RAISE EXCEPTION 'faltam enfileirar_notificacao e grupo_equipe_destino (o aviso ao grupo da equipe sai por elas)';
  END IF;
  IF to_regclass('public.whatsapp_triagens') IS NOT NULL OR to_regclass('public.whatsapp_triagem_eventos') IS NOT NULL
     OR to_regclass('public.whatsapp_automacao_bloqueios') IS NOT NULL THEN
    RAISE EXCEPTION 'as tabelas de estado da triagem já existem: não reaplique';
  END IF;
  -- a fila aceita o status novo sem migração: não pode haver CHECK em status
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.whatsapp_fila_envio'::regclass AND contype = 'c'
               AND pg_get_constraintdef(oid) ~ 'status') THEN
    RAISE EXCEPTION 'whatsapp_fila_envio tem CHECK em status: o valor cancelada precisa entrar nele antes';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.whatsapp_fila_envio'::regclass AND contype = 'u'
                  AND pg_get_constraintdef(oid) = 'UNIQUE (idempotency_key)') THEN
    RAISE EXCEPTION 'whatsapp_fila_envio perdeu a chave única de idempotency_key';
  END IF;
  -- a premissa central: automacao não zera aguardando_desde. Se a função viva mudou, pare e releia.
  IF EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = '_wa_mensagem_antes_inserir'
               AND prosrc ~ 'automacao' AND prosrc ~ 'aguardando_desde = NULL') IS NOT TRUE THEN
    RAISE EXCEPTION '_wa_mensagem_antes_inserir mudou: releia a definição viva antes de confiar em origem automacao';
  END IF;
END
$pre$;

-- 1. whatsapp_triagens -----------------------------------------------------------------------------------------------
CREATE TABLE public.whatsapp_triagens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversa_id uuid NOT NULL UNIQUE REFERENCES public.whatsapp_conversas(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  atendimento_id uuid REFERENCES public.whatsapp_atendimentos(id) ON DELETE SET NULL,
  ramo public.triagem_ramo NOT NULL DEFAULT 'cliente',
  ramo_motivo text NOT NULL DEFAULT 'padrao' CHECK (ramo_motivo IN ('anuncio_mapeado', 'palavra', 'padrao')),
  modo text NOT NULL CHECK (modo IN ('ensaio', 'real')),
  status public.triagem_status NOT NULL DEFAULT 'ativa',
  passo text CHECK (passo IS NULL OR passo IN ('nome', 'sobrenome', 'primeira_vez', 'cep', 'telefone', 'telefone_novo',
                                                'fechamento', 'parceiro_nome', 'parceiro_link')),
  tentativas_passo integer NOT NULL DEFAULT 0 CHECK (tentativas_passo >= 0),
  mensagens_enviadas integer NOT NULL DEFAULT 0 CHECK (mensagens_enviadas >= 0),
  avisos_audio integer NOT NULL DEFAULT 0 CHECK (avisos_audio >= 0),
  avisos_arquivo integer NOT NULL DEFAULT 0 CHECK (avisos_arquivo >= 0),
  audios integer NOT NULL DEFAULT 0 CHECK (audios >= 0),
  figurinhas integer NOT NULL DEFAULT 0 CHECK (figurinhas >= 0),
  perguntas_de_preco integer NOT NULL DEFAULT 0 CHECK (perguntas_de_preco >= 0),
  etapas_esgotadas_seguidas integer NOT NULL DEFAULT 0 CHECK (etapas_esgotadas_seguidas >= 0),
  versao integer NOT NULL DEFAULT 1,
  -- o que a pessoa disse
  nome_informado text CHECK (nome_informado IS NULL OR char_length(nome_informado) <= 60),
  nome_completo boolean NOT NULL DEFAULT false,
  primeira_vez text CHECK (primeira_vez IS NULL OR primeira_vez IN ('sim', 'nao', 'ja_cliente', 'nao_sei')),
  cep text CHECK (cep IS NULL OR cep ~ '^\d{8}$'),
  cep_endereco jsonb CHECK (cep_endereco IS NULL OR (jsonb_typeof(cep_endereco) = 'object' AND octet_length(cep_endereco::text) <= 1000)),
  endereco_texto text CHECK (endereco_texto IS NULL OR char_length(endereco_texto) <= 300),
  endereco_recusado boolean NOT NULL DEFAULT false,
  telefone_chat text CHECK (telefone_chat IS NULL OR char_length(telefone_chat) <= 20),
  telefone_confirmado text CHECK (telefone_confirmado IS NULL OR telefone_confirmado IN ('sim', 'alternativo', 'pendente')),
  telefone_alternativo text CHECK (telefone_alternativo IS NULL OR telefone_alternativo ~ '^\d{10,11}$'),
  -- sem prova de posse: a triagem NUNCA marca verdadeiro; só gente confirma, e só gente copia para o cadastro (B7)
  telefone_alternativo_verificado boolean NOT NULL DEFAULT false,
  pediu_preco boolean NOT NULL DEFAULT false,
  pediu_tabela_especial boolean NOT NULL DEFAULT false,
  pediu_equipe boolean NOT NULL DEFAULT false,
  pediu_parceria boolean NOT NULL DEFAULT false,
  mandou_audio boolean NOT NULL DEFAULT false,
  reclamou boolean NOT NULL DEFAULT false,
  -- rastro
  origem_anuncio jsonb CHECK (origem_anuncio IS NULL OR jsonb_typeof(origem_anuncio) = 'object'),
  primeira_mensagem_id uuid REFERENCES public.whatsapp_mensagens(id) ON DELETE SET NULL,
  ultima_entrada_id uuid REFERENCES public.whatsapp_mensagens(id) ON DELETE SET NULL,
  ultima_pergunta_mensagem_id uuid REFERENCES public.whatsapp_mensagens(id) ON DELETE SET NULL,
  -- hash (md5 do texto normalizado), não o texto: serve para achar mensagem repetida sem guardar o que a pessoa escreveu
  ultima_entrada_hash text CHECK (ultima_entrada_hash IS NULL OR ultima_entrada_hash ~ '^[0-9a-f]{32}$'),
  ultima_entrada_em timestamptz,
  ultimo_envio_em timestamptz,
  ultima_pergunta_em timestamptz,
  iniciada_em timestamptz NOT NULL DEFAULT now(),
  concluida_em timestamptz,
  motivo_fim text,
  aviso_grupo_decidido boolean NOT NULL DEFAULT false,
  aviso_grupo_motivo text,
  aviso_grupo_marcas text[] NOT NULL DEFAULT '{}',
  aviso_grupo_enviado_em timestamptz,
  -- Quantas vezes o aviso foi (re)decidido: a expiração decide um aviso; se a pessoa volta e a triagem termina, o aviso novo
  -- (o resumo de como terminou) sai com outra chave. No máximo 3 avisos por triagem. Só a rodada 1 usa a chave pura.
  aviso_grupo_rodada integer NOT NULL DEFAULT 1 CHECK (aviso_grupo_rodada BETWEEN 1 AND 3),
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT triagem_status_ensaio_so_no_ensaio CHECK (status <> 'ensaio' OR modo = 'ensaio'),
  CONSTRAINT triagem_ensaio_nunca_ativa CHECK (NOT (modo = 'ensaio' AND status = 'ativa'))
);
COMMENT ON TABLE public.whatsapp_triagens IS
  'Estado da triagem de boas-vindas por conversa. Escrita só pelas funções triagem_*. Guarda nome, CEP e telefone que a pessoa disse: dado pessoal, lido por quem vê a caixa de WhatsApp.';
CREATE INDEX whatsapp_triagens_varredura ON public.whatsapp_triagens (status, ultimo_envio_em)
  WHERE status IN ('ativa', 'ensaio', 'expirada');
CREATE INDEX whatsapp_triagens_lead ON public.whatsapp_triagens (lead_id);
CREATE INDEX whatsapp_triagens_iniciada ON public.whatsapp_triagens (iniciada_em);
-- chaves estrangeiras para mensagem e atendimento: sem índice, apagar mensagem ou atendimento varreria a tabela inteira
CREATE INDEX whatsapp_triagens_atendimento ON public.whatsapp_triagens (atendimento_id);
CREATE INDEX whatsapp_triagens_primeira_mensagem ON public.whatsapp_triagens (primeira_mensagem_id);
CREATE INDEX whatsapp_triagens_ultima_entrada ON public.whatsapp_triagens (ultima_entrada_id);
CREATE INDEX whatsapp_triagens_ultima_pergunta ON public.whatsapp_triagens (ultima_pergunta_mensagem_id);
CREATE INDEX whatsapp_triagens_aviso_pendente ON public.whatsapp_triagens (aviso_grupo_decidido)
  WHERE aviso_grupo_decidido AND aviso_grupo_enviado_em IS NULL;

-- 2. whatsapp_triagem_eventos ----------------------------------------------------------------------------------------
CREATE TABLE public.whatsapp_triagem_eventos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  triagem_id uuid REFERENCES public.whatsapp_triagens(id) ON DELETE CASCADE,
  conversa_id uuid REFERENCES public.whatsapp_conversas(id) ON DELETE CASCADE,
  mensagem_id uuid REFERENCES public.whatsapp_mensagens(id) ON DELETE SET NULL,
  tipo public.triagem_evento_tipo NOT NULL,
  passo text,
  intencao public.triagem_intencao,
  detalhe jsonb NOT NULL DEFAULT '{}',
  criado_em timestamptz NOT NULL DEFAULT now(),
  -- recusa de portão e erro acontecem sem triagem; todo o resto pertence a uma
  CONSTRAINT triagem_evento_sem_triagem CHECK (triagem_id IS NOT NULL OR tipo IN ('gate', 'erro', 'freio')),
  -- só o freio automático (desligar tudo) não pertence a uma conversa
  CONSTRAINT triagem_evento_sem_conversa CHECK (conversa_id IS NOT NULL OR tipo = 'freio'),
  CONSTRAINT triagem_evento_detalhe_objeto CHECK (jsonb_typeof(detalhe) = 'object'),
  CONSTRAINT triagem_evento_detalhe_pequeno CHECK (octet_length(detalhe::text) <= 2000),
  -- sem conteúdo de mensagem: nenhuma chave com cara de texto, nome, telefone, CEP ou endereço, EM QUALQUER NÍVEL
  -- (jsonb_path_exists com $.** olha dentro de objetos e listas, não só a raiz)
  CONSTRAINT triagem_evento_detalhe_sem_conteudo CHECK (NOT jsonb_path_exists(detalhe,
    'strict $.** ? (@.type() == "object").keyvalue() ? (@.key like_regex "^(texto|text|mensagem|conteudo|body|nome|telefone|phone|cep|endereco|email|resposta|frase)$")')),
  -- variaveis e codigos guardam só NOMES (primeiro_nome, telefone, nome), nunca valores
  CONSTRAINT triagem_evento_variaveis_so_nomes CHECK (
    NOT (detalhe ? 'variaveis')
    OR (jsonb_typeof(detalhe -> 'variaveis') = 'array'
        AND NOT jsonb_path_exists(detalhe, '$.variaveis[*] ? (@.type() != "string" || !(@ like_regex "^[a-z_]{1,40}$"))'))),
  CONSTRAINT triagem_evento_codigos_so_codigos CHECK (
    NOT (detalhe ? 'codigos')
    OR (jsonb_typeof(detalhe -> 'codigos') = 'array'
        AND NOT jsonb_path_exists(detalhe, '$.codigos[*] ? (@.type() != "string" || !(@ like_regex "^[a-z][a-z0-9_]{0,40}$"))')))
);
COMMENT ON TABLE public.whatsapp_triagem_eventos IS
  'Registro das decisões da triagem. NUNCA guarda texto de mensagem: só códigos, ids e contagens. Apagado pela varredura depois de config.retencao_eventos_dias.';
-- a mesma mensagem de entrada nunca é processada duas vezes: é isto que torna o webhook repetido idempotente
CREATE UNIQUE INDEX whatsapp_triagem_eventos_entrada_unica ON public.whatsapp_triagem_eventos (triagem_id, mensagem_id)
  WHERE tipo = 'entrada';
CREATE INDEX whatsapp_triagem_eventos_triagem ON public.whatsapp_triagem_eventos (triagem_id, criado_em);
CREATE INDEX whatsapp_triagem_eventos_tipo_hora ON public.whatsapp_triagem_eventos (tipo, criado_em);
CREATE INDEX whatsapp_triagem_eventos_conversa ON public.whatsapp_triagem_eventos (conversa_id, tipo, criado_em);
CREATE INDEX whatsapp_triagem_eventos_mensagem ON public.whatsapp_triagem_eventos (mensagem_id);

-- 3. whatsapp_automacao_bloqueios ------------------------------------------------------------------------------------
-- Guardado só como hash (sha256 com prefixo fixo): quem lê a tabela não lê o telefone. É proteção contra olhar casual,
-- não contra quem tenta todos os números de celular. A chave é conversa, lid e telefone, porque 136 de 151 conversas
-- têm chat_lid e um parar gravado só no telefone não casaria com a mensagem seguinte.
CREATE TABLE public.whatsapp_automacao_bloqueios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telefone_hash text CHECK (telefone_hash IS NULL OR telefone_hash ~ '^[0-9a-f]{64}$'),
  lid_hash text CHECK (lid_hash IS NULL OR lid_hash ~ '^[0-9a-f]{64}$'),
  conversa_id uuid REFERENCES public.whatsapp_conversas(id) ON DELETE SET NULL,
  motivo text NOT NULL CHECK (motivo IN ('parar', 'robo', 'manual')),
  origem text NOT NULL DEFAULT 'triagem',
  criado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bloqueio_tem_chave CHECK (telefone_hash IS NOT NULL OR lid_hash IS NOT NULL)
);
CREATE UNIQUE INDEX whatsapp_automacao_bloqueios_telefone ON public.whatsapp_automacao_bloqueios (telefone_hash) WHERE telefone_hash IS NOT NULL;
CREATE UNIQUE INDEX whatsapp_automacao_bloqueios_lid ON public.whatsapp_automacao_bloqueios (lid_hash) WHERE lid_hash IS NOT NULL;
CREATE UNIQUE INDEX whatsapp_automacao_bloqueios_conversa ON public.whatsapp_automacao_bloqueios (conversa_id) WHERE conversa_id IS NOT NULL;

-- 4. RLS e GRANTs: leitura da equipe da caixa, escrita só pelas funções -----------------------------------------------
ALTER TABLE public.whatsapp_triagens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_triagem_eventos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_automacao_bloqueios ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_triagens FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.whatsapp_triagem_eventos FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.whatsapp_automacao_bloqueios FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.whatsapp_triagens TO authenticated;
GRANT SELECT ON public.whatsapp_triagem_eventos TO authenticated;
-- bloqueios: nem a equipe lê a tabela; quem precisa saber consulta pela função, no servidor
GRANT ALL ON public.whatsapp_triagens TO service_role;
GRANT ALL ON public.whatsapp_triagem_eventos TO service_role;
GRANT ALL ON public.whatsapp_automacao_bloqueios TO service_role;

CREATE POLICY "triagens leitura equipe" ON public.whatsapp_triagens
  FOR SELECT TO authenticated
  USING (public.has_permission((SELECT auth.uid()), 'whatsapp.read'));
CREATE POLICY "triagem_eventos leitura equipe" ON public.whatsapp_triagem_eventos
  FOR SELECT TO authenticated
  USING (public.has_permission((SELECT auth.uid()), 'whatsapp.read'));

-- 5. Funções internas -----------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._triagem_hash(p_valor text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'public'
AS $function$
  SELECT CASE WHEN nullif(btrim(coalesce(p_valor, '')), '') IS NULL THEN NULL
              ELSE encode(sha256(convert_to('bex-triagem:' || btrim(p_valor), 'UTF8')), 'hex') END
$function$;

-- Resto da divisão por 100 dos 8 últimos dígitos hexadecimais do uuid, igual a numeroDoIdentificador % 100 em textos.ts.
CREATE OR REPLACE FUNCTION public._triagem_sorteio(p_conversa uuid)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'public'
AS $function$
  SELECT (((('x' || right(replace(p_conversa::text, '-', ''), 8))::bit(32))::bigint) % 100)::integer
$function$;

-- Sinais estruturais de que o outro lado é uma automação (mesmos de detectarRobo em portao.ts, os que só dependem do
-- texto). O que depende de tempo e de repetição fica no TypeScript, que tem o relógio e o hash da última entrada.
CREATE OR REPLACE FUNCTION public._triagem_parece_robo(p_texto text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_texto text := coalesce(p_texto, '');
  v_norm text := public.bex_normalizar_texto(v_texto);
BEGIN
  IF char_length(v_texto) > 300 THEN RETURN 'texto_longo'; END IF;
  IF v_texto ~* 'https?://|www\.' THEN RETURN 'link'; END IF;
  IF v_texto ~ '^\s*\*[^*\s]' THEN RETURN 'negrito_no_comeco'; END IF;
  IF v_texto ~* '\y(responda|digite)\s+\w+\s+para\y' THEN RETURN 'frase_de_robo'; END IF;
  IF v_norm <> '' AND EXISTS (
       SELECT 1 FROM public.whatsapp_triagem_respostas r
        WHERE r.ativo AND r.intencao = 'automatica'
          AND position(' ' || r.frase || ' ' IN ' ' || v_norm || ' ') > 0) THEN
    RETURN 'frase_de_robo';
  END IF;
  RETURN NULL;
END $function$;

-- O telefone ou o lid desta conversa já é de alguém que a Bex Print conhece? Devolve o motivo ou nulo.
-- whatsapp_registrar_mensagem não olha telefone_2 nem lid, então esta busca é mais larga do que o vínculo da conversa.
CREATE OR REPLACE FUNCTION public._triagem_conhecido(p_conversa uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c public.whatsapp_conversas%ROWTYPE;
  v_tel text;
BEGIN
  SELECT * INTO c FROM public.whatsapp_conversas WHERE id = p_conversa;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_tel := c.telefone_normalizado;
  IF v_tel IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.clientes cl
                WHERE cl.telefone_normalizado = v_tel
                   OR public.normalize_whatsapp_phone(cl.whatsapp_principal) = v_tel
                   OR public.normalize_whatsapp_phone(cl.telefone_2) = v_tel
                   OR public.normalize_whatsapp_phone(cl.telefone_3) = v_tel) THEN
      RETURN 'cliente_cadastrado';
    END IF;
    IF EXISTS (SELECT 1 FROM public.cliente_contatos cc WHERE public.normalize_whatsapp_phone(cc.telefone) = v_tel) THEN
      RETURN 'contato_de_cliente';
    END IF;
    IF EXISTS (SELECT 1 FROM public.leads l WHERE l.telefone_normalizado = v_tel AND (l.cliente_id IS NOT NULL OR l.status = 'ganho')) THEN
      RETURN 'lead_ganho';
    END IF;
  END IF;
  -- outra conversa do mesmo telefone ou do mesmo lid que já tem cliente ou já foi atendida por gente
  IF EXISTS (
       SELECT 1 FROM public.whatsapp_conversas o
        WHERE o.id <> c.id
          AND ((v_tel IS NOT NULL AND o.telefone_normalizado = v_tel)
               OR (c.chat_lid IS NOT NULL AND o.chat_lid = c.chat_lid))
          AND (o.cliente_id IS NOT NULL
               OR EXISTS (SELECT 1 FROM public.whatsapp_mensagens m
                           WHERE m.conversa_id = o.id AND m.direcao = 'saida'
                             AND coalesce(m.origem, 'humano') NOT IN ('automacao', 'ia')))) THEN
    RETURN 'conversa_antiga_atendida';
  END IF;
  RETURN NULL;
END $function$;

CREATE OR REPLACE FUNCTION public._triagem_bloqueado(p_conversa uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM public.whatsapp_conversas c
      JOIN public.whatsapp_automacao_bloqueios b
        ON b.conversa_id = c.id
        OR (b.telefone_hash IS NOT NULL AND b.telefone_hash = public._triagem_hash(c.telefone_normalizado))
        OR (b.lid_hash IS NOT NULL AND b.lid_hash = public._triagem_hash(c.chat_lid))
     WHERE c.id = p_conversa)
$function$;

-- Nome que o contato digitou: só passa se parecer nome de pessoa. É a última porta antes de o robô repetir o nome.
-- Mesma regra de extrairNome (extrair.ts): palavras só de letras (acento, apóstrofo e hífen no meio), de 2 a 20 letras,
-- sem ponto, dígito, link, emoji nem símbolo ("www.exemplo.com", "oi.com", "bit.ly" caem aqui: têm ponto); até 6 palavras
-- no total e até 4 fora os conectores (de, da, do, das, dos, di, du); conector nunca no começo nem no fim; o primeiro
-- nome vai até 15 letras (é o único que o robô repete); o nome inteiro cabe em 60 letras (limite da coluna).
CREATE OR REPLACE FUNCTION public._triagem_nome_valido(p_nome text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_nome text := btrim(regexp_replace(coalesce(p_nome, ''), '\s+', ' ', 'g'));
  v_norm text;
  v_palavras text[];
  v_palavra text;
  v_plano text;
  v_letras integer;
  v_principais integer := 0;
  v_primeiro_principal text;
  v_conectores constant text[] := ARRAY['da', 'de', 'do', 'das', 'dos', 'di', 'du'];
  t record;
BEGIN
  IF v_nome = '' OR char_length(v_nome) > 60 THEN RETURN false; END IF;
  v_palavras := string_to_array(v_nome, ' ');
  IF cardinality(v_palavras) > 6 THEN RETURN false; END IF;
  FOREACH v_palavra IN ARRAY v_palavras LOOP
    -- só letras, com apóstrofo ou hífen no meio; nada de ponto, dígito, arroba, barra ou emoji
    IF v_palavra !~ '^[A-Za-zÀ-ÖØ-öø-ÿ]+([''’-][A-Za-zÀ-ÖØ-öø-ÿ]+)*$' THEN RETURN false; END IF;
    v_plano := public._triagem_texto_plano(v_palavra);
    IF v_plano = ANY (v_conectores) THEN CONTINUE; END IF;
    v_letras := char_length(regexp_replace(v_palavra, '[''’-]', '', 'g'));
    IF v_letras < 2 OR v_letras > 20 THEN RETURN false; END IF;
    v_principais := v_principais + 1;
    IF v_primeiro_principal IS NULL THEN v_primeiro_principal := v_palavra; END IF;
  END LOOP;
  IF v_principais = 0 OR v_principais > 4 THEN RETURN false; END IF;
  IF public._triagem_texto_plano(v_palavras[1]) = ANY (v_conectores)
     OR public._triagem_texto_plano(v_palavras[cardinality(v_palavras)]) = ANY (v_conectores) THEN
    RETURN false;
  END IF;
  IF char_length(regexp_replace(v_primeiro_principal, '[''’-]', '', 'g')) > 15 THEN RETURN false; END IF;
  v_norm := public._triagem_normalizar_frase(v_nome);
  IF v_norm = '' THEN RETURN false; END IF;
  -- nunca nome: qualquer coisa que o quadro entenda (sim, ok, obrigado, quero orçamento, parceiro, robô...)
  IF EXISTS (
       SELECT 1 FROM public.whatsapp_triagem_respostas r
        WHERE r.ativo
          AND ((r.casamento = 'igual' AND v_norm = r.frase)
               OR (r.casamento = 'comeca' AND (v_norm = r.frase OR v_norm LIKE r.frase || ' %'))
               OR (r.casamento = 'contem' AND position(' ' || r.frase || ' ' IN ' ' || v_norm || ' ') > 0))) THEN
    RETURN false;
  END IF;
  -- nunca nome: termo proibido do ramo cliente, de dinheiro ou palavrão
  FOR t IN SELECT tipo, termo, sobre FROM public.whatsapp_triagem_termos_proibidos
            WHERE ativo AND ramo IN ('todos', 'cliente', 'nome') LOOP
    IF t.tipo = 'trecho' THEN
      IF position(t.termo IN v_norm) > 0 THEN RETURN false; END IF;
    ELSIF t.sobre = 'bruto' THEN
      IF lower(v_nome) ~ t.termo THEN RETURN false; END IF;
    ELSIF public._triagem_texto_plano(v_nome) ~ t.termo THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
END $function$;

-- Códigos de etapa e nomes de variáveis que vão para o detalhe de um evento: só o que casa com o formato, nunca valor.
CREATE OR REPLACE FUNCTION public._triagem_lista_limpa(p_lista jsonb, p_formato text)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'public'
AS $function$
  SELECT coalesce(jsonb_agg(x ORDER BY ord), '[]'::jsonb)
    FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(p_lista) = 'array' THEN p_lista ELSE '[]'::jsonb END)
         WITH ORDINALITY AS e(x, ord)
   WHERE x ~ p_formato AND ord <= 20
$function$;

-- Gente na conversa: responsável, atribuição, modo humano, arquivada, ou qualquer saída que não seja robô.
CREATE OR REPLACE FUNCTION public._triagem_humano_na_conversa(p_conversa uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.whatsapp_conversas c
     WHERE c.id = p_conversa
       AND (c.responsavel_id IS NOT NULL OR c.atribuido_para IS NOT NULL OR c.modo = 'humano' OR c.status = 'arquivada'
            OR EXISTS (SELECT 1 FROM public.whatsapp_mensagens m
                        WHERE m.conversa_id = c.id AND m.direcao = 'saida'
                          AND coalesce(m.origem, 'humano') NOT IN ('automacao', 'ia'))))
$function$;

-- Depois de apagar mensagens pendentes que nunca saíram, a "última mensagem" da conversa volta a ser a última que existe de
-- verdade. Só mexe na conversa cuja ultima_mensagem seja exatamente um dos textos apagados (a caixa não mostra como última
-- uma pergunta que o contato nunca recebeu). Usada pela função de cancelar uma conversa e pelos DELETE em lote.
CREATE OR REPLACE FUNCTION public._triagem_recompor_ultima(p_conversas uuid[], p_textos text[])
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  UPDATE public.whatsapp_conversas c
     SET ultima_mensagem = coalesce((SELECT left(coalesce(nullif(m.texto, ''), '[' || m.tipo::text || ']'), 500)
                                       FROM public.whatsapp_mensagens m WHERE m.conversa_id = c.id
                                      ORDER BY coalesce(m.recebido_em, m.enviado_em, m.created_at) DESC, m.created_at DESC LIMIT 1),
                                    c.ultima_mensagem),
         ultima_mensagem_at = coalesce((SELECT coalesce(m.recebido_em, m.enviado_em, m.created_at)
                                          FROM public.whatsapp_mensagens m WHERE m.conversa_id = c.id
                                         ORDER BY coalesce(m.recebido_em, m.enviado_em, m.created_at) DESC, m.created_at DESC LIMIT 1),
                                       c.ultima_mensagem_at)
   WHERE c.id = ANY (p_conversas) AND c.ultima_mensagem = ANY (p_textos)
$function$;

-- Cancela os envios da triagem que ainda não saíram (status pendente) e apaga a mensagem pendente que nunca saiu.
-- Linha 'enviando' já foi reservada pelo despachante e não é tocada. Depois de apagar, a "última mensagem" da conversa
-- volta a ser a última que existe de verdade: a caixa não mostra como última uma pergunta que o contato nunca recebeu.
CREATE OR REPLACE FUNCTION public._triagem_cancelar_pendentes(p_conversa uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_msgs uuid[];
  v_textos text[];
  v_n integer;
BEGIN
  WITH canc AS (
    UPDATE public.whatsapp_fila_envio
       SET status = 'cancelada', erro = 'cancelada pela triagem', updated_at = now()
     WHERE conversa_id = p_conversa AND status = 'pendente' AND payload ? 'triagem_id'
    RETURNING mensagem_id)
  SELECT coalesce(array_agg(mensagem_id) FILTER (WHERE mensagem_id IS NOT NULL), '{}'::uuid[]), count(*)
    INTO v_msgs, v_n FROM canc;
  IF cardinality(v_msgs) > 0 THEN
    WITH apagadas AS (
      DELETE FROM public.whatsapp_mensagens WHERE id = ANY (v_msgs) AND status = 'pendente' AND direcao = 'saida'
      RETURNING texto)
    SELECT array_agg(left(texto, 500)) INTO v_textos FROM apagadas;
    IF v_textos IS NOT NULL THEN
      PERFORM public._triagem_recompor_ultima(ARRAY[p_conversa], v_textos);
    END IF;
  END IF;
  RETURN v_n;
END $function$;

-- Pausa (ou encerra) a triagem aberta: status, cancelamento dos pendentes e evento. Quem chama já travou a conversa.
CREATE OR REPLACE FUNCTION public._triagem_pausar(p_triagem uuid, p_status public.triagem_status, p_motivo text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_conversa uuid;
  v_passo text;
BEGIN
  UPDATE public.whatsapp_triagens
     SET status = p_status, concluida_em = now(), motivo_fim = p_motivo, versao = versao + 1, atualizado_em = now()
   WHERE id = p_triagem AND status IN ('ativa', 'ensaio', 'expirada')
   RETURNING conversa_id, passo INTO v_conversa, v_passo;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  PERFORM public._triagem_cancelar_pendentes(v_conversa);
  INSERT INTO public.whatsapp_triagem_eventos (triagem_id, conversa_id, tipo, passo, detalhe)
  VALUES (p_triagem, v_conversa, 'pausa', v_passo, jsonb_build_object('motivo', p_motivo, 'status', p_status));
  RETURN true;
END $function$;

-- A triagem desta conversa ainda está em andamento? Aberta (ativa ou ensaio), ou expirada mas dentro do prazo de retomada e
-- sem gente na conversa. Só lê. Quem chama já travou a conversa quando precisa de consistência.
CREATE OR REPLACE FUNCTION public._triagem_em_andamento(p_conversa uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  cfg public.whatsapp_triagem_config%ROWTYPE;
  t public.whatsapp_triagens%ROWTYPE;
BEGIN
  SELECT * INTO t FROM public.whatsapp_triagens WHERE conversa_id = p_conversa;
  IF NOT FOUND THEN RETURN false; END IF;
  IF t.status IN ('ativa', 'ensaio') THEN RETURN true; END IF;
  IF t.status <> 'expirada' THEN RETURN false; END IF;
  SELECT * INTO cfg FROM public.whatsapp_triagem_config WHERE id;
  RETURN greatest(coalesce(t.ultimo_envio_em, t.iniciada_em), t.iniciada_em) > now() - cfg.retomar_ate_horas * interval '1 hour'
         AND NOT public._triagem_humano_na_conversa(p_conversa);
END $function$;

-- Desliga SÓ a configuração (uma linha), sem percorrer outras conversas. É o que triagem_aplicar pode fazer sem risco de
-- deadlock: quem estiver com triagem aberta é parado por triagem_varrer, por triagem_ler_ou_abrir ou por triagem_aplicar na
-- próxima mensagem, que já conferem a configuração. Devolve true se mudou o estado.
CREATE OR REPLACE FUNCTION public._triagem_desligar_config(p_motivo text, p_usuario uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_n integer;
BEGIN
  UPDATE public.whatsapp_triagem_config
     SET estado = 'desligada', desligada_por = left(p_motivo, 120), desligada_em = now(),
         atualizado_por = coalesce(p_usuario, atualizado_por)
   WHERE id AND estado <> 'desligada';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n > 0;
END $function$;

-- O degrau ATUAL da escada permite que esta conversa continue com envio real? Descer a escada (ligada para parcial ou teste,
-- ou para ensaio) precisa valer também para a triagem que já estava em curso, não só para conversa nova:
--   desligada  nunca;
--   triagem em modo ensaio  sim (ela só anota, nada sai de verdade);
--   estado ensaio  não (triagem de modo real não envia nada no ensaio);
--   teste      só número de teste;
--   parcial    número de teste, ou sorteio da conversa dentro do percentual atual;
--   ligada     sim.
-- Só lê. Quem chama decide o que fazer com o não (pausada_desligada, motivo fora_do_degrau).
CREATE OR REPLACE FUNCTION public._triagem_degrau_permite(p_conversa uuid, p_modo text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  cfg public.whatsapp_triagem_config%ROWTYPE;
  v_tel text;
  v_teste boolean;
BEGIN
  SELECT * INTO cfg FROM public.whatsapp_triagem_config WHERE id;
  IF cfg.estado = 'desligada' THEN RETURN false; END IF;
  IF p_modo = 'ensaio' THEN RETURN true; END IF;
  IF cfg.estado = 'ensaio' THEN RETURN false; END IF;
  IF cfg.estado = 'ligada' THEN RETURN true; END IF;
  SELECT telefone_normalizado INTO v_tel FROM public.whatsapp_conversas WHERE id = p_conversa;
  v_teste := v_tel IS NOT NULL AND v_tel = ANY (cfg.numeros_teste);
  IF cfg.estado = 'teste' THEN RETURN v_teste; END IF;
  RETURN v_teste OR public._triagem_sorteio(p_conversa) < cfg.percentual;
END $function$;

-- 6. triagem_enviar: a única porta de saída da triagem. Mesma fila e mesmo consumidor da assistente. -------------------
CREATE OR REPLACE FUNCTION public.triagem_enviar(
  p_triagem_id uuid, p_texto text, p_chave text, p_atraso_s integer, p_passo text, p_ordem integer, p_codigos text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  t public.whatsapp_triagens%ROWTYPE;
  c public.whatsapp_conversas%ROWTYPE;
  cfg public.whatsapp_triagem_config%ROWTYPE;
  v_texto text := btrim(coalesce(p_texto, ''));
  v_problemas text[];
  v_existente record;
  v_ja integer;
  v_msg uuid;
  v_fila uuid;
  v_atraso integer;
BEGIN
  SELECT * INTO t FROM public.whatsapp_triagens WHERE id = p_triagem_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Triagem não encontrada.'; END IF;
  -- ordem de travas de sempre: advisory, conversa, triagem (quando vem de triagem_aplicar o advisory já é nosso)
  PERFORM pg_advisory_xact_lock(hashtextextended('triagem:' || t.conversa_id::text, 0));
  SELECT * INTO c FROM public.whatsapp_conversas WHERE id = t.conversa_id FOR UPDATE;
  SELECT * INTO t FROM public.whatsapp_triagens WHERE id = p_triagem_id FOR UPDATE;
  SELECT * INTO cfg FROM public.whatsapp_triagem_config WHERE id;

  IF p_chave IS NULL OR p_chave NOT LIKE 'triagem:' || t.id::text || ':%' THEN
    RAISE EXCEPTION 'A chave de idempotência da triagem precisa começar com triagem:<id>: (veio %).', p_chave;
  END IF;
  IF v_texto = '' THEN RAISE EXCEPTION 'Texto vazio.'; END IF;

  -- Envio idempotente: a mesma chave nunca gera segunda mensagem.
  SELECT id, status INTO v_existente FROM public.whatsapp_fila_envio WHERE idempotency_key = p_chave;
  IF FOUND THEN
    RETURN jsonb_build_object('enviado', false, 'duplicado', true, 'fila_id', v_existente.id, 'status_da_fila', v_existente.status);
  END IF;

  IF t.modo <> 'real' OR cfg.estado NOT IN ('teste', 'parcial', 'ligada') THEN
    RETURN jsonb_build_object('enviado', false, 'motivo', 'sem_envio_real', 'estado', cfg.estado);
  END IF;
  IF t.status IN ('pausada_humano', 'pausada_desligada', 'pulada') THEN
    RETURN jsonb_build_object('enviado', false, 'motivo', 'triagem_' || t.status);
  END IF;
  IF public._triagem_humano_na_conversa(c.id) THEN
    RETURN jsonb_build_object('enviado', false, 'motivo', 'humano_na_conversa');
  END IF;
  -- Descer a escada vale para a triagem em curso: o degrau ATUAL tem que permitir esta conversa. Se não permite, a triagem
  -- para (pausada_desligada, fora_do_degrau) e nada é enviado.
  IF NOT public._triagem_degrau_permite(c.id, t.modo) THEN
    PERFORM public._triagem_pausar(t.id, 'pausada_desligada', 'fora_do_degrau');
    RETURN jsonb_build_object('enviado', false, 'motivo', 'fora_do_degrau', 'estado', cfg.estado);
  END IF;

  -- Revalidação do texto JÁ MONTADO (com nome, telefone e CEP dentro) contra os termos proibidos do ramo.
  v_problemas := public._triagem_problemas_de_texto(v_texto, t.ramo, false);
  IF cardinality(v_problemas) > 0 THEN
    INSERT INTO public.whatsapp_triagem_eventos (triagem_id, conversa_id, tipo, passo, detalhe)
    VALUES (t.id, t.conversa_id, 'texto_barrado', p_passo,
            jsonb_build_object('regras', to_jsonb(v_problemas),
                               'codigos', public._triagem_lista_limpa(to_jsonb(coalesce(p_codigos, '{}'::text[])), '^[a-z][a-z0-9_]{0,40}$'),
                               'ordem', p_ordem));
    RETURN jsonb_build_object('enviado', false, 'motivo', 'texto_barrado', 'regras', to_jsonb(v_problemas));
  END IF;

  -- Teto: conta TODA saída automática da conversa, a da triagem e as de fora (aviso de pedido, cobrança). A pergunta da
  -- triagem que ainda não saiu NÃO conta: ela vai ser substituída por esta, e contar contra si mesma travaria uma vaga.
  SELECT count(*) INTO v_ja FROM public.whatsapp_mensagens m
   WHERE m.conversa_id = c.id AND m.direcao = 'saida' AND m.origem = 'automacao'
     AND NOT (m.status = 'pendente' AND m.payload ? 'triagem'
              AND EXISTS (SELECT 1 FROM public.whatsapp_fila_envio f WHERE f.mensagem_id = m.id AND f.status = 'pendente'));
  IF v_ja >= cfg.max_mensagens THEN
    INSERT INTO public.whatsapp_triagem_eventos (triagem_id, conversa_id, tipo, passo, detalhe)
    VALUES (t.id, t.conversa_id, 'pulou', p_passo, jsonb_build_object('motivo', 'teto_de_mensagens', 'automaticas', v_ja, 'teto', cfg.max_mensagens));
    RETURN jsonb_build_object('enviado', false, 'motivo', 'teto_de_mensagens');
  END IF;

  -- A pergunta nova substitui a que ainda não saiu.
  PERFORM public._triagem_cancelar_pendentes(c.id);

  v_atraso := least(15, greatest(1, coalesce(p_atraso_s, cfg.atraso_min_s)));
  INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, direcao, tipo, status, texto, cliente_id, os_id, enviada_por, origem, payload)
  VALUES (c.id, c.instancia_id, 'saida', 'texto', 'pendente', left(v_texto, 4096), c.cliente_id, c.os_id, NULL, 'automacao',
          jsonb_build_object('triagem', jsonb_build_object('id', t.id, 'passo', p_passo, 'ordem', p_ordem, 'ramo', t.ramo,
                                                          'codigos', public._triagem_lista_limpa(to_jsonb(coalesce(p_codigos, '{}'::text[])), '^[a-z][a-z0-9_]{0,40}$'))))
  RETURNING id INTO v_msg;
  INSERT INTO public.whatsapp_fila_envio (conversa_id, mensagem_id, payload, status, idempotency_key)
  VALUES (c.id, v_msg,
          jsonb_build_object('tipo', 'texto', 'texto', left(v_texto, 4096), 'atraso_s', v_atraso, 'triagem_id', t.id, 'passo', p_passo),
          'pendente', p_chave)
  RETURNING id INTO v_fila;
  UPDATE public.whatsapp_conversas SET ultima_mensagem = left(v_texto, 500), ultima_mensagem_at = now() WHERE id = c.id;
  UPDATE public.whatsapp_triagens
     SET ultimo_envio_em = now(), ultima_pergunta_em = now(), ultima_pergunta_mensagem_id = v_msg, atualizado_em = now()
   WHERE id = t.id;
  INSERT INTO public.whatsapp_triagem_eventos (triagem_id, conversa_id, mensagem_id, tipo, passo, detalhe)
  VALUES (t.id, t.conversa_id, v_msg, 'envio_enfileirado', p_passo,
          jsonb_build_object('ordem', p_ordem, 'atraso_s', v_atraso,
                             'codigos', public._triagem_lista_limpa(to_jsonb(coalesce(p_codigos, '{}'::text[])), '^[a-z][a-z0-9_]{0,40}$')));
  RETURN jsonb_build_object('enviado', true, 'mensagem_id', v_msg, 'fila_id', v_fila, 'atraso_s', v_atraso);
END $function$;

-- 7. triagem_dono_da_conversa: a única fonte de "quem responde". Só lê. -----------------------------------------------
--   triagem   a triagem de boas-vindas responde (aberta, modo real)
--   assistente a assistente de IA responde, se estiver ligada (sem triagem, triagem em ENSAIO, triagem concluída com
--              agente_apos_triagem, ou pausada por gente que depois devolveu a conversa à IA)
--   ninguem   ninguém automático responde (pausada, pulada, encerrada, robô, grupo, bloqueado, conversa inexistente). Grupo,
--              bloqueado e robô de empresa dão ninguem TAMBÉM quando a conversa não tem linha de triagem (a triagem desligada,
--              por exemplo): o robô da empresa é reconhecido pela PRIMEIRA mensagem de pessoa da conversa, a mesma regra de
--              _triagem_parece_robo que o portão usa.
-- O ENSAIO NÃO É DONO: a triagem em ensaio só anota o que faria; se a assistente estiver ligada, ela segue respondendo,
-- senão o contato ficaria sem resposta durante os dias de ensaio.
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

-- 8. triagem_ler_ou_abrir: trava a conversa, aplica o portão, cria ou lê a triagem e devolve o instantâneo ---------------
-- O que o servidor faz com a resposta:
--   dono = 'triagem'                 interpreta a mensagem e chama triagem_aplicar (envia de verdade)
--   dono = 'assistente' e ensaio     interpreta e chama triagem_aplicar (só anota o que faria, nada sai); quem responde
--                                    de verdade é a assistente, se estiver ligada
--   qualquer outro                   não interpreta
--   pendentes                        mensagens de entrada dos 20 s anteriores ainda sem evento: o servidor junta com a
--                                    atual e devolve todas os ids em mensagens_ids de triagem_aplicar
CREATE OR REPLACE FUNCTION public.triagem_ler_ou_abrir(p_conversa_id uuid, p_mensagem_id uuid, p_contexto jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  cfg public.whatsapp_triagem_config%ROWTYPE;
  c public.whatsapp_conversas%ROWTYPE;
  m public.whatsapp_mensagens%ROWTYPE;
  t public.whatsapp_triagens%ROWTYPE;
  l public.leads%ROWTYPE;
  a public.whatsapp_atendimentos%ROWTYPE;
  v_tem_triagem boolean;
  v_msg_ok boolean := false;
  v_motivo text;
  v_dono text;
  v_teste boolean;
  v_modo text;
  v_robo text;
  v_ensaio boolean;
  v_ctx jsonb := coalesce(p_contexto, '{}'::jsonb);
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('triagem:' || p_conversa_id::text, 0));
  SELECT * INTO c FROM public.whatsapp_conversas WHERE id = p_conversa_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('dono', 'ninguem', 'motivo', 'conversa_inexistente');
  END IF;
  SELECT * INTO cfg FROM public.whatsapp_triagem_config WHERE id;
  SELECT * INTO m FROM public.whatsapp_mensagens WHERE id = p_mensagem_id AND conversa_id = p_conversa_id;
  v_msg_ok := FOUND AND m.direcao = 'entrada' AND coalesce(m.origem, 'humano') <> 'automacao' AND m.tipo <> 'sistema';
  SELECT * INTO t FROM public.whatsapp_triagens WHERE conversa_id = p_conversa_id FOR UPDATE;
  v_tem_triagem := FOUND;

  IF v_tem_triagem THEN
    IF t.status IN ('ativa', 'ensaio', 'expirada') THEN
      -- pausa se gente apareceu na conversa depois de a triagem abrir (a corrida que o gatilho não pegou)
      IF public._triagem_humano_na_conversa(c.id) THEN
        PERFORM public._triagem_pausar(t.id, 'pausada_humano', 'humano_na_conversa');
        RETURN jsonb_build_object('dono', 'ninguem', 'motivo', 'humano_na_conversa', 'triagem_id', t.id, 'status', 'pausada_humano');
      END IF;
      IF cfg.estado = 'desligada' THEN
        PERFORM public._triagem_pausar(t.id, 'pausada_desligada', 'desligada');
        RETURN jsonb_build_object('dono', 'ninguem', 'motivo', 'desligada', 'triagem_id', t.id, 'status', 'pausada_desligada');
      END IF;
      -- descer a escada vale para a triagem em curso: o degrau atual tem que permitir ESTA conversa
      IF NOT public._triagem_degrau_permite(c.id, t.modo) THEN
        PERFORM public._triagem_pausar(t.id, 'pausada_desligada', 'fora_do_degrau');
        RETURN jsonb_build_object('dono', 'ninguem', 'motivo', 'fora_do_degrau', 'triagem_id', t.id, 'status', 'pausada_desligada');
      END IF;
      -- o portão vale o fluxo inteiro, não só a abertura: cliente vinculado no meio, bloqueio manual novo, cliente que a
      -- busca larga agora reconhece
      IF c.cliente_id IS NOT NULL THEN
        v_motivo := 'cliente_vinculado';
      ELSIF public._triagem_bloqueado(c.id) THEN
        v_motivo := 'bloqueado';
      ELSIF public._triagem_conhecido(c.id) IS NOT NULL THEN
        v_motivo := 'cliente_conhecido';
      END IF;
      IF v_motivo IS NOT NULL THEN
        PERFORM public._triagem_pausar(t.id, 'pulada', v_motivo);
        RETURN jsonb_build_object('dono', 'ninguem', 'motivo', v_motivo, 'triagem_id', t.id, 'status', 'pulada');
      END IF;
    END IF;
    SELECT * INTO t FROM public.whatsapp_triagens WHERE id = t.id;
    IF NOT public._triagem_em_andamento(c.id) THEN
      RETURN jsonb_build_object('dono', public.triagem_dono_da_conversa(c.id), 'motivo', 'triagem_' || t.status,
                                'triagem_id', t.id, 'status', t.status);
    END IF;
    IF NOT v_msg_ok THEN
      RETURN jsonb_build_object('dono', 'ninguem', 'motivo', 'nao_e_pessoa', 'triagem_id', t.id, 'status', t.status);
    END IF;
    -- a mesma mensagem, ou uma mais antiga que outra já processada (a corrida de dois webhooks seguidos): não interpreta de novo
    IF EXISTS (SELECT 1 FROM public.whatsapp_triagem_eventos e WHERE e.triagem_id = t.id AND e.mensagem_id = m.id AND e.tipo = 'entrada')
       OR EXISTS (SELECT 1 FROM public.whatsapp_triagem_eventos e JOIN public.whatsapp_mensagens m3 ON m3.id = e.mensagem_id
                   WHERE e.triagem_id = t.id AND e.tipo = 'entrada' AND m3.created_at > m.created_at) THEN
      RETURN jsonb_build_object('dono', 'ninguem', 'motivo', 'entrada_repetida', 'triagem_id', t.id, 'status', t.status);
    END IF;
  ELSE
    -- Portão de abertura: o primeiro motivo que falhar manda, na ordem da seção 1.2 do projeto com as correções das críticas.
    v_teste := c.telefone_normalizado IS NOT NULL AND c.telefone_normalizado = ANY (cfg.numeros_teste);
    v_dono := 'assistente';
    IF cfg.estado = 'desligada' THEN
      RETURN jsonb_build_object('dono', 'assistente', 'motivo', 'desligada');
    ELSIF cfg.vale_a_partir_de IS NULL OR c.created_at < cfg.vale_a_partir_de THEN
      v_motivo := 'antes_da_data';
    ELSIF NOT v_msg_ok THEN
      v_motivo := 'nao_e_pessoa';
    ELSIF coalesce((v_ctx ->> 'eh_grupo')::boolean, false) OR c.telefone ~* '(-group|@g\.us)' THEN
      v_motivo := 'grupo'; v_dono := 'ninguem';
    ELSIF public._wa_telefone_da_equipe(c.telefone_normalizado) AND NOT (cfg.estado = 'teste' AND v_teste) THEN
      -- a exclusão da equipe só é ignorada no degrau de teste e só para número de teste, nunca por padrão
      v_motivo := 'equipe';
    ELSIF c.cliente_id IS NOT NULL THEN
      v_motivo := 'cliente_vinculado';
    ELSIF c.responsavel_id IS NOT NULL OR c.atribuido_para IS NOT NULL THEN
      v_motivo := 'tem_responsavel';
    ELSIF c.status = 'arquivada' THEN
      v_motivo := 'arquivada';
    ELSIF c.modo = 'humano' THEN
      v_motivo := 'modo_humano';
    ELSIF EXISTS (SELECT 1 FROM public.whatsapp_atendimentos x
                   WHERE x.conversa_id = c.id AND (x.fechado_em IS NOT NULL OR x.reaberto_de IS NOT NULL)) THEN
      -- A mensagem que acabou de chegar já reabriu a conversa (whatsapp_registrar_mensagem e _wa_abrir_atendimento tiraram o
      -- responsável e puseram modo auto ANTES desta função), então os testes de responsável, arquivada e modo humano acima
      -- não enxergam mais o que a equipe tinha feito. O atendimento anterior fechado ou o reaberto_de dizem a verdade:
      -- gente já cuidou desta conversa (resolvida, arquivada, spam, duplicada).
      v_motivo := 'ja_atendida';
    ELSIF EXISTS (SELECT 1 FROM public.whatsapp_mensagens s WHERE s.conversa_id = c.id AND s.direcao = 'saida') THEN
      -- qualquer saída anterior: gente, celular, assistente, aviso de pedido ou cobrança
      v_motivo := 'ja_atendida';
    ELSIF public._triagem_conhecido(c.id) IS NOT NULL THEN
      v_motivo := 'cliente_conhecido';
    ELSIF public._triagem_bloqueado(c.id) THEN
      v_motivo := 'bloqueado'; v_dono := 'ninguem';
    ELSE
      v_robo := public._triagem_parece_robo(m.texto);
      IF v_robo IS NOT NULL THEN
        -- robô de empresa: nem a triagem nem a assistente respondem (a assistente também entraria em laço com ele)
        v_motivo := 'robo'; v_dono := 'ninguem';
      ELSIF cfg.estado = 'teste' AND NOT v_teste THEN
        v_motivo := 'fora_dos_numeros_de_teste';
      ELSIF cfg.estado = 'parcial' AND NOT v_teste AND public._triagem_sorteio(c.id) >= cfg.percentual THEN
        v_motivo := 'fora_do_sorteio';
      ELSIF (SELECT count(*) FROM public.whatsapp_triagens x WHERE x.iniciada_em > now() - interval '1 hour') >= cfg.max_novas_por_hora
         OR (SELECT count(*) FROM public.whatsapp_triagens x WHERE x.iniciada_em > now() - interval '1 day') >= cfg.max_novas_por_dia THEN
        v_motivo := 'freio_de_volume';
      END IF;
    END IF;

    IF v_motivo IS NOT NULL THEN
      -- Só o ensaio registra a recusa (uma vez por conversa, motivo e hora); fora dele nada é gravado.
      IF cfg.estado = 'ensaio' AND NOT EXISTS (
           SELECT 1 FROM public.whatsapp_triagem_eventos e
            WHERE e.conversa_id = c.id AND e.tipo = 'gate' AND e.detalhe ->> 'motivo' = v_motivo
              AND e.criado_em > now() - interval '1 hour') THEN
        INSERT INTO public.whatsapp_triagem_eventos (conversa_id, mensagem_id, tipo, detalhe)
        VALUES (c.id, CASE WHEN v_msg_ok THEN m.id END, 'gate',
                jsonb_build_object('motivo', v_motivo, 'sinal_de_robo', v_robo));
      END IF;
      RETURN jsonb_build_object('dono', v_dono, 'motivo', v_motivo);
    END IF;

    v_modo := CASE WHEN cfg.estado = 'ensaio' THEN 'ensaio' ELSE 'real' END;
    SELECT * INTO a FROM public.whatsapp_atendimentos WHERE id = c.atendimento_ativo_id;
    INSERT INTO public.whatsapp_triagens (conversa_id, lead_id, atendimento_id, modo, status, telefone_chat, origem_anuncio, primeira_mensagem_id)
    VALUES (c.id, c.lead_id, c.atendimento_ativo_id, v_modo,
            CASE WHEN v_modo = 'ensaio' THEN 'ensaio'::public.triagem_status ELSE 'ativa'::public.triagem_status END,
            c.telefone_normalizado,
            CASE WHEN a.anuncio_id IS NOT NULL
                 THEN jsonb_build_object('canal', a.origem_canal, 'tipo', a.tipo_contato, 'anuncio_id', a.anuncio_id) END,
            m.id)
    RETURNING * INTO t;
  END IF;

  v_ensaio := t.modo = 'ensaio' OR cfg.estado = 'ensaio';
  -- Instantâneo para o servidor interpretar a mensagem. Nada com texto de mensagem, só o que a máquina precisa.
  IF c.lead_id IS NOT NULL THEN
    SELECT * INTO l FROM public.leads WHERE id = c.lead_id;
  END IF;
  RETURN jsonb_build_object(
    -- ensaio NÃO é dono: a triagem interpreta e anota, mas quem responde de verdade é a assistente (se ligada)
    'dono', CASE WHEN v_ensaio THEN 'assistente' ELSE 'triagem' END,
    'ensaio', v_ensaio,
    'motivo', NULL,
    'triagem', to_jsonb(t),
    'config', to_jsonb(cfg),
    'conversa', jsonb_build_object(
      'id', c.id,
      'criada_em', c.created_at,
      'telefone_normalizado', c.telefone_normalizado,
      'telefone_valido_br', coalesce(c.telefone_normalizado ~ '^[1-9][0-9]9[0-9]{8}$', false),
      'tem_chat_lid', c.chat_lid IS NOT NULL,
      'atendimento_id', c.atendimento_ativo_id),
    'lead', CASE WHEN l.id IS NOT NULL THEN jsonb_build_object('id', l.id, 'tipo', l.tipo, 'tipo_origem', l.tipo_origem) END,
    'passos', CASE WHEN coalesce((v_ctx ->> 'sem_catalogo')::boolean, false) THEN NULL ELSE
      (SELECT coalesce(jsonb_agg(jsonb_build_object('codigo', p.codigo, 'ramo', p.ramo, 'ordem', p.ordem, 'texto', p.texto,
                                                    'variantes', to_jsonb(p.variantes), 'repeticao', p.repeticao,
                                                    'versao', p.versao, 'ativo', p.ativo) ORDER BY p.ramo, p.ordem), '[]'::jsonb)
         FROM public.whatsapp_triagem_passos p WHERE p.ativo) END,
    'quadro', CASE WHEN coalesce((v_ctx ->> 'sem_catalogo')::boolean, false) THEN NULL ELSE
      (SELECT coalesce(jsonb_agg(jsonb_build_object('passo', r.passo, 'intencao', r.intencao, 'frase', r.frase,
                                                    'casamento', r.casamento)), '[]'::jsonb)
         FROM public.whatsapp_triagem_respostas r WHERE r.ativo) END,
    'horario', jsonb_build_object(
      'semana', (SELECT jsonb_agg(jsonb_build_object('diaSemana', h.dia_semana, 'abre', to_char(h.abre, 'HH24:MI'),
                                                     'fecha', to_char(h.fecha, 'HH24:MI'), 'ativo', h.ativo) ORDER BY h.dia_semana)
                   FROM public.whatsapp_horarios_atendimento h),
      'feriados', (SELECT coalesce(jsonb_agg(jsonb_build_object('data', f.data, 'fechado', f.fechado,
                                                                'abre', to_char(f.abre, 'HH24:MI'), 'fecha', to_char(f.fecha, 'HH24:MI'))), '[]'::jsonb)
                     FROM public.whatsapp_feriados f WHERE f.data >= public.hoje_br() - 1),
      'dentro', public.whatsapp_dentro_do_horario(now()),
      'texto', public.whatsapp_horario_em_texto()),
    -- mensagens de entrada dos 20 s anteriores que ainda não viraram evento: o servidor junta antes de interpretar
    'pendentes', CASE WHEN v_msg_ok THEN
      (SELECT coalesce(jsonb_agg(m2.id ORDER BY m2.created_at), '[]'::jsonb) FROM public.whatsapp_mensagens m2
        WHERE m2.conversa_id = c.id AND m2.direcao = 'entrada' AND coalesce(m2.origem, 'humano') <> 'automacao'
          AND m2.created_at < m.created_at AND m2.created_at > m.created_at - interval '20 seconds'
          AND NOT EXISTS (SELECT 1 FROM public.whatsapp_triagem_eventos e WHERE e.triagem_id = t.id AND e.mensagem_id = m2.id AND e.tipo = 'entrada'))
      ELSE '[]'::jsonb END,
    'automaticas_de_fora', (SELECT count(*) FROM public.whatsapp_mensagens s
                             WHERE s.conversa_id = c.id AND s.direcao = 'saida' AND s.origem = 'automacao' AND NOT (s.payload ? 'triagem')),
    'agora', now());
END $function$;

-- 9. triagem_aplicar: grava o resultado de um passo, na mesma transação -----------------------------------------------
-- p_resultado (todas as chaves opcionais):
--   mensagem_id uuid          a entrada que gerou este passo (vira o evento 'entrada', a trava de idempotência)
--   mensagens_ids [uuid]      as outras entradas da rajada que o servidor juntou com esta: cada uma também vira evento
--                             'entrada', então nenhuma volta como pendente nem é interpretada de novo
--   estado { status, passo, ramo, ramo_motivo, tentativas_passo, mensagens_enviadas, avisos_audio, avisos_arquivo,
--            audios, figurinhas, perguntas_de_preco, etapas_esgotadas_seguidas, ultima_entrada_hash, motivo_fim }
--   gravar { nome_informado, nome_completo, primeira_vez, cep, cep_endereco, endereco_texto, endereco_recusado,
--            telefone_confirmado, telefone_alternativo, pediu_preco, pediu_tabela_especial, pediu_equipe,
--            pediu_parceria, mandou_audio, reclamou }
--   eventos [ { tipo, passo, intencao, detalhe } ]   (só interpretada, pulou, pausa, texto_barrado, gate e erro; os
--                                                     outros tipos o banco grava sozinho e os do servidor são ignorados)
--   envio { texto, chave, atraso_s, passo, ordem, codigos[], variaveis[] }
--   aviso_grupo { motivo, marcas[] }
--   bloquear_contato boolean
--
-- Texto barrado (o texto MONTADO, com nome, telefone e CEP dentro, tem termo proibido): não envia, grava texto_barrado,
-- entrega a conversa à equipe (status entregue_equipe) e guarda o que a pessoa disse. NÃO desliga a triagem de todos por
-- causa de um contato: o freio global só dispara por contagem (3 textos barrados em 30 minutos, depois de desligada_em).
CREATE OR REPLACE FUNCTION public.triagem_aplicar(p_triagem_id uuid, p_versao integer, p_resultado jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  t public.whatsapp_triagens%ROWTYPE;
  c public.whatsapp_conversas%ROWTYPE;
  cfg public.whatsapp_triagem_config%ROWTYPE;
  v_conversa uuid;
  v_e jsonb := coalesce(p_resultado -> 'estado', '{}'::jsonb);
  v_g jsonb := coalesce(p_resultado -> 'gravar', '{}'::jsonb);
  v_envio jsonb := p_resultado -> 'envio';
  v_aviso jsonb := p_resultado -> 'aviso_grupo';
  v_msg uuid := nullif(p_resultado ->> 'mensagem_id', '')::uuid;
  v_ids uuid[];
  v_n integer;
  v_ev jsonb;
  v_status public.triagem_status;
  v_ramo public.triagem_ramo;
  v_ramo_motivo text;
  v_nome text := nullif(btrim(coalesce(v_g ->> 'nome_informado', '')), '');
  v_nome_novo text;
  v_nome_gravado boolean := false;
  v_alt text := nullif(btrim(coalesce(v_g ->> 'telefone_alternativo', '')), '');
  v_envio_res jsonb;
  v_enviou boolean := false;
  v_ensaio boolean;
  v_marcas text[];
  v_motivo_aviso text;
  v_hash_tel text;
  v_hash_lid text;
  v_portao text;
  v_prob text[];
  v_barrado boolean := false;
  v_regras jsonb;
  v_barrados integer;
  v_freio boolean := false;
  v_reabriu boolean;
  v_aviso_ja_decidido boolean;
  v_refaz_aviso boolean;
BEGIN
  SELECT conversa_id INTO v_conversa FROM public.whatsapp_triagens WHERE id = p_triagem_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Triagem não encontrada.'; END IF;
  -- ordem de travas de sempre: advisory, conversa, triagem (e só depois a configuração, se precisar)
  PERFORM pg_advisory_xact_lock(hashtextextended('triagem:' || v_conversa::text, 0));
  SELECT * INTO c FROM public.whatsapp_conversas WHERE id = v_conversa FOR UPDATE;
  SELECT * INTO t FROM public.whatsapp_triagens WHERE id = p_triagem_id FOR UPDATE;
  SELECT * INTO cfg FROM public.whatsapp_triagem_config WHERE id;

  IF t.status NOT IN ('ativa', 'ensaio', 'expirada') THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'triagem_encerrada', 'status', t.status);
  END IF;
  IF t.versao <> p_versao THEN
    RETURN jsonb_build_object('ok', false, 'conflito', true, 'versao', t.versao);
  END IF;

  -- idempotência da entrada: a mesma mensagem nunca é processada duas vezes, e uma entrada MAIS ANTIGA que outra já
  -- processada (dois webhooks seguidos, o segundo fechou primeiro) também conta como repetida
  IF v_msg IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.whatsapp_triagem_eventos e JOIN public.whatsapp_mensagens mm ON mm.id = e.mensagem_id
                WHERE e.triagem_id = t.id AND e.tipo = 'entrada'
                  AND mm.created_at > (SELECT x.created_at FROM public.whatsapp_mensagens x WHERE x.id = v_msg)) THEN
      RETURN jsonb_build_object('ok', true, 'duplicada', true, 'motivo', 'entrada_mais_antiga');
    END IF;
    INSERT INTO public.whatsapp_triagem_eventos (triagem_id, conversa_id, mensagem_id, tipo, passo)
    VALUES (t.id, t.conversa_id, v_msg, 'entrada', t.passo)
    ON CONFLICT (triagem_id, mensagem_id) WHERE tipo = 'entrada' DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n = 0 THEN
      RETURN jsonb_build_object('ok', true, 'duplicada', true, 'motivo', 'entrada_repetida');
    END IF;
    -- a rajada: as outras mensagens que o servidor juntou (só desta conversa, só de entrada, no máximo 20)
    v_ids := ARRAY(SELECT m.id FROM public.whatsapp_mensagens m
                    WHERE m.conversa_id = c.id AND m.direcao = 'entrada' AND m.id <> v_msg
                      AND m.id::text IN (SELECT x FROM jsonb_array_elements_text(
                            CASE WHEN jsonb_typeof(p_resultado -> 'mensagens_ids') = 'array' THEN p_resultado -> 'mensagens_ids' ELSE '[]'::jsonb END) AS x)
                    ORDER BY m.created_at LIMIT 20);
    IF cardinality(v_ids) > 0 THEN
      INSERT INTO public.whatsapp_triagem_eventos (triagem_id, conversa_id, mensagem_id, tipo, passo)
      SELECT t.id, t.conversa_id, i, 'entrada', t.passo FROM unnest(v_ids) AS i
      ON CONFLICT (triagem_id, mensagem_id) WHERE tipo = 'entrada' DO NOTHING;
    END IF;
  END IF;

  -- antes de interpretar e antes de enviar: gente na conversa, triagem desligada, ou o portão que mudou no meio do fluxo
  IF public._triagem_humano_na_conversa(c.id) THEN
    PERFORM public._triagem_pausar(t.id, 'pausada_humano', 'humano_na_conversa');
    RETURN jsonb_build_object('ok', true, 'pausada', 'pausada_humano');
  END IF;
  IF cfg.estado = 'desligada' THEN
    PERFORM public._triagem_pausar(t.id, 'pausada_desligada', 'desligada');
    RETURN jsonb_build_object('ok', true, 'pausada', 'pausada_desligada');
  END IF;
  -- descer a escada vale para a triagem em curso: o degrau atual tem que permitir esta conversa, senão nada é enviado
  IF NOT public._triagem_degrau_permite(c.id, t.modo) THEN
    PERFORM public._triagem_pausar(t.id, 'pausada_desligada', 'fora_do_degrau');
    RETURN jsonb_build_object('ok', true, 'pausada', 'pausada_desligada', 'motivo', 'fora_do_degrau');
  END IF;
  IF c.cliente_id IS NOT NULL THEN
    v_portao := 'cliente_vinculado';
  ELSIF public._triagem_bloqueado(c.id) THEN
    v_portao := 'bloqueado';
  END IF;
  IF v_portao IS NOT NULL THEN
    PERFORM public._triagem_pausar(t.id, 'pulada', v_portao);
    RETURN jsonb_build_object('ok', true, 'pausada', 'pulada', 'motivo', v_portao);
  END IF;

  v_ensaio := t.modo = 'ensaio' OR cfg.estado = 'ensaio';

  -- envio: o texto montado é revalidado (dentro de triagem_enviar, ou aqui no ensaio, para o ensaio medir o mesmo)
  IF v_envio IS NOT NULL AND jsonb_typeof(v_envio) = 'object' THEN
    IF v_ensaio THEN
      v_prob := CASE WHEN nullif(btrim(coalesce(v_envio ->> 'texto', '')), '') IS NOT NULL
                     THEN public._triagem_problemas_de_texto(btrim(v_envio ->> 'texto'), t.ramo, false) ELSE '{}'::text[] END;
      IF cardinality(v_prob) > 0 THEN
        v_barrado := true;
        v_regras := to_jsonb(v_prob);
        INSERT INTO public.whatsapp_triagem_eventos (triagem_id, conversa_id, mensagem_id, tipo, passo, detalhe)
        VALUES (t.id, t.conversa_id, v_msg, 'texto_barrado', coalesce(v_envio ->> 'passo', t.passo),
                jsonb_build_object('regras', v_regras, 'ensaio', true,
                                   'codigos', public._triagem_lista_limpa(v_envio -> 'codigos', '^[a-z][a-z0-9_]{0,40}$')));
      ELSE
        -- Ensaio: nada em whatsapp_mensagens nem na fila. Só o evento, com códigos e NOMES de variáveis, nunca valores.
        v_enviou := true;
        INSERT INTO public.whatsapp_triagem_eventos (triagem_id, conversa_id, tipo, passo, detalhe)
        VALUES (t.id, t.conversa_id, 'envio_ensaio', coalesce(v_envio ->> 'passo', t.passo),
                jsonb_build_object('ordem', (v_envio ->> 'ordem')::integer, 'atraso_s', (v_envio ->> 'atraso_s')::integer,
                                   'codigos', public._triagem_lista_limpa(v_envio -> 'codigos', '^[a-z][a-z0-9_]{0,40}$'),
                                   'variaveis', public._triagem_lista_limpa(v_envio -> 'variaveis', '^[a-z_]{1,40}$'),
                                   'ramo', t.ramo));
      END IF;
    ELSE
      v_envio_res := public.triagem_enviar(
        t.id, v_envio ->> 'texto', v_envio ->> 'chave', (v_envio ->> 'atraso_s')::integer,
        coalesce(v_envio ->> 'passo', t.passo), (v_envio ->> 'ordem')::integer,
        ARRAY(SELECT jsonb_array_elements_text(coalesce(v_envio -> 'codigos', '[]'::jsonb))));
      IF v_envio_res ->> 'motivo' = 'texto_barrado' THEN
        v_barrado := true;
        v_regras := v_envio_res -> 'regras';
      END IF;
      v_enviou := coalesce((v_envio_res ->> 'enviado')::boolean, false);
      IF v_envio_res ->> 'motivo' = 'humano_na_conversa' THEN
        PERFORM public._triagem_pausar(t.id, 'pausada_humano', 'humano_na_conversa');
        RETURN jsonb_build_object('ok', true, 'pausada', 'pausada_humano');
      END IF;
      IF v_envio_res ->> 'motivo' = 'fora_do_degrau' THEN
        -- triagem_enviar já pausou; o estado e os dados do passo não são gravados em triagem encerrada
        RETURN jsonb_build_object('ok', true, 'pausada', 'pausada_desligada', 'motivo', 'fora_do_degrau');
      END IF;
    END IF;
  END IF;

  -- estado: o ramo só sobe, e o status segue o modo
  v_ramo := CASE WHEN t.ramo = 'parceiro' THEN 'parceiro'::public.triagem_ramo
                 ELSE coalesce(nullif(v_e ->> 'ramo', '')::public.triagem_ramo, t.ramo) END;
  v_ramo_motivo := CASE WHEN v_ramo <> t.ramo OR t.mensagens_enviadas = 0
                        THEN coalesce(nullif(v_e ->> 'ramo_motivo', ''), t.ramo_motivo) ELSE t.ramo_motivo END;
  v_status := coalesce(nullif(v_e ->> 'status', '')::public.triagem_status, t.status);
  IF t.modo = 'ensaio' AND v_status = 'ativa' THEN v_status := 'ensaio'; END IF;
  IF t.modo = 'real' AND v_status = 'ensaio' THEN v_status := 'ativa'; END IF;
  IF v_barrado THEN v_status := 'entregue_equipe'; END IF;
  -- retomada: uma triagem expirada que volta a andar. O aviso que a expiração decidiu é refeito, para a equipe saber como a
  -- conversa terminou de verdade: se o primeiro já saiu, o novo sai como segundo aviso (outra chave, no máximo 3 por triagem).
  v_reabriu := t.status = 'expirada' AND v_status IN ('ativa', 'ensaio');
  v_refaz_aviso := v_reabriu AND t.aviso_grupo_decidido AND t.aviso_grupo_motivo = 'expirada' AND t.aviso_grupo_rodada < 3;
  v_aviso_ja_decidido := t.aviso_grupo_decidido AND NOT v_refaz_aviso;

  -- nome: escrita única, com validação forte. Exceção: completar o sobrenome dentro da própria etapa sobrenome.
  IF v_nome IS NOT NULL THEN
    IF t.nome_informado IS NULL THEN
      IF public._triagem_nome_valido(v_nome) THEN
        v_nome_novo := v_nome; v_nome_gravado := true;
      ELSE
        INSERT INTO public.whatsapp_triagem_eventos (triagem_id, conversa_id, tipo, passo, detalhe)
        VALUES (t.id, t.conversa_id, 'nome_nao_gravado', t.passo, jsonb_build_object('motivo', 'nome_invalido'));
      END IF;
    ELSIF t.passo = 'sobrenome' AND NOT t.nome_completo
          AND lower(v_nome) LIKE lower(split_part(t.nome_informado, ' ', 1)) || ' %' THEN
      IF public._triagem_nome_valido(v_nome) THEN
        v_nome_novo := v_nome; v_nome_gravado := true;
      ELSE
        INSERT INTO public.whatsapp_triagem_eventos (triagem_id, conversa_id, tipo, passo, detalhe)
        VALUES (t.id, t.conversa_id, 'nome_nao_gravado', t.passo, jsonb_build_object('motivo', 'sobrenome_invalido'));
      END IF;
    END IF;
  END IF;

  UPDATE public.whatsapp_triagens SET
    ramo = v_ramo,
    ramo_motivo = v_ramo_motivo,
    status = v_status,
    passo = CASE WHEN v_e ? 'passo' THEN nullif(v_e ->> 'passo', '') ELSE passo END,
    tentativas_passo = coalesce((v_e ->> 'tentativas_passo')::integer, tentativas_passo),
    mensagens_enviadas = CASE WHEN v_enviou AND NOT v_ensaio
                              THEN greatest(coalesce((v_e ->> 'mensagens_enviadas')::integer, mensagens_enviadas), mensagens_enviadas + 1)
                              ELSE coalesce((v_e ->> 'mensagens_enviadas')::integer, mensagens_enviadas) END,
    avisos_audio = coalesce((v_e ->> 'avisos_audio')::integer, avisos_audio),
    avisos_arquivo = coalesce((v_e ->> 'avisos_arquivo')::integer, avisos_arquivo),
    audios = coalesce((v_e ->> 'audios')::integer, audios),
    figurinhas = coalesce((v_e ->> 'figurinhas')::integer, figurinhas),
    perguntas_de_preco = coalesce((v_e ->> 'perguntas_de_preco')::integer, perguntas_de_preco),
    etapas_esgotadas_seguidas = coalesce((v_e ->> 'etapas_esgotadas_seguidas')::integer, etapas_esgotadas_seguidas),
    ultima_entrada_hash = CASE WHEN v_e ? 'ultima_entrada_hash' THEN nullif(v_e ->> 'ultima_entrada_hash', '') ELSE ultima_entrada_hash END,
    -- o ensaio também grava o relógio do envio (o real já gravou em triagem_enviar), para ele exercitar o tempo de verdade:
    -- reabertura, resposta rápida demais e pronto para responder
    ultimo_envio_em = CASE WHEN v_enviou AND v_ensaio THEN now() ELSE ultimo_envio_em END,
    ultima_pergunta_em = CASE WHEN v_enviou AND v_ensaio THEN now() ELSE ultima_pergunta_em END,
    -- fim: motivo e hora só enquanto terminou; ao voltar a andar (retomada) os dois são limpos
    motivo_fim = CASE WHEN v_barrado THEN 'texto_barrado'
                      WHEN v_status IN ('ativa', 'ensaio') THEN NULL
                      WHEN v_status = 'expirada' THEN motivo_fim
                      ELSE coalesce(nullif(v_e ->> 'motivo_fim', ''), motivo_fim, 'fim_do_fluxo') END,
    concluida_em = CASE WHEN v_status IN ('ativa', 'ensaio') THEN NULL
                        WHEN v_status <> 'expirada' THEN coalesce(concluida_em, now())
                        ELSE concluida_em END,
    aviso_grupo_decidido = CASE WHEN v_refaz_aviso THEN false ELSE aviso_grupo_decidido END,
    aviso_grupo_motivo = CASE WHEN v_refaz_aviso THEN NULL ELSE aviso_grupo_motivo END,
    aviso_grupo_marcas = CASE WHEN v_refaz_aviso THEN '{}'::text[] ELSE aviso_grupo_marcas END,
    aviso_grupo_enviado_em = CASE WHEN v_refaz_aviso THEN NULL ELSE aviso_grupo_enviado_em END,
    aviso_grupo_rodada = CASE WHEN v_refaz_aviso AND t.aviso_grupo_enviado_em IS NOT NULL AND t.modo = 'real'
                              THEN aviso_grupo_rodada + 1 ELSE aviso_grupo_rodada END,
    -- campos de escrita ÚNICA: só entram se estavam vazios
    nome_informado = CASE WHEN v_nome_gravado THEN v_nome_novo ELSE nome_informado END,
    nome_completo = nome_completo OR (v_nome_gravado AND coalesce((v_g ->> 'nome_completo')::boolean, false)),
    primeira_vez = CASE WHEN primeira_vez IS NULL AND v_g ->> 'primeira_vez' IN ('sim', 'nao', 'ja_cliente', 'nao_sei')
                        THEN v_g ->> 'primeira_vez' ELSE primeira_vez END,
    cep = CASE WHEN cep IS NULL AND v_g ->> 'cep' ~ '^\d{8}$' THEN v_g ->> 'cep' ELSE cep END,
    cep_endereco = CASE WHEN cep_endereco IS NULL AND jsonb_typeof(v_g -> 'cep_endereco') = 'object' THEN v_g -> 'cep_endereco' ELSE cep_endereco END,
    endereco_texto = CASE WHEN endereco_texto IS NULL THEN left(nullif(btrim(coalesce(v_g ->> 'endereco_texto', '')), ''), 300) ELSE endereco_texto END,
    -- telefone: 'pendente' pode virar sim ou alternativo; o contrário nunca
    telefone_confirmado = CASE WHEN (telefone_confirmado IS NULL OR telefone_confirmado = 'pendente')
                                    AND v_g ->> 'telefone_confirmado' IN ('sim', 'alternativo', 'pendente')
                               THEN v_g ->> 'telefone_confirmado' ELSE telefone_confirmado END,
    -- alternativo: escrita única, trocável só dentro da própria etapa telefone_novo; NUNCA marcado como verificado aqui
    telefone_alternativo = CASE WHEN v_alt ~ '^\d{10,11}$' AND (telefone_alternativo IS NULL OR t.passo = 'telefone_novo')
                                THEN v_alt ELSE telefone_alternativo END,
    -- marcas que só sobem
    endereco_recusado = endereco_recusado OR coalesce((v_g ->> 'endereco_recusado')::boolean, false),
    pediu_preco = pediu_preco OR coalesce((v_g ->> 'pediu_preco')::boolean, false),
    pediu_tabela_especial = pediu_tabela_especial OR coalesce((v_g ->> 'pediu_tabela_especial')::boolean, false),
    pediu_equipe = pediu_equipe OR coalesce((v_g ->> 'pediu_equipe')::boolean, false),
    pediu_parceria = pediu_parceria OR coalesce((v_g ->> 'pediu_parceria')::boolean, false),
    mandou_audio = mandou_audio OR coalesce((v_g ->> 'mandou_audio')::boolean, false),
    reclamou = reclamou OR coalesce((v_g ->> 'reclamou')::boolean, false),
    ultima_entrada_id = coalesce(v_msg, ultima_entrada_id),
    ultima_entrada_em = CASE WHEN v_msg IS NOT NULL
                             THEN coalesce((SELECT coalesce(recebido_em, created_at) FROM public.whatsapp_mensagens WHERE id = v_msg), now())
                             ELSE ultima_entrada_em END,
    versao = versao + 1,
    atualizado_em = now()
  WHERE id = t.id;

  -- texto barrado: a pergunta anterior que ainda não saiu também não vai (a equipe assume)
  IF v_barrado THEN
    PERFORM public._triagem_cancelar_pendentes(c.id);
  END IF;

  -- eventos da máquina. Os tipos que o banco grava sozinho (entrada, envios, aviso_grupo, nome_nao_gravado, expirou, freio)
  -- são ignorados aqui: gravar de novo duplicaria. Um evento recusado pelos CHECKs vira evento 'erro', não derruba o passo.
  FOR v_ev IN SELECT * FROM jsonb_array_elements(coalesce(p_resultado -> 'eventos', '[]'::jsonb)) LOOP
    IF v_ev ->> 'tipo' IN ('interpretada', 'pulou', 'pausa', 'texto_barrado', 'gate', 'erro') THEN
      BEGIN
        INSERT INTO public.whatsapp_triagem_eventos (triagem_id, conversa_id, mensagem_id, tipo, passo, intencao, detalhe)
        VALUES (t.id, t.conversa_id, v_msg, (v_ev ->> 'tipo')::public.triagem_evento_tipo,
                nullif(v_ev ->> 'passo', ''), nullif(v_ev ->> 'intencao', '')::public.triagem_intencao,
                CASE WHEN jsonb_typeof(v_ev -> 'detalhe') = 'object' THEN v_ev -> 'detalhe' ELSE '{}'::jsonb END);
      EXCEPTION WHEN check_violation OR invalid_text_representation THEN
        INSERT INTO public.whatsapp_triagem_eventos (triagem_id, conversa_id, mensagem_id, tipo, passo, detalhe)
        VALUES (t.id, t.conversa_id, v_msg, 'erro', t.passo,
                jsonb_build_object('motivo', 'evento_recusado', 'tipo_do_evento', left(coalesce(v_ev ->> 'tipo', ''), 30)));
      END;
    END IF;
  END LOOP;

  -- aviso para o grupo da equipe: uma vez por triagem. Aqui só se decide; triagem_varrer enfileira em notificacoes_fila.
  IF v_aviso IS NOT NULL AND jsonb_typeof(v_aviso) = 'object' AND cfg.avisar_grupo AND NOT v_aviso_ja_decidido THEN
    SELECT coalesce(array_agg(x), '{}'::text[]) INTO v_marcas
      FROM (SELECT x FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(v_aviso -> 'marcas') = 'array' THEN v_aviso -> 'marcas' ELSE '[]'::jsonb END) AS x
             WHERE x ~ '^[a-z_]{1,30}$' LIMIT 8) q;
    v_motivo_aviso := CASE WHEN v_aviso ->> 'motivo' ~ '^[a-z_]{1,40}$' THEN v_aviso ->> 'motivo' ELSE 'sem_motivo' END;
    UPDATE public.whatsapp_triagens
       SET aviso_grupo_decidido = true, aviso_grupo_motivo = v_motivo_aviso, aviso_grupo_marcas = v_marcas,
           -- em ensaio o aviso nunca sai: nasce "já enfileirado" e fica só o evento
           aviso_grupo_enviado_em = CASE WHEN v_ensaio THEN now() END
     WHERE id = t.id;
    INSERT INTO public.whatsapp_triagem_eventos (triagem_id, conversa_id, mensagem_id, tipo, passo, detalhe)
    VALUES (t.id, t.conversa_id, v_msg, 'aviso_grupo', t.passo,
            jsonb_build_object('motivo', v_motivo_aviso, 'marcas', to_jsonb(v_marcas), 'ensaio', v_ensaio));
  END IF;

  -- "parar" vale por conversa, por lid e por telefone, guardado em hash. Em ENSAIO nada real é gravado: a pessoa nunca
  -- recebeu mensagem do robô, então não há o que parar.
  IF coalesce((p_resultado ->> 'bloquear_contato')::boolean, false) THEN
    IF v_ensaio THEN
      INSERT INTO public.whatsapp_triagem_eventos (triagem_id, conversa_id, mensagem_id, tipo, passo, detalhe)
      VALUES (t.id, t.conversa_id, v_msg, 'pulou', t.passo, jsonb_build_object('motivo', 'bloqueio_em_ensaio'));
    ELSE
      v_hash_tel := public._triagem_hash(c.telefone_normalizado);
      v_hash_lid := public._triagem_hash(c.chat_lid);
      IF v_hash_tel IS NULL AND v_hash_lid IS NULL THEN
        -- sem telefone e sem lid não há chave para guardar (o CHECK exige uma): a triagem desta conversa já ficou parada
        -- e uma conversa só tem uma triagem, então ela não reabre; só não vale para outra conversa da mesma pessoa
        INSERT INTO public.whatsapp_triagem_eventos (triagem_id, conversa_id, mensagem_id, tipo, passo, detalhe)
        VALUES (t.id, t.conversa_id, v_msg, 'pulou', t.passo, jsonb_build_object('motivo', 'bloqueio_sem_chave'));
      ELSE
        INSERT INTO public.whatsapp_automacao_bloqueios (telefone_hash, lid_hash, conversa_id, motivo)
        VALUES (v_hash_tel, v_hash_lid, c.id, 'parar')
        ON CONFLICT DO NOTHING;
        -- se a conversa já tinha um bloqueio por outra chave, completa as chaves que faltam
        UPDATE public.whatsapp_automacao_bloqueios b
           SET telefone_hash = coalesce(b.telefone_hash, v_hash_tel), lid_hash = coalesce(b.lid_hash, v_hash_lid)
         WHERE b.conversa_id = c.id
           AND (b.telefone_hash IS NULL OR b.lid_hash IS NULL)
           AND NOT EXISTS (SELECT 1 FROM public.whatsapp_automacao_bloqueios o WHERE o.id <> b.id
                              AND (o.telefone_hash = v_hash_tel OR o.lid_hash = v_hash_lid));
      END IF;
    END IF;
  END IF;

  -- freio global por CONTAGEM: 3 textos barrados em 30 minutos, contados só depois do último desligar. Só muda a
  -- configuração (uma linha): quem tiver triagem aberta é parado por triagem_varrer ou pela próxima mensagem.
  IF v_barrado THEN
    SELECT count(*) INTO v_barrados FROM public.whatsapp_triagem_eventos e
     WHERE e.tipo = 'texto_barrado' AND e.criado_em > greatest(now() - interval '30 minutes', coalesce(cfg.desligada_em, '-infinity'::timestamptz));
    IF v_barrados >= 3 AND public._triagem_desligar_config('freio_textos_barrados', NULL) THEN
      v_freio := true;
      INSERT INTO public.whatsapp_triagem_eventos (tipo, detalhe)
      VALUES ('freio', jsonb_build_object('motivo', 'freio_textos_barrados', 'barrados', v_barrados, 'pausadas', 0, 'manual', false));
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'versao', t.versao + 1, 'enviado', v_enviou AND NOT v_ensaio,
                            'ensaio', v_ensaio AND v_enviou, 'envio', v_envio_res,
                            'barrado', v_barrado, 'regras', v_regras, 'freio', v_freio);
END $function$;

-- 10. gatilhos de pausa por humano ------------------------------------------------------------------------------------
-- Na mensagem: saída que não seja automacao nem ia (humano pelo painel, celular da empresa, qualquer origem humana futura).
-- Na conversa: ganhou responsável ou atribuição, entrou em modo humano ou foi arquivada.
-- Se der erro aqui NÃO derruba a mensagem de quem respondeu (nem o 200 do webhook): o aviso vai para o log do banco e as
-- outras travas (triagem_ler_ou_abrir, triagem_aplicar e triagem_enviar conferem a gente na conversa antes de interpretar e
-- de enviar) pegam a pausa na mensagem seguinte. Três cuidados para NUNCA esperar trava de outra sessão:
--   * FOR UPDATE SKIP LOCKED: triagem travada por outro processo (aplicar, varrer, desligar) é deixada para a próxima conferência;
--   * lock_timeout de 1 s na própria função (SET da função: vale só enquanto ela roda), para a pausa que já pegou a triagem
--     não ficar esperando fila, mensagem ou conversa travadas;
--   * QUERY_CANCELED capturado pelo nome (WHEN OTHERS não pega): o statement_timeout que o PostgREST impõe não derruba o INSERT.
CREATE OR REPLACE FUNCTION public.triagem_pausar_por_humano()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET lock_timeout TO '1s'
AS $function$
DECLARE
  v_conversa uuid;
  v_motivo text;
  v_triagem uuid;
BEGIN
  IF TG_TABLE_NAME = 'whatsapp_mensagens' THEN
    v_conversa := NEW.conversa_id;
    v_motivo := 'saida_humana';
  ELSE
    v_conversa := NEW.id;
    v_motivo := 'conversa_assumida';
  END IF;
  BEGIN
    SELECT id INTO v_triagem FROM public.whatsapp_triagens
     WHERE conversa_id = v_conversa AND status IN ('ativa', 'ensaio', 'expirada') FOR UPDATE SKIP LOCKED;
    IF FOUND THEN
      PERFORM public._triagem_pausar(v_triagem, 'pausada_humano', v_motivo);
    END IF;
  EXCEPTION
    WHEN query_canceled THEN
      RAISE WARNING 'triagem_pausar_por_humano cancelada por tempo (conversa %), a mensagem segue: %', v_conversa, SQLERRM;
    WHEN OTHERS THEN
      RAISE WARNING 'triagem_pausar_por_humano falhou (conversa %): % [%]', v_conversa, SQLERRM, SQLSTATE;
  END;
  RETURN NULL;
END $function$;

CREATE TRIGGER tg_triagem_pausa_por_mensagem
  AFTER INSERT ON public.whatsapp_mensagens
  FOR EACH ROW
  WHEN (NEW.direcao = 'saida' AND coalesce(NEW.origem, 'humano') NOT IN ('automacao', 'ia'))
  EXECUTE FUNCTION public.triagem_pausar_por_humano();

CREATE TRIGGER tg_triagem_pausa_por_conversa
  AFTER UPDATE OF responsavel_id, atribuido_para, modo, status ON public.whatsapp_conversas
  FOR EACH ROW
  WHEN (NEW.responsavel_id IS NOT NULL OR NEW.atribuido_para IS NOT NULL OR NEW.modo = 'humano' OR NEW.status = 'arquivada')
  EXECUTE FUNCTION public.triagem_pausar_por_humano();

-- 11. Desligar: o botão vermelho (pública) e o freio automático (interna) -----------------------------------------------
-- A interna é a que o freio usa (triagem_varrer): sem usuário, sem checagem de permissão, só para quem já é de dentro do
-- banco. A pública exige usuário e permissão, então uma server function que repasse usuário nulo (sessão não resolvida)
-- NÃO desliga nada. Desligar é a direção segura, por isso aceita whatsapp.manage OU configuracoes.manage.
--
-- Ordem de travas, igual à de triagem_aplicar e à do gatilho de mensagem: advisory, conversa, triagem (e a configuração
-- por último). Conversas em ordem de id, para dois desligar ao mesmo tempo não se travarem. A conversa é travada ANTES de
-- mexer na triagem: a mensagem da equipe trava a conversa e depois espera a triagem, e o ciclo fechava sem isto.
CREATE OR REPLACE FUNCTION public._triagem_desligar_interno(p_motivo text, p_usuario uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  t record;
  v_pausadas integer := 0;
  v_canceladas integer := 0;
  v_mudou boolean;
  v_msgs uuid[];
  v_convs uuid[];
  v_textos text[];
  v_motivo text := left(coalesce(nullif(btrim(coalesce(p_motivo, '')), ''), 'sem_motivo'), 120);
BEGIN
  FOR t IN SELECT id, conversa_id FROM public.whatsapp_triagens WHERE status IN ('ativa', 'ensaio', 'expirada') ORDER BY conversa_id LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('triagem:' || t.conversa_id::text, 0));
    PERFORM 1 FROM public.whatsapp_conversas WHERE id = t.conversa_id FOR UPDATE;
    IF public._triagem_pausar(t.id, 'pausada_desligada', 'desligada') THEN
      v_pausadas := v_pausadas + 1;
    END IF;
  END LOOP;
  v_mudou := public._triagem_desligar_config(v_motivo, p_usuario);
  -- sobra de fila de triagem (por exemplo de conversa já encerrada) também sai. Só se apaga a mensagem cuja fila ESTE comando
  -- acabou de cancelar: mensagem que o despachante já mandou (fila enviada ou com falha) nunca é apagada do histórico.
  -- Em dois comandos (cancelar a fila, depois apagar a mensagem), como _triagem_cancelar_pendentes: a fila que aponta para a
  -- mensagem apagada não pode ser atualizada no mesmo comando que apaga a mensagem. E a "última mensagem" de cada conversa
  -- afetada volta a ser a última que existe de verdade.
  WITH canc AS (
    UPDATE public.whatsapp_fila_envio SET status = 'cancelada', erro = 'cancelada pela triagem', updated_at = now()
     WHERE status = 'pendente' AND payload ? 'triagem_id'
    RETURNING mensagem_id)
  SELECT coalesce(array_agg(mensagem_id) FILTER (WHERE mensagem_id IS NOT NULL), '{}'::uuid[]), count(*)
    INTO v_msgs, v_canceladas FROM canc;
  IF cardinality(v_msgs) > 0 THEN
    WITH apagadas AS (
      DELETE FROM public.whatsapp_mensagens WHERE id = ANY (v_msgs) AND status = 'pendente' AND direcao = 'saida'
      RETURNING conversa_id, left(texto, 500) AS texto)
    SELECT array_agg(conversa_id), array_agg(texto) INTO v_convs, v_textos FROM apagadas;
    IF v_textos IS NOT NULL THEN
      PERFORM public._triagem_recompor_ultima(v_convs, v_textos);
    END IF;
  END IF;
  INSERT INTO public.whatsapp_triagem_eventos (tipo, detalhe)
  VALUES ('freio', jsonb_build_object('motivo', v_motivo, 'pausadas', v_pausadas, 'manual', p_usuario IS NOT NULL,
                                      'mudou_o_estado', v_mudou));
  RETURN jsonb_build_object('ok', true, 'estado', 'desligada', 'pausadas', v_pausadas, 'canceladas_na_fila', v_canceladas);
END $function$;

CREATE OR REPLACE FUNCTION public.triagem_desligar(p_motivo text, p_usuario uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_usuario IS NULL OR NOT (public.has_permission(p_usuario, 'whatsapp.manage')
                               OR public.has_permission(p_usuario, 'configuracoes.manage')) THEN
    RAISE EXCEPTION 'Desligar a triagem exige a permissão whatsapp.manage ou configuracoes.manage, e um usuário.';
  END IF;
  RETURN public._triagem_desligar_interno(p_motivo, p_usuario);
END $function$;

-- 12. triagem_varrer: a rodada do despachante (a cada 2 minutos) ------------------------------------------------------
-- Devolve só contagens. Quem manda o aviso ao grupo é esta função mesma, pela fila de notificações (passo 6).
CREATE OR REPLACE FUNCTION public.triagem_varrer()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  cfg public.whatsapp_triagem_config%ROWTYPE;
  t record;
  v_expiradas integer := 0;
  v_canceladas integer := 0;
  v_apagados integer := 0;
  v_falhas integer := 0;
  v_erros integer := 0;
  v_barrados integer := 0;
  v_freio text;
  v_desde timestamptz;
  v_passo text;
  v_grupo text;
  v_texto text;
  v_avisos integer := 0;
  v_sem_grupo integer := 0;
  v_msgs uuid[];
  v_convs uuid[];
  v_textos text[];
BEGIN
  SELECT * INTO cfg FROM public.whatsapp_triagem_config WHERE id;

  -- 1. desligada, mas ainda com triagem aberta: o freio de triagem_aplicar só muda a configuração, esta rodada para o resto
  IF cfg.estado = 'desligada' AND EXISTS (SELECT 1 FROM public.whatsapp_triagens WHERE status IN ('ativa', 'ensaio', 'expirada')) THEN
    PERFORM public._triagem_desligar_interno(coalesce(cfg.desligada_por, 'desligada'), NULL);
  END IF;

  -- 2. freio automático: falhas de envio, erros de leitura e textos barrados. Conta SÓ o que aconteceu depois de
  -- desligada_em: sem isto, religar dentro da janela desligava de novo pelo mesmo motivo na rodada seguinte.
  IF cfg.estado <> 'desligada' THEN
    v_desde := coalesce(cfg.desligada_em, '-infinity'::timestamptz);
    SELECT count(*) INTO v_falhas FROM public.whatsapp_fila_envio f
     WHERE f.payload ? 'triagem_id' AND f.status = 'falha' AND f.updated_at > greatest(now() - interval '30 minutes', v_desde);
    SELECT count(*) INTO v_erros FROM public.whatsapp_triagem_eventos e
     WHERE e.tipo = 'erro' AND e.criado_em > greatest(now() - interval '1 hour', v_desde);
    SELECT count(*) INTO v_barrados FROM public.whatsapp_triagem_eventos e
     WHERE e.tipo = 'texto_barrado' AND e.criado_em > greatest(now() - interval '30 minutes', v_desde);
    IF v_falhas >= cfg.freio_falhas_envio THEN
      v_freio := 'freio_falhas_de_envio';
    ELSIF v_erros >= cfg.freio_erros_hora THEN
      v_freio := 'freio_erros_de_leitura';
    ELSIF v_barrados >= 3 THEN
      v_freio := 'freio_textos_barrados';
    END IF;
    IF v_freio IS NOT NULL THEN
      PERFORM public._triagem_desligar_interno(v_freio, NULL);
    END IF;
  END IF;

  -- 3. expirar: etapa aberta sem resposta além do limite (sem lembrete). Em ensaio o aviso nasce já "enfileirado".
  -- A conversa é travada ANTES de tocar na triagem (mesma ordem da mensagem da equipe) e SEM esperar: conversa ocupada
  -- agora é conversa viva, fica para a próxima rodada. Não expira quem já respondeu e ainda não foi lido pelo servidor
  -- (resposta dos últimos 10 minutos sem evento de entrada): o aplicar daria conflito e a resposta se perderia.
  FOR t IN SELECT x.id, x.conversa_id FROM public.whatsapp_triagens x
            WHERE x.status IN ('ativa', 'ensaio')
              AND greatest(coalesce(x.ultimo_envio_em, '-infinity'::timestamptz), coalesce(x.ultima_entrada_em, '-infinity'::timestamptz), x.iniciada_em)
                  < now() - cfg.espera_resposta_min * interval '1 minute'
            ORDER BY x.conversa_id LOOP
    IF NOT pg_try_advisory_xact_lock(hashtextextended('triagem:' || t.conversa_id::text, 0)) THEN CONTINUE; END IF;
    PERFORM 1 FROM public.whatsapp_conversas WHERE id = t.conversa_id FOR UPDATE SKIP LOCKED;
    IF NOT FOUND THEN CONTINUE; END IF;
    UPDATE public.whatsapp_triagens x
       SET status = 'expirada', motivo_fim = coalesce(x.motivo_fim, 'silencio'), versao = x.versao + 1, atualizado_em = now(),
           -- a mesma decisão de aviso do TypeScript (maquina.ts): nome, CEP, primeira vez, número alternativo, endereço ou preço
           aviso_grupo_decidido = x.aviso_grupo_decidido OR (cfg.avisar_grupo AND (x.nome_informado IS NOT NULL OR x.cep IS NOT NULL
                                    OR x.primeira_vez IS NOT NULL OR x.telefone_alternativo IS NOT NULL OR x.endereco_texto IS NOT NULL OR x.pediu_preco)),
           aviso_grupo_motivo = CASE WHEN NOT x.aviso_grupo_decidido AND cfg.avisar_grupo AND (x.nome_informado IS NOT NULL OR x.cep IS NOT NULL
                                    OR x.primeira_vez IS NOT NULL OR x.telefone_alternativo IS NOT NULL OR x.endereco_texto IS NOT NULL OR x.pediu_preco)
                                     THEN 'expirada' ELSE x.aviso_grupo_motivo END,
           aviso_grupo_enviado_em = CASE WHEN NOT x.aviso_grupo_decidido AND cfg.avisar_grupo AND x.modo = 'ensaio' AND (x.nome_informado IS NOT NULL OR x.cep IS NOT NULL
                                    OR x.primeira_vez IS NOT NULL OR x.telefone_alternativo IS NOT NULL OR x.endereco_texto IS NOT NULL OR x.pediu_preco)
                                         THEN now() ELSE x.aviso_grupo_enviado_em END
     WHERE x.id = t.id AND x.status IN ('ativa', 'ensaio')
       AND greatest(coalesce(x.ultimo_envio_em, '-infinity'::timestamptz), coalesce(x.ultima_entrada_em, '-infinity'::timestamptz), x.iniciada_em)
           < now() - cfg.espera_resposta_min * interval '1 minute'
       AND NOT EXISTS (SELECT 1 FROM public.whatsapp_mensagens m
                        WHERE m.conversa_id = x.conversa_id AND m.direcao = 'entrada' AND coalesce(m.origem, 'humano') <> 'automacao'
                          AND m.tipo <> 'sistema' AND m.created_at > x.iniciada_em AND m.created_at > now() - interval '10 minutes'
                          AND NOT EXISTS (SELECT 1 FROM public.whatsapp_triagem_eventos e
                                           WHERE e.triagem_id = x.id AND e.mensagem_id = m.id AND e.tipo = 'entrada'))
    RETURNING x.passo INTO v_passo;
    IF FOUND THEN
      INSERT INTO public.whatsapp_triagem_eventos (triagem_id, conversa_id, tipo, passo, detalhe)
      VALUES (t.id, t.conversa_id, 'expirou', v_passo, jsonb_build_object('espera_min', cfg.espera_resposta_min));
      v_expiradas := v_expiradas + 1;
    END IF;
  END LOOP;

  -- 4. cancelar fila de triagem que ficou para trás (pausada por humano, desligada, ou triagem que sumiu)
  -- (dois comandos, cancelar a fila e depois apagar a mensagem; e a caixa não continua mostrando como última mensagem a
  -- pergunta que acabou de ser apagada)
  WITH canc AS (
    UPDATE public.whatsapp_fila_envio f
       SET status = 'cancelada', erro = 'cancelada pela triagem', updated_at = now()
     WHERE f.status = 'pendente' AND f.payload ? 'triagem_id'
       AND NOT EXISTS (SELECT 1 FROM public.whatsapp_triagens t2
                        WHERE t2.id::text = f.payload ->> 'triagem_id'
                          AND t2.status NOT IN ('pausada_humano', 'pausada_desligada', 'pulada'))
    RETURNING f.mensagem_id)
  SELECT coalesce(array_agg(mensagem_id) FILTER (WHERE mensagem_id IS NOT NULL), '{}'::uuid[]), count(*)
    INTO v_msgs, v_canceladas FROM canc;
  IF cardinality(v_msgs) > 0 THEN
    WITH apagadas AS (
      DELETE FROM public.whatsapp_mensagens WHERE id = ANY (v_msgs) AND status = 'pendente' AND direcao = 'saida'
      RETURNING conversa_id, left(texto, 500) AS texto)
    SELECT array_agg(conversa_id), array_agg(texto) INTO v_convs, v_textos FROM apagadas;
    IF v_textos IS NOT NULL THEN
      PERFORM public._triagem_recompor_ultima(v_convs, v_textos);
    END IF;
  END IF;

  -- 5. retenção dos eventos
  DELETE FROM public.whatsapp_triagem_eventos WHERE criado_em < now() - cfg.retencao_eventos_dias * interval '1 day';
  GET DIAGNOSTICS v_apagados = ROW_COUNT;

  -- 6. avisos de grupo: ENFILEIRADOS em notificacoes_fila, uma vez por triagem, só o primeiro nome (sem CEP nem telefone).
  -- A chave triagem_aviso:<id> torna o reenvio seguro: se a rodada falhar no meio ou o despachante perder a resposta, a
  -- próxima rodada tenta de novo e o enfileirar não duplica. Só depois de enfileirado a triagem fica marcada. Sem grupo da
  -- equipe configurado, nada é marcado e o aviso espera. O ramo de entidade 'whatsapp_atendimento' é o que o CHECK da fila
  -- aceita; sem atendimento, o id da triagem faz de identificador.
  v_grupo := public.grupo_equipe_destino();
  FOR t IN SELECT x.id, x.conversa_id, x.atendimento_id, x.aviso_grupo_motivo, x.aviso_grupo_marcas, x.ramo, x.aviso_grupo_rodada,
                  split_part(coalesce(x.nome_informado, ''), ' ', 1) AS primeiro_nome
             FROM public.whatsapp_triagens x
            WHERE x.aviso_grupo_decidido AND x.aviso_grupo_enviado_em IS NULL AND x.modo = 'real'
              AND x.status NOT IN ('pausada_humano', 'pausada_desligada', 'pulada')
            ORDER BY x.atualizado_em LIMIT 50 LOOP
    IF v_grupo IS NULL THEN
      v_sem_grupo := v_sem_grupo + 1;
      CONTINUE;
    END IF;
    PERFORM 1 FROM public.whatsapp_triagens WHERE id = t.id FOR UPDATE SKIP LOCKED;
    IF NOT FOUND THEN CONTINUE; END IF;
    BEGIN
      v_texto := concat_ws(E'\n',
        '🧾 Triagem do robô: ' || CASE WHEN t.aviso_grupo_motivo = 'expirada' THEN 'a pessoa parou de responder'
                                       ELSE replace(coalesce(t.aviso_grupo_motivo, 'terminou'), '_', ' ') END,
        '👤 ' || coalesce(nullif(t.primeiro_nome, ''), 'Contato sem nome') || ' · '
              || CASE t.ramo WHEN 'parceiro' THEN 'quer ser parceiro' ELSE 'cliente final' END,
        CASE WHEN cardinality(t.aviso_grupo_marcas) > 0 THEN '🏷️ ' || replace(array_to_string(t.aviso_grupo_marcas, ', '), '_', ' ') END,
        '👉 Responder: https://bexprint.com.br/whatsapp?conversa=' || t.conversa_id);
      PERFORM public.enfileirar_notificacao('whatsapp', v_grupo, NULL, 'aviso_grupo_equipe', 'whatsapp_atendimento',
                                            coalesce(t.atendimento_id, t.id), 'aviso_grupo_equipe',
                                            jsonb_build_object('texto', v_texto),
                                            'triagem_aviso:' || t.id || CASE WHEN t.aviso_grupo_rodada > 1 THEN ':' || t.aviso_grupo_rodada ELSE '' END);
      UPDATE public.whatsapp_triagens SET aviso_grupo_enviado_em = now(), atualizado_em = now()
       WHERE id = t.id AND aviso_grupo_enviado_em IS NULL;
      v_avisos := v_avisos + 1;
    EXCEPTION WHEN OTHERS THEN
      -- não vira evento 'erro' (cada rodada repetiria e o freio de erros desligaria tudo por causa de um aviso)
      RAISE WARNING 'aviso da triagem % para o grupo falhou: % [%]', t.id, SQLERRM, SQLSTATE;
    END;
  END LOOP;

  RETURN jsonb_build_object('expiradas', v_expiradas, 'canceladas', v_canceladas, 'eventos_apagados', v_apagados,
                            'freio', v_freio, 'falhas_de_envio_30min', v_falhas, 'erros_na_ultima_hora', v_erros,
                            'textos_barrados_30min', v_barrados, 'avisos_enfileirados', v_avisos, 'avisos_sem_grupo', v_sem_grupo);
END $function$;

-- 13. ACL: nada para anon nem authenticated, EXECUTE só do service_role ------------------------------------------------
REVOKE ALL ON FUNCTION public._triagem_lista_limpa(jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._triagem_em_andamento(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._triagem_desligar_config(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._triagem_desligar_interno(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._triagem_hash(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._triagem_sorteio(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._triagem_parece_robo(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._triagem_conhecido(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._triagem_bloqueado(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._triagem_nome_valido(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._triagem_humano_na_conversa(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._triagem_cancelar_pendentes(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._triagem_recompor_ultima(uuid[], text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._triagem_degrau_permite(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._triagem_pausar(uuid, public.triagem_status, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.triagem_enviar(uuid, text, text, integer, text, integer, text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.triagem_dono_da_conversa(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.triagem_ler_ou_abrir(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.triagem_aplicar(uuid, integer, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.triagem_pausar_por_humano() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.triagem_desligar(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.triagem_varrer() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._triagem_lista_limpa(jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public._triagem_em_andamento(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public._triagem_desligar_config(text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public._triagem_desligar_interno(text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public._triagem_hash(text) TO service_role;
GRANT EXECUTE ON FUNCTION public._triagem_sorteio(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public._triagem_parece_robo(text) TO service_role;
GRANT EXECUTE ON FUNCTION public._triagem_conhecido(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public._triagem_bloqueado(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public._triagem_nome_valido(text) TO service_role;
GRANT EXECUTE ON FUNCTION public._triagem_humano_na_conversa(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public._triagem_cancelar_pendentes(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public._triagem_recompor_ultima(uuid[], text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public._triagem_degrau_permite(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public._triagem_pausar(uuid, public.triagem_status, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.triagem_enviar(uuid, text, text, integer, text, integer, text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.triagem_dono_da_conversa(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.triagem_ler_ou_abrir(uuid, uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.triagem_aplicar(uuid, integer, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.triagem_pausar_por_humano() TO service_role;
GRANT EXECUTE ON FUNCTION public.triagem_desligar(text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.triagem_varrer() TO service_role;

-- 14. Conferência -------------------------------------------------------------------------------------------------------
DO $conferencia$
DECLARE
  v_n integer;
  v_t text;
  v_f text;
BEGIN
  FOREACH v_t IN ARRAY ARRAY['public.whatsapp_triagens', 'public.whatsapp_triagem_eventos', 'public.whatsapp_automacao_bloqueios'] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = v_t::regclass) THEN
      RAISE EXCEPTION 'RLS desligada em %', v_t;
    END IF;
    IF has_table_privilege('anon', v_t, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
      RAISE EXCEPTION 'anon tem privilégio em %', v_t;
    END IF;
    IF has_table_privilege('authenticated', v_t, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
      RAISE EXCEPTION 'authenticated escreve em %', v_t;
    END IF;
    IF NOT has_table_privilege('service_role', v_t, 'SELECT,INSERT,UPDATE,DELETE') THEN
      RAISE EXCEPTION 'service_role perdeu acesso a %', v_t;
    END IF;
  END LOOP;
  -- bloqueios: nem leitura para a equipe (telefone em hash, mas não precisa ser lido)
  IF has_table_privilege('authenticated', 'public.whatsapp_automacao_bloqueios', 'SELECT') THEN
    RAISE EXCEPTION 'authenticated lê os bloqueios';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
              AND tablename IN ('whatsapp_triagens', 'whatsapp_triagem_eventos', 'whatsapp_automacao_bloqueios') AND cmd <> 'SELECT') THEN
    RAISE EXCEPTION 'política de escrita nas tabelas da triagem';
  END IF;

  FOREACH v_f IN ARRAY ARRAY[
    '_triagem_hash', '_triagem_sorteio', '_triagem_parece_robo', '_triagem_conhecido', '_triagem_bloqueado',
    '_triagem_nome_valido', '_triagem_humano_na_conversa', '_triagem_cancelar_pendentes', '_triagem_pausar',
    '_triagem_lista_limpa', '_triagem_em_andamento', '_triagem_desligar_config', '_triagem_desligar_interno',
    '_triagem_recompor_ultima', '_triagem_degrau_permite',
    'triagem_enviar', 'triagem_dono_da_conversa', 'triagem_ler_ou_abrir', 'triagem_aplicar',
    'triagem_pausar_por_humano', 'triagem_desligar', 'triagem_varrer'
  ] LOOP
    SELECT count(*) INTO v_n FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = v_f;
    IF v_n <> 1 THEN RAISE EXCEPTION '% tem % versões (esperado 1): sobrecarga quebra o PostgREST', v_f, v_n; END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = v_f
                  AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))) THEN
      RAISE EXCEPTION 'anon ou authenticated executa %', v_f;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = v_f
                      AND has_function_privilege('service_role', p.oid, 'EXECUTE')) THEN
      RAISE EXCEPTION 'service_role perdeu o EXECUTE de %', v_f;
    END IF;
  END LOOP;
  -- todas SECURITY DEFINER com search_path público, menos as funções puras (hash, sorteio, robo, nome)
  SELECT count(*) INTO v_n FROM pg_proc
   WHERE pronamespace = 'public'::regnamespace
     AND proname IN ('triagem_enviar', 'triagem_dono_da_conversa', 'triagem_ler_ou_abrir', 'triagem_aplicar',
                     'triagem_pausar_por_humano', 'triagem_desligar', 'triagem_varrer', '_triagem_conhecido', '_triagem_bloqueado',
                     '_triagem_humano_na_conversa', '_triagem_cancelar_pendentes', '_triagem_pausar',
                     '_triagem_em_andamento', '_triagem_desligar_config', '_triagem_desligar_interno',
                     '_triagem_recompor_ultima', '_triagem_degrau_permite')
     AND prosecdef AND proconfig::text LIKE '%search_path=public%';
  IF v_n <> 17 THEN RAISE EXCEPTION 'só % de 17 funções são SECURITY DEFINER com search_path', v_n; END IF;
  -- o gatilho de pausa nunca espera trava: SKIP LOCKED, lock_timeout na função e QUERY_CANCELED capturado
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'triagem_pausar_por_humano'
                    AND prosrc ~ 'SKIP LOCKED' AND prosrc ~ 'query_canceled' AND proconfig::text LIKE '%lock_timeout%') THEN
    RAISE EXCEPTION 'triagem_pausar_por_humano precisa de SKIP LOCKED, lock_timeout e QUERY_CANCELED capturado';
  END IF;
  -- toda chave estrangeira das tabelas novas tem índice que ela encabeça (apagar mensagem ou atendimento não varre tabela)
  SELECT count(*) INTO v_n FROM pg_constraint k
   WHERE k.contype = 'f'
     AND k.conrelid IN ('public.whatsapp_triagens'::regclass, 'public.whatsapp_triagem_eventos'::regclass,
                        'public.whatsapp_automacao_bloqueios'::regclass)
     AND NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = k.conrelid AND i.indisvalid
                        AND (i.indkey::int2[])[0:cardinality(k.conkey) - 1] = k.conkey);
  IF v_n <> 0 THEN RAISE EXCEPTION '% chave(s) estrangeira(s) das tabelas da triagem sem índice', v_n; END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.whatsapp_mensagens'::regclass AND tgname = 'tg_triagem_pausa_por_mensagem' AND NOT tgisinternal)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.whatsapp_conversas'::regclass AND tgname = 'tg_triagem_pausa_por_conversa' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'falta um dos gatilhos de pausa por humano';
  END IF;
  -- o gatilho da caixa continua o mesmo e continua sendo o único BEFORE INSERT de mensagens
  IF (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.whatsapp_mensagens'::regclass AND tgname = 'whatsapp_mensagens_atendimento' AND NOT tgisinternal) <> 1 THEN
    RAISE EXCEPTION 'o gatilho whatsapp_mensagens_atendimento sumiu';
  END IF;
  -- índice único de entrada e chaves do bloqueio
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'whatsapp_triagem_eventos_entrada_unica' AND indexdef LIKE '%UNIQUE%')
     OR (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'whatsapp_automacao_bloqueios' AND indexdef LIKE '%UNIQUE%') < 3 THEN
    RAISE EXCEPTION 'faltam índices únicos';
  END IF;
  -- a mensagem da triagem sai pelo caminho que não zera a espera: o CHECK ainda aceita a origem automacao E o corpo vivo
  -- de _wa_mensagem_antes_inserir ainda trata automacao à parte (a mesma checagem do início, repetida: se alguém trocou a
  -- função entre as duas, a migração desfaz)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.whatsapp_mensagens'::regclass AND contype = 'c'
                  AND pg_get_constraintdef(oid) ~ 'automacao') THEN
    RAISE EXCEPTION 'whatsapp_mensagens não aceita mais a origem automacao';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = '_wa_mensagem_antes_inserir'
               AND prosrc ~ 'automacao' AND prosrc ~ 'aguardando_desde = NULL') IS NOT TRUE THEN
    RAISE EXCEPTION '_wa_mensagem_antes_inserir mudou durante a migração: releia a definição viva';
  END IF;

  -- nome: a validação forte recusa o que não é nome
  IF NOT public._triagem_nome_valido('Maria Souza') OR NOT public._triagem_nome_valido('João da Silva Pereira')
     OR NOT public._triagem_nome_valido('Maria de Lourdes Santos Lima') OR NOT public._triagem_nome_valido('Maria Aparecida dos Santos Silva')
     OR NOT public._triagem_nome_valido('Ana-Clara D''Ávila') THEN
    RAISE EXCEPTION 'nome de pessoa foi recusado';
  END IF;
  IF public._triagem_nome_valido('sim') OR public._triagem_nome_valido('ok') OR public._triagem_nome_valido('quero banner')
     OR public._triagem_nome_valido('Bloqueio de Linha') OR public._triagem_nome_valido('Parceiro Silva')
     OR public._triagem_nome_valido('Maria 123') OR public._triagem_nome_valido('www.golpe.com') OR public._triagem_nome_valido('Pix')
     OR public._triagem_nome_valido('Um Dois Tres Quatro Cinco') OR public._triagem_nome_valido('www.exemplo.com')
     OR public._triagem_nome_valido('oi.com') OR public._triagem_nome_valido('bit.ly') OR public._triagem_nome_valido('meusite.com.br')
     OR public._triagem_nome_valido('Maria Souza Lima Santos Pereira Alves Costa') OR public._triagem_nome_valido('de Maria')
     OR public._triagem_nome_valido('Maria de') THEN
    RAISE EXCEPTION 'a validação de nome deixou passar o que não é nome';
  END IF;
  -- sorteio igual ao do TypeScript (numeroDoIdentificador % 100): ffffffff = 4294967295 -> 95; 00000000 -> 0
  IF public._triagem_sorteio('00000000-0000-0000-0000-0000ffffffff') <> 95 OR public._triagem_sorteio('00000000-0000-0000-0000-000000000000') <> 0 THEN
    RAISE EXCEPTION 'sorteio diverge do TypeScript';
  END IF;
  -- robô
  IF public._triagem_parece_robo('Seu código de verificação é 123') IS NULL OR public._triagem_parece_robo('Olá, tudo bem?') IS NOT NULL THEN
    RAISE EXCEPTION 'detecção de robô errada';
  END IF;
  -- eventos: o CHECK recusa chave com cara de conteúdo
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.whatsapp_triagem_eventos'::regclass
                  AND conname = 'triagem_evento_detalhe_sem_conteudo') THEN
    RAISE EXCEPTION 'falta o CHECK de eventos sem conteúdo';
  END IF;
  -- e ele olha dentro de objetos e listas (keyvalue em $.**), não só a raiz; variaveis e codigos só guardam nomes
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.whatsapp_triagem_eventos'::regclass
                  AND conname = 'triagem_evento_detalhe_sem_conteudo' AND pg_get_constraintdef(oid) ~ 'keyvalue')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.whatsapp_triagem_eventos'::regclass
                     AND conname = 'triagem_evento_variaveis_so_nomes')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.whatsapp_triagem_eventos'::regclass
                     AND conname = 'triagem_evento_codigos_so_codigos') THEN
    RAISE EXCEPTION 'o CHECK de eventos não é recursivo ou faltam os de variaveis e codigos';
  END IF;
  -- nada nasce ligado e nada foi criado: zero triagens, zero bloqueios, configuração desligada
  SELECT count(*) INTO v_n FROM public.whatsapp_triagens;
  IF v_n <> 0 THEN RAISE EXCEPTION 'nasceram % triagens', v_n; END IF;
  IF (SELECT estado FROM public.whatsapp_triagem_config WHERE id) <> 'desligada' THEN
    RAISE EXCEPTION 'a configuração não está desligada';
  END IF;
END
$conferencia$;

COMMIT;
