# Ensaio da migração B7 e B8: a triagem grava no cadastro e o aviso do grupo traz o resumo

Migração, a ainda NÃO aplicada: `supabase/migrations/20261114100000_triagem_grava_cadastro_e_aviso_com_resumo.sql`. Depende das três da Onda B (`20261113130000`, `20261113131000`, `20261113132000`), que no banco vivo já estão aplicadas.

## O que muda em produção ao aplicar

- **B7.** Nasce `triagem_gravar_no_cadastro(triagem)` e `triagem_aplicar` passa a chamá-la, uma vez, quando a triagem REAL chega a `concluida` ou `entregue_equipe`. Ela grava só o que é seguro, só em campo vazio ou marcador: nome completo no lead (e no cliente, quando o lead já tem `cliente_id` e o nome do cliente é vazio, marcador ou o telefone), CEP e endereço do ViaCEP no cliente (campo por campo, só nos vazios, e só quando não mistura endereços), e uma nota em `leads.observacoes` com a primeira vez e o telefone alternativo MARCADO como não verificado. Nunca sobrescreve, nunca copia o telefone alternativo para telefone de lead ou de cliente, nunca cria cliente, nunca toca `converter_lead_em_cliente`.
- **B8.** O bloco 6 de `triagem_varrer` (aviso ao grupo da equipe) passa a trazer: primeiro nome, tipo (parceiro ou cliente final), anúncio e produto do atendimento, primeira vez, pediu preço, telefone confirmado que é outro, pediu para falar com a equipe, outras marcas e o link da conversa. Sem sobrenome, sem CEP, sem telefone. O título do anúncio e o produto passam por `_triagem_texto_de_aviso` (nova, pura) antes de entrar no texto: sem `*`, `_`, `~` nem crase, sem `http` nem `www`, sem caractere de controle (quebra de linha, tabulação) nem invisível de formatação (zero width, marcas de direção, soft hyphen, BOM), espaços colapsados, até 80 caracteres no anúncio e 60 no produto. O resto da varredura (freio, expiração, fila, retenção, chave de idempotência do aviso) é o mesmo texto de antes.
- **Hoje, com a triagem desligada, nada muda:** nenhuma triagem real termina, então nada é gravado, e nenhum aviso novo sai. O comportamento só aparece quando alguém sobe a escada para `teste` ou acima.
- As duas funções vivas são trocadas por TEXTO sobre a definição viva (`pg_get_functiondef`), depois de conferir o md5 do corpo. Se o corpo vivo mudou, a migração para sem mudar nada.
- Front: nada muda. Nenhuma coluna nova, nenhum valor novo de enum.

**O que a B7 faz e não faz, dito com todas as letras**

- O lead da conversa é `whatsapp_triagens.lead_id` (que vem de `whatsapp_conversas.lead_id`) ou, se estiver vazio, o lead mais novo com aquele `conversa_id`.
- Nome só entra se a triagem diz `nome_completo` (nome e sobrenome) e o nome passa de novo na validação forte do banco. Só o primeiro nome NÃO entra.
- "Marcador" é: vazio, só pontuação (".", "-"), só dígitos de telefone, ou "Lead WhatsApp 1995...". "Lucy", "Delta" e "Claro" NÃO são marcador: nome de perfil do WhatsApp que a pessoa já tem fica como está.
- O cliente só é tocado quando `leads.cliente_id` existe. A conversa com cliente já vinculado nem abre triagem (portão `cliente_vinculado`), e o portão de abertura também pula quem tem lead com `cliente_id` e o mesmo telefone. Na prática o ramo do cliente só trabalha quando o lead é convertido NO MEIO da triagem, ou quando o lead tem `cliente_id` com outro telefone.
- CEP e endereço, três casos. (1) O cadastro já tem OUTRO CEP: NADA do ViaCEP desta triagem entra e o rastro diz `cep_diferente_mantido`. (2) O CEP do cadastro está VAZIO: só entram o CEP e o endereço se rua, bairro, cidade e UF do cliente estão todos vazios ou iguais ao ViaCEP (sem diferença de caixa nem de espaço); se qualquer um está preenchido e diferente (ou o ViaCEP não trouxe aquele campo), NADA de endereço entra, nem o CEP, e o rastro diz `endereco_diferente_mantido` (um CEP novo em cima de uma rua antiga seria um endereço que não existe). (3) O cadastro tem o MESMO CEP: entram só os campos vazios.
- A nota nunca é repetida (marca "Triagem do WhatsApp" no texto) e vai DEPOIS da observação que já existia.
- Linha ocupada por outra sessão: `FOR UPDATE SKIP LOCKED` deixa o lead ou o cliente para trás, o rastro diz `adiado_lead` ou `adiado_cliente`, e a mensagem do contato é gravada do mesmo jeito. **Esse adiamento não é refeito sozinho**: a triagem já terminou e não passa mais por `triagem_aplicar`, e nenhuma rotina volta para reprocessá-la. Os dados continuam na própria triagem (nome, CEP, ViaCEP, primeira vez, alternativo), que a equipe lê na caixa; a janela é de milissegundos.
- Erro de escrita (gatilho, restrição): cada parte tem o seu bloco, e a falha de uma não desfaz a outra. São três: o lead (nome e nota), o nome do cliente e o CEP e endereço do cliente. Assim um gatilho de WhatsApp do cliente que barra a mudança de endereço NÃO leva o nome junto, e o contrário também. A parte que falhou é pulada, o rastro diz `erro_lead`, `erro_cliente_nome` ou `erro_cliente_endereco`, o log leva só o id da triagem e o SQLSTATE (nunca a mensagem do erro, que numa violação de unicidade traz o valor), e a mensagem do contato é gravada.
- Rastro: um evento `pulou` com `codigos` (nomes de campo, nunca valores) e um `motivo` que separa três coisas. `cadastro_adiado`: SÓ quando houve trava ou erro. `cadastro_gravado`: gravou pelo menos um campo (códigos de "mantido" podem vir junto). `cadastro_mantido`: não gravou nada por REGRA (`cep_diferente_mantido`, `endereco_diferente_mantido`), sem trava e sem erro. Assim "adiado" sempre quer dizer "o dado ficou só na triagem, por acidente", e "mantido" quer dizer "o cadastro foi preservado de propósito". (O tipo `pulou` é reaproveitado de propósito: acrescentar valor ao enum exigiria outra migração e só valeria depois do commit.)

Como as outras: cada bloco abaixo é para colar no SQL do banco vivo, um de cada vez. Os blocos de ANTES e DEPOIS só leem. O bloco de ENSAIO escreve de verdade para provar o comportamento e termina em `RAISE EXCEPTION`, que desfaz tudo; o resultado aparece na mensagem do erro. Nada aqui usa sequência: os ids são `gen_random_uuid()` e o protocolo do atendimento mora em `whatsapp_atendimento_seq`, que o erro desfaz junto.

**Rodado em 14/11/2026 num Postgres 17 local** com o esquema reduzido do ensaio da Onda B (as tabelas e as funções vivas do WhatsApp, leads e clientes com as colunas novas) e as quatro migrações aplicadas em ordem: o bloco do ENSAIO passou inteiro (15 linhas, de 0 a 13), o bloco local de gatilhos (3.2) passou (3 linhas), a prova de duas sessões (3.1) passou nos dois casos, as duas voltas (seção 5) devolveram os dois md5, e o ensaio antigo da Onda B (`docs/ensaio-triagem-dados.md`, 44 provas) continuou passando por inteiro com as funções trocadas, inclusive a 27 (aviso ao grupo). NÃO foi rodado no banco vivo: lá, quem aplica confere. Diferenças conhecidas do local para o vivo: o banco vivo tem gatilhos em `clientes` (telefone precisa receber WhatsApp, sem duplicata de WhatsApp) e em `leads` (aviso de lead novo ao grupo, enfileirado dentro da transação e desfeito junto); por isso as fixtures de cliente trazem `telefone` de celular válido e as provas comparam o telefone com o valor lido logo depois do insert, e não com um literal.

## 0. ANTES de aplicar

```sql
-- 0.1 As duas funções vivas são as que foram lidas em 14/11/2026. Esperado: triagem_aplicar d32589123febf3acbec9c233810fc55a,
-- triagem_varrer a7f66a3a0cf0b7791120829ffdcf30ae, converter_lead_em_cliente 91a97214034b636a61ed9136dd2dbbf3 (esta a migração NÃO toca),
-- e nenhuma das três funções novas (3 linhas no total).
SELECT proname, pronargs, md5(prosrc) AS md5_do_corpo
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND proname IN ('triagem_aplicar', 'triagem_varrer', 'converter_lead_em_cliente', 'triagem_gravar_no_cadastro', '_triagem_nome_e_marcador', '_triagem_texto_de_aviso')
ORDER BY 1;
```

Se algum md5 de `triagem_aplicar` ou `triagem_varrer` for diferente, alguém mudou a função depois de 14/11: NÃO aplique sem reler (a migração também para sozinha).

