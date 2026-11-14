-- NÃO APLICADA. Roteiro de ensaio: docs/ensaio-agente-escolhe.md, seção 9.
-- ORDEM: depois de 20261114120000_agente_base_de_respostas.sql (a função que esta migração troca, já aplicada). Não depende da C3 nem da C4,
-- mas vale antes de o dono aprovar as respostas: o que ela barra passa a valer na aprovação, no envio e na conferência da fila.
--
-- O VALIDADOR DE TEXTO DO AGENTE, MAIS FIRME (Bex Print, C3.1)
--
-- O QUE É: o validador `_agente_problemas_de_texto` barra o óbvio, e uma revisão achou frases que o agente nunca poderia mandar e que
-- ele deixava passar: "Faço o orçamento", "Preparo o orçamento", "te passo o valor" (o agente fazendo ou entregando orçamento por um
-- verbo que a regra antiga não cobria), "sai hoje" e "no outro dia" (prazo sem número), "competitivo", "taxa de", "custa pouco" e
-- "preço bom" (condição de preço sem número). Esta migração acrescenta as regras que faltam, sem tirar nenhuma das que já existiam.
--
-- O VALIDADOR É UMA ÚLTIMA PORTA PARCIAL. Ele barra o que alguém já pensou em barrar; não entende frase. A garantia real de que o agente
-- nunca cita preço nem prazo é o dono LER cada resposta antes de aprová-la: só a resposta aprovada sai, palavra por palavra. Nenhuma
-- lista de palavras substitui isso, e esta migração não promete pegar tudo.
--
-- POR TROCA NA DEFINIÇÃO VIVA (lição ler-funcao-viva-nao-migracao): a função tem mais de 7 mil letras e outras migrações a usam
-- (a aprovação da C2, o ensaio e a C3). Em vez de recopiar o corpo, a migração LÊ a definição viva, confere o md5 do corpo contra
-- o lido em 14/11/2026 (e7cd527d465584a7d0ff8e470263616d), confere que a âncora existe UMA vez e insere um bloco novo antes dela.
-- Se o corpo vivo for outro, alguém mexeu depois: a migração para sem trocar nada. Rodar duas vezes não faz nada na segunda.
--
-- O QUE ENTRA (todas sobre o texto sem acento e em minúsculas, para qualquer ramo):
--   orcamento_feito_pelo_agente  faço, fazemos, fiz, farei, preparo, preparamos, preparei, passo, passamos, passei, monto, montamos,
--                                montei, calculo, calculamos, calculei (e vou, vamos, posso, irei mais fazer, preparar, passar,
--                                montar, calcular, enviar, mandar) seguidos de orçamento, valor, preço ou cotação:
--                                "Faço o orçamento", "Preparo o orçamento", "te passo o valor", "vou preparar o orçamento".
--                                NÃO barra o infinitivo solto nem a equipe como sujeito: "Para a equipe montar o orçamento, me conte o
--                                produto" e "a equipe faz o orçamento" continuam passando (a primeira é uma das 15 respostas semente).
--   prazo_prometido              sai hoje, saem amanhã, "no outro dia", "no dia seguinte".
--   condicao_de_preco            competitivo, competitiva, competitividade; custa pouco, custam pouco; preço bom, bom preço, preço justo,
--                                preço baixo, preço camarada, o melhor preço.
--   taxa_cobrada                 "taxa de" (taxa de entrega, taxa de urgência...), com a palavra no plural também.
--
-- O QUE NÃO MUDA: nenhuma outra função, tabela, gatilho, coluna ou dado. A ACL e o search_path da função são os mesmos (CREATE OR
-- REPLACE preserva). O espelho em TypeScript é src/domain/whatsapp/triagem/verificador.ts (escopo completo, nunca o escopo triagem).
-- A conferência no fim desfaz tudo se as 15 respostas semente (ou qualquer resposta não arquivada) passarem a ter problema, ou se
-- qualquer frase nova passar sem ser barrada.

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $migracao$
DECLARE
  v_oid oid := to_regprocedure('public._agente_problemas_de_texto(text, public.triagem_ramo[])');
  v_def text;
  v_ancora constant text := E'  FOREACH c IN ARRAY v_novos LOOP\n';
  v_marca constant text := '-- C3.1: validador mais firme';
  v_md5_lido constant text := 'e7cd527d465584a7d0ff8e470263616d';
  v_n integer;
  v_bloco constant text := $bloco$
  -- C3.1: validador mais firme (15/11/2026). Última porta PARCIAL: a garantia real é o dono ler cada resposta antes de aprovar.
  -- ORÇAMENTO FEITO PELO AGENTE, por mais verbos. Barra: "faço o orçamento", "preparo o orçamento", "te passo o valor", "monto o orçamento",
  -- "calculo o preço", "vou preparar o orçamento". Passa: "para a equipe montar o orçamento", "a equipe faz o orçamento", "eu passo para a equipe".
  IF v_plano ~ '\y(faco|fazemos|fiz|fizemos|farei|faremos|preparo|preparamos|preparei|prepararei|passo|passamos|passei|passarei|monto|montamos|montei|montarei|calculo|calculamos|calculei|calcularei)\s+(te |lhe |ja |logo )?(o |a |um |uma |seu |sua |o seu |a sua |esse |este )?(orcamento|orcamentos|valor|valores|preco|precos|cotacao)\y'
     OR v_plano ~ '\y(vou|vamos|posso|irei|iremos)\s+(te |lhe |ja )?(fazer|preparar|passar|montar|calcular|enviar|mandar)\s+(te |lhe )?(o |a |um |uma |seu |sua )?(orcamento|orcamentos|valor|valores|preco|precos|cotacao)\y' THEN
    v_novos := array_append(v_novos, 'orcamento_feito_pelo_agente');
  END IF;
  -- PRAZO SEM NÚMERO. Barra: "sai hoje", "saem amanhã", "no outro dia", "no dia seguinte". Passa: "hoje", "amanhã" soltos já têm regra própria; "sai da fila" passa.
  IF v_plano ~ '\y(sai|saem|saira|sairao)\s+(hoje|amanha|no mesmo dia)\y'
     OR v_plano ~ '\y(no outro dia|no dia seguinte)\y' THEN
    v_novos := array_append(v_novos, 'prazo_prometido');
  END IF;
  -- CONDIÇÃO DE PREÇO SEM NÚMERO. Barra: "preço competitivo", "custa pouco", "preço bom", "bom preço", "preço justo", "o melhor preço".
  IF v_plano ~ '\ycompetitiv[a-z]*\y'
     OR v_plano ~ '\y(custa|custam)\s+(muito\s+)?pouco\y'
     OR v_plano ~ '\ypreco\s+(bom|bons|justo|justos|baixo|baixos|camarada|camaradas|acessivel|acessiveis)\y'
     OR v_plano ~ '\y(bom|bons|otimo|otimos|melhor|melhores|baixo|baixos|justo|justos|camarada|camaradas)\s+(preco|precos)\y' THEN
    v_novos := array_append(v_novos, 'condicao_de_preco');
  END IF;
  -- TAXA. Barra: "taxa de entrega", "a taxa de urgência". Passa: "a equipe confirma se tem alguma taxa" (sem "de").
  IF v_plano ~ '\ytaxas?\s+de\y' THEN
    v_novos := array_append(v_novos, 'taxa_cobrada');
  END IF;

