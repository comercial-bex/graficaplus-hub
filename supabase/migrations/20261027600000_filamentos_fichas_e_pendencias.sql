-- 27/10/2026 — filamentos, fichas de material e pendências que mediam errado.
--
-- 1) "Novo filamento" (upsert_filamento_3d) FALHAVA SEMPRE: o INSERT citava as colunas `tipo` e `ativa`, que
--    `materiais` não tem, e o UPSERT gravava `custo_por_grama_calculado`, que é coluna GERADA. A tela de
--    Filamentos 3D não conseguia cadastrar nada desde a migração de 14/07. Filamento nasce em gramas.
-- 2) Fichas de material dos 7 produtos da tabela (adesivo transparente, fosco, blackout, PROMO, perfurado
--    promocional, lona fosca, lona backlight): o consumo por m² já existe; o vinil transparente tem preço REAL
--    (R$ 21,50 o metro de 1,22 m, nota da Camaleão); os outros 6 materiais ficam SEM PREÇO (venda sob cotação,
--    a internet não traz preço de rolo) e aparecem em "Materiais em ficha técnica sem custo de compra".
-- 3) Pendências: brinde/cartão/panfleto de terceiros é revenda (sem ficha), OS de impressão 3D é agendada e
--    consome filamento por job (não pela agenda de máquina nem pela ficha do produto), e "mão de obra
--    estimada" passa a contar também o salário mínimo provisório.
--
-- Dados aplicados por SQL em 27/10/2026 (não repetem aqui): entrada de 4 rolos da Amazon (pedido
-- 701-2987278-3060254, R$ 379,87 com cupom de R$ 20 rateado: 2× PLA Fosco Ultra Branco Creatorally, 1× PLA
-- Soleyin Ultra Branco Creality, 1× PLA V-Silk Dourado Voolt3D); FILAMENTO PETG 2 → 2.200 g (2 bobinas de 1,1 kg,
-- estava 2 g); Bambu Lab A1 com a ficha pública (256³ mm, 500 mm/s, bico 0,4 mm); tempo por peça provisório do
-- chaveiro acrílico (1 min), copos (5 min) e kit churrasco (6 min); agenda de máquina das OS 161, 162, 163 e 167.

CREATE OR REPLACE FUNCTION public.upsert_filamento_3d(p_material_id uuid, p_nome text, p_tipo text, p_marca text DEFAULT NULL::text, p_cor text DEFAULT NULL::text, p_custo_por_kg numeric DEFAULT 0, p_peso_kg numeric DEFAULT 1, p_diametro numeric DEFAULT 1.75, p_densidade numeric DEFAULT NULL::numeric, p_fator_aproveitamento numeric DEFAULT 1)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_id uuid; v_peso_g numeric; v_custo_spool numeric; v_fator numeric;
BEGIN
  PERFORM require_permission('impressao3d.settings.manage');
  IF COALESCE(btrim(p_nome),'')='' THEN RAISE EXCEPTION 'Nome do filamento é obrigatório'; END IF;
  IF COALESCE(btrim(p_tipo),'')='' THEN RAISE EXCEPTION 'Tipo do filamento é obrigatório'; END IF;
  v_fator := COALESCE(NULLIF(p_fator_aproveitamento,0),1);
  v_peso_g := COALESCE(p_peso_kg,0)*1000;
  v_custo_spool := COALESCE(p_custo_por_kg,0)*COALESCE(p_peso_kg,0);
  IF p_material_id IS NULL THEN
    INSERT INTO materiais (nome, unidade, status, caracteristicas)
    VALUES (p_nome, 'g', 'ativo', concat_ws(', ', NULLIF(btrim(p_cor),''), p_diametro::text || ' mm', 'bobina ' || p_peso_kg::text || ' kg'))
    RETURNING id INTO v_id;
  ELSE v_id := p_material_id; UPDATE materiais SET nome=p_nome WHERE id=v_id; END IF;
  INSERT INTO materiais_3d_filamento (material_id,tipo,marca,cor,diametro,densidade,peso_nominal,peso_liquido,custo_compra,fator_aproveitamento,updated_at)
  VALUES (v_id,p_tipo,p_marca,p_cor,p_diametro,p_densidade,v_peso_g,v_peso_g,v_custo_spool,v_fator,now())
  ON CONFLICT (material_id) DO UPDATE SET tipo=EXCLUDED.tipo,marca=EXCLUDED.marca,cor=EXCLUDED.cor,diametro=EXCLUDED.diametro,densidade=EXCLUDED.densidade,peso_nominal=EXCLUDED.peso_nominal,peso_liquido=EXCLUDED.peso_liquido,custo_compra=EXCLUDED.custo_compra,fator_aproveitamento=EXCLUDED.fator_aproveitamento,updated_at=now();
  RETURN v_id;
