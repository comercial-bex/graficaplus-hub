-- O custo não escapa por função (04/11/2026, achados da revisão adversarial do PR 425).
--
-- O banco esconde custo, margem e lucro de quem não os vê por GRANT por coluna, RLS e views por nível.
-- Função SECURITY DEFINER passa por cima de tudo isso: o que ela devolve ou grava vale para quem a chama.
-- A revisão achou seis portas por onde o vendedor, o operador e até o parceiro liam custo, e eu repeti as
-- duas piores com a conta real de um vendedor (sem financeiro.read, custos.read nem estoque.cost.read):
--
--   a. sugerir_compra_da_os devolvia custo do material e fornecedor para qualquer conta autenticada
--      (5 linhas, 4 com custo e 4 com fornecedor), parceiros incluídos;
--   b. fechar_os gravava o resultado financeiro inteiro em eventos_negocio (legível por logs.read, os.read
--      ou clientes.read: 4 eventos com custo, margem e lucro), escrevia o custo em reais no texto de
--      ordens_servico.fechamento_estimativas e devolvia a linha da vw_resultado_os na resposta;
--   c. avancar_os_status devolvia a linha INTEIRA de ordens_servico (25 colunas privadas) em toda mudança de
--      status, para qualquer staff;
--   d. aprovar_orcamento gravava to_jsonb(orcamentos) (custo_estimado, margem_estimada, token_publico,
--      aprovado_ip) em orcamento_versoes.snapshot quando o orçamento ainda não tinha versão;
--   e. converter_orcamento_em_os devolvia custo_materiais_previsto ao vendedor que converte;
--   f. o filtro do retrato da versão só pegava custo_* e margem_*, e o cabeçalho do retrato tinha 4 chaves
--      escritas à mão.
--
-- O resultado completo da OS fica em os_resultado_snapshots (protegido por resultado.read), então tirar o
-- custo do evento, do texto e da resposta não perde nada.
--
-- Cada troca é feita sobre a definição VIVA (pg_get_functiondef) com âncora que precisa aparecer o número
-- esperado de vezes: se outra sessão mexeu na função, a migração para em voz alta. Rodar de novo é inofensivo.
--
-- NÃO faz parte desta migração (precisa do OK do dono, listar antes de mexer): limpar as chaves de custo dos 4
-- eventos antigos de eventos_negocio e o texto em reais da OS 212; o resto do que a revisão achou em 3D,
-- textos livres de custo e automações está no documento de próximos passos.

