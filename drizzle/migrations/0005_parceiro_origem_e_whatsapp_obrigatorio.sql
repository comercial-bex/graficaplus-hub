ALTER TABLE public.parceiros ADD COLUMN IF NOT EXISTS origem_cadastro jsonb;
COMMENT ON COLUMN public.parceiros.origem_cadastro IS 'UTM e fbclid capturados na página de convite (origem do cadastro).';

DROP FUNCTION IF EXISTS public.parceiro_cadastrar_por_convite(text,uuid,text,text,text,text,text,text);

CREATE FUNCTION public.parceiro_cadastrar_por_convite(p_codigo text, p_usuario_id uuid, p_marca_nome text, p_documento text DEFAULT NULL::text, p_telefone text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_cidade text DEFAULT NULL::text, p_estado text DEFAULT NULL::text, p_origem jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_padrinho public.parceiros%ROWTYPE;
  v_casa boolean := upper(btrim(p_codigo)) = 'BEXPRINT';
  v_criado_em timestamptz; v_cliente_id uuid; v_parceiro_id uuid;
  v_nome text := nullif(btrim(p_marca_nome), '');
  v_digitos text := regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g');
  v_tel text := public.normalize_whatsapp_phone(p_telefone);
  v_achados uuid[];
  v_origem jsonb;
BEGIN
  IF v_nome IS NULL THEN RAISE EXCEPTION 'Informe o nome da sua empresa' USING ERRCODE = '22023'; END IF;
  IF length(v_digitos) NOT IN (10, 11) THEN RAISE EXCEPTION 'Informe um WhatsApp válido com DDD (10 ou 11 dígitos)' USING ERRCODE = '22023'; END IF;
  IF p_origem IS NOT NULL AND jsonb_typeof(p_origem) = 'object' THEN
    SELECT nullif(jsonb_object_agg(k, left(p_origem->>k, 300)), '{}'::jsonb) INTO v_origem
      FROM unnest(ARRAY['utm_source','utm_medium','utm_campaign','utm_content','fbclid']) AS k
     WHERE nullif(btrim(p_origem->>k), '') IS NOT NULL;
  END IF;
  IF NOT v_casa THEN
    SELECT * INTO v_padrinho FROM public.parceiros WHERE codigo_convite = upper(btrim(p_codigo)) AND status = 'ativo';
    IF NOT FOUND THEN RAISE EXCEPTION 'Convite inválido ou expirado' USING ERRCODE = '22023'; END IF;
  END IF;
  SELECT created_at INTO v_criado_em FROM auth.users WHERE id = p_usuario_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conta não encontrada' USING ERRCODE = '22023'; END IF;
  IF v_criado_em < now() - interval '15 minutes' THEN RAISE EXCEPTION 'Esta conta não acabou de ser criada' USING ERRCODE = '42501'; END IF;
  IF EXISTS (SELECT 1 FROM public.parceiros WHERE usuario_id = p_usuario_id) THEN RAISE EXCEPTION 'Esta conta já é de um parceiro' USING ERRCODE = '23505'; END IF;
  IF v_tel IS NOT NULL THEN
    SELECT array_agg(c.id) INTO v_achados FROM public.clientes c
     WHERE c.ativo IS NOT FALSE AND c.revendedor AND c.telefone_normalizado = v_tel
       AND NOT EXISTS (SELECT 1 FROM public.parceiros pa WHERE pa.cliente_id = c.id);
    IF coalesce(array_length(v_achados, 1), 0) = 1 THEN v_cliente_id := v_achados[1]; END IF;
  END IF;
  IF v_cliente_id IS NULL THEN
    INSERT INTO public.clientes (nome, documento, telefone, email, cidade, estado, origem, ativo, revendedor)
    VALUES (v_nome, nullif(btrim(p_documento), ''), nullif(btrim(p_telefone), ''), nullif(btrim(p_email), ''),
            nullif(btrim(p_cidade), ''), nullif(btrim(p_estado), ''), 'convite_parceiro', true, true)
    RETURNING id INTO v_cliente_id;
  END IF;
  INSERT INTO public.parceiros (cliente_id, usuario_id, status, marca_nome, marca_documento, marca_telefone, marca_email, marca_cidade, marca_estado, indicado_por, indicado_em, origem_cadastro)
  VALUES (v_cliente_id, p_usuario_id, 'ativo', v_nome, nullif(btrim(p_documento), ''), nullif(btrim(p_telefone), ''), nullif(btrim(p_email), ''),
          nullif(btrim(p_cidade), ''), nullif(btrim(p_estado), ''), CASE WHEN v_casa THEN NULL ELSE v_padrinho.id END, CASE WHEN v_casa THEN NULL ELSE now() END, v_origem)
  RETURNING id INTO v_parceiro_id;

  INSERT INTO public.user_roles (user_id, role) VALUES (p_usuario_id, 'parceiro')
  ON CONFLICT DO NOTHING;
  RETURN jsonb_build_object('ok', true, 'parceiro_id', v_parceiro_id, 'convidado_por', CASE WHEN v_casa THEN 'Bex Print' ELSE coalesce(v_padrinho.marca_nome, 'Bex Print') END);
END; $function$;

REVOKE ALL ON FUNCTION public.parceiro_cadastrar_por_convite(text,uuid,text,text,text,text,text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.parceiro_cadastrar_por_convite(text,uuid,text,text,text,text,text,text,jsonb) TO anon, authenticated, service_role;