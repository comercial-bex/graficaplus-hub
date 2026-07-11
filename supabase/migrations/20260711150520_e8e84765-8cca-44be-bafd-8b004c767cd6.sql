
CREATE OR REPLACE FUNCTION public._apply_pending_migration(p_sql text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  EXECUTE 'SET LOCAL sql_safe_updates = off';
  EXECUTE p_sql;
END;
$$;
