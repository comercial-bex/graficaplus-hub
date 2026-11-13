# Ensaio das migrações da triagem de boas-vindas (Onda B: B1, B3 e B4)

Migrações, nesta ordem, as três ainda NÃO aplicadas:

1. `supabase/migrations/20261113130000_triagem_dados.sql` (B1): tipos, configuração, textos das etapas, quadro de respostas, termos proibidos.
2. `supabase/migrations/20261113131000_horario_unico.sql` (B3): tabelas de horário e feriado, funções de horário.
3. `supabase/migrations/20261113132000_triagem_estado_e_envio.sql` (B4): estado por conversa, eventos, bloqueios, funções de envio e pausa.

## O que muda em produção ao aplicar: quase nada, com UMA exceção que faz trabalho de verdade

- A triagem nasce DESLIGADA (`estado = 'desligada'`, percentual 0, números de teste vazios, `vale_a_partir_de` vazio).
- NINGUÉM chama as funções novas: não há rota, tela nem chamada no webhook. Isso é o PR B5. (`triagem_varrer` enfileira o aviso ao grupo da equipe quando alguém a chamar; sem B5 ninguém chama, então nenhum aviso sai.)
- A assistente de IA antiga continua desligada e continua lendo o horário pelas colunas antigas de `whatsapp_configuracoes`.
- Nenhuma função viva é recriada. As migrações acrescentam três gatilhos: um em `whatsapp_configuracoes` e dois de pausa por humano em `whatsapp_mensagens` e `whatsapp_conversas`. Com a triagem desligada os de pausa acham zero triagens e saem na primeira consulta, e eles nunca esperam trava de outra sessão (ver a seção 4.1).
- **A exceção, dita com todas as letras:** o gatilho `tg_whatsapp_config_sincroniza_horario` (B3) FAZ TRABALHO DE VERDADE desde o primeiro dia. Quando alguém salva na tela antiga de configuração do WhatsApp um horário de início, de fim ou dias da semana DIFERENTES dos que estavam, ele REESCREVE os 7 dias de `whatsapp_horarios_atendimento` com o que a tela mandou (medido no ensaio local: o sábado editado na tabela nova, 9h às 12h, voltou a 8h às 17h). Salvar sem mexer no horário não toca na tabela nova. Ele fica até o B5 removê-lo, e qualquer erro dentro dele vira `RAISE WARNING` no log do banco sem travar o salvamento da tela.
- Front: nada muda. Pode publicar antes ou depois.

Como as outras: cada bloco abaixo é para colar no SQL do banco vivo, um de cada vez. Os blocos de ANTES e DEPOIS só leem. O bloco de ENSAIO escreve de verdade para provar o comportamento e termina em `RAISE EXCEPTION`, que desfaz tudo. O resultado aparece na mensagem do erro. Nenhuma das três migrações usa sequência: o número do protocolo do atendimento mora na tabela `whatsapp_atendimento_seq`, e os ids são `gen_random_uuid()`. Por isso o erro desfaz também o protocolo e nenhum número é queimado. (Se um dia o ensaio passar a usar uma sequência de verdade, ela NÃO volta com o desfazer.)

Este roteiro foi rodado num Postgres 17 local com esquema reduzido: as tabelas e as funções vivas do WhatsApp (`_wa_mensagem_antes_inserir` com o corpo lido do banco vivo em 13/11/2026), a fila de envio, a fila de notificações com o CHECK de entidade do banco vivo, clientes, leads e usuários (com um admin e um gestor), e as três migrações aplicadas em ordem. As saídas esperadas abaixo vêm dessa rodada. NÃO foi rodado no banco vivo: lá, quem aplica confere. Diferenças conhecidas: o ensaio insere as mensagens direto em `whatsapp_mensagens`, em vez de passar por `whatsapp_registrar_mensagem`, porque a intenção é provar as funções novas e não a RPC de entrada (que já foi ensaiada na origem do contato); no banco vivo, abrir atendimento dispara `tg_atendimento_avisa_grupo`, que enfileira em `notificacoes_fila` dentro da mesma transação, e o erro final desfaz isso junto; a prova 10b desliga um gatilho de `whatsapp_conversas` por alguns segundos (ver a prova); as provas 27 e 38 se adaptam se o banco não tem grupo da equipe ou não tem usuário gestor (dizem isso na saída em vez de falhar); e a prova 35 se adapta se o banco vivo não aceitar telefone sem número normalizável.

**Uma regra do ensaio: todo o bloco roda numa transação só, então `now()` é um instante só.** As provas que dependem de tempo (expirar, freio por janela, `desligada_em`) mudam as colunas de tempo à mão (`now() - interval ...`) em vez de esperar.

## 0. Antes de aplicar: o que as migrações supõem do banco

```sql
-- 0.1 Nada da triagem existe ainda. Esperado: 0 em todas as linhas.
SELECT 'tabelas da triagem' AS item, count(*)::text AS valor
  FROM pg_class WHERE relnamespace = 'public'::regnamespace
   AND relname IN ('whatsapp_triagem_config', 'whatsapp_triagem_passos', 'whatsapp_triagem_respostas',
                   'whatsapp_triagem_termos_proibidos', 'whatsapp_triagens', 'whatsapp_triagem_eventos',
                   'whatsapp_automacao_bloqueios', 'whatsapp_horarios_atendimento', 'whatsapp_feriados')
UNION ALL SELECT 'tipos triagem_*', count(*)::text FROM pg_type WHERE typnamespace = 'public'::regnamespace AND typname LIKE 'triagem\_%'
UNION ALL SELECT 'funções triagem_* e _triagem_*', count(*)::text FROM pg_proc
  WHERE pronamespace = 'public'::regnamespace AND (proname LIKE 'triagem\_%' OR proname LIKE '\_triagem\_%')
UNION ALL SELECT 'funções de horário novas', count(*)::text FROM pg_proc
  WHERE pronamespace = 'public'::regnamespace AND proname IN ('whatsapp_dentro_do_horario', 'whatsapp_horario_em_texto');
```

```sql
-- 0.2 As funções vivas em que a B4 se apoia são as que foram lidas. Esperado em 13/11/2026:
SELECT proname, pronargs, md5(prosrc) AS md5_do_corpo, proacl::text AS acl
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND proname IN ('_wa_mensagem_antes_inserir', 'whatsapp_ia_enviar', 'whatsapp_registrar_mensagem',
                  '_wa_telefone_da_equipe', 'whatsapp_salvar_configuracoes', 'normalize_whatsapp_phone', 'bex_normalizar_texto')
ORDER BY 1;
```

| função | pronargs | md5_do_corpo |
| --- | --- | --- |
| _wa_mensagem_antes_inserir | 0 | 9efd3ba8a1b6829d6ae923079c8d43e5 |
| _wa_telefone_da_equipe | 1 | 5dd2860ff3abbddb14dc0fa134138b26 |
| bex_normalizar_texto | 1 | 1f87e835d9e0015ffe145fc5d2baac4e |
| normalize_whatsapp_phone | 1 | 439e7ea16ac8e0147a9fdee2a3307086 |
| whatsapp_ia_enviar | 3 | d841150f076a0f67022f51353aad5951 |
| whatsapp_registrar_mensagem | 12 | c5c91b5dc24d3d0abf79b7b229cafeb4 |
| whatsapp_salvar_configuracoes | 2 | 5826c616bf40c25f165bac1f632cf46f |

Se algum md5 for diferente, alguém mudou a função depois de 13/11: NÃO aplique a B4 sem reler. A premissa central é que uma saída com origem `automacao` não zera `aguardando_desde` nem põe a conversa em modo humano (a B4 também confere isso sozinha, pelo texto da função, e se não achar desfaz).

```sql
-- 0.3 A premissa da B4 sobre origens e sobre a fila.
SELECT direcao, origem, count(*) FROM public.whatsapp_mensagens GROUP BY 1, 2 ORDER BY 1, 2;
-- Esperado: entrada/automacao, entrada/humano, saida/automacao, saida/celular, saida/humano. Nenhuma origem a mais.

SELECT pg_get_constraintdef(oid) FROM pg_constraint
 WHERE conrelid = 'public.whatsapp_mensagens'::regclass AND conname = 'whatsapp_mensagens_origem_check';
-- Esperado: origem NULL ou uma de humano, celular, automacao, ia. A B4 NÃO muda este CHECK.

SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
 WHERE conrelid = 'public.whatsapp_fila_envio'::regclass AND contype IN ('c', 'u');
-- Esperado: só UNIQUE (idempotency_key). Nenhum CHECK em status: o valor 'cancelada' entra sem migração.

SELECT DISTINCT status FROM public.whatsapp_fila_envio;
-- Esperado hoje: enviada, falha.
```

```sql
-- 0.4 Onda A aplicada (a B4 exige) e nenhuma tabela de feriado ou horário (a B3 só cria se não houver).
SELECT 'leads.tipo existe' AS item, EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
         AND table_name = 'leads' AND column_name = 'tipo')::text AS valor
UNION ALL SELECT 'mapa de anúncios', (to_regclass('public.conjuntos_anuncio') IS NOT NULL AND to_regclass('public.anuncios_origem') IS NOT NULL)::text
UNION ALL SELECT 'hoje_br() existe (a B4 usa em vez de current_date)', (to_regprocedure('public.hoje_br()') IS NOT NULL)::text
UNION ALL SELECT 'enfileirar_notificacao e grupo_equipe_destino existem (o aviso ao grupo sai por elas)',
  (to_regprocedure('public.enfileirar_notificacao(text, text, uuid, text, text, uuid, text, jsonb, text)') IS NOT NULL
   AND to_regprocedure('public.grupo_equipe_destino()') IS NOT NULL)::text
UNION ALL SELECT 'grupo da equipe configurado (se false, o aviso espera sem se perder)', (public.grupo_equipe_destino() IS NOT NULL)::text
UNION ALL SELECT 'tabelas de feriado, calendário ou horário',
  coalesce((SELECT string_agg(relname, ', ') FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'
             AND relname ~* '(feriad|expedient|calendario|horari)'), 'nenhuma');
-- Esperado: true, true, true, true, o que for a verdade sobre o grupo (true se o grupo da equipe está ligado), nenhuma.

-- 0.5 O horário de hoje, que a B3 copia. Esperado: horario_inicio 08:00, horario_fim 18:00, dias_semana {1,2,3,4,5}.
SELECT horario_inicio, horario_fim, dias_semana FROM public.whatsapp_configuracoes;
```

```sql
-- 0.6 Nenhuma coluna de whatsapp_conversas, whatsapp_mensagens ou whatsapp_fila_envio tem GRANT por coluna
-- (a B4 não cria coluna nelas, mas a B3 e a B4 criam gatilho). Esperado: 0 linhas.
SELECT c.relname, a.attname, a.attacl::text
FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
WHERE c.relnamespace = 'public'::regnamespace
  AND c.relname IN ('whatsapp_conversas', 'whatsapp_mensagens', 'whatsapp_fila_envio', 'whatsapp_configuracoes')
  AND a.attnum > 0 AND a.attacl IS NOT NULL;

-- 0.7 Gatilhos que já existem nas tabelas que vão ganhar gatilho. Esperado depois de aplicar: estes mais os novos.
SELECT tgrelid::regclass AS tabela, tgname FROM pg_trigger
WHERE tgrelid IN ('public.whatsapp_mensagens'::regclass, 'public.whatsapp_conversas'::regclass,
                  'public.whatsapp_configuracoes'::regclass) AND NOT tgisinternal ORDER BY 1, 2;
```

Esperado antes: `tg_whatsapp_conversas_updated`, `tg_whatsapp_mensagens_updated`, `whatsapp_mensagens_atendimento`, `whatsapp_mensagens_liga_entidade` e os que `whatsapp_configuracoes` já tiver.

## 1. Aplicar

Aplique os três arquivos, um de cada vez, NESSA ordem. Cada um abre com `BEGIN;`, fecha com `COMMIT;` e termina com um bloco de conferência que desfaz o arquivo inteiro se algo estiver fora do esperado: sobrecarga de função, RLS desligada, privilégio de `anon`, `authenticated` com mais que leitura, função executável por quem não é o servidor, contagem de sementes errada, texto semeado reprovado pela própria validação, função nova diferente da regra antiga de horário em 49 momentos da semana, premissa sobre `_wa_mensagem_antes_inserir` quebrada.

## 2. DEPOIS: estrutura

```sql
-- 2.1 Tabelas: RLS ligada e quem pode o quê. Esperado: nove linhas, rls true, anon_tem_algo false, auth_escreve false.
SELECT c.relname, c.relrowsecurity AS rls,
       has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS anon_tem_algo,
       has_table_privilege('authenticated', c.oid, 'SELECT') AS auth_le,
       has_table_privilege('authenticated', c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE') AS auth_escreve,
       has_table_privilege('service_role', c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS servico_tudo
FROM pg_class c
WHERE c.relnamespace = 'public'::regnamespace
  AND c.relname IN ('whatsapp_triagem_config', 'whatsapp_triagem_passos', 'whatsapp_triagem_respostas',
                    'whatsapp_triagem_termos_proibidos', 'whatsapp_triagens', 'whatsapp_triagem_eventos',
                    'whatsapp_automacao_bloqueios', 'whatsapp_horarios_atendimento', 'whatsapp_feriados')
ORDER BY 1;
```

Esperado: `auth_le = true` em tudo, MENOS em `whatsapp_automacao_bloqueios`, que nem a equipe lê (`auth_le = false`).

```sql
-- 2.2 Políticas. Esperado: oito linhas (uma por tabela, menos bloqueios), todas FOR SELECT, só authenticated.
SELECT tablename, policyname, cmd, roles::text FROM pg_policies
WHERE schemaname = 'public' AND tablename LIKE ANY (ARRAY['whatsapp\_triagem%', 'whatsapp\_triagens', 'whatsapp\_automacao%', 'whatsapp\_horarios%', 'whatsapp\_feriados'])
ORDER BY 1;
```

```sql
-- 2.3 Funções: ACL, SECURITY DEFINER e search_path. Esperado: anon_executa false e auth_executa false em TODAS.
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS argumentos, p.prosecdef AS definer,
       p.proconfig::text AS config,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_executa,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_executa,
       has_function_privilege('service_role', p.oid, 'EXECUTE') AS servico_executa
FROM pg_proc p
WHERE p.pronamespace = 'public'::regnamespace
  AND (p.proname LIKE 'triagem\_%' OR p.proname LIKE '\_triagem\_%'
       OR p.proname IN ('whatsapp_dentro_do_horario', 'whatsapp_horario_em_texto', '_whatsapp_hora_em_texto',
                        '_whatsapp_dias_em_texto', 'whatsapp_horario_salvar', 'whatsapp_feriado_salvar',
                        'tg_whatsapp_config_sincroniza_horario'))
ORDER BY 1;
```

Esperado: 39 linhas (10 da B1, 7 da B3, 22 da B4), cada nome UMA vez (sem sobrecarga), `servico_executa = true`. `definer = true` e `config` com `search_path=public` nas funções que escrevem ou leem tabela; as puras (`_triagem_texto_plano`, `_triagem_normalizar_frase`, `_triagem_numeros_validos`, `_triagem_toca_atualizado_em`, `_triagem_config_antes_gravar`, `_triagem_problemas_de_texto`, `_triagem_passo_validar`, `_triagem_hash`, `_triagem_sorteio`, `_triagem_parece_robo`, `_triagem_nome_valido`, `_triagem_lista_limpa`, `_whatsapp_hora_em_texto`, `_whatsapp_dias_em_texto`) podem ser definer falso, mas todas têm `search_path=public`. `_triagem_desligar_interno` e `_triagem_desligar_config` são as do freio: só `service_role` executa, e a pública `triagem_desligar` exige usuário e permissão. `_triagem_degrau_permite` (só lê) e `_triagem_recompor_ultima` são as duas novas da terceira revisão. `triagem_pausar_por_humano` tem `config` com `search_path=public` e `lock_timeout=1s`.

```sql
-- 2.4 Gatilhos novos.
SELECT tgrelid::regclass AS tabela, tgname, CASE WHEN (tgtype & 2) = 2 THEN 'BEFORE' ELSE 'AFTER' END AS quando,
       pg_get_triggerdef(oid) AS definicao
FROM pg_trigger
WHERE tgname IN ('tg_triagem_pausa_por_mensagem', 'tg_triagem_pausa_por_conversa', 'tg_whatsapp_config_sincroniza_horario',
                 'tg_triagem_config_antes_gravar', 'tg_triagem_config_sem_truncate', 'tg_triagem_passo_validar',
                 'tg_triagem_respostas_atualizado')
  AND NOT tgisinternal ORDER BY 1, 2;
```

Esperado: a pausa por mensagem é AFTER INSERT com `WHEN` de saída que não é `automacao` nem `ia`; a pausa por conversa é AFTER UPDATE OF `responsavel_id, atribuido_para, modo, status`; `whatsapp_mensagens_atendimento` continua sendo o único BEFORE INSERT de `whatsapp_mensagens`.

```sql
-- 2.5 O CHECK de origem das mensagens e a fila NÃO mudaram. Esperado: igual ao 0.3.
SELECT pg_get_constraintdef(oid) FROM pg_constraint
 WHERE conrelid = 'public.whatsapp_mensagens'::regclass AND conname = 'whatsapp_mensagens_origem_check';
SELECT count(*) AS funcoes_vivas_trocadas FROM pg_proc
 WHERE pronamespace = 'public'::regnamespace
   AND ((proname = '_wa_mensagem_antes_inserir' AND md5(prosrc) <> '9efd3ba8a1b6829d6ae923079c8d43e5')
     OR (proname = 'whatsapp_ia_enviar' AND md5(prosrc) <> 'd841150f076a0f67022f51353aad5951')
     OR (proname = 'whatsapp_registrar_mensagem' AND md5(prosrc) <> 'c5c91b5dc24d3d0abf79b7b229cafeb4')
     OR (proname = 'whatsapp_salvar_configuracoes' AND md5(prosrc) <> '5826c616bf40c25f165bac1f632cf46f'));
-- Esperado: 0 (nenhuma função viva foi tocada).
```

```sql
-- 2.6 Chaves estrangeiras das tabelas da triagem sem índice que as encabece. Esperado: zero linhas.
SELECT k.conrelid::regclass AS tabela, k.conname, pg_get_constraintdef(k.oid) AS chave
FROM pg_constraint k
WHERE k.contype = 'f'
  AND k.conrelid IN ('public.whatsapp_triagens'::regclass, 'public.whatsapp_triagem_eventos'::regclass, 'public.whatsapp_automacao_bloqueios'::regclass)
  AND NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = k.conrelid AND i.indisvalid
                    AND (i.indkey::int2[])[0:cardinality(k.conkey) - 1] = k.conkey);
```

