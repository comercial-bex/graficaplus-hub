-- =====================================================================================================
-- APLICADA em 15/11/2026 (drizzle 0013_parceiro_sempre_atendido). Seções A, B e C. Sem BEGIN/COMMIT. Backfill NÃO rodado.
-- ATENÇÃO: prefixo 20261115140000 já usado por 20261115140000_maquina_na_fila_e_validacao_sem_atalho.sql.
-- Nome solicitado preservado para revisão; resolver colisão antes de autorizar aplicação.
-- Revisada em 15/11/2026. NÃO APLICAR sem nova autorização; não rodar backfill nem publicar.
-- Arquivo pronto: supabase/migrations/20261115160000_parceiro_sempre_atendido.sql.
-- Não altera funções do WhatsApp/triagem; altera somente as funções de parceiro indicadas em B/C.
-- Hash = md5(btrim(regexp_replace(prosrc, '\s+', ' ', 'g'))) — o mesmo método que dá d8b83a6f… para
-- parceiro_enviar_pedido.
--
-- FUNÇÕES E HASHES RECONFERIDOS NO BANCO VIVO (15/11/2026, leitura apenas)
-- _parceiro_conceder_entrada: f7003bea46eef29008ce69dc21a08168; parceiro_enviar_pedido: d8b83a6fc83e950b63e69c746881e2f8.
-- Ambas SECURITY DEFINER, search_path=public; ACL preservadas por CREATE OR REPLACE.
-- Concessão: só service_role; pedido: authenticated + service_role (além do proprietário).
-- Contagens/instância/atendente abaixo são a fotografia de 14/11, não uma nova medição.
--  1. _wa_abrir_atendimento: md5 vivo b7cb044a43f39067edada667b581caeb. O corpo vivo é igual ao da
--     drizzle 0002 (copiado abaixo, só para referência; esta proposta NÃO o altera).
--     Com origem 'manual' ela não zera responsável nem modo; é idempotente (devolve o aberto).
--  2. Ela NÃO grava em whatsapp_conversa_eventos (só insere o atendimento e atualiza a conversa).
--  3. Aviso ao grupo (tg_atendimento_avisa_grupo, md5 vivo b9c0b4f7ba5d698552138ab05d29fc3e): a
--     primeira linha é `IF v_grupo IS NULL OR NEW.origem_abertura::text = 'manual' THEN RETURN NEW`.
--     ATENÇÃO: um atendimento aberto como 'manual' NÃO gera aviso nenhum. Se gerasse (origem não
--     manual), com tipo_contato 'parceiro' + origem_do_tipo 'telefone' o título seria "🤝 PARCEIRO" e o
--     preço "parceiro, nível X" (cliente ligado) ou "parceiro cadastrado, falta ligar o cliente".
--     Como a regra pede para não mexer no aviso, o backfill gera 0 avisos. Ver "decisão pendente".
--  4. Fila de notificações: enfileirar_notificacao só insere em notificacoes_fila. O despachante
--     (src/lib/api/whatsapp-enviar.server.ts) manda até ZAPI_LIMITE_POR_RODADA por rodada (job de
--     2 min), espera se o WhatsApp estiver desconectado e só confere horário útil na COBRANÇA de
--     orçamento. Os demais avisos (inclusive o do grupo) saem a qualquer hora, sem espaçamento próprio.
--  5. telefone_normalizado em whatsapp_conversas é coluna gerada = normalize_whatsapp_phone(telefone),
--     que tira o 55 e põe o nono dígito em celular de 10 dígitos. Casar por ela cobre as variantes
--     com/sem 55 e com/sem nono dígito. Índice único (instancia_id, telefone_normalizado).
--  6. Instância: 1 linha, ativa e conectada.
--  7. Parceiros: 17 ativos, 17 com responsavel_id, 17 com celular válido; 13 já têm conversa e
--     0 têm atendimento aberto. Backfill = 4 conversas novas (vazias) + 17 atendimentos 'manual'.
--  8. parceiro_programa.atendente_padrao_id está preenchido com usuário ativo (o gatilho da seção B
--     não trava a tabela no estado atual).
--
-- DECISÃO CONFIRMADA (15/11): manter origem 'manual' e o aviso ao grupo intacto.
-- Atendimentos manuais continuam gerando 0 avisos ao grupo e 0 mensagens ao parceiro.
-- =====================================================================================================

