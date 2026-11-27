-- ============================================================================
-- Modelo de troféu "JariCross 10 Anos" (26/11/2026, pedido do dono: cadastrar o produto que ainda faltava).
--
-- O orçamento de 55 troféus do JariCross 10 Anos estava saindo pelo modelo genérico "Troféu econômico" (placa de cristal de 2 mm),
-- porque o modelo da ficha de fabricação não existia no catálogo. A ficha (imagem gerada, "Modelo: JariCross 10 Anos") lista três peças:
--
--   1  Placa principal (formato capacete)   acrílico cristal 6 mm            20,0 x 15,0 cm   1 por troféu   vinil impresso + laminação   Laser CO2
--   2  Placa frontal da base                acrílico prata escovado ou branco 2 mm   16,0 x 4,0 cm   1   vinil impresso + laminação   Laser CO2 + plotter
--   3  Base                                 acrílico preto brilhante 10 mm   22,0 x 5,0 cm   1   sem decoração (corte e polimento)   Laser CO2
--   Troféu montado: 18 cm de altura por 20 cm de largura.
--
-- O que entra agora (só o que tem material e preço no cadastro, sem inventar custo):
--   * placa principal: ACRILICO CRISTAL VIRGEM 6MM (cadastrado);
--   * placa frontal da base: ACRILICO BRANCO VIRGEM 2MM (cadastrado; a ficha aceita prata escovado OU branco, e o prata escovado não tem cadastro).
--
-- O que NÃO entra, e o modelo avisa na própria descrição (a tela a mostra ao escolher o modelo): a BASE de acrílico preto de 10 mm. Esse
-- material não existe no cadastro e nenhum fornecedor cadastrado traz o preço dele; o custo não se inventa. O preço deste modelo, por
-- enquanto, NÃO inclui a base. Quando o dono informar o preço da chapa (ou a nota de compra), cadastra-se o material e a peça entra.
-- A regra de 22/11/2026 vale aqui: o que o cadastro não tem é sinalizado ("o preço não inclui esta peça"), não recusado.
--
-- Os valores do modelo ainda são estimados, como os dos três modelos que já existem: `provisorio` fica verdadeiro (a tela avisa), os
-- 20 minutos de mão de obra estão entre os do econômico (15) e os do padrão (25), e o fator de forma 1,35 da placa recortada é o do econômico.
--
-- Só ACRESCENTA: duas inserções, nenhuma alteração nos modelos existentes. Pode ser reaplicada (não duplica). Para desfazer, no fim.
-- ============================================================================

DO $guarda$
BEGIN
  IF to_regclass('public.trofeu_modelos') IS NULL OR to_regclass('public.trofeu_pecas') IS NULL THEN
    RAISE EXCEPTION 'As tabelas de troféu (migrações 20261122200000 e 20261122300000) precisam estar aplicadas antes desta.';
  END IF;
  IF (SELECT count(*) FROM public.materiais WHERE nome = 'ACRILICO CRISTAL VIRGEM 6MM') <> 1
     OR (SELECT count(*) FROM public.materiais WHERE nome = 'ACRILICO BRANCO VIRGEM 2MM') <> 1 THEN
    RAISE EXCEPTION 'Faltam (ou estão repetidos) os materiais ACRILICO CRISTAL VIRGEM 6MM e ACRILICO BRANCO VIRGEM 2MM no cadastro.';
  END IF;
END
$guarda$;

INSERT INTO public.trofeu_modelos (nome, linha, descricao, altura_referencia_m, minutos_de_mao_de_obra, multiplicador_base, provisorio)
SELECT 'JariCross 10 Anos', 'economico',
       'Troféu JariCross 10 Anos (ficha de 26/11/2026): placa principal em formato de capacete, de acrílico cristal 6 mm (20 × 15 cm), e placa frontal da base de 2 mm (16 × 4 cm), impressas em vinil laminado. ' ||
       'ATENÇÃO: falta a BASE de acrílico preto brilhante de 10 mm (22 × 5 cm). Esse material não tem cadastro nem preço, e o preço deste modelo NÃO inclui a base. ' ||
       'A placa frontal usa o branco 2 mm (a ficha aceita prata escovado ou branco). Tempo de mão de obra estimado.',
       0.180, 20.0, 3.00, true
 WHERE NOT EXISTS (SELECT 1 FROM public.trofeu_modelos WHERE nome = 'JariCross 10 Anos');

INSERT INTO public.trofeu_pecas (modelo_id, ordem, nome, material_id, espessura_mm, largura_m, altura_m, quantidade, fator_de_forma, decoracao)
SELECT m.id, v.ordem, v.nome, mat.id, v.espessura, v.largura, v.altura, v.quantidade, v.fator, v.decoracao
  FROM (VALUES
    (1, 'Placa principal (formato capacete)', 'ACRILICO CRISTAL VIRGEM 6MM', 6.0, 0.200, 0.150, 1, 1.35, 'vinil_laminado'),
    (2, 'Placa frontal da base',              'ACRILICO BRANCO VIRGEM 2MM',   2.0, 0.160, 0.040, 1, 1.00, 'vinil_laminado')
  ) AS v(ordem, nome, material, espessura, largura, altura, quantidade, fator, decoracao)
  JOIN public.trofeu_modelos m ON m.nome = 'JariCross 10 Anos'
  JOIN public.materiais mat ON mat.nome = v.material
 WHERE NOT EXISTS (SELECT 1 FROM public.trofeu_pecas p WHERE p.modelo_id = m.id AND p.ordem = v.ordem);

-- Conferência final: o modelo existe uma vez, com as duas peças, ativo e provisório, e os três modelos de antes seguem no catálogo.
DO $conferencia$
DECLARE
  v_modelo uuid;
BEGIN
  SELECT id INTO v_modelo FROM public.trofeu_modelos WHERE nome = 'JariCross 10 Anos';
  IF v_modelo IS NULL THEN RAISE EXCEPTION 'O modelo JariCross 10 Anos não ficou cadastrado.'; END IF;
  IF (SELECT count(*) FROM public.trofeu_pecas WHERE modelo_id = v_modelo) <> 2 THEN
    RAISE EXCEPTION 'O JariCross 10 Anos deveria ter 2 peças, tem %.', (SELECT count(*) FROM public.trofeu_pecas WHERE modelo_id = v_modelo);
  END IF;
  IF NOT (SELECT provisorio AND ativo FROM public.trofeu_modelos WHERE id = v_modelo) THEN
    RAISE EXCEPTION 'O JariCross 10 Anos deve nascer ativo e provisório.';
  END IF;
  IF (SELECT count(*) FROM public.trofeu_modelos WHERE nome IN ('Troféu econômico', 'Troféu padrão em duas camadas', 'Troféu premium em camadas')) <> 3 THEN
    RAISE EXCEPTION 'Os três modelos que já existiam precisam continuar no catálogo.';
  END IF;
END
$conferencia$;

-- ============================================================================
-- DESFAZER (as peças saem junto, por ON DELETE CASCADE; orçamentos já salvos com este modelo guardam as linhas próprias)
-- ============================================================================
-- DELETE FROM public.trofeu_modelos WHERE nome = 'JariCross 10 Anos';
