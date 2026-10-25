-- Prazo e EXPRESSO no pedido do parceiro (25/10/2026) — fase 2 de docs/plano-orcamento-em-passos.md.
--
-- Decisão do dono (24/10/2026): o expresso é uma TAXA EM PORCENTAGEM sobre o valor dos
-- produtos — nunca um valor fixo, porque o mesmo valor em reais pesaria de outro jeito num
-- produto de R$ 50 e num de R$ 100. Para começar, 12% (valor provisório: "depois a gente vê").
-- A taxa fica numa tabela editável; mudar o número não exige nova migração.
--
-- O QUE FAZ
--   * prazos_de_entrega: 'normal' (0%) e 'expresso' (12%). Todo mundo lê; só admin e gestor mudam.
--   * parceiro_orcamentos.prazo: o prazo que o parceiro escolheu ('normal' por padrão).
--   * parceiro_enviar_pedido: quando o prazo não é o normal, entra no pedido UMA LINHA
--     "Taxa de expresso (12% sobre os produtos)" com o valor calculado AQUI, no banco, sobre a
--     soma dos produtos já recalculados pela tabela de parceiro. A tela só antecipa o número.
--
-- A taxa NÃO incide sobre si mesma nem sobre o crédito do parceiro: o teto de crédito por pedido
-- continua calculado sobre os produtos (v_base), como era sobre o subtotal antes da taxa.
-- A linha nasce sem produto e com custo 0 (é receita da gráfica), e o gatilho de totais soma o
-- subtotal como soma qualquer outro item.
--
-- A função é reescrita por inteiro (CREATE OR REPLACE) a partir da versão que estava no banco em
-- 24/10/2026. A guarda de md5 abaixo ABORTA a migração se alguém mudou a função desde então:
-- reescrever em cima de uma versão que não se leu apaga a mudança do outro.
--
-- Desfazer: restaurar a versão anterior de parceiro_enviar_pedido (migração
-- 20261008043700_itens_e_versoes_sem_escrita_da_equipe.sql);
--           ALTER TABLE public.parceiro_orcamentos DROP COLUMN prazo;
--           DROP TABLE public.prazos_de_entrega;

DO $guarda$
BEGIN
  IF md5(pg_get_functiondef('public.parceiro_enviar_pedido(uuid, numeric)'::regprocedure))
     <> '2ae9e4a39f43b39539458049cf49370a' THEN
    RAISE EXCEPTION 'parceiro_enviar_pedido mudou desde a leitura de 24/10/2026. Releia a função e refaça esta migração.';
  END IF;
END
$guarda$;

CREATE TABLE public.prazos_de_entrega (
  chave           text PRIMARY KEY,
  nome            text NOT NULL,
  descricao       text,
  taxa_percentual numeric(5, 2) NOT NULL DEFAULT 0 CHECK (taxa_percentual >= 0 AND taxa_percentual <= 100),
  ativo           boolean NOT NULL DEFAULT true,
  ordem           integer NOT NULL DEFAULT 0,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid,
  -- o prazo normal é o que existe quando nada foi escolhido: não custa nada e não some
  CONSTRAINT prazos_normal_sem_taxa CHECK (chave <> 'normal' OR taxa_percentual = 0),
  CONSTRAINT prazos_normal_sempre_ativo CHECK (chave <> 'normal' OR ativo)
);

INSERT INTO public.prazos_de_entrega (chave, nome, descricao, taxa_percentual, ordem) VALUES
  ('normal', 'Normal', 'Prazo de produção da gráfica.', 0, 1),
  ('expresso', 'Expresso', 'Produção prioritária, mais rápida. Taxa em % sobre o valor dos produtos.', 12, 2);

ALTER TABLE public.prazos_de_entrega ENABLE ROW LEVEL SECURITY;
CREATE POLICY prazos_ler ON public.prazos_de_entrega FOR SELECT TO authenticated USING (true);
CREATE POLICY prazos_gerir ON public.prazos_de_entrega FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'gestor'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'gestor'));
REVOKE ALL ON public.prazos_de_entrega FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON public.prazos_de_entrega TO authenticated;

ALTER TABLE public.parceiro_orcamentos
  ADD COLUMN prazo text NOT NULL DEFAULT 'normal' REFERENCES public.prazos_de_entrega(chave);

