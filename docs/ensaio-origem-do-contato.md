# Ensaio da migração 20261113100000, origem do contato e aviso novo

Migração: `supabase/migrations/20261113100000_origem_do_contato_e_aviso_novo.sql` (ainda não aplicada).

Regra de ouro: aplicar a migração ANTES de publicar o front. O front novo manda chaves a mais em `p_payload`, que a RPC velha ignora, então não existe janela quebrada. A tela de origem precisa das tabelas.

Cada bloco abaixo é para colar no SQL do banco vivo, um de cada vez. Os blocos de ANTES e DEPOIS só leem. Os blocos que escrevem para provar algo (papéis, simulação, falha forçada) terminam em `RAISE EXCEPTION`, que desfaz tudo de propósito. O resultado aparece na mensagem do erro. Como o banco guarda o número de protocolo em tabela (`whatsapp_atendimento_seq`) e não em sequência, o erro desfaz também o número: nenhum protocolo é queimado.

Este roteiro foi rodado num Postgres 17 local com o esquema reduzido (tabelas e funções vivas copiadas, menos as que não importam). As saídas esperadas abaixo vêm dessa rodada e das medições do banco vivo de 12/11. Não foi rodado no banco vivo: lá, quem aplica confere.

## 0. Antes de aplicar: guardar o que vai ser trocado

Duas funções mudam de corpo. Guarde a definição atual para poder voltar:

```sql
SELECT proname, pg_get_functiondef(oid) AS definicao
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND proname IN ('whatsapp_registrar_mensagem', 'tg_atendimento_avisa_grupo');
```

Salve as duas num arquivo. A volta do aviso também está na migração 20261112120000. A volta da RPC é o texto que você acabou de salvar.

## 1. ANTES: nada existe ainda

```sql
SELECT 'tabelas novas' AS item, count(*)::text AS valor
  FROM pg_class WHERE relnamespace = 'public'::regnamespace
   AND relname IN ('conjuntos_anuncio', 'anuncios_origem', 'palavras_de_origem')
UNION ALL SELECT 'colunas novas em leads', count(*)::text
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'leads'
   AND column_name IN ('tipo', 'tipo_origem', 'tipo_definido_em')
UNION ALL SELECT 'colunas novas em whatsapp_atendimentos', count(*)::text
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'whatsapp_atendimentos'
   AND column_name IN ('anuncio_id', 'produto', 'anuncio_titulo', 'origem_canal', 'origem_entrada',
                       'ctwa_clid', 'tipo_contato', 'origem_do_tipo', 'primeira_mensagem', 'primeira_mensagem_tipo')
UNION ALL SELECT 'funcoes novas', count(*)::text
  FROM pg_proc WHERE pronamespace = 'public'::regnamespace
   AND proname IN ('bex_normalizar_texto', '_wa_registrar_anuncio', '_wa_classificar_contato',
                   'tg_atendimento_traz_contexto', 'tg_lead_tipo_confiavel', 'origem_salvar_conjunto',
                   'origem_vincular_anuncio', 'origem_salvar_anuncio', 'origem_salvar_palavra',
                   'origem_remover_palavra', 'whatsapp_definir_tipo_do_contato')
UNION ALL SELECT 'gatilhos novos', count(*)::text
  FROM pg_trigger WHERE tgname IN ('tg_atendimento_traz_contexto', 'tg_leads_tipo_confiavel') AND NOT tgisinternal
UNION ALL SELECT 'aviso vivo ainda e o antigo', (prosrc LIKE '%Novo atendimento%')::text
  FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'tg_atendimento_avisa_grupo';
```

Esperado: seis linhas, as cinco primeiras com `0` e a última com `true`.

### 1.1 As duas funções que mudam são as que a migração copiou

```sql
SELECT proname, pronargs, md5(prosrc) AS md5_do_corpo, proacl::text AS acl, proconfig::text AS config, prosecdef
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND proname IN ('whatsapp_registrar_mensagem', 'tg_atendimento_avisa_grupo')
ORDER BY proname;
```

Esperado em 12/11:

| função | pronargs | md5_do_corpo |
| --- | --- | --- |
| tg_atendimento_avisa_grupo | 0 | d4b46577e88a2645f96bd25f1876ca5b |
| whatsapp_registrar_mensagem | 12 | 633eb6adeab24612c244bd9456bee014 |

ACL das duas: `{postgres=X/postgres,service_role=X/postgres}`. Config: `{search_path=public}`. `prosecdef` verdadeiro.

