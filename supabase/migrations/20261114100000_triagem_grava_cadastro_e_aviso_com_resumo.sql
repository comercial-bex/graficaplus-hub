-- APLICADA em 14/11/2026, depois do ensaio com desfazer no banco vivo (provas 0 a 13 ok). Eu apliquei e conferi md5, permissões e estado. Roteiro: docs/ensaio-triagem-cadastro-e-aviso.md.
-- Com a triagem DESLIGADA (estado de hoje) esta migração não muda comportamento nenhum: nenhuma triagem real termina, então
-- nada é gravado no cadastro, e o aviso novo só sai de triagem real com o grupo ligado.
--
-- TRIAGEM DE BOAS-VINDAS DO WHATSAPP, B7 e B8 (Bex Print, Onda B)
--
-- B7. QUANDO A TRIAGEM TERMINA, O QUE ELA SOUBE VAI PARA O CADASTRO (SÓ O QUE É SEGURO)
--   Nova função triagem_gravar_no_cadastro(triagem), chamada de DENTRO de triagem_aplicar logo depois que o estado final
--   ('concluida' ou 'entregue_equipe') é gravado, só em triagem de modo real e fora do ensaio. Ela grava:
--     * nome completo no LEAD, só se o nome do lead está vazio ou é marcador (".", "Lead WhatsApp 1995...", só dígitos);
--     * o mesmo nome no CLIENTE, só quando o lead já tem cliente_id e o nome do cliente é vazio, marcador ou o telefone;
--     * CEP e endereço (rua, bairro, cidade, estado do ViaCEP) no CLIENTE, campo por campo, só nos campos vazios, e só
--       quando o CEP do cliente é o mesmo que a pessoa disse OU está vazio E rua, bairro, cidade e UF do cliente estão todos
--       vazios ou iguais ao ViaCEP (endereço de outro CEP, ou CEP em cima de endereço diferente, nunca entra: ou o cadastro
--       fica com o endereço inteiro dele, ou recebe o do ViaCEP inteiro);
--     * uma nota curta em leads.observacoes com "primeira vez" e o telefone alternativo MARCADO COMO NÃO VERIFICADO.
--   O que ela NUNCA faz: sobrescrever dado que existe; copiar o telefone alternativo para o telefone do cliente ou do lead
--   (a triagem não prova posse do número); mexer em converter_lead_em_cliente (esta migração não toca nela); criar cliente.
--   Idempotente: cada UPDATE confere de novo "campo vazio" no próprio WHERE, e a nota tem uma marca que impede a segunda.
--   Nunca derruba a gravação da mensagem: travas com FOR UPDATE SKIP LOCKED (linha ocupada fica para trás), lock_timeout de
--   1 s na função, cada parte em seu próprio bloco com captura de erro (lead; nome do cliente; CEP e endereço do cliente: a
--   falha de uma não desfaz a outra, por exemplo um gatilho de WhatsApp do cliente que barra o endereço não leva o nome junto),
--   QUERY_CANCELED capturado pelo nome, e a chamada dentro de triagem_aplicar também é protegida por EXCEPTION WHEN OTHERS.
--   O log do banco recebe só o id da triagem e o SQLSTATE, nunca a mensagem do erro (a de violação de unicidade traz o valor).
--   Rastro: um evento 'pulou' com códigos dos campos (nunca valores) e um motivo que separa três coisas:
--     'cadastro_adiado'  = só quando houve TRAVA ou ERRO (adiado_lead, adiado_cliente, erro_lead, erro_cliente_nome,
--                          erro_cliente_endereco). Não é refeito: a triagem já terminou e o dado continua nela.
--     'cadastro_gravado' = gravou ao menos um campo (os códigos de "mantido" podem vir junto);
--     'cadastro_mantido' = não gravou nada por REGRA, sem trava nem erro (cep_diferente_mantido, endereco_diferente_mantido).
--
-- B8. O AVISO DO GRUPO TRAZ O RESUMO ÚTIL
--   O bloco 6 de triagem_varrer passa a dizer: primeiro nome, tipo (parceiro ou cliente final), anúncio e produto do
--   atendimento, se é a primeira vez, se pediu preço, se o telefone confirmado é outro, se pediu para falar com a equipe, as
--   outras marcas e o link da conversa. Sem CEP, sem telefone, sem sobrenome. Mudam só o texto e a consulta dos avisos; o
--   resto da função (freio, expiração, fila, retenção, a chave de idempotência) fica como está. O título do anúncio e o
--   produto vêm da Meta e do cadastro, não do contato, mas passam por _triagem_texto_de_aviso antes de entrar no texto:
--   sem *, _, ~ nem crase (que formatariam o WhatsApp), sem http nem www (link clicável), sem caractere de controle nem
--   invisível, espaços colapsados e tamanho cortado.
--
-- COMO AS DUAS FUNÇÕES VIVAS SÃO TROCADAS (lição ler-funcao-viva-nao-migracao)
--   triagem_aplicar e triagem_varrer NÃO são copiadas para cá. A migração lê a definição VIVA com pg_get_functiondef, confere
--   o md5 do corpo contra o que foi lido em 14/11/2026, troca só o trecho que muda (um ponto de inserção em triagem_aplicar,
--   o bloco 6 inteiro em triagem_varrer) e recria. Se o corpo vivo for outro, ou se o ponto de troca não existir exatamente
--   uma vez, a migração para com erro e não muda nada. ACL e search_path ficam: CREATE OR REPLACE não mexe neles, e a
--   conferência final repete a checagem.
--
-- LIÇÕES APLICADAS
--   * REVOKE de PUBLIC não fecha o anon: revoga PELO NOME de PUBLIC, anon e authenticated e só depois concede ao service_role.
--   * safeupdate (banco vivo) recusa UPDATE sem WHERE: todo UPDATE aqui tem WHERE por id (um teste varre o arquivo e o roteiro).
--   * Coluna nova em tabela com GRANT por coluna derruba a view de todos: nenhuma coluna nova em lugar nenhum.
--   * Nenhum valor novo de enum (ALTER TYPE ADD VALUE não vale na mesma transação): o rastro usa o tipo 'pulou'.

