-- Lonas e acabamentos prontos para orçar, e os modelos do mercado (01/11/2026, pedido do dono: "o coração é a venda").
--
-- 1. ACABAMENTOS DE LONA. Havia só "Bainha + ilhós". Entram Só bainha, Só ilhós, Bastão e corda, Refile e Colagem,
--    cada um como serviço com preço (é assim que a gráfica cobra) e ligado às lonas.
--    Tempo e preço são ESTIMATIVA DA CASA, a mesma conta do combo: bainha 7 min/m + ilhós 3 min/m (2 ilhós) = os 10 min/m
--    do Bainha + ilhós, e 5,50 + 3,50 = os R$ 9,00 dele, para o vendedor não baratear separando. Mão de obra R$ 24,17/h.
--    Cronometrar e corrigir: é a decisão "Tempos reais de mão de obra".
--    De fora, por falta de material com custo no estoque: perfil C, tubo de ferro e rebite.
--
-- 2. FAIXA EM LONA. O produto de lona que mais se vende e não existia (a OS 163 foi digitada à mão como "faixa banner").
--    Mesma lona, mesmo custo e mesmo preço da Lona 280g: é ela vendida com bainha e ilhós já sugeridos.
--
-- 3. MODELOS DO MERCADO. Tabela à parte, de propósito: são nomes de produto que uma gráfica vende, sem preço, sem custo
--    e sem máquina. Em `produtos` apareceriam nos orçamentos a R$ 0,00. A equipe traz o que for vender (botão em Produtos):
--    aí nasce um produto inativo, que só vende depois de ganhar preço.

INSERT INTO public.produtos (nome, sku, descricao, categoria, tipo, unidade, custo_medio, preco_base, margem_minima, familia, tempo_producao_min, observacoes_internas)
VALUES
  ('Bainha na lona', 'LON-BAI', 'Solda da borda da lona, sem ilhós', 'acabamento', 'servico', 'm', 2.82, 5.50, 40, 'Acabamentos', 7, 'Provisório: 7 min/m é estimativa da casa. Cronometrar e corrigir.'),
  ('Ilhós na lona', 'LON-ILH', 'Ilhós a cada 50 cm, sem bainha', 'acabamento', 'servico', 'm', 1.91, 3.50, 40, 'Acabamentos', 3, 'Provisório: 3 min/m e 2 ilhós por metro são estimativa da casa. Cronometrar e corrigir.'),
  ('Bastão e corda', 'LON-BAS', 'Bastão e corda para pendurar a peça', 'acabamento', 'servico', 'un', 7.01, 12.00, 40, 'Acabamentos', 5, 'Provisório: 5 min por peça é estimativa da casa. Cronometrar e corrigir.'),
  ('Refile de lona', 'LON-REF', 'Corte reto da sobra, sem bainha', 'acabamento', 'servico', 'm', 0.24, 0.50, 40, 'Acabamentos', 1, 'Provisório: referência de 100 m/h. Cronometrar e corrigir.'),
  ('Colagem da borda', 'LON-COL', 'Borda da lona colada em vez de soldada', 'acabamento', 'servico', 'm', 2.01, 3.50, 40, 'Acabamentos', 5, 'Provisório: 5 min/m é estimativa da casa. Cronometrar e corrigir.');

INSERT INTO public.acabamentos (nome, processo, base, minutos_maquina, minutos_mao_de_obra, material_id, material_qtd, preco_venda, observacao, produto_servico_id)
SELECT v.nome, 'manual', v.base, 0, v.minutos, m.id, v.qtd, v.preco, 'Estimativa da casa (01/11/2026): cronometrar e corrigir.', p.id
  FROM (VALUES
    ('Só bainha', 'metro_linear', 7.0, NULL, 0.0, 5.50, 'LON-BAI'),
    ('Só ilhós', 'metro_linear', 3.0, 'Ilhós metálico', 2.0, 3.50, 'LON-ILH'),
    ('Bastão e corda', 'un', 5.0, 'Bastão + corda para banner', 1.0, 12.00, 'LON-BAS'),
    ('Refile', 'metro_linear', 0.6, NULL, 0.0, 0.50, 'LON-REF'),
    ('Colagem da borda', 'metro_linear', 5.0, NULL, 0.0, 3.50, 'LON-COL')
  ) AS v(nome, base, minutos, material, qtd, preco, sku)
  JOIN public.produtos p ON p.sku = v.sku
  LEFT JOIN public.materiais m ON m.nome = v.material;