Se algum md5 for diferente, alguém mudou a função depois de 12/11: NÃO aplique. A migração foi montada sobre o corpo com esses md5 (o corpo novo da RPC, sem o bloco acrescentado, tem exatamente o md5 acima). Releia a função viva e refaça a cópia.

### 1.2 Pontos de atenção que a migração assume

```sql
-- Mapa de ACL de coluna das quatro tabelas mexidas. Esperado: 0 linhas.
SELECT c.relname, a.attname, a.attacl::text
FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
WHERE c.relnamespace = 'public'::regnamespace
  AND c.relname IN ('leads', 'whatsapp_atendimentos', 'whatsapp_conversas', 'whatsapp_conversa_eventos')
  AND a.attacl IS NOT NULL;

-- Gatilhos das duas tabelas. Esperado: tg_lead_avisa_grupo, tg_leads_deixa_de_ser_temporario,
-- tg_leads_updated e tg_atendimento_avisa_grupo. Nenhum de auditoria ou de hash.
SELECT tgrelid::regclass AS tabela, tgname
FROM pg_trigger
WHERE tgrelid IN ('public.leads'::regclass, 'public.whatsapp_atendimentos'::regclass) AND NOT tgisinternal
ORDER BY 1, 2;

-- Visões que leem leads ou atendimentos. Esperado: 0 linhas.
SELECT viewname FROM pg_views WHERE schemaname = 'public' AND definition ~* '(leads|whatsapp_atendimentos)';

-- CHECK do histórico da conversa, que ganha o valor tipo_contato. Esperado: nove valores, sem tipo_contato.
SELECT pg_get_constraintdef(oid) FROM pg_constraint
WHERE conrelid = 'public.whatsapp_conversa_eventos'::regclass AND contype = 'c';

-- Grupo da equipe configurado (sem ele o aviso nem sai). Esperado: true.
SELECT public.grupo_equipe_destino() IS NOT NULL AS grupo_configurado;
```

### 1.3 Regra do dono: preço não lê o tipo do lead

```sql
SELECT proname FROM pg_proc
WHERE pronamespace = 'public'::regnamespace AND prokind = 'f'
  AND prosrc ~* '(leads|whatsapp_atendimentos)'
  AND proname ~* '(orcamento|parceiro|preco|desconto|tabela)';
```

Esperado: só `tg_orcamento_qualifica_lead`, que qualifica o lead quando nasce orçamento e não calcula preço. A migração não muda nenhuma função de preço, e o teste `tests/preco-nao-le-o-tipo-do-lead.test.ts` do front fica para a etapa do front.

## 2. Aplicar

Aplique o arquivo inteiro. Ele abre com `BEGIN;`, fecha com `COMMIT;` e termina com um bloco de conferência que desfaz a migração inteira se algo estiver fora do esperado: sobrecarga da RPC, número de parâmetros diferente de 12, RLS desligada, algum privilégio de `anon`, `authenticated` com mais que leitura nas três tabelas, função interna executável por quem não é o servidor, seed incompleto.

## 3. DEPOIS: estrutura

```sql
-- 3.1 Tabelas, RLS ligada e quem pode o quê. Esperado: três linhas, rls true.
SELECT c.relname, c.relrowsecurity AS rls,
       has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS anon_tem_algo,
       has_table_privilege('authenticated', c.oid, 'SELECT') AS auth_le,
       has_table_privilege('authenticated', c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE') AS auth_escreve,
       has_table_privilege('service_role', c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS servico_tudo
FROM pg_class c
WHERE c.relnamespace = 'public'::regnamespace
  AND c.relname IN ('conjuntos_anuncio', 'anuncios_origem', 'palavras_de_origem')
ORDER BY 1;
```

Esperado nas três: `rls = true`, `anon_tem_algo = false`, `auth_le = true`, `auth_escreve = false`, `servico_tudo = true`.

```sql
-- 3.2 As policies. Esperado: três linhas, todas FOR SELECT, só para authenticated.
SELECT tablename, policyname, cmd, roles::text, qual
FROM pg_policies
WHERE schemaname = 'public' AND tablename IN ('conjuntos_anuncio', 'anuncios_origem', 'palavras_de_origem')
ORDER BY 1;
```

A condição de cada uma tem `is_staff` e `has_permission` com `whatsapp.read` ou `configuracoes.manage`, e nenhuma subconsulta.

