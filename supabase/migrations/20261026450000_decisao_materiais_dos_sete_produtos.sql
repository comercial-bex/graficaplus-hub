-- Os sete produtos da tabela de terceirizados (ativados em 25/10/2026 com custo provisório) nasceram
-- SEM ficha de material: os materiais deles não existem no estoque (vinil transparente, fosco,
-- blackout, vinil da linha promo, lona fosca e lona backlight). Sem ficha, uma OS desses produtos
-- nasce sem material previsto e a baixa de estoque não acontece. Não se liga o material de outro
-- produto por palpite: o vinil branco não é o blackout.
--
-- Vira uma decisão pendente (aviso para administrador, gestor e financeiro) até os materiais serem
-- cadastrados em Materiais e ligados a cada produto.
INSERT INTO public.decisoes_pendentes (chave, titulo, detalhe) VALUES
  ('materiais_dos_sete_produtos', 'Materiais dos sete produtos da tabela',
   'Adesivo PROMO, perfurado promocional, transparente, fosco, blackout, lona fosca e lona backlight vendem sem ficha de material: o material deles não está no estoque. Cadastre cada material (o assistente de Novo material faz isso, com o preço pago e o estoque cheio) e ligue na ficha do produto.')
ON CONFLICT (chave) DO NOTHING;
