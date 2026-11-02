-- A IA recebe a instrução de cada pergunta e os limites de cada máquina (02/11/2026, pedido do dono).
--
-- O dono mandou ler a aba Orç.AI do Holdprint produto por produto. O que serve é a lógica: cada pergunta do checklist
-- traz o que fazer com ela, em três modos (perguntar, marcar só se o cliente falar, definir sem perguntar). Os textos
-- abaixo são nossos, com as máquinas e os materiais da Bex; os limites vêm de `maquinas.especificacoes` e de
-- `materiais.largura_bobina_m`.
--
--   ia_modo        Vale só para a IA. Quem atende continua vendo a pergunta no item.
--   ia_resposta    A resposta que a IA marca no modo definir.
--   ia_instrucao   Quando perguntar, o que explicar, de que resposta depende.
--
-- Arte final passa a cobrar por hora quando a resposta diz que precisamos criar a arte.
-- Precisam de confirmação do dono: a emenda de peça maior que o rolo e o aviso sobre branco no adesivo transparente.

ALTER TABLE public.produto_perguntas
  ADD COLUMN IF NOT EXISTS ia_modo text NOT NULL DEFAULT 'perguntar',
  ADD COLUMN IF NOT EXISTS ia_resposta text,
  ADD COLUMN IF NOT EXISTS ia_instrucao text;
ALTER TABLE public.produto_perguntas DROP CONSTRAINT IF EXISTS produto_perguntas_ia_modo_valido;
ALTER TABLE public.produto_perguntas ADD CONSTRAINT produto_perguntas_ia_modo_valido
  CHECK (ia_modo IN ('perguntar', 'seguir_cliente', 'definir'));
ALTER TABLE public.produto_perguntas DROP CONSTRAINT IF EXISTS produto_perguntas_ia_definir_tem_resposta;
ALTER TABLE public.produto_perguntas ADD CONSTRAINT produto_perguntas_ia_definir_tem_resposta
  CHECK (ia_modo <> 'definir' OR btrim(COALESCE(ia_resposta, '')) <> '');

UPDATE public.processos pr SET produto_servico_id = p.id, medida_cobrada = 'informar'
  FROM public.produtos p WHERE p.sku = 'SRV-PROJ' AND pr.nome = 'Arte final';

-- As perguntas que já existem.
UPDATE public.produto_perguntas SET ia_modo = 'perguntar',
  ia_instrucao = 'Pergunte sempre. Se for por nossa conta, peça o bairro e como é o acesso ao local. Horas e km ficam para quem atende preencher.'
 WHERE pergunta IN ('A instalação é por nossa conta?', 'A aplicação é por nossa conta?');
UPDATE public.produto_perguntas SET ia_modo = 'perguntar',
  ia_instrucao = 'Pergunte só se a aplicação for por nossa conta. Vidro e veículo pedem cuidados diferentes de parede.'
 WHERE pergunta = 'Onde o adesivo vai aplicado?';
UPDATE public.produto_perguntas SET ia_modo = 'perguntar',
  ia_instrucao = 'Pergunte quando a peça fica na rua, leva atrito ou é limpa com frequência. Explique que a laminação protege a impressão e é cobrada à parte.'
 WHERE pergunta = 'Precisa de laminação?';
UPDATE public.produto_perguntas SET ia_modo = 'definir', ia_resposta = 'Não',
  ia_instrucao = 'Não fale de embalagem. Se o cliente disser que vai despachar a peça, anote na observação.'
 WHERE pergunta = 'Precisa embalar para transporte?';
UPDATE public.produto_perguntas SET ia_modo = 'definir', ia_resposta = 'Sim',
  ia_instrucao = 'Não fale de máscara: adesivo recortado sai sempre com ela.'
 WHERE pergunta = 'Vai com máscara de transferência?';

