-- =============================================================================
-- PROPOSTA (NÃO APLICADA): crédito de entrada do parceiro (A) e atendente padrão (B)
-- Escrita em 13/11/2026. Sem BEGIN/COMMIT: a ferramenta de migração roda cada
-- seção como um bloco único. Aplicar A e B separadamente; B não depende de A.
--
-- Corpos vivos conferidos antes de escrever (md5 de prosrc com espaços colapsados):
--   parceiro_enviar_pedido     = 079b320bd6a9d15636a87819e21ffa04
--   programa_parceiros_publico = 073efdd4a9f109d65be5fbecf0569ee3
-- Os blocos DESFAZER trazem esses corpos byte a byte, como saem de pg_get_functiondef.
-- Toda linha nova nas funções existentes está marcada com [entrada] ou [atendente].
-- =============================================================================


-- #############################################################################
-- SEÇÃO A — CRÉDITO DE ENTRADA
-- #############################################################################

-- A.1 Parâmetros. A política "programa escrita gestao" de parceiro_programa é por
-- tabela (has_permission(auth.uid(), 'parceiros.manage') em USING e WITH CHECK),
-- então as colunas novas herdam a mesma trava; não há GRANT por coluna nesta tabela,
-- e a ACL da tabela cobre as colunas novas.
ALTER TABLE public.parceiro_programa
  ADD COLUMN entrada_ativa boolean NOT NULL DEFAULT true,
  ADD COLUMN entrada_valor numeric(10,2) NOT NULL DEFAULT 50
    CONSTRAINT parceiro_programa_entrada_valor_check CHECK (entrada_valor > 0),
  ADD COLUMN entrada_validade_dias integer NOT NULL DEFAULT 30
    CONSTRAINT parceiro_programa_entrada_validade_check CHECK (entrada_validade_dias BETWEEN 1 AND 365),
  ADD COLUMN entrada_pedido_minimo numeric(10,2) NOT NULL DEFAULT 150,
  ADD COLUMN entrada_max_pct_pedido numeric NOT NULL DEFAULT 50
    CONSTRAINT parceiro_programa_entrada_max_pct_check CHECK (entrada_max_pct_pedido > 0 AND entrada_max_pct_pedido <= 50),
  ADD CONSTRAINT parceiro_programa_entrada_minimo_check CHECK (entrada_pedido_minimo >= entrada_valor);

-- A.2 Livro de créditos: tipo 'entrada'. Mesma forma dos CHECKs vivos + 'entrada'.
ALTER TABLE public.parceiro_creditos DROP CONSTRAINT parceiro_creditos_check;
ALTER TABLE public.parceiro_creditos ADD CONSTRAINT parceiro_creditos_check
  CHECK (((tipo <> ALL (ARRAY['cashback'::text, 'recompensa'::text, 'estorno_uso'::text, 'boas_vindas'::text, 'indicacao'::text, 'entrada'::text])) OR (valor > (0)::numeric)));
ALTER TABLE public.parceiro_creditos DROP CONSTRAINT parceiro_creditos_tipo_check;
ALTER TABLE public.parceiro_creditos ADD CONSTRAINT parceiro_creditos_tipo_check
  CHECK ((tipo = ANY (ARRAY['cashback'::text, 'recompensa'::text, 'uso'::text, 'estorno_uso'::text, 'ajuste'::text, 'boas_vindas'::text, 'indicacao'::text, 'expirado'::text, 'entrada'::text])));

-- Uma vez por parceiro, mesmo com duas chamadas ao mesmo tempo.
CREATE UNIQUE INDEX parceiro_creditos_entrada_unica
  ON public.parceiro_creditos (parceiro_id) WHERE tipo = 'entrada';

