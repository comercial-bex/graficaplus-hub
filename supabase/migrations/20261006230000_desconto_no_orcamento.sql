-- ============================================================================
-- Desconto no orçamento: o vendedor digita, o banco confere
-- ============================================================================
--
-- POR QUÊ (06/10/2026): o dono decidiu "campo de desconto no orçamento: manter
-- e melhorar se possível com tooltips". A tela não tinha campo nenhum. O banco
-- tinha três colunas de desconto (orcamentos.desconto_percentual,
-- orcamento_itens.desconto, ordens_servico.desconto), uma permissão
-- `desconto.approve` que nenhuma regra lia, e uma trava de 10% na OS que
-- contradizia a régua da barra de composição do preço.
--
-- A RÉGUA (a mesma de src/domain/orcamentos/composicao-do-preco.ts)
--   piso    = custo ÷ (1 − taxa)              onde o lucro zera
--   mínimo  = custo ÷ (1 − margem − taxa)     a margem mínima da casa
--   Até o mínimo, quem vende decide sozinho. Abaixo do mínimo — e abaixo do
--   piso — só quem tem `desconto.approve` (gestor e admin hoje) aplica.
--   taxa   = imposto + metade do cartão, a média da casa (a mesma conta de
--            `ponto_de_equilibrio`).
--   margem = `produtos.margem_minima` do item; item sem produto, 30% (o padrão
--            da barra).
--   custo  = por item, na ordem: custo da linha calculado pelo sistema
--            (`custo_previsto`: motor de custo ou catálogo de fornecedor);
--            custo cheio do produto (`produto_custo_cheio`) × m² cobrados ou
--            quantidade; custo digitado (`custo_unitario`) × quantidade.
--            O custo_unitario de item de catálogo NÃO entra antes do custo
--            cheio: a tela grava ali o custo por m² do produto como se fosse
--            por peça (placa de 0,15 m² saía com o custo de 1 m²).
--   Sem custo conhecido em algum item com valor, o sistema não sabe onde fica
--   o mínimo: vale o limite que a casa já usava na OS, 10% do subtotal.
--
-- O QUE MUDA
--   1. `orcamentos` ganha o desconto como foi digitado (modo + número), o
--      valor em reais e a aprovação (quem, quando, para qual subtotal e valor).
--   2. O gatilho de totais (`tg_parceiro_credito_no_total`, nome histórico)
--      passa a calcular tudo: subtotal = soma dos itens; total = subtotal −
--      desconto − crédito do parceiro, em centavos; e é a GUARDA — vale para a
--      tela, para a API e para qualquer outra porta.
--   3. A conversão em OS recusa desconto que passou da alçada sem aprovação e
--      leva para a OS o total que o cliente paga, com o desconto ao lado.
--   4. `ordens_servico.valor_total` passa a ser sempre o que o cliente paga.
--      Antes o gatilho dos itens regravava a soma BRUTA por cima do total da
--      conversão, enquanto a conta a receber nascia com o LÍQUIDO: o status
--      financeiro nunca chegaria a "pago", a comissão e o cashback nunca
--      sairiam, e o PDF da OS mostrava o bruto sem desconto. `fechar_os` e
--      `vw_resultado_os`, que subtraíam o desconto do total, acompanham.
--   5. A trava `desconto_alto` de `os_bloqueios_para` sai: os 10% fixos
--      contradiziam a régua (vendedor dentro da alçada travaria a produção) e
--      barrariam todo pedido de parceiro com crédito; a aprovação, que era
--      lida de `aprovacoes` — onde quem tem `orcamentos.create` grava o que
--      quiser, inclusive o id de um gestor —, agora mora no orçamento e só o
--      gatilho escreve. A conferência foi para a conversão, que é antes.
--   6. A via de produção da OS passa a ler a especificação dos itens:
--      `itens_os.especificacoes` ganha SELECT (não é dinheiro).
--
-- ORDEM DE APLICAÇÃO: banco primeiro, tela depois. A tela de hoje continua
-- funcionando com este banco (ela grava subtotal = total = soma dos itens e o
-- gatilho refaz a conta). A tela nova chama funções que só existem aqui.
--
-- Ensaiado inteiro em transação revertida (DO ... RAISE EXCEPTION) com
-- vendedor, gestor, admin, financeiro e operador; ver o relatório do PR.

-- ------------------------------------------------------------- 1. colunas
ALTER TABLE public.orcamentos
  ADD COLUMN IF NOT EXISTS desconto_modo text NOT NULL DEFAULT 'valor',
  ADD COLUMN IF NOT EXISTS desconto_informado numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS desconto_valor numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS desconto_aprovado_por uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS desconto_aprovado_em timestamptz,
  ADD COLUMN IF NOT EXISTS desconto_aprovado_subtotal numeric(12,2),
  ADD COLUMN IF NOT EXISTS desconto_aprovado_valor numeric(12,2);

ALTER TABLE public.orcamentos DROP CONSTRAINT IF EXISTS orcamentos_desconto_modo_valido;
ALTER TABLE public.orcamentos ADD CONSTRAINT orcamentos_desconto_modo_valido
  CHECK (desconto_modo IN ('valor', 'percentual'));
ALTER TABLE public.orcamentos DROP CONSTRAINT IF EXISTS orcamentos_desconto_informado_valido;
ALTER TABLE public.orcamentos ADD CONSTRAINT orcamentos_desconto_informado_valido
  CHECK (desconto_informado >= 0 AND (desconto_modo <> 'percentual' OR desconto_informado <= 100));
ALTER TABLE public.orcamentos DROP CONSTRAINT IF EXISTS orcamentos_desconto_valor_valido;
ALTER TABLE public.orcamentos ADD CONSTRAINT orcamentos_desconto_valor_valido
  CHECK (desconto_valor >= 0);

COMMENT ON COLUMN public.orcamentos.desconto_modo IS
  'Como o desconto foi digitado: valor (R$ fixo) ou percentual (acompanha o subtotal quando os itens mudam).';
COMMENT ON COLUMN public.orcamentos.desconto_informado IS
  'O número digitado: reais no modo valor, pontos percentuais no modo percentual. Gravar por definir_desconto_do_orcamento.';
COMMENT ON COLUMN public.orcamentos.desconto_valor IS
  'Desconto comercial em reais, calculado pelo gatilho de totais. valor_total = valor_subtotal − desconto_valor − crédito do parceiro.';
COMMENT ON COLUMN public.orcamentos.desconto_aprovado_por IS
  'Quem aprovou o desconto acima da alçada de quem vende (desconto.approve). Só o gatilho escreve; valor mandado pela API é ignorado.';
COMMENT ON COLUMN public.orcamentos.desconto_aprovado_subtotal IS
  'Subtotal no momento da aprovação. A aprovação vale enquanto o subtotal for este e o desconto não passar de desconto_aprovado_valor.';

-- Nenhuma destas ganha SELECT para a equipe: desconto é preço. A tela lê pela
-- função desconto_do_orcamento, que confere quem vê preço e quem vê custo.

-- ----------------------------------------------- 2. as contas, sem permissão
-- Valor do desconto em reais. Percentual incide sobre o subtotal; nunca passa
-- do que sobra depois do crédito do parceiro (o total não fica negativo).
CREATE OR REPLACE FUNCTION public.desconto_em_reais(
  p_subtotal numeric, p_credito numeric, p_modo text, p_informado numeric
) RETURNS numeric
LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $fn$
  SELECT LEAST(
    GREATEST(CASE WHEN p_modo = 'percentual'
                  THEN round(GREATEST(COALESCE(p_subtotal, 0), 0) * COALESCE(p_informado, 0) / 100, 2)
                  ELSE round(COALESCE(p_informado, 0), 2) END, 0),
    GREATEST(COALESCE(p_subtotal, 0) - GREATEST(COALESCE(p_credito, 0), 0), 0)
  )
