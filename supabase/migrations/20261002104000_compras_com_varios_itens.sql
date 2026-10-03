-- Compras com vários itens — criar, revisar, receber e cancelar o pedido inteiro
-- ---------------------------------------------------------------------------
-- O módulo de compras (20260901110000) modelou o pedido certo — cabeçalho em
-- `pedidos_compra`, uma linha por material em `pedido_compra_itens` — e a tela
-- usou metade: o formulário tinha UM material, uma quantidade e um custo, e
-- gravava em duas chamadas soltas. Se a segunda caísse, sobrava um pedido sem
-- item nenhum, "aguardando entrega" para sempre. Resultado medido em 02/10/2026:
-- 0 pedidos e 0 itens desde a criação do módulo.
--
-- E havia um elo morto: o "Comprar o que falta" da OS cria o pedido como
-- RASCUNHO, com fornecedor "A definir", e avisa "a tela de Compras deixa
-- corrigir antes de enviar". A tela não deixava: não havia como editar nem
-- registrar um rascunho, e o status 'cancelado' (com a permissão
-- compras.cancel) não tinha nenhum caminho que o gravasse.
--
-- O que esta migração acrescenta (só funções novas; nenhuma tabela, coluna ou
-- função existente foi alterada):
--
--   salvar_pedido_compra   cria ou altera o pedido com todos os itens numa
--                          transação só. INVOKER: a RLS de compras vale como
--                          está (compras.create). Recusa material repetido
--                          (a tabela tem UNIQUE (pedido_id, material_id)),
--                          quantidade zero, custo negativo e "A definir" na
--                          hora de registrar. Pedido com algo recebido vira
--                          histórico e não muda mais.
--   receber_pedido_compra  recebe vários itens de uma vez, tudo ou nada. NÃO é
--                          um segundo caminho de estoque: cada item passa por
--                          `receber_item_compra`, que chama
--                          `registrar_entrada_material` — lote, movimentação e
--                          custo médio continuam nascendo num lugar só.
--                          Recusa RASCUNHO: a entrada grava o fornecedor no
--                          lote e em `materiais.fornecedor`, e o rascunho da OS
--                          pode estar com "A definir" (medido no ensaio: o
--                          fornecedor do material é sobrescrito na entrada).
--   cancelar_pedido_compra exige compras.cancel e um motivo, que fica nas
--                          observações. O que já chegou continua no estoque.
--
-- Achado de passagem, NÃO corrigido aqui: compras.receive é de admin, estoque e
-- gestor, mas a entrada exige estoque.entry, que é só de admin e estoque. Um
-- gestor (hoje 0 contas) veria o botão e o banco recusaria no meio. Por isso
-- `receber_pedido_compra` confere estoque.entry logo no começo, com a mensagem
-- da permissão que falta.
--
-- Ensaiado antes de aplicar (DO ... RAISE EXCEPTION, tudo desfeito, inclusive a
-- sequência do número do pedido, devolvida com setval): criar com 2 itens
-- (total R$ 195,00), recusar material repetido, quantidade zero e "A definir";
-- editar (2 → 1 item); receber 5 de 12 (estoque da lona 44 → 49, custo médio
-- 16,23 → 16,00, lote novo, motivo "Pedido de compra #2 — NF 123"); recusar
-- edição depois de receber; operador barrado em compras.create, financeiro em
-- compras.receive e compras.cancel (mas lê o pedido); cancelar sem motivo
-- recusado, com motivo grava "Cancelado em 02/10/2026 por ..."; receber pedido
-- cancelado recusado. Segundo ensaio, já com as funções no ar: rascunho com
-- "A definir" → registrado; pedido inteiro recebido numa chamada → 'recebido';
-- "nf: 4567" vira "NF 4567"; receber a mais diz o material e a unidade
-- ("De Lona 440g reforçada, faltam 3 m2 neste pedido e foram informados 4 m2");
-- a mesma linha repetida na chamada derruba a chamada inteira; rascunho é
-- recusado e, depois de registrado, recebe. A sequência de `numero` foi
-- devolvida ao ponto de partida em todos os ensaios (last_value 1).