BEGIN;

-- 0. Precondições -------------------------------------------------------------------------------------------------------
DO $pre$
DECLARE
  v_def text;
  v_faltam text[];
BEGIN
  IF to_regprocedure('public.triagem_aplicar(uuid, integer, jsonb)') IS NULL
     OR to_regprocedure('public.triagem_varrer()') IS NULL
     OR to_regprocedure('public._triagem_nome_valido(text)') IS NULL THEN
    RAISE EXCEPTION 'faltam funções da triagem (triagem_aplicar, triagem_varrer, _triagem_nome_valido): aplique B1, B3 e B4 antes';
  END IF;
  IF to_regprocedure('public.triagem_gravar_no_cadastro(uuid)') IS NOT NULL
     OR to_regprocedure('public._triagem_texto_de_aviso(text, integer)') IS NOT NULL THEN
    RAISE EXCEPTION 'triagem_gravar_no_cadastro ou _triagem_texto_de_aviso já existe: não reaplique';
  END IF;
  -- os corpos vivos são os que foram lidos
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.triagem_aplicar(uuid, integer, jsonb)'::regprocedure) <> 'd32589123febf3acbec9c233810fc55a' THEN
    RAISE EXCEPTION 'triagem_aplicar mudou depois de 14/11/2026: releia a definição viva antes de aplicar';
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.triagem_varrer()'::regprocedure) <> 'a7f66a3a0cf0b7791120829ffdcf30ae' THEN
    RAISE EXCEPTION 'triagem_varrer mudou depois de 14/11/2026: releia a definição viva antes de aplicar';
  END IF;
  -- as colunas que esta migração lê e escreve existem (leads 4, clientes 6, atendimentos 2, triagens 17 = 29)
  SELECT array_agg(e.tabela || '.' || e.coluna ORDER BY e.tabela, e.coluna) INTO v_faltam
    FROM (VALUES
      ('leads', 'nome'), ('leads', 'observacoes'), ('leads', 'cliente_id'), ('leads', 'conversa_id'),
      ('clientes', 'nome'), ('clientes', 'cep'), ('clientes', 'endereco'), ('clientes', 'bairro'), ('clientes', 'cidade'), ('clientes', 'estado'),
      ('whatsapp_atendimentos', 'anuncio_titulo'), ('whatsapp_atendimentos', 'produto'),
      ('whatsapp_triagens', 'lead_id'), ('whatsapp_triagens', 'cep_endereco'), ('whatsapp_triagens', 'nome_completo'),
      ('whatsapp_triagens', 'primeira_vez'), ('whatsapp_triagens', 'telefone_confirmado'), ('whatsapp_triagens', 'pediu_equipe'),
      ('whatsapp_triagens', 'aviso_grupo_rodada'), ('whatsapp_triagens', 'pediu_preco'), ('whatsapp_triagens', 'cep'),
      ('whatsapp_triagens', 'nome_informado'), ('whatsapp_triagens', 'telefone_alternativo'), ('whatsapp_triagens', 'conversa_id'),
      ('whatsapp_triagens', 'atendimento_id'), ('whatsapp_triagens', 'modo'), ('whatsapp_triagens', 'status'),
      ('whatsapp_triagens', 'ramo'), ('whatsapp_triagens', 'aviso_grupo_marcas')
    ) AS e(tabela, coluna)
   WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns c
                      WHERE c.table_schema = 'public' AND c.table_name = e.tabela AND c.column_name = e.coluna);
  IF v_faltam IS NOT NULL THEN
    RAISE EXCEPTION 'faltam colunas que a migração usa: %', array_to_string(v_faltam, ', ');
  END IF;
  -- a triagem real só roda com a regra do dono vigente: nenhum telefone alternativo é marcado verificado pela triagem
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'whatsapp_triagens'
                    AND column_name = 'telefone_alternativo_verificado') THEN
    RAISE EXCEPTION 'falta whatsapp_triagens.telefone_alternativo_verificado';
  END IF;
  v_def := pg_get_functiondef('public.triagem_aplicar(uuid, integer, jsonb)'::regprocedure);
  IF v_def LIKE '%triagem_gravar_no_cadastro%' THEN RAISE EXCEPTION 'triagem_aplicar já chama a gravação no cadastro'; END IF;
