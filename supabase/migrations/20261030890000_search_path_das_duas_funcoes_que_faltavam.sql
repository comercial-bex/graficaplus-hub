-- Última varredura de 30/10/2026: das funções PL/pgSQL do schema public, só estas duas ficaram sem `search_path` fixo
-- (nenhuma é SECURITY DEFINER; uma só soma dias úteis e a outra só carimba o updated_at). Fixar é gratuito e fecha o
-- aviso "function_search_path_mutable" do Supabase.
ALTER FUNCTION public.tg_notificacao_templates_touch() SET search_path TO 'public';
ALTER FUNCTION public.somar_dias_uteis(date, integer) SET search_path TO 'public';
