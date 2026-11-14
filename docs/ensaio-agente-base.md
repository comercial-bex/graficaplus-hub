# Ensaio da migração C2: a base de respostas aprovadas do agente

Migração APLICADA em 14/11/2026 (ensaio com desfazer no banco vivo e md5 das 10 funções iguais ao arquivo): `supabase/migrations/20261114120000_agente_base_de_respostas.sql`. Depende da Onda B (`20261113130000_triagem_dados.sql`, que traz o tipo `triagem_ramo`, o validador de texto e os termos proibidos, e `20261113131000_horario_unico.sql`, que traz `whatsapp_horario_em_texto`), que no banco vivo já estão aplicadas. Não depende das migrações B7, B8 e B9.

## O que muda em produção ao aplicar

- **Duas tabelas novas e vazias de uso:** `agente_base_respostas` (a base) e `agente_base_respostas_historico` (a trilha de versões). Nenhuma tabela, função ou gatilho vivo é alterado. A única ligação com tabela viva é a chave `produto_id` para `produtos` (`ON DELETE SET NULL`), que pede uma trava curta em `produtos` no `CREATE TABLE`; a migração abre com `lock_timeout` de 5 s e desiste inteira se `produtos` estiver ocupada.
- **15 perguntas semeadas, todas RASCUNHO**, ramo cliente final, produto nulo, escritas para o dono aprovar. Nenhuma nasce aprovada (a conferência no fim da migração desfaz tudo se alguma estiver aprovada).
- **Nenhum consumidor chama a base.** O agente de texto livre continua desligado e a triagem de boas-vindas não lê esta tabela. Aprovar uma resposta hoje não muda nada para nenhum contato.
- **Quem aprova:** só `whatsapp.manage`, que no banco vivo só o perfil admin tem (conferido em 14/11/2026: `perfil_permissoes` dá `whatsapp.manage` só a `admin`; `configuracoes.manage` vai a `admin` e `gestor`). Quem tem `configuracoes.manage` salva rascunho, volta a rascunho e arquiva, mas não aprova. Não foi criada permissão nova, de propósito: criar exigiria mexer em `permissoes` e `perfil_permissoes` e na lista do TypeScript, e a regra "só o dono" já está dita por uma permissão que só o admin tem. Se o dono quiser que outra pessoa aprove, concede `whatsapp.manage` a ela pela tela de exceções de permissão.
- **Front:** a tela `/configuracoes-agente-base` (fila de aprovação, uma resposta por vez) lê e escreve só por funções do servidor. Antes de a migração ser aplicada a tela abre e mostra "a base ainda não existe no banco" em vez de quebrar.

**Regras que o banco impõe, com todas as letras**

- `status`: `rascunho`, `aprovada` ou `arquivada`. A linha nasce rascunho (um `INSERT` com outro status é recusado).
- **Aprovada exige** quem aprovou, quando, `texto_aprovado` IGUAL à `resposta` e ao menos uma frase gatilho (restrição `CHECK`). Fora de aprovada, `texto_aprovado`, `aprovada_por` e `aprovada_em` são sempre nulos.
- **Aprovar só passa por `agente_resposta_aprovar(usuário, id, versão que o dono viu, texto novo opcional)`.** Um `UPDATE` direto para `aprovada` é recusado pelo gatilho, e o gatilho roda o validador de novo. A função confere que a versão que o dono viu ainda é a atual (se alguém editou no meio, ela recusa) e roda o validador. "Editar e aprovar" é a mesma função com o texto novo, numa transação só.
- **Qualquer mudança no conteúdo** (tema, pergunta, frases, ramos, produto, família ou texto) numa resposta aprovada a DEVOLVE a rascunho, apaga o texto aprovado e sobe a versão. Mudar só a contagem de ocorrências não faz isso.
- **Uma por vez:** duas respostas virando aprovada na mesma instrução são recusadas por um gatilho de instrução, mesmo que alguém consiga liberar as duas. Não existe "aprovar tudo".
- `DELETE` e `TRUNCATE` são recusados nas duas tabelas (arquive, que o histórico fica). O histórico também recusa `UPDATE`.
- **Escrita só por funções `SECURITY DEFINER` executáveis só por `service_role`.** Nem o `service_role` escreve direto nas tabelas (só lê): a trava vale também para a chave do servidor. A leitura por RLS é de quem é da equipe e tem `configuracoes.manage` ou `whatsapp.manage`.
- **Sem preço:** nenhuma coluna de preço, valor, custo, desconto ou orçamento, e as funções só leem `produtos.familia` (nunca `preco_*`). Conferido na migração e no ensaio.
- **A palavra que a casa não usa** nunca é guardada: `ramos` é um tipo com só `cliente` e `parceiro`, e as frases gatilho e os textos que a tenham são recusados. O código do problema também nunca a carrega: vira `palavra_que_a_casa_nao_usa`.

**O validador (`_agente_problemas_de_texto`)** tem duas camadas e devolve só códigos, nunca o trecho. A primeira reaproveita `_triagem_problemas_de_texto` e a tabela de termos proibidos (24 regras ativas em 14/11/2026: valor em reais, centavos, valor com número, porcentagem, desconto, pix, boleto, parcelamento, juros, nota fiscal, prazo em número, travessão, seta, parênteses e as palavras de cliente final). Nessa camada, `preco_especial`, `preco_diferenciado` e `tabela` valem SÓ para o ramo cliente. A segunda é PRÓPRIA do agente e vale para qualquer ramo: `preco_com_numero` (valor, preço, custa, custo ou cobramos com número perto, em dígito OU por extenso como cem, cinquenta e mil; "sai por" e "fica por" com número; "a partir de" com número, menos quando é quantidade, como "a partir de 100 unidades"), `valor_em_reais` por extenso ("um real", "dois contos"), `condicao_de_preco` (grátis, promoção, barato, em conta, oferta), `desconto_disfarcado`, `preco_especial`, `preco_diferenciado` e `tabela` repetidos sem olhar o ramo (preço especial, preço diferenciado, preço de custo, valor de atacado, atacado, condições especiais, tabela de preços), `prazo_prometido` (por extenso como "em dois dias" e "uma semana", "meia hora", minutos, "48h", "em 2h", "3d" em minúsculas, "dia 15", "mesmo dia", "esta semana", "amanhã"), `pagamento_com_numero` (sinal, entrada, vezes ou à vista com número perto, em dígito ou por extenso), `forma_de_pagamento` (à vista, a prazo, cartão de crédito ou débito, dinheiro, cheque, fiado, sinal, "em 3x", "em três vezes", "metade na entrada"; cartão de visita passa) e `orcamento_feito_pelo_agente` ("segue o orçamento", "vou calcular o valor"). **Não barram:** o horário da casa ("das 8h às 17h", "até 17h", "de segunda a sexta"), quantidades ("cem unidades", "dez cores"), medidas ("90 x 60 cm", "300 dpi") e impressão 3D, porque só viram problema junto de uma palavra de preço, de prazo ou de pagamento. As palavras parceiro e parceria seguem livres no ramo parceiro. Ramo com cliente (ou os dois) valida como cliente final, o mais estrito.

**De onde vêm as 15 perguntas.** Contagem por expressão regular, conversa por conversa, sobre as mensagens de ENTRADA de 05/10 a 14/11/2026 (148 conversas; o pedido falava em 146, que é o número de antes das últimas conversas do dia 14). Nenhuma mensagem, nome ou telefone foi copiado, e nenhuma resposta da equipe foi lida ou usada (traz valor). Li só frases curtas de entrada, sem nome nem número, para conferir que a expressão pegava o que dizia pegar. As contagens (conversas em que o tema aparece ao menos uma vez) e a ordem da fila:

