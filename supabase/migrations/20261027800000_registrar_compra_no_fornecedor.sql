-- Registrar compra nova na aba Fornecedores (26/10/2026, pedido do dono).
--
-- APLICADA no banco vivo em 26/10/2026 pelo MCP, depois de ensaio com rollback
-- (Cibele, Fernando, Leonardo, Raymison); conferida logo em seguida.
--
-- A aba Fornecedores (20261027700000) mostrava as compras, mas só entravam por
-- migração (as 8 da Camaleão, 20261027700500). Agora a tela registra o
-- documento do fornecedor com os itens, e corrige um registro errado excluindo
-- com motivo. As tabelas continuam sem escrita direta da API: tudo passa por
-- estas duas funções, que conferem a permissão e as contas.
--
-- registrar_compra_fornecedor(jsonb) — pagamentos.create OU compras.create
--   (admin, financeiro, gestor, estoque). O total de cada item é quantidade ×
--   preço pago, calculado aqui; o total do documento é a soma dos itens; bruto
--   e desconto saem do preço de tabela. Devolução: quantidades negativas,
--   aponta para uma VENDA do mesmo fornecedor e não devolve mais do que ela
--   valeu. Item ligado a material do estoque exige quanto ele rende (m², ml).
-- excluir_compra_fornecedor(uuid, text) — pagamentos.reverse OU compras.cancel
--   (admin, financeiro, gestor), com motivo. A linha da auditoria guarda o
--   motivo e os itens excluídos. Venda com devolução não sai antes da devolução.
--
-- Continua REGISTRO: nada aqui mexe em estoque, caixa, contas a pagar ou custo
-- do material.