```sql
-- 3.3 Colunas e restrições novas. Esperado: tipo e tipo_origem com CHECK; nenhum valor revendedor em lugar nenhum.
SELECT conrelid::regclass AS tabela, conname, pg_get_constraintdef(oid) AS regra
FROM pg_constraint
WHERE conname IN ('leads_tipo_check', 'leads_tipo_origem_check', 'whatsapp_atendimentos_tipo_contato_check',
                  'whatsapp_atendimentos_origem_do_tipo_check', 'conjuntos_anuncio_tipo_check',
                  'palavras_de_origem_tipo_check', 'palavras_de_origem_normalizada_check',
                  'anuncios_origem_definido_por_check', 'whatsapp_conversa_eventos_tipo_check')
ORDER BY 1, 2;

SELECT count(*) AS constraints_com_revendedor
FROM pg_constraint WHERE pg_get_constraintdef(oid) ILIKE '%revendedor%' AND connamespace = 'public'::regnamespace;
```

O primeiro traz nove linhas. Os CHECKs de tipo aceitam só `cliente_final` e `parceiro`; o de `palavras_de_origem` aceita só `parceiro`; o de eventos agora lista `tipo_contato`. O segundo é só a prova de que a palavra não entrou: se der mais que zero, são constraints antigas que já existiam, e o número deve ser o mesmo de antes de aplicar.

```sql
-- 3.4 Funções: ACL, SECURITY DEFINER e search_path.
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS argumentos, p.prosecdef AS definer,
       p.proconfig::text AS config, p.proacl::text AS acl,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_executa,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_executa
FROM pg_proc p
WHERE p.pronamespace = 'public'::regnamespace
  AND p.proname IN ('bex_normalizar_texto', '_wa_registrar_anuncio', '_wa_classificar_contato',
                    'tg_atendimento_traz_contexto', 'tg_lead_tipo_confiavel', 'tg_atendimento_avisa_grupo',
                    'origem_salvar_conjunto', 'origem_vincular_anuncio', 'origem_salvar_anuncio',
                    'origem_salvar_palavra', 'origem_remover_palavra', 'whatsapp_definir_tipo_do_contato',
                    'whatsapp_registrar_mensagem')
ORDER BY 1;
```

Esperado: `anon_executa = false` em todas. `auth_executa = true` só em `bex_normalizar_texto` e nas cinco `origem_*`; false nas outras. `config` com `search_path=public` em todas. `definer = true` em todas, menos `tg_atendimento_traz_contexto` e `tg_lead_tipo_confiavel`, que de propósito rodam como quem chama (a segunda precisa enxergar `current_user`). `whatsapp_registrar_mensagem` aparece UMA vez, com 12 argumentos.

```sql
-- 3.5 A RPC mantém os 12 parâmetros e não ganhou sobrecarga. Esperado: 1 e 12.
SELECT count(*) AS versoes, max(pronargs) AS parametros
FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'whatsapp_registrar_mensagem';

-- 3.6 Gatilhos de whatsapp_atendimentos. Esperado: tg_atendimento_traz_contexto (BEFORE INSERT) e
-- tg_atendimento_avisa_grupo (AFTER INSERT). Antes só existia o segundo.
SELECT tgname, CASE WHEN (tgtype & 2) = 2 THEN 'BEFORE' ELSE 'AFTER' END AS quando
FROM pg_trigger WHERE tgrelid = 'public.whatsapp_atendimentos'::regclass AND NOT tgisinternal ORDER BY 1;

-- 3.7 O texto novo está no ar e o velho saiu; a palavra proibida não aparece em lugar nenhum.
SELECT proname,
       prosrc LIKE '%LEAD NOVO%' AS tem_titulo_novo,
       prosrc LIKE '%Novo atendimento%' AS tem_texto_velho,
       prosrc ILIKE '%revendedor%' AS tem_revendedor
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND proname IN ('tg_atendimento_avisa_grupo', 'whatsapp_registrar_mensagem', '_wa_classificar_contato');
```

Esperado: `tem_titulo_novo = true` só no aviso, `tem_texto_velho = false`, `tem_revendedor = false` nas três.

## 4. DEPOIS: o seed