## 3. DEPOIS: as sementes e o estado de nascença

```sql
-- 3.1 Configuração: uma linha, desligada. Esperado: estado desligada, percentual 0, numeros_teste {}, vale_a_partir_de nulo,
-- max_mensagens 8, agente_apos_triagem false, retencao_eventos_dias 90.
SELECT estado, percentual, numeros_teste, vale_a_partir_de, max_mensagens, max_tentativas_por_passo, espera_resposta_min,
       intervalo_minimo_s, atraso_min_s, atraso_max_s, agente_apos_triagem, avisar_grupo, retencao_eventos_dias FROM public.whatsapp_triagem_config;

-- 3.2 Contagens. Esperado: passos 32 (cliente 22, parceiro 10), respostas 770, termos 24, horários 7, feriados 0,
-- triagens 0, eventos 0, bloqueios 0.
SELECT 'passos' AS item, count(*) FROM public.whatsapp_triagem_passos
UNION ALL SELECT 'passos do cliente', count(*) FROM public.whatsapp_triagem_passos WHERE ramo = 'cliente'
UNION ALL SELECT 'respostas', count(*) FROM public.whatsapp_triagem_respostas
UNION ALL SELECT 'termos proibidos', count(*) FROM public.whatsapp_triagem_termos_proibidos
UNION ALL SELECT 'horários', count(*) FROM public.whatsapp_horarios_atendimento
UNION ALL SELECT 'feriados', count(*) FROM public.whatsapp_feriados
UNION ALL SELECT 'triagens', count(*) FROM public.whatsapp_triagens
UNION ALL SELECT 'eventos', count(*) FROM public.whatsapp_triagem_eventos
UNION ALL SELECT 'bloqueios', count(*) FROM public.whatsapp_automacao_bloqueios;

-- 3.3 Regras do dono nas sementes. Esperado: 0 em todas.
SELECT 'texto do cliente com parceiro, revenda ou tabela' AS regra, count(*) FROM public.whatsapp_triagem_passos
 WHERE ramo = 'cliente' AND (texto || ' ' || coalesce(repeticao, '') || ' ' || array_to_string(variantes, ' ')) ~* 'parceir|parceri|terceiriz|revend|tabela|diferenciad|link_parceiro'
UNION ALL SELECT 'travessão', count(*) FROM public.whatsapp_triagem_passos WHERE texto ~ '[—–―‒−⸺⸻﹘﹣－]' OR coalesce(repeticao, '') ~ '[—–―‒−⸺⸻﹘﹣－]'
UNION ALL SELECT 'seta', count(*) FROM public.whatsapp_triagem_passos WHERE texto ~ '[←-⇿➔-➾⟰-⟿⤀-⥿⬅-⬇]|->|=>|<-' OR coalesce(repeticao, '') ~ '[←-⇿➔-➾⟰-⟿⤀-⥿⬅-⬇]|->|=>|<-'
UNION ALL SELECT 'parênteses', count(*) FROM public.whatsapp_triagem_passos WHERE texto ~ '[()]' OR coalesce(repeticao, '') ~ '[()]'
UNION ALL SELECT 'texto reprovado pela própria validação', count(*) FROM public.whatsapp_triagem_passos p
 WHERE cardinality(public._triagem_problemas_de_texto(p.texto, p.ramo, true)) > 0;
```

```sql
-- 3.4 Horário: a função nova responde como a regra antiga e o texto sai da tabela.
SELECT public.whatsapp_horario_em_texto() AS texto,
       public.whatsapp_dentro_do_horario('2026-11-16 10:00-03') AS segunda_10h,
       public.whatsapp_dentro_do_horario('2026-11-16 18:00-03') AS segunda_18h_em_ponto,
       public.whatsapp_dentro_do_horario('2026-11-21 10:00-03') AS sabado_10h,
       public.whatsapp_dentro_do_horario('2026-11-22 10:00-03') AS domingo_10h;
```

Esperado: `{"abre": "8h", "dias": "de segunda a sexta", "fecha": "18h"}`, true, false, false, false. Sábado fica inativo até o dono decidir (pergunta 1 do projeto).

## 4. ENSAIO: uma conversa de teste inteira pelas funções da B4

Rode inteiro. Usa telefones fictícios (`55969999900NN`), liga a triagem em `teste` só para eles, simula as conversas e termina em `RAISE EXCEPTION`, que desfaz TUDO: a configuração volta a `desligada`, nenhuma conversa, mensagem, fila, notificação, triagem, evento nem bloqueio fica no banco. Pré-requisitos: pelo menos uma instância de WhatsApp e um usuário com o papel `admin` (sem ele o bloco para com `FALHOU`, porque as provas da exclusão da equipe, da permissão de desligar e da escada não provariam nada). Se existir um usuário com `configuracoes.manage` e sem `whatsapp.manage` (o gestor), a prova 38 também prova que ele não liga o robô. O bloco muda temporariamente o telefone do admin para provar a exclusão da equipe, e o erro final desfaz isso também.

Provas novas da terceira revisão (41 a 43, mais mudanças na 38): descer a escada vale para a triagem em curso, recomposição da última mensagem nos cancelamentos em lote, dono da conversa sem linha de triagem, os sete freios que exigem `whatsapp.manage` e o gatilho da configuração que recusa pular degrau. A partir desta revisão o gatilho da configuração recusa subir mais de um degrau também num `UPDATE` direto, por isso o ensaio sobe de `desligada` para `ensaio` e só depois para `teste`.

Provas da revisão anterior (25 a 40, mais 10b, 20b e 35b): rajada, corrida de dois webhooks, aviso ao grupo, conversa reaberta, portão no meio do fluxo, dono da conversa, desligar sem apagar mensagem que já saiu, expiração e retomada, freio só depois de `desligada_em`, CHECK recursivo, `parar` sem chave e em ensaio, ensaio que exercita o tempo, teto, escada e permissão, horário com dias diferentes, nome do banco igual ao do TypeScript.

Sem sequências: tudo que o ensaio cria usa `gen_random_uuid()` e a tabela `whatsapp_atendimento_seq`, que o desfazer reverte. Se você acrescentar cenário que use `nextval`, a sequência não volta.