```sql
-- 0.2 As colunas que a migração lê e escreve. Esperado: 29 linhas (leads 4, clientes 6, whatsapp_atendimentos 2, whatsapp_triagens 17).
SELECT table_name, column_name FROM information_schema.columns
WHERE table_schema = 'public' AND (
  (table_name = 'leads' AND column_name IN ('nome', 'observacoes', 'cliente_id', 'conversa_id'))
  OR (table_name = 'clientes' AND column_name IN ('nome', 'cep', 'endereco', 'bairro', 'cidade', 'estado'))
  OR (table_name = 'whatsapp_atendimentos' AND column_name IN ('anuncio_titulo', 'produto'))
  OR (table_name = 'whatsapp_triagens' AND column_name IN ('lead_id', 'cep_endereco', 'nome_completo', 'primeira_vez',
        'telefone_confirmado', 'pediu_equipe', 'aviso_grupo_rodada', 'pediu_preco', 'cep', 'nome_informado', 'telefone_alternativo',
        'conversa_id', 'atendimento_id', 'modo', 'status', 'ramo', 'aviso_grupo_marcas')))
ORDER BY 1, 2;
```

```sql
-- 0.3 O estado da triagem. Esperado em 14/11/2026: desligada, 0 triagens, 0 eventos de cadastro.
SELECT (SELECT estado FROM public.whatsapp_triagem_config) AS estado,
       (SELECT count(*) FROM public.whatsapp_triagens) AS triagens,
       (SELECT count(*) FROM public.whatsapp_triagem_eventos WHERE tipo = 'pulou' AND detalhe ->> 'motivo' LIKE 'cadastro%') AS eventos_de_cadastro;
```

```sql
-- 0.4 Quantos leads e clientes têm nome de marcador hoje (o que a B7 poderia completar). Só informação.
SELECT 'leads com nome marcador' AS item, count(*) AS n FROM public.leads
 WHERE btrim(nome) = '' OR btrim(nome) ~ '^[\s.,;:!?*#_/-]+$' OR btrim(nome) ~ '^\+?[\d\s().-]{6,}$'
    OR lower(btrim(nome)) ~ '^(lead whatsapp|contato whatsapp|cliente whatsapp|whatsapp|sem nome|novo contato)([\s+().-]*\d[\d\s+().-]*)?$'
UNION ALL SELECT 'clientes com nome marcador', count(*) FROM public.clientes
 WHERE btrim(nome) = '' OR btrim(nome) ~ '^[\s.,;:!?*#_/-]+$' OR btrim(nome) ~ '^\+?[\d\s().-]{6,}$'
    OR lower(btrim(nome)) ~ '^(lead whatsapp|contato whatsapp|cliente whatsapp|whatsapp|sem nome|novo contato)([\s+().-]*\d[\d\s+().-]*)?$'
UNION ALL SELECT 'leads com cliente_id', count(*) FROM public.leads WHERE cliente_id IS NOT NULL;
```

```sql
-- 0.5 Gatilhos de UPDATE em leads e clientes que a gravação vai disparar. Esperado: nenhum mexe em telefone.
SELECT tgrelid::regclass AS tabela, tgname, pg_get_triggerdef(oid) AS definicao
FROM pg_trigger WHERE tgrelid IN ('public.leads'::regclass, 'public.clientes'::regclass) AND NOT tgisinternal ORDER BY 1, 2;
```

## 1. Aplicar

Aplique o arquivo da migração inteiro. Ele abre com `BEGIN;`, fecha com `COMMIT;` e termina com uma conferência que desfaz tudo se algo estiver fora do esperado: sobrecarga de função, `anon` ou `authenticated` executando, `service_role` sem EXECUTE, função sem `SECURITY DEFINER` e `search_path`, `triagem_gravar_no_cadastro` sem `lock_timeout`, `SKIP LOCKED` ou `QUERY_CANCELED`, escrita de telefone ou conversão de lead dentro da gravação, a troca que não pegou (a chamada não aparece exatamente uma vez em `triagem_aplicar`; o resumo não está em `triagem_varrer`; o texto antigo continua lá), texto do aviso que mencione CEP, telefone ou nome completo, o saneamento do texto do anúncio que erra e o marcador de nome que erra. A precondição já para sozinha, e diz quais colunas faltam, se alguma das 29 não existir.

## 2. DEPOIS: estrutura

```sql
-- 2.1 Funções: ACL, SECURITY DEFINER e search_path. Esperado: 5 linhas, anon_executa false e auth_executa false em todas,
-- servico_executa true. Só as puras _triagem_nome_e_marcador e _triagem_texto_de_aviso podem ter definer false; as outras três têm search_path=public, e
-- triagem_gravar_no_cadastro tem também lock_timeout=1s.
SELECT p.proname, p.prosecdef AS definer, p.proconfig::text AS config,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_executa,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_executa,
       has_function_privilege('service_role', p.oid, 'EXECUTE') AS servico_executa
FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
  AND p.proname IN ('triagem_gravar_no_cadastro', '_triagem_nome_e_marcador', '_triagem_texto_de_aviso', 'triagem_aplicar', 'triagem_varrer')
ORDER BY 1;
```

```sql
-- 2.2 A troca pegou e nada mais mudou. Esperado: aplicar_chama_a_gravacao 1; varrer_tem_resumo true; varrer_sem_texto_antigo true;
-- varrer_ainda_tem_o_freio true; converter_lead_em_cliente_intacta true (md5 91a97214...).
SELECT (SELECT (length(prosrc) - length(replace(prosrc, 'triagem_gravar_no_cadastro', ''))) / length('triagem_gravar_no_cadastro')
          FROM pg_proc WHERE proname = 'triagem_aplicar' AND pronamespace = 'public'::regnamespace) AS aplicar_chama_a_gravacao,
       (SELECT prosrc LIKE '%Primeira vez: sim%' AND prosrc LIKE '%Pediu para falar com a equipe%'
          FROM pg_proc WHERE proname = 'triagem_varrer' AND pronamespace = 'public'::regnamespace) AS varrer_tem_resumo,
       (SELECT prosrc NOT LIKE '%quer ser parceiro%' FROM pg_proc WHERE proname = 'triagem_varrer' AND pronamespace = 'public'::regnamespace) AS varrer_sem_texto_antigo,
       (SELECT prosrc LIKE '%freio_falhas_de_envio%' AND prosrc LIKE '%triagem_aviso:%' FROM pg_proc WHERE proname = 'triagem_varrer' AND pronamespace = 'public'::regnamespace) AS varrer_ainda_tem_o_freio,
       (SELECT md5(prosrc) = '91a97214034b636a61ed9136dd2dbbf3' FROM pg_proc WHERE proname = 'converter_lead_em_cliente' AND pronamespace = 'public'::regnamespace) AS converter_lead_em_cliente_intacta;
```

## 3. ENSAIO: seis conversas fictícias pelas funções da B7 e da B8

**Antes de rodar, três avisos.** (1) O ensaio escreve de verdade e conta o número do atendimento (`whatsapp_atendimento_seq` é uma tabela de contador, e a linha dela fica TRAVADA até o erro final desfazer): enquanto ele roda, ninguém consegue abrir um atendimento novo, e o ensaio dura alguns segundos. Rode com pouco movimento (fora do horário de pico), nunca no meio de uma campanha. (2) Ele abre com `SET LOCAL lock_timeout = '2s'`: se alguma linha que ele precisa estiver presa por outra sessão, ele desiste em 2 segundos com `canceling statement due to lock timeout` e desfaz tudo; é só rodar de novo daqui a pouco. (3) Ele NÃO cria gatilho, função nem qualquer DDL em `leads` ou `clientes` (a prova de gatilho que recusa escrita ficou só no banco local, seção 3.2): em tabela viva, um `CREATE TRIGGER` pede trava forte e poderia enfileirar atrás de uma transação longa e parar o cadastro inteiro.

Rode inteiro. Usa telefones fictícios (`55969999900NN`, de 41 a 49, e clientes `96999990051` a `96999990054`), liga a triagem em `teste` só para eles, simula as conversas, cria um lead e um cliente por cenário e termina em `RAISE EXCEPTION`, que desfaz TUDO: a configuração volta a `desligada`, nenhum lead, cliente, conversa, mensagem, triagem, evento nem aviso fica no banco. Pré-requisito: pelo menos uma instância de WhatsApp. Se o banco vivo não tem grupo da equipe ligado, a prova 11 diz isso em vez de provar o texto, e a 12 e a 13 não rodam. Todo `UPDATE` do roteiro tem `WHERE` (o banco vivo usa safeupdate, que recusa `UPDATE` sem `WHERE`); um teste do repositório varre o roteiro e a migração atrás de `UPDATE` ou `DELETE` sem `WHERE`.

