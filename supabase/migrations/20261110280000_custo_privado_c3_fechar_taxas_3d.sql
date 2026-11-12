-- AINDA NÃO APLICADA (escrita em 11/11/2026, pacote c2 da onda C). Só depois da C1 aplicada E do front da onda C publicado
-- e provado no pacote. Quem aplicar: ensaiar antes (transação desfeita, com as contas reais: e52011db, a1d56e29 e d15a87fd sem
-- custo; a5bc923d financeiro; o admin), aplicar fora do horário, avisar a equipe para recarregar a página, e só então trocar
-- esta linha por "APLICADA em <data>" com o que foi conferido depois.

-- Privacidade do custo, onda C3: as taxas da impressão 3D só para quem vê custo (CONTRAI; desenho de 05/11/2026, revisto
-- em 11/11/2026).
--
-- ATENÇÃO À ORDEM: só depois de publicado e provado o front da onda C, que (a) cota a peça 3D NO SERVIDOR para quem não vê
-- custo (lib/api/orcamento-3d.functions.ts) e (b) lê as taxas pelas visões *_financeiro (C1) quem vê custo. Antes disso a
-- calculadora 3D antiga quebra: ela pede custo/grama, custo/hora e a configuração de preço direto das tabelas e faz a conta
-- no navegador; coluna sem GRANT derruba a consulta inteira (select '*' inclusive) para TODOS os papéis, o admin também, e
-- a tela antiga engolia o erro como "Nenhuma impressora ativa" e caía nos números de fábrica sem avisar.
--
-- O QUE FAZ
--   0. Guardas que PARAM em voz alta: colunas vivas = lista aberta + lista de custo (src/domain/impressao3d/colunas.ts);
--      as visões da C1 existem; nenhuma visão com security_invoker, nenhuma função SECURITY INVOKER e nenhuma policy de outra
--      tabela lê essas tabelas (perderiam a leitura e quebrariam em silêncio).
--   1. maquinas_3d_config e materiais_3d_filamento: leitura por coluna, só as sem custo. Quem cota e quem opera ainda escolhe
--      impressora e filamento por nome, tipo, cor, potência e capacidade. Ficam sem leitura: na impressora, a depreciação e
--      o custo/hora (custo_aquisicao, frete, instalação, acessórios, valor residual, vida útil, horas acumuladas, manutenção,
--      consumíveis e infraestrutura por hora, horas produtivas, método, custo_hora_calculado, custo_hora_manual e seu
--      motivo/autor/data, consumiveis_json); no filamento, custo_compra, frete_rateado, tributos_aquisicao, descontos,
--      outros_custos e custo_por_grama_calculado.
--   2. config_precificacao_3d: a linha só para quem vê custo de máquina (financeiro.read ou impressao3d.cost.read: admin,
--      gestor e financeiro). A policy de gravar ("config 3d manage", ALL) passa a FILTRAR na leitura (has_permission) em vez
--      de lançar exceção para quem não tem a chave; na escrita (WITH CHECK) continua lançando, dizendo qual chave faltou.
--      MUDA PARA O ESTOQUE: a conta e52011db (estoque, vendedor, operador, designer) lia a configuração porque tem
--      impressao3d.read; depois daqui ela não lê, e a Planilha de custos, aba "Tarifas e margens", mostra o aviso em vez dos
--      números (a tela foi ajustada para dizer isso em vez de ficar vazia).
--   INSERT, UPDATE e DELETE seguem como estão (policies de admin e gestor; as gravações de impressora e filamento passam
--   pelas funções DEFINER upsert_*_3d e delete_*_3d). service_role continua lendo tudo (é quem cota no servidor).
--   Coluna NOVA nessas duas tabelas nasce sem leitura: quem acrescentar decide na hora (tests/custo-3d-pela-visao.test.ts).
--
-- REVISTO CONTRA O BANCO DE 11/11/2026: 36 colunas na impressora (18 abertas + 18 de custo), 25 no filamento (19 + 6);
-- policies "config 3d read" (md5 da expressão 6bbc721c...) e "config 3d manage" (md5 5462ae4c... no USING e no WITH CHECK)
-- iguais às de 05/11; nenhuma visão depende das três tabelas; as 7 funções que as citam são SECURITY DEFINER
-- (audit_maquina_3d_manual, breakdown_3d, delete_filamento_3d, delete_impressora_3d, produtividade_3d, upsert_filamento_3d,
-- upsert_impressora_3d); a única policy de outra tabela que cita o nome é a de eventos_negocio, e só como texto.
--
-- IDEMPOTENTE: rodar de novo reproduz o mesmo estado (cada troca reconhece que já foi feita).