```sql
DO $ensaio$
DECLARE
  v_inst uuid := (SELECT id FROM public.whatsapp_instancias LIMIT 1);
  v_user uuid;
  v_gestor uuid;
  v_r text[] := '{}';
  v_c1 uuid; v_c2 uuid; v_c3 uuid; v_c4 uuid; v_c5 uuid; v_c6 uuid; v_c7 uuid; v_c8 uuid; v_c9 uuid;
  v_ca uuid; v_cb uuid; v_cc uuid; v_cli uuid;
  v_m uuid; v_m2 uuid; v_m3 uuid;
  v_s jsonb; v_a jsonb; v_j jsonb; v_t public.whatsapp_triagens%ROWTYPE; v_t2 public.whatsapp_triagens%ROWTYPE;
  v_n integer; v_x text; v_txt text; v_grupo text; v_ag timestamptz; v_ag_antes timestamptz; v_ok boolean;
  v_cs uuid[];
BEGIN
  IF v_inst IS NULL THEN RAISE EXCEPTION 'FALHOU: não há instância de WhatsApp para o ensaio'; END IF;
  -- quem edita a configuração: um admin (tem whatsapp.manage e configuracoes.manage). Sem ele várias provas não provariam nada
  -- (a exclusão da equipe, a permissão de desligar e a escada), então a ausência é erro, não "passa".
  SELECT ur.user_id INTO v_user FROM public.user_roles ur WHERE ur.role::text = 'admin' LIMIT 1;
  IF v_user IS NULL THEN RAISE EXCEPTION 'FALHOU: não há usuário com o papel admin para o ensaio'; END IF;
  -- um usuário com configuracoes.manage e SEM whatsapp.manage (o gestor), se existir, para provar a política
  SELECT u.id INTO v_gestor FROM public.usuarios u
   WHERE u.ativo AND public.has_permission(u.id, 'configuracoes.manage') AND NOT public.has_permission(u.id, 'whatsapp.manage') LIMIT 1;

  -- 0. liga em TESTE, só para os telefones fictícios (grava direto: é ensaio, tudo desfaz no fim)
  -- (o ensaio abre dezenas de triagens na mesma hora, então o freio de volume por hora e por dia sobe só aqui)
  -- Atenção: o gatilho da configuração agora também recusa pular degrau (desligada, ensaio, teste, parcial, ligada), mesmo num
  -- UPDATE direto. Por isso, quando o ensaio sai de 'desligada', ele sobe um degrau por vez, como a função de salvar.
  UPDATE public.whatsapp_triagem_config SET estado = 'ensaio';
  UPDATE public.whatsapp_triagem_config SET estado = 'teste', max_novas_por_hora = 100, max_novas_por_dia = 1000,
    numeros_teste = ARRAY['96999990001','96999990002','96999990003','96999990004','96999990005','96999990006','96999990009',
                          '96999990010','96999990012','96999990013','96999990014'];
  IF (SELECT vale_a_partir_de FROM public.whatsapp_triagem_config) IS NULL THEN
    RAISE EXCEPTION 'FALHOU: vale_a_partir_de não foi preenchido ao sair de desligada'; END IF;
  v_r := array_append(v_r, ('0) config em teste, vale_a_partir_de preenchido')::text);

  ---------------------------------------------------------------------------------------------------------
  -- CONVERSA 1: caminho completo com aguardando_desde, duplicada, nome inválido, versão velha e humano que pausa
  INSERT INTO public.whatsapp_conversas (instancia_id, telefone, chat_lid) VALUES (v_inst, '5596999990001', '99999999990001@lid') RETURNING id INTO v_c1;
  INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, zapi_message_id, direcao, tipo, status, texto, origem, recebido_em)
  VALUES (v_c1, v_inst, 'ENSAIO-1-A', 'entrada', 'texto', 'recebida', 'Oi', 'humano', now()) RETURNING id INTO v_m;
  SELECT aguardando_desde INTO v_ag_antes FROM public.whatsapp_conversas WHERE id = v_c1;
  IF v_ag_antes IS NULL THEN RAISE EXCEPTION 'FALHOU: a entrada não pôs o contato na fila de espera'; END IF;

  v_s := public.triagem_ler_ou_abrir(v_c1, v_m);
  IF v_s ->> 'dono' <> 'triagem' THEN RAISE EXCEPTION 'FALHOU 1: dono % motivo %', v_s ->> 'dono', v_s ->> 'motivo'; END IF;
  SELECT * INTO v_t FROM public.whatsapp_triagens WHERE conversa_id = v_c1;
  v_r := array_append(v_r, (format('1) triagem aberta: status %s, modo %s, versão %s, ramo %s', v_t.status, v_t.modo, v_t.versao, v_t.ramo))::text);

  v_a := public.triagem_aplicar(v_t.id, v_t.versao, jsonb_build_object(
    'mensagem_id', v_m,
    'estado', jsonb_build_object('passo', 'nome', 'tentativas_passo', 0, 'mensagens_enviadas', 1),
    'envio', jsonb_build_object('texto', 'Olá, seja bem-vindo à Bex Print! Como posso te chamar?', 'chave', 'triagem:' || v_t.id || ':nome:1',
                                'atraso_s', 4, 'passo', 'nome', 'ordem', 1, 'codigos', jsonb_build_array('nome'), 'variaveis', '[]'::jsonb)));
  IF NOT coalesce((v_a ->> 'enviado')::boolean, false) THEN RAISE EXCEPTION 'FALHOU 2: não enviou: %', v_a; END IF;
  SELECT count(*) INTO v_n FROM public.whatsapp_mensagens WHERE conversa_id = v_c1 AND direcao = 'saida' AND origem = 'automacao' AND payload ? 'triagem';
  v_r := array_append(v_r, (format('2) mensagem da triagem gravada com origem automacao e marca triagem: %s; linhas na fila com a chave da triagem: %s',
    v_n, (SELECT count(*) FROM public.whatsapp_fila_envio WHERE conversa_id = v_c1 AND idempotency_key LIKE 'triagem:%' AND status = 'pendente')))::text);
  SELECT aguardando_desde INTO v_ag FROM public.whatsapp_conversas WHERE id = v_c1;
  IF v_ag IS DISTINCT FROM v_ag_antes THEN RAISE EXCEPTION 'FALHOU 3: aguardando_desde mudou depois da mensagem automacao (% -> %)', v_ag_antes, v_ag; END IF;
  v_r := array_append(v_r, ('3) aguardando_desde continua contando depois da mensagem automacao (a equipe ainda vê o contato esperando)')::text);
  IF (SELECT modo FROM public.whatsapp_conversas WHERE id = v_c1) <> 'auto' THEN RAISE EXCEPTION 'FALHOU 3b: a mensagem automacao pôs a conversa em modo humano'; END IF;

  -- segunda entrada igual (webhook entregue duas vezes)
  v_s := public.triagem_ler_ou_abrir(v_c1, v_m);
  v_a := public.triagem_aplicar(v_t.id, v_t.versao + 1, jsonb_build_object('mensagem_id', v_m,
    'envio', jsonb_build_object('texto', 'repetido', 'chave', 'triagem:' || v_t.id || ':nome:1b', 'passo', 'nome', 'ordem', 2)));
  SELECT count(*) INTO v_n FROM public.whatsapp_mensagens WHERE conversa_id = v_c1 AND direcao = 'saida';
  IF v_s ->> 'motivo' <> 'entrada_repetida' OR NOT coalesce((v_a ->> 'duplicada')::boolean, false) OR v_n <> 1 THEN
    RAISE EXCEPTION 'FALHOU 4: duplicada %, aplicar %, saídas %', v_s ->> 'motivo', v_a, v_n; END IF;
  v_r := array_append(v_r, (format('4) a segunda entrada igual não duplica: ler_ou_abrir diz %s, aplicar diz duplicada, saídas continuam %s', v_s ->> 'motivo', v_n))::text);

  -- mesma chave de envio: nada duplica
  v_a := public.triagem_enviar(v_t.id, 'Olá, seja bem-vindo à Bex Print! Como posso te chamar?', 'triagem:' || v_t.id || ':nome:1', 4, 'nome', 1, ARRAY['nome']);
  IF NOT coalesce((v_a ->> 'duplicado')::boolean, false) THEN RAISE EXCEPTION 'FALHOU 5: chave repetida gerou envio: %', v_a; END IF;
  v_r := array_append(v_r, ('5) mesma chave de idempotência da fila não gera segunda mensagem')::text);

  -- resposta com nome inválido (pedido de produto) e depois nome bom
  INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, zapi_message_id, direcao, tipo, status, texto, origem, recebido_em)
  VALUES (v_c1, v_inst, 'ENSAIO-1-B', 'entrada', 'texto', 'recebida', 'quero 100 banners', 'humano', now()) RETURNING id INTO v_m2;
  SELECT * INTO v_t FROM public.whatsapp_triagens WHERE id = v_t.id;
  v_a := public.triagem_aplicar(v_t.id, v_t.versao, jsonb_build_object('mensagem_id', v_m2,
    'gravar', jsonb_build_object('nome_informado', 'Quero Banners', 'nome_completo', true)));
  SELECT * INTO v_t FROM public.whatsapp_triagens WHERE id = v_t.id;
  IF v_t.nome_informado IS NOT NULL THEN RAISE EXCEPTION 'FALHOU 6: gravou nome inválido: %', v_t.nome_informado; END IF;
  SELECT count(*) INTO v_n FROM public.whatsapp_triagem_eventos WHERE triagem_id = v_t.id AND tipo = 'nome_nao_gravado';
  v_r := array_append(v_r, (format('6) nome "quero banners" não foi gravado (eventos nome_nao_gravado: %s)', v_n))::text);

  -- versão velha: conflito
  v_a := public.triagem_aplicar(v_t.id, v_t.versao - 1, jsonb_build_object('gravar', jsonb_build_object('nome_informado', 'Maria Souza')));
  IF NOT coalesce((v_a ->> 'conflito')::boolean, false) THEN RAISE EXCEPTION 'FALHOU 7: versão velha não deu conflito: %', v_a; END IF;
  v_r := array_append(v_r, ('7) gravação em cima de leitura velha devolve conflito')::text);

  INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, zapi_message_id, direcao, tipo, status, texto, origem, recebido_em)
  VALUES (v_c1, v_inst, 'ENSAIO-1-C', 'entrada', 'texto', 'recebida', 'Maria Souza', 'humano', now()) RETURNING id INTO v_m3;
  v_a := public.triagem_aplicar(v_t.id, v_t.versao, jsonb_build_object('mensagem_id', v_m3,
    'estado', jsonb_build_object('passo', 'primeira_vez', 'mensagens_enviadas', 2),
    'gravar', jsonb_build_object('nome_informado', 'Maria Souza', 'nome_completo', true, 'telefone_alternativo', '96988887777'),
    'envio', jsonb_build_object('texto', 'Prazer, Maria! Você já é cliente da Bex Print ou está nos conhecendo agora?',
                                'chave', 'triagem:' || v_t.id || ':primeira_vez:2', 'atraso_s', 3, 'passo', 'primeira_vez', 'ordem', 2,
                                'codigos', jsonb_build_array('primeira_vez'), 'variaveis', jsonb_build_array('primeiro_nome'))));
  SELECT * INTO v_t FROM public.whatsapp_triagens WHERE id = v_t.id;
  IF v_t.nome_informado <> 'Maria Souza' OR NOT v_t.nome_completo THEN RAISE EXCEPTION 'FALHOU 8: nome bom não foi gravado'; END IF;
  IF v_t.telefone_alternativo_verificado THEN RAISE EXCEPTION 'FALHOU 8b: alternativo nasceu verificado'; END IF;
  v_r := array_append(v_r, (format('8) nome bom gravado (%s); telefone alternativo guardado SEM verificação (verificado = %s); mensagens enviadas %s',
                       v_t.nome_informado, v_t.telefone_alternativo_verificado, v_t.mensagens_enviadas))::text);

  -- gente da equipe responde pelo painel: a triagem pausa e a pergunta pendente é cancelada
  SELECT count(*) INTO v_n FROM public.whatsapp_fila_envio WHERE conversa_id = v_c1 AND status = 'pendente';
  INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, direcao, tipo, status, texto, origem, enviada_por)
  VALUES (v_c1, v_inst, 'saida', 'texto', 'enviada', 'Oi Maria, aqui é a equipe.', 'humano', v_user);
  SELECT status INTO v_x FROM public.whatsapp_triagens WHERE id = v_t.id;
  IF v_x <> 'pausada_humano' THEN RAISE EXCEPTION 'FALHOU 9: humano não pausou (status %)', v_x; END IF;
  v_r := array_append(v_r, (format('9) humano respondeu: triagem %s; fila pendente antes %s, depois %s; mensagem pendente da triagem ainda existe: %s',
    v_x, v_n, (SELECT count(*) FROM public.whatsapp_fila_envio WHERE conversa_id = v_c1 AND status = 'pendente'),
    (SELECT count(*) FROM public.whatsapp_mensagens WHERE conversa_id = v_c1 AND status = 'pendente' AND direcao = 'saida')))::text);
  -- a caixa não mostra como última mensagem a pergunta que foi apagada sem sair
  IF (SELECT ultima_mensagem FROM public.whatsapp_conversas WHERE id = v_c1) LIKE 'Prazer, Maria%' THEN
    RAISE EXCEPTION 'FALHOU 9a: a última mensagem da conversa continua sendo a pergunta apagada'; END IF;
  -- O BEFORE INSERT vivo põe a conversa em modo humano e quem pausa primeiro é o gatilho de CONVERSA (motivo conversa_assumida).
  IF (SELECT e.detalhe ->> 'motivo' FROM public.whatsapp_triagem_eventos e WHERE e.triagem_id = v_t.id AND e.tipo = 'pausa' ORDER BY e.criado_em DESC LIMIT 1)
     <> 'conversa_assumida' THEN RAISE EXCEPTION 'FALHOU 9b: motivo da pausa pelo painel'; END IF;
  SELECT * INTO v_t FROM public.whatsapp_triagens WHERE id = v_t.id;
  v_a := public.triagem_aplicar(v_t.id, v_t.versao, jsonb_build_object('envio', jsonb_build_object('texto', 'não deveria sair', 'chave', 'triagem:' || v_t.id || ':x:9', 'passo', 'nome', 'ordem', 9)));
  IF v_a ->> 'ok' <> 'false' THEN RAISE EXCEPTION 'FALHOU 10: aplicar depois da pausa aceitou: %', v_a; END IF;
  v_s := public.triagem_ler_ou_abrir(v_c1, v_m3);
  IF v_s ->> 'dono' <> 'ninguem' THEN RAISE EXCEPTION 'FALHOU 10b: dono depois da pausa %', v_s ->> 'dono'; END IF;
  v_r := array_append(v_r, (format('10) depois da pausa: aplicar recusa (%s) e o dono da conversa é "%s"', v_a ->> 'motivo', v_s ->> 'dono'))::text);

  -- 10b) o ramo saida_humana do gatilho de MENSAGEM, pelo caminho real do celular da empresa (enviada_por nulo, origem humano,
  -- que o BEFORE INSERT vivo troca por celular). Como o gatilho de conversa dispara antes e pausa com outro motivo, ele é
  -- desligado SÓ aqui, dentro do ensaio. O ALTER TABLE segura a tabela whatsapp_conversas por alguns segundos até o erro final
  -- desfazer tudo; se não quiser isso no banco vivo, pule a 10b (as outras provas não dependem dela).
  INSERT INTO public.whatsapp_conversas (instancia_id, telefone) VALUES (v_inst, '5596999990010') RETURNING id INTO v_ca;
  INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, zapi_message_id, direcao, tipo, status, texto, origem, recebido_em)
  VALUES (v_ca, v_inst, 'ENSAIO-10-A', 'entrada', 'texto', 'recebida', 'Oi', 'humano', now()) RETURNING id INTO v_m;
  v_s := public.triagem_ler_ou_abrir(v_ca, v_m);
  SELECT * INTO v_t FROM public.whatsapp_triagens WHERE conversa_id = v_ca;
  ALTER TABLE public.whatsapp_conversas DISABLE TRIGGER tg_triagem_pausa_por_conversa;
  INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, direcao, tipo, status, texto, origem, enviada_por)
  VALUES (v_ca, v_inst, 'saida', 'texto', 'enviada', 'Oi, aqui é a equipe pelo celular.', 'humano', NULL);
  ALTER TABLE public.whatsapp_conversas ENABLE TRIGGER tg_triagem_pausa_por_conversa;
  SELECT status INTO v_x FROM public.whatsapp_triagens WHERE id = v_t.id;
  IF v_x <> 'pausada_humano'
     OR (SELECT e.detalhe ->> 'motivo' FROM public.whatsapp_triagem_eventos e WHERE e.triagem_id = v_t.id AND e.tipo = 'pausa') <> 'saida_humana'
     OR (SELECT origem FROM public.whatsapp_mensagens WHERE conversa_id = v_ca AND direcao = 'saida') <> 'celular' THEN
    RAISE EXCEPTION 'FALHOU 10b: gatilho de mensagem sozinho: status %', v_x; END IF;
  v_r := array_append(v_r, ('10b) mensagem do celular da empresa (origem celular) com o gatilho de conversa desligado: triagem pausada_humano, motivo saida_humana')::text);

  ---------------------------------------------------------------------------------------------------------
  -- CONVERSA 2: desligar cancela os pendentes
  INSERT INTO public.whatsapp_conversas (instancia_id, telefone) VALUES (v_inst, '5596999990002') RETURNING id INTO v_c2;
  INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, zapi_message_id, direcao, tipo, status, texto, origem, recebido_em)
  VALUES (v_c2, v_inst, 'ENSAIO-2-A', 'entrada', 'texto', 'recebida', 'Boa tarde', 'humano', now()) RETURNING id INTO v_m;
  v_s := public.triagem_ler_ou_abrir(v_c2, v_m);
  SELECT * INTO v_t FROM public.whatsapp_triagens WHERE conversa_id = v_c2;
  v_a := public.triagem_aplicar(v_t.id, v_t.versao, jsonb_build_object('mensagem_id', v_m,
    'estado', jsonb_build_object('passo', 'nome', 'mensagens_enviadas', 1),
    'envio', jsonb_build_object('texto', 'Olá! Qual é o seu nome?', 'chave', 'triagem:' || v_t.id || ':nome:1', 'atraso_s', 3, 'passo', 'nome', 'ordem', 1)));
  SELECT count(*) INTO v_n FROM public.whatsapp_fila_envio WHERE conversa_id = v_c2 AND status = 'pendente';
  IF v_n <> 1 THEN RAISE EXCEPTION 'FALHOU 11: esperava 1 pendente, achou %', v_n; END IF;
  v_a := public.triagem_desligar('ensaio: botão vermelho', v_user);
  SELECT status INTO v_x FROM public.whatsapp_triagens WHERE id = v_t.id;
  IF v_x <> 'pausada_desligada' OR (SELECT estado FROM public.whatsapp_triagem_config) <> 'desligada'
     OR (SELECT count(*) FROM public.whatsapp_fila_envio WHERE conversa_id = v_c2 AND status = 'pendente') <> 0 THEN
    RAISE EXCEPTION 'FALHOU 11b: desligar não limpou (status %, estado %)', v_x, (SELECT estado FROM public.whatsapp_triagem_config); END IF;
  IF (SELECT ultima_mensagem FROM public.whatsapp_conversas WHERE id = v_c2) <> 'Boa tarde' THEN
    RAISE EXCEPTION 'FALHOU 11c: a última mensagem da conversa não voltou para a que existe de verdade'; END IF;
  v_r := array_append(v_r, (format('11) desligar: estado desligada, triagem %s, pendentes na fila 0, canceladas na fila %s; dono da conversa agora "%s"',
    v_x, (SELECT count(*) FROM public.whatsapp_fila_envio WHERE conversa_id = v_c2 AND status = 'cancelada'), public.triagem_dono_da_conversa(v_c2)))::text);
  -- desligada: conversa nova segue o caminho de hoje e não grava nada
  INSERT INTO public.whatsapp_conversas (instancia_id, telefone) VALUES (v_inst, '5596999990003') RETURNING id INTO v_c3;
  INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, zapi_message_id, direcao, tipo, status, texto, origem, recebido_em)
  VALUES (v_c3, v_inst, 'ENSAIO-3-A', 'entrada', 'texto', 'recebida', 'Oi', 'humano', now()) RETURNING id INTO v_m;
  v_s := public.triagem_ler_ou_abrir(v_c3, v_m);
  IF v_s ->> 'dono' <> 'assistente' OR v_s ->> 'motivo' <> 'desligada' OR EXISTS (SELECT 1 FROM public.whatsapp_triagens WHERE conversa_id = v_c3) THEN
    RAISE EXCEPTION 'FALHOU 12: desligada abriu triagem: %', v_s; END IF;
  v_r := array_append(v_r, ('12) com a triagem desligada, a conversa nova não gera linha em whatsapp_triagens (dono = assistente, como hoje)')::text);

  ---------------------------------------------------------------------------------------------------------
  -- religa em teste para os próximos cenários (de desligada, um degrau por vez)
  UPDATE public.whatsapp_triagem_config SET estado = 'ensaio';
  UPDATE public.whatsapp_triagem_config SET estado = 'teste';

  -- CONVERSA 4: aviso de pedido (automacao SEM marca triagem) NÃO pausa; e saída anterior impede abrir
  INSERT INTO public.whatsapp_conversas (instancia_id, telefone) VALUES (v_inst, '5596999990004') RETURNING id INTO v_c4;
  INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, zapi_message_id, direcao, tipo, status, texto, origem, recebido_em)
  VALUES (v_c4, v_inst, 'ENSAIO-4-A', 'entrada', 'texto', 'recebida', 'Oi', 'humano', now()) RETURNING id INTO v_m;
  v_s := public.triagem_ler_ou_abrir(v_c4, v_m);
  SELECT * INTO v_t FROM public.whatsapp_triagens WHERE conversa_id = v_c4;
  INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, direcao, tipo, status, texto, origem, payload)
  VALUES (v_c4, v_inst, 'saida', 'texto', 'enviada', 'Seu pedido está em produção.', 'automacao', '{"fonte":"notificacoes_fila"}');
  SELECT status INTO v_x FROM public.whatsapp_triagens WHERE id = v_t.id;
  IF v_x <> 'ativa' THEN RAISE EXCEPTION 'FALHOU 13: aviso de pedido (automacao) pausou a triagem (status %)', v_x; END IF;
  v_r := array_append(v_r, (format('13) saída automacao de aviso de pedido NÃO pausa: triagem continua %s; as saídas automáticas de fora contam no teto: %s',
    v_x, (public.triagem_ler_ou_abrir(v_c4, v_m) ->> 'automaticas_de_fora')))::text);
  INSERT INTO public.whatsapp_conversas (instancia_id, telefone) VALUES (v_inst, '5596999990005') RETURNING id INTO v_c5;
  INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, direcao, tipo, status, texto, origem, payload)
  VALUES (v_c5, v_inst, 'saida', 'texto', 'enviada', 'Seu orçamento foi aprovado.', 'automacao', '{"fonte":"notificacoes_fila"}');
  INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, zapi_message_id, direcao, tipo, status, texto, origem, recebido_em)
  VALUES (v_c5, v_inst, 'ENSAIO-5-A', 'entrada', 'texto', 'recebida', 'sim', 'humano', now()) RETURNING id INTO v_m;
  v_s := public.triagem_ler_ou_abrir(v_c5, v_m);
  IF v_s ->> 'motivo' <> 'ja_atendida' OR EXISTS (SELECT 1 FROM public.whatsapp_triagens WHERE conversa_id = v_c5)
     OR EXISTS (SELECT 1 FROM public.whatsapp_triagem_eventos e WHERE e.conversa_id = v_c5) THEN
    RAISE EXCEPTION 'FALHOU 14: "sim" com saída anterior abriu triagem ou gerou evento: %', v_s; END IF;
  v_r := array_append(v_r, ('14) conversa com saída anterior e entrada "sim": zero triagens e zero eventos (motivo ja_atendida)')::text);

  -- CONVERSA 6: parar guarda hash por conversa, lid e telefone; nova conversa do mesmo lid fica de fora
  INSERT INTO public.whatsapp_conversas (instancia_id, telefone, chat_lid) VALUES (v_inst, '5596999990006', '99999999990006@lid') RETURNING id INTO v_c6;
  INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, zapi_message_id, direcao, tipo, status, texto, origem, recebido_em)
  VALUES (v_c6, v_inst, 'ENSAIO-6-A', 'entrada', 'texto', 'recebida', 'Oi', 'humano', now()) RETURNING id INTO v_m;
  v_s := public.triagem_ler_ou_abrir(v_c6, v_m);
  SELECT * INTO v_t FROM public.whatsapp_triagens WHERE conversa_id = v_c6;
  v_a := public.triagem_aplicar(v_t.id, v_t.versao, jsonb_build_object('mensagem_id', v_m,
    'estado', jsonb_build_object('status', 'parada_pelo_contato', 'motivo_fim', 'parar'), 'bloquear_contato', true));
  SELECT count(*) INTO v_n FROM public.whatsapp_automacao_bloqueios WHERE telefone_hash IS NOT NULL AND lid_hash IS NOT NULL AND conversa_id = v_c6;
  IF v_n <> 1 OR NOT public._triagem_bloqueado(v_c6) THEN RAISE EXCEPTION 'FALHOU 15: bloqueio não gravado (%)', v_n; END IF;
  IF EXISTS (SELECT 1 FROM public.whatsapp_automacao_bloqueios WHERE telefone_hash = '96999990006' OR lid_hash LIKE '%99999999990006%') THEN
    RAISE EXCEPTION 'FALHOU 15b: bloqueio guardou o número em claro'; END IF;
  -- mesma pessoa volta por outra conversa só com o lid
  UPDATE public.whatsapp_conversas SET chat_lid = NULL WHERE id = v_c6;
  INSERT INTO public.whatsapp_conversas (instancia_id, telefone, chat_lid) VALUES (v_inst, '5596999990099', '99999999990006@lid') RETURNING id INTO v_c7;
  UPDATE public.whatsapp_triagem_config SET numeros_teste = numeros_teste || ARRAY['96999990099'];
  INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, zapi_message_id, direcao, tipo, status, texto, origem, recebido_em)
  VALUES (v_c7, v_inst, 'ENSAIO-7-A', 'entrada', 'texto', 'recebida', 'Oi', 'humano', now()) RETURNING id INTO v_m;
  v_s := public.triagem_ler_ou_abrir(v_c7, v_m);
  IF v_s ->> 'motivo' <> 'bloqueado' THEN RAISE EXCEPTION 'FALHOU 16: contato bloqueado só por lid foi aceito: %', v_s; END IF;
  v_r := array_append(v_r, ('15) parar: bloqueio guardado só em hash (telefone e lid), nada em claro')::text);
  v_r := array_append(v_r, (format('16) a mesma pessoa em outra conversa, só com o lid: motivo %s, dono %s', v_s ->> 'motivo', v_s ->> 'dono'))::text);

  -- CONVERSA 8: telefone da equipe fica de fora do teste de número comum; só entra como número de teste
  UPDATE public.usuarios SET telefone = '96999990009', ativo = true WHERE id = v_user;  -- vira o celular de alguém da equipe (desfeito no fim)
  UPDATE public.whatsapp_triagem_config SET numeros_teste = array_remove(numeros_teste, '96999990009');
  INSERT INTO public.whatsapp_conversas (instancia_id, telefone) VALUES (v_inst, '5596999990009') RETURNING id INTO v_c8;
  INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, zapi_message_id, direcao, tipo, status, texto, origem, recebido_em)
  VALUES (v_c8, v_inst, 'ENSAIO-8-A', 'entrada', 'texto', 'recebida', 'Oi', 'humano', now()) RETURNING id INTO v_m;
  v_s := public.triagem_ler_ou_abrir(v_c8, v_m);
  IF v_s ->> 'motivo' <> 'equipe' THEN RAISE EXCEPTION 'FALHOU 17: a exclusão da equipe não foi provada: %', v_s; END IF;
  v_r := array_append(v_r, (format('17) celular de gente da equipe fora da lista de teste: motivo %s', v_s ->> 'motivo'))::text);
  -- grupo: o servidor avisa pelo contexto
  INSERT INTO public.whatsapp_conversas (instancia_id, telefone) VALUES (v_inst, '5596999990020-group') RETURNING id INTO v_c9;
  INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, zapi_message_id, direcao, tipo, status, texto, origem, recebido_em)
  VALUES (v_c9, v_inst, 'ENSAIO-9-A', 'entrada', 'texto', 'recebida', 'oi', 'humano', now()) RETURNING id INTO v_m;
  v_s := public.triagem_ler_ou_abrir(v_c9, v_m, '{"eh_grupo": true}');
  IF v_s ->> 'motivo' <> 'grupo' THEN RAISE EXCEPTION 'FALHOU 18: grupo %', v_s; END IF;
  v_r := array_append(v_r, (format('18) grupo: motivo %s, dono %s', v_s ->> 'motivo', v_s ->> 'dono'))::text);

  -- cliente cadastrado que escreve de um número que o vínculo da conversa não acha (só telefone_2)
  INSERT INTO public.clientes (nome, telefone_2) VALUES ('Cliente Ensaio', '96999990030');
  INSERT INTO public.whatsapp_conversas (instancia_id, telefone) VALUES (v_inst, '5596999990030') RETURNING id INTO v_c9;
  UPDATE public.whatsapp_triagem_config SET numeros_teste = numeros_teste || ARRAY['96999990030'];
  INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, zapi_message_id, direcao, tipo, status, texto, origem, recebido_em)
  VALUES (v_c9, v_inst, 'ENSAIO-30-A', 'entrada', 'texto', 'recebida', 'Oi', 'humano', now()) RETURNING id INTO v_m;
  v_s := public.triagem_ler_ou_abrir(v_c9, v_m);
  IF v_s ->> 'motivo' <> 'cliente_conhecido' OR EXISTS (SELECT 1 FROM public.whatsapp_triagens WHERE conversa_id = v_c9) THEN
    RAISE EXCEPTION 'FALHOU 18b: cliente só com telefone_2 foi triado: %', v_s; END IF;
  v_r := array_append(v_r, (format('18b) cliente cadastrado com o número só em telefone_2: motivo %s, nenhuma triagem', v_s ->> 'motivo'))::text);

  -- robô de empresa: origem automacao na entrada não abre; texto com link ou "digite 1 para" também não
  IF public._triagem_parece_robo('Digite 1 para falar com o atendente') IS NULL OR public._triagem_parece_robo('Acesse https://golpe.exemplo') IS NULL THEN
    RAISE EXCEPTION 'FALHOU 19: robô passou'; END IF;
  v_r := array_append(v_r, ('19) sinais estruturais de robô (menu, link) reconhecidos')::text);

  ---------------------------------------------------------------------------------------------------------
  -- texto barrado: não envia, grava texto_barrado e entrega UMA conversa à equipe. NÃO desliga a triagem de todos por causa
  -- de um contato: o freio global só dispara por contagem (3 textos barrados em 30 minutos).
  UPDATE public.whatsapp_triagem_config SET estado = 'teste';
  INSERT INTO public.whatsapp_conversas (instancia_id, telefone) VALUES (v_inst, '5596999990005') ON CONFLICT DO NOTHING;
  v_c5 := (SELECT id FROM public.whatsapp_conversas WHERE telefone_normalizado = '96999990005');
  DELETE FROM public.whatsapp_mensagens WHERE conversa_id = v_c5 AND direcao = 'saida';
  INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, zapi_message_id, direcao, tipo, status, texto, origem, recebido_em)
  VALUES (v_c5, v_inst, 'ENSAIO-5-B', 'entrada', 'texto', 'recebida', 'Oi de novo', 'humano', now()) RETURNING id INTO v_m;
  v_s := public.triagem_ler_ou_abrir(v_c5, v_m);
  SELECT * INTO v_t FROM public.whatsapp_triagens WHERE conversa_id = v_c5;
  v_a := public.triagem_aplicar(v_t.id, v_t.versao, jsonb_build_object('mensagem_id', v_m,
    'envio', jsonb_build_object('texto', 'Temos preço de parceiro por R$ 10', 'chave', 'triagem:' || v_t.id || ':nome:1', 'passo', 'nome', 'ordem', 1)));
  SELECT status INTO v_x FROM public.whatsapp_triagens WHERE id = v_t.id;
  IF NOT coalesce((v_a ->> 'barrado')::boolean, false)
     OR (SELECT estado FROM public.whatsapp_triagem_config) <> 'teste'
     OR v_x <> 'entregue_equipe'
     OR EXISTS (SELECT 1 FROM public.whatsapp_fila_envio WHERE conversa_id = v_c5)
     OR NOT EXISTS (SELECT 1 FROM public.whatsapp_triagem_eventos WHERE triagem_id = v_t.id AND tipo = 'texto_barrado') THEN
    RAISE EXCEPTION 'FALHOU 20: texto barrado desligou todos ou enfileirou: %', v_a; END IF;
  v_r := array_append(v_r, (format('20) texto com parceiro e R$ no ramo cliente: barrado (regras %s), nada na fila, só esta triagem parou (%s) e a configuração continua %s',
    v_a ->> 'regras', v_x, (SELECT estado FROM public.whatsapp_triagem_config)))::text);

  -- 20b) o caso que derrubava tudo: o contato responde "Pix" ao pedido de nome e o texto montado ("Prazer, Pix!") é barrado.
  -- Dois barrados a mais fecham 3 em 30 minutos e AÍ o freio desliga a triagem de todos.
  UPDATE public.whatsapp_triagem_config SET desligada_em = now() - interval '1 hour';
  FOR v_n IN 1..2 LOOP
    INSERT INTO public.whatsapp_conversas (instancia_id, telefone) VALUES (v_inst, '55969999900' || (11 + v_n)::text) RETURNING id INTO v_c9;
    INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, zapi_message_id, direcao, tipo, status, texto, origem, recebido_em)
    VALUES (v_c9, v_inst, 'ENSAIO-20B-' || v_n, 'entrada', 'texto', 'recebida', 'Pix', 'humano', now()) RETURNING id INTO v_m;
    v_s := public.triagem_ler_ou_abrir(v_c9, v_m);
    SELECT * INTO v_t FROM public.whatsapp_triagens WHERE conversa_id = v_c9;
    v_a := public.triagem_aplicar(v_t.id, v_t.versao, jsonb_build_object('mensagem_id', v_m,
      'gravar', jsonb_build_object('nome_informado', 'Pix', 'nome_completo', false),
      'envio', jsonb_build_object('texto', 'Prazer, Pix! Você já é cliente da Bex Print?', 'chave', 'triagem:' || v_t.id || ':primeira_vez:2',
                                  'passo', 'primeira_vez', 'ordem', 2)));
    IF NOT coalesce((v_a ->> 'barrado')::boolean, false) OR (v_a -> 'regras') <> '["pix"]'::jsonb THEN
      RAISE EXCEPTION 'FALHOU 20b: "Prazer, Pix!" não foi barrado como pix: %', v_a; END IF;
    IF v_n = 1 AND ((SELECT estado FROM public.whatsapp_triagem_config) <> 'teste' OR coalesce((v_a ->> 'freio')::boolean, false)) THEN
      RAISE EXCEPTION 'FALHOU 20b: dois barrados já desligaram tudo'; END IF;
  END LOOP;
  IF (SELECT estado FROM public.whatsapp_triagem_config) <> 'desligada' OR NOT coalesce((v_a ->> 'freio')::boolean, false) THEN
    RAISE EXCEPTION 'FALHOU 20b: o terceiro texto barrado em 30 minutos não disparou o freio: %', v_a; END IF;
  v_r := array_append(v_r, (format('20b) respostas "Pix" ao pedido de nome: cada uma barra o texto e entrega só a sua conversa; o terceiro barrado em 30 minutos dispara o freio (estado %s)',
    (SELECT estado FROM public.whatsapp_triagem_config)))::text);

  ---------------------------------------------------------------------------------------------------------
  -- ENSAIO (modo ensaio): nada em mensagens nem na fila, só evento sem texto
  UPDATE public.whatsapp_triagem_config SET estado = 'ensaio', numeros_teste = '{}';
  INSERT INTO public.whatsapp_conversas (instancia_id, telefone) VALUES (v_inst, '5596999990011') RETURNING id INTO v_c9;
  INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, zapi_message_id, direcao, tipo, status, texto, origem, recebido_em)
  VALUES (v_c9, v_inst, 'ENSAIO-11-A', 'entrada', 'texto', 'recebida', 'Oi', 'humano', now()) RETURNING id INTO v_m;
  v_s := public.triagem_ler_ou_abrir(v_c9, v_m);
  SELECT * INTO v_t FROM public.whatsapp_triagens WHERE conversa_id = v_c9;
  v_a := public.triagem_aplicar(v_t.id, v_t.versao, jsonb_build_object('mensagem_id', v_m,
    'estado', jsonb_build_object('passo', 'nome', 'mensagens_enviadas', 1),
    'envio', jsonb_build_object('texto', 'Olá, Maria! este texto nunca deve aparecer em evento', 'chave', 'triagem:' || v_t.id || ':nome:1',
                                'passo', 'nome', 'ordem', 1, 'atraso_s', 4, 'codigos', jsonb_build_array('nome'), 'variaveis', jsonb_build_array('primeiro_nome'))));
  SELECT count(*) INTO v_n FROM public.whatsapp_fila_envio WHERE conversa_id = v_c9;
  IF v_n <> 0 OR EXISTS (SELECT 1 FROM public.whatsapp_mensagens WHERE conversa_id = v_c9 AND direcao = 'saida')
     OR v_t.status <> 'ensaio' OR NOT EXISTS (SELECT 1 FROM public.whatsapp_triagem_eventos WHERE triagem_id = v_t.id AND tipo = 'envio_ensaio')
     OR EXISTS (SELECT 1 FROM public.whatsapp_triagem_eventos WHERE triagem_id = v_t.id AND detalhe::text LIKE '%nunca deve aparecer%') THEN
    RAISE EXCEPTION 'FALHOU 21: ensaio escreveu fila, mensagem ou guardou texto: %', v_a; END IF;
  v_r := array_append(v_r, (format('21) modo ensaio: status %s, zero linhas em fila e em mensagens de saída, evento envio_ensaio sem o texto', v_t.status))::text);
  -- o CHECK de eventos recusa chave com cara de conteúdo
  v_ok := false;
  BEGIN
    INSERT INTO public.whatsapp_triagem_eventos (triagem_id, conversa_id, tipo, detalhe) VALUES (v_t.id, v_c9, 'pulou', '{"texto":"oi"}');
  EXCEPTION WHEN check_violation THEN v_ok := true; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'FALHOU 22: evento aceitou chave texto'; END IF;
  v_r := array_append(v_r, ('22) evento com chave "texto" é recusado pelo CHECK')::text);

  -- varredura: expira a que ficou em silêncio, devolve avisos, e a retenção apaga evento velho
  -- (o ensaio agora grava ultimo_envio_em como o real, então os três relógios voltam duas horas)
  UPDATE public.whatsapp_triagens SET iniciada_em = now() - interval '2 hours', ultima_entrada_em = now() - interval '2 hours',
         ultimo_envio_em = now() - interval '2 hours' WHERE id = v_t.id;
  UPDATE public.whatsapp_triagem_config SET estado = 'teste';
  v_s := public.triagem_varrer();
  SELECT status INTO v_x FROM public.whatsapp_triagens WHERE id = v_t.id;
  IF v_x <> 'expirada' THEN RAISE EXCEPTION 'FALHOU 23: não expirou (status %, varrer %)', v_x, v_s; END IF;
  v_r := array_append(v_r, (format('23) varredura: triagem em silêncio %s; resultado %s', v_x, v_s::text))::text);

  -- ninguém de fora executa as funções novas
  v_ok := false;
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM public.triagem_dono_da_conversa(v_c1);
  EXCEPTION WHEN insufficient_privilege THEN v_ok := true; END;
  RESET ROLE;
  IF NOT v_ok THEN RAISE EXCEPTION 'FALHOU 24: anon executou triagem_dono_da_conversa'; END IF;
  v_ok := false;
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM public.triagem_varrer();
  EXCEPTION WHEN insufficient_privilege THEN v_ok := true; END;
  RESET ROLE;
  IF NOT v_ok THEN RAISE EXCEPTION 'FALHOU 24b: authenticated executou triagem_varrer'; END IF;
  v_r := array_append(v_r, ('24) anon e authenticated levam "permission denied" nas funções novas')::text);

  ---------------------------------------------------------------------------------------------------------
  -- SEGUNDA REVISÃO: rajada, corrida, aviso ao grupo, portão, travas, ensaio, expiração, freio, política.
  -- Estado de partida destas provas: teste, só para os telefones fictícios abaixo (a configuração é regravada direto).
  DELETE FROM public.whatsapp_triagem_eventos WHERE tipo = 'texto_barrado';   -- os das provas 20 e 20b não entram na conta do freio daqui para a frente
  UPDATE public.whatsapp_triagem_config SET estado = 'teste', percentual = 0, max_mensagens = 8, desligada_em = now() - interval '1 hour',
    numeros_teste = ARRAY['96999990015','96999990016','96999990017','96999990018','96999990019','96999990021','96999990022',
                          '96999990023','96999990024','96999990025','96999990026','96999990027','96999990028'];

  -- 25) RAJADA: três mensagens em 15 segundos. O servidor junta as três e aplica uma vez, passando os ids; as três viram
  -- evento 'entrada' e nenhuma volta como pendente nem é interpretada de novo.
  INSERT INTO public.whatsapp_conversas (instancia_id, telefone) VALUES (v_inst, '5596999990015') RETURNING id INTO v_ca;
  INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, zapi_message_id, direcao, tipo, status, texto, origem, recebido_em, created_at)
  VALUES (v_ca, v_inst, 'ENSAIO-25-A', 'entrada', 'texto', 'recebida', 'Oi', 'humano', now(), now() - interval '15 seconds') RETURNING id INTO v_m;
  INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, zapi_message_id, direcao, tipo, status, texto, origem, recebido_em, created_at)
  VALUES (v_ca, v_inst, 'ENSAIO-25-B', 'entrada', 'texto', 'recebida', 'Maria', 'humano', now(), now() - interval '10 seconds') RETURNING id INTO v_m2;
  INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, zapi_message_id, direcao, tipo, status, texto, origem, recebido_em, created_at)
  VALUES (v_ca, v_inst, 'ENSAIO-25-C', 'entrada', 'texto', 'recebida', 'Souza', 'humano', now(), now() - interval '5 seconds') RETURNING id INTO v_m3;
  v_s := public.triagem_ler_ou_abrir(v_ca, v_m3);
  IF jsonb_array_length(v_s -> 'pendentes') <> 2 THEN RAISE EXCEPTION 'FALHOU 25: pendentes %', v_s -> 'pendentes'; END IF;
  SELECT * INTO v_t FROM public.whatsapp_triagens WHERE conversa_id = v_ca;
  v_a := public.triagem_aplicar(v_t.id, v_t.versao, jsonb_build_object('mensagem_id', v_m3, 'mensagens_ids', jsonb_build_array(v_m, v_m2),
    'estado', jsonb_build_object('passo', 'primeira_vez', 'mensagens_enviadas', 1),
    'gravar', jsonb_build_object('nome_informado', 'Maria Souza', 'nome_completo', true)));
  SELECT count(*) INTO v_n FROM public.whatsapp_triagem_eventos WHERE triagem_id = v_t.id AND tipo = 'entrada';
  IF v_n <> 3 THEN RAISE EXCEPTION 'FALHOU 25b: eventos de entrada %', v_n; END IF;
  v_s := public.triagem_ler_ou_abrir(v_ca, v_m);
  v_j := public.triagem_ler_ou_abrir(v_ca, v_m2);
  IF v_s ->> 'motivo' <> 'entrada_repetida' OR v_j ->> 'motivo' <> 'entrada_repetida' THEN
    RAISE EXCEPTION 'FALHOU 25c: mensagem juntada voltou: % %', v_s ->> 'motivo', v_j ->> 'motivo'; END IF;
  v_r := array_append(v_r, (format('25) rajada: 2 pendentes juntadas, %s eventos de entrada, as mensagens juntadas voltam como %s', v_n, v_s ->> 'motivo'))::text);

  -- 26) CORRIDA de dois webhooks seguidos: o segundo (a2) fecha antes do primeiro (a1). a1 NÃO é interpretada depois de a2.
  INSERT INTO public.whatsapp_conversas (instancia_id, telefone) VALUES (v_inst, '5596999990016') RETURNING id INTO v_cb;
  INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, zapi_message_id, direcao, tipo, status, texto, origem, recebido_em, created_at)
  VALUES (v_cb, v_inst, 'ENSAIO-26-A', 'entrada', 'texto', 'recebida', 'Oi', 'humano', now(), now() - interval '10 seconds') RETURNING id INTO v_m;
  INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, zapi_message_id, direcao, tipo, status, texto, origem, recebido_em, created_at)
  VALUES (v_cb, v_inst, 'ENSAIO-26-B', 'entrada', 'texto', 'recebida', 'Ana Lima', 'humano', now(), now() - interval '5 seconds') RETURNING id INTO v_m2;
  v_s := public.triagem_ler_ou_abrir(v_cb, v_m2);
  SELECT * INTO v_t FROM public.whatsapp_triagens WHERE conversa_id = v_cb;
  v_a := public.triagem_aplicar(v_t.id, v_t.versao, jsonb_build_object('mensagem_id', v_m2, 'estado', jsonb_build_object('passo', 'primeira_vez')));
  v_s := public.triagem_ler_ou_abrir(v_cb, v_m);
  SELECT * INTO v_t FROM public.whatsapp_triagens WHERE id = v_t.id;
  v_a := public.triagem_aplicar(v_t.id, v_t.versao, jsonb_build_object('mensagem_id', v_m,
    'envio', jsonb_build_object('texto', 'não deveria sair', 'chave', 'triagem:' || v_t.id || ':nome:77', 'passo', 'nome', 'ordem', 7)));
  IF v_s ->> 'motivo' <> 'entrada_repetida' OR NOT coalesce((v_a ->> 'duplicada')::boolean, false)
     OR EXISTS (SELECT 1 FROM public.whatsapp_fila_envio WHERE conversa_id = v_cb) THEN
    RAISE EXCEPTION 'FALHOU 26: entrada mais antiga foi interpretada: % %', v_s ->> 'motivo', v_a; END IF;
  v_r := array_append(v_r, (format('26) corrida de dois webhooks: a mensagem mais antiga que a já aplicada volta como %s no ler e como %s no aplicar, nada na fila',
    v_s ->> 'motivo', v_a ->> 'motivo'))::text);

  -- 27) AVISO AO GRUPO: decidido pelo aplicar, ENFILEIRADO pelo varrer em notificacoes_fila (chave triagem_aviso:<id>), só o
  -- primeiro nome. Rodar o varrer de novo não duplica. Se o banco não tem grupo da equipe configurado, nada é marcado.
  SELECT * INTO v_t FROM public.whatsapp_triagens WHERE conversa_id = v_ca;
  v_a := public.triagem_aplicar(v_t.id, v_t.versao, jsonb_build_object(
    'aviso_grupo', jsonb_build_object('motivo', 'concluida', 'marcas', jsonb_build_array('pediu_preco', 'Maria Souza')),
    'eventos', jsonb_build_array(jsonb_build_object('tipo', 'aviso_grupo', 'detalhe', jsonb_build_object('motivo', 'duplicado')))));
  SELECT count(*) INTO v_n FROM public.whatsapp_triagem_eventos WHERE triagem_id = v_t.id AND tipo = 'aviso_grupo';
  IF v_n <> 1 THEN RAISE EXCEPTION 'FALHOU 27: evento aviso_grupo duplicado (%)', v_n; END IF;
  v_grupo := public.grupo_equipe_destino();
  v_s := public.triagem_varrer();
  v_j := public.triagem_varrer();
  SELECT count(*), max(variaveis ->> 'texto') INTO v_n, v_txt FROM public.notificacoes_fila WHERE idempotency_key = 'triagem_aviso:' || v_t.id;
  SELECT aviso_grupo_enviado_em IS NOT NULL INTO v_ok FROM public.whatsapp_triagens WHERE id = v_t.id;
  IF v_grupo IS NOT NULL THEN
    IF v_n <> 1 OR NOT v_ok OR v_txt LIKE '%Souza%' OR v_txt NOT LIKE '%Maria%' OR v_txt NOT LIKE '%conversa=' || v_ca || '%'
       OR (v_s ->> 'avisos_enfileirados')::integer <> 1 OR (v_j ->> 'avisos_enfileirados')::integer <> 0 THEN
      RAISE EXCEPTION 'FALHOU 27b: aviso % linhas, marcado %, rodada 1 %, rodada 2 %, texto %', v_n, v_ok, v_s, v_j, v_txt; END IF;
    v_r := array_append(v_r, (format('27) aviso ao grupo: 1 linha em notificacoes_fila com a chave da triagem, só o primeiro nome, marcas de fora descartadas, 2ª rodada enfileira %s; evento aviso_grupo uma vez só', v_j ->> 'avisos_enfileirados'))::text);
  ELSE
    IF v_n <> 0 OR v_ok THEN RAISE EXCEPTION 'FALHOU 27c: sem grupo da equipe o aviso foi marcado como enviado'; END IF;
    v_r := array_append(v_r, ('27) aviso ao grupo: este banco não tem grupo da equipe ligado, então nada foi enfileirado nem marcado (o aviso espera); evento aviso_grupo uma vez só')::text);
  END IF;

  -- 28) PORTÃO: conversa que a equipe já fechou e a pessoa escreveu de novo (o registro da mensagem reabre e zera responsável e modo)
  INSERT INTO public.whatsapp_conversas (instancia_id, telefone) VALUES (v_inst, '5596999990017') RETURNING id INTO v_cc;
  INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, zapi_message_id, direcao, tipo, status, texto, origem, recebido_em)
  VALUES (v_cc, v_inst, 'ENSAIO-28-A', 'entrada', 'texto', 'recebida', 'Oi', 'humano', now());
  UPDATE public.whatsapp_atendimentos SET fechado_em = now(), fechado_por = v_user,
         motivo_resolucao = (SELECT e.enumlabel FROM pg_enum e WHERE e.enumtypid = 'public.whatsapp_motivo_resolucao'::regtype
                              AND e.enumlabel <> 'outro' ORDER BY e.enumsortorder LIMIT 1)::public.whatsapp_motivo_resolucao
   WHERE conversa_id = v_cc;
  UPDATE public.whatsapp_conversas SET atendimento_ativo_id = NULL, aguardando_desde = NULL WHERE id = v_cc;
  INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, zapi_message_id, direcao, tipo, status, texto, origem, recebido_em)
  VALUES (v_cc, v_inst, 'ENSAIO-28-B', 'entrada', 'texto', 'recebida', 'Oi de novo', 'humano', now()) RETURNING id INTO v_m;
  SELECT count(*) INTO v_n FROM public.whatsapp_atendimentos WHERE conversa_id = v_cc AND reaberto_de IS NOT NULL;
  IF v_n <> 1 OR (SELECT responsavel_id FROM public.whatsapp_conversas WHERE id = v_cc) IS NOT NULL THEN
    RAISE EXCEPTION 'FALHOU 28: o cenário não reabriu a conversa como o banco vivo faz (reabertos %)', v_n; END IF;
  v_s := public.triagem_ler_ou_abrir(v_cc, v_m);
  IF v_s ->> 'motivo' <> 'ja_atendida' OR EXISTS (SELECT 1 FROM public.whatsapp_triagens WHERE conversa_id = v_cc) THEN
    RAISE EXCEPTION 'FALHOU 28b: conversa reaberta abriu triagem: %', v_s; END IF;
  v_r := array_append(v_r, (format('28) conversa fechada pela equipe e reaberta pela mensagem nova (responsável e modo já zerados): motivo %s, nenhuma triagem', v_s ->> 'motivo'))::text);

  -- 29) PORTÃO NO MEIO DO FLUXO: cliente vinculado depois de a triagem abrir, e bloqueio manual novo
  INSERT INTO public.clientes (nome) VALUES ('Cliente Ensaio 2') RETURNING id INTO v_cli;
  INSERT INTO public.whatsapp_conversas (instancia_id, telefone) VALUES (v_inst, '5596999990018') RETURNING id INTO v_ca;
  INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, zapi_message_id, direcao, tipo, status, texto, origem, recebido_em)
  VALUES (v_ca, v_inst, 'ENSAIO-29-A', 'entrada', 'texto', 'recebida', 'Oi', 'humano', now()) RETURNING id INTO v_m;
  v_s := public.triagem_ler_ou_abrir(v_ca, v_m);
  UPDATE public.whatsapp_conversas SET cliente_id = v_cli WHERE id = v_ca;
  v_s := public.triagem_ler_ou_abrir(v_ca, v_m);
  SELECT * INTO v_t FROM public.whatsapp_triagens WHERE conversa_id = v_ca;
  IF v_s ->> 'motivo' <> 'cliente_vinculado' OR v_t.status <> 'pulada' OR v_s ->> 'dono' <> 'ninguem' OR public.triagem_dono_da_conversa(v_ca) <> 'ninguem' THEN
    RAISE EXCEPTION 'FALHOU 29: cliente vinculado no meio: % (status %)', v_s, v_t.status; END IF;
  INSERT INTO public.whatsapp_conversas (instancia_id, telefone) VALUES (v_inst, '5596999990019') RETURNING id INTO v_cb;
  INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, zapi_message_id, direcao, tipo, status, texto, origem, recebido_em)
  VALUES (v_cb, v_inst, 'ENSAIO-29-B', 'entrada', 'texto', 'recebida', 'Oi', 'humano', now()) RETURNING id INTO v_m;
  v_s := public.triagem_ler_ou_abrir(v_cb, v_m);
  INSERT INTO public.whatsapp_automacao_bloqueios (telefone_hash, motivo, origem) VALUES (public._triagem_hash('96999990019'), 'manual', 'ensaio');
  v_s := public.triagem_ler_ou_abrir(v_cb, v_m);
  IF v_s ->> 'motivo' <> 'bloqueado' OR (SELECT status FROM public.whatsapp_triagens WHERE conversa_id = v_cb) <> 'pulada' THEN
    RAISE EXCEPTION 'FALHOU 29b: bloqueio manual no meio: %', v_s; END IF;
  v_r := array_append(v_r, ('29) portão reconferido no meio do fluxo: cliente vinculado e bloqueio manual novo param a triagem em curso (status pulada, dono ninguem)')::text);

  -- 30) DONO DA CONVERSA: robô de empresa e pulada ficam sem dono (nem a assistente responde); pausada por gente que depois
  -- devolveu a conversa à IA (whatsapp_devolver_ia: modo auto, sem responsável) volta para a assistente
  INSERT INTO public.whatsapp_conversas (instancia_id, telefone) VALUES (v_inst, '5596999990021') RETURNING id INTO v_cc;
  INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, zapi_message_id, direcao, tipo, status, texto, origem, recebido_em)
  VALUES (v_cc, v_inst, 'ENSAIO-30-ROBO', 'entrada', 'texto', 'recebida', 'Digite 1 para falar com o atendente', 'humano', now()) RETURNING id INTO v_m;
  v_s := public.triagem_ler_ou_abrir(v_cc, v_m);
  IF v_s ->> 'motivo' <> 'robo' OR v_s ->> 'dono' <> 'ninguem' THEN RAISE EXCEPTION 'FALHOU 30: robô %', v_s; END IF;
  SELECT count(*) INTO v_n FROM public.whatsapp_triagens WHERE conversa_id = v_c1 AND status = 'pausada_humano';
  IF v_n <> 1 OR public.triagem_dono_da_conversa(v_c1) <> 'ninguem' THEN RAISE EXCEPTION 'FALHOU 30b: partida da conversa 1'; END IF;
  UPDATE public.whatsapp_conversas SET modo = 'auto', responsavel_id = NULL WHERE id = v_c1;
  IF public.triagem_dono_da_conversa(v_c1) <> 'assistente' THEN RAISE EXCEPTION 'FALHOU 30c: devolvida à IA e sem dono: %', public.triagem_dono_da_conversa(v_c1); END IF;
  v_r := array_append(v_r, ('30) dono: robô de empresa fica sem dono, pulada fica sem dono, pausada por gente e devolvida à IA volta para a assistente')::text);

  -- 31) DESLIGAR não apaga mensagem que já saiu: o despachante marca a fila como enviada ANTES de marcar a mensagem; se o
  -- botão vermelho cair no meio, a mensagem entregue ao cliente continua no histórico
  INSERT INTO public.whatsapp_conversas (instancia_id, telefone) VALUES (v_inst, '5596999990022') RETURNING id INTO v_ca;
  INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, zapi_message_id, direcao, tipo, status, texto, origem, recebido_em)
  VALUES (v_ca, v_inst, 'ENSAIO-31-A', 'entrada', 'texto', 'recebida', 'Oi', 'humano', now()) RETURNING id INTO v_m;
  v_s := public.triagem_ler_ou_abrir(v_ca, v_m);
  SELECT * INTO v_t FROM public.whatsapp_triagens WHERE conversa_id = v_ca;
  v_a := public.triagem_aplicar(v_t.id, v_t.versao, jsonb_build_object('mensagem_id', v_m, 'estado', jsonb_build_object('passo', 'nome'),
    'envio', jsonb_build_object('texto', 'Olá! Qual é o seu nome?', 'chave', 'triagem:' || v_t.id || ':nome:1', 'passo', 'nome', 'ordem', 1)));
  UPDATE public.whatsapp_fila_envio SET status = 'enviada' WHERE conversa_id = v_ca;   -- o despachante já mandou; a mensagem ainda está pendente
  INSERT INTO public.whatsapp_conversas (instancia_id, telefone) VALUES (v_inst, '5596999990023') RETURNING id INTO v_cb;
  INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, zapi_message_id, direcao, tipo, status, texto, origem, recebido_em)
  VALUES (v_cb, v_inst, 'ENSAIO-31-B', 'entrada', 'texto', 'recebida', 'Oi', 'humano', now()) RETURNING id INTO v_m;
  v_s := public.triagem_ler_ou_abrir(v_cb, v_m);
  SELECT * INTO v_t2 FROM public.whatsapp_triagens WHERE conversa_id = v_cb;
  v_a := public.triagem_aplicar(v_t2.id, v_t2.versao, jsonb_build_object('mensagem_id', v_m, 'estado', jsonb_build_object('passo', 'nome'),
    'envio', jsonb_build_object('texto', 'Olá! Qual é o seu nome?', 'chave', 'triagem:' || v_t2.id || ':nome:1', 'passo', 'nome', 'ordem', 1)));
  v_ok := false;
  BEGIN
    PERFORM public.triagem_desligar('ensaio: sem usuário', NULL);
  EXCEPTION WHEN OTHERS THEN v_ok := true; END;
  IF NOT v_ok OR (SELECT estado FROM public.whatsapp_triagem_config) <> 'teste' THEN RAISE EXCEPTION 'FALHOU 31: desligar sem usuário foi aceito'; END IF;
  v_a := public.triagem_desligar('ensaio: botão vermelho', v_user);
  SELECT count(*) INTO v_n FROM public.whatsapp_mensagens WHERE conversa_id = v_ca AND direcao = 'saida' AND texto = 'Olá! Qual é o seu nome?';
  IF v_n <> 1 THEN RAISE EXCEPTION 'FALHOU 31b: o desligar apagou a mensagem que já tinha saído (%)', v_n; END IF;
  IF EXISTS (SELECT 1 FROM public.whatsapp_mensagens WHERE conversa_id = v_cb AND direcao = 'saida')
     OR (SELECT status FROM public.whatsapp_fila_envio WHERE conversa_id = v_cb) <> 'cancelada' THEN
    RAISE EXCEPTION 'FALHOU 31c: a pergunta que não saiu devia ter sido cancelada e apagada'; END IF;
  SELECT status INTO v_x FROM public.whatsapp_triagens WHERE id = v_t2.id;
  v_r := array_append(v_r, (format('31) desligar: sem usuário é recusado; a mensagem cuja fila já estava enviada continua no histórico (%s), a que não saiu foi cancelada e apagada e a triagem ficou %s', v_n, v_x))::text);
  UPDATE public.whatsapp_triagem_config SET estado = 'ensaio';
  UPDATE public.whatsapp_triagem_config SET estado = 'teste', desligada_em = now() - interval '1 hour';

  -- 32) EXPIRAÇÃO: não leva resposta que chegou e ainda não foi aplicada; depois de aplicada expira; a retomada limpa
  -- motivo_fim e refaz o aviso que a expiração tinha decidido
  INSERT INTO public.whatsapp_conversas (instancia_id, telefone) VALUES (v_inst, '5596999990024') RETURNING id INTO v_ca;
  INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, zapi_message_id, direcao, tipo, status, texto, origem, recebido_em)
  VALUES (v_ca, v_inst, 'ENSAIO-32-A', 'entrada', 'texto', 'recebida', 'Oi', 'humano', now()) RETURNING id INTO v_m;
  v_s := public.triagem_ler_ou_abrir(v_ca, v_m);
  SELECT * INTO v_t FROM public.whatsapp_triagens WHERE conversa_id = v_ca;
  v_a := public.triagem_aplicar(v_t.id, v_t.versao, jsonb_build_object('mensagem_id', v_m, 'estado', jsonb_build_object('passo', 'cep'),
    'gravar', jsonb_build_object('nome_informado', 'Carla Dias', 'nome_completo', true)));
  UPDATE public.whatsapp_triagens SET iniciada_em = now() - interval '2 hours', ultima_entrada_em = now() - interval '2 hours',
         ultimo_envio_em = now() - interval '2 hours' WHERE id = v_t.id;
  INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, zapi_message_id, direcao, tipo, status, texto, origem, recebido_em)
  VALUES (v_ca, v_inst, 'ENSAIO-32-B', 'entrada', 'texto', 'recebida', '68900-000', 'humano', now()) RETURNING id INTO v_m2;
  v_s := public.triagem_varrer();
  SELECT status INTO v_x FROM public.whatsapp_triagens WHERE id = v_t.id;
  IF v_x <> 'ativa' THEN RAISE EXCEPTION 'FALHOU 32: expirou com resposta recebida e não aplicada (status %)', v_x; END IF;
  INSERT INTO public.whatsapp_triagem_eventos (triagem_id, conversa_id, mensagem_id, tipo, passo) VALUES (v_t.id, v_ca, v_m2, 'entrada', 'cep');
  v_s := public.triagem_varrer();
  SELECT * INTO v_t FROM public.whatsapp_triagens WHERE id = v_t.id;
  IF v_t.status <> 'expirada' OR NOT v_t.aviso_grupo_decidido OR v_t.aviso_grupo_motivo <> 'expirada' THEN
    RAISE EXCEPTION 'FALHOU 32b: expiração com resposta aplicada: status %, aviso decidido %', v_t.status, v_t.aviso_grupo_decidido; END IF;
  v_a := public.triagem_aplicar(v_t.id, v_t.versao, jsonb_build_object('estado', jsonb_build_object('status', 'ativa', 'passo', 'cep')));
  SELECT * INTO v_t FROM public.whatsapp_triagens WHERE id = v_t.id;
  v_n := (SELECT CASE WHEN v_grupo IS NOT NULL THEN 2 ELSE 1 END);   -- com grupo, o primeiro aviso já saiu e o novo é a rodada 2
  IF v_t.status <> 'ativa' OR v_t.motivo_fim IS NOT NULL OR v_t.concluida_em IS NOT NULL OR v_t.aviso_grupo_decidido
     OR v_t.aviso_grupo_rodada <> v_n THEN
    RAISE EXCEPTION 'FALHOU 32c: retomada: status %, motivo_fim %, aviso decidido %, rodada %', v_t.status, v_t.motivo_fim, v_t.aviso_grupo_decidido, v_t.aviso_grupo_rodada; END IF;
  v_r := array_append(v_r, (format('32) expiração: resposta já recebida e não aplicada segura a triagem; depois de aplicada expira (aviso decidido com os dados do TypeScript); a retomada limpa motivo_fim e abre a rodada %s do aviso, para o resumo de como terminou', v_t.aviso_grupo_rodada))::text);

  -- 33) FREIO só conta o que aconteceu DEPOIS de desligada_em: três textos barrados de antes do último desligar não reatam;
  -- três de depois desligam
  UPDATE public.whatsapp_triagem_config SET estado = 'teste', desligada_em = now() - interval '10 minutes';
  INSERT INTO public.whatsapp_triagem_eventos (triagem_id, conversa_id, tipo, criado_em, detalhe)
  SELECT v_t.id, v_ca, 'texto_barrado', now() - interval '20 minutes', '{"regras":["pix"]}' FROM generate_series(1, 3);
  v_s := public.triagem_varrer();
  IF v_s ->> 'freio' IS NOT NULL OR (SELECT estado FROM public.whatsapp_triagem_config) <> 'teste' THEN
    RAISE EXCEPTION 'FALHOU 33: o freio reatou por evento de antes de desligada_em: %', v_s; END IF;
  INSERT INTO public.whatsapp_triagem_eventos (triagem_id, conversa_id, tipo, criado_em, detalhe)
  SELECT v_t.id, v_ca, 'texto_barrado', now() - interval '5 minutes', '{"regras":["pix"]}' FROM generate_series(1, 3);
  v_s := public.triagem_varrer();
  IF v_s ->> 'freio' <> 'freio_textos_barrados' OR (SELECT estado FROM public.whatsapp_triagem_config) <> 'desligada' THEN
    RAISE EXCEPTION 'FALHOU 33b: o freio não disparou: %', v_s; END IF;
  SELECT status INTO v_x FROM public.whatsapp_triagens WHERE id = v_t.id;
  v_r := array_append(v_r, (format('33) freio: 3 barrados de antes de desligada_em não desligam (freio nulo); 3 de depois desligam (%s); a triagem aberta ficou %s', v_s ->> 'freio', v_x))::text);
  DELETE FROM public.whatsapp_triagem_eventos WHERE tipo = 'texto_barrado';
  UPDATE public.whatsapp_triagem_config SET estado = 'ensaio';
  UPDATE public.whatsapp_triagem_config SET estado = 'teste', desligada_em = now() - interval '1 hour';

  -- 34) CHECK de eventos recursivo, e variaveis e codigos só com nomes
  SELECT id INTO v_m FROM public.whatsapp_triagens WHERE conversa_id = v_ca;
  v_n := 0;
  FOREACH v_x IN ARRAY ARRAY['{"x":{"texto":"oi"}}', '{"a":[{"b":{"nome":"Maria"}}]}', '{"variaveis":["Maria Souza"]}', '{"variaveis":"primeiro_nome"}',
                             '{"codigos":["Nome completo"]}', '{"variaveis":[1]}'] LOOP
    v_ok := false;
    BEGIN
      INSERT INTO public.whatsapp_triagem_eventos (triagem_id, conversa_id, tipo, detalhe) VALUES (v_m, v_ca, 'pulou', v_x::jsonb);
    EXCEPTION WHEN check_violation THEN v_ok := true; END;
    IF NOT v_ok THEN RAISE EXCEPTION 'FALHOU 34: o CHECK aceitou %', v_x; END IF;
    v_n := v_n + 1;
  END LOOP;
  INSERT INTO public.whatsapp_triagem_eventos (triagem_id, conversa_id, tipo, detalhe)
  VALUES (v_m, v_ca, 'pulou', '{"variaveis":["primeiro_nome","telefone"],"codigos":["nome","primeira_vez"],"x":{"ordem":1}}');
  v_r := array_append(v_r, (format('34) CHECK de eventos: %s formas com conteúdo (aninhado, dentro de lista, variaveis com valor, codigos com espaço) recusadas; nomes de variáveis e códigos aceitos', v_n))::text);

  -- 35) 'parar' sem telefone nem lid não dá exceção, e em ENSAIO não grava bloqueio real
  UPDATE public.whatsapp_triagem_config SET estado = 'parcial', percentual = 100;
  v_ok := true;
  BEGIN
    INSERT INTO public.whatsapp_conversas (instancia_id, telefone) VALUES (v_inst, 'sem-numero-ensaio') RETURNING id INTO v_cb;
    INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, zapi_message_id, direcao, tipo, status, texto, origem, recebido_em)
    VALUES (v_cb, v_inst, 'ENSAIO-35-A', 'entrada', 'texto', 'recebida', 'parar', 'humano', now()) RETURNING id INTO v_m;
  EXCEPTION WHEN OTHERS THEN v_ok := false; v_x := SQLERRM; END;
  IF v_ok THEN
    IF (SELECT telefone_normalizado FROM public.whatsapp_conversas WHERE id = v_cb) IS NOT NULL THEN
      v_r := array_append(v_r, ('35) parar sem telefone nem lid: este banco normaliza o telefone de teste, cenário pulado')::text);
    ELSE
      v_s := public.triagem_ler_ou_abrir(v_cb, v_m);
      SELECT * INTO v_t FROM public.whatsapp_triagens WHERE conversa_id = v_cb;
      v_a := public.triagem_aplicar(v_t.id, v_t.versao, jsonb_build_object('mensagem_id', v_m,
        'estado', jsonb_build_object('status', 'parada_pelo_contato', 'motivo_fim', 'parar'), 'bloquear_contato', true));
      SELECT status INTO v_x FROM public.whatsapp_triagens WHERE id = v_t.id;
      IF v_x <> 'parada_pelo_contato' OR NOT EXISTS (SELECT 1 FROM public.whatsapp_triagem_eventos WHERE triagem_id = v_t.id AND detalhe ->> 'motivo' = 'bloqueio_sem_chave') THEN
        RAISE EXCEPTION 'FALHOU 35: parar sem chave: status %, %', v_x, v_a; END IF;
      v_r := array_append(v_r, ('35) parar sem telefone nem lid: sem exceção, triagem parada, evento bloqueio_sem_chave e nenhum bloqueio gravado')::text);
    END IF;
  ELSE
    v_r := array_append(v_r, (format('35) parar sem telefone nem lid: não deu para criar a conversa de teste neste banco (%s), cenário pulado', v_x))::text);
  END IF;
  UPDATE public.whatsapp_triagem_config SET estado = 'ensaio', percentual = 0;
  INSERT INTO public.whatsapp_conversas (instancia_id, telefone, chat_lid) VALUES (v_inst, '5596999990025', '99999999990025@lid') RETURNING id INTO v_cc;
  INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, zapi_message_id, direcao, tipo, status, texto, origem, recebido_em)
  VALUES (v_cc, v_inst, 'ENSAIO-35-B', 'entrada', 'texto', 'recebida', 'parar', 'humano', now()) RETURNING id INTO v_m;
  v_s := public.triagem_ler_ou_abrir(v_cc, v_m);
  SELECT * INTO v_t FROM public.whatsapp_triagens WHERE conversa_id = v_cc;
  v_a := public.triagem_aplicar(v_t.id, v_t.versao, jsonb_build_object('mensagem_id', v_m,
    'estado', jsonb_build_object('status', 'parada_pelo_contato', 'motivo_fim', 'parar'), 'bloquear_contato', true));
  SELECT count(*) INTO v_n FROM public.whatsapp_automacao_bloqueios WHERE conversa_id = v_cc OR telefone_hash = public._triagem_hash('96999990025');
  IF v_n <> 0 THEN RAISE EXCEPTION 'FALHOU 35b: ensaio gravou bloqueio real (%)', v_n; END IF;
  v_r := array_append(v_r, ('35b) parar em ENSAIO: a pessoa nunca recebeu mensagem do robô, então nenhum bloqueio real é gravado')::text);

  -- 36) ENSAIO exercita o tempo real e NÃO é dono: grava ultimo_envio_em, o dono é a assistente, o instantâneo diz ensaio
  INSERT INTO public.whatsapp_conversas (instancia_id, telefone) VALUES (v_inst, '5596999990026') RETURNING id INTO v_ca;
  UPDATE public.whatsapp_triagem_config SET numeros_teste = '{}';
  INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, zapi_message_id, direcao, tipo, status, texto, origem, recebido_em)
  VALUES (v_ca, v_inst, 'ENSAIO-36-A', 'entrada', 'texto', 'recebida', 'Oi', 'humano', now()) RETURNING id INTO v_m;
  v_s := public.triagem_ler_ou_abrir(v_ca, v_m);
  SELECT * INTO v_t FROM public.whatsapp_triagens WHERE conversa_id = v_ca;
  v_a := public.triagem_aplicar(v_t.id, v_t.versao, jsonb_build_object('mensagem_id', v_m, 'estado', jsonb_build_object('passo', 'nome'),
    'envio', jsonb_build_object('texto', 'Olá! Qual é o seu nome?', 'chave', 'triagem:' || v_t.id || ':nome:1', 'passo', 'nome', 'ordem', 1)));
  SELECT * INTO v_t FROM public.whatsapp_triagens WHERE id = v_t.id;
  INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, zapi_message_id, direcao, tipo, status, texto, origem, recebido_em)
  VALUES (v_ca, v_inst, 'ENSAIO-36-B', 'entrada', 'texto', 'recebida', 'Carla', 'humano', now() + interval '1 second') RETURNING id INTO v_m2;
  v_s := public.triagem_ler_ou_abrir(v_ca, v_m2);
  IF v_t.ultimo_envio_em IS NULL OR v_t.ultima_pergunta_em IS NULL OR v_s ->> 'dono' <> 'assistente' OR NOT coalesce((v_s ->> 'ensaio')::boolean, false)
     OR public.triagem_dono_da_conversa(v_ca) <> 'assistente' OR (v_s -> 'triagem' ->> 'ultimo_envio_em') IS NULL THEN
    RAISE EXCEPTION 'FALHOU 36: ensaio: envio em %, dono %, ensaio %', v_t.ultimo_envio_em, v_s ->> 'dono', v_s ->> 'ensaio'; END IF;
  -- e o ensaio também confere o texto montado: "Pix" como nome aparece como texto_barrado, sem nada na fila
  v_a := public.triagem_aplicar(v_t.id, v_t.versao, jsonb_build_object('mensagem_id', v_m2,
    'envio', jsonb_build_object('texto', 'Prazer, Pix! Você já é cliente?', 'chave', 'triagem:' || v_t.id || ':primeira_vez:2', 'passo', 'primeira_vez', 'ordem', 2)));
  IF NOT coalesce((v_a ->> 'barrado')::boolean, false) OR EXISTS (SELECT 1 FROM public.whatsapp_fila_envio WHERE conversa_id = v_ca) THEN
    RAISE EXCEPTION 'FALHOU 36b: o ensaio não barrou o texto com Pix: %', v_a; END IF;
  v_r := array_append(v_r, (format('36) ensaio: grava ultimo_envio_em e ultima_pergunta_em, o dono é "%s" (a assistente continua respondendo) e o instantâneo diz ensaio; o texto com Pix é barrado também no ensaio (regras %s)',
    v_s ->> 'dono', v_a ->> 'regras'))::text);

  -- 37) TETO: a pergunta que ainda não saiu não conta contra si mesma ao ser substituída
  UPDATE public.whatsapp_triagem_config SET estado = 'teste', max_mensagens = 1, numeros_teste = ARRAY['96999990027'];
  INSERT INTO public.whatsapp_conversas (instancia_id, telefone) VALUES (v_inst, '5596999990027') RETURNING id INTO v_ca;
  INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, zapi_message_id, direcao, tipo, status, texto, origem, recebido_em)
  VALUES (v_ca, v_inst, 'ENSAIO-37-A', 'entrada', 'texto', 'recebida', 'Oi', 'humano', now()) RETURNING id INTO v_m;
  v_s := public.triagem_ler_ou_abrir(v_ca, v_m);
  SELECT * INTO v_t FROM public.whatsapp_triagens WHERE conversa_id = v_ca;
  v_a := public.triagem_enviar(v_t.id, 'Olá! Qual é o seu nome?', 'triagem:' || v_t.id || ':nome:1', 3, 'nome', 1, ARRAY['nome']);
  v_s := public.triagem_enviar(v_t.id, 'Olá! Como posso te chamar?', 'triagem:' || v_t.id || ':nome:2', 3, 'nome', 1, ARRAY['nome']);
  IF NOT coalesce((v_a ->> 'enviado')::boolean, false) OR NOT coalesce((v_s ->> 'enviado')::boolean, false) THEN
    RAISE EXCEPTION 'FALHOU 37: a pergunta que ainda não saiu contou contra o teto: % %', v_a, v_s; END IF;
  UPDATE public.whatsapp_mensagens SET status = 'enviada' WHERE conversa_id = v_ca AND direcao = 'saida';
  UPDATE public.whatsapp_fila_envio SET status = 'enviada' WHERE conversa_id = v_ca;
  v_j := public.triagem_enviar(v_t.id, 'Mais uma pergunta?', 'triagem:' || v_t.id || ':nome:3', 3, 'nome', 2, ARRAY['nome']);
  IF v_j ->> 'motivo' <> 'teto_de_mensagens' THEN RAISE EXCEPTION 'FALHOU 37b: teto %', v_j; END IF;
  SELECT count(*) INTO v_n FROM public.whatsapp_mensagens WHERE conversa_id = v_ca AND direcao = 'saida';
  v_r := array_append(v_r, (format('37) teto de 1: a pergunta pendente foi substituída (saídas %s); com a anterior já enviada, a próxima para em %s', v_n, v_j ->> 'motivo'))::text);
  UPDATE public.whatsapp_triagem_config SET max_mensagens = 8;

  -- 38) POLÍTICA: a escada (um degrau por vez para cima, qualquer um para baixo) e whatsapp.manage para ligar
  UPDATE public.whatsapp_triagem_config SET estado = 'desligada', desligada_em = now() - interval '1 hour';
  v_n := 0;
  FOREACH v_x IN ARRAY ARRAY['ligada', 'parcial', 'teste'] LOOP
    v_ok := false;
    BEGIN
      PERFORM public.triagem_config_salvar(v_user, jsonb_build_object('estado', v_x));
    EXCEPTION WHEN OTHERS THEN v_ok := true; END;
    IF NOT v_ok THEN RAISE EXCEPTION 'FALHOU 38: pulou da desligada direto para %', v_x; END IF;
    v_n := v_n + 1;
  END LOOP;
  PERFORM public.triagem_config_salvar(v_user, '{"estado":"ensaio"}');
  v_ok := false;
  BEGIN PERFORM public.triagem_config_salvar(v_user, '{"estado":"parcial"}'); EXCEPTION WHEN OTHERS THEN v_ok := true; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'FALHOU 38b: ensaio foi direto para parcial'; END IF;
  PERFORM public.triagem_config_salvar(v_user, '{"estado":"teste"}');
  PERFORM public.triagem_config_salvar(v_user, '{"estado":"parcial","percentual":10}');
  PERFORM public.triagem_config_salvar(v_user, '{"estado":"ligada"}');
  PERFORM public.triagem_config_salvar(v_user, '{"estado":"ensaio"}');   -- para baixo, qualquer degrau
  IF (SELECT estado FROM public.whatsapp_triagem_config) <> 'ensaio' THEN RAISE EXCEPTION 'FALHOU 38c: descer não funcionou'; END IF;
  -- a escada vale também no GATILHO da configuração: um UPDATE direto (chave de serviço) de ensaio para ligada é recusado
  v_ok := false;
  BEGIN UPDATE public.whatsapp_triagem_config SET estado = 'ligada'; EXCEPTION WHEN raise_exception THEN v_ok := true; END;
  IF NOT v_ok OR (SELECT estado FROM public.whatsapp_triagem_config) <> 'ensaio' THEN RAISE EXCEPTION 'FALHOU 38e: o gatilho deixou pular degrau'; END IF;
  -- o admin (whatsapp.manage) muda um freio, e o freio volta ao que era
  PERFORM public.triagem_config_salvar(v_user, '{"intervalo_minimo_s":25}');
  IF (SELECT intervalo_minimo_s FROM public.whatsapp_triagem_config) <> 25 THEN RAISE EXCEPTION 'FALHOU 38f: o admin não mudou o freio'; END IF;
  PERFORM public.triagem_config_salvar(v_user, '{"intervalo_minimo_s":20}');
  IF v_gestor IS NOT NULL THEN
    PERFORM public.triagem_config_salvar(v_gestor, '{"avisar_grupo":true,"espera_resposta_min":45}');
    PERFORM public.triagem_config_salvar(v_gestor, jsonb_build_object('max_novas_por_hora', (SELECT max_novas_por_hora FROM public.whatsapp_triagem_config)));  -- o valor que já está não é mudança
    FOREACH v_x IN ARRAY ARRAY['{"estado":"teste"}', '{"percentual":50}', '{"numeros_teste":["96999990099"]}',
                               '{"max_novas_por_dia":999}', '{"max_novas_por_hora":99}', '{"freio_falhas_envio":20}', '{"freio_erros_hora":200}',
                               '{"max_mensagens":12}', '{"max_tentativas_por_passo":3}', '{"intervalo_minimo_s":5}'] LOOP
      v_ok := false;
      BEGIN PERFORM public.triagem_config_salvar(v_gestor, v_x::jsonb); EXCEPTION WHEN insufficient_privilege OR raise_exception THEN v_ok := true; END;
      IF NOT v_ok THEN RAISE EXCEPTION 'FALHOU 38d: gestor mudou %', v_x; END IF;
    END LOOP;
    v_r := array_append(v_r, (format('38) política: desligada não pula degrau (%s tentativas recusadas), sobe um por vez, desce livre, e o UPDATE direto também não pula degrau; o gestor edita textos e tempos, mas não muda estado, percentual, números de teste nem os 7 freios (freio_*, max_* e intervalo_minimo_s), que exigem whatsapp.manage; o admin muda freio', v_n))::text);
  ELSE
    v_r := array_append(v_r, (format('38) política: desligada não pula degrau (%s tentativas recusadas), sobe um por vez, desce livre, e o UPDATE direto também não pula degrau; o admin muda freio; sem usuário gestor neste banco, a parte de whatsapp.manage ficou sem prova', v_n))::text);
  END IF;
  UPDATE public.whatsapp_triagem_config SET estado = 'teste', percentual = 0, desligada_em = now() - interval '1 hour';

  -- 39) HORÁRIO em texto com dias de horários diferentes: o sábado ao meio-dia não herda o 18h da semana
  UPDATE public.whatsapp_horarios_atendimento SET abre = '08:00', fecha = '18:00', ativo = (dia_semana BETWEEN 1 AND 5);
  UPDATE public.whatsapp_horarios_atendimento SET ativo = true, fecha = '12:00' WHERE dia_semana = 6;
  v_j := public.whatsapp_horario_em_texto();
  IF v_j ->> 'dias' <> 'de segunda a sexta, e aos sábados das 8h às 12h' OR v_j ->> 'abre' <> '8h' OR v_j ->> 'fecha' <> '18h' THEN
    RAISE EXCEPTION 'FALHOU 39: horário em texto %', v_j; END IF;
  v_r := array_append(v_r, (format('39) horário em texto com sábado até o meio-dia: %s', v_j))::text);

  -- 40) NOME no banco igual ao do TypeScript: nomes longos com de e dos valem, endereço de internet não
  IF NOT public._triagem_nome_valido('Maria de Lourdes Santos Lima') OR NOT public._triagem_nome_valido('Maria Aparecida dos Santos Silva')
     OR public._triagem_nome_valido('www.exemplo.com') OR public._triagem_nome_valido('oi.com') OR public._triagem_nome_valido('bit.ly')
     OR public._triagem_nome_valido('meusite.com.br') OR public._triagem_nome_valido('Pix') OR public._triagem_nome_valido('Juros') THEN
    RAISE EXCEPTION 'FALHOU 40: validação de nome'; END IF;
  v_r := array_append(v_r, ('40) nome no banco: "Maria de Lourdes Santos Lima" e "Maria Aparecida dos Santos Silva" valem; www.exemplo.com, oi.com, bit.ly, meusite.com.br, Pix e Juros não')::text);

  -- 41) DESCER A ESCADA VALE PARA A TRIAGEM EM CURSO. Antes, descer de ligada para parcial ou teste só valia para conversa nova: a
  -- triagem já aberta de quem não é número de teste (ou ficou fora do sorteio) continuava enviando. Agora triagem_enviar,
  -- triagem_aplicar e triagem_ler_ou_abrir conferem o degrau ATUAL para a conversa e param a que não passar (pausada_desligada).
  UPDATE public.whatsapp_triagem_config SET estado = 'parcial', percentual = 100, numeros_teste = ARRAY['96999990044'];
  UPDATE public.whatsapp_triagem_config SET estado = 'ligada';
  v_cs := '{}';
  FOR v_n IN 1..5 LOOP    -- 1: enviar direto, 2: aplicar, 3: ler_ou_abrir, 4: número de teste, 5: fora do sorteio
    INSERT INTO public.whatsapp_conversas (instancia_id, telefone)
    VALUES (v_inst, '5596999990' || lpad((40 + v_n)::text, 3, '0')) RETURNING id INTO v_ca;
    v_cs := array_append(v_cs, v_ca);
    INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, zapi_message_id, direcao, tipo, status, texto, origem, recebido_em)
    VALUES (v_ca, v_inst, 'ENSAIO-41-' || v_n, 'entrada', 'texto', 'recebida', 'Oi', 'humano', now()) RETURNING id INTO v_m;
    v_s := public.triagem_ler_ou_abrir(v_ca, v_m);
    IF v_s ->> 'dono' <> 'triagem' THEN RAISE EXCEPTION 'FALHOU 41: na ligada a conversa % não abriu: %', v_n, v_s; END IF;
    SELECT * INTO v_t FROM public.whatsapp_triagens WHERE conversa_id = v_ca;
    v_a := public.triagem_aplicar(v_t.id, v_t.versao, jsonb_build_object('mensagem_id', v_m, 'estado', jsonb_build_object('passo', 'nome', 'mensagens_enviadas', 1),
      'envio', jsonb_build_object('texto', 'Olá! Qual é o seu nome?', 'chave', 'triagem:' || v_t.id || ':nome:1', 'atraso_s', 3, 'passo', 'nome', 'ordem', 1)));
    IF NOT coalesce((v_a ->> 'enviado')::boolean, false) THEN RAISE EXCEPTION 'FALHOU 41a: na ligada a conversa % não enviou: %', v_n, v_a; END IF;
  END LOOP;
  -- desce de ligada para PARCIAL com percentual 0: só número de teste passa (o sorteio de qualquer conversa fica >= 0)
  UPDATE public.whatsapp_triagem_config SET estado = 'parcial', percentual = 0;
  SELECT * INTO v_t FROM public.whatsapp_triagens WHERE conversa_id = v_cs[5];
  v_a := public.triagem_enviar(v_t.id, 'Mais uma pergunta?', 'triagem:' || v_t.id || ':nome:2', 3, 'nome', 2, ARRAY['nome']);
  SELECT * INTO v_t FROM public.whatsapp_triagens WHERE id = v_t.id;
  IF coalesce((v_a ->> 'enviado')::boolean, false) OR v_a ->> 'motivo' <> 'fora_do_degrau' OR v_t.status <> 'pausada_desligada' OR v_t.motivo_fim <> 'fora_do_degrau'
     OR EXISTS (SELECT 1 FROM public.whatsapp_fila_envio WHERE conversa_id = v_cs[5] AND status = 'pendente') THEN
    RAISE EXCEPTION 'FALHOU 41b: parcial com percentual 0 e a conversa fora do sorteio continuou enviando: % (status %)', v_a, v_t.status; END IF;
  SELECT * INTO v_t FROM public.whatsapp_triagens WHERE conversa_id = v_cs[4];
  v_a := public.triagem_enviar(v_t.id, 'Mais uma pergunta?', 'triagem:' || v_t.id || ':nome:2', 3, 'nome', 2, ARRAY['nome']);
  IF NOT coalesce((v_a ->> 'enviado')::boolean, false) THEN RAISE EXCEPTION 'FALHOU 41c: o número de teste foi parado no parcial: %', v_a; END IF;
  -- desce de parcial para TESTE: as três portas param a conversa que não é número de teste
  UPDATE public.whatsapp_triagem_config SET estado = 'teste';
  --   1) a reprodução da revisão: envio direto depois de descer
  SELECT * INTO v_t FROM public.whatsapp_triagens WHERE conversa_id = v_cs[1];
  v_a := public.triagem_enviar(v_t.id, 'Mais uma pergunta?', 'triagem:' || v_t.id || ':nome:2', 3, 'nome', 2, ARRAY['nome']);
  SELECT * INTO v_t FROM public.whatsapp_triagens WHERE id = v_t.id;
  IF coalesce((v_a ->> 'enviado')::boolean, false) OR v_a ->> 'motivo' <> 'fora_do_degrau' OR v_t.status <> 'pausada_desligada'
     OR EXISTS (SELECT 1 FROM public.whatsapp_fila_envio WHERE conversa_id = v_cs[1] AND status = 'pendente')
     OR EXISTS (SELECT 1 FROM public.whatsapp_mensagens WHERE conversa_id = v_cs[1] AND texto = 'Mais uma pergunta?') THEN
    RAISE EXCEPTION 'FALHOU 41d: triagem_enviar enfileirou depois de descer para teste: % (status %)', v_a, v_t.status; END IF;
  --   2) aplicar
  SELECT * INTO v_t FROM public.whatsapp_triagens WHERE conversa_id = v_cs[2];
  v_a := public.triagem_aplicar(v_t.id, v_t.versao, jsonb_build_object('estado', jsonb_build_object('passo', 'primeira_vez'),
    'envio', jsonb_build_object('texto', 'Mais uma pergunta?', 'chave', 'triagem:' || v_t.id || ':nome:2', 'atraso_s', 3, 'passo', 'nome', 'ordem', 2)));
  SELECT * INTO v_t FROM public.whatsapp_triagens WHERE id = v_t.id;
  IF v_a ->> 'pausada' <> 'pausada_desligada' OR v_a ->> 'motivo' <> 'fora_do_degrau' OR v_t.status <> 'pausada_desligada'
     OR EXISTS (SELECT 1 FROM public.whatsapp_fila_envio WHERE conversa_id = v_cs[2] AND status = 'pendente')
     OR EXISTS (SELECT 1 FROM public.whatsapp_mensagens WHERE conversa_id = v_cs[2] AND texto = 'Mais uma pergunta?') THEN
    RAISE EXCEPTION 'FALHOU 41e: triagem_aplicar enviou depois de descer para teste: % (status %)', v_a, v_t.status; END IF;
  --   3) ler_ou_abrir, com uma mensagem nova da pessoa
  INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, zapi_message_id, direcao, tipo, status, texto, origem, recebido_em)
  VALUES (v_cs[3], v_inst, 'ENSAIO-41-NOVA', 'entrada', 'texto', 'recebida', 'Carla', 'humano', now()) RETURNING id INTO v_m;
  v_s := public.triagem_ler_ou_abrir(v_cs[3], v_m);
  SELECT * INTO v_t FROM public.whatsapp_triagens WHERE conversa_id = v_cs[3];
  IF v_s ->> 'dono' <> 'ninguem' OR v_s ->> 'motivo' <> 'fora_do_degrau' OR v_t.status <> 'pausada_desligada'
     OR public.triagem_dono_da_conversa(v_cs[3]) <> 'ninguem' THEN
    RAISE EXCEPTION 'FALHOU 41f: ler_ou_abrir não parou a conversa fora do teste: % (status %)', v_s, v_t.status; END IF;
  --   4) o número de teste continua enviando no degrau de teste
  SELECT * INTO v_t FROM public.whatsapp_triagens WHERE conversa_id = v_cs[4];
  v_a := public.triagem_enviar(v_t.id, 'Qual o seu CEP?', 'triagem:' || v_t.id || ':cep:3', 3, 'cep', 3, ARRAY['cep']);
  IF NOT coalesce((v_a ->> 'enviado')::boolean, false) THEN RAISE EXCEPTION 'FALHOU 41g: o número de teste foi parado no teste: %', v_a; END IF;
  v_r := array_append(v_r, ('41) descer a escada vale para a triagem em curso: de ligada para parcial com percentual 0 a conversa fora do sorteio parou (fora_do_degrau) e o número de teste seguiu; de parcial para teste triagem_enviar, triagem_aplicar e triagem_ler_ou_abrir pararam a conversa que não é de teste (pausada_desligada, nada novo na fila nem nas mensagens) e o número de teste seguiu enviando')::text);

  -- 42) RECOMPOSIÇÃO EM LOTE: a fila pendente que sobra de triagem já parada (triagem_varrer, passo 4) e a que o botão vermelho
  -- cancela em lote (triagem_desligar) apagam a mensagem pendente E a caixa volta a mostrar como última mensagem a que existe
  -- de verdade. A triagem é marcada parada à mão, sem passar por _triagem_pausar, para sobrar fila pendente de propósito.
  UPDATE public.whatsapp_triagem_config SET desligada_em = clock_timestamp(),
    numeros_teste = numeros_teste || ARRAY['96999990051', '96999990052'];
  FOR v_n IN 1..2 LOOP    -- 1: triagem_varrer, 2: triagem_desligar
    INSERT INTO public.whatsapp_conversas (instancia_id, telefone) VALUES (v_inst, '5596999990' || lpad((50 + v_n)::text, 3, '0')) RETURNING id INTO v_ca;
    INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, zapi_message_id, direcao, tipo, status, texto, origem, recebido_em)
    VALUES (v_ca, v_inst, 'ENSAIO-42-' || v_n, 'entrada', 'texto', 'recebida', 'Oi', 'humano', now()) RETURNING id INTO v_m;
    v_s := public.triagem_ler_ou_abrir(v_ca, v_m);
    SELECT * INTO v_t FROM public.whatsapp_triagens WHERE conversa_id = v_ca;
    v_a := public.triagem_aplicar(v_t.id, v_t.versao, jsonb_build_object('mensagem_id', v_m, 'estado', jsonb_build_object('passo', 'nome'),
      'envio', jsonb_build_object('texto', 'Qual é o seu nome completo?', 'chave', 'triagem:' || v_t.id || ':nome:1', 'passo', 'nome', 'ordem', 1)));
    IF (SELECT ultima_mensagem FROM public.whatsapp_conversas WHERE id = v_ca) <> 'Qual é o seu nome completo?'
       OR NOT EXISTS (SELECT 1 FROM public.whatsapp_fila_envio WHERE conversa_id = v_ca AND status = 'pendente') THEN
      RAISE EXCEPTION 'FALHOU 42: a partida da prova (pergunta pendente como última mensagem) não está de pé'; END IF;
    UPDATE public.whatsapp_triagens SET status = 'pausada_humano', concluida_em = now(), motivo_fim = 'humano_na_conversa' WHERE id = v_t.id;
    IF v_n = 1 THEN
      v_j := public.triagem_varrer();
      IF v_j ->> 'freio' IS NOT NULL THEN RAISE EXCEPTION 'FALHOU 42: o freio disparou na varredura: %', v_j; END IF;
    ELSE
      v_j := public.triagem_desligar('ensaio: lote', v_user);
    END IF;
    IF EXISTS (SELECT 1 FROM public.whatsapp_fila_envio WHERE conversa_id = v_ca AND status = 'pendente')
       OR EXISTS (SELECT 1 FROM public.whatsapp_mensagens WHERE conversa_id = v_ca AND direcao = 'saida')
       OR (SELECT status FROM public.whatsapp_fila_envio WHERE conversa_id = v_ca) <> 'cancelada' THEN
      RAISE EXCEPTION 'FALHOU 42a: o lote % não cancelou e apagou a pergunta pendente', v_n; END IF;
    IF (SELECT ultima_mensagem FROM public.whatsapp_conversas WHERE id = v_ca) <> 'Oi' THEN
      RAISE EXCEPTION 'FALHOU 42b: depois do lote % a caixa ainda mostra "%" como última mensagem', v_n, (SELECT ultima_mensagem FROM public.whatsapp_conversas WHERE id = v_ca); END IF;
  END LOOP;
  v_r := array_append(v_r, ('42) lote: a fila pendente que sobrou de triagem já parada (varrer, passo 4) e a cancelada pelo botão vermelho (desligar) foram canceladas, a mensagem pendente foi apagada e a última mensagem da conversa voltou para a que existe de verdade')::text);
  -- o desligar acima desligou a configuração: volta ao teste, um degrau por vez
  UPDATE public.whatsapp_triagem_config SET estado = 'ensaio';
  UPDATE public.whatsapp_triagem_config SET estado = 'teste', percentual = 0, desligada_em = now() - interval '1 hour';

  -- 43) triagem_dono_da_conversa SEM linha de triagem: grupo, bloqueado e robô de empresa dão ninguem pela própria função (antes só
  -- triagem_ler_ou_abrir dizia isso e a função devolvia assistente, e quem consulta a função cairia no laço com o robô da empresa)
  INSERT INTO public.whatsapp_conversas (instancia_id, telefone) VALUES (v_inst, '5596999990060-group') RETURNING id INTO v_ca;
  INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, zapi_message_id, direcao, tipo, status, texto, origem, recebido_em)
  VALUES (v_ca, v_inst, 'ENSAIO-43-A', 'entrada', 'texto', 'recebida', 'oi pessoal', 'humano', now()) RETURNING id INTO v_m;
  v_s := public.triagem_ler_ou_abrir(v_ca, v_m, '{"eh_grupo": true}');
  IF v_s ->> 'motivo' <> 'grupo' OR EXISTS (SELECT 1 FROM public.whatsapp_triagens WHERE conversa_id = v_ca)
     OR public.triagem_dono_da_conversa(v_ca) <> 'ninguem' THEN
    RAISE EXCEPTION 'FALHOU 43: grupo sem linha de triagem: ler_ou_abrir %, função %', v_s, public.triagem_dono_da_conversa(v_ca); END IF;
  IF EXISTS (SELECT 1 FROM public.whatsapp_triagens WHERE conversa_id = v_c7) OR NOT public._triagem_bloqueado(v_c7)
     OR public.triagem_dono_da_conversa(v_c7) <> 'ninguem' THEN
    RAISE EXCEPTION 'FALHOU 43b: bloqueado sem linha de triagem: função %', public.triagem_dono_da_conversa(v_c7); END IF;
  INSERT INTO public.whatsapp_conversas (instancia_id, telefone) VALUES (v_inst, '5596999990061') RETURNING id INTO v_cb;
  INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, zapi_message_id, direcao, tipo, status, texto, origem, recebido_em)
  VALUES (v_cb, v_inst, 'ENSAIO-43-ROBO', 'entrada', 'texto', 'recebida', 'Digite 1 para falar com o atendente', 'humano', now()) RETURNING id INTO v_m;
  v_s := public.triagem_ler_ou_abrir(v_cb, v_m);
  IF v_s ->> 'motivo' <> 'robo' OR EXISTS (SELECT 1 FROM public.whatsapp_triagens WHERE conversa_id = v_cb)
     OR public.triagem_dono_da_conversa(v_cb) <> 'ninguem' THEN
    RAISE EXCEPTION 'FALHOU 43c: robô de empresa sem linha de triagem: ler_ou_abrir %, função %', v_s, public.triagem_dono_da_conversa(v_cb); END IF;
  IF EXISTS (SELECT 1 FROM public.whatsapp_triagens WHERE conversa_id = v_c3) OR public.triagem_dono_da_conversa(v_c3) <> 'assistente' THEN
    RAISE EXCEPTION 'FALHOU 43d: conversa comum sem linha de triagem: função %', public.triagem_dono_da_conversa(v_c3); END IF;
  IF public.triagem_dono_da_conversa(gen_random_uuid()) <> 'ninguem' THEN RAISE EXCEPTION 'FALHOU 43e: conversa inexistente'; END IF;
  v_r := array_append(v_r, ('43) dono da conversa sem linha de triagem: a função diz ninguem para grupo, bloqueado, robô de empresa e conversa inexistente, e assistente para a conversa comum')::text);

  RAISE EXCEPTION E'ENSAIO OK (tudo desfeito de propósito):\n%', array_to_string(v_r, E'\n');
END
$ensaio$;
```

