-- O Banner em lona 440g vira produto próprio, com preço de R$ 89,90/m² (decisão do dono, 02/11/2026).
--
-- A pergunta "Em qual lona?" (20261102110000) não mudava o preço: quem marcava 440 g precisava ajustar o valor à mão,
-- e a resposta dele podia sair com o preço da 280 g. Produto próprio traz preço e custo certos sem ninguém digitar.
--
--   Custo por m²    lona R$ 16,23 + bastão e corda R$ 5,00 = R$ 21,23, mais máquina, gente e rateio.
--   Preço           R$ 64,90 da 280 g + R$ 25 de diferença entre Lona 440g e Lona 280g.
--   Parceiro        Sem preço: o dono não definiu. Vale o preço pelo nível do parceiro.
--
-- O produto copia do Banner 280 g medida mínima, máquina, tempo, etapas, acabamentos, tamanhos e perguntas.
-- A pergunta "Em qual lona?" sai: nenhum item a respondeu.

INSERT INTO public.produtos (
  nome, sku, descricao, categoria, tipo, unidade, custo_medio, preco_base, margem_minima, margem_sugerida,
  familia, tempo_producao_min, maquina_padrao_id, area_minima_cobrada, espacamento_pecas_m
)
SELECT 'Banner com bastão e corda (lona 440g)', 'BAN-440',
       'Lona 440g reforçada, bastão e corda inclusos. Para quando o cliente pede mais resistência.',
       b.categoria, b.tipo, b.unidade, 21.23, 89.90, b.margem_minima, b.margem_sugerida,
       b.familia, b.tempo_producao_min, b.maquina_padrao_id, b.area_minima_cobrada, b.espacamento_pecas_m
  FROM public.produtos b
 WHERE b.sku = 'BAN-LON';

INSERT INTO public.produto_materiais (produto_id, material_id, quantidade_por_unidade, por_peca)
SELECT n.id, m.id, v.q, v.por_peca
  FROM public.produtos n
 CROSS JOIN (VALUES ('Lona 440g reforçada', 1.0, false), ('Bastão + corda para banner', 1.0, true)) AS v(material, q, por_peca)
  JOIN public.materiais m ON m.nome = v.material
 WHERE n.sku = 'BAN-440';

INSERT INTO public.produto_tamanhos (produto_id, nome, largura, altura, padrao, ordem, quando_usar)
SELECT n.id, t.nome, t.largura, t.altura, t.padrao, t.ordem, t.quando_usar
  FROM public.produtos n
 CROSS JOIN public.produtos b
  JOIN public.produto_tamanhos t ON t.produto_id = b.id
 WHERE n.sku = 'BAN-440' AND b.sku = 'BAN-LON';

INSERT INTO public.produto_acabamentos (produto_id, acabamento_id, obrigatorio, padrao)
SELECT n.id, a.acabamento_id, a.obrigatorio, a.padrao
  FROM public.produtos n
 CROSS JOIN public.produtos b
  JOIN public.produto_acabamentos a ON a.produto_id = b.id
 WHERE n.sku = 'BAN-440' AND b.sku = 'BAN-LON';

INSERT INTO public.produto_processos (produto_id, processo_id, ordem)
SELECT n.id, x.processo_id, x.ordem
  FROM public.produtos n
 CROSS JOIN public.produtos b
  JOIN public.produto_processos x ON x.produto_id = b.id
 WHERE n.sku = 'BAN-440' AND b.sku = 'BAN-LON';

DELETE FROM public.produto_perguntas q
 USING public.produtos b
 WHERE q.produto_id = b.id AND b.sku = 'BAN-LON' AND q.pergunta = 'Em qual lona?';

INSERT INTO public.produto_perguntas (produto_id, pergunta, descricao, obrigatoria, tipo_resposta, respostas, acoes, ordem, resposta_padrao)
SELECT n.id, q.pergunta, q.descricao, q.obrigatoria, q.tipo_resposta, q.respostas, q.acoes, q.ordem, q.resposta_padrao
  FROM public.produtos n
 CROSS JOIN public.produtos b
  JOIN public.produto_perguntas q ON q.produto_id = b.id
 WHERE n.sku = 'BAN-440' AND b.sku = 'BAN-LON';

INSERT INTO public.produto_ficha (produto_id, ia_habilitado, ia_personalidade, ia_como_medir, ia_perguntas, apelidos)
SELECT n.id, true,
       E'## O que é\nBanner em lona 440 g reforçada, pronto para pendurar, com bastão e corda.\n\n## Onde se usa\nPeças que ficam mais tempo expostas ou pegam vento e sol.\n\n## Observações\nOfereça só quando o cliente pedir mais resistência, e avise que o preço é maior que o do banner comum. Tripé é à parte.',
       f.ia_como_medir,
       E'## Antes de orçar\n- O cliente já tem a arte pronta ou precisamos criar?\n- Retira na loja, entrega ou instalação?\n- Qual acabamento? Opções: Bainha + ilhós\n- Precisa de tripé? Quando será usado?',
       ARRAY['banner 440', 'banner reforçado', 'banner de lona grossa', 'banner mais resistente']
  FROM public.produtos n
 CROSS JOIN public.produtos b
  JOIN public.produto_ficha f ON f.produto_id = b.id
 WHERE n.sku = 'BAN-440' AND b.sku = 'BAN-LON';

-- O Banner 280 g aponta para o novo produto e deixa de perguntar a lona a todo cliente.
UPDATE public.produtos
   SET descricao = 'Lona 280g, bastão e corda inclusos. Mais resistente: Banner com bastão e corda (lona 440g).'
 WHERE sku = 'BAN-LON';

UPDATE public.produto_ficha f
   SET ia_personalidade = E'## O que é\nBanner em lona 280 g pronto para pendurar, com bastão e corda.\n\n## Onde se usa\nEventos, lojas, igrejas, escolas e pontos de venda.\n\n## Observações\nPronto para uso, sem precisar de estrutura. Tripé é à parte.\n\nSe o cliente pedir mais resistência, sugira o Banner com bastão e corda (lona 440g) e avise que o preço é maior.',
       ia_perguntas = E'## Antes de orçar\n- O cliente já tem a arte pronta ou precisamos criar?\n- Retira na loja, entrega ou instalação?\n- Qual acabamento? Opções: Bainha + ilhós\n- Precisa de tripé? Quando será usado?'
  FROM public.produtos p
 WHERE p.id = f.produto_id AND p.sku = 'BAN-LON';
