-- =====================================================================================================
-- CORREÇÕES DE PREÇO NO BANCO (15/11/2026)
-- ENSAIADA no banco vivo com RAISE EXCEPTION final (docs/ensaio-precos-correcoes-15-11.md). NÃO aplicada.
-- Não rodar sem autorização do dono. O preço de NENHUM produto muda aqui (produtos.preco_base fica como está).
--
-- 1) produto_custo_cheio passa a ter UMA linha por produto (eram 109 linhas para 70 produtos). A duplicata vinha de produto_precificacao, que guarda duas linhas por produto ("Composição do
--    custo" e "Preço base"). Fica a linha de MAIOR custo cheio: é o que desconto_avaliar já usava (max), então
--    a alçada de quem vende nunca cresce. meta_por_produto deixa de listar o produto duas vezes.
--    CREATE OR REPLACE VIEW descarta as opções: security_invoker e GRANTs são reaplicados.
-- 2) preco_proposta_criar(produto, preço, motivo): proposta manual, só admin ou gestor que vê custo (o mesmo
--    critério de preco_proposta_aprovar). Nunca altera preco_base. CHECK de origem ganha 'manual' (aditivo).
-- 3) AVISO (não bloqueia, não altera valor): item de orçamento cujo custo gravado difere mais de 30 por cento
--    de custo_medio do produto vezes a área cobrada. Grava uma linha em logs_auditoria e mais nada.
-- 4) orcamento_3d_calculos.preco_minimo: gatilho que grava custo operacional dividido por 0,70 quando vem 0.
--    Os 30 registros que já existem NÃO são regravados: a tabela é imutável por gatilho de propósito (gere nova
--    versão) e liberar isso só para um backfill abriria a regra. Ver docs/ensaio-precos-correcoes-15-11.md.
-- 5) tg_historico_da_pasta_do_produto passa a gravar, quando preço, custo ou margem mínima mudam: preço de e
--    para, piso antes e depois, margem antes e depois, se o custo mudou e o autor (pessoa, chave de serviço ou
--    sem sessão). O valor do custo em reais NÃO é gravado.
-- 6) Custo zero preenchido nos itens de orçamento NÃO aprovados e NÃO convertidos, pela regra do próprio
--    gatilho de custo (tg_orcamento_item_custo_do_produto, que não é alterado). Só onde custo = 0.
-- 7) ia_habilitado desligado (reversível, com rastro) nos produtos ativos sem preço válido, abaixo do piso ou
--    com proposta pendente. Nada é ligado.
-- =====================================================================================================
BEGIN;
SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------------------------------
-- 0. Troca na definição viva: confere que o corpo que vamos trocar é o que o banco tem hoje.
-- ---------------------------------------------------------------------------------------------------
DO $guarda$
DECLARE
  v_h text;
  v_cols text;
BEGIN
  SELECT md5(prosrc) INTO v_h FROM pg_proc
   WHERE pronamespace = 'public'::regnamespace AND proname = 'tg_historico_da_pasta_do_produto';
  IF v_h IS DISTINCT FROM 'da8e14c4208ca0a42d2230a448537e3c' THEN
    RAISE EXCEPTION 'tg_historico_da_pasta_do_produto mudou no banco (md5 %). Releia a definição viva antes de trocar.', v_h;
  END IF;

  SELECT string_agg(attname || ':' || format_type(atttypid, atttypmod), ',' ORDER BY attnum) INTO v_cols
    FROM pg_attribute WHERE attrelid = 'public.produto_custo_cheio'::regclass AND attnum > 0 AND NOT attisdropped;
  IF v_cols IS DISTINCT FROM 'produto_id:uuid,nome:text,tempo_producao_min:integer,preco_base:numeric,custo_medio:numeric,custo_material:numeric,custo_maquina:numeric,custo_mao_obra:numeric,custo_indireto:numeric,custo_cheio:numeric,sem_ficha_de_material:boolean,sem_hora_de_maquina:boolean,sem_mao_de_obra:boolean,sem_rateio:boolean' THEN
    RAISE EXCEPTION 'produto_custo_cheio mudou de colunas no banco: %. Releia a definição viva antes de trocar.', v_cols;
  END IF;
END $guarda$;

