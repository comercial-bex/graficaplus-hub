-- Catálogo, fase 2a (25/10/2026): FAMÍLIA do produto e CÓDIGO (SKU) de todo produto ativo.
--
-- Diagnóstico da fase 1: a família (lonas, adesivos perfurados, brindes…) só existia
-- em código (src/domain/orcamentos/tipos-de-produto.ts) e 30 de 53 produtos não tinham
-- SKU, então a busca por código falhava para 57% do catálogo.
--
-- Esta migração só ACRESCENTA: uma coluna nula e o preenchimento do que está vazio.
-- NÃO troca preço, custo, categoria nem nome; NÃO mexe em SKU que já existe; NÃO toca
-- nas views produtos_* (recriá-las descartaria o security_invoker) — a tela lê
-- a família direto da tabela. O padrão de SKU em uso é mantido (ADE-, LON-, SRV-…).
-- Desfazer: UPDATE produtos SET familia = NULL; os SKUs novos podem ser apagados pelo
-- prefixo (lista abaixo).
ALTER TABLE public.produtos ADD COLUMN IF NOT EXISTS familia text;
COMMENT ON COLUMN public.produtos.familia IS
  'Agrupa produtos parecidos dentro da categoria (ex.: "Lonas frontlight"). Texto livre; as sugestões ficam em src/lib/produtos-catalogo.ts.';

