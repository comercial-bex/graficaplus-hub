ALTER TABLE public.parceiro_orcamentos
  ADD COLUMN IF NOT EXISTS venda_direta boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pagamento_modelo text,
  ADD COLUMN IF NOT EXISTS os_id uuid;

COMMENT ON COLUMN public.parceiro_orcamentos.venda_direta IS 'Compra direta do revendedor com a gráfica: sem cliente final e sem PDF.';
COMMENT ON COLUMN public.parceiro_orcamentos.pagamento_modelo IS 'Venda direta: a_vista ou metade_metade (sinal de 50%).';

CREATE POLICY parceiro_orcamentos_venda_direta_equipe ON public.parceiro_orcamentos
  FOR SELECT TO authenticated
  USING (venda_direta AND public.is_staff(auth.uid()));

CREATE OR REPLACE FUNCTION public.parceiro_venda_direta(p_itens jsonb, p_pagamento text, p_observacao text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_parceiro uuid := public.parceiro_do_usuario();
  v_uid uuid := auth.uid();
  v_p public.parceiros%ROWTYPE;
  v_q uuid;
  v_item jsonb;
  v_ordem int := 0;
  v_pedido jsonb;
  v_orc uuid;
  v_os jsonb;
  v_os_id uuid;
  v_total numeric;
BEGIN
  IF v_parceiro IS NULL THEN
    RAISE EXCEPTION 'Acesso de parceiro não encontrado ou suspenso.' USING ERRCODE = '42501';
  END IF;
  IF p_pagamento NOT IN ('a_vista', 'metade_metade') THEN
    RAISE EXCEPTION 'Escolha o pagamento: sinal de 50%% ou à vista.';
  END IF;
  IF jsonb_typeof(p_itens) <> 'array' OR jsonb_array_length(p_itens) = 0 THEN
    RAISE EXCEPTION 'Adicione pelo menos um item à compra.';
  END IF;
  SELECT * INTO v_p FROM public.parceiros WHERE id = v_parceiro;

  INSERT INTO public.parceiro_orcamentos (parceiro_id, titulo, cliente_nome, observacoes, venda_direta, pagamento_modelo)
  VALUES (v_parceiro, 'Venda direta', COALESCE(NULLIF(btrim(v_p.marca_nome), ''), v_p.nome, 'Parceiro'),
          NULLIF(btrim(COALESCE(p_observacao, '')), ''), true, p_pagamento)
  RETURNING id INTO v_q;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_itens) LOOP
    IF NULLIF(v_item->>'produto_id', '') IS NULL THEN
      RAISE EXCEPTION 'Na venda direta todo item precisa ser um produto da tabela.';
    END IF;
    INSERT INTO public.parceiro_orcamento_itens (orcamento_id, produto_id, descricao, unidade, largura, altura, quantidade, preco_venda_unidade, acabamento, ordem)
    VALUES (v_q, (v_item->>'produto_id')::uuid, left(COALESCE(v_item->>'descricao', 'Item'), 300),
            COALESCE(v_item->>'unidade', 'un'), NULLIF(v_item->>'largura', '')::numeric, NULLIF(v_item->>'altura', '')::numeric,
            GREATEST(COALESCE(NULLIF(v_item->>'quantidade', '')::numeric, 1), 0.001), 0,
            NULLIF(v_item->>'acabamento', ''), v_ordem);
    v_ordem := v_ordem + 1;
  END LOOP;

  -- Preços recalculados no banco pela tabela do nível do parceiro.
  v_pedido := public.parceiro_enviar_pedido(v_q, 0);
  v_orc := (v_pedido->>'orcamento_id')::uuid;
  v_total := (v_pedido->>'total')::numeric;

  UPDATE public.orcamentos
     SET condicao_pagamento = jsonb_build_object('modelo', p_pagamento, 'parcelas', CASE WHEN p_pagamento = 'a_vista' THEN 1 ELSE 2 END, 'venda_direta', true),
         titulo = left('Venda direta · ' || COALESCE(NULLIF(btrim(v_p.marca_nome), ''), v_p.nome, 'Parceiro'), 200),
         observacao_interna = observacao_interna || CASE WHEN p_pagamento = 'a_vista' THEN ' · VENDA DIRETA: pagamento à vista.' ELSE ' · VENDA DIRETA: sinal de 50% e restante na entrega.' END
           || COALESCE(' · Obs. do parceiro: ' || NULLIF(btrim(COALESCE(p_observacao, '')), ''), '')
   WHERE id = v_orc;

  -- A OS nasce em nome do atendente do parceiro (a conversão exige permissão da equipe).
  IF public.has_permission(v_p.responsavel_id, 'orcamentos.convert') THEN
    PERFORM set_config('request.jwt.claim.sub', v_p.responsavel_id::text, true);
    BEGIN
      v_os := public.converter_orcamento_em_os(v_orc, '{}'::jsonb);
      v_os_id := NULLIF(v_os->>'os_id', '')::uuid;
    EXCEPTION WHEN OTHERS THEN
      v_os_id := NULL;
    END;
    PERFORM set_config('request.jwt.claim.sub', COALESCE(v_uid::text, ''), true);
  END IF;

  UPDATE public.parceiro_orcamentos SET os_id = v_os_id WHERE id = v_q;

  RETURN jsonb_build_object('id', v_q, 'numero', v_pedido->'numero', 'total', v_total,
    'pagamento', p_pagamento, 'sinal', CASE WHEN p_pagamento = 'a_vista' THEN v_total ELSE round(v_total * 0.5, 2) END,
    'os_id', v_os_id);
END
$$;

REVOKE ALL ON FUNCTION public.parceiro_venda_direta(jsonb, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.parceiro_venda_direta(jsonb, text, text) TO authenticated;