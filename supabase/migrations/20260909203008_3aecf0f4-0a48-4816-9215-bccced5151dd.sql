CREATE OR REPLACE FUNCTION public.recalcular_custo_produto(p_produto_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_custo NUMERIC;
BEGIN
  -- Só mexe em produto que TEM receita. Produto sem receita tem custo digitado
  -- à mão, e zerar isso seria pior do que deixar desatualizado.
  SELECT SUM(pm.quantidade_por_unidade * COALESCE(m.custo_medio, m.custo_unitario, 0))
    INTO v_custo
    FROM public.produto_materiais pm
    JOIN public.materiais m ON m.id = pm.material_id
   WHERE pm.produto_id = p_produto_id;

  IF v_custo IS NULL THEN RETURN; END IF;

  UPDATE public.produtos
     SET custo_medio = ROUND(v_custo, 2), updated_at = now()
   WHERE id = p_produto_id;
END;
$$;

REVOKE ALL ON FUNCTION public.recalcular_custo_produto(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.tg_receita_recalcula_produto()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.recalcular_custo_produto(COALESCE(NEW.produto_id, OLD.produto_id));
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.tg_receita_recalcula_produto() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tg_receita_recalcula_produto ON public.produto_materiais;
CREATE TRIGGER tg_receita_recalcula_produto
AFTER INSERT OR UPDATE OR DELETE ON public.produto_materiais
FOR EACH ROW EXECUTE FUNCTION public.tg_receita_recalcula_produto();

CREATE OR REPLACE FUNCTION public.tg_material_custo_propaga()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r RECORD;
BEGIN
  IF COALESCE(NEW.custo_medio, -1) IS NOT DISTINCT FROM COALESCE(OLD.custo_medio, -1)
     AND COALESCE(NEW.custo_unitario, -1) IS NOT DISTINCT FROM COALESCE(OLD.custo_unitario, -1) THEN
    RETURN NULL;
  END IF;
  FOR r IN SELECT DISTINCT produto_id FROM public.produto_materiais WHERE material_id = NEW.id LOOP
    PERFORM public.recalcular_custo_produto(r.produto_id);
  END LOOP;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.tg_material_custo_propaga() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tg_material_custo_propaga ON public.materiais;
CREATE TRIGGER tg_material_custo_propaga
AFTER UPDATE OF custo_medio, custo_unitario ON public.materiais
FOR EACH ROW EXECUTE FUNCTION public.tg_material_custo_propaga();