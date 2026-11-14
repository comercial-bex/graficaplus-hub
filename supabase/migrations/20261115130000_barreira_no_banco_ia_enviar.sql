-- APLICADA no banco vivo em 15/11/2026, pelo texto exato deste arquivo (provas no roteiro, seção 6). Roteiro de ensaio: docs/ensaio-barreira-ia-enviar.md.
-- ORDEM: depois de 20261115120000_agente_validador_mais_firme.sql (a função `_agente_problemas_de_texto` que esta migração chama).
-- Pode ir antes ou depois do Publish: o código novo só passa a tratar a recusa como "reprovado pelas regras" (a conversa vai para a equipe);
-- sem ele, a recusa cai no catch do assistente (log com erro, nada enviado), que é o que já acontece com qualquer falha de enfileirar.
--
-- A BARREIRA NO BANCO DO ENVIO DA ASSISTENTE DE TEXTO LIVRE (Bex Print)
--
-- REGRA DO DONO: nenhum envio automático ao contato cita preço, prazo, pagamento nem orçamento. O validador de texto já existe no código do
-- servidor (verificarSaida, antes de chamar o banco) e no banco (`_agente_problemas_de_texto`, usado pelo agente e pela base de respostas).
-- Faltava a porta da assistente de texto livre: `whatsapp_ia_enviar` gravava a mensagem e a fila do texto que recebesse, sem conferir nada.
-- Quem chamasse a função com a chave de serviço (outra rota, outra sessão, um erro de código) enfileirava o que quisesse.
--
-- O QUE MUDA: UMA função, `whatsapp_ia_enviar(uuid, text, jsonb)`. Logo depois da checagem de texto vazio, e ANTES de pegar a trava da conversa
-- e de gravar qualquer linha, ela chama `_agente_problemas_de_texto(texto, ARRAY['cliente'])` (o ramo mais estrito, o mesmo do verificador do
-- servidor) sobre exatamente o texto que seria gravado (os primeiros 4.096 caracteres). Lista vazia: segue como sempre. Qualquer regra, ou o
-- validador sem resposta: a função recusa com `texto_reprovado_pela_barreira: <regras>`. Só o NOME das regras vai na mensagem, nunca o texto.
-- Recusar é lançar exceção antes de qualquer escrita: nada fica gravado, nem mensagem, nem fila, nem resumo da conversa.
--
-- O QUE NÃO MUDA, e por quê isso é seguro: `whatsapp_ia_enviar` só é chamada por UM lugar, o servidor da assistente de texto livre
-- (`src/lib/api/whatsapp-assistente.server.ts`). Nenhuma função SQL a chama (conferido em pg_proc), nenhum cron a chama, e hoje não existe
-- uma mensagem com origem 'ia' nem uma linha de fila 'ia:%' no banco. Mensagem de equipe humana (`whatsapp_responder`,
-- `whatsapp_responder_arquivo`, `_wa_enfileirar_mensagem_da_equipe`), triagem (`triagem_enviar`, `triagem_varrer`), agente
-- (`agente_registrar`, `agente_varrer`), cobrança, lembretes e notificações NÃO passam por esta função: continuam exatamente como estavam.
-- Esta migração troca uma função e não toca em tabela, gatilho, coluna, política, tipo nem em nenhuma outra função.
--
-- A BARREIRA É UMA ÚLTIMA PORTA PARCIAL, como o validador: barra o que alguém já pensou em barrar, não entende frase. A garantia de verdade
-- é a assistente receber só o que não tem preço nem prazo e o dono manter a assistente desligada até confiar. A barreira só garante que
-- o que o validador conhece não sai por esta porta, por nenhum chamador.
--
-- FALHA FECHADA: se o validador lançar erro (regex, tabela de termos), a função lança junto e nada é enviado. A assistente passa a
-- pedir ajuda à equipe em vez de mandar texto sem conferência. Hoje a assistente está desligada (`ia_ativa = false`), então nada muda
-- na prática até o dono ligar.
--
-- POR TROCA NA DEFINIÇÃO VIVA (lição ler-funcao-viva-nao-migracao): a migração LÊ a definição viva, confere o md5 do corpo contra o lido em
-- 15/11/2026 (d841150f076a0f67022f51353aad5951), confere que a âncora existe UMA vez e insere o bloco novo depois dela. Se o corpo vivo for
-- outro, alguém mexeu depois: para sem trocar nada. Rodar duas vezes não faz nada na segunda. `CREATE OR REPLACE` preserva dono, ACL e
-- search_path; a conferência final confirma, e o REVOKE e o GRANT são reaplicados pelo nome, só service_role executa.
--
-- COMO DESFAZER: o bloco de volta do roteiro (seção 4) devolve o corpo de 15/11/2026, com o md5 d841150f076a0f67022f51353aad5951.

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $migracao$
DECLARE
  v_oid oid := to_regprocedure('public.whatsapp_ia_enviar(uuid, text, jsonb)');
  v_def text;
  v_ancora constant text := $a$  IF v_texto = '' THEN RAISE EXCEPTION 'Texto vazio.'; END IF;