-- A Faixa em lona é a Lona 280g com outro nome: mesma ficha, mesmas medidas de cobrança.
INSERT INTO public.produtos (nome, sku, descricao, categoria, tipo, unidade, custo_medio, preco_base, margem_minima, familia, tempo_producao_min, maquina_padrao_id, material_principal_id)
SELECT 'Faixa em lona', 'LON-FAI', 'Faixa em lona brilho 280g com impressão digital. Bainha e ilhós cobrados à parte.', categoria, tipo, unidade, custo_medio, preco_base, margem_minima, familia, tempo_producao_min, maquina_padrao_id, material_principal_id
  FROM public.produtos WHERE sku = 'LON-280';

INSERT INTO public.produto_materiais (produto_id, material_id, quantidade_por_unidade, observacao, por_peca)
SELECT f.id, pm.material_id, pm.quantidade_por_unidade, pm.observacao, pm.por_peca
  FROM public.produto_materiais pm JOIN public.produtos o ON o.id = pm.produto_id AND o.sku = 'LON-280'
  CROSS JOIN public.produtos f WHERE f.sku = 'LON-FAI';

INSERT INTO public.produto_tamanhos (produto_id, nome, largura, altura, padrao, ordem)
SELECT f.id, v.nome, v.l, v.a, v.p, v.o FROM public.produtos f
  CROSS JOIN (VALUES ('Faixa 2,00 × 0,70', 2.0, 0.7, false, 0), ('Faixa 3,00 × 0,70', 3.0, 0.7, true, 1), ('Faixa 4,00 × 1,00', 4.0, 1.0, false, 2), ('Faixa 5,00 × 1,00', 5.0, 1.0, false, 3)) AS v(nome, l, a, p, o)
 WHERE f.sku = 'LON-FAI';

-- Cada lona aceita os acabamentos novos. Banner com bastão já vem com bastão e corda.
INSERT INTO public.produto_acabamentos (produto_id, acabamento_id, obrigatorio, padrao)
SELECT p.id, a.id, false, (a.nome = 'Bainha + ilhós' AND p.sku = 'LON-FAI')
  FROM public.produtos p CROSS JOIN public.acabamentos a
 WHERE p.ativo AND (p.familia ILIKE 'Lonas%' OR p.sku = 'LON-FAI') AND a.nome IN ('Bainha + ilhós', 'Só bainha', 'Só ilhós', 'Bastão e corda', 'Refile', 'Colagem da borda')
ON CONFLICT DO NOTHING;
INSERT INTO public.produto_acabamentos (produto_id, acabamento_id, obrigatorio, padrao)
SELECT p.id, a.id, false, false
  FROM public.produtos p CROSS JOIN public.acabamentos a
 WHERE p.nome = 'Banner com bastão e corda' AND a.nome IN ('Só bainha', 'Só ilhós', 'Refile')
ON CONFLICT DO NOTHING;

-- A pasta dos novos: o serviço e a faixa.
INSERT INTO public.processos (nome, etapa, base_produtividade, produtividade_origem, produtividade_fonte)
SELECT 'Colagem de borda', 'acabamento', 'tempo_do_produto', 'nao_se_aplica', 'O tempo fica no produto.'
ON CONFLICT (nome) DO NOTHING;

INSERT INTO public.produto_processos (produto_id, processo_id, ordem)
SELECT p.id, pr.id, v.ordem FROM (VALUES
    ('LON-FAI', 'Impressão eco-solvente', 0), ('LON-FAI', 'Bainha', 1), ('LON-FAI', 'Colocação de ilhós', 2),
    ('LON-BAI', 'Bainha', 0), ('LON-ILH', 'Colocação de ilhós', 0), ('LON-BAS', 'Bastão, ponteira e corda', 0),
    ('LON-REF', 'Refile manual', 0), ('LON-COL', 'Colagem de borda', 0)
  ) AS v(sku, processo, ordem)
  JOIN public.produtos p ON p.sku = v.sku JOIN public.processos pr ON pr.nome = v.processo;

