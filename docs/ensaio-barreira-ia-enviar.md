# Ensaio da migração: barreira no banco do envio da assistente de texto livre

Migração: `supabase/migrations/20261115130000_barreira_no_banco_ia_enviar.sql`. Depende de `20261115120000_agente_validador_mais_firme.sql` (a função `_agente_problemas_de_texto`, já aplicada). Código novo, pequeno: `src/lib/api/whatsapp-assistente.server.ts` passa a tratar a recusa da barreira como texto reprovado. Estado da aplicação: seção 6.

## O que muda em produção ao aplicar

- **Nada que um contato perceba hoje.** A assistente de texto livre está desligada (`whatsapp_configuracoes.ia_ativa = false`) e nunca enviou nada: não existe mensagem com origem `ia` nem linha de fila `ia:%` no banco. A barreira só passa a valer quando o dono ligar a assistente.
- **UMA função é trocada, por troca na definição viva:** `whatsapp_ia_enviar(uuid, text, jsonb)`. O corpo novo é o corpo vivo lido em 15/11/2026 (md5 `d841150f076a0f67022f51353aad5951`, conferido no começo da migração, que para sem mudar nada se o corpo vivo for outro) com UM bloco inserido logo depois da checagem de texto vazio. O corpo novo tem md5 `9bdd6735ab66704bbe586dcf578694d6`.
- **O bloco:** chama `_agente_problemas_de_texto(left(texto, 4096), ARRAY['cliente'])` sobre exatamente o texto que seria gravado. Lista vazia: segue como sempre. Qualquer regra, ou o validador sem resposta: `RAISE EXCEPTION 'texto_reprovado_pela_barreira: <regras>'`, antes da trava da conversa e de qualquer escrita. Nada fica gravado: nem mensagem, nem fila, nem resumo da conversa. A mensagem leva só o NOME das regras, nunca o texto.
- **Nenhuma outra função, tabela, gatilho, coluna, política ou tipo muda.** O ensaio compara o md5 do corpo, a ACL, o `search_path` e o modo de segurança de TODAS as 762 funções do esquema `public` antes e depois da troca: a única diferente é `whatsapp_ia_enviar`.
- **ACL e `search_path` preservados:** só `service_role` executa (anon, authenticated e PUBLIC revogados pelo nome, reaplicado pela migração), `SECURITY DEFINER`, `search_path = public`.
- **Código.** `enviar()` reconhece a recusa pelo prefixo e devolve as regras; `enviarVerificado` devolve `enviado: false`, que é o caminho que já existia para texto reprovado pelo verificador do código (nada enfileirado, conversa para a equipe, log com o nome da regra). Sem esta mudança de código a recusa cairia no `catch` da assistente (log de erro, nada enviado, mas a conversa não passaria para a equipe). **A ordem de publicação não importa:** com a migração antes do código, a recusa vira erro no log; com o código antes da migração, nada muda.

## A regra do dono e o furo que isto fecha

Nenhum envio automático ao contato cita preço, prazo, pagamento nem orçamento. O validador existia no código do servidor (`verificarSaida`, antes de chamar o banco) e no banco (`_agente_problemas_de_texto`, usado pelo agente e pela base de respostas). A porta da assistente de texto livre, `whatsapp_ia_enviar`, gravava mensagem e fila do texto que recebesse. Quem a chamasse com a chave de serviço (outra rota, outra sessão, um erro de código) enfileirava o que quisesse. Agora o banco confere o texto antes de gravar, por qualquer chamador.

## Por que a barreira não quebra nenhum caminho legítimo

`whatsapp_ia_enviar` só é chamada por UM lugar, o servidor da assistente de texto livre. Conferido no banco vivo em 15/11/2026: nenhuma função SQL cita `whatsapp_ia_enviar` no corpo (a consulta 0.2 devolve zero linhas), nenhum job do cron a chama, e o único chamador no código é `enviar()` em `src/lib/api/whatsapp-assistente.server.ts`. Portanto a barreira vale para tudo que passa por ela, e nada mais passa por ela:

| Origem                                                | Por onde enfileira                                                                                         | Passa pela função trocada? |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------- |
| Equipe humana na caixa de entrada                     | `whatsapp_responder`, `whatsapp_responder_arquivo`, `_wa_enfileirar_mensagem_da_equipe`                    | Não                        |
| Orçamento, documento, cobrança, lembrete, notificação | `enfileirarMensagem` (servidor, insert direto, origem `humano` com autor ou `automacao` com chave `auto:`) | Não                        |
| Triagem de boas-vindas                                | `triagem_enviar`, `triagem_varrer`                                                                         | Não                        |
| Agente que escolhe respostas aprovadas                | `agente_registrar`, `agente_varrer`                                                                        | Não                        |
| Assistente de texto livre                             | `whatsapp_ia_enviar`                                                                                       | **Sim, e só ela**          |

O ensaio (seção 3) prova isso com chamadas de cada origem ANTES e DEPOIS da troca, na mesma transação, e exige o mesmo resultado antes e depois para tudo que não é a porta da assistente.