END
$pre$;

-- 1. Marcador de nome sem valor ---------------------------------------------------------------------------------------
-- Vazio, só pontuação (".", "-"), só dígitos de telefone, ou o nome que o webhook dá a quem ainda não disse o nome
-- ("Lead WhatsApp 19958714824"). Nunca decide que um nome de verdade é marcador: "Lucy", "Delta" e "Claro" não são.
CREATE OR REPLACE FUNCTION public._triagem_nome_e_marcador(p_nome text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT btrim(coalesce(p_nome, '')) = ''
      OR btrim(p_nome) ~ '^[\s.,;:!?*#_/-]+$'
      OR btrim(p_nome) ~ '^\+?[\d\s().-]{6,}$'
      OR lower(btrim(p_nome)) ~ '^(lead whatsapp|contato whatsapp|cliente whatsapp|whatsapp|sem nome|novo contato)([\s+().-]*\d[\d\s+().-]*)?$'
$function$;

-- 1b. Texto de fora dentro do aviso do grupo ------------------------------------------------------------------------------
-- O título do anúncio vem da Meta e o produto do cadastro: não são do contato, mas entram num texto que o WhatsApp formata e
-- que a equipe lê. Passos, nesta ordem: controle (inclusive quebra de linha e tabulação) vira espaço; caractere invisível de
-- formatação (Cf: soft hyphen, zero width, marcas de direção, BOM, tags) some; *, _, ~ e crase somem; endereço (http://, https://,
-- www.) e as palavras http e www viram espaço (espaço e não vazio, para que "hhttpttp" não se refaça em "http"); espaços colapsam;
-- corta no tamanho. Devolve NULL se nada sobrar.
CREATE OR REPLACE FUNCTION public._triagem_texto_de_aviso(p_texto text, p_max integer)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT nullif(btrim(left(btrim(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              regexp_replace(coalesce(p_texto, ''), '[\u0001-\u001F\u007F-\u009F\u2028\u2029]', ' ', 'g'),
              '[\u00AD\u0600-\u0605\u061C\u06DD\u070F\u08E2\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF\uFFF9-\uFFFB\U000E0000-\U000E007F]', '', 'g'),
            '[*_~`]', '', 'g'),
          '(https?://|www\.)\S*', ' ', 'gi'),
        '(http|www)', ' ', 'gi'),
      '\s+', ' ', 'g')), greatest(coalesce(p_max, 0), 0))), '')
$function$;

