-- Prazo e EXPRESSO no orçamento da EQUIPE e na conversão em OS (25/10/2026).
--
-- Continua a migração 20261025000000 (que pôs o expresso no pedido do parceiro): a regra do dono
-- é a mesma — taxa em PORCENTAGEM sobre o valor dos produtos, hoje 12% (provisória), na tabela
-- prazos_de_entrega. Agora vale para o orçamento da equipe também, com a MESMA conta.
--
-- COMO FUNCIONA
--   * orcamentos.prazo_tipo ('normal' por padrão). O nome é prazo_tipo porque `orcamentos.prazo`
--     já existe e é a DATA de entrega.
--   * recalcular_taxa_prazo(orcamento): mantém UMA linha "Taxa de expresso (12% sobre os produtos)"
--     (origem_calculo = 'taxa_prazo', sem produto, custo 0) igual a % × soma dos demais itens. Prazo
--     normal ou taxa zero: a linha some. A linha fica sempre por último.
--   * A linha também leva tipo_produto = 'taxa_prazo': as visões da tela (orcamento_itens_comercial,
--     _financeiro e _operacional) listam as colunas à mão e não trazem origem_calculo, mas trazem
--     tipo_produto — é por ele que a tela reconhece a linha sem mexer nas visões.
--   * Quem a mantém é o GATILHO: qualquer caminho que mexa nos itens (tela da equipe, pedido do
--     parceiro, importação, API) ou troque o prazo recalcula. A tela só mostra.
--   * Orçamento que já virou OS não é recalculado: é retrato do que foi vendido.
--   * O desconto do orçamento incide sobre o total com a taxa (a taxa é um item como outro).
--
-- A CONVERSÃO EM OS (converter_orcamento_em_os), três ajustes:
--   1. A linha da taxa não conta como "item fora do catálogo sem custo". Sem isso, TODO pedido de
--      parceiro com expresso (já em produção desde a migração anterior) travava na conversão.
--   2. A OS nasce com a prioridade do prazo (expresso = 2, Alta; a escala é 1 Urgente … 5 Mínima).
--   3. A observação da OS começa com "PRAZO EXPRESSO: produção prioritária.".
--
-- O PEDIDO DO PARCEIRO (parceiro_enviar_pedido) deixa de montar a linha por conta própria: grava o
-- prazo no orçamento da equipe e o gatilho cria a linha, pela mesma regra.
--
-- As duas funções são alteradas POR SUBSTITUIÇÃO de trechos sobre o texto que está no banco, com
-- guarda de md5 e conferência de que cada trecho existe UMA vez: se alguém mudou a função, a
-- migração aborta em vez de apagar a mudança do outro.
--
-- Desfazer: DROP TRIGGER tg_orcamento_itens_zz_taxa_prazo ON public.orcamento_itens;
--           DROP TRIGGER tg_orcamentos_zz_taxa_prazo ON public.orcamentos;
--           DROP FUNCTION public.tg_orcamento_itens_taxa_prazo(); DROP FUNCTION public.tg_orcamento_prazo_tipo_taxa();
--           DROP FUNCTION public.recalcular_taxa_prazo(uuid);
--           ALTER TABLE public.orcamentos DROP COLUMN prazo_tipo;
--           ALTER TABLE public.prazos_de_entrega DROP COLUMN prioridade_os;
--           e restaurar converter_orcamento_em_os e parceiro_enviar_pedido das migrações anteriores.

DO $guarda$
BEGIN
  IF md5(pg_get_functiondef('public.converter_orcamento_em_os(uuid, jsonb)'::regprocedure))
     <> '9ae3491761573c07664421dbbe5dbf15' THEN
    RAISE EXCEPTION 'converter_orcamento_em_os mudou desde a leitura de 25/10/2026. Releia a função e refaça esta migração.';
  END IF;
  IF md5(pg_get_functiondef('public.parceiro_enviar_pedido(uuid, numeric)'::regprocedure))
     <> '0e261099f03d899f43fe15a781fe0ed4' THEN
    RAISE EXCEPTION 'parceiro_enviar_pedido mudou desde a leitura de 25/10/2026. Releia a função e refaça esta migração.';
  END IF;
END
$guarda$;

ALTER TABLE public.prazos_de_entrega
  ADD COLUMN prioridade_os smallint NOT NULL DEFAULT 3 CHECK (prioridade_os BETWEEN 1 AND 5);
