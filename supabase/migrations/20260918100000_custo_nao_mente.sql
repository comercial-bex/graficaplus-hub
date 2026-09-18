-- =============================================================================
-- CUSTO NÃO MENTE — receita com material sem custo não pode derrubar o produto
-- =============================================================================
--
-- O QUE ESTAVA ARMADO
--
-- `recalcular_custo_produto` soma a receita e grava em `produtos.custo_medio`.
-- Dois gatilhos a chamam sozinhos: `tg_receita_recalcula_produto` (alguém mexeu
-- na ficha) e `tg_material_custo_propaga` (mudou o custo de um material). A
-- soma usa COALESCE(custo, 0) — então material SEM custo entra como zero e o
-- produto inteiro barateia em silêncio.
--
-- Conferido no banco em 18/09/2026, com o material "Lona 440g reforçada" ainda
-- sem custo cadastrado:
--
--   Lona 440g reforçada impressa   custo digitado R$ 28,00 → a receita daria R$ 1,26
--   Fachada luminosa em lona       custo digitado R$ 420,00 → a receita daria R$ 0,00
--
-- Bastava abrir a ficha desses produtos e salvar. O estrago não para no
-- cadastro: o custo alimenta a margem da OS, o piso de margem mínima do preço
-- e, agora, o preço do parceiro revendedor — um produto com custo zero perde o
-- piso e pode ser vendido abaixo do custo real sem nada avisar.
--
-- A função já dizia, no próprio comentário, que "zerar isso seria pior do que
-- deixar desatualizado". Só faltava valer também para este caso.

CREATE OR REPLACE FUNCTION public.recalcular_custo_produto(p_produto_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_custo NUMERIC;
  v_sem_custo INTEGER;
BEGIN
  -- Só mexe em produto que TEM receita. Produto sem receita tem custo digitado
  -- à mão, e zerar isso seria pior do que deixar desatualizado.
  SELECT SUM(pm.quantidade_por_unidade * COALESCE(m.custo_medio, m.custo_unitario, 0)),
         count(*) FILTER (WHERE COALESCE(m.custo_medio, m.custo_unitario, 0) <= 0)
    INTO v_custo, v_sem_custo
    FROM public.produto_materiais pm
    JOIN public.materiais m ON m.id = pm.material_id
   WHERE pm.produto_id = p_produto_id;

  IF v_custo IS NULL THEN RETURN; END IF;

  -- Receita com material sem custo dá uma conta menor que a verdade. Manter o
  -- custo que está lá é errado por desatualização; gravar a conta furada é
  -- errado por invenção — e a segunda estraga o preço, a margem e o piso.
  IF v_sem_custo > 0 THEN RETURN; END IF;

  UPDATE public.produtos
     SET custo_medio = ROUND(v_custo, 2), updated_at = now()
   WHERE id = p_produto_id;
END;
$function$;

-- Quem está nessa situação, para a tela poder avisar e alguém resolver.
-- Devolve só nomes: o valor do custo continua restrito a quem pode vê-lo.
CREATE OR REPLACE FUNCTION public.produtos_com_custo_incompleto()
RETURNS TABLE(produto_id uuid, produto text, materiais_sem_custo text, materiais integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Usuário não autenticado' USING ERRCODE = '42501'; END IF;
  IF NOT (public.has_permission(v_uid, 'custos.read')
          OR public.has_permission(v_uid, 'estoque.cost.read')
          OR public.has_role(v_uid, 'admin')) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT pr.id, pr.nome,
         string_agg(m.nome, ', ' ORDER BY m.nome) FILTER (WHERE COALESCE(m.custo_medio, m.custo_unitario, 0) <= 0),
         count(*)::integer
  FROM public.produtos pr
  JOIN public.produto_materiais pm ON pm.produto_id = pr.id
  JOIN public.materiais m ON m.id = pm.material_id
  WHERE pr.ativo
  GROUP BY pr.id, pr.nome
  HAVING count(*) FILTER (WHERE COALESCE(m.custo_medio, m.custo_unitario, 0) <= 0) > 0
  ORDER BY pr.nome;
END
$function$;

REVOKE ALL ON FUNCTION public.produtos_com_custo_incompleto() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.produtos_com_custo_incompleto() TO authenticated;
