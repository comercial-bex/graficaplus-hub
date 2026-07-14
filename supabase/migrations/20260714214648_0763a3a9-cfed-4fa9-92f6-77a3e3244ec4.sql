
-- 1) Views: force security_invoker=true so RLS applies to the caller.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relname
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE c.relkind='v' AND n.nspname='public'
  LOOP
    EXECUTE format('ALTER VIEW public.%I SET (security_invoker = true)', r.relname);
  END LOOP;
END $$;

-- 2) Fix search_path on user-defined functions missing it.
ALTER FUNCTION public.normalize_document(text) SET search_path = public;
ALTER FUNCTION public.normalize_email(text) SET search_path = public;
ALTER FUNCTION public.normalize_phone(text) SET search_path = public;
ALTER FUNCTION public.normalize_whatsapp_phone(text) SET search_path = public;
ALTER FUNCTION public.prevent_delete_arquivos() SET search_path = public;
ALTER FUNCTION public.prevent_update_orcamento_3d_calculos() SET search_path = public;
ALTER FUNCTION public.status_os_exige_validacoes_producao(status_os) SET search_path = public;
ALTER FUNCTION public.sync_arquivo_aprovacao() SET search_path = public;
ALTER FUNCTION public.tg_set_updated_at() SET search_path = public;

-- 3) Revoke EXECUTE from PUBLIC and anon on ALL SECURITY DEFINER functions in public.
--    Then re-grant to authenticated only for legitimate RPCs; keep triggers unreachable from clients.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.prosecdef
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid=p.oid AND d.deptype='e')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END $$;

-- Re-grant EXECUTE to authenticated on legitimate client-callable RPCs.
GRANT EXECUTE ON FUNCTION public.converter_orcamento_em_os(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.avancar_os_status(uuid, status_os) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_staff(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_see_financials(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_permission(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_any_permission(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.aprovar_orcamento(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.converter_orcamento_3d_em_os(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirmar_pagamento(uuid, numeric, text, numeric, date, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirmar_pagamento_registrado(uuid, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.estornar_pagamento(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.baixar_estoque_os(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.estornar_baixa_estoque_os(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reservar_materiais_os(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fechar_os(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.forcar_transicao_os(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.converter_lead_em_cliente(uuid, jsonb, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.salvar_orcamento_3d(uuid, text, numeric, uuid, uuid, numeric, integer, uuid, numeric, jsonb, jsonb, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_filamento_3d(uuid, text, text, text, text, numeric, numeric, numeric, numeric, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_filamento_3d(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_impressora_3d(uuid, text, text, text, text, numeric, numeric, numeric, numeric, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_impressora_3d(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.require_permission(text) TO authenticated;

-- 4) Storage: prevent broad listing on the public "avatares" bucket.
--    Public URL access to individual objects still works because the bucket is public.
DROP POLICY IF EXISTS "avatar read" ON storage.objects;