| Tema | Conversas | | Tema | Conversas |
| --- | --- | --- | --- | --- |
| valor do produto | 49 | | endereço da loja | 9 |
| medida do produto | 39 | | entrega | 9 |
| como pedir orçamento | 24 | | formato do arquivo | 8 |
| item fora do catálogo | 22 | | quantidade mínima | 8 |
| horário de atendimento | 16 | | prazo | 7 |
| enviar a arte | 15 | | instalação | 7 |
| forma de pagamento | 12 | | exemplos e catálogo | 6 |
| falar com a equipe | 11 | | | |

Ficaram de fora por pouca ocorrência: nota fiscal (1) e acompanhar pedido (2). Os produtos citados (instalação e deslocamento) vêm de `produtos.familia`.

**O que as sementes leem do cadastro vivo.** O horário vem de `whatsapp_horario_em_texto()` (hoje "de segunda a sexta, das 8h às 18h"). O endereço vem de `empresa_config` (rua com número, bairro e cidade): o pedido falava em `whatsapp_configuracoes`, mas lá as colunas `endereco` e `horario_texto` estão VAZIAS em 14/11/2026, então a fonte certa é a tabela da empresa. Se o endereço ou o horário faltarem na hora de aplicar, o texto vira "isso a equipe confirma". A **quantidade mínima NÃO consta no cadastro de produto** (não existe coluna para isso), então o rascunho diz que a equipe confirma, sem número.

Como as outras: cada bloco abaixo é para colar no SQL do banco vivo, um de cada vez. Os blocos de ANTES e DEPOIS só leem. O bloco de ENSAIO escreve de verdade para provar o comportamento e termina em `RAISE EXCEPTION`, que desfaz tudo; o resultado aparece na mensagem do erro. Nada aqui usa sequência: os ids são `gen_random_uuid()`.

**Rodado em 14/11/2026 num Postgres 17 local** com o esquema reduzido (as funções vivas do validador copiadas da migração B1, a tabela de termos com as mesmas sementes, `produtos`, `empresa_config` e as permissões trocadas por uma tabela de teste) e a migração aplicada: a conferência da migração passou e o bloco do ENSAIO passou inteiro. NÃO foi rodado no banco vivo: lá, quem aplica confere. Diferença conhecida do local para o vivo: `has_permission` e `is_staff` aqui são tabelas de teste; no vivo vêm de `user_roles` e `perfil_permissoes`, por isso o ensaio escolhe as três pessoas de teste pelas permissões que elas TÊM (nunca por nome), e declara quando não acha alguma.

## 0. ANTES de aplicar

```sql
-- 0.1 Os pré-requisitos existem e a base ainda não. Esperado: validador bf1cd32a00a253089f0e3e5cb73064bd, horário ec60b92fbaac1dbe5b4ba06ce8bc35b9,
-- normalizador c32b42b4ad19dfa9674edb44245620dc (lidos em 14/11/2026) e as 4 linhas de "base" com 0.
SELECT proname AS item, md5(prosrc) AS md5_do_corpo FROM pg_proc
 WHERE pronamespace = 'public'::regnamespace
   AND proname IN ('_triagem_problemas_de_texto', 'whatsapp_horario_em_texto', '_triagem_normalizar_frase')
UNION ALL SELECT 'base: tabelas agente_*', count(*)::text FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'agente%'
UNION ALL SELECT 'base: funções agente_*', count(*)::text FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname ~ '^_?agente_'
UNION ALL SELECT 'base: tipo agente_resposta_status', count(*)::text FROM pg_type WHERE typname = 'agente_resposta_status'
UNION ALL SELECT 'base: alguma função viva já cita a base', count(*)::text FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND prosrc ILIKE '%agente_base%'
ORDER BY 1;
```

```sql
-- 0.2 Quem tem as duas permissões. Esperado: whatsapp.manage SÓ admin; configuracoes.manage admin e gestor.
-- (exceções individuais de permissão, se houver, não aparecem aqui: elas valem por cima.)
SELECT permissao, string_agg(perfil, ', ' ORDER BY perfil) AS perfis
FROM public.perfil_permissoes WHERE permissao IN ('whatsapp.manage', 'configuracoes.manage') GROUP BY permissao ORDER BY 1;
```

```sql
-- 0.3 O validador de termos que a base vai reaproveitar. Esperado: 24 regras ativas, e a lista abaixo tem 'revenda', 'tabela',
-- 'parceiro', 'prazo_em_numero', 'desconto' e 'moeda' (a regra da palavra que a casa não usa está lá).
SELECT count(*) AS regras_ativas, string_agg(DISTINCT regra, ', ' ORDER BY regra) AS regras
FROM public.whatsapp_triagem_termos_proibidos WHERE ativo;
```

```sql
-- 0.4 O cadastro que as sementes de horário e endereço leem. Esperado em 14/11/2026: abre 8h, fecha 18h, dias "de segunda a sexta",
-- endereço "Rua Cândido Mendes, 23", bairro "Perpétuo Socorro", cidade "Macapá". Se algo vier vazio, o rascunho vira "isso a equipe confirma".
SELECT public.whatsapp_horario_em_texto() AS horario,
       (SELECT jsonb_build_object('endereco', endereco, 'bairro', bairro, 'cidade', cidade) FROM public.empresa_config LIMIT 1) AS endereco;
```

```sql
-- 0.5 A coluna que a base copia de produtos. Esperado: familia existe (e nenhuma outra coluna de produtos é lida pela base).
SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'produtos' AND column_name IN ('id', 'familia') ORDER BY 1;
```

## 1. Aplicar

Aplique o arquivo da migração inteiro. Ele abre com `BEGIN;` e `SET LOCAL lock_timeout = '5s'`, fecha com `COMMIT;` e termina com uma conferência que desfaz tudo se algo estiver fora do esperado: pré-requisito que falta, base que já existe, número de sementes diferente de 15, semente que não seja rascunho do ramo cliente sem produto, semente reprovada pelo validador ou com menos de 3 frases gatilho, validador que não pega preço com número ou que devolve código com a palavra proibida, RLS desligada, qualquer permissão de escrita direta para `anon`, `authenticated` ou `service_role`, função com sobrecarga, sem `SECURITY DEFINER` ou `search_path`, executável por `anon` ou `authenticated`, número de gatilhos diferente de 7 e coluna de preço ou valor na estrutura.

## 2. DEPOIS: estrutura

```sql
-- 2.1 Tabelas: RLS ligada, leitura da equipe, nenhuma escrita direta. Esperado: 2 linhas, rls true, anon_le false, equipe_le true,
-- e escreve_direto false para os três papéis (anon, authenticated, service_role).
SELECT t.nome, c.relrowsecurity AS rls,
       has_table_privilege('anon', t.nome, 'SELECT') AS anon_le,
       has_table_privilege('authenticated', t.nome, 'SELECT') AS equipe_le,
       (has_table_privilege('anon', t.nome, 'INSERT, UPDATE, DELETE, TRUNCATE') OR has_table_privilege('authenticated', t.nome, 'INSERT, UPDATE, DELETE, TRUNCATE')
        OR has_table_privilege('service_role', t.nome, 'INSERT, UPDATE, DELETE, TRUNCATE')) AS escreve_direto
FROM (VALUES ('public.agente_base_respostas'), ('public.agente_base_respostas_historico')) t(nome)
JOIN pg_class c ON c.oid = t.nome::regclass ORDER BY 1;
```

```sql
-- 2.2 Funções: ACL, SECURITY DEFINER e search_path. Esperado: 10 linhas, anon_executa false e auth_executa false em todas. As 4 funções
-- de escrita (agente_resposta_*) têm definer true, search_path=public e servico_executa true; _agente_base_historico é definer true.
SELECT p.proname, p.pronargs, p.prosecdef AS definer, p.proconfig::text AS config,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_executa,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_executa,
       has_function_privilege('service_role', p.oid, 'EXECUTE') AS servico_executa
FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname ~ '^_?agente_' ORDER BY 1;
```

