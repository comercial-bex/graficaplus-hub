-- Onda 2 do plano orçamento→OS (26/10/2026): data de entrega sugerida.
-- PROVISÓRIO: 5 dias úteis até o dono confirmar o prazo real da gráfica.
INSERT INTO public.custos_tabela (categoria, codigo, descricao, valor, unidade, ativo, observacao)
SELECT 'chave', 'prazo_entrega_padrao_dias',
       'Prazo padrão de entrega sugerido no orçamento, em dias úteis', 5, 'dias úteis', true,
       'PROVISÓRIO (26/10/2026): confirmar o prazo real com o dono'
WHERE NOT EXISTS (SELECT 1 FROM public.custos_tabela WHERE codigo = 'prazo_entrega_padrao_dias');
