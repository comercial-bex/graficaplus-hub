-- 27/10/2026 — pendências que eram informação técnica, não decisão do dono.
--
-- * baixa_de_estoque_pendente: só há o que baixar quando a OS tem material previsto (a OS 44, urna 3D de
--   R$ 121,15, não tinha: o filamento sai do apontamento da impressão).
-- * os_sem_agenda: precisa de um produto COM máquina padrão (ou OS com máquina). Banner terceirizado é feito
--   fora e não ocupa a plotter; OS sem produto (adesivo DTF, máquina que ainda não chegou) não tem o que agendar.
-- * os_sem_material_previsto: brinde de catálogo/cartão/panfleto (revenda) não tem material da casa a prever.
-- * produto_sem_preco: SRV-3D é o produto-casca da calculadora 3D, o preço vem do cálculo de cada peça.
-- * material_sem_estoque_maximo: estoque cheio provisório dos rolos = maior compra registrada (ou 2 rolos) e
--   mínimo = 15% do cheio, como o próprio aviso diz; fica anotado no material para ajustar.
-- * Máquinas com custo/hora zerado ou simbólico: Fiber 30W = valor total do contrato Blips 12613148
--   (R$ 46.398,00) ÷ 10.000 h = R$ 4,64/h (o mesmo critério do CNC laser, R$ 66.979,68 ÷ 10.000 h);
--   plotter de recorte VCUT120CAM = preço de tabela da Ideal Distribuidora (R$ 6.994,00) ÷ 10.000 h =
--   R$ 0,70/h, com a ficha (1.000 g de força, 800 mm/s, boca de 120 cm, câmera CCD). O preço de tabela não é o
--   pago: fica em `especificacoes.preco_referencia` e NÃO vira valor de aquisição (patrimônio).
--   Custo cheio de todos os produtos recomposto depois.

DO $m$
DECLARE
  v_def text := pg_get_functiondef('public.pendencias_do_sistema()'::regprocedure);
  v_novo text;
BEGIN
  v_novo := replace(v_def,
    $a$AND (os.finalidade::text = 'venda' OR EXISTS (SELECT 1 FROM public.os_materiais_previstos m WHERE m.os_id = os.id))$a$,
    $b$AND EXISTS (SELECT 1 FROM public.os_materiais_previstos m WHERE m.os_id = os.id)$b$);
  IF v_novo = v_def THEN RAISE EXCEPTION 'baixa (where) não encontrada'; END IF;
  v_def := v_novo;
  v_novo := replace(v_def,
    $a$AND (os2.finalidade::text = 'venda' OR EXISTS (SELECT 1 FROM public.os_materiais_previstos m2 WHERE m2.os_id = os2.id))$a$,
    $b$AND EXISTS (SELECT 1 FROM public.os_materiais_previstos m2 WHERE m2.os_id = os2.id)$b$);
  IF v_novo = v_def THEN RAISE EXCEPTION 'baixa (total) não encontrada'; END IF;
  v_def := v_novo;
  v_novo := replace(v_def,
    $a$AND EXISTS (SELECT 1 FROM public.itens_os ix WHERE ix.os_id = o.id AND ix.produto_id IS NOT NULL) HAVING count(*) > 0;$a$,
    $b$AND EXISTS (SELECT 1 FROM public.itens_os ix LEFT JOIN public.produtos px ON px.id = ix.produto_id
                    WHERE ix.os_id = o.id AND ix.produto_id IS NOT NULL AND (px.maquina_padrao_id IS NOT NULL OR o.maquina_id IS NOT NULL)) HAVING count(*) > 0;$b$);
  IF v_novo = v_def THEN RAISE EXCEPTION 'os_sem_agenda não encontrada'; END IF;
  v_def := v_novo;
  v_novo := replace(v_def,
    $a$WHERE i.os_id = os.id AND COALESCE(p.tipo::text, 'produto') <> 'servico')$a$,
    $b$WHERE i.os_id = os.id AND COALESCE(p.tipo::text, 'produto') <> 'servico'
                   AND NOT COALESCE((p.categoria::text = 'brindes' OR p.sku LIKE 'BRI-%' OR p.sku LIKE 'PAN-%' OR p.sku LIKE 'CAR-%') AND p.sku <> 'BRI-CHA', false))$b$);
  IF v_novo = v_def THEN RAISE EXCEPTION 'os_sem_material_previsto não encontrada'; END IF;
  EXECUTE v_novo;
