-- Preço do cliente final × preço de parceiro (terceirizado) no orçamento (22/10/2026).
--
-- Pedido do dono: um seletor no topo do orçamento, "cliente final" ou
-- "parceiro (terceirizado)"; o preço de parceiro exige confirmação com a senha de
-- quem está orçando, e a diferença para a tabela fica registrada.
--
-- Até aqui o parceiro era um SEGUNDO PRODUTO ("Banner ... (Terceirizado)"): dois
-- cadastros para o mesmo banner, que divergiam (medida, ficha, kit) e deixavam o
-- orçamento depender do vendedor lembrar qual escolher. Agora o produto tem os
-- dois preços e o orçamento tem o modo.
--
--   produtos.preco_parceiro        o preço de parceiro do produto (nulo = sem)
--   clientes.revendedor            o cliente é parceiro/revendedor (abre em modo parceiro)
--   orcamentos.preco_modo          'cliente_final' | 'parceiro'
--   orcamentos.preco_parceiro_confirmado_{por,em}   quem confirmou com a senha e quando
--
-- Gravar o modo, a confirmação e o repreço dos itens só passa pelo servidor
-- (confirmarPrecoDoOrcamento → orcamento_aplicar_preco, só service_role): a coluna
-- não tem UPDATE para `authenticated`, senão a tela gravaria "parceiro" sem senha.

-- 1. Colunas --------------------------------------------------------------------
ALTER TABLE public.produtos ADD COLUMN IF NOT EXISTS preco_parceiro numeric;
ALTER TABLE public.produto_precos ADD COLUMN IF NOT EXISTS preco_parceiro numeric;
ALTER TABLE public.clientes ADD COLUMN IF NOT EXISTS revendedor boolean NOT NULL DEFAULT false;
ALTER TABLE public.orcamentos
  ADD COLUMN IF NOT EXISTS preco_modo text NOT NULL DEFAULT 'cliente_final',
  ADD COLUMN IF NOT EXISTS preco_parceiro_confirmado_por uuid,
  ADD COLUMN IF NOT EXISTS preco_parceiro_confirmado_em timestamptz;
ALTER TABLE public.orcamentos DROP CONSTRAINT IF EXISTS orcamentos_preco_modo_check;
ALTER TABLE public.orcamentos
  ADD CONSTRAINT orcamentos_preco_modo_check CHECK (preco_modo IN ('cliente_final', 'parceiro'));

COMMENT ON COLUMN public.produtos.preco_parceiro IS 'Preço de parceiro/terceirizado (por unidade de venda). Nulo: o produto não tem preço de parceiro.';
COMMENT ON COLUMN public.clientes.revendedor IS 'Cliente parceiro/revendedor: o orçamento sugere o preço de parceiro.';

-- Leitura/escrita por coluna, como o resto destas tabelas.
GRANT SELECT (preco_modo, preco_parceiro_confirmado_por, preco_parceiro_confirmado_em) ON public.orcamentos TO authenticated;
GRANT UPDATE (preco_parceiro) ON public.produtos TO authenticated;   -- a RLS deixa só admin e gestor

-- 2. O espelho de preços e as views de produto ----------------------------------------
CREATE OR REPLACE FUNCTION public.tg_sync_produto_precos()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.produto_precos (produto_id, preco_base, custo_medio, margem_minima,
    margem_sugerida, preco_minimo, preco_sugerido, preco_publico, area_minima_cobrada, preco_parceiro, updated_at)
  VALUES (NEW.id, NEW.preco_base, NEW.custo_medio, NEW.margem_minima, NEW.margem_sugerida,
    NEW.preco_minimo, NEW.preco_sugerido, NEW.preco_publico, NEW.area_minima_cobrada, NEW.preco_parceiro, now())
  ON CONFLICT (produto_id) DO UPDATE SET
    preco_base=EXCLUDED.preco_base, custo_medio=EXCLUDED.custo_medio,
    margem_minima=EXCLUDED.margem_minima, margem_sugerida=EXCLUDED.margem_sugerida,
    preco_minimo=EXCLUDED.preco_minimo, preco_sugerido=EXCLUDED.preco_sugerido,
    preco_publico=EXCLUDED.preco_publico, area_minima_cobrada=EXCLUDED.area_minima_cobrada,
    preco_parceiro=EXCLUDED.preco_parceiro,
    updated_at=now();
  RETURN NEW;
END $function$;

-- Coluna nova no FIM: CREATE OR REPLACE VIEW só aceita acrescentar no final.
CREATE OR REPLACE VIEW public.produtos_comercial AS
 SELECT p.id, p.nome, p.descricao, p.ativo, p.created_at, p.sku, p.categoria, p.tipo, p.unidade,
    p.tempo_producao_min, p.imagem_url, p.observacoes_internas, p.updated_at, p.maquina_padrao_id,
    p.material_principal_id, p.exigencias, p.sugestoes_operacionais, p.area_minima_cobrada,
    p.espacamento_pecas_m, pp.preco_base, pp.preco_publico, pp.preco_sugerido, pp.preco_parceiro
   FROM (produtos p LEFT JOIN produto_precos pp ON ((pp.produto_id = p.id)))
  WHERE (is_staff(auth.uid()) AND can_see_prices(auth.uid()));

