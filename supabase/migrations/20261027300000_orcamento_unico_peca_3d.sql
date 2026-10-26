-- Orçamento único: a peça 3D vira um ITEM do orçamento comum (27/10/2026).
--
-- Antes eram dois mundos. O orçamento 3D (orcamentos_3d + placas + consumos + cálculos) vivia em
-- /impressao-3d, com conversão, PDF e permissões próprias, e um gatilho espelhava só o VALOR num
-- orçamento comum vazio. Na tela de orçamentos a pessoa via "R$ 504,00 · Itens: 0", sem produto e
-- sem como editar (a calculadora não reabria). Pelo link do cliente, o orçamento aparecia sem itens.
--
-- Agora:
--   * `orcamentos_3d.embutido`: a peça pertence a um orçamento comum; `item_id` aponta para a linha
--     em `orcamento_itens` (é ela que o PDF, o link do cliente, as condições e a OS leem).
--   * O gatilho de espelho não mexe no orçamento quando a peça é embutida: o orçamento é a fonte
--     da verdade (título, cliente, status e total pelos itens).
--   * `salvar_item_3d_no_orcamento`: cria OU edita a peça e o item num ato só (cálculo versionado).
--   * `ler_item_3d`: o que a calculadora precisa para reabrir preenchida; custo só para quem pode.
--   * `remover_item_3d_do_orcamento`: tira o item e a peça juntos.
--   * `converter_orcamento_em_os`: orçamento com peça embutida converte pela porta comum (todos os
--     itens viram itens da OS) e cria os jobs de impressão 3D; a porta do 3D fica só para o legado.
--   * `os_e_impressao_3d`: a OS só dispensa arte aprovada e arquivo final quando TODOS os itens são
--     peças 3D — num pedido misto (banner + peça), o banner continua exigindo.
--   * Retroativo: as 18 peças 3D existentes ganham o item no orçamento espelho.
--
-- Permissão: a mesma de quem cria orçamento (`orcamentos.create`) — o atendimento cota a peça 3D
-- no mesmo lugar em que cota a lona.