UPDATE public.prazos_de_entrega SET prioridade_os = 2 WHERE chave = 'expresso';

ALTER TABLE public.orcamentos
  ADD COLUMN prazo_tipo text NOT NULL DEFAULT 'normal' REFERENCES public.prazos_de_entrega(chave);

CREATE OR REPLACE FUNCTION public.recalcular_taxa_prazo(p_orc uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_o record;
  v_pz record;
  v_base numeric;
  v_ordem integer;
  v_taxa numeric;
  v_linha uuid;
  v_desc text;
  v_pct text;
BEGIN
  SELECT prazo_tipo, status::text AS status, os_id INTO v_o FROM public.orcamentos WHERE id = p_orc;
  IF NOT FOUND THEN RETURN; END IF;
  -- Orçamento que virou OS é retrato do que foi vendido: a taxa não se mexe mais.
  IF v_o.os_id IS NOT NULL OR v_o.status = 'convertido' THEN RETURN; END IF;

  IF v_o.prazo_tipo = 'normal' THEN
    DELETE FROM public.orcamento_itens WHERE orcamento_id = p_orc AND origem_calculo = 'taxa_prazo';
    RETURN;
  END IF;

  SELECT nome, taxa_percentual INTO v_pz FROM public.prazos_de_entrega WHERE chave = v_o.prazo_tipo;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT COALESCE(sum(valor_total), 0), COALESCE(max(ordem), -1) + 1
    INTO v_base, v_ordem
    FROM public.orcamento_itens
   WHERE orcamento_id = p_orc AND origem_calculo IS DISTINCT FROM 'taxa_prazo';

  v_taxa := round(v_base * v_pz.taxa_percentual / 100, 2);
  IF v_taxa <= 0 THEN
    DELETE FROM public.orcamento_itens WHERE orcamento_id = p_orc AND origem_calculo = 'taxa_prazo';
    RETURN;
  END IF;

  v_pct := regexp_replace(to_char(v_pz.taxa_percentual, 'FM990.00'), '\.?0+$', '');
  v_desc := format('Taxa de %s (%s%% sobre os produtos)', lower(v_pz.nome), v_pct);

  SELECT id INTO v_linha FROM public.orcamento_itens
   WHERE orcamento_id = p_orc AND origem_calculo = 'taxa_prazo' ORDER BY ordem LIMIT 1;

  IF v_linha IS NULL THEN
    INSERT INTO public.orcamento_itens (
      orcamento_id, descricao, unidade, quantidade, valor_unitario, custo_unitario, ordem, origem_calculo, tipo_produto, produto_snapshot
    ) VALUES (
      p_orc, v_desc, 'un', 1, v_taxa, 0, v_ordem, 'taxa_prazo', 'taxa_prazo',
      jsonb_build_object('tipo', 'taxa_prazo', 'prazo', v_o.prazo_tipo, 'taxa_percentual', v_pz.taxa_percentual, 'base', v_base)
    );
  ELSE
    UPDATE public.orcamento_itens
       SET descricao = v_desc, quantidade = 1, valor_unitario = v_taxa, ordem = v_ordem, tipo_produto = 'taxa_prazo',
           produto_snapshot = jsonb_build_object('tipo', 'taxa_prazo', 'prazo', v_o.prazo_tipo,
                                                 'taxa_percentual', v_pz.taxa_percentual, 'base', v_base)
     WHERE id = v_linha
       AND (descricao, valor_unitario, ordem) IS DISTINCT FROM (v_desc, v_taxa, v_ordem);
  END IF;
END
$function$;
REVOKE ALL ON FUNCTION public.recalcular_taxa_prazo(uuid) FROM PUBLIC, anon, authenticated;

-- A taxa recalcula quando QUALQUER outro item muda. Insert e update da própria linha da taxa não
-- recalculam (seria laço); apagar a linha da taxa recalcula, para ela voltar se alguém a apagou.
CREATE OR REPLACE FUNCTION public.tg_orcamento_itens_taxa_prazo()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_orc uuid;
  v_eh_taxa boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_orc := OLD.orcamento_id;
    v_eh_taxa := OLD.origem_calculo = 'taxa_prazo';
  ELSE
    v_orc := NEW.orcamento_id;
    v_eh_taxa := NEW.origem_calculo = 'taxa_prazo';
  END IF;
  IF v_eh_taxa AND TG_OP <> 'DELETE' THEN RETURN NULL; END IF;
  PERFORM public.recalcular_taxa_prazo(v_orc);
  RETURN NULL;
END
$function$;
REVOKE ALL ON FUNCTION public.tg_orcamento_itens_taxa_prazo() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER tg_orcamento_itens_zz_taxa_prazo
  AFTER INSERT OR UPDATE OR DELETE ON public.orcamento_itens
  FOR EACH ROW EXECUTE FUNCTION public.tg_orcamento_itens_taxa_prazo();

CREATE OR REPLACE FUNCTION public.tg_orcamento_prazo_tipo_taxa()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.recalcular_taxa_prazo(NEW.id);
  RETURN NULL;
END
$function$;
REVOKE ALL ON FUNCTION public.tg_orcamento_prazo_tipo_taxa() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER tg_orcamentos_zz_taxa_prazo
  AFTER UPDATE OF prazo_tipo ON public.orcamentos
  FOR EACH ROW WHEN (OLD.prazo_tipo IS DISTINCT FROM NEW.prazo_tipo)
  EXECUTE FUNCTION public.tg_orcamento_prazo_tipo_taxa();

-- Substituição de trecho com conferência: o trecho antigo tem de existir UMA vez no texto.
CREATE FUNCTION pg_temp.trocar(p_texto text, p_antigo text, p_novo text) RETURNS text
LANGUAGE plpgsql AS $f$
BEGIN
  IF (length(p_texto) - length(replace(p_texto, p_antigo, ''))) <> length(p_antigo) THEN
    RAISE EXCEPTION 'Trecho esperado não encontrado exatamente uma vez: %', left(p_antigo, 90);
  END IF;
  RETURN replace(p_texto, p_antigo, p_novo);
END
$f$;

DO $conv$
DECLARE d text := pg_get_functiondef('public.converter_orcamento_em_os(uuid, jsonb)'::regprocedure);
BEGIN
  -- 1) a linha da taxa não é "item fora do catálogo sem custo"
  d := pg_temp.trocar(d,
    $a$AND i.produto_id IS NULL AND COALESCE(i.custo_unitario, 0) <= 0;$a$,
    $b$AND i.produto_id IS NULL AND COALESCE(i.custo_unitario, 0) <= 0
       AND i.origem_calculo IS DISTINCT FROM 'taxa_prazo';$b$);
  -- 2) a OS nasce com a prioridade do prazo
  d := pg_temp.trocar(d,
    $a$    responsavel_id
  )
  VALUES ($a$,
    $b$    responsavel_id, prioridade
  )
  VALUES ($b$);
  d := pg_temp.trocar(d,
    $a$    COALESCE(v_orc.vendedor_id, v_uid)
  )
  RETURNING id INTO v_os_id;$a$,
    $b$    COALESCE(v_orc.vendedor_id, v_uid),
    COALESCE((SELECT pz.prioridade_os FROM public.prazos_de_entrega pz WHERE pz.chave = v_orc.prazo_tipo), 3)
  )
  RETURNING id INTO v_os_id;$b$);
  -- 3) a observação da OS avisa do prazo
  d := pg_temp.trocar(d,
    $a$    v_orc.observacoes, v_orc.prazo, v_orc.valor_total, v_orc.custo_estimado,$a$,
    $b$    CASE WHEN v_orc.prazo_tipo IS DISTINCT FROM 'normal'
         THEN 'PRAZO ' || upper(COALESCE((SELECT pz.nome FROM public.prazos_de_entrega pz WHERE pz.chave = v_orc.prazo_tipo), v_orc.prazo_tipo))
              || ': produção prioritária.'
              || CASE WHEN NULLIF(btrim(v_orc.observacoes), '') IS NOT NULL THEN E'\n' || v_orc.observacoes ELSE '' END
         ELSE v_orc.observacoes END,
    v_orc.prazo, v_orc.valor_total, v_orc.custo_estimado,$b$);
  EXECUTE d;