```sql
DO $ensaio$
DECLARE
  v_sem_link text;
  v_linha text;
  v_inst uuid := (SELECT id FROM public.whatsapp_instancias LIMIT 1);
  v_r text[] := '{}';
  v_c1 uuid; v_c2 uuid; v_c3 uuid; v_c4 uuid; v_c5 uuid; v_c6 uuid; v_c7 uuid; v_c8 uuid; v_c9 uuid;
  v_l1 uuid; v_l2 uuid; v_l3 uuid; v_l4 uuid; v_l5 uuid; v_l6 uuid; v_l7 uuid; v_l8 uuid; v_l9 uuid;
  v_k2 uuid; v_k3 uuid; v_k4 uuid; v_k5 uuid; v_tel_k2 text;
  v_m uuid;
  v_s jsonb; v_a jsonb; v_j jsonb;
  v_t public.whatsapp_triagens%ROWTYPE;
  v_lead public.leads%ROWTYPE;
  v_cli public.clientes%ROWTYPE;
  v_ev jsonb;
  v_n integer; v_x text; v_txt text; v_grupo text; v_ok boolean;
  v_dados jsonb := jsonb_build_object(
    'nome_informado', 'Maria Souza', 'nome_completo', true, 'primeira_vez', 'sim', 'cep', '68900000',
    'cep_endereco', jsonb_build_object('cep', '68900-000', 'rua', 'Avenida Ensaio', 'bairro', 'Bairro Ensaio', 'cidade', 'Cidade Ensaio', 'estado', 'ap'),
    'telefone_alternativo', '96988887777', 'telefone_confirmado', 'alternativo', 'pediu_preco', true, 'pediu_equipe', true);
BEGIN
  -- se alguma linha estiver presa por outra sessão, o ensaio desiste em 2 s em vez de esperar e segurar quem vem atrás
  SET LOCAL lock_timeout = '2s';
  IF v_inst IS NULL THEN RAISE EXCEPTION 'FALHOU: não há instância de WhatsApp para o ensaio'; END IF;

  -- 0. liga em TESTE só para os telefones fictícios (grava direto: é ensaio, o erro final desfaz tudo)
  UPDATE public.whatsapp_triagem_config SET estado = 'ensaio' WHERE true;
  UPDATE public.whatsapp_triagem_config SET estado = 'teste', max_novas_por_hora = 100, max_novas_por_dia = 1000,
    numeros_teste = ARRAY['96999990041','96999990042','96999990043','96999990044','96999990045','96999990046','96999990047','96999990048','96999990049']
   WHERE true;
  v_r := array_append(v_r, '0) config em teste, só para os números fictícios do ensaio');

  -- CONVERSA 1: lead com nome "." e sem cliente. Termina em concluida com tudo preenchido.
  INSERT INTO public.leads (nome, telefone, origem, observacoes) VALUES ('.', '5596999990041', 'whatsapp', NULL) RETURNING id INTO v_l1;
  INSERT INTO public.whatsapp_conversas (instancia_id, telefone, lead_id) VALUES (v_inst, '5596999990041', v_l1) RETURNING id INTO v_c1;
  INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, zapi_message_id, direcao, tipo, status, texto, origem, recebido_em)
  VALUES (v_c1, v_inst, 'B7-1-A', 'entrada', 'texto', 'recebida', 'Oi', 'humano', now()) RETURNING id INTO v_m;
  v_s := public.triagem_ler_ou_abrir(v_c1, v_m);
  IF v_s ->> 'dono' <> 'triagem' THEN RAISE EXCEPTION 'FALHOU 1: dono % motivo %', v_s ->> 'dono', v_s ->> 'motivo'; END IF;
  SELECT * INTO v_t FROM public.whatsapp_triagens WHERE conversa_id = v_c1;
  IF v_t.lead_id IS DISTINCT FROM v_l1 THEN RAISE EXCEPTION 'FALHOU 1b: a triagem não ficou ligada ao lead'; END IF;
  v_a := public.triagem_aplicar(v_t.id, v_t.versao, jsonb_build_object('mensagem_id', v_m,
    'estado', jsonb_build_object('status', 'concluida'), 'gravar', v_dados,
    'aviso_grupo', jsonb_build_object('motivo', 'concluida', 'marcas', jsonb_build_array('telefone_nao_confirmado'))));
  IF NOT coalesce((v_a ->> 'ok')::boolean, false) THEN RAISE EXCEPTION 'FALHOU 1c: aplicar %', v_a; END IF;
  SELECT * INTO v_t FROM public.whatsapp_triagens WHERE id = v_t.id;
  SELECT * INTO v_lead FROM public.leads WHERE id = v_l1;
  IF v_t.status <> 'concluida' THEN RAISE EXCEPTION 'FALHOU 1d: status %', v_t.status; END IF;
  IF v_lead.nome <> 'Maria Souza' THEN RAISE EXCEPTION 'FALHOU 1e: nome do lead "%"', v_lead.nome; END IF;
  IF v_lead.telefone <> '5596999990041' THEN RAISE EXCEPTION 'FALHOU 1f: o telefone do lead mudou para %', v_lead.telefone; END IF;
  IF v_lead.observacoes NOT LIKE 'Triagem do WhatsApp (%): primeira vez: sim. Telefone alternativo informado no chat: (96) 98888-7777, NÃO verificado%'
     THEN RAISE EXCEPTION 'FALHOU 1g: nota "%"', v_lead.observacoes; END IF;
  IF v_t.telefone_alternativo_verificado THEN RAISE EXCEPTION 'FALHOU 1h: a triagem marcou o alternativo como verificado'; END IF;
  SELECT detalhe INTO v_ev FROM public.whatsapp_triagem_eventos WHERE triagem_id = v_t.id AND tipo = 'pulou' AND detalhe ->> 'motivo' LIKE 'cadastro%';
  IF v_ev ->> 'motivo' <> 'cadastro_gravado' OR v_ev -> 'codigos' <> '["nome_lead", "nota_lead"]'::jsonb THEN
    RAISE EXCEPTION 'FALHOU 1i: evento %', v_ev; END IF;
  v_r := array_append(v_r, format('1) concluida: lead "." virou o nome completo; nota "%s"; telefone do lead intacto; verificado = f; evento %s',
    regexp_replace(v_lead.observacoes, '^Triagem do WhatsApp \([0-9/]+\): ', 'Triagem do WhatsApp (data): '), v_ev::text));

  -- 2. idempotência: chamar de novo não muda nada e não cria evento
  v_j := public.triagem_gravar_no_cadastro(v_t.id);
  SELECT count(*) INTO v_n FROM public.whatsapp_triagem_eventos WHERE triagem_id = v_t.id AND tipo = 'pulou' AND detalhe ->> 'motivo' LIKE 'cadastro%';
  SELECT * INTO v_lead FROM public.leads WHERE id = v_l1;
  IF coalesce((v_j ->> 'gravou')::boolean, true) OR v_n <> 1
     OR (length(v_lead.observacoes) - length(replace(v_lead.observacoes, 'Triagem do WhatsApp', ''))) <> length('Triagem do WhatsApp') THEN
    RAISE EXCEPTION 'FALHOU 2: segunda chamada %, eventos %, nota "%"', v_j, v_n, v_lead.observacoes; END IF;
  v_r := array_append(v_r, '2) chamar de novo é inofensivo: gravou false, a nota continua uma só, nenhum evento a mais');

  -- 3. CONVERSA 2: lead "Lead WhatsApp ..." com cliente cujo nome é o telefone e sem CEP: nome e endereço entram no cliente
  INSERT INTO public.clientes (nome, telefone) VALUES ('96999990051', '96999990051') RETURNING id INTO v_k2;
  SELECT telefone INTO v_tel_k2 FROM public.clientes WHERE id = v_k2;
  INSERT INTO public.leads (nome, telefone, origem) VALUES ('Lead WhatsApp 96999990042', '5596999990042', 'whatsapp') RETURNING id INTO v_l2;
  INSERT INTO public.whatsapp_conversas (instancia_id, telefone, lead_id) VALUES (v_inst, '5596999990042', v_l2) RETURNING id INTO v_c2;
  INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, zapi_message_id, direcao, tipo, status, texto, origem, recebido_em)
  VALUES (v_c2, v_inst, 'B7-2-A', 'entrada', 'texto', 'recebida', 'Oi', 'humano', now()) RETURNING id INTO v_m;
  v_s := public.triagem_ler_ou_abrir(v_c2, v_m);
  IF v_s ->> 'dono' <> 'triagem' THEN RAISE EXCEPTION 'FALHOU 3: dono % motivo %', v_s ->> 'dono', v_s ->> 'motivo'; END IF;
  SELECT * INTO v_t FROM public.whatsapp_triagens WHERE conversa_id = v_c2;
  -- o portão de abertura pula quem já tem cliente (inclusive lead com cliente_id e o mesmo telefone), então o vínculo chega DEPOIS
  -- da abertura, como acontece quando a equipe ou outro canal converte o lead no meio da triagem
  UPDATE public.leads SET cliente_id = v_k2 WHERE id = v_l2;
  -- anúncio e produto do atendimento, para o aviso do grupo (prova 12)
  UPDATE public.whatsapp_atendimentos SET anuncio_titulo = 'Banner 3x1 em lona', produto = 'banner' WHERE conversa_id = v_c2 AND fechado_em IS NULL;
  v_a := public.triagem_aplicar(v_t.id, v_t.versao, jsonb_build_object('mensagem_id', v_m,
    'estado', jsonb_build_object('status', 'entregue_equipe'), 'gravar', v_dados,
    'aviso_grupo', jsonb_build_object('motivo', 'entregue_equipe', 'marcas', jsonb_build_array('pediu_preco', 'pediu_equipe', 'mandou_audio'))));
  SELECT * INTO v_lead FROM public.leads WHERE id = v_l2;
  SELECT * INTO v_cli FROM public.clientes WHERE id = v_k2;
  IF v_lead.nome <> 'Maria Souza' OR v_cli.nome <> 'Maria Souza' THEN RAISE EXCEPTION 'FALHOU 3b: nomes lead "%" cliente "%"', v_lead.nome, v_cli.nome; END IF;
  IF v_cli.cep <> '68900-000' OR v_cli.endereco <> 'Avenida Ensaio' OR v_cli.bairro <> 'Bairro Ensaio' OR v_cli.cidade <> 'Cidade Ensaio' OR v_cli.estado <> 'AP' THEN
    RAISE EXCEPTION 'FALHOU 3c: endereço do cliente % % % % %', v_cli.cep, v_cli.endereco, v_cli.bairro, v_cli.cidade, v_cli.estado; END IF;
  IF v_cli.telefone IS DISTINCT FROM v_tel_k2 OR v_lead.telefone <> '5596999990042'
     OR v_cli.telefone LIKE '%88887777%' OR coalesce(v_cli.observacoes, '') LIKE '%88887777%' THEN
    RAISE EXCEPTION 'FALHOU 3d: o telefone alternativo chegou ao telefone ou às observações do cliente (telefone %)', v_cli.telefone; END IF;
  SELECT detalhe INTO v_ev FROM public.whatsapp_triagem_eventos WHERE triagem_id = v_t.id AND tipo = 'pulou' AND detalhe ->> 'motivo' LIKE 'cadastro%';
  IF v_ev -> 'codigos' <> '["nome_lead", "nota_lead", "nome_cliente", "cep_cliente", "endereco_cliente"]'::jsonb THEN RAISE EXCEPTION 'FALHOU 3e: evento %', v_ev; END IF;
  v_r := array_append(v_r, format('3) entregue_equipe com lead e cliente: o cliente que se chamava pelo telefone ganhou o nome, o CEP %s e o endereço do ViaCEP (UF em maiúscula); o telefone do cliente continua o mesmo e o alternativo não foi para lugar nenhum além da nota do lead', v_cli.cep));

  -- 4. CONVERSA 3: nada é sobrescrito. Lead e cliente com nome de verdade, CEP diferente e endereço preenchido.
  INSERT INTO public.clientes (nome, telefone, cep, endereco, observacoes) VALUES ('Gráfica Cliente Antigo', '96999990052', '68901-111', 'Rua Antiga', 'obs do cliente') RETURNING id INTO v_k3;
  INSERT INTO public.leads (nome, telefone, origem, observacoes) VALUES ('Lucy', '5596999990043', 'whatsapp', 'obs antiga do lead') RETURNING id INTO v_l3;
  INSERT INTO public.whatsapp_conversas (instancia_id, telefone, lead_id) VALUES (v_inst, '5596999990043', v_l3) RETURNING id INTO v_c3;
  INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, zapi_message_id, direcao, tipo, status, texto, origem, recebido_em)
  VALUES (v_c3, v_inst, 'B7-3-A', 'entrada', 'texto', 'recebida', 'Oi', 'humano', now()) RETURNING id INTO v_m;
  v_s := public.triagem_ler_ou_abrir(v_c3, v_m);
  SELECT * INTO v_t FROM public.whatsapp_triagens WHERE conversa_id = v_c3;
  UPDATE public.leads SET cliente_id = v_k3 WHERE id = v_l3;
  v_a := public.triagem_aplicar(v_t.id, v_t.versao, jsonb_build_object('mensagem_id', v_m,
    'estado', jsonb_build_object('status', 'concluida'), 'gravar', v_dados));
  SELECT * INTO v_lead FROM public.leads WHERE id = v_l3;
  SELECT * INTO v_cli FROM public.clientes WHERE id = v_k3;
  IF v_lead.nome <> 'Lucy' OR v_cli.nome <> 'Gráfica Cliente Antigo' THEN RAISE EXCEPTION 'FALHOU 4a: nome sobrescrito (lead "%", cliente "%")', v_lead.nome, v_cli.nome; END IF;
  IF v_cli.cep <> '68901-111' OR v_cli.endereco <> 'Rua Antiga' OR v_cli.bairro IS NOT NULL OR v_cli.cidade IS NOT NULL OR v_cli.estado IS NOT NULL THEN
    RAISE EXCEPTION 'FALHOU 4b: o ViaCEP de outro CEP entrou no cadastro: % % % % %', v_cli.cep, v_cli.endereco, v_cli.bairro, v_cli.cidade, v_cli.estado; END IF;
  IF v_cli.observacoes <> 'obs do cliente' THEN RAISE EXCEPTION 'FALHOU 4c: observações do cliente mudaram'; END IF;
  IF v_lead.observacoes NOT LIKE E'obs antiga do lead\nTriagem do WhatsApp (%' THEN RAISE EXCEPTION 'FALHOU 4d: nota "%"', v_lead.observacoes; END IF;
  SELECT detalhe INTO v_ev FROM public.whatsapp_triagem_eventos WHERE triagem_id = v_t.id AND tipo = 'pulou' AND detalhe ->> 'motivo' LIKE 'cadastro%';
  IF v_ev ->> 'motivo' <> 'cadastro_gravado' OR v_ev -> 'codigos' <> '["nota_lead", "cep_diferente_mantido"]'::jsonb THEN RAISE EXCEPTION 'FALHOU 4e: evento %', v_ev; END IF;
  v_r := array_append(v_r, '4) nada é sobrescrito: nome de lead e de cliente que já são nomes ficam; CEP diferente mantém o cadastro inteiro (rua de um CEP nunca entra com cidade de outro); a nota entra DEPOIS da observação antiga; o motivo do rastro NÃO é adiado, é gravado (a nota entrou) com o código cep_diferente_mantido');

  -- 5. nome só com o primeiro nome (nome_completo false) não entra; a nota de primeira vez entra
  INSERT INTO public.leads (nome, telefone, origem) VALUES ('.', '5596999990044', 'whatsapp') RETURNING id INTO v_l4;
  INSERT INTO public.whatsapp_conversas (instancia_id, telefone, lead_id) VALUES (v_inst, '5596999990044', v_l4) RETURNING id INTO v_c4;
  INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, zapi_message_id, direcao, tipo, status, texto, origem, recebido_em)
  VALUES (v_c4, v_inst, 'B7-4-A', 'entrada', 'texto', 'recebida', 'Oi', 'humano', now()) RETURNING id INTO v_m;
  v_s := public.triagem_ler_ou_abrir(v_c4, v_m);
  SELECT * INTO v_t FROM public.whatsapp_triagens WHERE conversa_id = v_c4;
  v_a := public.triagem_aplicar(v_t.id, v_t.versao, jsonb_build_object('mensagem_id', v_m,
    'estado', jsonb_build_object('status', 'concluida'),
    'gravar', jsonb_build_object('nome_informado', 'Maria', 'nome_completo', false, 'primeira_vez', 'ja_cliente')));
  SELECT * INTO v_lead FROM public.leads WHERE id = v_l4;
  IF v_lead.nome <> '.' OR v_lead.observacoes NOT LIKE 'Triagem do WhatsApp (%): primeira vez: já é cliente.' THEN
    RAISE EXCEPTION 'FALHOU 5: nome "%", nota "%"', v_lead.nome, v_lead.observacoes; END IF;
  v_r := array_append(v_r, '5) só o primeiro nome: o lead continua com o marcador, e a nota leva só a primeira vez (sem telefone alternativo, sem a frase de não verificado)');

  -- 6. triagem que não terminou, ou em modo ensaio, não grava nada (a função de fora do fluxo também recusa)
  INSERT INTO public.leads (nome, telefone, origem) VALUES ('.', '5596999990045', 'whatsapp') RETURNING id INTO v_l5;
  INSERT INTO public.whatsapp_conversas (instancia_id, telefone, lead_id) VALUES (v_inst, '5596999990045', v_l5) RETURNING id INTO v_c5;
  INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, zapi_message_id, direcao, tipo, status, texto, origem, recebido_em)
  VALUES (v_c5, v_inst, 'B7-5-A', 'entrada', 'texto', 'recebida', 'Oi', 'humano', now()) RETURNING id INTO v_m;
  v_s := public.triagem_ler_ou_abrir(v_c5, v_m);
  SELECT * INTO v_t FROM public.whatsapp_triagens WHERE conversa_id = v_c5;
  v_a := public.triagem_aplicar(v_t.id, v_t.versao, jsonb_build_object('mensagem_id', v_m, 'gravar', v_dados));
  v_j := public.triagem_gravar_no_cadastro(v_t.id);
  SELECT * INTO v_lead FROM public.leads WHERE id = v_l5;
  IF v_lead.nome <> '.' OR v_lead.observacoes IS NOT NULL OR v_j ->> 'motivo' <> 'fora_do_escopo' THEN
    RAISE EXCEPTION 'FALHOU 6: triagem ativa gravou no cadastro (lead "%", função %)', v_lead.nome, v_j; END IF;
  UPDATE public.whatsapp_triagens SET status = 'concluida' WHERE id = v_t.id;
  UPDATE public.whatsapp_triagem_config SET estado = 'ensaio' WHERE true;
  v_j := public.triagem_gravar_no_cadastro(v_t.id);
  UPDATE public.whatsapp_triagem_config SET estado = 'teste' WHERE true;
  SELECT * INTO v_lead FROM public.leads WHERE id = v_l5;
  IF v_lead.nome <> '.' OR v_j ->> 'motivo' <> 'fora_do_escopo' THEN RAISE EXCEPTION 'FALHOU 6b: com a configuração em ensaio gravou (%)', v_j; END IF;
  v_r := array_append(v_r, '6) triagem ativa, ou concluida com a configuração em ensaio, não grava nada: a função devolve fora_do_escopo');

  -- 7. CEP VAZIO no cadastro, mas rua ou cidade já preenchidas: endereço de outro lugar, nada de endereço entra (nem o CEP)
  INSERT INTO public.clientes (nome, telefone, endereco, cidade) VALUES ('96999990053', '96999990053', 'Rua do Cadastro', 'Macapá') RETURNING id INTO v_k4;
  INSERT INTO public.leads (nome, telefone, origem) VALUES ('.', '5596999990046', 'whatsapp') RETURNING id INTO v_l6;
  INSERT INTO public.whatsapp_conversas (instancia_id, telefone, lead_id) VALUES (v_inst, '5596999990046', v_l6) RETURNING id INTO v_c6;
  INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, zapi_message_id, direcao, tipo, status, texto, origem, recebido_em)
  VALUES (v_c6, v_inst, 'B7-6-A', 'entrada', 'texto', 'recebida', 'Oi', 'humano', now()) RETURNING id INTO v_m;
  v_s := public.triagem_ler_ou_abrir(v_c6, v_m);
  SELECT * INTO v_t FROM public.whatsapp_triagens WHERE conversa_id = v_c6;
  UPDATE public.leads SET cliente_id = v_k4 WHERE id = v_l6;
  v_a := public.triagem_aplicar(v_t.id, v_t.versao, jsonb_build_object('mensagem_id', v_m,
    'estado', jsonb_build_object('status', 'concluida'), 'gravar', v_dados));
  SELECT * INTO v_cli FROM public.clientes WHERE id = v_k4;
  SELECT detalhe INTO v_ev FROM public.whatsapp_triagem_eventos WHERE triagem_id = v_t.id AND tipo = 'pulou' AND detalhe ->> 'motivo' LIKE 'cadastro%';
  IF btrim(coalesce(v_cli.cep, '')) <> '' OR v_cli.endereco <> 'Rua do Cadastro' OR v_cli.cidade <> 'Macapá'
     OR v_cli.bairro IS NOT NULL OR v_cli.estado IS NOT NULL THEN
    RAISE EXCEPTION 'FALHOU 7a: o ViaCEP entrou em cima de endereço diferente: % % % % %', v_cli.cep, v_cli.endereco, v_cli.bairro, v_cli.cidade, v_cli.estado; END IF;
  IF v_cli.nome <> 'Maria Souza' THEN RAISE EXCEPTION 'FALHOU 7b: o nome do cliente não entrou ("%")', v_cli.nome; END IF;
  IF v_ev ->> 'motivo' <> 'cadastro_gravado' OR v_ev -> 'codigos' <> '["nome_lead", "nota_lead", "nome_cliente", "endereco_diferente_mantido"]'::jsonb THEN
    RAISE EXCEPTION 'FALHOU 7c: evento %', v_ev; END IF;
  v_r := array_append(v_r, '7) CEP vazio com rua e cidade de outro lugar: nenhum endereço entra, nem o CEP (rastro endereco_diferente_mantido, que não é adiado); o nome do cliente entra do mesmo jeito');
  -- 7d. CEP vazio e o que existe é IGUAL ao ViaCEP (caixa e espaços à parte): o CEP e os campos vazios entram, os preenchidos ficam como estão
  INSERT INTO public.clientes (nome, telefone, endereco, cidade) VALUES ('Cliente Igual', '96999990054', 'avenida  ENSAIO ', 'cidade ensaio') RETURNING id INTO v_k5;
  INSERT INTO public.leads (nome, telefone, origem) VALUES ('.', '5596999990048', 'whatsapp') RETURNING id INTO v_l8;
  INSERT INTO public.whatsapp_conversas (instancia_id, telefone, lead_id) VALUES (v_inst, '5596999990048', v_l8) RETURNING id INTO v_c8;
  INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, zapi_message_id, direcao, tipo, status, texto, origem, recebido_em)
  VALUES (v_c8, v_inst, 'B7-8-A', 'entrada', 'texto', 'recebida', 'Oi', 'humano', now()) RETURNING id INTO v_m;
  v_s := public.triagem_ler_ou_abrir(v_c8, v_m);
  SELECT * INTO v_t FROM public.whatsapp_triagens WHERE conversa_id = v_c8;
  UPDATE public.leads SET cliente_id = v_k5 WHERE id = v_l8;
  v_a := public.triagem_aplicar(v_t.id, v_t.versao, jsonb_build_object('mensagem_id', v_m,
    'estado', jsonb_build_object('status', 'concluida'), 'gravar', v_dados));
  SELECT * INTO v_cli FROM public.clientes WHERE id = v_k5;
  SELECT detalhe INTO v_ev FROM public.whatsapp_triagem_eventos WHERE triagem_id = v_t.id AND tipo = 'pulou' AND detalhe ->> 'motivo' LIKE 'cadastro%';
  IF v_cli.cep <> '68900-000' OR v_cli.bairro <> 'Bairro Ensaio' OR v_cli.estado <> 'AP'
     OR v_cli.endereco <> 'avenida  ENSAIO ' OR v_cli.cidade <> 'cidade ensaio' OR v_cli.nome <> 'Cliente Igual' THEN
    RAISE EXCEPTION 'FALHOU 7d: cliente com endereço igual: % % % % % %', v_cli.nome, v_cli.cep, v_cli.endereco, v_cli.bairro, v_cli.cidade, v_cli.estado; END IF;
  IF v_ev ->> 'motivo' <> 'cadastro_gravado' OR v_ev -> 'codigos' <> '["nome_lead", "nota_lead", "cep_cliente", "endereco_cliente"]'::jsonb THEN
    RAISE EXCEPTION 'FALHOU 7e: evento %', v_ev; END IF;
  v_r := array_append(v_r, '7d) CEP vazio e endereço igual ao do ViaCEP (caixa e espaços à parte): o CEP e os campos vazios entram, rua e cidade preenchidas ficam como estavam, o nome do cliente não muda');

  -- 8. o rastro nunca leva dado privado (nome, CEP, telefone) em evento
  SELECT count(*) INTO v_n FROM public.whatsapp_triagem_eventos
   WHERE detalhe::text ~* '(souza|maria|68900|9888|99999|avenida|bairro ensaio|rua do cadastro|macap|cliente igual)';
  IF v_n <> 0 THEN RAISE EXCEPTION 'FALHOU 8: % evento(s) com dado privado', v_n; END IF;
  v_r := array_append(v_r, '8) nenhum evento tem nome, CEP, rua ou telefone');

  -- 9. ninguém de fora executa as funções novas
  v_ok := false;
  BEGIN SET LOCAL ROLE anon; PERFORM public.triagem_gravar_no_cadastro(v_t.id);
  EXCEPTION WHEN insufficient_privilege THEN v_ok := true; END;
  RESET ROLE;
  IF NOT v_ok THEN RAISE EXCEPTION 'FALHOU 9: anon executou triagem_gravar_no_cadastro'; END IF;
  v_ok := false;
  BEGIN SET LOCAL ROLE authenticated; PERFORM public._triagem_nome_e_marcador('x');
  EXCEPTION WHEN insufficient_privilege THEN v_ok := true; END;
  RESET ROLE;
  IF NOT v_ok THEN RAISE EXCEPTION 'FALHOU 9b: authenticated executou _triagem_nome_e_marcador'; END IF;
  v_r := array_append(v_r, '9) anon e authenticated levam "permission denied" nas duas funções novas');

  -- 10. marcador de nome
  IF NOT (public._triagem_nome_e_marcador('.') AND public._triagem_nome_e_marcador('Lead WhatsApp 19958714824') AND public._triagem_nome_e_marcador('96999990051'))
     OR public._triagem_nome_e_marcador('Lucy') OR public._triagem_nome_e_marcador('Delta') OR public._triagem_nome_e_marcador('Claro') THEN
    RAISE EXCEPTION 'FALHOU 10: marcador de nome'; END IF;
  v_r := array_append(v_r, '10) marcador de nome: ".", "Lead WhatsApp 1995..." e telefone são marcadores; "Lucy", "Delta" e "Claro" não são');

  -- 11/12. B8: o aviso do grupo com o resumo
  v_grupo := public.grupo_equipe_destino();
  v_s := public.triagem_varrer();
  SELECT count(*), max(variaveis ->> 'texto') INTO v_n, v_txt FROM public.notificacoes_fila WHERE idempotency_key = 'triagem_aviso:' || (SELECT id FROM public.whatsapp_triagens WHERE conversa_id = v_c2);
  IF v_grupo IS NOT NULL THEN
    IF v_n <> 1 THEN RAISE EXCEPTION 'FALHOU 11: % avisos na fila (varrer %)', v_n, v_s; END IF;
    IF v_txt NOT LIKE '%Triagem do robô: entregue equipe%' OR v_txt NOT LIKE E'%\n👤 Maria · cliente final\n%'
       OR v_txt NOT LIKE E'%\n📣 Anúncio: Banner 3x1 em lona · Produto: banner\n%' OR v_txt NOT LIKE E'%\n🆕 Primeira vez: sim\n%'
       OR v_txt NOT LIKE E'%\n💲 Pediu preço\n%' OR v_txt NOT LIKE E'%\n📞 O telefone de contato é outro, sem verificação\n%'
       OR v_txt NOT LIKE E'%\n🙋 Pediu para falar com a equipe\n%' OR v_txt NOT LIKE E'%\n🏷️ mandou audio\n%'
       OR v_txt NOT LIKE '%👉 Responder: https://bexprint.com.br/whatsapp?conversa=' || v_c2 THEN
      RAISE EXCEPTION 'FALHOU 11b: texto do aviso: %', v_txt; END IF;
    -- o link leva o id da conversa (um uuid, que pode ter oito dígitos seguidos): o resto do texto é que não pode ter
    v_sem_link := regexp_replace(v_txt, 'conversa=[0-9a-fA-F-]{36}', 'conversa=', 'g');
    IF v_sem_link LIKE '%' || v_c2::text || '%' OR v_sem_link !~ 'conversa=$' THEN
      RAISE EXCEPTION 'FALHOU 11c1: o id da conversa não está só no link: %', v_txt; END IF;
    IF v_sem_link ~* '(souza|68900|9888|99999|avenida|bairro ensaio|cidade ensaio|revend|pediu preco.*pediu preco)' OR v_sem_link ~ '\d{8,}' THEN
      RAISE EXCEPTION 'FALHOU 11c: o aviso leva dado privado ou palavra proibida: %', v_sem_link; END IF;
    v_r := array_append(v_r, format('11) aviso do grupo com resumo (varrer enfileirou %s): %s', v_s ->> 'avisos_enfileirados', replace(v_txt, E'\n', ' | ')));
    -- 12. sem anúncio, sem produto e do ramo parceiro: a linha do anúncio some e o tipo muda; marca repetida não aparece duas vezes
    INSERT INTO public.leads (nome, telefone, origem) VALUES ('.', '5596999990047', 'whatsapp') RETURNING id INTO v_l7;
    INSERT INTO public.whatsapp_conversas (instancia_id, telefone, lead_id) VALUES (v_inst, '5596999990047', v_l7) RETURNING id INTO v_c7;
    INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, zapi_message_id, direcao, tipo, status, texto, origem, recebido_em)
    VALUES (v_c7, v_inst, 'B7-7-A', 'entrada', 'texto', 'recebida', 'Oi', 'humano', now()) RETURNING id INTO v_m;
    v_s := public.triagem_ler_ou_abrir(v_c7, v_m);
    SELECT * INTO v_t FROM public.whatsapp_triagens WHERE conversa_id = v_c7;
    v_a := public.triagem_aplicar(v_t.id, v_t.versao, jsonb_build_object('mensagem_id', v_m,
      'estado', jsonb_build_object('status', 'concluida', 'ramo', 'parceiro', 'ramo_motivo', 'palavra'),
      'gravar', jsonb_build_object('primeira_vez', 'nao_sei'),
      'aviso_grupo', jsonb_build_object('motivo', 'concluida', 'marcas', '[]'::jsonb)));
    v_s := public.triagem_varrer();
    SELECT max(variaveis ->> 'texto') INTO v_txt FROM public.notificacoes_fila WHERE idempotency_key = 'triagem_aviso:' || v_t.id;
    IF v_txt NOT LIKE E'%\n👤 Contato sem nome · parceiro\n%' OR v_txt LIKE '%📣%' OR v_txt LIKE '%💲%' OR v_txt LIKE '%🙋%' OR v_txt LIKE '%📞%'
       OR v_txt NOT LIKE E'%\n❔ Primeira vez: não soube dizer\n%' THEN
      RAISE EXCEPTION 'FALHOU 12: texto do aviso do parceiro sem anúncio: %', v_txt; END IF;
    v_r := array_append(v_r, format('12) aviso de parceiro sem anúncio nem produto e sem nome: %s', replace(v_txt, E'\n', ' | ')));
    -- 13. título de anúncio e produto MALICIOSOS: formatação do WhatsApp, link, quebra de linha, invisíveis e tamanho
    INSERT INTO public.leads (nome, telefone, origem) VALUES ('.', '5596999990049', 'whatsapp') RETURNING id INTO v_l9;
    INSERT INTO public.whatsapp_conversas (instancia_id, telefone, lead_id) VALUES (v_inst, '5596999990049', v_l9) RETURNING id INTO v_c9;
    INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, zapi_message_id, direcao, tipo, status, texto, origem, recebido_em)
    VALUES (v_c9, v_inst, 'B7-9-A', 'entrada', 'texto', 'recebida', 'Oi', 'humano', now()) RETURNING id INTO v_m;
    v_s := public.triagem_ler_ou_abrir(v_c9, v_m);
    SELECT * INTO v_t FROM public.whatsapp_triagens WHERE conversa_id = v_c9;
    UPDATE public.whatsapp_atendimentos
       SET anuncio_titulo = E'*Promo* _grátis_ ~x~ `y`\n\thttps://evil.example/a?b=1 www.evil.com' || chr(8203) || chr(8238) || '  zero' || chr(8203) || 'width ' || repeat('x', 200),
           produto = 'banner *negrito* http://x.y'
     WHERE conversa_id = v_c9 AND fechado_em IS NULL;
    v_a := public.triagem_aplicar(v_t.id, v_t.versao, jsonb_build_object('mensagem_id', v_m,
      'estado', jsonb_build_object('status', 'concluida'), 'gravar', jsonb_build_object('primeira_vez', 'sim'),
      'aviso_grupo', jsonb_build_object('motivo', 'concluida', 'marcas', '[]'::jsonb)));
    v_s := public.triagem_varrer();
    SELECT max(variaveis ->> 'texto') INTO v_txt FROM public.notificacoes_fila WHERE idempotency_key = 'triagem_aviso:' || v_t.id;
    v_linha := substring(v_txt FROM E'📣[^\n]*');
    IF v_linha IS DISTINCT FROM E'📣 Anúncio: Promo grátis x y zerowidth ' || repeat('x', 53) || ' · Produto: banner negrito'
       OR array_length(string_to_array(v_txt, E'\n'), 1) <> 5
       OR v_linha ~ '[*_~`]' OR v_linha ~* '(http|www)' OR v_linha ~ (chr(8203) || '|' || chr(8238)) THEN
      RAISE EXCEPTION 'FALHOU 13: título malicioso chegou ao aviso: [%] texto [%]', v_linha, v_txt; END IF;
    v_r := array_append(v_r, format('13) título e produto maliciosos (negrito, itálico, crase, link, www, quebra de linha, invisíveis, 200 letras): %s', v_linha));
  ELSE
    IF v_n <> 0 THEN RAISE EXCEPTION 'FALHOU 11c: sem grupo da equipe o aviso foi enfileirado'; END IF;
    v_r := array_append(v_r, '11) aviso do grupo: este banco não tem grupo da equipe ligado, então nada foi enfileirado (o aviso espera); o texto novo não foi provado aqui');
  END IF;

  RAISE EXCEPTION E'ENSAIO OK (tudo desfeito de propósito):\n%', array_to_string(v_r, E'\n');