```sql
-- 2.3 Gatilhos. Esperado: 7 linhas (5 na base: antes de gravar, histórico, uma por vez, sem apagar, sem truncate; 2 no histórico).
SELECT tgrelid::regclass AS tabela, tgname, pg_get_triggerdef(oid) AS definicao
FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN ('public.agente_base_respostas'::regclass, 'public.agente_base_respostas_historico'::regclass) ORDER BY 1, 2;
```

```sql
-- 2.4 As 15 sementes. Esperado: 15 linhas, todas rascunho, origem semente, ramos {cliente}, produto vazio, 0 aprovadas,
-- problemas = [] em todas, e a ordem da fila pela contagem (49, 39, 24, 22, 16, 15, 12, 11, 9, 9, 8, 8, 7, 7, 6).
SELECT contagem_ocorrencias AS conversas, tema, status, origem, ramos, produto_id, familia,
       cardinality(frases_gatilho) AS frases, public._agente_problemas_de_texto(resposta, ramos) AS problemas, resposta
FROM public.agente_base_respostas ORDER BY contagem_ocorrencias DESC, tema;
```

```sql
-- 2.5 Nada aprovado ainda e o histórico das 15. Esperado: aprovadas 0, historico_criada 15, aprovadas_com_texto 0.
SELECT (SELECT count(*) FROM public.agente_base_respostas WHERE status = 'aprovada') AS aprovadas,
       (SELECT count(*) FROM public.agente_base_respostas_historico WHERE evento = 'criada') AS historico_criada,
       (SELECT count(*) FROM public.agente_base_respostas WHERE texto_aprovado IS NOT NULL) AS aprovadas_com_texto;
```

## 3. ENSAIO: a vida de uma resposta, do rascunho à aprovação, e as recusas

**Antes de rodar, três avisos.** (1) O ensaio escreve de verdade, mas só nas tabelas NOVAS da base (nenhuma tabela viva), e termina em `RAISE EXCEPTION`, que desfaz tudo. (2) Ele abre com `SET LOCAL lock_timeout = '2s'`: se alguma linha ou tabela que ele precisa estiver presa por outra sessão, desiste em 2 segundos com `canceling statement due to lock timeout` e desfaz tudo; é só rodar de novo. O ensaio faz um `TRUNCATE` recusado: ele pega por instantes a trava forte da tabela da base e do histórico, que ninguém usa ainda. (3) Ele NÃO cria gatilho, função nem qualquer DDL: o que prova já está na migração aplicada.

O ensaio escolhe três pessoas pelas permissões que elas TÊM: o dono (tem `whatsapp.manage`), um gestor (tem `configuracoes.manage` e não tem `whatsapp.manage`) e alguém sem nenhuma das duas. Se não achar o gestor ou a pessoa sem permissão, diz "pulada" naquela prova em vez de passar sem provar. Todo `UPDATE` do roteiro tem `WHERE` (o banco vivo usa safeupdate, que recusa `UPDATE` sem `WHERE`); o ensaio não usa `DELETE` sem `WHERE`, e os únicos `TRUNCATE` são os que a prova 12 espera recusados (o da base com `CASCADE`: sem ele o próprio Postgres já recusa, por causa da chave do histórico, antes de o gatilho rodar).