-- ---------------------------------------------------------------------------------------------------
-- 1) produto_custo_cheio: uma linha por produto. Mesmas colunas, mesma ordem, mesmos tipos.
--    Consumidores no banco: desconto_avaliar (agrupa e usa max) e meta_por_produto (junta direto).
--    Nenhum consumidor no código da tela (src só cita a view em comentário e em types.ts).
-- ---------------------------------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.produto_custo_cheio WITH (security_invoker = true) AS
SELECT p.id AS produto_id,
       p.nome,
       p.tempo_producao_min,
       pr.preco_base,
       pr.custo_medio,
       COALESCE(NULLIF(pp.custo_material, 0::numeric), pr.custo_medio, 0::numeric) AS custo_material,
       COALESCE(pp.custo_maquina, 0::numeric) AS custo_maquina,
       COALESCE(pp.custo_mao_obra, 0::numeric) AS custo_mao_obra,
       COALESCE(pp.custo_indireto, 0::numeric) AS custo_indireto,
       COALESCE(NULLIF(pp.custo_material, 0::numeric), pr.custo_medio, 0::numeric)
         + COALESCE(pp.custo_maquina, 0::numeric) + COALESCE(pp.custo_mao_obra, 0::numeric)
         + COALESCE(pp.custo_indireto, 0::numeric) AS custo_cheio,
       pp.produto_id IS NULL OR NULLIF(pp.custo_material, 0::numeric) IS NULL AS sem_ficha_de_material,
       COALESCE(pp.custo_maquina, 0::numeric) = 0::numeric AND NOT inteiro.servico AS sem_hora_de_maquina,
       COALESCE(pp.custo_mao_obra, 0::numeric) = 0::numeric AND NOT inteiro.servico AS sem_mao_de_obra,
       COALESCE(pp.custo_indireto, 0::numeric) = 0::numeric AND NOT inteiro.servico AS sem_rateio
  FROM public.produtos p
  JOIN public.produto_precos pr ON pr.produto_id = p.id
  -- A linha de maior custo cheio; no empate, a "Composição do custo"; depois o id, para ser estável.
  LEFT JOIN LATERAL (
    SELECT q.*
      FROM public.produto_precificacao q
     WHERE q.produto_id = p.id
     ORDER BY COALESCE(NULLIF(q.custo_material, 0::numeric), pr.custo_medio, 0::numeric)
              + COALESCE(q.custo_maquina, 0::numeric) + COALESCE(q.custo_mao_obra, 0::numeric)
              + COALESCE(q.custo_indireto, 0::numeric) DESC,
              (q.nome = 'Composição do custo') DESC,
              q.id
     LIMIT 1
  ) pp ON true
  CROSS JOIN LATERAL (
    SELECT p.tipo = 'servico'::tipo_item AND COALESCE(pr.custo_medio, 0::numeric) > 0::numeric
           AND NOT (EXISTS (SELECT 1 FROM public.produto_materiais pm WHERE pm.produto_id = p.id)) AS servico
  ) inteiro;

REVOKE ALL ON TABLE public.produto_custo_cheio FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.produto_custo_cheio TO service_role;

-- ---------------------------------------------------------------------------------------------------
-- 2) Proposta manual de preço. A tabela passa a aceitar a origem 'manual' (só acrescenta um valor).
-- ---------------------------------------------------------------------------------------------------
ALTER TABLE public.precos_propostas DROP CONSTRAINT IF EXISTS precos_propostas_origem_check;
ALTER TABLE public.precos_propostas
  ADD CONSTRAINT precos_propostas_origem_check CHECK (origem IN ('abaixo_do_piso', 'referencia_m2', 'manual'));

