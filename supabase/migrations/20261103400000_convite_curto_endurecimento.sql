-- Endurecimento do convite curto (03/11/2026), depois da primeira hora no ar.
--
-- A função parceiro_cadastrar_rapido é chamável sem login (a página chama logo
-- depois do signUp) e põe texto na mensagem que sai do WhatsApp da gráfica. Na
-- 20261103300000 ela confiava no que a página mandava:
--   1. a "senha provisória" era qualquer texto de 8+ caracteres: quem chamasse a
--      função direto podia fazer o número da gráfica mandar um link qualquer;
--   2. o e-mail da mensagem não era conferido com o da conta;
--   3. o nome podia trazer endereço de site ou quebra de linha;
--   4. nada limitava quantos avisos um mesmo WhatsApp recebe por dia.
-- E a senha provisória ficava em texto aberto em quatro lugares legíveis pela
-- equipe (mensagem, log do envio, prévia da conversa e fila), mesmo depois de
-- trocada.
--
-- O que muda:
--   - a senha tem de ser da forma que a página gera (8 de 32 caracteres, sem
--     0/O/1/I) E bater com a senha da conta (bcrypt de auth.users): texto livre
--     não passa;
--   - o e-mail tem de ser o da conta;
--   - o nome perde quebras de linha e é recusado se parecer endereço de site;
--   - a partir do 4º parceiro em 24 h para o mesmo WhatsApp, o aviso é cancelado
--     (o cadastro segue e a página orienta "Esqueci a senha");
--   - no primeiro acesso, a senha some também da mensagem, do log e da prévia da
--     conversa; as já trocadas são limpas agora.

-- 0. Guarda: as duas funções não mudaram desde a 20261103300000 ----------------
DO $guarda$
BEGIN
  IF md5(pg_get_functiondef('public.parceiro_cadastrar_rapido(text,uuid,text,text,text,text,jsonb)'::regprocedure))
     <> '3a2fc200b41ee22dfe1eff8426ac3c83' THEN
    RAISE EXCEPTION 'parceiro_cadastrar_rapido mudou desde a 20261103300000: reler antes de aplicar';
  END IF;
  IF md5(pg_get_functiondef('public.parceiro_completar_cadastro(jsonb)'::regprocedure))
     <> '5e0a281d0e9e95d69fe6e86b86f7019c' THEN
    RAISE EXCEPTION 'parceiro_completar_cadastro mudou desde a 20261103300000: reler antes de aplicar';
  END IF;
END $guarda$;