```sql
DO $ensaio$
DECLARE
  v_dono uuid := (SELECT u.id FROM public.usuarios u WHERE public.has_permission(u.id, 'whatsapp.manage') ORDER BY u.id LIMIT 1);
  v_gestor uuid := (SELECT u.id FROM public.usuarios u WHERE public.has_permission(u.id, 'configuracoes.manage') AND NOT public.has_permission(u.id, 'whatsapp.manage') ORDER BY u.id LIMIT 1);
  v_ninguem uuid := (SELECT u.id FROM public.usuarios u WHERE NOT public.has_permission(u.id, 'configuracoes.manage') AND NOT public.has_permission(u.id, 'whatsapp.manage') ORDER BY u.id LIMIT 1);
  v_prod uuid := (SELECT p.id FROM public.produtos p WHERE p.familia IS NOT NULL ORDER BY p.id LIMIT 1);
  v_r text[] := '{}';
  v_j jsonb;
  v_a uuid; v_b uuid; v_c uuid; v_d uuid;
  v_n integer;
  v_x text;
  v_t text;
  v_linha record;
  v_resp public.agente_base_respostas%ROWTYPE;
  v_fam text;
  v_casos text[][] := ARRAY[
    ARRAY['O valor é de R$ 50', 'moeda'],
    ARRAY['Fica em 30 reais', 'valor_em_reais'],
    ARRAY['Tem desconto para quem compra mais', 'desconto'],
    ARRAY['Aceitamos pix', 'pix'],
    ARRAY['A entrada é de 30 por cento', 'porcentagem'],
    ARRAY['Fica pronto em 3 dias', 'prazo_em_numero'],
    ARRAY['Fica pronto em três dias', 'prazo_prometido'],
    ARRAY['Fica pronto amanhã', 'prazo_prometido'],
    ARRAY['Custa 45 cada', 'preco_com_numero'],
    ARRAY['A partir de 20 a unidade', 'preco_com_numero'],
    ARRAY['O orçamento sai de graça', 'condicao_de_preco'],
    ARRAY['Segue o orçamento', 'orcamento_feito_pelo_agente'],
    ARRAY['Vou calcular o valor para você', 'orcamento_feito_pelo_agente'],
    ARRAY['Pode pagar a entrada de 30 e o resto na retirada', 'pagamento_com_numero'],
    ARRAY['Trabalhamos com revenda de brindes', 'palavra_que_a_casa_nao_usa'],
    ARRAY['Temos tabela de preço', 'tabela'],
    ARRAY['Texto com travessão — no meio', 'travessao'],
    ARRAY['Texto (com parênteses)', 'parenteses'],
    ARRAY['Falar com a equipe → agora', 'seta'],
    ARRAY['Aceitamos parceiro', 'parceiro'],
    -- preço por extenso, "sai por", moeda por extenso
    ARRAY['O preço é cem', 'preco_com_numero'],
    ARRAY['O valor fica em cento e cinquenta', 'preco_com_numero'],
    ARRAY['Sai por duzentos cada', 'preco_com_numero'],
    ARRAY['Sai por 30 cada', 'preco_com_numero'],
    ARRAY['Custa cinquenta a unidade', 'preco_com_numero'],
    ARRAY['Cobramos mil e quinhentos', 'preco_com_numero'],
    ARRAY['A partir de cem a unidade', 'preco_com_numero'],
    ARRAY['Custa um real', 'valor_em_reais'],
    ARRAY['Sai por dois contos', 'valor_em_reais'],
    -- prazo: abreviado, por extenso, dia marcado, expressão
    ARRAY['Fica pronto em 48h', 'prazo_prometido'],
    ARRAY['Pronto em 3d', 'prazo_prometido'],
    ARRAY['Fica pronto em 2h', 'prazo_prometido'],
    ARRAY['Fica pronto em até 36h', 'prazo_prometido'],
    ARRAY['Fica pronto em dois dias', 'prazo_prometido'],
    ARRAY['Leva uma semana', 'prazo_prometido'],
    ARRAY['Entrego dia 15', 'prazo_prometido'],
    ARRAY['Fica pronto no mesmo dia', 'prazo_prometido'],
    ARRAY['Entregamos esta semana', 'prazo_prometido'],
    ARRAY['Fica pronto em 30 minutos', 'prazo_prometido'],
    ARRAY['Fica pronto em meia hora', 'prazo_prometido'],
    -- forma de pagamento sem a palavra pix, boleto nem parcela
    ARRAY['Pagamento à vista', 'forma_de_pagamento'],
    ARRAY['Aceitamos cartão de crédito', 'forma_de_pagamento'],
    ARRAY['Dividimos em três vezes', 'forma_de_pagamento'],
    ARRAY['Dividimos em 3x', 'forma_de_pagamento'],
    ARRAY['Metade na entrada e metade na retirada', 'forma_de_pagamento'],
    ARRAY['Pedimos um sinal', 'forma_de_pagamento'],
    ARRAY['Pagamento em dinheiro', 'forma_de_pagamento'],
    ARRAY['', 'vazio']];
  -- Ramo PARCEIRO: preço especial, preço diferenciado e tabela só eram barrados para o cliente final pela tabela de termos;
  -- o validador do agente barra em qualquer ramo. As regras de preço, prazo e pagamento também valem para o parceiro.
  v_casos_parceiro text[][] := ARRAY[
    ARRAY['Temos preço especial para parceiros', 'preco_especial'],
    ARRAY['Parceiro tem preço diferenciado', 'preco_diferenciado'],
    ARRAY['Os valores diferenciados ficam no cadastro', 'preco_diferenciado'],
    ARRAY['O valor de atacado é combinado depois', 'preco_especial'],
    ARRAY['Trabalhamos no atacado', 'preco_especial'],
    ARRAY['Vou mandar a tabela de preços', 'tabela'],
    ARRAY['Temos condições especiais', 'preco_especial'],
    ARRAY['Aqui é preço de custo', 'preco_especial'],
    ARRAY['Sai por duzentos cada', 'preco_com_numero'],
    ARRAY['Fica pronto em 48h', 'prazo_prometido'],
    ARRAY['Pagamento à vista', 'forma_de_pagamento']];
  v_limpos_parceiro text[] := ARRAY[
    'O cadastro de parceiro é rápido e a equipe conversa com você.',
    'A parceria começa pelo cadastro.',
    'As condições de parceiro ficam disponíveis depois do cadastro.',
    'A equipe atende de segunda a sexta, das 8h às 17h.'];
  v_limpos text[] := ARRAY[
    'Pode mandar a arte por aqui que a equipe confere se está boa para imprimir.',
    'A Bex Print fica na Rua Cândido Mendes, 23, bairro Perpétuo Socorro, em Macapá.',
    'A equipe atende de segunda a sexta, das 8h às 18h.',
    'O prazo quem confirma é a equipe, depois de ver o que você precisa.',
    'Me conte o produto, a medida e a quantidade que eu passo para a equipe.',
    -- horário da casa, quantidades e medidas não são prazo, preço nem pagamento
    'Abrimos às 8h e fechamos às 18h, de segunda a sexta.',
    'A equipe atende de segunda a sexta, das 8h às 17h.',
    'Atendemos até 17h.',
    'Fazemos cartão de visita, panfleto e banner.',
    'A medida é 90 x 60 cm e o arquivo precisa ter 300 dpi.',
    'A lona tem 2 metros por 1 metro.',
    'O pedido mínimo é de cem unidades.',
    'A partir de 100 unidades a equipe confirma o mínimo.',
    'Trabalhamos com pedidos de dez unidades ou mais e com até vinte cores.',
    'Fazemos impressão 3D e impressão em 3D.',
    'Dar entrada no pedido é só mandar a arte.',
    'A forma de pagamento quem combina é a equipe.'];
  i integer;
BEGIN
  -- se alguma linha estiver presa por outra sessão, o ensaio desiste em 2 s em vez de esperar e segurar quem vem atrás
  SET LOCAL lock_timeout = '2s';
  IF v_dono IS NULL THEN RAISE EXCEPTION 'FALHOU: não achei ninguém com whatsapp.manage para ser o dono do ensaio'; END IF;

  -- 1. o estado de partida: 15 sementes, todas rascunho, nenhuma aprovada, todas limpas no validador
  SELECT count(*) INTO v_n FROM public.agente_base_respostas WHERE status = 'rascunho' AND origem = 'semente';
  IF v_n <> 15 THEN RAISE EXCEPTION 'FALHOU 1a: % sementes em rascunho (esperava 15)', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.agente_base_respostas WHERE status <> 'rascunho';
  IF v_n <> 0 THEN RAISE EXCEPTION 'FALHOU 1b: já há % respostas fora de rascunho: o ensaio mede a partida limpa; rode antes de aprovar as primeiras', v_n; END IF;
  SELECT string_agg(tema, ', ') INTO v_x FROM public.agente_base_respostas WHERE cardinality(public._agente_problemas_de_texto(resposta, ramos)) > 0;
  IF v_x IS NOT NULL THEN RAISE EXCEPTION 'FALHOU 1c: semente reprovada pelo validador: %', v_x; END IF;
  v_r := array_append(v_r, '1) partida: 15 sementes, todas rascunho, nenhuma aprovada, todas limpas no validador');

  -- 2. salvar um rascunho novo (o gestor tem configuracoes.manage): frases normalizadas, versão 1, histórico "criada"
  v_j := public.agente_resposta_salvar(coalesce(v_gestor, v_dono), NULL, 'ensaio_tema_a', 'Quanto é o frete?',
           ARRAY['Quanto É o Frete?', 'quanto e o frete', '  Frete  '], ARRAY['cliente']::public.triagem_ramo[], NULL, NULL,
           'O frete a equipe confirma, depois de saber o endereço.');
  v_a := (v_j ->> 'id')::uuid;
  SELECT * INTO v_resp FROM public.agente_base_respostas WHERE id = v_a;
  IF v_resp.status <> 'rascunho' OR v_resp.versao <> 1 OR v_resp.frases_gatilho <> ARRAY['quanto e o frete', 'frete']::text[] THEN
    RAISE EXCEPTION 'FALHOU 2a: status %, versão %, frases %', v_resp.status, v_resp.versao, v_resp.frases_gatilho; END IF;
  SELECT count(*) INTO v_n FROM public.agente_base_respostas_historico WHERE resposta_id = v_a AND evento = 'criada' AND versao = 1;
  IF v_n <> 1 OR jsonb_array_length(v_j -> 'problemas') <> 0 THEN RAISE EXCEPTION 'FALHOU 2b: histórico % problemas %', v_n, v_j -> 'problemas'; END IF;
  v_r := array_append(v_r, '2) salvar cria rascunho de versão 1; as frases saem normalizadas e sem repetição ("Quanto É o Frete?" vira "quanto e o frete"); o histórico registra criada');

  -- 3. quem não tem permissão nenhuma não salva
  IF v_ninguem IS NULL THEN
    v_r := array_append(v_r, '3) pulada: não há ninguém sem as duas permissões neste banco');
  ELSE
    v_x := NULL;
    BEGIN
      PERFORM public.agente_resposta_salvar(v_ninguem, NULL, 'ensaio_tema_x', 'Teste', ARRAY['teste'], ARRAY['cliente']::public.triagem_ramo[], NULL, NULL, 'Texto limpo.');
    EXCEPTION WHEN OTHERS THEN v_x := SQLERRM; END;
    IF v_x IS NULL OR v_x NOT LIKE '%exige a permissão%' THEN RAISE EXCEPTION 'FALHOU 3: %', coalesce(v_x, 'a pessoa sem permissão salvou'); END IF;
    v_r := array_append(v_r, '3) quem não tem configuracoes.manage nem whatsapp.manage não salva');
  END IF;

  -- 4. o gestor (sem whatsapp.manage) não aprova
  IF v_gestor IS NULL THEN
    v_r := array_append(v_r, '4) pulada: não há gestor (configuracoes.manage sem whatsapp.manage) neste banco');
  ELSE
    v_x := NULL;
    BEGIN
      PERFORM public.agente_resposta_aprovar(v_gestor, v_a, 1);
    EXCEPTION WHEN OTHERS THEN v_x := SQLERRM; END;
    IF v_x IS NULL OR v_x NOT LIKE '%exige a permissão whatsapp.manage%' THEN RAISE EXCEPTION 'FALHOU 4: %', coalesce(v_x, 'o gestor aprovou'); END IF;
    v_r := array_append(v_r, '4) o gestor não aprova: só quem tem whatsapp.manage');
  END IF;

  -- 5. editar com preço: salva como rascunho (versão 2) e AVISA; aprovar esse texto é recusado pelo validador
  v_j := public.agente_resposta_salvar(v_dono, v_a, 'ensaio_tema_a', 'Quanto é o frete?', ARRAY['quanto e o frete', 'frete'],
           ARRAY['cliente']::public.triagem_ramo[], NULL, NULL, 'O frete custa 30 para qualquer endereço.', 1);
  IF (v_j ->> 'versao')::integer <> 2 OR NOT (v_j -> 'problemas') ? 'preco_com_numero' THEN
    RAISE EXCEPTION 'FALHOU 5a: versão % problemas %', v_j ->> 'versao', v_j -> 'problemas'; END IF;
  v_x := NULL;
  BEGIN
    PERFORM public.agente_resposta_aprovar(v_dono, v_a, 2);
  EXCEPTION WHEN OTHERS THEN v_x := SQLERRM; END;
  IF v_x IS NULL OR v_x NOT LIKE '%preco_com_numero%' THEN RAISE EXCEPTION 'FALHOU 5b: %', coalesce(v_x, 'aprovou texto com preço'); END IF;
  SELECT status INTO v_t FROM public.agente_base_respostas WHERE id = v_a;
  IF v_t <> 'rascunho' THEN RAISE EXCEPTION 'FALHOU 5c: o texto com preço ficou %', v_t; END IF;
  v_r := array_append(v_r, '5) texto com preço salva como rascunho (versão 2) com o aviso preco_com_numero, e a aprovação é recusada pelo validador');

  -- 6. a versão que o dono viu: com a versão velha, recusa; com a atual, aprova
  v_j := public.agente_resposta_salvar(v_dono, v_a, 'ensaio_tema_a', 'Quanto é o frete?', ARRAY['quanto e o frete', 'frete'],
           ARRAY['cliente']::public.triagem_ramo[], NULL, NULL, 'O frete a equipe confirma, depois de saber o endereço.', 2);
  IF (v_j ->> 'versao')::integer <> 3 OR jsonb_array_length(v_j -> 'problemas') <> 0 THEN RAISE EXCEPTION 'FALHOU 6a: %', v_j; END IF;
  v_x := NULL;
  BEGIN
    PERFORM public.agente_resposta_aprovar(v_dono, v_a, 2);
  EXCEPTION WHEN OTHERS THEN v_x := SQLERRM; END;
  IF v_x IS NULL OR v_x NOT LIKE '%mudou depois que você a viu%' THEN RAISE EXCEPTION 'FALHOU 6b: %', coalesce(v_x, 'aprovou versão velha'); END IF;
  v_x := NULL;
  BEGIN
    PERFORM public.agente_resposta_salvar(v_dono, v_a, 'ensaio_tema_a', 'Quanto é o frete?', ARRAY['frete'], ARRAY['cliente']::public.triagem_ramo[], NULL, NULL, 'Texto limpo.', 1);
  EXCEPTION WHEN OTHERS THEN v_x := SQLERRM; END;
  IF v_x IS NULL OR v_x NOT LIKE '%mudou depois que você a abriu%' THEN RAISE EXCEPTION 'FALHOU 6c: %', coalesce(v_x, 'salvou por cima de versão velha'); END IF;
  v_j := public.agente_resposta_aprovar(v_dono, v_a, 3);
  SELECT * INTO v_resp FROM public.agente_base_respostas WHERE id = v_a;
  IF v_resp.status <> 'aprovada' OR v_resp.texto_aprovado IS DISTINCT FROM v_resp.resposta OR v_resp.aprovada_por <> v_dono OR v_resp.aprovada_em IS NULL OR v_resp.versao <> 3 THEN
    RAISE EXCEPTION 'FALHOU 6d: status %, versão %, texto_aprovado igual %, quem %', v_resp.status, v_resp.versao, v_resp.texto_aprovado = v_resp.resposta, v_resp.aprovada_por; END IF;
  v_r := array_append(v_r, '6) a versão que o dono viu manda: a velha é recusada (na aprovação e no salvar); a atual aprova, com texto aprovado igual à resposta, quem e quando');

  -- 7. UPDATE direto para aprovada, sem a função, é recusado
  v_j := public.agente_resposta_salvar(v_dono, NULL, 'ensaio_tema_b', 'Tem sacola?', ARRAY['tem sacola', 'sacola'], ARRAY['cliente']::public.triagem_ramo[], NULL, NULL, 'Isso a equipe confirma.');
  v_b := (v_j ->> 'id')::uuid;
  v_x := NULL;
  BEGIN
    UPDATE public.agente_base_respostas SET status = 'aprovada', aprovada_por = v_dono, aprovada_em = now(), texto_aprovado = resposta WHERE id = v_b;
  EXCEPTION WHEN OTHERS THEN v_x := SQLERRM; END;
  IF v_x IS NULL OR v_x NOT LIKE '%Aprovar só pela função%' THEN RAISE EXCEPTION 'FALHOU 7: %', coalesce(v_x, 'UPDATE direto aprovou'); END IF;
  v_r := array_append(v_r, '7) UPDATE direto para aprovada é recusado pelo gatilho: aprovar só pela função');

  -- 8. editar uma resposta aprovada a devolve a rascunho, sobe a versão e apaga o texto aprovado
  v_j := public.agente_resposta_salvar(v_dono, v_a, 'ensaio_tema_a', 'Quanto é o frete?', ARRAY['quanto e o frete', 'frete'],
           ARRAY['cliente']::public.triagem_ramo[], NULL, NULL, 'O frete a equipe confirma, depois de saber o endereço e o produto.', 3);
  SELECT * INTO v_resp FROM public.agente_base_respostas WHERE id = v_a;
  IF NOT coalesce((v_j ->> 'voltou_a_rascunho')::boolean, false) OR v_resp.status <> 'rascunho' OR v_resp.versao <> 4
     OR v_resp.texto_aprovado IS NOT NULL OR v_resp.aprovada_por IS NOT NULL OR v_resp.aprovada_em IS NOT NULL THEN
    RAISE EXCEPTION 'FALHOU 8a: %, status %, versão %, texto_aprovado %', v_j, v_resp.status, v_resp.versao, v_resp.texto_aprovado; END IF;
  SELECT string_agg(evento || ':' || versao, ', ' ORDER BY em, id) INTO v_x FROM public.agente_base_respostas_historico WHERE resposta_id = v_a;
  IF v_x <> 'criada:1, editada:2, editada:3, aprovada:3, editada_e_voltou_a_rascunho:4' THEN RAISE EXCEPTION 'FALHOU 8b: histórico %', v_x; END IF;
  v_r := array_append(v_r, format('8) editar uma aprovada a devolve a rascunho (versão 4, texto aprovado apagado); o histórico conta a vida inteira: %s', v_x));

  -- 9. aprovar de novo; salvar o MESMO conteúdo não desaprova; mudar só a contagem não desaprova nem sobe versão nem gera histórico
  PERFORM public.agente_resposta_aprovar(v_dono, v_a, 4);
  v_j := public.agente_resposta_salvar(v_dono, v_a, 'ensaio_tema_a', 'Quanto é o frete?', ARRAY['quanto e o frete', 'frete'],
           ARRAY['cliente']::public.triagem_ramo[], NULL, NULL, 'O frete a equipe confirma, depois de saber o endereço e o produto.', 4);
  UPDATE public.agente_base_respostas SET contagem_ocorrencias = contagem_ocorrencias + 5 WHERE id = v_a;
  SELECT * INTO v_resp FROM public.agente_base_respostas WHERE id = v_a;
  SELECT count(*) INTO v_n FROM public.agente_base_respostas_historico WHERE resposta_id = v_a;
  IF v_resp.status <> 'aprovada' OR v_resp.versao <> 4 OR v_n <> 6 OR coalesce((v_j ->> 'voltou_a_rascunho')::boolean, true) THEN
    RAISE EXCEPTION 'FALHOU 9: status %, versão %, histórico %, %', v_resp.status, v_resp.versao, v_n, v_j; END IF;
  v_r := array_append(v_r, '9) salvar o mesmo conteúdo e mudar só a contagem de ocorrências não desaprovam, não sobem a versão e não geram histórico');

  -- 10. aprovar em lote: duas na mesma instrução, mesmo com as duas liberadas, é recusado
  v_j := public.agente_resposta_salvar(v_dono, NULL, 'ensaio_tema_c', 'Tem fita?', ARRAY['tem fita'], ARRAY['cliente']::public.triagem_ramo[], NULL, NULL, 'Isso a equipe confirma.');
  v_c := (v_j ->> 'id')::uuid;
  v_x := NULL;
  BEGIN
    PERFORM set_config('agente_base.aprovando', v_b::text || ',' || v_c::text, true);
    UPDATE public.agente_base_respostas SET status = 'aprovada', aprovada_por = v_dono WHERE id IN (v_b, v_c);
  EXCEPTION WHEN OTHERS THEN v_x := SQLERRM; END;
  PERFORM set_config('agente_base.aprovando', '', true);
  IF v_x IS NULL OR v_x NOT LIKE '%Aprovação em lote não existe%' THEN RAISE EXCEPTION 'FALHOU 10a: %', coalesce(v_x, 'aprovou duas de uma vez'); END IF;
  SELECT count(*) INTO v_n FROM public.agente_base_respostas WHERE id IN (v_b, v_c) AND status = 'rascunho';
  IF v_n <> 2 THEN RAISE EXCEPTION 'FALHOU 10b: a recusa do lote deixou % de 2 em rascunho', v_n; END IF;
  v_r := array_append(v_r, '10) aprovar duas na mesma instrução é recusado ("Aprovação em lote não existe"); as duas continuam rascunho');

  -- 11. ramos: ordem fixa e sem repetição; vazio e repetido são recusados
  v_j := public.agente_resposta_salvar(v_dono, NULL, 'ensaio_tema_d', 'Pergunta dos dois ramos', ARRAY['dois ramos'], ARRAY['parceiro', 'cliente']::public.triagem_ramo[], NULL, NULL, 'Isso a equipe confirma.');
  v_d := (v_j ->> 'id')::uuid;
  SELECT ramos::text INTO v_x FROM public.agente_base_respostas WHERE id = v_d;
  IF v_x <> '{cliente,parceiro}' THEN RAISE EXCEPTION 'FALHOU 11a: ramos %', v_x; END IF;
  v_x := NULL;
  BEGIN
    PERFORM public.agente_resposta_salvar(v_dono, NULL, 'ensaio_tema_e', 'Teste', ARRAY['teste'], '{}'::public.triagem_ramo[], NULL, NULL, 'Texto limpo.');
  EXCEPTION WHEN OTHERS THEN v_x := SQLERRM; END;
  IF v_x IS NULL THEN RAISE EXCEPTION 'FALHOU 11b: ramo vazio foi aceito'; END IF;
  v_j := public.agente_resposta_salvar(v_dono, NULL, 'ensaio_tema_e', 'Teste', ARRAY['teste'], '{cliente,cliente}'::public.triagem_ramo[], NULL, NULL, 'Texto limpo.');
  SELECT ramos::text INTO v_x FROM public.agente_base_respostas WHERE id = (v_j ->> 'id')::uuid;
  IF v_x <> '{cliente}' THEN RAISE EXCEPTION 'FALHOU 11c: ramo repetido ficou %', v_x; END IF;
  v_r := array_append(v_r, '11) "ambos" é {cliente, parceiro}, sempre nessa ordem; ramo repetido vira um só; ramo vazio é recusado');

  -- 12. nada se apaga: DELETE e TRUNCATE nas duas tabelas, UPDATE no histórico
  v_x := NULL;
  BEGIN DELETE FROM public.agente_base_respostas WHERE id = v_b; EXCEPTION WHEN OTHERS THEN v_x := SQLERRM; END;
  IF v_x IS NULL OR v_x NOT LIKE '%não se apaga%' THEN RAISE EXCEPTION 'FALHOU 12a: %', coalesce(v_x, 'o DELETE passou'); END IF;
  v_x := NULL;
  BEGIN TRUNCATE public.agente_base_respostas CASCADE; EXCEPTION WHEN OTHERS THEN v_x := SQLERRM; END;
  IF v_x IS NULL OR v_x NOT LIKE '%não se apaga%' THEN RAISE EXCEPTION 'FALHOU 12b: %', coalesce(v_x, 'o TRUNCATE passou'); END IF;
  v_x := NULL;
  BEGIN UPDATE public.agente_base_respostas_historico SET por = NULL WHERE resposta_id = v_a; EXCEPTION WHEN OTHERS THEN v_x := SQLERRM; END;
  IF v_x IS NULL OR v_x NOT LIKE '%só cresce%' THEN RAISE EXCEPTION 'FALHOU 12c: %', coalesce(v_x, 'o UPDATE no histórico passou'); END IF;
  v_x := NULL;
  BEGIN DELETE FROM public.agente_base_respostas_historico WHERE resposta_id = v_a; EXCEPTION WHEN OTHERS THEN v_x := SQLERRM; END;
  IF v_x IS NULL OR v_x NOT LIKE '%só cresce%' THEN RAISE EXCEPTION 'FALHOU 12d: %', coalesce(v_x, 'o DELETE no histórico passou'); END IF;
  v_x := NULL;
  BEGIN TRUNCATE public.agente_base_respostas_historico; EXCEPTION WHEN OTHERS THEN v_x := SQLERRM; END;
  IF v_x IS NULL OR v_x NOT LIKE '%só cresce%' THEN RAISE EXCEPTION 'FALHOU 12e: %', coalesce(v_x, 'o TRUNCATE no histórico passou'); END IF;
  v_r := array_append(v_r, '12) DELETE e TRUNCATE recusados na base, UPDATE, DELETE e TRUNCATE recusados no histórico');

  -- 13. produto: a família vem de produtos.familia, sem ler preço
  IF v_prod IS NULL THEN
    v_r := array_append(v_r, '13) pulada: não há produto com família neste banco');
  ELSE
    SELECT familia INTO v_fam FROM public.produtos WHERE id = v_prod;
    v_j := public.agente_resposta_salvar(v_dono, NULL, 'ensaio_tema_f', 'Pergunta de produto', ARRAY['pergunta de produto'], ARRAY['cliente']::public.triagem_ramo[], v_prod, 'família digitada que deve ser ignorada', 'Isso a equipe confirma.');
    SELECT * INTO v_resp FROM public.agente_base_respostas WHERE id = (v_j ->> 'id')::uuid;
    IF v_resp.produto_id <> v_prod OR v_resp.familia IS DISTINCT FROM v_fam THEN RAISE EXCEPTION 'FALHOU 13a: produto %, família "%" (esperava "%")', v_resp.produto_id, v_resp.familia, v_fam; END IF;
    SELECT count(*) INTO v_n FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname ~ '^_?agente_' AND proname <> '_agente_problemas_de_texto' AND prosrc ~* 'preco|custo|margem';
    IF v_n <> 0 THEN RAISE EXCEPTION 'FALHOU 13b: % funções da base (fora o validador, que só tem as palavras para barrar) falam em preço, custo ou margem', v_n; END IF;
    v_r := array_append(v_r, format('13) com produto, a família vem do cadastro ("%s") e vale mais que a digitada; nenhuma função da base, fora o validador que só as cita para barrar, fala em preço, custo ou margem', v_fam));
  END IF;

  -- 14. duplicata: o mesmo tema para os mesmos ramos e o mesmo produto, enquanto não arquivado
  v_x := NULL;
  BEGIN
    PERFORM public.agente_resposta_salvar(v_dono, NULL, 'ensaio_tema_a', 'Outra vez o frete', ARRAY['outra vez'], ARRAY['cliente']::public.triagem_ramo[], NULL, NULL, 'Isso a equipe confirma.');
  EXCEPTION WHEN OTHERS THEN v_x := SQLERRM; END;
  IF v_x IS NULL OR v_x NOT LIKE '%Já existe uma resposta desse tema%' THEN RAISE EXCEPTION 'FALHOU 14: %', coalesce(v_x, 'a duplicata passou'); END IF;
  v_r := array_append(v_r, '14) o mesmo tema para os mesmos ramos e produto não se repete (mensagem em português simples)');

  -- 15. arquivar, nascer outra com o mesmo tema, e a reabertura da arquivada esbarrar na nova; arquivada não vai direto a aprovada
  PERFORM public.agente_resposta_arquivar(coalesce(v_gestor, v_dono), v_a);
  SELECT * INTO v_resp FROM public.agente_base_respostas WHERE id = v_a;
  IF v_resp.status <> 'arquivada' OR v_resp.texto_aprovado IS NOT NULL OR v_resp.aprovada_por IS NOT NULL THEN RAISE EXCEPTION 'FALHOU 15a: status %, texto aprovado %', v_resp.status, v_resp.texto_aprovado; END IF;
  v_j := public.agente_resposta_salvar(v_dono, NULL, 'ensaio_tema_a', 'Quanto é o frete?', ARRAY['quanto e o frete'], ARRAY['cliente']::public.triagem_ramo[], NULL, NULL, 'Isso a equipe confirma.');
  v_x := NULL;
  BEGIN PERFORM public.agente_resposta_rascunho(v_dono, v_a); EXCEPTION WHEN OTHERS THEN v_x := SQLERRM; END;
  IF v_x IS NULL OR v_x NOT LIKE '%Já existe outra resposta desse tema%' THEN RAISE EXCEPTION 'FALHOU 15b: %', coalesce(v_x, 'a reabertura passou por cima da duplicata'); END IF;
  v_x := NULL;
  BEGIN
    PERFORM set_config('agente_base.aprovando', v_a::text, true);
    UPDATE public.agente_base_respostas SET status = 'aprovada', aprovada_por = v_dono WHERE id = v_a;
  EXCEPTION WHEN OTHERS THEN v_x := SQLERRM; END;
  PERFORM set_config('agente_base.aprovando', '', true);
  IF v_x IS NULL OR v_x NOT LIKE '%arquivada não vai direto a aprovada%' THEN RAISE EXCEPTION 'FALHOU 15c: %', coalesce(v_x, 'arquivada foi direto a aprovada'); END IF;
  PERFORM public.agente_resposta_arquivar(v_dono, (v_j ->> 'id')::uuid);
  PERFORM public.agente_resposta_rascunho(v_dono, v_a);
  SELECT status INTO v_t FROM public.agente_base_respostas WHERE id = v_a;
  IF v_t <> 'rascunho' THEN RAISE EXCEPTION 'FALHOU 15d: reabrir deixou %', v_t; END IF;
  v_r := array_append(v_r, '15) arquivar apaga o texto aprovado; reabrir esbarra se já nasceu outra do mesmo tema; arquivada não vai direto a aprovada; depois de arquivar a outra, reabrir volta a rascunho');

  -- 16. o validador: cada caso precisa devolver o código esperado, nenhum código pode carregar a palavra proibida, e os textos limpos passam
  FOR i IN 1 .. array_length(v_casos, 1) LOOP
    IF NOT (v_casos[i][2] = ANY (public._agente_problemas_de_texto(v_casos[i][1], ARRAY['cliente']::public.triagem_ramo[]))) THEN
      RAISE EXCEPTION 'FALHOU 16a: "%" não devolveu %: %', v_casos[i][1], v_casos[i][2], public._agente_problemas_de_texto(v_casos[i][1], ARRAY['cliente']::public.triagem_ramo[]); END IF;
  END LOOP;
  SELECT count(*) INTO v_n FROM unnest(public._agente_problemas_de_texto('Trabalhamos com revenda de brindes.', ARRAY['cliente']::public.triagem_ramo[])) AS c WHERE c LIKE 'reven%';
  IF v_n <> 0 OR NOT ('palavra_que_a_casa_nao_usa' = ANY (public._agente_problemas_de_texto('Trabalhamos com revenda de brindes.', ARRAY['parceiro']::public.triagem_ramo[]))) THEN
    RAISE EXCEPTION 'FALHOU 16b: a palavra proibida chegou ao código ou o ramo parceiro não a pegou'; END IF;
  IF 'parceiro' = ANY (public._agente_problemas_de_texto('Aceitamos parceiro', ARRAY['parceiro']::public.triagem_ramo[])) THEN
    RAISE EXCEPTION 'FALHOU 16c: o ramo parceiro recusou a palavra parceiro'; END IF;
  FOREACH v_t IN ARRAY v_limpos LOOP
    IF cardinality(public._agente_problemas_de_texto(v_t, ARRAY['cliente']::public.triagem_ramo[])) <> 0 THEN
      RAISE EXCEPTION 'FALHOU 16d: texto limpo reprovado: % (%)', v_t, public._agente_problemas_de_texto(v_t, ARRAY['cliente']::public.triagem_ramo[]); END IF;
  END LOOP;
  -- 16e/16f: o ramo parceiro. As regras de preço especial, diferenciado e tabela valem lá também; parceiro e parceria seguem livres.
  FOR i IN 1 .. array_length(v_casos_parceiro, 1) LOOP
    IF NOT (v_casos_parceiro[i][2] = ANY (public._agente_problemas_de_texto(v_casos_parceiro[i][1], ARRAY['parceiro']::public.triagem_ramo[]))) THEN
      RAISE EXCEPTION 'FALHOU 16e: no ramo parceiro "%" não devolveu %: %', v_casos_parceiro[i][1], v_casos_parceiro[i][2], public._agente_problemas_de_texto(v_casos_parceiro[i][1], ARRAY['parceiro']::public.triagem_ramo[]); END IF;
  END LOOP;
  FOREACH v_t IN ARRAY v_limpos_parceiro LOOP
    IF cardinality(public._agente_problemas_de_texto(v_t, ARRAY['parceiro']::public.triagem_ramo[])) <> 0 THEN
      RAISE EXCEPTION 'FALHOU 16f: texto limpo do parceiro reprovado: % (%)', v_t, public._agente_problemas_de_texto(v_t, ARRAY['parceiro']::public.triagem_ramo[]); END IF;
  END LOOP;
  v_r := array_append(v_r, format('16) o validador devolveu o código esperado nos %s textos ruins do cliente e nos %s do parceiro, não deixou a palavra proibida chegar a nenhum código, e passou os %s textos limpos do cliente (horário da casa, quantidades e medidas entre eles) e os %s do parceiro (parceiro e parceria livres)',
    array_length(v_casos, 1), array_length(v_casos_parceiro, 1), array_length(v_limpos, 1), array_length(v_limpos_parceiro, 1)));

  -- 17. quem de fora não executa as funções de escrita
  SELECT count(*) INTO v_n FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname ~ '^_?agente_'
     AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  IF v_n <> 0 THEN RAISE EXCEPTION 'FALHOU 17: % funções da base executáveis por anon ou authenticated', v_n; END IF;
  v_r := array_append(v_r, '17) nenhuma função da base é executável por anon ou authenticated');

  RAISE EXCEPTION E'ENSAIO OK (tudo desfeito de propósito):\n%', array_to_string(v_r, E'\n');
END
$ensaio$;
```

