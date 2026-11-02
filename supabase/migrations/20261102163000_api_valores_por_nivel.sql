-- API de leitura: valores por nível, nome do cliente e filtro por cliente (02/11/2026).
--
-- A Onda 1 saiu sem valor de orçamento e de OS porque `valor_total` não tem
-- SELECT para `authenticated` na tabela: o app lê pelas views por nível. Aqui a
-- API faz o mesmo. Orçamento e OS ganham `valor_total` lido da view comercial
-- (`orcamentos_comercial`, `ordens_servico_comercial`), que só devolve linha
-- para quem passa em `is_staff AND can_see_prices`. Quem não vê preço recebe a
-- resposta SEM a chave `valor_total` (não zero, não nulo: ausente).
--
-- Também entram `cliente_nome` (lido de `clientes` sob a RLS de quem pede: sem
-- permissão vira nulo), `etapa_comercial` nos orçamentos (coluna liberada na
-- Onda 3), o filtro `cliente_id` e a busca por nome do cliente.
--
-- Defeito de paginação corrigido: a ordenação não tinha desempate, então duas
-- linhas com a mesma data podiam repetir ou sumir entre páginas, e a soma de
-- `bexprint_somar` (que pagina) sairia errada. Todas ordenam por `id` no fim.
--
-- A função continua SECURITY INVOKER, só service_role executa, e a troca de
-- papel volta ao de entrada.

