-- Custo de tinta, vinil, lona e perfurado pelo que a Camaleão cobrou (26/10/2026).
--
-- APLICADA no banco vivo em 26/10/2026 pelo MCP, depois de ensaio com rollback;
-- conferida: 4 materiais, tinta em estoque R$ 926,80 em 4.000 ml, 19 produtos
-- recalculados, decisão resolvida, nenhuma automação enfileirada.
--
-- Decisão do dono na conversa de 26/10/2026: perguntado se trocava o custo
-- sabendo que o custo de 19 produtos seria refeito pela receita, respondeu
-- "Pode continuar a resolver. Resolva tudo que precisa resolver." Resolve a
-- decisão `custo_dos_materiais_pelo_que_se_paga` (20261027900000).
--
-- O que muda (as compras estão em compras_fornecedor, migração 20261027700500):
--   Tinta solvente (conjunto)    R$ 0,09/ml  → 0,23/ml (4 L Jetbest a R$ 231,70 = 0,2317;
--                                o cadastro guarda 2 casas, os lotes guardam 0,2317)
--   Vinil adesivo branco brilho  R$ 9,50/m²  → último 6,42; médio 6,58 (7 rolos 1,06 × 50)
--   Lona 280g brilho             R$ 9,50/m²  → 7,25 (rolo 1,60 × 50 a R$ 580)
--   Vinil adesivo perfurado      R$ 22,00/m² → 6,30 (rolo 1,27 × 50 a R$ 400); bobina 1,06 → 1,27 m
--   Fornecedor dos quatro: Camaleão Tintas (o vinil dizia "Fornecedor teste").
-- Os 4.000 ml de tinta lançados em 22/10 entraram a R$ 0,09 — o valor do
-- cadastro, que a tela de entrada usa quando o custo fica em branco — e são os
-- 4 litros da RESERVA 22426. Os dois lotes e as duas entradas passam a R$ 0,2317,
-- com a correção anotada; sem isso a baixa da OS usaria R$ 0,09 e a próxima
-- entrada puxaria o custo médio de volta. Lona: o lote antigo e a entrada de
-- 21/09 ficam como estão (não há prova de onde vieram).
--
-- Efeito medido antes (ensaio com rollback): os gatilhos tg_material_custo_propaga
-- e tg_material_recompoe_custos refazem pela receita o custo de 19 produtos e o
-- custo digitado sai. Preço de venda, preço de parceiro (fixo ou piso abaixo do
-- nível) e os 12 itens de orçamento abertos (custo gravado no item) não mudam.
-- Nenhuma automação de estoque mínimo existe; nada é enviado.
--
-- DESFAZER (custos de antes):
--   materiais: tinta 0,09/0,09; vinil branco 9,50/9,50 fornecedor 'Fornecedor teste';
--     lona 9,50/9,50; perfurado 22,00/22,00 largura 1,06; fornecedor dos outros três NULL.
--   lotes 18deb691… e 51202195… e entradas 7d4ac798… e 62548e08…: custo 0,09
--     (custo_total 0,54 e 359,46).
--   produtos.custo_medio: Adesivo perfurado (one way) 34; Adesivo Perfurado 90 × 33 cm 7,15;
--     90 × 50 cm 10,79; Praguinha 10 × 10 0,11; Praguinha 7 × 7 0,06; Adesivo vinil
--     branco impresso 22; Adesivo vinil recortado 26; Banner com bastão e corda 14,50
--     (e o terceirizado 14,50); Bola Leitoso 33 × 33 1,14; Bolão Leitoso 48 × 48 2,39;
--     Lona 280g impressa 18; Lona 440g reforçada impressa 18,30; Placa ACM 3mm com
--     adesivo 145; Placa PS 2mm com adesivo 62; Placa PVC expandido 3mm 78;
--     Pragão 15 × 15 0,24; Pragão 30 × 30 0,94; Testeira 90 × 12 1,14.

DO $custo$
DECLARE
  v_nota constant text := ' | Custo corrigido em 26/10/2026: de R$ 0,09 para R$ 0,2317/ml (RESERVA 22426 da Camaleão: 4 L Jetbest a R$ 231,70; o 0,09 era o custo do cadastro usado por padrão).';
  v_tinta uuid := (SELECT id FROM public.materiais WHERE nome = 'Tinta solvente (conjunto)');
BEGIN
  -- Já aplicada: não faz de novo.
  IF EXISTS (SELECT 1 FROM public.decisoes_pendentes
              WHERE chave = 'custo_dos_materiais_pelo_que_se_paga' AND resolvida_em IS NOT NULL) THEN
    RETURN;
  END IF;

  -- 1. A tinta que está no estoque: lotes e entradas de 22/10, só os que estão a 0,09.
  UPDATE public.material_lotes
     SET custo_unitario_snapshot = 0.2317,
         custo_total = round(quantidade * 0.2317, 4),
         observacao = coalesce(observacao, '') || v_nota
   WHERE material_id = v_tinta AND custo_unitario_snapshot = 0.09
     AND created_at >= '2026-10-22' AND created_at < '2026-10-23';
  UPDATE public.movimentacoes_estoque
     SET custo_unitario_snapshot = 0.2317,
         observacao = coalesce(observacao, '') || v_nota
   WHERE material_id = v_tinta AND tipo::text = 'entrada' AND custo_unitario_snapshot = 0.09
     AND created_at >= '2026-10-22' AND created_at < '2026-10-23';

  -- 2. O cadastro dos quatro materiais (dispara o recálculo dos 19 produtos).
  -- O cadastro guarda 2 casas: 0,2317 vira 0,23 (a diferença é de 0,7%).
  UPDATE public.materiais SET custo_unitario = 0.23, custo_medio = 0.23, fornecedor = 'Camaleão Tintas'
   WHERE nome = 'Tinta solvente (conjunto)';
  UPDATE public.materiais SET custo_unitario = 6.42, custo_medio = 6.58, fornecedor = 'Camaleão Tintas'
   WHERE nome = 'Vinil adesivo branco brilho';
  UPDATE public.materiais SET custo_unitario = 7.25, custo_medio = 7.25, fornecedor = 'Camaleão Tintas'
   WHERE nome = 'Lona 280g brilho';
  UPDATE public.materiais SET custo_unitario = 6.30, custo_medio = 6.30, fornecedor = 'Camaleão Tintas', largura_bobina_m = 1.27
   WHERE nome = 'Vinil adesivo perfurado';

  -- 3. A decisão fica resolvida, com a resposta do dono.
  UPDATE public.decisoes_pendentes
     SET resolvida_em = now(),
         resolvida_por = '6e6693f1-ea58-42b8-acf6-46fae959566a',
         resposta = 'Trocar pelo que se paga. Resposta do dono na conversa de 26/10/2026: "Pode continuar a resolver. Resolva tudo que precisa resolver." Aplicado pela migração 20261027950000 (custos de antes anotados nela para desfazer).'
   WHERE chave = 'custo_dos_materiais_pelo_que_se_paga' AND resolvida_em IS NULL;
END
$custo$;
