-- Fechamento do plano orçamento→OS (27/10/2026).
--
-- 1. O cliente VIU o orçamento? Antes só se sabia "enviado" e "aprovado": quem não responde podia
--    nem ter aberto o link, e o lembrete de 48 h não distinguia os dois casos.
-- 2. Quando a conversão automática recusa (item fora do catálogo sem custo, desconto sem
--    aprovação, valor mudado), o motivo fica no histórico do orçamento em vez de se perder:
--    o aprovado seguia parado sem ninguém saber por quê.
ALTER TABLE public.orcamentos
  ADD COLUMN IF NOT EXISTS visualizado_em timestamptz,
  ADD COLUMN IF NOT EXISTS visualizacoes integer NOT NULL DEFAULT 0;

GRANT SELECT (visualizado_em, visualizacoes) ON public.orcamentos TO authenticated;

CREATE OR REPLACE FUNCTION public.converter_aprovado_pelo_cliente(p_orcamento_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_orc public.orcamentos%ROWTYPE;
  v_ator uuid;
  v_res jsonb;
  v_motivo text;
BEGIN
  IF COALESCE((SELECT max(valor) FROM public.custos_tabela WHERE ativo AND codigo = 'converter_sozinho_ao_aprovar'), 1) <= 0 THEN
    RETURN jsonb_build_object('convertido', false, 'motivo', 'desligado');
  END IF;

  SELECT * INTO v_orc FROM public.orcamentos WHERE id = p_orcamento_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('convertido', false, 'motivo', 'não encontrado'); END IF;
  IF v_orc.status::text <> 'aprovado' OR v_orc.os_id IS NOT NULL THEN
    RETURN jsonb_build_object('convertido', false, 'motivo', 'não está aprovado sem OS');
  END IF;

  IF v_orc.cliente_id IS NULL OR COALESCE(v_orc.valor_total, 0) <= 0
     OR NOT EXISTS (SELECT 1 FROM public.orcamento_itens i WHERE i.orcamento_id = p_orcamento_id) THEN
    v_motivo := 'pedido incompleto: falta cliente, itens ou valor';
  ELSE
    SELECT user_id INTO v_ator FROM public.user_roles WHERE role = 'admin'::public.app_role ORDER BY user_id LIMIT 1;
    IF v_ator IS NULL THEN RETURN jsonb_build_object('convertido', false, 'motivo', 'sem admin'); END IF;
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_ator, 'role', 'authenticated')::text, true);
    BEGIN
      v_res := public.converter_orcamento_em_os(p_orcamento_id, '{}'::jsonb);
    EXCEPTION WHEN OTHERS THEN
      v_motivo := SQLERRM;
    END;
  END IF;

  IF v_motivo IS NOT NULL THEN
    INSERT INTO public.eventos_negocio(entidade, entidade_id, cliente_id, tipo, titulo, descricao, usuario_id)
    VALUES ('orcamento', p_orcamento_id, v_orc.cliente_id, 'orcamento_conversao_automatica_recusada',
            'Aprovado, mas não virou OS sozinho', v_motivo, NULL);
    RETURN jsonb_build_object('convertido', false, 'motivo', v_motivo);
  END IF;

  INSERT INTO public.eventos_negocio(entidade, entidade_id, cliente_id, tipo, titulo, descricao, usuario_id)
  VALUES ('orcamento', p_orcamento_id, v_orc.cliente_id, 'orcamento_convertido_automatico',
          'OS criada automaticamente', 'O cliente aprovou pelo link e o pedido estava completo.', v_ator);
  RETURN jsonb_build_object('convertido', true, 'os_id', v_res->>'os_id');
END
$function$;

REVOKE ALL ON FUNCTION public.converter_aprovado_pelo_cliente(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.converter_aprovado_pelo_cliente(uuid) TO service_role;