CREATE OR REPLACE FUNCTION public.api_consultar(p_token text, p_recurso text, p_filtros jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_papel text := current_user;
  v_tok public.api_tokens%ROWTYPE;
  v_limite integer;
  v_desloc integer;
  v_busca text;
  v_status text;
  v_desde date;
  v_ate date;
  v_cliente uuid;
  v_ver boolean := false;
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
    v_cliente := nullif(btrim(coalesce(p_filtros->>'cliente_id', '')), '')::uuid;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('erro', 'filtro_invalido');
  END;

  -- Uso registrado ainda como papel de entrada (a pessoa não escreve em api_tokens).
  UPDATE public.api_tokens SET ultimo_uso_em = now(), usos = usos + 1 WHERE id = v_tok.id;

  -- Daqui em diante, a leitura é COMO A PESSOA: a RLS decide. Sem ler auth.users
  -- (service_role não enxerga essa tabela): a RLS só precisa do `sub`.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_tok.user_id, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_tok.user_id::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;
  v_ver := public.can_see_prices(v_tok.user_id);

  CASE p_recurso
    WHEN 'clientes' THEN
      WITH f AS (
        SELECT c.id, c.nome, c.razao_social, c.documento, c.telefone, c.email, c.cidade, c.estado, c.pais, c.origem, c.created_at
          FROM public.clientes c
         WHERE c.ativo
           AND (v_busca IS NULL OR c.nome ILIKE '%' || v_busca || '%' OR coalesce(c.razao_social, '') ILIKE '%' || v_busca || '%')
           AND (v_desde IS NULL OR c.created_at >= v_desde) AND (v_ate IS NULL OR c.created_at < v_ate + 1)
      ), pag AS (
        SELECT * FROM f ORDER BY nome, id LIMIT v_limite OFFSET v_desloc
      )
      SELECT (SELECT count(*) FROM f),
             coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.nome, p.id) FROM pag p), '[]'::jsonb)
        INTO v_total, v_itens;

    WHEN 'orcamentos' THEN
      WITH f AS (
        SELECT o.id, o.numero, o.titulo, o.status::text AS status, o.etapa_comercial, o.cliente_id, c.nome AS cliente_nome,
               o.contato_nome, oc.valor_total, o.validade_dias, o.enviado_em, o.aprovado_em, o.prazo, o.created_at
          FROM public.orcamentos o
          LEFT JOIN public.clientes c ON c.id = o.cliente_id
          LEFT JOIN public.orcamentos_comercial oc ON oc.id = o.id
         WHERE (v_status IS NULL OR o.status::text = v_status)
           AND (v_cliente IS NULL OR o.cliente_id = v_cliente)
           AND (v_busca IS NULL OR coalesce(o.titulo, '') ILIKE '%' || v_busca || '%' OR o.numero::text = v_busca OR coalesce(c.nome, '') ILIKE '%' || v_busca || '%')
           AND (v_desde IS NULL OR o.created_at >= v_desde) AND (v_ate IS NULL OR o.created_at < v_ate + 1)
      ), pag AS (
        SELECT * FROM f ORDER BY created_at DESC, id LIMIT v_limite OFFSET v_desloc
      )
      SELECT (SELECT count(*) FROM f),
             coalesce((SELECT jsonb_agg(CASE WHEN v_ver THEN to_jsonb(p) ELSE to_jsonb(p) - 'valor_total' END ORDER BY p.created_at DESC, p.id) FROM pag p), '[]'::jsonb)
        INTO v_total, v_itens;

    WHEN 'os' THEN
      WITH f AS (
        SELECT s.id, s.numero, s.titulo, s.status::text AS status, s.cliente_id, c.nome AS cliente_nome,
               s.prazo_entrega, s.setor_atual, s.prioridade, osc.valor_total, s.created_at
          FROM public.ordens_servico s
          LEFT JOIN public.clientes c ON c.id = s.cliente_id
          LEFT JOIN public.ordens_servico_comercial osc ON osc.id = s.id
         WHERE (v_status IS NULL OR s.status::text = v_status)
           AND (v_cliente IS NULL OR s.cliente_id = v_cliente)
           AND (v_busca IS NULL OR coalesce(s.titulo, '') ILIKE '%' || v_busca || '%' OR s.numero::text = v_busca OR coalesce(c.nome, '') ILIKE '%' || v_busca || '%')
           AND (v_desde IS NULL OR s.created_at >= v_desde) AND (v_ate IS NULL OR s.created_at < v_ate + 1)
      ), pag AS (
        SELECT * FROM f ORDER BY created_at DESC, id LIMIT v_limite OFFSET v_desloc
      )
      SELECT (SELECT count(*) FROM f),
             coalesce((SELECT jsonb_agg(CASE WHEN v_ver THEN to_jsonb(p) ELSE to_jsonb(p) - 'valor_total' END ORDER BY p.created_at DESC, p.id) FROM pag p), '[]'::jsonb)
        INTO v_total, v_itens;

    WHEN 'contas_receber' THEN
      WITH f AS (
        SELECT p.id, p.os_id, p.valor, p.status::text AS status, p.data_vencimento, p.data_pagamento, p.forma_pagamento, p.parcela, p.total_parcelas
          FROM public.pagamentos p
         WHERE (v_status IS NULL OR p.status::text = v_status)
           AND (v_desde IS NULL OR p.data_vencimento >= v_desde) AND (v_ate IS NULL OR p.data_vencimento <= v_ate)
      ), pag AS (
        SELECT * FROM f ORDER BY data_vencimento DESC NULLS LAST, id LIMIT v_limite OFFSET v_desloc
      )
      SELECT (SELECT count(*) FROM f),
             coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.data_vencimento DESC NULLS LAST, p.id) FROM pag p), '[]'::jsonb)
        INTO v_total, v_itens;

    WHEN 'contas_pagar' THEN
      WITH f AS (
        SELECT c.id, c.descricao, c.fornecedor, c.categoria, c.valor, c.vencimento, c.data_pagamento, c.status::text AS status
          FROM public.contas_pagar c
         WHERE (v_status IS NULL OR c.status::text = v_status)
           AND (v_busca IS NULL OR coalesce(c.descricao, '') ILIKE '%' || v_busca || '%' OR coalesce(c.fornecedor, '') ILIKE '%' || v_busca || '%')
           AND (v_desde IS NULL OR c.vencimento >= v_desde) AND (v_ate IS NULL OR c.vencimento <= v_ate)
      ), pag AS (
        SELECT * FROM f ORDER BY vencimento DESC NULLS LAST, id LIMIT v_limite OFFSET v_desloc
      )
      SELECT (SELECT count(*) FROM f),
             coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.vencimento DESC NULLS LAST, p.id) FROM pag p), '[]'::jsonb)
        INTO v_total, v_itens;
  END CASE;

  EXECUTE format('SET LOCAL ROLE %I', v_papel);
  RETURN jsonb_build_object(
    'recurso', p_recurso, 'total', v_total, 'limite', v_limite, 'deslocamento', v_desloc,
    'itens', v_itens, 'usuario_id', v_tok.user_id, 've_valores', v_ver
  );
END;
$$;

REVOKE ALL ON FUNCTION public.api_consultar(text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_consultar(text, text, jsonb) TO service_role;
