# Ensaio da migração C3: o agente que escolhe respostas aprovadas

Migração ainda NÃO aplicada: `supabase/migrations/20261115100000_agente_escolhe_respostas.sql`. Revisada em 14/11/2026 depois de uma revisão adversarial independente (seção 7.1 lista o que mudou). Depende da Onda B (`20261113130000`, `20261113131000`, `20261113132000`) e da base de respostas (`20261114120000_agente_base_de_respostas.sql`), que no banco vivo já estão aplicadas. Código novo: `src/domain/agente/` (portão, casamento, decisão, orquestrador), `src/lib/api/agente-escolhe.server.ts` e as ligações em `whatsapp-webhook.server.ts`, `whatsapp-triagem.server.ts` e `whatsapp-enviar.server.ts`.

## O que muda em produção ao aplicar

- **Nada que um contato perceba.** O agente nasce DESLIGADO (`agente_config.estado = 'desligada'`, percentual 0, números de teste vazios, `vale_a_partir_de` vazio). Com o estado desligado o servidor lê essa uma linha e sai: nenhuma função do agente é chamada, nenhuma trava é pega, nenhum evento é gravado.
- **Duas tabelas novas:** `agente_config` (uma linha) e `agente_eventos` (nasce vazia). Só RLS de leitura para quem tem `configuracoes.manage` ou `whatsapp.manage`; ninguém escreve direto, nem o `service_role`.
- **Nova coluna lida, nenhuma criada:** a migração agora exige `whatsapp_triagens.perguntas_de_preco` (já existe no vivo, inteiro, padrão 0) e o `agente_contexto` a soma ao contador de perguntas de preço do agente.
- **Quinze funções novas**, todas `SECURITY DEFINER` com `search_path = public`, executáveis só pelo `service_role` (anon, authenticated e PUBLIC revogados pelo nome): `agente_contexto`, `agente_registrar`, `agente_evento`, `agente_conferir_envio`, `agente_config_salvar`, `agente_desligar`, `agente_varrer`, `agente_resumo` e as internas `_agente_triagem_liberou`, `_agente_degrau_permite`, `_agente_cobre`, `_agente_cancelar_pendentes`, `_agente_desligar_config`, `_agente_avisar_equipe`, `_agente_config_antes_gravar` (esta é a do gatilho da configuração).
- **UMA função viva é trocada, por troca na definição viva:** `triagem_dono_da_conversa`. O corpo novo é o corpo vivo lido em 14/11/2026 (md5 `4632f793e72ba4d6d4b824fffcec6b5a`, conferido no começo da migração, que para sem mudar nada se o corpo vivo for outro) com UMA mudança, no ramo "triagem concluída ou entregue à equipe": primeiro, se o agente já entregou a conversa, `ninguem`; depois, se o agente cobre a conversa, `agente`; o resto igual ao de antes. Com o agente desligado `_agente_cobre` é falso e a função devolve exatamente o que devolvia. Os outros ramos (sem triagem, em andamento, ensaio, pausada por gente) não foram tocados.
- **Nenhuma outra função, tabela, gatilho ou coluna viva muda.** Nenhum valor novo de enum (o tipo `triagem_estado` é reaproveitado), nenhuma origem nova de mensagem (a mensagem sai com origem `automacao`), nenhum CHECK de origem mexido, nenhuma coluna nova em tabela com GRANT por coluna.
- **Código.** O webhook chama o agente DEPOIS da triagem e ANTES da assistente de texto livre, com `try/catch` e teto de 30 s; a conferência da fila (`conferirLinhaDeTriagem`) passa a delegar ao agente a linha que traz `agente: true`; a rodada do despachante varre o agente só quando ele está ligado. Nenhuma tela.
- **Ordem de publicação: aplique a migração ANTES do Publish.** Com o código no ar e a migração ainda não aplicada, a leitura de `agente_config` falha em todo webhook de mensagem de pessoa: o webhook segue (200) e a assistente roda como antes, mas cada mensagem deixa um `console.error` e uma tentativa de rastro que também falha. Não cai nada, só faz barulho no log.

## O que o agente faz e o que nunca faz (regras do dono)

- **Nunca escreve texto livre.** `decidirDoAgente` só devolve cinco coisas: silêncio, barrar, parar, entregar à equipe ou escolher UM código da base (id e versão da resposta). O servidor manda ao banco só ids, versão e contagens. **O texto que sai é o `texto_aprovado` da linha da base, lido por `agente_registrar` dentro da transação**, com a versão conferida e o validador do agente (`_agente_problemas_de_texto`) rodado de novo. O ensaio prova que um texto mandado de fora é ignorado (prova 5).
- **Nunca cita preço, prazo, desconto nem orçamento.** Três barreiras em série: o validador da base (C2) na hora de aprovar, `verificarTexto` (com os termos do banco) sobre o texto escolhido antes de pedir o envio, e o validador do agente no banco sobre o texto que ele leu. Reprovou em qualquer uma: a conversa vai à equipe com o motivo `texto_reprovado` e só os CÓDIGOS das regras. Há uma propriedade com 4.000 conversas sorteadas e respostas "envenenadas" na base (`tests/agente/propriedades.test.ts`): o que sai é sempre exatamente um texto aprovado e limpo, sem dígito, moeda, desconto, pagamento nem prazo, e resposta envenenada nunca é escolhida.
- **Pergunta de preço** só recebe a resposta do tema `valor_do_produto` (a que diz que a equipe confirma), mesmo que outra resposta tenha casado com uma frase maior. **A segunda pergunta de preço da conversa entrega à equipe** (`preco_de_novo`), e **quem conta é o BANCO**, não o servidor: `agente_registrar` marca como pergunta de preço toda escolha da resposta de valor (venha ou não a marca do código) e troca a decisão por `entregar` com `preco_de_novo` se já houver evento real sensível na conversa (`escolheu` ou `entregou`, nunca os de ensaio) ou se a triagem já tiver contado uma pergunta de preço (`whatsapp_triagens.perguntas_de_preco`). `agente_contexto` devolve o mesmo número ao servidor: no envio real só eventos reais, no degrau de ensaio também os de ensaio, sempre mais o contador da triagem. Nenhuma coluna nova.
- **Nunca pergunta o tipo do contato.** O ramo (cliente ou parceiro) vem da triagem. Só as duas modalidades; nenhum texto novo usa a outra palavra do mercado (`tests/vocabulario-sem-revendedor.test.ts` segue verde).
- **Casamento** pelo motor de `src/domain/agente-base/casar.ts`, sem mudar uma regra: frase gatilho como palavras inteiras, só resposta aprovada do ramo da conversa, produto vale mais que família, que vale mais que a geral, maior frase vence. O agente acrescenta: EMPATE exato (mesma especificidade, mesmo número de palavras, mesmo tamanho de frase, respostas diferentes) vai à equipe, sem sorteio.
- **Nasce desligado e com a mesma escada da triagem:** desligada, ensaio, teste, parcial, ligada. Um degrau por vez para subir (função e gatilho conferem), descer é livre, mudar estado, percentual, números de teste, teto e freios exige `whatsapp.manage` (hoje só o admin). No **ensaio** só se grava o evento `ensaio`: nenhuma mensagem, nenhuma fila, nenhum aviso, nenhum bloqueio.
- **Respeita:** gente na conversa (responsável, atribuição, modo humano, arquivada ou qualquer saída que não seja robô) e bloqueio de "parar" (no envio real o dono já é outro: o agente fica em silêncio SEM chamar o banco e sem evento; no ensaio vira `barrado`), telefone que o robô não alcança (lid, número de fora, fixo), robô de empresa (os mesmos sinais da triagem; texto longo e link vão à equipe em vez de ao silêncio), grupo, teto de mensagens do agente por conversa (padrão 3), freio de volume por hora (20) e por dia (100) e resposta do agente ainda na fila (a rajada): os três vão à EQUIPE com os motivos `teto_de_mensagens`, `freio_de_volume` e `rajada`, porque o contato ficaria sem resposta e sem ninguém sabendo; idempotência por mensagem de entrada (um índice único) e por chave da fila. **O pedido de parar vem antes de tudo isso** (robô, teto, freio, rajada): grava o bloqueio e cancela o que o agente ainda tinha pendente na conversa.
- **Conversa entregue fica entregue.** Depois de um evento `entregou` o registro recusa qualquer decisão nova com `ja_entregue` (dentro da trava da conversa, então duas mensagens que chegam juntas não passam as duas), e toda entrega cancela o que o agente ainda tinha na fila da conversa: ele não fala depois de passar a conversa à equipe. Só a entrega `passou_com_a_resposta` deixa a resposta sair, de propósito.
- **Resposta de produto nunca sai.** O agente só manda resposta geral: `agente_registrar` troca por `resposta_mudou` a linha que tenha `produto_id`, e a conferência da fila também.
- **Dado pessoal nunca vai para evento ou log.** `agente_eventos` não tem coluna de texto, nome, telefone nem CEP, e um CHECK recusa chave de detalhe com cara de conteúdo em qualquer nível. **A frase do contato que ficou sem resposta NÃO é guardada**: vira um evento `entregou` com o motivo `sem_resposta`, e `agente_resumo` conta esses eventos (o contador de perguntas sem resposta, para o dono saber que resposta falta escrever).
- **Como a mensagem sai.** Mensagem com origem `automacao` e `payload.agente` (código, versão, ramo); linha da fila com `triagem_id`, `agente: true`, `resposta_id` e `versao`, chave `triagem:<id da triagem>:agente:<id da mensagem de entrada>`. O consumidor da fila já deixa passar chave `triagem:`; `conferirLinhaDeTriagem` vê `agente: true` e confere o AGENTE (ligado, triagem que libera, degrau, gente na conversa, bloqueio, telefone e a RESPOSTA: `agente_conferir_envio(conversa, resposta_id, versao)` devolve `resposta_aprovada` falso se a resposta foi arquivada, editada, ganhou produto ou já não passa no validador, e o consumidor cancela com `resposta_mudou`), nunca a triagem. O evento `enviado` marca a FILA, não a entrega ao contato: a tela diz "escolheu uma resposta e colocou na fila" e manda conferir na conversa.
- **Retenção do rastro.** `agente_varrer` apaga o rastro velho (padrão 90 dias), MENOS os eventos `entregou`, `enviado` e `escolheu` de uma conversa: são o estado que decide o dono (`triagem_dono_da_conversa` olha o evento `entregou`), o teto de mensagens e a segunda pergunta de preço. Apagados, a conversa entregue voltaria a ter o agente como dono e o contador zeraria. Eles saem junto com a conversa (`ON DELETE CASCADE`). A prova 23 do ensaio mostra a conversa entregue com dono `ninguem` depois de a retenção rodar. A mensagem automação não zera `aguardando_desde` nem põe a conversa em modo humano (a premissa é conferida pela migração e provada no ensaio).

### Quando a triagem libera o agente

O agente só age em conversa cuja triagem TERMINOU depois de ele sair de desligada (`vale_a_partir_de`), em modo real, e só com a mensagem DEPOIS do fim da triagem (a que fechou a triagem é da triagem). Libera: `concluida`, ou `entregue_equipe` por `etapa_esgotada` ou `texto_livre`. NUNCA libera: `entregue_equipe` por `pediu_valor_de_novo` (a segunda pergunta de preço: a casa já respondeu uma vez e decidiu passar à equipe), `pediu_equipe`, `reclamou`, `texto_barrado`, `limite_mensagens`, `segundo_audio`, `texto_repetido` ou `sem_numero_alcancavel`; `parada_pelo_contato`; triagem em ensaio; conversa sem triagem.

### O que o agente faz com cada coisa que o contato escreve

| O contato escreve | O agente faz | Evento |
| --- | --- | --- |
| pergunta que a base conhece | manda o texto aprovado | `escolheu` e `enviado` |
| pergunta de preço (primeira) | manda a resposta de que a equipe confirma | `escolheu` (`sensivel`) |
| pergunta de preço (segunda em diante, ou depois de uma que a triagem já contou) | entrega à equipe, não responde | `entregou`, motivo `preco_de_novo` |
| pergunta que a base não conhece | entrega à equipe | `entregou`, motivo `sem_resposta` |
| duas respostas com a mesma força | entrega à equipe | `entregou`, motivo `empate` |
| pede para falar com uma pessoa | manda a resposta aprovada de falar com a equipe E entrega | `escolheu`, `enviado` e `entregou` (`passou_com_a_resposta`) |
| reclama, ou diz que fala com robô | entrega à equipe, sem resposta | `entregou`, motivo `reclamou` |
| áudio, imagem, documento, vídeo | entrega à equipe | `entregou`, motivo `nao_e_texto` |
| texto com mais de 300 letras ou link | entrega à equipe | `entregou`, motivo `texto_longo` ou `link` |
| "obrigado", "bom dia" | fica em silêncio | `barrado`, motivo `cortesia` |
| figurinha, texto vazio | fica em silêncio | `barrado` |
| "parar" (vale mesmo no teto, com o freio cheio ou com resposta na fila) | bloqueia (hash), cancela o que está pendente e não responde | `barrado`, motivo `parar` |
| qualquer coisa depois do teto de mensagens | entrega à equipe | `entregou`, motivo `teto_de_mensagens` |
| outra pergunta com a resposta anterior ainda na fila | entrega à equipe e cancela a resposta pendente | `entregou`, motivo `rajada` |
| qualquer pergunta com o limite por hora ou por dia cheio | entrega à equipe | `entregou`, motivo `freio_de_volume` |
| com gente na conversa ou contato bloqueado | não faz nada, sem evento e sem chamar o banco (no ensaio, anota) | nenhum (no ensaio, `barrado`) |

Toda entrega enfileira UM aviso no grupo da equipe (`agente_aviso:<conversa>`, só o motivo e o link da conversa, sem nome, telefone nem a frase), e depois dela o dono da conversa vira `ninguem` para sempre. Sem grupo da equipe configurado o aviso não sai e o evento diz `sem_grupo`.

### A chave antiga `agente_apos_triagem` (LEIA)

`whatsapp_triagem_config.agente_apos_triagem` continua existindo e continua liberando a assistente de TEXTO LIVRE depois que a triagem termina. **O dono não deve ligá-la:** é o caminho em que uma IA escreve o que quiser, que as regras do dono proíbem. Com o agente ligado e cobrindo a conversa, `agente` vence `assistente`; conversa que o agente entregou fica `ninguem` mesmo com a chave ligada; e conversa que o degrau do agente não cobre (teste ou parcial fora do sorteio) vai para a assistente SE a chave estiver ligada (prova 9). Mantida em `false`, nada disso acontece.

### Acoplamentos conhecidos com a triagem e limites do desenho (registrados, não corrigidos)

- **As filas do agente e da triagem se cruzam pela chave `triagem_id`.** A linha do agente na fila leva `triagem_id` (é o que faz o consumidor não cancelá-la), então os dois comandos da triagem que olham `payload ? 'triagem_id'` alcançam o agente: **desligar a triagem cancela também a linha do agente que ainda não saiu**, e **falhas de envio do agente contam no freio de falhas da triagem**, que pode desligar a triagem. É o lado seguro, e só acontece com as duas ligadas. O contrário também vale: o freio do agente conta só as linhas com `agente`, e a triagem não é desligada por ele.
- **Chave estrangeira para `usuarios` também pede trava curta.** Além de `whatsapp_conversas`, `agente_config.atualizado_por` referencia `usuarios(id)`: o `CREATE TABLE` toma uma trava curta nessa tabela também. O `lock_timeout` de 5 s cobre as duas.
- **O ensaio superestima.** No degrau de ensaio o agente não modela o teto de mensagens (nada é enviado, então `enviadas` fica em zero), nem a fila (`envio_pendente` fica falso, então não há rajada) nem o freio de volume. As métricas de ensaio mostram, por isso, MAIS respostas escolhidas e MENOS entregas por teto, rajada e volume do que o envio real terá.
- **Erro transitório não tem nova tentativa.** Se a leitura ou a gravação falhar (banco ocupado, tempo estourado), o agente grava o evento `erro` e a mensagem daquele contato fica sem decisão: ninguém tenta de novo. A equipe vê a mensagem na caixa, e o freio por erros desliga o agente se forem muitos. É um limite conhecido, escolhido para não responder duas vezes.
- **O papel `sandbox_exec` mantém o acesso que a postura do projeto lhe dá.** É o papel da plataforma, com `BYPASSRLS`. A promessa de que ninguém escreve direto nas tabelas do agente vale para `anon`, `authenticated` e `service_role` (as conferências olham os três), não para ele, que também edita o editor SQL do painel.
- Em teste e parcial o agente usa os SEUS números de teste e o SEU percentual (`agente_config`), não os da triagem. O sorteio é o mesmo (`_triagem_sorteio`).

## 0. ANTES de aplicar

```sql
-- 0.1 O estado de partida. Esperado: o corpo do dono 4632f793e72ba4d6d4b824fffcec6b5a (o que a migração troca); agente com 0 tabelas e 0 funções;
-- nenhuma função viva cita agente_eventos; a triagem em desligada com agente_apos_triagem false. "base: aprovadas" é quantas o dono já aprovou (0 em 14/11/2026).
SELECT 'dono da conversa: md5 do corpo vivo' AS item, md5(prosrc) AS valor FROM pg_proc WHERE oid = 'public.triagem_dono_da_conversa(uuid)'::regprocedure
UNION ALL SELECT 'agente: tabelas', count(*)::text FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('agente_config', 'agente_eventos')
UNION ALL SELECT 'agente: funções', count(*)::text FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname ~ '^_?agente_' AND proname !~ '^agente_resposta_'
   AND proname NOT IN ('_agente_frases_ok', '_agente_problemas_de_texto', '_agente_base_antes_gravar', '_agente_base_historico', '_agente_base_sem_apagar', '_agente_base_uma_por_vez')
UNION ALL SELECT 'agente: função viva que já cita agente_eventos', count(*)::text FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND prosrc ILIKE '%agente_eventos%'
UNION ALL SELECT 'base: aprovadas', count(*)::text FROM public.agente_base_respostas WHERE status = 'aprovada'
UNION ALL SELECT 'triagem: estado', estado::text FROM public.whatsapp_triagem_config
UNION ALL SELECT 'triagem: agente_apos_triagem', agente_apos_triagem::text FROM public.whatsapp_triagem_config
ORDER BY 1;
```

```sql
-- 0.2 A ACL e o search_path da função que será trocada. CREATE OR REPLACE preserva a ACL; esta é a prova de partida.
-- Esperado: definer true, config {search_path=public}, anon false, authenticated false, servico true.
SELECT p.proname, p.prosecdef AS definer, p.proconfig::text AS config,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_executa,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_executa,
       has_function_privilege('service_role', p.oid, 'EXECUTE') AS servico_executa
FROM pg_proc p WHERE p.oid = 'public.triagem_dono_da_conversa(uuid)'::regprocedure;
```

```sql
-- 0.3 A fila de envio. Esperado: a chave única de idempotency_key existe e nenhum CHECK fala de status (a idempotência do envio e o
-- status 'cancelada' dependem disso); e a premissa da saída automacao (a função viva de gatilho cita automacao e "aguardando_desde = NULL").
SELECT 'chave única da fila' AS item, (SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.whatsapp_fila_envio'::regclass AND contype = 'u'
          AND pg_get_constraintdef(oid) = 'UNIQUE (idempotency_key)')::text AS valor
UNION ALL SELECT 'CHECK de status na fila', (SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.whatsapp_fila_envio'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ~ 'status')::text
UNION ALL SELECT 'premissa automacao', (SELECT (prosrc ~ 'automacao' AND prosrc ~ 'aguardando_desde = NULL')::text FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = '_wa_mensagem_antes_inserir')
ORDER BY 1;
```
Esperado: chave única 1, CHECK de status 0, premissa true.

```sql
-- 0.4 Quem tem as duas permissões. Esperado: whatsapp.manage SÓ admin; configuracoes.manage admin e gestor.
SELECT permissao, string_agg(perfil, ', ' ORDER BY perfil) AS perfis
FROM public.perfil_permissoes WHERE permissao IN ('whatsapp.manage', 'configuracoes.manage') GROUP BY permissao ORDER BY 1;
```

```sql
-- 0.5 O grupo da equipe, que recebe o aviso quando o agente entrega uma conversa. Esperado: tem_grupo true. Se for false o aviso não sai
-- (o evento diz sem_grupo) e a conversa entregue só aparece na caixa.
SELECT public.grupo_equipe_destino() IS NOT NULL AS tem_grupo;
```

```sql
-- 0.6 O que o agente leria hoje: respostas aprovadas, por tema. Esperado em 14/11/2026: nenhuma linha (as 15 sementes são rascunho).
-- O agente sem resposta aprovada entrega TUDO à equipe com sem_resposta: aprove antes de subir além do ensaio.
SELECT tema, versao, ramos, cardinality(frases_gatilho) AS frases FROM public.agente_base_respostas WHERE status = 'aprovada' ORDER BY tema;
```

```sql
-- 0.7 A coluna que a revisão de 14/11 passou a exigir: o contador de perguntas de preço que a triagem já mantém. Esperado: 1 linha, integer, padrão 0, não nula.
-- Sem ela a migração para no começo, com "Faltam pré-requisitos".
SELECT column_name, data_type, column_default, is_nullable FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'whatsapp_triagens' AND column_name = 'perguntas_de_preco';
```

## 1. Aplicar

Aplique o arquivo da migração inteiro. Ele abre com `BEGIN;` e `SET LOCAL lock_timeout = '5s'`, fecha com `COMMIT;` e termina com uma conferência que desfaz tudo se algo estiver fora do esperado: pré-requisito que falta (inclui a coluna `whatsapp_triagens.perguntas_de_preco`), objeto do agente que já existe, corpo vivo do dono da conversa diferente do lido em 14/11/2026, chave única da fila ou premissa da saída automacao que sumiram, configuração que não nasceu desligada e com os padrões combinados, tabela com RLS desligada, qualquer papel de fora (ou o `service_role`) com escrita direta nas tabelas, função com sobrecarga, sem `SECURITY DEFINER` ou `search_path`, executável por `anon`, `authenticated` ou PUBLIC, número de funções diferente de 15, dono da conversa sem as marcas esperadas, número de gatilhos diferente de 2, coluna de texto, nome, telefone, CEP ou preço nas tabelas novas, e o CHECK do detalhe que não recusa a chave `frase`.

**Trava de tabela quente:** a migração cria `agente_eventos` com chave estrangeira para `whatsapp_conversas` (como a triagem), o que pede uma trava curta nessa tabela no `CREATE TABLE`. O `lock_timeout` de 5 s faz a migração desistir inteira se `whatsapp_conversas` estiver ocupada: aplique com pouco movimento. Não há chave estrangeira para `whatsapp_mensagens` (a tabela mais quente) e nenhum `ALTER TABLE` em tabela viva.

## 2. DEPOIS: estrutura

```sql
-- 2.1 Tabelas: RLS ligada, leitura da equipe, nenhuma escrita direta. Esperado: 2 linhas, rls true, anon_le false, equipe_le true e
-- escreve_direto false para os três papéis (anon, authenticated, service_role).
SELECT t.nome, c.relrowsecurity AS rls,
       has_table_privilege('anon', t.nome, 'SELECT') AS anon_le,
       has_table_privilege('authenticated', t.nome, 'SELECT') AS equipe_le,
       (has_table_privilege('anon', t.nome, 'INSERT, UPDATE, DELETE, TRUNCATE') OR has_table_privilege('authenticated', t.nome, 'INSERT, UPDATE, DELETE, TRUNCATE')
        OR has_table_privilege('service_role', t.nome, 'INSERT, UPDATE, DELETE, TRUNCATE')) AS escreve_direto
FROM (VALUES ('public.agente_config'), ('public.agente_eventos')) t(nome)
JOIN pg_class c ON c.oid = t.nome::regclass ORDER BY 1;
```

