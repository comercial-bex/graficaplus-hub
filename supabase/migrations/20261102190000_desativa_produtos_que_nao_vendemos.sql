-- Produtos que a gráfica não está vendendo saem da venda (decisão do dono, 02/11/2026).
--
-- Nenhum dos 11 foi orçado até hoje. Dez têm o material nunca comprado; a Fachada luminosa não tem o custo de
-- estrutura e LED. Continuam no catálogo: quando o material chegar, o botão "Ativar" da lista os traz de volta.

UPDATE public.produtos SET ativo = false
 WHERE sku IN ('FAC-LUM', 'LON-BCK', 'LON-DUP', 'LON-FOS', 'LON-LIS', 'LON-PER', 'LON-TEX', 'ADE-BLK', 'ADE-FOS', 'ADE-PRM', 'ADE-PERFP')
   AND NOT EXISTS (SELECT 1 FROM public.orcamento_itens i WHERE i.produto_id = produtos.id);