-- 0. Guardas --------------------------------------------------------------------------------------------------------------
DO $guarda$
DECLARE
  v_imp_abertas constant text[] := ARRAY[
    'maquina_id', 'fabricante', 'modelo', 'serial', 'tecnologia', 'potencia_media_w', 'potencia_aquecimento_w',
    'potencia_standby_w', 'capacidade_x', 'capacidade_y', 'capacidade_z', 'possui_ams', 'quantidade_slots', 'bico_padrao',
    'placa_padrao', 'ativa', 'created_at', 'updated_at'];
  v_imp_custo constant text[] := ARRAY[
    'custo_aquisicao', 'frete_aquisicao', 'instalacao', 'acessorios_capitalizados', 'valor_residual', 'vida_util_horas',
    'horas_acumuladas', 'manutencao_por_hora', 'consumiveis_por_hora', 'infraestrutura_por_hora', 'horas_produtivas_mensais',
    'metodo_custo_hora', 'custo_hora_calculado', 'custo_hora_manual', 'motivo_custo_manual', 'custo_hora_manual_usuario_id',
    'custo_hora_manual_at', 'consumiveis_json'];
  v_fil_abertas constant text[] := ARRAY[
    'material_id', 'tipo', 'marca', 'linha', 'cor', 'codigo', 'diametro', 'densidade', 'peso_nominal', 'peso_liquido',
    'tara_carretel', 'fator_aproveitamento', 'exige_secagem', 'tempo_secagem', 'potencia_secador', 'temperatura_secagem',
    'armazenamento', 'created_at', 'updated_at'];
  v_fil_custo constant text[] := ARRAY[
    'custo_compra', 'frete_rateado', 'tributos_aquisicao', 'descontos', 'outros_custos', 'custo_por_grama_calculado'];
  v_tabela text;
  v_esperadas text[];
  v_vivas text[];
  v_novas text;
  v_sumiram text;
  v_lista text;
