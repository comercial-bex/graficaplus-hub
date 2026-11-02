-- A marca "Pergunta sugerida em 02/11/2026 a partir do Holdprint" era nota de trabalho e aparecia para quem atende,
-- na explicação de cada pergunta do item (02/11/2026). As perguntas continuam; só a nota sai.
UPDATE public.produto_perguntas SET descricao = NULL WHERE descricao LIKE 'Pergunta sugerida em 02/11/2026%';
