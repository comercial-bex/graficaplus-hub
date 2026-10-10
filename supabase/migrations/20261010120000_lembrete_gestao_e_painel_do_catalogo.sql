-- Lembrete à gerência pelo WhatsApp e painel de preço do catálogo (10/10/2026).
--
-- Pedido do dono:
--   * "avise o Gestor (gerente) pra corrigir, avise e dispare no whatsapp dele
--     também os lembretes" — orçamentos aprovados pelo cliente que nunca
--     viraram OS (8 em 10/10/2026: 55, 56, 57, 61, 62, 65, 67, 70);
--   * margem de 85% no catálogo (gravada pela própria tela, catalogo_salvar_regras)
--     "e mostra pro Admin e Gerente também um painel".
--
-- O lembrete segue o desenho do alerta crítico do Bex Lite: uma varredura por
-- dia, UMA mensagem por pessoa com a lista inteira, e silêncio quando não há
-- nada — mensagem "está tudo bem" todo dia treina a pessoa a ignorar o canal.
-- Aqui ele é uma AUTOMAÇÃO comum (tela Automações): dá para ver, editar a
-- mensagem e desligar sem mexer no banco, e cada envio fica em
-- automacao_execucoes, mandado pelo mesmo despachante dos avisos.
--
-- A seção 0 roda SOZINHA antes do resto: valor novo de enum não pode ser usado
-- na mesma transação em que nasce.

-- 0. O gatilho novo ---------------------------------------------------------
ALTER TYPE public.automacao_gatilho ADD VALUE IF NOT EXISTS 'orcamento_aprovado_sem_os';

-- 1. A varredura ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lembrete_orcamentos_aprovados_sem_os()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_hoje date := (now() AT TIME ZONE 'America/Belem')::date;
  v_qtd int;
  v_total numeric;
  v_lista text;
  v_g record;
  v_n int;
  v_enfileirados int := 0;
  v_avisados text[] := '{}';
  v_sem_telefone text[] := '{}';
BEGIN
  SELECT count(*), coalesce(sum(coalesce(l.valor_total, 0)), 0),
         string_agg(l.linha, E'\n' ORDER BY l.ordem) FILTER (WHERE l.ordem <= 25)
           || CASE WHEN count(*) > 25 THEN format(E'\n… e mais %s', count(*) - 25) ELSE '' END
    INTO v_qtd, v_total, v_lista
  FROM (
    SELECT o.valor_total,
           row_number() OVER (ORDER BY coalesce(o.aprovado_em, o.updated_at), o.numero) AS ordem,
           format('#%s · %s · %s · %s · %s',
             o.numero,
             coalesce(nullif(btrim(c.nome), ''), nullif(btrim(o.contato_nome), ''), 'sem cliente'),
             coalesce(nullif(btrim(o.titulo), ''), 'sem título'),
             'R$ ' || translate(to_char(coalesce(o.valor_total, 0), 'FM999,999,990.00'), ',.', '.,'),
             CASE x.dias WHEN 0 THEN 'aprovado hoje' WHEN 1 THEN 'aprovado ontem'
                         ELSE format('aprovado há %s dias', x.dias) END
           ) AS linha
    FROM public.orcamentos o
    LEFT JOIN public.clientes c ON c.id = o.cliente_id
    CROSS JOIN LATERAL (
      SELECT GREATEST(v_hoje - (coalesce(o.aprovado_em, o.updated_at) AT TIME ZONE 'America/Belem')::date, 0) AS dias
    ) x
    WHERE o.status = 'aprovado' AND o.os_id IS NULL
  ) l;

  -- Silêncio quando não há nada.
  IF coalesce(v_qtd, 0) = 0 THEN
    RETURN jsonb_build_object('quantidade', 0, 'enfileirados', 0,
                              'motivo', 'nenhum orçamento aprovado esperando OS');
  END IF;

  FOR v_g IN
    SELECT u.id, btrim(u.nome) AS nome, public.normalize_whatsapp_phone(u.telefone) AS tel
    FROM public.usuarios u
    WHERE EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = u.id AND r.role = 'gestor')
    ORDER BY u.nome
  LOOP
    IF v_g.tel IS NULL THEN
      -- Sem telefone não há para onde mandar; fica no retorno, não some.
      v_sem_telefone := v_sem_telefone || v_g.nome;
      CONTINUE;
    END IF;
    v_n := public.enqueue_automacoes(
      'orcamento_aprovado_sem_os', 'usuarios', v_g.id,
      jsonb_build_object(
        'gestor', jsonb_build_object('nome', split_part(v_g.nome, ' ', 1), 'telefone_normalizado', v_g.tel),
        'quantidade', v_qtd,
        'valor_total', 'R$ ' || translate(to_char(v_total, 'FM999,999,990.00'), ',.', '.,'),
        'lista', v_lista,
        'link', 'https://bexprint.com.br/orcamentos',
        'dia', v_hoje
      )
    );
    v_enfileirados := v_enfileirados + v_n;
    IF v_n > 0 THEN v_avisados := v_avisados || v_g.nome; END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'quantidade', v_qtd,
    'enfileirados', v_enfileirados,
    'avisados', to_jsonb(v_avisados),
    'gestores_sem_telefone', to_jsonb(v_sem_telefone)
  );