```sql
-- 2.2 Funções: ACL, SECURITY DEFINER e search_path. Esperado: 16 linhas (as 15 novas e o dono da conversa), anon_executa false e auth_executa false em todas.
-- Todas com definer true e config {search_path=public} e servico_executa true, EXCETO _agente_config_antes_gravar (função de gatilho: definer false).
SELECT p.proname, p.pronargs, p.prosecdef AS definer, p.proconfig::text AS config,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_executa,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_executa,
       has_function_privilege('service_role', p.oid, 'EXECUTE') AS servico_executa
FROM pg_proc p
WHERE p.pronamespace = 'public'::regnamespace
  AND ((p.proname ~ '^_?agente_' AND p.proname !~ '^agente_resposta_'
        AND p.proname NOT IN ('_agente_frases_ok', '_agente_problemas_de_texto', '_agente_base_antes_gravar', '_agente_base_historico', '_agente_base_sem_apagar', '_agente_base_uma_por_vez'))
       OR p.proname = 'triagem_dono_da_conversa')
ORDER BY 1;
```

```sql
-- 2.3 A configuração nasceu desligada. Esperado: 1 linha, estado desligada, percentual 0, numeros_teste {}, vale_a_partir_de vazio, max_mensagens 3,
-- atraso 3 e 8, max_por_hora 20, max_por_dia 100, freio_falhas_envio 3, freio_erros_hora 10, avisar_grupo true, retencao 90, desligada_por e desligada_em vazios.
SELECT estado, percentual, numeros_teste, vale_a_partir_de, max_mensagens, atraso_min_s, atraso_max_s, max_por_hora, max_por_dia,
       freio_falhas_envio, freio_erros_hora, avisar_grupo, retencao_eventos_dias, desligada_por, desligada_em FROM public.agente_config;
```

```sql
-- 2.4 Os md5 do corpo de cada função, lidos do arquivo aplicado num Postgres 17 local em 14/11/2026 (revisão de 14/11, depois da revisão adversarial). Esperado: exatamente estes 16.
-- Esperado (função, md5):
--   _agente_avisar_equipe 91ceeab664782751256b886dc538295a
--   _agente_cancelar_pendentes c20334e09977fafa6d55b4b3222696c1
--   _agente_cobre b21fa64db4df6d9494c89aa5fd118126
--   _agente_config_antes_gravar 20e9cb560e9afc410b7b26edac53a31c
--   _agente_degrau_permite 082cdd97f13caec7e605627684b71979
--   _agente_desligar_config c4fe60fc65ec99e3abf5621b5556fa83
--   _agente_triagem_liberou 761b9ac0720b6bbf72686c9379015a64
--   agente_conferir_envio 935f9bc755aa06d74dbca5cb041b5f6e
--   agente_config_salvar f88ba3db40820c7b02cfa0e0dd6320e5
--   agente_contexto 256084f9f529bd6a6c8e050ba55049b0
--   agente_desligar 20a3e5e88500933c88fcd72b3aae997e
--   agente_evento 101f3af4a01cf7057852db1e181d1121
--   agente_registrar 1770aa2400883c9fd91160a77b208f55
--   agente_resumo 1d90c52cb9a81820b0816efa09077e02
--   agente_varrer 45f7b09fec74a6563717b3d43aefedbe
--   triagem_dono_da_conversa 248788016b9eab6cc226bb33a49c201e
SELECT p.proname, md5(p.prosrc) AS md5_do_corpo FROM pg_proc p
WHERE p.pronamespace = 'public'::regnamespace
  AND ((p.proname ~ '^_?agente_' AND p.proname !~ '^agente_resposta_'
        AND p.proname NOT IN ('_agente_frases_ok', '_agente_problemas_de_texto', '_agente_base_antes_gravar', '_agente_base_historico', '_agente_base_sem_apagar', '_agente_base_uma_por_vez'))
       OR p.proname = 'triagem_dono_da_conversa')
ORDER BY 1;
```

```sql
-- 2.5 O dono da conversa trocado: as marcas do corpo novo e as do corpo antigo que precisam continuar. Esperado: as cinco colunas true.
SELECT prosrc LIKE '%_agente_cobre%' AS cita_o_agente, prosrc LIKE '%agente_eventos%' AS cita_a_entrega,
       prosrc LIKE '%agente_apos_triagem%' AS mantem_a_chave_antiga, prosrc LIKE '%pausada_humano%' AS mantem_pausada_humano,
       prosrc LIKE '%_triagem_parece_robo%' AS mantem_o_robo
FROM pg_proc WHERE oid = 'public.triagem_dono_da_conversa(uuid)'::regprocedure;
```

```sql
-- 2.6 Gatilhos. Esperado: 2 linhas, ambos na configuração (antes de gravar e sem truncate).
SELECT tgrelid::regclass AS tabela, tgname, pg_get_triggerdef(oid) AS definicao
FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN ('public.agente_config'::regclass, 'public.agente_eventos'::regclass) ORDER BY 1, 2;
```

```sql
-- 2.7 O agente ainda não fez nada. Esperado: 0 eventos, estado desligada.
SELECT (SELECT count(*) FROM public.agente_eventos) AS eventos, (SELECT estado FROM public.agente_config) AS estado;
```

## 3. ENSAIO: o agente inteiro, do estado de nascença ao freio

**Antes de rodar, quatro avisos.** (1) O ensaio escreve de verdade (conversas, mensagens, triagens, fila, eventos, bloqueio e aviso), mas só com telefones fictícios `55969999900NN`, e termina em `RAISE EXCEPTION`, que desfaz TUDO: o agente volta a `desligada`, nenhuma conversa, mensagem, fila, aviso, evento nem bloqueio fica, e as quatro respostas que ele aprova para provar o envio voltam a rascunho (a prova 31 arquiva a resposta de medida e a 32 liga a de horário a um produto, e tudo volta junto com o erro final). (2) Ele abre com `SET LOCAL lock_timeout = '2s'` e repete o ajuste por dentro (`set_config`, para valer também onde o `SET LOCAL` fora do bloco não vale): se alguma tabela ou linha que ele precisa estiver presa por outra sessão, desiste em 2 segundos com `canceling statement due to lock timeout` e desfaz tudo; é só rodar de novo com menos movimento. (3) Ele NÃO cria, altera nem apaga tabela, função ou gatilho (nenhum `CREATE`, `ALTER`, `DROP` ou `TRUNCATE`): só `INSERT`, `UPDATE` e `DELETE` com `WHERE`, que o banco vivo (safeupdate) aceita. (4) Ele para com `FALHOU` se o agente não estiver desligado, se já houver evento do agente, se não achar um usuário admin ou se não houver exatamente uma resposta não arquivada de cada um dos quatro temas que ele usa (valor, horário, falar com a equipe, medida).

O ensaio escolhe as pessoas pelas permissões que elas TÊM: o admin (papel `admin`), um gestor (`configuracoes.manage` sem `whatsapp.manage`) e alguém sem nenhuma das duas. Se não achar o gestor ou a pessoa sem permissão, diz "PULADA" naquela prova em vez de passar sem provar. As comparações usam `IS DISTINCT FROM`: uma prova que lê uma linha que não existe FALHA, não passa em silêncio. O aviso ao grupo se adapta: sem grupo da equipe a prova 8 confere que NADA foi enfileirado e o evento diz `sem_grupo`.

**Rodado em 14/11/2026 num Postgres 17 local** (o mesmo esquema reduzido de antes: as funções vivas do portão da triagem copiadas da migração B4 com o corpo do dono lido do banco vivo, `whatsapp_conversas`, `whatsapp_mensagens`, `whatsapp_fila_envio`, `whatsapp_triagens` com a coluna `perguntas_de_preco`, bloqueios, `notificacoes_fila` com um `enfileirar_notificacao` que devolve NULL na chave repetida como o vivo, `produtos`, permissões trocadas por tabela de teste, e um validador de texto simplificado no lugar do `_agente_problemas_de_texto` da C2) e a migração revisada aplicada: a conferência da migração passou, o ensaio passou inteiro (33 provas, de 0 a 32), e depois do erro final as tabelas do agente estavam vazias e a configuração desligada. **Cada correção da revisão tem prova que FALHARIA antes.** Para mostrar, cada uma foi desfeita no arquivo da migração, uma de cada vez, e o ensaio parou na prova certa: retenção apagando os eventos `entregou`, `enviado` e `escolheu` (prova 23: `6 antes, 0 depois`), `ja_entregue` removido (24), marca de preço pelo tema removida (25), contador da triagem fora da conta (25), contador de ensaio contando no envio real (6), resposta com produto passando (32), entrega sem cancelar o pendente (28), `rajada` e `freio_de_volume` voltando a barrar (28 e 29), `pediu_valor_de_novo` liberando o agente (26), o gestor mudando o atraso (2), o aviso repetido sem `ja_enviado` (27), `parar` sem cancelar o pendente (30) e a conferência da fila sem olhar a resposta (31). NÃO foi rodado no banco vivo: lá, quem aplica confere. **Diferenças conhecidas do local para o vivo:** o validador de texto do local barra qualquer dígito, "R$" e "dias" (o vivo é o da C2, muito mais fino, e é ele que aprova as quatro respostas na prova 0; a seção 9 prova o validador fino no Postgres local com as funções vivas copiadas); `has_permission` é uma tabela de teste; `notificacoes_fila` local não tem o CHECK de entidade (a prova 8 confere no vivo); o vivo tem gatilhos em `whatsapp_conversas`, `whatsapp_mensagens` e `agente_base_respostas` que o local não tem (o ensaio da Onda B, com as mesmas inserções, já passou no vivo). **No vivo as provas 31 e 32 podem dizer PULADA em parte**, porque o gatilho da base devolve a resposta a rascunho ao mudar o produto e pode recusar o `UPDATE`: elas dizem isso em vez de passar sem provar.