-- ---------------------------------------------------------------------------
-- 1. Criar e alterar o pedido inteiro
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.salvar_pedido_compra(
  p_pedido_id uuid,
  p_fornecedor text,
  p_itens jsonb,
  p_previsao_entrega date DEFAULT NULL,
  p_observacoes text DEFAULT NULL,
  p_enviar boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pedido public.pedidos_compra%ROWTYPE;
  v_item jsonb;
  v_material uuid;
  v_qtd numeric;
  v_custo numeric;
  v_nome text;
  v_vistos uuid[] := ARRAY[]::uuid[];
  v_total numeric := 0;
  v_fornecedor text := btrim(coalesce(p_fornecedor, ''));
BEGIN
  PERFORM public.require_permission('compras.create');

  IF v_fornecedor = '' THEN
    RAISE EXCEPTION 'Informe o fornecedor.';
  END IF;
  -- "A definir" é o palpite do "Comprar o que falta" da OS: serve para rascunho,
  -- não para pedido registrado.
  IF p_enviar AND lower(v_fornecedor) = 'a definir' THEN
    RAISE EXCEPTION 'Defina o fornecedor antes de registrar o pedido.';
  END IF;
  IF p_itens IS NULL OR jsonb_typeof(p_itens) <> 'array' OR jsonb_array_length(p_itens) = 0 THEN
    RAISE EXCEPTION 'O pedido precisa de pelo menos um material.';
  END IF;

  -- Confere todas as linhas antes de gravar qualquer uma.
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_itens) LOOP
    v_material := NULLIF(v_item->>'material_id', '')::uuid;
    IF v_material IS NULL THEN
      RAISE EXCEPTION 'Escolha o material de todas as linhas.';
    END IF;
    SELECT m.nome INTO v_nome FROM public.materiais m WHERE m.id = v_material;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Material não encontrado.';
    END IF;
    IF v_material = ANY (v_vistos) THEN
      RAISE EXCEPTION 'O material % aparece duas vezes. Junte as quantidades numa linha só.', v_nome;
    END IF;
    v_vistos := v_vistos || v_material;
    v_qtd := NULLIF(v_item->>'quantidade', '')::numeric;
    v_custo := NULLIF(v_item->>'custo_unitario', '')::numeric;
    IF v_qtd IS NULL OR v_qtd <= 0 THEN
      RAISE EXCEPTION 'Informe a quantidade de %.', v_nome;
    END IF;
    IF v_custo IS NULL OR v_custo < 0 THEN
      RAISE EXCEPTION 'Informe o custo unitário de %.', v_nome;
    END IF;
    v_total := v_total + v_qtd * v_custo;
  END LOOP;

  IF p_pedido_id IS NULL THEN
    INSERT INTO public.pedidos_compra (fornecedor, status, previsao_entrega, observacoes, created_by)
    VALUES (v_fornecedor,
            CASE WHEN p_enviar THEN 'enviado' ELSE 'rascunho' END,
            p_previsao_entrega,
            NULLIF(btrim(coalesce(p_observacoes, '')), ''),
            auth.uid())
    RETURNING * INTO v_pedido;
  ELSE
    SELECT * INTO v_pedido FROM public.pedidos_compra WHERE id = p_pedido_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Pedido não encontrado.';
    END IF;
    IF v_pedido.status = 'cancelado' THEN
      RAISE EXCEPTION 'O pedido #% foi cancelado e não pode mais ser alterado.', v_pedido.numero;
    END IF;
    -- Depois que algo chegou, o pedido é histórico: o lote e o custo médio já
    -- foram gravados a partir dele.
    IF v_pedido.status IN ('recebido', 'recebido_parcial')
       OR EXISTS (SELECT 1 FROM public.pedido_compra_itens i
                   WHERE i.pedido_id = p_pedido_id AND i.quantidade_recebida > 0) THEN
      RAISE EXCEPTION 'O pedido #% já teve material recebido e não pode mais ser alterado.', v_pedido.numero;
    END IF;

    -- Rascunho vira enviado quando a pessoa registra; enviado não volta a rascunho.
    UPDATE public.pedidos_compra
       SET fornecedor = v_fornecedor,
           previsao_entrega = p_previsao_entrega,
           observacoes = NULLIF(btrim(coalesce(p_observacoes, '')), ''),
           status = CASE WHEN p_enviar THEN 'enviado' ELSE status END,
           updated_at = now()
     WHERE id = p_pedido_id
    RETURNING * INTO v_pedido;

    DELETE FROM public.pedido_compra_itens i
     WHERE i.pedido_id = p_pedido_id AND NOT (i.material_id = ANY (v_vistos));
  END IF;

  INSERT INTO public.pedido_compra_itens (pedido_id, material_id, quantidade, custo_unitario)
  SELECT v_pedido.id, (e.value->>'material_id')::uuid, (e.value->>'quantidade')::numeric,
         (e.value->>'custo_unitario')::numeric
    FROM jsonb_array_elements(p_itens) e
  ON CONFLICT (pedido_id, material_id)
  DO UPDATE SET quantidade = EXCLUDED.quantidade, custo_unitario = EXCLUDED.custo_unitario;

  RETURN jsonb_build_object(
    'pedido_id', v_pedido.id,
    'numero', v_pedido.numero,
    'status', v_pedido.status,
    'itens', jsonb_array_length(p_itens),
    'total', round(v_total, 2)
  );