```sql
SELECT conjunto_id, nome, tipo, campanha_nome, ativo FROM public.conjuntos_anuncio ORDER BY conjunto_id;

SELECT a.anuncio_id, a.nome_interno, a.conjunto_id, c.tipo AS tipo_herdado, a.produto, a.ativo
FROM public.anuncios_origem a LEFT JOIN public.conjuntos_anuncio c USING (conjunto_id)
ORDER BY c.tipo, a.anuncio_id;

SELECT palavra, tipo, ativo FROM public.palavras_de_origem ORDER BY palavra;
```

Esperado: 2 conjuntos (`120252255931120481` cliente_final, `120252255945380481` parceiro) e 8 anúncios. No conjunto de cliente final ficam seis: Brindes 3D, Lona 4h e Modo Expresso ativos; Institucional, vídeo Expresso e vídeo Cliente final pausados. No de parceiro ficam dois: o card `120252264127430481` ativo e o vídeo `120252255959270481` pausado. Só o Brindes 3D vem com produto preenchido. Sete palavras: ser parceira, ser parceiro, parceria, quero ser parceira, quero ser parceiro, terceirizada, terceirizado.

Observação medida em `whatsapp_webhook_eventos`: o título do criativo que chega não coincide com o nome do anúncio no Gerenciador. O id `...600481` (nome "Card Modo Expresso (D)") traz "Lona e adesivo em até 4h" e o `...750481` (nome "Card Lona 4h (A)") traz "Modo Expresso: pronto em até 4h". Por isso o produto desses dois não é semeado.

## 5. DEPOIS: quem pode o quê, com papéis falsos

Rode inteiro. Termina em erro de propósito: nada fica gravado.

```sql
DO $ensaio$
DECLARE
  v_saida text := '';
  v_papel record;
  v_n integer;
  v_msg text;
  v_ok boolean;
BEGIN
  -- anon falso: nada pode passar.
  SET LOCAL ROLE anon;
  v_ok := true;
  BEGIN PERFORM 1 FROM public.conjuntos_anuncio LIMIT 1; v_ok := false;
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM 1 FROM public.anuncios_origem LIMIT 1; v_ok := false;
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM 1 FROM public.palavras_de_origem LIMIT 1; v_ok := false;
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.origem_salvar_palavra('teste anon', true); v_ok := false;
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public._wa_classificar_contato('1', 'x', NULL, NULL); v_ok := false;
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.whatsapp_definir_tipo_do_contato(gen_random_uuid(), gen_random_uuid(), 'parceiro'); v_ok := false;
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  v_saida := v_saida || E'\nanon: ' || CASE WHEN v_ok THEN 'barrado em tudo (certo)' ELSE 'PASSOU EM ALGO (ERRADO)' END;
  RESET ROLE;

  -- authenticated falsos: sem papel, parceiro, equipe sem configuracoes.manage e quem administra.
  FOR v_papel IN
    SELECT * FROM (
      SELECT 'sem papel nenhum' AS quem, gen_random_uuid() AS id
      UNION ALL SELECT 'parceiro', (SELECT r.user_id FROM public.user_roles r WHERE r.role::text = 'parceiro' LIMIT 1)
      UNION ALL SELECT 'equipe sem configuracoes.manage', (SELECT u.id FROM public.usuarios u
                 WHERE public.is_staff(u.id) AND public.has_permission(u.id, 'whatsapp.read')
                   AND NOT public.has_permission(u.id, 'configuracoes.manage') LIMIT 1)
      UNION ALL SELECT 'com configuracoes.manage', (SELECT u.id FROM public.usuarios u
                 WHERE public.has_permission(u.id, 'configuracoes.manage') LIMIT 1)
    ) x WHERE x.id IS NOT NULL
  LOOP
    PERFORM set_config('request.jwt.claim.sub', v_papel.id::text, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_papel.id, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    SELECT (SELECT count(*) FROM public.conjuntos_anuncio) + (SELECT count(*) FROM public.anuncios_origem)
           + (SELECT count(*) FROM public.palavras_de_origem) INTO v_n;
    v_saida := v_saida || E'\n' || v_papel.quem || ': lê ' || v_n || ' linhas';
    BEGIN
      INSERT INTO public.palavras_de_origem (palavra) VALUES ('ensaio direto');
      v_saida := v_saida || E'\n  INSERT direto PASSOU (ERRADO)';
    EXCEPTION WHEN insufficient_privilege THEN
      v_saida := v_saida || E'\n  INSERT direto barrado (certo)';
    END;
    BEGIN
      PERFORM public.origem_salvar_palavra('ensaio via funcao', true);
      v_saida := v_saida || E'\n  origem_salvar_palavra: aceitou';
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
      v_saida := v_saida || E'\n  origem_salvar_palavra: recusou com "' || v_msg || '"';
    END;
    RESET ROLE;
  END LOOP;

  RAISE EXCEPTION E'ENSAIO DE PAPÉIS CONCLUÍDO. NADA FOI GRAVADO.%', v_saida;
END
$ensaio$;
```

