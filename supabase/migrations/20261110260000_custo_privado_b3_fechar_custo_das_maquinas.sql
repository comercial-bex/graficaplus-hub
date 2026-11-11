-- APLICADA em 10/11/2026, em produção, depois de ensaio na mesma base (8 contas reais e o visitante, antes e depois, em
-- transação desfeita) e de o front que lê maquinas_financeiro estar publicado e provado no pacote. Conferido depois:
-- authenticated não lê custo_hora, vida_util_horas, valor_residual, forma_aquisicao, valor_aquisicao, data_aquisicao nem
-- especificacoes_comerciais; o visitante não lê coluna nenhuma; 7 máquinas guardam o texto de compra na coluna nova e 0 fichas
-- técnicas têm chave de compra (eram 6); a restrição da ficha é válida; pendencias_de_preenchimento devolve as mesmas linhas
-- (hash igual antes e depois, por conta); o patrimônio lê da visão; o admin segue gravando na máquina.
-- Ajuste ao aplicar: no banco vivo a âncora do marcador custo_hora_provisorio aparece 2 vezes em pendencias_de_preenchimento
-- (a contagem e o filtro do mesmo RETURN QUERY), então a conferência espera 2.

-- Privacidade do custo, onda B3: fechar o custo das máquinas por coluna (CONTRAI; 10/11/2026).
--
-- ATENÇÃO À ORDEM: só depois de publicado e provado o front que lê maquinas_financeiro (feito em 10/11/2026, pacote com
-- a visão e src/domain/maquinas/colunas.ts). Coluna sem GRANT derruba a consulta inteira de quem a cita (select '*'
-- inclusive) para TODOS os papéis, o admin também. Por isso o front saiu antes.
--
-- O QUE FAZ
--   1. Move as chaves de compra e de custo do jsonb especificacoes para especificacoes_comerciais (a ficha técnica fica só com
--      dado técnico). Nada se perde.
--   2. CHECK em especificacoes: chave com compra, custo, preco, valor, aquisi, parcela ou financ não entra mais na ficha técnica.
--   3. pendencias_de_preenchimento passa a ler o marcador custo_hora_provisorio na coluna nova (troca por âncora contada).
--   4. vw_patrimonio_maquinas lê de maquinas_financeiro (a tabela deixa de ter essas colunas para authenticated).
--   4b. Guarda: nenhuma visão com security_invoker pode ainda depender de coluna que vai perder a leitura.
--   5. maquinas: tira o SELECT de tabela inteira de authenticated e de anon e devolve SELECT só das colunas sem custo
--      (a mesma lista de src/domain/maquinas/colunas.ts, com alimentacao e comprimento_util_m da migração do formato).
--      Ficam sem leitura: custo_hora, vida_util_horas, valor_residual, forma_aquisicao, valor_aquisicao, data_aquisicao,
--      especificacoes_comerciais. INSERT, UPDATE e DELETE seguem como estão (admin e gestor, pela policy).
--      Coluna NOVA em maquinas nasce sem leitura: quem acrescentar coluna decide na hora (tests/custo-das-maquinas-pela-visao.test.ts).
--
-- IDEMPOTENTE: rodar de novo reproduz o mesmo estado.

-- 1. Texto de compra e de custo sai da ficha técnica ----------------------------------------------------------
UPDATE public.maquinas
   SET especificacoes_comerciais = coalesce(especificacoes_comerciais, '{}'::jsonb)
         || (SELECT coalesce(jsonb_object_agg(e.k, e.v), '{}'::jsonb)
               FROM jsonb_each(especificacoes) AS e(k, v)
              WHERE e.k = ANY (ARRAY['compra', 'custo_hora_base', 'custo_hora_atualizado_em', 'preco_referencia', 'situacao', 'custo_hora_provisorio'])),
       especificacoes = especificacoes - ARRAY['compra', 'custo_hora_base', 'custo_hora_atualizado_em', 'preco_referencia', 'situacao', 'custo_hora_provisorio']
 WHERE especificacoes ?| ARRAY['compra', 'custo_hora_base', 'custo_hora_atualizado_em', 'preco_referencia', 'situacao', 'custo_hora_provisorio'];

-- 2. A ficha técnica não recebe mais custo ----------------------------------------------------------------------
ALTER TABLE public.maquinas DROP CONSTRAINT IF EXISTS maquinas_especificacoes_sem_custo_chk;
ALTER TABLE public.maquinas ADD CONSTRAINT maquinas_especificacoes_sem_custo_chk
  CHECK (especificacoes::text !~* '"[^"]*(compra|custo|preco|valor|aquisi|parcela|financ)[^"]*"\s*:');
