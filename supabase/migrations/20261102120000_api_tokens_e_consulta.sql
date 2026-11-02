-- API do Bex Print com token pessoal (02/11/2026), Onda 1 do "API/MCP".
--
-- O dono viu a tela API/MCP do Holdprint e pediu o mesmo caminho aqui: um
-- token que a pessoa gera em Ajustes, trata como senha e usa para LER os dados
-- da gráfica de fora do sistema (Claude, planilha, outro programa).
--
-- Desenho:
--   - `api_tokens` guarda só o HASH (sha256) do token; o texto aparece uma vez,
--     na hora de gerar. Prefixo de 12 letras para a pessoa reconhecer na lista.
--   - `criar_api_token` e `revogar_api_token`: admin e gestor, pelo app.
--   - `api_consultar`: só o servidor chama (service_role). Confere o token e
--     depois LÊ COMO A PESSOA DONA DO TOKEN (SET LOCAL ROLE authenticated com as
--     claims dela): a RLS de cada tabela decide o que sai. Nenhum dado além do
--     que ela já vê logada. Só leitura; nenhuma ação.
--   - Leitura da tabela de tokens no nível da TABELA (não por coluna), para a
--     coluna nova de amanhã não repetir o tropeço do #342.

CREATE TABLE public.api_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nome text NOT NULL CHECK (btrim(nome) <> ''),
  prefixo text NOT NULL,
  hash text NOT NULL UNIQUE,
  escopo text NOT NULL DEFAULT 'leitura' CHECK (escopo IN ('leitura')),
  criado_em timestamptz NOT NULL DEFAULT now(),
  expira_em timestamptz NOT NULL,
  revogado_em timestamptz,
  ultimo_uso_em timestamptz,
  usos integer NOT NULL DEFAULT 0
);
COMMENT ON TABLE public.api_tokens IS 'Tokens pessoais da API de leitura. Só o hash fica guardado; o texto aparece uma vez ao gerar.';
CREATE INDEX api_tokens_user_idx ON public.api_tokens (user_id, criado_em DESC);

ALTER TABLE public.api_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "api_tokens: cada um vê os seus" ON public.api_tokens
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
REVOKE ALL ON public.api_tokens FROM PUBLIC, anon;
GRANT SELECT ON public.api_tokens TO authenticated;
GRANT ALL ON public.api_tokens TO service_role;

-- Gera o token: 'bxp_' + 48 hexadecimais. Devolve o texto UMA vez.
CREATE OR REPLACE FUNCTION public.criar_api_token(p_nome text, p_dias integer DEFAULT 90)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_token text;
  v_id uuid;
  v_expira timestamptz;
  v_ativos integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Entre no sistema para gerar um token.' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.has_role(v_uid, 'admin') OR public.has_role(v_uid, 'gestor')) THEN
    RAISE EXCEPTION 'Gerar token da API é de administrador e gerência.' USING ERRCODE = '42501';
  END IF;
  IF btrim(coalesce(p_nome, '')) = '' THEN
    RAISE EXCEPTION 'Dê um nome ao token: onde ele vai ser usado.';
  END IF;
  IF p_dias IS NULL OR p_dias < 1 OR p_dias > 365 THEN
    RAISE EXCEPTION 'A validade vai de 1 a 365 dias.';
  END IF;
  SELECT count(*) INTO v_ativos FROM public.api_tokens
   WHERE user_id = v_uid AND revogado_em IS NULL AND expira_em > now();
  IF v_ativos >= 5 THEN
    RAISE EXCEPTION 'Você já tem 5 tokens ativos. Revogue um antes de gerar outro.';
  END IF;

  v_token := 'bxp_' || encode(gen_random_bytes(24), 'hex');
  v_expira := now() + make_interval(days => p_dias);
  INSERT INTO public.api_tokens (user_id, nome, prefixo, hash, expira_em)
  VALUES (v_uid, left(btrim(p_nome), 80), left(v_token, 12), encode(digest(v_token, 'sha256'), 'hex'), v_expira)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id, 'token', v_token, 'prefixo', left(v_token, 12), 'expira_em', v_expira);
END;
$$;

