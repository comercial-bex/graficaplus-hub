
-- 1. Enums
DO $$ BEGIN
  CREATE TYPE public.categoria_produto AS ENUM (
    'impressao_grande_formato','adesivos','comunicacao_visual',
    'brindes','acabamento','instalacao','servico','outros'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.tipo_item AS ENUM ('produto','servico');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Estender produtos
ALTER TABLE public.produtos
  ADD COLUMN IF NOT EXISTS sku text UNIQUE,
  ADD COLUMN IF NOT EXISTS categoria public.categoria_produto NOT NULL DEFAULT 'outros',
  ADD COLUMN IF NOT EXISTS tipo public.tipo_item NOT NULL DEFAULT 'produto',
  ADD COLUMN IF NOT EXISTS unidade text NOT NULL DEFAULT 'un',
  ADD COLUMN IF NOT EXISTS custo_medio numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS margem_minima numeric NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS tempo_producao_min integer,
  ADD COLUMN IF NOT EXISTS imagem_url text,
  ADD COLUMN IF NOT EXISTS observacoes_internas text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- 3. Trigger updated_at
DROP TRIGGER IF EXISTS produtos_set_updated_at ON public.produtos;
CREATE TRIGGER produtos_set_updated_at
  BEFORE UPDATE ON public.produtos
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- 4. Índices para busca/filtro
CREATE INDEX IF NOT EXISTS idx_produtos_categoria ON public.produtos(categoria);
CREATE INDEX IF NOT EXISTS idx_produtos_ativo ON public.produtos(ativo);
CREATE INDEX IF NOT EXISTS idx_produtos_sku ON public.produtos(sku);

-- 5. Seed catálogo padrão (idempotente via SKU)
INSERT INTO public.produtos (sku, nome, descricao, categoria, tipo, unidade, preco_base, custo_medio, margem_minima, tempo_producao_min) VALUES
  ('IGF-LONA-280','Banner lona 280g','Lona front-light 280g impressão solvente','impressao_grande_formato','produto','m2',55,25,40,8),
  ('IGF-LONA-380','Banner lona 380g','Lona reforçada 380g','impressao_grande_formato','produto','m2',70,32,40,8),
  ('IGF-LONA-440','Banner lona 440g','Lona blackout 440g dupla face','impressao_grande_formato','produto','m2',95,48,40,10),
  ('IGF-LONA-BL','Lona backlight','Lona translúcida para caixa luminosa','impressao_grande_formato','produto','m2',140,70,45,12),
  ('IGF-TECIDO','Tecido sublimação','Tecido oxford sublimado','impressao_grande_formato','produto','m2',120,55,45,15),
  ('ADE-VINIL-B','Adesivo vinil brilho','Vinil adesivo brilho impressão solvente','adesivos','produto','m2',85,38,45,7),
  ('ADE-VINIL-F','Adesivo vinil fosco','Vinil adesivo fosco','adesivos','produto','m2',90,40,45,7),
  ('ADE-PERFUR','Adesivo perfurado','Vinil perfurado para vidros','adesivos','produto','m2',135,68,45,9),
  ('ADE-PAREDE','Adesivo de parede','Vinil texturizado para parede','adesivos','produto','m2',110,55,45,8),
  ('ADE-CHAO','Adesivo de chão antiderrapante','Vinil laminado antiderrapante','adesivos','produto','m2',180,90,45,10),
  ('ADE-ETIQ','Etiqueta vinil branco','Etiquetas recortadas em vinil','adesivos','produto','un',2.5,0.8,50,2),
  ('REC-VINIL','Recorte eletrônico em vinil','Recorte plotter de letras e logos','adesivos','servico','m2',60,20,50,15),
  ('CV-ACM3','Placa ACM 3mm','Placa em ACM com adesivo aplicado','comunicacao_visual','produto','m2',280,140,40,30),
  ('CV-LETRA','Letra caixa em PVC','Letra caixa recortada PVC 10mm','comunicacao_visual','produto','un',180,85,45,60),
  ('CV-FACHADA','Fachada com letra caixa LED','Fachada completa LED','comunicacao_visual','servico','un',0,0,40,480),
  ('CV-TOTEM','Totem comunicação visual','Totem ACM com impressão','comunicacao_visual','produto','un',0,0,40,240),
  ('CV-PAINEL','Painel PS impresso','Painel poliestireno impresso','comunicacao_visual','produto','m2',220,110,40,25),
  ('BRI-CV4X4','Cartão de visita 4x4 300g','Cartão couché 300g 4 cores frente e verso','brindes','produto','un',0.35,0.12,50,1),
  ('BRI-FOLDER','Folder A4 4x4 90g','Folder couché 90g 2 dobras','brindes','produto','un',1.2,0.45,50,1),
  ('BRI-FLYER','Flyer A5 4x4 90g','Flyer couché 90g','brindes','produto','un',0.4,0.15,50,1),
  ('BRI-PASTA','Pasta com bolso 250g','Pasta institucional com bolso','brindes','produto','un',8,3.5,45,3),
  ('ACA-LAMBOPP','Laminação BOPP brilho','Laminação BOPP em impressos','acabamento','servico','m2',18,7,55,2),
  ('ACA-ILHOS','Ilhós metálico','Ilhós aplicado em banner','acabamento','servico','un',1.5,0.5,55,1),
  ('ACA-BASTAO','Bastão de madeira p/ banner','Bastão de madeira topo e base','acabamento','produto','un',12,5,50,2),
  ('ACA-APLIC','Aplicação em parede','Mão de obra aplicação adesivo','acabamento','servico','m2',45,20,50,15),
  ('SRV-ARTE','Criação de arte','Layout e diagramação','servico','servico','hora',120,40,60,60),
  ('SRV-INST','Instalação local','Instalação em local do cliente','instalacao','servico','hora',95,40,55,60),
  ('SRV-MEDIDA','Projeto e medição em obra','Visita técnica para medição','servico','servico','un',180,60,60,90),
  ('SRV-URG','Taxa de urgência','Taxa entrega urgente (até 24h)','servico','servico','un',0,0,100,0),
  ('SRV-ENT','Entrega local','Frete dentro da cidade','servico','servico','un',35,15,55,30)
ON CONFLICT (sku) DO NOTHING;
