-- APLICADA em 10/11/2026, em produção. O bloco se confere por dentro (tipos, definição das visões, opções, dono, privilégios,
-- comentário, colunas, gatilho e o hash dos valores de hoje): qualquer diferença desfaz a transação inteira. Conferido
-- depois de aplicar: as duas colunas são numeric sem escala, o gatilho existe, as duas visões voltaram e
-- rel_margem_por_produto segue fechada a anon e authenticated. Ajuste ao aplicar: a checagem de dependentes ignora o
-- tipo-lista (_rel_margem_por_produto, _itens_os_financeiro) que o Postgres cria sozinho para cada visão.

-- Custo por peça do ITEM da OS sem arredondar a centavos (decisão 11 de docs/proximos-passos-interface-holdprint.md,
-- liberada pelo dono em 05/11/2026).
--
-- O que acontecia: a conversão em OS grava, em itens_os.custo_unitario, `orcamento_itens.custo_unitario +
-- COALESCE(custo_formulas, 0)`. O custo_formulas não tem escala (R$ 100 por pedido em 30.000 peças = 0,0033333...
-- por peça), mas a coluna de destino era numeric(12,2): o Postgres arredondava na gravação e o item da OS ficava com
-- R$ 0,00 desse terceirizado. O custo da OS (ordens_servico.custo_previsto) sempre veio do custo_estimado do
-- orçamento, que é exato; só o relatório "Margem por produto" (rel_margem_por_produto, lido pela
-- get_relatorios_prioritarios) soma quantidade × custo_unitario do item e saía com margem a mais.
--
-- O que muda: itens_os.custo_unitario e o espelho item_os_custos.custo_unitario (que a visão financeira
-- itens_os_financeiro lê) passam de numeric(12,2) a numeric SEM escala, o mesmo tipo de orcamento_itens.custo_formulas.
-- Por que sem escala e não numeric(14,6): com 6 casas, R$ 100 por pedido em 30.000 peças voltam a R$ 99,99 (um
-- centavo a menos) e R$ 12,34 por pedido em 10.000.000 de peças voltam a R$ 10,00; sem escala o quociente guarda de 16
-- a 24 casas e a conta fecha. O Postgres nem reescreve a tabela (numeric(p,s) para numeric é troca de rótulo), e as
-- linhas de hoje, todas em centavos, continuam com o mesmo valor e o mesmo texto.
--
-- O que impedia o ALTER TYPE direto (pg_depend, lido em 05/11/2026) e é derrubado e refeito aqui, na MESMA transação:
--   - gatilho tg_sync_item_os_custos (AFTER INSERT OR UPDATE OF valor_unitario, custo_unitario, valor_total)
--   - visão rel_margem_por_produto (security_invoker; SEM grant para anon/authenticated de propósito; com comentário)
--   - visão itens_os_financeiro (security_invoker), que depende do custo_unitario do espelho
-- Nada mais depende das duas colunas (nem índice, nem restrição, nem política, nem coluna gerada, nem outra visão).
--
-- Armadilhas que esta migração fecha por escrito (memória: create-or-replace-view-descarta-as-opcoes):
--   1. visão recriada perde reloptions: elas são lidas antes e repostas;
--   2. visão nova nasce com os privilégios padrão do schema (anon e authenticated com tudo): os privilégios de antes
--      são repostos um a um e os que sobram são revogados; rel_margem_por_produto CONTINUA fechada ao público;
--   3. o comentário da visão some com o DROP: é reposto;
--   4. o texto da visão é o VIVO (pg_get_viewdef), nunca uma cópia escrita à mão: se outra sessão mexeu nela, a cópia
--      não reverte o que ela fez.
--
-- Tudo é conferido DENTRO do bloco (definição, opções, dono, privilégios, comentário, colunas, gatilho, valores);
-- qualquer diferença levanta exceção e a transação inteira volta. Rodar de novo é inofensivo (as colunas já
-- numeric: nada a fazer). Não toca em nenhum dado: nenhuma linha é lida para ser regravada.
--
-- Ficam de fora, de propósito: (a) converter_orcamento_3d_em_os grava round(v_custo / v_qtd, 2) por escrita
-- explícita (porta legada, 0 orçamentos 3D não embutidos hoje); (b) orcamento_itens.custo_unitario segue numeric(12,2),
-- então o custo-base do item continua em centavos como sempre foi.

