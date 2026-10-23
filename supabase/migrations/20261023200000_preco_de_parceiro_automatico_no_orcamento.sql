-- Preço de parceiro AUTOMÁTICO no orçamento (23/10/2026).
--
-- Defeito: o orçamento de um parceiro abria no preço de cliente final e o
-- "modo parceiro" (22/10) lia só `produtos.preco_parceiro` — preenchido em 1 dos
-- 46 produtos. Resultado: trocar para parceiro não mudava quase nada ("itens
-- ficaram como estavam") e 12 dos 13 orçamentos recentes de revendedor ficaram
-- no preço final. A tabela de verdade (níveis 15–30%, faixas, ofertas) só
-- alimentava o painel do próprio parceiro (`parceiro_precos`).
--
-- Agora, para cliente que tem cadastro de parceiro ATIVO:
--   1. o preço de parceiro do produto é o `preco_parceiro` do produto, quando
--      preenchido (tabela da casa), senão o do programa (`parceiro_precos`:
--      nível, faixa de quantidade, oferta, piso de margem);
--   2. o orçamento nasce no modo parceiro e, ao trocar o cliente de um rascunho,
--      reprecifica sozinho (sem senha: é regra, não exceção);
--   3. `orcamento_precos_parceiro(orcamento)` entrega a tabela à tela.
-- Cliente sem cadastro de parceiro continua com o caminho antigo (coluna + senha).
-- Desfazer: recriar `orcamento_aplicar_preco` de 20261022150000 e dropar os
-- gatilhos/funções novos.

CREATE OR REPLACE FUNCTION public.parceiro_ativo_do_cliente(p_cliente uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT pa.id FROM public.parceiros pa WHERE pa.cliente_id = p_cliente AND pa.status = 'ativo' LIMIT 1 $$;
REVOKE ALL ON FUNCTION public.parceiro_ativo_do_cliente(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.parceiro_ativo_do_cliente(uuid) TO authenticated;

-- Preço de parceiro de cada produto para o cliente do orçamento.
CREATE OR REPLACE FUNCTION public.orcamento_precos_parceiro(p_orcamento uuid)
RETURNS TABLE(produto_id uuid, preco_referencia numeric, preco_parceiro numeric, origem text, faixas jsonb,
              nivel_nome text, desconto_pct numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_parc uuid; v_nivel jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_permission(auth.uid(), 'orcamentos.read') THEN
    RAISE EXCEPTION 'Seu perfil não pode ver orçamentos.' USING ERRCODE = '42501';
  END IF;
  SELECT public.parceiro_ativo_do_cliente(o.cliente_id) INTO v_parc FROM public.orcamentos o WHERE o.id = p_orcamento;
  IF v_parc IS NULL THEN RETURN; END IF;
  v_nivel := public.parceiro_nivel(v_parc);
  RETURN QUERY
  SELECT pr.produto_id, pr.preco_referencia,
         CASE WHEN pr.faixas IS NULL AND p.preco_parceiro IS NOT NULL THEN p.preco_parceiro ELSE pr.preco_parceiro END,
         CASE WHEN pr.faixas IS NULL AND p.preco_parceiro IS NOT NULL THEN 'tabela_do_produto' ELSE pr.origem END,
         pr.faixas, v_nivel->>'nome', (v_nivel->>'desconto_pct')::numeric
    FROM public.parceiro_precos(v_parc) pr JOIN public.produtos p ON p.id = pr.produto_id;
END
$function$;
REVOKE ALL ON FUNCTION public.orcamento_precos_parceiro(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.orcamento_precos_parceiro(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.orcamento_aplicar_preco(p_orcamento uuid, p_modo text, p_usuario uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_orc public.orcamentos%ROWTYPE; v_mudou int := 0; v_sem_preco int := 0; i record; v_preco numeric;
  v_parc uuid; v_origem text := 'coluna'; v_faixa jsonb;
BEGIN
  IF p_usuario IS NULL OR NOT public.has_permission(p_usuario, 'orcamentos.update') THEN
    RAISE EXCEPTION 'Seu perfil não pode alterar orçamentos (falta a permissão orçamentos › update).';
  END IF;
  IF p_modo NOT IN ('cliente_final', 'parceiro') THEN RAISE EXCEPTION 'Modo de preço inválido.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_orc FROM public.orcamentos WHERE id = p_orcamento FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Orçamento não encontrado.'; END IF;
  IF v_orc.os_id IS NOT NULL OR v_orc.status::text NOT IN ('rascunho', 'enviado') THEN
    RAISE EXCEPTION 'O preço só muda em orçamento em rascunho ou enviado, que ainda não virou OS.';
  END IF;
  v_parc := public.parceiro_ativo_do_cliente(v_orc.cliente_id);
  IF p_modo = 'parceiro' AND v_parc IS NOT NULL THEN v_origem := 'programa'; END IF;

  FOR i IN
    SELECT it.id, it.preco_m2, it.quantidade, p.id AS produto_id,
           COALESCE(pp.preco_base, p.preco_base) AS preco_base, p.preco_parceiro
      FROM public.orcamento_itens it
      JOIN public.produtos p ON p.id = it.produto_id
      LEFT JOIN public.produto_precos pp ON pp.produto_id = p.id
     WHERE it.orcamento_id = p_orcamento
  LOOP
    IF p_modo = 'cliente_final' THEN
      v_preco := i.preco_base;
    ELSIF v_origem = 'programa' THEN
      SELECT pr.preco_parceiro, pr.faixas INTO v_preco, v_faixa
        FROM public.orcamento_precos_parceiro_interno(v_parc, i.produto_id) pr;
      IF v_faixa IS NOT NULL THEN
        v_preco := NULL;
        SELECT (f->>'preco_parceiro')::numeric INTO v_preco FROM jsonb_array_elements(v_faixa) f
         WHERE (f->>'quantidade_minima')::integer <= ceil(i.quantidade)
         ORDER BY (f->>'quantidade_minima')::integer DESC LIMIT 1;
      END IF;
    ELSE
      v_preco := i.preco_parceiro;
    END IF;
    IF v_preco IS NULL THEN v_sem_preco := v_sem_preco + 1; CONTINUE; END IF;
    UPDATE public.orcamento_itens
       SET valor_unitario = v_preco, preco_m2 = CASE WHEN i.preco_m2 IS NOT NULL THEN v_preco ELSE NULL END
     WHERE id = i.id;
    v_mudou := v_mudou + 1;
  END LOOP;
  UPDATE public.orcamentos
     SET preco_modo = p_modo,
         -- Preço do programa é regra (sem senha, sem "confirmado por"); só o preço pela
         -- coluna do produto é exceção confirmada por alguém.
         preco_parceiro_confirmado_por = CASE WHEN p_modo = 'parceiro' AND v_origem = 'coluna' THEN p_usuario END,
         preco_parceiro_confirmado_em = CASE WHEN p_modo = 'parceiro' AND v_origem = 'coluna' THEN now() END
   WHERE id = p_orcamento;
  RETURN jsonb_build_object('modo', p_modo, 'itens_repreciados', v_mudou, 'origem', v_origem,
    'itens_sem_preco', v_sem_preco + (SELECT count(*) FROM public.orcamento_itens WHERE orcamento_id = p_orcamento AND produto_id IS NULL));
END $function$;

-- Preço de um produto para um parceiro (mesma regra de orcamento_precos_parceiro, sem checar a pessoa).
CREATE OR REPLACE FUNCTION public.orcamento_precos_parceiro_interno(p_parceiro uuid, p_produto uuid)
RETURNS TABLE(preco_parceiro numeric, faixas jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT CASE WHEN pr.faixas IS NULL AND p.preco_parceiro IS NOT NULL THEN p.preco_parceiro ELSE pr.preco_parceiro END, pr.faixas
    FROM public.parceiro_precos(p_parceiro) pr JOIN public.produtos p ON p.id = pr.produto_id
   WHERE pr.produto_id = p_produto
$$;
REVOKE ALL ON FUNCTION public.orcamento_precos_parceiro_interno(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Orçamento novo de cliente que é parceiro ativo já nasce no modo parceiro.
CREATE OR REPLACE FUNCTION public.tg_orcamento_modo_parceiro_automatico()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.preco_modo IS DISTINCT FROM 'parceiro' AND NEW.cliente_id IS NOT NULL
       AND public.parceiro_ativo_do_cliente(NEW.cliente_id) IS NOT NULL THEN
      NEW.preco_modo := 'parceiro';
    END IF;
    RETURN NEW;
  END IF;
  -- Troca de cliente num orçamento ainda aberto: acompanha o novo cliente.
  IF NEW.cliente_id IS DISTINCT FROM OLD.cliente_id AND NEW.os_id IS NULL
     AND NEW.status::text IN ('rascunho', 'enviado') THEN
    IF public.parceiro_ativo_do_cliente(NEW.cliente_id) IS NOT NULL AND NEW.preco_modo IS DISTINCT FROM 'parceiro' THEN
      PERFORM public.orcamento_aplicar_preco(NEW.id, 'parceiro', COALESCE(auth.uid(), NEW.created_by));
    ELSIF public.parceiro_ativo_do_cliente(NEW.cliente_id) IS NULL AND NEW.preco_modo = 'parceiro'
          AND NEW.preco_parceiro_confirmado_por IS NULL THEN
      PERFORM public.orcamento_aplicar_preco(NEW.id, 'cliente_final', COALESCE(auth.uid(), NEW.created_by));
    END IF;
  END IF;
  RETURN NULL;
END
$function$;
REVOKE ALL ON FUNCTION public.tg_orcamento_modo_parceiro_automatico() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS orcamento_modo_parceiro_antes ON public.orcamentos;
CREATE TRIGGER orcamento_modo_parceiro_antes BEFORE INSERT ON public.orcamentos
  FOR EACH ROW EXECUTE FUNCTION public.tg_orcamento_modo_parceiro_automatico();
DROP TRIGGER IF EXISTS orcamento_modo_parceiro_depois ON public.orcamentos;
CREATE TRIGGER orcamento_modo_parceiro_depois AFTER UPDATE OF cliente_id ON public.orcamentos
  FOR EACH ROW EXECUTE FUNCTION public.tg_orcamento_modo_parceiro_automatico();

-- Usada pela função de servidor que confirma o preço: parceiro ativo dispensa a senha.
CREATE OR REPLACE FUNCTION public.orcamento_de_parceiro_ativo(p_orcamento uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT public.parceiro_ativo_do_cliente((SELECT o.cliente_id FROM public.orcamentos o WHERE o.id = p_orcamento)) IS NOT NULL $$;
REVOKE ALL ON FUNCTION public.orcamento_de_parceiro_ativo(uuid) FROM PUBLIC, anon, authenticated;