-- 2. triagem_gravar_no_cadastro -------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.triagem_gravar_no_cadastro(p_triagem_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET lock_timeout TO '1s'
AS $function$
DECLARE
  t public.whatsapp_triagens%ROWTYPE;
  v_estado text;
  v_lead public.leads%ROWTYPE;
  v_lead_id uuid;
  v_cli public.clientes%ROWTYPE;
  v_cli_id uuid;
  v_nome text;
  v_campos text[] := '{}';
  v_adiado text[] := '{}';
  v_mantido text[] := '{}';
  v_conflito boolean;
  v_cep_cli text;
  v_cep_fmt text;
  v_end jsonb;
  v_rua text;
  v_bairro text;
  v_cidade text;
  v_uf text;
  v_troca_cep boolean;
  v_troca_rua boolean;
  v_troca_bairro boolean;
  v_troca_cidade boolean;
  v_troca_uf boolean;
  v_pv text;
  v_alt text;
  v_alt_fmt text;
  v_nota text;
BEGIN
  SELECT * INTO t FROM public.whatsapp_triagens WHERE id = p_triagem_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'motivo', 'triagem_inexistente'); END IF;
  SELECT estado::text INTO v_estado FROM public.whatsapp_triagem_config WHERE id;
  -- só triagem real, que terminou, com a configuração fora do ensaio e do desligado (a mesma conta de triagem_aplicar)
  IF t.modo <> 'real' OR coalesce(v_estado, 'desligada') IN ('desligada', 'ensaio') OR t.status NOT IN ('concluida', 'entregue_equipe') THEN
    RETURN jsonb_build_object('ok', true, 'gravou', false, 'motivo', 'fora_do_escopo');
  END IF;

  -- o nome só vale completo (nome e sobrenome) e passando de novo na validação forte
  v_nome := btrim(regexp_replace(coalesce(t.nome_informado, ''), '\s+', ' ', 'g'));
  IF NOT (t.nome_completo AND position(' ' IN v_nome) > 0 AND public._triagem_nome_valido(v_nome)) THEN v_nome := NULL; END IF;

  -- o lead da conversa, travado sem esperar
  v_lead_id := t.lead_id;
  IF v_lead_id IS NULL THEN
    SELECT l.id INTO v_lead_id FROM public.leads l WHERE l.conversa_id = t.conversa_id ORDER BY l.created_at DESC LIMIT 1;
  END IF;
  IF v_lead_id IS NOT NULL THEN
    SELECT * INTO v_lead FROM public.leads WHERE id = v_lead_id FOR UPDATE SKIP LOCKED;
    IF NOT FOUND THEN
      IF EXISTS (SELECT 1 FROM public.leads WHERE id = v_lead_id) THEN v_adiado := array_append(v_adiado, 'adiado_lead'); END IF;
      v_lead_id := NULL;
    END IF;
  END IF;

  -- a) nome no lead e nota
  IF v_lead_id IS NOT NULL THEN
    BEGIN
      IF v_nome IS NOT NULL AND public._triagem_nome_e_marcador(v_lead.nome) THEN
        UPDATE public.leads SET nome = v_nome WHERE id = v_lead.id AND public._triagem_nome_e_marcador(nome);
        IF FOUND THEN v_campos := array_append(v_campos, 'nome_lead'); END IF;
      END IF;

      v_pv := CASE t.primeira_vez WHEN 'sim' THEN 'sim' WHEN 'nao' THEN 'não' WHEN 'ja_cliente' THEN 'já é cliente' WHEN 'nao_sei' THEN 'não soube dizer' END;
      v_alt := CASE WHEN t.telefone_alternativo ~ '^\d{10,11}$' THEN t.telefone_alternativo END;
      v_alt_fmt := CASE WHEN v_alt IS NULL THEN NULL
                        WHEN length(v_alt) = 11 THEN format('(%s) %s-%s', left(v_alt, 2), substr(v_alt, 3, 5), right(v_alt, 4))
                        ELSE format('(%s) %s-%s', left(v_alt, 2), substr(v_alt, 3, 4), right(v_alt, 4)) END;
      IF v_pv IS NOT NULL OR v_alt IS NOT NULL THEN
        v_nota := 'Triagem do WhatsApp (' || to_char(public.hoje_br(), 'DD/MM/YYYY') || '): '
               || concat_ws('. ',
                    CASE WHEN v_pv IS NOT NULL THEN 'primeira vez: ' || v_pv END,
                    CASE WHEN v_alt IS NOT NULL THEN 'Telefone alternativo informado no chat: ' || v_alt_fmt
                                                     || ', NÃO verificado (a triagem não prova que o número é do contato)' END)
               || '.';
        UPDATE public.leads
           SET observacoes = CASE WHEN btrim(coalesce(observacoes, '')) = '' THEN v_nota ELSE observacoes || E'\n' || v_nota END
         WHERE id = v_lead.id AND position('Triagem do WhatsApp' IN coalesce(observacoes, '')) = 0;
        IF FOUND THEN v_campos := array_append(v_campos, 'nota_lead'); END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'triagem_gravar_no_cadastro %: parte do lead falhou [%]', t.id, SQLSTATE;
      v_adiado := array_append(v_adiado, 'erro_lead');
      -- o subbloco desfez a escrita do lead: o que ele tinha anotado antes do erro não vale
      v_campos := array_remove(array_remove(v_campos, 'nome_lead'), 'nota_lead');
    END;
  END IF;

  -- b) cliente: só quando o lead já tem cliente_id
  v_cli_id := CASE WHEN v_lead_id IS NOT NULL THEN v_lead.cliente_id END;
  IF v_cli_id IS NOT NULL THEN
    SELECT * INTO v_cli FROM public.clientes WHERE id = v_cli_id FOR UPDATE SKIP LOCKED;
    IF NOT FOUND THEN
      IF EXISTS (SELECT 1 FROM public.clientes WHERE id = v_cli_id) THEN v_adiado := array_append(v_adiado, 'adiado_cliente'); END IF;
      v_cli_id := NULL;
    END IF;
  END IF;

  IF v_cli_id IS NOT NULL THEN
    -- b1) nome do cliente: bloco próprio, para que um gatilho do cliente que barra o endereço não leve o nome junto
    IF v_nome IS NOT NULL AND public._triagem_nome_e_marcador(v_cli.nome) THEN
      BEGIN
        UPDATE public.clientes SET nome = v_nome WHERE id = v_cli.id AND public._triagem_nome_e_marcador(nome);
        IF FOUND THEN v_campos := array_append(v_campos, 'nome_cliente'); END IF;
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'triagem_gravar_no_cadastro %: nome do cliente falhou [%]', t.id, SQLSTATE;
        v_adiado := array_append(v_adiado, 'erro_cliente_nome');
      END;
    END IF;

    -- b2) CEP e endereço do cliente: bloco próprio
    IF t.cep ~ '^\d{8}$' THEN
      BEGIN
        v_cep_cli := regexp_replace(coalesce(v_cli.cep, ''), '\D', '', 'g');
        IF v_cep_cli <> '' AND v_cep_cli <> t.cep THEN
          -- o cadastro já tem outro CEP: nada do ViaCEP desta triagem entra (rua de um CEP com cidade de outro)
          v_mantido := array_append(v_mantido, 'cep_diferente_mantido');
        ELSE
          v_cep_fmt := left(t.cep, 5) || '-' || right(t.cep, 3);
          v_end := CASE WHEN jsonb_typeof(t.cep_endereco) = 'object'
                         AND regexp_replace(coalesce(t.cep_endereco ->> 'cep', ''), '\D', '', 'g') IN ('', t.cep)
                        THEN t.cep_endereco END;
          v_rua := nullif(btrim(left(coalesce(v_end ->> 'rua', ''), 200)), '');
          v_bairro := nullif(btrim(left(coalesce(v_end ->> 'bairro', ''), 120)), '');
          v_cidade := nullif(btrim(left(coalesce(v_end ->> 'cidade', ''), 120)), '');
          v_uf := CASE WHEN btrim(coalesce(v_end ->> 'estado', '')) ~ '^[A-Za-z]{2}$' THEN upper(btrim(v_end ->> 'estado')) END;
          -- CEP vazio no cadastro: só entra CEP e endereço se rua, bairro, cidade e UF do cliente estão todos vazios ou iguais
          -- ao ViaCEP (sem diferença de caixa nem de espaço). Um campo preenchido e diferente (ou que o ViaCEP não trouxe)
          -- é endereço de outro lugar: nada de endereço entra, nem o CEP, para não casar CEP novo com rua antiga.
          v_conflito := v_cep_cli = '' AND EXISTS (
            SELECT 1 FROM (VALUES (v_cli.endereco, v_rua), (v_cli.bairro, v_bairro), (v_cli.cidade, v_cidade), (v_cli.estado, v_uf)) AS x(c, v)
             WHERE btrim(coalesce(x.c, '')) <> ''
               AND lower(regexp_replace(btrim(x.c), '\s+', ' ', 'g')) <> lower(coalesce(x.v, '')));
          IF v_conflito THEN
            v_mantido := array_append(v_mantido, 'endereco_diferente_mantido');
          ELSE
            v_troca_cep := v_cep_cli = '';
            v_troca_rua := v_rua IS NOT NULL AND btrim(coalesce(v_cli.endereco, '')) = '';
            v_troca_bairro := v_bairro IS NOT NULL AND btrim(coalesce(v_cli.bairro, '')) = '';
            v_troca_cidade := v_cidade IS NOT NULL AND btrim(coalesce(v_cli.cidade, '')) = '';
            v_troca_uf := v_uf IS NOT NULL AND btrim(coalesce(v_cli.estado, '')) = '';
            IF v_troca_cep OR v_troca_rua OR v_troca_bairro OR v_troca_cidade OR v_troca_uf THEN
              UPDATE public.clientes SET
                cep = CASE WHEN v_troca_cep AND regexp_replace(coalesce(cep, ''), '\D', '', 'g') = '' THEN v_cep_fmt ELSE cep END,
                endereco = CASE WHEN v_troca_rua AND btrim(coalesce(endereco, '')) = '' THEN v_rua ELSE endereco END,
                bairro = CASE WHEN v_troca_bairro AND btrim(coalesce(bairro, '')) = '' THEN v_bairro ELSE bairro END,
                cidade = CASE WHEN v_troca_cidade AND btrim(coalesce(cidade, '')) = '' THEN v_cidade ELSE cidade END,
                estado = CASE WHEN v_troca_uf AND btrim(coalesce(estado, '')) = '' THEN v_uf ELSE estado END
               WHERE id = v_cli.id;
              IF v_troca_cep THEN v_campos := array_append(v_campos, 'cep_cliente'); END IF;
              IF v_troca_rua OR v_troca_bairro OR v_troca_cidade OR v_troca_uf THEN v_campos := array_append(v_campos, 'endereco_cliente'); END IF;
            END IF;
          END IF;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'triagem_gravar_no_cadastro %: endereco do cliente falhou [%]', t.id, SQLSTATE;
        v_adiado := array_append(v_adiado, 'erro_cliente_endereco');
        -- o que o bloco tinha anotado antes do erro não vale: o subbloco desfez a escrita
        v_campos := array_remove(array_remove(v_campos, 'cep_cliente'), 'endereco_cliente');
        v_mantido := '{}';
      END;
    END IF;
  END IF;

  -- rastro: só códigos, nunca valores. Adiado é só trava ou erro; regra que decidiu não gravar tem motivo próprio.
  IF cardinality(v_campos) > 0 OR cardinality(v_adiado) > 0 OR cardinality(v_mantido) > 0 THEN
    INSERT INTO public.whatsapp_triagem_eventos (triagem_id, conversa_id, tipo, passo, detalhe)
    VALUES (t.id, t.conversa_id, 'pulou', NULL,
            jsonb_build_object('motivo', CASE WHEN cardinality(v_adiado) > 0 THEN 'cadastro_adiado'
                                              WHEN cardinality(v_campos) > 0 THEN 'cadastro_gravado'
                                              ELSE 'cadastro_mantido' END,
                               'codigos', to_jsonb(v_campos || v_adiado || v_mantido)));
  END IF;
  RETURN jsonb_build_object('ok', true, 'gravou', cardinality(v_campos) > 0, 'campos', to_jsonb(v_campos),
                            'adiado', to_jsonb(v_adiado), 'mantido', to_jsonb(v_mantido));