-- 1. Ajudantes (só as funções definer chamam; ninguém chama direto) ---------------------------------------
-- Tira de um jsonb toda chave que diz custo, margem, lucro, markup ou divergência de custo.
CREATE OR REPLACE FUNCTION public.jsonb_sem_custo(p_json jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT CASE WHEN jsonb_typeof(p_json) = 'object'
           THEN p_json - coalesce((SELECT array_agg(k) FROM jsonb_object_keys(p_json) AS k
                                    WHERE k ~* '(custo|margem|lucro|markup|divergencia)'), ARRAY[]::text[])
           ELSE p_json END
$function$;
REVOKE ALL ON FUNCTION public.jsonb_sem_custo(jsonb) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.jsonb_sem_custo(jsonb) IS
  'Tira de um jsonb toda chave com custo, margem, lucro, markup ou divergência de custo. Para o que sai de função definer rumo a quem não vê custo.';

-- "Material pelo previsto (R$ 3,88): ..." vira "Material pelo previsto: ...". O texto com valor fica só no snapshot protegido.
CREATE OR REPLACE FUNCTION public.estimativas_sem_reais(p_estimativas jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT CASE WHEN jsonb_typeof(p_estimativas) = 'array'
           THEN coalesce((SELECT jsonb_agg(to_jsonb(regexp_replace(e #>> '{}', '\s*\(R\$\s*[0-9.,]+\)', '', 'g')) ORDER BY n)
                            FROM jsonb_array_elements(p_estimativas) WITH ORDINALITY AS t(e, n)), '[]'::jsonb)
           ELSE p_estimativas END
$function$;
REVOKE ALL ON FUNCTION public.estimativas_sem_reais(jsonb) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.estimativas_sem_reais(jsonb) IS
  'Tira "(R$ 0,00)" dos textos de estimativa do fechamento da OS: o valor mora no snapshot de resultado, protegido por resultado.read.';

-- A linha da OS sem as colunas que o próprio banco não deixa authenticated ler direto (valor, custo, margem,
-- lucro...). O valor de retorno de uma função definer não passa pelo GRANT por coluna; quem vê o financeiro
-- recebe a linha inteira. Coluna que nascer privada amanhã já entra na regra.
CREATE OR REPLACE FUNCTION public.os_sem_colunas_privadas(p_os public.ordens_servico)
RETURNS public.ordens_servico
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE v_privadas text[];
BEGIN
  IF public.can_see_financials(auth.uid()) THEN RETURN p_os; END IF;
  SELECT coalesce(array_agg(a.attname::text), ARRAY[]::text[]) INTO v_privadas
    FROM pg_attribute a
   WHERE a.attrelid = 'public.ordens_servico'::regclass AND a.attnum > 0 AND NOT a.attisdropped
     AND NOT has_column_privilege('authenticated', a.attrelid, a.attnum, 'SELECT');
  RETURN jsonb_populate_record(NULL::public.ordens_servico, to_jsonb(p_os) - v_privadas);
END $function$;
REVOKE ALL ON FUNCTION public.os_sem_colunas_privadas(public.ordens_servico) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.os_sem_colunas_privadas(public.ordens_servico) IS
  'A linha da OS sem as colunas que authenticated não lê direto (valor, custo, margem, lucro), exceto para quem vê o financeiro. Para o retorno de funções definer.';

-- 2. sugerir_compra_da_os: só a equipe, e custo e fornecedor só para quem vê custo de material -----------
-- (a mesma regra da leitura de os_materiais_previstos e material_lotes: estoque.cost.read ou financeiro.read)
CREATE OR REPLACE FUNCTION public.sugerir_compra_da_os(p_os_id uuid)
RETURNS TABLE(material_id uuid, material text, unidade text, faltante numeric, ultimo_custo numeric, fornecedor_sugerido text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  select f.material_id, f.material, f.unidade, f.faltante,
         CASE WHEN v.ve_custo THEN coalesce(m.custo_unitario, m.custo_medio, 0) END,
         CASE WHEN v.ve_custo THEN m.fornecedor END
  from public.materiais_faltantes_os(p_os_id) f
  join public.materiais m on m.id = f.material_id
  cross join lateral (
    select public.has_permission(auth.uid(), 'estoque.cost.read') or public.can_see_financials(auth.uid()) as ve_custo
  ) v
  where f.faltante > 0
    and public.is_staff(auth.uid())
$function$;

-- 3. avancar_os_status devolve a linha da OS sem as colunas privadas ----------------------------------------
DO $m$
DECLARE
  v_def text := pg_get_functiondef('public.avancar_os_status(uuid,public.status_os)'::regprocedure);
  v_novo text;
  n integer;
BEGIN
  IF position('os_sem_colunas_privadas' IN v_def) > 0 THEN
    RAISE NOTICE 'avancar_os_status já devolve a linha sem as colunas privadas';
    RETURN;
  END IF;
  -- Três saídas devolvem a linha inteira: RETURN v_os; (status igual) e RETURN v_os_atualizada; (duas vezes).
  v_novo := replace(v_def, 'RETURN v_os_atualizada;', 'RETURN public.os_sem_colunas_privadas(v_os_atualizada);');
  v_novo := replace(v_novo, 'RETURN v_os;', 'RETURN public.os_sem_colunas_privadas(v_os);');
  n := (length(v_novo) - length(replace(v_novo, 'public.os_sem_colunas_privadas(', ''))) / length('public.os_sem_colunas_privadas(');
  IF n <> 3 THEN
    RAISE EXCEPTION 'avancar_os_status: % saídas trocadas (esperado 3)', n;
  END IF;
  EXECUTE v_novo;
END $m$;

-- 4. fechar_os: o custo fica no snapshot protegido e não vai para o evento, para o texto nem para quem não vê o financeiro
DO $m$
DECLARE
  v_def text := pg_get_functiondef('public.fechar_os(uuid)'::regprocedure);
  v_de text[];
  v_para text[];
  v_cont integer[] := ARRAY[1, 1, 2, 1];
  k integer;
  n integer;
BEGIN
  IF position('estimativas_sem_reais' IN v_def) > 0 THEN
    RAISE NOTICE 'fechar_os já tira o custo do evento, do texto e da resposta';
    RETURN;
  END IF;
  v_de := ARRAY[
    -- (a) depois do snapshot (que guarda o texto com valor), as estimativas perdem os reais
    $d$  PERFORM set_config('app.avancar_os_status', 'on', true);$d$,
    -- (b) o evento da linha do tempo guarda o resultado SEM chaves de custo, e as estimativas sem reais
    $d$'OS fechada' END, NULL, v_result);$d$,
    -- (c) a resposta de quem não vê o financeiro não leva custo (bloqueada e sem custo previsto)
    $d$'resultado', v_result);$d$,
    -- (c) a resposta da OS fechada
    $d$'resultado', v_result, 'estimativas', v_estimativas);$d$
  ];
  v_para := ARRAY[
    E'  -- O snapshot acima guarda o texto das estimativas com valor (protegido por resultado.read). Para a OS, o evento e a\n'
      || E'  -- resposta, que quem não vê custo também lê, o texto vai sem reais (revisão de 04/11/2026).\n'
      || E'  v_estimativas := public.estimativas_sem_reais(v_estimativas);\n'
      || E'  PERFORM set_config(''app.avancar_os_status'', ''on'', true);',
    $d$'OS fechada' END, NULL, public.jsonb_sem_custo(v_result) || jsonb_build_object('estimativas', v_estimativas));$d$,
    $d$'resultado', CASE WHEN public.can_see_financials(v_uid) THEN v_result ELSE public.jsonb_sem_custo(v_result) END);$d$,
    $d$'resultado', CASE WHEN public.can_see_financials(v_uid) THEN v_result ELSE public.jsonb_sem_custo(v_result) || jsonb_build_object('estimativas', v_estimativas) END, 'estimativas', v_estimativas);$d$
  ];
  FOR k IN 1..array_length(v_de, 1) LOOP
    n := (length(v_def) - length(replace(v_def, v_de[k], ''))) / length(v_de[k]);
    IF n <> v_cont[k] THEN
      RAISE EXCEPTION 'fechar_os: âncora % apareceu % vezes (esperado %)', k, n, v_cont[k];
    END IF;
    v_def := replace(v_def, v_de[k], v_para[k]);
  END LOOP;
  EXECUTE v_def;