END
$ensaio$;
```

Esperado, na mensagem do erro (15 linhas: 0 a 13, com a 7d; a 11, a 12 e a 13 trazem o texto do aviso, e a 11 e a 12 o id da conversa):

```
ERRO: ENSAIO OK (tudo desfeito de propósito):
0) config em teste, só para os números fictícios do ensaio
1) concluida: lead "." virou o nome completo; nota "Triagem do WhatsApp (data): primeira vez: sim. Telefone alternativo informado no chat: (96) 98888-7777, NÃO verificado (a triagem não prova que o número é do contato)."; telefone do lead intacto; verificado = f; evento {"motivo": "cadastro_gravado", "codigos": ["nome_lead", "nota_lead"]}
2) chamar de novo é inofensivo: gravou false, a nota continua uma só, nenhum evento a mais
3) entregue_equipe com lead e cliente: o cliente que se chamava pelo telefone ganhou o nome, o CEP 68900-000 e o endereço do ViaCEP (UF em maiúscula); o telefone do cliente continua o mesmo e o alternativo não foi para lugar nenhum além da nota do lead
4) nada é sobrescrito: nome de lead e de cliente que já são nomes ficam; CEP diferente mantém o cadastro inteiro (rua de um CEP nunca entra com cidade de outro); a nota entra DEPOIS da observação antiga; o motivo do rastro NÃO é adiado, é gravado (a nota entrou) com o código cep_diferente_mantido
5) só o primeiro nome: o lead continua com o marcador, e a nota leva só a primeira vez (sem telefone alternativo, sem a frase de não verificado)
6) triagem ativa, ou concluida com a configuração em ensaio, não grava nada: a função devolve fora_do_escopo
7) CEP vazio com rua e cidade de outro lugar: nenhum endereço entra, nem o CEP (rastro endereco_diferente_mantido, que não é adiado); o nome do cliente entra do mesmo jeito
7d) CEP vazio e endereço igual ao do ViaCEP (caixa e espaços à parte): o CEP e os campos vazios entram, rua e cidade preenchidas ficam como estavam, o nome do cliente não muda
8) nenhum evento tem nome, CEP, rua ou telefone
9) anon e authenticated levam "permission denied" nas duas funções novas
10) marcador de nome: ".", "Lead WhatsApp 1995..." e telefone são marcadores; "Lucy", "Delta" e "Claro" não são
11) aviso do grupo com resumo (varrer enfileirou 2): 🧾 Triagem do robô: entregue equipe | 👤 Maria · cliente final | 📣 Anúncio: Banner 3x1 em lona · Produto: banner | 🆕 Primeira vez: sim | 💲 Pediu preço | 📞 O telefone de contato é outro, sem verificação | 🙋 Pediu para falar com a equipe | 🏷️ mandou audio | 👉 Responder: https://bexprint.com.br/whatsapp?conversa=<id da conversa>
12) aviso de parceiro sem anúncio nem produto e sem nome: 🧾 Triagem do robô: concluida | 👤 Contato sem nome · parceiro | ❔ Primeira vez: não soube dizer | 👉 Responder: https://bexprint.com.br/whatsapp?conversa=<id da conversa>
13) título e produto maliciosos (negrito, itálico, crase, link, www, quebra de linha, invisíveis, 200 letras): 📣 Anúncio: Promo grátis x y zerowidth xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx · Produto: banner negrito
```

O que cada prova garante:

- 1: triagem real `concluida` com lead de nome "." e sem cliente: o lead ganha o nome completo, a nota nasce com primeira vez e o alternativo formatado e marcado NÃO verificado, o telefone do lead não muda, a triagem não marca o alternativo como verificado, e o evento traz só códigos.
- 2: chamar a função de novo é inofensivo (nota única, nenhum evento a mais).
- 3: `entregue_equipe` com lead que ganhou `cliente_id` no meio da triagem: o cliente que se chamava pelo próprio telefone ganha o nome, o CEP no formato `NNNNN-NNN` e o endereço do ViaCEP (rua, bairro, cidade, UF em maiúscula). O telefone do cliente continua o mesmo, e o alternativo não está no telefone nem nas observações do cliente.
- 4: nada é sobrescrito: nome de lead e de cliente que já são nomes ficam; CEP diferente mantém o cadastro inteiro; a nota entra depois da observação antiga; o rastro é `cadastro_gravado` (a nota entrou) com `cep_diferente_mantido`, nunca `cadastro_adiado`.
- 5: só o primeiro nome: o lead continua com o marcador e a nota leva só a primeira vez.
- 6: triagem ativa, ou concluída com a configuração em ensaio, não grava nada.
- 7: cliente com CEP vazio mas rua e cidade de outro lugar: nenhum endereço entra, nem o CEP, o nome do cliente entra do mesmo jeito, e o rastro diz `endereco_diferente_mantido` (não é adiado). 7d: cliente com CEP vazio e endereço igual ao do ViaCEP (caixa e espaços à parte): o CEP e os campos vazios entram, os preenchidos ficam como estavam.
- 8: nenhum evento da base tem nome, CEP, rua ou telefone.
- 9: `anon` e `authenticated` levam "permission denied".
- 10: o marcador de nome.
- 11: o aviso do grupo com o resumo completo, sem sobrenome, CEP, telefone nem a palavra proibida; marca repetida (`pediu_preco`, `pediu_equipe`) não aparece duas vezes. As conferências de dígitos e de palavras proibidas (11c) rodam no texto SEM o link, porque o id da conversa no link é um uuid e pode ter oito dígitos seguidos.
- 12: aviso de parceiro sem anúncio, sem produto e sem nome: as linhas que não se aplicam somem.
- 13: título de anúncio e produto maliciosos (negrito, itálico, riscado, crase, link `https://` e `www`, quebra de linha, tabulação, zero width, marca de direção, 200 letras): a linha do anúncio sai limpa e com no máximo 80 caracteres, e o aviso continua com 5 linhas (nada quebrou a mensagem em linhas novas).

