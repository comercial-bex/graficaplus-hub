-- Fase 1 (parte 4) — índices nas chaves estrangeiras sem cobertura.
--
-- 205 das 245 FKs não tinham índice cuja primeira coluna fosse a coluna da FK.
-- O Postgres cria índice automático para PRIMARY KEY e UNIQUE, mas nunca para
-- FOREIGN KEY. Sem ele:
--   - todo JOIN pelo lado filho vira sequential scan;
--   - todo DELETE/UPDATE no lado pai varre a tabela filha inteira para checar
--     a constraint (inclusive nos ON DELETE CASCADE).
--
-- Hoje isso não aparece porque as tabelas estão praticamente vazias. Aparece
-- de uma vez quando a operação começar: as FKs mais carentes apontam para
-- ordens_servico, itens_os e clientes, que são exatamente as que mais crescem.
--
-- Percorre o catálogo em vez de listar 205 CREATE INDEX à mão: o critério é
-- objetivo e a migração continua correta se novas FKs surgirem antes de ela
-- rodar num ambiente. IF NOT EXISTS mantém tudo idempotente.
--
-- Só FKs de coluna única. FKs compostas precisam de decisão sobre a ordem das
-- colunas do índice e ficam de fora de propósito (hoje não há nenhuma).

DO $$
DECLARE
  r record;
  nome_indice text;
  criados int := 0;
BEGIN
  FOR r IN
    SELECT c.conrelid::regclass::text AS tabela, a.attname AS coluna
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace AND n.nspname = 'public'
    JOIN unnest(c.conkey) WITH ORDINALITY k(attnum, ord) ON true
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
    WHERE c.contype = 'f'
      AND array_length(c.conkey, 1) = 1
      AND NOT EXISTS (
        SELECT 1 FROM pg_index i
        WHERE i.indrelid = c.conrelid AND i.indkey[0] = k.attnum
      )
    ORDER BY 1, 2
  LOOP
    -- nomes de relação no Postgres são truncados em 63 bytes
    nome_indice := left('idx_' || r.tabela || '_' || r.coluna, 63);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (%I)',
                   nome_indice, r.tabela, r.coluna);
    criados := criados + 1;
  END LOOP;

  RAISE NOTICE 'Índices de FK criados: %', criados;
END $$;