INSERT INTO public.produto_ficha (produto_id, ia_habilitado, ia_personalidade, ia_como_medir, ia_perguntas)
SELECT p.id, true, '## O que é' || E'\n' || v.oque || E'\n\n## Onde se usa\n' || v.onde || E'\n\n## Observações\n' || v.obs, v.medir, v.perguntas
  FROM (VALUES
    ('LON-FAI', 'Faixa em lona 280 g com impressão digital.', 'Inaugurações, promoções, eventos, igrejas e fachadas temporárias.', 'Cobre a bainha e os ilhós à parte. Em área de vento, indique a lona 440 g.', E'## Perguntar sempre\n- Quantas faixas?\n- Qual a largura e a altura?\n\n## Se o cliente não souber a medida, oferecer\n- Faixa 2,00 × 0,70\n- Faixa 3,00 × 0,70\n- Faixa 4,00 × 1,00\n- Faixa 5,00 × 1,00', E'## Antes de orçar\n- O cliente já tem a arte pronta ou precisamos criar?\n- Como vai fixar: corda, abraçadeira ou parafuso?\n- Precisa de instalação?'),
    ('LON-BAI', 'Borda da lona soldada, sem ilhós.', 'Lonas que vão presas em estrutura ou quadro.', 'Cobrado por metro de contorno.', E'## Perguntar sempre\n- Quais lados levam bainha?', E'## Antes de orçar\n- A lona vai presa em estrutura?'),
    ('LON-ILH', 'Ilhós a cada 50 cm, sem bainha.', 'Lonas para amarrar com corda ou abraçadeira.', 'Sem bainha, a borda rasga mais fácil com vento.', E'## Perguntar sempre\n- Quais lados levam ilhós?', E'## Antes de orçar\n- Vai ficar em área externa? Se sim, indique bainha + ilhós.'),
    ('LON-BAS', 'Bastão e corda para pendurar a peça.', 'Banners e lonas de parede.', 'Cobrado por peça.', E'## Perguntar sempre\n- Em quantas peças?', E'## Antes de orçar\n- Precisa também de tripé?'),
    ('LON-REF', 'Corte reto da sobra da lona, sem bainha.', 'Lona que vai colada ou presa em quadro.', 'Sem reforço na borda.', E'## Perguntar sempre\n- Qual a medida final?', E'## Antes de orçar\n- A lona vai presa em algum suporte?'),
    ('LON-COL', 'Borda dobrada e colada em vez de soldada.', 'Peças internas e reparos.', 'Para área externa, a bainha soldada resiste mais.', E'## Perguntar sempre\n- Quais lados levam colagem?', E'## Antes de orçar\n- Vai ficar em área interna ou externa?')
  ) AS v(sku, oque, onde, obs, medir, perguntas)
  JOIN public.produtos p ON p.sku = v.sku;

CREATE TABLE public.catalogo_modelos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  familia text NOT NULL,
  nome text NOT NULL,
  produto_id uuid REFERENCES public.produtos(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (familia, nome)
);
ALTER TABLE public.catalogo_modelos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.catalogo_modelos FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.catalogo_modelos TO authenticated;
CREATE POLICY "catalogo_modelos staff read" ON public.catalogo_modelos FOR SELECT USING (public.is_staff((SELECT auth.uid())));
CREATE POLICY "catalogo_modelos admin write" ON public.catalogo_modelos FOR ALL
  USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role) OR public.has_role((SELECT auth.uid()), 'gestor'::public.app_role))
  WITH CHECK (public.has_role((SELECT auth.uid()), 'admin'::public.app_role) OR public.has_role((SELECT auth.uid()), 'gestor'::public.app_role));

