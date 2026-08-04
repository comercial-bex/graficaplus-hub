GRANT SELECT ON public.role_permission_matrix TO authenticated;

REVOKE ALL ON FUNCTION public.sync_orcamento_3d_para_funil() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.trg_itens_os_materiais_previstos() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.trg_os_pos_venda() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.gerar_materiais_previstos_os(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gerar_materiais_previstos_os(uuid) TO authenticated, service_role;