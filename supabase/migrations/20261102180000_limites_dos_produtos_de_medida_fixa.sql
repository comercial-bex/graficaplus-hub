-- Os produtos de medida fixa e a fachada luminosa recebem o limite da máquina no roteiro da IA (02/11/2026).
--
-- Adesivo de mão, pragão, bola e bolão são recortados no contorno, e o cadastro só dizia impressão: a etapa de recorte
-- entra. A testeira é reta, leva refile. Campanha distribui adesivo: a IA só fala de aplicação se o cliente falar.
-- Perfurado de medida pronta vai no vidro traseiro: "onde vai aplicado" está respondido.
--
-- Estes 9 produtos só têm preço por faixa, e as faixas venceram em 04/10/2026 (tabela da campanha). Preço não muda
-- aqui: o rascunho da IA passa a avisar quando o item fica sem preço de tabela.

INSERT INTO public.produto_processos (produto_id, processo_id, ordem)
SELECT p.id, pr.id, 1
  FROM public.produtos p
  JOIN public.processos pr ON pr.nome = 'Recorte eletrônico'
 WHERE p.sku IN ('ADE-PRG07', 'ADE-PRG10', 'ADE-PGA15', 'ADE-PGA30', 'ADE-BOL33', 'ADE-BLO48')
ON CONFLICT (produto_id, processo_id) DO UPDATE SET ordem = EXCLUDED.ordem;

INSERT INTO public.produto_processos (produto_id, processo_id, ordem)
SELECT p.id, pr.id, 1
  FROM public.produtos p
  JOIN public.processos pr ON pr.nome = 'Refile manual'
 WHERE p.sku = 'ADE-TES90'
ON CONFLICT (produto_id, processo_id) DO UPDATE SET ordem = EXCLUDED.ordem;

UPDATE public.produto_perguntas q
   SET ia_modo = 'seguir_cliente',
       ia_instrucao = CASE q.pergunta
         WHEN 'A aplicação é por nossa conta?' THEN 'Peça de campanha costuma ser distribuída. Marque só se o cliente falar em aplicar.'
         ELSE 'Marque só se o cliente disser onde vai.' END
  FROM public.produtos p
 WHERE p.id = q.produto_id
   AND p.sku IN ('ADE-PRG07', 'ADE-PRG10', 'ADE-PGA15', 'ADE-PGA30', 'ADE-BOL33', 'ADE-BLO48')
   AND q.pergunta IN ('A aplicação é por nossa conta?', 'Onde o adesivo vai aplicado?');

UPDATE public.produto_perguntas q
   SET ia_modo = 'definir', ia_resposta = 'Veículo', ia_instrucao = 'Esta peça é feita para o vidro traseiro de carro.'
  FROM public.produtos p
 WHERE p.id = q.produto_id AND p.sku IN ('ADE-P9033', 'ADE-P9050') AND q.pergunta = 'Onde o adesivo vai aplicado?';

INSERT INTO public.produto_perguntas (produto_id, pergunta, obrigatoria, tipo_resposta, respostas, ordem, ia_modo, ia_instrucao)
SELECT p.id, v.pergunta, false, 'unica', '["Sim", "Não"]'::jsonb, v.ordem, 'perguntar', v.instrucao
  FROM public.produtos p
 CROSS JOIN (VALUES
    ('Tem ponto de energia no local?', 2, 'Pergunte sempre. Sem energia no local, a fachada não acende: registre para a visita técnica.'),
    ('Podemos agendar a visita técnica?', 3, 'Pergunte sempre. Sem a visita, o valor é só uma estimativa: diga isso ao cliente.')
  ) AS v(pergunta, ordem, instrucao)
 WHERE p.sku = 'FAC-LUM'
   AND NOT EXISTS (SELECT 1 FROM public.produto_perguntas q WHERE q.produto_id = p.id AND q.pergunta = v.pergunta);

UPDATE public.produto_ficha f
   SET ia_personalidade = COALESCE(f.ia_personalidade, '') || E'\n\n## Máquina e limites\n' || CASE v.tipo
         WHEN 'contorno' THEN 'Sai na plotter eco-solvente, em vinil de 1,06 m, e o contorno é cortado na plotter de recorte, que lê as marcas de registro com câmera. Medida fixa: outro tamanho é o Adesivo vinil branco impresso, vendido por m².'
         WHEN 'reta' THEN 'Sai na plotter eco-solvente, em vinil de 1,06 m, com refile reto. Medida fixa: outro tamanho é o Adesivo vinil branco impresso, vendido por m².'
         ELSE 'Sai na plotter eco-solvente, em vinil perfurado de 1,27 m, com refile reto. Medida fixa: outro tamanho é o Adesivo perfurado (one way), vendido por m². De fora se vê a imagem; de dentro, o vidro continua transparente.' END,
       ia_como_medir = E'## Perguntar sempre\n- Quantas unidades? O preço é por faixa, a partir de ' || v.minimo || E' unidades.\n\n## Se o cliente não souber\nDiga a medida pronta deste produto. Para quantidade menor que ' || v.minimo || ', avise quem atende: fora da faixa não há preço de tabela.',
       ia_perguntas = replace(COALESCE(f.ia_perguntas, ''), E'- O cliente já tem a arte pronta ou precisamos criar?\n', '')
  FROM (VALUES
    ('ADE-PRG07', 'contorno', 1000), ('ADE-PRG10', 'contorno', 1000), ('ADE-PGA15', 'contorno', 300),
    ('ADE-PGA30', 'contorno', 100), ('ADE-BOL33', 'contorno', 100), ('ADE-BLO48', 'contorno', 100),
    ('ADE-TES90', 'reta', 100), ('ADE-P9033', 'perfurado', 50), ('ADE-P9050', 'perfurado', 50)
  ) AS v(sku, tipo, minimo)
  JOIN public.produtos p ON p.sku = v.sku
 WHERE f.produto_id = p.id;

UPDATE public.produto_ficha f
   SET ia_personalidade = COALESCE(f.ia_personalidade, '') || E'\n\n## Máquina e limites\nA lona sai na plotter eco-solvente, em rolo de 1,60 m. Fachada com os dois lados acima de 1,60 m sai em partes, com emenda: avise o cliente antes. Estrutura e LED dependem da medida no local: sem a visita técnica, o valor é só estimativa.',
       ia_como_medir = E'## Perguntar sempre\n- Quantas fachadas?\n- Qual a medida do local (largura x altura)?\n\n## Se o cliente não souber\nNão sugira tamanho pronto: fachada depende do local. Ofereça a visita técnica.',
       ia_perguntas = replace(replace(COALESCE(f.ia_perguntas, ''), E'- O cliente já tem a arte pronta ou precisamos criar?\n', ''), E'\n- Tem ponto de energia no local? Podemos agendar a visita técnica?', '')
  FROM public.produtos p
 WHERE p.id = f.produto_id AND p.sku = 'FAC-LUM';