Esperado, na mensagem do erro (48 linhas, 44 provas numeradas de 0 a 43; 10b, 18b, 20b e 35b são as de letra). Na prova 27 o texto muda conforme o banco tenha ou não grupo da equipe, e na 38 conforme exista ou não um usuário gestor:

```
ERRO: ENSAIO OK (tudo desfeito de propósito):
0) config em teste, vale_a_partir_de preenchido
1) triagem aberta: status ativa, modo real, versão 1, ramo cliente
2) mensagem da triagem gravada com origem automacao e marca triagem: 1; linhas na fila com a chave da triagem: 1
3) aguardando_desde continua contando depois da mensagem automacao (a equipe ainda vê o contato esperando)
4) a segunda entrada igual não duplica: ler_ou_abrir diz entrada_repetida, aplicar diz duplicada, saídas continuam 1
5) mesma chave de idempotência da fila não gera segunda mensagem
6) nome "quero banners" não foi gravado (eventos nome_nao_gravado: 1)
7) gravação em cima de leitura velha devolve conflito
8) nome bom gravado (Maria Souza); telefone alternativo guardado SEM verificação (verificado = f); mensagens enviadas 2
9) humano respondeu: triagem pausada_humano; fila pendente antes 1, depois 0; mensagem pendente da triagem ainda existe: 0
10) depois da pausa: aplicar recusa (triagem_encerrada) e o dono da conversa é "ninguem"
10b) mensagem do celular da empresa (origem celular) com o gatilho de conversa desligado: triagem pausada_humano, motivo saida_humana
11) desligar: estado desligada, triagem pausada_desligada, pendentes na fila 0, canceladas na fila 1; dono da conversa agora "ninguem"
12) com a triagem desligada, a conversa nova não gera linha em whatsapp_triagens (dono = assistente, como hoje)
13) saída automacao de aviso de pedido NÃO pausa: triagem continua ativa; as saídas automáticas de fora contam no teto: 1
14) conversa com saída anterior e entrada "sim": zero triagens e zero eventos (motivo ja_atendida)
15) parar: bloqueio guardado só em hash (telefone e lid), nada em claro
16) a mesma pessoa em outra conversa, só com o lid: motivo bloqueado, dono ninguem
17) celular de gente da equipe fora da lista de teste: motivo equipe
18) grupo: motivo grupo, dono ninguem
18b) cliente cadastrado com o número só em telefone_2: motivo cliente_conhecido, nenhuma triagem
19) sinais estruturais de robô (menu, link) reconhecidos
20) texto com parceiro e R$ no ramo cliente: barrado (regras ["moeda", "parceiro"]), nada na fila, só esta triagem parou (entregue_equipe) e a configuração continua teste
20b) respostas "Pix" ao pedido de nome: cada uma barra o texto e entrega só a sua conversa; o terceiro barrado em 30 minutos dispara o freio (estado desligada)
21) modo ensaio: status ensaio, zero linhas em fila e em mensagens de saída, evento envio_ensaio sem o texto
22) evento com chave "texto" é recusado pelo CHECK
23) varredura: triagem em silêncio expirada; resultado {"freio": null, "expiradas": 1, "canceladas": 0, "avisos_sem_grupo": 0, "eventos_apagados": 0, "avisos_enfileirados": 0, "erros_na_ultima_hora": 0, "falhas_de_envio_30min": 0, "textos_barrados_30min": 0}
24) anon e authenticated levam "permission denied" nas funções novas
25) rajada: 2 pendentes juntadas, 3 eventos de entrada, as mensagens juntadas voltam como entrada_repetida
26) corrida de dois webhooks: a mensagem mais antiga que a já aplicada volta como entrada_repetida no ler e como entrada_mais_antiga no aplicar, nada na fila
27) aviso ao grupo: 1 linha em notificacoes_fila com a chave da triagem, só o primeiro nome, marcas de fora descartadas, 2ª rodada enfileira 0; evento aviso_grupo uma vez só
28) conversa fechada pela equipe e reaberta pela mensagem nova (responsável e modo já zerados): motivo ja_atendida, nenhuma triagem
29) portão reconferido no meio do fluxo: cliente vinculado e bloqueio manual novo param a triagem em curso (status pulada, dono ninguem)
30) dono: robô de empresa fica sem dono, pulada fica sem dono, pausada por gente e devolvida à IA volta para a assistente
31) desligar: sem usuário é recusado; a mensagem cuja fila já estava enviada continua no histórico (1), a que não saiu foi cancelada e apagada e a triagem ficou pausada_desligada
32) expiração: resposta já recebida e não aplicada segura a triagem; depois de aplicada expira (aviso decidido com os dados do TypeScript); a retomada limpa motivo_fim e abre a rodada 2 do aviso, para o resumo de como terminou
33) freio: 3 barrados de antes de desligada_em não desligam (freio nulo); 3 de depois desligam (freio_textos_barrados); a triagem aberta ficou pausada_desligada
34) CHECK de eventos: 6 formas com conteúdo (aninhado, dentro de lista, variaveis com valor, codigos com espaço) recusadas; nomes de variáveis e códigos aceitos
35) parar sem telefone nem lid: sem exceção, triagem parada, evento bloqueio_sem_chave e nenhum bloqueio gravado
35b) parar em ENSAIO: a pessoa nunca recebeu mensagem do robô, então nenhum bloqueio real é gravado
36) ensaio: grava ultimo_envio_em e ultima_pergunta_em, o dono é "assistente" (a assistente continua respondendo) e o instantâneo diz ensaio; o texto com Pix é barrado também no ensaio (regras ["pix"])
37) teto de 1: a pergunta pendente foi substituída (saídas 1); com a anterior já enviada, a próxima para em teto_de_mensagens
38) política: desligada não pula degrau (3 tentativas recusadas), sobe um por vez, desce livre, e o UPDATE direto também não pula degrau; o gestor edita textos e tempos, mas não muda estado, percentual, números de teste nem os 7 freios (freio_*, max_* e intervalo_minimo_s), que exigem whatsapp.manage; o admin muda freio
39) horário em texto com sábado até o meio-dia: {"abre": "8h", "dias": "de segunda a sexta, e aos sábados das 8h às 12h", "fecha": "18h"}
40) nome no banco: "Maria de Lourdes Santos Lima" e "Maria Aparecida dos Santos Silva" valem; www.exemplo.com, oi.com, bit.ly, meusite.com.br, Pix e Juros não
41) descer a escada vale para a triagem em curso: de ligada para parcial com percentual 0 a conversa fora do sorteio parou (fora_do_degrau) e o número de teste seguiu; de parcial para teste triagem_enviar, triagem_aplicar e triagem_ler_ou_abrir pararam a conversa que não é de teste (pausada_desligada, nada novo na fila nem nas mensagens) e o número de teste seguiu enviando
42) lote: a fila pendente que sobrou de triagem já parada (varrer, passo 4) e a cancelada pelo botão vermelho (desligar) foram canceladas, a mensagem pendente foi apagada e a última mensagem da conversa voltou para a que existe de verdade
43) dono da conversa sem linha de triagem: a função diz ninguem para grupo, bloqueado, robô de empresa e conversa inexistente, e assistente para a conversa comum
```