ALTER TABLE public.orcamentos_3d
  ADD COLUMN IF NOT EXISTS embutido boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS item_id uuid REFERENCES public.orcamento_itens(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS gramas_modelo numeric;

CREATE INDEX IF NOT EXISTS orcamentos_3d_item_idx ON public.orcamentos_3d (item_id);
GRANT SELECT (embutido, item_id, gramas_modelo) ON public.orcamentos_3d TO authenticated;

COMMENT ON COLUMN public.orcamentos_3d.embutido IS 'A peça está dentro de um orçamento comum (item em orcamento_itens). O orçamento é a fonte da verdade.';
COMMENT ON COLUMN public.orcamentos_3d.item_id IS 'A linha de orcamento_itens que representa esta peça.';

-- 1. O espelho não toca o orçamento de uma peça embutida -------------------------------------
CREATE OR REPLACE FUNCTION public.sync_orcamento_3d_para_funil()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_orc_id uuid; v_status public.status_orcamento;
BEGIN
  -- Peça 3D embutida num orçamento comum (27/10/2026): título, cliente, status e total vêm do
  -- orçamento e dos itens. Nada a espelhar — espelhar aqui sobrescrevia o orçamento inteiro.
  IF COALESCE(NEW.embutido, false) THEN RETURN NULL; END IF;

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
END $function$;

-- 2. Gravar a peça 3D como item do orçamento (criar ou editar) --------------------------------
CREATE OR REPLACE FUNCTION public.salvar_item_3d_no_orcamento(
  p_orcamento_id uuid, p_orcamento_3d_id uuid, p_titulo text, p_quantidade numeric,
  p_maquina_id uuid, p_material_id uuid, p_gramas numeric, p_tempo_segundos integer, p_custo_por_grama numeric,
  p_inputs jsonb, p_resultados jsonb,
  p_custo_material numeric, p_custo_maquina numeric, p_custo_energia numeric, p_custo_mao_obra numeric,
  p_custo_acabamento numeric, p_custo_risco numeric, p_custo_indireto numeric, p_custo_operacional numeric,
  p_preco numeric, p_markup numeric, p_margem numeric, p_lucro numeric,
  p_foto_arquivo_id uuid DEFAULT NULL, p_material_descricao text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid; v_orc public.orcamentos%ROWTYPE; v_t3 public.orcamentos_3d%ROWTYPE;
  v_o3d uuid; v_item uuid; v_placa uuid; v_consumo uuid; v_produto uuid;
  v_qtd numeric := GREATEST(COALESCE(NULLIF(p_quantidade, 0), 1), 1);
  v_unit numeric; v_custo_un numeric; v_preco numeric; v_pecas_placa int; v_placas int;
  v_suporte numeric := COALESCE((p_inputs->>'peso_suporte_g')::numeric, 0);
  v_purga numeric := COALESCE((p_inputs->>'peso_purga_g')::numeric, 0);
  v_foto_caminho text; v_espec text; v_versao int;
BEGIN
  v_uid := public.require_permission('orcamentos.create');
  IF COALESCE(btrim(p_titulo), '') = '' THEN RAISE EXCEPTION 'Dê um nome à peça (título).'; END IF;
  IF p_maquina_id IS NULL OR p_material_id IS NULL THEN RAISE EXCEPTION 'Escolha a impressora e o filamento.'; END IF;
  IF COALESCE(p_gramas, 0) <= 0 THEN RAISE EXCEPTION 'Informe o peso do modelo.'; END IF;
  IF COALESCE(p_tempo_segundos, 0) <= 0 THEN RAISE EXCEPTION 'Informe o tempo de impressão: sem ele a máquina e a energia saem de graça.'; END IF;

  SELECT * INTO v_orc FROM public.orcamentos WHERE id = p_orcamento_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Orçamento não encontrado'; END IF;
  IF v_orc.os_id IS NOT NULL OR v_orc.status::text = 'convertido' THEN
    RAISE EXCEPTION 'Este orçamento já virou OS: os itens ficam como foram vendidos.';
  END IF;

  -- O unitário arredondado manda; o total é unitário × quantidade (fecha a conta na frente do cliente).
  v_unit := round(COALESCE(p_preco, 0) / v_qtd, 2);
  v_preco := round(v_unit * v_qtd, 2);
  v_custo_un := round(COALESCE(p_custo_operacional, 0) / v_qtd, 4);
  v_pecas_placa := GREATEST(COALESCE(NULLIF(p_inputs->>'pecas_por_placa', '')::numeric, 1), 1)::int;
  v_placas := GREATEST(ceil(v_qtd / v_pecas_placa)::int, 1);
  IF p_foto_arquivo_id IS NOT NULL THEN
    SELECT caminho INTO v_foto_caminho FROM public.arquivos WHERE id = p_foto_arquivo_id;
  END IF;
  SELECT id INTO v_produto FROM public.produtos WHERE upper(sku) = 'SRV-3D' AND ativo ORDER BY created_at LIMIT 1;
  v_espec := concat_ws(' · ',
    NULLIF(btrim(COALESCE(p_material_descricao, '')), ''),
    NULLIF(btrim(COALESCE(p_inputs->>'impressora', '')), ''),
    round(p_tempo_segundos / 3600.0, 2) || ' h de impressão',
    CASE WHEN v_placas > 1 THEN v_placas || ' impressões' END);

  IF p_orcamento_3d_id IS NULL THEN
    INSERT INTO public.orcamentos_3d (orcamento_id, embutido, cliente_id, contato_nome, contato_telefone, contato_email,
      titulo, quantidade, nivel_precisao, status, versao_motor, moeda, preco_nao_arredondado, preco_comercial, created_by,
      material_descricao, gramas_modelo, peso_suporte_g, peso_purga_g, pecas_por_placa, filamento_tipo_detectado,
      altura_camada_mm, infill_pct, foto_modelo_path)
    VALUES (p_orcamento_id, true, v_orc.cliente_id, v_orc.contato_nome, v_orc.contato_telefone, v_orc.contato_email,
      btrim(p_titulo), v_qtd, 'validado_pelo_fatiador', 'rascunho', '3d-cost-engine-v1', 'BRL', p_preco, v_preco, v_uid,
      NULLIF(btrim(COALESCE(p_material_descricao, '')), ''), p_gramas, v_suporte, v_purga, v_pecas_placa,
      NULLIF(p_inputs->>'filamento_tipo_detectado', ''), NULLIF(p_inputs->>'altura_camada_mm', '')::numeric,
      NULLIF(p_inputs->>'infill_pct', '')::numeric, v_foto_caminho)
    RETURNING id INTO v_o3d;
    INSERT INTO public.orcamento_3d_placas (orcamento_3d_id, maquina_id, nome_placa, quantidade_pecas, repeticoes, tempo_estimado_segundos, fonte)
    VALUES (v_o3d, p_maquina_id, 'Placa 1', v_pecas_placa, v_placas, p_tempo_segundos, 'manual')
    RETURNING id INTO v_placa;
    INSERT INTO public.orcamento_3d_consumos (placa_id, material_id, gramas_modelo, gramas_suporte, gramas_purga, custo_por_grama_snapshot, fonte)
    VALUES (v_placa, p_material_id, p_gramas, v_suporte, v_purga, COALESCE(p_custo_por_grama, 0), 'manual');
    v_versao := 1;
  ELSE
    SELECT * INTO v_t3 FROM public.orcamentos_3d WHERE id = p_orcamento_3d_id FOR UPDATE;
    IF NOT FOUND OR v_t3.orcamento_id IS DISTINCT FROM p_orcamento_id THEN
      RAISE EXCEPTION 'Esta peça 3D não pertence a este orçamento.';
    END IF;
    IF v_t3.os_id IS NOT NULL THEN RAISE EXCEPTION 'Esta peça já está em produção (a OS existe).'; END IF;
    v_o3d := v_t3.id;
    v_item := v_t3.item_id;
    UPDATE public.orcamentos_3d
       SET embutido = true, titulo = btrim(p_titulo), quantidade = v_qtd,
           preco_nao_arredondado = p_preco, preco_comercial = v_preco,
           material_descricao = COALESCE(NULLIF(btrim(COALESCE(p_material_descricao, '')), ''), material_descricao),
           gramas_modelo = p_gramas, peso_suporte_g = v_suporte, peso_purga_g = v_purga, pecas_por_placa = v_pecas_placa,
           filamento_tipo_detectado = NULLIF(p_inputs->>'filamento_tipo_detectado', ''),
           altura_camada_mm = NULLIF(p_inputs->>'altura_camada_mm', '')::numeric,
           infill_pct = NULLIF(p_inputs->>'infill_pct', '')::numeric,
           foto_modelo_path = COALESCE(v_foto_caminho, foto_modelo_path), updated_at = now()
     WHERE id = v_o3d;
    SELECT id INTO v_placa FROM public.orcamento_3d_placas WHERE orcamento_3d_id = v_o3d ORDER BY nome_placa, id LIMIT 1;
    IF v_placa IS NULL THEN
      INSERT INTO public.orcamento_3d_placas (orcamento_3d_id, maquina_id, nome_placa, quantidade_pecas, repeticoes, tempo_estimado_segundos, fonte)
      VALUES (v_o3d, p_maquina_id, 'Placa 1', v_pecas_placa, v_placas, p_tempo_segundos, 'manual')
      RETURNING id INTO v_placa;
    ELSE
      UPDATE public.orcamento_3d_placas
         SET maquina_id = p_maquina_id, quantidade_pecas = v_pecas_placa, repeticoes = v_placas, tempo_estimado_segundos = p_tempo_segundos
       WHERE id = v_placa;
    END IF;
    SELECT id INTO v_consumo FROM public.orcamento_3d_consumos WHERE placa_id = v_placa ORDER BY id LIMIT 1;
    IF v_consumo IS NULL THEN
      INSERT INTO public.orcamento_3d_consumos (placa_id, material_id, gramas_modelo, gramas_suporte, gramas_purga, custo_por_grama_snapshot, fonte)
      VALUES (v_placa, p_material_id, p_gramas, v_suporte, v_purga, COALESCE(p_custo_por_grama, 0), 'manual');
    ELSE
      UPDATE public.orcamento_3d_consumos
         SET material_id = p_material_id, gramas_modelo = p_gramas, gramas_suporte = v_suporte, gramas_purga = v_purga,
             custo_por_grama_snapshot = COALESCE(p_custo_por_grama, 0)
       WHERE id = v_consumo;
    END IF;
    SELECT COALESCE(max(versao), 0) + 1 INTO v_versao FROM public.orcamento_3d_calculos WHERE orcamento_3d_id = v_o3d;
  END IF;

  -- O cálculo é imutável: cada salvamento é uma versão nova (a última vale).
  INSERT INTO public.orcamento_3d_calculos (orcamento_3d_id, versao, nivel_precisao, inputs_json, resultados_json, versao_motor,
    custo_material, custo_maquina, custo_energia, custo_mao_obra, custo_acabamento, custo_risco, custo_indireto, custo_operacional,
    preco_sugerido, preco_praticado, lucro, margem, markup, valor_unitario, created_by)
  VALUES (v_o3d, v_versao, 'validado_pelo_fatiador', COALESCE(p_inputs, '{}'::jsonb), COALESCE(p_resultados, '{}'::jsonb), '3d-cost-engine-v1',
    p_custo_material, p_custo_maquina, p_custo_energia, p_custo_mao_obra, p_custo_acabamento, p_custo_risco, p_custo_indireto, p_custo_operacional,
    v_preco, v_preco, p_lucro, p_margem, p_markup, v_unit, v_uid);

  -- O item do orçamento: é ele que o PDF, o link do cliente, as condições e a OS leem.
  IF v_item IS NULL OR NOT EXISTS (SELECT 1 FROM public.orcamento_itens WHERE id = v_item) THEN
    INSERT INTO public.orcamento_itens (orcamento_id, descricao, quantidade, unidade, valor_unitario, custo_unitario, ordem,
      produto_id, tipo_produto, origem_calculo, especificacao, parametros, arquivo_id)
    VALUES (p_orcamento_id, btrim(p_titulo), v_qtd, 'un', v_unit, v_custo_un,
      COALESCE((SELECT max(ordem) + 1 FROM public.orcamento_itens WHERE orcamento_id = p_orcamento_id), 0),
      v_produto, '3D', 'orcamento_3d', NULLIF(v_espec, ''), jsonb_build_object('orcamento_3d_id', v_o3d), p_foto_arquivo_id)
    RETURNING id INTO v_item;
    UPDATE public.orcamentos_3d SET item_id = v_item WHERE id = v_o3d;
  ELSE
    UPDATE public.orcamento_itens
       SET descricao = btrim(p_titulo), quantidade = v_qtd, valor_unitario = v_unit, custo_unitario = v_custo_un,
           especificacao = NULLIF(v_espec, ''),
           parametros = COALESCE(parametros, '{}'::jsonb) || jsonb_build_object('orcamento_3d_id', v_o3d),
           arquivo_id = COALESCE(p_foto_arquivo_id, arquivo_id)
     WHERE id = v_item;
  END IF;

  -- A foto do modelo é a capa do item: sai no PDF, no link do cliente e vira referência na OS.
  IF p_foto_arquivo_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.orcamento_item_arquivos WHERE item_id = v_item AND arquivo_id = p_foto_arquivo_id) THEN
    UPDATE public.orcamento_item_arquivos SET capa = false WHERE item_id = v_item;
    INSERT INTO public.orcamento_item_arquivos (item_id, arquivo_id, capa, ordem)
    VALUES (v_item, p_foto_arquivo_id, true, COALESCE((SELECT max(ordem) + 1 FROM public.orcamento_item_arquivos WHERE item_id = v_item), 0));
  END IF;

  RETURN jsonb_build_object('orcamento_id', p_orcamento_id, 'orcamento_3d_id', v_o3d, 'item_id', v_item,
                            'valor_unitario', v_unit, 'valor_total', v_preco, 'versao', v_versao);
END $function$;

REVOKE ALL ON FUNCTION public.salvar_item_3d_no_orcamento(uuid, uuid, text, numeric, uuid, uuid, numeric, integer, numeric, jsonb, jsonb, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.salvar_item_3d_no_orcamento(uuid, uuid, text, numeric, uuid, uuid, numeric, integer, numeric, jsonb, jsonb, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, uuid, text) TO authenticated;

-- 3. O que a calculadora precisa para reabrir uma peça preenchida ------------------------------
CREATE OR REPLACE FUNCTION public.ler_item_3d(p_orcamento_3d_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid; v_t3 public.orcamentos_3d%ROWTYPE; v_placa public.orcamento_3d_placas%ROWTYPE;
  v_consumo public.orcamento_3d_consumos%ROWTYPE; v_calc public.orcamento_3d_calculos%ROWTYPE;
  v_tem_placa boolean := false; v_tem_consumo boolean := false; v_tem_calc boolean := false; r jsonb;
BEGIN
  v_uid := public.require_permission('orcamentos.read');
  SELECT * INTO v_t3 FROM public.orcamentos_3d WHERE id = p_orcamento_3d_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Peça 3D não encontrada'; END IF;
  SELECT * INTO v_placa FROM public.orcamento_3d_placas WHERE orcamento_3d_id = v_t3.id ORDER BY nome_placa, id LIMIT 1;
  v_tem_placa := FOUND;
  IF v_tem_placa THEN
    SELECT * INTO v_consumo FROM public.orcamento_3d_consumos WHERE placa_id = v_placa.id ORDER BY id LIMIT 1;
    v_tem_consumo := FOUND;
  END IF;
  SELECT * INTO v_calc FROM public.orcamento_3d_calculos WHERE orcamento_3d_id = v_t3.id ORDER BY versao DESC LIMIT 1;
  v_tem_calc := FOUND;

  r := jsonb_build_object(
    'orcamento_3d_id', v_t3.id, 'orcamento_id', v_t3.orcamento_id, 'item_id', v_t3.item_id,
    'embutido', COALESCE(v_t3.embutido, false), 'os_id', v_t3.os_id,
    'titulo', v_t3.titulo, 'quantidade', v_t3.quantidade, 'preco_comercial', v_t3.preco_comercial,
    'maquina_id', CASE WHEN v_tem_placa THEN v_placa.maquina_id END,
    'tempo_segundos', CASE WHEN v_tem_placa THEN v_placa.tempo_estimado_segundos END,
    'material_id', CASE WHEN v_tem_consumo THEN v_consumo.material_id END,
    'gramas', COALESCE(v_t3.gramas_modelo, CASE WHEN v_tem_consumo THEN v_consumo.gramas_modelo END),
    'peso_suporte_g', COALESCE(v_t3.peso_suporte_g, CASE WHEN v_tem_consumo THEN v_consumo.gramas_suporte END, 0),
    'peso_purga_g', COALESCE(v_t3.peso_purga_g, CASE WHEN v_tem_consumo THEN v_consumo.gramas_purga END, 0),
    'pecas_por_placa', COALESCE(v_t3.pecas_por_placa, CASE WHEN v_tem_placa THEN v_placa.quantidade_pecas END, 1),
    'filamento_tipo_detectado', v_t3.filamento_tipo_detectado, 'altura_camada_mm', v_t3.altura_camada_mm,
    'infill_pct', v_t3.infill_pct, 'foto_modelo_path', v_t3.foto_modelo_path, 'material_descricao', v_t3.material_descricao);
  -- Os parâmetros de custo (custo-hora, tarifa, markup…) são dado de custo: só para quem pode ver custo.
  IF v_tem_calc AND public.has_permission(v_uid, 'impressao3d.cost.read') THEN
    r := r || jsonb_build_object('custo_inputs', COALESCE(v_calc.inputs_json, '{}'::jsonb) - 'slicer_screenshot',
                                 'slicer_screenshot', v_calc.inputs_json->>'slicer_screenshot');
  END IF;
  RETURN r;
END $function$;

REVOKE ALL ON FUNCTION public.ler_item_3d(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ler_item_3d(uuid) TO authenticated;

-- 4. Tirar a peça do orçamento (item e peça juntos) ----------------------------------------------
CREATE OR REPLACE FUNCTION public.remover_item_3d_do_orcamento(p_orcamento_3d_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_t3 public.orcamentos_3d%ROWTYPE;
BEGIN
  PERFORM public.require_permission('orcamentos.create');
  SELECT * INTO v_t3 FROM public.orcamentos_3d WHERE id = p_orcamento_3d_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF v_t3.os_id IS NOT NULL THEN RAISE EXCEPTION 'Esta peça já virou OS e não pode ser tirada do orçamento.'; END IF;
  IF NOT COALESCE(v_t3.embutido, false) THEN RAISE EXCEPTION 'Esta peça 3D não está dentro de um orçamento.'; END IF;
  IF v_t3.item_id IS NOT NULL THEN
    DELETE FROM public.orcamento_item_arquivos WHERE item_id = v_t3.item_id;
    DELETE FROM public.orcamento_itens WHERE id = v_t3.item_id;
  END IF;
  DELETE FROM public.orcamentos_3d WHERE id = p_orcamento_3d_id; -- placas, consumos e cálculos vão em cascata
END $function$;

REVOKE ALL ON FUNCTION public.remover_item_3d_do_orcamento(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remover_item_3d_do_orcamento(uuid) TO authenticated;

-- 5. A OS "é de impressão 3D" só quando TODOS os itens são peças 3D -------------------------------
-- Num pedido misto (banner + peça), o banner continua exigindo arte aprovada e arquivo final.
CREATE OR REPLACE FUNCTION public.os_e_impressao_3d(p_os_id uuid, p_orcamento_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.orcamentos_3d t3
    WHERE t3.os_id = p_os_id
       OR (p_orcamento_id IS NOT NULL AND t3.orcamento_id = p_orcamento_id)
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.orcamento_itens i
    WHERE p_orcamento_id IS NOT NULL AND i.orcamento_id = p_orcamento_id
      AND COALESCE(i.origem_calculo, '') NOT IN ('orcamento_3d', 'taxa_prazo')
  )
$function$;

DO $bloqueios$
DECLARE
  v_def text := pg_get_functiondef('public.os_bloqueios_para(uuid, public.status_os)'::regprocedure);
  v_de text := $a$       AND NOT EXISTS (
         SELECT 1 FROM public.orcamentos_3d t3
         WHERE t3.os_id = os_bloqueios_para.os_id
            OR (t3.orcamento_id IS NOT NULL AND t3.orcamento_id = v_os.orcamento_id)
       ) THEN$a$;
  v_para text := $b$       -- Só dispensa a arte quando a OS é SÓ de peças 3D (27/10/2026): num pedido misto o
       -- banner continua precisando da aprovação.
       AND NOT public.os_e_impressao_3d(os_bloqueios_para.os_id, v_os.orcamento_id) THEN$b$;
BEGIN
  IF position('AND NOT public.os_e_impressao_3d(os_bloqueios_para.os_id, v_os.orcamento_id) THEN' IN v_def) > 0 THEN
    RETURN; -- já trocado
  END IF;
  IF (length(v_def) - length(replace(v_def, v_de, ''))) / length(v_de) <> 1 THEN
    RAISE EXCEPTION 'os_bloqueios_para: o teste da arte 3D não está como esperado; revise a troca';
  END IF;
  EXECUTE replace(v_def, v_de, v_para);
END
$bloqueios$;

-- 6. Conversão em OS: peça embutida converte pela porta comum e ganha os jobs de impressão -------
DO $conv$
DECLARE
  v_def text := pg_get_functiondef('public.converter_orcamento_em_os(uuid, jsonb)'::regprocedure);
  v_de1 text := $a$  IF EXISTS (SELECT 1 FROM public.orcamentos_3d t3 WHERE t3.orcamento_id = p_orcamento_id) THEN
    RETURN public.converter_orcamento_3d_em_os(
      (SELECT t3.id FROM public.orcamentos_3d t3 WHERE t3.orcamento_id = p_orcamento_id ORDER BY t3.created_at DESC LIMIT 1));
  END IF;$a$;
  v_para1 text := $b$  -- Só o 3D LEGADO (sem item no orçamento) converte pela porta do 3D. A peça embutida (27/10/2026)
  -- é um item como os outros: converte aqui e ganha os jobs de impressão mais abaixo.
  IF EXISTS (SELECT 1 FROM public.orcamentos_3d t3 WHERE t3.orcamento_id = p_orcamento_id AND NOT COALESCE(t3.embutido, false)) THEN
    RETURN public.converter_orcamento_3d_em_os(
      (SELECT t3.id FROM public.orcamentos_3d t3 WHERE t3.orcamento_id = p_orcamento_id AND NOT COALESCE(t3.embutido, false)
        ORDER BY t3.created_at DESC LIMIT 1));
  END IF;$b$;
  v_de2 text := $c$  UPDATE public.orcamentos SET os_id = v_os_id WHERE id = p_orcamento_id;
$c$;
  v_para2 text := $d$  UPDATE public.orcamentos SET os_id = v_os_id WHERE id = p_orcamento_id;

  -- Peças 3D embutidas (27/10/2026): cada uma ganha os jobs de impressão da OS, ligados ao item
  -- da OS que a representa. Acessório: a OS nasce mesmo que um job falhe, e o motivo fica no log.
  DECLARE v_t3 record; v_os_item uuid;
  BEGIN
    FOR v_t3 IN SELECT * FROM public.orcamentos_3d
                 WHERE orcamento_id = p_orcamento_id AND COALESCE(embutido, false) AND os_id IS NULL LOOP
      BEGIN
        UPDATE public.orcamentos_3d SET os_id = v_os_id, status = 'convertido' WHERE id = v_t3.id;
        v_jobs_3d := v_jobs_3d + public.criar_jobs_3d_da_os(v_t3.id, v_os_id);
        SELECT id INTO v_os_item FROM public.itens_os WHERE os_id = v_os_id AND orcamento_item_id = v_t3.item_id LIMIT 1;
        IF v_os_item IS NOT NULL THEN
          UPDATE public.producao_3d_jobs SET os_item_id = v_os_item
           WHERE os_id = v_os_id AND orcamento_3d_id = v_t3.id AND os_item_id IS NULL;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'Peça 3D % da OS % ficou sem jobs de impressão: %', v_t3.id, v_os_id, SQLERRM;
      END;
    END LOOP;
  END;
$d$;
  v_de3 text := $e$  v_desconto_os NUMERIC := 0;
BEGIN$e$;
  v_para3 text := $f$  v_desconto_os NUMERIC := 0;
  v_jobs_3d INT := 0;
BEGIN$f$;
  v_de4 text := $g$    'agenda', v_agenda,
    'desconto', v_desconto_os
  );$g$;
  v_para4 text := $h$    'agenda', v_agenda,
    'desconto', v_desconto_os,
    'jobs_3d', v_jobs_3d
  );$h$;
BEGIN
  IF position('v_jobs_3d' IN v_def) > 0 THEN RETURN; END IF; -- já trocado
  IF (length(v_def) - length(replace(v_def, v_de1, ''))) / length(v_de1) <> 1 THEN
    RAISE EXCEPTION 'converter_orcamento_em_os: o desvio para o 3D não está como esperado';
  END IF;
  IF (length(v_def) - length(replace(v_def, v_de2, ''))) / length(v_de2) <> 1 THEN
    RAISE EXCEPTION 'converter_orcamento_em_os: o ponto de gravar os_id não está como esperado';
  END IF;
  IF (length(v_def) - length(replace(v_def, v_de3, ''))) / length(v_de3) <> 1 THEN
    RAISE EXCEPTION 'converter_orcamento_em_os: o fim do DECLARE não está como esperado';
  END IF;
  IF (length(v_def) - length(replace(v_def, v_de4, ''))) / length(v_de4) <> 1 THEN
    RAISE EXCEPTION 'converter_orcamento_em_os: o retorno não está como esperado';
  END IF;
  v_def := replace(v_def, v_de1, v_para1);
  v_def := replace(v_def, v_de2, v_para2);
  v_def := replace(v_def, v_de3, v_para3);
  v_def := replace(v_def, v_de4, v_para4);
  EXECUTE v_def;
END
$conv$;

-- 7. Retroativo: as peças 3D que já existem ganham o item no orçamento espelho -------------------
DO $retro$
DECLARE
  t record; v_calc record; v_tem_calc boolean; v_qtd numeric; v_unit numeric; v_custo_un numeric;
  v_item uuid; v_produto uuid; v_arq uuid; v_gramas numeric; n int := 0;
BEGIN
  SELECT id INTO v_produto FROM public.produtos WHERE upper(sku) = 'SRV-3D' AND ativo ORDER BY created_at LIMIT 1;
  FOR t IN SELECT t3.* FROM public.orcamentos_3d t3
            WHERE t3.orcamento_id IS NOT NULL AND t3.item_id IS NULL
              AND EXISTS (SELECT 1 FROM public.orcamentos o WHERE o.id = t3.orcamento_id)
            ORDER BY t3.created_at LOOP
    SELECT * INTO v_calc FROM public.orcamento_3d_calculos WHERE orcamento_3d_id = t.id ORDER BY versao DESC LIMIT 1;
    v_tem_calc := FOUND;
    v_qtd := GREATEST(COALESCE(t.quantidade, 1), 1);
    v_unit := round(COALESCE(t.preco_comercial, 0) / v_qtd, 2);
    v_custo_un := round(COALESCE(CASE WHEN v_tem_calc THEN v_calc.custo_operacional END, 0) / v_qtd, 4);
    SELECT c.gramas_modelo INTO v_gramas
      FROM public.orcamento_3d_placas p JOIN public.orcamento_3d_consumos c ON c.placa_id = p.id
     WHERE p.orcamento_3d_id = t.id ORDER BY p.nome_placa, p.id LIMIT 1;

    v_arq := NULL;
    IF t.foto_modelo_path IS NOT NULL THEN
      INSERT INTO public.arquivos (cliente_id, nome, caminho, bucket, tipo, created_by, observacao)
      VALUES (t.cliente_id, 'Foto do modelo — ' || btrim(t.titulo), t.foto_modelo_path, 'arquivos-clientes', 'referencia',
              t.created_by, 'Veio do orçamento 3D')
      RETURNING id INTO v_arq;
    END IF;

    INSERT INTO public.orcamento_itens (orcamento_id, descricao, quantidade, unidade, valor_unitario, custo_unitario, ordem,
      produto_id, tipo_produto, origem_calculo, especificacao, parametros, arquivo_id)
    VALUES (t.orcamento_id, t.titulo, v_qtd, 'un', v_unit, v_custo_un, 0, v_produto, '3D', 'orcamento_3d',
      t.material_descricao, jsonb_build_object('orcamento_3d_id', t.id, 'retroativo', true), v_arq)
    RETURNING id INTO v_item;
    IF v_arq IS NOT NULL THEN
      INSERT INTO public.orcamento_item_arquivos (item_id, arquivo_id, capa, ordem) VALUES (v_item, v_arq, true, 0);
    END IF;
    UPDATE public.orcamentos_3d SET embutido = true, item_id = v_item, gramas_modelo = COALESCE(gramas_modelo, v_gramas) WHERE id = t.id;
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'peças 3D ligadas a itens do orçamento: %', n;
END
$retro$;

-- 8. Tirar a peça inteira passa pelo gatilho de imutabilidade do cálculo ---------------------------
-- A cascata chega ao cálculo depois que orcamentos_3d já sumiu: só nesse caso o DELETE passa.
-- Alterar ou apagar um cálculo avulso continua proibido.
CREATE OR REPLACE FUNCTION public.prevent_update_orcamento_3d_calculos()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM public.orcamentos_3d WHERE id = OLD.orcamento_3d_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'orcamento_3d_calculos é imutável; gere nova versão';
END $function$;
