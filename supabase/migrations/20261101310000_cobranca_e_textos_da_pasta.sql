-- A pasta do produto começa a funcionar (01/11/2026, pedido do dono).
--
-- 1. PRODUTIVIDADE COM DADO, NÃO EM BRANCO. Cada processo diz de onde vem o tempo:
--      m2_h / m_h          produtividade da oficina (impressão por área; refile, bainha e ilhós pelo contorno);
--      tempo_do_produto    o tempo mora no produto ou no fatiador (laser, recorte, 3D, instalação): depende do desenho,
--                          e uma média por m² mentiria.
--    E de onde veio o número (`produtividade_origem`):
--      cadastro_maquina    a velocidade já gravada na máquina (plotter: 14 m²/h);
--      referencia_mercado  número de referência do setor, provisório até a oficina medir;
--      medido              a oficina confirmou;
--      nao_se_aplica       o tempo não vem daqui.
--    Quem conhece a oficina confirma em /preencher-pastas: é o painel de cobrança abaixo.
--
-- 2. QUEM PREENCHE PODE GRAVAR. Produção grava processos; atendimento e financeiro gravam a ficha. Antes só admin e
--    gestor gravavam: a cobrança ia para quem não conseguia atender.
--
-- 3. COBRANÇA NO PAINEL DE CADA PAPEL, em `pendencias_do_sistema`: produção confirma o número, atendimento revisa o
--    roteiro, financeiro preenche o fiscal, gerência vê o total.
--
-- 4. TEXTOS DO ROTEIRO DA IA. Escritos para os produtos desta casa, a partir do catálogo e do conhecimento comum do
--    ofício: o que é, onde se usa, observações e o que perguntar. Não há texto copiado de outro sistema.
--    Ficam LIGADOS (`ia_habilitado`), e `ia_revisado_em` vazio é o que o painel do atendimento cobra.

ALTER TABLE public.processos
  ADD COLUMN base_produtividade text NOT NULL DEFAULT 'm2_h'
    CHECK (base_produtividade IN ('m2_h', 'm_h', 'tempo_do_produto')),
  ADD COLUMN produtividade_m_h numeric CHECK (produtividade_m_h IS NULL OR produtividade_m_h > 0),
  ADD COLUMN produtividade_origem text NOT NULL DEFAULT 'referencia_mercado'
    CHECK (produtividade_origem IN ('cadastro_maquina', 'referencia_mercado', 'medido', 'nao_se_aplica')),
  ADD COLUMN produtividade_fonte text,
  ADD COLUMN medido_em timestamptz;

ALTER TABLE public.produto_ficha
  ADD COLUMN ia_revisado_em timestamptz,
  ADD COLUMN ia_revisado_por uuid;

UPDATE public.processos SET base_produtividade = 'tempo_do_produto', produtividade_origem = 'nao_se_aplica',
       produtividade_fonte = CASE nome
         WHEN 'Arte final' THEN 'Hora lançada no item do orçamento.'
         WHEN 'Recorte eletrônico' THEN 'Depende do desenho. Teto da máquina: 800 mm/s (ficha VCUT120CAM). O tempo fica no produto.'
         WHEN 'Corte e gravação a laser CO2' THEN 'Depende do material e do desenho. Teto da máquina: 40.000 mm/min de corte e 75.000 de gravação. O tempo fica no produto.'
         WHEN 'Marcação a laser fiber' THEN 'Depende da peça. O tempo fica no produto.'
         WHEN 'Impressão 3D' THEN 'O tempo vem do fatiador, em cada orçamento 3D.'
         ELSE 'Combinado por trabalho.' END
 WHERE nome IN ('Arte final', 'Recorte eletrônico', 'Corte e gravação a laser CO2', 'Marcação a laser fiber', 'Impressão 3D',
                'Bastão, ponteira e corda', 'Embalagem', 'Instalação', 'Deslocamento de equipe');

UPDATE public.processos SET produtividade_m2_h = m.velocidade_m2_h, setup_min = 5, produtividade_origem = 'cadastro_maquina',
       produtividade_fonte = 'Velocidade cadastrada da plotter. Catálogos de plotter de 1,8 m trazem de 8,7 a 17 m²/h nos modos de qualidade. Preparação: referência do setor.'
  FROM public.maquinas m WHERE m.tipo = 'plotter_impressao' AND m.ativa AND m.velocidade_m2_h > 0 AND processos.nome = 'Impressão eco-solvente';