Não provado no bloco: a trava de linha de outra sessão (uma sessão só não consegue) e o gatilho que recusa escrita (exige DDL em `leads` e `clientes`, que não se faz em tabela viva). As duas provas foram rodadas à parte no Postgres local (3.1 e 3.2) e NÃO devem ser rodadas no banco vivo.

### 3.1 Prova em duas sessões: lead ou cliente travado por outra sessão (só no banco local)

Sessão A segura a linha e dorme 5 s; sessão B termina a triagem logo em seguida.

```sql
-- sessão A (primeiro o lead; depois repita com a linha do CLIENTE do lead)
BEGIN; SELECT 1 FROM public.leads WHERE id = '<lead>' FOR UPDATE; SELECT pg_sleep(5); COMMIT;
-- sessão B (um segundo depois)
SELECT public.triagem_aplicar('<triagem>', <versao>, '{"mensagem_id":"<msg>","estado":{"status":"concluida"},"gravar":{"nome_informado":"Maria Souza","nome_completo":true,"primeira_vez":"sim"}}'::jsonb) ->> 'ok';
```

Resultado literal no Postgres local, nos dois casos: `true` em 0,13 segundo (o tempo de abrir o `psql`; não esperou a trava), triagem `concluida`. Com o LEAD travado: lead com o nome "." e sem nota, evento `{"motivo": "cadastro_adiado", "codigos": ["adiado_lead"]}`. Com o CLIENTE travado: o lead ganhou nome e nota e o cliente continuou com o nome antigo, evento `{"motivo": "cadastro_adiado", "codigos": ["nome_lead", "nota_lead", "adiado_cliente"]}`.

