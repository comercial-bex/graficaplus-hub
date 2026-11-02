-- Mais lonas para vender (01/11/2026, pedido do dono: "trazer mais lonas").
--
-- Seis produtos, na mesma regra de 25/10 e 27/10 para o que ainda não foi comprado: o custo acompanha o produto parecido,
-- o preço é provisório e leva a tag "PROVISÓRIOS" em observacoes_internas, que o aviso `produto_custo_provisorio` já cobra.
-- Quando a primeira nota chegar: informar o preço pago no material, corrigir o custo e apagar a tag.
--
--   Lona dupla face      ficha da 440 g com o dobro de tinta. Custo R$ 23,48. Preço R$ 89,90 (imprime dois lados).
--   Lona perfurada       custo da 440 g (R$ 20,26). Preço R$ 79,90.
--   Lona texturizada     custo da 440 g (R$ 20,26). Preço R$ 79,90.
--   Lona lisa            custo da 440 g (R$ 20,26). Preço R$ 69,90, o da 440 g.
--   Lona com adesivo     lona 280 g + vinil branco, materiais com custo real (R$ 17,28). Só o preço R$ 74,90 é provisório.
--   Lona para cavalete   a Lona 280g com outro nome (a OS 213 foi digitada à mão). Custo e preço reais; estrutura à parte.
--
-- Os materiais novos nascem como os da lona fosca e backlight: inativos, sem estoque e sem preço pago.
-- Modelos do mercado que já têm produto passam a apontar para ele, para ninguém trazer em duplicidade.

INSERT INTO public.materiais (nome, unidade, estoque, custo_unitario, custo_medio, status, largura_bobina_m, comprimento_bobina_m, caracteristicas)
SELECT v.nome, 'm²', 0, 0, 0, 'inativo', 1.6, 50,
       'SEM PREÇO: informar o valor pago por rolo. Largura e comprimento presumidos iguais aos da lona 440g (1,60 × 50 m); confirmar. NÃO COMPRADO (01/11/2026): sem estoque e sem preço pago. Quando comprar, ative o material e informe o preço da nota.'
  FROM (VALUES ('Lona dupla face'), ('Lona perfurada (mesh)'), ('Lona texturizada'), ('Lona lisa (sem trama)')) AS v(nome);

INSERT INTO public.produtos (nome, sku, descricao, categoria, tipo, unidade, custo_medio, preco_base, margem_minima, familia, tempo_producao_min, maquina_padrao_id, observacoes_internas)
SELECT v.nome, v.sku, v.descricao, base.categoria, base.tipo, 'm2', v.custo, v.preco, 30, v.familia, v.tempo, base.maquina_padrao_id, v.obs
  FROM public.produtos base
  CROSS JOIN (VALUES
    ('Lona dupla face', 'LON-DUP', 'Lona impressa dos dois lados, que não deixa um lado aparecer no outro.', 23.48, 89.90, 'Lonas especiais', 45,
     'CUSTO E PREÇO DE BALCÃO PROVISÓRIOS (01/11/2026): custo da lona 440g com o dobro de tinta, porque a lona dupla face ainda não foi comprada. Corrigir na primeira nota.'),
    ('Lona perfurada', 'LON-PER', 'Lona telada que deixa o vento passar.', 20.26, 79.90, 'Lonas especiais', 25,
     'CUSTO E PREÇO DE BALCÃO PROVISÓRIOS (01/11/2026): custo copiado de "Lona 440g reforçada impressa", porque a lona perfurada ainda não foi comprada. Corrigir na primeira nota.'),
    ('Lona texturizada', 'LON-TEX', 'Lona com textura na superfície, para painéis de ambiente interno.', 20.26, 79.90, 'Lonas especiais', 25,
     'CUSTO E PREÇO DE BALCÃO PROVISÓRIOS (01/11/2026): custo copiado de "Lona 440g reforçada impressa", porque a lona texturizada ainda não foi comprada. Corrigir na primeira nota.'),
    ('Lona lisa (sem trama)', 'LON-LIS', 'Lona sem a trama aparente, com imagem mais uniforme.', 20.26, 69.90, 'Lonas especiais', 25,
     'CUSTO E PREÇO DE BALCÃO PROVISÓRIOS (01/11/2026): custo copiado de "Lona 440g reforçada impressa", porque a lona lisa ainda não foi comprada. Corrigir na primeira nota.'),
    ('Lona com adesivo aplicado', 'LON-ADE', 'Lona 280g com vinil adesivo impresso aplicado por cima.', 17.28, 74.90, 'Lonas especiais', 30,
     'PREÇO DE BALCÃO PROVISÓRIOS (01/11/2026): o custo vem dos materiais reais; o preço ainda não foi confirmado pelo dono.'),
    ('Lona para cavalete', 'LON-CAV', 'Lona brilho 280g com impressão digital, na medida do cavalete. Estrutura à parte.', 10.37, 45.00, 'Lonas frontlight', 20, NULL)
  ) AS v(nome, sku, descricao, custo, preco, familia, tempo, obs)
 WHERE base.sku = 'LON-440';