UPDATE public.processos SET base_produtividade = 'm_h', produtividade_m_h = 100, setup_min = 5,
       produtividade_por_familia = '[{"familias":["Adesivo","Vinil"],"produtividade_m2_h":100},{"familias":["Impress","Papel"],"produtividade_m2_h":120},{"familias":["Lona"],"produtividade_m2_h":90}]'::jsonb,
       produtividade_fonte = 'Referência do setor, em metros de contorno por hora.' WHERE nome = 'Refile manual';
UPDATE public.processos SET produtividade_m2_h = 20, setup_min = 5, produtividade_fonte = 'Referência do setor.' WHERE nome = 'Laminação';
UPDATE public.processos SET produtividade_m2_h = 15, setup_min = 5, produtividade_fonte = 'Referência do setor: 10 m²/h em desenho difícil, 20 em desenho simples.' WHERE nome = 'Depilação de adesivo recortado';
UPDATE public.processos SET base_produtividade = 'm_h', produtividade_m_h = 60, setup_min = 3, sobra_cm = '{"superior":10,"inferior":10,"esquerda":10,"direita":10}'::jsonb,
       produtividade_fonte = 'Referência do setor, em metros de contorno por hora.' WHERE nome = 'Colocação de ilhós';
UPDATE public.processos SET base_produtividade = 'm_h', produtividade_m_h = 300, setup_min = 10, sobra_cm = '{"superior":10,"inferior":10,"esquerda":10,"direita":10}'::jsonb,
       produtividade_fonte = 'Referência do setor, em metros de contorno por hora.' WHERE nome = 'Bainha';

-- Quem preenche pode gravar. A tela mostra a cada papel só a sua parte.
DROP POLICY "processos admin write" ON public.processos;
CREATE POLICY "processos producao write" ON public.processos FOR ALL
  USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role) OR public.has_role((SELECT auth.uid()), 'gestor'::public.app_role) OR public.has_role((SELECT auth.uid()), 'operador'::public.app_role))
  WITH CHECK (public.has_role((SELECT auth.uid()), 'admin'::public.app_role) OR public.has_role((SELECT auth.uid()), 'gestor'::public.app_role) OR public.has_role((SELECT auth.uid()), 'operador'::public.app_role));

DROP POLICY "produto_ficha admin write" ON public.produto_ficha;
CREATE POLICY "produto_ficha equipe write" ON public.produto_ficha FOR ALL
  USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role) OR public.has_role((SELECT auth.uid()), 'gestor'::public.app_role) OR public.has_role((SELECT auth.uid()), 'vendedor'::public.app_role) OR public.has_role((SELECT auth.uid()), 'financeiro'::public.app_role))
  WITH CHECK (public.has_role((SELECT auth.uid()), 'admin'::public.app_role) OR public.has_role((SELECT auth.uid()), 'gestor'::public.app_role) OR public.has_role((SELECT auth.uid()), 'vendedor'::public.app_role) OR public.has_role((SELECT auth.uid()), 'financeiro'::public.app_role));

-- A cobrança, na definição viva: outra sessão pode ter acrescentado pendências desde a última migração.
DO $m$
DECLARE
  v_def text := pg_get_functiondef('public.pendencias_do_sistema()'::regprocedure);
  v_novo text;