END $m$;

-- 5. aprovar_orcamento: a versão que ele cria quando o orçamento não tem nenhuma não leva custo, token nem IP ---
DO $m$
DECLARE
  v_def text := pg_get_functiondef('public.aprovar_orcamento(uuid,uuid,text)'::regprocedure);
  v_de text := $d$'aprovada', to_jsonb(v_orc), v_orc.valor_total$d$;
  v_para text := $d$'aprovada', public.jsonb_sem_custo(to_jsonb(v_orc) - 'token_publico' - 'aprovado_ip'), v_orc.valor_total$d$;
  n integer;
BEGIN
  IF position('jsonb_sem_custo' IN v_def) > 0 THEN
    RAISE NOTICE 'aprovar_orcamento já grava a versão sem custo';
    RETURN;
  END IF;
  n := (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de);
  IF n <> 1 THEN
    RAISE EXCEPTION 'aprovar_orcamento: âncora apareceu % vezes (esperado 1)', n;
  END IF;
  EXECUTE replace(v_def, v_de, v_para);
END $m$;

-- 6. converter_orcamento_em_os: o custo previsto de material só volta para quem vê o financeiro ---------------
DO $m$
DECLARE
  v_def text := pg_get_functiondef('public.converter_orcamento_em_os(uuid,jsonb)'::regprocedure);
  v_de text := $d$'custo_materiais_previsto', v_custo_materiais,$d$;
  v_para text := $d$'custo_materiais_previsto', CASE WHEN public.can_see_financials(auth.uid()) THEN v_custo_materiais END,$d$;
  n integer;