Esperado:

- anon: barrado em tudo.
- sem papel nenhum e parceiro: leem 0 linhas, INSERT direto barrado, `origem_salvar_palavra` recusa com "Permissão necessária: configuracoes.manage".
- equipe sem configuracoes.manage: lê 17 linhas (2 conjuntos, 8 anúncios, 7 palavras), INSERT direto barrado, a função recusa.
- com configuracoes.manage: lê 17 linhas, INSERT direto barrado (ninguém grava direto, nem administrador), a função aceita.

Se houver mais de uma pessoa por papel o bloco usa a primeira. Se faltar um papel, a linha dele simplesmente não aparece.

### 5.1 Ninguém forja a origem da etiqueta pela API

O gatilho `tg_lead_tipo_confiavel` não deixa quem chama pela API gravar origem diferente de `manual`. Quem tem `leads.create` (use um usuário real da equipe) pode testar assim, também terminando em erro:

```sql
DO $ensaio$
DECLARE
  v_uid uuid := (SELECT u.id FROM public.usuarios u WHERE public.has_permission(u.id, 'leads.create') LIMIT 1);
  v_saida text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.leads (nome, telefone, tipo, tipo_origem, tipo_definido_em)
  VALUES ('Ensaio forja', '96900000099', 'parceiro', 'anuncio', now() - interval '1 year');
  UPDATE public.leads SET tipo_origem = 'telefone' WHERE nome = 'Ensaio forja';
  SELECT 'tipo=' || tipo || ' origem=' || tipo_origem || ' definido_agora=' || (tipo_definido_em > now() - interval '1 minute')::text
    INTO v_saida FROM public.leads WHERE nome = 'Ensaio forja';
  RESET ROLE;
  RAISE EXCEPTION E'ENSAIO DA FORJA CONCLUÍDO. NADA FOI GRAVADO.\n%', v_saida;
END
$ensaio$;
```

Esperado: `tipo=parceiro origem=manual definido_agora=true`. A origem 'anuncio' pedida no INSERT virou 'manual', e o UPDATE só da origem foi desfeito.

## 6. DEPOIS: o texto vivo do aviso, simulado com a RPC de verdade

O bloco abaixo chama `whatsapp_registrar_mensagem` com telefones de teste (`55009000000NN`) e um cliente real que tenha orçamento aberto e nenhuma conversa. Isso dispara o gatilho do atendimento e o aviso reais, e lê o texto que foi para a fila. Termina em `RAISE EXCEPTION`, então nada fica gravado: nem lead, nem conversa, nem atendimento, nem aviso na fila, nem contagem de anúncio. O telefone sai mascarado.

