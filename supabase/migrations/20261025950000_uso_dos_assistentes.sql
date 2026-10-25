-- Uso dos assistentes em passos (25/10/2026): medir quanto cada tela é usada e onde as pessoas
-- desistem, para saber se os passos ganham tempo de verdade. Até aqui a frequência de uso de cada
-- tela era só palpite.
--
-- Guarda só QUEM (o próprio usuário), QUAL tela, QUE evento e em que passo; nunca o que foi
-- digitado. Eventos: abriu, passo, fechou, concluiu. Uma "sessão" é uma abertura da tela.
-- Só o administrador lê (o resumo vem da função, que confere o papel).

CREATE TABLE IF NOT EXISTS public.uso_de_telas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL DEFAULT auth.uid(),
  tela text NOT NULL CHECK (length(tela) BETWEEN 1 AND 80),
  evento text NOT NULL CHECK (evento IN ('abriu', 'passo', 'fechou', 'concluiu')),
  passo smallint CHECK (passo IS NULL OR passo BETWEEN 1 AND 20),
  sessao uuid NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_uso_de_telas_tela ON public.uso_de_telas (tela, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_uso_de_telas_sessao ON public.uso_de_telas (sessao);

ALTER TABLE public.uso_de_telas ENABLE ROW LEVEL SECURITY;

-- Cada pessoa só grava o próprio uso.
DROP POLICY IF EXISTS "uso grava o proprio" ON public.uso_de_telas;
CREATE POLICY "uso grava o proprio" ON public.uso_de_telas
  FOR INSERT TO authenticated
  WITH CHECK (usuario_id = (SELECT auth.uid()));

-- Só o administrador lê a tabela crua.
DROP POLICY IF EXISTS "uso admin le" ON public.uso_de_telas;
CREATE POLICY "uso admin le" ON public.uso_de_telas
  FOR SELECT TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'));

COMMENT ON TABLE public.uso_de_telas IS
  'Abertura, passo, fechamento e conclusão dos assistentes em passos. Sem conteúdo digitado.';

-- O resumo: por tela, quantas aberturas, quantas concluídas, a mediana do tempo até concluir
-- e o passo em que mais gente fecha sem concluir.
CREATE OR REPLACE FUNCTION public.uso_dos_assistentes(p_dias integer DEFAULT 30)
RETURNS TABLE (
  tela text,
  aberturas integer,
  concluidas integer,
  abandonadas integer,
  mediana_segundos integer,
  passo_mais_abandonado integer
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Só o administrador vê o uso das telas.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH janela AS (
    SELECT * FROM public.uso_de_telas
     WHERE criado_em >= now() - make_interval(days => GREATEST(1, LEAST(p_dias, 365)))
  ),
  sessoes AS (
    SELECT j.tela, j.sessao,
           min(j.criado_em) FILTER (WHERE j.evento = 'abriu') AS abriu_em,
           min(j.criado_em) FILTER (WHERE j.evento = 'concluiu') AS concluiu_em,
           max(j.passo) FILTER (WHERE j.evento = 'passo') AS ultimo_passo
      FROM janela j
     GROUP BY j.tela, j.sessao
  ),
  por_tela AS (
    SELECT s.tela,
           count(*) FILTER (WHERE s.abriu_em IS NOT NULL)::int AS aberturas,
           count(*) FILTER (WHERE s.concluiu_em IS NOT NULL)::int AS concluidas,
           count(*) FILTER (WHERE s.abriu_em IS NOT NULL AND s.concluiu_em IS NULL)::int AS abandonadas,
           (percentile_cont(0.5) WITHIN GROUP (
              ORDER BY extract(epoch FROM (s.concluiu_em - s.abriu_em))
            ) FILTER (WHERE s.concluiu_em IS NOT NULL AND s.abriu_em IS NOT NULL))::int AS mediana_segundos
      FROM sessoes s
     GROUP BY s.tela
  ),
  onde AS (
    SELECT DISTINCT ON (s.tela) s.tela, s.ultimo_passo
      FROM (
        SELECT x.tela, x.ultimo_passo, count(*) AS n
          FROM sessoes x
         WHERE x.abriu_em IS NOT NULL AND x.concluiu_em IS NULL AND x.ultimo_passo IS NOT NULL
         GROUP BY x.tela, x.ultimo_passo
      ) s
     ORDER BY s.tela, s.n DESC, s.ultimo_passo
  )
  SELECT p.tela, p.aberturas, p.concluidas, p.abandonadas, p.mediana_segundos, o.ultimo_passo::int
    FROM por_tela p LEFT JOIN onde o ON o.tela = p.tela
   ORDER BY p.aberturas DESC;
END;
$function$;

REVOKE ALL ON FUNCTION public.uso_dos_assistentes(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.uso_dos_assistentes(integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