-- Perguntas novas, opcionais para quem atende.
INSERT INTO public.produto_perguntas (produto_id, pergunta, obrigatoria, tipo_resposta, respostas, acoes, ordem, ia_modo, ia_instrucao)
SELECT p.id, 'A arte está pronta?', false, 'unica', '["Sim, arte pronta", "Não, precisamos criar"]'::jsonb,
       jsonb_build_array(jsonb_build_object('resposta', 'Não, precisamos criar', 'processo_id', pr.id)), 1, 'perguntar',
       CASE WHEN m.tipo IN ('laser_co2', 'laser_fiber', 'plotter_recorte')
            THEN 'Pergunte sempre. Esta máquina trabalha com vetor (PDF, AI, CDR ou SVG): foto ou imagem de WhatsApp precisa ser redesenhada, e isso é criação de arte.'
            ELSE 'Pergunte sempre. Arquivo em PDF em boa resolução serve. Foto ou imagem de WhatsApp pode sair sem nitidez: se o cliente só tiver isso, é criação de arte.' END
  FROM public.produtos p
  JOIN public.maquinas m ON m.id = p.maquina_padrao_id
  JOIN public.processos pr ON pr.nome = 'Arte final'
 WHERE p.ativo AND m.tipo IN ('plotter_impressao', 'plotter_recorte', 'laser_co2', 'laser_fiber')
   AND NOT EXISTS (SELECT 1 FROM public.produto_perguntas q WHERE q.produto_id = p.id AND q.pergunta = 'A arte está pronta?');

INSERT INTO public.produto_perguntas (produto_id, pergunta, obrigatoria, tipo_resposta, respostas, ordem, ia_modo, ia_instrucao)
SELECT p.id, v.pergunta, false, v.tipo, v.respostas::jsonb, v.ordem, v.modo, v.instrucao
  FROM (VALUES
    ('ACR-VIR2', 'Qual a cor do acrílico?', 'unica', '["Transparente", "Branco", "Preto"]', 2, 'perguntar', 'Pergunte sempre, se o pedido não disser.'),
    ('ACR-VIR3', 'Qual a cor do acrílico?', 'unica', '["Transparente", "Branco", "Preto"]', 2, 'perguntar', 'Pergunte sempre, se o pedido não disser.'),
    ('ACR-ESP2', 'Qual a cor do espelhado?', 'unica', '["Dourado", "Prateado"]', 2, 'perguntar', 'Pergunte sempre, se o pedido não disser.'),
    ('ACR-VIR2', 'Só corte ou corte e gravação?', 'unica', '["Só corte", "Corte e gravação"]', 3, 'seguir_cliente', 'Marque se o cliente falar de gravar nome, logo ou desenho na peça.'),
    ('ACR-VIR3', 'Só corte ou corte e gravação?', 'unica', '["Só corte", "Corte e gravação"]', 3, 'seguir_cliente', 'Marque se o cliente falar de gravar nome, logo ou desenho na peça.'),
    ('ACR-ESP2', 'Só corte ou corte e gravação?', 'unica', '["Só corte", "Corte e gravação"]', 3, 'seguir_cliente', 'Marque se o cliente falar de gravar nome, logo ou desenho na peça.'),
    ('BRI-CHA', 'Qual o formato do chaveiro?', 'unica', '["Formato padrão", "Desenho do cliente"]', 2, 'perguntar', 'Pergunte sempre, se o pedido não disser. Desenho próprio precisa do contorno em vetor.'),
    ('BRI-CPT500', 'Onde vai a marcação?', 'unica', '["Uma face", "Duas faces", "Volta inteira"]', 2, 'perguntar', 'Pergunte sempre. O tempo de máquina cresce com a área marcada.'),
    ('BRI-CUIA380', 'Onde vai a marcação?', 'unica', '["Uma face", "Duas faces", "Volta inteira"]', 2, 'perguntar', 'Pergunte sempre. O tempo de máquina cresce com a área marcada.'),
    ('BRI-KC3', 'Quais peças do kit levam marcação?', 'unica', '["Todas", "Só algumas"]', 2, 'perguntar', 'Pergunte sempre, se o pedido não disser.'),
    ('BRI-KC3B', 'Quais peças do kit levam marcação?', 'unica', '["Todas", "Só algumas"]', 2, 'perguntar', 'Pergunte sempre, se o pedido não disser.'),
    ('BRI-KCL2', 'Quais peças do kit levam marcação?', 'unica', '["Todas", "Só algumas"]', 2, 'perguntar', 'Pergunte sempre, se o pedido não disser.'),
    ('ADE-VINR', 'Qual a cor do vinil?', 'texto', '[]', 2, 'perguntar', 'Pergunte sempre. O vinil cadastrado é o branco: outra cor, confirme com a compra antes de prometer prazo.'),
    ('SRV-3D', 'Tem o arquivo 3D da peça?', 'unica', '["Sim, STL ou 3MF", "Não, precisamos modelar"]', 1, 'perguntar', 'Pergunte sempre. Sem arquivo, a modelagem é serviço de criação.'),
    ('SRV-3D', 'Para que serve a peça?', 'unica', '["Decoração", "Uso funcional"]', 2, 'perguntar', 'Pergunte sempre: define material e preenchimento, e com eles o tempo de máquina.'),
    ('SRV-3D', 'Quantas cores?', 'unica', '["Uma cor", "Duas a quatro cores"]', 3, 'perguntar', 'Até quatro cores só na máquina com troca automática de filamento. Mais cores não dá.')
  ) AS v(sku, pergunta, tipo, respostas, ordem, modo, instrucao)
  JOIN public.produtos p ON p.sku = v.sku
 WHERE NOT EXISTS (SELECT 1 FROM public.produto_perguntas q WHERE q.produto_id = p.id AND q.pergunta = v.pergunta);