## O que a barreira não cobre

1. **Ela é uma última porta PARCIAL, como o validador.** Barra o que alguém já pensou em barrar, não entende frase. A garantia de verdade é a assistente receber só o que não tem preço nem prazo (o contexto dela já não traz valor nem data) e o dono manter a assistente desligada até confiar.
2. **Outros caminhos de texto automático não passam por ela.** As respostas automáticas de sistema (`auto:`, por exemplo o toque num botão do Pix) e a triagem têm as suas conferências próprias (a triagem confere no banco em `triagem_enviar`). A barreira desta migração é só da assistente de texto livre. Se o dono quiser a mesma regra no insert direto de `enfileirarMensagem`, é um gatilho em `whatsapp_fila_envio` ou `whatsapp_mensagens`, e aí SIM atinge a equipe humana: exigiria distinguir a origem e é outra decisão, não foi feita.
3. **Falha fechada.** Se o validador lançar erro (regex, tabela de termos), a função lança junto e nada é enviado. A conversa vai para a equipe pelo caminho do texto reprovado só quando a mensagem tem o prefixo da barreira; um erro de outra natureza continua sendo erro de infraestrutura, como antes.
4. **Texto longo.** A barreira confere os primeiros 4.096 caracteres, que é exatamente o que a função grava.
5. **Sem rastro no banco da recusa.** Recusar é lançar exceção, que desfaz tudo na mesma transação, inclusive qualquer log escrito dentro da função. O rastro é o que o servidor grava em `whatsapp_ia_logs` (nome das regras, nunca o texto).

## 0. ANTES: o que conferir

```sql
-- 0.1 O corpo vivo. Esperado: 1 linha, md5 d841150f076a0f67022f51353aad5951, SECURITY DEFINER, search_path=public, ACL só postgres e service_role.
SELECT p.oid::regprocedure::text AS assinatura, md5(p.prosrc) AS md5_corpo, p.prosecdef, p.proconfig, p.proacl::text AS acl
FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'whatsapp_ia_enviar';
```

```sql
-- 0.2 Quem chama a função. Esperado: ZERO linhas (nenhuma outra função SQL, nenhum job do cron). O único chamador é o servidor da assistente.
SELECT p.oid::regprocedure::text AS chamador FROM pg_proc p
WHERE p.pronamespace = 'public'::regnamespace AND p.prosrc ILIKE '%whatsapp_ia_enviar%' AND p.proname <> 'whatsapp_ia_enviar'
UNION ALL
SELECT 'cron ' || jobid || ' ' || jobname FROM cron.job WHERE command ILIKE '%whatsapp_ia_enviar%';
```

```sql
-- 0.3 O estado que não pode mudar. Esperado em 15/11/2026: agente desligada, triagem desligada, ia_ativa false, 0 eventos do agente,
-- 0 mensagens de origem 'ia', 0 linhas de fila 'ia:%'.
SELECT 'agente' AS item, (SELECT estado::text FROM public.agente_config) AS valor
UNION ALL SELECT 'triagem', (SELECT estado::text FROM public.whatsapp_triagem_config)
UNION ALL SELECT 'ia_ativa', (SELECT ia_ativa::text FROM public.whatsapp_configuracoes)
UNION ALL SELECT 'eventos do agente', (SELECT count(*)::text FROM public.agente_eventos)
UNION ALL SELECT 'mensagens origem ia', (SELECT count(*)::text FROM public.whatsapp_mensagens WHERE origem = 'ia')
UNION ALL SELECT 'fila ia:%', (SELECT count(*)::text FROM public.whatsapp_fila_envio WHERE idempotency_key LIKE 'ia:%');
```

```sql
-- 0.4 O validador que a barreira chama existe e está no md5 da C3.1 (a barreira não exige o md5, só que a função exista; o md5 serve de registro).
-- Esperado: 1 linha, texto[] de retorno, md5 92b7101a1208c7c747c2a6f891421494 em 15/11/2026.
SELECT p.oid::regprocedure::text AS assinatura, pg_get_function_result(p.oid) AS retorno, md5(p.prosrc) AS md5_corpo
FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = '_agente_problemas_de_texto';
```

## 1. Aplicar

Aplique o arquivo da migração inteiro. Ele abre com `BEGIN;` e `SET LOCAL lock_timeout = '5s'`, fecha com `COMMIT;` e termina com uma conferência que desfaz tudo se algo estiver fora do esperado: função com sobrecarga, bloco que não entrou, md5 do corpo novo diferente do ensaio, ACL com anon, authenticated ou PUBLIC (ou sem service_role), `search_path` ou modo de segurança diferentes, texto proibido que NÃO é recusado com a regra esperada (cinco textos, um deles com assinatura), a recusa que repete o texto, texto liberado que NÃO chega até a checagem da conversa (quatro textos, incluindo o aviso fora do horário e a frase de transferência reais), texto vazio que perdeu a mensagem antiga, e qualquer mensagem ou fila `ia` gravada pelas chamadas da conferência.

