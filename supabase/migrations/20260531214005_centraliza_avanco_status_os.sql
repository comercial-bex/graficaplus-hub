-- Centraliza alterações de status de OS em uma RPC auditável.

ALTER TYPE public.tipo_aprovacao ADD VALUE IF NOT EXISTS 'margem_baixa';
ALTER TYPE public.tipo_aprovacao ADD VALUE IF NOT EXISTS 'desconto_alto';

-- Materiais que precisam estar disponíveis antes do avanço para produção.
CREATE TABLE IF NOT EXISTS public.os_materiais_obrigatorios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  os_id UUID NOT NULL REFERENCES public.ordens_servico(id) ON DELETE CASCADE,
  material_id UUID NOT NULL REFERENCES public.materiais(id) ON DELETE RESTRICT,
  quantidade NUMERIC(12,2) NOT NULL CHECK (quantidade > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (os_id, material_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.os_materiais_obrigatorios TO authenticated;
GRANT ALL ON public.os_materiais_obrigatorios TO service_role;

ALTER TABLE public.os_materiais_obrigatorios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "os materiais staff read" ON public.os_materiais_obrigatorios;
CREATE POLICY "os materiais staff read" ON public.os_materiais_obrigatorios
FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "os materiais estoque write" ON public.os_materiais_obrigatorios;
CREATE POLICY "os materiais estoque write" ON public.os_materiais_obrigatorios
FOR ALL TO authenticated
USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'gestor') OR public.has_role(auth.uid(),'estoque') OR public.has_role(auth.uid(),'operador'))
WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'gestor') OR public.has_role(auth.uid(),'estoque') OR public.has_role(auth.uid(),'operador'));

CREATE INDEX IF NOT EXISTS idx_os_materiais_obrigatorios_os ON public.os_materiais_obrigatorios(os_id);

CREATE OR REPLACE FUNCTION public.status_os_exige_validacoes_producao(_status public.status_os)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT _status IN (
    'aguardando_producao','em_producao','em_impressao','em_corte','em_acabamento',
    'em_uv','em_laser_cnc','em_3d','controle_qualidade','aguardando_retirada',
    'aguardando_entrega','em_entrega','em_instalacao','concluido','faturado'
  )
$$;

CREATE OR REPLACE FUNCTION public.tg_bloquear_update_status_os()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND COALESCE(current_setting('app.avancar_os_status', true), '') <> 'on'
     AND NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'gestor')) THEN
    RAISE EXCEPTION 'Alteração direta de status bloqueada. Use public.avancar_os_status(os_id, novo_status).'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_bloquear_update_status_os ON public.ordens_servico;
CREATE TRIGGER tg_bloquear_update_status_os
  BEFORE UPDATE OF status ON public.ordens_servico
  FOR EACH ROW EXECUTE FUNCTION public.tg_bloquear_update_status_os();

CREATE OR REPLACE FUNCTION public.avancar_os_status(os_id UUID, novo_status public.status_os)
RETURNS public.ordens_servico
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_os public.ordens_servico%ROWTYPE;
  v_os_atualizada public.ordens_servico%ROWTYPE;
  v_usuario_id UUID := auth.uid();
  v_total_pago NUMERIC(12,2);
  v_margem_minima NUMERIC(5,2) := 20;
  v_desconto_limite NUMERIC(5,2) := 10;
  v_margem NUMERIC(10,2);
  v_desconto NUMERIC(10,2);
  v_materiais_insuficientes JSONB;
