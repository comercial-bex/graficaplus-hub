-- ============================================================================
-- Onda 2 — o custo verdadeiro da peça
-- ============================================================================
--
-- O sistema tinha UM número chamado custo: `produto_precos.custo_medio`. Ele é
-- material, e só. Hora de máquina, hora de gente e rateio administrativo nunca
-- entraram, embora a tabela `produto_precificacao` tivesse as quatro colunas
-- desde maio — três delas em zero nas 21 linhas.
--
-- O efeito estava na tela de meta, que ordena as peças por margem por hora:
--
--   peça                    margem anunciada    margem real
--   Fachada luminosa              98,0%            61,1%
--   Banner com bastão             86,8%            46,6%
--   Lona 440g                     73,9%            34,3%
--   Adesivo jateado               60,0%            23,9%
--
-- Quem vende olhava o ranking e empurrava justamente a peça que ocupa a
-- plotter o dia inteiro. O ranking não estava quebrado — estava certo sobre a
-- pergunta errada.
--
-- O que esta migração NÃO faz: mexer em `custo_medio`. Ele é lido por 17
-- funções e 9 telas, e `ponto_de_equilibrio` o usa como custo VARIÁVEL para a
-- margem de contribuição. Material é variável; máquina e folha são fixos e já
-- estão no custo fixo do mês. Somar os quatro lá contaria a mesma hora duas
-- vezes e a meta pediria faturamento a mais. São duas contas diferentes, cada
-- uma com a sua base — é por isso que o número novo mora ao lado, não por cima.
--
-- Este arquivo é retrato do banco vivo: tudo abaixo já foi aplicado e ensaiado
-- com reversão antes de ser escrito aqui.

