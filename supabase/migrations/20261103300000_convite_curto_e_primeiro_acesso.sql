-- Convite curto: nome, WhatsApp e e-mail; o acesso vai pelo WhatsApp (03/11/2026).
--
-- Decisão do dono: a página /convite/:codigo pedia nove campos dentro do
-- Instagram e a pessoa desistia. Agora pede três. A senha é provisória (gerada
-- pela página, 8 caracteres) e segue pelo WhatsApp com o link e o e-mail; o
-- resto do cadastro (ramo, comprovação, cidade, documento) e a senha
-- definitiva são pedidos UMA vez, no primeiro acesso ao painel.
--
-- Como a mensagem sai: o gatilho tg_parceiro_boas_vindas (20261024200000) já
-- enfileira uma boas-vindas quando o parceiro nasce ativo e com login. Em vez
-- de uma segunda mensagem, `parceiro_cadastrar_rapido` TROCA o modelo dessa
-- linha ainda pendente para `parceiro_acesso`, que leva e-mail e senha. Se o
-- gatilho não enfileirou (ele engole a própria falha), a função enfileira.
--
-- A senha provisória fica em `notificacoes_fila.variaveis` até o primeiro
-- acesso: `parceiro_completar_cadastro` a apaga de lá quando a pessoa cria a
-- senha definitiva. O despachante ainda grava o texto final em whatsapp_logs e
-- na conversa, como grava toda mensagem — por isso a senha é provisória e a
-- troca é obrigatória, não opcional.
--
-- Desfazer: DROP FUNCTION das duas funções e DELETE do template 'parceiro_acesso';
-- a página volta a chamar parceiro_cadastrar_por_convite (intacta).

-- 1. O modelo da mensagem --------------------------------------------------------
INSERT INTO public.notificacao_templates (evento, canal, descricao, corpo, ativo) VALUES
 ('parceiro_acesso', 'whatsapp', 'Acesso do parceiro que se cadastrou pelo convite curto (link, e-mail e senha provisória)',
  E'Olá, {{nome}}! 👋 Seu cadastro de parceiro na Bex Print está liberado.\n\nEntre em {{link}}\nE-mail: {{email}}\nSenha provisória: {{senha}}\n\nNo primeiro acesso você cria a sua senha e completa o cadastro em um minuto. Lá estão a sua tabela de preços, o orçamento com a sua marca e o seu crédito.\n\nQualquer dúvida, é só responder por aqui.', true)
ON CONFLICT (evento) DO UPDATE SET corpo = EXCLUDED.corpo, descricao = EXCLUDED.descricao, ativo = true;

-- 2. O cadastro curto -------------------------------------------------------------
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
  v_nome text := left(nullif(btrim(p_nome), ''), 120);
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
  v_whatsapp boolean := false;