INSERT INTO public.produto_materiais (produto_id, material_id, quantidade_por_unidade)
SELECT p.id, m.id, v.q
  FROM (VALUES
    ('LON-DUP', 'Lona dupla face', 1.05), ('LON-DUP', 'Tinta solvente (conjunto)', 28),
    ('LON-PER', 'Lona perfurada (mesh)', 1.05), ('LON-PER', 'Tinta solvente (conjunto)', 14),
    ('LON-TEX', 'Lona texturizada', 1.05), ('LON-TEX', 'Tinta solvente (conjunto)', 14),
    ('LON-LIS', 'Lona lisa (sem trama)', 1.05), ('LON-LIS', 'Tinta solvente (conjunto)', 14),
    ('LON-ADE', 'Lona 280g brilho', 1.05), ('LON-ADE', 'Vinil adesivo branco brilho', 1.05), ('LON-ADE', 'Tinta solvente (conjunto)', 12),
    ('LON-CAV', 'Lona 280g brilho', 1.05), ('LON-CAV', 'Tinta solvente (conjunto)', 12)
  ) AS v(sku, material, q)
  JOIN public.produtos p ON p.sku = v.sku
  JOIN public.materiais m ON m.nome = v.material;

INSERT INTO public.produto_tamanhos (produto_id, nome, largura, altura, padrao, ordem)
SELECT p.id, v.nome, v.l, v.a, v.pad, v.o FROM public.produtos p
  CROSS JOIN (VALUES ('Cavalete 0,60 × 0,90', 0.6, 0.9, false, 0), ('Cavalete 0,81 × 0,98', 0.81, 0.98, true, 1), ('Cavalete 1,00 × 1,20', 1.0, 1.2, false, 2)) AS v(nome, l, a, pad, o)
 WHERE p.sku = 'LON-CAV';

INSERT INTO public.produto_acabamentos (produto_id, acabamento_id, obrigatorio, padrao)
SELECT p.id, a.id, false, false
  FROM public.produtos p CROSS JOIN public.acabamentos a
 WHERE p.sku IN ('LON-DUP', 'LON-PER', 'LON-TEX', 'LON-LIS', 'LON-ADE', 'LON-CAV')
   AND a.nome IN ('Bainha + ilhós', 'Só bainha', 'Só ilhós', 'Bastão e corda', 'Refile', 'Colagem da borda')
ON CONFLICT DO NOTHING;

INSERT INTO public.produto_processos (produto_id, processo_id, ordem)
SELECT p.id, pr.id, 0 FROM public.produtos p JOIN public.processos pr ON pr.nome = 'Impressão eco-solvente'
 WHERE p.sku IN ('LON-DUP', 'LON-PER', 'LON-TEX', 'LON-LIS', 'LON-ADE', 'LON-CAV');
INSERT INTO public.produto_processos (produto_id, processo_id, ordem)
SELECT p.id, pr.id, 1 FROM public.produtos p JOIN public.processos pr ON pr.nome = 'Refile manual' WHERE p.sku IN ('LON-ADE', 'LON-CAV');