Trava: `CREATE OR REPLACE FUNCTION` de uma função só; o `lock_timeout` de 5 s faz a migração desistir inteira se algo segurar a função. Não toca em tabela. Rodar duas vezes não faz nada na segunda (a marca `-- BARREIRA NO BANCO (15/11/2026)` já está no corpo).

## 2. DEPOIS: estrutura

```sql
-- 2.1 O corpo novo. Esperado: md5 9bdd6735ab66704bbe586dcf578694d6, marca presente, SECURITY DEFINER, search_path=public,
-- ACL {postgres=X/postgres,service_role=X/postgres}, anon/authenticated/public sem execução, service_role executa.
SELECT md5(p.prosrc) AS md5_corpo, position('-- BARREIRA NO BANCO (15/11/2026)' IN p.prosrc) > 0 AS tem_marca,
       p.prosecdef, p.proconfig, p.proacl::text AS acl,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_executa,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_executa,
       has_function_privilege('public', p.oid, 'EXECUTE') AS public_executa,
       has_function_privilege('service_role', p.oid, 'EXECUTE') AS servico_executa
FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'whatsapp_ia_enviar';
```

```sql
-- 2.2 O corpo inteiro, para ler. Esperado: o bloco da barreira entre a checagem de texto vazio e o SELECT ... FOR UPDATE da conversa.
SELECT pg_get_functiondef('public.whatsapp_ia_enviar(uuid, text, jsonb)'::regprocedure);
```

```sql
-- 2.3 A recusa ao vivo, sem escrever nada (a barreira lança antes de qualquer escrita; a conversa nem precisa existir).
-- Esperado: o primeiro SELECT lança 'texto_reprovado_pela_barreira: valor_em_reais,preco_com_numero'; o segundo lança 'Conversa não encontrada.'
-- (passou pela barreira e parou na conversa que não existe, que vem depois dela).
SELECT public.whatsapp_ia_enviar('00000000-0000-0000-0000-00000000ba44', 'O valor fica em 50 reais.', '{}'::jsonb);
SELECT public.whatsapp_ia_enviar('00000000-0000-0000-0000-00000000ba44', 'Olá! Me conta qual produto você quer ver.', '{}'::jsonb);
```

```sql
-- 2.4 O estado final. Esperado: o mesmo da 0.3 (agente desligada, triagem desligada, ia_ativa false, 0 eventos, 0 mensagens ia, 0 fila ia).
SELECT 'agente' AS item, (SELECT estado::text FROM public.agente_config) AS valor
UNION ALL SELECT 'triagem', (SELECT estado::text FROM public.whatsapp_triagem_config)
UNION ALL SELECT 'ia_ativa', (SELECT ia_ativa::text FROM public.whatsapp_configuracoes)
UNION ALL SELECT 'eventos do agente', (SELECT count(*)::text FROM public.agente_eventos)
UNION ALL SELECT 'mensagens origem ia', (SELECT count(*)::text FROM public.whatsapp_mensagens WHERE origem = 'ia')
UNION ALL SELECT 'fila ia:%', (SELECT count(*)::text FROM public.whatsapp_fila_envio WHERE idempotency_key LIKE 'ia:%');
```

## 3. O ensaio atômico no banco vivo

Uma chamada só: a troca (o corpo da migração, sem `BEGIN` e `COMMIT`) no meio de duas rodadas de sondas, e um `RAISE EXCEPTION` final que desfaz TUDO. A mensagem do erro traz o relatório. As sondas usam uma conversa real com a instância conectada, escolhida pela mais antiga, mas tudo é desfeito: nada chega à fila de verdade nem ao contato.

Cada sonda roda ANTES e DEPOIS da troca:

- **A, a porta da assistente:** texto ruim, texto bom, o aviso fora do horário e a frase de transferência reais (com a assinatura da configuração) e texto vazio.
- **B, equipe humana:** `_wa_enfileirar_mensagem_da_equipe` com texto ruim.
- **C, caixa de entrada:** `whatsapp_responder` com texto ruim, como a pessoa logada (papel `authenticated`, permissão `whatsapp.reply`).
- **D, o que o servidor grava direto:** resposta automática do sistema (`auto:`) e humano direto (cobrança, lembrete, orçamento), com os mesmos inserts de `enfileirarMensagem`.
- **E, triagem e agente:** `triagem_enviar` e `agente_registrar` (desligados, com ids que não existem).
- **F, a matriz:** 20 textos que nunca podem sair e 12 que precisam sair, por `whatsapp_ia_enviar`.

O relatório falha se: a troca mudou qualquer função além de `whatsapp_ia_enviar`; qualquer sonda fora da porta da assistente deu resultado diferente antes e depois; o texto proibido NÃO foi recusado depois, ou já era recusado antes; o texto liberado deixou de ser aceito; qualquer origem humana ou de sistema deixou de aceitar o texto ruim.