```sql
-- Rode com pouco movimento. Se alguma tabela ou linha que o ensaio precisa estiver presa por outra sessão, desiste em 2 s e desfaz tudo; repita depois.
SET LOCAL lock_timeout = '2s';
DO $ensaio$
DECLARE
  v_inst uuid := (SELECT id FROM public.whatsapp_instancias LIMIT 1);
  v_admin uuid;
  v_gestor uuid;
  v_ninguem uuid;
  v_r text[] := '{}';
  v_c1 uuid; v_c2 uuid; v_c3 uuid; v_c4 uuid; v_c5 uuid; v_c6 uuid; v_c7 uuid; v_c8 uuid; v_c9 uuid; v_c10 uuid;
  v_c11 uuid; v_c12 uuid; v_c13 uuid; v_c14 uuid;
  v_c15 uuid; v_c16 uuid; v_c17 uuid; v_c18 uuid; v_c19 uuid; v_c20 uuid; v_c21 uuid; v_c22 uuid; v_c23 uuid; v_c24 uuid;
  v_t2 uuid; v_ms uuid; v_ant integer; v_dep integer;
  v_m uuid; v_m2 uuid; v_m3 uuid; v_m4 uuid; v_m5 uuid; v_m6 uuid; v_m7 uuid; v_m8 uuid;
  v_t uuid;
  v_ag timestamptz; v_ag2 timestamptz;
  v_valor uuid; v_valor_v integer; v_valor_t text;
  v_hor uuid; v_hor_v integer;
  v_eq uuid; v_eq_v integer; v_eq_t text;
  v_med uuid; v_med_v integer;
  v_s jsonb; v_j jsonb;
  v_n integer; v_x text;
  v_lin record;
  v_tema text;
  v_fim timestamptz := now();
BEGIN
  PERFORM set_config('lock_timeout', '2s', true);
  IF v_inst IS NULL THEN RAISE EXCEPTION 'FALHOU: não há instância de WhatsApp para o ensaio'; END IF;
  SELECT ur.user_id INTO v_admin FROM public.user_roles ur WHERE ur.role::text = 'admin' LIMIT 1;
  IF v_admin IS NULL THEN RAISE EXCEPTION 'FALHOU: não há usuário com o papel admin para o ensaio'; END IF;
  SELECT u.id INTO v_gestor FROM public.usuarios u
   WHERE u.ativo AND public.has_permission(u.id, 'configuracoes.manage') AND NOT public.has_permission(u.id, 'whatsapp.manage') LIMIT 1;
  SELECT u.id INTO v_ninguem FROM public.usuarios u
   WHERE NOT public.has_permission(u.id, 'configuracoes.manage') AND NOT public.has_permission(u.id, 'whatsapp.manage') LIMIT 1;
  IF (SELECT estado FROM public.agente_config) <> 'desligada' THEN
    RAISE EXCEPTION 'FALHOU: o agente não está desligado; este ensaio parte do estado de nascença';
  END IF;
  IF (SELECT count(*) FROM public.agente_eventos) <> 0 THEN
    RAISE EXCEPTION 'FALHOU: já existem eventos do agente; este ensaio parte de uma tabela vazia (rode a seção 5 só se quiser descartar)';
  END IF;

  -- 0) o que o dono aprovaria, aprovado DENTRO desta transação (o erro final desfaz). Só rascunho é aprovado; aprovada já é usada.
  FOREACH v_tema IN ARRAY ARRAY['valor_do_produto', 'horario_de_atendimento', 'falar_com_a_equipe', 'medida_do_produto'] LOOP
    SELECT count(*) INTO v_n FROM public.agente_base_respostas WHERE tema = v_tema AND status::text <> 'arquivada';
    IF v_n <> 1 THEN RAISE EXCEPTION 'FALHOU 0: esperava 1 resposta não arquivada do tema %, achei %', v_tema, v_n; END IF;
    IF (SELECT status::text FROM public.agente_base_respostas WHERE tema = v_tema AND status::text <> 'arquivada') = 'rascunho' THEN
      PERFORM public.agente_resposta_aprovar(v_admin, (SELECT id FROM public.agente_base_respostas WHERE tema = v_tema AND status::text <> 'arquivada'),
                                             (SELECT versao FROM public.agente_base_respostas WHERE tema = v_tema AND status::text <> 'arquivada'));
    END IF;
  END LOOP;
  SELECT id, versao, texto_aprovado INTO v_valor, v_valor_v, v_valor_t FROM public.agente_base_respostas WHERE tema = 'valor_do_produto' AND status::text = 'aprovada';
  SELECT id, versao INTO v_hor, v_hor_v FROM public.agente_base_respostas WHERE tema = 'horario_de_atendimento' AND status::text = 'aprovada';
  SELECT id, versao, texto_aprovado INTO v_eq, v_eq_v, v_eq_t FROM public.agente_base_respostas WHERE tema = 'falar_com_a_equipe' AND status::text = 'aprovada';
  SELECT id, versao INTO v_med, v_med_v FROM public.agente_base_respostas WHERE tema = 'medida_do_produto' AND status::text = 'aprovada';
  IF v_valor IS NULL OR v_hor IS NULL OR v_eq IS NULL OR v_med IS NULL THEN RAISE EXCEPTION 'FALHOU 0: não deu para aprovar as quatro respostas do ensaio'; END IF;
  v_r := array_append(v_r, '0) quatro respostas aprovadas dentro da transação (valor, horário, falar com a equipe, medida)');

  -- 1) ESTADO DE NASCENÇA: desligada, nada é dono, o contexto não traz base e o registro recusa
  INSERT INTO public.whatsapp_conversas (instancia_id, telefone, chat_lid) VALUES (v_inst, '5596999990001', '99999999990001@lid') RETURNING id INTO v_c1;
  INSERT INTO public.whatsapp_triagens (conversa_id, modo, status, motivo_fim, concluida_em, atualizado_em)
  VALUES (v_c1, 'real', 'concluida', NULL, v_fim, v_fim) RETURNING id INTO v_t;
  INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, zapi_message_id, direcao, tipo, status, texto, origem, recebido_em, created_at)
  VALUES (v_c1, v_inst, 'ENSAIO-AG-1A', 'entrada', 'texto', 'recebida', 'quanto custa um banner?', 'humano', now(), v_fim + interval '1 minute') RETURNING id INTO v_m;
  SELECT aguardando_desde INTO v_ag FROM public.whatsapp_conversas WHERE id = v_c1;
  v_s := public.agente_contexto(v_c1, v_m);
  IF v_s -> 'config' ->> 'estado' IS DISTINCT FROM 'desligada' OR jsonb_array_length(v_s -> 'base') <> 0 THEN
    RAISE EXCEPTION 'FALHOU 1: desligada, o contexto não devia trazer base: %', v_s -> 'config'; END IF;
  v_j := public.agente_registrar(v_c1, v_m, jsonb_build_object('acao', 'escolher', 'resposta_id', v_valor, 'versao', v_valor_v));
  IF v_j ->> 'registrado' IS DISTINCT FROM 'false' OR v_j ->> 'motivo' IS DISTINCT FROM 'desligada' THEN RAISE EXCEPTION 'FALHOU 1: o registro devia recusar desligada: %', v_j; END IF;
  IF (SELECT count(*) FROM public.agente_eventos) <> 0 THEN RAISE EXCEPTION 'FALHOU 1: desligada não grava evento'; END IF;
  IF public.triagem_dono_da_conversa(v_c1) IS DISTINCT FROM 'ninguem' THEN RAISE EXCEPTION 'FALHOU 1: triagem concluída e agente desligado: dono %', public.triagem_dono_da_conversa(v_c1); END IF;
  v_r := array_append(v_r, '1) desligada (nascença): contexto sem base, registro recusa, zero evento, dono continua ninguem (agente_apos_triagem desligada)');

  -- 2) A ESCADA: subir um degrau por vez, quem pode, e vale_a_partir_de
  BEGIN
    PERFORM public.agente_config_salvar(v_admin, '{"estado":"teste"}'::jsonb);
    RAISE EXCEPTION 'FALHOU 2: pulou de desligada para teste';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FALHOU%' THEN RAISE; END IF;
    IF SQLERRM IS DISTINCT FROM 'O agente só sobe um degrau de cada vez, na ordem.' THEN RAISE EXCEPTION 'FALHOU 2: frase do degrau: %', SQLERRM; END IF;
  END;
  PERFORM public.agente_config_salvar(v_admin, '{"estado":"ensaio"}'::jsonb);
  IF (SELECT vale_a_partir_de FROM public.agente_config) IS NULL THEN RAISE EXCEPTION 'FALHOU 2: vale_a_partir_de não foi preenchido ao sair de desligada'; END IF;
  IF v_gestor IS NOT NULL THEN
    BEGIN
      PERFORM public.agente_config_salvar(v_gestor, '{"estado":"teste"}'::jsonb);
      RAISE EXCEPTION 'FALHOU 2: o gestor mudou o estado do agente';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM LIKE 'FALHOU%' THEN RAISE; END IF;
    END;
    -- salvar os MESMOS valores não muda nada e passa; mudar o aviso ao grupo, o atraso ou a guarda do rastro exige whatsapp.manage
    PERFORM public.agente_config_salvar(v_gestor, '{"avisar_grupo":true,"atraso_min_s":3}'::jsonb);
    FOREACH v_x IN ARRAY ARRAY['{"avisar_grupo":false}', '{"retencao_eventos_dias":30}', '{"atraso_min_s":5}', '{"atraso_max_s":9}'] LOOP
      BEGIN
        PERFORM public.agente_config_salvar(v_gestor, v_x::jsonb);
        RAISE EXCEPTION 'FALHOU 2: o gestor mudou %', v_x;
      EXCEPTION WHEN raise_exception THEN
        IF SQLERRM LIKE 'FALHOU%' THEN RAISE; END IF;
        IF SQLERRM !~ 'permissão de gerenciar o WhatsApp' THEN RAISE EXCEPTION 'FALHOU 2: frase da recusa fora do combinado: %', SQLERRM; END IF;
      END;
    END LOOP;
    v_r := array_append(v_r, '2) escada: pular degrau recusado; o gestor não muda o estado, o aviso ao grupo, o atraso nem a guarda do rastro (a recusa vem em frase de tela), mas salva os mesmos valores; vale_a_partir_de preenchido');
  ELSE
    v_r := array_append(v_r, '2) escada: pular degrau recusado e vale_a_partir_de preenchido (parte do gestor PULADA: não há usuário só com configuracoes.manage)');
  END IF;

  -- 3) ENSAIO: grava só o evento. Nada de mensagem, fila, aviso nem bloqueio. O ensaio não é dono.
  IF public.triagem_dono_da_conversa(v_c1) IS DISTINCT FROM 'ninguem' THEN RAISE EXCEPTION 'FALHOU 3: no ensaio o agente não é dono: %', public.triagem_dono_da_conversa(v_c1); END IF;
  v_s := public.agente_contexto(v_c1, v_m);
  IF v_s -> 'triagem' ->> 'liberou' IS DISTINCT FROM 'true' OR v_s -> 'mensagem' ->> 'posterior_a_triagem' IS DISTINCT FROM 'true'
     OR jsonb_array_length(v_s -> 'base') < 4 THEN RAISE EXCEPTION 'FALHOU 3: contexto do ensaio: %', v_s - 'base'; END IF;
  v_j := public.agente_registrar(v_c1, v_m, jsonb_build_object('acao', 'escolher', 'resposta_id', v_valor, 'versao', v_valor_v, 'sensivel', true,
                                                              'candidatas', 1, 'especificidade', 1, 'atraso_s', 4));
  IF v_j ->> 'ensaio' IS DISTINCT FROM 'true' OR v_j ->> 'enviado' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'FALHOU 3: %', v_j; END IF;
  IF (SELECT count(*) FROM public.whatsapp_mensagens WHERE conversa_id = v_c1 AND direcao = 'saida') <> 0
     OR (SELECT count(*) FROM public.whatsapp_fila_envio WHERE conversa_id = v_c1) <> 0
     OR (SELECT count(*) FROM public.agente_eventos WHERE conversa_id = v_c1 AND tipo = 'ensaio' AND codigo = 'valor_do_produto' AND sensivel) <> 1
     OR (SELECT count(*) FROM public.agente_eventos WHERE tipo IN ('escolheu', 'enviado')) <> 0 THEN
    RAISE EXCEPTION 'FALHOU 3: o ensaio gravou o que não devia'; END IF;
  v_j := public.agente_registrar(v_c1, v_m, jsonb_build_object('acao', 'escolher', 'resposta_id', v_valor, 'versao', v_valor_v));
  IF v_j ->> 'duplicada' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'FALHOU 3: a segunda decisão da mesma mensagem passou: %', v_j; END IF;
  INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, zapi_message_id, direcao, tipo, status, texto, origem, recebido_em, created_at)
  VALUES (v_c1, v_inst, 'ENSAIO-AG-1B', 'entrada', 'texto', 'recebida', 'obrigado', 'humano', now(), v_fim + interval '2 minutes') RETURNING id INTO v_m2;
  v_j := public.agente_registrar(v_c1, v_m2, jsonb_build_object('acao', 'entregar', 'motivo', 'sem_resposta'));
  IF v_j ->> 'ensaio' IS DISTINCT FROM 'true'
     OR (SELECT count(*) FROM public.agente_eventos WHERE conversa_id = v_c1 AND tipo = 'ensaio' AND acao = 'entregar' AND motivo = 'sem_resposta') <> 1
     OR (SELECT count(*) FROM public.agente_eventos WHERE tipo = 'entregou') <> 0
     OR (SELECT count(*) FROM public.notificacoes_fila WHERE idempotency_key = 'agente_aviso:' || v_c1) <> 0 THEN
    RAISE EXCEPTION 'FALHOU 3: entregar no ensaio devia só anotar: %', v_j; END IF;
  v_s := public.agente_contexto(v_c1, v_m2);
  IF (v_s -> 'contagens' ->> 'perguntas_de_preco')::integer IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'FALHOU 3: no ensaio a pergunta de preço do ensaio conta: %', v_s -> 'contagens'; END IF;
  v_r := array_append(v_r, '3) ensaio: escolher e entregar gravam só o evento ensaio (com a marca de pergunta de preço); zero mensagem, zero fila, zero aviso; a mesma mensagem não decide duas vezes; ensaio não é dono');

  -- 4) TESTE: o dono é o agente só para número de teste; os outros seguem como antes
  INSERT INTO public.whatsapp_conversas (instancia_id, telefone, chat_lid) VALUES (v_inst, '5596999990002', '99999999990002@lid') RETURNING id INTO v_c2;
  INSERT INTO public.whatsapp_triagens (conversa_id, modo, status, concluida_em, atualizado_em) VALUES (v_c2, 'real', 'concluida', v_fim, v_fim);
  INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, zapi_message_id, direcao, tipo, status, texto, origem, recebido_em, created_at)
  VALUES (v_c2, v_inst, 'ENSAIO-AG-2A', 'entrada', 'texto', 'recebida', 'qual o horario?', 'humano', now(), v_fim + interval '1 minute') RETURNING id INTO v_m3;
  PERFORM public.agente_config_salvar(v_admin, jsonb_build_object('estado', 'teste', 'max_mensagens', 2, 'numeros_teste',
    jsonb_build_array('96999990001','96999990003','96999990004','96999990005','96999990006','96999990007','96999990008','96999990014','96999990010','96999990013',
                      '96999990015','96999990016','96999990017','96999990018','96999990019','96999990020','96999990021','96999990022','96999990023','96999990024')));
  IF public.triagem_dono_da_conversa(v_c1) IS DISTINCT FROM 'agente' THEN RAISE EXCEPTION 'FALHOU 4: número de teste devia ter o agente como dono: %', public.triagem_dono_da_conversa(v_c1); END IF;
  IF public.triagem_dono_da_conversa(v_c2) IS DISTINCT FROM 'ninguem' THEN RAISE EXCEPTION 'FALHOU 4: fora do teste o dono é o de antes: %', public.triagem_dono_da_conversa(v_c2); END IF;
  v_j := public.agente_registrar(v_c2, v_m3, jsonb_build_object('acao', 'escolher', 'resposta_id', v_hor, 'versao', v_hor_v));
  IF v_j ->> 'registrado' IS DISTINCT FROM 'false' OR v_j ->> 'motivo' IS DISTINCT FROM 'fora_do_degrau' THEN RAISE EXCEPTION 'FALHOU 4: fora do degrau: %', v_j; END IF;
  v_r := array_append(v_r, '4) teste: agente dono só do número de teste; o outro continua ninguem e o registro recusa com fora_do_degrau');

  -- 5) ENVIO REAL: o texto é o aprovado, palavra por palavra, mesmo que o servidor mande outro; origem automacao; marca de agente
  INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, zapi_message_id, direcao, tipo, status, texto, origem, recebido_em, created_at)
  VALUES (v_c1, v_inst, 'ENSAIO-AG-1C', 'entrada', 'texto', 'recebida', 'qual o valor do banner?', 'humano', now(), v_fim + interval '3 minutes') RETURNING id INTO v_m4;
  v_j := public.agente_registrar(v_c1, v_m4, jsonb_build_object('acao', 'escolher', 'resposta_id', v_valor, 'versao', v_valor_v, 'sensivel', true,
                                  'candidatas', 1, 'especificidade', 1, 'atraso_s', 4, 'texto', 'O valor fica em R$ 50, pronto em 2 dias'));
  IF v_j ->> 'enviado' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'FALHOU 5: não enviou: %', v_j; END IF;
  SELECT m.texto, m.origem, m.payload, m.status INTO v_lin FROM public.whatsapp_mensagens m WHERE m.conversa_id = v_c1 AND m.direcao = 'saida';
  IF v_lin.texto IS DISTINCT FROM v_valor_t OR v_lin.origem IS DISTINCT FROM 'automacao' OR NOT coalesce(v_lin.payload ? 'agente', false) OR v_lin.status IS DISTINCT FROM 'pendente' THEN
    RAISE EXCEPTION 'FALHOU 5: a mensagem gravada não é a aprovada: % / % / %', v_lin.texto, v_lin.origem, v_lin.payload; END IF;
  SELECT f.payload, f.idempotency_key, f.status INTO v_lin FROM public.whatsapp_fila_envio f WHERE f.conversa_id = v_c1;
  IF v_lin.payload ->> 'texto' IS DISTINCT FROM v_valor_t OR (v_lin.payload ->> 'triagem_id')::uuid IS DISTINCT FROM v_t
     OR v_lin.payload ->> 'agente' IS DISTINCT FROM 'true' OR v_lin.payload ->> 'passo' IS DISTINCT FROM 'agente'
     OR (v_lin.payload ->> 'resposta_id')::uuid IS DISTINCT FROM v_valor OR (v_lin.payload ->> 'versao')::integer IS DISTINCT FROM v_valor_v
     OR v_lin.idempotency_key IS DISTINCT FROM 'triagem:' || v_t || ':agente:' || v_m4 OR v_lin.status IS DISTINCT FROM 'pendente' THEN
    RAISE EXCEPTION 'FALHOU 5: linha da fila fora do combinado: %', v_lin.payload; END IF;
  SELECT aguardando_desde INTO v_ag2 FROM public.whatsapp_conversas WHERE id = v_c1;
  IF v_ag2 IS DISTINCT FROM v_ag THEN RAISE EXCEPTION 'FALHOU 5: a mensagem automacao mexeu em aguardando_desde (% -> %)', v_ag, v_ag2; END IF;
  IF (SELECT modo FROM public.whatsapp_conversas WHERE id = v_c1) IS DISTINCT FROM 'auto' THEN RAISE EXCEPTION 'FALHOU 5: a mensagem automacao pôs a conversa em modo humano'; END IF;
  IF (SELECT count(*) FROM public.agente_eventos WHERE conversa_id = v_c1 AND tipo = 'escolheu' AND mensagem_id = v_m4) <> 1
     OR (SELECT count(*) FROM public.agente_eventos WHERE conversa_id = v_c1 AND tipo = 'enviado') <> 1 THEN
    RAISE EXCEPTION 'FALHOU 5: eventos escolheu e enviado'; END IF;
  v_r := array_append(v_r, '5) envio real: texto igual ao aprovado (o texto mandado de fora foi ignorado), origem automacao, marca agente e triagem_id na fila, chave triagem:<id>:agente:<entrada>, resposta_id e versao no payload da fila, aguardando_desde e modo intactos, eventos escolheu e enviado');

  -- 6) a mesma chave nunca gera segunda mensagem; mensagem nova com resposta ainda na fila é barrada
  v_j := public.agente_registrar(v_c1, v_m4, jsonb_build_object('acao', 'escolher', 'resposta_id', v_valor, 'versao', v_valor_v));
  IF v_j ->> 'duplicada' IS DISTINCT FROM 'true' OR (SELECT count(*) FROM public.whatsapp_fila_envio WHERE conversa_id = v_c1) <> 1 THEN
    RAISE EXCEPTION 'FALHOU 6: reenvio: %', v_j; END IF;
  INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, zapi_message_id, direcao, tipo, status, texto, origem, recebido_em, created_at)
  VALUES (v_c1, v_inst, 'ENSAIO-AG-1D', 'entrada', 'texto', 'recebida', 'e qual a medida?', 'humano', now(), v_fim + interval '4 minutes') RETURNING id INTO v_m5;
  v_s := public.agente_contexto(v_c1, v_m5);
  -- perguntas de preço: no envio real só contam os eventos reais (a escolha da prova 5), nunca o evento de ensaio da prova 3
  IF v_s -> 'contagens' ->> 'envio_pendente' IS DISTINCT FROM 'true' OR (v_s -> 'contagens' ->> 'enviadas')::integer <> 1
     OR (v_s -> 'contagens' ->> 'perguntas_de_preco')::integer IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'FALHOU 6: contagens: %', v_s -> 'contagens'; END IF;
  v_r := array_append(v_r, '6) mesma mensagem: duplicada, uma linha só na fila; contagens de envio, de fila e de pergunta de preço corretas (no envio real o evento de ensaio não conta)');

  -- 7) conferir_envio: o que o consumidor lê antes de despachar
  v_s := public.agente_conferir_envio(v_c1, v_valor, v_valor_v);
  IF v_s ->> 'estado' IS DISTINCT FROM 'teste' OR v_s ->> 'triagem_liberou' IS DISTINCT FROM 'true' OR v_s ->> 'degrau_permite' IS DISTINCT FROM 'true'
     OR v_s ->> 'humano' IS DISTINCT FROM 'false' OR v_s ->> 'bloqueado' IS DISTINCT FROM 'false' OR v_s ->> 'resposta_aprovada' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'FALHOU 7: %', v_s; END IF;
  v_s := public.agente_conferir_envio(v_c2, v_hor, v_hor_v);
  IF v_s ->> 'degrau_permite' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'FALHOU 7: fora do teste o degrau não permite: %', v_s; END IF;
  v_r := array_append(v_r, '7) conferir_envio: estado teste, triagem libera, degrau permite, sem humano, sem bloqueio; o número fora do teste não passa');

  -- 8) TETO do agente (2): depois de duas enviadas a conversa vai à equipe, com aviso ao grupo
  UPDATE public.whatsapp_fila_envio SET status = 'enviada' WHERE conversa_id = v_c1;
  UPDATE public.whatsapp_mensagens SET status = 'enviada' WHERE conversa_id = v_c1 AND direcao = 'saida';
  INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, zapi_message_id, direcao, tipo, status, texto, origem, recebido_em, created_at)
  VALUES (v_c1, v_inst, 'ENSAIO-AG-1D2', 'entrada', 'texto', 'recebida', 'qual medida posso pedir?', 'humano', now(), v_fim + interval '270 seconds') RETURNING id INTO v_m8;
  v_j := public.agente_registrar(v_c1, v_m8, jsonb_build_object('acao', 'escolher', 'resposta_id', v_med, 'versao', v_med_v));
  IF v_j ->> 'enviado' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'FALHOU 8: a segunda resposta devia sair: %', v_j; END IF;
  UPDATE public.whatsapp_fila_envio SET status = 'enviada' WHERE conversa_id = v_c1;
  UPDATE public.whatsapp_mensagens SET status = 'enviada' WHERE conversa_id = v_c1 AND direcao = 'saida';
  INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, zapi_message_id, direcao, tipo, status, texto, origem, recebido_em, created_at)
  VALUES (v_c1, v_inst, 'ENSAIO-AG-1E', 'entrada', 'texto', 'recebida', 'e o horario?', 'humano', now(), v_fim + interval '5 minutes') RETURNING id INTO v_m6;
  v_j := public.agente_registrar(v_c1, v_m6, jsonb_build_object('acao', 'escolher', 'resposta_id', v_hor, 'versao', v_hor_v));
  IF v_j ->> 'acao' IS DISTINCT FROM 'entregar' OR v_j ->> 'motivo' IS DISTINCT FROM 'teto_de_mensagens' OR v_j ->> 'enviado' IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'FALHOU 8: teto: %', v_j; END IF;
  v_x := v_j ->> 'aviso';
  IF v_x IS NULL OR v_x NOT IN ('enfileirado', 'sem_grupo') THEN RAISE EXCEPTION 'FALHOU 8: aviso %', v_x; END IF;
  SELECT count(*) INTO v_n FROM public.notificacoes_fila WHERE idempotency_key = 'agente_aviso:' || v_c1;
  IF (v_x = 'enfileirado' AND v_n <> 1) OR (v_x = 'sem_grupo' AND v_n <> 0) THEN RAISE EXCEPTION 'FALHOU 8: notificações % com aviso %', v_n, v_x; END IF;
  IF v_x = 'enfileirado' AND (SELECT variaveis ->> 'texto' FROM public.notificacoes_fila WHERE idempotency_key = 'agente_aviso:' || v_c1) !~ 'Motivo: teto de mensagens' THEN
    RAISE EXCEPTION 'FALHOU 8: texto do aviso'; END IF;
  IF public.triagem_dono_da_conversa(v_c1) IS DISTINCT FROM 'ninguem' THEN RAISE EXCEPTION 'FALHOU 8: depois de entregar o dono é ninguem: %', public.triagem_dono_da_conversa(v_c1); END IF;
  v_r := array_append(v_r, format('8) teto de 2 mensagens: a terceira vira entregou/teto_de_mensagens, aviso ao grupo: %s (%s linha em notificacoes_fila, sem nome nem telefone), e o dono passa a ninguem', v_x, v_n));

  -- 9) A CHAVE ANTIGA agente_apos_triagem: depois de entregar, fica ninguem mesmo com ela ligada; fora do degrau, libera a assistente (por isso o dono não deve ligá-la)
  UPDATE public.whatsapp_triagem_config SET agente_apos_triagem = true WHERE id;
  IF public.triagem_dono_da_conversa(v_c1) IS DISTINCT FROM 'ninguem' THEN RAISE EXCEPTION 'FALHOU 9: entregue pelo agente é ninguem para sempre: %', public.triagem_dono_da_conversa(v_c1); END IF;
  IF public.triagem_dono_da_conversa(v_c2) IS DISTINCT FROM 'assistente' THEN RAISE EXCEPTION 'FALHOU 9: com a chave antiga ligada a conversa fora do degrau vai para a assistente: %', public.triagem_dono_da_conversa(v_c2); END IF;
  UPDATE public.whatsapp_triagem_config SET agente_apos_triagem = false WHERE id;
  v_r := array_append(v_r, '9) agente_apos_triagem ligada: conversa que o agente entregou segue ninguem; a que o degrau não cobre vai para a assistente de texto livre (o dono não deve ligar a chave)');

  -- 10) SEGUNDA PERGUNTA DE PREÇO: triagem entregue por texto_livre libera o agente; entregar com o motivo, só aviso, nenhuma mensagem
  INSERT INTO public.whatsapp_conversas (instancia_id, telefone, chat_lid) VALUES (v_inst, '5596999990003', '99999999990003@lid') RETURNING id INTO v_c3;
  INSERT INTO public.whatsapp_triagens (conversa_id, modo, status, motivo_fim, concluida_em, atualizado_em) VALUES (v_c3, 'real', 'entregue_equipe', 'texto_livre', v_fim, v_fim);
  INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, zapi_message_id, direcao, tipo, status, texto, origem, recebido_em, created_at)
  VALUES (v_c3, v_inst, 'ENSAIO-AG-3A', 'entrada', 'texto', 'recebida', 'qual o preco de novo?', 'humano', now(), v_fim + interval '1 minute') RETURNING id INTO v_m;
  IF public.triagem_dono_da_conversa(v_c3) IS DISTINCT FROM 'agente' THEN RAISE EXCEPTION 'FALHOU 10: entregue_equipe por texto_livre devia liberar o agente: %', public.triagem_dono_da_conversa(v_c3); END IF;
  v_j := public.agente_registrar(v_c3, v_m, jsonb_build_object('acao', 'entregar', 'motivo', 'preco_de_novo', 'sensivel', true));
  IF v_j ->> 'tipo' IS DISTINCT FROM 'entregou' OR v_j ->> 'enviado' IS DISTINCT FROM 'false'
     OR (SELECT count(*) FROM public.whatsapp_mensagens WHERE conversa_id = v_c3 AND direcao = 'saida') <> 0
     OR (SELECT count(*) FROM public.agente_eventos WHERE conversa_id = v_c3 AND tipo = 'entregou' AND motivo = 'preco_de_novo' AND sensivel) <> 1
     OR public.triagem_dono_da_conversa(v_c3) IS DISTINCT FROM 'ninguem' THEN RAISE EXCEPTION 'FALHOU 10: %', v_j; END IF;
  v_r := array_append(v_r, '10) segunda pergunta de preço: entregou/preco_de_novo, nenhuma mensagem ao contato, dono vira ninguem; triagem entregue por texto_livre liberou o agente');

  -- 11) triagem entregue porque o contato PEDIU GENTE (ou reclamou) NUNCA libera o agente
  INSERT INTO public.whatsapp_conversas (instancia_id, telefone, chat_lid) VALUES (v_inst, '5596999990004', '99999999990004@lid') RETURNING id INTO v_c4;
  INSERT INTO public.whatsapp_triagens (conversa_id, modo, status, motivo_fim, concluida_em, atualizado_em) VALUES (v_c4, 'real', 'entregue_equipe', 'pediu_equipe', v_fim, v_fim);
  INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, zapi_message_id, direcao, tipo, status, texto, origem, recebido_em, created_at)
  VALUES (v_c4, v_inst, 'ENSAIO-AG-4A', 'entrada', 'texto', 'recebida', 'qual o horario?', 'humano', now(), v_fim + interval '1 minute') RETURNING id INTO v_m;
  v_j := public.agente_registrar(v_c4, v_m, jsonb_build_object('acao', 'escolher', 'resposta_id', v_hor, 'versao', v_hor_v));
  IF v_j ->> 'motivo' IS DISTINCT FROM 'triagem_nao_liberou' OR public.triagem_dono_da_conversa(v_c4) IS DISTINCT FROM 'ninguem'
     OR (SELECT count(*) FROM public.agente_eventos WHERE conversa_id = v_c4) <> 0 THEN RAISE EXCEPTION 'FALHOU 11: %', v_j; END IF;
  v_r := array_append(v_r, '11) triagem entregue por pediu_equipe: o agente não é dono, o registro recusa (triagem_nao_liberou) e nada é gravado');

  -- 12) RESPOSTA MUDOU: versão velha nunca envia, vai à equipe
  INSERT INTO public.whatsapp_conversas (instancia_id, telefone, chat_lid) VALUES (v_inst, '5596999990005', '99999999990005@lid') RETURNING id INTO v_c5;
  INSERT INTO public.whatsapp_triagens (conversa_id, modo, status, concluida_em, atualizado_em) VALUES (v_c5, 'real', 'concluida', v_fim, v_fim);
  INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, zapi_message_id, direcao, tipo, status, texto, origem, recebido_em, created_at)
  VALUES (v_c5, v_inst, 'ENSAIO-AG-5A', 'entrada', 'texto', 'recebida', 'qual o horario?', 'humano', now(), v_fim + interval '1 minute') RETURNING id INTO v_m;
  v_j := public.agente_registrar(v_c5, v_m, jsonb_build_object('acao', 'escolher', 'resposta_id', v_hor, 'versao', v_hor_v + 1));
  IF v_j ->> 'acao' IS DISTINCT FROM 'entregar' OR v_j ->> 'motivo' IS DISTINCT FROM 'resposta_mudou'
     OR (SELECT count(*) FROM public.whatsapp_mensagens WHERE conversa_id = v_c5 AND direcao = 'saida') <> 0 THEN RAISE EXCEPTION 'FALHOU 12: %', v_j; END IF;
  v_r := array_append(v_r, '12) versão que o servidor viu diferente da do banco: entregou/resposta_mudou e nenhuma mensagem');

  -- 13) GENTE NA CONVERSA manda mais que a decisão
  INSERT INTO public.whatsapp_conversas (instancia_id, telefone, chat_lid) VALUES (v_inst, '5596999990006', '99999999990006@lid') RETURNING id INTO v_c6;
  INSERT INTO public.whatsapp_triagens (conversa_id, modo, status, concluida_em, atualizado_em) VALUES (v_c6, 'real', 'concluida', v_fim, v_fim);
  INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, zapi_message_id, direcao, tipo, status, texto, origem, recebido_em, created_at)
  VALUES (v_c6, v_inst, 'ENSAIO-AG-6A', 'saida', 'texto', 'enviada', 'Oi, aqui é a equipe', 'humano', now(), v_fim + interval '30 seconds');
  INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, zapi_message_id, direcao, tipo, status, texto, origem, recebido_em, created_at)
  VALUES (v_c6, v_inst, 'ENSAIO-AG-6B', 'entrada', 'texto', 'recebida', 'qual o horario?', 'humano', now(), v_fim + interval '1 minute') RETURNING id INTO v_m;
  IF public.triagem_dono_da_conversa(v_c6) IS NOT DISTINCT FROM 'agente' THEN RAISE EXCEPTION 'FALHOU 13: com gente na conversa o agente não é dono'; END IF;
  v_j := public.agente_registrar(v_c6, v_m, jsonb_build_object('acao', 'escolher', 'resposta_id', v_hor, 'versao', v_hor_v));
  IF v_j ->> 'motivo' IS DISTINCT FROM 'humano_na_conversa' OR v_j ->> 'tipo' IS DISTINCT FROM 'barrado'
     OR (SELECT count(*) FROM public.whatsapp_fila_envio WHERE conversa_id = v_c6) <> 0 THEN RAISE EXCEPTION 'FALHOU 13: %', v_j; END IF;
  v_s := public.agente_conferir_envio(v_c6, v_hor, v_hor_v);
  IF v_s ->> 'humano' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'FALHOU 13: conferir_envio não viu a equipe: %', v_s; END IF;
  v_r := array_append(v_r, '13) equipe respondeu na conversa: o agente não é dono, o registro vira barrado/humano_na_conversa, nada na fila, e conferir_envio diz humano');

  -- 14) PARAR: o contato pede para parar. Bloqueio por hash, evento barrado, nada é enviado; depois disso tudo é barrado
  INSERT INTO public.whatsapp_conversas (instancia_id, telefone, chat_lid) VALUES (v_inst, '5596999990007', '99999999990007@lid') RETURNING id INTO v_c7;
  INSERT INTO public.whatsapp_triagens (conversa_id, modo, status, concluida_em, atualizado_em) VALUES (v_c7, 'real', 'concluida', v_fim, v_fim);
  INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, zapi_message_id, direcao, tipo, status, texto, origem, recebido_em, created_at)
  VALUES (v_c7, v_inst, 'ENSAIO-AG-7A', 'entrada', 'texto', 'recebida', 'pare de me mandar mensagem', 'humano', now(), v_fim + interval '1 minute') RETURNING id INTO v_m;
  v_j := public.agente_registrar(v_c7, v_m, jsonb_build_object('acao', 'parar', 'motivo', 'parar'));
  IF v_j ->> 'bloqueio' IS DISTINCT FROM 'gravado' OR NOT public._triagem_bloqueado(v_c7) OR v_j ->> 'enviado' IS DISTINCT FROM 'false'
     OR (SELECT count(*) FROM public.whatsapp_automacao_bloqueios WHERE conversa_id = v_c7 AND motivo = 'parar' AND origem = 'agente') <> 1 THEN
    RAISE EXCEPTION 'FALHOU 14: %', v_j; END IF;
  INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, zapi_message_id, direcao, tipo, status, texto, origem, recebido_em, created_at)
  VALUES (v_c7, v_inst, 'ENSAIO-AG-7B', 'entrada', 'texto', 'recebida', 'qual o horario?', 'humano', now(), v_fim + interval '2 minutes') RETURNING id INTO v_m2;
  v_j := public.agente_registrar(v_c7, v_m2, jsonb_build_object('acao', 'escolher', 'resposta_id', v_hor, 'versao', v_hor_v));
  IF v_j ->> 'motivo' IS DISTINCT FROM 'bloqueado' OR (SELECT count(*) FROM public.whatsapp_fila_envio WHERE conversa_id = v_c7) <> 0
     OR public.triagem_dono_da_conversa(v_c7) IS NOT DISTINCT FROM 'agente' THEN RAISE EXCEPTION 'FALHOU 14: depois de parar: %', v_j; END IF;
  v_r := array_append(v_r, '14) parar: bloqueio gravado só em hash (origem agente), nenhuma mensagem; a pergunta seguinte é barrada (bloqueado) e o agente deixa de ser dono');

  -- 15) a mensagem que FECHOU a triagem é da triagem; triagem em modo ensaio e triagem anterior ao agente nunca liberam
  INSERT INTO public.whatsapp_conversas (instancia_id, telefone, chat_lid) VALUES (v_inst, '5596999990008', '99999999990008@lid') RETURNING id INTO v_c8;
  INSERT INTO public.whatsapp_triagens (conversa_id, modo, status, concluida_em, atualizado_em) VALUES (v_c8, 'real', 'concluida', v_fim + interval '10 minutes', v_fim + interval '10 minutes');
  INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, zapi_message_id, direcao, tipo, status, texto, origem, recebido_em, created_at)
  VALUES (v_c8, v_inst, 'ENSAIO-AG-8A', 'entrada', 'texto', 'recebida', 'qual o horario?', 'humano', now(), v_fim + interval '1 minute') RETURNING id INTO v_m;
  v_s := public.agente_contexto(v_c8, v_m);
  v_j := public.agente_registrar(v_c8, v_m, jsonb_build_object('acao', 'escolher', 'resposta_id', v_hor, 'versao', v_hor_v));
  IF v_s -> 'mensagem' ->> 'posterior_a_triagem' IS DISTINCT FROM 'false' OR v_j ->> 'motivo' IS DISTINCT FROM 'triagem_nao_liberou' THEN
    RAISE EXCEPTION 'FALHOU 15: mensagem anterior ao fim da triagem: % / %', v_s -> 'mensagem', v_j; END IF;
  INSERT INTO public.whatsapp_conversas (instancia_id, telefone, chat_lid) VALUES (v_inst, '5596999990010', '99999999990010@lid') RETURNING id INTO v_c10;
  INSERT INTO public.whatsapp_triagens (conversa_id, modo, status, concluida_em, atualizado_em)
  VALUES (v_c10, 'real', 'concluida', (SELECT vale_a_partir_de FROM public.agente_config) - interval '1 day', (SELECT vale_a_partir_de FROM public.agente_config) - interval '1 day');
  INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, zapi_message_id, direcao, tipo, status, texto, origem, recebido_em, created_at)
  VALUES (v_c10, v_inst, 'ENSAIO-AG-10A', 'entrada', 'texto', 'recebida', 'qual o horario?', 'humano', now(), v_fim + interval '1 minute') RETURNING id INTO v_m;
  IF public._agente_triagem_liberou(v_c10) OR public.triagem_dono_da_conversa(v_c10) IS NOT DISTINCT FROM 'agente' THEN RAISE EXCEPTION 'FALHOU 15: triagem de antes do agente liberou'; END IF;
  INSERT INTO public.whatsapp_conversas (instancia_id, telefone, chat_lid) VALUES (v_inst, '5596999990009', '99999999990009@lid') RETURNING id INTO v_c11;
  INSERT INTO public.whatsapp_triagens (conversa_id, modo, status, concluida_em, atualizado_em) VALUES (v_c11, 'ensaio', 'ensaio', v_fim, v_fim);
  IF public._agente_triagem_liberou(v_c11) THEN RAISE EXCEPTION 'FALHOU 15: triagem em ensaio liberou'; END IF;
  v_r := array_append(v_r, '15) mensagem anterior ao fim da triagem, triagem de antes do agente ligar e triagem em modo ensaio: o agente não age');

  -- 16) A RESPOSTA QUE PROMETE AVISAR A EQUIPE: sai o texto aprovado E a conversa é entregue (a linha da fila continua pendente para sair)
  INSERT INTO public.whatsapp_conversas (instancia_id, telefone, chat_lid) VALUES (v_inst, '5596999990013', '99999999990013@lid') RETURNING id INTO v_c13;
  INSERT INTO public.whatsapp_triagens (conversa_id, modo, status, concluida_em, atualizado_em) VALUES (v_c13, 'real', 'concluida', v_fim, v_fim);
  INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, zapi_message_id, direcao, tipo, status, texto, origem, recebido_em, created_at)
  VALUES (v_c13, v_inst, 'ENSAIO-AG-13A', 'entrada', 'texto', 'recebida', 'quero falar com uma pessoa', 'humano', now(), v_fim + interval '1 minute') RETURNING id INTO v_m;
  v_j := public.agente_registrar(v_c13, v_m, jsonb_build_object('acao', 'escolher', 'resposta_id', v_eq, 'versao', v_eq_v, 'passar_para_equipe', true));
  IF v_j ->> 'enviado' IS DISTINCT FROM 'true' OR (SELECT texto FROM public.whatsapp_mensagens WHERE conversa_id = v_c13 AND direcao = 'saida') IS DISTINCT FROM v_eq_t
     OR (SELECT count(*) FROM public.agente_eventos WHERE conversa_id = v_c13 AND tipo = 'entregou' AND motivo = 'passou_com_a_resposta') <> 1
     OR public.triagem_dono_da_conversa(v_c13) IS DISTINCT FROM 'ninguem'
     OR (SELECT status FROM public.whatsapp_fila_envio WHERE conversa_id = v_c13) IS DISTINCT FROM 'pendente' THEN
    RAISE EXCEPTION 'FALHOU 16: %', v_j; END IF;
  v_s := public.agente_conferir_envio(v_c13, v_eq, v_eq_v);
  IF v_s ->> 'triagem_liberou' IS DISTINCT FROM 'true' OR v_s ->> 'degrau_permite' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'FALHOU 16: a linha pendente não passaria na conferência: %', v_s; END IF;
  v_r := array_append(v_r, '16) resposta que promete avisar a equipe: o texto aprovado sai (linha pendente que passa em conferir_envio) e a conversa é entregue (passou_com_a_resposta), dono ninguem');

  -- 17) O QUE JÁ EXISTIA NÃO MUDOU: triagem em andamento continua triagem; sem triagem continua assistente
  INSERT INTO public.whatsapp_conversas (instancia_id, telefone, chat_lid) VALUES (v_inst, '5596999990011', '99999999990011@lid') RETURNING id INTO v_c12;
  INSERT INTO public.whatsapp_triagens (conversa_id, modo, status, passo) VALUES (v_c12, 'real', 'ativa', 'nome');
  IF public.triagem_dono_da_conversa(v_c12) IS DISTINCT FROM 'triagem' THEN RAISE EXCEPTION 'FALHOU 17: triagem em andamento: %', public.triagem_dono_da_conversa(v_c12); END IF;
  INSERT INTO public.whatsapp_conversas (instancia_id, telefone, chat_lid) VALUES (v_inst, '5596999990012', '99999999990012@lid') RETURNING id INTO v_c14;
  INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, zapi_message_id, direcao, tipo, status, texto, origem, recebido_em)
  VALUES (v_c14, v_inst, 'ENSAIO-AG-14A', 'entrada', 'texto', 'recebida', 'Oi', 'humano', now());
  IF public.triagem_dono_da_conversa(v_c14) IS DISTINCT FROM 'assistente' THEN RAISE EXCEPTION 'FALHOU 17: sem triagem: %', public.triagem_dono_da_conversa(v_c14); END IF;
  v_r := array_append(v_r, '17) o que já existia: triagem em andamento continua triagem e conversa sem triagem continua assistente');

  -- 18) O RESUMO: contagens por tipo, motivo e tema, e o contador de perguntas sem resposta. Nenhuma frase.
  INSERT INTO public.whatsapp_conversas (instancia_id, telefone, chat_lid) VALUES (v_inst, '5596999990015', '99999999990015@lid') RETURNING id INTO v_c15;
  INSERT INTO public.whatsapp_triagens (conversa_id, modo, status, concluida_em, atualizado_em) VALUES (v_c15, 'real', 'concluida', v_fim, v_fim);
  INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, zapi_message_id, direcao, tipo, status, texto, origem, recebido_em, created_at)
  VALUES (v_c15, v_inst, 'ENSAIO-AG-15A', 'entrada', 'texto', 'recebida', 'frase que a base não conhece xyz', 'humano', now(), v_fim + interval '2 minutes') RETURNING id INTO v_m;
  PERFORM public.agente_registrar(v_c15, v_m, jsonb_build_object('acao', 'entregar', 'motivo', 'sem_resposta'));
  v_s := public.agente_resumo(7);
  IF (v_s ->> 'perguntas_sem_resposta')::integer <> 2 OR (v_s -> 'por_tipo' ->> 'enviado')::integer <> 3
     OR (v_s -> 'por_motivo' ->> 'entregou:teto_de_mensagens')::integer <> 1 OR v_s::text ~* 'banner|xyz|quanto|qual o' THEN RAISE EXCEPTION 'FALHOU 18: %', v_s; END IF;
  v_r := array_append(v_r, format('18) resumo: %s perguntas sem resposta (uma em ensaio), %s enviadas; nenhuma frase do contato aparece', v_s ->> 'perguntas_sem_resposta', v_s -> 'por_tipo' ->> 'enviado'));

  -- 19) O QUE O BANCO NÃO DEIXA: chave de conteúdo no detalhe, evento fora da lista, ACL, escrita direta
  BEGIN
    PERFORM public.agente_evento(v_c1, NULL, 'erro', '{"etapa":"x","frase":"qualquer coisa"}'::jsonb);
    RAISE EXCEPTION 'FALHOU 19: o CHECK aceitou a chave frase';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.agente_evento(v_c1, NULL, 'escolheu', '{}'::jsonb);
    RAISE EXCEPTION 'FALHOU 19: agente_evento aceitou um tipo de decisão';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FALHOU%' THEN RAISE; END IF;
  END;
  SELECT count(*) INTO v_n FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname ~ '^_?agente_'
     AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  IF v_n <> 0 THEN RAISE EXCEPTION 'FALHOU 19: % funções do agente executáveis por anon ou authenticated', v_n; END IF;
  IF has_table_privilege('service_role', 'public.agente_eventos', 'INSERT,UPDATE,DELETE,TRUNCATE')
     OR has_table_privilege('service_role', 'public.agente_config', 'INSERT,UPDATE,DELETE,TRUNCATE')
     OR has_table_privilege('authenticated', 'public.agente_eventos', 'INSERT,UPDATE,DELETE,TRUNCATE') THEN RAISE EXCEPTION 'FALHOU 19: escrita direta nas tabelas'; END IF;
  IF v_ninguem IS NOT NULL THEN
    BEGIN
      PERFORM public.agente_desligar('ensaio', v_ninguem);
      RAISE EXCEPTION 'FALHOU 19: quem não tem permissão desligou o agente';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM LIKE 'FALHOU%' THEN RAISE; END IF;
    END;
  END IF;
  v_r := array_append(v_r, '19) o CHECK recusa chave frase no detalhe; agente_evento só aceita erro e pausado; nenhuma função do agente é executável por anon ou authenticated; ninguém escreve direto nas tabelas; quem não tem permissão não desliga');

  -- 20) FREIO POR ERROS: um erro com o limite em 1 desliga SÓ a configuração e cancela o que está na fila (a linha da prova 16)
  PERFORM public.agente_config_salvar(v_admin, '{"freio_erros_hora":1}'::jsonb);
  v_j := public.agente_evento(v_c1, v_m4, 'erro', '{"etapa":"registrar","codigo":"tempo"}'::jsonb);
  IF v_j ->> 'freio' IS DISTINCT FROM 'true' OR (SELECT estado::text FROM public.agente_config) IS DISTINCT FROM 'desligada'
     OR (SELECT count(*) FROM public.agente_eventos WHERE tipo = 'freio' AND motivo = 'freio_erros_de_leitura') <> 1
     OR (SELECT count(*) FROM public.whatsapp_fila_envio WHERE conversa_id = v_c13 AND status = 'cancelada') <> 1
     OR (SELECT count(*) FROM public.whatsapp_mensagens WHERE conversa_id = v_c13 AND direcao = 'saida') <> 0 THEN
    RAISE EXCEPTION 'FALHOU 20: %', v_j; END IF;
  v_r := array_append(v_r, '20) freio por erros: com o limite em 1, o primeiro erro desliga o agente, grava o evento freio, cancela a linha pendente da fila e apaga a mensagem que nunca saiu');

  -- 21) DESLIGADA DE NOVO: registrar recusa, o dono volta ao de antes, e desligar à mão cancela o pendente
  v_j := public.agente_registrar(v_c15, v_m, jsonb_build_object('acao', 'entregar', 'motivo', 'sem_resposta'));
  IF v_j ->> 'motivo' IS DISTINCT FROM 'desligada' AND v_j ->> 'duplicada' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'FALHOU 21: %', v_j; END IF;
  PERFORM public.agente_config_salvar(v_admin, '{"estado":"ensaio"}'::jsonb);
  PERFORM public.agente_config_salvar(v_admin, '{"estado":"teste"}'::jsonb);
  INSERT INTO public.whatsapp_conversas (instancia_id, telefone, chat_lid) VALUES (v_inst, '5596999990016', '99999999990016@lid') RETURNING id INTO v_c16;
  INSERT INTO public.whatsapp_triagens (conversa_id, modo, status, concluida_em, atualizado_em) VALUES (v_c16, 'real', 'concluida', v_fim, v_fim);
  INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, zapi_message_id, direcao, tipo, status, texto, origem, recebido_em, created_at)
  VALUES (v_c16, v_inst, 'ENSAIO-AG-16A', 'entrada', 'texto', 'recebida', 'qual medida posso pedir?', 'humano', now(), v_fim + interval '3 minutes') RETURNING id INTO v_m7;
  v_j := public.agente_registrar(v_c16, v_m7, jsonb_build_object('acao', 'escolher', 'resposta_id', v_med, 'versao', v_med_v));
  IF v_j ->> 'enviado' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'FALHOU 21: depois de religar uma conversa nova devia poder receber: %', v_j; END IF;
  v_j := public.agente_desligar('ensaio', v_admin);
  IF (v_j ->> 'canceladas_na_fila')::integer <> 1 OR (SELECT estado::text FROM public.agente_config) IS DISTINCT FROM 'desligada'
     OR (SELECT count(*) FROM public.whatsapp_mensagens WHERE conversa_id = v_c16 AND direcao = 'saida') <> 0
     OR (SELECT count(*) FROM public.agente_eventos WHERE tipo = 'freio' AND motivo = 'desligado_a_mao') <> 1 THEN
    RAISE EXCEPTION 'FALHOU 21: desligar: %', v_j; END IF;
  v_r := array_append(v_r, '21) religar um degrau por vez e desligar à mão: cancela a linha pendente, apaga a mensagem que nunca saiu e grava o evento freio (desligado_a_mao)');

  -- 22) A VARREDURA: retenção dos eventos e freio por falhas de envio (conta só depois de desligada_em)
  PERFORM public.agente_config_salvar(v_admin, '{"estado":"ensaio"}'::jsonb);
  INSERT INTO public.agente_eventos (conversa_id, tipo, acao, motivo, criado_em) VALUES (v_c14, 'barrado', 'barrar', 'robo', now() - interval '200 days');
  INSERT INTO public.whatsapp_fila_envio (conversa_id, payload, status, idempotency_key, updated_at) VALUES
    (v_c14, '{"agente":true,"triagem_id":"00000000-0000-4000-8000-000000000001"}'::jsonb, 'falha', 'ensaio-falha-agente-1', now() + interval '1 second'),
    (v_c14, '{"agente":true,"triagem_id":"00000000-0000-4000-8000-000000000001"}'::jsonb, 'falha', 'ensaio-falha-agente-2', now() + interval '1 second'),
    (v_c14, '{"agente":true,"triagem_id":"00000000-0000-4000-8000-000000000001"}'::jsonb, 'falha', 'ensaio-falha-agente-3', now() + interval '1 second');
  v_j := public.agente_varrer();
  IF (v_j ->> 'eventos_apagados')::integer < 1 OR v_j ->> 'freio' IS DISTINCT FROM 'freio_falhas_de_envio'
     OR (SELECT estado::text FROM public.agente_config) IS DISTINCT FROM 'desligada' THEN RAISE EXCEPTION 'FALHOU 22: %', v_j; END IF;
  v_r := array_append(v_r, format('22) agente_varrer: apagou %s evento antigo (retenção) e desligou por 3 falhas de envio (freio_falhas_de_envio)', v_j ->> 'eventos_apagados'));


  -- 23) A RETENÇÃO NÃO APAGA O QUE DECIDE O DONO, O TETO E O PREÇO. Antes: o dono da conversa entregue (prova 10) é ninguem só por causa
  -- do evento entregou. Se a retenção o apagasse, o agente voltaria a ser dono dela. Religa até teste, tira as falhas de mentira da prova 22
  -- (senão o freio desligaria de novo) e volta o relógio dos eventos 200 dias.
  DELETE FROM public.whatsapp_fila_envio WHERE idempotency_key LIKE 'ensaio-falha-agente-%';
  IF (SELECT estado::text FROM public.agente_config) = 'desligada' THEN
    PERFORM public.agente_config_salvar(v_admin, '{"estado":"ensaio"}'::jsonb);
  END IF;
  PERFORM public.agente_config_salvar(v_admin, '{"estado":"teste"}'::jsonb);
  IF public.triagem_dono_da_conversa(v_c3) IS DISTINCT FROM 'ninguem' OR public._agente_cobre(v_c3) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FALHOU 23: partida: o agente cobre a conversa entregue e o dono é ninguem só pelo evento entregou (dono %, cobre %)',
      public.triagem_dono_da_conversa(v_c3), public._agente_cobre(v_c3); END IF;
  UPDATE public.agente_eventos SET criado_em = now() - interval '200 days' WHERE conversa_id IN (v_c1, v_c3);
  INSERT INTO public.agente_eventos (conversa_id, tipo, acao, motivo, criado_em) VALUES (v_c3, 'barrado', 'barrar', 'robo', now() - interval '200 days');
  INSERT INTO public.agente_eventos (conversa_id, tipo, acao, motivo, criado_em) VALUES (v_c1, 'ensaio', 'barrar', 'robo', now() - interval '200 days');
  INSERT INTO public.agente_eventos (tipo, motivo, criado_em) VALUES ('freio', 'desligado_a_mao', now() - interval '200 days');
  SELECT count(*) INTO v_ant FROM public.agente_eventos WHERE conversa_id IN (v_c1, v_c3) AND tipo IN ('entregou', 'enviado', 'escolheu');
  v_j := public.agente_varrer();
  SELECT count(*) INTO v_dep FROM public.agente_eventos WHERE conversa_id IN (v_c1, v_c3) AND tipo IN ('entregou', 'enviado', 'escolheu');
  IF v_ant < 4 OR v_dep IS DISTINCT FROM v_ant THEN RAISE EXCEPTION 'FALHOU 23: a retenção apagou evento que decide dono, teto ou preço (% antes, % depois)', v_ant, v_dep; END IF;
  IF (v_j ->> 'eventos_apagados')::integer < 3
     OR (SELECT count(*) FROM public.agente_eventos WHERE criado_em < now() - interval '100 days' AND tipo NOT IN ('entregou', 'enviado', 'escolheu')) <> 0 THEN
    RAISE EXCEPTION 'FALHOU 23: a retenção devia apagar o resto do rastro antigo (barrado, ensaio, freio): %', v_j; END IF;
  IF public.triagem_dono_da_conversa(v_c3) IS DISTINCT FROM 'ninguem' THEN
    RAISE EXCEPTION 'FALHOU 23: depois da retenção a conversa entregue voltou a ter dono: %', public.triagem_dono_da_conversa(v_c3); END IF;
  v_s := public.agente_contexto(v_c1, v_m5);
  IF (v_s -> 'contagens' ->> 'enviadas')::integer IS DISTINCT FROM 2 OR (v_s -> 'contagens' ->> 'perguntas_de_preco')::integer IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'FALHOU 23: o teto e a pergunta de preço zeraram com a retenção: %', v_s -> 'contagens'; END IF;
  v_r := array_append(v_r, format('23) retenção: %s eventos antigos apagados (barrado, ensaio, freio), mas os %s eventos entregou, enviado e escolheu das conversas ficaram: a conversa entregue continua com dono ninguem, o teto de mensagens (2) e a pergunta de preço (1) não zeraram', v_j ->> 'eventos_apagados', v_dep));

  -- 24) CONVERSA JÁ ENTREGUE: nenhuma decisão nova, mesmo que a mensagem chegue (e que o servidor tenha lido o contexto antes da entrega)
  INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, zapi_message_id, direcao, tipo, status, texto, origem, recebido_em, created_at)
  VALUES (v_c3, v_inst, 'ENSAIO-AG-3B', 'entrada', 'texto', 'recebida', 'qual o horario?', 'humano', now(), v_fim + interval '2 minutes') RETURNING id INTO v_ms;
  SELECT count(*) INTO v_ant FROM public.agente_eventos WHERE conversa_id = v_c3;
  v_j := public.agente_registrar(v_c3, v_ms, jsonb_build_object('acao', 'escolher', 'resposta_id', v_hor, 'versao', v_hor_v));
  IF v_j ->> 'registrado' IS DISTINCT FROM 'false' OR v_j ->> 'motivo' IS DISTINCT FROM 'ja_entregue'
     OR (SELECT count(*) FROM public.agente_eventos WHERE conversa_id = v_c3) <> v_ant
     OR (SELECT count(*) FROM public.whatsapp_fila_envio WHERE conversa_id = v_c3) <> 0 THEN RAISE EXCEPTION 'FALHOU 24: %', v_j; END IF;
  v_r := array_append(v_r, '24) conversa que o agente já entregou: o registro recusa com ja_entregue, nenhum evento novo e nenhuma linha na fila');

  -- 25) SEGUNDA PERGUNTA DE PREÇO, A CONTA É DO BANCO. (a) o servidor manda escolher a resposta de valor SEM a marca de preço, nas duas vezes:
  -- a primeira sai e fica marcada pelo tema; a segunda vai à equipe. (b) a triagem já contou uma pergunta de preço: a primeira do agente já é a segunda.
  INSERT INTO public.whatsapp_conversas (instancia_id, telefone, chat_lid) VALUES (v_inst, '5596999990017', '99999999990017@lid') RETURNING id INTO v_c17;
  INSERT INTO public.whatsapp_triagens (conversa_id, modo, status, concluida_em, atualizado_em) VALUES (v_c17, 'real', 'concluida', v_fim, v_fim);
  INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, zapi_message_id, direcao, tipo, status, texto, origem, recebido_em, created_at)
  VALUES (v_c17, v_inst, 'ENSAIO-AG-17A', 'entrada', 'texto', 'recebida', 'quanto custa?', 'humano', now(), v_fim + interval '1 minute') RETURNING id INTO v_m;
  v_j := public.agente_registrar(v_c17, v_m, jsonb_build_object('acao', 'escolher', 'resposta_id', v_valor, 'versao', v_valor_v));
  IF v_j ->> 'enviado' IS DISTINCT FROM 'true' OR (SELECT count(*) FROM public.agente_eventos WHERE conversa_id = v_c17 AND tipo = 'escolheu' AND sensivel) <> 1 THEN
    RAISE EXCEPTION 'FALHOU 25: a primeira pergunta de preço devia sair e ficar marcada pelo tema: %', v_j; END IF;
  UPDATE public.whatsapp_fila_envio SET status = 'enviada' WHERE conversa_id = v_c17;
  UPDATE public.whatsapp_mensagens SET status = 'enviada' WHERE conversa_id = v_c17 AND direcao = 'saida';
  INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, zapi_message_id, direcao, tipo, status, texto, origem, recebido_em, created_at)
  VALUES (v_c17, v_inst, 'ENSAIO-AG-17B', 'entrada', 'texto', 'recebida', 'e o valor do cartao?', 'humano', now(), v_fim + interval '2 minutes') RETURNING id INTO v_m2;
  v_s := public.agente_contexto(v_c17, v_m2);
  IF (v_s -> 'contagens' ->> 'perguntas_de_preco')::integer IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'FALHOU 25: contagem da primeira: %', v_s -> 'contagens'; END IF;
  v_j := public.agente_registrar(v_c17, v_m2, jsonb_build_object('acao', 'escolher', 'resposta_id', v_valor, 'versao', v_valor_v));
  IF v_j ->> 'acao' IS DISTINCT FROM 'entregar' OR v_j ->> 'motivo' IS DISTINCT FROM 'preco_de_novo' OR v_j ->> 'enviado' IS DISTINCT FROM 'false'
     OR (SELECT count(*) FROM public.whatsapp_mensagens WHERE conversa_id = v_c17 AND direcao = 'saida') <> 1
     OR (SELECT count(*) FROM public.agente_eventos WHERE conversa_id = v_c17 AND tipo = 'entregou' AND motivo = 'preco_de_novo' AND sensivel) <> 1 THEN
    RAISE EXCEPTION 'FALHOU 25: a segunda pergunta de preço devia ir à equipe: %', v_j; END IF;
  INSERT INTO public.whatsapp_conversas (instancia_id, telefone, chat_lid) VALUES (v_inst, '5596999990018', '99999999990018@lid') RETURNING id INTO v_c18;
  INSERT INTO public.whatsapp_triagens (conversa_id, modo, status, concluida_em, atualizado_em, perguntas_de_preco) VALUES (v_c18, 'real', 'concluida', v_fim, v_fim, 1);
  INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, zapi_message_id, direcao, tipo, status, texto, origem, recebido_em, created_at)
  VALUES (v_c18, v_inst, 'ENSAIO-AG-18A', 'entrada', 'texto', 'recebida', 'quanto custa?', 'humano', now(), v_fim + interval '1 minute') RETURNING id INTO v_m;
  v_s := public.agente_contexto(v_c18, v_m);
  IF (v_s -> 'contagens' ->> 'perguntas_de_preco')::integer IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'FALHOU 25: o contador da triagem não entrou na conta: %', v_s -> 'contagens'; END IF;
  v_j := public.agente_registrar(v_c18, v_m, jsonb_build_object('acao', 'escolher', 'resposta_id', v_valor, 'versao', v_valor_v));
  IF v_j ->> 'motivo' IS DISTINCT FROM 'preco_de_novo' OR (SELECT count(*) FROM public.whatsapp_mensagens WHERE conversa_id = v_c18 AND direcao = 'saida') <> 0 THEN
    RAISE EXCEPTION 'FALHOU 25: com uma pergunta de preço já contada pela triagem a do agente devia ir à equipe: %', v_j; END IF;
  v_r := array_append(v_r, '25) segunda pergunta de preço decidida pelo banco: mesmo sem a marca do servidor, a resposta de valor sai uma vez e a segunda vai à equipe (preco_de_novo); com uma pergunta de preço já contada pela triagem, a primeira do agente já vai à equipe; o evento de ensaio não entra na conta do envio real');

  -- 26) A TRIAGEM ENTREGUE PORQUE O CONTATO PERGUNTOU PREÇO DE NOVO NÃO LIBERA O AGENTE (a casa já respondeu uma vez e decidiu passar)
  INSERT INTO public.whatsapp_conversas (instancia_id, telefone, chat_lid) VALUES (v_inst, '5596999990019', '99999999990019@lid') RETURNING id INTO v_c19;
  INSERT INTO public.whatsapp_triagens (conversa_id, modo, status, motivo_fim, concluida_em, atualizado_em) VALUES (v_c19, 'real', 'entregue_equipe', 'pediu_valor_de_novo', v_fim, v_fim);
  INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, zapi_message_id, direcao, tipo, status, texto, origem, recebido_em, created_at)
  VALUES (v_c19, v_inst, 'ENSAIO-AG-19A', 'entrada', 'texto', 'recebida', 'qual o horario?', 'humano', now(), v_fim + interval '1 minute') RETURNING id INTO v_m;
  v_j := public.agente_registrar(v_c19, v_m, jsonb_build_object('acao', 'escolher', 'resposta_id', v_hor, 'versao', v_hor_v));
  IF public._agente_triagem_liberou(v_c19) OR public.triagem_dono_da_conversa(v_c19) IS NOT DISTINCT FROM 'agente'
     OR v_j ->> 'motivo' IS DISTINCT FROM 'triagem_nao_liberou' OR (SELECT count(*) FROM public.agente_eventos WHERE conversa_id = v_c19) <> 0 THEN
    RAISE EXCEPTION 'FALHOU 26: pediu_valor_de_novo liberou o agente: %', v_j; END IF;
  v_r := array_append(v_r, '26) triagem entregue por pediu_valor_de_novo: não libera o agente (nem dono, nem registro, nenhum evento)');

  -- 27) AVISO JÁ ENVIADO: a chave agente_aviso:<conversa> já existe, então enfileirar_notificacao devolve NULL e o código é ja_enviado
  INSERT INTO public.whatsapp_conversas (instancia_id, telefone, chat_lid) VALUES (v_inst, '5596999990020', '99999999990020@lid') RETURNING id INTO v_c20;
  INSERT INTO public.whatsapp_triagens (conversa_id, modo, status, concluida_em, atualizado_em) VALUES (v_c20, 'real', 'concluida', v_fim, v_fim);
  INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, zapi_message_id, direcao, tipo, status, texto, origem, recebido_em, created_at)
  VALUES (v_c20, v_inst, 'ENSAIO-AG-20A', 'entrada', 'texto', 'recebida', 'frase que a base não conhece abc', 'humano', now(), v_fim + interval '1 minute') RETURNING id INTO v_m;
  IF public.grupo_equipe_destino() IS NULL THEN
    v_r := array_append(v_r, '27) aviso já enviado: PULADA, não há grupo da equipe configurado (o aviso sai como sem_grupo)');
  ELSE
    PERFORM public.enfileirar_notificacao('whatsapp', public.grupo_equipe_destino(), NULL, 'aviso_grupo_equipe', 'whatsapp_atendimento', v_c20,
                                          'aviso_grupo_equipe', '{"texto":"aviso de ensaio"}'::jsonb, 'agente_aviso:' || v_c20);
    SELECT count(*) INTO v_ant FROM public.notificacoes_fila WHERE idempotency_key = 'agente_aviso:' || v_c20;
    v_j := public.agente_registrar(v_c20, v_m, jsonb_build_object('acao', 'entregar', 'motivo', 'sem_resposta'));
    SELECT count(*) INTO v_dep FROM public.notificacoes_fila WHERE idempotency_key = 'agente_aviso:' || v_c20;
    IF v_ant <> 1 OR v_dep <> 1 OR v_j ->> 'aviso' IS DISTINCT FROM 'ja_enviado'
       OR (SELECT detalhe ->> 'aviso' FROM public.agente_eventos WHERE conversa_id = v_c20 AND tipo = 'entregou') IS DISTINCT FROM 'ja_enviado' THEN
      RAISE EXCEPTION 'FALHOU 27: aviso repetido devia dizer ja_enviado e não enfileirar de novo: % (% antes, % depois)', v_j, v_ant, v_dep; END IF;
    v_r := array_append(v_r, '27) aviso repetido para a mesma conversa: o evento diz ja_enviado, nada foi enfileirado de novo (1 linha em notificacoes_fila antes e depois)');
  END IF;

  -- 28) RAJADA: a segunda pergunta chega com a resposta da primeira ainda na fila. Vai à equipe (não é silêncio) e a resposta pendente NÃO sai depois da entrega.
  INSERT INTO public.whatsapp_conversas (instancia_id, telefone, chat_lid) VALUES (v_inst, '5596999990021', '99999999990021@lid') RETURNING id INTO v_c21;
  INSERT INTO public.whatsapp_triagens (conversa_id, modo, status, concluida_em, atualizado_em) VALUES (v_c21, 'real', 'concluida', v_fim, v_fim);
  INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, zapi_message_id, direcao, tipo, status, texto, origem, recebido_em, created_at)
  VALUES (v_c21, v_inst, 'ENSAIO-AG-21A', 'entrada', 'texto', 'recebida', 'qual o horario?', 'humano', now(), v_fim + interval '1 minute') RETURNING id INTO v_m;
  v_j := public.agente_registrar(v_c21, v_m, jsonb_build_object('acao', 'escolher', 'resposta_id', v_hor, 'versao', v_hor_v));
  IF v_j ->> 'enviado' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'FALHOU 28: a primeira devia sair: %', v_j; END IF;
  INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, zapi_message_id, direcao, tipo, status, texto, origem, recebido_em, created_at)
  VALUES (v_c21, v_inst, 'ENSAIO-AG-21B', 'entrada', 'texto', 'recebida', 'e qual a medida?', 'humano', now(), v_fim + interval '2 minutes') RETURNING id INTO v_m2;
  v_j := public.agente_registrar(v_c21, v_m2, jsonb_build_object('acao', 'escolher', 'resposta_id', v_med, 'versao', v_med_v));
  IF v_j ->> 'acao' IS DISTINCT FROM 'entregar' OR v_j ->> 'motivo' IS DISTINCT FROM 'rajada' OR v_j ->> 'enviado' IS DISTINCT FROM 'false'
     OR (SELECT count(*) FROM public.agente_eventos WHERE conversa_id = v_c21 AND tipo = 'entregou' AND motivo = 'rajada') <> 1
     OR (SELECT count(*) FROM public.agente_eventos WHERE conversa_id = v_c21 AND tipo = 'barrado') <> 0
     OR (SELECT count(*) FROM public.whatsapp_fila_envio WHERE conversa_id = v_c21 AND status = 'pendente') <> 0
     OR (SELECT count(*) FROM public.whatsapp_fila_envio WHERE conversa_id = v_c21 AND status = 'cancelada') <> 1
     OR (SELECT count(*) FROM public.whatsapp_mensagens WHERE conversa_id = v_c21 AND direcao = 'saida') <> 0
     OR public.triagem_dono_da_conversa(v_c21) IS DISTINCT FROM 'ninguem' THEN RAISE EXCEPTION 'FALHOU 28: rajada: %', v_j; END IF;
  v_r := array_append(v_r, '28) rajada: a segunda pergunta com a resposta ainda na fila vira entregou/rajada (não é barrado), a resposta pendente é cancelada e apagada, o dono passa a ninguem');

  -- 29) FREIO DE VOLUME: no limite por hora a conversa vai à equipe com o motivo freio_de_volume (não é silêncio)
  PERFORM public.agente_config_salvar(v_admin, '{"max_por_hora":1}'::jsonb);
  INSERT INTO public.whatsapp_conversas (instancia_id, telefone, chat_lid) VALUES (v_inst, '5596999990022', '99999999990022@lid') RETURNING id INTO v_c22;
  INSERT INTO public.whatsapp_triagens (conversa_id, modo, status, concluida_em, atualizado_em) VALUES (v_c22, 'real', 'concluida', v_fim, v_fim);
  INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, zapi_message_id, direcao, tipo, status, texto, origem, recebido_em, created_at)
  VALUES (v_c22, v_inst, 'ENSAIO-AG-22A', 'entrada', 'texto', 'recebida', 'qual o horario?', 'humano', now(), v_fim + interval '1 minute') RETURNING id INTO v_m;
  v_j := public.agente_registrar(v_c22, v_m, jsonb_build_object('acao', 'escolher', 'resposta_id', v_hor, 'versao', v_hor_v));
  IF v_j ->> 'acao' IS DISTINCT FROM 'entregar' OR v_j ->> 'motivo' IS DISTINCT FROM 'freio_de_volume' OR v_j ->> 'enviado' IS DISTINCT FROM 'false'
     OR (SELECT count(*) FROM public.agente_eventos WHERE conversa_id = v_c22 AND tipo = 'entregou' AND motivo = 'freio_de_volume') <> 1
     OR (SELECT count(*) FROM public.whatsapp_mensagens WHERE conversa_id = v_c22 AND direcao = 'saida') <> 0 THEN RAISE EXCEPTION 'FALHOU 29: freio de volume: %', v_j; END IF;
  PERFORM public.agente_config_salvar(v_admin, '{"max_por_hora":20}'::jsonb);
  v_r := array_append(v_r, '29) freio de volume (limite por hora em 1): entregou/freio_de_volume, nenhuma mensagem ao contato; limite devolvido a 20');

  -- 30) PARAR COM RESPOSTA NA FILA: o pedido de parar cancela o que o agente ainda tinha pendente nesta conversa
  INSERT INTO public.whatsapp_conversas (instancia_id, telefone, chat_lid) VALUES (v_inst, '5596999990023', '99999999990023@lid') RETURNING id INTO v_c23;
  INSERT INTO public.whatsapp_triagens (conversa_id, modo, status, concluida_em, atualizado_em) VALUES (v_c23, 'real', 'concluida', v_fim, v_fim);
  INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, zapi_message_id, direcao, tipo, status, texto, origem, recebido_em, created_at)
  VALUES (v_c23, v_inst, 'ENSAIO-AG-23A', 'entrada', 'texto', 'recebida', 'qual o horario?', 'humano', now(), v_fim + interval '1 minute') RETURNING id INTO v_m;
  v_j := public.agente_registrar(v_c23, v_m, jsonb_build_object('acao', 'escolher', 'resposta_id', v_hor, 'versao', v_hor_v));
  IF v_j ->> 'enviado' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'FALHOU 30: a resposta devia sair: %', v_j; END IF;
  INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, zapi_message_id, direcao, tipo, status, texto, origem, recebido_em, created_at)
  VALUES (v_c23, v_inst, 'ENSAIO-AG-23B', 'entrada', 'texto', 'recebida', 'pare de me mandar mensagem', 'humano', now(), v_fim + interval '2 minutes') RETURNING id INTO v_m2;
  v_j := public.agente_registrar(v_c23, v_m2, jsonb_build_object('acao', 'parar', 'motivo', 'parar'));
  IF v_j ->> 'bloqueio' IS DISTINCT FROM 'gravado' OR NOT public._triagem_bloqueado(v_c23)
     OR (SELECT count(*) FROM public.whatsapp_fila_envio WHERE conversa_id = v_c23 AND status = 'pendente') <> 0
     OR (SELECT count(*) FROM public.whatsapp_fila_envio WHERE conversa_id = v_c23 AND status = 'cancelada') <> 1
     OR (SELECT count(*) FROM public.whatsapp_mensagens WHERE conversa_id = v_c23 AND direcao = 'saida') <> 0 THEN RAISE EXCEPTION 'FALHOU 30: parar: %', v_j; END IF;
  v_r := array_append(v_r, '30) parar com a resposta ainda na fila: bloqueio gravado e a resposta pendente cancelada e apagada');

  -- 31) CONFERIR ENVIO CONFERE A RESPOSTA: a linha da fila leva resposta_id e versao; arquivada, de outra versão, sem os dois valores ou
  -- com produto deixa de passar. A linha desta prova sai pelo mesmo caminho da prova 5.
  INSERT INTO public.whatsapp_conversas (instancia_id, telefone, chat_lid) VALUES (v_inst, '5596999990024', '99999999990024@lid') RETURNING id INTO v_c24;
  INSERT INTO public.whatsapp_triagens (conversa_id, modo, status, concluida_em, atualizado_em) VALUES (v_c24, 'real', 'concluida', v_fim, v_fim);
  INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, zapi_message_id, direcao, tipo, status, texto, origem, recebido_em, created_at)
  VALUES (v_c24, v_inst, 'ENSAIO-AG-24A', 'entrada', 'texto', 'recebida', 'qual medida posso pedir?', 'humano', now(), v_fim + interval '1 minute') RETURNING id INTO v_m;
  v_j := public.agente_registrar(v_c24, v_m, jsonb_build_object('acao', 'escolher', 'resposta_id', v_med, 'versao', v_med_v));
  SELECT f.payload INTO v_lin FROM public.whatsapp_fila_envio f WHERE f.conversa_id = v_c24;
  v_s := public.agente_conferir_envio(v_c24, (v_lin.payload ->> 'resposta_id')::uuid, (v_lin.payload ->> 'versao')::integer);
  IF v_s ->> 'resposta_aprovada' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'FALHOU 31: a resposta aprovada devia passar: %', v_s; END IF;
  v_s := public.agente_conferir_envio(v_c24, v_med, v_med_v + 1);
  IF v_s ->> 'resposta_aprovada' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'FALHOU 31: outra versão devia reprovar: %', v_s; END IF;
  v_s := public.agente_conferir_envio(v_c24, NULL, NULL);
  IF v_s ->> 'resposta_aprovada' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'FALHOU 31: linha sem resposta e versão devia reprovar: %', v_s; END IF;
  v_x := NULL;
  BEGIN
    UPDATE public.agente_base_respostas SET status = 'arquivada' WHERE id = v_med;
  EXCEPTION WHEN OTHERS THEN
    v_x := SQLSTATE;
  END;
  IF v_x IS NULL THEN
    v_s := public.agente_conferir_envio(v_c24, v_med, v_med_v);
    IF v_s ->> 'resposta_aprovada' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'FALHOU 31: resposta arquivada devia reprovar: %', v_s; END IF;
  END IF;
  v_r := array_append(v_r, '31) conferir_envio com resposta e versao: a resposta aprovada passa; outra versão e linha sem os dois valores não passam'
    || CASE WHEN v_x IS NULL THEN ', nem a resposta arquivada' ELSE ' (a parte da resposta arquivada ficou PULADA: o banco recusou o UPDATE, ' || v_x || ')' END
    || ' (o consumidor cancela com resposta_mudou)');

  -- 32) RESPOSTA COM PRODUTO NUNCA SAI. Se a linha ainda estiver aprovada com produto, o registro entrega com resposta_mudou. No banco vivo
  -- o gatilho da base devolve a resposta a rascunho assim que o produto muda; aí a prova diz PULADA em vez de passar sem provar, e a guarda
  -- fica coberta pelo ensaio local (sem esse gatilho) e pelos testes.
  SELECT id INTO v_ms FROM public.produtos LIMIT 1;
  v_x := NULL;
  IF v_ms IS NULL THEN
    v_x := 'não há produto cadastrado';
  ELSE
    BEGIN
      UPDATE public.agente_base_respostas SET produto_id = v_ms WHERE id = v_hor;
    EXCEPTION WHEN OTHERS THEN
      v_x := 'o banco recusou ligar a resposta a um produto (' || SQLSTATE || ')';
    END;
    IF v_x IS NULL AND (SELECT status::text FROM public.agente_base_respostas WHERE id = v_hor) <> 'aprovada' THEN
      v_x := 'o gatilho da base devolveu a resposta a rascunho ao mudar o produto';
    END IF;
  END IF;
  IF v_x IS NOT NULL THEN
    v_r := array_append(v_r, '32) resposta com produto: PULADA, ' || v_x);
  ELSE
    INSERT INTO public.whatsapp_conversas (instancia_id, telefone, chat_lid) VALUES (v_inst, '5596999990014', '99999999990014@lid') RETURNING id INTO v_c9;
    INSERT INTO public.whatsapp_triagens (conversa_id, modo, status, concluida_em, atualizado_em) VALUES (v_c9, 'real', 'concluida', v_fim, v_fim);
    INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, zapi_message_id, direcao, tipo, status, texto, origem, recebido_em, created_at)
    VALUES (v_c9, v_inst, 'ENSAIO-AG-9A', 'entrada', 'texto', 'recebida', 'qual o horario?', 'humano', now(), v_fim + interval '1 minute') RETURNING id INTO v_m;
    v_j := public.agente_registrar(v_c9, v_m, jsonb_build_object('acao', 'escolher', 'resposta_id', v_hor, 'versao', v_hor_v));
    IF v_j ->> 'acao' IS DISTINCT FROM 'entregar' OR v_j ->> 'motivo' IS DISTINCT FROM 'resposta_mudou'
       OR (SELECT count(*) FROM public.whatsapp_mensagens WHERE conversa_id = v_c9 AND direcao = 'saida') <> 0 THEN
      RAISE EXCEPTION 'FALHOU 32: resposta com produto: %', v_j; END IF;
    v_r := array_append(v_r, '32) resposta aprovada com produto: o registro entrega com resposta_mudou e nenhuma mensagem');
  END IF;

  RAISE EXCEPTION E'ENSAIO PASSOU (33 provas, de 0 a 32). Nada ficou: este erro desfaz tudo.\n%', array_to_string(v_r, E'\n');
END $ensaio$;
```