$fn$;

-- O que está errado no que foi digitado, ou NULL. O gatilho transforma em erro;
-- a simulação da tela devolve como texto enquanto a pessoa digita. As frases
-- chegam à tela como estão: `mensagemErro` (src/lib/erros.ts) só deixa passar
-- texto que reconhece como português (com acento) — sem acento, vira "Não foi
-- possível concluir a operação". O espelho em TS é src/domain/orcamentos/desconto.ts.
CREATE OR REPLACE FUNCTION public.desconto_erro_de_entrada(
  p_subtotal numeric, p_credito numeric, p_modo text, p_informado numeric
) RETURNS text
LANGUAGE plpgsql STABLE SET search_path TO 'public'
AS $fn$
DECLARE
  v_base numeric := GREATEST(COALESCE(p_subtotal, 0) - GREATEST(COALESCE(p_credito, 0), 0), 0);
BEGIN
  IF p_modo IS NULL OR p_modo NOT IN ('valor', 'percentual') THEN
    RETURN 'Escolha se o desconto é em R$ ou em %.';
  END IF;
  IF COALESCE(p_informado, 0) < 0 THEN
    RETURN 'O desconto não pode ser negativo.';
  END IF;
  IF COALESCE(p_informado, 0) = 0 THEN
    RETURN NULL;
  END IF;
  IF COALESCE(p_subtotal, 0) <= 0 THEN
    RETURN 'Adicione os itens antes do desconto: sem subtotal não há do que descontar.';
  END IF;
  IF p_modo = 'percentual' AND p_informado > 100 THEN
    RETURN 'O desconto não passa de 100%.';
  END IF;
  IF p_modo = 'valor' AND round(p_informado, 2) > v_base THEN
    RETURN 'O desconto de R$ ' || replace(to_char(round(p_informado, 2), 'FM999999990.00'), '.', ',')
        || ' passa do valor do orçamento (R$ ' || replace(to_char(v_base, 'FM999999990.00'), '.', ',') || ').';
  END IF;
  RETURN NULL;
END
$fn$;

