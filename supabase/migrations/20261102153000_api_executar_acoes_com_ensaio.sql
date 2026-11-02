-- Ações do MCP com ensaio (02/11/2026), Onda 3 do "API/MCP".
--
-- No padrão do Holdprint: toda ação roda em ENSAIO por padrão e só grava com
-- p_confirmado = true. Três ações que já existem como botão e não mexem em
-- dinheiro: renovar orçamento vencido, mover a etapa comercial e registrar
-- nota na ficha do cliente. Quem executa é a pessoa dona do token, com a RLS
-- dela (mesma troca de papel de `api_consultar`); escrita barrada pela RLS
-- vira {erro: sem_permissao}, nunca "gravado" em falso.
--
-- Cada chamada (ensaio ou não) fica em `api_acoes`: o rastro paga em dias.

CREATE TABLE public.api_acoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_id uuid NOT NULL REFERENCES public.api_tokens(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  acao text NOT NULL,
  argumentos jsonb NOT NULL DEFAULT '{}'::jsonb,
  confirmado boolean NOT NULL DEFAULT false,
  resultado jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.api_acoes IS 'Rastro das ações pedidas pelo MCP/API: ensaio e gravação, com argumentos e resultado.';
CREATE INDEX api_acoes_user_idx ON public.api_acoes (user_id, created_at DESC);
ALTER TABLE public.api_acoes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "api_acoes: cada um vê as suas; admin vê todas" ON public.api_acoes
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR public.has_role((SELECT auth.uid()), 'admin'));
REVOKE ALL ON public.api_acoes FROM PUBLIC, anon;
GRANT SELECT ON public.api_acoes TO authenticated;
GRANT ALL ON public.api_acoes TO service_role;

-- A etapa comercial passa a ser legível por coluna, como status e enviado_em já são.
GRANT SELECT (etapa_comercial) ON public.orcamentos TO authenticated;