Saída esperada (a mensagem do erro final, como rodou no local):

```
ENSAIO PASSOU (33 provas, de 0 a 32). Nada ficou: este erro desfaz tudo.
0) quatro respostas aprovadas dentro da transação (valor, horário, falar com a equipe, medida)
1) desligada (nascença): contexto sem base, registro recusa, zero evento, dono continua ninguem (agente_apos_triagem desligada)
2) escada: pular degrau recusado; o gestor não muda o estado, o aviso ao grupo, o atraso nem a guarda do rastro (a recusa vem em frase de tela), mas salva os mesmos valores; vale_a_partir_de preenchido
3) ensaio: escolher e entregar gravam só o evento ensaio (com a marca de pergunta de preço); zero mensagem, zero fila, zero aviso; a mesma mensagem não decide duas vezes; ensaio não é dono
4) teste: agente dono só do número de teste; o outro continua ninguem e o registro recusa com fora_do_degrau
5) envio real: texto igual ao aprovado (o texto mandado de fora foi ignorado), origem automacao, marca agente e triagem_id na fila, chave triagem:<id>:agente:<entrada>, resposta_id e versao no payload da fila, aguardando_desde e modo intactos, eventos escolheu e enviado
6) mesma mensagem: duplicada, uma linha só na fila; contagens de envio, de fila e de pergunta de preço corretas (no envio real o evento de ensaio não conta)
7) conferir_envio: estado teste, triagem libera, degrau permite, sem humano, sem bloqueio; o número fora do teste não passa
8) teto de 2 mensagens: a terceira vira entregou/teto_de_mensagens, aviso ao grupo: enfileirado (1 linha em notificacoes_fila, sem nome nem telefone), e o dono passa a ninguem
9) agente_apos_triagem ligada: conversa que o agente entregou segue ninguem; a que o degrau não cobre vai para a assistente de texto livre (o dono não deve ligar a chave)
10) segunda pergunta de preço: entregou/preco_de_novo, nenhuma mensagem ao contato, dono vira ninguem; triagem entregue por texto_livre liberou o agente
11) triagem entregue por pediu_equipe: o agente não é dono, o registro recusa (triagem_nao_liberou) e nada é gravado
12) versão que o servidor viu diferente da do banco: entregou/resposta_mudou e nenhuma mensagem
13) equipe respondeu na conversa: o agente não é dono, o registro vira barrado/humano_na_conversa, nada na fila, e conferir_envio diz humano
14) parar: bloqueio gravado só em hash (origem agente), nenhuma mensagem; a pergunta seguinte é barrada (bloqueado) e o agente deixa de ser dono
15) mensagem anterior ao fim da triagem, triagem de antes do agente ligar e triagem em modo ensaio: o agente não age
16) resposta que promete avisar a equipe: o texto aprovado sai (linha pendente que passa em conferir_envio) e a conversa é entregue (passou_com_a_resposta), dono ninguem
17) o que já existia: triagem em andamento continua triagem e conversa sem triagem continua assistente
18) resumo: 2 perguntas sem resposta (uma em ensaio), 3 enviadas; nenhuma frase do contato aparece
19) o CHECK recusa chave frase no detalhe; agente_evento só aceita erro e pausado; nenhuma função do agente é executável por anon ou authenticated; ninguém escreve direto nas tabelas; quem não tem permissão não desliga
20) freio por erros: com o limite em 1, o primeiro erro desliga o agente, grava o evento freio, cancela a linha pendente da fila e apaga a mensagem que nunca saiu
21) religar um degrau por vez e desligar à mão: cancela a linha pendente, apaga a mensagem que nunca saiu e grava o evento freio (desligado_a_mao)
22) agente_varrer: apagou 1 evento antigo (retenção) e desligou por 3 falhas de envio (freio_falhas_de_envio)
23) retenção: 6 eventos antigos apagados (barrado, ensaio, freio), mas os 6 eventos entregou, enviado e escolheu das conversas ficaram: a conversa entregue continua com dono ninguem, o teto de mensagens (2) e a pergunta de preço (1) não zeraram
24) conversa que o agente já entregou: o registro recusa com ja_entregue, nenhum evento novo e nenhuma linha na fila
25) segunda pergunta de preço decidida pelo banco: mesmo sem a marca do servidor, a resposta de valor sai uma vez e a segunda vai à equipe (preco_de_novo); com uma pergunta de preço já contada pela triagem, a primeira do agente já vai à equipe; o evento de ensaio não entra na conta do envio real
26) triagem entregue por pediu_valor_de_novo: não libera o agente (nem dono, nem registro, nenhum evento)
27) aviso repetido para a mesma conversa: o evento diz ja_enviado, nada foi enfileirado de novo (1 linha em notificacoes_fila antes e depois)
28) rajada: a segunda pergunta com a resposta ainda na fila vira entregou/rajada (não é barrado), a resposta pendente é cancelada e apagada, o dono passa a ninguem
29) freio de volume (limite por hora em 1): entregou/freio_de_volume, nenhuma mensagem ao contato; limite devolvido a 20
30) parar com a resposta ainda na fila: bloqueio gravado e a resposta pendente cancelada e apagada
31) conferir_envio com resposta e versao: a resposta aprovada passa; outra versão e linha sem os dois valores não passam, nem a resposta arquivada (o consumidor cancela com resposta_mudou)
32) resposta aprovada com produto: o registro entrega com resposta_mudou e nenhuma mensagem
```

