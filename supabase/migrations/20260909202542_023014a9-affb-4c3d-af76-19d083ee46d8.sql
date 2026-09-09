ALTER VIEW public.produtos_operacional SET (security_invoker = on);
ALTER VIEW public.materiais_operacional SET (security_invoker = on);
REVOKE ALL ON FUNCTION public.tg_material_custo_medio() FROM PUBLIC, anon, authenticated;