-- Referência: corpo vivo de _wa_abrir_atendimento (NÃO é executado; está comentado).
-- CREATE OR REPLACE FUNCTION public._wa_abrir_atendimento(p_conversa_id uuid, p_origem whatsapp_origem_abertura, p_usuario uuid)
--  RETURNS uuid
--  LANGUAGE plpgsql
--  SECURITY DEFINER
--  SET search_path TO 'public'
-- AS $function$
-- DECLARE v_id uuid; v_anterior uuid; v_fila public.whatsapp_fila;
-- BEGIN
--   SELECT id INTO v_id FROM public.whatsapp_atendimentos WHERE conversa_id = p_conversa_id AND fechado_em IS NULL;
--   IF v_id IS NOT NULL THEN RETURN v_id; END IF;
--   SELECT id INTO v_anterior FROM public.whatsapp_atendimentos WHERE conversa_id = p_conversa_id ORDER BY aberto_em DESC LIMIT 1;
--   SELECT fila INTO v_fila FROM public.whatsapp_conversas WHERE id = p_conversa_id;
--   INSERT INTO public.whatsapp_atendimentos (conversa_id, numero, fila, aberto_por, origem_abertura, reaberto_de)
--   VALUES (p_conversa_id, public.whatsapp_proximo_numero_atendimento(), coalesce(v_fila,'comercial'), p_usuario,
--           CASE WHEN p_origem = 'mensagem_recebida' AND v_anterior IS NOT NULL THEN 'reaberto'::public.whatsapp_origem_abertura ELSE p_origem END,
--           v_anterior)
--   ON CONFLICT (conversa_id) WHERE fechado_em IS NULL DO NOTHING
--   RETURNING id INTO v_id;
--   IF v_id IS NULL THEN
--     SELECT id INTO v_id FROM public.whatsapp_atendimentos WHERE conversa_id = p_conversa_id AND fechado_em IS NULL;
--   END IF;
--   UPDATE public.whatsapp_conversas
--      SET atendimento_ativo_id = v_id,
--          responsavel_id = CASE WHEN v_anterior IS NOT NULL AND p_origem = 'mensagem_recebida' THEN NULL ELSE responsavel_id END,
--          modo = CASE WHEN v_anterior IS NOT NULL AND p_origem = 'mensagem_recebida' THEN 'auto'::public.whatsapp_modo ELSE modo END
--    WHERE id = p_conversa_id;
--   RETURN v_id;
-- END $function$;

-- =====================================================================================================
-- SEÇÃO A — CHAMADO AUTOMÁTICO (só objetos novos; nenhuma função existente muda)
-- =====================================================================================================

