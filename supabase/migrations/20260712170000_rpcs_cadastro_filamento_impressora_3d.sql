-- Pré-requisito: o trigger de material chamava enqueue_automacoes, que está
-- dessincronizado do schema de `automacoes` (referencia colunas inexistentes) e
-- fazia QUALQUER insert/update de material falhar. Automação é efeito colateral e
-- não pode bloquear a gravação — o trigger passa a engolir o erro (com WARNING).
-- O bug de fundo em enqueue_automacoes deve ser corrigido à parte.
CREATE OR REPLACE FUNCTION public.tg_automacao_material_eventos()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_contexto JSONB;
BEGIN
  v_contexto := jsonb_build_object('material', to_jsonb(NEW));
  BEGIN
    PERFORM public.enqueue_automacoes('estoque_minimo', 'materiais', NEW.id, v_contexto);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'enqueue_automacoes falhou para material %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END $function$;

-- RPCs transacionais para cadastro de Filamento e Impressora 3D.
-- As tabelas materiais_3d_filamento e maquinas_3d_config são extensões 1:1 de
-- materiais/maquinas. Escrever direto do frontend exigiria roles distintas
-- (estoque/gestor para o pai + impressao3d.settings.manage para a extensão) e
-- não seria atômico. Estas funções rodam SECURITY DEFINER, checam a permissão
-- impressao3d.settings.manage e gravam pai + extensão numa única transação.

-- ============ FILAMENTO ============
CREATE OR REPLACE FUNCTION public.upsert_filamento_3d(
  p_material_id uuid,
  p_nome text,
  p_tipo text,
  p_marca text DEFAULT NULL,
  p_cor text DEFAULT NULL,
  p_custo_por_kg numeric DEFAULT 0,
  p_peso_kg numeric DEFAULT 1,
  p_diametro numeric DEFAULT 1.75,
  p_densidade numeric DEFAULT NULL,
  p_fator_aproveitamento numeric DEFAULT 1
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
  v_peso_g numeric;
  v_custo_spool numeric;
  v_fator numeric;
BEGIN
  PERFORM require_permission('impressao3d.settings.manage');
  IF COALESCE(btrim(p_nome),'') = '' THEN RAISE EXCEPTION 'Nome do filamento é obrigatório'; END IF;
  IF COALESCE(btrim(p_tipo),'') = '' THEN RAISE EXCEPTION 'Tipo do filamento é obrigatório'; END IF;

  v_fator := COALESCE(NULLIF(p_fator_aproveitamento, 0), 1);
  v_peso_g := COALESCE(p_peso_kg, 0) * 1000;
  v_custo_spool := COALESCE(p_custo_por_kg, 0) * COALESCE(p_peso_kg, 0);
  -- custo_por_grama_calculado é coluna GERADA:
  -- (custo_compra + frete + tributos + outros - descontos) / (peso_liquido * fator)
  -- Basta gravar custo_compra, peso_liquido e fator; a coluna deriva sozinha.

  IF p_material_id IS NULL THEN
    -- materiais só exige `nome`; demais colunas (unidade/estoque/status) têm default.
    INSERT INTO materiais (nome) VALUES (p_nome) RETURNING id INTO v_id;
  ELSE
    v_id := p_material_id;
    UPDATE materiais SET nome = p_nome WHERE id = v_id;
  END IF;

  INSERT INTO materiais_3d_filamento (
    material_id, tipo, marca, cor, diametro, densidade,
    peso_nominal, peso_liquido, custo_compra, fator_aproveitamento, updated_at
  ) VALUES (
    v_id, p_tipo, p_marca, p_cor, p_diametro, p_densidade,
    v_peso_g, v_peso_g, v_custo_spool, v_fator, now()
  )
  ON CONFLICT (material_id) DO UPDATE SET
    tipo = EXCLUDED.tipo, marca = EXCLUDED.marca, cor = EXCLUDED.cor,
    diametro = EXCLUDED.diametro, densidade = EXCLUDED.densidade,
    peso_nominal = EXCLUDED.peso_nominal, peso_liquido = EXCLUDED.peso_liquido,
    custo_compra = EXCLUDED.custo_compra, fator_aproveitamento = EXCLUDED.fator_aproveitamento,
    updated_at = now();

  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.delete_filamento_3d(p_material_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM require_permission('impressao3d.settings.manage');
  DELETE FROM materiais_3d_filamento WHERE material_id = p_material_id;
  DELETE FROM materiais WHERE id = p_material_id;
END $$;

-- ============ IMPRESSORA ============
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
  p_potencia_media_w numeric DEFAULT 0
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
  v_vida numeric;
  v_custo_hora numeric;
BEGIN
  PERFORM require_permission('impressao3d.settings.manage');
  IF COALESCE(btrim(p_nome),'') = '' THEN RAISE EXCEPTION 'Nome da impressora é obrigatório'; END IF;

  -- vida_util_horas tem CHECK > 0; coage null/<=0 para um default seguro.
  v_vida := COALESCE(NULLIF(p_vida_util_horas, 0), 5000);
  IF v_vida <= 0 THEN v_vida := 5000; END IF;
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
    metodo_custo_hora, custo_hora_calculado, ativa, updated_at
  ) VALUES (
    v_id, p_fabricante, p_modelo, p_tecnologia, p_custo_aquisicao, p_valor_residual,
    v_vida, p_manutencao_por_hora, p_potencia_media_w,
    'depreciacao_hora', v_custo_hora, true, now()
  )
  ON CONFLICT (maquina_id) DO UPDATE SET
    fabricante = EXCLUDED.fabricante, modelo = EXCLUDED.modelo, tecnologia = EXCLUDED.tecnologia,
    custo_aquisicao = EXCLUDED.custo_aquisicao, valor_residual = EXCLUDED.valor_residual,
    vida_util_horas = EXCLUDED.vida_util_horas, manutencao_por_hora = EXCLUDED.manutencao_por_hora,
    potencia_media_w = EXCLUDED.potencia_media_w, custo_hora_calculado = EXCLUDED.custo_hora_calculado,
    metodo_custo_hora = 'depreciacao_hora', updated_at = now();

  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.delete_impressora_3d(p_maquina_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM require_permission('impressao3d.settings.manage');
  DELETE FROM maquinas_3d_config WHERE maquina_id = p_maquina_id;
  DELETE FROM maquinas WHERE id = p_maquina_id;
END $$;

GRANT EXECUTE ON FUNCTION public.upsert_filamento_3d(uuid,text,text,text,text,numeric,numeric,numeric,numeric,numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_filamento_3d(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_impressora_3d(uuid,text,text,text,text,numeric,numeric,numeric,numeric,numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_impressora_3d(uuid) TO authenticated;