```sql
SET LOCAL lock_timeout = '5s';

CREATE TEMP TABLE _ens (fase text, sonda text, resultado text) ON COMMIT DROP;
CREATE TEMP TABLE _fn (fase text, assinatura text, md5_corpo text, acl text, cfg text, seg boolean) ON COMMIT DROP;

-- as sondas: cada origem de envio chamada com texto ruim e texto bom, ANTES e DEPOIS da troca
CREATE FUNCTION pg_temp._sondar(p_fase text) RETURNS void LANGUAGE plpgsql AS $s$
DECLARE
  v_conv uuid;
  v_autor uuid;
  v_ruim constant text := 'O valor fica em 50 reais e fica pronto em dois dias.';
  v_bom constant text := 'Olá, tudo bem? Me conta qual produto você quer ver.';
  v_ass text;
  v_fora text;
  v_r jsonb;
  v_m uuid;
  v_ok text;
  f record;
BEGIN
  SELECT c.id INTO v_conv FROM public.whatsapp_conversas c JOIN public.whatsapp_instancias i ON i.id = c.instancia_id
   WHERE i.ativa AND i.conectado AND i.status::text = 'conectada' AND public.conversa_recebe_whatsapp(c.telefone)
   ORDER BY c.ultima_mensagem_at ASC NULLS FIRST LIMIT 1;
  SELECT m.enviada_por INTO v_autor FROM public.whatsapp_mensagens m WHERE m.direcao = 'saida' AND m.enviada_por IS NOT NULL ORDER BY m.created_at DESC LIMIT 1;
  SELECT assinatura, mensagem_fora_horario INTO v_ass, v_fora FROM public.whatsapp_configuracoes LIMIT 1;
  INSERT INTO _ens VALUES (p_fase, '00 conversa e autor achados', (v_conv IS NOT NULL AND v_autor IS NOT NULL)::text);

  -- A. a porta da assistente de texto livre
  FOR f IN SELECT * FROM (VALUES
      ('A1 ia_enviar texto ruim', v_ruim),
      ('A2 ia_enviar texto bom', v_bom),
      ('A3 ia_enviar aviso fora do horário (da configuração)', '*' || v_ass || E'*\n' || v_fora),
      ('A4 ia_enviar frase de transferência (com assinatura)', '*' || v_ass || E'*\n' || 'Vou chamar alguém da equipe para continuar com você.'),
      ('A5 ia_enviar texto vazio', '   ')) AS q(nome, texto)
  LOOP
    BEGIN
      v_r := public.whatsapp_ia_enviar(v_conv, f.texto, '{"ensaio":true}'::jsonb);
      INSERT INTO _ens VALUES (p_fase, f.nome, CASE WHEN v_r ? 'mensagem_id' AND v_r ? 'fila_id' THEN 'ACEITO' ELSE v_r::text END);
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO _ens VALUES (p_fase, f.nome, 'RECUSADO: ' || SQLERRM);
    END;
  END LOOP;

  -- B. mensagem de equipe humana, pela função interna que a caixa e o orçamento usam
  BEGIN
    v_r := public._wa_enfileirar_mensagem_da_equipe(v_conv, v_autor, v_ruim, 'ensaio', 'ensaio');
    INSERT INTO _ens VALUES (p_fase, 'B1 equipe _wa_enfileirar_mensagem_da_equipe texto ruim', CASE WHEN (v_r->>'enfileirado')::boolean THEN 'ACEITO' ELSE v_r::text END);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _ens VALUES (p_fase, 'B1 equipe _wa_enfileirar_mensagem_da_equipe texto ruim', 'RECUSADO: ' || SQLERRM);
  END;

  -- C. a caixa de entrada, como a pessoa logada (papel authenticated, com a permissão whatsapp.reply)
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_autor, 'role', 'authenticated')::text, true);
    PERFORM set_config('request.jwt.claim.sub', v_autor::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    v_r := public.whatsapp_responder(v_conv, v_ruim);
    EXECUTE 'RESET ROLE';
    INSERT INTO _ens VALUES (p_fase, 'C1 caixa whatsapp_responder texto ruim', CASE WHEN v_r ? 'mensagem_id' THEN 'ACEITO' ELSE v_r::text END);
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    INSERT INTO _ens VALUES (p_fase, 'C1 caixa whatsapp_responder texto ruim', 'RECUSADO: ' || SQLERRM);
  END;

  -- D. o que o servidor grava direto (enfileirarMensagem): resposta automática do sistema ('auto:'), cobrança, lembrete e orçamento (autor humano)
  FOR f IN SELECT * FROM (VALUES
      ('D1 automação direta (auto:) texto ruim', NULL::uuid, 'automacao', 'auto'),
      ('D2 humano direto (cobrança, lembrete, orçamento) texto ruim', v_autor, 'humano', 'cobranca')) AS q(nome, usuario, origem, chave)
  LOOP
    BEGIN
      INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, direcao, tipo, status, texto, enviada_por, origem, payload)
      SELECT v_conv, c.instancia_id, 'saida', 'texto', 'pendente', v_ruim, f.usuario, f.origem, '{"origem":"ensaio"}'::jsonb
        FROM public.whatsapp_conversas c WHERE c.id = v_conv RETURNING id INTO v_m;
      INSERT INTO public.whatsapp_fila_envio (conversa_id, mensagem_id, payload, status, idempotency_key, created_by)
      VALUES (v_conv, v_m, jsonb_build_object('tipo', 'texto', 'texto', v_ruim), 'pendente', f.chave || ':' || v_m::text, f.usuario);
      INSERT INTO _ens VALUES (p_fase, f.nome, 'ACEITO');
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO _ens VALUES (p_fase, f.nome, 'RECUSADO: ' || SQLERRM);
    END;
  END LOOP;

  -- E. triagem e agente (desligados): a porta responde igual antes e depois
  BEGIN
    v_r := public.triagem_enviar('00000000-0000-0000-0000-00000000ba45'::uuid, v_ruim, 'triagem:x:1', 0, 'ensaio', 1, '{}'::text[]);
    INSERT INTO _ens VALUES (p_fase, 'E1 triagem_enviar triagem inexistente', v_r::text);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _ens VALUES (p_fase, 'E1 triagem_enviar triagem inexistente', 'RECUSADO: ' || SQLERRM);
  END;
  BEGIN
    v_r := public.agente_registrar('00000000-0000-0000-0000-00000000ba46'::uuid, '00000000-0000-0000-0000-00000000ba47'::uuid, '{}'::jsonb);
    INSERT INTO _ens VALUES (p_fase, 'E2 agente_registrar conversa inexistente', v_r::text);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _ens VALUES (p_fase, 'E2 agente_registrar conversa inexistente', 'RECUSADO: ' || SQLERRM);
  END;

  -- F. a matriz da barreira: 20 textos que NUNCA podem sair e 12 que precisam sair
  FOR f IN SELECT * FROM (VALUES
      ('F proibido', 'O valor fica em 50 reais.'), ('F proibido', 'Custa R$ 80,00 o metro.'), ('F proibido', 'O banner sai por 30.'),
      ('F proibido', 'Fica pronto em 48h.'), ('F proibido', 'Entregamos amanhã.'), ('F proibido', 'Fica pronto em dois dias.'),
      ('F proibido', 'Pagamento à vista tem desconto.'), ('F proibido', 'Aceitamos cartão de crédito.'), ('F proibido', 'Dá para pagar em 3x.'),
      ('F proibido', 'Faço o orçamento para você.'), ('F proibido', 'Segue o orçamento.'), ('F proibido', 'Temos promoção essa semana.'),
      ('F proibido', 'Preço de atacado para revenda.'), ('F proibido', 'Nosso preço é competitivo.'), ('F proibido', 'Segue a tabela de preços.'),
      ('F proibido', 'Há uma taxa de entrega.'), ('F proibido', 'Pronto dia 15.'), ('F proibido', 'Metade na entrada.'),
      ('F proibido', 'Cobramos mil e quinhentos.'), ('F proibido', 'A partir de 20 a unidade.'),
      ('F liberado', 'Olá! Tudo bem? Me conta qual produto você quer ver.'),
      ('F liberado', 'Pode mandar a arte por aqui que a equipe confere se está boa para imprimir.'),
      ('F liberado', 'A equipe atende de segunda a sexta, das 8h às 18h.'),
      ('F liberado', 'Para a equipe montar o orçamento, preciso saber qual produto você quer, a medida e a quantidade.'),
      ('F liberado', 'Temos banner, adesivo, cartão de visita e placa.'),
      ('F liberado', 'Qual o tamanho e a quantidade que você precisa?'),
      ('F liberado', 'Fazemos impressão em 3D também.'),
      ('F liberado', 'O pedido mínimo é de cem unidades.'),
      ('F liberado', 'Estamos na Avenida FAB, 123.'),
      ('F liberado', 'A equipe confirma isso com tudo certinho para o pedido.'),
      ('F liberado', 'Posso te ajudar com adesivo ou com faixa?'),
      ('F liberado', '*' || v_ass || E'*\nO que você precisa imprimir?')) AS q(grupo, texto)
  LOOP
    BEGIN
      v_r := public.whatsapp_ia_enviar(v_conv, f.texto, '{"ensaio":true}'::jsonb);
      INSERT INTO _ens VALUES (p_fase, f.grupo || ': ' || f.texto, CASE WHEN v_r ? 'mensagem_id' THEN 'ACEITO' ELSE v_r::text END);
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO _ens VALUES (p_fase, f.grupo || ': ' || f.texto, 'RECUSADO: ' || SQLERRM);
    END;
  END LOOP;
END $s$;

-- retrato de TODAS as funções do esquema public, antes
INSERT INTO _fn SELECT 'antes', p.oid::regprocedure::text, md5(p.prosrc), coalesce(p.proacl::text, ''), coalesce(p.proconfig::text, ''), p.prosecdef
  FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace;
SELECT pg_temp._sondar('antes');

-- A TROCA (o corpo da migração, sem BEGIN e COMMIT)
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


-- retrato de TODAS as funções do esquema public, depois
INSERT INTO _fn SELECT 'depois', p.oid::regprocedure::text, md5(p.prosrc), coalesce(p.proacl::text, ''), coalesce(p.proconfig::text, ''), p.prosecdef
  FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace;
SELECT pg_temp._sondar('depois');

DO $relatorio$
DECLARE
  v_rel text := '';
  v_trocadas text;
  v_n_antes integer;
  v_n_depois integer;
  v_falhas text := '';
  r record;
BEGIN
  SELECT count(*) INTO v_n_antes FROM _fn WHERE fase = 'antes';
  SELECT count(*) INTO v_n_depois FROM _fn WHERE fase = 'depois';
  SELECT string_agg(a.assinatura, ', ') INTO v_trocadas FROM _fn a JOIN _fn d ON d.assinatura = a.assinatura AND d.fase = 'depois'
   WHERE a.fase = 'antes' AND (a.md5_corpo <> d.md5_corpo OR a.acl <> d.acl OR a.cfg <> d.cfg OR a.seg <> d.seg);
  v_rel := v_rel || format(E'FUNÇÕES: antes %s, depois %s, trocadas: %s\n', v_n_antes, v_n_depois, coalesce(v_trocadas, 'nenhuma'));
  IF v_n_antes <> v_n_depois THEN v_falhas := v_falhas || 'número de funções mudou; '; END IF;
  IF v_trocadas IS DISTINCT FROM 'whatsapp_ia_enviar(uuid,text,jsonb)' THEN v_falhas := v_falhas || 'a troca não foi só whatsapp_ia_enviar; '; END IF;
  FOR r IN SELECT a.sonda, a.resultado AS antes, d.resultado AS depois FROM _ens a JOIN _ens d ON d.sonda = a.sonda AND d.fase = 'depois' WHERE a.fase = 'antes' ORDER BY a.sonda LOOP
    v_rel := v_rel || format(E'%s\n   antes:  %s\n   depois: %s\n', r.sonda, left(r.antes, 160), left(r.depois, 160));
    -- toda sonda que NÃO é da porta da assistente tem de dar o mesmo resultado antes e depois
    IF r.sonda !~ '^(A[1-4]|F )' AND r.antes <> r.depois THEN v_falhas := v_falhas || 'mudou o que não devia: ' || r.sonda || '; '; END IF;
    -- a porta da assistente: o que é proibido passa a ser recusado; o que é liberado segue aceito
    IF r.sonda ~ '^(A1|F proibido)' AND (r.depois NOT LIKE 'RECUSADO: texto_reprovado_pela_barreira: %') THEN v_falhas := v_falhas || 'proibido não foi recusado: ' || r.sonda || '; '; END IF;
    IF r.sonda ~ '^(A2|A3|A4|F liberado)' AND r.depois <> 'ACEITO' THEN v_falhas := v_falhas || 'liberado não foi aceito: ' || r.sonda || ' => ' || r.depois || '; '; END IF;
    IF r.sonda ~ '^A5' AND r.depois <> 'RECUSADO: Texto vazio.' THEN v_falhas := v_falhas || 'vazio mudou; '; END IF;
    -- antes da troca, o proibido passava (é o furo que a barreira fecha)
    IF r.sonda ~ '^(A1|F proibido)' AND r.antes <> 'ACEITO' THEN v_falhas := v_falhas || 'antes da troca o proibido já era recusado (sonda sem sentido): ' || r.sonda || '; '; END IF;
  END LOOP;
  -- as origens que não passam pela função seguem aceitando o texto ruim, como antes
  IF EXISTS (SELECT 1 FROM _ens WHERE fase = 'depois' AND sonda ~ '^(B1|C1|D1|D2)' AND resultado <> 'ACEITO') THEN
    v_falhas := v_falhas || 'uma origem humana ou de sistema deixou de aceitar: ' || (SELECT string_agg(sonda || ' => ' || resultado, ' | ') FROM _ens WHERE fase = 'depois' AND sonda ~ '^(B1|C1|D1|D2)' AND resultado <> 'ACEITO') || '; ';
  END IF;
  IF EXISTS (SELECT 1 FROM _ens WHERE sonda = '00 conversa e autor achados' AND resultado <> 'true') THEN v_falhas := v_falhas || 'sem conversa ou autor para sondar; '; END IF;
  v_rel := v_rel || format(E'\nMATRIZ DEPOIS: proibido recusado %s de %s; liberado aceito %s de %s\n',
    (SELECT count(*) FROM _ens WHERE fase = 'depois' AND sonda LIKE 'F proibido%' AND resultado LIKE 'RECUSADO: texto_reprovado_pela_barreira: %'),
    (SELECT count(*) FROM _ens WHERE fase = 'depois' AND sonda LIKE 'F proibido%'),
    (SELECT count(*) FROM _ens WHERE fase = 'depois' AND sonda LIKE 'F liberado%' AND resultado = 'ACEITO'),
    (SELECT count(*) FROM _ens WHERE fase = 'depois' AND sonda LIKE 'F liberado%'));
  v_rel := v_rel || format(E'\nESTADO: agente %s, triagem %s, ia_ativa %s, eventos do agente %s\n',
    (SELECT estado::text FROM public.agente_config), (SELECT estado::text FROM public.whatsapp_triagem_config),
    (SELECT ia_ativa::text FROM public.whatsapp_configuracoes), (SELECT count(*) FROM public.agente_eventos));
  IF v_falhas <> '' THEN
    RAISE EXCEPTION E'ENSAIO FALHOU: %\n%', v_falhas, v_rel;
  END IF;
  RAISE EXCEPTION E'ENSAIO OK (desfeito de propósito)\n%', v_rel;
END $relatorio$;
```

