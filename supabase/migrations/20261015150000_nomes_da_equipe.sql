-- Nome de quem é da equipe, para quem é da equipe (15/10/2026).
--
-- A regra de leitura de `usuarios` só deixa ver a própria linha — o admin e o
-- gestor veem todas. Toda tela que mostra "quem fez" lendo `usuarios` direto
-- mostrava o nome só para eles dois: no Quadro, "movida por Harison" virava
-- "movida por Equipe" para o Leonardo e a Cibele; no histórico da OS, igual;
-- e a Cibele não saberia de quem é o reembolso que ela aprova. Ensaiado em
-- 15/10: logado como Leonardo, `usuarios` devolve 1 linha (a dele).
--
-- A função devolve SÓ id e nome (nada de e-mail, telefone, papel ou ativo),
-- só da equipe (quem tem papel que não é cliente nem parceiro — inclusive quem
-- já saiu, porque o histórico dele continua na tela) e só para quem é da
-- equipe e está ativo (is_staff).
CREATE OR REPLACE FUNCTION public.nomes_da_equipe(p_ids uuid[] DEFAULT NULL)
RETURNS TABLE(id uuid, nome text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT u.id, u.nome
    FROM public.usuarios u
   WHERE public.is_staff(auth.uid())
     AND (p_ids IS NULL OR u.id = ANY (p_ids))
     AND EXISTS (SELECT 1 FROM public.user_roles ur
                  WHERE ur.user_id = u.id AND ur.role::text NOT IN ('cliente', 'parceiro'))
   ORDER BY u.nome
$function$;
COMMENT ON FUNCTION public.nomes_da_equipe(uuid[]) IS
  'Id e nome de quem é da equipe (inclusive quem saiu), para quem é da equipe: o "quem fez" do Quadro, do histórico da OS e dos reembolsos.';

REVOKE ALL ON FUNCTION public.nomes_da_equipe(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nomes_da_equipe(uuid[]) TO authenticated, service_role;