-- A régua: custo, mínimo, piso e de quem é a decisão para um desconto dado.
-- Recebe subtotal, desconto e crédito em vez de ler o orçamento porque o
-- gatilho avalia a linha NOVA, antes de gravar.
CREATE OR REPLACE FUNCTION public.desconto_avaliar(
  p_orcamento_id uuid, p_subtotal numeric, p_desconto numeric, p_credito numeric
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_sub numeric := GREATEST(COALESCE(p_subtotal, 0), 0);
  v_desc numeric := GREATEST(COALESCE(p_desconto, 0), 0);
  v_cred numeric := GREATEST(COALESCE(p_credito, 0), 0);
  v_taxa numeric;
  v_custo numeric := 0;
  v_minimo numeric := 0;
  v_piso numeric := 0;
  v_itens_com_custo integer := 0;
  v_sem_custo integer := 0;
  v_so_material integer := 0;
  v_impossivel integer := 0;
  v_total numeric;
  v_regra text;
  v_alcada text;
  v_max_vendedor numeric;
  v_ate_piso numeric;
  v_c numeric;
  v_m numeric;
  r record;
BEGIN
  SELECT (COALESCE(max(ct.valor) FILTER (WHERE ct.codigo = 'impostos_venda'), 0)
        + COALESCE(max(ct.valor) FILTER (WHERE ct.codigo = 'taxa_cartao'), 0) / 2) / 100
    INTO v_taxa
    FROM public.custos_tabela ct
   WHERE ct.ativo;
  v_taxa := LEAST(GREATEST(COALESCE(v_taxa, 0), 0), 0.99);

  -- `produto_custo_cheio` repete o produto quando `produto_precificacao` tem
  -- mais de uma linha dele (há 10 assim, uma com custos diferentes). Fica o
  -- MAIOR: na dúvida, a alçada de quem vende encolhe, nunca cresce.
  FOR r IN
    SELECT i.valor_total, i.quantidade, i.custo_unitario, i.custo_previsto, i.area_cobrada,
           p.unidade AS unidade_do_produto, p.margem_minima, cc.custo_cheio, cc.so_material
      FROM public.orcamento_itens i
      LEFT JOIN public.produtos p ON p.id = i.produto_id
      LEFT JOIN (
        SELECT pcc.produto_id,
               max(pcc.custo_cheio) AS custo_cheio,
               bool_and(pcc.sem_hora_de_maquina AND pcc.sem_mao_de_obra) AS so_material
          FROM public.produto_custo_cheio pcc
         GROUP BY pcc.produto_id
      ) cc ON cc.produto_id = i.produto_id
     WHERE i.orcamento_id = p_orcamento_id
  LOOP
    v_c := NULL;
    IF COALESCE(r.custo_previsto, 0) > 0 THEN
      v_c := r.custo_previsto;
    ELSIF COALESCE(r.custo_cheio, 0) > 0 THEN
      v_c := r.custo_cheio * CASE
        WHEN lower(btrim(COALESCE(r.unidade_do_produto, ''))) IN ('m2', 'm²') AND COALESCE(r.area_cobrada, 0) > 0
          THEN r.area_cobrada
        ELSE GREATEST(COALESCE(r.quantidade, 1), 1) END;
      IF COALESCE(r.so_material, false) THEN v_so_material := v_so_material + 1; END IF;
    ELSIF COALESCE(r.custo_unitario, 0) > 0 THEN
      v_c := r.custo_unitario * GREATEST(COALESCE(r.quantidade, 1), 1);
    END IF;

    IF v_c IS NULL THEN
      -- Linha de valor zero sem custo (cortesia, observação) não muda a conta.
      IF COALESCE(r.valor_total, 0) > 0 THEN v_sem_custo := v_sem_custo + 1; END IF;
      CONTINUE;
    END IF;

    v_itens_com_custo := v_itens_com_custo + 1;
    v_m := COALESCE(NULLIF(r.margem_minima, 0), 30) / 100.0;
    v_custo := v_custo + v_c;
    v_piso := v_piso + v_c / (1 - v_taxa);
    IF 1 - v_m - v_taxa <= 0.0001 THEN
      -- margem + taxa ≥ 100%: não existe preço que entregue essa margem
      v_impossivel := v_impossivel + 1;
    ELSE
      v_minimo := v_minimo + v_c / (1 - v_m - v_taxa);
    END IF;
  END LOOP;

  v_custo := round(v_custo, 2);
  v_minimo := round(v_minimo, 2);
  v_piso := round(v_piso, 2);
  v_regra := CASE WHEN v_sem_custo = 0 AND v_itens_com_custo > 0 THEN 'margem' ELSE 'limite_fixo' END;
  v_total := GREATEST(round(v_sub - LEAST(v_desc, v_sub) - v_cred, 2), 0);

  IF v_desc <= 0 THEN
    v_alcada := 'sem_desconto';
  ELSIF v_regra = 'margem' THEN
    IF v_total < v_piso THEN
      v_alcada := 'abaixo_do_piso';
    ELSIF v_impossivel > 0 OR v_total < v_minimo THEN
      v_alcada := 'gerente';
    ELSE
      v_alcada := 'vendedor';
    END IF;
  ELSIF v_desc * 100 > v_sub * 10 THEN
    v_alcada := 'gerente';
  ELSE
    v_alcada := 'vendedor';
  END IF;

  IF v_regra = 'margem' THEN
    v_max_vendedor := CASE WHEN v_impossivel > 0 THEN 0
                           ELSE LEAST(GREATEST(round(v_sub - v_cred - v_minimo, 2), 0), v_sub) END;
    v_ate_piso := LEAST(GREATEST(round(v_sub - v_cred - v_piso, 2), 0), v_sub);
  ELSE
    -- 10% do subtotal, arredondado para BAIXO no centavo: o limite é "até 10%".
    v_max_vendedor := round(floor(v_sub * 10) / 100, 2);
    v_ate_piso := NULL;
  END IF;

  RETURN jsonb_build_object(
    'regra', v_regra,
    'alcada', v_alcada,
    'limite_fixo_pct', 10,
    'taxa', round(v_taxa, 4),
    'custo', CASE WHEN v_regra = 'margem' THEN v_custo END,
    'minimo', CASE WHEN v_regra = 'margem' AND v_impossivel = 0 THEN v_minimo END,
    'piso', CASE WHEN v_regra = 'margem' THEN v_piso END,
    'desconto_max_vendedor', v_max_vendedor,
    'desconto_ate_piso', v_ate_piso,
    'itens_sem_custo', v_sem_custo,
    'itens_so_material', v_so_material,
    'margem_impossivel', v_impossivel > 0
  );
END
$fn$;

COMMENT ON FUNCTION public.desconto_avaliar(uuid, numeric, numeric, numeric) IS
  'Régua do desconto (custo, mínimo, piso, alçada). Interna: devolve custo e mínimo, que são custo disfarçado — sem GRANT para a equipe. A tela usa desconto_do_orcamento.';

-- ---------------------------------------- 3. o gatilho de totais e a guarda
-- O nome é histórico: nasceu para abater o crédito do parceiro. Agora faz a
-- conta inteira do cabeçalho e confere o desconto, e por isso é DEFINER —
-- precisa ler o custo, que quem vende não lê.
CREATE OR REPLACE FUNCTION public.tg_parceiro_credito_no_total()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_n_itens integer;
  v_soma numeric;
  v_sub numeric;
  v_credito numeric := GREATEST(COALESCE((NEW.condicao_pagamento->>'credito_parceiro')::numeric, 0), 0);
  v_credito_antes numeric := 0;
  v_desconto_antes numeric := 0;
  v_desc numeric;
  v_decisao boolean;
  v_erro text;
  v_avaliacao jsonb;
  v_alcada text;
  v_coberto boolean;
BEGIN
  -- Aprovação só este gatilho escreve: o que vier pela API é ignorado. Sem
  -- isto, quem tem UPDATE na tabela gravaria o id de um gestor e "aprovaria".
  IF TG_OP = 'UPDATE' THEN
    NEW.desconto_aprovado_por := OLD.desconto_aprovado_por;
    NEW.desconto_aprovado_em := OLD.desconto_aprovado_em;
    NEW.desconto_aprovado_subtotal := OLD.desconto_aprovado_subtotal;
    NEW.desconto_aprovado_valor := OLD.desconto_aprovado_valor;
    v_credito_antes := GREATEST(COALESCE((OLD.condicao_pagamento->>'credito_parceiro')::numeric, 0), 0);
    v_desconto_antes := COALESCE(OLD.desconto_valor, 0);
  ELSE
    NEW.desconto_aprovado_por := NULL;
    NEW.desconto_aprovado_em := NULL;
    NEW.desconto_aprovado_subtotal := NULL;
    NEW.desconto_aprovado_valor := NULL;
  END IF;

  NEW.desconto_modo := COALESCE(NEW.desconto_modo, 'valor');
  NEW.desconto_informado := COALESCE(NEW.desconto_informado, 0);

  -- Subtotal é a soma dos itens. O que a tela (ou a API) manda no campo não
  -- conta quando há itens: foi assim que o orçamento nº 1 ficou com R$ 121,15
  -- no cabeçalho e nenhum item. Sem itens (o valor potencial do lead
  -- convertido, o espelho do orçamento 3D), vale o que foi gravado.
  SELECT count(*), COALESCE(sum(i.valor_total), 0) INTO v_n_itens, v_soma
    FROM public.orcamento_itens i WHERE i.orcamento_id = NEW.id;
  IF v_n_itens > 0 THEN
    NEW.valor_subtotal := v_soma;
  END IF;
  v_sub := GREATEST(COALESCE(NEW.valor_subtotal, 0), 0);

  -- Decidir o desconto é mudar o que foi digitado, ou reafirmar pela função
  -- definir_desconto_do_orcamento (é assim que o gestor aprova o que ficou
  -- pendente sem redigitar).
  IF TG_OP = 'INSERT' THEN
    v_decisao := NEW.desconto_informado <> 0;
  ELSE
    v_decisao := NEW.desconto_modo IS DISTINCT FROM OLD.desconto_modo
              OR NEW.desconto_informado IS DISTINCT FROM OLD.desconto_informado;
  END IF;
  v_decisao := v_decisao OR COALESCE(current_setting('app.desconto_decisao', true), '') = 'on';

  IF v_decisao THEN
    IF TG_OP = 'UPDATE' AND OLD.os_id IS NOT NULL THEN
      RAISE EXCEPTION 'Este orçamento já virou OS: o desconto fica como foi vendido.'
        USING ERRCODE = '22023';
    END IF;
    v_erro := public.desconto_erro_de_entrada(v_sub, v_credito, NEW.desconto_modo, NEW.desconto_informado);
    IF v_erro IS NOT NULL THEN
      RAISE EXCEPTION '%', v_erro USING ERRCODE = '22023';
    END IF;
  END IF;

  v_desc := public.desconto_em_reais(v_sub, v_credito, NEW.desconto_modo, NEW.desconto_informado);
  NEW.desconto_valor := v_desc;

  -- total = subtotal − desconto − crédito, em centavos, nunca negativo.
  IF v_n_itens > 0 OR v_desc > 0 OR v_credito > 0 OR v_credito_antes > 0 OR v_desconto_antes > 0 THEN
    NEW.valor_total := GREATEST(round(v_sub - v_desc - v_credito, 2), 0);
    NEW.desconto_percentual := CASE WHEN v_sub > 0
                                    THEN round((v_sub - NEW.valor_total) / v_sub * 100, 2)
                                    ELSE 0 END;
  ELSE
    NEW.desconto_percentual := 0;
  END IF;

  IF v_decisao THEN
    IF v_desc <= 0 THEN
      NEW.desconto_aprovado_por := NULL;
      NEW.desconto_aprovado_em := NULL;
      NEW.desconto_aprovado_subtotal := NULL;
      NEW.desconto_aprovado_valor := NULL;
    ELSE
      v_avaliacao := public.desconto_avaliar(NEW.id, v_sub, v_desc, v_credito);
      v_alcada := v_avaliacao->>'alcada';
      IF v_alcada IN ('gerente', 'abaixo_do_piso') THEN
        -- A mesma conta de desconto_situacao_interna: aprovação para ESTE
        -- subtotal e um desconto até o valor aprovado.
        v_coberto := NEW.desconto_aprovado_por IS NOT NULL
                 AND NEW.desconto_aprovado_subtotal = v_sub
                 AND v_desc <= NEW.desconto_aprovado_valor;
        IF v_uid IS NOT NULL AND public.has_permission(v_uid, 'desconto.approve') THEN
          NEW.desconto_aprovado_por := v_uid;
          NEW.desconto_aprovado_em := now();
          NEW.desconto_aprovado_subtotal := v_sub;
          NEW.desconto_aprovado_valor := v_desc;
        ELSIF v_coberto OR v_uid IS NULL THEN
          -- Baixar um desconto já aprovado é sempre permitido. Sem sessão
          -- (manutenção direto no banco) grava, mas fica pendente: aprovar
          -- continua sendo de uma pessoa com a permissão.
          NULL;
        ELSIF v_avaliacao->>'regra' = 'limite_fixo' THEN
          RAISE EXCEPTION 'Desconto acima de 10%% com item sem custo cadastrado passa da sua alçada. Só quem tem a permissão "Aprovar desconto" aplica.'
            USING ERRCODE = '42501';
        ELSIF v_alcada = 'abaixo_do_piso' AND public.can_see_financials(v_uid) THEN
          -- Piso só para quem vê custo: dizer "abaixo do piso" a quem não vê
          -- deixaria achar o piso por tentativa — e piso × (1 − taxa) é o custo.
          RAISE EXCEPTION 'Com esse desconto o orçamento fica abaixo do piso: o lucro some e cada peça sai do bolso da gráfica. Só quem tem a permissão "Aprovar desconto" aplica.'
            USING ERRCODE = '42501';
        ELSE
          RAISE EXCEPTION 'Desconto acima da sua alçada: com ele o orçamento fica abaixo da margem mínima da casa. Só quem tem a permissão "Aprovar desconto" aplica.'
            USING ERRCODE = '42501';
        END IF;
      ELSE
        -- Dentro da alçada de quem vende: não há o que aprovar.
        NEW.desconto_aprovado_por := NULL;
        NEW.desconto_aprovado_em := NULL;
        NEW.desconto_aprovado_subtotal := NULL;
        NEW.desconto_aprovado_valor := NULL;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END
$fn$;

-- O gatilho em si não muda: continua BEFORE INSERT OR UPDATE em orcamentos
-- (criado em 20260917100000), agora apontando para o corpo novo.

-- --------------------------------------------- 4. o subtotal segue os itens
-- Antes este gatilho gravava a soma no TOTAL, por cima do desconto e do
-- crédito. Agora só cutuca a linha: o gatilho de totais refaz a conta toda.
CREATE OR REPLACE FUNCTION public.tg_orcamento_soma_os_itens()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_orc uuid;
BEGIN
  v_orc := COALESCE(NEW.orcamento_id, OLD.orcamento_id);
  IF v_orc IS NULL THEN RETURN NULL; END IF;

  -- O total do cabecalho era escrito SO pela tela, em JavaScript. Quem grava
  -- item por outro caminho — importacao, editor do parceiro, API — deixava o
  -- cabecalho parado, e `converter_orcamento_em_os` le o CABECALHO. Aqui o
  -- subtotal acompanha a soma; total, desconto e credito saem do gatilho de
  -- totais (tg_parceiro_credito_no_total), que roda neste UPDATE.
  UPDATE public.orcamentos o
     SET valor_subtotal = COALESCE((SELECT sum(i.valor_total) FROM public.orcamento_itens i
                                     WHERE i.orcamento_id = v_orc), 0),
         updated_at = now()
   WHERE o.id = v_orc;
  RETURN NULL;
END $fn$;

-- ----------------------------------------------- 5. a situação, para a tela
CREATE OR REPLACE FUNCTION public.desconto_situacao_interna(
  p_orcamento_id uuid, p_modo text DEFAULT NULL, p_informado numeric DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  o public.orcamentos%ROWTYPE;
  v_simulado boolean := p_modo IS NOT NULL;
  v_modo text;
  v_informado numeric;
  v_sub numeric;
  v_credito numeric;
  v_n_itens integer;
  v_soma numeric;
  v_desc numeric;
  v_total numeric;
  v_erro text;
  v_av jsonb;
  v_aprovacao_valida boolean;
  v_pendente boolean;
  v_nome text;
BEGIN
  SELECT * INTO o FROM public.orcamentos WHERE id = p_orcamento_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orçamento não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  SELECT count(*), COALESCE(sum(i.valor_total), 0) INTO v_n_itens, v_soma
    FROM public.orcamento_itens i WHERE i.orcamento_id = p_orcamento_id;
  v_sub := GREATEST(CASE WHEN v_n_itens > 0 THEN v_soma ELSE COALESCE(o.valor_subtotal, 0) END, 0);
  v_credito := GREATEST(COALESCE((o.condicao_pagamento->>'credito_parceiro')::numeric, 0), 0);

  v_modo := CASE WHEN v_simulado THEN p_modo ELSE o.desconto_modo END;
  v_informado := CASE WHEN v_simulado THEN round(COALESCE(p_informado, 0), 2) ELSE o.desconto_informado END;
  v_erro := CASE WHEN v_simulado THEN public.desconto_erro_de_entrada(v_sub, v_credito, v_modo, v_informado) END;
  v_desc := CASE WHEN v_erro IS NULL THEN public.desconto_em_reais(v_sub, v_credito, v_modo, v_informado) ELSE 0 END;
  v_total := CASE WHEN v_simulado OR v_n_itens > 0 OR v_desc > 0 OR v_credito > 0
                  THEN GREATEST(round(v_sub - v_desc - v_credito, 2), 0)
                  ELSE COALESCE(o.valor_total, 0) END;

  v_av := public.desconto_avaliar(p_orcamento_id, v_sub, v_desc, v_credito);

  -- A mesma conta do gatilho (v_coberto): a aprovação vale para o subtotal
  -- daquele momento e até o valor aprovado.
  v_aprovacao_valida := o.desconto_aprovado_por IS NOT NULL
                    AND o.desconto_aprovado_subtotal = v_sub
                    AND v_desc <= o.desconto_aprovado_valor;
  v_pendente := v_desc > 0 AND (v_av->>'alcada') IN ('gerente', 'abaixo_do_piso') AND NOT v_aprovacao_valida;

  IF o.desconto_aprovado_por IS NOT NULL THEN
    SELECT u.nome INTO v_nome FROM public.usuarios u WHERE u.id = o.desconto_aprovado_por;
  END IF;

  RETURN v_av || jsonb_build_object(
    'orcamento_id', o.id,
    'simulado', v_simulado,
    'erro', v_erro,
    'modo', v_modo,
    'informado', v_informado,
    'subtotal', v_sub,
    'credito_parceiro', v_credito,
    'desconto', v_desc,
    'desconto_pct', CASE WHEN v_sub > 0 THEN round(v_desc / v_sub * 100, 2) ELSE 0 END,
    'total', v_total,
    'fechado', o.os_id IS NOT NULL,
    'aprovacao', CASE WHEN o.desconto_aprovado_por IS NULL THEN NULL ELSE jsonb_build_object(
                   'por', o.desconto_aprovado_por, 'nome', v_nome, 'em', o.desconto_aprovado_em,
                   'subtotal', o.desconto_aprovado_subtotal, 'valor', o.desconto_aprovado_valor) END,
    'aprovacao_valida', v_aprovacao_valida,
    'pendente', v_pendente
  );
END
$fn$;

-- O que a tela recebe. Quem vê preço vê o desconto e de quem é a decisão;
-- custo, mínimo e piso só para quem vê o financeiro — margem e mínimo são custo
-- disfarçado (custo = mínimo × (1 − margem − taxa)). No limite fixo os 10% não
-- vêm do custo, então todo mundo vê.
CREATE OR REPLACE FUNCTION public.desconto_do_orcamento(
  p_orcamento_id uuid, p_modo text DEFAULT NULL, p_valor numeric DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_s jsonb;
  v_pode_aprovar boolean;
  v_pode_editar boolean;
BEGIN
  IF v_uid IS NULL OR NOT public.is_staff(v_uid) OR NOT public.can_see_prices(v_uid) THEN
    RAISE EXCEPTION 'Desconto é preço: seu perfil não vê valores do orçamento.' USING ERRCODE = '42501';
  END IF;

  v_s := public.desconto_situacao_interna(p_orcamento_id, p_modo, p_valor);
  v_pode_aprovar := public.has_permission(v_uid, 'desconto.approve');
  -- A policy de UPDATE de orcamentos pede orcamentos.create.
  v_pode_editar := public.has_permission(v_uid, 'orcamentos.create') AND NOT (v_s->>'fechado')::boolean;

  v_s := v_s || jsonb_build_object(
    'pode_aprovar', v_pode_aprovar,
    'pode_editar', v_pode_editar,
    -- o que aconteceria ao gravar este desconto
    'pode_aplicar', v_pode_editar AND (v_s->>'erro') IS NULL AND (
      (v_s->>'alcada') IN ('sem_desconto', 'vendedor') OR v_pode_aprovar
      OR (v_s->>'aprovacao_valida')::boolean)
  );

  IF NOT public.can_see_financials(v_uid) THEN
    v_s := v_s - 'custo' - 'minimo' - 'piso' - 'desconto_ate_piso' - 'itens_so_material' - 'taxa';
    IF v_s->>'regra' = 'margem' THEN
      v_s := v_s - 'desconto_max_vendedor';
    END IF;
    -- "Abaixo do piso" é "abaixo do custo": para quem não vê custo, a decisão
    -- é só "do gerente". Separar os dois deixaria achar o piso por tentativa.
    IF v_s->>'alcada' = 'abaixo_do_piso' THEN
      v_s := jsonb_set(v_s, '{alcada}', to_jsonb('gerente'::text));
    END IF;
  END IF;
  RETURN v_s;
END
$fn$;

COMMENT ON FUNCTION public.desconto_do_orcamento(uuid, text, numeric) IS
  'Situação do desconto do orçamento para a tela (com p_modo/p_valor: simulação do que foi digitado). Exige is_staff e can_see_prices; custo, mínimo e piso só com can_see_financials.';

-- Gravar o desconto. SECURITY INVOKER de propósito: a policy de UPDATE da
-- tabela vale para quem chama, e a guarda de verdade é o gatilho de totais.
CREATE OR REPLACE FUNCTION public.definir_desconto_do_orcamento(
  p_orcamento_id uuid, p_modo text, p_valor numeric
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'public'
AS $fn$
DECLARE v_n integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Entre no sistema para mexer no desconto do orçamento.' USING ERRCODE = '42501';
  END IF;
  IF p_modo IS NULL OR p_modo NOT IN ('valor', 'percentual') THEN
    RAISE EXCEPTION 'Escolha se o desconto é em R$ ou em %%.' USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('app.desconto_decisao', 'on', true);
  UPDATE public.orcamentos
     SET desconto_modo = p_modo,
         desconto_informado = round(COALESCE(p_valor, 0), 2)
   WHERE id = p_orcamento_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  PERFORM set_config('app.desconto_decisao', '', true);

  -- Escrita barrada pela RLS devolve zero linhas e nenhum erro.
  IF v_n = 0 THEN
    RAISE EXCEPTION 'Seu perfil não pode alterar este orçamento.' USING ERRCODE = '42501';
  END IF;
  RETURN public.desconto_do_orcamento(p_orcamento_id);
END
$fn$;

COMMENT ON FUNCTION public.definir_desconto_do_orcamento(uuid, text, numeric) IS
  'Grava o desconto (modo valor|percentual). Chamada de novo com os mesmos números por quem tem desconto.approve, aprova o que ficou pendente. A guarda é tg_parceiro_credito_no_total.';

-- ------------------------------------------------------- 6. virar OS
-- Igual à versão viva até o INSERT da OS; o que muda:
--   a) a linha é cutucada antes de ler, para o gatilho de totais refazer a
--      conta com os itens de agora;
--   b) desconto pendente de aprovação não vira OS;
--   c) depois dos itens, a OS fica com o total que o cliente paga (o do
--      orçamento) e o desconto que leva até ele.
CREATE OR REPLACE FUNCTION public.converter_orcamento_em_os(p_orcamento_id uuid, p_opcoes jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid UUID;
  v_orc public.orcamentos%ROWTYPE;
  v_os_id UUID;
  v_conta_id UUID;
  v_parcelas INT;
  v_intervalo INT;
  v_primeiro DATE;
  v_valor_parcela NUMERIC;
  v_acumulado NUMERIC := 0;
  v_i INT;
  v_cliente_criado BOOLEAN := false;
  v_previstos INT := 0;
  v_reserva JSONB := '{}'::jsonb;
  v_custo_materiais NUMERIC := 0;
  v_agenda JSONB := '{}'::jsonb;
  v_desconto JSONB;
  v_soma_itens NUMERIC;
  v_desconto_os NUMERIC := 0;
BEGIN
  v_uid := public.require_permission('orcamentos.convert');

  SELECT * INTO v_orc FROM public.orcamentos WHERE id = p_orcamento_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Orçamento não encontrado'; END IF;

  IF v_orc.os_id IS NOT NULL THEN
    RETURN jsonb_build_object('orcamento_id', p_orcamento_id, 'os_id', v_orc.os_id, 'idempotent', true);
  END IF;

  IF v_orc.versao_aprovada_id IS NULL AND v_orc.status::text <> 'aprovado' THEN
    RAISE EXCEPTION 'Orçamento sem versão aprovada';
  END IF;

  -- (a) o gatilho de totais refaz subtotal, desconto e total sobre os itens de agora
  UPDATE public.orcamentos SET updated_at = now() WHERE id = p_orcamento_id;
  SELECT * INTO v_orc FROM public.orcamentos WHERE id = p_orcamento_id;

  -- (b) desconto que passou da alçada precisa de aprovação válida
  v_desconto := public.desconto_situacao_interna(p_orcamento_id);
  IF (v_desconto->>'pendente')::boolean THEN
    RAISE EXCEPTION 'O desconto deste orçamento passou da alçada de quem vende e não tem aprovação para os valores de agora. Quem tem a permissão "Aprovar desconto" aprova no quadro Desconto do orçamento; depois converta.'
      USING ERRCODE = '42501';
  END IF;

  IF v_orc.cliente_id IS NULL THEN
    PERFORM public.vincular_cliente_do_contato(p_orcamento_id);
    SELECT * INTO v_orc FROM public.orcamentos WHERE id = p_orcamento_id;
    v_cliente_criado := true;
  END IF;

  INSERT INTO public.ordens_servico(
    cliente_id, orcamento_id, vendedor_id, titulo, briefing, observacoes,
    prazo_entrega, valor_total, custo_previsto, desconto, created_by, status_geral,
    endereco_entrega, condicao_pagamento, precisa_entrega, precisa_instalacao,
    responsavel_id
  )
  VALUES (
    v_orc.cliente_id, p_orcamento_id, v_orc.vendedor_id, v_orc.titulo, v_orc.briefing,
    v_orc.observacoes, v_orc.prazo, v_orc.valor_total, v_orc.custo_estimado,
    GREATEST(0, COALESCE(v_orc.valor_subtotal, 0) - COALESCE(v_orc.valor_total, 0)),
    v_uid, 'entrada',
    v_orc.endereco_entrega, v_orc.condicao_pagamento,
    COALESCE(v_orc.precisa_entrega, false), COALESCE(v_orc.precisa_instalacao, false),
    COALESCE(v_orc.vendedor_id, v_uid)
  )
  RETURNING id INTO v_os_id;

  INSERT INTO public.itens_os(
    os_id, orcamento_item_id, produto_id, descricao, quantidade, unidade,
    valor_unitario, custo_unitario, ordem, produto_snapshot, parametros,
    largura, altura, acabamento, preco_m2, arquivo_id
  )
  SELECT
    v_os_id, id, produto_id, descricao, quantidade, unidade,
    valor_unitario, custo_unitario, ordem, produto_snapshot, parametros,
    largura, altura, acabamento, preco_m2, arquivo_id
  FROM public.orcamento_itens
  WHERE orcamento_id = p_orcamento_id
  ORDER BY ordem;

  -- (c) A OS guarda o que o cliente paga (o total do orçamento, com desconto e
  -- crédito) e, ao lado, o desconto que leva da soma dos itens da OS até ele.
  -- O gatilho dos itens (tg_os_soma_os_itens) mantém total = itens − desconto
  -- daqui em diante. Orçamento sem itens fica como a versão anterior fazia.
  IF EXISTS (SELECT 1 FROM public.itens_os WHERE os_id = v_os_id) THEN
    SELECT COALESCE(sum(valor_total), 0) INTO v_soma_itens FROM public.itens_os WHERE os_id = v_os_id;
    v_desconto_os := GREATEST(v_soma_itens - COALESCE(v_orc.valor_total, 0), 0);
    UPDATE public.ordens_servico
       SET desconto = v_desconto_os,
           valor_total = GREATEST(v_soma_itens - v_desconto_os, 0)
     WHERE id = v_os_id;
  END IF;

  UPDATE public.orcamentos SET os_id = v_os_id WHERE id = p_orcamento_id;

  -- Previsão de materiais + reserva do estoque real.
  -- Nunca derruba a conversão: se o estoque estiver inconsistente, a OS nasce
  -- mesmo assim e a falta é informada de volta para a tela.
  BEGIN
    v_previstos := public.gerar_materiais_previstos_os(v_os_id);
    v_reserva := public.reservar_materiais_os_interno(v_os_id, v_uid);
  EXCEPTION WHEN OTHERS THEN
    v_reserva := jsonb_build_object('erro', SQLERRM);
  END;

  -- Quantos materiais a OS TEM previstos, não quantos esta chamada inseriu.
  -- O gatilho de item já explode a receita na inserção, então a chamada a
  -- gerar_materiais_previstos_os logo acima encontra tudo pronto e devolve 0 —
  -- e a tela anunciava "0 materiais previstos" com a previsão inteira feita.
  SELECT count(*)::int, COALESCE(SUM(quantidade * COALESCE(custo_unitario_previsto, 0)), 0)
    INTO v_previstos, v_custo_materiais
    FROM public.os_materiais_previstos WHERE os_id = v_os_id;

  UPDATE public.ordens_servico
     SET custo_previsto = GREATEST(COALESCE(v_orc.custo_estimado, 0), v_custo_materiais)
   WHERE id = v_os_id;

  INSERT INTO public.contas_receber(cliente_id, orcamento_id, os_id, valor_total)
  VALUES (v_orc.cliente_id, p_orcamento_id, v_os_id, v_orc.valor_total)
  RETURNING id INTO v_conta_id;

  v_parcelas  := GREATEST(1, COALESCE((v_orc.condicao_pagamento->>'parcelas')::int, 1));
  v_intervalo := GREATEST(0, COALESCE((v_orc.condicao_pagamento->>'intervalo_dias')::int, 30));
  v_primeiro  := COALESCE((v_orc.condicao_pagamento->>'primeiro_vencimento')::date, CURRENT_DATE);

  v_valor_parcela := round(COALESCE(v_orc.valor_total, 0) / v_parcelas, 2);
  FOR v_i IN 1..v_parcelas LOOP
    INSERT INTO public.parcelas_receber(conta_id, parcela, valor, vencimento)
    VALUES (
      v_conta_id, v_i,
      CASE WHEN v_i < v_parcelas THEN v_valor_parcela
           ELSE COALESCE(v_orc.valor_total, 0) - v_acumulado END,
      v_primeiro + ((v_i - 1) * v_intervalo)
    );
    v_acumulado := v_acumulado + v_valor_parcela;
  END LOOP;

  -- A OS nasce com a máquina reservada: é o passo que faltava entre vender
  -- e produzir. Acessório de propósito — se o agendamento falhar, a OS
  -- continua de pé e o motivo volta no retorno em vez de sumir.
  BEGIN
    v_agenda := public.agendar_os_interno(v_os_id);
  EXCEPTION WHEN OTHERS THEN
    v_agenda := jsonb_build_object('erro', SQLERRM);
    RAISE WARNING 'Não deu para agendar a OS % na máquina: %', v_os_id, SQLERRM;
  END;

  INSERT INTO public.eventos_negocio(
    entidade, entidade_id, os_id, cliente_id, tipo, titulo, dados_posteriores, usuario_id
  )
  VALUES (
    'orcamento', p_orcamento_id, v_os_id, v_orc.cliente_id, 'orcamento_convertido_os',
    'Orçamento convertido em OS',
    jsonb_build_object('os_id', v_os_id, 'conta_id', v_conta_id, 'parcelas', v_parcelas,
                       'cliente_criado_do_contato', v_cliente_criado,
                       'materiais_previstos', v_previstos, 'reserva', v_reserva, 'agenda', v_agenda,
                       'desconto', v_desconto_os,
                       'desconto_aprovado_por', v_orc.desconto_aprovado_por),
    v_uid
  );

  RETURN jsonb_build_object(
    'orcamento_id', p_orcamento_id, 'os_id', v_os_id, 'conta_id', v_conta_id,
    'parcelas', v_parcelas, 'cliente_id', v_orc.cliente_id,
    'cliente_criado_do_contato', v_cliente_criado,
    'materiais_previstos', v_previstos,
    'custo_materiais_previsto', v_custo_materiais,
    'reserva', v_reserva,
    'agenda', v_agenda,
    'desconto', v_desconto_os
  );
END;
$function$;

-- ------------------------------------- 7. a OS guarda o que o cliente paga
CREATE OR REPLACE FUNCTION public.tg_os_soma_os_itens()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_os uuid; v_soma numeric;
BEGIN
  v_os := COALESCE(NEW.os_id, OLD.os_id);
  IF v_os IS NULL THEN RETURN NULL; END IF;
  SELECT COALESCE(sum(i.valor_total), 0) INTO v_soma FROM public.itens_os i WHERE i.os_id = v_os;
  -- valor_total = itens − desconto: o que o cliente paga, o mesmo número da
  -- conta a receber. Gravar a soma bruta deixava o status financeiro sem
  -- nunca chegar a "pago" quando havia desconto.
  UPDATE public.ordens_servico o
     SET valor_total = GREATEST(v_soma - COALESCE(o.desconto, 0), 0), updated_at = now()
   WHERE o.id = v_os
     AND o.valor_total IS DISTINCT FROM GREATEST(v_soma - COALESCE(o.desconto, 0), 0);
  RETURN NULL;
END $fn$;

-- fechar_os: a receita é o total (que já é líquido). Igual à versão viva fora a
-- linha da receita.
CREATE OR REPLACE FUNCTION public.fechar_os(os_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid; v_result jsonb; v_cliente uuid; v_bloqueios jsonb := '[]'::jsonb;
        v_receita numeric; v_pago numeric; v_veredito text;
BEGIN
  v_uid := public.require_permission('os.close');
  -- valor_total já é o que o cliente paga (total = itens − desconto, desde a
  -- migração 20261006230000); subtrair o desconto de novo contaria duas vezes.
  SELECT o.cliente_id, COALESCE(o.valor_total,0)
    INTO v_cliente, v_receita
  FROM public.ordens_servico o WHERE o.id = fechar_os.os_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OS não encontrada'; END IF;

  IF EXISTS (SELECT 1 FROM public.os_tarefas t WHERE t.os_id = fechar_os.os_id
               AND t.obrigatoria AND t.status NOT IN ('concluida','cancelada'))
  THEN v_bloqueios := v_bloqueios || '"tarefas_obrigatorias"'::jsonb; END IF;

  v_veredito := public.veredito_qualidade_os(fechar_os.os_id);

  IF EXISTS (SELECT 1 FROM public.itens_os i WHERE i.os_id = fechar_os.os_id AND i.requer_qualidade)
     AND COALESCE(v_veredito,'') NOT IN ('aprovado','aprovado_com_ressalva')
  THEN v_bloqueios := v_bloqueios || '"qualidade_aprovada"'::jsonb; END IF;

  IF v_veredito IN ('reprovado','retrabalho')
  THEN v_bloqueios := v_bloqueios || '"qualidade_reprovada_ou_retrabalho"'::jsonb; END IF;

  IF EXISTS (SELECT 1 FROM public.os_materiais_previstos mp WHERE mp.os_id = fechar_os.os_id)
     AND NOT EXISTS (SELECT 1 FROM public.movimentacoes_estoque me
                     WHERE me.os_id = fechar_os.os_id AND me.tipo='saida' AND me.origem='baixa_os')
  THEN v_bloqueios := v_bloqueios || '"materiais_baixados"'::jsonb; END IF;

  IF EXISTS (SELECT 1 FROM public.ocorrencias oc WHERE oc.os_id = fechar_os.os_id
               AND COALESCE(oc.status,'aberta') NOT IN ('tratada','fechada','cancelada'))
  THEN v_bloqueios := v_bloqueios || '"ocorrencias_tratadas"'::jsonb; END IF;

  IF EXISTS (SELECT 1 FROM public.entregas_instalacoes ei WHERE ei.os_id = fechar_os.os_id
               AND ei.status NOT IN ('concluida','cancelada','nao_necessaria'))
  THEN v_bloqueios := v_bloqueios || '"logistica_concluida"'::jsonb; END IF;

  IF EXISTS (SELECT 1 FROM public.apontamentos_producao ap WHERE ap.os_id = fechar_os.os_id
               AND ap.finalizado_em IS NULL)
  THEN v_bloqueios := v_bloqueios || '"apontamento_aberto"'::jsonb; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.custos_operacionais_os co WHERE co.os_id = fechar_os.os_id)
  THEN v_bloqueios := v_bloqueios || '"custos_operacionais"'::jsonb; END IF;

  SELECT COALESCE(SUM(pg.valor),0) INTO v_pago FROM public.pagamentos pg
   WHERE pg.os_id = fechar_os.os_id AND pg.status='pago';

  IF v_receita > 0 AND v_pago < v_receita
     AND COALESCE((SELECT o2.status_financeiro::text FROM public.ordens_servico o2
                    WHERE o2.id = fechar_os.os_id),'pendente') <> 'pago'
  THEN v_bloqueios := v_bloqueios || '"pagamentos_pendentes"'::jsonb; END IF;

  SELECT to_jsonb(r) INTO v_result FROM public.vw_resultado_os r WHERE r.os_id = fechar_os.os_id;

  IF jsonb_array_length(v_bloqueios) > 0 THEN
    RETURN jsonb_build_object('os_id', fechar_os.os_id, 'fechada', false,
                              'bloqueios', v_bloqueios, 'resultado', v_result);
  END IF;

  INSERT INTO public.os_resultado_snapshots(os_id, resultado_json, created_by)
  VALUES (fechar_os.os_id, v_result, v_uid);
  UPDATE public.ordens_servico o SET status='concluido', status_geral='fechada', data_fechamento=now(),
         custo_real=COALESCE((v_result->>'custo_realizado')::numeric,0),
         margem_real=COALESCE((v_result->>'margem_realizada')::numeric,0)
   WHERE o.id = fechar_os.os_id;
  INSERT INTO public.pos_venda_pesquisas(os_id, cliente_id) VALUES (fechar_os.os_id, v_cliente);
  PERFORM public.registrar_evento_os(fechar_os.os_id,'os',fechar_os.os_id,'fechamento','OS fechada',NULL,v_result);
  RETURN jsonb_build_object('os_id', fechar_os.os_id, 'fechada', true, 'resultado', v_result);
END
$function$;

-- vw_resultado_os: receita bruta = total + desconto; líquida = total. Mesmas
-- colunas, mesma ordem. O WITH (security_invoker) tem de vir de novo: CREATE OR
-- REPLACE VIEW sem ele zera a opção e a view passaria a ignorar a RLS.
CREATE OR REPLACE VIEW public.vw_resultado_os WITH (security_invoker = true) AS
 WITH previsto_material AS (
         SELECT p.os_id,
            sum(p.quantidade * COALESCE(p.custo_unitario_previsto, 0::numeric)) AS total
           FROM os_materiais_previstos p
          GROUP BY p.os_id
        ), realizado AS (
         SELECT co.os_id,
            sum(co.total) AS total,
            sum(co.total) FILTER (WHERE co.categoria = 'retrabalho'::text) AS retrabalho
           FROM custos_operacionais_os co
          GROUP BY co.os_id
        ), reservado AS (
         SELECT r.os_id,
            sum(r.quantidade * l.custo_unitario_snapshot) AS total
           FROM estoque_reservas r
             LEFT JOIN material_lotes l ON l.id = r.lote_id
          GROUP BY r.os_id
        )
 SELECT os.id AS os_id,
    COALESCE(f.valor_total, 0::numeric) + COALESCE(f.desconto, 0::numeric) AS receita_bruta,
    COALESCE(f.desconto, 0::numeric) AS descontos,
    COALESCE(f.valor_total, 0::numeric) AS receita_liquida,
        CASE
            WHEN COALESCE(f.custo_previsto, 0::numeric) > 0::numeric THEN f.custo_previsto
            ELSE COALESCE(pm.total, 0::numeric)
        END AS custo_previsto,
    COALESCE(rs.total, 0::numeric) AS custo_reservado,
    COALESCE(rl.total, 0::numeric) AS custo_realizado,
    COALESCE(f.valor_total, 0::numeric) -
        CASE
            WHEN COALESCE(f.custo_previsto, 0::numeric) > 0::numeric THEN f.custo_previsto
            ELSE COALESCE(pm.total, 0::numeric)
        END AS lucro_previsto,
        CASE
            WHEN rl.total IS NULL THEN NULL::numeric
            ELSE COALESCE(f.valor_total, 0::numeric) - rl.total
        END AS lucro_realizado,
        CASE
            WHEN COALESCE(f.valor_total, 0::numeric) > 0::numeric THEN round((COALESCE(f.valor_total, 0::numeric) -
            CASE
                WHEN COALESCE(f.custo_previsto, 0::numeric) > 0::numeric THEN f.custo_previsto
                ELSE COALESCE(pm.total, 0::numeric)
            END) / COALESCE(f.valor_total, 0::numeric) * 100::numeric, 2)
            ELSE NULL::numeric
        END AS margem_prevista,
        CASE
            WHEN rl.total IS NULL THEN NULL::numeric
            WHEN COALESCE(f.valor_total, 0::numeric) > 0::numeric THEN round((COALESCE(f.valor_total, 0::numeric) - rl.total) / COALESCE(f.valor_total, 0::numeric) * 100::numeric, 2)
            ELSE NULL::numeric
        END AS margem_realizada,
    COALESCE(rl.total, 0::numeric) -
        CASE
            WHEN COALESCE(f.custo_previsto, 0::numeric) > 0::numeric THEN f.custo_previsto
            ELSE COALESCE(pm.total, 0::numeric)
        END AS divergencia_custo,
    COALESCE(rl.retrabalho, 0::numeric) AS retrabalho,
        CASE
            WHEN os.prazo_entrega IS NOT NULL AND os.prazo_entrega < now() AND (os.status::text <> ALL (ARRAY['concluido'::text, 'faturado'::text, 'cancelado'::text])) THEN true
            ELSE false
        END AS atraso,
    COALESCE(f.status_financeiro, 'pendente'::status_pagamento) AS status_financeiro,
        CASE
            WHEN COALESCE(f.custo_previsto, 0::numeric) > 0::numeric THEN 'orcamento'::text
            WHEN COALESCE(pm.total, 0::numeric) > 0::numeric THEN 'previsao_de_material'::text
            ELSE 'sem_custo'::text
        END AS custo_previsto_origem,
    COALESCE(pm.total, 0::numeric) AS custo_previsto_materiais,
    rl.total IS NOT NULL AS custo_lancado
   FROM ordens_servico os
     LEFT JOIN os_resultados_financeiros f ON f.os_id = os.id
     LEFT JOIN previsto_material pm ON pm.os_id = os.id
     LEFT JOIN realizado rl ON rl.os_id = os.id
     LEFT JOIN reservado rs ON rs.os_id = os.id;

-- ------------------------------------------ 8. a trava de 10% sai da OS
-- Igual à versão viva menos o bloco `desconto_alto` (ver o cabeçalho, item 5).
CREATE OR REPLACE FUNCTION public.os_bloqueios_para(os_id uuid, novo_status status_os)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_os public.ordens_servico%ROWTYPE;
  v_bloqueios jsonb := '[]'::jsonb;
  v_margem_minima NUMERIC(5,2) := 20;
  v_margem NUMERIC(10,2);
  v_total_pago NUMERIC(12,2);
  v_faltando TEXT;
  v_ve_financeiro BOOLEAN;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Usuário sem permissão para consultar a OS.' USING ERRCODE = '42501';
  END IF;

  v_ve_financeiro := public.has_permission(auth.uid(), 'financeiro.read');

  SELECT * INTO v_os FROM public.ordens_servico WHERE id = os_bloqueios_para.os_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OS % não encontrada.', os_bloqueios_para.os_id USING ERRCODE = 'P0002';
  END IF;

  IF v_os.status = novo_status THEN
    RETURN '[]'::jsonb;
  END IF;

  IF v_os.responsavel_id IS NULL THEN
    v_bloqueios := v_bloqueios || jsonb_build_object(
      'codigo', 'sem_responsavel',
      'titulo', 'Sem responsável definido',
      'resolver', 'Escolha quem responde por esta OS antes de mudar o status.'
    );
  END IF;

  IF public.status_os_exige_validacoes_producao(novo_status) THEN
    SELECT COALESCE(SUM(valor), 0) INTO v_total_pago
    FROM public.pagamentos
    WHERE pagamentos.os_id = os_bloqueios_para.os_id
      AND status IN ('parcial','pago')
      AND valor > 0;

    IF v_total_pago <= 0 THEN
      v_bloqueios := v_bloqueios || jsonb_build_object(
        'codigo', 'sem_pagamento',
        'titulo', 'Nenhum pagamento registrado',
        'resolver', 'Registre ao menos a entrada no financeiro da OS.'
      );
    END IF;

    -- Uma pergunta so, para os dois caminhos de aprovacao. Ver
    -- `arte_aprovada_da_os`: lendo so `aprovacoes`, a aprovacao que o cliente
    -- dava pelo link nao contava aqui e a producao ficava barrada.
    IF NOT public.arte_aprovada_da_os(os_bloqueios_para.os_id) THEN
      v_bloqueios := v_bloqueios || jsonb_build_object(
        'codigo', 'arte_nao_aprovada',
        'titulo', 'Arte ainda não aprovada',
        'resolver', 'Envie a arte para aprovação e registre o aceite do cliente.'
      );
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.arquivos
      WHERE arquivos.os_id = os_bloqueios_para.os_id AND final_producao = true
    ) THEN
      v_bloqueios := v_bloqueios || jsonb_build_object(
        'codigo', 'sem_arquivo_final',
        'titulo', 'Sem arquivo final de produção',
        'resolver', 'Anexe o arquivo fechado e marque-o como final de produção.'
      );
    END IF;

    SELECT string_agg(m.nome || ' (falta ' || ROUND(omo.quantidade - m.estoque, 2) || ')', ', ')
    INTO v_faltando
    FROM public.os_materiais_obrigatorios omo
    JOIN public.materiais m ON m.id = omo.material_id
    WHERE omo.os_id = os_bloqueios_para.os_id AND m.estoque < omo.quantidade;

    IF v_faltando IS NOT NULL THEN
      v_bloqueios := v_bloqueios || jsonb_build_object(
        'codigo', 'material_insuficiente',
        'titulo', 'Material obrigatório em falta',
        'resolver', 'Sem saldo de: ' || v_faltando || '. Dê entrada no estoque ou compre.'
      );
    END IF;
  END IF;

  SELECT margem_estimada INTO v_margem
  FROM public.orcamentos WHERE id = v_os.orcamento_id;

  IF v_margem IS NULL THEN
    v_margem := COALESCE(
      v_os.margem_real,
      CASE
        WHEN v_os.valor_total > 0 THEN ROUND(((v_os.valor_total - COALESCE(NULLIF(v_os.custo_real, 0), v_os.custo_previsto, 0)) / v_os.valor_total) * 100, 2)
        ELSE NULL
      END
    );
  END IF;

  IF v_margem IS NOT NULL AND v_margem < v_margem_minima AND NOT EXISTS (
    SELECT 1 FROM public.aprovacoes a
    JOIN public.user_roles ur ON ur.user_id = a.usuario_id AND ur.role IN ('admin','gestor')
    WHERE a.os_id = os_bloqueios_para.os_id AND a.tipo::text = 'margem_baixa' AND a.aprovado = true
  ) THEN
    v_bloqueios := v_bloqueios || jsonb_build_object(
      'codigo', 'margem_baixa',
      'titulo', CASE WHEN v_ve_financeiro
                     THEN 'Margem de ' || v_margem || '% abaixo do mínimo de ' || v_margem_minima || '%'
                     ELSE 'Margem abaixo do mínimo — precisa de aprovação do gestor' END,
      'resolver', 'Peça aprovação de um gestor ou revise o preço.'
    );
  END IF;

  -- O desconto não trava mais aqui: a régua dele é a do orçamento
  -- (margem mínima e piso, ou 10% sem custo conhecido), conferida pelo gatilho
  -- de totais ao gravar e por converter_orcamento_em_os antes de a OS nascer.
  -- Os 10% fixos daqui travavam vendedor dentro da alçada e todo pedido de
  -- parceiro com crédito (até 15%), e a aprovação vinha de `aprovacoes`, onde
  -- quem cria orçamento grava qualquer usuario_id.

  RETURN v_bloqueios;
END;
$function$;

-- ------------------------------------- 9. especificação na via de produção
-- `tg_itens_os_herda_especificacao` (20261005233000) leva o texto do item do
-- orçamento para itens_os.especificacoes ({"texto": …}), mas a equipe não lia
-- a coluna: a OS saía sem a especificação. Não é dinheiro.
GRANT SELECT (especificacoes) ON public.itens_os TO authenticated;

-- ----------------------------------------------------------- 10. permissões
-- Função nasce com EXECUTE para PUBLIC, e REVOKE de PUBLIC não fecha o anon
-- nem o authenticated (eles têm grant próprio). As internas e as de gatilho
-- ficam só com o dono; as duas da tela, só com authenticated.
REVOKE ALL ON FUNCTION public.desconto_em_reais(numeric, numeric, text, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.desconto_erro_de_entrada(numeric, numeric, text, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.desconto_avaliar(uuid, numeric, numeric, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.desconto_situacao_interna(uuid, text, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_parceiro_credito_no_total() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_orcamento_soma_os_itens() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_os_soma_os_itens() FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.desconto_do_orcamento(uuid, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.desconto_do_orcamento(uuid, text, numeric) TO authenticated;
REVOKE ALL ON FUNCTION public.definir_desconto_do_orcamento(uuid, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.definir_desconto_do_orcamento(uuid, text, numeric) TO authenticated;

-- As que já existiam mantêm quem chama (authenticated); só o anon e o PUBLIC
-- ficam de fora, como já estavam.
REVOKE ALL ON FUNCTION public.converter_orcamento_em_os(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fechar_os(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.os_bloqueios_para(uuid, status_os) FROM PUBLIC, anon;