```sql
DO $ensaio$
DECLARE
  v_inst uuid := (SELECT id FROM public.whatsapp_instancias LIMIT 1);
  v_grupo text := public.grupo_equipe_destino();
  v_cli record;
  v_caso record;
  v_r jsonb;
  v_txt text;
  v_saida text := '';
  v_fora integer;
BEGIN
  IF v_inst IS NULL THEN RAISE EXCEPTION 'Sem instância de WhatsApp para o ensaio.'; END IF;
  IF v_grupo IS NULL THEN RAISE EXCEPTION 'Sem grupo da equipe configurado: o aviso não sai e o ensaio não prova nada.'; END IF;

  -- Cliente real para o caso 3: ativo, único no telefone, sem parceria, sem conversa, com orçamento aberto.
  SELECT c.id, c.nome, c.telefone INTO v_cli
    FROM public.clientes c
   WHERE c.ativo IS NOT FALSE AND c.telefone_normalizado IS NOT NULL
     AND (SELECT count(*) FROM public.clientes x WHERE x.telefone_normalizado = c.telefone_normalizado) = 1
     AND public.parceiro_ativo_do_cliente(c.id) IS NULL
     AND NOT public._wa_telefone_da_equipe(c.telefone_normalizado)
     AND NOT EXISTS (SELECT 1 FROM public.whatsapp_conversas w WHERE w.telefone_normalizado = c.telefone_normalizado)
     AND EXISTS (SELECT 1 FROM public.orcamentos o WHERE o.cliente_id = c.id AND o.status IN ('rascunho', 'enviado'))
   ORDER BY c.id LIMIT 1;
  IF v_cli.id IS NULL THEN RAISE EXCEPTION 'Nenhum cliente elegível para o caso 3 (precisa de orçamento aberto e nenhuma conversa).'; END IF;

  FOR v_caso IN
    SELECT * FROM (VALUES
      (1, 'LEAD NOVO de anúncio (Modo Expresso)', '5500900000001', 'Ensaio Um',
          'Olá! Posso ter mais informações sobre isso?', 'texto',
          '{"anuncio_id":"120252258241600481","canal_origem":"instagram","tipo_origem":"anuncio","anuncio_titulo":"Modo Expresso: pronto em até 4h","entry_point":"ctwa_ad","ctwa_clid":"ENSAIO"}'::jsonb),
      (2, 'LEAD NOVO sem anúncio', '5500900000002', 'Ensaio Dois',
          'Bom dia, vocês fazem cartão de visita?', 'texto', '{}'::jsonb),
      (3, 'CLIENTE VOLTOU com orçamento aberto (cliente real)', v_cli.telefone, v_cli.nome,
          'Oi, queria ver meu orçamento', 'texto', '{}'::jsonb),
      (4, 'QUER SER PARCEIRO pela palavra', '5500900000004', 'Ensaio Quatro',
          E'Oi, quero ser parceiro\nde vocês', 'texto', '{}'::jsonb),
      (5, 'EXTRA: anúncio do conjunto de parceiro', '5500900000005', 'Ensaio Cinco',
          'Vi o anúncio', 'texto',
          '{"anuncio_id":"120252264127430481","canal_origem":"facebook","anuncio_titulo":"Tem cliente? Nós imprimimos"}'::jsonb),
      (6, 'EXTRA: anúncio desconhecido, só foto', '5500900000006', 'Ensaio Seis',
          NULL, 'imagem', '{"anuncio_id":"999999999999999","anuncio_titulo":"Anúncio que ninguém cadastrou"}'::jsonb)
    ) AS t(n, titulo, tel, nome, texto, tipo, payload)
    ORDER BY n
  LOOP
    v_r := public.whatsapp_registrar_mensagem(v_inst, 'ensaio-origem-' || v_caso.n, v_caso.tel, 'entrada',
             v_caso.tipo::public.whatsapp_mensagem_tipo, v_caso.texto, NULL, NULL, v_caso.nome, v_caso.payload);
    SELECT n.variaveis->>'texto' INTO v_txt
      FROM public.notificacoes_fila n
      JOIN public.whatsapp_conversas c ON c.atendimento_ativo_id = n.entidade_id
     WHERE c.id = (v_r->>'conversa_id')::uuid
     ORDER BY n.created_at DESC LIMIT 1;
    v_txt := regexp_replace(coalesce(v_txt, '(NENHUM AVISO SAIU)'), '\) (\d)\d{3,4}-(\d{4})', ') \1****-****', 'g');
    v_saida := v_saida || E'\n\n=== CASO ' || v_caso.n || ': ' || v_caso.titulo || E' ===\n' || v_txt;
  END LOOP;

  SELECT count(*) INTO v_fora
    FROM public.notificacoes_fila n
    JOIN public.whatsapp_atendimentos a ON a.id = n.entidade_id
   WHERE a.aberto_em = now() AND n.destinatario <> v_grupo;
  v_saida := v_saida || E'\n\n=== PROVAS ===\navisos com destino diferente do grupo da equipe: ' || v_fora;
  v_saida := v_saida || E'\nleads criados no ensaio: ' || (SELECT string_agg(l.nome || ' tipo=' || coalesce(l.tipo, 'nulo') || ' por=' || coalesce(l.tipo_origem, 'nulo'), '; ' ORDER BY l.nome) FROM public.leads l WHERE l.nome LIKE 'Ensaio %');
  v_saida := v_saida || E'\ncliente real do caso 3 continua sem etiqueta de lead: ' || (NOT EXISTS (SELECT 1 FROM public.leads l WHERE l.cliente_id = v_cli.id AND l.tipo IS NOT NULL))::text;

  RAISE EXCEPTION E'ENSAIO CONCLUÍDO. NADA FOI GRAVADO (este erro desfaz tudo, de propósito).%', v_saida;
END
$ensaio$;
```