CREATE OR REPLACE FUNCTION public.preco_proposta_criar(p_produto_id uuid, p_preco numeric, p_motivo text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$
DECLARE
  v_uid uuid := auth.uid();
  v_prod public.produtos;
  v_preco numeric := round(p_preco, 2);
  v_motivo text := btrim(COALESCE(p_motivo, ''));
  v_id uuid;
  v_pend public.precos_propostas;
  v_piso numeric;
BEGIN
  IF v_uid IS NULL OR NOT (public.has_role(v_uid, 'admin'::public.app_role) OR public.has_role(v_uid, 'gestor'::public.app_role))
     OR NOT public.pode_ver_custo(v_uid) THEN
    RAISE EXCEPTION 'Só admin ou gestor que vê custo propõe preço.' USING ERRCODE = '42501';
  END IF;
  IF v_preco IS NULL OR v_preco <= 0 THEN
    RAISE EXCEPTION 'O preço proposto precisa ser maior que zero.' USING ERRCODE = '22023';
  END IF;
  IF length(v_motivo) < 3 THEN
    RAISE EXCEPTION 'Explique em uma frase o motivo da proposta.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_prod FROM public.produtos WHERE id = p_produto_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Produto não encontrado.' USING ERRCODE = 'P0002'; END IF;

  -- Mesma conta do piso de parceiro_precos e das propostas existentes (custo só de material).
  v_piso := public._preco_piso(v_prod.custo_medio, v_prod.margem_minima);

  INSERT INTO public.precos_propostas
    (produto_id, preco_atual, preco_proposto, custo, piso, margem_minima, margem_atual, margem_proposta, motivo, origem)
  VALUES
    (v_prod.id, COALESCE(v_prod.preco_base, 0), v_preco, v_prod.custo_medio, v_piso, v_prod.margem_minima,
     public._preco_margem(v_prod.preco_base, v_prod.custo_medio), public._preco_margem(v_preco, v_prod.custo_medio),
     left(v_motivo, 500), 'manual')
  ON CONFLICT (produto_id) WHERE status = 'pendente' DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    -- Já existe uma proposta pendente deste produto. Se for do mesmo preço, devolve a que existe.
    SELECT * INTO v_pend FROM public.precos_propostas WHERE produto_id = v_prod.id AND status = 'pendente';
    IF FOUND AND v_pend.preco_proposto = v_preco THEN
      RETURN v_pend.id;
    END IF;
    RAISE EXCEPTION 'Este produto já tem uma proposta pendente de outro preço. Decida essa antes de propor de novo.'
      USING ERRCODE = '22023';
  END IF;

  -- Rastro com preço, nunca com custo.
  INSERT INTO public.logs_auditoria (usuario_id, entidade, entidade_id, acao, detalhes)
  VALUES (v_uid, 'produtos', v_prod.id, 'preco_proposta_criada',
          jsonb_build_object('proposta_id', v_id, 'preco_de', COALESCE(v_prod.preco_base, 0), 'preco_proposto', v_preco, 'origem', 'manual'));

  RETURN v_id;
END $f$;

REVOKE ALL ON FUNCTION public.preco_proposta_criar(uuid, numeric, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.preco_proposta_criar(uuid, numeric, text) TO authenticated;

-- ---------------------------------------------------------------------------------------------------
-- 3) Aviso de custo fora da faixa. AFTER, para ler area_cobrada (coluna gerada) já calculada. Não devolve
--    linha nova, então não pode bloquear nem alterar nada. Falha ao gravar o aviso vira WARNING com o erro
--    (aparece no log do banco), nunca derruba a gravação do item.
-- ---------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_orcamento_item_aviso_custo_fora_da_faixa()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$
DECLARE
  v_custo_medio numeric;
  v_unidade text;
  v_nome text;
  v_qtd numeric;
  v_esperado numeric;
  v_gravado numeric;
  v_dif numeric;
  v_uid uuid := auth.uid();
BEGIN
  IF NEW.produto_id IS NULL OR COALESCE(NEW.custo_unitario, 0) <= 0 THEN RETURN NULL; END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.custo_unitario IS NOT DISTINCT FROM OLD.custo_unitario
     AND NEW.produto_id IS NOT DISTINCT FROM OLD.produto_id
     AND NEW.quantidade IS NOT DISTINCT FROM OLD.quantidade
     AND NEW.largura IS NOT DISTINCT FROM OLD.largura
     AND NEW.altura IS NOT DISTINCT FROM OLD.altura
     AND NEW.area_minima IS NOT DISTINCT FROM OLD.area_minima THEN
    RETURN NULL;
  END IF;

  SELECT p.custo_medio, p.unidade, p.nome INTO v_custo_medio, v_unidade, v_nome
    FROM public.produtos p WHERE p.id = NEW.produto_id;
  IF COALESCE(v_custo_medio, 0) <= 0 THEN RETURN NULL; END IF;

  v_qtd := GREATEST(COALESCE(NEW.quantidade, 1), 1);
  -- Por metro quadrado, o custo esperado é o custo do m2 vezes a área cobrada da linha; no resto, vezes a quantidade.
  v_esperado := round(v_custo_medio * CASE
    WHEN lower(btrim(COALESCE(v_unidade, ''))) IN ('m2', 'm²') AND COALESCE(NEW.area_cobrada, 0) > 0 THEN NEW.area_cobrada
    ELSE v_qtd END, 2);
  v_gravado := round(NEW.custo_unitario * v_qtd, 2);
  IF v_esperado <= 0 THEN RETURN NULL; END IF;

  v_dif := round((v_gravado - v_esperado) / v_esperado * 100, 1);
  IF abs(v_dif) <= 30 THEN RETURN NULL; END IF;

  BEGIN
    INSERT INTO public.logs_auditoria (usuario_id, entidade, entidade_id, acao, detalhes)
    VALUES ((SELECT u.id FROM public.usuarios u WHERE u.id = v_uid), 'orcamento_itens', NEW.id, 'custo_fora_da_faixa',
            jsonb_build_object('orcamento_id', NEW.orcamento_id, 'produto_id', NEW.produto_id, 'produto', v_nome,
                               'quantidade', v_qtd, 'area_cobrada', NEW.area_cobrada,
                               'custo_gravado_da_linha', v_gravado, 'custo_esperado_da_linha', v_esperado,
                               'diferenca_pct', v_dif, 'limite_pct', 30));
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'aviso de custo fora da faixa do item % não registrado: % (%)', NEW.id, SQLERRM, SQLSTATE;
  END;
  RETURN NULL;
END $f$;

REVOKE ALL ON FUNCTION public.tg_orcamento_item_aviso_custo_fora_da_faixa() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tg_orcamento_itens_zz_aviso_custo ON public.orcamento_itens;
CREATE TRIGGER tg_orcamento_itens_zz_aviso_custo
  AFTER INSERT OR UPDATE OF custo_unitario, produto_id, quantidade, largura, altura, area_minima ON public.orcamento_itens
  FOR EACH ROW EXECUTE FUNCTION public.tg_orcamento_item_aviso_custo_fora_da_faixa();

-- ---------------------------------------------------------------------------------------------------
-- 4) orcamento_3d_calculos.preco_minimo = custo operacional / 0,70 quando vem zerado. Só INSERT: a tabela é
--    imutável depois (gatilho que recusa UPDATE e DELETE), por isso o backfill dos 30 registros não é feito.
-- ---------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_orcamento_3d_calculos_piso()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $f$
BEGIN
  IF COALESCE(NEW.preco_minimo, 0) = 0 AND COALESCE(NEW.custo_operacional, 0) > 0 THEN
    NEW.preco_minimo := round(NEW.custo_operacional / 0.70, 2);
  END IF;
  RETURN NEW;