$a$;
  v_marca constant text := '-- BARREIRA NO BANCO (15/11/2026)';
  v_md5_lido constant text := 'd841150f076a0f67022f51353aad5951';
  v_n integer;
  v_bloco constant text := $bloco$
  -- BARREIRA NO BANCO (15/11/2026): nenhum texto da assistente entra na mensagem nem na fila sem passar pelo validador da casa.
  -- Lista vazia segue. Qualquer regra, ou validador sem resposta, recusa ANTES da trava da conversa e de qualquer escrita. Só o nome da regra vai na mensagem.
  DECLARE
    v_regras text[] := public._agente_problemas_de_texto(left(v_texto, 4096), ARRAY['cliente']::public.triagem_ramo[]);
  BEGIN
    IF v_regras IS NULL OR cardinality(v_regras) > 0 THEN
      RAISE EXCEPTION 'texto_reprovado_pela_barreira: %', coalesce(array_to_string(v_regras, ','), 'validador_sem_resposta')
        USING HINT = 'Nenhum envio automático cita preço, prazo, pagamento ou orçamento. Nada foi gravado.';
    END IF;
  END;
$bloco$;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'A função whatsapp_ia_enviar(uuid, text, jsonb) não existe.';
  END IF;
  IF to_regprocedure('public._agente_problemas_de_texto(text, public.triagem_ramo[])') IS NULL THEN
    RAISE EXCEPTION 'A função _agente_problemas_de_texto não existe: aplique antes a migração 20261114120000.';
  END IF;
  v_def := pg_get_functiondef(v_oid);
  IF position(v_marca IN v_def) > 0 THEN
    RAISE NOTICE 'A barreira já está em whatsapp_ia_enviar: nada a fazer.';
    RETURN;
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = v_oid) <> v_md5_lido THEN
    RAISE EXCEPTION 'O corpo vivo de whatsapp_ia_enviar mudou desde 15/11/2026 (md5 lido %): releia o corpo vivo antes de trocar.', v_md5_lido;
  END IF;
  v_n := (length(v_def) - length(replace(v_def, v_ancora, ''))) / length(v_ancora);
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'Esperava a âncora da checagem de texto vazio UMA vez no corpo vivo, achei % vezes: nada foi trocado.', v_n;
  END IF;
  EXECUTE replace(v_def, v_ancora, v_ancora || v_bloco);
END $migracao$;

