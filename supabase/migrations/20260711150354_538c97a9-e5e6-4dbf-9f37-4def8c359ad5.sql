
CREATE OR REPLACE FUNCTION public._apply_pending_migration(p_sql text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  EXECUTE p_sql;
END;
$$;

REVOKE ALL ON FUNCTION public._apply_pending_migration(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._apply_pending_migration(text) TO service_role;
