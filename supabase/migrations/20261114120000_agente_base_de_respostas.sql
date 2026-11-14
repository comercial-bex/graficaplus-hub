-- APLICADA em 14/11/2026, depois de ensaio com desfazer no banco vivo (provas 1 a 17, a 4 pulada por não haver gestor) e prova por md5 das 10 funções. Roteiro: docs/ensaio-agente-base.md.
-- ORDEM: depois de 20261113130000_triagem_dados.sql (tipo triagem_ramo, validador de texto, termos proibidos) e de
-- 20261113131000_horario_unico.sql (whatsapp_horario_em_texto). Não depende das migrações B7, B8 e B9.
--
-- BASE DE RESPOSTAS APROVADAS DO AGENTE (Bex Print, C2)
--
-- O QUE É: uma lista de perguntas que o contato costuma fazer, com a resposta que o DONO aprovou, uma a uma, para o agente
-- poder usar depois. O agente e os assistentes de texto livre NUNCA citam preço nem fazem orçamento: a base só carrega
-- expectativa de produto, endereço, horário, formato de arquivo e o que a equipe confirma.
--
-- O QUE CRIA
--  1. Tipo agente_resposta_status (rascunho, aprovada, arquivada).
--  2. agente_base_respostas: uma linha por pergunta (tema), com frases gatilho (minúsculas, sem acento, sem pontuação),
--     ramos (cliente, parceiro ou os dois), produto OU família opcionais, o texto proposto, a versão, quem aprovou e quando.
--     SEM coluna de preço e sem ler nenhum preco_* de produtos (só id e familia).
--  3. agente_base_respostas_historico: trilha de versões, quem e quando. Só entra por gatilho e nunca muda nem se apaga.
--  4. Gatilhos:
--       a) antes de gravar: texto aprovado que muda de qualquer jeito VOLTA a rascunho e a versão sobe; aprovar só passa
--          pela função agente_resposta_aprovar (que roda o validador); duas aprovações na mesma instrução são recusadas;
--       b) depois de gravar: registra o histórico;
--       c) DELETE e TRUNCATE são recusados nas duas tabelas (arquive, não apague); o histórico também recusa UPDATE.
--  5. Validador _agente_problemas_de_texto: reaproveita _triagem_problemas_de_texto e a tabela de termos proibidos
--     (valor em reais, centavos, desconto, porcentagem, forma de pagamento, nota fiscal, prazo em número, travessão, seta,
--     parênteses, as palavras de cliente final) e acrescenta regras PRÓPRIAS do agente, que valem em qualquer ramo: preço ou valor
--     com número, em dígito ou por extenso (cem, cinquenta, mil), "sai por" e "a partir de"; preço especial, preço diferenciado,
--     atacado e tabela de preços (a tabela de termos só os barra para o cliente final); condição de preço (grátis, promoção,
--     barato); prazo por extenso, abreviado ou marcado (48h, em dois dias, dia 15, mesmo dia, esta semana); forma de pagamento
--     (à vista, cartão de crédito, sinal, em três vezes, metade na entrada); o agente fazendo ou entregando orçamento; e a palavra
--     que a casa não usa, que NUNCA volta no código do problema. Horário da casa, quantidades e medidas passam.
--  6. Escrita só por funções SECURITY DEFINER, executáveis só por service_role, que conferem a permissão de quem pediu:
--       agente_resposta_salvar     salva rascunho (configuracoes.manage ou whatsapp.manage)
--       agente_resposta_aprovar    SÓ whatsapp.manage (hoje, só o admin): confere a versão que o dono viu e roda o validador
--       agente_resposta_rascunho   volta a rascunho (ou reabre uma arquivada)
--       agente_resposta_arquivar   arquiva
--     A leitura é por RLS para a equipe com a permissão da tela de configuração da triagem. Ninguém escreve pelo navegador.
--  7. Sementes: 15 perguntas mais frequentes como RASCUNHO, ramo cliente, produto nulo, escritas para o dono aprovar.
--     NENHUMA nasce aprovada. Os temas vêm de contagens de 148 conversas de entrada de 05/10 a 14/11/2026, por expressão
--     regular, sem copiar nome, telefone nem a resposta da equipe. Horário e endereço são lidos do cadastro vivo
--     (whatsapp_horario_em_texto e empresa_config), nunca escritos aqui; se faltarem, o texto vira "isso a equipe confirma".
--
-- O QUE NÃO MUDA: nenhuma função viva, nenhuma tabela viva, nenhum gatilho vivo. Nenhum consumidor chama a base ainda
-- (o agente de texto livre continua desligado). A única ligação com tabela viva é a chave de produto_id para produtos, que
-- pede uma trava curta em produtos no CREATE TABLE (lock_timeout de 5 s: se estiver ocupada, a migração desiste inteira).
--
-- A conferência no fim desfaz tudo se algo estiver fora do esperado.

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $pre$
DECLARE v_falta text;
BEGIN
  SELECT string_agg(x, ', ') INTO v_falta FROM (
    SELECT 'tipo triagem_ramo' AS x WHERE to_regtype('public.triagem_ramo') IS NULL
    UNION ALL SELECT 'função _triagem_problemas_de_texto' WHERE to_regprocedure('public._triagem_problemas_de_texto(text, public.triagem_ramo, boolean)') IS NULL
    UNION ALL SELECT 'função _triagem_normalizar_frase' WHERE to_regprocedure('public._triagem_normalizar_frase(text)') IS NULL
    UNION ALL SELECT 'função _triagem_texto_plano' WHERE to_regprocedure('public._triagem_texto_plano(text)') IS NULL
    UNION ALL SELECT 'função bex_normalizar_texto' WHERE to_regprocedure('public.bex_normalizar_texto(text)') IS NULL
    UNION ALL SELECT 'função has_permission' WHERE to_regprocedure('public.has_permission(uuid, text)') IS NULL
    UNION ALL SELECT 'função is_staff' WHERE to_regprocedure('public.is_staff(uuid)') IS NULL
    UNION ALL SELECT 'função whatsapp_horario_em_texto' WHERE to_regprocedure('public.whatsapp_horario_em_texto()') IS NULL
    UNION ALL SELECT 'tabela usuarios' WHERE to_regclass('public.usuarios') IS NULL
    UNION ALL SELECT 'tabela produtos' WHERE to_regclass('public.produtos') IS NULL
    UNION ALL SELECT 'tabela empresa_config' WHERE to_regclass('public.empresa_config') IS NULL
    UNION ALL SELECT 'tabela whatsapp_triagem_termos_proibidos' WHERE to_regclass('public.whatsapp_triagem_termos_proibidos') IS NULL
  ) q;
  IF v_falta IS NOT NULL THEN
    RAISE EXCEPTION 'Faltam pré-requisitos (aplique antes as migrações da triagem): %', v_falta;
  END IF;
  IF to_regclass('public.agente_base_respostas') IS NOT NULL OR to_regclass('public.agente_base_respostas_historico') IS NOT NULL
     OR to_regtype('public.agente_resposta_status') IS NOT NULL THEN
    RAISE EXCEPTION 'A base de respostas do agente já existe: esta migração só cria, nunca refaz.';
  END IF;
END $pre$;

-- 1. Tipo -------------------------------------------------------------------------------------------------------------
CREATE TYPE public.agente_resposta_status AS ENUM ('rascunho', 'aprovada', 'arquivada');

