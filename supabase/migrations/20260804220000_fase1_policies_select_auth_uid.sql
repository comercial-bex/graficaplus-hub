-- Fase 1 (parte 5) — normaliza auth.uid() para (select auth.uid()) nas policies.
--
-- Escrito direto como auth.uid(), o Postgres trata a chamada como volátil no
-- contexto da policy e a reavalia UMA VEZ POR LINHA examinada. Envolvida em
-- subselect, vira InitPlan: avaliada uma vez por query e reaproveitada.
--
-- 129 das 163 policies estavam na forma direta. O efeito é invisível com as
-- tabelas quase vazias de hoje e cresce linearmente com o volume — foi
-- exatamente esse padrão que pesou no Bex.
--
-- A troca é semanticamente neutra: auth.uid() é STABLE e lê o JWT da requisição,
-- que não muda no meio da query.
--
-- Recria a partir do catálogo (pg_policies) em vez de reescrever 129 policies à
-- mão, para não haver divergência entre o que está no banco e o que a migração
-- supõe. Roda dentro de um bloco DO, então é atômico: se qualquer CREATE
-- falhar, o DROP correspondente também é desfeito.

DO $$
DECLARE
  p record;
  novo_qual text;
  novo_check text;
  comando text;
  normalizadas int := 0;
BEGIN
  FOR p IN
    SELECT tablename, policyname, permissive, roles, cmd, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (coalesce(qual, '') || coalesce(with_check, '')) LIKE '%auth.uid()%'
      AND (coalesce(qual, '') || coalesce(with_check, '')) NOT LIKE '%SELECT auth.uid()%'
    ORDER BY tablename, policyname
  LOOP
    novo_qual  := replace(p.qual,       'auth.uid()', '(select auth.uid())');
    novo_check := replace(p.with_check, 'auth.uid()', '(select auth.uid())');

    EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, p.tablename);

    comando := format('CREATE POLICY %I ON public.%I AS %s FOR %s TO %s',
                      p.policyname, p.tablename, p.permissive, p.cmd,
                      array_to_string(p.roles, ', '));

    -- INSERT tem só WITH CHECK; SELECT e DELETE têm só USING.
    IF novo_qual IS NOT NULL THEN
      comando := comando || format(' USING (%s)', novo_qual);
    END IF;
    IF novo_check IS NOT NULL THEN
      comando := comando || format(' WITH CHECK (%s)', novo_check);
    END IF;

    EXECUTE comando;
    normalizadas := normalizadas + 1;
  END LOOP;

  RAISE NOTICE 'Policies normalizadas: %', normalizadas;
END $$;
