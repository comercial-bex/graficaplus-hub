-- RPC transacional para salvar um orçamento 3D completo (assistente).
-- O cálculo de custo/preço é feito no frontend com o motor Decimal (cost-engine);
-- esta função apenas persiste, de forma atômica, as 4 linhas relacionadas:
-- orcamentos_3d -> orcamento_3d_placas -> orcamento_3d_consumos + orcamento_3d_calculos.
-- Checa require_permission('impressao3d.quote.create').

CREATE OR REPLACE FUNCTION public.salvar_orcamento_3d(
  p_cliente_id uuid,
  p_titulo text,
  p_quantidade numeric,
  p_maquina_id uuid,
  p_material_id uuid,
  p_gramas numeric,
  p_tempo_segundos integer,
  p_arquivo_id uuid,
  p_custo_por_grama numeric,
  p_inputs jsonb,
  p_resultados jsonb,
  p_custo_material numeric,
  p_custo_maquina numeric,
  p_custo_energia numeric,
  p_custo_mao_obra numeric,
  p_custo_acabamento numeric,
  p_custo_risco numeric,
  p_custo_indireto numeric,
  p_custo_operacional numeric,
  p_preco numeric,
  p_markup numeric,
  p_margem numeric,
  p_lucro numeric
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid;
  v_orc uuid;
  v_placa uuid;
  v_qtd numeric := COALESCE(NULLIF(p_quantidade, 0), 1);
BEGIN
  v_uid := require_permission('impressao3d.quote.create');
  IF COALESCE(btrim(p_titulo),'') = '' THEN RAISE EXCEPTION 'Título do orçamento é obrigatório'; END IF;

  INSERT INTO orcamentos_3d (
    cliente_id, titulo, quantidade, nivel_precisao, status, versao_motor,
    moeda, preco_nao_arredondado, preco_comercial, created_by
  ) VALUES (
    p_cliente_id, p_titulo, v_qtd, 'validado_pelo_fatiador', 'rascunho', '3d-cost-engine-v1',
    'BRL', p_preco, round(p_preco, 2), v_uid
  ) RETURNING id INTO v_orc;

  INSERT INTO orcamento_3d_placas (
    orcamento_3d_id, maquina_id, nome_placa, quantidade_pecas,
    tempo_estimado_segundos, arquivo_id, fonte
  ) VALUES (
    v_orc, p_maquina_id, 'Placa 1', GREATEST(round(v_qtd)::int, 1),
    p_tempo_segundos, p_arquivo_id, 'manual'
  ) RETURNING id INTO v_placa;

  -- gramas_totais e custo_total são colunas GERADAS (soma das partes × custo/grama);
  -- basta gravar gramas_modelo e custo_por_grama_snapshot.
  INSERT INTO orcamento_3d_consumos (
    placa_id, material_id, gramas_modelo, custo_por_grama_snapshot, fonte
  ) VALUES (
    v_placa, p_material_id, p_gramas, p_custo_por_grama, 'manual'
  );

  INSERT INTO orcamento_3d_calculos (
    orcamento_3d_id, versao, nivel_precisao, inputs_json, resultados_json, versao_motor,
    custo_material, custo_maquina, custo_energia, custo_mao_obra, custo_acabamento,
    custo_risco, custo_indireto, custo_operacional,
    preco_sugerido, preco_praticado, lucro, margem, markup, valor_unitario, created_by
  ) VALUES (
    v_orc, 1, 'validado_pelo_fatiador', COALESCE(p_inputs,'{}'::jsonb), COALESCE(p_resultados,'{}'::jsonb), '3d-cost-engine-v1',
    p_custo_material, p_custo_maquina, p_custo_energia, p_custo_mao_obra, p_custo_acabamento,
    p_custo_risco, p_custo_indireto, p_custo_operacional,
    p_preco, p_preco, p_lucro, p_margem, p_markup, round(p_preco / v_qtd, 2), v_uid
  );

  RETURN v_orc;
END $$;

GRANT EXECUTE ON FUNCTION public.salvar_orcamento_3d(uuid,text,numeric,uuid,uuid,numeric,integer,uuid,numeric,jsonb,jsonb,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric) TO authenticated;
