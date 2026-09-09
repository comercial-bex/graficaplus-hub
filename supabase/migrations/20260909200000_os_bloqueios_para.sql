-- O que falta para a OS avançar — em UM lugar só.
--
-- As regras de "pode avançar?" moravam dentro de `avancar_os_status`, cada uma
-- num RAISE. Consequência prática: a tela não tinha como saber de nada antes de
-- tentar. O operador arrastava o cartão, esperava, e recebia um toast vermelho.
-- Se faltavam três coisas, ele descobria uma por vez, num arrasto cada.
--
-- Conferido no banco em 09/09/2026: as duas OS abertas (#44 e #49) não têm
-- pagamento, nem arte aprovada, nem arquivo final. Ou seja: QUINZE dos vinte e
-- seis status estavam fechados para elas, e o quadro oferecia os quinze sem
-- avisar. É o mesmo padrão das listas divergentes — a tela oferecendo o que o
-- banco recusa — só que aqui a divergência era entre a tela e uma regra, não
-- entre duas listas.
--
-- Esta função é a regra. `avancar_os_status` passa a chamá-la em vez de repetir
-- os IFs, então não existe segunda versão para ficar para trás.

CREATE OR REPLACE FUNCTION public.os_bloqueios_para(os_id uuid, novo_status status_os)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_os public.ordens_servico%ROWTYPE;
  v_bloqueios jsonb := '[]'::jsonb;
  v_margem_minima NUMERIC(5,2) := 20;
  v_desconto_limite NUMERIC(5,2) := 10;
  v_margem NUMERIC(10,2);
  v_desconto NUMERIC(10,2);
  v_total_pago NUMERIC(12,2);
  v_faltando TEXT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'Usuário sem permissão para consultar a OS.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_os FROM public.ordens_servico WHERE id = os_bloqueios_para.os_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OS % não encontrada.', os_bloqueios_para.os_id USING ERRCODE = 'P0002';
  END IF;

  -- Já está lá: nada bloqueia ficar parado onde se está.
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

    IF NOT EXISTS (
      SELECT 1 FROM public.aprovacoes
      WHERE aprovacoes.os_id = os_bloqueios_para.os_id AND tipo = 'arte' AND aprovado = true
    ) THEN
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

  SELECT margem_estimada, desconto_percentual INTO v_margem, v_desconto
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
      'titulo', 'Margem de ' || v_margem || '% abaixo do mínimo de ' || v_margem_minima || '%',
      'resolver', 'Peça aprovação de um gestor ou revise o preço.'
    );
  END IF;

  IF COALESCE(v_desconto, 0) > v_desconto_limite AND NOT EXISTS (
    SELECT 1 FROM public.aprovacoes a
    JOIN public.user_roles ur ON ur.user_id = a.usuario_id AND ur.role IN ('admin','gestor')
    WHERE (a.os_id = os_bloqueios_para.os_id OR a.orcamento_id = v_os.orcamento_id)
      AND a.tipo::text = 'desconto_alto' AND a.aprovado = true
  ) THEN
    v_bloqueios := v_bloqueios || jsonb_build_object(
      'codigo', 'desconto_alto',
      'titulo', 'Desconto de ' || v_desconto || '% acima do limite de ' || v_desconto_limite || '%',
      'resolver', 'Peça aprovação de um gestor ou reduza o desconto.'
    );
  END IF;

  RETURN v_bloqueios;
END;
$function$;

COMMENT ON FUNCTION public.os_bloqueios_para(uuid, status_os) IS
  'O que falta para a OS chegar a este status. Fonte única: avancar_os_status chama esta função em vez de repetir as regras, e a tela chama a mesma para avisar ANTES do arrasto.';

-- avancar_os_status passa a delegar as regras. O que muda para quem usa: em vez
-- de descobrir um impedimento por arrasto, recebe todos de uma vez.
CREATE OR REPLACE FUNCTION public.avancar_os_status(os_id uuid, novo_status status_os)
RETURNS ordens_servico
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_os public.ordens_servico%ROWTYPE;
  v_os_atualizada public.ordens_servico%ROWTYPE;
  v_usuario_id UUID := auth.uid();
  v_bloqueios jsonb;
  v_texto TEXT;
BEGIN
  IF v_usuario_id IS NULL OR NOT public.is_staff(v_usuario_id) THEN
    RAISE EXCEPTION 'Usuário sem permissão para alterar status de OS.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_os
  FROM public.ordens_servico
  WHERE id = avancar_os_status.os_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'OS % não encontrada.', avancar_os_status.os_id USING ERRCODE = 'P0002';
  END IF;

  IF v_os.status = novo_status THEN
    RETURN v_os;
  END IF;

  v_bloqueios := public.os_bloqueios_para(avancar_os_status.os_id, novo_status);

  IF jsonb_array_length(v_bloqueios) > 0 THEN
    SELECT string_agg(b->>'titulo', '; ') INTO v_texto
    FROM jsonb_array_elements(v_bloqueios) b;
    RAISE EXCEPTION 'A OS não pode avançar ainda: %.', v_texto;
  END IF;

  PERFORM set_config('app.avancar_os_status', 'on', true);

  UPDATE public.ordens_servico
  SET status = novo_status,
      updated_at = now()
  WHERE id = avancar_os_status.os_id
  RETURNING * INTO v_os_atualizada;

  PERFORM set_config('app.avancar_os_status', '', true);

  INSERT INTO public.logs_auditoria (usuario_id, entidade, entidade_id, acao, detalhes)
  VALUES (
    v_usuario_id,
    'ordens_servico',
    avancar_os_status.os_id,
    'status_change',
    jsonb_build_object('anterior', v_os.status, 'novo', novo_status)
  );

  RETURN v_os_atualizada;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.os_bloqueios_para(uuid, status_os) TO authenticated;

-- O quadro precisa da resposta por cartão. Uma chamada por cartão não escala,
-- então o lote existe: uma ida ao banco para todas as OS abertas.
CREATE OR REPLACE FUNCTION public.os_bloqueios_do_quadro()
RETURNS TABLE(os_id uuid, bloqueios jsonb)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
  SELECT o.id, public.os_bloqueios_para(o.id, 'em_producao'::status_os)
  FROM public.ordens_servico o
  WHERE o.status NOT IN ('faturado','cancelado','concluido')
$function$;

GRANT EXECUTE ON FUNCTION public.os_bloqueios_do_quadro() TO authenticated;

COMMENT ON FUNCTION public.os_bloqueios_do_quadro() IS
  'As travas de produção de todas as OS abertas, numa chamada só. SECURITY INVOKER: o RLS de ordens_servico continua decidindo quais linhas o usuário enxerga.';
