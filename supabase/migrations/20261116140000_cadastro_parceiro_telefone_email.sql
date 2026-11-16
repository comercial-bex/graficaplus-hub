-- Cadastro de parceiro: telefone e e-mail sem erro (16/11/2026). APLICADA em 16/11/2026.
--
-- Pedido do dono: um parceiro digitou '(55) 96984-1232' e outra 'gmai.com'.
-- Mudança mínima em parceiro_cadastrar_rapido (a do cadastro curto do convite,
-- 20261103400000_convite_curto_endurecimento.sql): duas recusas novas, marcadas
-- [telefone-email]. O resto do corpo é o vivo, sem alteração.
--
-- Corpo vivo conferido em 16/11/2026:
--   md5(btrim(regexp_replace(prosrc, '\s+', ' ', 'g'))) = 68fc05bb0ee5c49653880673d5b571b1
-- Prefixo: o pedido citava 20261116100000, já usado por
-- 20261116100000_custo_real_do_produto.sql; este arquivo usa 20261116140000.
--
-- A tela do convite aplica a MESMA regra antes de criar a conta (a conta nasce
-- antes desta função; recusa aqui deixaria conta órfã).
--
-- Teste de mesa:
--   '(96) 99206-1119'  -> 96992061119 -> aceita
--   '(55) 96984-1232'  -> 55969841232 -> DDD 55 existe (RS): aceita (o +55 fixo no campo evita o erro)
--   '(96) 3223-1234'   -> fixo, 10 dígitos -> recusa
--   '(20) 99999-9999'  -> DDD 20 não existe -> recusa
--   'ana@gmai.com'     -> recusa; 'ana@empresa.com.br' -> aceita