-- Tamanhos para quem não tinha, e para sugerir quando o cliente não sabe a medida.
INSERT INTO public.produto_tamanhos (produto_id, nome, largura, altura, padrao, ordem, quando_usar)
SELECT p.id, v.nome, v.l, v.a, v.pad, v.o, v.uso
  FROM public.produtos p
 CROSS JOIN (VALUES
    ('Peça 0,60 × 0,80', 0.6, 0.8, false, 1, 'Pouco espaço na parede'),
    ('Peça 1,00 × 1,50', 1.0, 1.5, true, 2, 'Vista de perto, em loja ou evento'),
    ('Peça 1,50 × 3,00', 1.5, 3.0, false, 3, 'Fundo de estande e parede de destaque')
  ) AS v(nome, l, a, pad, o, uso)
 WHERE p.sku IN ('LON-FOS', 'LON-BCK', 'LON-DUP', 'LON-PER', 'LON-TEX', 'LON-LIS', 'LON-ADE')
   AND NOT EXISTS (SELECT 1 FROM public.produto_tamanhos t WHERE t.produto_id = p.id);

INSERT INTO public.produto_tamanhos (produto_id, nome, largura, altura, padrao, ordem, quando_usar)
SELECT p.id, v.nome, v.l, v.a, v.pad, v.o, v.uso
  FROM public.produtos p
 CROSS JOIN (VALUES
    ('Pequeno 0,30 × 0,30', 0.3, 0.3, false, 1, 'Porta, caixa e selo de aviso'),
    ('Médio 0,50 × 0,50', 0.5, 0.5, true, 2, 'Vidro de porta e carro'),
    ('Vitrine 1,00 × 1,00', 1.0, 1.0, false, 3, 'Uma folha de vitrine')
  ) AS v(nome, l, a, pad, o, uso)
 WHERE p.sku IN ('ADE-BLK', 'ADE-FOS', 'ADE-PRM', 'ADE-TRP', 'ADE-PERFP')
   AND NOT EXISTS (SELECT 1 FROM public.produto_tamanhos t WHERE t.produto_id = p.id);