BEGIN
  IF position('can_see_financials(auth.uid()) THEN v_custo_materiais' IN v_def) > 0 THEN
    RAISE NOTICE 'converter_orcamento_em_os já esconde o custo de material de quem não vê o financeiro';
    RETURN;
  END IF;
  n := (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de);
  IF n <> 1 THEN
    RAISE EXCEPTION 'converter_orcamento_em_os: âncora apareceu % vezes (esperado 1)', n;
  END IF;
  EXECUTE replace(v_def, v_de, v_para);
END $m$;

-- 7. O retrato da versão: o filtro cobre custo, margem, lucro e markup, e o cabeçalho usa o mesmo filtro -------
-- (itens: o regex passa de '^(custo|margem)_' para o conjunto todo; cabeçalho: no lugar das 4 chaves escritas à mão)
DO $m$
DECLARE
  v_itens text := pg_get_functiondef('public.orcamento_itens_para_versao(uuid)'::regprocedure);
  v_gatilho text := pg_get_functiondef('public.tg_orcamento_congela_versao()'::regprocedure);
  n integer;
BEGIN
  IF position($d$'^(custo|margem)_'$d$ IN v_itens) > 0 THEN
    v_itens := replace(v_itens, $d$'^(custo|margem)_'$d$, $d$'^(custos?|margem|lucro|markup|divergencia)(_|$)'$d$);
    EXECUTE v_itens;
    REVOKE ALL ON FUNCTION public.orcamento_itens_para_versao(uuid) FROM PUBLIC, anon, authenticated;
  ELSE
    RAISE NOTICE 'orcamento_itens_para_versao já cobre custo, margem, lucro e markup';
  END IF;

  IF position($d$to_jsonb(NEW) - 'custo_estimado' - 'margem_estimada' - 'token_publico' - 'aprovado_ip'$d$ IN v_gatilho) > 0 THEN
    n := (length(v_gatilho) - length(replace(v_gatilho, $d$to_jsonb(NEW) - 'custo_estimado' - 'margem_estimada' - 'token_publico' - 'aprovado_ip'$d$, ''))) / length($d$to_jsonb(NEW) - 'custo_estimado' - 'margem_estimada' - 'token_publico' - 'aprovado_ip'$d$);
    IF n <> 1 THEN
      RAISE EXCEPTION 'tg_orcamento_congela_versao: âncora apareceu % vezes (esperado 1)', n;
    END IF;
    EXECUTE replace(v_gatilho, $d$to_jsonb(NEW) - 'custo_estimado' - 'margem_estimada' - 'token_publico' - 'aprovado_ip'$d$,
                    $d$public.jsonb_sem_custo(to_jsonb(NEW) - 'token_publico' - 'aprovado_ip')$d$);
    REVOKE ALL ON FUNCTION public.tg_orcamento_congela_versao() FROM PUBLIC, anon, authenticated;
  ELSE
    RAISE NOTICE 'tg_orcamento_congela_versao já usa o filtro de custo no cabeçalho';
  END IF;
END $m$;