### Resultado do ensaio, 15/11/2026

`ENSAIO OK (desfeito de propósito)`. Funções do esquema `public`: antes 762, depois 762, trocadas: só `whatsapp_ia_enviar(uuid,text,jsonb)`.

| Sonda                                                        | Antes                          | Depois                                                                                     |
| ------------------------------------------------------------ | ------------------------------ | ------------------------------------------------------------------------------------------ |
| A1 assistente, texto ruim                                    | aceito                         | recusado: `texto_reprovado_pela_barreira: valor_em_reais,preco_com_numero,prazo_prometido` |
| A2 assistente, texto bom                                     | aceito                         | aceito                                                                                     |
| A3 aviso fora do horário real, com assinatura                | aceito                         | aceito                                                                                     |
| A4 frase de transferência real, com assinatura               | aceito                         | aceito                                                                                     |
| A5 texto vazio                                               | `Texto vazio.`                 | `Texto vazio.`                                                                             |
| B1 equipe, `_wa_enfileirar_mensagem_da_equipe`, texto ruim   | aceito                         | aceito                                                                                     |
| C1 caixa, `whatsapp_responder`, texto ruim                   | aceito                         | aceito                                                                                     |
| D1 automação direta (`auto:`), texto ruim                    | aceito                         | aceito                                                                                     |
| D2 humano direto (cobrança, lembrete, orçamento), texto ruim | aceito                         | aceito                                                                                     |
| E1 `triagem_enviar`, triagem inexistente                     | `Triagem não encontrada.`      | `Triagem não encontrada.`                                                                  |
| E2 `agente_registrar`, conversa inexistente                  | `Ação do agente desconhecida.` | `Ação do agente desconhecida.`                                                             |