INSERT INTO public.produto_tamanhos (produto_id, nome, largura, altura, padrao, ordem, quando_usar)
SELECT p.id, v.nome, v.l, v.a, v.pad, v.o, v.uso
  FROM public.produtos p
 CROSS JOIN (VALUES
    ('Peça 0,30 × 0,20', 0.3, 0.2, false, 1, 'Placa de mesa e identificação'),
    ('Peça 0,50 × 0,30', 0.5, 0.3, true, 2, 'Placa de porta e recepção'),
    ('Peça 1,00 × 0,60', 1.0, 0.6, false, 3, 'A maior que a máquina corta inteira')
  ) AS v(nome, l, a, pad, o, uso)
 WHERE p.sku IN ('ACR-VIR2', 'ACR-VIR3', 'ACR-ESP2', 'QUA-ACR')
   AND NOT EXISTS (SELECT 1 FROM public.produto_tamanhos t WHERE t.produto_id = p.id);

-- Os limites da máquina entram no roteiro da IA. O que já estava escrito sobre cada produto fica; só a pergunta da
-- arte sai do texto, porque agora é pergunta do checklist.
UPDATE public.produto_ficha f
   SET ia_personalidade = COALESCE(f.ia_personalidade, '') || E'\n\n## Máquina e limites\n' || v.maquina,
       ia_como_medir = v.medir,
       ia_perguntas = replace(COALESCE(f.ia_perguntas, ''), E'- O cliente já tem a arte pronta ou precisamos criar?\n', '') || COALESCE(E'\n' || v.perguntas, '')
  FROM (VALUES
    ('lona',
     'Sai na plotter eco-solvente, em rolo de lona de 1,60 m de largura. Peça com os dois lados acima de 1,60 m sai em partes, com emenda: avise o cliente antes.',
     E'## Perguntar sempre\n- Quantas peças?\n- Qual a medida de cada peça (largura x altura, em cm ou m)?\n\n## Se o cliente não souber\nSugira os tamanhos da lista, dizendo para que serve cada um. Se a peça vai num lugar certo, peça a medida do local. Sem como medir, ofereça a visita técnica.',
     NULL::text),
    ('vinil',
     'Sai na plotter eco-solvente, em rolo de vinil de 1,06 m de largura (perfurado 1,27 m; transparente 1,22 m). Peça com os dois lados acima do rolo sai em partes, com emenda: avise o cliente antes. No adesivo transparente, as áreas claras da arte ficam translúcidas: avise.',
     E'## Perguntar sempre\n- Quantas peças?\n- Qual a medida de cada peça (largura x altura, em cm ou m)?\n\n## Se o cliente não souber\nSugira os tamanhos da lista, dizendo para que serve cada um. Em vidro e veículo, peça a medida do local ou ofereça a visita técnica.',
     NULL),
    ('placa',
     'O vinil sai na plotter eco-solvente, em rolo de 1,06 m, e é aplicado na chapa antes do corte. Placa com os dois lados acima do rolo fica com emenda no vinil: avise o cliente antes.',
     E'## Perguntar sempre\n- Quantas placas?\n- Qual a medida de cada placa (largura x altura, em cm ou m)?\n\n## Se o cliente não souber\nSugira os tamanhos da lista, dizendo para que serve cada um. Para fachada, peça a medida do local ou ofereça a visita técnica.',
     NULL),
    ('recorte',
     'Sai na plotter de recorte, com até 1,20 m de boca. Só corta vinil e insulfilm, em cor sólida, sem impressão: arte com degradê ou foto vai no adesivo impresso. O desenho precisa estar em vetor. Letra muito pequena ou traço muito fino pode soltar na depilação: confirme antes de prometer.',
     E'## Perguntar sempre\n- Quantas peças?\n- Qual a medida de cada peça (largura x altura, em cm ou m)?\n\n## Se o cliente não souber\nSugira os tamanhos da lista. Para letreiro em vidro, peça a medida do vidro e a altura das letras.',
     NULL),
    ('co2',
     'Sai no laser CO2 de 100 W, com área de 1,00 x 0,60 m. Corta e grava acrílico e MDF. Não corta metal. PVC não vai no laser, porque solta gás tóxico. Peça maior que a área de corte não sai inteira: avise e ofereça dividir.',
     E'## Perguntar sempre\n- Quantas peças?\n- Qual a medida de cada peça (largura x altura, em cm ou m)?\n\n## Se o cliente não souber\nSugira os tamanhos da lista. O limite da máquina é 1,00 x 0,60 m por peça.',
     NULL),
    ('chaveiro',
     'O contorno sai no laser CO2 de 100 W. Corta acrílico; não corta metal.',
     E'## Perguntar sempre\n- Quantas unidades? O preço muda por faixa de quantidade.\n\n## Se o cliente não souber\nDiga as faixas de quantidade e sugira começar pela menor.',
     NULL),
    ('fiber',
     'A marcação sai no laser fiber de 30 W, com área de 20 x 20 cm por face e eixo rotativo para copo e garrafa. Marca metal, plástico, couro e tecido; não corta. A marca fica em um tom só, sem cores: arte colorida não sai colorida. Avise antes.',
     E'## Perguntar sempre\n- Quantas unidades?\n- O que vai gravado: logo, nome ou frase?\n\n## Se o cliente não souber\nSugira o logo em uma face. A área máxima é de 20 x 20 cm por face.',
     NULL),
    ('3d',
     'Sai nas impressoras 3D FDM: três com volume de 25,6 x 25,6 x 25,6 cm e uma com 18 x 18 x 18 cm. Até quatro cores só na máquina com troca automática de filamento. As camadas ficam aparentes: avise quem quer acabamento liso. Peça maior que o volume sai em partes, para colar. O preço não é de tabela: sai da calculadora de Peça 3D, pelo arquivo.',
     E'## Perguntar sempre\n- Quantas peças?\n- Qual o tamanho de cada peça (largura x altura x profundidade)?\n\n## Se o cliente não souber\nPeça uma foto com uma régua ou um objeto ao lado. Sem o tamanho, não dá para estimar tempo nem material.',
     'Não diga preço nem prazo: quem atende calcula em Peça 3D.')
  ) AS v(familia, maquina, medir, perguntas)
  JOIN public.produtos p ON p.sku = ANY (CASE v.familia
    WHEN 'lona' THEN ARRAY['LON-280', 'LON-440', 'LON-FOS', 'LON-BCK', 'LON-DUP', 'LON-PER', 'LON-TEX', 'LON-LIS', 'LON-CAV', 'LON-FAI', 'BAN-LON', 'BAN-440']
    WHEN 'vinil' THEN ARRAY['ADE-VIN', 'ADE-FOS', 'ADE-BLK', 'ADE-TRP', 'ADE-PRM', 'ADE-JAT', 'ADE-PERF', 'ADE-PERFP', 'LON-ADE']
    WHEN 'placa' THEN ARRAY['PLA-PS', 'PLA-PVC', 'PLA-ACM']
    WHEN 'recorte' THEN ARRAY['ADE-VINR']
    WHEN 'co2' THEN ARRAY['ACR-VIR2', 'ACR-VIR3', 'ACR-ESP2', 'QUA-ACR']
    WHEN 'chaveiro' THEN ARRAY['BRI-CHA']
    WHEN 'fiber' THEN ARRAY['BRI-CPT500', 'BRI-CUIA380', 'BRI-KC3', 'BRI-KC3B', 'BRI-KCL2']
    WHEN '3d' THEN ARRAY['SRV-3D'] END)
 WHERE f.produto_id = p.id;