$bloco$;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'A função _agente_problemas_de_texto não existe: aplique antes a migração 20261114120000.';
  END IF;
  v_def := pg_get_functiondef(v_oid);
  IF position(v_marca IN v_def) > 0 THEN
    RAISE NOTICE 'O validador já está mais firme: nada a fazer.';
    RETURN;
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = v_oid) <> v_md5_lido THEN
    RAISE EXCEPTION 'O corpo vivo de _agente_problemas_de_texto mudou desde 14/11/2026 (md5 lido %): releia o corpo vivo antes de trocar.', v_md5_lido;
  END IF;
  v_n := (length(v_def) - length(replace(v_def, v_ancora, ''))) / length(v_ancora);
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'Esperava a âncora do fim das regras UMA vez no corpo vivo, achei % vezes: nada foi trocado.', v_n;
  END IF;
  EXECUTE replace(v_def, v_ancora, v_bloco || v_ancora);
END $migracao$;

-- Conferência: se algo estiver fora do esperado, desfaz tudo -----------------------------------------------------------------------
DO $confere$
DECLARE
  v_oid oid := to_regprocedure('public._agente_problemas_de_texto(text, public.triagem_ramo[])');
  v_n integer;
  v_x text;
  v_cli public.triagem_ramo[] := ARRAY['cliente']::public.triagem_ramo[];
  v_par public.triagem_ramo[] := ARRAY['parceiro']::public.triagem_ramo[];
  f record;