## 4. DEPOIS do ensaio: nada ficou

```sql
-- Esperado: eventos 0, conversas_do_ensaio 0, aprovadas_do_ensaio 0 (ou o número que o dono já tinha aprovado antes), estado desligada,
-- desligada_em vazio, aviso_do_ensaio 0, bloqueio_do_ensaio 0, fila_do_ensaio 0.
SELECT (SELECT count(*) FROM public.agente_eventos) AS eventos,
       (SELECT count(*) FROM public.whatsapp_conversas WHERE telefone LIKE '55969999900%') AS conversas_do_ensaio,
       (SELECT count(*) FROM public.agente_base_respostas WHERE status = 'aprovada') AS aprovadas_do_ensaio,
       (SELECT estado FROM public.agente_config) AS estado,
       (SELECT desligada_em FROM public.agente_config) AS desligada_em,
       (SELECT count(*) FROM public.notificacoes_fila WHERE idempotency_key LIKE 'agente_aviso:%') AS aviso_do_ensaio,
       (SELECT count(*) FROM public.whatsapp_automacao_bloqueios WHERE origem = 'agente') AS bloqueio_do_ensaio,
       (SELECT count(*) FROM public.whatsapp_fila_envio WHERE payload ? 'agente' OR idempotency_key LIKE 'ensaio-falha-agente-%') AS fila_do_ensaio;
```