-- A.3 Função interna: concede ou diz por que não.
CREATE OR REPLACE FUNCTION public._parceiro_conceder_entrada(p_parceiro_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $$
DECLARE
  v_prog public.parceiro_programa%ROWTYPE;
  v_p public.parceiros%ROWTYPE;
  v_doc text; v_tel text; v_email text;
BEGIN
  -- Serializa as concessões: a checagem de documento/telefone/e-mail repetido
  -- olha OUTROS parceiros, e o índice único só protege o mesmo parceiro.
  PERFORM pg_advisory_xact_lock(hashtext('parceiro_credito_de_entrada'));

  SELECT * INTO v_prog FROM public.parceiro_programa WHERE id;
  IF NOT FOUND OR NOT v_prog.entrada_ativa THEN
    RETURN jsonb_build_object('concedido', false, 'motivo', 'Crédito de entrada desligado no programa.');
  END IF;

  SELECT * INTO v_p FROM public.parceiros WHERE id = p_parceiro_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('concedido', false, 'motivo', 'Parceiro não encontrado.');
  END IF;
  IF v_p.status <> 'ativo' OR v_p.usuario_id IS NULL THEN
    RETURN jsonb_build_object('concedido', false, 'motivo', 'Parceiro sem acesso ativo.');
  END IF;
  IF EXISTS (SELECT 1 FROM public.parceiro_creditos WHERE parceiro_id = v_p.id AND tipo = 'entrada') THEN
    RETURN jsonb_build_object('concedido', false, 'motivo', 'Já recebeu o crédito de entrada.');
  END IF;
  IF EXISTS (SELECT 1 FROM public.parceiro_orcamentos WHERE parceiro_id = v_p.id AND pedido_orcamento_id IS NOT NULL) THEN
    RETURN jsonb_build_object('concedido', false, 'motivo', 'Já fez pedido.');
  END IF;

  -- Identidade: dados da marca, e na falta deles os do cliente ligado.
  SELECT regexp_replace(COALESCE(NULLIF(btrim(v_p.marca_documento), ''), c.cpf_cnpj, c.documento, ''), '\D', '', 'g'),
         regexp_replace(COALESCE(NULLIF(btrim(v_p.marca_telefone), ''), c.whatsapp_principal, c.telefone, ''), '\D', '', 'g'),
         lower(btrim(COALESCE(NULLIF(btrim(v_p.marca_email), ''), c.email, '')))
    INTO v_doc, v_tel, v_email
    FROM (SELECT 1) x LEFT JOIN public.clientes c ON c.id = v_p.cliente_id;
  v_doc   := CASE WHEN length(v_doc) >= 11 THEN v_doc END;
  v_tel   := CASE WHEN length(v_tel) >= 10 THEN right(v_tel, 11) END;
  v_email := NULLIF(v_email, '');

  IF (v_doc IS NOT NULL OR v_tel IS NOT NULL OR v_email IS NOT NULL) AND EXISTS (
    SELECT 1
      FROM public.parceiro_creditos pc
      JOIN public.parceiros o ON o.id = pc.parceiro_id
      LEFT JOIN public.clientes c ON c.id = o.cliente_id
      CROSS JOIN LATERAL (SELECT
        regexp_replace(COALESCE(NULLIF(btrim(o.marca_documento), ''), c.cpf_cnpj, c.documento, ''), '\D', '', 'g') AS doc,
        regexp_replace(COALESCE(NULLIF(btrim(o.marca_telefone), ''), c.whatsapp_principal, c.telefone, ''), '\D', '', 'g') AS tel,
        lower(btrim(COALESCE(NULLIF(btrim(o.marca_email), ''), c.email, ''))) AS email) i
     WHERE pc.tipo = 'entrada' AND o.id <> v_p.id
       AND ((v_doc IS NOT NULL AND length(i.doc) >= 11 AND i.doc = v_doc)
         OR (v_tel IS NOT NULL AND length(i.tel) >= 10 AND right(i.tel, 11) = v_tel)
         OR (v_email IS NOT NULL AND i.email = v_email))) THEN
    RETURN jsonb_build_object('concedido', false, 'motivo', 'Mesmo documento, telefone ou e-mail de quem já recebeu.');
  END IF;

  INSERT INTO public.parceiro_creditos (parceiro_id, tipo, valor, expira_em, descricao, criado_por)
  VALUES (v_p.id, 'entrada', v_prog.entrada_valor, now() + make_interval(days => v_prog.entrada_validade_dias),
          'Crédito de entrada: vale na 1ª compra', auth.uid());

  RETURN jsonb_build_object('concedido', true, 'motivo', NULL, 'valor', v_prog.entrada_valor);
END
$$;
REVOKE ALL ON FUNCTION public._parceiro_conceder_entrada(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._parceiro_conceder_entrada(uuid) TO service_role;

-- A.4 Painel da equipe: dar o crédito a uma lista (parceiros ativos que ainda não compraram).
CREATE OR REPLACE FUNCTION public.parceiro_dar_credito_de_entrada(p_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $$
DECLARE
  v_id uuid; v_r jsonb;
  v_qtd integer := 0; v_total numeric := 0;
  v_negados jsonb := '[]'::jsonb;
BEGIN
  PERFORM public.require_permission('parceiros.manage');
  FOR v_id IN SELECT DISTINCT unnest(COALESCE(p_ids, '{}'::uuid[])) LOOP
    v_r := public._parceiro_conceder_entrada(v_id);  -- criado_por = auth.uid() de quem clicou
    IF (v_r->>'concedido')::boolean THEN
      v_qtd := v_qtd + 1;
      v_total := v_total + (v_r->>'valor')::numeric;
    ELSE
      v_negados := v_negados || jsonb_build_array(jsonb_build_object(
        'parceiro_id', v_id,
        'nome', (SELECT COALESCE(NULLIF(btrim(p.marca_nome), ''), c.nome) FROM public.parceiros p
                   LEFT JOIN public.clientes c ON c.id = p.cliente_id WHERE p.id = v_id),
        'motivo', v_r->>'motivo'));
    END IF;
  END LOOP;
  RETURN jsonb_build_object('concedidos', v_qtd, 'total', v_total, 'negados', v_negados);
END
$$;
REVOKE ALL ON FUNCTION public.parceiro_dar_credito_de_entrada(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.parceiro_dar_credito_de_entrada(uuid[]) TO authenticated, service_role;

-- A.5 Gatilho: concede na ativação, mesma condição de tg_parceiro_boas_vindas.
CREATE OR REPLACE FUNCTION public.tg_parceiro_entrada()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $$
BEGIN
  IF NEW.status <> 'ativo' OR NEW.usuario_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.usuario_id IS NOT NULL AND OLD.status = 'ativo' THEN RETURN NEW; END IF;
  -- Acessório: nunca derruba o cadastro do parceiro.
  BEGIN
    PERFORM public._parceiro_conceder_entrada(NEW.id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'tg_parceiro_entrada: crédito de entrada não concedido ao parceiro %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION public.tg_parceiro_entrada() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER tg_parceiro_entrada
  AFTER INSERT OR UPDATE OF usuario_id, status ON public.parceiros
  FOR EACH ROW EXECUTE FUNCTION public.tg_parceiro_entrada();

-- A.6 parceiro_enviar_pedido: só o teto de crédito muda na 1ª compra (linhas [entrada]).
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
  v_prog public.parceiro_programa%ROWTYPE;  -- [entrada]
  v_teto_pct numeric;                       -- [entrada]
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

  IF v_q.prazo <> 'normal'
     AND NOT EXISTS (SELECT 1 FROM public.prazos_de_entrega WHERE chave = v_q.prazo AND ativo) THEN
    RAISE EXCEPTION 'O prazo escolhido não está disponível. Escolha outro e envie de novo.';
  END IF;

  v_nivel := public.parceiro_nivel(v_parceiro);

  INSERT INTO public.orcamentos (
    cliente_id, vendedor_id, created_by, status, titulo, descricao, observacao_interna,
    aprovado_em, aprovado_por_nome, validade_dias, condicao_pagamento, prazo_tipo
  ) VALUES (
    v_p.cliente_id, v_p.responsavel_id, auth.uid(), 'aprovado',
    left('Pedido de parceiro · ' || v_q.titulo, 200),
    'Pedido feito pelo painel do parceiro revendedor.',
    format('Parceiro nível %s (desconto %s%%). Preços da tabela de parceiro, recalculados pelo sistema no envio. Orçamento nº %s do parceiro.',
           v_nivel->>'nome', v_nivel->>'desconto_pct', v_q.numero),
    now(), left(COALESCE(NULLIF(btrim(v_p.marca_nome), ''), 'Parceiro') || ' (painel do parceiro)', 120),
    7, '{"parcelas": 1}'::jsonb, v_q.prazo
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

  -- A linha da taxa já foi criada pelo gatilho dos itens (recalcular_taxa_prazo), pela mesma regra
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


  SELECT COALESCE(sum(valor_total), 0) INTO v_subtotal FROM public.orcamento_itens WHERE orcamento_id = v_orc;
  UPDATE public.orcamentos SET valor_subtotal = v_subtotal, valor_total = v_subtotal WHERE id = v_orc;

  PERFORM public.parceiro_expirar_creditos(v_parceiro);
  IF COALESCE(p_usar_credito, 0) > 0 THEN
    SELECT COALESCE(sum(valor), 0) INTO v_saldo FROM public.parceiro_creditos WHERE parceiro_id = v_parceiro;
    -- [entrada] Teto geral, igual ao de antes (sem linha no programa = 100%).
    SELECT * INTO v_prog FROM public.parceiro_programa WHERE id;
    v_teto_pct := COALESCE(v_prog.credito_max_pct_pedido, 100);
    -- [entrada] Na 1ª compra (nenhum outro pedido valendo: recusado/expirado devolvem o
    -- crédito em tg_parceiro_pedido_recusado e não contam) com base >= pedido mínimo,
    -- o teto sobe para o da entrada. Sempre % de v_base (só produtos, sem a taxa de prazo).
    IF COALESCE(v_prog.entrada_ativa, false)
       AND v_base >= v_prog.entrada_pedido_minimo
       AND NOT EXISTS (
         SELECT 1 FROM public.parceiro_orcamentos po
           JOIN public.orcamentos o ON o.id = po.pedido_orcamento_id
          WHERE po.parceiro_id = v_parceiro AND po.id <> v_q.id
            AND o.status::text NOT IN ('rejeitado', 'expirado')) THEN
      v_teto_pct := GREATEST(v_teto_pct, v_prog.entrada_max_pct_pedido);
    END IF;
    v_credito := round(LEAST(p_usar_credito, v_saldo, round(v_base * v_teto_pct / 100, 2)), 2);
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


-- A.7 programa_parceiros_publico: acrescenta a chave 'entrada'.
CREATE OR REPLACE FUNCTION public.programa_parceiros_publico()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'niveis', coalesce((SELECT jsonb_agg(jsonb_build_object('nome', n.nome, 'cor', n.cor, 'desconto_pct', n.desconto_pct,
                'compra_minima_90d', n.compra_minima_90d, 'cashback_pct', n.cashback_pct, 'desconto_faixa_pct', n.desconto_faixa_pct) ORDER BY n.ordem)
              FROM public.parceiro_niveis n), '[]'::jsonb),
    'boas_vindas', (SELECT jsonb_build_object('ativa', p.boas_vindas_ativa, 'pct', p.boas_vindas_pct, 'teto', p.boas_vindas_teto, 'validade_dias', p.boas_vindas_validade_dias) FROM public.parceiro_programa p LIMIT 1),
    'indicacao', (SELECT jsonb_build_object('ativa', p.indicacao_ativa, 'pct', p.indicacao_pct, 'teto', p.indicacao_teto, 'compras', p.indicacao_compras) FROM public.parceiro_programa p LIMIT 1),
    'credito_max_pct_pedido', (SELECT p.credito_max_pct_pedido FROM public.parceiro_programa p LIMIT 1),
    -- [entrada] chave nova; as de cima ficam idênticas.
    'entrada', (SELECT jsonb_build_object('ativa', p.entrada_ativa, 'valor', p.entrada_valor, 'validade_dias', p.entrada_validade_dias,
                'pedido_minimo', p.entrada_pedido_minimo, 'max_pct', p.entrada_max_pct_pedido) FROM public.parceiro_programa p LIMIT 1))
$function$;


-- -----------------------------------------------------------------------------
-- DESFAZER A (rodar como um bloco; na ordem)
-- -----------------------------------------------------------------------------
-- Os CHECKs antigos não aceitam linhas 'entrada'. Antes de restaurá-los, decida o
-- destino dessas linhas. Sugestão, que preserva o saldo do parceiro:
--   UPDATE public.parceiro_creditos SET tipo = 'ajuste', descricao = descricao || ' (era entrada)' WHERE tipo = 'entrada';
--
-- CREATE OR REPLACE FUNCTION public.parceiro_enviar_pedido(p_orcamento_id uuid, p_usar_credito numeric)
--  RETURNS jsonb
--  LANGUAGE plpgsql
--  SECURITY DEFINER
--  SET search_path TO 'public'
-- AS $function$
-- DECLARE
--   v_parceiro uuid := public.parceiro_do_usuario();
--   v_p public.parceiros%ROWTYPE;
--   v_q public.parceiro_orcamentos%ROWTYPE;
--   v_nivel jsonb;
--   v_orc uuid;
--   v_numero integer;
--   v_item record;
--   v_preco record;
--   v_faixa jsonb;
--   v_preco_un numeric;
--   v_custo_un numeric;
--   v_area_peca numeric;
--   v_n_itens integer := 0;
--   v_livres integer := 0;
--   v_subtotal numeric;
--   v_base numeric;
--   v_taxa numeric := 0;
--   v_taxa_pct numeric := 0;
--   v_taxa_nome text;
--   v_saldo numeric;
--   v_credito numeric := 0;
-- BEGIN
--   IF v_parceiro IS NULL THEN
--     RAISE EXCEPTION 'Acesso de parceiro não encontrado ou suspenso.' USING ERRCODE = '42501';
--   END IF;
--   SELECT * INTO v_p FROM public.parceiros WHERE id = v_parceiro;
--   SELECT * INTO v_q FROM public.parceiro_orcamentos
--    WHERE id = p_orcamento_id AND parceiro_id = v_parceiro FOR UPDATE;
--   IF NOT FOUND THEN RAISE EXCEPTION 'Orçamento não encontrado.'; END IF;
--   IF v_q.pedido_orcamento_id IS NOT NULL OR v_q.status = 'pedido_feito' THEN
--     RAISE EXCEPTION 'Este orçamento já virou pedido.';
--   END IF;
--   IF v_q.status = 'perdido' THEN
--     RAISE EXCEPTION 'Orçamento marcado como perdido não vira pedido. Reabra antes.';
--   END IF;
--   IF v_p.responsavel_id IS NULL THEN
--     RAISE EXCEPTION 'Seu cadastro ainda não tem um atendente na gráfica. Fale com a equipe antes do primeiro pedido.';
--   END IF;
-- 
--   IF v_q.prazo <> 'normal'
--      AND NOT EXISTS (SELECT 1 FROM public.prazos_de_entrega WHERE chave = v_q.prazo AND ativo) THEN
--     RAISE EXCEPTION 'O prazo escolhido não está disponível. Escolha outro e envie de novo.';
--   END IF;
-- 
--   v_nivel := public.parceiro_nivel(v_parceiro);
-- 
--   INSERT INTO public.orcamentos (
--     cliente_id, vendedor_id, created_by, status, titulo, descricao, observacao_interna,
--     aprovado_em, aprovado_por_nome, validade_dias, condicao_pagamento, prazo_tipo
--   ) VALUES (
--     v_p.cliente_id, v_p.responsavel_id, auth.uid(), 'aprovado',
--     left('Pedido de parceiro · ' || v_q.titulo, 200),
--     'Pedido feito pelo painel do parceiro revendedor.',
--     format('Parceiro nível %s (desconto %s%%). Preços da tabela de parceiro, recalculados pelo sistema no envio. Orçamento nº %s do parceiro.',
--            v_nivel->>'nome', v_nivel->>'desconto_pct', v_q.numero),
--     now(), left(COALESCE(NULLIF(btrim(v_p.marca_nome), ''), 'Parceiro') || ' (painel do parceiro)', 120),
--     7, '{"parcelas": 1}'::jsonb, v_q.prazo
--   ) RETURNING id, numero INTO v_orc, v_numero;
-- 
--   FOR v_item IN
--     SELECT * FROM public.parceiro_orcamento_itens WHERE orcamento_id = v_q.id ORDER BY ordem, created_at
--   LOOP
--     IF v_item.produto_id IS NULL THEN
--       v_livres := v_livres + 1;
--       CONTINUE;
--     END IF;
-- 
--     SELECT * INTO v_preco FROM public.parceiro_precos(v_parceiro) pr WHERE pr.produto_id = v_item.produto_id;
--     IF NOT FOUND THEN
--       RAISE EXCEPTION '"%" não está disponível na tabela de parceiro.', v_item.descricao;
--     END IF;
--     IF v_preco.por_area AND (COALESCE(v_item.largura, 0) <= 0 OR COALESCE(v_item.altura, 0) <= 0) THEN
--       RAISE EXCEPTION '"%" é vendido por m² e precisa de largura e altura.', v_item.descricao;
--     END IF;
-- 
--     IF v_preco.faixas IS NOT NULL THEN
--       v_faixa := NULL;
--       SELECT f INTO v_faixa FROM jsonb_array_elements(v_preco.faixas) f
--        WHERE (f->>'quantidade_minima')::integer <= ceil(v_item.quantidade)
--        ORDER BY (f->>'quantidade_minima')::integer DESC LIMIT 1;
--       IF v_faixa IS NULL THEN
--         RAISE EXCEPTION '"%" tem pedido mínimo de % unidades.', v_item.descricao, v_preco.faixas->0->>'quantidade_minima';
--       END IF;
--       v_preco_un := (v_faixa->>'preco_parceiro')::numeric;
--     ELSE
--       v_preco_un := v_preco.preco_parceiro;
--     END IF;
-- 
--     v_area_peca := CASE WHEN v_preco.por_area
--                         THEN GREATEST(round(v_item.largura * v_item.altura, 3), COALESCE(v_preco.area_minima, 0)) END;
--     SELECT CASE WHEN v_preco.por_area THEN round(COALESCE(p.custo_medio, 0) * v_area_peca, 2)
--                 ELSE COALESCE(p.custo_medio, 0) END
--       INTO v_custo_un FROM public.produtos p WHERE p.id = v_item.produto_id;
-- 
--     INSERT INTO public.orcamento_itens (
--       orcamento_id, produto_id, descricao, unidade, quantidade, largura, altura, acabamento,
--       preco_m2, valor_unitario, custo_unitario, ordem, origem_calculo, produto_snapshot
--     ) VALUES (
--       v_orc, v_item.produto_id, v_item.descricao, v_preco.unidade, v_item.quantidade,
--       v_item.largura, v_item.altura, v_item.acabamento,
--       CASE WHEN v_preco.por_area THEN v_preco_un END,
--       CASE WHEN v_preco.por_area THEN 0 ELSE v_preco_un END,
--       COALESCE(v_custo_un, 0), v_n_itens, 'tabela_parceiro',
--       jsonb_build_object('origem', 'parceiro', 'nivel', v_nivel->>'nome',
--                          'desconto_pct', v_nivel->'desconto_pct', 'preco_referencia', v_preco.preco_referencia,
--                          'preco_parceiro_unidade', v_preco_un, 'origem_preco', v_preco.origem)
--     );
--     v_n_itens := v_n_itens + 1;
--   END LOOP;
-- 
--   IF v_n_itens = 0 THEN
--     RAISE EXCEPTION 'Nenhum item deste orçamento é produto da gráfica. Itens livres entram só no seu PDF.';
--   END IF;
-- 
--   -- A linha da taxa já foi criada pelo gatilho dos itens (recalcular_taxa_prazo), pela mesma regra
--   -- do orçamento da equipe. Aqui só se lê o que ela deu: a base (produtos) e a taxa.
--   SELECT COALESCE(sum(valor_total) FILTER (WHERE origem_calculo IS DISTINCT FROM 'taxa_prazo'), 0),
--          COALESCE(sum(valor_total) FILTER (WHERE origem_calculo = 'taxa_prazo'), 0)
--     INTO v_base, v_taxa
--     FROM public.orcamento_itens WHERE orcamento_id = v_orc;
-- 
--   IF v_taxa > 0 THEN
--     SELECT nome, taxa_percentual INTO v_taxa_nome, v_taxa_pct
--       FROM public.prazos_de_entrega WHERE chave = v_q.prazo;
--     UPDATE public.orcamentos SET observacao_interna = observacao_interna ||
--       format(' · %s: +%s%% sobre os produtos (R$ %s). Produção prioritária.', upper(v_taxa_nome),
--              regexp_replace(to_char(v_taxa_pct, 'FM990.00'), '\.?0+$', ''),
--              replace(to_char(v_taxa, 'FM999999990.00'), '.', ','))
--     WHERE id = v_orc;
--   END IF;
-- 
-- 
--   SELECT COALESCE(sum(valor_total), 0) INTO v_subtotal FROM public.orcamento_itens WHERE orcamento_id = v_orc;
--   UPDATE public.orcamentos SET valor_subtotal = v_subtotal, valor_total = v_subtotal WHERE id = v_orc;
-- 
--   PERFORM public.parceiro_expirar_creditos(v_parceiro);
--   IF COALESCE(p_usar_credito, 0) > 0 THEN
--     SELECT COALESCE(sum(valor), 0) INTO v_saldo FROM public.parceiro_creditos WHERE parceiro_id = v_parceiro;
--     v_credito := round(LEAST(p_usar_credito, v_saldo, round(v_base * COALESCE((SELECT credito_max_pct_pedido FROM public.parceiro_programa WHERE id), 100) / 100, 2)), 2);
--     IF v_credito > 0 THEN
--       INSERT INTO public.parceiro_creditos (parceiro_id, tipo, valor, parceiro_orcamento_id, descricao, criado_por)
--       VALUES (v_parceiro, 'uso', -v_credito, v_q.id, format('Reservado para o pedido nº %s', v_numero), auth.uid());
--       UPDATE public.orcamentos SET
--         condicao_pagamento = jsonb_build_object('parcelas', 1, 'credito_parceiro', v_credito),
--         observacao_interna = observacao_interna ||
--           format(' · Crédito do parceiro de R$ %s JÁ ABATIDO como desconto deste pedido — não descontar de novo.', replace(to_char(v_credito, 'FM999999990.00'), '.', ','))
--       WHERE id = v_orc;
--     ELSE
--       v_credito := 0;
--     END IF;
--   END IF;
-- 
--   UPDATE public.parceiro_orcamentos
--      SET status = 'pedido_feito', pedido_orcamento_id = v_orc, credito_usado = v_credito, updated_at = now()
--    WHERE id = v_q.id;
-- 
--   RETURN jsonb_build_object(
--     'orcamento_id', v_orc, 'numero', v_numero, 'itens', v_n_itens,
--     'itens_livres_fora_do_pedido', v_livres, 'total', v_subtotal, 'credito_usado', v_credito,
--     'prazo', v_q.prazo, 'taxa_prazo', v_taxa
--   );
-- END
-- $function$;
--
-- CREATE OR REPLACE FUNCTION public.programa_parceiros_publico()
--  RETURNS jsonb
--  LANGUAGE sql
--  STABLE SECURITY DEFINER
--  SET search_path TO 'public'
-- AS $function$
--   SELECT jsonb_build_object(
--     'niveis', coalesce((SELECT jsonb_agg(jsonb_build_object('nome', n.nome, 'cor', n.cor, 'desconto_pct', n.desconto_pct,
--                 'compra_minima_90d', n.compra_minima_90d, 'cashback_pct', n.cashback_pct, 'desconto_faixa_pct', n.desconto_faixa_pct) ORDER BY n.ordem)
--               FROM public.parceiro_niveis n), '[]'::jsonb),
--     'boas_vindas', (SELECT jsonb_build_object('ativa', p.boas_vindas_ativa, 'pct', p.boas_vindas_pct, 'teto', p.boas_vindas_teto, 'validade_dias', p.boas_vindas_validade_dias) FROM public.parceiro_programa p LIMIT 1),
--     'indicacao', (SELECT jsonb_build_object('ativa', p.indicacao_ativa, 'pct', p.indicacao_pct, 'teto', p.indicacao_teto, 'compras', p.indicacao_compras) FROM public.parceiro_programa p LIMIT 1),
--     'credito_max_pct_pedido', (SELECT p.credito_max_pct_pedido FROM public.parceiro_programa p LIMIT 1))
-- $function$;
--
-- DROP TRIGGER IF EXISTS tg_parceiro_entrada ON public.parceiros;
-- DROP FUNCTION IF EXISTS public.tg_parceiro_entrada();
-- DROP FUNCTION IF EXISTS public.parceiro_dar_credito_de_entrada(uuid[]);
-- DROP FUNCTION IF EXISTS public._parceiro_conceder_entrada(uuid);
-- DROP INDEX IF EXISTS public.parceiro_creditos_entrada_unica;
-- ALTER TABLE public.parceiro_creditos DROP CONSTRAINT parceiro_creditos_tipo_check;
-- ALTER TABLE public.parceiro_creditos ADD CONSTRAINT parceiro_creditos_tipo_check
--   CHECK ((tipo = ANY (ARRAY['cashback'::text, 'recompensa'::text, 'uso'::text, 'estorno_uso'::text, 'ajuste'::text, 'boas_vindas'::text, 'indicacao'::text, 'expirado'::text])));
-- ALTER TABLE public.parceiro_creditos DROP CONSTRAINT parceiro_creditos_check;
-- ALTER TABLE public.parceiro_creditos ADD CONSTRAINT parceiro_creditos_check
--   CHECK (((tipo <> ALL (ARRAY['cashback'::text, 'recompensa'::text, 'estorno_uso'::text, 'boas_vindas'::text, 'indicacao'::text])) OR (valor > (0)::numeric)));
-- ALTER TABLE public.parceiro_programa
--   DROP CONSTRAINT parceiro_programa_entrada_minimo_check,
--   DROP COLUMN entrada_max_pct_pedido, DROP COLUMN entrada_pedido_minimo,
--   DROP COLUMN entrada_validade_dias, DROP COLUMN entrada_valor, DROP COLUMN entrada_ativa;
--
-- Testes manuais sugeridos (A), com parceiro fictício em ambiente de teste:
--   1) SELECT public.programa_parceiros_publico()->'entrada';  -- {ativa:true, valor:50, ...}
--   2) Ativar parceiro de teste com login: 1 linha 'entrada' de +50, expira em 30 dias.
--   3) Repetir a ativação: continua 1 linha (índice único + checagem).
--   4) Pedido de R$ 149,99 na 1ª compra: crédito até 15% (22,50). Pedido de R$ 150: até 75,00.
--   5) Recusar o 1º pedido (status 'rejeitado'): estorno do 'uso'; o próximo volta a ser 1ª compra.
--   6) UPDATE parceiro_programa SET entrada_max_pct_pedido = 51  -> erro do CHECK.


