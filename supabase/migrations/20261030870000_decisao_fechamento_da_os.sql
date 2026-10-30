-- Registro da decisão tomada por delegação do dono em 30/10/2026, para ficar ao lado das outras do cartão "Decisões do
-- dono" (já nasce resolvida: o cartão só mostra as abertas). O efeito está em 20261030850000_fechamento_assistido_da_os.
INSERT INTO public.decisoes_pendentes (chave, titulo, detalhe, criada_em, resolvida_em, resposta)
SELECT 'fechamento_da_os',
       'Como fechar a OS: exigir os seis registros e treinar, ou fechar com o previsto',
       'O diagnóstico de 29/10/2026 simulou o fechamento nas 18 OS abertas e nenhuma fechava: custo operacional (16), qualidade (12), layout final (11), pagamentos (9), baixa de material (7) e medidas (5). O painel mostrava 1 de 19 OS concluída.',
       now(), now(),
       'Decidido em 30/10/2026 por delegação do dono: fechar com o previsto (opção B). O que é FATO continua travando (pagamento por receber, entrega pendente, tarefa obrigatória, ocorrência aberta, máquina rodando, qualidade reprovada, peça que ainda não saiu). O que é REGISTRO o sistema cobre com o dado real ou com o previsto e marca a OS como "fechada com estimativa" (a margem real dela é a prevista): custo de máquina e mão de obra, baixa de material, inspeção de qualidade, arquivo final e medidas (só de produto em m²). Sem custo lançado e sem custo previsto, não fecha. Para desfazer: voltar a exigir os registros em fechar_os (20261030850000 guarda a regra nova; a antiga está em 20261015170000).'
 WHERE NOT EXISTS (SELECT 1 FROM public.decisoes_pendentes WHERE chave = 'fechamento_da_os');