END
$conv$;

DO $parc$
DECLARE d text := pg_get_functiondef('public.parceiro_enviar_pedido(uuid, numeric)'::regprocedure);
BEGIN
  -- o prazo escolhido tem de estar disponível (a checagem sai do meio do cálculo e vem para o começo)
  d := pg_temp.trocar(d,
    $a$  v_nivel := public.parceiro_nivel(v_parceiro);$a$,
    $b$  IF v_q.prazo <> 'normal'
     AND NOT EXISTS (SELECT 1 FROM public.prazos_de_entrega WHERE chave = v_q.prazo AND ativo) THEN
    RAISE EXCEPTION 'O prazo escolhido não está disponível. Escolha outro e envie de novo.';
  END IF;

  v_nivel := public.parceiro_nivel(v_parceiro);$b$);
  -- o prazo vai para o orçamento da equipe; o gatilho dos itens cria a linha da taxa
  d := pg_temp.trocar(d,
    $a$aprovado_em, aprovado_por_nome, validade_dias, condicao_pagamento
  ) VALUES ($a$,
    $b$aprovado_em, aprovado_por_nome, validade_dias, condicao_pagamento, prazo_tipo
  ) VALUES ($b$);
  d := pg_temp.trocar(d,
    $a$    7, '{"parcelas": 1}'::jsonb
  ) RETURNING id, numero INTO v_orc, v_numero;$a$,
    $b$    7, '{"parcelas": 1}'::jsonb, v_q.prazo
  ) RETURNING id, numero INTO v_orc, v_numero;$b$);
  -- sai a linha montada à mão; entra a leitura do que o gatilho criou
  d := pg_temp.trocar(d,
    $a$  SELECT COALESCE(sum(valor_total), 0) INTO v_base FROM public.orcamento_itens WHERE orcamento_id = v_orc;

  IF v_q.prazo <> 'normal' THEN
    SELECT nome, taxa_percentual INTO v_taxa_nome, v_taxa_pct
      FROM public.prazos_de_entrega WHERE chave = v_q.prazo AND ativo;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'O prazo escolhido não está disponível. Escolha outro e envie de novo.';
    END IF;
    v_taxa := round(v_base * v_taxa_pct / 100, 2);
    IF v_taxa > 0 THEN
      INSERT INTO public.orcamento_itens (
        orcamento_id, descricao, unidade, quantidade, valor_unitario, custo_unitario, ordem, origem_calculo, produto_snapshot
      ) VALUES (
        v_orc,
        format('Taxa de %s (%s%% sobre os produtos)', lower(v_taxa_nome),
               regexp_replace(to_char(v_taxa_pct, 'FM990.00'), '\.?0+$', '')),
        'un', 1, v_taxa, 0, v_n_itens, 'taxa_prazo',
        jsonb_build_object('origem', 'parceiro', 'tipo', 'taxa_prazo', 'prazo', v_q.prazo,
                           'taxa_percentual', v_taxa_pct, 'base', v_base)
      );
      UPDATE public.orcamentos SET observacao_interna = observacao_interna ||
        format(' · %s: +%s%% sobre os produtos (R$ %s). Produção prioritária.', upper(v_taxa_nome),
               regexp_replace(to_char(v_taxa_pct, 'FM990.00'), '\.?0+$', ''),
               replace(to_char(v_taxa, 'FM999999990.00'), '.', ','))
      WHERE id = v_orc;
    END IF;
  END IF;$a$,
    $b$  -- A linha da taxa já foi criada pelo gatilho dos itens (recalcular_taxa_prazo), pela mesma regra
  -- do orçamento da equipe. Aqui só se lê o que ela deu: a base (produtos) e a taxa.
  SELECT COALESCE(sum(valor_total) FILTER (WHERE origem_calculo IS DISTINCT FROM 'taxa_prazo'), 0),
         COALESCE(sum(valor_total) FILTER (WHERE origem_calculo = 'taxa_prazo'), 0)
    INTO v_base, v_taxa
    FROM public.orcamento_itens WHERE orcamento_id = v_orc;

  IF v_taxa > 0 THEN
    SELECT nome, taxa_percentual INTO v_taxa_nome, v_taxa_pct
      FROM public.prazos_de_entrega WHERE chave = v_q.prazo;
    UPDATE public.orcamentos SET observacao_interna = observacao_interna ||
      format(' · %s: +%s%% sobre os produtos (R$ %s). Produção prioritária.', upper(v_taxa_nome),
             regexp_replace(to_char(v_taxa_pct, 'FM990.00'), '\.?0+$', ''),
             replace(to_char(v_taxa, 'FM999999990.00'), '.', ','))
    WHERE id = v_orc;
  END IF;
$b$);
  EXECUTE d;
END
$parc$;