BEGIN
  IF v_nome IS NULL OR length(v_nome) < 2 THEN RAISE EXCEPTION 'Diga o seu nome ou o da sua empresa' USING ERRCODE = '22023'; END IF;
  IF length(v_digitos) NOT IN (10, 11) THEN RAISE EXCEPTION 'Informe um WhatsApp válido com DDD (10 ou 11 dígitos)' USING ERRCODE = '22023'; END IF;
  IF v_email IS NULL OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]{2,}$' THEN
    RAISE EXCEPTION 'Confira o e-mail' USING ERRCODE = '22023'; END IF;
  IF v_senha IS NULL OR length(v_senha) < 8 THEN RAISE EXCEPTION 'Senha provisória inválida' USING ERRCODE = '22023'; END IF;
  IF p_origem IS NOT NULL AND jsonb_typeof(p_origem) = 'object' THEN
    SELECT nullif(jsonb_object_agg(k, left(p_origem->>k, 300)), '{}'::jsonb) INTO v_origem
      FROM unnest(ARRAY['utm_source','utm_medium','utm_campaign','utm_content','fbclid']) AS k
     WHERE nullif(btrim(p_origem->>k), '') IS NOT NULL;
  END IF;
  IF NOT v_casa THEN
    SELECT * INTO v_padrinho FROM public.parceiros WHERE codigo_convite = upper(btrim(p_codigo)) AND status = 'ativo';
    IF NOT FOUND THEN RAISE EXCEPTION 'Convite inválido ou expirado' USING ERRCODE = '22023'; END IF;
  END IF;
  -- Mesmas travas de parceiro_cadastrar_por_convite: só a conta recém-criada,
  -- e só uma vez. A página chama logo depois do signUp.
  SELECT created_at INTO v_criado_em FROM auth.users WHERE id = p_usuario_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conta não encontrada' USING ERRCODE = '22023'; END IF;
  IF v_criado_em < now() - interval '15 minutes' THEN RAISE EXCEPTION 'Esta conta não acabou de ser criada' USING ERRCODE = '42501'; END IF;
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
    UPDATE public.notificacoes_fila
       SET template = 'parceiro_acesso', evento = 'parceiro_acesso', variaveis = v_variaveis
     WHERE idempotency_key = v_chave AND status = 'pendente';
    GET DIAGNOSTICS v_trocadas = ROW_COUNT;
    IF v_trocadas = 0 THEN
      PERFORM public.enfileirar_notificacao('whatsapp', nullif(btrim(p_telefone), ''), v_cliente_id, 'parceiro_acesso',
        'parceiro', v_parceiro_id, 'parceiro_acesso', v_variaveis, v_chave);
    END IF;
    v_whatsapp := true;
  EXCEPTION WHEN OTHERS THEN
    -- Acessório: a mensagem não derruba o cadastro. A pessoa já está logada e a
    -- página diz como entrar; o motivo fica no log do banco.
    RAISE WARNING 'parceiro_cadastrar_rapido: acesso não enfileirado para o parceiro %: %', v_parceiro_id, SQLERRM;
  END;

  RETURN jsonb_build_object('ok', true, 'parceiro_id', v_parceiro_id, 'whatsapp_enfileirado', v_whatsapp,
    'convidado_por', CASE WHEN v_casa THEN 'Bex Print' ELSE coalesce(v_padrinho.marca_nome, 'Bex Print') END);
END; $function$;

-- Mesma postura de parceiro_cadastrar_por_convite: a página do convite chama logo
-- depois do signUp, e as travas estão dentro (conta de até 15 min, uma vez só).
GRANT EXECUTE ON FUNCTION public.parceiro_cadastrar_rapido(text, uuid, text, text, text, text, jsonb) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.parceiro_cadastrar_rapido(text, uuid, text, text, text, text, jsonb) IS
  'Cadastro curto do convite de parceiro (/convite/:codigo): nome, WhatsApp e e-mail. Chamável logo após o signUp, de propósito; só aceita a conta criada há menos de 15 min e uma vez. Manda link, e-mail e senha provisória pelo WhatsApp (modelo parceiro_acesso).';

-- 3. O primeiro acesso ------------------------------------------------------------
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

  -- A senha provisória já cumpriu o papel: sai da fila de avisos.
  UPDATE public.notificacoes_fila
     SET variaveis = variaveis - 'senha'
   WHERE entidade = 'parceiro' AND entidade_id = v_id AND variaveis ? 'senha';

  RETURN jsonb_build_object('ok', true, 'parceiro_id', v_id);
END; $function$;

REVOKE ALL ON FUNCTION public.parceiro_completar_cadastro(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.parceiro_completar_cadastro(jsonb) TO authenticated, service_role;
COMMENT ON FUNCTION public.parceiro_completar_cadastro(jsonb) IS
  'Primeiro acesso do parceiro cadastrado pelo convite curto: grava ramo, comprovação, cidade, UF e documento do próprio parceiro (parceiro_do_usuario) e apaga a senha provisória da fila de avisos. A senha nova é trocada pelo app (auth.updateUser).';