O que cada prova garante:

- 1 a 3: a triagem abre, a mensagem sai pela fila existente com origem `automacao` e a marca `payload.triagem`, e `aguardando_desde` continua contando (a equipe ainda enxerga o contato esperando). A conversa não vai para modo humano.
- 4 e 5: a segunda entrada igual não duplica (o índice único do evento `entrada`), e a mesma chave de idempotência da fila não gera segunda mensagem.
- 6 a 8: nome de pedido de produto não é gravado; nome bom é; gravação em cima de leitura velha dá conflito; o telefone alternativo é guardado SEM verificação.
- 9, 10 e 10b: gente da equipe responde pelo painel (motivo `conversa_assumida`), a triagem pausa, a pergunta pendente é cancelada e apagada (e a "última mensagem" da conversa volta para a que existe), e a triagem nunca retoma sozinha. A 10b prova o ramo `saida_humana` do gatilho de mensagem, pelo caminho do celular da empresa, com o gatilho de conversa desligado só ali.
- 11 e 12: desligar cancela os pendentes; com a triagem desligada a conversa nova não gera linha.
- 13 e 14: aviso de pedido (`automacao` sem marca) não pausa a triagem e conta no teto; saída anterior impede abrir, e "sim" sem triagem não gera evento.
- 15 e 16: "parar" fica só em hash e vale para a mesma pessoa em outra conversa que tenha só o `chat_lid`.
- 17, 18 e 18b: celular de gente da equipe (a prova agora exige o motivo `equipe`, nunca outro), grupo e cliente cadastrado só com `telefone_2` ficam de fora.
- 20 e 20b: texto com `parceiro` e `R$` no ramo cliente é barrado e só aquela conversa vai para a equipe; "Pix" como resposta ao pedido de nome barra o texto montado e também só entrega aquela conversa; o freio global só dispara no terceiro texto barrado em 30 minutos.
- 21 e 22: em modo `ensaio` nada vai para mensagem nem fila, o evento `envio_ensaio` não leva o texto, e o CHECK recusa chave de conteúdo.
- 23: a varredura expira a triagem em silêncio e devolve o resultado.
- 24: `anon` e `authenticated` levam "permission denied".
- 25 e 26: rajada (três mensagens juntadas viram três eventos de entrada e nenhuma volta) e corrida de dois webhooks (a mensagem mais antiga que a já aplicada não é interpretada, nem no ler nem no aplicar).
- 27: aviso ao grupo enfileirado pelo varrer em `notificacoes_fila` com chave própria, só o primeiro nome, sem duplicar na segunda rodada; sem grupo da equipe o aviso espera sem ser marcado; o evento `aviso_grupo` não duplica quando o servidor também o manda.
- 28 e 29: conversa que a equipe fechou e a mensagem nova reabriu não abre triagem; cliente vinculado e bloqueio manual no meio do fluxo param a triagem em curso.
- 30: dono da conversa: robô de empresa e pulada sem dono, pausada por gente e devolvida à IA volta para a assistente.
- 31: desligar sem usuário é recusado; mensagem cuja fila já estava enviada nunca é apagada do histórico, a que não saiu é cancelada e apagada.
- 32 e 33: expiração não leva resposta recebida e não aplicada, a retomada limpa `motivo_fim` e abre nova rodada de aviso; o freio só conta o que aconteceu depois de `desligada_em`.
- 34, 35 e 35b: CHECK de eventos recursivo e `variaveis` e `codigos` só com nomes; `parar` sem telefone nem lid não dá exceção; `parar` em ensaio não grava bloqueio real.
- 36 e 37: o ensaio grava o relógio do envio, não é dono e também barra texto com termo proibido; o teto não conta a pergunta pendente que vai ser substituída.
- 38: a escada (um degrau por vez para cima, qualquer um para baixo, também no `UPDATE` direto, que o gatilho da configuração agora confere) e `whatsapp.manage` para estado, percentual, números de teste e os sete freios (`freio_falhas_envio`, `freio_erros_hora`, `max_mensagens`, `max_tentativas_por_passo`, `max_novas_por_hora`, `max_novas_por_dia`, `intervalo_minimo_s`). Mandar o valor que já está gravado não conta como mudança. O admin muda freio.
- 39 e 40: horário em texto com dias de horários diferentes; nome no banco igual ao do TypeScript.
- 41: DESCER A ESCADA VALE PARA A TRIAGEM EM CURSO. Cinco conversas abertas com a triagem `ligada`. Ao descer para `parcial` com percentual 0, a conversa fora do sorteio para na hora (`pausada_desligada`, motivo `fora_do_degrau`) e o número de teste segue. Ao descer para `teste`, as TRÊS portas (`triagem_enviar` direto, `triagem_aplicar` e `triagem_ler_ou_abrir`) param a conversa que não é número de teste, sem fila nova nem mensagem nova, e o número de teste segue enviando. Antes desta revisão, só a conversa nova respeitava o degrau.
- 42: a fila pendente que sobra de triagem já parada (`triagem_varrer`, passo 4) e a cancelada em lote pelo botão vermelho (`triagem_desligar`) são canceladas, a mensagem pendente é apagada e a última mensagem da conversa volta para a que existe de verdade.
- 43: `triagem_dono_da_conversa` sem linha de triagem: ninguém para grupo, bloqueado, robô de empresa (reconhecido pela primeira mensagem de pessoa) e conversa inexistente; assistente para a conversa comum. Antes, só `triagem_ler_ou_abrir` dizia ninguém.