BEGIN
  SELECT count(*) INTO v_n FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = '_agente_problemas_de_texto';
  IF v_n <> 1 THEN RAISE EXCEPTION '_agente_problemas_de_texto tem % versões (esperado 1)', v_n; END IF;
  IF position('-- C3.1: validador mais firme' IN (SELECT prosrc FROM pg_proc WHERE oid = v_oid)) = 0 THEN
    RAISE EXCEPTION 'o bloco novo não entrou no corpo da função';
  END IF;
  -- o corpo novo é determinístico: o corpo lido em 14/11/2026 mais o bloco acima. Se o md5 for outro, a troca saiu diferente do ensaio.
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = v_oid) <> '92b7101a1208c7c747c2a6f891421494' THEN
    RAISE EXCEPTION 'o corpo novo de _agente_problemas_de_texto não tem o md5 do ensaio';
  END IF;
  IF has_function_privilege('anon', v_oid, 'EXECUTE') OR has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR has_function_privilege('public', v_oid, 'EXECUTE') OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'a ACL de _agente_problemas_de_texto mudou';
  END IF;
  IF NOT (SELECT proconfig IS NOT NULL AND 'search_path=public' = ANY (proconfig) AND NOT prosecdef FROM pg_proc WHERE oid = v_oid) THEN
    RAISE EXCEPTION 'o search_path ou o modo de segurança de _agente_problemas_de_texto mudou';
  END IF;

  -- cada frase nova é barrada, com o código esperado, nos dois ramos
  FOR f IN SELECT * FROM (VALUES
      ('Faço o orçamento para você.', 'orcamento_feito_pelo_agente'),
      ('Preparo o orçamento agora.', 'orcamento_feito_pelo_agente'),
      ('Eu te passo o valor depois.', 'orcamento_feito_pelo_agente'),
      ('Monto o orçamento e te mando.', 'orcamento_feito_pelo_agente'),
      ('Calculo o preço para você.', 'orcamento_feito_pelo_agente'),
      ('Vou preparar o orçamento hoje.', 'orcamento_feito_pelo_agente'),
      ('O pedido sai hoje.', 'prazo_prometido'),
      ('Entregamos no outro dia.', 'prazo_prometido'),
      ('Nosso preço é competitivo.', 'condicao_de_preco'),
      ('Isso custa pouco.', 'condicao_de_preco'),
      ('Temos um preço bom.', 'condicao_de_preco'),
      ('Há uma taxa de entrega.', 'taxa_cobrada')) AS q(frase, codigo)
  LOOP
    IF NOT (f.codigo = ANY (public._agente_problemas_de_texto(f.frase, v_cli)))
       OR NOT (f.codigo = ANY (public._agente_problemas_de_texto(f.frase, v_par))) THEN
      RAISE EXCEPTION 'a frase "%" devia ser barrada com %', f.frase, f.codigo;
    END IF;
  END LOOP;

  -- o que precisa continuar passando passa
  FOR f IN SELECT * FROM (VALUES
      ('Para a equipe montar o orçamento, preciso saber qual produto você quer, a medida e a quantidade. Pode mandar por aqui que eu passo para a equipe.'),
      ('A equipe faz o orçamento depois de ver o pedido.'),
      ('Me diga o produto que você quer ver que eu passo o pedido para ela.'),
      ('A equipe atende de segunda a sexta, das 8h às 18h.'),
      ('Pode mandar a arte por aqui que a equipe confere se está boa para imprimir.')) AS q(frase)
  LOOP
    IF cardinality(public._agente_problemas_de_texto(f.frase, v_cli)) > 0 THEN
      RAISE EXCEPTION 'a frase "%" devia passar e foi barrada: %', f.frase, public._agente_problemas_de_texto(f.frase, v_cli);
    END IF;
  END LOOP;

  -- as respostas que existem (as 15 sementes e o que o dono escreveu depois): nenhuma não arquivada pode passar a ter problema
  SELECT string_agg(tema, ', ') INTO v_x FROM public.agente_base_respostas
   WHERE status <> 'arquivada' AND cardinality(public._agente_problemas_de_texto(resposta, ramos)) > 0;
  IF v_x IS NOT NULL THEN
    RAISE EXCEPTION 'o validador mais firme barra respostas que já existem (releia e reescreva antes de aplicar): %', v_x;
  END IF;
  SELECT string_agg(tema, ', ') INTO v_x FROM public.agente_base_respostas
   WHERE status = 'aprovada' AND texto_aprovado IS NOT NULL AND cardinality(public._agente_problemas_de_texto(texto_aprovado, ramos)) > 0;
  IF v_x IS NOT NULL THEN
    RAISE EXCEPTION 'o validador mais firme barra respostas aprovadas: %', v_x;
  END IF;
END $confere$;

COMMIT;
