-- =====================================================================================================
-- LEMBRETE DIARIO DE PENDENCIAS DE CUSTO (16/11/2026)
-- Ensaio com RAISE EXCEPTION final no banco vivo em docs/ensaio-lembrete-de-custos.md (a aplicacao e feita depois,
-- pelo dono, junto com 20261116100000 e 20261116120000). O preco de NENHUM produto muda aqui, e a migracao nao
-- enfileira mensagem nenhuma: so cria funcoes e um job do pg_cron. NAO toca em whatsapp_feriados, a tabela do
-- horario de atendimento da triagem do WhatsApp. A primeira mensagem sai no proximo dia de envio, as 08:00 de
-- Macapa, se houver pendencia.
--
-- ORDEM DE APLICACAO: 20261116100000, depois esta, depois 20261116120000. Esta migracao e a UNICA dona de
-- pendencias_de_custo(): a 20261116100000 nao a define mais. Aplicar a 100000 e esta juntas, na mesma entrega,
-- porque o painel de precos chama a funcao e entre as duas ela nao existe.
-- Esta aplicacao e posterior a 20261116100000 (custo real, parametros novos de custos_tabela e
-- a view produto_custo_real). Esta migracao tambem roda sem ela, porque as funcoes olham o que existe na
-- hora de rodar: sem a coluna confirmado_em, pendente e valor nulo ou zero; sem a view produto_custo_real,
-- o custo do produto sai de custo_cheio_do_produto. Mas so com a do banco o lembrete mostra a lista
-- completa e a mesma margem da tela /precos.
--
-- A) pendencias_de_custo(): cada item de custo pendente, em tres fontes:
--    1. parametro de custos_tabela dos 9 codigos do contrato que nao existe, esta desativado, tem valor
--       nulo, ou tem confirmado_em nulo (valor provisorio);
--    2. material ativo com custo de compra zerado, em uso por produto ativo;
--    3. produto ativo com preco de parceiro (fixo, por area ou por faixa de quantidade) abaixo do piso
--       liquido: piso = custo de producao / (1 - margem minima - taxas). As taxas sao o imposto sobre
--       venda mais metade do cartao, lidos de custos_tabela, como desconto_avaliar usa. O piso parte do
--       custo de producao SEM taxa, entao o imposto entra uma vez so. O preco olhado e o PIOR do parceiro.
--    So service_role executa. Devolve codigo, rotulo e tipo. O rotulo leva so percentual e nomes,
--    nunca valor em reais, e nunca parenteses, travessao ou seta.
-- B) lembrete_diario_de_custos(): UM aviso ao grupo da equipe e UM ao privado de cada gestor ou admin com
--    celular. Chave de dedupe diaria, no maximo 3 tentativas por dia (a seguinte so nasce se a anterior
--    ficou falhou ou cancelado), limite de 12 linhas por mensagem, para sozinho quando a lista esvazia e
--    avisa uma unica vez que tudo foi atualizado. Destino invalido, grupo desligado ou fila recusando vira
--    WARNING e linha em logs_auditoria, nunca silencio. Nao roda com pessoa logada.
-- C) Cron pendencias-de-custo, 11:00 e 13:00 UTC (08:00 e 10:00 em Macapa, sem horario de verao), de
--    segunda a sabado. A rodada das 10:00 so age se a das 08:00 falhou, porque a chave diaria barra
--    duplicata. Sabado envia. Domingo e os feriados da lista propria do lembrete nao enviam (a lista mora
--    dentro de lembrete_diario_de_custos: 20/11/2026, 25/12/2026 e 01/01/2027; ao virar o ano, acrescente
--    os do ano novo na mesma funcao). Nasce ativo, a pedido do dono.
-- D) Sem empilhar na segunda 16/11: o alerta de integridade dos orcamentos passa de :00 para :20 (a
--    mensagem de custo sai primeiro, as 08:00, e o lembrete de operacao e o da equipe ficam as 09:00).
-- E) Feriados do lembrete: lista curta propria, SEM tocar em whatsapp_feriados. Aquela tabela e a do horario de
--    atendimento da triagem do WhatsApp, e um feriado nela fecha a triagem no dia. O lembrete de custo nao tem
--    esse direito.
--
-- Fila: notificacoes_fila.entidade so aceita 'usuario' (entre outros) e entidade_id e NOT NULL. O aviso
-- usa 'usuario' com o id real do gestor, que aviso_registro_existe nao marca como orfao.
-- =====================================================================================================
BEGIN;
SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------------------------------
-- 0. Texto sem parenteses, travessao nem seta (nome de produto e material vem do cadastro).
-- ---------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._custo_texto_limpo(p_texto text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $f$
  SELECT btrim(regexp_replace(
           regexp_replace(
             regexp_replace(COALESCE(p_texto, ''), E'[()\\[\\]—–→←]|->|=>| - ', ' ', 'g'),
             E'\\s+,', ',', 'g'),
           E'\\s+', ' ', 'g'))
$f$;

REVOKE ALL ON FUNCTION public._custo_texto_limpo(text) FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------
-- A) pendencias_de_custo()
-- ---------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pendencias_de_custo()
RETURNS TABLE (codigo text, rotulo text, tipo text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $f$
DECLARE
  v_tem_confirmacao boolean;
  v_tem_view boolean := to_regclass('public.produto_custo_real') IS NOT NULL;
  v_sql text;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_attribute a
                  WHERE a.attrelid = 'public.custos_tabela'::regclass AND a.attname = 'confirmado_em' AND NOT a.attisdropped)
    INTO v_tem_confirmacao;

  v_sql := $q$
    WITH taxa AS (
      SELECT (COALESCE((SELECT max(c.valor) FROM public.custos_tabela c WHERE c.ativo AND c.codigo = 'impostos_venda'), 6)
            + COALESCE((SELECT max(c.valor) FROM public.custos_tabela c WHERE c.ativo AND c.codigo = 'taxa_cartao'), 3.5) / 2.0) / 100.0 AS t
    ),
    nivel AS (SELECT COALESCE(max(n.desconto_faixa_pct), 0) AS df FROM public.parceiro_niveis n),
    -- 1. parametros de custo
    par AS (
      SELECT v.cod::text AS codigo,
             (v.rot || ': ' || CASE WHEN c.id IS NULL THEN 'não cadastrado ou desativado'
                                    WHEN c.valor IS NULL THEN 'sem valor'
                                    ELSE 'valor provisório, falta confirmar' END)::text AS rotulo,
             'parametro'::text AS tipo, 1 AS ord
        FROM (VALUES
          ('aluguel_espaco_mensal',        'Aluguel do espaço'),
          ('outros_fixos_admin_mes',       'Outros custos fixos da administração'),
          ('plotter_horas_mes_reais',      'Horas reais de uso da plotter por mês'),
          ('energia_comercial_tarifa_kwh', 'Tarifa de energia comercial'),
          ('tinta_consumo_ml_m2',          'Consumo médio de tinta por metro quadrado'),
          ('plotter_manutencao_mensal',    'Manutenção mensal da plotter'),
          ('plotter_cabecote_custo',       'Custo do cabeçote da plotter'),
          ('plotter_cabecote_vida_m2',     'Vida útil do cabeçote da plotter em metros quadrados'),
          ('plotter_limpeza_mensal',       'Limpeza mensal da plotter')
        ) AS v(cod, rot)
        LEFT JOIN public.custos_tabela c ON c.codigo = v.cod AND c.ativo
       WHERE c.id IS NULL OR c.valor IS NULL OR {PENDENTE}
    ),
    -- 2. material ativo, sem custo de compra, em uso por produto ativo (mesma conta do motor de custo)
    mat AS (
      SELECT ('material:' || m.id)::text AS codigo,
             ('Material ' || public._custo_texto_limpo(m.nome) || ': custo de compra zerado, usado em ' || u.n
              || CASE WHEN u.n = 1 THEN ' produto ativo' ELSE ' produtos ativos' END)::text AS rotulo,
             'material'::text AS tipo, 2 AS ord
        FROM public.materiais m
        JOIN LATERAL (
          SELECT count(DISTINCT pm.produto_id) AS n
            FROM public.produto_materiais pm
            JOIN public.produtos p ON p.id = pm.produto_id AND p.ativo
           WHERE pm.material_id = m.id
        ) u ON u.n > 0
       WHERE m.status = 'ativo' AND COALESCE(m.custo_medio, m.custo_unitario, 0) <= 0
    ),
    -- 3. preco de parceiro abaixo do piso liquido
    base AS (
      -- margem mínima como desconto_avaliar e a tela /precos: vazio ou zero vale 30 (o piso antigo abaixo mantém a conta de parceiro_precos)
      SELECT p.id, p.nome, COALESCE(NULLIF(p.margem_minima, 0), 30) AS mm, p.preco_parceiro, p.preco_parceiro_acima,
             CASE WHEN COALESCE(p.custo_medio, 0) > 0 AND COALESCE(p.margem_minima, 0) < 100
                  THEN round(p.custo_medio / (1 - COALESCE(p.margem_minima, 0) / 100), 2) END AS piso_antigo,
             {CUSTO} AS custo
        FROM public.produtos p
       WHERE p.ativo
         AND (COALESCE(p.preco_parceiro, 0) > 0 OR COALESCE(p.preco_parceiro_acima, 0) > 0
              OR EXISTS (SELECT 1 FROM public.produto_faixas_preco f WHERE f.produto_id = p.id))
    ),
    cand AS (
      SELECT b.id, b.preco_parceiro AS preco FROM base b WHERE b.preco_parceiro > 0
      UNION ALL
      SELECT b.id, b.preco_parceiro_acima FROM base b WHERE b.preco_parceiro_acima > 0
      UNION ALL
      -- faixa de quantidade: o parceiro do nivel mais alto paga o menor preco, nunca abaixo do piso antigo
      SELECT b.id, LEAST(GREATEST(round(f.preco_unitario * (1 - n.df / 100), 4), COALESCE(b.piso_antigo, 0)),
                         NULLIF(round(f.preco_unitario, 4), 0))
        FROM base b
        JOIN public.produto_faixas_preco f ON f.produto_id = b.id
        CROSS JOIN nivel n
       WHERE (f.vigencia_inicio IS NULL OR f.vigencia_inicio <= public.hoje_br())
         AND (f.vigencia_fim IS NULL OR f.vigencia_fim >= public.hoje_br())
    ),
    pior AS (
      SELECT b.id, b.nome, b.mm, b.custo, min(c.preco) AS preco
        FROM base b JOIN cand c ON c.id = b.id
       WHERE c.preco > 0 AND COALESCE(b.custo, 0) > 0
       GROUP BY b.id, b.nome, b.mm, b.custo
    ),
    calc AS (
      SELECT w.id, w.nome, w.mm, w.preco,
             w.custo / (1 - w.mm / 100.0 - t.t) AS piso_liquido,
             (1 - w.custo / w.preco - t.t) * 100 AS margem_liquida
        FROM pior w CROSS JOIN taxa t
       WHERE 1 - w.mm / 100.0 - t.t > 0
    ),
    parc AS (
      SELECT ('parceiro:' || k.id)::text AS codigo,
             ('Preço de parceiro de ' || public._custo_texto_limpo(k.nome) || ': margem líquida de '
              || CASE WHEN round(k.margem_liquida, 0) < 0 THEN 'menos ' || abs(round(k.margem_liquida, 0))::integer
                      ELSE round(k.margem_liquida, 0)::integer::text END
              || ' por cento, o mínimo é ' || round(k.mm, 0)::integer || ' por cento')::text AS rotulo,
             'parceiro'::text AS tipo, 3 AS ord
        FROM calc k
       WHERE round(k.preco, 2) < round(k.piso_liquido, 2)
    )
    SELECT x.codigo, x.rotulo, x.tipo
      FROM (SELECT * FROM par UNION ALL SELECT * FROM mat UNION ALL SELECT * FROM parc) x
     ORDER BY x.ord, x.rotulo
  $q$;

  v_sql := replace(v_sql, '{PENDENTE}',
                   CASE WHEN v_tem_confirmacao THEN 'c.confirmado_em IS NULL' ELSE 'c.valor <= 0' END);
  v_sql := replace(v_sql, '{CUSTO}',
                   CASE WHEN v_tem_view
                        THEN '(SELECT r.custo_producao FROM public.produto_custo_real r WHERE r.produto_id = p.id)'
                        ELSE 'NULLIF((public.custo_cheio_do_produto(p.id) ->> ''custo_total'')::numeric, 0)' END);

  RETURN QUERY EXECUTE v_sql;
