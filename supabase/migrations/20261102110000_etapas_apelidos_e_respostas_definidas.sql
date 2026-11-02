-- O passo a passo de cada produto, o nome que o cliente usa e a resposta que a casa já decidiu (02/11/2026).
--
-- O dono mandou ler o Holdprint produto por produto. Foi lido só o que é função: a sequência de processos e as
-- perguntas. Nas lonas, faixas, banners e adesivos o padrão é o mesmo: impressão, refile e o acabamento que aquele
-- produto leva. Os textos abaixo (apelidos e quando usar) são nossos, com o vocabulário do balcão.
--
--   Sequência     Só a pasta do produto lê `produto_processos`: isto não muda preço, custo nem OS.
--   Apelidos      "Também conhecido como": a busca do item e a IA acham o produto pelo nome que o cliente usa.
--   Quando usar   O tamanho pronto diz para que serve, em vez de ser só uma medida.
--   Padrão        `resposta_padrao` já vem marcada; com `nao_perguntar`, entra sozinha e aparece como definida.
--                 Nenhuma pergunta nasce com `nao_perguntar` aqui: quem decide o que não se pergunta é o dono.
--
-- Banner: a lona principal é a 280 g (pedido do dono em 02/11). A 440 g é opção, sugerida só com o aviso do preço.

ALTER TABLE public.produto_ficha ADD COLUMN IF NOT EXISTS apelidos text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.produto_tamanhos ADD COLUMN IF NOT EXISTS quando_usar text;
ALTER TABLE public.produto_perguntas
  ADD COLUMN IF NOT EXISTS resposta_padrao text,
  ADD COLUMN IF NOT EXISTS nao_perguntar boolean NOT NULL DEFAULT false;
ALTER TABLE public.produto_perguntas
  ADD CONSTRAINT produto_perguntas_nao_perguntar_tem_resposta
  CHECK (NOT nao_perguntar OR btrim(COALESCE(resposta_padrao, '')) <> '');

-- O Banner.
UPDATE public.produtos
   SET descricao = 'Lona 280g, bastão e corda inclusos. Sob pedido, em lona 440g, com outro preço.'
 WHERE sku = 'BAN-LON';

UPDATE public.produto_ficha f
   SET ia_personalidade = E'## O que é\nBanner em lona 280 g pronto para pendurar, com bastão e corda.\n\n## Onde se usa\nEventos, lojas, igrejas, escolas e pontos de venda.\n\n## Observações\nPronto para uso, sem precisar de estrutura. Tripé é à parte.\n\nSe o cliente pedir mais resistência, sugira a lona 440 g e avise que o preço é outro.',
       ia_perguntas = E'## Antes de orçar\n- O cliente já tem a arte pronta ou precisamos criar?\n- Retira na loja, entrega ou instalação?\n- Qual acabamento? Opções: Bainha + ilhós\n- Precisa de tripé? Quando será usado?\n- Quer a lona comum (280 g) ou a reforçada (440 g, com preço maior)?'
  FROM public.produtos p
 WHERE p.id = f.produto_id AND p.sku = 'BAN-LON';

INSERT INTO public.produto_perguntas (produto_id, pergunta, descricao, obrigatoria, tipo_resposta, respostas, ordem, resposta_padrao)
SELECT p.id, 'Em qual lona?',
       'A principal é a 280 g. Sugira a 440 g só se o cliente pedir mais resistência e avise do preço: na 440 g, ajuste o valor do item.',
       false, 'unica', '["Lona 280 g", "Lona 440 g (outro preço)"]'::jsonb, 0, 'Lona 280 g'
  FROM public.produtos p
 WHERE p.sku = 'BAN-LON'
   AND NOT EXISTS (SELECT 1 FROM public.produto_perguntas q WHERE q.produto_id = p.id AND q.pergunta = 'Em qual lona?');

INSERT INTO public.produto_tamanhos (produto_id, nome, largura, altura, padrao, ordem)
SELECT p.id, v.nome, v.l, v.a, v.pad, v.o
  FROM public.produtos p
 CROSS JOIN (VALUES ('Banner 0,80 × 1,20', 0.8, 1.2, true, 1), ('Banner 1,00 × 0,70', 1.0, 0.7, false, 2), ('Banner 2,00 × 1,00', 2.0, 1.0, false, 3)) AS v(nome, l, a, pad, o)
 WHERE p.sku = 'BAN-LON'
   AND NOT EXISTS (SELECT 1 FROM public.produto_tamanhos t WHERE t.produto_id = p.id AND t.nome = v.nome);

-- Etapas que faltavam no catálogo. O tempo vem do produto até a oficina medir.
INSERT INTO public.processos (nome, descricao, etapa, base_produtividade, produtividade_origem)
VALUES
  ('Aplicação de adesivo em chapa', 'Aplicar o vinil sobre a chapa, sem bolha, antes do corte.', 'acabamento', 'tempo_do_produto', 'nao_se_aplica'),
  ('Corte de chapa', 'Cortar a chapa na medida da peça.', 'acabamento', 'tempo_do_produto', 'nao_se_aplica'),
  ('Máscara de transferência', 'Película que leva o adesivo recortado inteiro até o lugar de aplicar.', 'acabamento', 'tempo_do_produto', 'nao_se_aplica')