-- A ACL fica como estava (só service_role), reaplicada pelo nome: PUBLIC, anon e authenticated fora.
REVOKE ALL ON FUNCTION public.whatsapp_ia_enviar(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_ia_enviar(uuid, text, jsonb) TO service_role;

-- Conferência: se algo estiver fora do esperado, desfaz tudo -----------------------------------------------------------------------
DO $confere$
DECLARE
  v_oid oid := to_regprocedure('public.whatsapp_ia_enviar(uuid, text, jsonb)');
  v_n integer;
  v_msg text;
  v_fila_antes bigint := (SELECT count(*) FROM public.whatsapp_fila_envio WHERE idempotency_key LIKE 'ia:%');
  v_msgs_antes bigint := (SELECT count(*) FROM public.whatsapp_mensagens WHERE origem = 'ia');
  v_inexistente constant uuid := '00000000-0000-0000-0000-00000000ba44';
  f record;
BEGIN
  SELECT count(*) INTO v_n FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'whatsapp_ia_enviar';
  IF v_n <> 1 THEN RAISE EXCEPTION 'whatsapp_ia_enviar tem % versões (esperado 1)', v_n; END IF;
  IF position('-- BARREIRA NO BANCO (15/11/2026)' IN (SELECT prosrc FROM pg_proc WHERE oid = v_oid)) = 0 THEN
    RAISE EXCEPTION 'o bloco novo não entrou no corpo da função';
  END IF;
  -- o corpo novo é determinístico: o corpo lido em 15/11/2026 mais o bloco acima. Se o md5 for outro, a troca saiu diferente do ensaio.
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = v_oid) <> '9bdd6735ab66704bbe586dcf578694d6' THEN
    RAISE EXCEPTION 'o corpo novo de whatsapp_ia_enviar não tem o md5 do ensaio';
  END IF;
  IF has_function_privilege('anon', v_oid, 'EXECUTE') OR has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR has_function_privilege('public', v_oid, 'EXECUTE') OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'a ACL de whatsapp_ia_enviar mudou';
  END IF;
  IF NOT (SELECT proconfig IS NOT NULL AND 'search_path=public' = ANY (proconfig) AND prosecdef FROM pg_proc WHERE oid = v_oid) THEN
    RAISE EXCEPTION 'o search_path ou o modo de segurança de whatsapp_ia_enviar mudou';
  END IF;

  -- cada texto proibido é recusado com a regra esperada, antes de qualquer escrita (a conversa nem precisa existir)
  FOR f IN SELECT * FROM (VALUES
      ('O valor fica em 50 reais.', 'preco_com_numero'),
      ('Fica pronto em dois dias.', 'prazo_prometido'),
      ('Pagamento à vista tem desconto.', 'forma_de_pagamento'),
      ('Faço o orçamento para você.', 'orcamento_feito_pelo_agente'),
      ('*Bex Print · assistente*' || E'\n' || 'O banner sai por 30.', 'preco_com_numero')) AS q(frase, codigo)
  LOOP
    v_msg := NULL;
    BEGIN
      PERFORM public.whatsapp_ia_enviar(v_inexistente, f.frase, '{}'::jsonb);
    EXCEPTION WHEN OTHERS THEN
      v_msg := SQLERRM;
    END;
    IF v_msg IS NULL OR v_msg NOT LIKE 'texto_reprovado_pela_barreira: %' OR position(f.codigo IN v_msg) = 0 THEN
      RAISE EXCEPTION 'o texto "%" devia ser recusado pela barreira com %, veio: %', f.frase, f.codigo, coalesce(v_msg, 'nada (passou)');
    END IF;
    IF position(left(f.frase, 12) IN v_msg) > 0 THEN
      RAISE EXCEPTION 'a recusa não pode repetir o texto, só o nome da regra: %', v_msg;
    END IF;
  END LOOP;

  -- o que precisa continuar passando passa pela barreira (para na conversa inexistente, que vem DEPOIS dela)
  FOR f IN SELECT * FROM (VALUES
      ('Olá! Recebemos sua mensagem fora do horário de atendimento. Assim que abrirmos, alguém da equipe responde você.'),
      ('Vou chamar alguém da equipe para continuar com você.'),
      ('*Bex Print · assistente*' || E'\n' || 'Vou chamar alguém da equipe para continuar com você.'),
      ('Pode mandar a arte por aqui que a equipe confere se está boa para imprimir.')) AS q(frase)
  LOOP
    v_msg := NULL;
    BEGIN
      PERFORM public.whatsapp_ia_enviar(v_inexistente, f.frase, '{}'::jsonb);
    EXCEPTION WHEN OTHERS THEN
      v_msg := SQLERRM;
    END;
    IF v_msg IS DISTINCT FROM 'Conversa não encontrada.' THEN
      RAISE EXCEPTION 'o texto "%" devia passar pela barreira e parar na conversa inexistente, veio: %', f.frase, coalesce(v_msg, 'nada (gravou?)');
    END IF;
  END LOOP;
  -- texto vazio continua com a mensagem antiga
  v_msg := NULL;
  BEGIN
    PERFORM public.whatsapp_ia_enviar(v_inexistente, '   ', '{}'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    v_msg := SQLERRM;
  END;
  IF v_msg IS DISTINCT FROM 'Texto vazio.' THEN
    RAISE EXCEPTION 'texto vazio devia continuar com a mensagem antiga, veio: %', coalesce(v_msg, 'nada');
  END IF;

  -- nada foi gravado pelas chamadas acima: as contagens de antes e depois são iguais
  IF (SELECT count(*) FROM public.whatsapp_fila_envio WHERE idempotency_key LIKE 'ia:%') <> v_fila_antes
     OR (SELECT count(*) FROM public.whatsapp_mensagens WHERE origem = 'ia') <> v_msgs_antes THEN
    RAISE EXCEPTION 'a conferência gravou mensagem ou fila da assistente: a barreira deixou gravar';
  END IF;
END $confere$;

COMMIT;