Saída esperada (protocolos e ids de conversa mudam; o caso 3 mostra o nome do cliente real escolhido e a contagem real dos orçamentos dele):

```
=== CASO 1: LEAD NOVO de anúncio (Modo Expresso) ===
🆕 LEAD NOVO · anúncio Modo Expresso: pronto em até 4h
👤 Ensaio Um · (00) 9****-****
💬 "Olá! Posso ter mais informações sobre isso?"
💰 Preço: cliente final, tabela cheia
👉 Responder: https://bexprint.com.br/whatsapp?conversa=<id>
Protocolo WA-2611-NNNN

=== CASO 2: LEAD NOVO sem anúncio ===
🆕 LEAD NOVO
👤 Ensaio Dois · (00) 9****-****
💬 "Bom dia, vocês fazem cartão de visita?"
📣 Origem: contato direto, sem anúncio
💰 Preço: tipo a confirmar
👉 Responder: https://bexprint.com.br/whatsapp?conversa=<id>
Protocolo WA-2611-NNNN

=== CASO 3: CLIENTE VOLTOU com orçamento aberto (cliente real) ===
🔁 CLIENTE VOLTOU
👤 <nome do contato> · (DD) 9****-****
💬 "Oi, queria ver meu orçamento"
🏷️ Cliente: <nome do cadastro>        (só se o nome do cadastro for diferente do nome do contato)
📄 Tem N orçamentos abertos
💰 Preço: cliente final, tabela cheia
👉 Responder: https://bexprint.com.br/whatsapp?conversa=<id>
Protocolo WA-2611-NNNN

=== CASO 4: QUER SER PARCEIRO pela palavra ===
🤝 QUER SER PARCEIRO
👤 Ensaio Quatro · (00) 9****-****
💬 "Oi, quero ser parceiro de vocês"
📣 Origem: contato direto, sem anúncio
💰 Preço: tabela cheia até o cadastro como parceiro
👉 Responder: https://bexprint.com.br/whatsapp?conversa=<id>
Protocolo WA-2611-NNNN

=== CASO 5: EXTRA: anúncio do conjunto de parceiro ===
🤝 QUER SER PARCEIRO · anúncio Tem cliente? Nós imprimimos
... 💰 Preço: tabela cheia até o cadastro como parceiro

=== CASO 6: EXTRA: anúncio desconhecido, só foto ===
🆕 LEAD NOVO · anúncio Anúncio que ninguém cadastrou
💬 Enviou uma foto
💰 Preço: tipo a confirmar

=== PROVAS ===
avisos com destino diferente do grupo da equipe: 0
leads criados no ensaio: Ensaio Cinco tipo=parceiro por=anuncio; Ensaio Dois tipo=nulo por=nulo; Ensaio Quatro tipo=parceiro por=palavra; Ensaio Seis tipo=nulo por=nulo; Ensaio Um tipo=cliente_final por=anuncio
cliente real do caso 3 continua sem etiqueta de lead: true
```

O que conferir nesta saída:

1. A primeira linha de cada aviso diz o que é o contato. Cada linha tem rótulo em palavras.
2. A primeira mensagem aparece entre aspas. A quebra de linha do caso 4 virou espaço: ninguém forja uma linha do aviso pelo texto.
3. O caso 6 mostra "Enviou uma foto" e o anúncio sem cadastro vira lead com tipo nulo e "tipo a confirmar".
4. O caso 3 (cliente real) não ganha lead nem etiqueta: o preço segue o cadastro. Se esse cliente for parceiro cadastrado o caso não é escolhido, de propósito.
5. Nenhuma palavra revendedor. Nenhum aviso com destino diferente do grupo da equipe.

### 6.1 Atendimento reaberto (VOLTOU A CONVERSAR)

O bloco acima não cobre a volta porque exige um atendimento que já foi fechado há dias. Para ver o texto: peça a quem conhece a caixa um contato que fechou o atendimento há mais de um dia e que escreva de novo, ou, num banco de teste, feche o atendimento e mande outra mensagem. O texto esperado, rodado no banco local, foi:

```
🔁 VOLTOU A CONVERSAR · anúncio Lona e adesivo em até 4h
👤 <nome> · (DD) 9****-****
💬 "Voltei, preciso de lona"
🕒 Última conversa há 12 dias
💰 Preço: cliente final, tabela cheia
👉 Responder: https://bexprint.com.br/whatsapp?conversa=<id>
Protocolo WA-2611-NNNN
```