END;
$function$;

COMMENT ON FUNCTION public.lembrete_orcamentos_aprovados_sem_os() IS
  'Varredura diária (job lembrete-gestao-orcamentos, 9h de seg a sáb): se há orçamento aprovado sem OS, enfileira UMA mensagem por gestor com telefone, pela automação do gatilho orcamento_aprovado_sem_os. Sem nenhum, não faz nada.';

REVOKE ALL ON FUNCTION public.lembrete_orcamentos_aprovados_sem_os() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lembrete_orcamentos_aprovados_sem_os() TO service_role;

-- 2. Uma na fila por gestor: o lembrete é situação, como OS atrasada ---------
DO $situacao$
DECLARE
  v_def text := pg_get_functiondef('public.enqueue_automacoes(public.automacao_gatilho, text, uuid, jsonb)'::regprocedure);
  v_de text := $a$p_gatilho IN ('os_atrasada','pagamento_atrasado','estoque_minimo','margem_abaixo_minimo')$a$;
  v_para text := $b$p_gatilho IN ('os_atrasada','pagamento_atrasado','estoque_minimo','margem_abaixo_minimo','orcamento_aprovado_sem_os')$b$;
BEGIN
  IF position(v_para IN v_def) > 0 THEN
    RETURN; -- já trocado
  END IF;
  IF (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de) <> 1 THEN
    RAISE EXCEPTION 'enqueue_automacoes: a lista de situações não está como esperado; revise a troca';
  END IF;
  EXECUTE replace(v_def, v_de, v_para);
END
$situacao$;

-- 2b. A condição: gatilho que automacao_condicao_ok não conhece cai no
-- RETURN false do fim — o ensaio de 10/10 achou os 8 orçamentos e enfileirou 0.
-- O lembrete não tem condição na tela: sempre passa, como OS atrasada.
DO $condicao$
DECLARE
  v_def text := pg_get_functiondef('public.automacao_condicao_ok(public.automacao_gatilho, jsonb, jsonb)'::regprocedure);
  v_de text := $a$ELSIF p_gatilho IN ('pagamento_atrasado','os_atrasada') THEN$a$;
  v_para text := $b$ELSIF p_gatilho IN ('pagamento_atrasado','os_atrasada','orcamento_aprovado_sem_os') THEN$b$;
BEGIN
  IF position(v_para IN v_def) > 0 THEN
    RETURN; -- já trocado
  END IF;
  IF (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de) <> 1 THEN
    RAISE EXCEPTION 'automacao_condicao_ok: o ramo das situações não está como esperado; revise a troca';
  END IF;
  EXECUTE replace(v_def, v_de, v_para);
END
$condicao$;

-- 3. A automação (aparece em Automações; dá para editar e desligar) ----------
INSERT INTO public.automacoes (nome, descricao, gatilho, condicao, ativo, acao, payload, cooldown_segundos, delay_segundos)
SELECT
  'Lembrete à gerência: orçamentos aprovados sem OS',
  'Pedido do dono em 10/10/2026. Todo dia, de segunda a sábado, às 9h, se houver orçamento aprovado pelo cliente que ainda não virou OS, cada gestor recebe uma mensagem com a lista. Sem nenhum, não manda nada.',
  'orcamento_aprovado_sem_os',
  '{}'::jsonb,
  true,
  'whatsapp',
  jsonb_build_object(
    'telefone', '55{{gestor.telefone_normalizado}}',
    'mensagem',
    E'Olá, {{gestor.nome}}! Lembrete do Bex Print.\n\n'
    || E'Orçamentos aprovados pelo cliente que ainda não viraram OS: {{quantidade}}, somando {{valor_total}}.\n\n'
    || E'{{lista}}\n\n'
    || E'Em cada um:\n'
    || E'• vai produzir ou já entregou: abra o orçamento e use "Converter em OS" (se já foi pago, dê baixa em Contas a receber);\n'
    || E'• o cliente desistiu: marque o orçamento como rejeitado.\n\n'
    || E'{{link}}'
  ),
  43200,
  0
WHERE NOT EXISTS (SELECT 1 FROM public.automacoes WHERE gatilho = 'orcamento_aprovado_sem_os');

-- 4. O job: 9h de Macapá (12h UTC), de segunda a sábado ----------------------
DO $job$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lembrete-gestao-orcamentos') THEN
    PERFORM cron.unschedule('lembrete-gestao-orcamentos');
  END IF;
  PERFORM cron.schedule(
    'lembrete-gestao-orcamentos',
    '0 12 * * 1-6',
    $cmd$SELECT public.lembrete_orcamentos_aprovados_sem_os()$cmd$
  );