END $f$;

REVOKE ALL ON FUNCTION public.pendencias_de_custo() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pendencias_de_custo() TO service_role;

-- ---------------------------------------------------------------------------------------------------
-- B1) Enfileira um aviso com chave diaria e ate 3 tentativas (base, r1, r2). A seguinte so nasce se a
--     anterior ficou 'falhou' ou 'cancelado' (a fila deixa 'pendente' quando ainda vai tentar de novo).
-- ---------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._lembrete_custos_enfileirar(
  p_destino text, p_evento text, p_chave text, p_texto text, p_mencionar jsonb, p_entidade_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$
DECLARE
  v_k integer;
  v_chave text;
  v_status text;
  v_id uuid;
BEGIN
  IF p_destino IS NULL OR btrim(p_destino) = '' THEN
    RETURN 'sem_destino';
  END IF;
  FOR v_k IN 0..2 LOOP
    v_chave := p_chave || CASE WHEN v_k = 0 THEN '' ELSE ':r' || v_k END;
    SELECT f.status INTO v_status FROM public.notificacoes_fila f WHERE f.idempotency_key = v_chave;
    IF NOT FOUND THEN
      v_id := public.enfileirar_notificacao('whatsapp', p_destino, NULL, p_evento, 'usuario', p_entidade_id, p_evento,
                jsonb_build_object('texto', p_texto)
                  || CASE WHEN p_mencionar IS NOT NULL THEN jsonb_build_object('mencionar', p_mencionar) ELSE '{}'::jsonb END,
                v_chave);
      IF v_id IS NULL THEN
        IF EXISTS (SELECT 1 FROM public.notificacoes_fila f WHERE f.idempotency_key = v_chave) THEN
          RETURN 'ja_na_fila';
        END IF;
        RETURN 'recusado';
      END IF;
      RETURN CASE WHEN v_k = 0 THEN 'enfileirado' ELSE 'reenfileirado' END;
    ELSIF v_status IN ('falhou', 'cancelado') THEN
      CONTINUE;
    ELSE
      RETURN 'ja_na_fila';
    END IF;
  END LOOP;
  RETURN 'esgotado';
END $f$;

REVOKE ALL ON FUNCTION public._lembrete_custos_enfileirar(text, text, text, text, jsonb, uuid) FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------
-- B2) lembrete_diario_de_custos(p_enfileirar, p_hoje)
--     p_enfileirar = false: modo seco, devolve o texto que sairia e nao grava nem enfileira nada.
--     p_hoje: so para ensaio (simular domingo ou feriado). O agendamento nao passa nada.
-- ---------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lembrete_diario_de_custos(p_enfileirar boolean DEFAULT true, p_hoje date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$
DECLARE
  c_limite constant integer := 12;
  -- TEXTO:INICIO
  c_modelo_lembrete constant text := E'{saudacao}\nPendências de custo da Bex Print, {itens}. Sem esses números o preço de venda e a margem na tabela de preços ficam errados.\n{lista}\nGestor e financeiro, preencham e confirmem os números na tela.\nPreencher e confirmar na tela de custos fixos: https://bexprint.com.br/custos-producao\nEste aviso volta todo dia útil e aos sábados, no início do dia, até a lista zerar.';
  c_modelo_fim constant text := E'{saudacao}\nAs pendências de custo da Bex Print foram todas atualizadas. O lembrete diário parou e volta sozinho se surgir pendência nova.';
  c_saudacao_grupo constant text := 'Bom dia, gerente e financeiro';
  -- TEXTO:FIM
  v_hoje date := COALESCE(p_hoje, public.hoje_br());
  v_util boolean := true;
  v_motivo text;
  v_feriado text;
  v_grupo text := public.grupo_equipe_destino();
  v_itens text[];
  v_n integer;
  v_linhas text;
  v_itens_txt text;
  v_tel text[];
  v_mencao text := '';
  v_ger uuid;
  v_ent_grupo uuid;
  v_texto_grupo text;
  v_texto_privado_exemplo text;
  v_texto text;
  v_res text;
  v_resultado jsonb := '{}'::jsonb;
  v_privados jsonb := '[]'::jsonb;
  v_n_privados integer := 0;
  v_sem_celular integer := 0;
  v_falhas text[] := ARRAY[]::text[];
  v_erro text;
  v_ult_lembrete timestamptz;
  v_ult_fim timestamptz;
  v_manda_fim boolean := false;
  v_saida jsonb;
  r record;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'Só o agendamento roda o lembrete de custos.' USING ERRCODE = '42501';
  END IF;

  -- Dia: domingo e feriado da lista do lembrete nao enviam. Sabado envia (o aviso e das 08:00).
  -- A lista e propria do lembrete e NAO le nem grava whatsapp_feriados (essa e a da triagem do WhatsApp).
  IF extract(isodow FROM v_hoje) = 7 THEN
    v_util := false; v_motivo := 'domingo';
  ELSE
    SELECT f.nome INTO v_feriado
      FROM (VALUES (DATE '2026-11-20', 'Consciência Negra'),
                   (DATE '2026-12-25', 'Natal'),
                   (DATE '2027-01-01', 'Confraternização Universal')) AS f(data, nome)
     WHERE f.data = v_hoje;
    IF v_feriado IS NOT NULL THEN
      v_util := false; v_motivo := 'feriado';
    END IF;
  END IF;

  -- Pendencias, em ordem fixa.
  -- Se a lista não pode ser montada (coluna ou visão com outro nome, produto que quebra o custo), o erro NÃO morre
  -- calado no cron: vira WARNING e linha lembrete_diario_falha em logs_auditoria, e a rodada seguinte tenta de novo.
  BEGIN
    SELECT COALESCE(array_agg(p.rotulo ORDER BY CASE p.tipo WHEN 'parametro' THEN 1 WHEN 'material' THEN 2 ELSE 3 END, p.rotulo),
                    ARRAY[]::text[])
      INTO v_itens
      FROM public.pendencias_de_custo() p;
  EXCEPTION WHEN OTHERS THEN
    v_erro := SQLERRM;
    RAISE WARNING 'lembrete de custos: não foi possível listar as pendências: %', v_erro;
    IF p_enfileirar THEN
      INSERT INTO public.logs_auditoria (usuario_id, entidade, entidade_id, acao, detalhes)
      VALUES (NULL, 'pendencias_custo', NULL, 'lembrete_diario_falha',
              jsonb_build_object('dia', v_hoje, 'enviou', false, 'motivo', 'erro ao listar pendências', 'erro', v_erro));
    END IF;
    RETURN jsonb_build_object('modo', CASE WHEN p_enfileirar THEN 'enviando' ELSE 'seco' END, 'dia', v_hoje,
                              'enviou', false, 'motivo', 'erro ao listar pendências', 'erro', v_erro);
  END;
  v_n := cardinality(v_itens);

  -- Telefones para citar no grupo: gestor e financeiro ativos (55 mais DDD e numero).
  SELECT COALESCE(array_agg(DISTINCT '55' || t.tel), ARRAY[]::text[]) INTO v_tel
    FROM (SELECT public.normalize_whatsapp_phone(u.telefone) AS tel
            FROM public.usuarios u
           WHERE u.ativo IS NOT FALSE
             AND EXISTS (SELECT 1 FROM public.user_roles ur
                          WHERE ur.user_id = u.id AND ur.role IN ('gestor'::public.app_role, 'financeiro'::public.app_role))) t
   WHERE t.tel ~ '^[0-9]{10,11}$';
  IF cardinality(v_tel) > 0 THEN
    SELECT string_agg('@' || n, ' ') INTO v_mencao FROM unnest(v_tel) n;
  END IF;

  -- Id real de um gestor (ou admin) para a linha da fila. Sem nenhum, um id fixo.
  SELECT u.id INTO v_ger
    FROM public.usuarios u JOIN public.user_roles ur ON ur.user_id = u.id
   WHERE ur.role IN ('gestor'::public.app_role, 'admin'::public.app_role) AND u.ativo IS NOT FALSE
   ORDER BY (ur.role = 'gestor'::public.app_role) DESC, u.nome
   LIMIT 1;
  v_ent_grupo := COALESCE(v_ger, md5('pendencias_custo')::uuid);

  -- Texto da lista: ate 12 linhas numeradas, o resto vira contagem.
  IF v_n > 0 THEN
    SELECT string_agg(g.n || '. ' || g.t, E'\n' ORDER BY g.n) INTO v_linhas
      FROM (SELECT i AS n, v_itens[i] AS t FROM generate_series(1, LEAST(v_n, c_limite)) i) g;
    IF v_n > c_limite THEN
      v_linhas := v_linhas || E'\nE mais ' || (v_n - c_limite) || CASE WHEN v_n - c_limite = 1 THEN ' pendência.' ELSE ' pendências.' END;
    END IF;
    v_itens_txt := CASE WHEN v_n = 1 THEN '1 item' ELSE v_n || ' itens' END;
    v_texto_grupo := replace(replace(replace(c_modelo_lembrete,
                       '{saudacao}', c_saudacao_grupo || CASE WHEN v_mencao <> '' THEN ' ' || v_mencao ELSE '' END),
                       '{itens}', v_itens_txt), '{lista}', v_linhas);
    v_texto_privado_exemplo := replace(replace(replace(c_modelo_lembrete,
                       '{saudacao}', 'Gerente, bom dia.'), '{itens}', v_itens_txt), '{lista}', v_linhas);
  END IF;

  -- Fim de ciclo: so se ja houve lembrete depois do ultimo aviso de fim.
  IF v_n = 0 THEN
    SELECT max(f.created_at) INTO v_ult_lembrete FROM public.notificacoes_fila f
     WHERE starts_with(f.idempotency_key, 'pendencias_custo:grupo:') OR starts_with(f.idempotency_key, 'pendencias_custo:privado:');
    SELECT max(f.created_at) INTO v_ult_fim FROM public.notificacoes_fila f
     WHERE starts_with(f.idempotency_key, 'pendencias_custo:fim:');
    v_manda_fim := v_ult_lembrete IS NOT NULL AND (v_ult_fim IS NULL OR v_ult_lembrete > v_ult_fim);
  END IF;

  -- Modo seco: mostra o que sairia, sem gravar nada.
  IF NOT p_enfileirar THEN
    RETURN jsonb_build_object(
      'modo', 'seco', 'dia', v_hoje, 'dia_util', v_util, 'motivo_sem_envio', v_motivo,
      'pendencias', v_n, 'lista', to_jsonb(v_itens),
      'grupo_ativo', v_grupo IS NOT NULL, 'mencionando', to_jsonb(v_tel),
      'manda_fim_de_ciclo', v_manda_fim,
      'texto_grupo', v_texto_grupo, 'texto_privado_exemplo', v_texto_privado_exemplo,
      'linhas_no_texto', LEAST(v_n, c_limite));
  END IF;

  IF NOT v_util THEN
    INSERT INTO public.logs_auditoria (usuario_id, entidade, entidade_id, acao, detalhes)
    VALUES (NULL, 'pendencias_custo', NULL, 'lembrete_diario',
            jsonb_build_object('dia', v_hoje, 'enviou', false, 'motivo', v_motivo, 'feriado', v_feriado, 'pendencias', v_n));
    RETURN jsonb_build_object('modo', 'enviando', 'dia', v_hoje, 'enviou', false, 'motivo', v_motivo, 'pendencias', v_n);
  END IF;

  IF v_n = 0 AND NOT v_manda_fim THEN
    INSERT INTO public.logs_auditoria (usuario_id, entidade, entidade_id, acao, detalhes)
    VALUES (NULL, 'pendencias_custo', NULL, 'lembrete_diario',
            jsonb_build_object('dia', v_hoje, 'enviou', false, 'motivo', 'nada pendente', 'pendencias', 0));
    RETURN jsonb_build_object('modo', 'enviando', 'dia', v_hoje, 'enviou', false, 'motivo', 'nada pendente', 'pendencias', 0);
  END IF;

  -- Grupo da equipe.
  IF v_n > 0 THEN
    v_texto := v_texto_grupo;
  ELSE
    v_texto := replace(c_modelo_fim, '{saudacao}',
                 c_saudacao_grupo || CASE WHEN v_mencao <> '' THEN ' ' || v_mencao ELSE '' END);
  END IF;
  v_res := public._lembrete_custos_enfileirar(v_grupo, 'aviso_grupo_equipe',
             CASE WHEN v_n > 0 THEN 'pendencias_custo:grupo:' ELSE 'pendencias_custo:fim:grupo:' END || v_hoje,
             v_texto, to_jsonb(v_tel), v_ent_grupo);
  v_resultado := jsonb_build_object('grupo', v_res);
  IF v_res IN ('sem_destino', 'recusado', 'esgotado') THEN
    v_falhas := v_falhas || ('grupo da equipe: ' || v_res);
  END IF;

  -- Privado: um por gestor ou admin com celular.
  FOR r IN
    SELECT DISTINCT ON (public.normalize_whatsapp_phone(u.telefone))
           u.id, split_part(btrim(u.nome), ' ', 1) AS nome, public.normalize_whatsapp_phone(u.telefone) AS tel
      FROM public.usuarios u
     WHERE u.ativo IS NOT FALSE
       AND EXISTS (SELECT 1 FROM public.user_roles ur
                    WHERE ur.user_id = u.id AND ur.role IN ('gestor'::public.app_role, 'admin'::public.app_role))
       AND public.normalize_whatsapp_phone(u.telefone) ~ '^[0-9]{10,11}$'
     ORDER BY public.normalize_whatsapp_phone(u.telefone), u.nome
  LOOP
    v_n_privados := v_n_privados + 1;
    IF v_n > 0 THEN
      v_texto := replace(replace(replace(c_modelo_lembrete,
                   '{saudacao}', r.nome || ', bom dia.'), '{itens}', v_itens_txt), '{lista}', v_linhas);
    ELSE
      v_texto := replace(c_modelo_fim, '{saudacao}', r.nome || ', bom dia.');
    END IF;
    v_res := public._lembrete_custos_enfileirar(r.tel, 'aviso_gerente_privado',
               CASE WHEN v_n > 0 THEN 'pendencias_custo:privado:' ELSE 'pendencias_custo:fim:privado:' END || r.id || ':' || v_hoje,
               v_texto, NULL, r.id);
    v_privados := v_privados || jsonb_build_object('nome', r.nome, 'resultado', v_res);
    IF v_res IN ('sem_destino', 'recusado', 'esgotado') THEN
      v_falhas := v_falhas || ('privado de ' || r.nome || ': ' || v_res);
    END IF;
  END LOOP;

  SELECT count(*) INTO v_sem_celular
    FROM public.usuarios u
   WHERE u.ativo IS NOT FALSE
     AND EXISTS (SELECT 1 FROM public.user_roles ur
                  WHERE ur.user_id = u.id AND ur.role IN ('gestor'::public.app_role, 'admin'::public.app_role))
     AND NOT COALESCE(public.normalize_whatsapp_phone(u.telefone) ~ '^[0-9]{10,11}$', false);
  IF v_n_privados = 0 THEN
    v_falhas := v_falhas || 'nenhum gestor ou admin com celular para o aviso privado';
  END IF;

  v_saida := jsonb_build_object(
    'modo', 'enviando', 'dia', v_hoje, 'enviou', true, 'fim_de_ciclo', v_n = 0, 'pendencias', v_n,
    'linhas_no_texto', LEAST(v_n, c_limite), 'grupo', v_resultado -> 'grupo', 'privados', v_privados,
    'sem_celular', v_sem_celular, 'falhas', to_jsonb(v_falhas));

  INSERT INTO public.logs_auditoria (usuario_id, entidade, entidade_id, acao, detalhes)
  VALUES (NULL, 'pendencias_custo', NULL, CASE WHEN cardinality(v_falhas) > 0 THEN 'lembrete_diario_falha' ELSE 'lembrete_diario' END, v_saida);

  IF cardinality(v_falhas) > 0 THEN
    RAISE WARNING 'lembrete de custos: %', array_to_string(v_falhas, '; ');
  END IF;

  RETURN v_saida;
END $f$;

REVOKE ALL ON FUNCTION public.lembrete_diario_de_custos(boolean, date) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lembrete_diario_de_custos(boolean, date) TO service_role;

-- ---------------------------------------------------------------------------------------------------
-- C e D) Agendamento. O banco roda em UTC: 11:00 e 13:00 sao 08:00 e 10:00 em Macapa (UTC-3).
--        O alerta de integridade passa para :20 para nao empilhar com o lembrete de custo.
-- ---------------------------------------------------------------------------------------------------
DO $cron$
DECLARE v_id bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'pendencias-de-custo') THEN
    PERFORM cron.unschedule('pendencias-de-custo');
  END IF;
  PERFORM cron.schedule('pendencias-de-custo', '0 11,13 * * 1-6', 'SELECT public.lembrete_diario_de_custos()');

  SELECT j.jobid INTO v_id FROM cron.job j WHERE j.jobname = 'integridade-orcamentos' AND j.schedule = '0 11-21 * * 1-6';
  IF v_id IS NOT NULL THEN
    PERFORM cron.alter_job(v_id, schedule => '20 11-21 * * 1-6');
  END IF;
END
$cron$;

-- ---------------------------------------------------------------------------------------------------
-- Conferencia final: a migracao para se algo nao ficou como deveria.
-- ---------------------------------------------------------------------------------------------------
DO $confere$
BEGIN
  IF has_function_privilege('anon', 'public.pendencias_de_custo()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.pendencias_de_custo()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.lembrete_diario_de_custos(boolean, date)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.lembrete_diario_de_custos(boolean, date)', 'EXECUTE')
     OR has_function_privilege('anon', 'public._lembrete_custos_enfileirar(text, text, text, text, jsonb, uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public._lembrete_custos_enfileirar(text, text, text, text, jsonb, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon ou authenticated executa função nova';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.pendencias_de_custo()', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.lembrete_diario_de_custos(boolean, date)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role sem EXECUTE';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'pendencias-de-custo' AND active AND schedule = '0 11,13 * * 1-6') THEN
    RAISE EXCEPTION 'o agendamento pendencias-de-custo não ficou ativo';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'integridade-orcamentos' AND active) THEN
    RAISE EXCEPTION 'o agendamento integridade-orcamentos não ficou ativo';
  END IF;
END
$confere$;

COMMIT;
