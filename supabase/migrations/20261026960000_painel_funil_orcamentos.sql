-- Onda 5 do plano orçamento→OS (26/10/2026): medir o funil de verdade, em horas, em vez de estimar.
-- Quem converte orçamento (admin, gestor e atendimento) lê: o painel mostra contagens e tempos, sem valores.
CREATE OR REPLACE FUNCTION public.painel_funil_orcamentos(p_dias integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_ini timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_dias, 30), 365)));
  r jsonb;
BEGIN
  IF v_uid IS NULL OR NOT public.has_permission(v_uid, 'orcamentos.convert') THEN
    RAISE EXCEPTION 'Permissão necessária: orcamentos.convert';
  END IF;

  WITH base AS (
    SELECT o.id, o.status::text AS status, o.cliente_id, o.created_at, o.enviado_em, o.aprovado_em,
           (SELECT min(os.created_at) FROM public.ordens_servico os WHERE os.orcamento_id = o.id) AS os_em
      FROM public.orcamentos o
     WHERE o.created_at >= v_ini
       AND COALESCE(o.valor_total, 0) > 0
  )
  SELECT jsonb_build_object(
    'dias', greatest(1, least(coalesce(p_dias, 30), 365)),
    'criados', count(*),
    'enviados', count(*) FILTER (WHERE enviado_em IS NOT NULL),
    'aprovados', count(*) FILTER (WHERE aprovado_em IS NOT NULL),
    'viraram_os', count(*) FILTER (WHERE os_em IS NOT NULL),
    'rascunhos_sem_cliente', count(*) FILTER (WHERE status = 'rascunho' AND cliente_id IS NULL),
    'aprovados_sem_os', count(*) FILTER (WHERE status = 'aprovado' AND os_em IS NULL),
    'horas_criar_ate_enviar', round((avg(extract(epoch FROM (enviado_em - created_at)) / 3600) FILTER (WHERE enviado_em IS NOT NULL))::numeric, 1),
    'horas_enviar_ate_aprovar', round((avg(extract(epoch FROM (aprovado_em - enviado_em)) / 3600) FILTER (WHERE aprovado_em IS NOT NULL AND enviado_em IS NOT NULL AND aprovado_em >= enviado_em))::numeric, 1),
    'horas_aprovar_ate_os', round((avg(extract(epoch FROM (os_em - aprovado_em)) / 3600) FILTER (WHERE os_em IS NOT NULL AND aprovado_em IS NOT NULL AND os_em >= aprovado_em))::numeric, 1),
    'pct_os_em_24h', CASE WHEN count(*) FILTER (WHERE aprovado_em IS NOT NULL) = 0 THEN NULL
      ELSE round(100.0 * count(*) FILTER (WHERE aprovado_em IS NOT NULL AND os_em IS NOT NULL AND os_em - aprovado_em <= interval '24 hours')
                 / count(*) FILTER (WHERE aprovado_em IS NOT NULL), 0) END
  ) INTO r FROM base;
  RETURN r;
END
$function$;

REVOKE ALL ON FUNCTION public.painel_funil_orcamentos(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.painel_funil_orcamentos(integer) TO authenticated;
COMMENT ON FUNCTION public.painel_funil_orcamentos(integer) IS 'Funil do orçamento à OS em contagens e horas médias. Só quem converte orçamento (admin, gestor, atendimento) lê; sem valores em dinheiro.';