CREATE OR REPLACE VIEW public.produtos_financeiro AS
 SELECT p.id, p.nome, p.descricao, p.ativo, p.created_at, p.sku, p.categoria, p.tipo, p.unidade,
    p.tempo_producao_min, p.imagem_url, p.observacoes_internas, p.updated_at, p.maquina_padrao_id,
    p.material_principal_id, p.exigencias, p.sugestoes_operacionais, pp.preco_base, pp.custo_medio,
    pp.margem_minima, pp.margem_sugerida, pp.preco_minimo, pp.preco_sugerido, pp.preco_publico,
    pp.area_minima_cobrada, pp.preco_parceiro
   FROM (produtos p LEFT JOIN produto_precos pp ON ((pp.produto_id = p.id)))
  WHERE can_see_financials(( SELECT auth.uid() AS uid));

-- CREATE OR REPLACE VIEW DESCARTA as opções da view (visto no ensaio de 22/10:
-- reloptions voltou vazio). Sem elas a visão financeira deixaria de rodar como
-- quem pergunta. Repostas aqui, com os mesmos valores de antes.
ALTER VIEW public.produtos_comercial SET (security_invoker = false, security_barrier = true);
ALTER VIEW public.produtos_financeiro SET (security_invoker = true);

-- 3. O repreço do orçamento ---------------------------------------------------------
-- Troca o preço dos itens do catálogo pelo de tabela (cliente_final) ou pelo de
-- parceiro. Item sem produto, ou de produto sem preço de parceiro, NÃO muda — e é
-- contado no retorno, para a tela dizer. Desconto, condição e prazo ficam como
-- estão; os totais saem dos gatilhos de itens.
CREATE OR REPLACE FUNCTION public.orcamento_aplicar_preco(p_orcamento uuid, p_modo text, p_usuario uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_orc public.orcamentos%ROWTYPE;
  v_mudou int := 0;
  v_sem_preco int := 0;
  i record;
  v_preco numeric;
BEGIN
  IF p_usuario IS NULL OR NOT public.has_permission(p_usuario, 'orcamentos.update') THEN
    RAISE EXCEPTION 'Seu perfil não pode alterar orçamentos (falta a permissão orçamentos › update).';
  END IF;
  IF p_modo NOT IN ('cliente_final', 'parceiro') THEN
    RAISE EXCEPTION 'Modo de preço inválido.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_orc FROM public.orcamentos WHERE id = p_orcamento FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Orçamento não encontrado.'; END IF;
  IF v_orc.os_id IS NOT NULL OR v_orc.status::text NOT IN ('rascunho', 'enviado') THEN
    RAISE EXCEPTION 'O preço só muda em orçamento em rascunho ou enviado, que ainda não virou OS.';
  END IF;

  FOR i IN
    SELECT it.id, it.preco_m2, p.preco_base, p.preco_parceiro
      FROM public.orcamento_itens it
      JOIN public.produtos p ON p.id = it.produto_id
     WHERE it.orcamento_id = p_orcamento
  LOOP
    v_preco := CASE WHEN p_modo = 'parceiro' THEN i.preco_parceiro ELSE i.preco_base END;
    IF v_preco IS NULL THEN v_sem_preco := v_sem_preco + 1; CONTINUE; END IF;
    UPDATE public.orcamento_itens
       SET valor_unitario = v_preco,
           preco_m2 = CASE WHEN i.preco_m2 IS NOT NULL THEN v_preco ELSE NULL END
     WHERE id = i.id;
    v_mudou := v_mudou + 1;
  END LOOP;

  UPDATE public.orcamentos
     SET preco_modo = p_modo,
         preco_parceiro_confirmado_por = CASE WHEN p_modo = 'parceiro' THEN p_usuario END,
         preco_parceiro_confirmado_em = CASE WHEN p_modo = 'parceiro' THEN now() END
   WHERE id = p_orcamento;

  RETURN jsonb_build_object(
    'modo', p_modo,
    'itens_repreciados', v_mudou,
    'itens_sem_preco', v_sem_preco + (SELECT count(*) FROM public.orcamento_itens WHERE orcamento_id = p_orcamento AND produto_id IS NULL)
  );
END $function$;
COMMENT ON FUNCTION public.orcamento_aplicar_preco(uuid, text, uuid) IS
  'Troca o orçamento entre preço de cliente final e de parceiro, repreciando os itens do catálogo. Só service_role; a senha é conferida no servidor antes.';
REVOKE ALL ON FUNCTION public.orcamento_aplicar_preco(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.orcamento_aplicar_preco(uuid, text, uuid) TO service_role;

-- 4. Os dados que já se sabe ---------------------------------------------------------
-- Banner: o preço de parceiro é o do produto "(Terceirizado)" (R$ 40/m²). O
-- duplicado sai do catálogo (inativo, não apagado: o orçamento #78 e as OS #164 e
-- #166 seguem apontando para ele).
UPDATE public.produtos SET preco_parceiro = 40
 WHERE id = 'cb58f5d8-1eaf-4019-a84c-6b311d0cf9c3' AND preco_parceiro IS DISTINCT FROM 40;
UPDATE public.produtos SET ativo = false
 WHERE id = 'a90b6fc0-79a1-43d0-bd24-68e36663b542' AND ativo;