Não provado aqui, porque uma sessão só não consegue: concorrência de verdade. Foi rodada à parte no Postgres local, com duas sessões: dois `triagem_aplicar` ao mesmo tempo na mesma triagem (o segundo espera o primeiro e devolve `conflito`), `triagem_desligar` ao mesmo tempo que uma mensagem da equipe (sem deadlock, nos dois sentidos de chegada) e o gatilho de pausa com a triagem travada por outra sessão (seção 4.1).

### 4.1 Prova em duas sessões: a mensagem da equipe é gravada mesmo com a triagem travada (só no banco local)

O gatilho de pausa por humano roda dentro do `INSERT` da mensagem de saída da equipe, e o PostgREST impõe `statement_timeout` a quem chama. Antes desta revisão ele fazia `FOR UPDATE` e, com a linha da triagem travada por outra sessão, o `INSERT` inteiro falhava por tempo e a mensagem não era gravada (`WHEN OTHERS` não pega `QUERY_CANCELED`). Agora o gatilho usa `FOR UPDATE SKIP LOCKED`, tem `lock_timeout` de 1 segundo só durante a função e captura `QUERY_CANCELED` pelo nome. Não dá para provar isso num bloco só (precisa de uma segunda sessão segurando a trava), por isso a prova é este roteiro, rodado no Postgres local com os três cenários, e NÃO deve ser rodado no banco vivo. Sessão A segura a trava e dorme; sessão B insere a mensagem de saída com `statement_timeout` curto.

