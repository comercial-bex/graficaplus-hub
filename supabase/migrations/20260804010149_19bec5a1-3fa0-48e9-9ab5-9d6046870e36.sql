-- ============ 1. AGENDA DE MÁQUINAS: elimina duplicidade ============
INSERT INTO public.maquinas_agenda (maquina_id, os_id, os_item_id, operador_id, titulo, inicio, fim, status, prioridade, observacoes, created_by, created_at, updated_at)
SELECT maquina_id, os_id, item_os_id, operador_id, titulo, inicio, fim, status, prioridade, observacoes, created_by, created_at, updated_at
FROM public.agenda_maquinas;

DROP TABLE public.agenda_maquinas CASCADE;

CREATE VIEW public.agenda_maquinas
WITH (security_invoker = on) AS
SELECT id, maquina_id, os_id, os_item_id AS item_os_id, operador_id, titulo,
       observacoes AS descricao, inicio, fim, status, prioridade, observacoes,
       created_by, created_at, updated_at
FROM public.maquinas_agenda;

GRANT SELECT ON public.agenda_maquinas TO authenticated;
GRANT ALL ON public.agenda_maquinas TO service_role;

-- ============ 2. ORÇAMENTO 3D ENTRA NO FUNIL COMERCIAL ============
CREATE OR REPLACE FUNCTION public.sync_orcamento_3d_para_funil()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_orc_id uuid; v_status public.status_orcamento;
BEGIN
  v_status := CASE lower(coalesce(NEW.status,'rascunho'))
    WHEN 'enviado' THEN 'enviado'::public.status_orcamento
    WHEN 'aprovado' THEN 'aprovado'::public.status_orcamento
    WHEN 'rejeitado' THEN 'rejeitado'::public.status_orcamento
    WHEN 'convertido' THEN 'convertido'::public.status_orcamento
    WHEN 'expirado' THEN 'expirado'::public.status_orcamento
    ELSE 'rascunho'::public.status_orcamento END;

  IF NEW.orcamento_id IS NULL THEN
    INSERT INTO public.orcamentos (cliente_id, titulo, descricao, status, valor_subtotal, valor_total,
                                   contato_nome, contato_telefone, contato_email, created_by, os_id, prazo)
    VALUES (NEW.cliente_id, NEW.titulo, coalesce(NEW.descricao,'Orçamento de impressão 3D'), v_status,
            coalesce(NEW.preco_comercial,0), coalesce(NEW.preco_comercial,0),
            NEW.contato_nome, NEW.contato_telefone, NEW.contato_email, NEW.created_by, NEW.os_id, NEW.prazo)
    RETURNING id INTO v_orc_id;
    UPDATE public.orcamentos_3d SET orcamento_id = v_orc_id WHERE id = NEW.id;
  ELSE
    UPDATE public.orcamentos
       SET cliente_id = NEW.cliente_id,
           titulo = NEW.titulo,
           status = v_status,
           valor_subtotal = coalesce(NEW.preco_comercial,0),
           valor_total = coalesce(NEW.preco_comercial,0),
           contato_nome = NEW.contato_nome,
           contato_telefone = NEW.contato_telefone,
           contato_email = NEW.contato_email,
           os_id = coalesce(NEW.os_id, os_id),
           updated_at = now()
     WHERE id = NEW.orcamento_id;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_sync_orcamento_3d_funil ON public.orcamentos_3d;
CREATE TRIGGER trg_sync_orcamento_3d_funil
AFTER INSERT OR UPDATE OF titulo, cliente_id, status, preco_comercial, os_id, contato_nome, contato_telefone, contato_email
ON public.orcamentos_3d
FOR EACH ROW EXECUTE FUNCTION public.sync_orcamento_3d_para_funil();

-- ============ 3. MATERIAIS PREVISTOS A PARTIR DA RECEITA DO PRODUTO ============
CREATE OR REPLACE FUNCTION public.gerar_materiais_previstos_os(p_os_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count integer;
BEGIN
  INSERT INTO public.os_materiais_previstos (os_id, os_item_id, material_id, quantidade, unidade, custo_unitario_previsto)
  SELECT i.os_id, i.id, pm.material_id,
         pm.quantidade_por_unidade * coalesce(i.quantidade,1),
         m.unidade, m.custo_unitario
  FROM public.itens_os i
  JOIN public.produto_materiais pm ON pm.produto_id = i.produto_id
  JOIN public.materiais m ON m.id = pm.material_id
  WHERE i.os_id = p_os_id
    AND NOT EXISTS (
      SELECT 1 FROM public.os_materiais_previstos p
      WHERE p.os_item_id = i.id AND p.material_id = pm.material_id
    );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;

REVOKE ALL ON FUNCTION public.gerar_materiais_previstos_os(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gerar_materiais_previstos_os(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.trg_itens_os_materiais_previstos()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.gerar_materiais_previstos_os(NEW.os_id);
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_itens_os_prev ON public.itens_os;
CREATE TRIGGER trg_itens_os_prev
AFTER INSERT ON public.itens_os
FOR EACH ROW WHEN (NEW.produto_id IS NOT NULL)
EXECUTE FUNCTION public.trg_itens_os_materiais_previstos();

-- ============ 4. PÓS-VENDA AUTOMÁTICA AO FINALIZAR OS ============
CREATE OR REPLACE FUNCTION public.trg_os_pos_venda()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF coalesce(NEW.status_geral,'') IN ('finalizado','entregue')
     AND coalesce(OLD.status_geral,'') IS DISTINCT FROM coalesce(NEW.status_geral,'')
     AND NEW.cliente_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.pos_venda_pesquisas WHERE os_id = NEW.id) THEN
    INSERT INTO public.pos_venda_pesquisas (os_id, cliente_id, tipo, status, agendada_para)
    VALUES (NEW.id, NEW.cliente_id, 'nps', 'agendada', now() + interval '2 days');
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_os_pos_venda ON public.ordens_servico;
CREATE TRIGGER trg_os_pos_venda
AFTER UPDATE OF status_geral ON public.ordens_servico
FOR EACH ROW EXECUTE FUNCTION public.trg_os_pos_venda();