CREATE OR REPLACE FUNCTION public.registrar_compra_fornecedor(p jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_forn uuid := nullif(p ->> 'fornecedor_id', '')::uuid;
  v_documento text := nullif(btrim(coalesce(p ->> 'documento', '')), '');
  v_tipo text := p ->> 'tipo';
  v_data timestamptz := nullif(p ->> 'data_operacao', '')::timestamptz;
  v_comprador text := nullif(btrim(coalesce(p ->> 'comprador_nome', '')), '');
  v_devolve uuid := nullif(p ->> 'devolve_compra_id', '')::uuid;
  v_itens jsonb := coalesce(p -> 'itens', '[]'::jsonb);
  v_item jsonb;
  v_ordem int := 0;
  v_qtd numeric;
  v_preco numeric;
  v_lista numeric;
  v_desc numeric;
  v_material uuid;
  v_rende numeric;
  v_total numeric := 0;
  v_bruto numeric := 0;
  v_venda record;
  v_ja_devolvido numeric;
  v_id uuid;
BEGIN
  IF NOT (public.has_permission(v_uid, 'pagamentos.create') OR public.has_permission(v_uid, 'compras.create')) THEN
    RAISE EXCEPTION 'Você não pode registrar compra.' USING ERRCODE = '42501';
  END IF;
  IF v_forn IS NULL OR NOT EXISTS (SELECT 1 FROM public.fornecedores WHERE id = v_forn) THEN
    RAISE EXCEPTION 'Fornecedor não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  IF v_documento IS NULL THEN
    RAISE EXCEPTION 'Informe o número do documento do fornecedor.' USING ERRCODE = '22023';
  END IF;
  IF v_tipo IS NULL OR v_tipo NOT IN ('venda', 'reserva', 'devolucao') THEN
    RAISE EXCEPTION 'Tipo do documento: venda, reserva ou devolução.' USING ERRCODE = '22023';
  END IF;
  IF v_data IS NULL THEN
    RAISE EXCEPTION 'Informe a data da compra.' USING ERRCODE = '22023';
  END IF;
  IF v_data > now() + interval '1 day' THEN
    RAISE EXCEPTION 'A data da compra está no futuro.' USING ERRCODE = '22023';
  END IF;
  IF v_comprador IS NULL THEN
    RAISE EXCEPTION 'Informe quem comprou (Bex Print ou Agência Bex).' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(v_itens) <> 'array' OR jsonb_array_length(v_itens) = 0 THEN
    RAISE EXCEPTION 'A compra precisa de pelo menos um item.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(v_itens) > 200 THEN
    RAISE EXCEPTION 'No máximo 200 itens por documento.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.compras_fornecedor WHERE fornecedor_id = v_forn AND documento = v_documento) THEN
    RAISE EXCEPTION 'O documento % já está registrado neste fornecedor.', v_documento USING ERRCODE = '23505';
  END IF;

  IF v_tipo = 'devolucao' THEN
    IF v_devolve IS NULL THEN
      RAISE EXCEPTION 'Devolução precisa dizer qual venda ela desfaz.' USING ERRCODE = '22023';
    END IF;
    SELECT id, tipo, total, fornecedor_id, documento INTO v_venda
      FROM public.compras_fornecedor WHERE id = v_devolve;
    IF v_venda.id IS NULL OR v_venda.fornecedor_id <> v_forn OR v_venda.tipo <> 'venda' THEN
      RAISE EXCEPTION 'A devolução tem de apontar para uma venda deste fornecedor.' USING ERRCODE = '22023';
    END IF;
  ELSIF v_devolve IS NOT NULL THEN
    RAISE EXCEPTION 'Só devolução aponta para outra compra.' USING ERRCODE = '22023';
  END IF;

  -- Conta os itens antes de gravar qualquer coisa.
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_itens) LOOP
    v_ordem := v_ordem + 1;
    IF nullif(btrim(coalesce(v_item ->> 'descricao', '')), '') IS NULL THEN
      RAISE EXCEPTION 'Item %: falta a descrição.', v_ordem USING ERRCODE = '22023';
    END IF;
    v_qtd := nullif(v_item ->> 'quantidade', '')::numeric;
    v_preco := nullif(v_item ->> 'preco_unitario', '')::numeric;
    v_lista := nullif(v_item ->> 'preco_lista', '')::numeric;
    v_desc := nullif(v_item ->> 'desconto_pct', '')::numeric;
    v_material := nullif(v_item ->> 'material_id', '')::uuid;
    v_rende := nullif(v_item ->> 'rende_do_material', '')::numeric;
    IF v_qtd IS NULL OR v_qtd = 0 THEN
      RAISE EXCEPTION 'Item %: informe a quantidade.', v_ordem USING ERRCODE = '22023';
    END IF;
    IF v_tipo = 'devolucao' AND v_qtd > 0 THEN
      RAISE EXCEPTION 'Item %: na devolução a quantidade é negativa.', v_ordem USING ERRCODE = '22023';
    END IF;
    IF v_tipo <> 'devolucao' AND v_qtd < 0 THEN
      RAISE EXCEPTION 'Item %: quantidade negativa só em devolução.', v_ordem USING ERRCODE = '22023';
    END IF;
    IF v_preco IS NULL OR v_preco < 0 THEN
      RAISE EXCEPTION 'Item %: informe o preço pago.', v_ordem USING ERRCODE = '22023';
    END IF;
    IF v_lista IS NOT NULL AND v_lista < 0 THEN
      RAISE EXCEPTION 'Item %: preço de tabela negativo.', v_ordem USING ERRCODE = '22023';
    END IF;
    IF v_desc IS NOT NULL AND (v_desc < 0 OR v_desc > 100) THEN
      RAISE EXCEPTION 'Item %: desconto entre 0 e 100%%.', v_ordem USING ERRCODE = '22023';
    END IF;
    IF coalesce(v_item ->> 'finalidade', '') NOT IN ('materia_prima', 'tinta', 'ferramenta', 'consumo', 'outro') THEN
      RAISE EXCEPTION 'Item %: para que é (matéria-prima, tinta, ferramenta, consumo ou outro).', v_ordem USING ERRCODE = '22023';
    END IF;
    IF v_material IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.materiais WHERE id = v_material) THEN
      RAISE EXCEPTION 'Item %: material do estoque não encontrado.', v_ordem USING ERRCODE = '22023';
    END IF;
    IF v_material IS NOT NULL AND (v_rende IS NULL OR v_rende <= 0) THEN
      RAISE EXCEPTION 'Item %: diga quanto do material uma unidade rende (ex.: rolo 1,06 × 50 = 53 m²).', v_ordem USING ERRCODE = '22023';
    END IF;
    v_total := v_total + round(v_qtd * v_preco, 2);
    v_bruto := v_bruto + round(v_qtd * coalesce(v_lista, v_preco), 2);
  END LOOP;

  IF v_tipo = 'devolucao' THEN
    -- Como o fornecedor mostra a devolução: bruto = total, sem desconto.
    v_bruto := v_total;
    SELECT coalesce(sum(-total), 0) INTO v_ja_devolvido
      FROM public.compras_fornecedor WHERE devolve_compra_id = v_venda.id;
    IF v_ja_devolvido + (-v_total) > v_venda.total THEN
      RAISE EXCEPTION 'A devolução passa do valor da %: % já devolvido de %.', v_venda.documento, v_ja_devolvido, v_venda.total
        USING ERRCODE = '22023';
    END IF;
  END IF;

  INSERT INTO public.compras_fornecedor (fornecedor_id, documento, tipo, data_operacao, comprador_nome, comprador_cnpj,
    codigo_cliente, forma_pagamento, condicao_pagamento, pago, total_bruto, desconto, total, devolve_compra_id,
    observacoes, fonte, created_by)
  VALUES (v_forn, v_documento, v_tipo, v_data, v_comprador, nullif(btrim(coalesce(p ->> 'comprador_cnpj', '')), ''),
    nullif(btrim(coalesce(p ->> 'codigo_cliente', '')), ''), nullif(btrim(coalesce(p ->> 'forma_pagamento', '')), ''),
    nullif(btrim(coalesce(p ->> 'condicao_pagamento', '')), ''), coalesce((p ->> 'pago')::boolean, true),
    v_bruto, v_bruto - v_total, v_total, v_devolve,
    nullif(btrim(coalesce(p ->> 'observacoes', '')), ''), 'Registrado na tela Fornecedores', v_uid)
  RETURNING id INTO v_id;

  INSERT INTO public.compras_fornecedor_itens (compra_id, ordem, codigo, descricao, unidade, quantidade, preco_lista,
    desconto_pct, preco_unitario, total, finalidade, material_id, rende_do_material)
  SELECT v_id, e.ordinality::int,
         nullif(btrim(coalesce(e.value ->> 'codigo', '')), ''),
         btrim(e.value ->> 'descricao'),
         nullif(btrim(coalesce(e.value ->> 'unidade', '')), ''),
         (e.value ->> 'quantidade')::numeric,
         nullif(e.value ->> 'preco_lista', '')::numeric,
         nullif(e.value ->> 'desconto_pct', '')::numeric,
         (e.value ->> 'preco_unitario')::numeric,
         round((e.value ->> 'quantidade')::numeric * (e.value ->> 'preco_unitario')::numeric, 2),
         e.value ->> 'finalidade',
         nullif(e.value ->> 'material_id', '')::uuid,
         nullif(e.value ->> 'rende_do_material', '')::numeric
    FROM jsonb_array_elements(v_itens) WITH ORDINALITY AS e(value, ordinality);

  RETURN v_id;