ON CONFLICT (nome) DO NOTHING;

-- A sequência de cada produto.
INSERT INTO public.produto_processos (produto_id, processo_id, ordem)
SELECT p.id, pr.id, v.ordem
  FROM (VALUES
    ('LON-280', 'Refile manual', 1), ('LON-440', 'Refile manual', 1), ('LON-FOS', 'Refile manual', 1),
    ('LON-BCK', 'Refile manual', 1), ('LON-DUP', 'Refile manual', 1), ('LON-PER', 'Refile manual', 1),
    ('LON-TEX', 'Refile manual', 1), ('LON-LIS', 'Refile manual', 1),
    ('BAN-LON', 'Refile manual', 1), ('BAN-LON', 'Bastão, ponteira e corda', 2),
    ('ADE-VIN', 'Refile manual', 1), ('ADE-FOS', 'Refile manual', 1), ('ADE-BLK', 'Refile manual', 1),
    ('ADE-TRP', 'Refile manual', 1), ('ADE-PRM', 'Refile manual', 1), ('ADE-JAT', 'Refile manual', 1),
    ('ADE-PERF', 'Refile manual', 1), ('ADE-PERFP', 'Refile manual', 1), ('ADE-P9033', 'Refile manual', 1), ('ADE-P9050', 'Refile manual', 1),
    ('ADE-VINR', 'Depilação de adesivo recortado', 1),
    ('PLA-PS', 'Refile manual', 1), ('PLA-PS', 'Aplicação de adesivo em chapa', 2), ('PLA-PS', 'Corte de chapa', 3),
    ('PLA-PVC', 'Impressão eco-solvente', 0), ('PLA-PVC', 'Refile manual', 1), ('PLA-PVC', 'Aplicação de adesivo em chapa', 2), ('PLA-PVC', 'Corte de chapa', 3),
    ('PLA-ACM', 'Impressão eco-solvente', 0), ('PLA-ACM', 'Refile manual', 1), ('PLA-ACM', 'Aplicação de adesivo em chapa', 2), ('PLA-ACM', 'Corte de chapa', 3),
    ('FAC-LUM', 'Refile manual', 1),
    ('LON-ACB', 'Bainha', 0), ('LON-ACB', 'Colocação de ilhós', 1),
    ('ADE-LAM', 'Laminação', 0),
    ('ACB-RECORTE', 'Recorte eletrônico', 0),
    ('ACB-LASER', 'Corte e gravação a laser CO2', 0),
    ('SRV-PROJ', 'Arte final', 0),
    ('SRV-INST', 'Instalação', 0),
    ('SRV-DESL', 'Deslocamento de equipe', 0)
  ) AS v(sku, processo, ordem)
  JOIN public.produtos p ON p.sku = v.sku
  JOIN public.processos pr ON pr.nome = v.processo
ON CONFLICT (produto_id, processo_id) DO UPDATE SET ordem = EXCLUDED.ordem;

-- O adesivo recortado pergunta da máscara; a resposta já acrescenta a etapa.
INSERT INTO public.produto_perguntas (produto_id, pergunta, obrigatoria, tipo_resposta, respostas, acoes, ordem, resposta_padrao)
SELECT p.id, 'Vai com máscara de transferência?', false, 'unica', '["Sim", "Não"]'::jsonb,
       jsonb_build_array(jsonb_build_object('resposta', 'Sim', 'processo_id', pr.id)), 5, 'Sim'
  FROM public.produtos p
  JOIN public.processos pr ON pr.nome = 'Máscara de transferência'
 WHERE p.sku = 'ADE-VINR'
   AND NOT EXISTS (SELECT 1 FROM public.produto_perguntas q WHERE q.produto_id = p.id AND q.pergunta = 'Vai com máscara de transferência?');

