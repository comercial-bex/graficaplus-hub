-- Pendências resolvidas em 21/10/2026 (decisão do dono: "resolver tudo").
-- Aplicado no banco depois de ensaio com rollback; este arquivo é o registro,
-- e cada passo tem guarda para rodar de novo sem efeito.

-- 1. Rascunhos vazios que a conversa da luanaovilhena abriu em 19/10 (um a cada
--    volta ao "Criar orçamento"; corrigido na tela no #155) e o #94, cópia do
--    #93 por dois toques no "Criar" (0,08 s; corrigido no #157). O banco não
--    tem status "cancelado" para orçamento: "expirado" tira das listas e da
--    pendência "orçamento sem item" e volta com um clique. Nada é apagado.
--    Ensaio: 9 linhas, nenhum aviso enfileirado; o #98 (o que virou a OS #168)
--    e o #93 ficam como estão.
UPDATE public.orcamentos SET status = 'expirado'
 WHERE numero IN (88, 89, 90, 91, 92, 95, 96, 97) AND status = 'rascunho' AND os_id IS NULL
   AND NOT EXISTS (SELECT 1 FROM public.orcamento_itens i WHERE i.orcamento_id = orcamentos.id);
UPDATE public.orcamentos SET status = 'expirado'
 WHERE numero = 94 AND status = 'rascunho' AND os_id IS NULL AND titulo = 'PLACA ACRILICA'
   AND NOT EXISTS (SELECT 1 FROM public.orcamento_itens i WHERE i.orcamento_id = orcamentos.id);

-- 2. Acrílico Virgem Recortado 2mm apontava para a chapa dourada ESPELHADA e
--    não tinha ficha. Não havia chapa virgem de 2 mm cadastrada: entra
--    "ACRILICO CRISTAL VIRGEM 2MM" a R$ 300/m² — o custo que o produto já
--    usava, então recalcular_custo_produto mantém R$ 300 (conferido no ensaio).
--    O Espelhado 2mm fica SEM ficha, por decisão do dono: com a chapa dourada
--    (R$ 87,09/m²) o custo do produto cairia de R$ 400 para R$ 87,09 — só a
--    chapa, sem corte nem mão de obra.
INSERT INTO public.materiais (nome, unidade, custo_medio, custo_unitario, estoque, estoque_minimo, status)
SELECT 'ACRILICO CRISTAL VIRGEM 2MM', 'm²', 300, 300, 0, 0, 'ativo'
 WHERE NOT EXISTS (SELECT 1 FROM public.materiais WHERE nome = 'ACRILICO CRISTAL VIRGEM 2MM');
UPDATE public.produtos p
   SET material_principal_id = (SELECT id FROM public.materiais WHERE nome = 'ACRILICO CRISTAL VIRGEM 2MM')
 WHERE p.nome = 'Acrílico Virgem Recortado 2mm';
INSERT INTO public.produto_materiais (produto_id, material_id, quantidade_por_unidade, observacao)
SELECT p.id, (SELECT id FROM public.materiais WHERE nome = 'ACRILICO CRISTAL VIRGEM 2MM'), 1,
       'Chapa cristal virgem 2 mm, 1 m² por m² vendido (decisão do dono, 21/10/2026)'
  FROM public.produtos p
 WHERE p.nome = 'Acrílico Virgem Recortado 2mm'
   AND NOT EXISTS (SELECT 1 FROM public.produto_materiais pm WHERE pm.produto_id = p.id);
