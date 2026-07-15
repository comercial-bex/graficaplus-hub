-- Cadastro de energia por máquina: além da potência média (W), a impressora
-- passa a registrar potência de aquecimento e standby (para precisão do custo
-- de energia). A tarifa continua única (base config_precificacao_3d).
DROP FUNCTION IF EXISTS public.upsert_impressora_3d(uuid,text,text,text,text,numeric,numeric,numeric,numeric,numeric);

CREATE OR REPLACE FUNCTION public.upsert_impressora_3d(
  p_maquina_id uuid,
  p_nome text,
  p_fabricante text DEFAULT NULL,
  p_modelo text DEFAULT NULL,
  p_tecnologia text DEFAULT 'FDM',
  p_custo_aquisicao numeric DEFAULT 0,
  p_valor_residual numeric DEFAULT 0,
  p_vida_util_horas numeric DEFAULT 5000,
  p_manutencao_por_hora numeric DEFAULT 0,
  p_potencia_media_w numeric DEFAULT 0,
  p_potencia_aquecimento_w numeric DEFAULT 0,
  p_potencia_standby_w numeric DEFAULT 0
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_vida numeric; v_custo_hora numeric;
BEGIN
  PERFORM require_permission('impressao3d.settings.manage');
  IF COALESCE(btrim(p_nome),'') = '' THEN RAISE EXCEPTION 'Nome da impressora é obrigatório'; END IF;
  v_vida := COALESCE(NULLIF(p_vida_util_horas, 0), 5000); IF v_vida <= 0 THEN v_vida := 5000; END IF;
  v_custo_hora := (COALESCE(p_custo_aquisicao,0) - COALESCE(p_valor_residual,0)) / v_vida
                  + COALESCE(p_manutencao_por_hora,0);

  IF p_maquina_id IS NULL THEN
    INSERT INTO maquinas (nome, tipo, ativa) VALUES (p_nome, 'impressora_3d', true) RETURNING id INTO v_id;
  ELSE
    v_id := p_maquina_id;
    UPDATE maquinas SET nome = p_nome WHERE id = v_id;
  END IF;

  INSERT INTO maquinas_3d_config (
    maquina_id, fabricante, modelo, tecnologia, custo_aquisicao, valor_residual,
    vida_util_horas, manutencao_por_hora, potencia_media_w,
    potencia_aquecimento_w, potencia_standby_w,
    metodo_custo_hora, custo_hora_calculado, ativa, updated_at
  ) VALUES (
    v_id, p_fabricante, p_modelo, p_tecnologia, p_custo_aquisicao, p_valor_residual,
    v_vida, p_manutencao_por_hora, p_potencia_media_w,
    COALESCE(p_potencia_aquecimento_w,0), COALESCE(p_potencia_standby_w,0),
    'depreciacao_hora', v_custo_hora, true, now()
  )
  ON CONFLICT (maquina_id) DO UPDATE SET
    fabricante = EXCLUDED.fabricante, modelo = EXCLUDED.modelo, tecnologia = EXCLUDED.tecnologia,
    custo_aquisicao = EXCLUDED.custo_aquisicao, valor_residual = EXCLUDED.valor_residual,
    vida_util_horas = EXCLUDED.vida_util_horas, manutencao_por_hora = EXCLUDED.manutencao_por_hora,
    potencia_media_w = EXCLUDED.potencia_media_w,
    potencia_aquecimento_w = EXCLUDED.potencia_aquecimento_w,
    potencia_standby_w = EXCLUDED.potencia_standby_w,
    custo_hora_calculado = EXCLUDED.custo_hora_calculado,
    metodo_custo_hora = 'depreciacao_hora', updated_at = now();

  RETURN v_id;
END $$;

GRANT EXECUTE ON FUNCTION public.upsert_impressora_3d(uuid,text,text,text,text,numeric,numeric,numeric,numeric,numeric,numeric,numeric) TO authenticated;