-- 1. Tirar a senha provisória dos registros de um parceiro -----------------------
CREATE OR REPLACE FUNCTION public.ocultar_senha_provisoria_do_parceiro(p_parceiro uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_msgs uuid[];
  v_conversas uuid[];
  v_n integer := 0;
  k integer;
BEGIN
  UPDATE public.notificacoes_fila
     SET variaveis = variaveis - 'senha'
   WHERE entidade = 'parceiro' AND entidade_id = p_parceiro AND variaveis ? 'senha';
  GET DIAGNOSTICS k = ROW_COUNT; v_n := v_n + k;

  WITH u AS (
    UPDATE public.whatsapp_mensagens m
       SET texto = regexp_replace(m.texto, 'Senha provisória: [A-Z0-9]{8}', 'Senha provisória: ********', 'g')
     WHERE m.payload->>'fonte' = 'notificacoes_fila'
       AND m.texto ~ 'Senha provisória: [A-Z0-9]{8}'
       AND m.payload->>'id' IN (
         SELECT f.id::text FROM public.notificacoes_fila f
          WHERE f.entidade = 'parceiro' AND f.entidade_id = p_parceiro AND f.template = 'parceiro_acesso')
    RETURNING m.id, m.conversa_id
  )
  SELECT array_agg(id), array_agg(DISTINCT conversa_id) INTO v_msgs, v_conversas FROM u;
  v_n := v_n + coalesce(array_length(v_msgs, 1), 0);

  IF v_msgs IS NOT NULL THEN
    UPDATE public.whatsapp_logs
       SET request  = regexp_replace(request::text,  'Senha provisória: [A-Z0-9]{8}', 'Senha provisória: ********', 'g')::jsonb,
           response = regexp_replace(response::text, 'Senha provisória: [A-Z0-9]{8}', 'Senha provisória: ********', 'g')::jsonb
     WHERE mensagem_id = ANY (v_msgs)
       AND (request::text ~ 'Senha provisória: [A-Z0-9]{8}' OR response::text ~ 'Senha provisória: [A-Z0-9]{8}');
  END IF;
  IF v_conversas IS NOT NULL THEN
    UPDATE public.whatsapp_conversas
       SET ultima_mensagem = regexp_replace(ultima_mensagem, 'Senha provisória: [A-Z0-9]{8}', 'Senha provisória: ********', 'g')
     WHERE id = ANY (v_conversas) AND ultima_mensagem ~ 'Senha provisória: [A-Z0-9]{8}';
  END IF;
  RETURN v_n;
END; $function$;

REVOKE ALL ON FUNCTION public.ocultar_senha_provisoria_do_parceiro(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ocultar_senha_provisoria_do_parceiro(uuid) TO service_role;
COMMENT ON FUNCTION public.ocultar_senha_provisoria_do_parceiro(uuid) IS
  'Interna (só chamada por parceiro_completar_cadastro e pela migração): apaga a senha provisória da fila de avisos, do texto da mensagem, do log do envio e da prévia da conversa de um parceiro. Devolve quantos registros mexeu.';

-- 2. O cadastro curto, agora conferindo o que recebe -----------------------------
CREATE OR REPLACE FUNCTION public.parceiro_cadastrar_rapido(
  p_codigo text,
  p_usuario_id uuid,
  p_nome text,
  p_telefone text,
  p_email text,
  p_senha text,
  p_origem jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_padrinho public.parceiros%ROWTYPE;
  v_casa boolean := upper(btrim(p_codigo)) = 'BEXPRINT';
  v_criado_em timestamptz; v_cliente_id uuid; v_parceiro_id uuid;
  v_email_conta text; v_hash text;
  v_nome text := left(nullif(btrim(regexp_replace(coalesce(p_nome, ''), '[[:cntrl:]]+', ' ', 'g')), ''), 120);
  v_email text := lower(nullif(btrim(p_email), ''));
  v_digitos text := regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g');
  v_tel text := public.normalize_whatsapp_phone(p_telefone);
  v_senha text := nullif(btrim(p_senha), '');
  v_achados uuid[];
  v_origem jsonb;
  v_link text := public.url_publica_do_sistema() || '/login?como=parceiro';
  v_variaveis jsonb;
  v_chave text;
  v_trocadas integer := 0;
  v_recentes integer := 0;
  v_whatsapp boolean := false;
BEGIN
  IF v_nome IS NULL OR length(v_nome) < 2 THEN RAISE EXCEPTION 'Diga o seu nome ou o da sua empresa' USING ERRCODE = '22023'; END IF;
  -- O nome vai na mensagem do WhatsApp da gráfica: nada que vire link clicável.
  IF v_nome ~* '(https?:|www\.|://|\.(com|net|org|br|io|app|dev|me|co|info|biz|xyz|link|site|online|store|shop|click|ly|gl)(\y|$))' THEN
    RAISE EXCEPTION 'Use só o nome, sem endereço de site ou e-mail' USING ERRCODE = '22023'; END IF;
  IF length(v_digitos) NOT IN (10, 11) THEN RAISE EXCEPTION 'Informe um WhatsApp válido com DDD (10 ou 11 dígitos)' USING ERRCODE = '22023'; END IF;
  IF v_email IS NULL OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]{2,}$' THEN
    RAISE EXCEPTION 'Confira o e-mail' USING ERRCODE = '22023'; END IF;
  -- Só a forma que a página gera (cadastro-rapido.ts): 8 de 32 caracteres, sem 0/O/1/I.
  IF v_senha IS NULL OR v_senha !~ '^[2-9A-HJ-NP-Z]{8}$' THEN RAISE EXCEPTION 'Senha provisória inválida' USING ERRCODE = '22023'; END IF;
  IF p_origem IS NOT NULL AND jsonb_typeof(p_origem) = 'object' THEN
    SELECT nullif(jsonb_object_agg(k, left(p_origem->>k, 300)), '{}'::jsonb) INTO v_origem
      FROM unnest(ARRAY['utm_source','utm_medium','utm_campaign','utm_content','fbclid']) AS k
     WHERE nullif(btrim(p_origem->>k), '') IS NOT NULL;
  END IF;
  IF NOT v_casa THEN
    SELECT * INTO v_padrinho FROM public.parceiros WHERE codigo_convite = upper(btrim(p_codigo)) AND status = 'ativo';
    IF NOT FOUND THEN RAISE EXCEPTION 'Convite inválido ou expirado' USING ERRCODE = '22023'; END IF;
  END IF;
  -- Só a conta recém-criada, uma vez só, e só com o e-mail e a senha que ELA tem:
  -- o que vai na mensagem é o que realmente abre a conta.
  SELECT created_at, lower(email), encrypted_password INTO v_criado_em, v_email_conta, v_hash
    FROM auth.users WHERE id = p_usuario_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conta não encontrada' USING ERRCODE = '22023'; END IF;
  IF v_criado_em < now() - interval '15 minutes' THEN RAISE EXCEPTION 'Esta conta não acabou de ser criada' USING ERRCODE = '42501'; END IF;
  IF v_email_conta IS DISTINCT FROM v_email THEN RAISE EXCEPTION 'Confira o e-mail' USING ERRCODE = '22023'; END IF;
  IF v_hash IS NULL OR extensions.crypt(v_senha, v_hash) <> v_hash THEN
    RAISE EXCEPTION 'Senha provisória inválida' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.parceiros WHERE usuario_id = p_usuario_id) THEN RAISE EXCEPTION 'Esta conta já é de um parceiro' USING ERRCODE = '23505'; END IF;

  -- Revendedor que a gráfica já cadastrou como cliente, pelo mesmo WhatsApp: reaproveita.
  IF v_tel IS NOT NULL THEN
    SELECT array_agg(c.id) INTO v_achados FROM public.clientes c
     WHERE c.ativo IS NOT FALSE AND c.revendedor AND c.telefone_normalizado = v_tel
       AND NOT EXISTS (SELECT 1 FROM public.parceiros pa WHERE pa.cliente_id = c.id);
    IF coalesce(array_length(v_achados, 1), 0) = 1 THEN v_cliente_id := v_achados[1]; END IF;
  END IF;
  IF v_cliente_id IS NULL THEN
    INSERT INTO public.clientes (nome, telefone, email, origem, ativo, revendedor)
    VALUES (v_nome, nullif(btrim(p_telefone), ''), v_email, 'convite_parceiro', true, true)
    RETURNING id INTO v_cliente_id;
  END IF;

  -- Nasce ativo e com o papel (regra de 23/10/2026). Ramo, comprovação, cidade e
  -- documento ficam nulos até o primeiro acesso (parceiro_completar_cadastro).
  INSERT INTO public.parceiros (cliente_id, usuario_id, status, marca_nome, marca_telefone, marca_email, indicado_por, indicado_em, origem_cadastro)
  VALUES (v_cliente_id, p_usuario_id, 'ativo', v_nome, nullif(btrim(p_telefone), ''), v_email,
          CASE WHEN v_casa THEN NULL ELSE v_padrinho.id END, CASE WHEN v_casa THEN NULL ELSE now() END, v_origem)
  RETURNING id INTO v_parceiro_id;

  INSERT INTO public.user_roles (user_id, role) VALUES (p_usuario_id, 'parceiro')
  ON CONFLICT DO NOTHING;

  -- A mensagem: troca o modelo da boas-vindas que o gatilho acabou de enfileirar.
  v_variaveis := jsonb_build_object('nome', v_nome, 'email', v_email, 'senha', v_senha, 'link', v_link);
  v_chave := 'parceiro:' || v_parceiro_id::text || ':boas_vindas';
  BEGIN
    -- Limite por WhatsApp: a partir do 4º parceiro em 24 h para o mesmo número, o
    -- aviso é cancelado (o cadastro segue; a página orienta "Esqueci a senha").
    SELECT count(*) INTO v_recentes FROM public.notificacoes_fila f
     WHERE f.canal = 'whatsapp' AND f.entidade = 'parceiro' AND f.destinatario = v_tel
       AND f.entidade_id <> v_parceiro_id AND f.status <> 'cancelado'
       AND f.created_at > now() - interval '24 hours';
    IF v_recentes >= 3 THEN
      UPDATE public.notificacoes_fila
         SET status = 'cancelado', ultimo_erro = 'limite: 3 avisos por WhatsApp em 24 h'
       WHERE idempotency_key = v_chave AND status = 'pendente';
    ELSE
      UPDATE public.notificacoes_fila
         SET template = 'parceiro_acesso', evento = 'parceiro_acesso', variaveis = v_variaveis
       WHERE idempotency_key = v_chave AND status = 'pendente';
      GET DIAGNOSTICS v_trocadas = ROW_COUNT;
      IF v_trocadas = 0 THEN
        PERFORM public.enfileirar_notificacao('whatsapp', nullif(btrim(p_telefone), ''), v_cliente_id, 'parceiro_acesso',
          'parceiro', v_parceiro_id, 'parceiro_acesso', v_variaveis, v_chave);
      END IF;
      v_whatsapp := true;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- Acessório: a mensagem não derruba o cadastro. A pessoa já está logada e a
    -- página diz como entrar; o motivo fica no log do banco.
    RAISE WARNING 'parceiro_cadastrar_rapido: acesso não enfileirado para o parceiro %: %', v_parceiro_id, SQLERRM;
  END;

  RETURN jsonb_build_object('ok', true, 'parceiro_id', v_parceiro_id, 'whatsapp_enfileirado', v_whatsapp,
    'convidado_por', CASE WHEN v_casa THEN 'Bex Print' ELSE coalesce(v_padrinho.marca_nome, 'Bex Print') END);
END; $function$;

COMMENT ON FUNCTION public.parceiro_cadastrar_rapido(text, uuid, text, text, text, text, jsonb) IS
  'Cadastro curto do convite de parceiro (/convite/:codigo): nome, WhatsApp e e-mail. Chamável logo após o signUp, de propósito; só aceita a conta criada há menos de 15 min, uma vez, e só com o e-mail e a senha provisória que a própria conta tem (conferidos em auth.users). Manda link, e-mail e senha pelo WhatsApp (modelo parceiro_acesso), no máximo 3 parceiros por número em 24 h.';

-- 3. O primeiro acesso agora limpa a senha de todos os registros -----------------
CREATE OR REPLACE FUNCTION public.parceiro_completar_cadastro(p_dados jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid := public.parceiro_do_usuario();
  v_cliente_id uuid;
  v_ramo text := nullif(btrim(p_dados->>'ramo'), '');
  v_ramo_outro text := left(nullif(btrim(p_dados->>'ramo_outro'), ''), 120);
  v_comprova text := left(nullif(btrim(p_dados->>'comprovacao'), ''), 300);
  v_documento text := left(nullif(btrim(p_dados->>'documento'), ''), 30);
  v_cidade text := left(nullif(btrim(p_dados->>'cidade'), ''), 80);
  v_estado text := upper(left(nullif(btrim(p_dados->>'estado'), ''), 2));
  v_nome text := left(nullif(btrim(p_dados->>'nome'), ''), 120);
BEGIN
  IF v_id IS NULL THEN RAISE EXCEPTION 'Acesso de parceiro não encontrado ou suspenso.' USING ERRCODE = '42501'; END IF;
  IF v_ramo IS NULL OR v_ramo NOT IN ('grafica','comunicacao_visual','agencia','designer','revendedor_brindes','outro') THEN
    RAISE EXCEPTION 'Informe o seu ramo de atuação' USING ERRCODE = '22023'; END IF;
  IF v_ramo = 'outro' AND v_ramo_outro IS NULL THEN RAISE EXCEPTION 'Diga qual é o seu ramo' USING ERRCODE = '22023'; END IF;
  IF v_ramo <> 'outro' THEN v_ramo_outro := NULL; END IF;
  IF v_comprova IS NULL OR length(v_comprova) < 3 THEN RAISE EXCEPTION 'Informe o Instagram ou site do seu negócio' USING ERRCODE = '22023'; END IF;

  UPDATE public.parceiros
     SET ramo_atuacao = v_ramo,
         ramo_outro = v_ramo_outro,
         comprovacao_url = v_comprova,
         marca_nome = coalesce(v_nome, marca_nome),
         marca_documento = coalesce(v_documento, marca_documento),
         marca_cidade = coalesce(v_cidade, marca_cidade),
         marca_estado = coalesce(v_estado, marca_estado),
         updated_at = now()
   WHERE id = v_id
   RETURNING cliente_id INTO v_cliente_id;

  -- O cliente da marca nasceu só com nome e telefone: completa o que faltava.
  UPDATE public.clientes
     SET documento = coalesce(documento, v_documento),
         cidade = coalesce(cidade, v_cidade),
         estado = coalesce(estado, v_estado)
   WHERE id = v_cliente_id;

  -- A senha provisória já cumpriu o papel: sai da fila, da mensagem, do log e da
  -- prévia da conversa.
  PERFORM public.ocultar_senha_provisoria_do_parceiro(v_id);

  RETURN jsonb_build_object('ok', true, 'parceiro_id', v_id);
END; $function$;

-- 4. Quem já trocou a senha: limpa agora ------------------------------------------
DO $limpar$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.id FROM public.parceiros p JOIN auth.users u ON u.id = p.usuario_id
     WHERE coalesce(u.raw_user_meta_data->>'cadastro_pendente', '') <> 'true'
       AND EXISTS (SELECT 1 FROM public.notificacoes_fila f
                    WHERE f.entidade = 'parceiro' AND f.entidade_id = p.id AND f.template = 'parceiro_acesso')
  LOOP
    PERFORM public.ocultar_senha_provisoria_do_parceiro(r.id);
  END LOOP;
END $limpar$;