### 3.2 Gatilho que recusa a escrita, uma parte de cada vez (só no banco local)

Cria uma função que sempre falha e um gatilho `BEFORE UPDATE` por cenário, termina a triagem, confere e desfaz tudo. Prova que cada parte é independente: o gatilho no lead não derruba a mensagem; o gatilho que barra a mudança de CEP do cliente NÃO leva o nome do cliente junto; o gatilho que barra a mudança de nome do cliente NÃO leva o endereço junto.

```sql
DO $local$
DECLARE
  v_inst uuid := (SELECT id FROM public.whatsapp_instancias LIMIT 1);
  v_r text[] := '{}';
  i integer; v_tel text; v_l uuid; v_c uuid; v_k uuid; v_m uuid; v_s jsonb; v_a jsonb; v_ev jsonb;
  v_t public.whatsapp_triagens%ROWTYPE; v_lead public.leads%ROWTYPE; v_cli public.clientes%ROWTYPE;
  v_ddl text[] := ARRAY[
    'BEFORE UPDATE ON public.leads FOR EACH ROW WHEN (NEW.id = %L)',
    'BEFORE UPDATE ON public.clientes FOR EACH ROW WHEN (NEW.id = %L AND NEW.cep IS DISTINCT FROM OLD.cep)',
    'BEFORE UPDATE ON public.clientes FOR EACH ROW WHEN (NEW.id = %L AND NEW.nome IS DISTINCT FROM OLD.nome)'];
  v_tab text[] := ARRAY['leads', 'clientes', 'clientes'];
  v_esperado jsonb[] := ARRAY['["erro_lead"]'::jsonb,
    '["nome_lead", "nota_lead", "nome_cliente", "erro_cliente_endereco"]'::jsonb,
    '["nome_lead", "nota_lead", "cep_cliente", "endereco_cliente", "erro_cliente_nome"]'::jsonb];
BEGIN
  SET LOCAL lock_timeout = '2s';
  UPDATE public.whatsapp_triagem_config SET estado = 'ensaio' WHERE true;
  UPDATE public.whatsapp_triagem_config SET estado = 'teste', max_novas_por_hora = 100, max_novas_por_dia = 1000,
    numeros_teste = ARRAY['96999990071','96999990072','96999990073'] WHERE true;
  EXECUTE 'CREATE FUNCTION public._ensaio_b7_falha() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION ''falha de ensaio''; END $f$';
  FOR i IN 1..3 LOOP
    v_tel := '9699999007' || i;
    INSERT INTO public.leads (nome, telefone, origem) VALUES ('.', '55' || v_tel, 'whatsapp') RETURNING id INTO v_l;
    INSERT INTO public.whatsapp_conversas (instancia_id, telefone, lead_id) VALUES (v_inst, '55' || v_tel, v_l) RETURNING id INTO v_c;
    INSERT INTO public.whatsapp_mensagens (conversa_id, instancia_id, zapi_message_id, direcao, tipo, status, texto, origem, recebido_em)
    VALUES (v_c, v_inst, 'B7-L-' || i, 'entrada', 'texto', 'recebida', 'Oi', 'humano', now()) RETURNING id INTO v_m;
    v_s := public.triagem_ler_ou_abrir(v_c, v_m);
    SELECT * INTO v_t FROM public.whatsapp_triagens WHERE conversa_id = v_c;
    IF i > 1 THEN
      INSERT INTO public.clientes (nome, telefone) VALUES (v_tel, v_tel) RETURNING id INTO v_k;
      UPDATE public.leads SET cliente_id = v_k WHERE id = v_l;
    END IF;
    EXECUTE format('CREATE TRIGGER zz_ensaio_b7_falha ' || v_ddl[i] || ' EXECUTE FUNCTION public._ensaio_b7_falha()', CASE WHEN i = 1 THEN v_l ELSE v_k END);
    v_a := public.triagem_aplicar(v_t.id, v_t.versao, jsonb_build_object('mensagem_id', v_m,
      'estado', jsonb_build_object('status', 'concluida'),
      'gravar', jsonb_build_object('nome_informado', 'Maria Souza', 'nome_completo', true, 'primeira_vez', 'sim', 'cep', '68900000',
        'cep_endereco', jsonb_build_object('cep', '68900-000', 'rua', 'Avenida Ensaio', 'bairro', 'Bairro Ensaio', 'cidade', 'Cidade Ensaio', 'estado', 'ap'))));
    EXECUTE format('DROP TRIGGER zz_ensaio_b7_falha ON public.%I', v_tab[i]);
    SELECT * INTO v_t FROM public.whatsapp_triagens WHERE id = v_t.id;
    SELECT * INTO v_lead FROM public.leads WHERE id = v_l;
    SELECT detalhe INTO v_ev FROM public.whatsapp_triagem_eventos WHERE triagem_id = v_t.id AND tipo = 'pulou' AND detalhe ->> 'motivo' LIKE 'cadastro%';
    IF NOT coalesce((v_a ->> 'ok')::boolean, false) OR v_t.status <> 'concluida' OR v_t.nome_informado <> 'Maria Souza'
       OR v_ev ->> 'motivo' <> 'cadastro_adiado' OR v_ev -> 'codigos' <> v_esperado[i] THEN
      RAISE EXCEPTION 'FALHOU L%: aplicar % status % evento %', i, v_a, v_t.status, v_ev; END IF;
    IF i = 1 AND v_lead.nome <> '.' THEN RAISE EXCEPTION 'FALHOU L1b: o lead mudou apesar do gatilho'; END IF;
    IF i > 1 THEN
      SELECT * INTO v_cli FROM public.clientes WHERE id = v_k;
      IF i = 2 AND (v_cli.nome <> 'Maria Souza' OR btrim(coalesce(v_cli.cep, '')) <> '' OR v_cli.endereco IS NOT NULL) THEN
        RAISE EXCEPTION 'FALHOU L2b: o nome do cliente foi junto com o endereço (nome "%", cep "%")', v_cli.nome, v_cli.cep; END IF;
      IF i = 3 AND (v_cli.nome <> v_tel OR v_cli.cep <> '68900-000' OR v_cli.endereco <> 'Avenida Ensaio') THEN
        RAISE EXCEPTION 'FALHOU L3b: o endereço foi junto com o nome (nome "%", cep "%")', v_cli.nome, v_cli.cep; END IF;
    END IF;
    v_r := array_append(v_r, format('L%s) gatilho em %s recusa a escrita: aplicar ok, triagem concluida, rastro cadastro_adiado %s', i, v_tab[i], v_ev -> 'codigos'));
  END LOOP;
  EXECUTE 'DROP FUNCTION public._ensaio_b7_falha()';
  RAISE EXCEPTION E'GATILHOS OK (tudo desfeito de propósito):\n%', array_to_string(v_r, E'\n');
END
$local$;
```