## 5. Voltar atrás, se for preciso

### 5.0 Se a C4 (métricas) já foi aplicada: PRIMEIRO as views

As quatro views `agente_metricas_*` leem `agente_eventos`, e o bloco da C3 abaixo não usa `CASCADE`: com as views no lugar, o `DROP TABLE public.agente_eventos` pararia no meio. Por isso o bloco da C3 recusa rodar enquanto existir alguma view `agente_metricas_*`, e o bloco da C4 vem ANTES. É o mesmo bloco da seção 8.5. As views só leem: derrubá-las não apaga dado nenhum. Se a C4 nunca foi aplicada, pule para o bloco da C3.

```sql
-- Rode com pouco movimento. Desiste em 2 s se o catálogo estiver preso por outra sessão, e então nada mudou.
BEGIN;
SET LOCAL lock_timeout = '2s';
DO $volta$
DECLARE v_n integer;
BEGIN
  -- as views só leem: derrubá-las não apaga dado nenhum. Sem CASCADE de propósito: se algo depender delas, o DROP para e diz o quê.
  DROP VIEW public.agente_metricas_dia;
  DROP VIEW public.agente_metricas_motivos_30_dias;
  DROP VIEW public.agente_metricas_respostas;
  DROP VIEW public.agente_metricas_sem_resposta_dia;
  SELECT count(*) INTO v_n FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname LIKE 'agente\_metricas\_%';
  IF v_n <> 0 THEN RAISE EXCEPTION 'sobrou objeto agente_metricas_*: %', v_n; END IF;
  -- o rastro e a base continuam intactos
  IF to_regclass('public.agente_eventos') IS NULL OR to_regclass('public.agente_base_respostas') IS NULL THEN
    RAISE EXCEPTION 'as tabelas do agente sumiram: nada foi desfeito';
  END IF;
END $volta$;
COMMIT;
```

### 5.1 O bloco da C3

Antes: desligue o agente (`SELECT public.agente_desligar('voltando atrás', '<id do admin>');`, que cancela o que está na fila) e espere a fila do agente esvaziar. O bloco abaixo recusa rodar com o agente ligado ou com linha do agente na fila. Os eventos não guardam dado pessoal; se quiser guardá-los antes de derrubar, exporte `SELECT * FROM public.agente_eventos` (só códigos e contagens).

Ordem do bloco: PRIMEIRO o dono da conversa volta ao corpo da B4 (o corpo novo cita `agente_eventos` e `_agente_cobre`), DEPOIS caem as tabelas e as funções, e a conferência final desfaz tudo se algo sobrou ou se o corpo do dono não voltou ao md5 `4632f793e72ba4d6d4b824fffcec6b5a` com a ACL de antes. Rodado no Postgres local com as duas migrações aplicadas: o bloco da C3 recusou rodar com as views no lugar, o bloco da C4 derrubou as quatro views, o bloco da C3 devolveu o md5 do dono e derrubou tudo, e as duas migrações aplicaram de novo em seguida.

```sql
-- Rode com pouco movimento. Desiste em 2 s se alguma tabela estiver presa por outra sessão, e então nada mudou.
BEGIN;
SET LOCAL lock_timeout = '2s';
DO $volta$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname LIKE 'agente\_metricas\_%') THEN
    RAISE EXCEPTION 'As views da C4 ainda existem: rode antes o bloco da seção 5.0 (DROP VIEW das quatro views), senão as tabelas do agente não caem.';
  END IF;
  IF (SELECT estado::text FROM public.agente_config) <> 'desligada' THEN
    RAISE EXCEPTION 'O agente não está desligado: use agente_desligar antes (ele cancela o que está na fila) e rode de novo.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.whatsapp_fila_envio WHERE payload ? 'agente' AND status IN ('pendente', 'enviando')) THEN
    RAISE EXCEPTION 'Há linha do agente na fila de envio: espere sair ou cancele antes de voltar atrás.';
  END IF;
END $volta$;

-- 1. PRIMEIRO o dono da conversa volta ao corpo da B4 (o corpo novo cita agente_eventos e _agente_cobre, que vão embora abaixo).
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

-- 2. O rastro e a configuração (as tabelas levam os gatilhos e as políticas junto)
DROP TABLE public.agente_eventos;
DROP TABLE public.agente_config;
-- 3. As funções do agente
DROP FUNCTION public.agente_contexto(uuid, uuid);
DROP FUNCTION public.agente_registrar(uuid, uuid, jsonb);
DROP FUNCTION public.agente_evento(uuid, uuid, text, jsonb);
DROP FUNCTION public.agente_conferir_envio(uuid, uuid, integer);
DROP FUNCTION public.agente_config_salvar(uuid, jsonb);
DROP FUNCTION public.agente_desligar(text, uuid);
DROP FUNCTION public.agente_varrer();
DROP FUNCTION public.agente_resumo(integer);
DROP FUNCTION public._agente_cobre(uuid);
DROP FUNCTION public._agente_triagem_liberou(uuid);
DROP FUNCTION public._agente_degrau_permite(uuid);
DROP FUNCTION public._agente_cancelar_pendentes(uuid);
DROP FUNCTION public._agente_desligar_config(text, uuid);
DROP FUNCTION public._agente_avisar_equipe(uuid, uuid, text, boolean);
DROP FUNCTION public._agente_config_antes_gravar();

DO $confere$
BEGIN
  IF to_regclass('public.agente_config') IS NOT NULL OR to_regclass('public.agente_eventos') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace
                  AND proname IN ('agente_contexto', 'agente_registrar', 'agente_evento', 'agente_conferir_envio', 'agente_config_salvar',
                                  'agente_desligar', 'agente_varrer', 'agente_resumo', '_agente_cobre', '_agente_triagem_liberou',
                                  '_agente_degrau_permite', '_agente_cancelar_pendentes', '_agente_desligar_config', '_agente_avisar_equipe',
                                  '_agente_config_antes_gravar')) THEN
    RAISE EXCEPTION 'sobrou algo do agente: nada foi desfeito';
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.triagem_dono_da_conversa(uuid)'::regprocedure) <> '4632f793e72ba4d6d4b824fffcec6b5a' THEN
    RAISE EXCEPTION 'o dono da conversa não voltou ao corpo da B4: nada foi desfeito';
  END IF;
  IF has_function_privilege('anon', 'public.triagem_dono_da_conversa(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.triagem_dono_da_conversa(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.triagem_dono_da_conversa(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'a ACL do dono da conversa mudou: nada foi desfeito';
  END IF;
END $confere$;
COMMIT;
```

### 5.2 Conferência final

```sql
-- Esperado: 0 tabelas, 0 funções, dono com o md5 4632f793e72ba4d6d4b824fffcec6b5a.
SELECT (SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('agente_config', 'agente_eventos')) AS tabelas,
       (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname ~ '^_?agente_' AND proname !~ '^agente_resposta_'
          AND proname NOT IN ('_agente_frases_ok', '_agente_problemas_de_texto', '_agente_base_antes_gravar', '_agente_base_historico', '_agente_base_sem_apagar', '_agente_base_uma_por_vez')) AS funcoes,
       (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.triagem_dono_da_conversa(uuid)'::regprocedure) AS md5_do_dono;
```

## 6. Ligar não faz parte deste PR (e como operar sem tela)

A tela `/configuracoes-agente` (etapa C4, seção 8) sobe, desce e desliga o agente; o que segue é o mesmo caminho por SQL, para quem prefere ou para conferir. Ordem sugerida, um degrau por vez, SÓ depois de aplicar a migração, publicar o código e aprovar as respostas da base (tela `/configuracoes-agente-base`):

1. `SELECT public.agente_config_salvar('<id do admin>', '{"estado":"ensaio"}');` e deixar dias. Medir com `SELECT public.agente_resumo(7);` e ler os eventos `ensaio`: quantas perguntas a base entenderia, quantas iriam à equipe e por quê, quantas sem resposta (o contador que diz que resposta falta escrever), e se alguma conversa de robô de empresa apareceria (`barrado` com motivo `robo`).
2. `... '{"estado":"teste","numeros_teste":["96999990001"]}'`, mandar mensagens do número de teste depois de a triagem terminar, e conferir a mensagem recebida palavra por palavra com o texto aprovado.
3. `... '{"estado":"parcial","percentual":10}'` e só depois `ligada`.
4. Para parar: `SELECT public.agente_desligar('motivo', '<id>');` (desliga e cancela o que está na fila). Descer um degrau (`agente_config_salvar` com o estado de baixo) também é livre.

Deixe `whatsapp_triagem_config.agente_apos_triagem` em `false`. A tela e o servidor não deixam o agente SUBIR de degrau enquanto essa chave estiver ligada, e dizem isso em palavras (descer e Desligar tudo continuam livres). Em parcial a porcentagem vai só até 50: o servidor recusa mais que isso, e a tela pede confirmação para AUMENTAR a porcentagem em parcial. Para todos os contatos, o dono sobe para ligada. Antes de aprovar as respostas, leia a seção 9: o conferidor de texto é uma última porta parcial, e a garantia real é o dono ler cada resposta.

## 7. O que este diff NÃO resolve

1. **Este diff (C3) não traz tela nem função de servidor de configuração.** A etapa C4 traz a tela `/configuracoes-agente` e as métricas (seção 8). A tela da base (`/configuracoes-agente-base`) continua sendo onde o dono aprova as respostas.
2. **Produto e família da conversa não são conhecidos.** O motor aceita produto e família, mas o agente não os extrai da conversa: só resposta geral (sem produto) ou de família sem família conhecida serve. Resposta amarrada a produto nunca é escolhida enquanto não houver essa leitura.
3. **Um contato por vez, uma mensagem por vez.** Não há tratamento de rajada: se o contato manda duas perguntas seguidas e a primeira resposta ainda está na fila, a segunda vai à equipe (`entregou`, motivo `rajada`, com aviso ao grupo) e a resposta pendente é cancelada, em vez de o agente responder duas vezes. Também não há leitura de mensagens anteriores: o agente responde só à mensagem que chegou.
4. **Duas perguntas na mesma mensagem recebem UMA resposta** (a de preço se houver pergunta de preço, senão a de frase maior). Uma pergunta com assunto que a base trata em duas respostas de força diferente recebe a mais forte.
5. **O casamento é por frase gatilho**, o que torna algumas frases curtas largas ("valor", "preço", "horário" sozinhas casam qualquer mensagem que as contenha como palavra). A pergunta de preço é tratada à parte e só recebe a resposta de preço.
6. **O aviso ao grupo da equipe nasce da entrega, não de uma varredura.** Se `enfileirar_notificacao` falhar o evento diz `falhou` e nada refaz o aviso. Sem grupo da equipe o evento diz `sem_grupo`.
7. **Eventos de erro de leitura do banco sobre a própria tabela do agente** não têm onde ser gravados (se a tabela não existe, o rastro também falha): o servidor só escreve `console.error` com o código.
8. **As respostas aprovadas viajam do banco ao servidor a cada mensagem de conversa que o agente pode atender.** São poucas dezenas de linhas de texto aprovado (sem preço); se a base crescer para centenas, vale cachear no servidor.
9. **A premissa da saída `automacao` e do consumidor da fila** (não zerar `aguardando_desde`, chave `triagem:` liberada) é conferida por leitura de função e provada no ensaio, mas se alguém mexer em `_wa_mensagem_antes_inserir` ou no consumidor depois, só o ensaio acusa.
10. **Mensagem do agente na caixa:** a caixa mostra como saída automática, sem o selo de triagem da B9 (o selo lê a marca `triagem` do payload, e a do agente é `agente`).
11. **Pendências da triagem que continuam:** resposta pelo `chat_lid`, tempos e freios na tela, idade máxima da mensagem na fila, página de privacidade, equipe devolve o ramo ao cliente. Nenhuma foi mexida.

### 7.1 Revisão adversarial de 14/11/2026: o que mudou, item por item

Uma revisão independente achou defeitos nas migrações C3 e C4 e na tela. Cada correção tem prova que falharia antes (seção 3, provas 23 a 32, e os testes em `tests/agente/`).

**SQL da C3.** (1) A retenção não apaga mais os eventos `entregou`, `enviado` e `escolheu` de conversa (prova 23). (2) `agente_registrar` recusa conversa já entregue (`ja_entregue`, prova 24); marca como pergunta de preço toda escolha da resposta de valor; entrega com `preco_de_novo` pela conta do banco, com o contador da triagem junto (prova 25); entrega com `resposta_mudou` a resposta que tenha produto (prova 32); e toda entrega cancela o que o agente tinha pendente na conversa (prova 28). (3) `agente_contexto` soma `whatsapp_triagens.perguntas_de_preco` e conta só eventos reais no envio real; `pediu_valor_de_novo` deixou de liberar o agente (prova 26). (4) `avisar_grupo`, `retencao_eventos_dias`, `atraso_min_s` e `atraso_max_s` exigem `whatsapp.manage` (prova 2). (5) O aviso ao grupo usa o retorno de `enfileirar_notificacao`: NULL vira `ja_enviado`, nunca `enfileirado` (prova 27). (6) Rajada e freio de volume entregam à equipe, com os motivos `rajada` e `freio_de_volume` (provas 28 e 29). (7) A linha da fila leva `resposta_id` e `versao`, e `agente_conferir_envio(conversa, resposta_id, versao)` devolve `resposta_aprovada`; o consumidor cancela com `resposta_mudou` (prova 31). O pedido de parar também cancela o pendente (prova 30).

**SQL da C4.** (9) As quatro views revogam TUDO do `service_role` antes do `GRANT SELECT`: o default do Supabase concede `arwdDxtm` a ele em objeto novo. A conferência da migração e o ensaio da seção 8.3 provam, por `has_table_privilege` e pela ACL de cada view, que o servidor só lê, e que o INSERT como `service_role` falha. O Postgres local foi montado com o `ALTER DEFAULT PRIVILEGES` do Supabase (tudo para `anon`, `authenticated` e `service_role`) e a migração passou; sem o `service_role` no REVOKE a conferência para com "a view agente_metricas_dia aceita escrita".

**TypeScript e tela.** (10) O pedido de parar é lido antes de teto, freio, rajada e robô. (11) Gente na conversa ou contato bloqueado, fora do dono: silêncio sem chamar `agente_registrar` e sem evento, exceto no ensaio. (12) Subir de degrau é bloqueado, na tela e no servidor, com a chave `agente_apos_triagem` ligada; o servidor recusa porcentagem acima de 50 em parcial; a tela pede confirmação para aumentar a porcentagem em parcial, o campo da porcentagem acompanha o painel quando ele recarrega, e o erro de qualquer botão do painel também recarrega. (13) `falhou()` só deixa passar a frase do banco sem parênteses nem sublinhado; as frases da migração e do servidor foram reescritas com acento e sem parênteses ("O agente só sobe um degrau de cada vez, na ordem."). (14) O selo, a lista de motivos e as métricas dizem "escolheu uma resposta e colocou na fila" e "escolhida" (o evento `enviado` marca a fila, não a entrega), o selo não manda mais ao "motivo nas métricas", o simulador não mostra o "Código do motivo" e limpa o resultado quando a base recarrega.

**Validador de texto.** Migração nova `20261115120000_agente_validador_mais_firme.sql` e seção 9.

**O que a revisão NÃO mudou, de propósito.** Nada foi aplicado no banco vivo, nenhuma migração foi commitada nem teve PR aberto; `meta.reviewer` e as regras de aviso de dinheiro ficaram como estavam; a palavra do mercado que o dono não usa não aparece em texto novo.

## 8. A migração das métricas (C4): `20261115110000_agente_metricas.sql`

Migração ainda NÃO aplicada. **Só views e GRANTs**: nenhuma tabela, função, gatilho, coluna ou dado muda. Depende da migração C3 deste mesmo roteiro (as tabelas `agente_eventos` e `agente_config`), da base de respostas (`agente_base_respostas`, C2) e de `public.hoje_br()` (relógio de Macapá); a migração para sozinha, com a lista do que falta, se algum deles não existir. **Ordem: aplique a C3, depois esta, e só então publique o código** (a tela `/configuracoes-agente` lê estas views: com a migração ausente ela diz "as métricas ainda não foram instaladas" em vez de mostrar zero).

### O que muda em produção ao aplicar

- **Nada que um contato ou a equipe perceba.** Quatro views novas, `security_invoker`, com `SELECT` só para o `service_role` (anon, authenticated, PUBLIC E o próprio `service_role` revogados pelo nome antes do `GRANT SELECT`: o default do Supabase concede todos os privilégios ao `service_role` em objeto novo, view inclusive, e o servidor só precisa ler). O navegador nunca lê estas views: o servidor confere a permissão (`configuracoes.manage` ou `whatsapp.manage`) e lê com a chave de serviço. Motivo: a RLS das tabelas aceita as duas permissões, mas uma leitura pelo navegador que falha para um perfil e vale para outro mostraria zero, e zero se lê como "sem dados".
- **O que cada view conta** (a tela repete o denominador de cada taxa e nunca mistura real com ensaio, que é a coluna `modo`):
  - `agente_metricas_dia`: por dia (Macapá), modo e ramo, as DECISÕES (evento com `mensagem_id`): `decisoes`, `escolhidas`, `entregues`, `barradas` (o silêncio) e `sensiveis` (as de pergunta de preço). A saída na fila (`enviado`), o erro, o freio e a entrega sem mensagem NÃO são decisão. Perguntas = escolhidas mais entregues; cobertura = escolhidas sobre perguntas.
  - `agente_metricas_motivos_30_dias`: por modo, ramo, ação e motivo, nos últimos 30 dias. Inclui `passou_com_a_resposta` (a resposta aprovada saiu E a conversa foi à equipe), que não tem `mensagem_id`; por isso a tela usa os motivos como base própria.
  - `agente_metricas_respostas`: UMA linha por resposta não arquivada da base, inclusive as nunca usadas (é o que torna "nunca usada" visível), com uso real e em ensaio nos últimos 30 dias, total guardado e último uso.
  - `agente_metricas_sem_resposta_dia`: quantas perguntas foram entregues por motivo `sem_resposta`, por dia, modo e ramo. **Só a contagem**: a frase do contato nunca foi guardada.
- **Nenhuma coluna identifica conversa, mensagem ou pessoa** (`conversa_id`, `mensagem_id`, `saida_id`, nome, telefone, CEP, texto, frase, pergunta), e nenhuma tem nome de dinheiro: a conferência da migração olha isso nas colunas das quatro views. A "pergunta de preço" chama-se `sensiveis`, como a coluna do evento.
- **Sem trava em tabela quente.** `CREATE VIEW` só mexe no catálogo; a migração abre com `lock_timeout` de 5 s por hábito e para inteira se o catálogo estiver preso. Nenhum `UPDATE` nem `DELETE`, nenhum `ALTER TABLE`, nenhum valor de enum, nenhuma coluna nova em tabela com GRANT por coluna.
- **A migração só cria.** Se qualquer uma das quatro views já existir, ela para com "Já existe: ..." em vez de trocar a definição de uma view que a tela já lê. Ela também confere que o `service_role` lê `agente_eventos` e `agente_base_respostas`: sem isso a view devolveria erro de permissão ao servidor.
- **Retenção.** O rastro é apagado por `agente_varrer` depois de `agente_config.retencao_eventos_dias` (90 por padrão), menos os eventos `entregou`, `enviado` e `escolheu` de conversa, que ficam (decidem o dono, o teto e a pergunta de preço). Por isso o uso REAL de uma resposta não some com o tempo; o uso em ensaio, o silêncio e os erros somem. "Nunca usada" quer dizer nunca usada nos registros guardados; "total guardado" idem. A tela diz isso.
- **Limite conhecido do ensaio do agente.** No degrau de ensaio o evento `ensaio` guarda a ação (escolheria, entregaria, silêncio) e o motivo, mas não guarda o "responderia e entregaria junto" (`passar_para_equipe` fica no detalhe do evento, que estas views não leem). No real esse caso aparece como o motivo `passou_com_a_resposta`.

## 8.0 ANTES de aplicar

```sql
-- 8.0.1 O estado de partida. Esperado: tabelas do agente 3 (config, eventos, base), views agente_metricas_* 0, hoje_br existe, e o service_role lê as duas tabelas
-- de baixo. Se "tabelas do agente" der menos de 3, aplique antes a C3 (seção 1) e a base de respostas.
SELECT 'tabelas do agente' AS item, count(*)::text AS valor FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('agente_config', 'agente_eventos', 'agente_base_respostas')
UNION ALL SELECT 'views agente_metricas_*', count(*)::text FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname LIKE 'agente\_metricas\_%'
UNION ALL SELECT 'hoje_br existe', (to_regprocedure('public.hoje_br()') IS NOT NULL)::text
UNION ALL SELECT 'service_role lê agente_eventos', has_table_privilege('service_role', 'public.agente_eventos', 'SELECT')::text
UNION ALL SELECT 'service_role lê agente_base_respostas', has_table_privilege('service_role', 'public.agente_base_respostas', 'SELECT')::text
UNION ALL SELECT 'eventos do agente guardados', count(*)::text FROM public.agente_eventos
ORDER BY 1;
```

```sql
-- 8.0.2 O que a tela vai mostrar de partida. Esperado: aprovadas e não arquivadas são números que você reconhece (a tela diz "N de 15 aprovadas" por ramo).
SELECT status::text AS status, count(*) AS respostas FROM public.agente_base_respostas GROUP BY 1 ORDER BY 1;
```

## 8.1 Aplicar

Aplique `supabase/migrations/20261115110000_agente_metricas.sql` inteiro. Ele abre com `BEGIN;` e `SET LOCAL lock_timeout = '5s'`, fecha com `COMMIT;` e termina com uma conferência que desfaz tudo se algo estiver fora do esperado: número de views diferente de 4, view que não ficou `security_invoker`, aberta para anon, authenticated ou PUBLIC, sem leitura para o `service_role`, que tenha qualquer privilégio de escrita (ou de referência e gatilho) para o `service_role`, anon, authenticated ou PUBLIC, com ACL além do `SELECT` do servidor, coluna que identifica conversa ou pessoa ou com nome de dinheiro, coluna que a tela lê e não existe, função ou tabela nova com o nome das métricas, e qualquer view que dê erro ao ser lida.

## 8.2 DEPOIS: estrutura

```sql
-- 8.2.1 As quatro views: security_invoker, ACL e escrita. Esperado: 4 linhas, invoker true, anon_le false, auth_le false, publico_le false, servico_le true, escreve false
-- e acl_alem_do_select 0 (nenhum privilégio de ninguém além do dono e do SELECT do service_role).
SELECT c.relname, coalesce(c.reloptions @> ARRAY['security_invoker=true'], false) AS invoker,
       has_table_privilege('anon', c.oid, 'SELECT') AS anon_le,
       has_table_privilege('authenticated', c.oid, 'SELECT') AS auth_le,
       has_table_privilege('public', c.oid, 'SELECT') AS publico_le,
       has_table_privilege('service_role', c.oid, 'SELECT') AS servico_le,
       has_table_privilege('service_role', c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS escreve,
       (SELECT count(*) FROM aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
         WHERE a.grantee <> c.relowner AND a.grantee::regrole::text <> 'sandbox_exec' AND NOT (a.grantee = 'service_role'::regrole AND a.privilege_type = 'SELECT')) AS acl_alem_do_select
FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relname LIKE 'agente\_metricas\_%' ORDER BY 1;
```