END
$function$;

COMMENT ON FUNCTION public.registrar_compra_fornecedor(jsonb) IS
  'Registra o documento do fornecedor com os itens (venda, reserva, devolução). Exige pagamentos.create ou compras.create. Totais calculados aqui. Não mexe em estoque, caixa nem custo.';
REVOKE ALL ON FUNCTION public.registrar_compra_fornecedor(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_compra_fornecedor(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.excluir_compra_fornecedor(p_id uuid, p_motivo text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_doc record;
  v_itens jsonb;
  v_devolucao text;
BEGIN
  IF NOT (public.has_permission(v_uid, 'pagamentos.reverse') OR public.has_permission(v_uid, 'compras.cancel')) THEN
    RAISE EXCEPTION 'Você não pode excluir registro de compra.' USING ERRCODE = '42501';
  END IF;
  IF v_motivo IS NULL OR length(v_motivo) < 5 THEN
    RAISE EXCEPTION 'Diga por que o registro sai (pelo menos 5 letras).' USING ERRCODE = '22023';
  END IF;
  SELECT id, documento INTO v_doc FROM public.compras_fornecedor WHERE id = p_id;
  IF v_doc.id IS NULL THEN
    RAISE EXCEPTION 'Registro de compra não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  SELECT string_agg(documento, ', ') INTO v_devolucao FROM public.compras_fornecedor WHERE devolve_compra_id = p_id;
  IF v_devolucao IS NOT NULL THEN
    RAISE EXCEPTION 'A % tem devolução registrada (%): exclua a devolução antes.', v_doc.documento, v_devolucao
      USING ERRCODE = '23503';
  END IF;

  SELECT coalesce(jsonb_agg(to_jsonb(i) - 'compra_id' ORDER BY i.ordem), '[]'::jsonb) INTO v_itens
    FROM public.compras_fornecedor_itens i WHERE i.compra_id = p_id;

  DELETE FROM public.compras_fornecedor WHERE id = p_id;

  -- O gatilho de auditoria acabou de gravar a exclusão; o motivo e os itens
  -- (que saem em cascata, sem auditoria própria) vão na mesma linha.
  UPDATE public.logs_auditoria
     SET detalhes = coalesce(detalhes, '{}'::jsonb) || jsonb_build_object('motivo', v_motivo, 'itens', v_itens)
   WHERE entidade = 'compras_fornecedor' AND entidade_id = p_id AND acao = 'delete' AND created_at = now();
END
$function$;

COMMENT ON FUNCTION public.excluir_compra_fornecedor(uuid, text) IS
  'Exclui um registro de compra feito errado, com motivo. Exige pagamentos.reverse ou compras.cancel. A auditoria guarda o motivo e os itens.';
REVOKE ALL ON FUNCTION public.excluir_compra_fornecedor(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.excluir_compra_fornecedor(uuid, text) TO authenticated;