-- ---------------------------------------------------------------- 1. a conta
-- `custo_cheio_do_produto` monta a composição e diz o que falta para ela estar
-- inteira. Devolve `faltas` em vez de completar com zero, porque zero numa
-- fatia de custo é indistinguível de "de graça" na tela.
--
-- Sobre o encargo: a conta usa `custos_mao_de_obra.encargos_pct` e NÃO o
-- parâmetro geral `custos_tabela.mo_encargos_pct` (hoje em 80%). Puxar o
-- parâmetro por cima de um encargo zerado seria inventar custo que o cadastro
-- não afirma. O que ela faz é dizer, em `faltas`, que a mão de obra está sendo
-- contada sem FGTS, 13º, férias e rescisão.
CREATE OR REPLACE FUNCTION public.custo_cheio_do_produto(p_produto_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  p RECORD;
  v_maquina_nome text; v_maquina_custo numeric; v_setor text;
  v_funcao text; v_mo_hora numeric; v_mo_encargos numeric;
  v_material numeric := 0; v_sem_custo int := 0;
  v_horas numeric := 0; v_maquina numeric := 0; v_mao numeric := 0; v_indireto numeric := 0;
  v_admin_hora numeric := 0;
  v_faltas text[] := ARRAY[]::text[];
BEGIN
  SELECT pr.id AS id, pr.nome AS nome, pr.tempo_producao_min AS tempo_producao_min,
         pr.maquina_padrao_id AS maquina_padrao_id, pp.preco_base AS preco_base
    INTO p
  FROM public.produtos pr
  LEFT JOIN public.produto_precos pp ON pp.produto_id = pr.id
  WHERE pr.id = p_produto_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Produto não encontrado' USING ERRCODE = 'P0002'; END IF;

  -- 1. material, da receita — a mesma conta de recalcular_custo_produto
  SELECT COALESCE(sum(pm.quantidade_por_unidade * COALESCE(mt.custo_medio, mt.custo_unitario, 0)), 0),
         count(*) FILTER (WHERE COALESCE(mt.custo_medio, mt.custo_unitario, 0) <= 0)
    INTO v_material, v_sem_custo
  FROM public.produto_materiais pm
  JOIN public.materiais mt ON mt.id = pm.material_id
  WHERE pm.produto_id = p_produto_id;

  IF NOT EXISTS (SELECT 1 FROM public.produto_materiais WHERE produto_id = p_produto_id) THEN
    v_faltas := array_append(v_faltas, 'sem ficha de material');
  ELSIF v_sem_custo > 0 THEN
    v_faltas := array_append(v_faltas, v_sem_custo || ' material(is) sem custo de compra');
  END IF;

  -- 2. tempo: é o que transforma hora de máquina e de gente em dinheiro
  v_horas := COALESCE(p.tempo_producao_min, 0) / 60.0;
  IF v_horas <= 0 THEN v_faltas := array_append(v_faltas, 'sem tempo de produção'); END IF;

  -- 3. máquina
  IF p.maquina_padrao_id IS NULL THEN
    v_faltas := array_append(v_faltas, 'sem máquina padrão');
  ELSE
    SELECT mq.nome, mq.custo_hora, mq.setor
      INTO v_maquina_nome, v_maquina_custo, v_setor
    FROM public.maquinas mq WHERE mq.id = p.maquina_padrao_id;
    IF COALESCE(v_maquina_custo, 0) <= 0 THEN
      v_faltas := array_append(v_faltas, 'máquina ' || COALESCE(v_maquina_nome, '?') || ' sem custo por hora');
    ELSE
      v_maquina := v_horas * v_maquina_custo;
    END IF;
  END IF;

  -- 4. mão de obra: a função do setor da máquina; sem setor, a mais cara ativa.
  SELECT cm.funcao, cm.custo_hora, COALESCE(cm.encargos_pct, 0)
    INTO v_funcao, v_mo_hora, v_mo_encargos
  FROM public.custos_mao_de_obra cm
  WHERE cm.ativo
  ORDER BY (cm.setor IS NOT DISTINCT FROM v_setor) DESC, cm.custo_hora DESC
  LIMIT 1;

  IF COALESCE(v_mo_hora, 0) <= 0 THEN
    v_faltas := array_append(v_faltas, 'sem custo de mão de obra cadastrado');
  ELSE
    -- `encargos_pct` é FRAÇÃO (0,8 = 80%), como a tela grava e o motor de custo
    -- consome. O parâmetro `custos_tabela.mo_encargos_pct`, esse sim, está em
    -- pontos percentuais — são campos diferentes e não se misturam.
    v_mao := v_horas * v_mo_hora * (1 + v_mo_encargos);
    -- Encargo zerado NÃO é zero: é FGTS, 13º, férias e rescisão que saem do
    -- caixa e não estão na conta. Com o Simples são ~32% a mais; fora dele,
    -- ~60%. Dizer isso aqui é o que impede a composição de parecer completa
    -- com a mão de obra pela metade.
    IF v_mo_encargos <= 0 THEN
      v_faltas := array_append(v_faltas,
        'mão de obra sem encargos: a função ' || v_funcao || ' está com 0%');
    END IF;
  END IF;

  -- 5. rateio administrativo por hora produtiva
  SELECT COALESCE(max(valor), 0) INTO v_admin_hora
  FROM public.custos_tabela WHERE ativo AND codigo = 'custo_admin_hora';
  v_indireto := v_horas * v_admin_hora;

  RETURN jsonb_build_object(
    'produto_id', p.id, 'nome', p.nome, 'preco_base', p.preco_base,
    'minutos', COALESCE(p.tempo_producao_min, 0), 'horas', round(v_horas, 4),
    'custo_material', round(v_material, 4),
    'custo_maquina', round(v_maquina, 4),
    'custo_mao_obra', round(v_mao, 4),
    'custo_indireto', round(v_indireto, 4),
    'custo_total', round(v_material + v_maquina + v_mao + v_indireto, 4),
    'maquina', v_maquina_nome, 'funcao', v_funcao,
    'completo', (array_length(v_faltas, 1) IS NULL),
    'faltas', to_jsonb(v_faltas)
  );
END $function$;

REVOKE ALL ON FUNCTION public.custo_cheio_do_produto(uuid) FROM PUBLIC, anon, authenticated;


-- -------------------------------------------------------- 2. guardar a conta
-- `produto_precificacao` tinha as quatro colunas e vinha preenchida só com o
-- material. Agora guarda a composição inteira.
CREATE OR REPLACE FUNCTION public.sincronizar_precificacao_do_produto(p_produto_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE c jsonb;
BEGIN
  c := public.custo_cheio_do_produto(p_produto_id);

  UPDATE public.produto_precificacao
     SET custo_material = (c->>'custo_material')::numeric,
         custo_maquina  = (c->>'custo_maquina')::numeric,
         custo_mao_obra = (c->>'custo_mao_obra')::numeric,
         custo_indireto = (c->>'custo_indireto')::numeric,
         updated_at = now()
   WHERE produto_id = p_produto_id;

  IF NOT FOUND THEN
    INSERT INTO public.produto_precificacao
      (produto_id, nome, custo_material, custo_maquina, custo_mao_obra, custo_indireto)
    VALUES (p_produto_id, 'Composição do custo',
            (c->>'custo_material')::numeric, (c->>'custo_maquina')::numeric,
            (c->>'custo_mao_obra')::numeric, (c->>'custo_indireto')::numeric);
  END IF;
END $function$;

REVOKE ALL ON FUNCTION public.sincronizar_precificacao_do_produto(uuid) FROM PUBLIC, anon, authenticated;


-- ------------------------------------------- 3. manter a conta em dia sozinha
-- A composição é feita de parâmetros que vivem em cinco tabelas. Guardar o
-- resultado sem recompor quando o parâmetro muda é fabricar número velho com
-- cara de medido — o mesmo defeito que esta onda veio consertar, um andar
-- acima.
--
-- Todos os gatilhos abaixo são ACESSÓRIOS: recompor o custo não pode derrubar
-- o cadastro do produto, a edição da receita nem a entrada de estoque. Por
-- isso engolem o erro — mas com RAISE WARNING, nunca em silêncio.
CREATE OR REPLACE FUNCTION public.tg_produto_recalcula_composicao()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_produto uuid;
BEGIN
  v_produto := CASE TG_TABLE_NAME
                 WHEN 'produtos' THEN COALESCE(NEW.id, OLD.id)
                 ELSE COALESCE(NEW.produto_id, OLD.produto_id) END;
  IF v_produto IS NULL THEN RETURN NULL; END IF;

  BEGIN
    PERFORM public.sincronizar_precificacao_do_produto(v_produto);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Não deu para recompor o custo do produto %: %', v_produto, SQLERRM;
  END;
  RETURN NULL;
END $function$;

REVOKE ALL ON FUNCTION public.tg_produto_recalcula_composicao() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tg_produto_composicao ON public.produtos;
CREATE TRIGGER tg_produto_composicao
  AFTER INSERT OR UPDATE OF tempo_producao_min, maquina_padrao_id ON public.produtos
  FOR EACH ROW EXECUTE FUNCTION public.tg_produto_recalcula_composicao();

DROP TRIGGER IF EXISTS tg_receita_composicao ON public.produto_materiais;
CREATE TRIGGER tg_receita_composicao
  AFTER INSERT OR UPDATE OR DELETE ON public.produto_materiais
  FOR EACH ROW EXECUTE FUNCTION public.tg_produto_recalcula_composicao();

-- Parâmetro da casa muda o custo de todo mundo de uma vez. Statement-level:
-- mexer nas cinco funções recompõe uma vez, não cinco.
CREATE OR REPLACE FUNCTION public.tg_parametro_recompoe_custos()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.produtos LOOP
    BEGIN
      PERFORM public.sincronizar_precificacao_do_produto(r.id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Não deu para recompor o custo do produto %: %', r.id, SQLERRM;
    END;
  END LOOP;
  RETURN NULL;
END $function$;

REVOKE ALL ON FUNCTION public.tg_parametro_recompoe_custos() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tg_maquina_recompoe_custos ON public.maquinas;
CREATE TRIGGER tg_maquina_recompoe_custos
  AFTER INSERT OR UPDATE OF custo_hora OR DELETE ON public.maquinas
  FOR EACH STATEMENT EXECUTE FUNCTION public.tg_parametro_recompoe_custos();

DROP TRIGGER IF EXISTS tg_mao_de_obra_recompoe_custos ON public.custos_mao_de_obra;
CREATE TRIGGER tg_mao_de_obra_recompoe_custos
  AFTER INSERT OR UPDATE OR DELETE ON public.custos_mao_de_obra
  FOR EACH STATEMENT EXECUTE FUNCTION public.tg_parametro_recompoe_custos();

DROP TRIGGER IF EXISTS tg_custos_tabela_recompoe_custos ON public.custos_tabela;
CREATE TRIGGER tg_custos_tabela_recompoe_custos
  AFTER INSERT OR UPDATE OR DELETE ON public.custos_tabela
  FOR EACH STATEMENT EXECUTE FUNCTION public.tg_parametro_recompoe_custos();

-- Material é diferente: `custo_medio` muda a cada entrada de estoque, e aí só
-- interessam os produtos cuja ficha usa AQUELE material.
CREATE OR REPLACE FUNCTION public.tg_material_recompoe_custos()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE r record;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.custo_medio IS NOT DISTINCT FROM OLD.custo_medio
     AND NEW.custo_unitario IS NOT DISTINCT FROM OLD.custo_unitario THEN
    RETURN NULL;
  END IF;

  FOR r IN SELECT DISTINCT produto_id FROM public.produto_materiais
            WHERE material_id = COALESCE(NEW.id, OLD.id) LOOP
    BEGIN
      PERFORM public.sincronizar_precificacao_do_produto(r.produto_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Não deu para recompor o custo do produto %: %', r.produto_id, SQLERRM;
    END;
  END LOOP;
  RETURN NULL;
END $function$;

REVOKE ALL ON FUNCTION public.tg_material_recompoe_custos() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tg_material_recompoe_custos ON public.materiais;
CREATE TRIGGER tg_material_recompoe_custos
  AFTER UPDATE OF custo_medio, custo_unitario ON public.materiais
  FOR EACH ROW EXECUTE FUNCTION public.tg_material_recompoe_custos();

-- Primeira carga. Daqui em diante os gatilhos mantêm.
DO $seed$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.produtos LOOP
    PERFORM public.sincronizar_precificacao_do_produto(r.id);
  END LOOP;
END $seed$;


-- ------------------------------------------------------ 4. a régua da leitura
-- A view aplica a regra de fallback num lugar só, para não ficar espalhada por
-- cada consumidor.
CREATE OR REPLACE VIEW public.produto_custo_cheio AS
SELECT
  p.id AS produto_id,
  p.nome,
  p.tempo_producao_min,
  pr.preco_base,
  pr.custo_medio,
  -- Material: a receita manda quando existe. Quando não existe, `custo_medio`
  -- é a única estimativa que alguém já afirmou — usar zero ali faria o produto
  -- SEM ficha parecer o mais lucrativo da casa, que é o inverso da verdade.
  -- (Panfleto A5 e Cartão de visita não têm receita e têm custo_medio de
  -- R$ 92 e R$ 78 digitados na mão.)
  COALESCE(NULLIF(pp.custo_material, 0), pr.custo_medio, 0) AS custo_material,
  COALESCE(pp.custo_maquina, 0)  AS custo_maquina,
  COALESCE(pp.custo_mao_obra, 0) AS custo_mao_obra,
  COALESCE(pp.custo_indireto, 0) AS custo_indireto,
  COALESCE(NULLIF(pp.custo_material, 0), pr.custo_medio, 0)
    + COALESCE(pp.custo_maquina, 0)
    + COALESCE(pp.custo_mao_obra, 0)
    + COALESCE(pp.custo_indireto, 0) AS custo_cheio,
  -- O que ainda falta para a composição ser inteira. A tela precisa disto para
  -- não apresentar como medida o que ainda é estimativa.
  (pp.produto_id IS NULL OR NULLIF(pp.custo_material, 0) IS NULL) AS sem_ficha_de_material,
  (COALESCE(pp.custo_maquina, 0) = 0)  AS sem_hora_de_maquina,
  (COALESCE(pp.custo_mao_obra, 0) = 0) AS sem_mao_de_obra,
  (COALESCE(pp.custo_indireto, 0) = 0) AS sem_rateio
FROM public.produtos p
JOIN public.produto_precos pr ON pr.produto_id = p.id
LEFT JOIN public.produto_precificacao pp ON pp.produto_id = p.id;

-- Sem `security_invoker` e sem GRANT: só as funções DEFINER leem. É custo, e
-- custo não sai por view.
REVOKE ALL ON public.produto_custo_cheio FROM PUBLIC, anon, authenticated;

COMMENT ON VIEW public.produto_custo_cheio IS
  'Custo cheio da peça: material (receita, ou custo_medio quando não há ficha) + hora de máquina + mão de obra + rateio. Sem GRANT: é custo, só DEFINER lê.';


-- ------------------------------------------------- 5. o ranking muda de base
-- `meta_por_produto` ordenava por (preço − material) ÷ hora. Agora ordena pelo
-- custo cheio, manda a composição para o financeiro e — para quem só vê preço —
-- continua mandando apenas a FAIXA (em que terço do ranking a peça está).
--
-- A regra do vazamento continua valendo e ganhou cinco chaves novas para
-- apagar: margem em reais ao lado de preço e tempo entrega o custo por
-- subtração exata.
CREATE OR REPLACE FUNCTION public.meta_por_produto(p_mes date DEFAULT (date_trunc('month'::text, (CURRENT_DATE)::timestamp with time zone))::date)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_ini date := date_trunc('month', COALESCE(p_mes, CURRENT_DATE))::date;
  v_fim date := (v_ini + INTERVAL '1 month')::date;
  v_ver_custo boolean := public.can_see_financials(auth.uid());
  v_linhas jsonb;
  v_sem_encargo int := 0;
BEGIN
  IF NOT public.can_see_prices(auth.uid()) THEN
    RAISE EXCEPTION 'Preço de venda não é do seu perfil.' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(
           CASE WHEN v_ver_custo THEN to_jsonb(x)
                ELSE to_jsonb(x) - 'margem_hora' - 'margem_pct' - 'custo_medio'
                                 - 'custo_cheio' - 'custo_material' - 'custo_maquina'
                                 - 'custo_mao_obra' - 'custo_indireto' END
           ORDER BY x.ordem), '[]'::jsonb) INTO v_linhas
  FROM (
    SELECT p.id AS produto_id, p.nome, p.categoria, p.unidade, p.tempo_producao_min, c.preco_base,
           CASE WHEN p.tempo_producao_min > 0 AND c.custo_cheio > 0
                THEN round((c.preco_base - c.custo_cheio) * 60.0 / p.tempo_producao_min, 2) END AS margem_hora,
           CASE WHEN v_ver_custo THEN c.custo_medio END AS custo_medio,
           CASE WHEN v_ver_custo THEN round(c.custo_cheio, 2) END AS custo_cheio,
           CASE WHEN v_ver_custo THEN round(c.custo_material, 2) END AS custo_material,
           CASE WHEN v_ver_custo THEN round(c.custo_maquina, 2) END AS custo_maquina,
           CASE WHEN v_ver_custo THEN round(c.custo_mao_obra, 2) END AS custo_mao_obra,
           CASE WHEN v_ver_custo THEN round(c.custo_indireto, 2) END AS custo_indireto,
           CASE WHEN c.preco_base > 0 AND c.custo_cheio > 0
                THEN round(100 * (c.preco_base - c.custo_cheio) / c.preco_base, 1) END AS margem_pct,
           -- faixa do ranking: 1 = rende mais, 2 = no meio, 3 = rende menos.
           -- Sai para todo mundo com preço; não permite reconstruir o custo.
           CASE WHEN p.tempo_producao_min > 0 AND c.custo_cheio > 0
                THEN ntile(3) OVER (
                       PARTITION BY (p.tempo_producao_min > 0 AND c.custo_cheio > 0)
                       ORDER BY (c.preco_base - c.custo_cheio) * 60.0 / p.tempo_producao_min DESC)
                END AS faixa,
           row_number() OVER (ORDER BY
             CASE WHEN p.tempo_producao_min > 0 AND c.custo_cheio > 0
                  THEN (c.preco_base - c.custo_cheio) * 60.0 / p.tempo_producao_min END DESC NULLS LAST) AS ordem,
           COALESCE((SELECT sum(ic.valor_total) FROM public.itens_os i
                       JOIN public.item_os_custos ic ON ic.item_os_id = i.id
                       JOIN public.ordens_servico o ON o.id = i.os_id
                      WHERE i.produto_id = p.id AND o.status <> 'cancelado'
                        AND o.created_at >= v_ini AND o.created_at < v_fim), 0) AS vendido_no_mes,
           (p.tempo_producao_min IS NULL OR p.tempo_producao_min = 0) AS sem_tempo,
           (c.custo_cheio IS NULL OR c.custo_cheio = 0) AS sem_custo,
           p.maquina_padrao_id IS NOT NULL AS tem_maquina,
           -- O custo está INTEIRO? Sai para todo mundo: é o aviso de que a
           -- margem ao lado ainda é otimista, e não revela valor nenhum.
           (c.sem_ficha_de_material OR c.sem_hora_de_maquina
            OR c.sem_mao_de_obra OR c.sem_rateio) AS custo_parcial,
           c.sem_ficha_de_material, c.sem_hora_de_maquina, c.sem_mao_de_obra, c.sem_rateio
    FROM public.produtos p
    JOIN public.produto_custo_cheio c ON c.produto_id = p.id
    WHERE p.ativo AND c.preco_base > 0
  ) x;

  -- O encargo zerado não aparece produto a produto: ele é da CASA e atinge
  -- todos de uma vez. A mão de obra de cada linha acima está menor do que sai
  -- do bolso enquanto FGTS, 13º, férias e rescisão estiverem em 0%.
  IF v_ver_custo THEN
    SELECT count(*) INTO v_sem_encargo
    FROM public.custos_mao_de_obra
    WHERE ativo AND COALESCE(encargos_pct, 0) <= 0;
  END IF;

  RETURN jsonb_build_object('mes', v_ini, 'ver_custo', v_ver_custo,
                            'funcoes_sem_encargo', v_sem_encargo, 'produtos', v_linhas);
END $function$;


-- ----------------------------------------- 6. fechar a porta que se abriu com
-- A tabela guardava só `preco_base` e o material, e a policy de leitura era
-- `is_staff` — impressor, designer e VENDEDOR. No instante em que a composição
-- do custo entrou aqui, bastava um GET em /rest/v1/produto_precificacao para
-- ler exatamente o número que `meta_por_produto` apaga linha a linha. O nível
-- comercial inteiro cairia por uma tabela que ninguém no front consulta.
--
-- Ensaiado por perfil: financeiro 31 linhas, vendedor 0, operacional 0,
-- anônimo permission denied.
DROP POLICY IF EXISTS "prod prec staff read" ON public.produto_precificacao;
CREATE POLICY "prod prec financeiro read" ON public.produto_precificacao
  FOR SELECT TO authenticated
  USING (public.can_see_financials((SELECT auth.uid())));

-- `anon` tinha INSERT/UPDATE/DELETE/TRUNCATE aqui. Sem policy para `anon` o
-- RLS já barrava, mas privilégio concedido a quem não tem login é rede de uma
-- camada só: basta uma policy futura com `true` e a tabela abre para a
-- internet.
REVOKE ALL ON public.produto_precificacao FROM anon;