WITH mapa(nome, categoria, familia, sku) AS (VALUES
  ('Impressão A3 colorida',                 'impressao_grande_formato', 'Impressão em papel',        NULL),
  ('Impressão A4 colorida',                 'impressao_grande_formato', 'Impressão em papel',        NULL),
  ('Lona 280g impressa',                    'impressao_grande_formato', 'Lonas frontlight',          NULL),
  ('Lona 440g reforçada impressa',          'impressao_grande_formato', 'Lonas frontlight',          NULL),
  ('Lona fosca (comparação)',               'impressao_grande_formato', 'Lonas frontlight',          NULL),
  ('Lona backlight (comparação)',           'impressao_grande_formato', 'Lonas backlight',           NULL),
  ('Adesivo vinil branco impresso',         'adesivos', 'Adesivos impressos',                        NULL),
  ('Adesivo PROMO (comparação)',            'adesivos', 'Adesivos impressos',                        NULL),
  ('Adesivo transparente (comparação)',     'adesivos', 'Adesivos impressos',                        NULL),
  ('Adesivo fosco (comparação)',            'adesivos', 'Adesivos impressos',                        NULL),
  ('Adesivo blackout (comparação)',         'adesivos', 'Adesivos impressos',                        NULL),
  ('Adesivo vinil recortado',               'adesivos', 'Adesivos com recorte',                      NULL),
  ('Adesivo jateado',                       'adesivos', 'Adesivos especiais',                        NULL),
  ('Adesivo perfurado (one way)',           'adesivos', 'Adesivos perfurados',                       NULL),
  ('Adesivo perfurado promocional (comparação)', 'adesivos', 'Adesivos perfurados',                  NULL),
  ('Adesivo Perfurado 90 × 33 cm',          'adesivos', 'Adesivos perfurados',                       'ADE-P9033'),
  ('Adesivo Perfurado 90 × 50 cm',          'adesivos', 'Adesivos perfurados',                       'ADE-P9050'),
  ('Adesivo Praguinha 10 × 10 cm',          'adesivos', 'Adesivos de carroceria',                    'ADE-PRG10'),
  ('Adesivo Praguinha 7 × 7 cm',            'adesivos', 'Adesivos de carroceria',                    'ADE-PRG07'),
  ('Bola Leitoso 33 × 33 cm',               'adesivos', 'Adesivos de carroceria',                    'ADE-BOL33'),
  ('Bolão Leitoso 48 × 48 cm',              'adesivos', 'Adesivos de carroceria',                    'ADE-BLO48'),
  ('Pragão 15 × 15 cm',                     'adesivos', 'Adesivos de carroceria',                    'ADE-PGA15'),
  ('Pragão 30 × 30 cm',                     'adesivos', 'Adesivos de carroceria',                    'ADE-PGA30'),
  ('Testeira 90 × 12 cm',                   'adesivos', 'Adesivos de carroceria',                    'ADE-TES90'),
  ('Banner com bastão e corda',             'comunicacao_visual', 'Banners',                         NULL),
  ('Banner com bastão e corda (Terceirizado)', 'comunicacao_visual', 'Banners',                      NULL),
  ('Fachada luminosa em lona',              'comunicacao_visual', 'Fachadas e letreiros',            NULL),
  ('Letra caixa em PVC',                    'comunicacao_visual', 'Fachadas e letreiros',            NULL),
  ('Placa ACM 3mm com adesivo',             'comunicacao_visual', 'Placas',                          NULL),
  ('Placa PS 2mm com adesivo',              'comunicacao_visual', 'Placas',                          NULL),
  ('Placa PVC expandido 3mm',               'comunicacao_visual', 'Placas',                          NULL),
  ('Acrílico Espelhado Recortado 2mm',      'comunicacao_visual', 'Acrílico',                        'ACR-ESP2'),
  ('Acrílico Virgem Recortado 2mm',         'comunicacao_visual', 'Acrílico',                        'ACR-VIR2'),
  ('Acrílico Virgem Recortado 3mm',         'comunicacao_visual', 'Acrílico',                        'ACR-VIR3'),
  ('Quadro Acrilico',                       'comunicacao_visual', 'Acrílico',                        'QUA-ACR'),
  ('Cartão de visita 4x4 (milheiro)',       'brindes', 'Impressos gráficos',                         NULL),
  ('Panfleto A5 4x4 (milheiro)',            'brindes', 'Impressos gráficos',                         NULL),
  ('BOLSA TERMICA 30L',                     'brindes', 'Brindes personalizados',                     'BRI-BOL30'),
  ('CANETA BASICA PERSONALIZADA',           'brindes', 'Brindes personalizados',                     'BRI-CAN'),
  ('CHAVEIRO ACRILICO',                     'brindes', 'Brindes personalizados',                     'BRI-CHA'),
  ('COPO TERMICO 500ML',                    'brindes', 'Brindes personalizados',                     'BRI-CPT500'),
  ('COPO TIPO CUIA 380ML',                  'brindes', 'Brindes personalizados',                     'BRI-CUIA380'),
  ('KIT CHURRASCO 3PÇ',                     'brindes', 'Brindes personalizados',                     'BRI-KC3'),
  ('KIT CHURRASCO LONGO 2PÇ',               'brindes', 'Brindes personalizados',                     'BRI-KCL2'),
  ('NECESSAIRE PERSONALIZADA',              'brindes', 'Brindes personalizados',                     'BRI-NEC'),
  ('KIT CHURRASCO 12PÇ',                    'outros',  'Brindes personalizados',                     'BRI-KC12'),
  ('KIT CHURRASCO 3PÇ',                     'outros',  'Brindes personalizados',                     'BRI-KC3B'),
  ('Acabamento de lona (bainha + ilhós)',   'acabamento', 'Acabamentos',                             NULL),
  ('Laminação de adesivo',                  'acabamento', 'Acabamentos',                             NULL),
  ('Deslocamento',                          'instalacao', 'Instalação e deslocamento',               NULL),
  ('Instalação em campo',                   'instalacao', 'Instalação e deslocamento',               NULL),
  ('Criação/arte final',                    'servico', 'Criação e serviços',                         NULL),
  ('Impressão 3D (serviço)',                'servico', 'Criação e serviços',                         NULL)
)
UPDATE public.produtos p
   SET familia = COALESCE(p.familia, m.familia),
       sku     = COALESCE(p.sku, m.sku)
  FROM mapa m
 WHERE p.nome = m.nome AND p.categoria::text = m.categoria
   AND (p.familia IS NULL OR (p.sku IS NULL AND m.sku IS NOT NULL));