-- #############################################################################
-- SEÇÃO B — ATENDENTE PADRÃO
-- #############################################################################

-- B.1 Quem recebe os parceiros sem atendente. Começa NULO (definir com o dono).
-- Herda a política de escrita por tabela (parceiros.manage), como em A.1.
ALTER TABLE public.parceiro_programa
  ADD COLUMN atendente_padrao_id uuid NULL REFERENCES public.usuarios(id) ON DELETE SET NULL;

-- B.2 Gatilho: parceiro ativo sem atendente recebe o padrão (se for usuário ativo).
-- Nome "ab_" para rodar depois de aa_parceiro_codigo_convite (BEFORE em ordem alfabética).
CREATE OR REPLACE FUNCTION public.tg_parceiro_atendente_padrao()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $$
DECLARE v_atendente uuid;
BEGIN
  IF NEW.status <> 'ativo' OR NEW.responsavel_id IS NOT NULL THEN RETURN NEW; END IF;
  BEGIN
    SELECT u.id INTO v_atendente
      FROM public.parceiro_programa pp
      JOIN public.usuarios u ON u.id = pp.atendente_padrao_id AND u.ativo
     WHERE pp.id LIMIT 1;
    IF v_atendente IS NOT NULL THEN NEW.responsavel_id := v_atendente; END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'tg_parceiro_atendente_padrao: atendente não definido para o parceiro %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION public.tg_parceiro_atendente_padrao() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER ab_parceiro_atendente_padrao
  BEFORE INSERT OR UPDATE OF status, usuario_id ON public.parceiros
  FOR EACH ROW EXECUTE FUNCTION public.tg_parceiro_atendente_padrao();