END $function$;

INSERT INTO public.materiais (nome, unidade, estoque, estoque_minimo, custo_unitario, custo_medio, fornecedor, status, largura_bobina_m, comprimento_bobina_m, caracteristicas)
SELECT v.nome, 'm²', 0, 0, v.custo, v.custo, v.forn, 'ativo', v.larg, v.comp, v.car
FROM (VALUES
 ('Vinil transparente 1,22 m (Alltak Premium)', 17.6230::numeric, 'Camaleão Tintas', 1.22::numeric, NULL::numeric, 'Custo REAL: R$ 21,50 por metro linear (nota da Camaleão, 26/10/2026) ÷ 1,22 m de largura = R$ 17,62/m². Vendido por metro; o comprimento do rolo não consta.'),
 ('Vinil branco fosco', 0::numeric, NULL, 1.06::numeric, 50::numeric, 'SEM PREÇO: informar o valor pago por rolo. Largura/comprimento presumidos iguais aos do vinil branco brilho (1,06 × 50 m); confirmar. A busca na internet não achou preço de rolo (venda sob cotação).'),
 ('Vinil blackout', 0::numeric, NULL, 1.06::numeric, 50::numeric, 'SEM PREÇO: informar o valor pago por rolo. Largura/comprimento presumidos (1,06 × 50 m); confirmar. Venda sob cotação.'),
 ('Vinil promocional branco', 0::numeric, NULL, 1.06::numeric, 50::numeric, 'SEM PREÇO: informar o valor pago por rolo. Largura/comprimento presumidos (1,06 × 50 m); confirmar. Venda sob cotação.'),
 ('Vinil perfurado promocional', 0::numeric, NULL, 1.27::numeric, 50::numeric, 'SEM PREÇO: informar o valor pago por rolo. Largura/comprimento presumidos iguais aos do vinil perfurado (1,27 × 50 m); confirmar.'),
 ('Lona fosca 440g', 0::numeric, NULL, 1.60::numeric, 50::numeric, 'SEM PREÇO: informar o valor pago por rolo. Largura/comprimento presumidos iguais aos da lona 440g (1,60 × 50 m); confirmar. Venda sob cotação.'),
 ('Lona backlight (translúcida)', 0::numeric, NULL, 1.60::numeric, 50::numeric, 'SEM PREÇO: informar o valor pago por rolo. Largura 1,60 m é a de linha dos fabricantes (1,60 × 50 m); confirmar gramatura. Venda sob cotação.')
) AS v(nome, custo, forn, larg, comp, car)
WHERE NOT EXISTS (SELECT 1 FROM public.materiais m WHERE m.nome = v.nome);

INSERT INTO public.produto_materiais (produto_id, material_id, quantidade_por_unidade, observacao, por_peca)
SELECT p.id, m.id, f.q, f.obs, false
FROM (VALUES
 ('Adesivo transparente','Vinil transparente 1,22 m (Alltak Premium)', 1.05, 'm² + perda de 5% (mesma regra do vinil branco impresso)'),
 ('Adesivo transparente','Tinta solvente (conjunto)', 10, 'ml por m² (mesma regra do vinil branco impresso)'),
 ('Adesivo fosco','Vinil branco fosco', 1.05, 'm² + perda de 5%'),
 ('Adesivo fosco','Tinta solvente (conjunto)', 10, 'ml por m²'),
 ('Adesivo blackout','Vinil blackout', 1.05, 'm² + perda de 5%'),
 ('Adesivo blackout','Tinta solvente (conjunto)', 10, 'ml por m²'),
 ('Adesivo PROMO','Vinil promocional branco', 1.05, 'm² + perda de 5%'),
 ('Adesivo PROMO','Tinta solvente (conjunto)', 10, 'ml por m²'),
 ('Adesivo perfurado promocional','Vinil perfurado promocional', 1.05, 'm² + perda de 5% (mesma regra do perfurado)'),
 ('Adesivo perfurado promocional','Tinta solvente (conjunto)', 12, 'ml por m² (mesma regra do perfurado)'),
 ('Lona fosca','Lona fosca 440g', 1.05, 'm² de lona + perda de 5% (mesma regra da lona 440g)'),
 ('Lona fosca','Tinta solvente (conjunto)', 14, 'ml de tinta por m² (mesma regra da lona 440g)'),
 ('Lona backlight','Lona backlight (translúcida)', 1.05, 'm² de lona + perda de 5%'),
 ('Lona backlight','Tinta solvente (conjunto)', 14, 'ml de tinta por m² (mesma regra da lona 440g; backlight pode pedir mais, medir)')
) AS f(produto, material, q, obs)
JOIN public.produtos p ON p.nome = f.produto AND p.ativo
JOIN public.materiais m ON m.nome = f.material
WHERE NOT EXISTS (SELECT 1 FROM public.produto_materiais x WHERE x.produto_id = p.id AND x.material_id = m.id);