-- Telefone do parceiro: marca_telefone; senão whatsapp_principal / telefone do cliente ligado.
-- Devolve o número normalizado (11 dígitos, sem 55) só se for celular (3º dígito 9); senão NULL.
CREATE OR REPLACE FUNCTION public._parceiro_celular(p_parceiro uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN n ~ '^[1-9][0-9]9[0-9]{8}$' THEN n END
    FROM (SELECT public.normalize_whatsapp_phone(COALESCE(
                   nullif(btrim(p.marca_telefone), ''),
                   nullif(btrim(c.whatsapp_principal), ''),
                   nullif(btrim(c.telefone), ''))) AS n
            FROM public.parceiros p LEFT JOIN public.clientes c ON c.id = p.cliente_id
           WHERE p.id = p_parceiro) t
$$;
REVOKE ALL ON FUNCTION public._parceiro_celular(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._parceiro_celular(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public._parceiro_garantir_chamado(p_parceiro uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_p public.parceiros%ROWTYPE;
  v_n text;
  v_inst uuid;
  v_conv uuid;
  v_at uuid;
BEGIN
  BEGIN
    SELECT * INTO v_p FROM public.parceiros WHERE id = p_parceiro;
    IF NOT FOUND OR v_p.status <> 'ativo' OR v_p.responsavel_id IS NULL THEN RETURN NULL; END IF;
    v_n := public._parceiro_celular(p_parceiro);
    IF v_n IS NULL THEN RETURN NULL; END IF;

    -- Conversa existente pelo número normalizado (cobre 55 e nono dígito); prefere a instância ativa.
    SELECT w.id INTO v_conv
      FROM public.whatsapp_conversas w
      LEFT JOIN public.whatsapp_instancias i ON i.id = w.instancia_id
     WHERE w.telefone_normalizado = v_n
     ORDER BY (i.ativa IS TRUE) DESC, w.ultima_mensagem_at DESC NULLS LAST
     LIMIT 1;

    IF v_conv IS NULL THEN
      SELECT id INTO v_inst FROM public.whatsapp_instancias
       WHERE ativa ORDER BY (status::text = 'conectada') DESC LIMIT 1;
      IF v_inst IS NULL THEN
        RAISE WARNING 'chamado do parceiro %: nenhuma instância ativa', p_parceiro;
        RETURN NULL;
      END IF;
      -- Conversa vazia: nenhuma mensagem é inserida nem enfileirada.
      INSERT INTO public.whatsapp_conversas (instancia_id, telefone, nome_contato, cliente_id, responsavel_id)
      VALUES (v_inst, '55' || v_n, nullif(btrim(v_p.marca_nome), ''), v_p.cliente_id, v_p.responsavel_id)
      ON CONFLICT (instancia_id, telefone_normalizado) DO NOTHING
      RETURNING id INTO v_conv;
      IF v_conv IS NULL THEN
        SELECT id INTO v_conv FROM public.whatsapp_conversas
         WHERE instancia_id = v_inst AND telefone_normalizado = v_n;
      END IF;
    END IF;

    -- O tipo entra já na inserção do atendimento pelo gatilho existente tg_atendimento_traz_contexto.
    PERFORM set_config('bex.contato_ctx', jsonb_build_object(
      'conversa_id', v_conv, 'tipo', 'parceiro', 'origem_do_tipo', 'telefone')::text, true);
    v_at := public._wa_abrir_atendimento(v_conv, 'manual', v_p.responsavel_id);
    PERFORM set_config('bex.contato_ctx', '', true);

    -- Só onde está vazio: quem já tem tipo ou responsável não é trocado.
    UPDATE public.whatsapp_atendimentos
       SET origem_do_tipo = CASE WHEN tipo_contato IS NULL THEN 'telefone' ELSE origem_do_tipo END,
           tipo_contato   = COALESCE(tipo_contato, 'parceiro'),
           responsavel_id = COALESCE(responsavel_id, v_p.responsavel_id)
     WHERE id = v_at;
    UPDATE public.whatsapp_conversas
       SET responsavel_id = COALESCE(responsavel_id, v_p.responsavel_id),
           cliente_id     = COALESCE(cliente_id, v_p.cliente_id)
     WHERE id = v_conv;
    RETURN v_at;
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('bex.contato_ctx', '', true);
    RAISE WARNING 'chamado do parceiro % falhou: % [%]', p_parceiro, SQLERRM, SQLSTATE;
    RETURN NULL;
  END;
END $$;
REVOKE ALL ON FUNCTION public._parceiro_garantir_chamado(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._parceiro_garantir_chamado(uuid) TO service_role;
COMMENT ON FUNCTION public._parceiro_garantir_chamado(uuid) IS
  'Interna: garante conversa + atendimento aberto (manual, tipo parceiro, responsável = atendente) para o celular do parceiro ativo. Idempotente; nunca envia mensagem; erro vira WARNING.';

CREATE OR REPLACE FUNCTION public.tg_parceiro_chamado()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_n text;
  v_conv uuid;
BEGIN
  -- Ativo + responsável + celular válido; login não é exigido.
  IF NEW.status = 'ativo' AND NEW.responsavel_id IS NOT NULL THEN
    IF TG_OP = 'UPDATE' THEN
      IF OLD.responsavel_id IS NOT NULL
         AND OLD.responsavel_id IS DISTINCT FROM NEW.responsavel_id THEN
        v_n := public._parceiro_celular(NEW.id);
        IF v_n IS NULL THEN RETURN NULL; END IF;
        -- Mesmo critério da função de garantia; não abre/reabre para redistribuir.
        SELECT w.id INTO v_conv
          FROM public.whatsapp_conversas w
          LEFT JOIN public.whatsapp_instancias i ON i.id = w.instancia_id
         WHERE w.telefone_normalizado = v_n
         ORDER BY (i.ativa IS TRUE) DESC, w.ultima_mensagem_at DESC NULLS LAST
         LIMIT 1;
        -- Atualizações independentes e condicionais: preservar quem a equipe já assumiu.
        UPDATE public.whatsapp_atendimentos
           SET responsavel_id = NEW.responsavel_id
         WHERE conversa_id = v_conv AND fechado_em IS NULL
           AND responsavel_id = OLD.responsavel_id;
        UPDATE public.whatsapp_conversas
           SET responsavel_id = NEW.responsavel_id
         WHERE id = v_conv AND responsavel_id = OLD.responsavel_id;
        -- Sem chamado aberto (ou sem conversa), garantir normalmente.
        IF NOT EXISTS (SELECT 1 FROM public.whatsapp_atendimentos
                        WHERE conversa_id = v_conv AND fechado_em IS NULL) THEN
          PERFORM public._parceiro_garantir_chamado(NEW.id);
        END IF;
      ELSIF OLD.status IS DISTINCT FROM 'ativo'
         OR OLD.responsavel_id IS NULL
         OR OLD.marca_telefone IS DISTINCT FROM NEW.marca_telefone THEN
        PERFORM public._parceiro_garantir_chamado(NEW.id);
      END IF;
    ELSE
      PERFORM public._parceiro_garantir_chamado(NEW.id);
    END IF;
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'gatilho do chamado do parceiro % falhou: %', NEW.id, SQLERRM;
  RETURN NULL;
END $$;
-- TESTE DE MESA (dados fictícios; não executar em produção): parceiro ativo X -> Y.
-- atendimento ABERTO=X, conversa=X: ambos Y; mesmo atendimento/id, sem novo chamado.
-- atendimento ABERTO=Z, conversa=Z (equipe assumiu): ambos Z, nenhuma troca.
-- atendimento ABERTO=X, conversa=Z: somente atendimento Y; conversa Z preservada.
-- atendimento ABERTO=Z, conversa=X: somente conversa Y; atendimento Z preservado.
-- responsável atual NULL: não sincroniza NULL -> Y; fechado_em preenchido: histórico intacto.
-- sem atendimento aberto: garantir chamado normalmente; repetir Y -> Y não faz nada.
-- X/NULL ou NULL/Y não são redistribuição; NULL/Y continua garantindo chamado.
-- parceiro inativo ou celular inválido: nada muda; erro: WARNING, cadastro não cai.
REVOKE ALL ON FUNCTION public.tg_parceiro_chamado() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER tg_parceiro_chamado
  AFTER INSERT OR UPDATE OF status, responsavel_id, marca_telefone ON public.parceiros
  FOR EACH ROW EXECUTE FUNCTION public.tg_parceiro_chamado();

-- BACKFILL (NÃO RODAR AGORA; rodar à mão em horário comercial, depois de aplicar a seção A).
-- Medido em 14/11: 17 parceiros elegíveis → 4 conversas novas (vazias) e 17 atendimentos 'manual'.
-- Avisos ao grupo da equipe: 0 (o aviso ignora atendimento 'manual'; ver topo). Mensagens ao parceiro: 0.
-- Idempotente: rodar de novo não abre outro atendimento.
-- SELECT p.id, public._parceiro_garantir_chamado(p.id)
--   FROM public.parceiros p
--  WHERE p.status = 'ativo' AND p.responsavel_id IS NOT NULL;

-- =====================================================================================================
-- SEÇÃO B — NUNCA SEM ATENDENTE
-- =====================================================================================================

CREATE OR REPLACE FUNCTION public.tg_parceiro_programa_exige_atendente()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.atendente_padrao_id IS NULL THEN
    RAISE EXCEPTION 'Escolha o atendente padrão: todo parceiro precisa de alguém da equipe para atender.'
      USING ERRCODE = '23502';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.usuarios WHERE id = NEW.atendente_padrao_id AND ativo) THEN
    RAISE EXCEPTION 'O atendente padrão escolhido está inativo. Escolha uma pessoa ativa da equipe.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.tg_parceiro_programa_exige_atendente() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER tg_parceiro_programa_exige_atendente
  BEFORE UPDATE ON public.parceiro_programa
  FOR EACH ROW EXECUTE FUNCTION public.tg_parceiro_programa_exige_atendente();

-- parceiro_enviar_pedido: md5 vivo d8b83a6fc83e950b63e69c746881e2f8. Um só corpo: blocos marcados
-- [sempre-atendido] antes da recusa e [primeira-compra] no teto da entrada. Atenção: o UPDATE do responsável dispara tg_parceiro_entrada
-- (pode conceder o crédito de entrada nesse momento) e tg_parceiro_chamado (abre o chamado).
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
  -- [sempre-atendido] sem atendente: preenche com o atendente padrão ativo antes de recusar.
  IF v_p.responsavel_id IS NULL THEN                                                    -- [sempre-atendido]
    SELECT pp.atendente_padrao_id INTO v_p.responsavel_id                               -- [sempre-atendido]
      FROM public.parceiro_programa pp                                                  -- [sempre-atendido]
      JOIN public.usuarios u ON u.id = pp.atendente_padrao_id AND u.ativo               -- [sempre-atendido]
     LIMIT 1;                                                                           -- [sempre-atendido]
    IF v_p.responsavel_id IS NOT NULL THEN                                              -- [sempre-atendido]
      UPDATE public.parceiros SET responsavel_id = v_p.responsavel_id                   -- [sempre-atendido]
       WHERE id = v_parceiro AND responsavel_id IS NULL;                                -- [sempre-atendido]
    END IF;                                                                             -- [sempre-atendido]
  END IF;                                                                               -- [sempre-atendido]
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
    -- [primeira-compra] Compra pelo painel OU pela equipe: só aprovado/convertido conta.
    -- [primeira-compra] Excluir v_orc, criado acima; recusado/expirado não contam.
    -- [entrada] Com base >= mínimo, teto da entrada; só produtos, sem taxa de prazo.
    IF COALESCE(v_prog.entrada_ativa, false)
       AND v_base >= v_prog.entrada_pedido_minimo
       AND NOT EXISTS (
         SELECT 1 FROM public.orcamentos o                          -- [primeira-compra]
          WHERE o.cliente_id = v_p.cliente_id AND o.id <> v_orc       -- [primeira-compra]
            AND o.status::text IN ('aprovado', 'convertido')) THEN   -- [primeira-compra]
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

-- =====================================================================================================
-- SEÇÃO C — CRÉDITO DE ENTRADA SOMENTE PARA QUEM NUNCA COMPROU DE VERDADE
-- Corpo vivo: md5 f7003bea46eef29008ce69dc21a08168 (15/11, mesmo método do topo).
-- Só acrescenta a recusa depois de 'Já fez pedido'; nenhuma concessão/backfill agora.
-- A outra mudança de primeira compra está no ÚNICO corpo do pedido da seção B.
-- =====================================================================================================
CREATE OR REPLACE FUNCTION public._parceiro_conceder_entrada(p_parceiro_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  IF v_p.responsavel_id IS NULL THEN
    RETURN jsonb_build_object('concedido', false, 'motivo', 'Sem atendente: o crédito começa a valer quando alguém da gráfica assumir.');
  END IF;
  IF EXISTS (SELECT 1 FROM public.parceiro_creditos WHERE parceiro_id = v_p.id AND tipo = 'entrada') THEN
    RETURN jsonb_build_object('concedido', false, 'motivo', 'Já recebeu o crédito de entrada.');
  END IF;
  IF EXISTS (SELECT 1 FROM public.parceiro_orcamentos WHERE parceiro_id = v_p.id AND pedido_orcamento_id IS NOT NULL) THEN
    RETURN jsonb_build_object('concedido', false, 'motivo', 'Já fez pedido.');
  END IF;
  -- [primeira-compra] Compra pela equipe também impede crédito de entrada.
  IF EXISTS (SELECT 1 FROM public.orcamentos o
              WHERE o.cliente_id = v_p.cliente_id
                AND o.status::text IN ('aprovado', 'convertido')) THEN
    RETURN jsonb_build_object('concedido', false, 'motivo', 'Já compra com a gráfica: o crédito é só para a 1ª compra.');
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
$function$;
-- TESTE DE MESA C: cliente com aprovado/convertido pela equipe -> negar entrada.
-- Só rejeitado/expirado/rascunho/enviado/cancelado -> não bloquear por esta regra nova.
-- Pedido atual v_orc sozinho aprovado -> ainda 1ª compra; outro cliente -> não conta.
-- Outro orçamento aprovado/convertido do mesmo cliente -> sem teto especial de 1ª compra.
-- Sem cliente_id -> nenhuma correspondência; demais travas vivas seguem intactas.

-- =====================================================================================================
-- DESFAZER — TODO COMENTADO; reverter C, depois B, depois A. NÃO EXECUTAR AGORA.
-- =====================================================================================================
-- ----- DESFAZER C -----
-- Recriar o corpo vivo (md5 f7003bea46eef29008ce69dc21a08168):
-- CREATE OR REPLACE FUNCTION public._parceiro_conceder_entrada(p_parceiro_id uuid)
--  RETURNS jsonb
--  LANGUAGE plpgsql
--  SECURITY DEFINER
--  SET search_path TO 'public'
-- AS $function$
-- DECLARE
--   v_prog public.parceiro_programa%ROWTYPE;
--   v_p public.parceiros%ROWTYPE;
--   v_doc text; v_tel text; v_email text;
-- BEGIN
--   -- Serializa as concessões: a checagem de documento/telefone/e-mail repetido
--   -- olha OUTROS parceiros, e o índice único só protege o mesmo parceiro.
--   PERFORM pg_advisory_xact_lock(hashtext('parceiro_credito_de_entrada'));
--
--   SELECT * INTO v_prog FROM public.parceiro_programa WHERE id;
--   IF NOT FOUND OR NOT v_prog.entrada_ativa THEN
--     RETURN jsonb_build_object('concedido', false, 'motivo', 'Crédito de entrada desligado no programa.');
--   END IF;
--
--   SELECT * INTO v_p FROM public.parceiros WHERE id = p_parceiro_id;
--   IF NOT FOUND THEN
--     RETURN jsonb_build_object('concedido', false, 'motivo', 'Parceiro não encontrado.');
--   END IF;
--   IF v_p.status <> 'ativo' OR v_p.usuario_id IS NULL THEN
--     RETURN jsonb_build_object('concedido', false, 'motivo', 'Parceiro sem acesso ativo.');
--   END IF;
--   IF v_p.responsavel_id IS NULL THEN
--     RETURN jsonb_build_object('concedido', false, 'motivo', 'Sem atendente: o crédito começa a valer quando alguém da gráfica assumir.');
--   END IF;
--   IF EXISTS (SELECT 1 FROM public.parceiro_creditos WHERE parceiro_id = v_p.id AND tipo = 'entrada') THEN
--     RETURN jsonb_build_object('concedido', false, 'motivo', 'Já recebeu o crédito de entrada.');
--   END IF;
--   IF EXISTS (SELECT 1 FROM public.parceiro_orcamentos WHERE parceiro_id = v_p.id AND pedido_orcamento_id IS NOT NULL) THEN
--     RETURN jsonb_build_object('concedido', false, 'motivo', 'Já fez pedido.');
--   END IF;
--
--   -- Identidade: dados da marca, e na falta deles os do cliente ligado.
--   SELECT regexp_replace(COALESCE(NULLIF(btrim(v_p.marca_documento), ''), c.cpf_cnpj, c.documento, ''), '\D', '', 'g'),
--          regexp_replace(COALESCE(NULLIF(btrim(v_p.marca_telefone), ''), c.whatsapp_principal, c.telefone, ''), '\D', '', 'g'),
--          lower(btrim(COALESCE(NULLIF(btrim(v_p.marca_email), ''), c.email, '')))
--     INTO v_doc, v_tel, v_email
--     FROM (SELECT 1) x LEFT JOIN public.clientes c ON c.id = v_p.cliente_id;
--   v_doc   := CASE WHEN length(v_doc) >= 11 THEN v_doc END;
--   v_tel   := CASE WHEN length(v_tel) >= 10 THEN right(v_tel, 11) END;
--   v_email := NULLIF(v_email, '');
--
--   IF (v_doc IS NOT NULL OR v_tel IS NOT NULL OR v_email IS NOT NULL) AND EXISTS (
--     SELECT 1
--       FROM public.parceiro_creditos pc
--       JOIN public.parceiros o ON o.id = pc.parceiro_id
--       LEFT JOIN public.clientes c ON c.id = o.cliente_id
--       CROSS JOIN LATERAL (SELECT
--         regexp_replace(COALESCE(NULLIF(btrim(o.marca_documento), ''), c.cpf_cnpj, c.documento, ''), '\D', '', 'g') AS doc,
--         regexp_replace(COALESCE(NULLIF(btrim(o.marca_telefone), ''), c.whatsapp_principal, c.telefone, ''), '\D', '', 'g') AS tel,
--         lower(btrim(COALESCE(NULLIF(btrim(o.marca_email), ''), c.email, ''))) AS email) i
--      WHERE pc.tipo = 'entrada' AND o.id <> v_p.id
--        AND ((v_doc IS NOT NULL AND length(i.doc) >= 11 AND i.doc = v_doc)
--          OR (v_tel IS NOT NULL AND length(i.tel) >= 10 AND right(i.tel, 11) = v_tel)
--          OR (v_email IS NOT NULL AND i.email = v_email))) THEN
--     RETURN jsonb_build_object('concedido', false, 'motivo', 'Mesmo documento, telefone ou e-mail de quem já recebeu.');
--   END IF;
--
--   INSERT INTO public.parceiro_creditos (parceiro_id, tipo, valor, expira_em, descricao, criado_por)
--   VALUES (v_p.id, 'entrada', v_prog.entrada_valor, now() + make_interval(days => v_prog.entrada_validade_dias),
--           'Crédito de entrada: vale na 1ª compra', auth.uid());
--
--   RETURN jsonb_build_object('concedido', true, 'motivo', NULL, 'valor', v_prog.entrada_valor);
-- END
-- $function$;

-- ----- DESFAZER B -----
-- DROP TRIGGER IF EXISTS tg_parceiro_programa_exige_atendente ON public.parceiro_programa;
-- DROP FUNCTION IF EXISTS public.tg_parceiro_programa_exige_atendente();
-- e recriar parceiro_enviar_pedido com o corpo vivo (md5 d8b83a6fc83e950b63e69c746881e2f8):
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
--   v_prog public.parceiro_programa%ROWTYPE;  -- [entrada]
--   v_teto_pct numeric;                       -- [entrada]
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
--     -- [entrada] Teto geral, igual ao de antes (sem linha no programa = 100%).
--     SELECT * INTO v_prog FROM public.parceiro_programa WHERE id;
--     v_teto_pct := COALESCE(v_prog.credito_max_pct_pedido, 100);
--     -- [entrada] Na 1ª compra (nenhum outro pedido valendo: recusado/expirado devolvem o
--     -- crédito em tg_parceiro_pedido_recusado e não contam) com base >= pedido mínimo,
--     -- o teto sobe para o da entrada. Sempre % de v_base (só produtos, sem a taxa de prazo).
--     IF COALESCE(v_prog.entrada_ativa, false)
--        AND v_base >= v_prog.entrada_pedido_minimo
--        AND NOT EXISTS (
--          SELECT 1 FROM public.parceiro_orcamentos po
--            JOIN public.orcamentos o ON o.id = po.pedido_orcamento_id
--           WHERE po.parceiro_id = v_parceiro AND po.id <> v_q.id
--             AND o.status::text NOT IN ('rejeitado', 'expirado')) THEN
--       v_teto_pct := GREATEST(v_teto_pct, v_prog.entrada_max_pct_pedido);
--     END IF;
--     v_credito := round(LEAST(p_usar_credito, v_saldo, round(v_base * v_teto_pct / 100, 2)), 2);
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

-- ----- DESFAZER A -----
-- DROP TRIGGER IF EXISTS tg_parceiro_chamado ON public.parceiros;
-- DROP FUNCTION IF EXISTS public.tg_parceiro_chamado();
-- DROP FUNCTION IF EXISTS public._parceiro_garantir_chamado(uuid);
-- DROP FUNCTION IF EXISTS public._parceiro_celular(uuid);
-- (Conversas/atendimentos já abertos ficam: são atendimento normal da caixa.)