BEGIN
  v_novo := replace(v_def, E'\n  RETURN;\nEND;', $bloco$

  -- A pasta do produto (01/11/2026): cada um cobra a sua parte em /preencher-pastas.
  RETURN QUERY SELECT 'processo_produtividade_a_confirmar', 'Processos com produtividade ainda não medida', count(*)::int,
    (SELECT count(*)::int FROM public.processos WHERE ativo AND base_produtividade <> 'tempo_do_produto'), 'atencao', 'producao',
    'O tempo de cada produto sai deste número, e hoje ele é referência, não medição da oficina. Meça e confirme.', '/preencher-pastas'
  FROM public.processos WHERE ativo AND base_produtividade <> 'tempo_do_produto' AND produtividade_origem <> 'medido' HAVING count(*) > 0;

  RETURN QUERY SELECT 'roteiro_ia_a_revisar', 'Roteiros da IA sem revisão de quem atende', count(*)::int,
    (SELECT count(*)::int FROM public.produto_ficha), 'atencao', 'atendimento',
    'A IA usa este roteiro para perguntar ao cliente. Leia, ajuste o que não é assim na nossa loja e marque como revisado.', '/preencher-pastas'
  FROM public.produto_ficha f JOIN public.produtos p ON p.id = f.produto_id
  WHERE p.ativo AND f.ia_revisado_em IS NULL HAVING count(*) > 0;

  RETURN QUERY SELECT 'produto_sem_ncm', 'Produtos sem NCM', count(*)::int,
    (SELECT count(*)::int FROM public.produtos WHERE ativo AND tipo::text <> 'servico'), 'atencao', 'financeiro',
    'Produto sem NCM não sai certo na nota fiscal. Preencha com o código que a contabilidade usa.', '/preencher-pastas'
  FROM public.produtos p LEFT JOIN public.produto_ficha f ON f.produto_id = p.id
  WHERE p.ativo AND p.tipo::text <> 'servico' AND coalesce(btrim(f.ncm), '') = '' HAVING count(*) > 0;

  RETURN QUERY SELECT 'pasta_do_produto_incompleta', 'Pastas de produto incompletas', n.falta,
    n.falta, 'atencao', 'gestao',
    'Produção, atendimento e financeiro têm a sua parte para preencher. Veja quem falta e cobre.', '/preencher-pastas'
  FROM (SELECT
      (SELECT count(*)::int FROM public.processos WHERE ativo AND base_produtividade <> 'tempo_do_produto' AND produtividade_origem <> 'medido')
    + (SELECT count(*)::int FROM public.produto_ficha f JOIN public.produtos p ON p.id = f.produto_id WHERE p.ativo AND f.ia_revisado_em IS NULL)
    + (SELECT count(*)::int FROM public.produtos p LEFT JOIN public.produto_ficha f ON f.produto_id = p.id
        WHERE p.ativo AND p.tipo::text <> 'servico' AND coalesce(btrim(f.ncm), '') = '') AS falta) n
  WHERE n.falta > 0;

  RETURN;
END;$bloco$);
  IF v_novo = v_def THEN RAISE EXCEPTION 'o fim de pendencias_do_sistema não foi encontrado'; END IF;
  EXECUTE v_novo;
END $m$;

-- Os textos. Para cada produto: o que é, onde se usa, observações e o que só este produto precisa perguntar.
UPDATE public.produto_ficha f SET
  ia_personalidade = '## O que é' || E'\n' || t.oque || E'\n\n## Onde se usa\n' || t.onde || E'\n\n## Observações\n' || t.obs,
  ia_perguntas = coalesce(f.ia_perguntas, '') || E'\n- ' || t.pergunta,
  ia_habilitado = true