```sql
-- 8.2.2 As colunas, que são o contrato com o servidor (src/lib/api/agente-escolhe.functions.ts). Esperado:
--   agente_metricas_dia                dia, modo, ramo, decisoes, escolhidas, entregues, barradas, sensiveis
--   agente_metricas_motivos_30_dias    modo, ramo, acao, motivo, n
--   agente_metricas_respostas          resposta_id, tema, status, versao, usos_real_30_dias, usos_ensaio_30_dias, usos_total, ultimo_uso
--   agente_metricas_sem_resposta_dia   dia, modo, ramo, perguntas_sem_resposta
SELECT table_name, string_agg(column_name, ', ' ORDER BY ordinal_position) AS colunas
FROM information_schema.columns WHERE table_schema = 'public' AND table_name LIKE 'agente\_metricas\_%' GROUP BY 1 ORDER BY 1;
```

```sql
-- 8.2.3 Nenhuma coluna de conversa, mensagem ou pessoa, nem de dinheiro. Esperado: 0 linhas.
SELECT table_name, column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name LIKE 'agente\_metricas\_%'
  AND (column_name ~ '^(nome|texto|text|mensagem|conteudo|body|telefone|phone|cep|endereco|email|frase|pergunta|resposta|detalhe|conversa_id|mensagem_id|saida_id|chat_lid|lid)$'
       OR column_name ~ 'preco|valor|custo|desconto|orcamento');
```

```sql
-- 8.2.4 O que as views dizem agora. Com o agente desligado e a C3 recém-aplicada: dias 0, motivos 0, sem_resposta 0, e uma linha por resposta não arquivada
-- da base, todas com usos_total 0 (é isto que a tela mostra como "nunca usada"). Com o agente já em ensaio, os três primeiros números passam de zero.
SELECT (SELECT count(*) FROM public.agente_metricas_dia) AS dias,
       (SELECT count(*) FROM public.agente_metricas_motivos_30_dias) AS motivos,
       (SELECT count(*) FROM public.agente_metricas_sem_resposta_dia) AS sem_resposta,
       (SELECT count(*) FROM public.agente_metricas_respostas) AS respostas_na_view,
       (SELECT count(*) FROM public.agente_base_respostas WHERE status::text <> 'arquivada') AS respostas_nao_arquivadas,
       (SELECT count(*) FROM public.agente_metricas_respostas WHERE usos_total = 0) AS nunca_usadas;
```

## 8.3 ENSAIO: as métricas contra eventos de mentira

**Antes de rodar, três avisos.** (1) O ensaio escreve de verdade, mas só 4 conversas fictícias (telefones `55969999901NN`) e 23 eventos do agente, e termina em `RAISE EXCEPTION`, que desfaz TUDO. (2) Ele abre com `SET LOCAL lock_timeout = '2s'` e repete o ajuste por dentro (`set_config`): se alguma tabela que ele precisa estiver presa por outra sessão, desiste em 2 segundos e desfaz tudo; rode de novo com menos movimento. (3) Ele NÃO cria, altera nem apaga tabela, view, função ou gatilho (nenhum `CREATE`, `ALTER`, `DROP` ou `TRUNCATE`): só `INSERT`. Ele conta SÓ a diferença que causa (lê as views antes e depois), então vale também com eventos de verdade já gravados. Ele para com `FALHOU` se não achar as quatro views, uma instância de WhatsApp, uma resposta não arquivada dos temas `valor_do_produto` e `horario_de_atendimento`, ou se quem roda não puder trocar para os papéis `service_role`, `anon` e `authenticated` (a prova 7 troca de papel, e sem essa checagem a recusa de trocar pareceria a recusa da view).

**Rodado em 14/11/2026 num Postgres 17 local** com o esquema reduzido (a tabela `agente_eventos` copiada da migração C3 com todos os CHECK, `agente_base_respostas`, `whatsapp_conversas`, os três papéis e `hoje_br`) e a migração aplicada: a conferência passou, o ensaio passou inteiro (8 provas) e, depois do erro final, as views estavam vazias. **O esquema local foi montado com o `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role`, que é o que o Supabase faz**, para provar que a migração passa nesse cenário; sem o `service_role` no REVOKE (mutação) a conferência da migração parou com "a view agente_metricas_dia aceita escrita ou outro privilégio além da leitura para o servidor". As quatro views têm GROUP BY, então o INSERT falha por isso MESMO se o privilégio existisse: a prova do privilégio é `has_table_privilege` e a lista de acesso, e o INSERT só confirma que nada passa. Duas mutações provaram que o ensaio acusa: uma view que passa a contar a saída na fila faz o ensaio parar com `FALHOU na medida 1: o ensaio devia somar 9, somou 13`; aplicar a migração duas vezes para com "Já existe". NÃO foi rodado no banco vivo: lá, quem aplica confere. **Diferença conhecida do local para o vivo:** lá a tabela do agente tem a RLS da C3 e `agente_base_respostas` tem os GRANTs da C2; o ensaio roda como dono, que contorna a RLS, e a prova 7 troca para `service_role` (que contorna a RLS), `anon` e `authenticated`.

```sql
-- Rode com pouco movimento. Se alguma tabela ou linha que o ensaio precisa estiver presa por outra sessão, desiste em 2 s e desfaz tudo; repita depois.
SET LOCAL lock_timeout = '2s';
DO $ensaio$
DECLARE
  v_inst uuid := (SELECT id FROM public.whatsapp_instancias LIMIT 1);
  v_hoje date := public.hoje_br();
  v_cc uuid; v_cp uuid; v_ce uuid; v_co uuid;
  v_valor uuid := (SELECT id FROM public.agente_base_respostas WHERE tema = 'valor_do_produto' AND status::text <> 'arquivada' LIMIT 1);
  v_hor uuid := (SELECT id FROM public.agente_base_respostas WHERE tema = 'horario_de_atendimento' AND status::text <> 'arquivada' LIMIT 1);
  v_q text;
  v_antes bigint[]; v_depois bigint[];
  v_esperado CONSTANT bigint[] := ARRAY[
    9, 3, 3, 3, 2,        -- 1 a 5: real, cliente, hoje: decisoes, escolhidas, entregues, barradas, sensiveis
    2, 4, 2,              -- 6 a 8: decisoes real parceiro hoje, ensaio cliente hoje, real cliente 45 dias atrás
    2, 1, 1, 2, 1,        -- 9 a 13: motivos real cliente: sem_resposta, preco_de_novo, passou_com_a_resposta, cortesia, parar
    1,                    -- 14: motivos ensaio cliente: sem_resposta
    3, 4, 2, 1, 3,        -- 15 a 19: respostas: valor real 30 dias, valor total, horario ensaio 30 dias, horario real 30 dias, horario total
    2, 1, 1, 1,           -- 20 a 23: sem resposta hoje real cliente, real parceiro, ensaio cliente, real cliente 45 dias atrás
    0];                   -- 24: resposta arquivada na view
  i integer;
  v_r text[] := '{}';
  v_n integer;
BEGIN
  PERFORM set_config('lock_timeout', '2s', true);
  IF v_inst IS NULL THEN RAISE EXCEPTION 'FALHOU: não há instância de WhatsApp para o ensaio'; END IF;
  IF v_valor IS NULL OR v_hor IS NULL THEN
    RAISE EXCEPTION 'FALHOU: preciso de uma resposta não arquivada dos temas valor_do_produto e horario_de_atendimento (base da C2)';
  END IF;
  -- a prova 7 troca de papel; se quem roda não puder, a recusa de trocar pareceria a recusa da view e a prova passaria sem provar
  IF NOT (pg_has_role(current_user, 'service_role', 'MEMBER') AND pg_has_role(current_user, 'anon', 'MEMBER') AND pg_has_role(current_user, 'authenticated', 'MEMBER')) THEN
    RAISE EXCEPTION 'FALHOU: quem roda o ensaio precisa poder trocar para os papéis service_role, anon e authenticated (o editor do painel pode)';
  END IF;
  SELECT count(*) INTO v_n FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'v' AND relname LIKE 'agente\_metricas\_%';
  IF v_n <> 4 THEN RAISE EXCEPTION 'FALHOU: esperava 4 views agente_metricas_*, achei %', v_n; END IF;

  -- a régua: as contagens que o ensaio compara. Lê as views como o servidor lê e conta SÓ a diferença que o ensaio causa,
  -- então funciona também com eventos de verdade já gravados (o agente em ensaio ou ligado).
  v_q := format($q$SELECT ARRAY[
    (SELECT coalesce(sum(decisoes),0) FROM public.agente_metricas_dia WHERE dia = public.hoje_br() AND modo = 'real' AND ramo = 'cliente'),
    (SELECT coalesce(sum(escolhidas),0) FROM public.agente_metricas_dia WHERE dia = public.hoje_br() AND modo = 'real' AND ramo = 'cliente'),
    (SELECT coalesce(sum(entregues),0) FROM public.agente_metricas_dia WHERE dia = public.hoje_br() AND modo = 'real' AND ramo = 'cliente'),
    (SELECT coalesce(sum(barradas),0) FROM public.agente_metricas_dia WHERE dia = public.hoje_br() AND modo = 'real' AND ramo = 'cliente'),
    (SELECT coalesce(sum(sensiveis),0) FROM public.agente_metricas_dia WHERE dia = public.hoje_br() AND modo = 'real' AND ramo = 'cliente'),
    (SELECT coalesce(sum(decisoes),0) FROM public.agente_metricas_dia WHERE dia = public.hoje_br() AND modo = 'real' AND ramo = 'parceiro'),
    (SELECT coalesce(sum(decisoes),0) FROM public.agente_metricas_dia WHERE dia = public.hoje_br() AND modo = 'ensaio' AND ramo = 'cliente'),
    (SELECT coalesce(sum(decisoes),0) FROM public.agente_metricas_dia WHERE dia = public.hoje_br() - 45 AND modo = 'real' AND ramo = 'cliente'),
    (SELECT coalesce(sum(n),0) FROM public.agente_metricas_motivos_30_dias WHERE modo = 'real' AND ramo = 'cliente' AND acao = 'entregar' AND motivo = 'sem_resposta'),
    (SELECT coalesce(sum(n),0) FROM public.agente_metricas_motivos_30_dias WHERE modo = 'real' AND ramo = 'cliente' AND acao = 'entregar' AND motivo = 'preco_de_novo'),
    (SELECT coalesce(sum(n),0) FROM public.agente_metricas_motivos_30_dias WHERE modo = 'real' AND ramo = 'cliente' AND acao = 'entregar' AND motivo = 'passou_com_a_resposta'),
    (SELECT coalesce(sum(n),0) FROM public.agente_metricas_motivos_30_dias WHERE modo = 'real' AND ramo = 'cliente' AND acao = 'barrar' AND motivo = 'cortesia'),
    (SELECT coalesce(sum(n),0) FROM public.agente_metricas_motivos_30_dias WHERE modo = 'real' AND ramo = 'cliente' AND acao = 'parar' AND motivo = 'parar'),
    (SELECT coalesce(sum(n),0) FROM public.agente_metricas_motivos_30_dias WHERE modo = 'ensaio' AND ramo = 'cliente' AND acao = 'entregar' AND motivo = 'sem_resposta'),
    (SELECT coalesce(sum(usos_real_30_dias),0) FROM public.agente_metricas_respostas WHERE resposta_id = %1$L),
    (SELECT coalesce(sum(usos_total),0) FROM public.agente_metricas_respostas WHERE resposta_id = %1$L),
    (SELECT coalesce(sum(usos_ensaio_30_dias),0) FROM public.agente_metricas_respostas WHERE resposta_id = %2$L),
    (SELECT coalesce(sum(usos_real_30_dias),0) FROM public.agente_metricas_respostas WHERE resposta_id = %2$L),
    (SELECT coalesce(sum(usos_total),0) FROM public.agente_metricas_respostas WHERE resposta_id = %2$L),
    (SELECT coalesce(sum(perguntas_sem_resposta),0) FROM public.agente_metricas_sem_resposta_dia WHERE dia = public.hoje_br() AND modo = 'real' AND ramo = 'cliente'),
    (SELECT coalesce(sum(perguntas_sem_resposta),0) FROM public.agente_metricas_sem_resposta_dia WHERE dia = public.hoje_br() AND modo = 'real' AND ramo = 'parceiro'),
    (SELECT coalesce(sum(perguntas_sem_resposta),0) FROM public.agente_metricas_sem_resposta_dia WHERE dia = public.hoje_br() AND modo = 'ensaio' AND ramo = 'cliente'),
    (SELECT coalesce(sum(perguntas_sem_resposta),0) FROM public.agente_metricas_sem_resposta_dia WHERE dia = public.hoje_br() - 45 AND modo = 'real' AND ramo = 'cliente'),
    (SELECT count(*) FROM public.agente_metricas_respostas m JOIN public.agente_base_respostas b ON b.id = m.resposta_id WHERE b.status::text = 'arquivada')
  ]::bigint[]$q$, v_valor::text, v_hor::text);
  EXECUTE v_q INTO v_antes;

  -- quatro conversas fictícias (telefones 55969999901NN); os eventos apontam para elas por chave estrangeira
  INSERT INTO public.whatsapp_conversas (instancia_id, telefone, chat_lid) VALUES (v_inst, '5596999990101', '99999999990101@lid') RETURNING id INTO v_cc;
  INSERT INTO public.whatsapp_conversas (instancia_id, telefone, chat_lid) VALUES (v_inst, '5596999990102', '99999999990102@lid') RETURNING id INTO v_cp;
  INSERT INTO public.whatsapp_conversas (instancia_id, telefone, chat_lid) VALUES (v_inst, '5596999990103', '99999999990103@lid') RETURNING id INTO v_ce;
  INSERT INTO public.whatsapp_conversas (instancia_id, telefone, chat_lid) VALUES (v_inst, '5596999990104', '99999999990104@lid') RETURNING id INTO v_co;

  -- REAL, cliente final, hoje: 3 escolhidas (1 era pergunta de preço), 3 entregues, 3 em silêncio, 3 saídas na fila (não são decisão)
  INSERT INTO public.agente_eventos (conversa_id, mensagem_id, tipo, acao, codigo, resposta_id, versao, ramo, sensivel) VALUES
    (v_cc, gen_random_uuid(), 'escolheu', 'escolher', 'valor_do_produto', v_valor, 1, 'cliente', true),
    (v_cc, gen_random_uuid(), 'escolheu', 'escolher', 'valor_do_produto', v_valor, 1, 'cliente', false),
    (v_cc, gen_random_uuid(), 'escolheu', 'escolher', 'valor_do_produto', v_valor, 1, 'cliente', false);
  INSERT INTO public.agente_eventos (conversa_id, mensagem_id, saida_id, tipo, codigo, resposta_id, versao, ramo, sensivel) VALUES
    (v_cc, gen_random_uuid(), gen_random_uuid(), 'enviado', 'valor_do_produto', v_valor, 1, 'cliente', false),
    (v_cc, gen_random_uuid(), gen_random_uuid(), 'enviado', 'valor_do_produto', v_valor, 1, 'cliente', false),
    (v_cc, gen_random_uuid(), gen_random_uuid(), 'enviado', 'valor_do_produto', v_valor, 1, 'cliente', false);
  INSERT INTO public.agente_eventos (conversa_id, mensagem_id, tipo, acao, motivo, ramo, sensivel) VALUES
    (v_cc, gen_random_uuid(), 'entregou', 'entregar', 'sem_resposta', 'cliente', false),
    (v_cc, gen_random_uuid(), 'entregou', 'entregar', 'sem_resposta', 'cliente', false),
    (v_cc, gen_random_uuid(), 'entregou', 'entregar', 'preco_de_novo', 'cliente', true),
    (v_cc, gen_random_uuid(), 'barrado', 'barrar', 'cortesia', 'cliente', false),
    (v_cc, gen_random_uuid(), 'barrado', 'barrar', 'cortesia', 'cliente', false),
    (v_cc, gen_random_uuid(), 'barrado', 'parar', 'parar', 'cliente', false);
  -- a conversa entregue junto com a resposta (sem mensagem_id), um erro e um freio: nada disto é decisão
  INSERT INTO public.agente_eventos (conversa_id, tipo, acao, motivo, ramo) VALUES (v_cc, 'entregou', 'entregar', 'passou_com_a_resposta', 'cliente');
  INSERT INTO public.agente_eventos (tipo, motivo, detalhe) VALUES ('erro', 'ensaio_de_metricas', '{"etapa":"lerContexto"}'::jsonb);
  INSERT INTO public.agente_eventos (tipo, motivo, detalhe) VALUES ('freio', 'ensaio_de_metricas', '{}'::jsonb);
  -- REAL, parceiro, hoje: 1 escolhida e 1 entregue sem resposta
  INSERT INTO public.agente_eventos (conversa_id, mensagem_id, tipo, acao, codigo, resposta_id, versao, ramo) VALUES
    (v_cp, gen_random_uuid(), 'escolheu', 'escolher', 'horario_de_atendimento', v_hor, 1, 'parceiro');
  INSERT INTO public.agente_eventos (conversa_id, mensagem_id, tipo, acao, motivo, ramo) VALUES
    (v_cp, gen_random_uuid(), 'entregou', 'entregar', 'sem_resposta', 'parceiro');
  -- ENSAIO, cliente final, hoje: 2 escolheria, 1 entregaria sem resposta, 1 silêncio
  INSERT INTO public.agente_eventos (conversa_id, mensagem_id, tipo, acao, codigo, resposta_id, versao, ramo) VALUES
    (v_ce, gen_random_uuid(), 'ensaio', 'escolher', 'horario_de_atendimento', v_hor, 1, 'cliente'),
    (v_ce, gen_random_uuid(), 'ensaio', 'escolher', 'horario_de_atendimento', v_hor, 1, 'cliente');
  INSERT INTO public.agente_eventos (conversa_id, mensagem_id, tipo, acao, motivo, ramo) VALUES
    (v_ce, gen_random_uuid(), 'ensaio', 'entregar', 'sem_resposta', 'cliente'),
    (v_ce, gen_random_uuid(), 'ensaio', 'barrar', 'cortesia', 'cliente');
  -- REAL, cliente final, 45 dias atrás: fora da janela de 30 dias (motivos e uso de 30 dias), mas dentro do que o rastro guarda
  INSERT INTO public.agente_eventos (conversa_id, mensagem_id, tipo, acao, codigo, resposta_id, versao, ramo, criado_em) VALUES
    (v_co, gen_random_uuid(), 'escolheu', 'escolher', 'valor_do_produto', v_valor, 1, 'cliente', now() - interval '45 days');
  INSERT INTO public.agente_eventos (conversa_id, mensagem_id, tipo, acao, motivo, ramo, criado_em) VALUES
    (v_co, gen_random_uuid(), 'entregou', 'entregar', 'sem_resposta', 'cliente', now() - interval '45 days');

  EXECUTE v_q INTO v_depois;
  FOR i IN 1..array_length(v_esperado, 1) LOOP
    IF v_depois[i] - v_antes[i] IS DISTINCT FROM v_esperado[i] THEN
      RAISE EXCEPTION 'FALHOU na medida %: o ensaio devia somar %, somou % (antes %, depois %)',
        i, v_esperado[i], v_depois[i] - v_antes[i], v_antes[i], v_depois[i];
    END IF;
  END LOOP;
  v_r := array_append(v_r, '1) por dia, real e ensaio separados: 9 decisões reais (3 escolhidas, 3 entregues, 3 em silêncio, 2 de preço), parceiro à parte, ensaio à parte; saída na fila, erro, freio e entrega sem mensagem NÃO são decisão');
  v_r := array_append(v_r, '2) motivos dos últimos 30 dias: sem resposta 2, segunda pergunta de preço 1, entregue junto com a resposta 1, cortesia 2, parar 1; o evento de 45 dias atrás fica de fora');
  v_r := array_append(v_r, '3) respostas: a de valor tem 3 usos reais em 30 dias e 4 no total guardado; a de horário tem 1 uso real e 2 em ensaio; nenhuma arquivada aparece');
  v_r := array_append(v_r, '4) perguntas sem resposta por dia: só a contagem, separada por modo e ramo');

  -- resposta nunca usada aparece com zero (é o que torna "nunca usada" visível): toda resposta não arquivada tem linha
  SELECT count(*) INTO v_n FROM public.agente_base_respostas WHERE status::text <> 'arquivada';
  IF (SELECT count(*) FROM public.agente_metricas_respostas) IS DISTINCT FROM v_n THEN
    RAISE EXCEPTION 'FALHOU 5: a view de respostas devia ter 1 linha por resposta não arquivada (%), tem %', v_n, (SELECT count(*) FROM public.agente_metricas_respostas);
  END IF;
  v_r := array_append(v_r, format('5) a view de respostas tem uma linha por resposta não arquivada (%s), inclusive as nunca usadas', v_n));

  -- nenhuma coluna identifica conversa, mensagem ou pessoa
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name LIKE 'agente\_metricas\_%'
              AND column_name ~ '^(nome|texto|text|mensagem|conteudo|body|telefone|phone|cep|endereco|email|frase|pergunta|resposta|detalhe|conversa_id|mensagem_id|saida_id|chat_lid|lid)$') THEN
    RAISE EXCEPTION 'FALHOU 6: uma view de métricas expõe coluna de conversa, mensagem ou pessoa';
  END IF;
  v_r := array_append(v_r, '6) nenhuma view tem coluna de conversa, mensagem, nome, telefone, CEP ou texto');

  -- quem lê: o servidor lê (e as tabelas de baixo deixam); anon e authenticated recebem negação, não "vazio"
  SET LOCAL ROLE service_role;
  SELECT count(*) INTO v_n FROM public.agente_metricas_dia;
  SELECT count(*) INTO v_n FROM public.agente_metricas_motivos_30_dias;
  SELECT count(*) INTO v_n FROM public.agente_metricas_respostas;
  SELECT count(*) INTO v_n FROM public.agente_metricas_sem_resposta_dia;
  RESET ROLE;
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM count(*) FROM public.agente_metricas_dia;
    RESET ROLE;
    RAISE EXCEPTION 'FALHOU 7: o anon leu agente_metricas_dia';
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
  END;
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM count(*) FROM public.agente_metricas_respostas;
    RESET ROLE;
    RAISE EXCEPTION 'FALHOU 7: o authenticated leu agente_metricas_respostas';
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
  END;
  v_r := array_append(v_r, '7) o service_role lê as quatro views; anon e authenticated recebem negação de permissão (nunca uma lista vazia)');

  -- 8) O SERVIDOR SÓ LÊ. Nenhuma das quatro views dá escrita ao service_role (o default do Supabase concede tudo, e a migração revoga),
  -- a lista de acesso (ACL) de cada uma só tem o dono e o SELECT do service_role, e o INSERT feito como service_role não passa. As quatro views têm
  -- GROUP BY, então o INSERT falha por isso MESMO se o privilégio existisse: a prova do privilégio é has_table_privilege e a ACL, e o INSERT só confirma.
  FOREACH v_q IN ARRAY ARRAY['agente_metricas_dia', 'agente_metricas_motivos_30_dias', 'agente_metricas_respostas', 'agente_metricas_sem_resposta_dia'] LOOP
    IF has_table_privilege('service_role', 'public.' || v_q, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
      RAISE EXCEPTION 'FALHOU 8: o service_role tem privilégio além da leitura em %', v_q; END IF;
    IF EXISTS (SELECT 1 FROM pg_class c, LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
                WHERE c.oid = ('public.' || v_q)::regclass AND a.grantee <> c.relowner
                  AND a.grantee::regrole::text <> 'sandbox_exec'
                  AND NOT (a.grantee = 'service_role'::regrole AND a.privilege_type = 'SELECT')) THEN
      RAISE EXCEPTION 'FALHOU 8: a lista de acesso de % tem privilégio além do SELECT do servidor', v_q; END IF;
    BEGIN
      SET LOCAL ROLE service_role;
      EXECUTE format('INSERT INTO public.%I SELECT * FROM public.%I LIMIT 0', v_q, v_q);
      RESET ROLE;
      RAISE EXCEPTION 'FALHOU 8: o INSERT em % passou para o service_role', v_q;
    EXCEPTION WHEN insufficient_privilege OR feature_not_supported OR object_not_in_prerequisite_state THEN
      RESET ROLE;
    END;
  END LOOP;
  v_r := array_append(v_r, '8) o service_role só lê: nenhum privilégio de escrita nas quatro views (has_table_privilege e ACL), e o INSERT como service_role falha');

  RAISE EXCEPTION E'ENSAIO PASSOU (8 provas). Nada ficou: este erro desfaz tudo.\n%', array_to_string(v_r, E'\n');
END $ensaio$;
```