CREATE OR REPLACE FUNCTION public.parceiro_cadastrar_rapido(p_codigo text, p_usuario_id uuid, p_nome text, p_telefone text, p_email text, p_senha text, p_origem jsonb DEFAULT NULL::jsonb)
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
  IF v_nome ~* '(https?:|www\.|://|\.(com|net|org|br|io|app|dev|me|co|info|biz|xyz|link|site|online|store|shop|click|ly|gl)(\y|$))' THEN
    RAISE EXCEPTION 'Use só o nome, sem endereço de site ou e-mail' USING ERRCODE = '22023'; END IF;
  IF length(v_digitos) NOT IN (10, 11) THEN RAISE EXCEPTION 'Informe um WhatsApp válido com DDD (10 ou 11 dígitos)' USING ERRCODE = '22023'; END IF;
  -- [telefone-email 16/11/2026] celular brasileiro: DDD oficial + 9 dígitos começando por 9
  IF v_digitos !~ '^(11|12|13|14|15|16|17|18|19|21|22|24|27|28|31|32|33|34|35|37|38|41|42|43|44|45|46|47|48|49|51|53|54|55|61|62|63|64|65|66|67|68|69|71|73|74|75|77|79|81|82|83|84|85|86|87|88|89|91|92|93|94|95|96|97|98|99)9[0-9]{8}$' THEN
    RAISE EXCEPTION 'Informe um celular com DDD válido, no formato (96) 99999-9999' USING ERRCODE = '22023'; END IF;
  IF v_email IS NULL OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]{2,}$' THEN
    RAISE EXCEPTION 'Confira o e-mail' USING ERRCODE = '22023'; END IF;
  -- [telefone-email 16/11/2026] domínio com erro de digitação (mesma lista de src/domain/contato/celular-e-email.ts)
  IF split_part(v_email, '@', 2) = ANY (ARRAY['gmai.com', 'gmial.com', 'gmail.co', 'gmail.com.br', 'gmal.com', 'gmil.com', 'gamil.com', 'gnail.com', 'gmail.cm', 'gmail.con', 'gmaill.com', 'gmail.com.com', 'hotmial.com', 'hotmal.com', 'hotmai.com', 'hotmil.com', 'hotmail.co', 'hotmail.con', 'homail.com', 'hotamil.com', 'outlok.com', 'outloo.com', 'otlook.com', 'outlook.co', 'outlook.con', 'outllok.com', 'iclod.com', 'icoud.com', 'iclould.com', 'icloud.co', 'icloud.con', 'icluod.com', 'yaho.com.br', 'yahooo.com.br', 'yaoo.com.br', 'yahoo.co.br', 'yahoo.com.b', 'yhaoo.com.br']) THEN
    RAISE EXCEPTION 'O domínio do e-mail parece digitado errado (ex.: gmai.com). Confira: é por ele que você entra no painel' USING ERRCODE = '22023'; END IF;
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
  SELECT created_at, lower(email), encrypted_password INTO v_criado_em, v_email_conta, v_hash
    FROM auth.users WHERE id = p_usuario_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conta não encontrada' USING ERRCODE = '22023'; END IF;
  IF v_criado_em < now() - interval '15 minutes' THEN RAISE EXCEPTION 'Esta conta não acabou de ser criada' USING ERRCODE = '42501'; END IF;
  IF v_email_conta IS DISTINCT FROM v_email THEN RAISE EXCEPTION 'Confira o e-mail' USING ERRCODE = '22023'; END IF;
  IF v_hash IS NULL OR extensions.crypt(v_senha, v_hash) <> v_hash THEN
    RAISE EXCEPTION 'Senha provisória inválida' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.parceiros WHERE usuario_id = p_usuario_id) THEN RAISE EXCEPTION 'Esta conta já é de um parceiro' USING ERRCODE = '23505'; END IF;
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
  INSERT INTO public.parceiros (cliente_id, usuario_id, status, marca_nome, marca_telefone, marca_email, indicado_por, indicado_em, origem_cadastro)
  VALUES (v_cliente_id, p_usuario_id, 'ativo', v_nome, nullif(btrim(p_telefone), ''), v_email,
          CASE WHEN v_casa THEN NULL ELSE v_padrinho.id END, CASE WHEN v_casa THEN NULL ELSE now() END, v_origem)
  RETURNING id INTO v_parceiro_id;
  INSERT INTO public.user_roles (user_id, role) VALUES (p_usuario_id, 'parceiro') ON CONFLICT DO NOTHING;
  v_variaveis := jsonb_build_object('nome', v_nome, 'email', v_email, 'senha', v_senha, 'link', v_link);
  v_chave := 'parceiro:' || v_parceiro_id::text || ':boas_vindas';
  BEGIN
    SELECT count(*) INTO v_recentes FROM public.notificacoes_fila f
     WHERE f.canal = 'whatsapp' AND f.entidade = 'parceiro' AND f.destinatario = v_tel
       AND f.entidade_id <> v_parceiro_id AND f.status <> 'cancelado' AND f.created_at > now() - interval '24 hours';
    IF v_recentes >= 3 THEN
      UPDATE public.notificacoes_fila SET status = 'cancelado', ultimo_erro = 'limite: 3 avisos por WhatsApp em 24 h'
       WHERE idempotency_key = v_chave AND status = 'pendente';
    ELSE
      UPDATE public.notificacoes_fila SET template = 'parceiro_acesso', evento = 'parceiro_acesso', variaveis = v_variaveis
       WHERE idempotency_key = v_chave AND status = 'pendente';
      GET DIAGNOSTICS v_trocadas = ROW_COUNT;
      IF v_trocadas = 0 THEN
        PERFORM public.enfileirar_notificacao('whatsapp', nullif(btrim(p_telefone), ''), v_cliente_id, 'parceiro_acesso',
          'parceiro', v_parceiro_id, 'parceiro_acesso', v_variaveis, v_chave);
      END IF;
      v_whatsapp := true;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'parceiro_cadastrar_rapido: acesso não enfileirado para o parceiro %: %', v_parceiro_id, SQLERRM;
  END;
  RETURN jsonb_build_object('ok', true, 'parceiro_id', v_parceiro_id, 'whatsapp_enfileirado', v_whatsapp,
    'convidado_por', CASE WHEN v_casa THEN 'Bex Print' ELSE coalesce(v_padrinho.marca_nome, 'Bex Print') END);
END; $function$
;