Resultado literal no Postgres local:

```
ERRO: GATILHOS OK (tudo desfeito de propósito):
L1) gatilho em leads recusa a escrita: aplicar ok, triagem concluida, rastro cadastro_adiado ["erro_lead"]
L2) gatilho em clientes recusa a escrita: aplicar ok, triagem concluida, rastro cadastro_adiado ["nome_lead", "nota_lead", "nome_cliente", "erro_cliente_endereco"]
L3) gatilho em clientes recusa a escrita: aplicar ok, triagem concluida, rastro cadastro_adiado ["nome_lead", "nota_lead", "cep_cliente", "endereco_cliente", "erro_cliente_nome"]
```

Nos três casos o log do banco recebe um `WARNING` só com o id da triagem e o SQLSTATE (`P0001`), nunca a mensagem.

## 4. DEPOIS do ensaio: nada ficou

```sql
-- Esperado: 0 eventos de cadastro, 0 leads e 0 clientes de teste, o estado de antes (desligada em 14/11/2026), e nenhum gatilho ou função de ensaio.
SELECT (SELECT count(*) FROM public.whatsapp_triagem_eventos WHERE tipo = 'pulou' AND detalhe ->> 'motivo' LIKE 'cadastro%') AS eventos_de_cadastro,
       (SELECT count(*) FROM public.leads WHERE telefone IN ('5596999990041', '5596999990042', '5596999990043', '5596999990044', '5596999990045', '5596999990046', '5596999990047', '5596999990048', '5596999990049')) AS leads_de_teste,
       (SELECT count(*) FROM public.clientes WHERE telefone IN ('96999990051', '96999990052', '96999990053', '96999990054')) AS clientes_de_teste,
       (SELECT estado FROM public.whatsapp_triagem_config) AS estado,
       (SELECT count(*) FROM pg_trigger WHERE tgname = 'zz_ensaio_b7_falha') AS gatilho_de_ensaio,
       (SELECT count(*) FROM pg_proc WHERE proname = '_ensaio_b7_falha') AS funcao_de_ensaio;
```