END $m$;

DO $m$
DECLARE
  v_def text := pg_get_functiondef('public.pendencias_de_preenchimento()'::regprocedure);
  v_novo text;
BEGIN
  v_novo := replace(v_def,
    $a$AND NOT EXISTS (SELECT 1 FROM public.produto_faixas_preco f WHERE f.produto_id = p.id)$a$,
    $b$AND NOT EXISTS (SELECT 1 FROM public.produto_faixas_preco f WHERE f.produto_id = p.id)
      AND p.sku <> 'SRV-3D'$b$);
  IF v_novo = v_def THEN RAISE EXCEPTION 'produto_sem_preco não encontrado'; END IF;
  EXECUTE v_novo;
END $m$;

UPDATE public.produtos SET maquina_padrao_id = NULL,
  observacoes_internas = trim(both E'\n' from coalesce(observacoes_internas,'') || E'\n27/10/2026: produto terceirizado, sem máquina padrão (não ocupa a plotter da casa na agenda).')
 WHERE nome ILIKE '%(Terceirizado)%' AND maquina_padrao_id IS NOT NULL;

WITH base AS (
  SELECT m.id, m.largura_bobina_m * m.comprimento_bobina_m AS area,
         GREATEST(2, COALESCE((SELECT max(i.quantidade) FROM public.compras_fornecedor_itens i WHERE i.material_id = m.id AND i.quantidade > 0), 0)) AS rolos
    FROM public.materiais m
   WHERE m.status = 'ativo' AND m.largura_bobina_m IS NOT NULL AND m.comprimento_bobina_m IS NOT NULL AND m.estoque_maximo IS NULL)
UPDATE public.materiais m SET estoque_maximo = round(b.area * b.rolos, 2), estoque_minimo = round(b.area * b.rolos * 0.15, 2),
  caracteristicas = trim(both ' ' from coalesce(m.caracteristicas,'') || ' Estoque cheio PROVISÓRIO (27/10/2026): ' || b.rolos::int || ' rolos de ' || round(b.area,1) || ' m² (a maior compra registrada, ou 2 rolos); mínimo = 15% do cheio. Ajustar se a política de compra for outra.'),
  updated_at = now()
  FROM base b WHERE b.id = m.id;

UPDATE public.maquinas SET valor_aquisicao = 46398.00, custo_hora = round(46398.00 / 10000, 4),
  especificacoes = especificacoes || jsonb_build_object('custo_hora_base', 'valor total do contrato Blips 12613148 (R$ 46.398,00) ÷ 10.000 h, o mesmo critério do CNC laser', 'custo_hora_atualizado_em', '2026-10-27')
 WHERE id = 'c67b9750-b7a9-43c7-84c1-2953ed15ecde' AND COALESCE(custo_hora,0) = 0;
UPDATE public.maquinas SET custo_hora = round(6994.00 / 10000, 4),
  especificacoes = (especificacoes - 'custo_hora_provisorio' - 'custo_hora_provisorio_nota') || jsonb_build_object(
    'preco_referencia', 6994.00,
    'custo_hora_base', 'preço de tabela da Ideal Distribuidora em 27/10/2026 (R$ 6.994,00; ofertas de R$ 6.040 a R$ 7.221) ÷ 10.000 h. É o preço de tabela, não o pago: confirmar com a nota da compra.',
    'forca_corte_g', 1000, 'velocidade_mm_s', 800, 'largura_boca_corte_cm', 120, 'largura_max_alimentacao_cm', 135, 'camera', 'CCD, corte de contorno por marcas de registro', 'painel', 'touch')
 WHERE id = 'e2c92d0d-3b74-4240-8633-5428ff00dfc3' AND especificacoes->>'custo_hora_provisorio' = 'true';

DO $r$
DECLARE x record;
BEGIN
  FOR x IN SELECT id FROM public.produtos LOOP
    PERFORM public.sincronizar_precificacao_do_produto(x.id);
  END LOOP;
END $r$;