Saída esperada (a mensagem do erro final, como rodou no local; o número de respostas na prova 5 é o da sua base):

```
ENSAIO PASSOU (8 provas). Nada ficou: este erro desfaz tudo.
1) por dia, real e ensaio separados: 9 decisões reais (3 escolhidas, 3 entregues, 3 em silêncio, 2 de preço), parceiro à parte, ensaio à parte; saída na fila, erro, freio e entrega sem mensagem NÃO são decisão
2) motivos dos últimos 30 dias: sem resposta 2, segunda pergunta de preço 1, entregue junto com a resposta 1, cortesia 2, parar 1; o evento de 45 dias atrás fica de fora
3) respostas: a de valor tem 3 usos reais em 30 dias e 4 no total guardado; a de horário tem 1 uso real e 2 em ensaio; nenhuma arquivada aparece
4) perguntas sem resposta por dia: só a contagem, separada por modo e ramo
5) a view de respostas tem uma linha por resposta não arquivada (4), inclusive as nunca usadas
6) nenhuma view tem coluna de conversa, mensagem, nome, telefone, CEP ou texto
7) o service_role lê as quatro views; anon e authenticated recebem negação de permissão (nunca uma lista vazia)
8) o service_role só lê: nenhum privilégio de escrita nas quatro views (has_table_privilege e ACL), e o INSERT como service_role falha
```

## 8.4 DEPOIS do ensaio: nada ficou

```sql
-- Esperado: conversas_do_ensaio 0, eventos_do_ensaio 0, e eventos_do_agente igual ao que a seção 8.0.1 mostrou antes (0 com o agente desligado).
SELECT (SELECT count(*) FROM public.whatsapp_conversas WHERE telefone LIKE '55969999901%') AS conversas_do_ensaio,
       (SELECT count(*) FROM public.agente_eventos WHERE motivo = 'ensaio_de_metricas') AS eventos_do_ensaio,
       (SELECT count(*) FROM public.agente_eventos) AS eventos_do_agente;
```

## 8.5 Voltar atrás, se for preciso

As views só leem: derrubá-las não apaga dado nenhum, e a tela passa a dizer "as métricas ainda não foram instaladas" (o painel, a escada e o simulador continuam funcionando). O bloco abaixo recusa sobrar objeto `agente_metricas_*` e confere que as tabelas do agente estão intactas. Sem `CASCADE` de propósito: se alguma coisa depender de uma view, o `DROP` para e diz o quê. Rodado no Postgres local: a volta apagou as quatro views e a migração aplicou de novo em seguida. **É o mesmo bloco da seção 5.0, e ele vem ANTES da volta da C3**: quem volta as duas migrações roda este bloco primeiro, e o bloco da C3 recusa rodar com as views no lugar.

```sql
-- Rode com pouco movimento. Desiste em 2 s se o catálogo estiver preso por outra sessão, e então nada mudou.
BEGIN;
SET LOCAL lock_timeout = '2s';
DO $volta$
DECLARE v_n integer;
BEGIN
  -- as views só leem: derrubá-las não apaga dado nenhum. Sem CASCADE de propósito: se algo depender delas, o DROP para e diz o quê.
  DROP VIEW public.agente_metricas_dia;
  DROP VIEW public.agente_metricas_motivos_30_dias;
  DROP VIEW public.agente_metricas_respostas;
  DROP VIEW public.agente_metricas_sem_resposta_dia;
  SELECT count(*) INTO v_n FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname LIKE 'agente\_metricas\_%';
  IF v_n <> 0 THEN RAISE EXCEPTION 'sobrou objeto agente_metricas_*: %', v_n; END IF;
  -- o rastro e a base continuam intactos
  IF to_regclass('public.agente_eventos') IS NULL OR to_regclass('public.agente_base_respostas') IS NULL THEN
    RAISE EXCEPTION 'as tabelas do agente sumiram: nada foi desfeito';
  END IF;
END $volta$;
COMMIT;
```

```sql
-- Esperado: 0 views agente_metricas_*, e as duas tabelas do agente no lugar.
SELECT (SELECT count(*) FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname LIKE 'agente\_metricas\_%') AS views,
       (to_regclass('public.agente_eventos') IS NOT NULL) AS tem_eventos,
       (to_regclass('public.agente_base_respostas') IS NOT NULL) AS tem_base;
```

## 8.6 O que a C4 NÃO resolve

1. **Nada foi ligado.** O agente continua desligado; a tela só mostra, simula e, para quem tem `whatsapp.manage`, sobe um degrau por vez. Subir é decisão do dono, depois de aprovar as respostas, publicar o código e aplicar as duas migrações.
2. **O ensaio não conta "responderia e entregaria junto"** (seção 8, limite conhecido): no degrau de ensaio esse caso aparece como "responderia", e só no real vira o motivo `passou_com_a_resposta`.
3. **"Nunca usada" vale para o que o rastro guarda.** O uso real (evento `escolheu`) fica; o uso em ensaio é apagado depois de 90 dias por padrão, então uma resposta que só apareceu em ensaio há 100 dias aparece como nunca usada.
4. **A cobertura não distingue o que a base poderia ter coberto do que nunca seria dela**: reclamação, áudio e foto também entram como "entregue à equipe". A tela mostra a volta por motivo logo abaixo, para separar o que falta escrever (`sem_resposta`) do que é da equipe por natureza.
5. **O selo "Agente" mora só no cabeçalho da conversa aberta**, não na lista de conversas, e lê pelo servidor com a permissão `whatsapp.read`.

## 9. O validador de texto mais firme (C3.1): `20261115120000_agente_validador_mais_firme.sql`

Migração ainda NÃO aplicada. Troca UMA função viva, `_agente_problemas_de_texto` (a que a aprovação da C2, o ensaio e o agente da C3 usam para barrar texto), **por troca na definição viva**: a migração lê o corpo vivo, confere o md5 `e7cd527d465584a7d0ff8e470263616d` (o corpo lido em 14/11/2026, igual ao da migração C2), confere que a âncora do fim das regras aparece UMA vez e insere um bloco novo antes dela. Se o corpo vivo for outro, para sem trocar nada. Rodar duas vezes não faz nada na segunda. Não depende da C3 nem da C4; vale antes de o dono aprovar as respostas.

**O validador é uma última porta parcial, e a garantia real é o dono ler cada resposta antes de aprovar.** Ele barra o que alguém já pensou em barrar e não entende frase: uma frase nova que prometa preço ou prazo de um jeito que ninguém previu passa por ele. Só a resposta que o dono leu e aprovou sai, palavra por palavra. A tela de aprovação de respostas diz isso ao dono (no lugar da frase velha "o texto não fala valor, desconto, prazo em número nem forma de pagamento", que prometia mais do que o validador garante), e esta migração não promete pegar tudo.

### O que a migração acrescenta

Todas as regras valem para os dois ramos e rodam sobre o texto sem acento e em minúsculas. Os códigos que as telas já explicam continuam os mesmos; só `taxa_cobrada` é novo.

- `orcamento_feito_pelo_agente`: faço, fazemos, fiz, farei, preparo, preparamos, preparei, passo, passamos, passei, monto, montamos, montei, calculo, calculamos, calculei (e vou, vamos, posso, irei, iremos com fazer, preparar, passar, montar, calcular, enviar, mandar) seguidos de orçamento, valor, preço ou cotação: "Faço o orçamento", "Preparo o orçamento", "te passo o valor", "vou preparar o orçamento". **Não barra o infinitivo solto nem a equipe como sujeito**: "Para a equipe montar o orçamento, me conte o produto" (é uma das 15 respostas semente) e "a equipe faz o orçamento" passam.
- `prazo_prometido`: "sai hoje", "saem amanhã", "no outro dia", "no dia seguinte".
- `condicao_de_preco`: competitivo, competitiva; custa pouco; preço bom, bom preço, preço justo, preço baixo, o melhor preço.
- `taxa_cobrada`: "taxa de" (taxa de entrega, taxa de urgência). "Taxa" sem "de" passa.

O espelho em TypeScript é `src/domain/whatsapp/triagem/verificador.ts`, **só no escopo completo** (agente e assistentes de texto livre): o escopo `triagem` (nome digitado, textos montados e editáveis) não ganhou regra nenhuma, e os testes dos 52 nomes e frases da triagem continuam passando. O corpo novo é determinístico: o corpo lido mais o bloco, md5 `92b7101a1208c7c747c2a6f891421494`, que a conferência da migração confere e o teste `tests/agente/validador-mais-firme.test.ts` recalcula.

### 9.0 ANTES de aplicar

```sql
-- Esperado: md5 e7cd527d465584a7d0ff8e470263616d (o corpo da C2), a função com ACL só do service_role, as 15 respostas semente da C2 (ou o que o dono já escreveu)
-- e o que for rascunho ou aprovado passando no validador de hoje. Se o md5 for outro, NÃO aplique: alguém mexeu na função depois de 14/11/2026.
SELECT 'md5 do corpo vivo' AS item, md5(prosrc) AS valor FROM pg_proc WHERE oid = 'public._agente_problemas_de_texto(text, public.triagem_ramo[])'::regprocedure
UNION ALL SELECT 'ACL: anon/authenticated executam', (has_function_privilege('anon', 'public._agente_problemas_de_texto(text, public.triagem_ramo[])', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public._agente_problemas_de_texto(text, public.triagem_ramo[])', 'EXECUTE'))::text
UNION ALL SELECT 'respostas não arquivadas', count(*)::text FROM public.agente_base_respostas WHERE status::text <> 'arquivada'
UNION ALL SELECT 'respostas não arquivadas com problema hoje', count(*)::text FROM public.agente_base_respostas
   WHERE status::text <> 'arquivada' AND cardinality(public._agente_problemas_de_texto(resposta, ramos)) > 0
ORDER BY 1;
```

### 9.1 Aplicar

Aplique o arquivo inteiro. Abre com `BEGIN;` e `SET LOCAL lock_timeout = '5s'`, fecha com `COMMIT;` e termina com uma conferência que desfaz tudo se: o corpo vivo não tem o md5 lido, a âncora não aparece uma vez, o bloco novo não entrou, o md5 do corpo novo não é o do ensaio, a ACL ou o `search_path` mudaram, alguma frase nova passa sem ser barrada, alguma frase que a casa pode dizer é barrada, ou qualquer resposta não arquivada (as 15 sementes e as que o dono escreveu) passaria a ter problema. Esta última é de propósito: se o dono já escreveu uma resposta com "preço bom", a migração para e mostra o tema, para ele reescrever antes de aplicar.

### 9.2 DEPOIS: estrutura

```sql
-- Esperado: md5 92b7101a1208c7c747c2a6f891421494, ACL intacta (anon e authenticated false), bloco C3.1 presente, uma só versão da função.
SELECT md5(prosrc) AS md5_do_corpo, position('-- C3.1: validador mais firme' IN prosrc) > 0 AS tem_o_bloco,
       has_function_privilege('anon', oid, 'EXECUTE') AS anon_executa, has_function_privilege('authenticated', oid, 'EXECUTE') AS auth_executa,
       has_function_privilege('service_role', oid, 'EXECUTE') AS servico_executa, proconfig::text AS config, prosecdef AS definer,
       (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = '_agente_problemas_de_texto') AS versoes
FROM pg_proc WHERE oid = 'public._agente_problemas_de_texto(text, public.triagem_ramo[])'::regprocedure;
```

### 9.3 ENSAIO: as 15 sementes continuam passando e cada frase nova é barrada

**Só lê.** O bloco roda o validador sobre as respostas que existem e sobre frases, e termina em `RAISE EXCEPTION` por hábito. Prova 1: as 15 respostas semente da C2 (e toda resposta não arquivada, aprovada ou rascunho) passam, nos dois ramos. Prova 2: 24 frases novas são barradas, com o código esperado, no ramo cliente e no ramo parceiro. Prova 3: 10 frases que a casa pode dizer continuam passando, inclusive a semente `como_pedir_orcamento`, que tem "montar o orçamento" no infinitivo. Prova 4: a ACL não mudou.

**Rodado em 14/11/2026 num Postgres 17 local com as funções VIVAS copiadas do banco** (`bex_normalizar_texto`, `_triagem_texto_plano`, `_triagem_problemas_de_texto`, a tabela de termos proibidos com as linhas vivas, e o corpo da C2, que o `md5` confirmou igual ao vivo) e as 15 sementes copiadas do vivo. Antes da migração o ensaio PAROU, como devia: `FALHOU 2: a frase "Faço o orçamento para você." devia ser barrada com orcamento_feito_pelo_agente (cliente {}, parceiro {})`. Depois da migração passou inteiro. A migração rodada duas vezes não fez nada na segunda; com o corpo vivo mexido à mão (um comentário a mais) parou com "O corpo vivo de _agente_problemas_de_texto mudou desde 14/11/2026"; e a volta (9.4) devolveu o md5 `e7cd527d465584a7d0ff8e470263616d` com a ACL intacta e a migração aplicou de novo em seguida.

```sql
-- Só LÊ: roda o validador sobre frases e sobre as respostas que existem. Não escreve nada; termina em RAISE EXCEPTION por hábito.
DO $ensaio$
DECLARE
  v_cli public.triagem_ramo[] := ARRAY['cliente']::public.triagem_ramo[];
  v_par public.triagem_ramo[] := ARRAY['parceiro']::public.triagem_ramo[];
  f record;
  v_x text;
  v_n integer;
  v_r text[] := '{}';
BEGIN
  -- 1) as respostas semente da C2 (e qualquer outra não arquivada) continuam passando, nos dois ramos
  SELECT count(*) INTO v_n FROM public.agente_base_respostas
   WHERE tema IN ('como_pedir_orcamento', 'endereco_da_loja', 'entrega_do_pedido', 'enviar_a_arte', 'exemplos_e_catalogo', 'falar_com_a_equipe',
                  'forma_de_pagamento', 'formato_do_arquivo', 'horario_de_atendimento', 'instalacao', 'item_fora_do_catalogo', 'medida_do_produto',
                  'prazo_do_pedido', 'quantidade_minima', 'valor_do_produto');
  IF v_n <> 15 THEN RAISE EXCEPTION 'FALHOU 1: esperava as 15 respostas semente da C2, achei %', v_n; END IF;
  SELECT string_agg(tema || ' ' || public._agente_problemas_de_texto(resposta, ramos)::text, '; ') INTO v_x FROM public.agente_base_respostas
   WHERE status::text <> 'arquivada' AND cardinality(public._agente_problemas_de_texto(resposta, ramos)) > 0;
  IF v_x IS NOT NULL THEN RAISE EXCEPTION 'FALHOU 1: resposta que existe passou a ter problema: %', v_x; END IF;
  SELECT string_agg(tema, ', ') INTO v_x FROM public.agente_base_respostas
   WHERE status::text = 'aprovada' AND texto_aprovado IS NOT NULL AND cardinality(public._agente_problemas_de_texto(texto_aprovado, ramos)) > 0;
  IF v_x IS NOT NULL THEN RAISE EXCEPTION 'FALHOU 1: resposta aprovada passou a ter problema: %', v_x; END IF;
  v_r := array_append(v_r, '1) as 15 respostas semente da C2 (e toda resposta não arquivada, aprovada ou rascunho) passam, nos dois ramos');

  -- 2) cada frase nova é barrada, com o código esperado, no ramo cliente e no ramo parceiro
  FOR f IN SELECT * FROM (VALUES
      ('Faço o orçamento para você.', 'orcamento_feito_pelo_agente'),
      ('Preparo o orçamento agora mesmo.', 'orcamento_feito_pelo_agente'),
      ('Eu te passo o valor depois.', 'orcamento_feito_pelo_agente'),
      ('Te passo o orçamento ainda hoje.', 'orcamento_feito_pelo_agente'),
      ('Monto o orçamento e te mando.', 'orcamento_feito_pelo_agente'),
      ('Montamos o orçamento para você.', 'orcamento_feito_pelo_agente'),
      ('Calculo o preço para você.', 'orcamento_feito_pelo_agente'),
      ('Faremos o orçamento amanhã.', 'orcamento_feito_pelo_agente'),
      ('Vou preparar o orçamento.', 'orcamento_feito_pelo_agente'),
      ('Posso calcular o valor para você.', 'orcamento_feito_pelo_agente'),
      ('O pedido sai hoje.', 'prazo_prometido'),
      ('Sai hoje mesmo.', 'prazo_prometido'),
      ('Os banners saem amanhã.', 'prazo_prometido'),
      ('Entregamos no outro dia.', 'prazo_prometido'),
      ('Fica pronto no dia seguinte.', 'prazo_prometido'),
      ('Nosso preço é competitivo.', 'condicao_de_preco'),
      ('Temos condições competitivas.', 'condicao_de_preco'),
      ('Isso custa pouco.', 'condicao_de_preco'),
      ('Custa muito pouco para você.', 'condicao_de_preco'),
      ('Temos um preço bom.', 'condicao_de_preco'),
      ('Fazemos um bom preço.', 'condicao_de_preco'),
      ('Preço justo para o seu pedido.', 'condicao_de_preco'),
      ('Há uma taxa de entrega.', 'taxa_cobrada'),
      ('Tem uma taxa de urgência.', 'taxa_cobrada')) AS q(frase, codigo)
  LOOP
    IF NOT (f.codigo = ANY (public._agente_problemas_de_texto(f.frase, v_cli)))
       OR NOT (f.codigo = ANY (public._agente_problemas_de_texto(f.frase, v_par))) THEN
      RAISE EXCEPTION 'FALHOU 2: a frase "%" devia ser barrada com % (cliente %, parceiro %)', f.frase, f.codigo,
        public._agente_problemas_de_texto(f.frase, v_cli), public._agente_problemas_de_texto(f.frase, v_par);
    END IF;
  END LOOP;
  v_r := array_append(v_r, '2) 24 frases novas (orçamento feito pelo agente, prazo sem número, condição de preço, taxa) são barradas, com o código esperado, nos dois ramos');

  -- 3) o que precisa continuar passando continua passando (a primeira frase é a semente como_pedir_orcamento)
  FOR f IN SELECT * FROM (VALUES
      ('Para a equipe montar o orçamento, preciso saber qual produto você quer, a medida, a quantidade e se você já tem a arte pronta. Pode mandar essas informações por aqui que eu passo para a equipe.'),
      ('A equipe faz o orçamento depois de ver o pedido.'),
      ('A equipe prepara o orçamento quando você mandar as medidas.'),
      ('Me diga o produto que você quer ver que eu passo o pedido para ela.'),
      ('Vou avisar a equipe que você quer falar com uma pessoa.'),
      ('Pode mandar a arte por aqui que a equipe confere se está boa para imprimir.'),
      ('A equipe atende de segunda a sexta, das 8h às 18h.'),
      ('Quem confirma se há alguma taxa é a equipe.'),
      ('O pedido sai da fila de produção na ordem em que chegou.'),
      ('Impressão em 3D é com a equipe.')) AS q(frase)
  LOOP
    IF cardinality(public._agente_problemas_de_texto(f.frase, v_cli)) > 0 THEN
      RAISE EXCEPTION 'FALHOU 3: a frase "%" devia passar e foi barrada: %', f.frase, public._agente_problemas_de_texto(f.frase, v_cli);
    END IF;
  END LOOP;
  v_r := array_append(v_r, '3) 10 frases que a casa pode dizer continuam passando, inclusive a semente que tem "montar o orçamento" no infinitivo e a equipe como sujeito');

  -- 4) a ACL e o modo da função não mudaram
  IF has_function_privilege('anon', 'public._agente_problemas_de_texto(text, public.triagem_ramo[])', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public._agente_problemas_de_texto(text, public.triagem_ramo[])', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public._agente_problemas_de_texto(text, public.triagem_ramo[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'FALHOU 4: a ACL da função mudou';
  END IF;
  v_r := array_append(v_r, '4) ACL intacta: só o service_role executa');

  RAISE EXCEPTION E'ENSAIO DO VALIDADOR PASSOU (4 provas). Nada foi escrito.\n%', array_to_string(v_r, E'\n');
END $ensaio$;
```

Saída esperada (a mensagem do erro final, como rodou no local):

```
ENSAIO DO VALIDADOR PASSOU (4 provas). Nada foi escrito.
1) as 15 respostas semente da C2 (e toda resposta não arquivada, aprovada ou rascunho) passam, nos dois ramos
2) 24 frases novas (orçamento feito pelo agente, prazo sem número, condição de preço, taxa) são barradas, com o código esperado, nos dois ramos
3) 10 frases que a casa pode dizer continuam passando, inclusive a semente que tem "montar o orçamento" no infinitivo e a equipe como sujeito
4) ACL intacta: só o service_role executa
```

### 9.4 Voltar atrás, se for preciso

Tira exatamente o bloco que a migração pôs. Recusa rodar se o corpo vivo não for o da C3.1 (alguém mexeu depois), confere que o corpo voltou ao md5 `e7cd527d465584a7d0ff8e470263616d` e que a ACL não mudou, e desfaz tudo se algo falhar. As respostas já aprovadas continuam como estão.

```sql
-- Volta da C3.1: tira o bloco que a migração pôs e devolve o corpo lido em 14/11/2026. Para sem mudar nada se o corpo não for o da C3.1.
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $volta$
DECLARE
  v_oid oid := 'public._agente_problemas_de_texto(text, public.triagem_ramo[])'::regprocedure;
  v_def text := pg_get_functiondef('public._agente_problemas_de_texto(text, public.triagem_ramo[])'::regprocedure);
  v_novo text;
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = v_oid) <> '92b7101a1208c7c747c2a6f891421494' THEN
    RAISE EXCEPTION 'O corpo vivo não é o da C3.1 (md5 92b7101a1208c7c747c2a6f891421494): alguém mexeu depois, releia antes de voltar.';
  END IF;
  v_novo := regexp_replace(v_def, E'\n  -- C3\\.1: validador mais firme.*?(?=  FOREACH c IN ARRAY v_novos LOOP)', '', 's');
  IF v_novo = v_def THEN RAISE EXCEPTION 'não achei o bloco da C3.1 para tirar'; END IF;
  EXECUTE v_novo;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = v_oid) <> 'e7cd527d465584a7d0ff8e470263616d' THEN
    RAISE EXCEPTION 'o corpo não voltou ao de 14/11/2026: nada foi desfeito';
  END IF;
  IF has_function_privilege('anon', v_oid, 'EXECUTE') OR has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'a ACL mudou: nada foi desfeito';
  END IF;
END $volta$;
COMMIT;
```

### 9.5 O que a C3.1 NÃO resolve

1. **Continua sendo uma última porta parcial.** Frase que ninguém previu passa, e frase de preço ou prazo escrita de um jeito novo também. A garantia real é o dono ler cada resposta; o ensaio da C3 e os testes em TypeScript não substituem isso.
2. **Falso positivo é aceito do lado seguro.** "Taxa de" e "preço bom" barram mesmo em frase que a casa poderia dizer sem prometer nada; o dono reescreve. O verbo na primeira pessoa com "valor" ("eu passo o valor para a equipe") também é barrado.
3. **O TypeScript tem um falso positivo antigo que o SQL não tem** ("impressão em 3D" no escopo completo, pela regra do prazo abreviado). Não foi mexido.