-- B.3 Painel da equipe: atribuir o padrão aos que estão sem atendente.
CREATE OR REPLACE FUNCTION public.parceiros_atribuir_atendente_padrao(p_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $$
DECLARE v_atendente uuid; v_qtd integer;
BEGIN
  PERFORM public.require_permission('parceiros.manage');
  SELECT u.id INTO v_atendente
    FROM public.parceiro_programa pp
    JOIN public.usuarios u ON u.id = pp.atendente_padrao_id AND u.ativo
   WHERE pp.id LIMIT 1;
  IF v_atendente IS NULL THEN
    RAISE EXCEPTION 'Defina um atendente padrão ativo na aba Programa antes.';
  END IF;
  UPDATE public.parceiros
     SET responsavel_id = v_atendente
   WHERE id = ANY (COALESCE(p_ids, '{}'::uuid[]))
     AND responsavel_id IS NULL AND status = 'ativo';
  GET DIAGNOSTICS v_qtd = ROW_COUNT;
  RETURN v_qtd;
END
$$;
REVOKE ALL ON FUNCTION public.parceiros_atribuir_atendente_padrao(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.parceiros_atribuir_atendente_padrao(uuid[]) TO authenticated, service_role;

-- B.4 parceiros_pendentes: sai só a janela de 14 dias da 2ª condição.
CREATE OR REPLACE FUNCTION public.parceiros_pendentes()
 RETURNS TABLE(id uuid, nome text, documento text, telefone text, email text, cidade text, estado text, convidado_por text, criado_em timestamp with time zone, tem_login boolean, status text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.require_permission('parceiros.read');
  RETURN QUERY
  SELECT p.id,
         coalesce(nullif(btrim(p.marca_nome),''), c.nome),
         p.marca_documento, p.marca_telefone, p.marca_email,
         p.marca_cidade, p.marca_estado,
         coalesce(nullif(btrim(padrinho.marca_nome),''), pc.nome, 'cadastro direto'),
         p.created_at,
         p.usuario_id IS NOT NULL,
         p.status
  FROM public.parceiros p
  LEFT JOIN public.clientes c ON c.id = p.cliente_id
  LEFT JOIN public.parceiros padrinho ON padrinho.id = p.indicado_por
  LEFT JOIN public.clientes pc ON pc.id = padrinho.cliente_id
  WHERE p.status = 'pendente'
     OR (p.status = 'ativo' AND p.responsavel_id IS NULL)  -- [atendente] sem a janela de 14 dias
  ORDER BY p.created_at;
END;
$function$;


-- -----------------------------------------------------------------------------
-- DESFAZER B (rodar como um bloco). Os responsáveis já atribuídos ficam: são
-- dados de atendimento reais; desfazer não os apaga.
-- -----------------------------------------------------------------------------
-- CREATE OR REPLACE FUNCTION public.parceiros_pendentes()
--  RETURNS TABLE(id uuid, nome text, documento text, telefone text, email text, cidade text, estado text, convidado_por text, criado_em timestamp with time zone, tem_login boolean, status text)
--  LANGUAGE plpgsql
--  STABLE SECURITY DEFINER
--  SET search_path TO 'public'
-- AS $function$
-- BEGIN
--   PERFORM public.require_permission('parceiros.read');
--   RETURN QUERY
--   SELECT p.id,
--          coalesce(nullif(btrim(p.marca_nome),''), c.nome),
--          p.marca_documento, p.marca_telefone, p.marca_email,
--          p.marca_cidade, p.marca_estado,
--          coalesce(nullif(btrim(padrinho.marca_nome),''), pc.nome, 'cadastro direto'),
--          p.created_at,
--          p.usuario_id IS NOT NULL,
--          p.status
--   FROM public.parceiros p
--   LEFT JOIN public.clientes c ON c.id = p.cliente_id
--   LEFT JOIN public.parceiros padrinho ON padrinho.id = p.indicado_por
--   LEFT JOIN public.clientes pc ON pc.id = padrinho.cliente_id
--   WHERE p.status = 'pendente'
--      OR (p.status = 'ativo' AND p.responsavel_id IS NULL AND p.created_at > now() - interval '14 days')
--   ORDER BY p.created_at;
-- END;
-- $function$;
--
-- DROP FUNCTION IF EXISTS public.parceiros_atribuir_atendente_padrao(uuid[]);
-- DROP TRIGGER IF EXISTS ab_parceiro_atendente_padrao ON public.parceiros;
-- DROP FUNCTION IF EXISTS public.tg_parceiro_atendente_padrao();
-- ALTER TABLE public.parceiro_programa DROP COLUMN atendente_padrao_id;
--
-- Testes manuais sugeridos (B):
--   1) Com atendente_padrao_id NULO, ativar parceiro: responsavel_id continua NULO.
--   2) Definir um usuário ativo e ativar outro parceiro: recebe o padrão.
--   3) Parceiro com responsável já definido: não é trocado.
--   4) SELECT * FROM parceiros_pendentes(): os cadastros de 23/10 e 03/11 voltam à fila.