END $f$;

REVOKE ALL ON FUNCTION public.tg_orcamento_3d_calculos_piso() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tg_orcamento_3d_calculos_piso ON public.orcamento_3d_calculos;
CREATE TRIGGER tg_orcamento_3d_calculos_piso
  BEFORE INSERT ON public.orcamento_3d_calculos
  FOR EACH ROW EXECUTE FUNCTION public.tg_orcamento_3d_calculos_piso();

-- ---------------------------------------------------------------------------------------------------
-- 5) Histórico da pasta do produto com valores. Troca na definição viva (md5 conferido no começo).
--    O que já gravava continua igual; quando preço, custo ou margem mínima mudam, o detalhe ganha os
--    números do preço e o autor. Custo em reais não entra: só o piso, as margens e se o custo mudou.
--    A gravação com preço é feita SEM tratamento que engole erro: se o rastro não grava, a troca de
--    preço não passa. O resto do histórico mantém o aviso (WARNING) que já tinha.
-- ---------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_historico_da_pasta_do_produto()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_produto uuid;
  v_mudou text[] := '{}';
  v_novo jsonb;
  v_velho jsonb;
  v_c text;
  v_uid uuid := auth.uid();
  v_papel text;
  v_detalhes jsonb;
  v_com_preco boolean := false;