CREATE OR REPLACE FUNCTION public.revogar_api_token(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Entre no sistema para revogar um token.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.api_tokens
     SET revogado_em = now()
   WHERE id = p_id AND revogado_em IS NULL
     AND (user_id = v_uid OR public.has_role(v_uid, 'admin'));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Token não encontrado ou já revogado.';
  END IF;
END;
$$;

-- A leitura. Devolve {erro} para token ruim, recurso errado ou filtro inválido,
-- e {recurso, total, limite, deslocamento, itens, usuario} quando dá certo.
--
-- SECURITY INVOKER de propósito: o Postgres não deixa trocar de papel dentro
-- de função SECURITY DEFINER ("cannot set parameter role"). Quem chama é o
-- servidor como service_role (que lê api_tokens sem RLS); a função troca para
-- `authenticated` com as claims da pessoa, lê, e volta ao papel de entrada.
CREATE OR REPLACE FUNCTION public.api_consultar(p_token text, p_recurso text, p_filtros jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_papel text := current_user;
  v_tok public.api_tokens%ROWTYPE;
  v_email text;
  v_limite integer;
  v_desloc integer;
  v_busca text;
  v_status text;
  v_desde date;
  v_ate date;
  v_total bigint := 0;
  v_itens jsonb := '[]'::jsonb;
BEGIN
  IF p_token IS NULL OR p_token !~ '^bxp_[0-9a-f]{48}$' THEN
    RETURN jsonb_build_object('erro', 'token_invalido');
  END IF;
  SELECT * INTO v_tok FROM public.api_tokens WHERE hash = encode(digest(p_token, 'sha256'), 'hex');
  IF NOT FOUND OR v_tok.revogado_em IS NOT NULL THEN
    RETURN jsonb_build_object('erro', 'token_invalido');
  END IF;
  IF v_tok.expira_em <= now() THEN
    RETURN jsonb_build_object('erro', 'token_expirado');
  END IF;
  IF p_recurso NOT IN ('clientes', 'orcamentos', 'os', 'contas_receber', 'contas_pagar') THEN
    RETURN jsonb_build_object('erro', 'recurso_desconhecido');
  END IF;

  BEGIN
    v_limite := least(greatest(coalesce((p_filtros->>'limite')::integer, 50), 1), 100);
    v_desloc := greatest(coalesce((p_filtros->>'deslocamento')::integer, 0), 0);
    v_busca := nullif(btrim(coalesce(p_filtros->>'busca', '')), '');
    v_status := nullif(btrim(coalesce(p_filtros->>'status', '')), '');
    v_desde := (p_filtros->>'desde')::date;
    v_ate := (p_filtros->>'ate')::date;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('erro', 'filtro_invalido');
  END;

  -- Uso registrado ainda como dono da função (a pessoa não escreve em api_tokens).
  UPDATE public.api_tokens SET ultimo_uso_em = now(), usos = usos + 1 WHERE id = v_tok.id;
  SELECT email INTO v_email FROM auth.users WHERE id = v_tok.user_id;

  -- Daqui em diante, a leitura é COMO A PESSOA: a RLS decide.
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', v_tok.user_id, 'role', 'authenticated', 'email', coalesce(v_email, ''))::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_tok.user_id::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;

  CASE p_recurso
    WHEN 'clientes' THEN
      SELECT count(*) INTO v_total FROM public.clientes c
       WHERE c.ativo
         AND (v_busca IS NULL OR c.nome ILIKE '%' || v_busca || '%' OR coalesce(c.razao_social, '') ILIKE '%' || v_busca || '%')
         AND (v_desde IS NULL OR c.created_at >= v_desde) AND (v_ate IS NULL OR c.created_at < v_ate + 1);
      SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_itens FROM (
        SELECT c.id, c.nome, c.razao_social, c.documento, c.telefone, c.email, c.cidade, c.estado, c.pais, c.origem, c.created_at
          FROM public.clientes c
         WHERE c.ativo
           AND (v_busca IS NULL OR c.nome ILIKE '%' || v_busca || '%' OR coalesce(c.razao_social, '') ILIKE '%' || v_busca || '%')
           AND (v_desde IS NULL OR c.created_at >= v_desde) AND (v_ate IS NULL OR c.created_at < v_ate + 1)
         ORDER BY c.nome LIMIT v_limite OFFSET v_desloc) t;
    WHEN 'orcamentos' THEN
      SELECT count(*) INTO v_total FROM public.orcamentos o
       WHERE (v_status IS NULL OR o.status::text = v_status)
         AND (v_busca IS NULL OR coalesce(o.titulo, '') ILIKE '%' || v_busca || '%' OR o.numero::text = v_busca)
         AND (v_desde IS NULL OR o.created_at >= v_desde) AND (v_ate IS NULL OR o.created_at < v_ate + 1);
      SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_itens FROM (
        -- Só colunas com SELECT para authenticated: valor e etapa comercial ficam para a onda das views por nível.
        SELECT o.id, o.numero, o.titulo, o.status, o.cliente_id, o.contato_nome, o.validade_dias,
               o.enviado_em, o.aprovado_em, o.prazo, o.created_at
          FROM public.orcamentos o
         WHERE (v_status IS NULL OR o.status::text = v_status)
           AND (v_busca IS NULL OR coalesce(o.titulo, '') ILIKE '%' || v_busca || '%' OR o.numero::text = v_busca)
           AND (v_desde IS NULL OR o.created_at >= v_desde) AND (v_ate IS NULL OR o.created_at < v_ate + 1)
         ORDER BY o.created_at DESC LIMIT v_limite OFFSET v_desloc) t;
    WHEN 'os' THEN
      SELECT count(*) INTO v_total FROM public.ordens_servico s
       WHERE (v_status IS NULL OR s.status::text = v_status)
         AND (v_busca IS NULL OR coalesce(s.titulo, '') ILIKE '%' || v_busca || '%' OR s.numero::text = v_busca)
         AND (v_desde IS NULL OR s.created_at >= v_desde) AND (v_ate IS NULL OR s.created_at < v_ate + 1);
      SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_itens FROM (
        SELECT s.id, s.numero, s.titulo, s.status, s.cliente_id, s.prazo_entrega, s.setor_atual, s.prioridade, s.created_at
          FROM public.ordens_servico s
         WHERE (v_status IS NULL OR s.status::text = v_status)
           AND (v_busca IS NULL OR coalesce(s.titulo, '') ILIKE '%' || v_busca || '%' OR s.numero::text = v_busca)
           AND (v_desde IS NULL OR s.created_at >= v_desde) AND (v_ate IS NULL OR s.created_at < v_ate + 1)
         ORDER BY s.created_at DESC LIMIT v_limite OFFSET v_desloc) t;
    WHEN 'contas_receber' THEN
      SELECT count(*) INTO v_total FROM public.pagamentos p
       WHERE (v_status IS NULL OR p.status::text = v_status)
         AND (v_desde IS NULL OR p.data_vencimento >= v_desde) AND (v_ate IS NULL OR p.data_vencimento <= v_ate);
      SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_itens FROM (
        SELECT p.id, p.os_id, p.valor, p.status, p.data_vencimento, p.data_pagamento, p.forma_pagamento, p.parcela, p.total_parcelas
          FROM public.pagamentos p
         WHERE (v_status IS NULL OR p.status::text = v_status)
           AND (v_desde IS NULL OR p.data_vencimento >= v_desde) AND (v_ate IS NULL OR p.data_vencimento <= v_ate)
         ORDER BY p.data_vencimento DESC NULLS LAST LIMIT v_limite OFFSET v_desloc) t;
    WHEN 'contas_pagar' THEN
      SELECT count(*) INTO v_total FROM public.contas_pagar c
       WHERE (v_status IS NULL OR c.status::text = v_status)
         AND (v_busca IS NULL OR coalesce(c.descricao, '') ILIKE '%' || v_busca || '%' OR coalesce(c.fornecedor, '') ILIKE '%' || v_busca || '%')
         AND (v_desde IS NULL OR c.vencimento >= v_desde) AND (v_ate IS NULL OR c.vencimento <= v_ate);
      SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_itens FROM (
        SELECT c.id, c.descricao, c.fornecedor, c.categoria, c.valor, c.vencimento, c.data_pagamento, c.status
          FROM public.contas_pagar c
         WHERE (v_status IS NULL OR c.status::text = v_status)
           AND (v_busca IS NULL OR coalesce(c.descricao, '') ILIKE '%' || v_busca || '%' OR coalesce(c.fornecedor, '') ILIKE '%' || v_busca || '%')
           AND (v_desde IS NULL OR c.vencimento >= v_desde) AND (v_ate IS NULL OR c.vencimento <= v_ate)
         ORDER BY c.vencimento DESC NULLS LAST LIMIT v_limite OFFSET v_desloc) t;
  END CASE;

  EXECUTE format('SET LOCAL ROLE %I', v_papel);
  RETURN jsonb_build_object(
    'recurso', p_recurso, 'total', v_total, 'limite', v_limite, 'deslocamento', v_desloc,
    'itens', v_itens, 'usuario', v_email
  );
END;
$$;

REVOKE ALL ON FUNCTION public.criar_api_token(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.criar_api_token(text, integer) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.revogar_api_token(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revogar_api_token(uuid) TO authenticated, service_role;
-- Só o servidor consulta com token: o navegador nunca chama isto direto.
REVOKE ALL ON FUNCTION public.api_consultar(text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_consultar(text, text, jsonb) TO service_role;