END $function$;

REVOKE ALL ON FUNCTION public.salvar_pedido_compra(uuid, text, jsonb, date, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.salvar_pedido_compra(uuid, text, jsonb, date, text, boolean) TO authenticated;
COMMENT ON FUNCTION public.salvar_pedido_compra(uuid, text, jsonb, date, text, boolean) IS
  'Cria (p_pedido_id nulo) ou altera um pedido de compra com vários materiais, numa transação só. Invoker: a RLS de compras vale como está.';

-- ---------------------------------------------------------------------------
-- 2. Receber o pedido inteiro pela via que já existe
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.receber_pedido_compra(
  p_pedido_id uuid,
  p_itens jsonb,
  p_nota text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pedido public.pedidos_compra%ROWTYPE;
  v_item jsonb;
  v_item_id uuid;
  v_qtd numeric;
  v_custo numeric;
  v_nota text;
  v_r jsonb;
  v_recebidos int := 0;
  v_falta numeric;
  v_material text;
  v_unidade text;
BEGIN
  PERFORM public.require_permission('compras.receive');
  -- Receber é dar entrada no estoque, e a entrada exige estoque.entry.
  -- Conferir antes troca o erro do meio do caminho por um aviso claro.
  PERFORM public.require_permission('estoque.entry');

  SELECT * INTO v_pedido FROM public.pedidos_compra WHERE id = p_pedido_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pedido não encontrado.';
  END IF;
  -- Rascunho ainda pode estar com fornecedor "A definir", e a entrada grava o
  -- fornecedor no lote e no cadastro do material. Registrar primeiro.
  IF v_pedido.status = 'rascunho' THEN
    RAISE EXCEPTION 'O pedido #% ainda é rascunho: confira o fornecedor e registre o pedido antes de receber.', v_pedido.numero;
  END IF;
  IF p_itens IS NULL OR jsonb_typeof(p_itens) <> 'array' THEN
    RAISE EXCEPTION 'Informe o que chegou.';
  END IF;

  -- A NF vai junto com o número do pedido: é o motivo da movimentação de estoque.
  -- Quem digita "NF 123" não pode virar "NF NF 123" no histórico.
  v_nota := 'Pedido de compra #' || v_pedido.numero
            || COALESCE(' — NF ' || NULLIF(regexp_replace(btrim(coalesce(p_nota, '')),
                 '^(nf-?e?|nota fiscal)\s*[:nº°#.-]*\s*', '', 'i'), ''), '');

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_itens) LOOP
    v_qtd := COALESCE(NULLIF(v_item->>'quantidade', '')::numeric, 0);
    CONTINUE WHEN v_qtd <= 0;
    v_item_id := NULLIF(v_item->>'item_id', '')::uuid;
    SELECT i.quantidade - i.quantidade_recebida, m.nome, coalesce(m.unidade, 'un')
      INTO v_falta, v_material, v_unidade
      FROM public.pedido_compra_itens i
      JOIN public.materiais m ON m.id = i.material_id
     WHERE i.id = v_item_id AND i.pedido_id = p_pedido_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Um dos itens informados não é do pedido #%.', v_pedido.numero;
    END IF;
    -- receber_item_compra também recusa, mas com o número cru ("3.0000"):
    -- aqui a pessoa lê o material e a unidade.
    IF v_qtd > v_falta THEN
      RAISE EXCEPTION 'De %, faltam % % neste pedido e foram informados % %.',
        v_material, trim_scale(v_falta), v_unidade, trim_scale(v_qtd), v_unidade;
    END IF;
    v_custo := NULLIF(v_item->>'custo_unitario', '')::numeric;
    -- A via oficial, item a item: lote, movimentação e custo médio saem de
    -- registrar_entrada_material, chamada por dentro de receber_item_compra.
    v_r := public.receber_item_compra(v_item_id, v_qtd, v_custo, v_nota);
    v_recebidos := v_recebidos + 1;
  END LOOP;

  IF v_recebidos = 0 THEN
    RAISE EXCEPTION 'Informe a quantidade que chegou de pelo menos um item.';
  END IF;

  RETURN jsonb_build_object(
    'pedido_id', p_pedido_id,
    'numero', v_pedido.numero,
    'itens_recebidos', v_recebidos,
    'pedido_status', v_r->'pedido_status',
    'itens_pendentes', v_r->'itens_pendentes'
  );
END $function$;

REVOKE ALL ON FUNCTION public.receber_pedido_compra(uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.receber_pedido_compra(uuid, jsonb, text) TO authenticated;
COMMENT ON FUNCTION public.receber_pedido_compra(uuid, jsonb, text) IS
  'Recebe vários itens do pedido de uma vez, tudo ou nada. Cada item passa por receber_item_compra, que dá a entrada pela via oficial (registrar_entrada_material).';

-- ---------------------------------------------------------------------------
-- 3. Cancelar, com motivo
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancelar_pedido_compra(p_pedido_id uuid, p_motivo text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid;
  v_pedido public.pedidos_compra%ROWTYPE;
  v_quem text;
  v_motivo text := btrim(coalesce(p_motivo, ''));
  v_ja_chegou boolean;
BEGIN
  v_uid := public.require_permission('compras.cancel');
  IF v_motivo = '' THEN
    RAISE EXCEPTION 'Diga por que o pedido está sendo cancelado.';
  END IF;

  SELECT * INTO v_pedido FROM public.pedidos_compra WHERE id = p_pedido_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pedido não encontrado.';
  END IF;
  IF v_pedido.status IN ('recebido', 'cancelado') THEN
    RAISE EXCEPTION 'O pedido #% já está %.', v_pedido.numero,
      CASE v_pedido.status WHEN 'recebido' THEN 'recebido por inteiro' ELSE 'cancelado' END;
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.pedido_compra_itens i
                  WHERE i.pedido_id = p_pedido_id AND i.quantidade_recebida > 0)
    INTO v_ja_chegou;
  SELECT NULLIF(btrim(coalesce(u.nome, '')), '') INTO v_quem FROM public.usuarios u WHERE u.id = v_uid;

  -- O motivo fica nas observações, que são o que a tela mostra; quem e quando
  -- também ficam na trilha de auditoria (tg_auditar_pedidos_compra).
  UPDATE public.pedidos_compra
     SET status = 'cancelado',
         observacoes = concat_ws(E'\n',
           NULLIF(btrim(coalesce(observacoes, '')), ''),
           format('Cancelado em %s por %s: %s',
                  to_char(now() AT TIME ZONE 'America/Belem', 'DD/MM/YYYY'),
                  coalesce(v_quem, 'usuário sem nome no cadastro'), v_motivo)),
         updated_at = now()
   WHERE id = p_pedido_id;

  RETURN jsonb_build_object(
    'pedido_id', p_pedido_id,
    'numero', v_pedido.numero,
    'status', 'cancelado',
    'ja_tinha_recebido', v_ja_chegou
  );
END $function$;

-- DEFINER porque a permissão que manda é compras.cancel, e a policy de escrita
-- da tabela olha compras.create. search_path fixo e EXECUTE só para logado.
REVOKE ALL ON FUNCTION public.cancelar_pedido_compra(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancelar_pedido_compra(uuid, text) TO authenticated;
COMMENT ON FUNCTION public.cancelar_pedido_compra(uuid, text) IS
  'Cancela o pedido de compra (exige compras.cancel) e grava o motivo nas observações. O que já chegou continua no estoque.';

NOTIFY pgrst, 'reload schema';