BEGIN
  IF TG_TABLE_NAME = 'produtos' THEN
    v_produto := NEW.id;
    FOREACH v_c IN ARRAY ARRAY['nome', 'descricao', 'unidade', 'ativo', 'preco_base', 'custo_medio', 'margem_minima',
                               'maquina_padrao_id', 'material_principal_id', 'tempo_producao_min', 'area_minima_cobrada'] LOOP
      IF to_jsonb(NEW) -> v_c IS DISTINCT FROM to_jsonb(OLD) -> v_c THEN v_mudou := v_mudou || v_c; END IF;
    END LOOP;
    IF cardinality(v_mudou) = 0 THEN RETURN NEW; END IF;

    v_detalhes := jsonb_build_object('tabela', TG_TABLE_NAME, 'campos', to_jsonb(v_mudou));

    IF v_mudou && ARRAY['preco_base', 'custo_medio', 'margem_minima'] THEN
      v_com_preco := true;
      v_papel := COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''),
                          NULLIF(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', ''), '');
      v_detalhes := v_detalhes || jsonb_build_object(
        'preco_de', OLD.preco_base,
        'preco_para', NEW.preco_base,
        'piso_antes', public._preco_piso(OLD.custo_medio, OLD.margem_minima),
        'piso_depois', public._preco_piso(NEW.custo_medio, NEW.margem_minima),
        'margem_antes', public._preco_margem(OLD.preco_base, OLD.custo_medio),
        'margem_depois', public._preco_margem(NEW.preco_base, NEW.custo_medio),
        'custo_mudou', (v_mudou @> ARRAY['custo_medio']),
        'autor_tipo', CASE WHEN v_uid IS NOT NULL THEN 'pessoa'
                           WHEN v_papel = 'service_role' THEN 'chave_de_servico'
                           ELSE 'sem_sessao' END,
        'autor_id', v_uid);
    END IF;
  ELSE
    v_novo := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END;
    v_velho := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END;
    v_produto := (coalesce(v_novo, v_velho) ->> 'produto_id')::uuid;
    IF TG_OP = 'UPDATE' THEN
      FOR v_c IN SELECT k FROM jsonb_object_keys(v_novo) k WHERE k NOT IN ('updated_at', 'created_at') LOOP
        IF v_novo -> v_c IS DISTINCT FROM v_velho -> v_c THEN v_mudou := v_mudou || v_c; END IF;
      END LOOP;
      IF cardinality(v_mudou) = 0 THEN RETURN NEW; END IF;
    END IF;
    v_detalhes := jsonb_build_object('tabela', TG_TABLE_NAME, 'campos', to_jsonb(v_mudou));
  END IF;

  IF v_com_preco THEN
    INSERT INTO public.logs_auditoria (usuario_id, entidade, entidade_id, acao, detalhes)
    VALUES ((SELECT u.id FROM public.usuarios u WHERE u.id = v_uid), 'produtos', v_produto, lower(TG_OP), v_detalhes);
  ELSE
    BEGIN
      INSERT INTO public.logs_auditoria (usuario_id, entidade, entidade_id, acao, detalhes)
      VALUES (v_uid, 'produtos', v_produto, lower(TG_OP), v_detalhes);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'histórico do produto % não registrado: %', v_produto, SQLERRM;
    END;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $function$;

REVOKE ALL ON FUNCTION public.tg_historico_da_pasta_do_produto() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------
-- 6) Custo zero preenchido, SÓ onde custo_unitario = 0, em orçamento que não é aprovado nem convertido.
--    A conta é a do gatilho tg_orcamento_item_custo_do_produto, que dispara no UPDATE abaixo (a coluna
--    é regravada com o mesmo valor 0 e o gatilho preenche). Antes e depois ficam em logs_auditoria.
--    Se o valor do item mudar por qualquer motivo, a migração inteira para.
-- ---------------------------------------------------------------------------------------------------
DO $custo_zero$
DECLARE
  v_n int;
  v_mexeu int;
  v_tocou_aprovado int;