Matriz F depois da troca: **proibido recusado 20 de 20; liberado aceito 12 de 12**. Antes da troca os 32 eram aceitos (é o furo). Proibidos recusados, com as regras que o banco devolveu: "A partir de 20 a unidade" (`preco_com_numero`), "Aceitamos cartão de crédito" (`forma_de_pagamento`), "Cobramos mil e quinhentos" (`preco_com_numero`), "Custa R$ 80,00 o metro" (`moeda`, `valor_com_centavos`, `preco_com_numero`), "Dá para pagar em 3x" (`pagamento_com_numero`, `forma_de_pagamento`), "Entregamos amanhã" (`prazo_prometido`), "Faço o orçamento para você" e "Segue o orçamento" (`orcamento_feito_pelo_agente`), "Fica pronto em 48h" e "em dois dias" e "Pronto dia 15" (`prazo_prometido`), "Há uma taxa de entrega" (`taxa_cobrada`), "Metade na entrada" (`forma_de_pagamento`), "Nosso preço é competitivo" (`condicao_de_preco`), "O banner sai por 30" e "O valor fica em 50 reais" (`preco_com_numero`), "Pagamento à vista tem desconto" (`desconto`, `forma_de_pagamento`), "Preço de atacado para revenda" (`palavra_que_a_casa_nao_usa`, `preco_especial`), "Segue a tabela de preços" (`tabela`), "Temos promoção essa semana" (`condicao_de_preco`, `prazo_prometido`). Liberados aceitos: saudação, "Pode mandar a arte por aqui", horário de atendimento, "Para a equipe montar o orçamento", lista de produtos, pergunta de medida e quantidade, "impressão em 3D", "pedido mínimo é de cem unidades", endereço com número, "A equipe confirma isso com tudo certinho", pergunta de produto e uma resposta com a assinatura da configuração.