A data vem das mensagens do atendimento anterior, não de `ultima_mensagem_at` da conversa, que já foi atualizada pela mensagem nova.

## 7. Falha forçada: a mensagem entra mesmo se a classificação quebrar

```sql
DO $ensaio$
DECLARE
  v_inst uuid := (SELECT id FROM public.whatsapp_instancias LIMIT 1);
  v_r jsonb;
  v_msgs integer;
  v_txt text;
BEGIN
  ALTER TABLE public.anuncios_origem RENAME TO anuncios_origem_ensaio;   -- quebra de propósito a classificação
  v_r := public.whatsapp_registrar_mensagem(v_inst, 'ensaio-falha-1', '5500900000077', 'entrada', 'texto',
           'Oi tudo bem', NULL, NULL, 'Ensaio Falha', '{"anuncio_id":"120252258241600481","anuncio_titulo":"X"}'::jsonb);
  SELECT count(*) INTO v_msgs FROM public.whatsapp_mensagens WHERE zapi_message_id = 'ensaio-falha-1';
  SELECT n.variaveis->>'texto' INTO v_txt
    FROM public.notificacoes_fila n
    JOIN public.whatsapp_conversas c ON c.atendimento_ativo_id = n.entidade_id
   WHERE c.id = (v_r->>'conversa_id')::uuid;
  RAISE EXCEPTION E'ENSAIO DA FALHA CONCLUÍDO. NADA FOI GRAVADO.\nmensagens gravadas: %\naviso:\n%', v_msgs, regexp_replace(coalesce(v_txt, '(NENHUM AVISO)'), '\) (\d)\d{3,4}-(\d{4})', ') \1****-****', 'g');
END
$ensaio$;
```

Esperado: `mensagens gravadas: 1` e o aviso sai com "📣 Origem: não identificada" e "💰 Preço: tipo a confirmar", sem o nome do anúncio. Nos logs do Postgres aparece `WARNING: origem do contato falhou (conversa ..., mensagem ensaio-falha-1, anuncio ...)` com a causa (a tabela `public.anuncios_origem` não existe). Se o aviso tiver "Origem: contato direto, sem anúncio" aqui, algo está errado: sem contexto gravado o aviso não pode afirmar que não havia anúncio.

## 8. Rajada no mesmo anúncio (opcional, antes de publicar o front)

Contagem de contatos do anúncio sob 20 clientes clicando juntos: o `ON CONFLICT` do anúncio bloqueia a linha por transação, e a soma tem de bater. No banco local, 20 chamadas paralelas ao mesmo `anuncio_id` com telefones diferentes deram `total_contatos = 20`, 20 atendimentos e 20 avisos. No banco vivo só vale repetir com telefone de teste e depois apagar os rastros; a conferência acima já cobre a lógica, então esta etapa é por conta de quem aplica.

## 9. O que o ensaio precisa mostrar (lista de conferência)

1. Seção 1: tudo zerado, md5 das duas funções iguais aos da tabela, nenhuma ACL de coluna, grupo configurado.
2. Seção 3: três tabelas com RLS, anon sem nada, authenticated só lê; função por função com `anon_executa = false`; a RPC com 12 parâmetros e uma versão só; dois gatilhos em `whatsapp_atendimentos`.
3. Seção 4: 2 conjuntos, 8 anúncios herdando o tipo do conjunto, 7 palavras.
4. Seção 5: parceiro e sem papel leem zero; equipe lê 17 e não escreve; só quem tem `configuracoes.manage` grava, e só pela função.
5. Seção 6: os quatro textos pedidos e os dois extras, com rótulo em linguagem comum, primeira mensagem entre aspas, protocolo na última linha, e a prova de que nada vai a quem não é o grupo da equipe.
6. Seção 7: falha na classificação não perde mensagem nem aviso.
7. A palavra revendedor não aparece em lugar nenhum, e `clientes.revendedor`, `parceiros`, orçamentos e funções de preço ficam como estavam.

## 10. Depois de aplicar

1. Trocar a primeira linha da migração para "APLICADA em <data>".
2. Publicar o front (que manda título, corpo, link e ctwaClid em `p_payload`).
3. Esperar o primeiro contato de anúncio real e conferir `whatsapp_atendimentos.anuncio_id`, `tipo_contato` e `primeira_mensagem` da linha nova, e o texto do aviso no grupo.
4. Contatos antigos ficam sem tipo: não há reprocessamento retroativo.