-- 2. Frase gatilho válida: já normalizada (minúsculas, sem acento, sem pontuação), de 1 a 80 letras, sem a palavra que a casa
-- não usa. Normalizar de novo não pode mudar nada: é isso que garante que o casamento do TypeScript e o do banco concordem.
CREATE OR REPLACE FUNCTION public._agente_frases_ok(p_frases text[])
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'public'
AS $function$
  SELECT cardinality(p_frases) <= 30 AND NOT EXISTS (
    SELECT 1 FROM unnest(p_frases) AS f
     WHERE f IS NULL OR f = '' OR char_length(f) > 80 OR f <> public._triagem_normalizar_frase(f) OR f LIKE '%revend%')
$function$;

-- 3. A base ----------------------------------------------------------------------------------------------------------
CREATE TABLE public.agente_base_respostas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tema text NOT NULL CHECK (tema ~ '^[a-z][a-z0-9_]{2,60}$'),
  pergunta text NOT NULL CHECK (btrim(pergunta) <> '' AND char_length(pergunta) <= 160),
  frases_gatilho text[] NOT NULL DEFAULT '{}'::text[] CHECK (public._agente_frases_ok(frases_gatilho)),
  -- um ramo ou os dois ("ambos" = {cliente, parceiro}); o tipo é o da triagem, que só tem cliente e parceiro
  ramos public.triagem_ramo[] NOT NULL DEFAULT ARRAY['cliente']::public.triagem_ramo[]
    CHECK (cardinality(ramos) BETWEEN 1 AND 2 AND (cardinality(ramos) = 1 OR ramos[1] <> ramos[2])),
  produto_id uuid REFERENCES public.produtos(id) ON DELETE SET NULL,
  familia text CHECK (familia IS NULL OR (btrim(familia) <> '' AND char_length(familia) <= 80)),
  resposta text NOT NULL CHECK (btrim(resposta) <> '' AND char_length(resposta) <= 600),
  status public.agente_resposta_status NOT NULL DEFAULT 'rascunho',
  texto_aprovado text,
  versao integer NOT NULL DEFAULT 1 CHECK (versao >= 1),
  aprovada_por uuid REFERENCES public.usuarios(id),
  aprovada_em timestamptz,
  origem text NOT NULL DEFAULT 'dono' CHECK (origem IN ('semente', 'dono', 'conversas')),
  contagem_ocorrencias integer NOT NULL DEFAULT 0 CHECK (contagem_ocorrencias >= 0),
  criado_em timestamptz NOT NULL DEFAULT now(),
  criado_por uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_por uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  -- aprovada exige quem, quando, o texto aprovado IGUAL à resposta e ao menos uma frase gatilho
  CONSTRAINT agente_aprovada_exige_rastro CHECK (
    status <> 'aprovada' OR (aprovada_por IS NOT NULL AND aprovada_em IS NOT NULL AND texto_aprovado IS NOT NULL
                             AND texto_aprovado = resposta AND cardinality(frases_gatilho) >= 1)),
  CONSTRAINT agente_so_aprovada_tem_texto_aprovado CHECK (
    status = 'aprovada' OR (texto_aprovado IS NULL AND aprovada_por IS NULL AND aprovada_em IS NULL))
);
-- um mesmo tema não se repete para os mesmos ramos e o mesmo produto, enquanto não estiver arquivado
CREATE UNIQUE INDEX agente_base_respostas_tema_unico ON public.agente_base_respostas
  (tema, ramos, (coalesce(produto_id, '00000000-0000-0000-0000-000000000000'::uuid))) WHERE status <> 'arquivada';
CREATE INDEX agente_base_respostas_status_idx ON public.agente_base_respostas (status, contagem_ocorrencias DESC);
CREATE INDEX agente_base_respostas_produto_idx ON public.agente_base_respostas (produto_id) WHERE produto_id IS NOT NULL;

COMMENT ON TABLE public.agente_base_respostas IS
  'Respostas que o dono aprovou, uma a uma, para o agente usar depois. Nunca tem preço, prazo em número, desconto nem orçamento. Escrita só por agente_resposta_*; nenhum consumidor chama ainda.';
COMMENT ON COLUMN public.agente_base_respostas.texto_aprovado IS 'Só existe com status aprovada e é sempre igual à resposta. Quem consumir a base lê só linhas aprovadas.';