BEGIN
  IF v_usuario_id IS NULL OR NOT public.is_staff(v_usuario_id) THEN
    RAISE EXCEPTION 'Usuário sem permissão para alterar status de OS.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_os
  FROM public.ordens_servico
  WHERE id = os_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'OS % não encontrada.', os_id USING ERRCODE = 'P0002';
  END IF;

  IF v_os.status = novo_status THEN
    RETURN v_os;
  END IF;

  IF v_os.responsavel_id IS NULL THEN
    RAISE EXCEPTION 'Defina um responsável antes de alterar o status da OS %.', os_id;
  END IF;

  IF public.status_os_exige_validacoes_producao(novo_status) THEN
    SELECT COALESCE(SUM(valor), 0) INTO v_total_pago
    FROM public.pagamentos
    WHERE pagamentos.os_id = avancar_os_status.os_id
      AND status IN ('parcial','pago')
      AND valor > 0;

    IF v_total_pago <= 0 THEN
      RAISE EXCEPTION 'Registre o pagamento mínimo antes de avançar a OS % para %.', os_id, novo_status;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.aprovacoes
      WHERE aprovacoes.os_id = avancar_os_status.os_id
        AND tipo = 'arte'
        AND aprovado = true
    ) THEN
      RAISE EXCEPTION 'A arte precisa estar aprovada antes de avançar a OS % para %.', os_id, novo_status;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.arquivos
      WHERE arquivos.os_id = avancar_os_status.os_id
        AND final_producao = true
    ) THEN
      RAISE EXCEPTION 'Anexe ou marque um arquivo final de produção antes de avançar a OS % para %.', os_id, novo_status;
    END IF;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'material_id', omo.material_id,
      'material', m.nome,
      'necessario', omo.quantidade,
      'saldo', m.estoque
    )), '[]'::jsonb)
    INTO v_materiais_insuficientes
    FROM public.os_materiais_obrigatorios omo
    JOIN public.materiais m ON m.id = omo.material_id
    WHERE omo.os_id = avancar_os_status.os_id
      AND m.estoque < omo.quantidade;

    IF jsonb_array_length(v_materiais_insuficientes) > 0 THEN
      RAISE EXCEPTION 'Materiais obrigatórios com saldo insuficiente para a OS %: %.', os_id, v_materiais_insuficientes;
    END IF;
  END IF;

  SELECT margem_estimada, desconto_percentual
  INTO v_margem, v_desconto
  FROM public.orcamentos
  WHERE id = v_os.orcamento_id;

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
    SELECT 1
    FROM public.aprovacoes a
    JOIN public.user_roles ur ON ur.user_id = a.usuario_id AND ur.role IN ('admin','gestor')
    WHERE a.os_id = avancar_os_status.os_id
      AND a.tipo::text = 'margem_baixa'
      AND a.aprovado = true
  ) THEN
    RAISE EXCEPTION 'Margem de % está abaixo do mínimo de %. Registre aprovação de gestor.', v_margem, v_margem_minima;
  END IF;

  IF COALESCE(v_desconto, 0) > v_desconto_limite AND NOT EXISTS (
    SELECT 1
    FROM public.aprovacoes a
    JOIN public.user_roles ur ON ur.user_id = a.usuario_id AND ur.role IN ('admin','gestor')
    WHERE (a.os_id = avancar_os_status.os_id OR a.orcamento_id = v_os.orcamento_id)
      AND a.tipo::text = 'desconto_alto'
      AND a.aprovado = true
  ) THEN
    RAISE EXCEPTION 'Desconto de % está acima do limite de %. Registre aprovação de gestor.', v_desconto, v_desconto_limite;
  END IF;

  PERFORM set_config('app.avancar_os_status', 'on', true);

  UPDATE public.ordens_servico
  SET status = novo_status,
      updated_at = now()
  WHERE id = os_id
  RETURNING * INTO v_os_atualizada;

  PERFORM set_config('app.avancar_os_status', '', true);

  INSERT INTO public.logs_auditoria (usuario_id, entidade, entidade_id, acao, detalhes)
  VALUES (
    v_usuario_id,
    'ordens_servico',
    os_id,
    'status_change',
    jsonb_build_object('anterior', v_os.status, 'novo', novo_status)
  );

  RETURN v_os_atualizada;
END;
$$;

REVOKE ALL ON FUNCTION public.avancar_os_status(UUID, public.status_os) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.avancar_os_status(UUID, public.status_os) TO authenticated;
GRANT EXECUTE ON FUNCTION public.avancar_os_status(UUID, public.status_os) TO service_role;