COMMENT ON CONSTRAINT maquinas_especificacoes_sem_custo_chk ON public.maquinas IS
  'especificacoes é a ficha técnica e toda a equipe lê. Compra e custo vão em especificacoes_comerciais.';

-- 3. O marcador de custo provisório mora na coluna nova ----------------------------------------------------------
DO $m$
DECLARE
  v_def text;
  v_ancora constant text := 'especificacoes->>''custo_hora_provisorio''';
  v_n integer;
BEGIN
  IF to_regprocedure('public.pendencias_de_preenchimento()') IS NULL THEN
    RAISE NOTICE 'pendencias_de_preenchimento não existe neste banco; nada a trocar';
    RETURN;
  END IF;
  v_def := pg_get_functiondef('public.pendencias_de_preenchimento()'::regprocedure);
  IF position('especificacoes_comerciais->>''custo_hora_provisorio''' IN v_def) > 0 THEN
    RAISE NOTICE 'pendencias_de_preenchimento já lê o marcador na coluna nova';
    RETURN;
  END IF;
  v_n := (length(v_def) - length(replace(v_def, v_ancora, ''))) / length(v_ancora);
  -- Duas vezes, as duas no mesmo RETURN QUERY de custo_de_producao_estimado: a contagem e o filtro do WHERE.
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'pendencias_de_preenchimento: a âncora % aparece % vez(es), esperado 2; a função mudou, reler antes de trocar', v_ancora, v_n;
  END IF;
  EXECUTE replace(v_def, v_ancora, 'especificacoes_comerciais->>''custo_hora_provisorio''');
END $m$;

-- 4. vw_patrimonio_maquinas lê da visão do custo (a tabela já não entrega essas colunas) ---------------------
DO $m$
DECLARE
  v_def text := pg_get_viewdef('public.vw_patrimonio_maquinas'::regclass, true);
BEGIN
  IF position('maquinas_financeiro' IN v_def) > 0 THEN
    RAISE NOTICE 'vw_patrimonio_maquinas já lê de maquinas_financeiro';
  ELSIF position('FROM maquinas m' IN v_def) = 0 THEN
    RAISE EXCEPTION 'vw_patrimonio_maquinas: a visão não tem mais "FROM maquinas m"; mudou, reler antes de trocar';
  ELSE
    EXECUTE regexp_replace('CREATE OR REPLACE VIEW public.vw_patrimonio_maquinas AS ' || v_def, 'FROM maquinas m', 'FROM maquinas_financeiro m');
    ALTER VIEW public.vw_patrimonio_maquinas SET (security_invoker = true);
  END IF;
END $m$;
REVOKE ALL ON public.vw_patrimonio_maquinas FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.vw_patrimonio_maquinas TO authenticated;

-- 4b. Guarda: nenhuma visão invoker pode ainda depender de coluna de custo de maquinas (perderia a leitura e quebraria) ----
DO $guarda$
DECLARE
  v_lista text;
BEGIN
  SELECT string_agg(DISTINCT c.relname, ', ') INTO v_lista
    FROM pg_depend d
    JOIN pg_rewrite r ON r.oid = d.objid
    JOIN pg_class c ON c.oid = r.ev_class
    JOIN pg_attribute a ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid
   WHERE d.classid = 'pg_rewrite'::regclass AND d.refobjid = 'public.maquinas'::regclass
     AND c.relkind = 'v' AND c.oid <> d.refobjid
     AND coalesce(c.reloptions::text, '') ~ 'security_invoker=(true|on)'
     AND a.attname = ANY (ARRAY['custo_hora', 'vida_util_horas', 'valor_residual', 'forma_aquisicao', 'valor_aquisicao',
                                'data_aquisicao', 'especificacoes_comerciais']);
  IF v_lista IS NOT NULL THEN
    RAISE EXCEPTION 'Visões com security_invoker ainda leem coluna de custo de maquinas: %. Refazer antes de fechar.', v_lista;
  END IF;
END $guarda$;

-- 5. maquinas: leitura por coluna, sem as de custo ----------------------------------------------------------------
-- (REVOKE de tabela inteira leva junto os privilégios por coluna que existissem: o estado final é sempre o da lista abaixo)
REVOKE SELECT ON public.maquinas FROM authenticated, anon;
GRANT SELECT (id, nome, tipo, ativa, created_at, updated_at, potencia_kw, setup_min, velocidade_m2_h, disponibilidade_pct, setor,
              largura_util_m, margem_lateral_m, fabricante, modelo, numero_serie, imagem_url, especificacoes,
              horas_produtivas_mensais, base_cobranca, tempo_minimo_min, velocidade_mm_s, avanco_m,
              alimentacao, comprimento_util_m)
  ON public.maquinas TO authenticated;

NOTIFY pgrst, 'reload schema';