```sql
-- sessão A (cenário 1: segura a linha da triagem)
BEGIN; SELECT 1 FROM public.whatsapp_triagens WHERE conversa_id = '<conversa>' FOR UPDATE; SELECT pg_sleep(4); COMMIT;
-- sessão B (ao mesmo tempo)
SET statement_timeout = '1s';
INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, direcao, tipo, status, texto, origem, enviada_por)
VALUES ('<conversa>', '<instancia>', 'saida', 'texto', 'enviada', 'Oi, aqui é a equipe.', 'celular', NULL);
-- cenário 2: A segura a FILA da triagem (SELECT ... FROM public.whatsapp_fila_envio WHERE conversa_id = ... FOR UPDATE), B com statement_timeout de 3 s
-- cenário 3: a mesma fila travada, B com statement_timeout de 300 ms (o tempo estoura antes do lock_timeout da função)
```

Resultado literal no Postgres local (três conversas com triagem aberta, nenhuma pausa tinha como acontecer porque a trava estava com a outra sessão):

```
--- Cenário 1: outra sessão segura a linha da triagem (FOR UPDATE), statement_timeout de 1 s
mensagem gravada: 1, triagem: ativa
--- Cenário 2: outra sessão segura a FILA da triagem; o gatilho pega a triagem e espera a fila; statement_timeout de 3 s
WARNING:  triagem_pausar_por_humano falhou (conversa ...): canceling statement due to lock timeout [55P03]
mensagem gravada: 1, triagem: ativa
--- Cenário 3: mesma fila travada, statement_timeout de 300 ms (o tempo estoura antes do lock_timeout da função)
WARNING:  triagem_pausar_por_humano cancelada por tempo (conversa ...), a mensagem segue: canceling statement due to statement timeout
mensagem gravada: 1, triagem: ativa
```