## 5. Voltar atrás, se for preciso

Três passos, nesta ordem, cada um numa transação que termina conferindo o md5 e desfaz tudo se não bater. Primeiro `triagem_aplicar` para de chamar a gravação e as funções da gravação saem; depois `triagem_varrer` volta ao texto da B4 (e só então o saneador do aviso sai, porque o texto novo do aviso chama o saneador); no fim, uma consulta de conferência. O que já foi gravado no cadastro NÃO é desfeito (nome, CEP, endereço e a nota ficam: são dados da pessoa, em campos que estavam vazios).

### 5.1 `triagem_aplicar` volta ao corpo da B4

```sql
BEGIN;
DO $volta$
DECLARE v_def text; v_ini integer; v_fim integer;
BEGIN
  v_def := pg_get_functiondef('public.triagem_aplicar(uuid, integer, jsonb)'::regprocedure);
  v_ini := strpos(v_def, E'  -- B7: triagem real que terminou grava no cadastro');
  v_fim := strpos(v_def, E'  -- texto barrado: a pergunta anterior que ainda não saiu também não vai (a equipe assume)');
  IF v_ini = 0 OR v_fim <= v_ini THEN RAISE EXCEPTION 'o bloco da B7 não está em triagem_aplicar'; END IF;
  EXECUTE left(v_def, v_ini - 1) || substr(v_def, v_fim);
END $volta$;
DROP FUNCTION IF EXISTS public.triagem_gravar_no_cadastro(uuid);
DROP FUNCTION IF EXISTS public._triagem_nome_e_marcador(text);
DO $confere_aplicar$
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.triagem_aplicar(uuid, integer, jsonb)'::regprocedure) <> 'd32589123febf3acbec9c233810fc55a' THEN
    RAISE EXCEPTION 'triagem_aplicar não voltou ao corpo da B4 (md5 diferente): nada foi desfeito nem refeito';
  END IF;
END $confere_aplicar$;
COMMIT;
```

### 5.2 `triagem_varrer` volta ao texto da B4 (o corpo inteiro, como está na seção 12 de `supabase/migrations/20261113132000_triagem_estado_e_envio.sql`)

```sql
BEGIN;
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
DROP FUNCTION IF EXISTS public._triagem_texto_de_aviso(text, integer);
DO $confere_varrer$
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.triagem_varrer()'::regprocedure) <> 'a7f66a3a0cf0b7791120829ffdcf30ae' THEN
    RAISE EXCEPTION 'triagem_varrer não voltou ao texto da B4 (md5 diferente)';
  END IF;
END $confere_varrer$;
COMMIT;
```

`CREATE OR REPLACE` não mexe em dono, ACL nem `search_path`: a função continua só do `service_role`.

### 5.3 Conferência final

```sql
-- Esperado: aplicar_volta true, varrer_volta true, 0 funções novas, 0 chamadas à gravação, e as ACLs de antes (anon e authenticated sem EXECUTE).
SELECT (SELECT md5(prosrc) = 'd32589123febf3acbec9c233810fc55a' FROM pg_proc WHERE oid = 'public.triagem_aplicar(uuid, integer, jsonb)'::regprocedure) AS aplicar_volta,
       (SELECT md5(prosrc) = 'a7f66a3a0cf0b7791120829ffdcf30ae' FROM pg_proc WHERE oid = 'public.triagem_varrer()'::regprocedure) AS varrer_volta,
       (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace
          AND proname IN ('triagem_gravar_no_cadastro', '_triagem_nome_e_marcador', '_triagem_texto_de_aviso')) AS funcoes_novas,
       (SELECT count(*) FROM pg_proc WHERE proname = 'triagem_aplicar' AND pronamespace = 'public'::regnamespace AND prosrc LIKE '%triagem_gravar_no_cadastro%') AS aplicar_ainda_chama,
       (SELECT bool_or(has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))
          FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('triagem_aplicar', 'triagem_varrer')) AS alguem_de_fora_executa;
```

As voltas foram rodadas no Postgres local, depois de aplicada a migração, e a consulta devolveu `t`, `t`, `0`, `0`, `f`.

## 6. O que este diff NÃO resolve

1. **Adiamento por trava ou erro não é refeito.** Se o lead ou o cliente estiver travado por outra sessão no instante exato em que a triagem termina, ou se um gatilho recusar a escrita, o cadastro fica sem aquela gravação e o rastro diz `cadastro_adiado` (com `adiado_lead`, `adiado_cliente`, `erro_lead`, `erro_cliente_nome` ou `erro_cliente_endereco`). Nada reprocessa isso depois: a triagem já terminou. Uma rotina de reprocessamento na varredura seria possível, mas não foi feita: a janela de trava é de milissegundos, o erro de gatilho é raro, e o dado continua inteiro na triagem, que a equipe lê na caixa. O rastro `cadastro_mantido` (e os códigos `cep_diferente_mantido` e `endereco_diferente_mantido`) NÃO é adiamento: é o cadastro preservado de propósito, e a equipe decide se quer o endereço novo.
2. **Nome de perfil do WhatsApp não é trocado.** "Lucy" continua "Lucy" mesmo que a pessoa tenha dito "Lucia Ferreira". Só marcador é substituído, por regra do dono (nunca sobrescrever). O nome completo fica na triagem.
3. **Só o primeiro nome não entra.** A regra pedida é nome completo.
4. **Endereço sem número.** O ViaCEP traz a rua, não o número; a equipe completa no cadastro.
5. **Ramo do cliente quase sem uso hoje.** Conversa com cliente vinculado, ou com lead que tem `cliente_id` e o mesmo telefone, nem abre triagem. O cliente só é atualizado quando o lead é convertido durante a triagem ou quando o `cliente_id` do lead é de outro telefone.
6. **O aviso do grupo mostra o título do anúncio saneado, não literal** (até 80 caracteres; sem `*`, `_`, `~`, crase, `http`, `www`, quebra de linha nem invisíveis). Um título que dependa dessas marcas perde a formatação no aviso. O título é da equipe, não do contato; se um título tiver preço, o aviso interno o repete. Nada disso vai ao contato.
7. **Converter lead em cliente não ganha a nota.** `converter_lead_em_cliente` não foi tocada; a nota fica no lead e a equipe a lê lá.