FROM (VALUES
  ('53096339-5b76-48ca-86e6-df116cfe6074'::uuid, 'Reforço da borda da lona com solda e ilhós a cada 50 cm, para pendurar ou amarrar.', 'Faixas, fachadas e qualquer lona que vai ficar exposta ao vento.', 'Cobrado por metro de contorno. Sem bainha a borda rasga com o tempo em área externa.', 'Vai pendurar por corda, abraçadeira ou parafuso?'),
  ('ea107d14-1ccf-4c36-b946-4ca6768ab4ea', 'Hora de trabalho manual para acabamentos que não têm processo próprio.', 'Montagem, colagem, dobra e ajustes em peças especiais.', 'Só entra quando o acabamento não está no próprio produto. Combine as horas antes de orçar.', 'O que precisa ser feito à mão e em quantas peças?'),
  ('923148dd-1675-4fc8-9a35-1778418d6e85', 'Corte de material por laser CO2, cobrado pelo tempo de máquina.', 'Acrílico, MDF e outros materiais não metálicos, em letras, logos e formatos especiais.', 'O tempo depende do desenho e da espessura. Área de trabalho de 100 x 60 cm. Metal não corta neste laser.', 'Qual o material e a espessura? Tem o arquivo vetorial do corte?'),
  ('2fe3d50e-12e1-40a8-8296-c3eead2dd957', 'Camada protetora sobre o adesivo impresso, contra raios UV e riscos.', 'Adesivos de carro, área externa e peças com muito manuseio.', 'Aumenta a vida útil da impressão. Recomende sempre para uso externo prolongado.', 'Prefere acabamento brilho ou fosco?'),
  ('f7e2dc28-9f0f-49f9-ba05-62f8cdedb1da', 'Corte do vinil no contorno do desenho, feito na plotter de recorte com leitura de marcas.', 'Adesivos em formato especial, letras e logos.', 'Cobrado por metro. Largura útil de 1,26 m. Letras muito pequenas ou traços finos podem não recortar bem.', 'Qual o menor detalhe do desenho?'),
  ('c885a2b3-1aef-4150-8382-6b76ac8e9604', 'Acrílico com efeito de espelho, dourado ou prateado, recortado no formato desejado.', 'Letreiros internos, logos de recepção, troféus, decoração e lembranças.', 'A face espelhada risca com facilidade: manuseie com a película. Melhor em ambiente interno.', 'Dourado ou prateado?'),
  ('1b157420-ed1b-4732-97bb-189a7e3fe8fd', 'Acrílico virgem de 2 mm recortado no formato desejado.', 'Peças leves, displays pequenos, placas de identificação e chaveiros.', 'Mais fino e mais barato que o de 3 mm. Para peça grande ou que leva pancada, indique o de 3 mm.', 'Transparente, branco ou preto?'),
  ('328251b9-2360-4b62-8db0-1da77641a60d', 'Acrílico virgem de 3 mm recortado no formato desejado.', 'Placas, letreiros internos, displays e proteções.', 'Boa rigidez para a maioria das placas. Peça muito grande pode pedir espessura maior.', 'Transparente, branco ou preto?'),
  ('d64c2518-d40a-42a6-8800-794db7176eda', 'Quadro de acrílico transparente com adesivo vinil por trás.', 'Salas, recepções, decoração e quadros de avisos.', 'O acrílico dá brilho e protege a impressão. Confirme como vai fixar na parede.', 'Vai fixar com fita, parafuso ou espaçador?'),
  ('622d3846-6b63-432f-8ee2-c073e7373c16', 'Vinil de cor sólida recortado no desenho, sem impressão.', 'Letras em vidro, vitrines, carros e sinalização.', 'Sem degradê nem foto: só cor chapada. Quem aplica precisa de máscara de transferência.', 'Qual a cor do vinil? Precisa de aplicação?'),
  ('47f6148e-6ed0-45ab-ab7f-414c2fed685a', 'Adesivo de mão de 10 x 10 cm com recorte no contorno.', 'Campanhas, distribuição em massa e carros.', 'Vendido por unidade. Medida fixa.', 'Quantas unidades e com qual arte?'),
  ('f5c3a861-ee08-48c0-b593-b949f7ca0f01', 'Adesivo de mão de 7 x 7 cm com recorte no contorno.', 'Campanhas e distribuição em massa, o item de maior giro.', 'Vendido por unidade. Medida fixa.', 'Quantas unidades e com qual arte?'),
  ('6c4f2bc2-cf5b-4551-8bbf-dc5411d00e2e', 'Adesivo redondo em vinil leitoso de 33 x 33 cm.', 'Carro, moto e poste.', 'O vinil leitoso segura bem a cor sobre fundo escuro. Medida fixa.', 'Quantas unidades e com qual arte?'),
  ('40eb036f-ffa7-48ed-a36d-f75cc6421b17', 'Adesivo redondo em vinil leitoso de 48 x 48 cm.', 'Poste, muro e vitrine.', 'Formato grande para ser visto de longe. Medida fixa.', 'Quantas unidades e com qual arte?'),
  ('089ad79a-9269-4386-9855-4677a57b4070', 'Adesivo em vinil leitoso de 15 x 15 cm, recortado no contorno.', 'Poste, muro, portão e bandeira de mão.', 'Medida fixa, vendido por unidade.', 'Quantas unidades e com qual arte?'),
  ('44ef8199-2847-40dd-a595-1e8fc0b59317', 'Adesivo em vinil leitoso de 30 x 30 cm, recortado no contorno.', 'Poste, muro, portão e bandeira de mão.', 'Medida fixa, vendido por unidade.', 'Quantas unidades e com qual arte?'),
  ('59695bf2-02d8-41d7-b5ef-ecf78a978026', 'Faixa adesiva em vinil leitoso de 90 x 12 cm.', 'Banca, box de feira, mesa de rua e testeira de comitê.', 'Medida fixa. Boa para frase curta, porque a altura é pequena.', 'Qual o texto e quantas unidades?'),
  ('6e456561-d8f5-420f-88ce-814f387f7fe0', 'Vinil com aparência de vidro jateado, que dá privacidade e deixa a luz passar.', 'Divisórias, portas de vidro, salas de reunião, clínicas e vitrines.', 'Vidro limpo e liso é condição para aplicar sem bolha. A aplicação costuma ser feita por nós.', 'A aplicação fica por nossa conta? Qual a medida de cada vidro?'),
  ('3ae5022a-968d-41db-bb85-e462318cb583', 'Vinil impresso com verso bloqueador, que não deixa o fundo aparecer.', 'Cobrir marca antiga, adesivar sobre superfície escura ou com outra cor.', 'É o indicado para cobrir o que já existe no local.', 'Vai cobrir alguma marca ou cor de fundo?'),
  ('d741f73d-2129-41ef-9c67-fea281029620', 'Vinil impresso de acabamento fosco, sem reflexo.', 'Ambientes internos muito iluminados, painéis, paredes e peças de leitura de perto.', 'Evita o reflexo de luz. Marcas de dedo aparecem mais do que no brilho em cor escura.', 'Vai para ambiente interno ou externo?'),
  ('d28f271f-5745-4606-8d88-67ea6a51a46b', 'Vinil impresso de linha econômica, para campanha de curta duração.', 'Promoções, eventos e peças temporárias.', 'Não indique para longo prazo ao ar livre: para isso existe o vinil branco impresso com laminação.', 'Por quanto tempo a peça vai ficar exposta?'),
  ('504a9190-317b-4e44-8e7c-e9214ea0d1dd', 'Vinil transparente impresso, em que o fundo continua aparecendo.', 'Vitrines, vidros e superfícies em que a cor de fundo faz parte da arte.', 'Cor clara perde força sobre vidro: confirme a arte antes de produzir.', 'Sobre qual superfície será aplicado?'),
  ('aef1d1c9-5dbb-4860-bb80-818d64729464', 'Vinil branco brilho com impressão digital, o adesivo de uso geral.', 'Paredes, placas, caixas, carros e sinalização.', 'Para uso externo prolongado, ofereça laminação.', 'Vai para ambiente interno ou externo? Precisa de recorte no contorno?'),
  ('8834839e-f345-46dc-b864-10dfc0f4cc54', 'Vinil microperfurado: de fora se vê a imagem, de dentro se vê a rua.', 'Vidros de lojas, vitrines e veículos.', 'Foto e cor forte funcionam melhor que texto pequeno, porque os furos reduzem o detalhe.', 'Qual a medida de cada vidro? A aplicação fica por nossa conta?'),
  ('8c7f1f9e-88bd-499c-ae52-941edc0989f0', 'Microperfurado em medida pronta de 90 x 33 cm.', 'Vidro traseiro de carro hatch e compacto.', 'Confirme o modelo do carro: a curva do vidro muda o encaixe.', 'Qual o modelo do carro?'),
  ('a1763518-294a-475d-b2f7-dcd60768e977', 'Microperfurado em medida pronta de 90 x 50 cm.', 'Vidro traseiro de sedã e picape.', 'Confirme o modelo do carro: a curva do vidro muda o encaixe.', 'Qual o modelo do carro?'),
  ('6d3bcfa5-3a60-4e86-bc7f-92b4ee886d24', 'Microperfurado de linha econômica, para campanha de curta duração.', 'Vitrines e vidros em promoções temporárias.', 'Para longo prazo, indique o microperfurado comum.', 'Por quanto tempo a peça vai ficar exposta?'),
  ('cb58f5d8-1eaf-4019-a84c-6b311d0cf9c3', 'Banner em lona 440 g pronto para pendurar, com bastão e corda.', 'Eventos, lojas, igrejas, escolas e pontos de venda.', 'Pronto para uso, sem precisar de estrutura. Tripé é à parte.', 'Precisa de tripé? Quando será usado?'),
  ('02084c59-cc5e-49c3-b3b5-55d18b2581d0', 'Bolsa térmica de 30 litros com a marca do cliente.', 'Brinde de empresa, delivery e eventos.', 'Brinde depende de quantidade mínima e de prazo do fornecedor.', 'Quantas unidades e para quando?'),
  ('02b5aa14-2788-4325-8c82-e23a2279ae70', 'Caneta plástica simples com a marca do cliente.', 'Feiras, escolas, campanhas e distribuição em massa.', 'A área de gravação é pequena: logo simples fica melhor.', 'Quantas unidades e qual a cor da caneta?'),
  ('9dcd6d18-9b2c-4fc6-8067-f2fc6651d7ca', 'Chaveiro em acrílico recortado com arte em DTF.', 'Lembranças, brindes de empresa, eventos e festas.', 'Formato personalizado sai no laser. Vendido com preço por quantidade.', 'Qual o formato e quantas unidades?'),
  ('fb5b6cd1-3998-41a0-90d3-50f219c909a8', 'Copo térmico longo de 500 ml com a marca do cliente.', 'Brinde de empresa, festas e academias.', 'Confirme a cor disponível antes de fechar.', 'Quantas unidades e qual a cor?'),
  ('725fe45c-5e85-47df-a53a-658ab7faa9fa', 'Copo térmico tipo cuia de 380 ml com a marca do cliente.', 'Brinde de empresa e presentes.', 'Confirme a cor disponível antes de fechar.', 'Quantas unidades e qual a cor?'),
  ('c07299b0-a140-4a1f-860b-dfcb2be8d998', 'Kit de churrasco profissional com 6 jogos de garfo e faca, personalizado.', 'Presente corporativo e datas especiais.', 'Item de ticket maior: confirme estoque e prazo.', 'Quantos kits e para quando?'),
  ('50b480ea-db91-47d2-953b-08c83a357768', 'Kit avulso sem caixa com faca, garfo e afiador.', 'Brinde e presente.', 'Sem caixa. Se quiser apresentação melhor, ofereça o kit com tábua.', 'Quantos kits e qual a gravação?'),
  ('9584cbbc-6189-4ba2-86bc-e2b9d3bb1f9b', 'Kit com tábua, garfo e faca, personalizado.', 'Presente corporativo e datas especiais.', 'A tábua recebe bem gravação a laser de logo e nome.', 'Quantos kits e qual a gravação?'),
  ('ed1e594d-3770-4a6d-b69f-9e96d253885e', 'Kit de churrasco com garfo e faca longos, personalizado.', 'Brinde e presente.', 'A área de gravação fica no cabo ou na lâmina.', 'Quantos kits e qual a gravação?'),
  ('1a646e6f-1988-4fda-9a3f-c0284112f9d8', 'Necessaire em tecido com a marca do cliente.', 'Brinde de empresa, eventos e clínicas.', 'Confirme o tamanho e a cor disponível.', 'Quantas unidades e qual a cor?'),
  ('cf0b3917-7b71-441d-8f79-cd59043a5d37', 'Criação ou ajuste de arte pela nossa equipe.', 'Quando o cliente não tem arquivo pronto para produção.', 'Cobrado por hora. O cliente aprova a arte antes de produzir.', 'Já tem logo em boa qualidade e os textos?'),
  ('1dc26b82-fefa-41a7-92c5-f880668a978f', 'Peça impressa em 3D, em filamento, com preço calculado pelo tempo e pelo material.', 'Protótipos, miniaturas, brindes e peças sob encomenda.', 'O preço sai do orçamento 3D, com o tempo real do fatiador. Pedido grande é dividido entre as impressoras.', 'Tem o arquivo 3D ou uma foto da peça? Quantas unidades?'),
  ('dac028c2-9650-4c9d-936d-a06979e2b713', 'Fachada iluminada por dentro, com estrutura metálica, lona translúcida e LED.', 'Lojas e comércios que funcionam à noite.', 'Precisa de visita técnica e medida no local, além de ponto de energia.', 'Tem ponto de energia no local? Podemos agendar a visita técnica?'),
  ('7c260801-b934-4210-8917-19176c72d2f8', 'Letra em volume recortada em PVC de 10 mm e pintada.', 'Fachadas, recepções e letreiros internos.', 'Vendida por unidade. O tamanho muda o preço: confirme a altura de cada letra.', 'Qual o texto e a altura das letras? Precisa de instalação?'),
  ('44405505-1e06-4b7d-8829-4ea6c5719b47', 'Impressão colorida A3 em papel couché 150 g.', 'Cartazes, avisos e peças de ponto de venda.', 'Quantidade pequena sai na hora. Volume grande vale cotar impressão gráfica.', 'Quantas cópias e só frente?'),
  ('8935cd25-3073-419e-98cb-a2e2c46d0078', 'Impressão colorida A4 em papel couché 150 g.', 'Folhetos, avisos, etiquetas e materiais internos.', 'Quantidade pequena sai na hora. Volume grande vale cotar impressão gráfica.', 'Quantas cópias e só frente?'),
  ('01c58628-e678-44b7-b3c1-0be0eb9fc65e', 'Mil cartões de visita em couché 300 g, frente e verso, com verniz UV na frente.', 'Profissionais e empresas.', 'Vendido por milheiro. Confirme os dados com o cliente antes de produzir.', 'Tem a arte pronta com os dados conferidos?'),
  ('bf5c653f-e641-42a4-ae00-6e48e1ece8b3', 'Mil panfletos A5 em couché 115 g, frente e verso.', 'Promoções, campanhas e distribuição de rua.', 'Vendido por milheiro. Prazo depende da gráfica parceira.', 'Tem a arte pronta? Para quando precisa?'),
  ('ca0f2030-7434-4e7a-b83d-3722fbb0add6', 'Deslocamento da equipe até o local do serviço.', 'Instalações, entregas e visitas fora da loja.', 'Cobrado por km rodado. Pergunte o endereço para calcular.', 'Qual o endereço do local?'),
  ('4ed8f3f2-579a-4d70-a943-eb55f6db0401', 'Mão de obra da equipe de instalação, por hora.', 'Aplicação de adesivo, fachada, placa e lona no local do cliente.', 'Trabalho em altura pede avaliação antes. Some o deslocamento.', 'Qual a altura de instalação e o endereço?'),
  ('74cbbb9d-47a5-4cf3-8111-dc4517879743', 'Lona translúcida para peça iluminada por trás.', 'Fachadas luminosas e caixas de luz.', 'Só faz sentido com iluminação atrás. Sem ela, indique a lona frontlight.', 'A peça será iluminada por dentro?'),
  ('2fcb2825-56b8-4e8b-a4f7-386cf3612e2c', 'Lona brilho 280 g com impressão digital, sem acabamento.', 'Faixas, banners e campanhas de curta e média duração.', 'A lona mais usada. Para vento forte e longo prazo, indique a 440 g.', 'Vai ficar em área externa?'),
  ('b642e4a8-7fc0-4168-9ca6-697bfd5b985f', 'Lona 440 g blackout reforçada, com impressão digital.', 'Fachadas, painéis grandes e peças de longa duração.', 'Mais resistente e não deixa o fundo aparecer. Indique com bainha e ilhós.', 'Vai fixar em estrutura ou amarrar?'),
  ('104c2b37-2112-4c97-865e-7842b6696cd5', 'Lona impressa de acabamento fosco, sem reflexo.', 'Ambientes internos, palcos, fundos de foto e eventos.', 'Sem reflexo de luz: boa para foto e filmagem.', 'Será usada em foto ou filmagem?'),
  ('7a6c9053-7a54-4abf-ae57-d7ea5b3ce07e', 'Chapa de ACM de 3 mm com vinil impresso aplicado.', 'Fachadas e placas externas de longa duração.', 'O mais resistente das placas: não enferruja nem empena com facilidade.', 'Como vai fixar? Precisa de instalação?'),
  ('fc75848a-c4ab-4213-aefd-53733206ddd4', 'Chapa de poliestireno de 2 mm com vinil impresso.', 'Placas internas, sinalização e campanhas.', 'Leve e barata. Não é para exposição longa ao sol.', 'Vai para ambiente interno ou externo?'),
  ('39dfc6e8-e929-42c7-ac5e-e7490a32b8be', 'Chapa de PVC expandido de 3 mm com impressão ou adesivo.', 'Placas internas e externas protegidas, sinalização de loja.', 'Leve e fácil de fixar. Placa grande pode pedir espessura maior.', 'Como vai fixar a placa?')
) AS t(id, oque, onde, obs, pergunta)
WHERE f.produto_id = t.id;

-- Sugestão de medida para quem vende por m² e ainda não tem tamanhos cadastrados.
UPDATE public.produto_ficha f SET ia_como_medir = f.ia_como_medir
  || E'\n\n## Se o cliente não souber a medida\nPergunte onde a peça vai ficar e peça a medida do local. Se não tiver como medir, ofereça a visita técnica.'
 FROM public.produtos p
 WHERE p.id = f.produto_id AND lower(p.unidade) IN ('m2', 'm²') AND NOT EXISTS (SELECT 1 FROM public.produto_tamanhos z WHERE z.produto_id = p.id);
