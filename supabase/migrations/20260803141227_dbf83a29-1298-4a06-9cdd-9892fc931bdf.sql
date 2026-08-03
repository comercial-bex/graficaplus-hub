CREATE UNIQUE INDEX IF NOT EXISTS produto_precificacao_produto_nome_key ON public.produto_precificacao (produto_id, nome);

CREATE OR REPLACE FUNCTION public.tg_sync_produto_precificacao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.preco_base IS NULL THEN RETURN NEW; END IF;
  INSERT INTO public.produto_precificacao (produto_id, nome, unidade, quantidade_base, custo_material, margem_percentual, preco_calculado, updated_at)
  VALUES (NEW.id, 'Preço base', NEW.unidade, 1, COALESCE(NEW.custo_medio,0), COALESCE(NEW.margem_sugerida, NEW.margem_minima, 0), NEW.preco_base, now())
  ON CONFLICT (produto_id, nome) DO UPDATE
    SET unidade = EXCLUDED.unidade,
        custo_material = EXCLUDED.custo_material,
        margem_percentual = EXCLUDED.margem_percentual,
        preco_calculado = EXCLUDED.preco_calculado,
        updated_at = now();
  RETURN NEW;
END $function$;

INSERT INTO public.produtos (sku, nome, descricao, categoria, tipo, unidade, custo_medio, margem_minima, margem_sugerida, preco_base, tempo_producao_min)
VALUES
('LON-280', 'Lona 280g impressa', 'Lona brilho 280g com impressão digital, sem acabamento', 'impressao_grande_formato', 'produto', 'm2', 18.00, 35, 60, 45.00, 20),
('LON-440', 'Lona 440g reforçada impressa', 'Lona blackout 440g, alta durabilidade', 'impressao_grande_formato', 'produto', 'm2', 28.00, 35, 60, 70.00, 25),
('LON-ACB', 'Acabamento de lona (bainha + ilhós)', 'Solda de bainha e ilhós a cada 50cm', 'acabamento', 'servico', 'm', 4.00, 40, 70, 9.00, 10),
('ADE-VIN', 'Adesivo vinil branco impresso', 'Vinil branco brilho com impressão digital', 'adesivos', 'produto', 'm2', 22.00, 40, 70, 55.00, 20),
('ADE-VINR', 'Adesivo vinil recortado', 'Vinil de recorte eletrônico, cor sólida', 'adesivos', 'produto', 'm2', 26.00, 40, 75, 68.00, 35),
('ADE-PERF', 'Adesivo perfurado (one way)', 'Vinil perfurado para vidros', 'adesivos', 'produto', 'm2', 34.00, 35, 65, 82.00, 25),
('ADE-JAT', 'Adesivo jateado', 'Vinil jateado para vidraria', 'adesivos', 'produto', 'm2', 30.00, 35, 65, 75.00, 25),
('ADE-LAM', 'Laminação de adesivo', 'Laminação líquida ou vinil de proteção UV', 'acabamento', 'servico', 'm2', 12.00, 35, 60, 28.00, 15),
('BAN-LON', 'Banner com bastão e corda', 'Lona 440g, bastão e corda inclusos', 'comunicacao_visual', 'produto', 'un', 45.00, 40, 75, 110.00, 40),
('PLA-ACM', 'Placa ACM 3mm com adesivo', 'Chapa ACM 3mm aplicada com vinil impresso', 'comunicacao_visual', 'produto', 'm2', 145.00, 30, 55, 330.00, 90),
('PLA-PS', 'Placa PS 2mm com adesivo', 'Poliestireno 2mm com vinil impresso', 'comunicacao_visual', 'produto', 'm2', 62.00, 30, 55, 145.00, 45),
('PLA-PVC', 'Placa PVC expandido 3mm', 'PVC expandido com impressão/adesivo', 'comunicacao_visual', 'produto', 'm2', 78.00, 30, 55, 175.00, 50),
('FAC-LUM', 'Fachada luminosa em lona', 'Estrutura metálica, lona translúcida e iluminação LED', 'comunicacao_visual', 'produto', 'm2', 420.00, 25, 50, 900.00, 300),
('LET-CX', 'Letra caixa em PVC', 'Letra caixa recortada em PVC 10mm pintada', 'comunicacao_visual', 'produto', 'un', 55.00, 30, 60, 140.00, 60),
('IMP-A4', 'Impressão A4 colorida', 'Papel couché 150g, 4x0', 'impressao_grande_formato', 'produto', 'un', 0.80, 50, 120, 2.50, 2),
('IMP-A3', 'Impressão A3 colorida', 'Papel couché 150g, 4x0', 'impressao_grande_formato', 'produto', 'un', 1.60, 50, 120, 4.50, 3),
('CAR-4X4', 'Cartão de visita 4x4 (milheiro)', 'Couché 300g, verniz UV frente, 1000 unidades', 'brindes', 'produto', 'mil', 78.00, 35, 70, 165.00, 60),
('PAN-A5', 'Panfleto A5 4x4 (milheiro)', 'Couché 115g, 1000 unidades', 'brindes', 'produto', 'mil', 92.00, 35, 70, 195.00, 60),
('SRV-PROJ', 'Criação/arte final', 'Desenvolvimento ou adequação de arte', 'servico', 'servico', 'h', 40.00, 50, 100, 90.00, 60),
('SRV-INST', 'Instalação em campo', 'Mão de obra de instalação (por hora/equipe)', 'instalacao', 'servico', 'h', 60.00, 40, 80, 130.00, 60),
('SRV-DESL', 'Deslocamento', 'Deslocamento de equipe por km rodado', 'instalacao', 'servico', 'km', 2.20, 30, 60, 4.50, NULL),
('SRV-3D', 'Impressão 3D (serviço)', 'Peça em impressão 3D FDM — precificação pelo motor 3D', 'servico', 'servico', 'un', 0.00, 30, 60, NULL, NULL)
ON CONFLICT DO NOTHING;