CREATE TABLE public.agente_base_respostas_historico (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resposta_id uuid NOT NULL REFERENCES public.agente_base_respostas(id) ON DELETE RESTRICT,
  versao integer NOT NULL,
  evento text NOT NULL CHECK (evento IN ('criada', 'editada', 'aprovada', 'voltou_a_rascunho', 'editada_e_voltou_a_rascunho', 'arquivada', 'reaberta')),
  status public.agente_resposta_status NOT NULL,
  resposta text NOT NULL,
  frases_gatilho text[] NOT NULL,
  ramos public.triagem_ramo[] NOT NULL,
  produto_id uuid,
  familia text,
  -- sem chave para usuarios de propósito: a trilha sobrevive a quem sai da equipe
  por uuid,
  -- clock_timestamp e não now(): dois eventos na mesma transação (ensaio, aprovação logo depois da edição) precisam sair na ordem em que aconteceram
  em timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX agente_base_historico_resposta_idx ON public.agente_base_respostas_historico (resposta_id, em DESC);

-- 4. Validador -------------------------------------------------------------------------------------------------------
-- Devolve só CÓDIGOS de regra (nunca o trecho). Lista vazia = texto limpo. Ramo com cliente (ou os dois) valida como
-- cliente final, que é o mais estrito; só parceiro valida como parceiro. O código que carrega a palavra que a casa não usa
-- nunca sai daqui: vira palavra_que_a_casa_nao_usa.
--
-- Duas camadas. A primeira é a da triagem (_triagem_problemas_de_texto): reais, centavos, porcentagem, desconto, forma de
-- pagamento por nome, prazo com dígito e as palavras que o cliente final não lê. Nessa camada, preco_especial, preco_diferenciado
-- e tabela valem SÓ para o ramo cliente. A segunda é a PRÓPRIA do agente, abaixo, e vale para qualquer ramo: ela repete as
-- regras de preço especial, preço diferenciado e tabela sem olhar o ramo (parceiro não pode ouvir preço de custo nem tabela de
-- preços do agente), e acrescenta número por extenso, prazo, horário prometido e forma de pagamento. As palavras parceiro e
-- parceria continuam livres no ramo parceiro, porque só a camada da triagem as barra e só para o cliente final.
--
-- O que NÃO barra, de propósito: o horário da casa ("das 8h às 17h", "de segunda a sexta", "até 17h"), quantidades ("cem unidades",
-- "dez cores", "a partir de 100 unidades") e medidas ("90 x 60 cm", "300 dpi"), porque só viram problema junto de uma palavra de
-- preço, de prazo ou de pagamento. Quem lê e aprova é o dono: o validador barra o óbvio, não promete pegar tudo.
CREATE OR REPLACE FUNCTION public._agente_problemas_de_texto(p_texto text, p_ramos public.triagem_ramo[])
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ramo public.triagem_ramo := CASE WHEN 'cliente'::public.triagem_ramo = ANY (coalesce(p_ramos, ARRAY['cliente']::public.triagem_ramo[]))
                                     THEN 'cliente'::public.triagem_ramo ELSE 'parceiro'::public.triagem_ramo END;
  v_plano text := public._triagem_texto_plano(coalesce(p_texto, ''));
  v_base text[];
  v_out text[] := '{}';
  v_novos text[] := '{}';
  c text;
  -- números por extenso, sem "um" e "uma" (artigos: "o valor de um banner" não é preço)
  v_ext constant text := 'dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|catorze|quatorze|quinze|dezesseis|dezessete|dezoito|dezenove|vinte|trinta|quarenta|cinquenta|sessenta|setenta|oitenta|noventa|cem|cento|duzentos|duzentas|trezentos|trezentas|quatrocentos|quatrocentas|quinhentos|quinhentas|seiscentos|seiscentas|setecentos|setecentas|oitocentos|oitocentas|novecentos|novecentas|mil';
  -- o que vem depois de "a partir de N" e mostra que é quantidade ou medida, não preço
  v_unidade constant text := 'unidades?|pecas?|exemplares|folhas|copias|itens|metros?|m2|cm|mm|centimetros?|milimetros?|kg|quilos?|cores|vias|paginas|caixas|pacotes|rolos|blocos';
BEGIN
  v_base := public._triagem_problemas_de_texto(p_texto, v_ramo, false);
  FOREACH c IN ARRAY v_base LOOP
    c := CASE WHEN c LIKE 'reven%' THEN 'palavra_que_a_casa_nao_usa' ELSE c END;
    IF NOT (c = ANY (v_out)) THEN v_out := array_append(v_out, c); END IF;
  END LOOP;
  IF btrim(coalesce(p_texto, '')) = '' THEN
    RETURN v_out;
  END IF;
  IF v_plano ~ 'revend' AND NOT ('palavra_que_a_casa_nao_usa' = ANY (v_out)) THEN
    v_out := array_append(v_out, 'palavra_que_a_casa_nao_usa');
  END IF;

  -- PREÇO. Valor, preço, custo ou cobrança com número perto, em dígito ou por extenso.
  -- Barra: "o valor fica em 50", "custa cinquenta", "cobramos mil e quinhentos", "sai por 30", "fica por cem", "a partir de 20 a unidade", "a partir de cem a unidade".
  -- Passa: "a partir de 100 unidades", "o pedido mínimo é de cem unidades", "o orçamento tem duas cores" (orçamento só conta com dígito).
  IF v_plano ~ '\y(preco|precos|valor|valores|custa|custam|custo|custos|orcamento|cobramos|cobro)\y[^.!?]{0,40}\d'
     OR v_plano ~ ('\y(preco|precos|valor|valores|custa|custam|custo|custos|cobramos|cobro|cobrado|cobrada)\y[^.!?]{0,40}\y(' || v_ext || ')\y')
     -- "sai por 30", "fica por cem", "saem por duzentos"
     OR v_plano ~ ('\y(sai|saem|fica|ficam)\s+por\s+(\d|(' || v_ext || ')\y)')
     -- "a partir de 20 a unidade", "a partir de cem a unidade"; "a partir de 100 unidades" é quantidade e passa
     OR v_plano ~ ('\ya partir de\s+(\d+([.,]\d+)*(?![\d.,]*\d)|(' || v_ext || ')\y)(?!\s*(' || v_unidade || ')\y)') THEN
    v_novos := array_append(v_novos, 'preco_com_numero');
  END IF;
  -- MOEDA por extenso. Barra: "custa um real", "sai por dois contos", "cinquenta pilas".
  IF v_plano ~ ('\y(um|uma|' || v_ext || ')\s+(real|reais|conto|contos|pila|pilas|centavo|centavos)\y') THEN
    v_novos := array_append(v_novos, 'valor_em_reais');
  END IF;
  IF v_plano ~ '\y(gratis|gratuito|gratuita|de graca|sem custo|promocao|promocional|barato|barata|em conta|oferta|imperdivel|precinho)\y' THEN
    v_novos := array_append(v_novos, 'condicao_de_preco');
  END IF;
  IF v_plano ~ '\y(abatimento|abatemos|condicao especial|condicoes especiais)\y' THEN
    v_novos := array_append(v_novos, 'desconto_disfarcado');
  END IF;

  -- PREÇO ESPECIAL, DIFERENCIADO E TABELA, em qualquer ramo (a tabela de termos só os barra para o cliente final).
  -- Barra: "preço especial", "valor de atacado", "condições especiais", "preço de custo", "atacado", "preço diferenciado", "valores diferenciados", "tabela de preços", "tabela especial".
  -- Passa: "condições de parceiro", "a parceria começa pelo cadastro", "o cadastro de parceiro é rápido".
  IF v_plano ~ '\y(preco|precos|valor|valores|condicao|condicoes)\s+(especial|especiais|de custo|de atacado)\y'
     OR v_plano ~ '\yatacad[a-z]*\y' THEN
    v_novos := array_append(v_novos, 'preco_especial');
  END IF;
  IF v_plano ~ '\y(preco|precos|valor|valores|condicao|condicoes)\s+diferenciad[oa]s?\y' THEN
    v_novos := array_append(v_novos, 'preco_diferenciado');
  END IF;
  IF v_plano ~ '\ytabelas?\s+(de\s+)?(preco|precos|valor|valores|custo|custos)\y'
     OR v_plano ~ '\ytabelas?\s+(especial|especiais|diferenciad[oa]s?)\y' THEN
    v_novos := array_append(v_novos, 'tabela');
  END IF;

  -- PRAZO. O de dígito com dias, horas e semanas já vem de prazo_em_numero. Aqui entram o extenso, o abreviado e o marcado.
  -- Barra: "pronto em 48h", "em dois dias", "uma semana", "meia hora", "quinze minutos", "em 2h", "em até 36h", "pronto em 3d", "dia 15", "dia quinze", "mesmo dia", "esta semana", "amanhã".
  -- Passa: "das 8h às 17h", "até 17h", "de segunda a sexta", "impressão em 3D", "fechamos ao meio dia". Outra escolha: o 3d só é prazo em minúsculas depois de em, até ou prazo.
  IF v_plano ~ ('\y(um|uma|meia|' || v_ext || ')\s+(dias?|horas?|minutos?|segundos?|semanas?|quinzenas?|meses|mes)\y')
     OR v_plano ~ '\y\d+\s?(hrs?|hs)\y' OR v_plano ~ '\y(24|48|72)\s?h\y'
     OR v_plano ~ '\y\d+\s?(min|mins|minutos?|segundos?|seg)\y'
     OR v_plano ~ '\yem\s+\d+\s?h\y'
     OR v_plano ~ '\yate\s+(2[5-9]|[3-9]\d|\d{3,})\s?h\y'
     OR coalesce(p_texto, '') ~ '\y(em|ate|dentro de|prazo|prazo de|leva|levam|demora|demoram|pronto em)\s+\d+\s?(d|dd)\y'
     OR v_plano ~ '\ydia\s+\d{1,2}\y'
     OR v_plano ~ '\ydia\s+(um|dois|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|catorze|quatorze|quinze|dezesseis|dezessete|dezoito|dezenove|vinte|trinta)\y'
     OR v_plano ~ '\y(no mesmo dia|mesmo dia|amanha|depois de amanha|hoje mesmo|ainda hoje|na hora|em ate|em poucas horas|em poucos dias|esta semana|essa semana|nesta semana|nessa semana|semana que vem|proxima semana|proximo dia util|dia util seguinte)\y' THEN
    v_novos := array_append(v_novos, 'prazo_prometido');
  END IF;

  -- FORMA DE PAGAMENTO, com número perto (dígito ou extenso) e sem número.
  -- Barra: "pagamento à vista", "aceitamos cartão de crédito", "em três vezes", "em 3x", "metade na entrada", "pedimos um sinal", "pagamento em dinheiro", "pagar a entrada de 30".
  -- Passa: "forma de pagamento", "cartão de visita", "dar entrada no pedido", "a equipe combina o pagamento".
  IF v_plano ~ '\y(pagamento|pagar|pago|paga|pagam|sinal|entrada|a vista|cartao|parcelas?|vezes)\y[^.!?]{0,40}\d'
     OR v_plano ~ ('\y(pagamento|pagar|pago|paga|pagam|sinal|entrada|a vista|parcelas?|vezes)\y[^.!?]{0,40}\y(' || v_ext || '|metade)\y') THEN
    v_novos := array_append(v_novos, 'pagamento_com_numero');
  END IF;
  IF v_plano ~ '\ya vista\y'
     OR v_plano ~ '\y(a prazo|credito|debito|dinheiro|cheque|fiado|sinal)\y'
     OR v_plano ~ '\y(aceit[a-z]*|pag[a-z]*|passa[a-z]*|parcel[a-z]*)\s+(o |no |com |em |de )?cart(ao|oes)\y(?!\s+de\s+visitas?)'
     OR v_plano ~ ('\yem\s+(\d+|um|uma|' || v_ext || ')\s*(x|vezes)\y')
     OR v_plano ~ '\y(metade|meia|terco|um terco|dois tercos|um quarto|tres quartos)\y[^.!?]{0,30}\y(entrada|sinal|antes|adiantad[oa]|adiantamento|retirada|entrega|pedido|na hora)\y'
     OR v_plano ~ '\y(pagar|paga|pago|pagam|pagamos|cobramos|cobro|exige|exigimos|pedimos|pede|precisa de)\s+(a |uma |de |o |um )?entrada\y'
     OR v_plano ~ '\y(valor|parte|percentual)\s+(da|de|do)\s+entrada\y' THEN
    v_novos := array_append(v_novos, 'forma_de_pagamento');
  END IF;

  -- o agente nunca faz nem entrega orçamento: "segue o orçamento", "vou calcular o valor", "fiz o preço"
  IF v_plano ~ '\y(segue|enviei|envio|mando|vou (fazer|passar|montar|calcular|mandar)|fiz|calculei)\s+(o |a |um |uma |seu |sua )?(orcamento|valor|preco|cotacao)\y' THEN
    v_novos := array_append(v_novos, 'orcamento_feito_pelo_agente');
  END IF;

  FOREACH c IN ARRAY v_novos LOOP
    IF NOT (c = ANY (v_out)) THEN v_out := array_append(v_out, c); END IF;
  END LOOP;
  RETURN v_out;
END $function$;

-- 5. Gatilhos --------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._agente_base_antes_gravar()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_mudou boolean;
  v_p text[];
  v_liberadas text[];
BEGIN
  -- ramos em ordem fixa e sem repetição, para o índice de unicidade comparar igual
  NEW.ramos := coalesce((SELECT array_agg(DISTINCT r ORDER BY r) FROM unnest(NEW.ramos) AS r), NEW.ramos);
  NEW.tema := btrim(NEW.tema);
  NEW.pergunta := btrim(NEW.pergunta);
  NEW.resposta := btrim(NEW.resposta);
  NEW.familia := nullif(btrim(coalesce(NEW.familia, '')), '');

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'rascunho' THEN
      RAISE EXCEPTION 'A resposta nasce como rascunho: só o dono aprova, por agente_resposta_aprovar.';
    END IF;
    NEW.versao := 1;
    NEW.texto_aprovado := NULL;
    NEW.aprovada_por := NULL;
    NEW.aprovada_em := NULL;
    NEW.criado_em := now();
    NEW.atualizado_em := now();
    RETURN NEW;
  END IF;

  -- UPDATE
  NEW.id := OLD.id;
  NEW.criado_em := OLD.criado_em;
  NEW.criado_por := OLD.criado_por;
  v_mudou := (NEW.tema, NEW.pergunta, NEW.frases_gatilho, NEW.ramos, NEW.produto_id, NEW.familia, NEW.resposta)
             IS DISTINCT FROM (OLD.tema, OLD.pergunta, OLD.frases_gatilho, OLD.ramos, OLD.produto_id, OLD.familia, OLD.resposta);
  -- a versão sobe aqui e só aqui: quem chama não escolhe
  NEW.versao := CASE WHEN v_mudou THEN OLD.versao + 1 ELSE OLD.versao END;

  IF OLD.status = 'arquivada' AND NEW.status = 'aprovada' THEN
    RAISE EXCEPTION 'Uma resposta arquivada não vai direto a aprovada: volte a rascunho, leia e aprove de novo.';
  END IF;

  IF NEW.status = 'aprovada' AND OLD.status <> 'aprovada' THEN
    -- a aprovação só passa pela função, que marca a transação com o id (ou os ids, no ensaio de lote) que ela está aprovando
    v_liberadas := string_to_array(coalesce(current_setting('agente_base.aprovando', true), ''), ',');
    IF NOT (NEW.id::text = ANY (v_liberadas)) THEN
      RAISE EXCEPTION 'Aprovar só pela função agente_resposta_aprovar, que confere a versão que o dono viu e roda o validador.';
    END IF;
    IF NEW.aprovada_por IS NULL THEN
      RAISE EXCEPTION 'Aprovar exige saber quem aprovou.';
    END IF;
    v_p := public._agente_problemas_de_texto(NEW.resposta, NEW.ramos);
    IF cardinality(v_p) > 0 THEN
      RAISE EXCEPTION 'Texto recusado na aprovação: %', array_to_string(v_p, ', ') USING ERRCODE = 'check_violation';
    END IF;
    NEW.texto_aprovado := NEW.resposta;
    NEW.aprovada_em := now();
  ELSIF NEW.status = 'aprovada' AND OLD.status = 'aprovada' THEN
    IF v_mudou THEN
      -- qualquer mudança de conteúdo numa resposta aprovada a devolve a rascunho: o que o dono aprovou deixou de ser o que está escrito
      NEW.status := 'rascunho';
      NEW.texto_aprovado := NULL;
      NEW.aprovada_por := NULL;
      NEW.aprovada_em := NULL;
    ELSE
      NEW.texto_aprovado := OLD.texto_aprovado;
      NEW.aprovada_por := OLD.aprovada_por;
      NEW.aprovada_em := OLD.aprovada_em;
    END IF;
  ELSE
    NEW.texto_aprovado := NULL;
    NEW.aprovada_por := NULL;
    NEW.aprovada_em := NULL;
  END IF;
  NEW.atualizado_em := now();
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public._agente_base_historico()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_evento text;
  v_mudou boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_evento := 'criada';
  ELSE
    v_mudou := (NEW.tema, NEW.pergunta, NEW.frases_gatilho, NEW.ramos, NEW.produto_id, NEW.familia, NEW.resposta)
               IS DISTINCT FROM (OLD.tema, OLD.pergunta, OLD.frases_gatilho, OLD.ramos, OLD.produto_id, OLD.familia, OLD.resposta);
    IF OLD.status = 'aprovada' AND NEW.status = 'rascunho' THEN
      v_evento := CASE WHEN v_mudou THEN 'editada_e_voltou_a_rascunho' ELSE 'voltou_a_rascunho' END;
    ELSIF NEW.status = 'aprovada' AND OLD.status <> 'aprovada' THEN
      v_evento := 'aprovada';
    ELSIF NEW.status = 'arquivada' AND OLD.status <> 'arquivada' THEN
      v_evento := 'arquivada';
    ELSIF OLD.status = 'arquivada' AND NEW.status = 'rascunho' THEN
      v_evento := 'reaberta';
    ELSIF v_mudou THEN
      v_evento := 'editada';
    ELSE
      RETURN NULL;
    END IF;
  END IF;
  INSERT INTO public.agente_base_respostas_historico (resposta_id, versao, evento, status, resposta, frases_gatilho, ramos, produto_id, familia, por)
  VALUES (NEW.id, NEW.versao, v_evento, NEW.status, NEW.resposta, NEW.frases_gatilho, NEW.ramos, NEW.produto_id, NEW.familia,
          CASE WHEN v_evento = 'aprovada' THEN NEW.aprovada_por ELSE coalesce(NEW.atualizado_por, NEW.criado_por) END);
  RETURN NULL;
END $function$;

CREATE OR REPLACE FUNCTION public._agente_base_sem_apagar()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_TABLE_NAME = 'agente_base_respostas_historico' THEN
    RAISE EXCEPTION 'O histórico da base de respostas só cresce: não se muda nem se apaga (%).', TG_OP;
  END IF;
  RAISE EXCEPTION 'Resposta da base não se apaga (%): arquive, que o histórico fica.', TG_OP;
END $function$;

-- Defesa contra aprovar em lote: duas respostas virando aprovada na mesma instrução são recusadas, mesmo que alguém
-- consiga marcar as duas como liberadas.
CREATE OR REPLACE FUNCTION public._agente_base_uma_por_vez()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM novas n JOIN antigas a ON a.id = n.id WHERE n.status = 'aprovada' AND a.status <> 'aprovada';
  IF v_n > 1 THEN
    RAISE EXCEPTION 'Aprovação em lote não existe: cada resposta é lida e aprovada uma por vez (% na mesma instrução).', v_n;
  END IF;
  RETURN NULL;
END $function$;

CREATE TRIGGER tg_agente_base_antes_gravar BEFORE INSERT OR UPDATE ON public.agente_base_respostas
  FOR EACH ROW EXECUTE FUNCTION public._agente_base_antes_gravar();
CREATE TRIGGER tg_agente_base_historico AFTER INSERT OR UPDATE ON public.agente_base_respostas
  FOR EACH ROW EXECUTE FUNCTION public._agente_base_historico();
CREATE TRIGGER tg_agente_base_uma_por_vez AFTER UPDATE ON public.agente_base_respostas
  REFERENCING OLD TABLE AS antigas NEW TABLE AS novas
  FOR EACH STATEMENT EXECUTE FUNCTION public._agente_base_uma_por_vez();
CREATE TRIGGER tg_agente_base_sem_apagar BEFORE DELETE ON public.agente_base_respostas
  FOR EACH ROW EXECUTE FUNCTION public._agente_base_sem_apagar();
CREATE TRIGGER tg_agente_base_sem_truncate BEFORE TRUNCATE ON public.agente_base_respostas
  FOR EACH STATEMENT EXECUTE FUNCTION public._agente_base_sem_apagar();
CREATE TRIGGER tg_agente_historico_so_cresce BEFORE UPDATE OR DELETE ON public.agente_base_respostas_historico
  FOR EACH ROW EXECUTE FUNCTION public._agente_base_sem_apagar();
CREATE TRIGGER tg_agente_historico_sem_truncate BEFORE TRUNCATE ON public.agente_base_respostas_historico
  FOR EACH STATEMENT EXECUTE FUNCTION public._agente_base_sem_apagar();

-- 6. RLS e permissões de tabela --------------------------------------------------------------------------------------
ALTER TABLE public.agente_base_respostas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agente_base_respostas_historico ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agente_base_respostas FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.agente_base_respostas_historico FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.agente_base_respostas TO authenticated, service_role;
GRANT SELECT ON public.agente_base_respostas_historico TO authenticated, service_role;

CREATE POLICY "agente_base leitura equipe" ON public.agente_base_respostas
  FOR SELECT TO authenticated
  USING (public.is_staff((SELECT auth.uid()))
         AND (public.has_permission((SELECT auth.uid()), 'configuracoes.manage')
              OR public.has_permission((SELECT auth.uid()), 'whatsapp.manage')));
CREATE POLICY "agente_base_historico leitura equipe" ON public.agente_base_respostas_historico
  FOR SELECT TO authenticated
  USING (public.is_staff((SELECT auth.uid()))
         AND (public.has_permission((SELECT auth.uid()), 'configuracoes.manage')
              OR public.has_permission((SELECT auth.uid()), 'whatsapp.manage')));

-- 7. Funções de escrita, só service_role. A permissão de quem pediu é conferida aqui dentro. -------------------------
-- Quem pode o quê:
--   salvar, voltar a rascunho, arquivar : configuracoes.manage OU whatsapp.manage
--   aprovar                             : SÓ whatsapp.manage (hoje, só o admin)
CREATE OR REPLACE FUNCTION public.agente_resposta_salvar(
  p_usuario uuid, p_id uuid, p_tema text, p_pergunta text, p_frases text[], p_ramos public.triagem_ramo[],
  p_produto_id uuid, p_familia text, p_resposta text, p_versao_vista integer DEFAULT NULL, p_origem text DEFAULT 'dono')
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_frases text[];
  v_familia text := nullif(btrim(coalesce(p_familia, '')), '');
  v_antes public.agente_base_respostas%ROWTYPE;
  v_id uuid;
  v_versao integer;
  v_status public.agente_resposta_status;
BEGIN
  IF p_usuario IS NULL OR NOT (public.has_permission(p_usuario, 'configuracoes.manage') OR public.has_permission(p_usuario, 'whatsapp.manage')) THEN
    RAISE EXCEPTION 'Editar a base de respostas exige a permissão configuracoes.manage ou whatsapp.manage.';
  END IF;
  v_frases := coalesce((
    SELECT array_agg(d.f ORDER BY d.o)
      FROM (SELECT n.f, min(n.o) AS o
              FROM (SELECT public._triagem_normalizar_frase(u.x) AS f, u.o
                      FROM unnest(coalesce(p_frases, '{}'::text[])) WITH ORDINALITY AS u(x, o)) n
             WHERE n.f <> '' GROUP BY n.f) d), '{}'::text[]);
  IF p_produto_id IS NOT NULL THEN
    -- só id e família: nenhum preço é lido
    SELECT p.familia INTO v_familia FROM public.produtos p WHERE p.id = p_produto_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'O produto escolhido não existe.';
    END IF;
  END IF;
  IF p_origem NOT IN ('semente', 'dono', 'conversas') THEN
    RAISE EXCEPTION 'Origem desconhecida: %.', p_origem;
  END IF;
  BEGIN
    IF p_id IS NULL THEN
      INSERT INTO public.agente_base_respostas (tema, pergunta, frases_gatilho, ramos, produto_id, familia, resposta, origem, criado_por, atualizado_por)
      VALUES (p_tema, p_pergunta, v_frases, p_ramos, p_produto_id, v_familia, p_resposta, p_origem, p_usuario, p_usuario)
      RETURNING id, versao, status INTO v_id, v_versao, v_status;
    ELSE
      SELECT * INTO v_antes FROM public.agente_base_respostas WHERE id = p_id FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Essa resposta não existe.';
      END IF;
      IF p_versao_vista IS NOT NULL AND p_versao_vista <> v_antes.versao THEN
        RAISE EXCEPTION 'A resposta mudou depois que você a abriu (versão % no banco, você viu %). Recarregue antes de salvar.', v_antes.versao, p_versao_vista;
      END IF;
      UPDATE public.agente_base_respostas
         SET tema = p_tema, pergunta = p_pergunta, frases_gatilho = v_frases, ramos = p_ramos, produto_id = p_produto_id,
             familia = v_familia, resposta = p_resposta, atualizado_por = p_usuario
       WHERE id = p_id
       RETURNING id, versao, status INTO v_id, v_versao, v_status;
    END IF;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Já existe uma resposta desse tema para os mesmos ramos e o mesmo produto. Edite a que existe ou arquive aquela.';
  END;
  RETURN jsonb_build_object('ok', true, 'id', v_id, 'versao', v_versao, 'status', v_status,
    'voltou_a_rascunho', coalesce(v_antes.status = 'aprovada' AND v_status = 'rascunho', false),
    'problemas', to_jsonb(public._agente_problemas_de_texto(p_resposta, p_ramos)));
END $function$;

CREATE OR REPLACE FUNCTION public.agente_resposta_aprovar(
  p_usuario uuid, p_id uuid, p_versao_vista integer, p_texto_novo text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r public.agente_base_respostas%ROWTYPE;
  v_texto text;
  v_p text[];
  v_versao integer;
BEGIN
  IF p_usuario IS NULL OR NOT public.has_permission(p_usuario, 'whatsapp.manage') THEN
    RAISE EXCEPTION 'Aprovar resposta do agente exige a permissão whatsapp.manage (hoje, só o dono).';
  END IF;
  IF p_id IS NULL OR p_versao_vista IS NULL THEN
    RAISE EXCEPTION 'Aprovar exige o id da resposta e a versão que o dono viu.';
  END IF;
  SELECT * INTO r FROM public.agente_base_respostas WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Essa resposta não existe.';
  END IF;
  IF r.status <> 'rascunho' THEN
    RAISE EXCEPTION 'Só se aprova rascunho. Esta resposta está %.', r.status;
  END IF;
  IF r.versao <> p_versao_vista THEN
    RAISE EXCEPTION 'A resposta mudou depois que você a viu (versão % no banco, você viu %). Recarregue e leia de novo antes de aprovar.', r.versao, p_versao_vista;
  END IF;
  IF cardinality(r.frases_gatilho) < 1 THEN
    RAISE EXCEPTION 'Sem frase gatilho a resposta nunca seria usada: escreva ao menos uma antes de aprovar.';
  END IF;
  v_texto := coalesce(nullif(btrim(coalesce(p_texto_novo, '')), ''), r.resposta);
  v_p := public._agente_problemas_de_texto(v_texto, r.ramos);
  IF cardinality(v_p) > 0 THEN
    RAISE EXCEPTION 'Não aprovei: o texto tem problemas (%).', array_to_string(v_p, ', ') USING ERRCODE = 'check_violation';
  END IF;
  PERFORM set_config('agente_base.aprovando', p_id::text, true);
  UPDATE public.agente_base_respostas
     SET status = 'aprovada', resposta = v_texto, aprovada_por = p_usuario, atualizado_por = p_usuario
   WHERE id = p_id
   RETURNING versao INTO v_versao;
  PERFORM set_config('agente_base.aprovando', '', true);
  RETURN jsonb_build_object('ok', true, 'id', p_id, 'versao', v_versao, 'status', 'aprovada');
END $function$;

CREATE OR REPLACE FUNCTION public.agente_resposta_rascunho(p_usuario uuid, p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_versao integer;
BEGIN
  IF p_usuario IS NULL OR NOT (public.has_permission(p_usuario, 'configuracoes.manage') OR public.has_permission(p_usuario, 'whatsapp.manage')) THEN
    RAISE EXCEPTION 'Mexer na base de respostas exige a permissão configuracoes.manage ou whatsapp.manage.';
  END IF;
  BEGIN
    UPDATE public.agente_base_respostas SET status = 'rascunho', atualizado_por = p_usuario
     WHERE id = p_id RETURNING versao INTO v_versao;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Já existe outra resposta desse tema para os mesmos ramos e o mesmo produto: arquive ou edite aquela antes.';
  END;
  IF v_versao IS NULL THEN
    RAISE EXCEPTION 'Essa resposta não existe.';
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', p_id, 'versao', v_versao, 'status', 'rascunho');
END $function$;

CREATE OR REPLACE FUNCTION public.agente_resposta_arquivar(p_usuario uuid, p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_versao integer;
BEGIN
  IF p_usuario IS NULL OR NOT (public.has_permission(p_usuario, 'configuracoes.manage') OR public.has_permission(p_usuario, 'whatsapp.manage')) THEN
    RAISE EXCEPTION 'Mexer na base de respostas exige a permissão configuracoes.manage ou whatsapp.manage.';
  END IF;
  UPDATE public.agente_base_respostas SET status = 'arquivada', atualizado_por = p_usuario
   WHERE id = p_id RETURNING versao INTO v_versao;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Essa resposta não existe.';
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', p_id, 'versao', v_versao, 'status', 'arquivada');
END $function$;

REVOKE ALL ON FUNCTION public._agente_frases_ok(text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._agente_problemas_de_texto(text, public.triagem_ramo[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._agente_base_antes_gravar() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._agente_base_historico() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._agente_base_sem_apagar() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._agente_base_uma_por_vez() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agente_resposta_salvar(uuid, uuid, text, text, text[], public.triagem_ramo[], uuid, text, text, integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agente_resposta_aprovar(uuid, uuid, integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agente_resposta_rascunho(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agente_resposta_arquivar(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._agente_frases_ok(text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public._agente_problemas_de_texto(text, public.triagem_ramo[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.agente_resposta_salvar(uuid, uuid, text, text, text[], public.triagem_ramo[], uuid, text, text, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.agente_resposta_aprovar(uuid, uuid, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.agente_resposta_rascunho(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.agente_resposta_arquivar(uuid, uuid) TO service_role;

-- 8. Sementes: as 15 perguntas mais frequentes, todas RASCUNHO, ramo cliente, produto nulo ---------------------------------
-- contagem_ocorrencias = conversas de entrada (de 148, de 05/10 a 14/11/2026) em que a expressão do tema aparece pelo menos
-- uma vez. Só contagem: nenhuma mensagem, nome ou telefone foi copiado. Os textos são rascunhos escritos para o dono aprovar,
-- sem preço, sem prazo em número, sem desconto e sem orçamento; o que a casa não sabe vira "isso a equipe confirma".
DO $sementes$
DECLARE
  v_horario jsonb := public.whatsapp_horario_em_texto();
  v_atende text;
  v_endereco text;
  v_loja boolean;
BEGIN
  -- horário: da tabela viva de atendimento. Se não houver dia ligado, a resposta diz que a equipe confirma.
  IF coalesce(v_horario ->> 'abre', '') <> '' AND coalesce(v_horario ->> 'fecha', '') <> '' AND coalesce(v_horario ->> 'dias', '') <> '' THEN
    v_atende := format('A equipe atende %s, das %s às %s. Fora desse horário, deixe sua mensagem por aqui que a equipe vê quando abrir.',
                       v_horario ->> 'dias', v_horario ->> 'abre', v_horario ->> 'fecha');
  ELSE
    v_atende := 'O horário de atendimento a equipe confirma. Deixe sua mensagem por aqui que ela vê assim que puder.';
  END IF;
  -- endereço: do cadastro da empresa (rua com número, bairro e cidade). Se faltar rua ou cidade, a equipe confirma.
  SELECT nullif(btrim(concat_ws(', ', nullif(btrim(e.endereco), ''),
           CASE WHEN nullif(btrim(coalesce(e.bairro, '')), '') IS NOT NULL THEN 'bairro ' || btrim(e.bairro) END)), '') || ', em ' || nullif(btrim(e.cidade), ''),
         nullif(btrim(coalesce(e.endereco, '')), '') IS NOT NULL AND nullif(btrim(coalesce(e.cidade, '')), '') IS NOT NULL
    INTO v_endereco, v_loja
    FROM public.empresa_config e LIMIT 1;
  IF v_loja IS TRUE AND v_endereco IS NOT NULL THEN
    v_endereco := 'A Bex Print fica na ' || v_endereco || '. Se preferir, a equipe confirma como chegar.';
  ELSE
    v_endereco := 'O endereço a equipe confirma. Me diga que você quer ir até a loja que eu passo para ela.';
  END IF;

  INSERT INTO public.agente_base_respostas (tema, pergunta, frases_gatilho, ramos, familia, resposta, origem, contagem_ocorrencias)
  VALUES
    ('valor_do_produto', 'Quanto custa?',
     ARRAY['quanto custa','quanto fica','quanto sai','quanto e','quanto cobram','qual o valor','qual valor','qual o preco','qual preco','valor','preco']::text[],
     ARRAY['cliente']::public.triagem_ramo[], NULL,
     'Cada trabalho tem medida, material e quantidade próprios, então quem confirma o valor é a equipe, depois de entender o que você precisa. Me conte o produto, a medida e a quantidade que eu deixo anotado para ela.',
     'semente', 49),
    ('medida_do_produto', 'Qual medida posso pedir?',
     ARRAY['qual medida','que medida','qual tamanho','que tamanho','qual o tamanho','tamanho maximo','faz sob medida','medida personalizada','medida exata']::text[],
     ARRAY['cliente']::public.triagem_ramo[], NULL,
     'Me diga a largura e a altura que você precisa. A equipe confere se aquela medida é possível para o produto.',
     'semente', 39),
    ('como_pedir_orcamento', 'Como faço um orçamento?',
     ARRAY['orcamento','fazer orcamento','como faco orcamento','como faco um orcamento','quero orcar','queria orcar','pedir orcamento','cotacao']::text[],
     ARRAY['cliente']::public.triagem_ramo[], NULL,
     'Para a equipe montar o orçamento, preciso saber qual produto você quer, a medida, a quantidade e se você já tem a arte pronta. Pode mandar essas informações por aqui que eu passo para a equipe.',
     'semente', 24),
    ('item_fora_do_catalogo', 'Vocês fazem tal item?',
     ARRAY['voces fazem','vcs fazem','trabalham com','voces trabalham com','tem como fazer','da pra fazer','consegue fazer','conseguem fazer','voces vendem']::text[],
     ARRAY['cliente']::public.triagem_ramo[], NULL,
     'Vou anotar o que você procura para a equipe conferir se é um trabalho que a Bex Print faz. Descreva o item, a medida e a quantidade que você precisa.',
     'semente', 22),
    ('horario_de_atendimento', 'Qual o horário de atendimento?',
     ARRAY['horario','horario de atendimento','horario de funcionamento','que horas abre','que horas fecha','ate que horas','abre hoje','funciona hoje','estao abertos','esta aberto']::text[],
     ARRAY['cliente']::public.triagem_ramo[], NULL,
     v_atende, 'semente', 16),
    ('enviar_a_arte', 'Posso mandar minha arte?',
     ARRAY['posso mandar a arte','mandar a arte','enviar a arte','mandar minha arte','tenho a arte','minha arte','tenho a logo','tenho logo','mandar o layout','enviar o layout']::text[],
     ARRAY['cliente']::public.triagem_ramo[], NULL,
     'Pode sim. Mande a arte por aqui mesmo e a equipe confere se está boa para imprimir. Se você ainda não tem a arte, conte a ideia que a equipe vê como ajudar.',
     'semente', 15),
    ('forma_de_pagamento', 'Quais as formas de pagamento?',
     ARRAY['forma de pagamento','formas de pagamento','como pago','como posso pagar','aceitam pix','aceita cartao','voces parcelam','pagar no cartao','pagamento']::text[],
     ARRAY['cliente']::public.triagem_ramo[], NULL,
     'O pagamento é combinado a cada pedido, então quem explica as formas disponíveis é a equipe, junto com o orçamento.',
     'semente', 12),
    ('falar_com_a_equipe', 'Quero falar com uma pessoa',
     ARRAY['falar com atendente','falar com uma pessoa','falar com alguem','quero falar com','atendente','chama alguem','tem alguem ai']::text[],
     ARRAY['cliente']::public.triagem_ramo[], NULL,
     'Tudo bem, vou avisar a equipe que você quer falar com uma pessoa. Ela responde por aqui assim que puder.',
     'semente', 11),
    ('endereco_da_loja', 'Onde fica a loja?',
     ARRAY['endereco','onde fica','onde voces ficam','localizacao','como chego','qual a localizacao','mande a localizacao','passa o endereco']::text[],
     ARRAY['cliente']::public.triagem_ramo[], NULL,
     v_endereco, 'semente', 9),
    ('entrega_do_pedido', 'Vocês entregam?',
     ARRAY['voces entregam','entregam','fazem entrega','tem entrega','entrega em casa','frete','mandam pelo correio']::text[],
     ARRAY['cliente']::public.triagem_ramo[], NULL,
     'A equipe confirma se a entrega é possível para o seu endereço e como ela funciona. Me diga o bairro e o produto que você quer receber, que eu passo para ela.',
     'semente', 9),
    ('formato_do_arquivo', 'Qual formato de arquivo aceitam?',
     ARRAY['qual formato','que formato','formato do arquivo','formato de arquivo','aceitam pdf','aceita pdf','corel','vetor','resolucao']::text[],
     ARRAY['cliente']::public.triagem_ramo[], NULL,
     'Costuma servir arquivo em PDF, em vetor ou em imagem com boa resolução. Mande o que você tiver que a equipe confere se serve para imprimir.',
     'semente', 8),
    ('quantidade_minima', 'Tem quantidade mínima?',
     ARRAY['quantidade minima','tem minimo','pedido minimo','minimo','a partir de quantas','quantas unidades','quantidade menor']::text[],
     ARRAY['cliente']::public.triagem_ramo[], NULL,
     'A quantidade mínima muda de produto para produto, e quem confirma é a equipe. Me diga o que você quer fazer e quantas unidades pensa em pedir, que eu passo para ela.',
     'semente', 8),
    ('prazo_do_pedido', 'Qual o prazo?',
     ARRAY['qual o prazo','prazo','prazo de entrega','quanto tempo demora','demora quanto','quando fica pronto','quando ficaria pronto','para quando fica']::text[],
     ARRAY['cliente']::public.triagem_ramo[], NULL,
     'O prazo depende do produto, da quantidade e da fila de produção, então quem confirma é a equipe, depois de ver o que você precisa. Me conte o que você quer fazer que eu passo para ela.',
     'semente', 7),
    ('instalacao', 'Vocês fazem a instalação?',
     ARRAY['instalacao','voces instalam','fazem instalacao','tem instalacao','instalam','colocam','aplicacao','voces aplicam']::text[],
     ARRAY['cliente']::public.triagem_ramo[], 'Instalação e deslocamento',
     'A Bex Print tem serviço de instalação e deslocamento, e a equipe confirma se atende o seu caso. Conte o que seria instalado e onde, que eu passo para ela.',
     'semente', 7),
    ('exemplos_e_catalogo', 'Tem exemplos ou catálogo?',
     ARRAY['catalogo','portfolio','portifolio','exemplos','tem exemplo','amostra','fotos dos trabalhos','trabalhos feitos','tem foto']::text[],
     ARRAY['cliente']::public.triagem_ramo[], NULL,
     'A equipe pode mostrar exemplos de trabalhos parecidos com o que você procura. Me diga o produto que você quer ver que eu passo o pedido para ela.',
     'semente', 6);
END $sementes$;

-- 9. Conferência: se algo estiver fora do esperado, desfaz tudo ---------------------------------------------------------
DO $confere$
DECLARE
  v_n integer;
  v_x text;
BEGIN
  -- sementes: 15 rascunhos, nenhuma aprovada, todas passam no validador, todas de ramo cliente, produto nulo
  SELECT count(*) INTO v_n FROM public.agente_base_respostas;
  IF v_n <> 15 THEN RAISE EXCEPTION 'esperava 15 sementes, achei %', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.agente_base_respostas WHERE status <> 'rascunho' OR origem <> 'semente' OR produto_id IS NOT NULL
     OR ramos <> ARRAY['cliente']::public.triagem_ramo[] OR texto_aprovado IS NOT NULL OR aprovada_por IS NOT NULL;
  IF v_n <> 0 THEN RAISE EXCEPTION 'semente fora do combinado (aprovada, de outra origem, com produto ou fora do ramo cliente): %', v_n; END IF;
  SELECT string_agg(tema, ', ') INTO v_x FROM public.agente_base_respostas WHERE cardinality(public._agente_problemas_de_texto(resposta, ramos)) > 0;
  IF v_x IS NOT NULL THEN RAISE EXCEPTION 'semente reprovada pelo validador: %', v_x; END IF;
  SELECT count(*) INTO v_n FROM public.agente_base_respostas WHERE cardinality(frases_gatilho) < 3;
  IF v_n <> 0 THEN RAISE EXCEPTION 'semente com menos de 3 frases gatilho: %', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.agente_base_respostas_historico WHERE evento = 'criada';
  IF v_n <> 15 THEN RAISE EXCEPTION 'esperava 15 linhas de histórico criada, achei %', v_n; END IF;

  -- o validador pega o que deve e não devolve código com a palavra proibida
  IF NOT ('preco_com_numero' = ANY (public._agente_problemas_de_texto('O valor fica em 50 para você.', ARRAY['cliente']::public.triagem_ramo[]))) THEN
    RAISE EXCEPTION 'o validador não pegou preço com número'; END IF;
  IF NOT ('palavra_que_a_casa_nao_usa' = ANY (public._agente_problemas_de_texto('Trabalhamos com revenda de brindes.', ARRAY['cliente']::public.triagem_ramo[]))
     AND NOT EXISTS (SELECT 1 FROM unnest(public._agente_problemas_de_texto('Trabalhamos com revenda de brindes.', ARRAY['cliente']::public.triagem_ramo[])) AS c WHERE c LIKE 'reven%')) THEN
    RAISE EXCEPTION 'o validador não trocou o código da palavra proibida'; END IF;
  IF NOT ('palavra_que_a_casa_nao_usa' = ANY (public._agente_problemas_de_texto('Trabalhamos com revenda de brindes.', ARRAY['parceiro']::public.triagem_ramo[]))) THEN
    RAISE EXCEPTION 'o validador do ramo parceiro não pegou a palavra proibida'; END IF;
  IF cardinality(public._agente_problemas_de_texto('Pode mandar a arte por aqui que a equipe confere se está boa para imprimir.', ARRAY['cliente']::public.triagem_ramo[])) <> 0 THEN
    RAISE EXCEPTION 'o validador reprovou um texto limpo'; END IF;

  -- tabelas: RLS ligada, ninguém de fora escreve, service_role só lê (escreve pelas funções)
  SELECT count(*) INTO v_n FROM pg_class c WHERE c.oid IN ('public.agente_base_respostas'::regclass, 'public.agente_base_respostas_historico'::regclass) AND c.relrowsecurity;
  IF v_n <> 2 THEN RAISE EXCEPTION 'RLS desligada em alguma tabela da base'; END IF;
  SELECT count(*) INTO v_n FROM (VALUES ('public.agente_base_respostas'), ('public.agente_base_respostas_historico')) t(nome),
       (VALUES ('anon'), ('authenticated'), ('service_role')) r(papel),
       (VALUES ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) p(priv)
   WHERE has_table_privilege(r.papel, t.nome, p.priv);
  IF v_n <> 0 THEN RAISE EXCEPTION 'algum papel de fora ou o service_role escreve direto na base (% permissões)', v_n; END IF;
  IF has_table_privilege('anon', 'public.agente_base_respostas', 'SELECT') OR NOT has_table_privilege('authenticated', 'public.agente_base_respostas', 'SELECT') THEN
    RAISE EXCEPTION 'a leitura da base está errada: anon não lê e a equipe autenticada lê'; END IF;

  -- funções: uma de cada, definer onde deve, search_path, ACL
  SELECT count(*) INTO v_n FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN
    ('agente_resposta_salvar', 'agente_resposta_aprovar', 'agente_resposta_rascunho', 'agente_resposta_arquivar', '_agente_problemas_de_texto', '_agente_frases_ok',
     '_agente_base_antes_gravar', '_agente_base_historico', '_agente_base_sem_apagar', '_agente_base_uma_por_vez');
  IF v_n <> 10 THEN RAISE EXCEPTION 'esperava 10 funções (uma de cada, sem sobrecarga), achei %', v_n; END IF;
  SELECT string_agg(p.proname, ', ') INTO v_x FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname ~ '^_?agente_'
     AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  IF v_x IS NOT NULL THEN RAISE EXCEPTION 'anon ou authenticated executa: %', v_x; END IF;
  SELECT string_agg(p.proname, ', ') INTO v_x FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('agente_resposta_salvar', 'agente_resposta_aprovar', 'agente_resposta_rascunho', 'agente_resposta_arquivar')
     AND (NOT p.prosecdef OR p.proconfig IS NULL OR NOT ('search_path=public' = ANY (p.proconfig)) OR NOT has_function_privilege('service_role', p.oid, 'EXECUTE'));
  IF v_x IS NOT NULL THEN RAISE EXCEPTION 'função de escrita sem SECURITY DEFINER, search_path ou EXECUTE do service_role: %', v_x; END IF;

  -- gatilhos
  SELECT count(*) INTO v_n FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN ('public.agente_base_respostas'::regclass, 'public.agente_base_respostas_historico'::regclass);
  IF v_n <> 7 THEN RAISE EXCEPTION 'esperava 7 gatilhos, achei %', v_n; END IF;

  -- nada de preço na estrutura
  SELECT string_agg(column_name, ', ') INTO v_x FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name IN ('agente_base_respostas', 'agente_base_respostas_historico')
     AND (column_name ~ 'preco|valor|custo|desconto|orcamento' OR column_name LIKE '%revend%');
  IF v_x IS NOT NULL THEN RAISE EXCEPTION 'coluna que não deveria existir: %', v_x; END IF;
END $confere$;

COMMIT;