A mesma prova com o gatilho ANTIGO (sem `SKIP LOCKED`, sem `lock_timeout`, sem captura de `QUERY_CANCELED`), para mostrar que ela morde: no cenário 1 saiu `ERROR: canceling statement due to statement timeout ... while locking tuple in relation "whatsapp_triagens"` e `mensagem gravada: 0`. A triagem que não foi pausada na hora não manda mais nada: `triagem_ler_ou_abrir`, `triagem_aplicar` e `triagem_enviar` conferem gente na conversa antes de interpretar e de enviar e pausam na mensagem seguinte.

## 5. DEPOIS do ensaio: nada ficou

```sql
-- Esperado: 0, 0, 0, 0, desligada.
SELECT (SELECT count(*) FROM public.whatsapp_triagens) AS triagens,
       (SELECT count(*) FROM public.whatsapp_triagem_eventos) AS eventos,
       (SELECT count(*) FROM public.whatsapp_automacao_bloqueios) AS bloqueios,
       (SELECT count(*) FROM public.whatsapp_conversas WHERE telefone_normalizado LIKE '969999900%') AS conversas_de_teste,
       (SELECT estado FROM public.whatsapp_triagem_config) AS estado;
```

## 6. Ligar não faz parte deste PR

Estas migrações só preparam o chão. O PR B5 liga o webhook e o despachante. Antes de qualquer conversa real: estado `ensaio` por 3 dias úteis ou 30 conversas, leitura de 20 casos pelo dono, e só depois `teste` com o número dele. O botão de desligar chama `triagem_desligar` (exige usuário e `whatsapp.manage` ou `configuracoes.manage`); o freio automático chama a interna `_triagem_desligar_interno` pelo `triagem_varrer` (3 falhas de envio em 30 minutos, 10 erros por hora, 3 textos barrados em 30 minutos, sempre contados só depois do último desligar). Um texto barrado sozinho só entrega aquela conversa à equipe. Ligar é `triagem_config_salvar`: exige `whatsapp.manage` para mudar estado, percentual, números de teste e os sete freios (`freio_*`, `max_*` e `intervalo_minimo_s`), e o estado sobe um degrau por vez (desligada, ensaio, teste, parcial, ligada); o gatilho da configuração confere o mesmo salto também num `UPDATE` direto.

**O que realmente acontece ao descer a escada.** Descer é sempre permitido, mas não é só trocar um número: a cada mensagem de cada triagem já em curso, `triagem_ler_ou_abrir`, `triagem_aplicar` e `triagem_enviar` conferem o degrau ATUAL para aquela conversa. Em `teste`, só número de teste continua. Em `parcial`, continua quem é número de teste ou cai no sorteio dentro do percentual atual. Em `ensaio`, triagem de modo real não envia mais nada. A conversa que não passar vira `pausada_desligada` (motivo `fora_do_degrau`) e nada é enviado; a pergunta pendente é cancelada. Para parar tudo de uma vez, incluindo as conversas abertas e a fila, o caminho continua sendo `triagem_desligar`.

## 7. Voltar atrás, se for preciso

Como nada usa as funções, voltar é apagar. Só rode se a triagem estiver desligada e sem linhas que alguém queira guardar. Tabelas e gatilhos primeiro, funções depois, tipos por último (esta ordem foi rodada no Postgres local e as três migrações foram reaplicadas em seguida sem erro):

```sql
BEGIN;
-- B4: gatilhos e tabelas de estado
DROP TRIGGER IF EXISTS tg_triagem_pausa_por_mensagem ON public.whatsapp_mensagens;
DROP TRIGGER IF EXISTS tg_triagem_pausa_por_conversa ON public.whatsapp_conversas;
DROP TABLE IF EXISTS public.whatsapp_triagem_eventos, public.whatsapp_triagens, public.whatsapp_automacao_bloqueios CASCADE;
-- B3: gatilho e tabelas de horário
DROP TRIGGER IF EXISTS tg_whatsapp_config_sincroniza_horario ON public.whatsapp_configuracoes;
DROP TABLE IF EXISTS public.whatsapp_feriados, public.whatsapp_horarios_atendimento CASCADE;
-- B1: tabelas (levam junto os gatilhos de validação)
DROP TABLE IF EXISTS public.whatsapp_triagem_respostas, public.whatsapp_triagem_passos,
  public.whatsapp_triagem_termos_proibidos, public.whatsapp_triagem_config CASCADE;
-- todas as funções das três migrações, por nome (sem as funções vivas)
DO $volta$ DECLARE r record; BEGIN
  FOR r IN SELECT p.oid::regprocedure AS f FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
             AND (p.proname LIKE 'triagem\_%' OR p.proname LIKE '\_triagem\_%'
                  OR p.proname IN ('whatsapp_dentro_do_horario', 'whatsapp_horario_em_texto', '_whatsapp_hora_em_texto',
                                   '_whatsapp_dias_em_texto', 'whatsapp_horario_salvar', 'whatsapp_feriado_salvar',
                                   'tg_whatsapp_config_sincroniza_horario')) LOOP
    EXECUTE 'DROP FUNCTION ' || r.f;
  END LOOP;
END $volta$;
DROP TYPE IF EXISTS public.triagem_evento_tipo, public.triagem_casamento, public.triagem_intencao,
  public.triagem_ramo, public.triagem_status, public.triagem_estado;
COMMIT;
```

Se algo já tiver sido aplicado pela metade, apague só o que existe: todos os comandos são `IF EXISTS`.

## 8. O que este diff NÃO resolve (registro, a mesma lista está no cabeçalho da B4)

Cada item abaixo foi levantado pelas revisões e fica de fora de propósito. Ninguém deve achar que está coberto.

1. **Equipe devolve a conversa ao ramo cliente.** Não existe função nem tela. O ramo só sobe (cliente para parceiro). Decisão do dono, aberta.
2. **Página de privacidade cobrindo triagens, eventos e bloqueios.** Pendente, fora deste diff (é página, não banco). Até lá a página não diz que nome, CEP e telefone ditos ao robô ficam guardados, nem por quanto tempo.
3. **Página `seja-parceiro` diz "tabela de parceiro" e "preço de parceiro".** Pergunta ao dono. A página NÃO foi alterada. **Pré-requisito do B5:** seja qual for a decisão do dono, o B5 só sobe com PROVA POR REQUISIÇÃO SEM SESSÃO (`curl` ou `fetch` sem cookie, contra a página publicada) de que a página não mostra preço nem tabela para quem não está logado.
4. **Regra de dono na assistente** (a assistente consultar `triagem_dono_da_conversa` antes de responder): B5.
5. **Resposta pelo `chat_lid`** quando o contato só tem lid: B5.
6. **Medir as 16 conversas de robô de empresa no ensaio** e exigir zero respostas a elas: B5, no degrau de ensaio.
7. **Retenção das triagens.** Só os eventos têm retenção (`retencao_eventos_dias`, 90). Quanto tempo guardar nome, CEP e telefone da triagem em si é decisão do dono.
8. **Gatilho temporário de sincronização de horário** (`tg_whatsapp_config_sincroniza_horario`, B3): FAZ TRABALHO desde o primeiro dia (copia o horário da tela antiga para a tabela nova quando as colunas mudam) e sai no B5, quando a assistente passar a ler `whatsapp_dentro_do_horario`. Até lá, se o dono editar o horário dia a dia na tabela nova e depois mexer na tela antiga, a tela antiga ganha. Um erro dentro dele vira `RAISE WARNING` e não trava o salvamento da tela.
9. **Permissão do horário e dos feriados.** `whatsapp_horario_salvar` e `whatsapp_feriado_salvar` aceitam `configuracoes.manage` (admin e gestor) ou `whatsapp.manage`; a tela antiga exige só `whatsapp.manage`. O gestor pode mudar o horário que o robô diz ao cliente. Decisão do dono se isso fica assim.
10. **O PR B0 (vocabulário) é pré-requisito do B5.** Só as modalidades cliente e parceiro, sem a outra palavra do mercado; já está na main como #451. O B5 não sobe antes de o texto que o cliente lê estar nesse vocabulário.
11. Decididos e registrados no cabeçalho da B4: `max_mensagens` continua 8, nenhuma origem `triagem` nova, nenhuma coluna nova em `whatsapp_conversas`.