-- DESFAZER (corpo vivo, md5 68fc05bb0ee5c49653880673d5b571b1):
-- CREATE OR REPLACE FUNCTION public.parceiro_cadastrar_rapido(p_codigo text, p_usuario_id uuid, p_nome text, p_telefone text, p_email text, p_senha text, p_origem jsonb DEFAULT NULL::jsonb)
--  RETURNS jsonb
--  LANGUAGE plpgsql
--  SECURITY DEFINER
--  SET search_path TO 'public'
-- AS $function$
-- DECLARE
--   v_padrinho public.parceiros%ROWTYPE;
--   v_casa boolean := upper(btrim(p_codigo)) = 'BEXPRINT';
--   v_criado_em timestamptz; v_cliente_id uuid; v_parceiro_id uuid;
--   v_email_conta text; v_hash text;
--   v_nome text := left(nullif(btrim(regexp_replace(coalesce(p_nome, ''), '[[:cntrl:]]+', ' ', 'g')), ''), 120);
--   v_email text := lower(nullif(btrim(p_email), ''));
--   v_digitos text := regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g');
--   v_tel text := public.normalize_whatsapp_phone(p_telefone);
--   v_senha text := nullif(btrim(p_senha), '');
--   v_achados uuid[];
--   v_origem jsonb;
--   v_link text := public.url_publica_do_sistema() || '/login?como=parceiro';
--   v_variaveis jsonb;
--   v_chave text;
--   v_trocadas integer := 0;
--   v_recentes integer := 0;
--   v_whatsapp boolean := false;
-- BEGIN
--   IF v_nome IS NULL OR length(v_nome) < 2 THEN RAISE EXCEPTION 'Diga o seu nome ou o da sua empresa' USING ERRCODE = '22023'; END IF;
--   IF v_nome ~* '(https?:|www\.|://|\.(com|net|org|br|io|app|dev|me|co|info|biz|xyz|link|site|online|store|shop|click|ly|gl)(\y|$))' THEN
--     RAISE EXCEPTION 'Use só o nome, sem endereço de site ou e-mail' USING ERRCODE = '22023'; END IF;
--   IF length(v_digitos) NOT IN (10, 11) THEN RAISE EXCEPTION 'Informe um WhatsApp válido com DDD (10 ou 11 dígitos)' USING ERRCODE = '22023'; END IF;
--   IF v_email IS NULL OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]{2,}$' THEN
--     RAISE EXCEPTION 'Confira o e-mail' USING ERRCODE = '22023'; END IF;
--   IF v_senha IS NULL OR v_senha !~ '^[2-9A-HJ-NP-Z]{8}$' THEN RAISE EXCEPTION 'Senha provisória inválida' USING ERRCODE = '22023'; END IF;
--   IF p_origem IS NOT NULL AND jsonb_typeof(p_origem) = 'object' THEN
--     SELECT nullif(jsonb_object_agg(k, left(p_origem->>k, 300)), '{}'::jsonb) INTO v_origem
--       FROM unnest(ARRAY['utm_source','utm_medium','utm_campaign','utm_content','fbclid']) AS k
--      WHERE nullif(btrim(p_origem->>k), '') IS NOT NULL;
--   END IF;
--   IF NOT v_casa THEN
--     SELECT * INTO v_padrinho FROM public.parceiros WHERE codigo_convite = upper(btrim(p_codigo)) AND status = 'ativo';
--     IF NOT FOUND THEN RAISE EXCEPTION 'Convite inválido ou expirado' USING ERRCODE = '22023'; END IF;
--   END IF;
--   SELECT created_at, lower(email), encrypted_password INTO v_criado_em, v_email_conta, v_hash
--     FROM auth.users WHERE id = p_usuario_id;
--   IF NOT FOUND THEN RAISE EXCEPTION 'Conta não encontrada' USING ERRCODE = '22023'; END IF;
--   IF v_criado_em < now() - interval '15 minutes' THEN RAISE EXCEPTION 'Esta conta não acabou de ser criada' USING ERRCODE = '42501'; END IF;
--   IF v_email_conta IS DISTINCT FROM v_email THEN RAISE EXCEPTION 'Confira o e-mail' USING ERRCODE = '22023'; END IF;
--   IF v_hash IS NULL OR extensions.crypt(v_senha, v_hash) <> v_hash THEN
--     RAISE EXCEPTION 'Senha provisória inválida' USING ERRCODE = '22023'; END IF;
--   IF EXISTS (SELECT 1 FROM public.parceiros WHERE usuario_id = p_usuario_id) THEN RAISE EXCEPTION 'Esta conta já é de um parceiro' USING ERRCODE = '23505'; END IF;
--   IF v_tel IS NOT NULL THEN
--     SELECT array_agg(c.id) INTO v_achados FROM public.clientes c
--      WHERE c.ativo IS NOT FALSE AND c.revendedor AND c.telefone_normalizado = v_tel
--        AND NOT EXISTS (SELECT 1 FROM public.parceiros pa WHERE pa.cliente_id = c.id);
--     IF coalesce(array_length(v_achados, 1), 0) = 1 THEN v_cliente_id := v_achados[1]; END IF;
--   END IF;
--   IF v_cliente_id IS NULL THEN
--     INSERT INTO public.clientes (nome, telefone, email, origem, ativo, revendedor)
--     VALUES (v_nome, nullif(btrim(p_telefone), ''), v_email, 'convite_parceiro', true, true)
--     RETURNING id INTO v_cliente_id;
--   END IF;
--   INSERT INTO public.parceiros (cliente_id, usuario_id, status, marca_nome, marca_telefone, marca_email, indicado_por, indicado_em, origem_cadastro)
--   VALUES (v_cliente_id, p_usuario_id, 'ativo', v_nome, nullif(btrim(p_telefone), ''), v_email,
--           CASE WHEN v_casa THEN NULL ELSE v_padrinho.id END, CASE WHEN v_casa THEN NULL ELSE now() END, v_origem)
--   RETURNING id INTO v_parceiro_id;
--   INSERT INTO public.user_roles (user_id, role) VALUES (p_usuario_id, 'parceiro') ON CONFLICT DO NOTHING;
--   v_variaveis := jsonb_build_object('nome', v_nome, 'email', v_email, 'senha', v_senha, 'link', v_link);
--   v_chave := 'parceiro:' || v_parceiro_id::text || ':boas_vindas';
--   BEGIN
--     SELECT count(*) INTO v_recentes FROM public.notificacoes_fila f
--      WHERE f.canal = 'whatsapp' AND f.entidade = 'parceiro' AND f.destinatario = v_tel
--        AND f.entidade_id <> v_parceiro_id AND f.status <> 'cancelado' AND f.created_at > now() - interval '24 hours';
--     IF v_recentes >= 3 THEN
--       UPDATE public.notificacoes_fila SET status = 'cancelado', ultimo_erro = 'limite: 3 avisos por WhatsApp em 24 h'
--        WHERE idempotency_key = v_chave AND status = 'pendente';
--     ELSE
--       UPDATE public.notificacoes_fila SET template = 'parceiro_acesso', evento = 'parceiro_acesso', variaveis = v_variaveis
--        WHERE idempotency_key = v_chave AND status = 'pendente';
--       GET DIAGNOSTICS v_trocadas = ROW_COUNT;
--       IF v_trocadas = 0 THEN
--         PERFORM public.enfileirar_notificacao('whatsapp', nullif(btrim(p_telefone), ''), v_cliente_id, 'parceiro_acesso',
--           'parceiro', v_parceiro_id, 'parceiro_acesso', v_variaveis, v_chave);
--       END IF;
--       v_whatsapp := true;
--     END IF;
--   EXCEPTION WHEN OTHERS THEN
--     RAISE WARNING 'parceiro_cadastrar_rapido: acesso não enfileirado para o parceiro %: %', v_parceiro_id, SQLERRM;
--   END;
--   RETURN jsonb_build_object('ok', true, 'parceiro_id', v_parceiro_id, 'whatsapp_enfileirado', v_whatsapp,
--     'convidado_por', CASE WHEN v_casa THEN 'Bex Print' ELSE coalesce(v_padrinho.marca_nome, 'Bex Print') END);
-- END; $function$
-- ;