CREATE OR REPLACE FUNCTION public.api_executar(p_token text, p_acao text, p_args jsonb DEFAULT '{}'::jsonb, p_confirmado boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_papel text := current_user;
  v_tok public.api_tokens%ROWTYPE;
  v_log uuid;
  v_id uuid;
  v_texto text;
  v_etapa text;
  v_etapa_atual text;
  v_numero text;
  v_status text;
  v_enviado timestamptz;
  v_validade integer;
  v_vencido boolean;
  v_antes jsonb;
  v_depois jsonb;
  v_res jsonb;
BEGIN
  IF p_token IS NULL OR p_token !~ '^bxp_[0-9a-f]{48}$' THEN RETURN jsonb_build_object('erro', 'token_invalido'); END IF;
  SELECT * INTO v_tok FROM public.api_tokens WHERE hash = encode(digest(p_token, 'sha256'), 'hex');
  IF NOT FOUND OR v_tok.revogado_em IS NOT NULL THEN RETURN jsonb_build_object('erro', 'token_invalido'); END IF;
  IF v_tok.expira_em <= now() THEN RETURN jsonb_build_object('erro', 'token_expirado'); END IF;
  IF p_acao NOT IN ('renovar_orcamento', 'mover_etapa_comercial', 'registrar_nota_do_cliente') THEN
    RETURN jsonb_build_object('erro', 'acao_desconhecida');
  END IF;

  BEGIN
    IF p_acao IN ('renovar_orcamento', 'mover_etapa_comercial') THEN v_id := (p_args->>'orcamento_id')::uuid; END IF;
    IF p_acao = 'registrar_nota_do_cliente' THEN
      v_id := (p_args->>'cliente_id')::uuid;
      v_texto := left(btrim(coalesce(p_args->>'texto', '')), 2000);
    END IF;
    IF p_acao = 'mover_etapa_comercial' THEN v_etapa := nullif(btrim(coalesce(p_args->>'etapa', '')), ''); END IF;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('erro', 'args_invalidos');
  END;
  IF v_id IS NULL THEN RETURN jsonb_build_object('erro', 'args_invalidos'); END IF;
  IF p_acao = 'registrar_nota_do_cliente' AND coalesce(v_texto, '') = '' THEN RETURN jsonb_build_object('erro', 'args_invalidos'); END IF;
  IF p_acao = 'mover_etapa_comercial' AND (v_etapa IS NULL OR v_etapa NOT IN ('em_negociacao', 'aceite_verbal', 'enviado')) THEN
    RETURN jsonb_build_object('erro', 'args_invalidos');
  END IF;

  -- Rastro e uso, ainda como papel de entrada (a pessoa não escreve nestas tabelas).
  UPDATE public.api_tokens SET ultimo_uso_em = now(), usos = usos + 1 WHERE id = v_tok.id;
  INSERT INTO public.api_acoes (token_id, user_id, acao, argumentos, confirmado)
  VALUES (v_tok.id, v_tok.user_id, p_acao, coalesce(p_args, '{}'::jsonb), coalesce(p_confirmado, false))
  RETURNING id INTO v_log;

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_tok.user_id, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_tok.user_id::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  -- Daqui em diante, COMO A PESSOA. Erro de permissão vira resposta, não exceção.
  BEGIN
    SET LOCAL ROLE authenticated;
    CASE p_acao
      WHEN 'renovar_orcamento' THEN
        SELECT o.numero::text, o.status::text, o.enviado_em, o.validade_dias
          INTO v_numero, v_status, v_enviado, v_validade
          FROM public.orcamentos o WHERE o.id = v_id;
        IF NOT FOUND THEN
          v_res := jsonb_build_object('erro', 'nao_encontrado');
        ELSE
          v_vencido := v_enviado IS NOT NULL AND coalesce(v_validade, 0) > 0 AND v_enviado + make_interval(days => v_validade) < now();
          v_antes := jsonb_build_object('orcamento_id', v_id, 'numero', v_numero, 'status', v_status, 'enviado_em', v_enviado, 'validade_dias', v_validade);
          IF NOT (v_status = 'expirado' OR (v_status = 'enviado' AND v_vencido)) THEN
            v_res := jsonb_build_object('erro', 'estado_invalido', 'antes', v_antes, 'mensagem', 'Só renova orçamento expirado ou enviado que passou da validade.');
          ELSE
            v_depois := jsonb_build_object('orcamento_id', v_id, 'numero', v_numero, 'status', 'enviado', 'enviado_em', now(), 'validade_dias', v_validade);
            IF p_confirmado THEN
              UPDATE public.orcamentos SET status = 'enviado', enviado_em = now() WHERE id = v_id;
              IF NOT FOUND THEN v_res := jsonb_build_object('erro', 'sem_permissao'); END IF;
            END IF;
          END IF;
        END IF;
      WHEN 'mover_etapa_comercial' THEN
        SELECT o.numero::text, o.status::text, o.etapa_comercial
          INTO v_numero, v_status, v_etapa_atual
          FROM public.orcamentos o WHERE o.id = v_id;
        IF NOT FOUND THEN
          v_res := jsonb_build_object('erro', 'nao_encontrado');
        ELSE
          v_antes := jsonb_build_object('orcamento_id', v_id, 'numero', v_numero, 'status', v_status, 'etapa_comercial', v_etapa_atual);
          IF v_status <> 'enviado' THEN
            v_res := jsonb_build_object('erro', 'estado_invalido', 'antes', v_antes, 'mensagem', 'A etapa comercial só existe em orçamento enviado.');
          ELSE
            v_depois := jsonb_build_object('orcamento_id', v_id, 'numero', v_numero, 'status', v_status, 'etapa_comercial', CASE WHEN v_etapa = 'enviado' THEN NULL ELSE v_etapa END);
            IF p_confirmado THEN
              UPDATE public.orcamentos SET etapa_comercial = CASE WHEN v_etapa = 'enviado' THEN NULL ELSE v_etapa END WHERE id = v_id;
              IF NOT FOUND THEN v_res := jsonb_build_object('erro', 'sem_permissao'); END IF;
            END IF;
          END IF;
        END IF;
      WHEN 'registrar_nota_do_cliente' THEN
        SELECT c.nome INTO v_numero FROM public.clientes c WHERE c.id = v_id;
        IF NOT FOUND THEN
          v_res := jsonb_build_object('erro', 'nao_encontrado');
        ELSE
          v_antes := jsonb_build_object('cliente_id', v_id, 'cliente', v_numero);
          v_depois := jsonb_build_object('cliente_id', v_id, 'cliente', v_numero, 'nota', v_texto, 'autor_id', v_tok.user_id);
          IF p_confirmado THEN
            INSERT INTO public.cliente_notas (cliente_id, autor_id, texto) VALUES (v_id, v_tok.user_id, v_texto);
          END IF;
        END IF;
    END CASE;
  EXCEPTION
    WHEN insufficient_privilege THEN v_res := jsonb_build_object('erro', 'sem_permissao');
    WHEN OTHERS THEN v_res := jsonb_build_object('erro', 'falha', 'detalhe', left(SQLERRM, 200));
  END;
  EXECUTE format('SET LOCAL ROLE %I', v_papel);

  IF v_res IS NULL THEN
    v_res := jsonb_build_object(
      'acao', p_acao,
      'ensaio', NOT coalesce(p_confirmado, false),
      'antes', v_antes,
      'depois', v_depois,
      'mensagem', CASE WHEN coalesce(p_confirmado, false) THEN 'Gravado.' ELSE 'Ensaio: nada foi gravado. Repita com confirmado = true para gravar.' END
    );
  END IF;
  UPDATE public.api_acoes SET resultado = v_res WHERE id = v_log;
  RETURN v_res;
END;
$$;

REVOKE ALL ON FUNCTION public.api_executar(text, text, jsonb, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_executar(text, text, jsonb, boolean) TO service_role;