## 4. DEPOIS do ensaio: nada ficou

```sql
-- Esperado: 15 sementes em rascunho, 0 respostas de ensaio, 0 aprovadas, 15 linhas de histórico, 0 respostas fora das 15.
SELECT (SELECT count(*) FROM public.agente_base_respostas WHERE status = 'rascunho' AND origem = 'semente') AS sementes_em_rascunho,
       (SELECT count(*) FROM public.agente_base_respostas WHERE tema LIKE 'ensaio\_%') AS respostas_de_ensaio,
       (SELECT count(*) FROM public.agente_base_respostas WHERE status = 'aprovada') AS aprovadas,
       (SELECT count(*) FROM public.agente_base_respostas_historico) AS linhas_de_historico,
       (SELECT count(*) FROM public.agente_base_respostas) AS total_de_respostas;
```

## 5. Voltar atrás, se for preciso

Tudo que a migração criou é novo, então voltar é derrubar o que ela criou. **Atenção às travas:** o `DROP TABLE` de `agente_base_respostas` remove as chaves dela para `produtos` e para `usuarios`, e para isso o Postgres toma `ACCESS EXCLUSIVE` nessas duas tabelas VIVAS, não só nas da base. Enquanto ele espera a vez, quem quiser ler `produtos` ou `usuarios` fica na fila atrás dele. Por isso: rode com pouco movimento (de manhã cedo ou à noite) e com `lock_timeout` de 2 s, que já está no bloco. Se estourar, nada foi derrubado; é só repetir em outro momento. Se o dono já aprovou respostas, derrubar APAGA essas aprovações e o histórico: antes, exporte (5.1). O bloco se recusa a rodar com respostas aprovadas, a não ser que se diga que se quer descartá-las (a linha `SET LOCAL agente_base.descartar_aprovadas`).