INSERT INTO public.catalogo_modelos (familia, nome)
SELECT familia, unnest(nomes) FROM (VALUES
  ('Adesivos', ARRAY['Adesivo Bloqueado Impresso','Adesivo Branco Impresso','Adesivo Cast Impresso','Adesivo Colorido Aplicado em Chapa','Adesivo Colorido Envelopado','Adesivo Colorido com Recorte Eletrônico','Adesivo Floor Door','Adesivo Impresso Aplicado em Chapa','Adesivo Impresso Envelopado','Adesivo Impresso com Aplicação Externa','Adesivo Impresso com Recorte Eletrônico','Adesivo Jateado Aplicado','Adesivo Jateado Impresso','Adesivo Perfurado Impresso','Adesivo Refletivo Impresso','Adesivo Refletivo com Recorte Eletrônico','Adesivo Translúcido Impresso','Adesivo Translúcido com Recorte Eletrônico','Adesivo Transparente Impresso','Adesivo em papel Impresso','Adesivo impresso laminado','Adesivo jateado com recorte eletrônico','Adesivo removível impresso','Vinil Adesivo Cast Colorido','Vinil Eletrostático Impresso']),
  ('Banners', ARRAY['Banner em Lona','Banner em Papel','Banner em chapa','Wind Banner - Impressão Direta','Wind Banner - Impressão Sublimática']),
  ('Brindes', ARRAY['Abridor de garrafa personalizado','Agenda ecológica personalizada','Agenda personalizada','Azulejo personalizado com foto','Balde de gelo personalizado','Balde de pipoca personalizado','Bloco de papel personalizado','Botton personalizado','Caixa de som personalizada','Calculadora personalizada','Caneca personalizada','Caneta ecológica personalizada','Caneta personalizada','Canivete personalizado','Carregador sem fio personalizado','Carteira personalizada','Chaveiro personalizado com gravação','Chaveiro personalizado em MDF','Chaveiro personalizado em acrílico','Copo com canudo personalizado','Copo descartável personalizado','Copo long drink personalizado','Deskpad personalizado','Ecobag personalizada','Espelho de bolso personalizado','Fone de ouvido personalizado','Garrafa personalizada','Garrafa térmica personalizada','Guarda-chuva personalizado','Guarda-sol personalizado','Headset personalizado','Imã personalizado','Lapiseira personalizada','Lápis ecológico personalizado','Lápis personalizado','Mochila personalizada','Mousepad personalizado','Necessaire personalizada','Pen drive personalizado','Porta caneta personalizado','Porta cartão de bolso personalizado','Porta cartão de mesa personalizado','Porta garrafa térmico personalizado','Porta retrato em cubo de MDF','Porta retrato personalizado em MDF','Porta retrato personalizado em vidro','Power bank personalizada','Régua em PS personalizada','Sacola de tecido personalizada','Squeeze personalizada','Taça de espumante personalizada','Taça de gin personalizada','Taça de vinho personalizada','Troféu Personalizado']),
  ('Envelopamentos', ARRAY['Envelopamento de Caminhão','Envelopamento de Carro','Envelopamento de Moto','Envelopamento de Ônibus','Envelopamentos Diversos','Serviço de envelopamento']),
  ('Especiais', ARRAY['Display de mesa','Empena','Empena com Impressão Digital','Placa de não perturbe para porta','Porta de ACM']),
  ('Estruturas e fachadas', ARRAY['Estrutura em madeira para outdoor','Estrutura metálica para fachada','Estrutura metálica para outdoor','Estrutura: Fundação | Sapata','Fachada ACM com avanço','Fachada ACM plana','Fachada em chapa com avanço','Fachada em lona com avanço','Fachada plana em chapa','Fachada plana em lona','Front Light','Luminoso','Painel backlight com tecido impresso','Painel Neon LED','Papel impresso para outdoor']),
  ('Faixas', ARRAY['Faixa em Lona com Impressão Digital','Faixa em Tecido com Impressão Direta','Faixa em Tecido com Impressão Sublimática']),
  ('Impressão', ARRAY['Produto com impressão DTF','Produto com impressão DTF UV','Produto com impressão UV','Produto com impressão UV 360','Produto com impressão látex','Produto com impressão solvente','Produto com impressão sublimática - Grandes formatos','Produto com impressão sublimática - Pequenos formatos']),
  ('Lonas', ARRAY['Cavalete com lona impressa','Lona Back Light com Impressão Digital','Lona Banner com Impressão Digital','Lona Blackout(B.O.) com Impressão Digital','Lona Dupla Face com Impressão Digital','Lona Front Light com Impressão Digital','Lona Front Light com adesivo aplicado','Lona Lisa(Sem Trama) com Impressão Digital','Lona Perfurada com Impressão Digital','Lona Texturizada com Impressão Digital']),
  ('Papéis', ARRAY['Calendário personalizado','Cartaz','Cartão de visita personalizado','Convite personalizado','Envelope personalizado','Folder Personalizado','Folha com impressão jato de tinta','Folha com impressão laser','Jornal','Marca-página personalizado','Panfleto Personalizado','Papel timbrado personalizado','Pasta de papel personalizada','Revista personalizada','catálogo personalizado']),
  ('Serigrafia', ARRAY['Adesivo com gravação por serigrafia','Chapa com gravação por serigrafia','Vidro com gravação por serigrafia']),
  ('Serviços', ARRAY['Serviço de criação de arte','Serviço de entrega','Serviço de instalação','Serviço de remoção']),
  ('Sublimação', ARRAY['Bandeira em Tecido com Impressão Sublimática','Bandeira em tecido com Impressão Direta','Sublimação rolo a rolo']),
  ('Têxtil', ARRAY['Bermuda confeccionada - Impressão DTG','Bermuda confeccionada - Sublimação parcial','Calça confeccionada - Impressão DTG','Calça confeccionada - sublimação parcial','Camiseta manga curta confeccionada - Impressão DTG','Camiseta manga curta confeccionada - sublimação parcial','Camiseta manga curta confeccionada - sublimação total','Camiseta manga longa confeccionada - Impressão DTG','Camiseta manga longa confeccionada - sublimação parcial','Moletom confeccionado - Impressão DTG','Moletom confeccionado - sublimação parcial','Short confeccionado - Impressão DTG','Short confeccionado - sublimação parcial']),
  ('Toldos', ARRAY['Toldo capota em lona','Toldo capota em tecido','Toldo cortina em lona','Toldo cortina em tecido','Toldo fixo em lona','Toldo fixo em policarbonato','Toldo fixo em tecido','Toldo retrátil em lona','Toldo retrátil em policarbonato','Toldo retrátil em tecido'])
) AS f(familia, nomes)
ON CONFLICT DO NOTHING;