END
$job$;

-- 5. O painel de preço do catálogo (admin e gestor) --------------------------
-- Mostra custo ao lado do preço de venda: é de quem gerencia o catálogo E vê o
-- financeiro. Margem junto com preço é custo disfarçado — o vendedor não vê.
CREATE OR REPLACE FUNCTION public.catalogo_painel_de_precos()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid;
  v_res jsonb;
BEGIN
  v_uid := public.require_permission('catalogo.manage');
  IF NOT public.can_see_financials(v_uid) THEN
    RAISE EXCEPTION 'O painel de preço mostra o custo: é de quem vê o financeiro.' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'catalogo_id', c.id,
    'titulo', c.titulo,
    'regra', (
      SELECT jsonb_build_object(
        'margem_pct', r.margem_pct,
        'frete_por_peca', r.frete_por_peca,
        'arredondamento', r.arredondamento,
        'atualizado_em', r.atualizado_em,
        'atualizado_por', (SELECT u.nome FROM public.usuarios u WHERE u.id = r.atualizado_por))
      FROM public.fornecedor_regras_venda r
      WHERE r.catalogo_id = c.id AND r.secao_id IS NULL AND r.item_id IS NULL
      LIMIT 1),
    'excecoes', (
      SELECT count(*) FROM public.fornecedor_regras_venda r
      WHERE r.catalogo_id = c.id AND (r.secao_id IS NOT NULL OR r.item_id IS NOT NULL)),
    'totais', t.totais,
    'categorias', t.categorias
  ) ORDER BY c.created_at), '[]'::jsonb)
  INTO v_res
  FROM public.fornecedor_catalogos c
  CROSS JOIN LATERAL (
    WITH p AS (
      SELECT p.*, i.nome, i.codigo_bex, i.unidade_preco, i.tem_foto, i.ordem,
             coalesce(s.categoria, 'outros') AS categoria
      FROM public.fornecedor_precos_interno(c.id) p
      JOIN public.fornecedor_itens i ON i.id = p.item_id
      LEFT JOIN public.fornecedor_secoes s ON s.id = i.secao_id
      WHERE i.situacao = 'ativo'
    ),
    -- A opção "a partir de" de cada item: a de menor preço de venda.
    primeira AS (
      SELECT DISTINCT ON (item_id) *
      FROM p WHERE preco_venda IS NOT NULL
      ORDER BY item_id, preco_venda
    )
    SELECT
      jsonb_build_object(
        'itens', (SELECT count(DISTINCT item_id) FROM p),
        'itens_com_preco', (SELECT count(*) FROM primeira),
        'opcoes', (SELECT count(*) FROM p),
        'opcoes_com_preco', (SELECT count(*) FROM p WHERE preco_venda IS NOT NULL),
        'opcoes_sob_consulta', (SELECT count(*) FROM p WHERE preco_venda IS NULL)
      ) AS totais,
      coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'categoria', g.categoria,
          'itens', g.itens,
          'itens_com_preco', g.com_preco,
          'menor_preco', g.menor,
          'maior_preco', g.maior,
          'exemplo', (
            SELECT jsonb_build_object('nome', e.nome, 'codigo_bex', e.codigo_bex, 'unidade', e.unidade_preco,
                                      'custo', e.custo, 'frete', coalesce(e.frete_por_peca, 0), 'preco', e.preco_venda)
            FROM primeira e WHERE e.categoria = g.categoria
            ORDER BY e.tem_foto DESC, e.ordem NULLS LAST, e.codigo_bex
            LIMIT 1)
        ) ORDER BY g.itens DESC)
        FROM (
          SELECT p.categoria,
                 count(DISTINCT p.item_id) AS itens,
                 count(DISTINCT p.item_id) FILTER (WHERE p.preco_venda IS NOT NULL) AS com_preco,
                 (SELECT min(f.preco_venda) FROM primeira f WHERE f.categoria = p.categoria) AS menor,
                 (SELECT max(f.preco_venda) FROM primeira f WHERE f.categoria = p.categoria) AS maior
          FROM p GROUP BY p.categoria
        ) g
      ), '[]'::jsonb) AS categorias
  ) t;

  RETURN jsonb_build_object('catalogos', v_res);
END;
$function$;

COMMENT ON FUNCTION public.catalogo_painel_de_precos() IS
  'Painel do Início para admin e gestor: a regra de venda em uso, quantos itens têm preço e, por categoria, a faixa de preço e um exemplo com custo e venda. Exige catalogo.manage e visão financeira.';

REVOKE ALL ON FUNCTION public.catalogo_painel_de_precos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.catalogo_painel_de_precos() TO authenticated, service_role;