### 5.1 Exportar o que foi aprovado (só leitura)

```sql
SELECT tema, ramos, familia, frases_gatilho, texto_aprovado, versao, aprovada_por, aprovada_em
FROM public.agente_base_respostas WHERE status = 'aprovada' ORDER BY tema;
```

### 5.2 Derrubar

```sql
BEGIN;
-- ATENÇÃO: o DROP TABLE abaixo toma ACCESS EXCLUSIVE em produtos e em usuarios (as chaves da base apontam para elas).
-- Rode com pouco movimento. Se alguém estiver usando essas tabelas, desiste em 2 s e desfaz tudo; repita depois.
SET LOCAL lock_timeout = '2s';
-- para descartar respostas já aprovadas, tire o comentário da linha abaixo
-- SET LOCAL agente_base.descartar_aprovadas = 'sim';
DO $trava$
DECLARE v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM public.agente_base_respostas WHERE status = 'aprovada';
  IF v_n > 0 AND coalesce(current_setting('agente_base.descartar_aprovadas', true), '') <> 'sim' THEN
    RAISE EXCEPTION 'Há % respostas aprovadas pelo dono. Exporte (5.1) e, se quiser mesmo descartar, ligue a linha SET LOCAL acima.', v_n;
  END IF;
END $trava$;
DROP TABLE public.agente_base_respostas_historico;
DROP TABLE public.agente_base_respostas;
DROP FUNCTION public.agente_resposta_salvar(uuid, uuid, text, text, text[], public.triagem_ramo[], uuid, text, text, integer, text);
DROP FUNCTION public.agente_resposta_aprovar(uuid, uuid, integer, text);
DROP FUNCTION public.agente_resposta_rascunho(uuid, uuid);
DROP FUNCTION public.agente_resposta_arquivar(uuid, uuid);
DROP FUNCTION public._agente_problemas_de_texto(text, public.triagem_ramo[]);
DROP FUNCTION public._agente_base_antes_gravar();
DROP FUNCTION public._agente_base_historico();
DROP FUNCTION public._agente_base_sem_apagar();
DROP FUNCTION public._agente_base_uma_por_vez();
DROP FUNCTION public._agente_frases_ok(text[]);
DROP TYPE public.agente_resposta_status;
DO $confere$
BEGIN
  IF (SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'agente%') <> 0
     OR (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname ~ '^_?agente_') <> 0
     OR to_regtype('public.agente_resposta_status') IS NOT NULL THEN
    RAISE EXCEPTION 'sobrou algo da base de respostas: nada foi desfeito';
  END IF;
END $confere$;
COMMIT;
```