-- As três famílias que são combinação de material e forma.
INSERT INTO public.catalogo_modelos (familia, nome)
SELECT 'Chapas', 'Chapa ' || m || s
  FROM unnest(ARRAY['ABS','ACM','Acrílico','Aglomerado','Alumínio','Aço Escovado','Aço Galvanizado','Aço Inóx','Aço Zincado','Compensado','EPS','HDF','MDF','MDP','Madeira maciça','Metálica sem tratamento','OSB','PEAD','PETG','PP Alveolar','PP Compacto','PS','PSAI','PVC Expandido','PVC Rígido','Papel','Policarbonato alveolar','Policarbonato compacto','Vidro','XPS']) AS m,
       unnest(ARRAY[' com Impressão Direta', ' sem impressão']) AS s
ON CONFLICT DO NOTHING;

INSERT INTO public.catalogo_modelos (familia, nome)
SELECT 'Letra caixa', n FROM unnest(ARRAY['Letra Caixa Plana','Letra Caixa Plana com Adesivo Impresso','Letra Caixa Plana com Vinil Colorido','Letra Caixa plana com Impressão Direta','Letra caixa termo-moldada com iluminação','Letra caixa termo-moldada sem iluminação']) AS n
UNION ALL
SELECT 'Letra caixa', 'Letra Caixa plana em ' || m FROM unnest(ARRAY['ACM','Acrílico','Aço Escovado','Aço Galvanizado','Aço Inóx','Latão','MDF','PVC Expandido','XPS']) AS m
UNION ALL
SELECT 'Letra caixa', 'Letra caixa em relevo ' || i || ' - ' || m
  FROM unnest(ARRAY['com iluminação direta','com iluminação indireta','sem iluminação']) AS i,
       unnest(ARRAY['ACM','Acrílico','Aço Escovado','Aço Galvanizado','Aço Inóx','Latão','MDF','PVC Expandido','XPS']) AS m
ON CONFLICT DO NOTHING;

INSERT INTO public.catalogo_modelos (familia, nome)
SELECT 'Totens', 'Totem ' || f || ' em ' || m || s
  FROM unnest(ARRAY['plano','curvo','especial','formato L','formato T invertido','quadrado','redondo','triangular']) AS f,
       unnest(ARRAY['ACM','MDF','PS','PVC rígido','acrílico','aço galvanizado','aço inóx','papel']) AS m,
       unnest(ARRAY['', ' (Impressão Direta)']) AS s
ON CONFLICT DO NOTHING;