BEGIN
  CREATE TEMP TABLE _custo_zero_antes ON COMMIT DROP AS
  SELECT i.id, i.orcamento_id, i.produto_id, o.status::text AS status_orcamento, i.valor_unitario, i.valor_total,
         i.desconto, i.custo_unitario
    FROM public.orcamento_itens i
    JOIN public.orcamentos o ON o.id = i.orcamento_id
    JOIN public.produtos p ON p.id = i.produto_id
   WHERE i.custo_unitario = 0
     AND o.status NOT IN ('aprovado', 'convertido')
     AND COALESCE(p.custo_medio, 0) > 0;

  UPDATE public.orcamento_itens i
     SET custo_unitario = i.custo_unitario
    FROM _custo_zero_antes a
   WHERE i.id = a.id AND i.custo_unitario = 0;

  SELECT count(*) INTO v_mexeu
    FROM public.orcamento_itens i JOIN _custo_zero_antes a ON a.id = i.id
   WHERE i.valor_unitario IS DISTINCT FROM a.valor_unitario OR i.valor_total IS DISTINCT FROM a.valor_total
      OR i.desconto IS DISTINCT FROM a.desconto;
  IF v_mexeu > 0 THEN
    RAISE EXCEPTION 'Preencher o custo mudou valor de % item(ns). Nada foi gravado.', v_mexeu;
  END IF;

  SELECT count(*) INTO v_tocou_aprovado FROM _custo_zero_antes WHERE status_orcamento IN ('aprovado', 'convertido');
  IF v_tocou_aprovado > 0 THEN
    RAISE EXCEPTION 'Orçamento aprovado ou convertido entrou na lista. Nada foi gravado.';
  END IF;

  INSERT INTO public.logs_auditoria (usuario_id, entidade, entidade_id, acao, detalhes)
  SELECT NULL, 'orcamento_itens', a.id, 'custo_zero_preenchido',
         jsonb_build_object('orcamento_id', a.orcamento_id, 'produto_id', a.produto_id,
                            'status_orcamento', a.status_orcamento,
                            'custo_antes', a.custo_unitario, 'custo_depois', i.custo_unitario,
                            'regra', 'tg_orcamento_item_custo_do_produto', 'migracao', '20261115190000')
    FROM _custo_zero_antes a JOIN public.orcamento_itens i ON i.id = a.id
   WHERE i.custo_unitario IS DISTINCT FROM a.custo_unitario;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE 'custo zero preenchido em % item(ns)', v_n;
END $custo_zero$;

-- ---------------------------------------------------------------------------------------------------
-- 7) ia_habilitado DESLIGADO (nunca ligado) nos produtos ativos que a IA não pode vender: sem preço válido,
--    com preço abaixo do piso ou com proposta de preço pendente. A flag vive em produto_ficha. Cada produto
--    desligado deixa uma linha 'ia_desligada_por_preco' em logs_auditoria com os motivos: é a lista para
--    religar um a um, depois que o preço for decidido:
--      UPDATE public.produto_ficha f SET ia_habilitado = true
--       WHERE f.produto_id IN (SELECT entidade_id FROM public.logs_auditoria WHERE acao = 'ia_desligada_por_preco');
-- ---------------------------------------------------------------------------------------------------
WITH alvo AS (
  SELECT p.id,
         array_remove(ARRAY[
           CASE WHEN p.preco_base IS NULL OR p.preco_base <= 0 THEN 'sem_preco_valido' END,
           CASE WHEN p.preco_base > 0 AND p.preco_base < COALESCE(public._preco_piso(p.custo_medio, p.margem_minima), 0)
                THEN 'abaixo_do_piso' END,
           CASE WHEN EXISTS (SELECT 1 FROM public.precos_propostas x WHERE x.produto_id = p.id AND x.status = 'pendente')
                THEN 'proposta_pendente' END
         ], NULL) AS motivos
    FROM public.produtos p
    JOIN public.produto_ficha f ON f.produto_id = p.id
   WHERE p.ativo AND f.ia_habilitado
),
desligados AS (
  UPDATE public.produto_ficha f
     SET ia_habilitado = false
    FROM alvo
   WHERE f.produto_id = alvo.id AND f.ia_habilitado AND cardinality(alvo.motivos) > 0
  RETURNING f.produto_id
)
INSERT INTO public.logs_auditoria (usuario_id, entidade, entidade_id, acao, detalhes)
SELECT NULL, 'produtos', d.produto_id, 'ia_desligada_por_preco',
       jsonb_build_object('ia_habilitado_antes', true, 'motivos', to_jsonb(a.motivos), 'migracao', '20261115190000')
  FROM desligados d JOIN alvo a ON a.id = d.produto_id;

COMMIT;