-- Como o cliente chama. Só acrescenta a ficha que falta; a que existe ganha os apelidos.
INSERT INTO public.produto_ficha (produto_id, apelidos)
SELECT p.id, v.apelidos
  FROM (VALUES
    ('BAN-LON', ARRAY['banner', 'banner de lona', 'banner de evento', 'banner de loja', 'banner com bastão']),
    ('LON-280', ARRAY['lona', 'lona comum', 'lona brilho', 'front light', 'frontlight', 'lona de fachada']),
    ('LON-440', ARRAY['lona grossa', 'lona reforçada', 'lona blackout', 'blackout', 'lona 440']),
    ('LON-FOS', ARRAY['lona fosca', 'lona sem brilho']),
    ('LON-BCK', ARRAY['backlight', 'back light', 'lona iluminada', 'lona de luminoso']),
    ('LON-DUP', ARRAY['lona frente e verso', 'lona dois lados']),
    ('LON-PER', ARRAY['lona telada', 'tela mesh', 'mesh', 'lona furada', 'lona de andaime', 'lona de tapume']),
    ('LON-TEX', ARRAY['lona com textura']),
    ('LON-LIS', ARRAY['lona sem trama']),
    ('LON-ADE', ARRAY['lona adesivada', 'adesivo sobre lona']),
    ('LON-CAV', ARRAY['lona do cavalete', 'cavalete']),
    ('LON-FAI', ARRAY['faixa', 'faixa de rua', 'faixa de loja', 'faixa de aniversário', 'faixa de formatura']),
    ('ADE-VIN', ARRAY['adesivo', 'vinil', 'adesivo de vinil', 'vinil impresso', 'adesivo impresso']),
    ('ADE-VINR', ARRAY['adesivo recortado', 'adesivo de recorte', 'letra adesiva', 'vinil de recorte', 'adesivo sem fundo']),
    ('ADE-PERF', ARRAY['perfurado', 'one way', 'microperfurado', 'adesivo de vidro', 'adesivo de vitrine', 'vinil perfurado']),
    ('ADE-JAT', ARRAY['jateado', 'vidro jateado', 'adesivo de vidro jateado']),
    ('ADE-TRP', ARRAY['vinil transparente']),
    ('ADE-BLK', ARRAY['adesivo bloqueado', 'bloqueado']),
    ('ADE-PRM', ARRAY['adesivo promocional']),
    ('PLA-PS', ARRAY['placa de ps', 'poliestireno', 'placa de aviso', 'placa de sinalização']),
    ('PLA-PVC', ARRAY['placa de pvc', 'sinalização interna']),
    ('PLA-ACM', ARRAY['placa de acm', 'alumínio composto', 'placa de fachada']),
    ('FAC-LUM', ARRAY['luminoso', 'fachada iluminada', 'letreiro luminoso', 'caixa de luz']),
    ('LET-CX', ARRAY['letra em relevo', 'letra de pvc', 'letreiro de pvc']),
    ('QUA-ACR', ARRAY['quadro de acrílico', 'placa de acrílico']),
    ('ACR-VIR2', ARRAY['acrílico cortado a laser', 'acrílico cristal']),
    ('ACR-VIR3', ARRAY['acrílico cortado a laser', 'acrílico cristal']),
    ('ACR-ESP2', ARRAY['espelho de acrílico']),
    ('BRI-CHA', ARRAY['chaveiro', 'chaveiro personalizado']),
    ('BRI-CAN', ARRAY['caneta', 'caneta de brinde']),
    ('BRI-CPT500', ARRAY['copo térmico', 'copo gravado']),
    ('BRI-CUIA380', ARRAY['cuia', 'copo cuia']),
    ('BRI-BOL30', ARRAY['bolsa térmica', 'cooler']),
    ('BRI-NEC', ARRAY['nécessaire']),
    ('CAR-4X4', ARRAY['cartão', 'cartões', 'cartão de visita']),
    ('PAN-A5', ARRAY['panfleto', 'flyer', 'folheto']),
    ('SRV-PROJ', ARRAY['arte', 'criação', 'design', 'logo', 'layout']),
    ('SRV-INST', ARRAY['instalação', 'aplicação no local', 'colocar no local']),
    ('SRV-DESL', ARRAY['frete', 'deslocamento', 'km'])
  ) AS v(sku, apelidos)
  JOIN public.produtos p ON p.sku = v.sku
ON CONFLICT (produto_id) DO UPDATE SET apelidos = EXCLUDED.apelidos;

-- Para que serve cada tamanho pronto.
UPDATE public.produto_tamanhos t
   SET quando_usar = v.uso
  FROM (VALUES
    ('Banner 0,80 × 1,20', 'Porta de loja, evento e sala de aula'),
    ('Banner 1,00 × 0,70', 'Balcão e parede pequena'),
    ('Banner 2,00 × 1,00', 'Fundo de mesa e parede de loja'),
    ('Faixa de rua 3,00 × 0,70', 'Aviso de rua e fachada simples'),
    ('Faixa 2,00 × 0,70', 'Portão, muro e aviso de loja'),
    ('Faixa 3,00 × 0,70', 'Aviso de rua e fachada simples'),
    ('Faixa 4,00 × 1,00', 'Fachada larga e evento'),
    ('Faixa 5,00 × 1,00', 'Evento e vista de longe'),
    ('Cavalete 0,60 × 0,90', 'Calçada estreita'),
    ('Cavalete 0,81 × 0,98', 'Porta de loja'),
    ('Cavalete 1,00 × 1,20', 'Cavalete grande, visto da rua'),
    ('Placa 0,50 × 0,30', 'Aviso, porta e recepção'),
    ('Placa 1,00 × 0,50', 'Entrada e sinalização de loja'),
    ('Placa 2,00 × 1,00', 'Fachada e vista de longe'),
    ('Pequeno 0,30 × 0,30', 'Porta, caixa e selo de aviso'),
    ('Médio 0,50 × 0,50', 'Vidro de porta e carro'),
    ('Vitrine 1,00 × 1,00', 'Uma folha de vitrine'),
    ('Vitrine larga 2,00 × 1,00', 'Vitrine inteira')
  ) AS v(nome, uso)
 WHERE t.nome = v.nome;
