-- Custo real do acrílico: orçamento da Terzian de 03/11/2026 (foto do sistema do fornecedor).
--
-- O cadastro tinha o acrílico cristal a R$ 300 (2 mm) e R$ 400 (3 mm) por m², quase o dobro do
-- que o fornecedor cobra: 2 mm = R$ 316,00 e 3 mm = R$ 398,43 a chapa de 1,03 × 2,03 m. O
-- "Quadro Acrílico" nem tinha material ligado: o custo de R$ 450/m² era digitado à mão, e o
-- orçamento nº 69 saiu com custo de R$ 2.934,82 contra R$ 2.100,00 de venda.
--
-- O que este arquivo faz:
--  1. cadastra a Terzian como fornecedor (sem CNPJ nem contato: não vieram na foto);
--  2. troca o custo do acrílico cristal 2 mm e 3 mm pelo da nota e cadastra o 6 mm e o 10 mm;
--  3. liga o Quadro Acrílico à receita (acrílico 3 mm + adesivo vinil), como a Placa PVC já faz,
--     e o custo do produto passa a sair do material, não de um número digitado.
--
-- Não mexe em preço de venda, em estoque nem em lote. Os materiais novos NÃO levam
-- largura_bobina_m: é essa coluna que faz o sistema tratar o material como rolo e cobrar
-- "estoque cheio" em vermelho; chapa não é rolo.
-- Custo por m² = preço da chapa ÷ área da chapa (arredondado em centavos).
DO $$
DECLARE
  v_quadro constant uuid := 'd64c2518-d40a-42a6-8800-794db7176eda';
  v_ac3    uuid;
  v_vinil  uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.fornecedores WHERE nome = 'Terzian') THEN
    INSERT INTO public.fornecedores (nome, categorias, observacoes, ativo)
    VALUES ('Terzian', ARRAY['materia_prima'],
            'Chapas de acrílico cast cristal. Preços do orçamento de 03/11/2026. CNPJ e contato não vieram na foto: completar.',
            true);
  END IF;

  -- 2 mm e 3 mm já existiam: só o custo muda (e só se ainda estiver no valor antigo).
  UPDATE public.materiais
     SET custo_unitario = round(316.00 / (1.03 * 2.03), 2),
         custo_medio    = round(316.00 / (1.03 * 2.03), 2),
         fornecedor     = 'Terzian',
         caracteristicas = 'Chapa cast cristal 2 mm, 1,03 × 2,03 m (ref. Terzian 4172): R$ 316,00 a chapa. Rende 8 peças de 0,50 × 0,50 m.'
   WHERE nome = 'ACRILICO CRISTAL VIRGEM 2MM' AND custo_unitario = 300;

  UPDATE public.materiais
     SET custo_unitario = round(398.43 / (1.03 * 2.03), 2),
         custo_medio    = round(398.43 / (1.03 * 2.03), 2),
         fornecedor     = 'Terzian',
         caracteristicas = 'Chapa cast cristal 3 mm, 1,03 × 2,03 m (ref. Terzian 3772): R$ 398,43 a chapa. Rende 8 peças de 0,50 × 0,50 m.'
   WHERE nome = 'ACRILICO CRISTAL VIRGEM 3MM' AND custo_unitario = 400;

  -- 6 mm e 10 mm são novos, sem estoque.
  INSERT INTO public.materiais (nome, unidade, estoque, estoque_minimo, custo_unitario, custo_medio, fornecedor, status, caracteristicas)
  SELECT v.nome, 'm²', 0, 0, v.custo, v.custo, 'Terzian', 'ativo', v.obs
    FROM (VALUES
      ('ACRILICO CRISTAL VIRGEM 6MM',  round(801.51  / (1.03 * 2.03), 2),
       'Chapa cast cristal 6 mm, 1,03 × 2,03 m (ref. Terzian 3774): R$ 801,51 a chapa. Rende 8 peças de 0,50 × 0,50 m.'),
      ('ACRILICO CRISTAL VIRGEM 10MM', round(1282.49 / (1.05 * 2.05), 2),
       'Chapa cast cristal 10 mm, 1,05 × 2,05 m (ref. Terzian 3717): R$ 1.282,49 a chapa. Rende 8 peças de 0,50 × 0,50 m.')
    ) v(nome, custo, obs)
   WHERE NOT EXISTS (SELECT 1 FROM public.materiais m WHERE m.nome = v.nome);

  -- Receita do Quadro Acrílico, espelho da Placa PVC (chapa + vinil, 1 m² de cada por m²).
  SELECT id INTO v_ac3   FROM public.materiais WHERE nome = 'ACRILICO CRISTAL VIRGEM 3MM';
  SELECT id INTO v_vinil FROM public.materiais WHERE nome = 'Vinil adesivo branco brilho';
  IF v_ac3 IS NULL OR v_vinil IS NULL THEN
    RAISE EXCEPTION 'Material da receita do quadro não encontrado (acrílico 3 mm: %, vinil: %)', v_ac3, v_vinil;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.produto_materiais WHERE produto_id = v_quadro) THEN
    INSERT INTO public.produto_materiais (produto_id, material_id, quantidade_por_unidade, por_peca, observacao)
    VALUES
      (v_quadro, v_ac3,   1, false, 'Acrílico cast cristal 3 mm: 1 m² por m² de quadro'),
      (v_quadro, v_vinil, 1, false, 'Adesivo vinil impresso colado no quadro: 1 m² por m² de quadro');
  END IF;

  UPDATE public.produtos SET material_principal_id = v_ac3
   WHERE id = v_quadro AND material_principal_id IS NULL;
END $$;