DO $m$
DECLARE
  v_os oid := 'public.itens_os'::regclass;
  v_esp oid := 'public.item_os_custos'::regclass;
  v_tipo_os text;
  v_tipo_esp text;
  v_dependentes text;
  v_esperados constant text := 'gatilho itens_os.tg_sync_item_os_custos | visão itens_os_financeiro | visão rel_margem_por_produto';
  v_fotos jsonb;
  v_gatilho text;
  v_gatilho_estado "char";
  v_n_antes bigint;
  v_hash_antes text;
  v_hash_esp_antes text;
  v_attacl_antes text;
  v_attacl_depois text;
  f jsonb;
  g record;
  v_nome text;
  v_acl_antes text;
  v_acl_depois text;
  v_def_depois text;
  v_opcoes_depois jsonb;
  v_dono_depois text;
  v_comentario_depois text;
  v_oid_depois oid;
  v_colunas_depois jsonb;
BEGIN
  SELECT format_type(a.atttypid, a.atttypmod) INTO v_tipo_os
    FROM pg_attribute a WHERE a.attrelid = v_os AND a.attname = 'custo_unitario' AND NOT a.attisdropped;
  SELECT format_type(a.atttypid, a.atttypmod) INTO v_tipo_esp
    FROM pg_attribute a WHERE a.attrelid = v_esp AND a.attname = 'custo_unitario' AND NOT a.attisdropped;

  IF v_tipo_os = 'numeric' AND v_tipo_esp = 'numeric' THEN
    RAISE NOTICE 'itens_os.custo_unitario e item_os_custos.custo_unitario já são numeric sem escala';
    RETURN;
  END IF;
  IF v_tipo_os IS DISTINCT FROM 'numeric(12,2)' OR v_tipo_esp IS DISTINCT FROM 'numeric(12,2)' THEN
    RAISE EXCEPTION 'Tipo inesperado: itens_os.custo_unitario = %, item_os_custos.custo_unitario = % (esperado numeric(12,2) nas duas). Conferir antes de trocar.', v_tipo_os, v_tipo_esp;
  END IF;

  -- 1. Quem depende das duas colunas AGORA tem de ser exatamente o que foi visto em 05/11/2026 (o valor padrão
  --    acompanha a coluna e não conta). Dependente novo = outra sessão criou algo: parar em voz alta.
  SELECT string_agg(x, ' | ' ORDER BY x) INTO v_dependentes
    FROM (
      SELECT CASE
               WHEN d.classid = 'pg_rewrite'::regclass THEN
                 'visão ' || (SELECT c.relname FROM pg_rewrite r JOIN pg_class c ON c.oid = r.ev_class WHERE r.oid = d.objid)
               WHEN d.classid = 'pg_trigger'::regclass THEN
                 'gatilho ' || (SELECT c.relname || '.' || t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE t.oid = d.objid)
               WHEN d.classid = 'pg_constraint'::regclass THEN
                 'restrição ' || (SELECT conname FROM pg_constraint WHERE oid = d.objid)
               WHEN d.classid = 'pg_class'::regclass THEN
                 'índice ' || (SELECT relname FROM pg_class WHERE oid = d.objid)
               WHEN d.classid = 'pg_policy'::regclass THEN
                 'política ' || (SELECT polname FROM pg_policy WHERE oid = d.objid)
               ELSE d.classid::regclass::text || ' ' || d.objid::text
             END AS x
        FROM pg_depend d
       WHERE d.refclassid = 'pg_class'::regclass
         AND d.classid <> 'pg_attrdef'::regclass
         AND ((d.refobjid = v_os  AND d.refobjsubid = (SELECT attnum FROM pg_attribute WHERE attrelid = v_os  AND attname = 'custo_unitario'))
           OR (d.refobjid = v_esp AND d.refobjsubid = (SELECT attnum FROM pg_attribute WHERE attrelid = v_esp AND attname = 'custo_unitario')))
    ) s;
  IF v_dependentes IS DISTINCT FROM v_esperados THEN
    RAISE EXCEPTION 'Dependentes das colunas de custo mudaram. Esperado: [%]. Achado: [%]. Reler pg_depend antes de trocar o tipo.', v_esperados, COALESCE(v_dependentes, 'nenhum');
  END IF;

  -- Ninguém pode depender das duas visões que vão ser derrubadas (outra visão, função que devolve a linha delas).
  -- Fora o tipo-lista (_nome) que o Postgres cria sozinho para cada visão, com dependência interna: ele cai e volta junto com a visão.
  IF EXISTS (SELECT 1 FROM pg_depend d JOIN pg_rewrite r ON r.oid = d.objid
              WHERE d.classid = 'pg_rewrite'::regclass AND d.refclassid = 'pg_class'::regclass
                AND d.refobjid IN ('public.rel_margem_por_produto'::regclass, 'public.itens_os_financeiro'::regclass)
                AND r.ev_class <> d.refobjid)
     OR EXISTS (SELECT 1 FROM pg_depend d
                 WHERE d.refclassid = 'pg_type'::regclass AND d.classid <> 'pg_class'::regclass AND d.classid <> 'pg_attrdef'::regclass
                   AND d.refobjid IN (SELECT reltype FROM pg_class WHERE oid IN ('public.rel_margem_por_produto'::regclass, 'public.itens_os_financeiro'::regclass))
                   AND NOT (d.classid = 'pg_type'::regclass AND d.deptype = 'i'
                            AND EXISTS (SELECT 1 FROM pg_type t WHERE t.oid = d.objid AND t.typcategory = 'A' AND t.typelem = d.refobjid))) THEN
    RAISE EXCEPTION 'Alguma outra visão ou função depende de rel_margem_por_produto ou itens_os_financeiro: listar e refazer junto antes de derrubá-las.';
  END IF;

  -- 2. A foto do que vai ser derrubado, lida do banco vivo.
  SELECT jsonb_agg(jsonb_build_object(
           'nome',       'public.' || c.relname,
           'definicao',  pg_get_viewdef(c.oid),
           'opcoes',     to_jsonb(c.reloptions),
           'dono',       pg_get_userbyid(c.relowner),
           'comentario', obj_description(c.oid, 'pg_class'),
           'acl',        COALESCE((SELECT jsonb_agg(jsonb_build_object(
                                     'quem', CASE WHEN e.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END,
                                     'priv', e.privilege_type,
                                     'repassa', e.is_grantable))
                                   FROM aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) e), '[]'::jsonb),
           'colunas',    (SELECT jsonb_agg(jsonb_build_object('n', a.attname, 't', format_type(a.atttypid, a.atttypmod)) ORDER BY a.attnum)
                            FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped)
         ) ORDER BY c.relname)
    INTO v_fotos
    FROM pg_class c
   WHERE c.oid IN ('public.itens_os_financeiro'::regclass, 'public.rel_margem_por_produto'::regclass);

  -- Privilégio ou comentário por coluna da visão não é reposto por este bloco: se existir, parar.
  IF EXISTS (SELECT 1 FROM pg_attribute a
              WHERE a.attrelid IN ('public.itens_os_financeiro'::regclass, 'public.rel_margem_por_produto'::regclass)
                AND a.attnum > 0 AND NOT a.attisdropped
                AND (a.attacl IS NOT NULL OR col_description(a.attrelid, a.attnum) IS NOT NULL)) THEN
    RAISE EXCEPTION 'Alguma coluna das duas visões tem privilégio ou comentário próprio: este bloco não os repõe. Estender o bloco antes de rodar.';
  END IF;

  SELECT pg_get_triggerdef(t.oid), t.tgenabled INTO v_gatilho, v_gatilho_estado
    FROM pg_trigger t WHERE t.tgrelid = v_os AND t.tgname = 'tg_sync_item_os_custos' AND NOT t.tgisinternal;
  IF v_gatilho IS NULL THEN
    RAISE EXCEPTION 'Gatilho tg_sync_item_os_custos não encontrado em itens_os';
  END IF;

  -- Os valores de hoje (com trim_scale, para a conferência não depender de quantas casas cada linha mostra).
  SELECT count(*), md5(COALESCE(string_agg(id::text || ':' || trim_scale(custo_unitario)::text, ',' ORDER BY id), ''))
    INTO v_n_antes, v_hash_antes FROM public.itens_os;
  SELECT md5(COALESCE(string_agg(item_os_id::text || ':' || trim_scale(custo_unitario)::text, ',' ORDER BY item_os_id), ''))
    INTO v_hash_esp_antes FROM public.item_os_custos;
  SELECT string_agg(a.attrelid::regclass::text || '.' || a.attname || '=' || COALESCE(a.attacl::text, '-'), ';' ORDER BY a.attrelid::regclass::text)
    INTO v_attacl_antes
    FROM pg_attribute a WHERE a.attname = 'custo_unitario' AND a.attrelid IN (v_os, v_esp);

  -- 3. Derruba, troca o tipo, refaz.
  DROP TRIGGER tg_sync_item_os_custos ON public.itens_os;
  DROP VIEW public.rel_margem_por_produto;
  DROP VIEW public.itens_os_financeiro;

  ALTER TABLE public.itens_os ALTER COLUMN custo_unitario TYPE numeric;
  ALTER TABLE public.item_os_custos ALTER COLUMN custo_unitario TYPE numeric;

  FOR f IN SELECT x FROM jsonb_array_elements(v_fotos) x ORDER BY x->>'nome' LOOP
    v_nome := f->>'nome';
    EXECUTE format('CREATE VIEW %s %s AS %s',
                   v_nome,
                   CASE WHEN jsonb_typeof(f->'opcoes') = 'array'
                        THEN 'WITH (' || (SELECT string_agg(o, ', ') FROM jsonb_array_elements_text(f->'opcoes') o) || ')'
                        ELSE '' END,
                   rtrim(f->>'definicao', E'; \n'));
    EXECUTE format('ALTER VIEW %s OWNER TO %I', v_nome, f->>'dono');

    -- Os privilégios que o schema deu à visão nova saem; os de antes voltam, um a um.
    FOR g IN
      SELECT DISTINCT CASE WHEN e.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(e.grantee)) END AS quem
        FROM pg_class c, aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) e
       WHERE c.oid = v_nome::regclass AND e.grantee <> c.relowner
    LOOP
      EXECUTE format('REVOKE ALL ON %s FROM %s', v_nome, g.quem);
    END LOOP;
    FOR g IN
      SELECT e->>'quem' AS quem, (e->>'repassa')::boolean AS repassa, string_agg(e->>'priv', ', ' ORDER BY e->>'priv') AS privs
        FROM jsonb_array_elements(f->'acl') e
       WHERE e->>'quem' <> f->>'dono'
       GROUP BY 1, 2
    LOOP
      EXECUTE format('GRANT %s ON %s TO %s%s', g.privs, v_nome,
                     CASE WHEN g.quem = 'PUBLIC' THEN 'PUBLIC' ELSE quote_ident(g.quem) END,
                     CASE WHEN g.repassa THEN ' WITH GRANT OPTION' ELSE '' END);
    END LOOP;

    IF f->>'comentario' IS NOT NULL THEN
      EXECUTE format('COMMENT ON VIEW %s IS %L', v_nome, f->>'comentario');
    END IF;
  END LOOP;

  EXECUTE v_gatilho;
  IF v_gatilho_estado <> 'O' THEN
    EXECUTE format('ALTER TABLE public.itens_os %s TRIGGER tg_sync_item_os_custos',
                   CASE v_gatilho_estado WHEN 'D' THEN 'DISABLE' WHEN 'R' THEN 'ENABLE REPLICA' WHEN 'A' THEN 'ENABLE ALWAYS' END);
  END IF;

  COMMENT ON COLUMN public.itens_os.custo_unitario IS
    'Custo por peça do item da OS, SEM arredondar a centavos (numeric sem escala): terceirizado por pedido em tiragem grande dá frações de centavo (R$ 100 em 30.000 peças = 0,00333...) e a margem por produto soma quantidade × este valor. Não ler com round(...,2) por peça.';
  COMMENT ON COLUMN public.item_os_custos.custo_unitario IS
    'Espelho de itens_os.custo_unitario (gatilho tg_sync_item_os_custos), sem arredondar a centavos.';

  -- 4. Conferências: qualquer diferença desfaz tudo.
  SELECT format_type(a.atttypid, a.atttypmod) INTO v_tipo_os
    FROM pg_attribute a WHERE a.attrelid = v_os AND a.attname = 'custo_unitario' AND NOT a.attisdropped;
  SELECT format_type(a.atttypid, a.atttypmod) INTO v_tipo_esp
    FROM pg_attribute a WHERE a.attrelid = v_esp AND a.attname = 'custo_unitario' AND NOT a.attisdropped;
  IF v_tipo_os <> 'numeric' OR v_tipo_esp <> 'numeric' THEN
    RAISE EXCEPTION 'As colunas não ficaram numeric: itens_os=%, item_os_custos=%', v_tipo_os, v_tipo_esp;
  END IF;
  IF pg_get_expr((SELECT d.adbin FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum WHERE d.adrelid = v_os AND a.attname = 'custo_unitario'), v_os) <> '0'
     OR pg_get_expr((SELECT d.adbin FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum WHERE d.adrelid = v_esp AND a.attname = 'custo_unitario'), v_esp) <> '0' THEN
    RAISE EXCEPTION 'O valor padrão (0) de custo_unitario não sobreviveu à troca de tipo';
  END IF;

  FOR f IN SELECT x FROM jsonb_array_elements(v_fotos) x ORDER BY x->>'nome' LOOP
    v_nome := f->>'nome';
    v_oid_depois := v_nome::regclass;
    SELECT pg_get_viewdef(c.oid), to_jsonb(c.reloptions), pg_get_userbyid(c.relowner), obj_description(c.oid, 'pg_class'),
           (SELECT jsonb_agg(jsonb_build_object('n', a.attname, 't', format_type(a.atttypid, a.atttypmod)) ORDER BY a.attnum)
              FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped),
           (SELECT string_agg(q, ',' ORDER BY q) FROM (
              SELECT (CASE WHEN e.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(e.grantee) END) || ':' || e.privilege_type || ':' || e.is_grantable::text AS q
                FROM aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) e) s)
      INTO v_def_depois, v_opcoes_depois, v_dono_depois, v_comentario_depois, v_colunas_depois, v_acl_depois
      FROM pg_class c WHERE c.oid = v_oid_depois;

    IF v_def_depois IS DISTINCT FROM f->>'definicao' THEN
      RAISE EXCEPTION '% foi recriada com texto diferente do vivo', v_nome;
    END IF;
    IF v_opcoes_depois IS DISTINCT FROM f->'opcoes' AND NOT (v_opcoes_depois IS NULL AND jsonb_typeof(f->'opcoes') = 'null') THEN
      RAISE EXCEPTION '% perdeu as opções (reloptions): antes %, depois %', v_nome, f->'opcoes', v_opcoes_depois;
    END IF;
    IF v_dono_depois IS DISTINCT FROM f->>'dono' THEN
      RAISE EXCEPTION '% mudou de dono: antes %, depois %', v_nome, f->>'dono', v_dono_depois;
    END IF;
    IF v_comentario_depois IS DISTINCT FROM f->>'comentario' THEN
      RAISE EXCEPTION '% perdeu o comentário', v_nome;
    END IF;
    SELECT string_agg(q, ',' ORDER BY q) INTO v_acl_antes FROM (
      SELECT (e->>'quem') || ':' || (e->>'priv') || ':' || (e->>'repassa') AS q FROM jsonb_array_elements(f->'acl') e) s;
    IF v_acl_depois IS DISTINCT FROM v_acl_antes THEN
      RAISE EXCEPTION '% ficou com privilégios diferentes. Antes [%] depois [%]', v_nome, v_acl_antes, v_acl_depois;
    END IF;
    -- As colunas: iguais, exceto o custo do espelho, que deixa de ser numeric(12,2).
    IF v_nome = 'public.itens_os_financeiro' THEN
      IF replace(v_colunas_depois::text, '"t": "numeric"', '"t": "numeric(12,2)"') IS DISTINCT FROM (f->'colunas')::text THEN
        RAISE EXCEPTION '% mudou de colunas além do custo_unitario', v_nome;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_colunas_depois) c WHERE c->>'n' = 'custo_unitario' AND c->>'t' = 'numeric') THEN
        RAISE EXCEPTION 'itens_os_financeiro.custo_unitario não ficou numeric';
      END IF;
    ELSIF v_colunas_depois IS DISTINCT FROM f->'colunas' THEN
      RAISE EXCEPTION '% mudou de colunas (nomes ou tipos)', v_nome;
    END IF;
  END LOOP;

  -- O cofre dos números não pode ter se aberto: rel_margem_por_produto segue sem anon e sem authenticated.
  IF has_table_privilege('anon', 'public.rel_margem_por_produto', 'SELECT')
     OR has_table_privilege('authenticated', 'public.rel_margem_por_produto', 'SELECT') THEN
    RAISE EXCEPTION 'rel_margem_por_produto ficou legível para anon ou authenticated';
  END IF;

  IF pg_get_triggerdef((SELECT t.oid FROM pg_trigger t WHERE t.tgrelid = v_os AND t.tgname = 'tg_sync_item_os_custos' AND NOT t.tgisinternal)) IS DISTINCT FROM v_gatilho THEN
    RAISE EXCEPTION 'tg_sync_item_os_custos foi recriado com definição diferente';
  END IF;
  IF (SELECT t.tgenabled FROM pg_trigger t WHERE t.tgrelid = v_os AND t.tgname = 'tg_sync_item_os_custos' AND NOT t.tgisinternal) <> v_gatilho_estado THEN
    RAISE EXCEPTION 'tg_sync_item_os_custos mudou de estado (ligado/desligado)';
  END IF;

  SELECT string_agg(a.attrelid::regclass::text || '.' || a.attname || '=' || COALESCE(a.attacl::text, '-'), ';' ORDER BY a.attrelid::regclass::text)
    INTO v_attacl_depois
    FROM pg_attribute a WHERE a.attname = 'custo_unitario' AND a.attrelid IN (v_os, v_esp);
  IF v_attacl_depois IS DISTINCT FROM v_attacl_antes THEN
    RAISE EXCEPTION 'Os privilégios por coluna de custo_unitario mudaram: antes [%] depois [%]', v_attacl_antes, v_attacl_depois;
  END IF;

  IF (SELECT count(*) FROM public.itens_os) <> v_n_antes
     OR (SELECT md5(COALESCE(string_agg(id::text || ':' || trim_scale(custo_unitario)::text, ',' ORDER BY id), '')) FROM public.itens_os) <> v_hash_antes
     OR (SELECT md5(COALESCE(string_agg(item_os_id::text || ':' || trim_scale(custo_unitario)::text, ',' ORDER BY item_os_id), '')) FROM public.item_os_custos) <> v_hash_esp_antes THEN
    RAISE EXCEPTION 'Os valores de custo_unitario mudaram com a troca de tipo (não podia)';
  END IF;

  PERFORM pg_notify('pgrst', 'reload schema');
END
$m$;