Estado dentro do ensaio, depois da troca: agente desligada, triagem desligada, `ia_ativa` false, 0 eventos do agente.

A conferência da própria migração (o bloco `$confere$`) também rodou dentro do ensaio e passou.

## 4. Desfazer

O bloco de volta confere que o corpo vivo é o desta migração (md5 `9bdd6735ab66704bbe586dcf578694d6`), tira o bloco da barreira e confere que o corpo voltou ao md5 de 15/11/2026 (`d841150f076a0f67022f51353aad5951`). Ensaiado depois da troca, na mesma transação desfeita: voltou com md5 `d841150f076a0f67022f51353aad5951`, ACL `{postgres=X/postgres,service_role=X/postgres}`, `search_path=public`, `SECURITY DEFINER`, sem a marca.

```sql
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $volta$
DECLARE
  v_oid oid := to_regprocedure('public.whatsapp_ia_enviar(uuid, text, jsonb)');
  v_def text;
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
  IF v_oid IS NULL THEN RAISE EXCEPTION 'A função whatsapp_ia_enviar(uuid, text, jsonb) não existe.'; END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = v_oid) <> '9bdd6735ab66704bbe586dcf578694d6' THEN
    RAISE EXCEPTION 'O corpo vivo de whatsapp_ia_enviar não é o desta migração (md5 9bdd6735ab66704bbe586dcf578694d6): releia o corpo vivo antes de desfazer.';
  END IF;
  v_def := pg_get_functiondef(v_oid);
  v_n := (length(v_def) - length(replace(v_def, v_bloco, ''))) / length(v_bloco);
  IF v_n <> 1 THEN RAISE EXCEPTION 'Esperava o bloco da barreira UMA vez no corpo vivo, achei % vezes: nada foi trocado.', v_n; END IF;
  EXECUTE replace(v_def, v_bloco, '');
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = v_oid) <> 'd841150f076a0f67022f51353aad5951' THEN
    RAISE EXCEPTION 'O corpo depois de desfazer não tem o md5 de 15/11/2026 (d841150f076a0f67022f51353aad5951).';
  END IF;
END $volta$;

REVOKE ALL ON FUNCTION public.whatsapp_ia_enviar(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_ia_enviar(uuid, text, jsonb) TO service_role;

COMMIT;
```