BEGIN
  -- 0a. As colunas vivas são exatamente a lista aberta mais a de custo.
  FOREACH v_tabela IN ARRAY ARRAY['maquinas_3d_config', 'materiais_3d_filamento'] LOOP
    v_esperadas := CASE v_tabela WHEN 'maquinas_3d_config' THEN v_imp_abertas || v_imp_custo
                                 ELSE v_fil_abertas || v_fil_custo END;
    SELECT array_agg(a.attname::text ORDER BY a.attnum) INTO v_vivas
      FROM pg_attribute a
     WHERE a.attrelid = to_regclass('public.' || v_tabela) AND a.attnum > 0 AND NOT a.attisdropped;
    IF v_vivas IS NULL THEN
      RAISE EXCEPTION 'C3: a tabela public.% não existe neste banco; reler antes de fechar', v_tabela;
    END IF;
    SELECT string_agg(c, ', ') INTO v_novas FROM unnest(v_vivas) AS c WHERE c <> ALL (v_esperadas);
    SELECT string_agg(c, ', ') INTO v_sumiram FROM unnest(v_esperadas) AS c WHERE c <> ALL (v_vivas);
    IF v_novas IS NOT NULL OR v_sumiram IS NOT NULL THEN
      RAISE EXCEPTION 'C3: public.% mudou desde a leitura de 11/11/2026 (coluna nova: %; coluna que sumiu: %). Decidir a coluna em src/domain/impressao3d/colunas.ts e aqui antes de fechar',
        v_tabela, coalesce(v_novas, 'nenhuma'), coalesce(v_sumiram, 'nenhuma');
    END IF;
  END LOOP;

  -- 0b. Quem vê custo lê pelas visões da C1: sem elas, admin, gestor e financeiro ficariam sem lista.
  IF to_regclass('public.maquinas_3d_config_financeiro') IS NULL
     OR to_regclass('public.materiais_3d_filamento_financeiro') IS NULL THEN
    RAISE EXCEPTION 'C3: as visões da C1 (maquinas_3d_config_financeiro, materiais_3d_filamento_financeiro) não existem; aplicar a C1 e publicar o front antes';
  END IF;

  -- 0c. Nenhuma visão com security_invoker pode depender de coluna de custo (perderia a leitura e quebraria).
  SELECT string_agg(DISTINCT c.relname, ', ') INTO v_lista
    FROM pg_depend d
    JOIN pg_rewrite r ON r.oid = d.objid
    JOIN pg_class c ON c.oid = r.ev_class
    JOIN pg_attribute a ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid
   WHERE d.classid = 'pg_rewrite'::regclass
     AND c.relkind IN ('v', 'm') AND c.oid <> d.refobjid
     AND coalesce(c.reloptions::text, '') ~ 'security_invoker=(true|on)'
     AND ((d.refobjid = 'public.maquinas_3d_config'::regclass AND a.attname = ANY (v_imp_custo))
       OR (d.refobjid = 'public.materiais_3d_filamento'::regclass AND a.attname = ANY (v_fil_custo)));
  IF v_lista IS NOT NULL THEN
    RAISE EXCEPTION 'C3: visões com security_invoker ainda leem coluna de custo da impressão 3D: %. Refazer antes de fechar.', v_lista;
  END IF;

  -- 0d. Nenhuma função SECURITY INVOKER pode ler as duas tabelas (rodaria com o privilégio de quem chama e perderia as colunas).
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v_lista
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND NOT p.prosecdef
     AND p.prosrc ~ '(maquinas_3d_config|materiais_3d_filamento)';
  IF v_lista IS NOT NULL THEN
    RAISE EXCEPTION 'C3: funções SECURITY INVOKER leem maquinas_3d_config ou materiais_3d_filamento: %. Conferir se pedem coluna de custo antes de fechar.', v_lista;
  END IF;

  -- 0e. Nenhuma policy de outra tabela pode ler as duas tabelas por subconsulta (a de eventos_negocio só cita o nome como texto).
  SELECT string_agg(format('%I.%I', tablename, policyname), ', ') INTO v_lista
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename NOT IN ('maquinas_3d_config', 'materiais_3d_filamento')
     AND (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~* '(from|join)\s+(public\.)?(maquinas_3d_config|materiais_3d_filamento)\M';
  IF v_lista IS NOT NULL THEN
    RAISE EXCEPTION 'C3: policies de outras tabelas leem maquinas_3d_config ou materiais_3d_filamento: %. Conferir antes de fechar.', v_lista;
  END IF;
END $guarda$;

-- 1. Leitura por coluna, sem as de custo ------------------------------------------------------------------------------------
-- (REVOKE de tabela inteira leva junto os privilégios por coluna que existissem: o estado final é sempre o da lista abaixo)
REVOKE SELECT ON public.maquinas_3d_config FROM authenticated, anon;
GRANT SELECT (maquina_id, fabricante, modelo, serial, tecnologia, potencia_media_w, potencia_aquecimento_w, potencia_standby_w,
              capacidade_x, capacidade_y, capacidade_z, possui_ams, quantidade_slots, bico_padrao, placa_padrao,
              ativa, created_at, updated_at)
  ON public.maquinas_3d_config TO authenticated;

REVOKE SELECT ON public.materiais_3d_filamento FROM authenticated, anon;
GRANT SELECT (material_id, tipo, marca, linha, cor, codigo, diametro, densidade, peso_nominal, peso_liquido, tara_carretel,
              fator_aproveitamento, exige_secagem, tempo_secagem, potencia_secador, temperatura_secagem, armazenamento,
              created_at, updated_at)
  ON public.materiais_3d_filamento TO authenticated;

-- 2. Configuração de preço 3D: a linha só para quem vê custo -----------------------------------------------------------------
-- 2a. A leitura de quem tem impressao3d.read (o vendedor e o operador também) sai, só se ainda for a de 05/11/2026.
DO $m$
DECLARE
  v_qual text;
BEGIN
  SELECT qual INTO v_qual FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'config_precificacao_3d' AND policyname = 'config 3d read';
  IF NOT FOUND THEN
    RAISE NOTICE 'config_precificacao_3d: a policy "config 3d read" já saiu';
  ELSIF md5(coalesce(v_qual, '')) <> '6bbc721ca2536e19eeeed3f8b38300bd' THEN
    RAISE EXCEPTION 'config_precificacao_3d: a policy "config 3d read" mudou desde a leitura de 05/11/2026 (md5 %); reler antes de trocar', md5(coalesce(v_qual, ''));
  ELSE
    DROP POLICY "config 3d read" ON public.config_precificacao_3d;
  END IF;
END $m$;

-- 2b. A leitura nova: só quem vê custo de máquina.
DROP POLICY IF EXISTS config_3d_leitura_custo ON public.config_precificacao_3d;
CREATE POLICY config_3d_leitura_custo ON public.config_precificacao_3d
  FOR SELECT TO authenticated
  USING (public.pode_ver_custo_de_maquina((SELECT auth.uid())));

-- 2c. "config 3d manage" é ALL: o USING também vale na leitura, e require_permission LANÇA para quem não tem a chave.
--     Passa a filtrar (has_permission) na leitura; o WITH CHECK fica como está e continua lançando na escrita.
DO $m$
DECLARE
  v_qual text;
  v_check text;
BEGIN
  SELECT qual, with_check INTO v_qual, v_check FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'config_precificacao_3d' AND policyname = 'config 3d manage';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'config_precificacao_3d: a policy "config 3d manage" não existe mais; reler antes de trocar';
  END IF;
  IF md5(coalesce(v_check, '')) <> '5462ae4ca07991ead1dfbc7f2c50fee3' THEN
    RAISE EXCEPTION 'config_precificacao_3d: o WITH CHECK de "config 3d manage" mudou desde a leitura de 05/11/2026 (md5 %); reler antes de trocar', md5(coalesce(v_check, ''));
  END IF;
  IF v_qual ~ 'has_permission' AND v_qual ~ 'impressao3d\.settings\.manage' AND v_qual !~ 'require_permission' THEN
    RAISE NOTICE 'config_precificacao_3d: "config 3d manage" já filtra na leitura';
  ELSIF md5(coalesce(v_qual, '')) <> '5462ae4ca07991ead1dfbc7f2c50fee3' THEN
    RAISE EXCEPTION 'config_precificacao_3d: o USING de "config 3d manage" mudou desde a leitura de 05/11/2026 (md5 %); reler antes de trocar', md5(coalesce(v_qual, ''));
  ELSE
    ALTER POLICY "config 3d manage" ON public.config_precificacao_3d
      USING (public.has_permission((SELECT auth.uid()), 'impressao3d.settings.manage'));
  END IF;
END $m$;

NOTIFY pgrst, 'reload schema';