EXCEPTION
  WHEN query_canceled THEN
    RAISE WARNING 'triagem_gravar_no_cadastro % cancelada por tempo, a mensagem segue', p_triagem_id;
    RETURN jsonb_build_object('ok', false, 'motivo', 'tempo');
END $function$;

-- 3. ACL: só o service_role (nem anon nem authenticated) ---------------------------------------------------------------------
REVOKE ALL ON FUNCTION public._triagem_nome_e_marcador(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._triagem_texto_de_aviso(text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.triagem_gravar_no_cadastro(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._triagem_nome_e_marcador(text) TO service_role;
GRANT EXECUTE ON FUNCTION public._triagem_texto_de_aviso(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.triagem_gravar_no_cadastro(uuid) TO service_role;

-- 4. triagem_aplicar: chama a gravação logo depois do UPDATE do estado final -----------------------------------------------
-- Troca por texto na definição viva: um ponto de inserção, que tem que existir exatamente uma vez.
DO $troca_aplicar$
DECLARE
  v_def text;
  v_novo text;
  v_marca text := E'  -- texto barrado: a pergunta anterior que ainda não saiu também não vai (a equipe assume)';
  v_bloco text := $bloco$  -- B7: triagem real que terminou grava no cadastro só o que é seguro (nome completo, CEP e endereço, nota do lead).
  -- Nunca derruba a gravação da mensagem: erro vira aviso no log, só com o id e o SQLSTATE.
  IF t.modo = 'real' AND NOT v_ensaio AND v_status IN ('concluida', 'entregue_equipe') THEN
    BEGIN
      PERFORM public.triagem_gravar_no_cadastro(t.id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'triagem_aplicar %: gravar no cadastro falhou [%]', t.id, SQLSTATE;
    END;
  END IF;

$bloco$;
BEGIN
  v_def := pg_get_functiondef('public.triagem_aplicar(uuid, integer, jsonb)'::regprocedure);
  IF (length(v_def) - length(replace(v_def, v_marca, ''))) / length(v_marca) <> 1 THEN
    RAISE EXCEPTION 'o ponto de inserção de triagem_aplicar não aparece exatamente uma vez';
  END IF;
  v_novo := replace(v_def, v_marca, v_bloco || v_marca);
  IF v_novo = v_def THEN RAISE EXCEPTION 'a troca em triagem_aplicar não mudou nada'; END IF;
  EXECUTE v_novo;
END
$troca_aplicar$;

-- 5. triagem_varrer: o bloco 6 (aviso do grupo) com o resumo -----------------------------------------------------------------
-- Troca do trecho entre o comentário "-- 6." e o RETURN final, tudo lido da definição viva.
DO $troca_varrer$
DECLARE
  v_def text;
  v_ini integer;
  v_fim integer;
  v_novo text;
  v_bloco text := $bloco$  -- 6. avisos de grupo: ENFILEIRADOS em notificacoes_fila, uma vez por triagem, com o RESUMO para a equipe agir (B8):
  -- primeiro nome, tipo, anúncio e produto do atendimento, primeira vez, preço, telefone confirmado que é outro, pedido de
  -- equipe e o link da conversa. Sem sobrenome, sem CEP, sem telefone: nunca. A chave triagem_aviso:<id> torna o reenvio
  -- seguro: se a rodada falhar no meio ou o despachante perder a resposta, a próxima rodada tenta de novo e o enfileirar
  -- não duplica. Só depois de enfileirado a triagem fica marcada. Sem grupo da equipe configurado, nada é marcado e o aviso
  -- espera. O ramo de entidade 'whatsapp_atendimento' é o que o CHECK da fila aceita; sem atendimento, o id da triagem faz
  -- de identificador.
  v_grupo := public.grupo_equipe_destino();
  FOR t IN SELECT x.id, x.conversa_id, x.atendimento_id, x.aviso_grupo_motivo, x.aviso_grupo_marcas, x.ramo, x.aviso_grupo_rodada,
                  split_part(btrim(coalesce(x.nome_informado, '')), ' ', 1) AS primeiro_nome,
                  x.primeira_vez, x.pediu_preco, x.pediu_equipe, x.telefone_confirmado,
                  a.anuncio_titulo, a.produto
             FROM public.whatsapp_triagens x
             LEFT JOIN public.whatsapp_atendimentos a ON a.id = x.atendimento_id
            WHERE x.aviso_grupo_decidido AND x.aviso_grupo_enviado_em IS NULL AND x.modo = 'real'
              AND x.status NOT IN ('pausada_humano', 'pausada_desligada', 'pulada')
            ORDER BY x.atualizado_em LIMIT 50 LOOP
    IF v_grupo IS NULL THEN
      v_sem_grupo := v_sem_grupo + 1;
      CONTINUE;
    END IF;
    PERFORM 1 FROM public.whatsapp_triagens WHERE id = t.id FOR UPDATE SKIP LOCKED;
    IF NOT FOUND THEN CONTINUE; END IF;
    DECLARE
      -- título e produto não são do contato, mas entram num texto que o WhatsApp formata: saneados antes de montar o aviso
      v_anuncio text := public._triagem_texto_de_aviso(t.anuncio_titulo, 80);
      v_produto text := public._triagem_texto_de_aviso(t.produto, 60);
      -- as marcas que já têm linha própria não repetem
      v_resto text[] := ARRAY(SELECT m FROM unnest(t.aviso_grupo_marcas) AS m WHERE m NOT IN ('pediu_preco', 'pediu_equipe'));
    BEGIN
      v_texto := concat_ws(E'\n',
        '🧾 Triagem do robô: ' || CASE WHEN t.aviso_grupo_motivo = 'expirada' THEN 'a pessoa parou de responder'
                                       ELSE replace(coalesce(t.aviso_grupo_motivo, 'terminou'), '_', ' ') END,
        '👤 ' || coalesce(nullif(t.primeiro_nome, ''), 'Contato sem nome') || ' · '
              || CASE t.ramo WHEN 'parceiro' THEN 'parceiro' ELSE 'cliente final' END,
        CASE WHEN v_anuncio IS NOT NULL OR v_produto IS NOT NULL
             THEN '📣 ' || concat_ws(' · ', 'Anúncio: ' || v_anuncio, 'Produto: ' || v_produto) END,
        CASE t.primeira_vez WHEN 'sim' THEN '🆕 Primeira vez: sim'
                            WHEN 'nao' THEN '🔁 Primeira vez: não'
                            WHEN 'ja_cliente' THEN '🔁 Primeira vez: não, disse que já é cliente'
                            WHEN 'nao_sei' THEN '❔ Primeira vez: não soube dizer' END,
        CASE WHEN t.pediu_preco THEN '💲 Pediu preço' END,
        CASE WHEN t.telefone_confirmado = 'alternativo' THEN '📞 O telefone de contato é outro, sem verificação' END,
        CASE WHEN t.pediu_equipe THEN '🙋 Pediu para falar com a equipe' END,
        CASE WHEN cardinality(v_resto) > 0 THEN '🏷️ ' || replace(array_to_string(v_resto, ', '), '_', ' ') END,
        '👉 Responder: https://bexprint.com.br/whatsapp?conversa=' || t.conversa_id);
      PERFORM public.enfileirar_notificacao('whatsapp', v_grupo, NULL, 'aviso_grupo_equipe', 'whatsapp_atendimento',
                                            coalesce(t.atendimento_id, t.id), 'aviso_grupo_equipe',
                                            jsonb_build_object('texto', v_texto),
                                            'triagem_aviso:' || t.id || CASE WHEN t.aviso_grupo_rodada > 1 THEN ':' || t.aviso_grupo_rodada ELSE '' END);
      UPDATE public.whatsapp_triagens SET aviso_grupo_enviado_em = now(), atualizado_em = now()
       WHERE id = t.id AND aviso_grupo_enviado_em IS NULL;
      v_avisos := v_avisos + 1;
    EXCEPTION WHEN OTHERS THEN
      -- não vira evento 'erro' (cada rodada repetiria e o freio de erros desligaria tudo por causa de um aviso); o log leva
      -- só o id e o SQLSTATE
      RAISE WARNING 'aviso da triagem % para o grupo falhou [%]', t.id, SQLSTATE;
    END;
  END LOOP;

$bloco$;
BEGIN
  v_def := pg_get_functiondef('public.triagem_varrer()'::regprocedure);
  v_ini := strpos(v_def, E'  -- 6. avisos de grupo:');
  v_fim := strpos(v_def, E'  RETURN jsonb_build_object(''expiradas''');
  IF v_ini = 0 OR v_fim = 0 OR v_fim <= v_ini
     OR (length(v_def) - length(replace(v_def, E'  -- 6. avisos de grupo:', ''))) / length(E'  -- 6. avisos de grupo:') <> 1
     OR (length(v_def) - length(replace(v_def, E'  RETURN jsonb_build_object(''expiradas''', ''))) / length(E'  RETURN jsonb_build_object(''expiradas''') <> 1 THEN
    RAISE EXCEPTION 'os pontos de troca de triagem_varrer não aparecem exatamente uma vez, na ordem esperada';
  END IF;
  v_novo := left(v_def, v_ini - 1) || v_bloco || substr(v_def, v_fim);
  IF v_novo = v_def THEN RAISE EXCEPTION 'a troca em triagem_varrer não mudou nada'; END IF;
  EXECUTE v_novo;
END
$troca_varrer$;

-- 6. Conferência -------------------------------------------------------------------------------------------------------------
DO $conferencia$
DECLARE
  v_f text;
  v_n integer;
BEGIN
  FOREACH v_f IN ARRAY ARRAY['_triagem_nome_e_marcador', '_triagem_texto_de_aviso', 'triagem_gravar_no_cadastro', 'triagem_aplicar', 'triagem_varrer'] LOOP
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
  -- definer com search_path nas três que tocam tabela
  SELECT count(*) INTO v_n FROM pg_proc
   WHERE pronamespace = 'public'::regnamespace AND proname IN ('triagem_gravar_no_cadastro', 'triagem_aplicar', 'triagem_varrer')
     AND prosecdef AND proconfig::text LIKE '%search_path=public%';
  IF v_n <> 3 THEN RAISE EXCEPTION 'só % de 3 funções são SECURITY DEFINER com search_path', v_n; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'triagem_gravar_no_cadastro' AND pronamespace = 'public'::regnamespace
                    AND proconfig::text LIKE '%lock_timeout%' AND prosrc ~ 'SKIP LOCKED' AND prosrc ~ 'query_canceled') THEN
    RAISE EXCEPTION 'triagem_gravar_no_cadastro precisa de lock_timeout, SKIP LOCKED e QUERY_CANCELED capturado';
  END IF;
  -- a gravação nunca toca telefone nem converte lead: o texto da função não tem essas escritas
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'triagem_gravar_no_cadastro' AND pronamespace = 'public'::regnamespace
               AND (prosrc ~* 'SET\s+telefone' OR prosrc ~* 'converter_lead_em_cliente' OR prosrc ~* 'INSERT\s+INTO\s+public\.(clientes|leads)'
                    OR prosrc ~* 'telefone_alternativo_verificado\s*=')) THEN
    RAISE EXCEPTION 'triagem_gravar_no_cadastro escreve telefone, converte lead ou cria cadastro';
  END IF;
  -- a troca pegou: aplicar chama a gravação uma vez, varrer tem o resumo e perdeu o texto antigo, e o resto ficou
  IF (SELECT (length(prosrc) - length(replace(prosrc, 'triagem_gravar_no_cadastro', ''))) / length('triagem_gravar_no_cadastro')
        FROM pg_proc WHERE proname = 'triagem_aplicar' AND pronamespace = 'public'::regnamespace) <> 1 THEN
    RAISE EXCEPTION 'triagem_aplicar não chama a gravação exatamente uma vez';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'triagem_varrer' AND pronamespace = 'public'::regnamespace
                    AND prosrc LIKE '%Primeira vez: sim%' AND prosrc LIKE '%Pediu para falar com a equipe%' AND prosrc LIKE '%Anúncio: %'
                    AND prosrc NOT LIKE '%quer ser parceiro%' AND prosrc LIKE '%freio_falhas_de_envio%' AND prosrc LIKE '%triagem_aviso:%'
                    AND prosrc LIKE '%_triagem_desligar_interno%' AND prosrc LIKE '%_triagem_texto_de_aviso(t.anuncio_titulo, 80)%'
                    AND prosrc LIKE '%_triagem_texto_de_aviso(t.produto, 60)%') THEN
    RAISE EXCEPTION 'triagem_varrer não ficou como esperado';
  END IF;
  -- o aviso nunca leva dado privado: nenhuma referência a CEP, telefone ou nome completo dentro do bloco do texto
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'triagem_varrer' AND pronamespace = 'public'::regnamespace
               AND substr(prosrc, strpos(prosrc, 'v_texto := concat_ws'), strpos(prosrc, 'PERFORM public.enfileirar_notificacao') - strpos(prosrc, 'v_texto := concat_ws'))
                   ~* '(\mcep\M|telefone_alternativo|telefone_chat|nome_informado)') THEN
    RAISE EXCEPTION 'o texto do aviso do grupo referencia CEP, telefone ou nome completo';
  END IF;
  -- texto de aviso: o que some e o que fica (os escapes são os do próprio regex, só ASCII)
  IF public._triagem_texto_de_aviso(E'*Promo* _x_ ~y~ `z`\n\thttps://a.example/p?q=1 www.b.com ' || chr(8203) || chr(8238) || 'ok' || chr(173) || ' hhttpttp', 80)
       IS DISTINCT FROM 'Promo x y z ok h ttp'
     OR public._triagem_texto_de_aviso('  ', 80) IS NOT NULL OR public._triagem_texto_de_aviso(NULL, 80) IS NOT NULL
     OR public._triagem_texto_de_aviso(repeat('x', 200), 80) <> repeat('x', 80)
     OR public._triagem_texto_de_aviso('Banner 3x1 em lona', 80) <> 'Banner 3x1 em lona' THEN
    RAISE EXCEPTION 'o saneamento do texto do aviso não ficou como esperado';
  END IF;
  -- marcador de nome: o que é e o que não é
  IF NOT (public._triagem_nome_e_marcador('.') AND public._triagem_nome_e_marcador('') AND public._triagem_nome_e_marcador(NULL)
          AND public._triagem_nome_e_marcador('Lead WhatsApp 19958714824') AND public._triagem_nome_e_marcador('+55 96 99999-0001')
          AND public._triagem_nome_e_marcador('96999990001')) THEN
    RAISE EXCEPTION 'marcador de nome não reconheceu um marcador';
  END IF;
  IF public._triagem_nome_e_marcador('Lucy') OR public._triagem_nome_e_marcador('Delta') OR public._triagem_nome_e_marcador('Claro')
     OR public._triagem_nome_e_marcador('Maria Souza') OR public._triagem_nome_e_marcador('João 2') OR public._triagem_nome_e_marcador('Lana(Paty)') THEN
    RAISE EXCEPTION 'marcador de nome tratou nome de verdade como marcador';
  END IF;
END
$conferencia$;

COMMIT;