INSERT INTO public.produto_ficha (produto_id, ia_habilitado, ia_personalidade, ia_como_medir, ia_perguntas)
SELECT p.id, true,
       '## O que é' || E'\n' || v.oque || E'\n\n## Onde se usa\n' || v.onde || E'\n\n## Observações\n' || v.obs,
       E'## Perguntar sempre\n- Quantas peças?\n- Qual a medida de cada peça (largura x altura)?\n\n## Se o cliente não souber a medida\nPergunte onde a peça vai ficar e peça a medida do local. Se não tiver como medir, ofereça a visita técnica.',
       E'## Antes de orçar\n- O cliente já tem a arte pronta ou precisamos criar?\n- Retira na loja, entrega ou instalação?\n- Qual acabamento? Opções: Bainha + ilhós, Só bainha, Só ilhós, Bastão e corda, Refile, Colagem da borda\n- ' || v.pergunta
  FROM (VALUES
    ('LON-DUP', 'Lona impressa dos dois lados, sem que um lado apareça no outro.', 'Faixas de rua penduradas, placas de corredor e peças vistas dos dois lados.', 'Confirme se a arte é a mesma nos dois lados. Ainda não temos este material em estoque: confirme o prazo com a compra.', 'A arte é a mesma nos dois lados?'),
    ('LON-PER', 'Lona telada que deixa o vento passar.', 'Grades, andaimes, tapumes e fachadas altas em lugar de muito vento.', 'A imagem perde um pouco de definição por causa dos furos. Ainda não temos este material em estoque: confirme o prazo com a compra.', 'A peça fica em lugar alto ou com muito vento?'),
    ('LON-TEX', 'Lona com textura na superfície, para dar acabamento diferente.', 'Painéis de loja, decoração e fundos de ambiente interno.', 'Melhor em ambiente interno. Ainda não temos este material em estoque: confirme o prazo com a compra.', 'A peça fica em ambiente interno?'),
    ('LON-LIS', 'Lona sem a trama aparente, com imagem mais uniforme.', 'Peças vistas de perto, painéis de evento e ponto de venda.', 'Boa quando a trama atrapalha a leitura. Ainda não temos este material em estoque: confirme o prazo com a compra.', 'A peça será vista de perto?'),
    ('LON-ADE', 'Lona 280 g com vinil adesivo impresso aplicado por cima.', 'Reforma de fachada e peças que recebem arte nova sobre lona.', 'Mais trabalho de aplicação que a lona comum: confirme a medida antes de produzir.', 'A lona já existe ou fornecemos também?'),
    ('LON-CAV', 'Lona 280 g impressa na medida do cavalete, com a estrutura à parte.', 'Calçadas, portas de loja e ponto de venda.', 'Pergunte a medida do cavalete do cliente. Estrutura não está inclusa neste produto.', 'O cliente já tem o cavalete?')
  ) AS v(sku, oque, onde, obs, pergunta)
  JOIN public.produtos p ON p.sku = v.sku;

UPDATE public.catalogo_modelos c SET produto_id = p.id
  FROM (VALUES
    ('Lonas', 'Lona Back Light com Impressão Digital', 'LON-BCK'),
    ('Lonas', 'Lona Banner com Impressão Digital', 'BAN-LON'),
    ('Lonas', 'Lona Blackout(B.O.) com Impressão Digital', 'LON-440'),
    ('Lonas', 'Lona Dupla Face com Impressão Digital', 'LON-DUP'),
    ('Lonas', 'Lona Front Light com Impressão Digital', 'LON-280'),
    ('Lonas', 'Lona Front Light com adesivo aplicado', 'LON-ADE'),
    ('Lonas', 'Lona Lisa(Sem Trama) com Impressão Digital', 'LON-LIS'),
    ('Lonas', 'Lona Perfurada com Impressão Digital', 'LON-PER'),
    ('Lonas', 'Lona Texturizada com Impressão Digital', 'LON-TEX'),
    ('Lonas', 'Cavalete com lona impressa', 'LON-CAV'),
    ('Faixas', 'Faixa em Lona com Impressão Digital', 'LON-FAI'),
    ('Banners', 'Banner em Lona', 'BAN-LON')
  ) AS v(familia, nome, sku)
  JOIN public.produtos p ON p.sku = v.sku
 WHERE c.familia = v.familia AND c.nome = v.nome;