UPDATE public.produtos SET observacoes_internas = 'Custo definido pela ficha de material em 27/10/2026: vinil transparente Alltak (R$ 21,50 por metro linear ÷ 1,22 m = R$ 17,62/m², nota da Camaleão de 26/10) + 10 ml de tinta por m². Preço de balcão e de parceiro: tabela do WhatsApp, mantida (decisão do dono de 25/10/2026).'
 WHERE nome = 'Adesivo transparente' AND observacoes_internas LIKE '%PROVISÓRIOS%';

UPDATE public.produtos SET observacoes_internas = replace(observacoes_internas, 'Confirmar o custo por m² e ajustar.', 'FICHA DE MATERIAL CRIADA em 27/10/2026 (consumo por m²); falta só o preço pago do material, que está sem custo em Materiais.')
 WHERE nome IN ('Adesivo fosco','Adesivo blackout','Adesivo PROMO','Adesivo perfurado promocional','Lona fosca','Lona backlight') AND observacoes_internas LIKE '%Confirmar o custo por m² e ajustar.%';

-- 3) pendências: troca só o trecho da regra e para se ele não for encontrado
DO $m$
DECLARE
  v_def text := pg_get_functiondef('public.pendencias_do_sistema()'::regprocedure);
  v_novo text;
BEGIN
  v_novo := replace(v_def,
    $a$AND NOT EXISTS (SELECT 1 FROM public.produto_materiais pm WHERE pm.produto_id=p.id) HAVING count(*)>0;$a$,
    $b$AND NOT EXISTS (SELECT 1 FROM public.produto_materiais pm WHERE pm.produto_id=p.id)
    AND NOT (p.categoria::text = 'brindes' OR p.sku LIKE 'BRI-%' OR p.sku LIKE 'PAN-%' OR p.sku LIKE 'CAR-%') HAVING count(*)>0;$b$);
  IF v_novo = v_def THEN RAISE EXCEPTION 'trecho de produto_sem_ficha não encontrado'; END IF;
  v_def := v_novo;
  v_novo := replace(v_def,
    $a$AND NOT EXISTS (SELECT 1 FROM public.maquinas_agenda a WHERE a.os_id = o.id) HAVING count(*) > 0;$a$,
    $b$AND NOT EXISTS (SELECT 1 FROM public.maquinas_agenda a WHERE a.os_id = o.id)
    AND NOT EXISTS (SELECT 1 FROM public.producao_3d_jobs j WHERE j.os_id = o.id) HAVING count(*) > 0;$b$);
  IF v_novo = v_def THEN RAISE EXCEPTION 'trecho de os_sem_agenda não encontrado'; END IF;
  v_def := v_novo;
  v_novo := replace(v_def,
    '-- so de servico: nada a prever',
    E'-- 3D: o filamento sai do consumo do job (producao_3d_jobs), não da ficha do produto\n    AND NOT EXISTS (SELECT 1 FROM public.producao_3d_jobs j3 WHERE j3.os_id = os.id)\n    -- so de servico: nada a prever');
  IF v_novo = v_def THEN RAISE EXCEPTION 'trecho de os_sem_material_previsto não encontrado'; END IF;
  EXECUTE v_novo;
END $m$;

DO $m$
DECLARE
  v_def text := pg_get_functiondef('public.pendencias_de_preenchimento()'::regprocedure);
  v_novo text;
BEGIN
  v_novo := replace(v_def, $a$observacoes LIKE 'Estimativa%'$a$, $b$(observacoes LIKE 'Estimativa%' OR observacoes LIKE 'Provisório%')$b$);
  IF v_novo = v_def THEN RAISE EXCEPTION 'trecho de custo estimado não encontrado'; END IF;
  v_def := v_novo;
  v_novo := replace(v_def, 'R$ 10,65/h de mão de obra (média nacional de impressor, não o salário real)', 'R$ 12,17/h de mão de obra (salário mínimo ÷ 176 h com encargos do Simples, não o salário real)');
  IF v_novo = v_def THEN RAISE EXCEPTION 'texto de custo estimado não encontrado'; END IF;
  EXECUTE v_novo;
END $m$;