CREATE OR REPLACE FUNCTION public.parceiro_enviar_pedido(p_orcamento_id uuid, p_usar_credito numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_parceiro uuid := public.parceiro_do_usuario();
  v_p public.parceiros%ROWTYPE;
  v_q public.parceiro_orcamentos%ROWTYPE;
  v_nivel jsonb;
  v_orc uuid;
  v_numero integer;
  v_item record;
  v_preco record;
  v_faixa jsonb;
  v_preco_un numeric;
  v_custo_un numeric;
  v_area_peca numeric;
  v_n_itens integer := 0;
  v_livres integer := 0;
  v_subtotal numeric;
  v_base numeric;
  v_taxa numeric := 0;
  v_taxa_pct numeric := 0;
  v_taxa_nome text;
  v_saldo numeric;
  v_credito numeric := 0;
BEGIN
  IF v_parceiro IS NULL THEN
    RAISE EXCEPTION 'Acesso de parceiro não encontrado ou suspenso.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_p FROM public.parceiros WHERE id = v_parceiro;
  SELECT * INTO v_q FROM public.parceiro_orcamentos
   WHERE id = p_orcamento_id AND parceiro_id = v_parceiro FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Orçamento não encontrado.'; END IF;
  IF v_q.pedido_orcamento_id IS NOT NULL OR v_q.status = 'pedido_feito' THEN
    RAISE EXCEPTION 'Este orçamento já virou pedido.';
  END IF;
  IF v_q.status = 'perdido' THEN
    RAISE EXCEPTION 'Orçamento marcado como perdido não vira pedido. Reabra antes.';
  END IF;
  IF v_p.responsavel_id IS NULL THEN
    RAISE EXCEPTION 'Seu cadastro ainda não tem um atendente na gráfica. Fale com a equipe antes do primeiro pedido.';
  END IF;

  v_nivel := public.parceiro_nivel(v_parceiro);

  INSERT INTO public.orcamentos (
    cliente_id, vendedor_id, created_by, status, titulo, descricao, observacao_interna,
    aprovado_em, aprovado_por_nome, validade_dias, condicao_pagamento
  ) VALUES (
    v_p.cliente_id, v_p.responsavel_id, auth.uid(), 'aprovado',
    left('Pedido de parceiro · ' || v_q.titulo, 200),
    'Pedido feito pelo painel do parceiro revendedor.',
    format('Parceiro nível %s (desconto %s%%). Preços da tabela de parceiro, recalculados pelo sistema no envio. Orçamento nº %s do parceiro.',
           v_nivel->>'nome', v_nivel->>'desconto_pct', v_q.numero),
    now(), left(COALESCE(NULLIF(btrim(v_p.marca_nome), ''), 'Parceiro') || ' (painel do parceiro)', 120),
    7, '{"parcelas": 1}'::jsonb
  ) RETURNING id, numero INTO v_orc, v_numero;

  FOR v_item IN
    SELECT * FROM public.parceiro_orcamento_itens WHERE orcamento_id = v_q.id ORDER BY ordem, created_at
  LOOP
    IF v_item.produto_id IS NULL THEN
      v_livres := v_livres + 1;
      CONTINUE;
    END IF;

    SELECT * INTO v_preco FROM public.parceiro_precos(v_parceiro) pr WHERE pr.produto_id = v_item.produto_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION '"%" não está disponível na tabela de parceiro.', v_item.descricao;
    END IF;
    IF v_preco.por_area AND (COALESCE(v_item.largura, 0) <= 0 OR COALESCE(v_item.altura, 0) <= 0) THEN
      RAISE EXCEPTION '"%" é vendido por m² e precisa de largura e altura.', v_item.descricao;
    END IF;

    IF v_preco.faixas IS NOT NULL THEN
      v_faixa := NULL;
      SELECT f INTO v_faixa FROM jsonb_array_elements(v_preco.faixas) f
       WHERE (f->>'quantidade_minima')::integer <= ceil(v_item.quantidade)
       ORDER BY (f->>'quantidade_minima')::integer DESC LIMIT 1;
      IF v_faixa IS NULL THEN
        RAISE EXCEPTION '"%" tem pedido mínimo de % unidades.', v_item.descricao, v_preco.faixas->0->>'quantidade_minima';
      END IF;
      v_preco_un := (v_faixa->>'preco_parceiro')::numeric;
    ELSE
      v_preco_un := v_preco.preco_parceiro;
    END IF;

    v_area_peca := CASE WHEN v_preco.por_area
                        THEN GREATEST(round(v_item.largura * v_item.altura, 3), COALESCE(v_preco.area_minima, 0)) END;
    SELECT CASE WHEN v_preco.por_area THEN round(COALESCE(p.custo_medio, 0) * v_area_peca, 2)
                ELSE COALESCE(p.custo_medio, 0) END
      INTO v_custo_un FROM public.produtos p WHERE p.id = v_item.produto_id;

    INSERT INTO public.orcamento_itens (
      orcamento_id, produto_id, descricao, unidade, quantidade, largura, altura, acabamento,
      preco_m2, valor_unitario, custo_unitario, ordem, origem_calculo, produto_snapshot
    ) VALUES (
      v_orc, v_item.produto_id, v_item.descricao, v_preco.unidade, v_item.quantidade,
      v_item.largura, v_item.altura, v_item.acabamento,
      CASE WHEN v_preco.por_area THEN v_preco_un END,
      CASE WHEN v_preco.por_area THEN 0 ELSE v_preco_un END,
      COALESCE(v_custo_un, 0), v_n_itens, 'tabela_parceiro',
      jsonb_build_object('origem', 'parceiro', 'nivel', v_nivel->>'nome',
                         'desconto_pct', v_nivel->'desconto_pct', 'preco_referencia', v_preco.preco_referencia,
                         'preco_parceiro_unidade', v_preco_un, 'origem_preco', v_preco.origem)
    );
    v_n_itens := v_n_itens + 1;
  END LOOP;

  IF v_n_itens = 0 THEN
    RAISE EXCEPTION 'Nenhum item deste orçamento é produto da gráfica. Itens livres entram só no seu PDF.';
  END IF;

  -- Soma dos PRODUTOS, já recalculados pela tabela de parceiro: a base da taxa e do teto de crédito.
  SELECT COALESCE(sum(valor_total), 0) INTO v_base FROM public.orcamento_itens WHERE orcamento_id = v_orc;

  -- Prazo diferente do normal: uma linha de taxa em %, calculada aqui sobre os produtos.
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
  END IF;

  SELECT COALESCE(sum(valor_total), 0) INTO v_subtotal FROM public.orcamento_itens WHERE orcamento_id = v_orc;
  UPDATE public.orcamentos SET valor_subtotal = v_subtotal, valor_total = v_subtotal WHERE id = v_orc;

  PERFORM public.parceiro_expirar_creditos(v_parceiro);
  IF COALESCE(p_usar_credito, 0) > 0 THEN
    SELECT COALESCE(sum(valor), 0) INTO v_saldo FROM public.parceiro_creditos WHERE parceiro_id = v_parceiro;
    v_credito := round(LEAST(p_usar_credito, v_saldo, round(v_base * COALESCE((SELECT credito_max_pct_pedido FROM public.parceiro_programa WHERE id), 100) / 100, 2)), 2);
    IF v_credito > 0 THEN
      INSERT INTO public.parceiro_creditos (parceiro_id, tipo, valor, parceiro_orcamento_id, descricao, criado_por)
      VALUES (v_parceiro, 'uso', -v_credito, v_q.id, format('Reservado para o pedido nº %s', v_numero), auth.uid());
      UPDATE public.orcamentos SET
        condicao_pagamento = jsonb_build_object('parcelas', 1, 'credito_parceiro', v_credito),
        observacao_interna = observacao_interna ||
          format(' · Crédito do parceiro de R$ %s JÁ ABATIDO como desconto deste pedido — não descontar de novo.', replace(to_char(v_credito, 'FM999999990.00'), '.', ','))
      WHERE id = v_orc;
    ELSE
      v_credito := 0;
    END IF;
  END IF;

  UPDATE public.parceiro_orcamentos
     SET status = 'pedido_feito', pedido_orcamento_id = v_orc, credito_usado = v_credito, updated_at = now()
   WHERE id = v_q.id;

  RETURN jsonb_build_object(
    'orcamento_id', v_orc, 'numero', v_numero, 'itens', v_n_itens,
    'itens_livres_fora_do_pedido', v_livres, 'total', v_subtotal, 'credito_usado', v_credito,
    'prazo', v_q.prazo, 'taxa_prazo', v_taxa
  );
END
$function$;