## 5. Ordem e riscos

1. Aplique a migração e publique o código em qualquer ordem. Com a assistente desligada, nenhuma das duas coisas muda o que alguém vê.
2. Antes de ligar a assistente, repita a consulta 2.3 e leia as respostas aprovadas do dono: a barreira não substitui ler.
3. Se o dono mudar o validador (`_agente_problemas_de_texto`) no futuro, a barreira passa a valer com a versão nova, sem nova migração. Texto que hoje passa pode passar a ser recusado; o caminho da recusa leva a conversa para a equipe.

## 6. Prova da aplicação

Aplicada em 15/11/2026, em uma chamada, com o texto exato de `supabase/migrations/20261115130000_barreira_no_banco_ia_enviar.sql` (a conferência `$confere$` da própria migração passou, senão ela teria desfeito tudo).

| Prova                                     | Resultado                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| md5 de `prosrc`                           | `9bdd6735ab66704bbe586dcf578694d6`, igual ao esperado (o corpo do repositório mais o bloco, calculado fora do banco)                                                                                                                                                                                                                                       |
| md5 de `pg_get_functiondef`               | `5d394fc943a7ae14afedcfddf98b9d03`, igual ao do texto esperado montado fora do banco (cabeçalho de `pg_get_functiondef` mais o corpo novo)                                                                                                                                                                                                                 |
| Marca `-- BARREIRA NO BANCO (15/11/2026)` | presente, no lugar certo: depois da checagem de texto vazio e antes do `SELECT ... FOR UPDATE`                                                                                                                                                                                                                                                             |
| Versões da função                         | 1                                                                                                                                                                                                                                                                                                                                                          |
| ACL                                       | `{postgres=X/postgres,service_role=X/postgres}`, a mesma de antes; anon, authenticated e PUBLIC sem execução, service_role executa                                                                                                                                                                                                                         |
| `search_path` e modo                      | `search_path=public`, `SECURITY DEFINER`, como antes                                                                                                                                                                                                                                                                                                       |
| Chamada ao vivo, texto proibido           | `texto_reprovado_pela_barreira: valor_em_reais,preco_com_numero`, com a dica "Nada foi gravado"                                                                                                                                                                                                                                                            |
| Chamada ao vivo, texto liberado           | passa pela barreira e para em `Conversa não encontrada.` (a conversa de teste não existe)                                                                                                                                                                                                                                                                  |
| Outras funções                            | md5 igual ao de antes da aplicação: `_agente_problemas_de_texto` (`92b7101a1208c7c747c2a6f891421494`), `triagem_enviar` (`27ee9f8609837809436fce4048ae79a9`), `agente_registrar` (`1770aa2400883c9fd91160a77b208f55`), `_wa_enfileirar_mensagem_da_equipe` (`5dfe93015cddf1892707d8c29df20ec3`), `whatsapp_responder` (`bff51facf55d211658ab6ae98c4730fe`) |

Estado final depois da aplicação: agente desligada (percentual 0), 0 eventos do agente, triagem desligada (percentual 0), `ia_ativa` false, 0 mensagens de origem `ia`, 0 linhas de fila `ia:%`, 0 linhas em `whatsapp_ia_logs`.