### 5.3 Conferência final

```sql
-- Esperado: 0 tabelas, 0 funções, 0 tipos.
SELECT (SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'agente%') AS tabelas,
       (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname ~ '^_?agente_') AS funcoes,
       (SELECT count(*) FROM pg_type WHERE typname = 'agente_resposta_status') AS tipos;
```

## 6. O que este diff NÃO resolve

1. **Nenhum consumidor.** Nada lê a base: aprovar uma resposta não muda o que nenhum contato recebe. O agente de texto livre, o casamento em produção por frase gatilho e o envio ficam para outra etapa, e continuam desligados.
2. **O casamento por frase gatilho da área de ensaio é do TypeScript** (`src/domain/agente-base/casar.ts`). Quando houver consumidor, ele terá de usar a MESMA regra (frase inteira como palavras, maior frase vence, resposta de produto vence a geral), ou o ensaio da tela mentirá. A regra está nos testes do domínio.
3. **O validador acha o que sabe achar.** Preço dito de um jeito que ele não conhece (por exemplo "uma nota de cem" ou "o mesmo que o concorrente") passaria; por isso o dono lê e aprova cada resposta uma a uma, e o validador só barra o óbvio. Aprovar é decisão humana. Escolhas conhecidas: número por extenso só conta perto de preço, valor, custa, custo, cobramos, "sai por", "fica por" e "a partir de", e sem "um" e "uma" (artigos); "orçamento" só conta com número em dígito; "3d" só é prazo em minúsculas depois de "em", "até" ou "prazo" (3D maiúsculo é impressão); "hoje" sozinho e dia da semana ("até sexta") passam, porque são horário da casa; "sinal", "crédito", "débito", "dinheiro" e "cheque" são barrados mesmo fora de contexto de pagamento. A consequência é recusar às vezes um texto bom ("o preço depende das duas cores"): o dono reescreve.
4. **Quem aprova é quem tem `whatsapp.manage`**, hoje só o admin. Um admin com exceção individual removida não aprova.
5. **O aprovador não pode ser apagado.** `aprovada_por` aponta para `usuarios` sem `ON DELETE SET NULL` (a restrição de aprovada exige quem aprovou), então apagar um usuário que aprovou resposta ainda aprovada é recusado. O sistema desativa quem sai da equipe em vez de apagar, e o histórico guarda o id sem chave justamente para sobreviver.
6. **Produto apagado devolve a resposta a rascunho.** Se o produto de uma resposta aprovada for apagado, `produto_id` vira nulo (a resposta deixaria de ser específica), o que conta como mudança de conteúdo e a devolve a rascunho. Produto desativado não faz isso.
7. **Texto de endereço e horário é uma cópia de hoje.** As sementes gravam o horário e o endereço do cadastro na hora da migração. Se a loja mudar de endereço ou de horário, a resposta aprovada continua dizendo o antigo até alguém editá-la (o que a devolve a rascunho para nova aprovação). Ligar a resposta ao cadastro ao vivo ficou de fora de propósito: o que o dono aprovou é o texto, não uma fórmula.
8. **As frases gatilho curtas são largas.** "valor", "preço", "prazo" e "horário" sozinhas casam qualquer mensagem que as contenha como palavra. A área de ensaio mostra isso; o dono pode apagá-las ao revisar.
