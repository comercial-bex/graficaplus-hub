# Auditoria de orçamentos, preços e margem. 15/11/2026

## Resultado

As contas de preço estão certas. Os 30 orçamentos mais recentes e os 124 totais batem com o recálculo. Só 7 itens antigos divergem, num total de R$ 5,02.

O problema está na margem e no catálogo. A margem que a tela mostra é maior que a real. Há quatro causas principais.

1. O custo do item é só material. Máquina, mão de obra e indireto ficam de fora.
2. Impostos, taxa de cartão, perdas e comissão não entram na conta.
3. Custos gravados à mão estão errados em alguns itens. O pior é o orçamento 227, que mostra 97% de margem e tem cerca de 71%.
4. O custo gravado no orçamento está abaixo do custo vivo em 50 orçamentos enviados, aprovados ou convertidos. A diferença é de cerca de R$ 1,5 mil.

No catálogo, 9 produtos da campanha estão sem preço desde 04/10. Sete produtos têm preço de tabela abaixo do piso da margem mínima. Nesses sete, o parceiro paga mais que o balcão.

Dinheiro parado que pede ação sua hoje. O orçamento 142, de R$ 4.397,00, está aprovado sem OS há 17 dias. Mais 4 orçamentos aprovados sem OS somam R$ 322,54.

Nada foi alterado no banco. Tudo foi leitura.

## 1. Defeitos de código que posso corrigir agora

Ordem por gravidade confirmada.

1. Parceiro paga mais que o balcão em 7 produtos. Gravidade alta.
   - A função parceiro_precos usa GREATEST entre o preço com desconto e o piso. Não há LEAST contra o preço base.
   - Afeta os 19 parceiros ativos. Bolsa térmica 66,67 contra 59,00. Copo térmico 50,00 contra 40,00. Kit Churrasco 12PÇ 113,33 contra 89,00. Necessaire 49,83 contra 39,90. Corte a laser 55,05 contra 52,80. Recorte eletrônico 2,02 contra 1,93. Acabamento manual 40,28 contra 38,40.
   - Correção: LEAST do resultado com o preço base, nos dois pontos, preço simples e faixas.

2. Custo gravado errado passa sem checagem. Gravidade alta.
   - O gatilho tg_orcamento_item_custo_do_produto só preenche o custo quando ele é zero. Aceita qualquer valor vindo da tela.
   - Resultado medido em 8 itens com custo omitido de R$ 156,22. Orçamento 227: gravou R$ 12,97 e o certo é R$ 129,66, um décimo, erro de vírgula. Orçamento 212: gravou o custo de 1 m² numa peça de 1,5 m².
   - Correção de código: aviso ou CHECK quando o custo difere mais de 30% de custo_medio vezes a área cobrada.
   - Correção de dado: recalcular os 8 itens com UPDATE que dispara o gatilho.

3. custo_estimado do orçamento fica abaixo do custo vivo. Gravidade alta.
   - Hoje são 50 orçamentos divergentes de 72. O título original falava em 59, o texto em 46. O número de hoje é 50.
   - Aprovado: coluna R$ 3.886,46 contra vivo R$ 4.549,22. Convertido: R$ 1.804,44 contra R$ 2.390,79. Enviado: R$ 2.238,31 contra R$ 2.474,33.
   - Correção: o gatilho de totais passar a calcular o custo pela mesma função de desconto_situacao_interna, em vez de gravar o que a tela mandou.
   - A causa exata não foi isolada. Ver seção 3.

4. Custo do item só com material. Gravidade alta.
   - O gatilho lê custo_medio e ignora produto_custo_cheio. A tela e o desconto_avaliar usam critérios diferentes para o mesmo orçamento.
   - Exemplo: adesivo vinil branco mostra 83,3% e tem 76,5% com custo cheio.
   - Custo de máquina, mão de obra e indireto fora da conta: R$ 1.376,26 em aprovados e R$ 404,60 em convertidos.
   - Correção: gravar custo de material e custo de conversão em colunas separadas e mostrar margem de material e margem cheia. Qual custo vale é decisão sua. Ver seção 2.

5. Fatores fora da margem. Gravidade alta.
   - Estão cadastrados impostos 6%, cartão 3,5%, perda de material 8%, falha de produção 5% e uma regra de comissão de 10%.
   - Só o simulador e o desconto_avaliar usam esses fatores. Orçamento, vw_resultado_os e a tela não usam.
   - Taxa de 7,75% sobre a receita das OS dá cerca de R$ 902. Sobre orçamentos aprovados ou convertidos dá cerca de R$ 1.287.
   - Correção: uma função SQL única de margem, usada por tela, view e desconto_avaliar, com margem de contribuição ao lado da bruta.

6. Colunas geradas de área em 3 casas. Gravidade média.
   - area_unitaria e area_cobrada usam 3 casas. O preço já usa 6. Custo e preço usam áreas diferentes na mesma linha.
   - 8 itens divergem mais de 2%. O máximo é 25%. O erro vai nos dois sentidos. O adesivo 5x5 cm com 120 unidades mostra 0,360 e o real é 0,300.
   - Efeito extra: 11 itens mostram "cobrado ... mínimo" sem ter mínimo nenhum.
   - Correção segura: fazer desconto_avaliar e metragem-por-material calcularem a área direto. Depois recriar as colunas em 6 casas, conferindo antes as 6 views dependentes.

7. margem_estimada nunca é gravada. Gravidade média.
   - É nula em 124 de 124 orçamentos. Nenhuma função grava a coluna.
   - As views de dashboard fazem média com COALESCE e mostram margem prevista 0 em vez de nulo.
   - Correção: gravar no gatilho de totais, ou remover a coluna e o espelho.

8. vw_resultado_os trata um lançamento como custo completo. Gravidade média.
   - A OS de R$ 2.225 tem previsto R$ 1.125,00 e realizado R$ 17,36. A margem realizada sai 99,22%. Faltam R$ 1.107,64 de custo.
   - Correção: mostrar "parcial" quando o realizado for menor que o previsto. Adicionar CHECK total maior que zero em custos_operacionais_os.
   - A afirmação de 41 OS sem custo estava errada. O correto é 36 de 50.

9. Orçamento enviado pode ser editado sem nova versão. Gravidade média.
   - O gatilho de versão só dispara na mudança de status. O link público lê os itens ao vivo.
   - Orçamento 227 foi enviado por R$ 57,60 e hoje vale R$ 448,00. O cliente abriu o link 5 vezes.
   - Correção: criar nova versão ao editar orçamento enviado, ou voltar para rascunho. Servir o snapshot da última versão enviada no link.

10. Link público aprova orçamento vencido. Gravidade média.
    - Nenhum job move enviado para expirado. O handler de aprovação não lê validade.
    - São 12 orçamentos vencidos, R$ 3.617,85. Só 6 têm link público, somando R$ 1.186,32.
    - A página pública calcula "Válido até" com created_at mais 7 dias. A regra interna usa enviado_em mais validade_dias.
    - Correção: job diário de expiração, checagem de validade no handler e uma só regra para a data.

11. Duplicação em produto_custo_cheio. Gravidade baixa.
    - A view tem 109 linhas para 70 produtos. O LEFT JOIN com produto_precificacao não filtra.
    - Só 1 produto tem valores diferentes entre as duas linhas, o Certificado A4.
    - Correção: LEFT JOIN LATERAL com uma ficha por produto. Reaplicar security_invoker e GRANTs, porque CREATE OR REPLACE VIEW descarta as opções. Não impor UNIQUE em produto_id, pois as fichas múltiplas são permitidas de propósito.

12. Guarda de conversão só cobre item livre. Gravidade baixa a média.
    - O filtro b2 exige produto_id nulo e ignora custo_formulas. Item de catálogo com custo zero passa.
    - Correção: usar custo_unitario mais custo_formulas, sem exigir produto_id nulo, mantendo a exceção de taxa_prazo. Antes, conferir se terceirizados legítimos sem custo não seriam barrados em massa.

13. Terceirizado por m² ignora área mínima. Gravidade baixa, latente.
    - Nenhum produto tem terceirizado cadastrado com valor hoje. Impacto atual é zero.
    - Correção: GREATEST com a área mínima no ramo m².

14. Itens menores. Gravidade baixa.
    - desconto_avaliar trata a taxa de prazo como item sem custo e cai na regra fixa de 10%. Hoje afeta 0 orçamentos.
    - 20 orçamentos aprovados com OS continuam como "aprovado". Padronizar para convertido ou usar sempre os_id.
    - Colunas mortas: ordens_servico.valor_venda é 0 em 50 de 50 OS.
    - 6 orçamentos com versão aprovada sem linhas em orcamento_versao_itens. 5 itens_os sem orcamento_item_id.
    - Orçamento 36 rejeitado com custo fantasma de R$ 36,50.

## 2. Dados e preços que precisam da sua decisão

1. Campanha política. Gravidade alta.
   - 9 produtos ativos estão sem preço válido. As 33 faixas venceram em 04/10, há 42 dias.
   - Os produtos são Praguinha 10x10 e 7x7, Bola 33, Bolão 48, Pragão 15 e 30, Testeira 90x12, Perfurado 90x33 e 90x50.
   - Opção A: a campanha acabou, desativar os 9. Opção B: continua, renovar a vigência.

2. Sete produtos com preço abaixo do piso. Gravidade média.
   - Margens atuais de 23,6% a 37,4% contra 40% de mínimo.
   - Preços que entregam o piso, sobre custo de material: Kit Churrasco 12PÇ 113,40. Copo térmico 50,00. Necessaire 49,90. Bolsa térmica 66,70. Acabamento manual 40,30. Recorte eletrônico 2,02. Corte a laser 55,10.
   - Ou baixar a margem mínima de propósito. Os itens vendidos até hoje são poucos, então o dano real é pequeno.

3. Qual custo vale como piso e como margem.
   - Hoje o piso e a margem mínima usam só o material. O custo cheio é maior.
   - Copo térmico fica em 25,0% sobre material e 18,2% sobre custo cheio. Acrílico virgem 2mm fica em 74,8% e 69,7%.
   - Calcular sobre custo cheio é política sua. Não é bug de cálculo.

4. Desconto por nível que o piso come.
   - Dos 41 produtos sem preço fixo de parceiro, 17 não entregam os 15% do Bronze e 23 não entregam os 30% do Diamante.
   - Exemplo: Kit 3PÇ de R$ 98,90 dá 0,6% ao Diamante.
   - Opção A: corrigir preço e custo para o piso caber. Opção B: avisar na página seja-parceiro e no portal que o desconto é limitado pela margem mínima. O retorno já traz origem igual a piso.

5. Preço fixo de parceiro.
   - 7 produtos têm preço fixo 33% a 50% abaixo do balcão, igual para todos os níveis. É a tabela de terceirizados.
   - Decidir: manter e documentar, ou tornar o fixo o Bronze e escalar por nível.
   - Lona 440g acima de 6 m² paga 29,90 no excedente e o piso é 31,17. Sugestão: 31,20. O efeito médio só aparece em linhas acima de cerca de 23,6 m².

6. Orçamento 69, rascunho. Quadro Acrílico com custo de R$ 200,00 por peça.
   - O custo certo por peça é R$ 49,28. A diferença é R$ 1.959,36 de custo fantasma.
   - O 181 tem os mesmos itens e o mesmo preço, com custo de 49,28. Decidir qual vale e apagar o duplicado.
   - Corrigir antes de qualquer aprovação.

7. Resíduo de arredondamento antigo. Líquido de R$ 5,02 a mais, em 7 itens.
   - Orçamento 115, enviado, ainda sem aprovação. 4 itens cobram R$ 3,21 a mais. O 5x5 cm mostra R$ 10,80 e o certo é R$ 9,00. Dá para corrigir, mas o PDF enviado mostra o valor antigo, então avise o cliente.
   - Orçamentos 150 e 152, aprovados e com OS. Diferença de R$ 1,80 e R$ 0,02. Minha recomendação é manter. O preço aprovado manda e o cliente já pagou o Pix de 50%.
   - Orçamento 56, aprovado. Cobra R$ 0,01 a menos.
   - Isso não é defeito de código. O gatilho preserva o preço aprovado de propósito.

8. Itens sem custo gravado. 23 itens vivos, R$ 2.937,67. Margem aparece como 100%.
   - Convertidos 55, 61, 67, 78 e 98 com custo_estimado zero. As OS têm custo previsto 9,12, 274,52, 340,00 e 18,57, soma R$ 642,21. Margem real cerca de 65% a 70%.
   - A OS do orçamento 98, R$ 300, tem custo previsto zero. É o único caso com margem 100% de fato na OS.
   - Preencher o custo vem da planilha de custos.

9. Aprovados sem OS e sem motivo. R$ 4.719,54.
   - 142: R$ 4.397,00, Pix sem recebimento, parado desde 29/10. Confirmar o Pix no extrato ou ligar para o cliente.
   - 223: R$ 150,45. 159: R$ 70,09, sem cliente vinculado. 177: R$ 60,00. 153: R$ 42,00, dois itens livres sem custo.
   - Sugestão de processo: aviso diário para aprovado sem OS há mais de 2 dias, com o motivo da recusa.

10. Orçamentos enviados e depois editados.
    - 227: enviado por R$ 57,60, hoje R$ 448,00. Confirmar com o cliente qual valor vale antes de aprovar.
    - 134: enviado por R$ 210,00, hoje R$ 326,88. 115: enviado por R$ 530,30, hoje R$ 366,00.

11. 12 orçamentos enviados vencidos, R$ 3.617,85. Expirar ou renovar pelo quadro.

12. Impressão 3D serviço. Gravidade baixa.
    - Está ativa sem preço e sem custo no catálogo. Já vendeu R$ 12.902,65 em 30 itens, com margem de 50,5%.
    - O preço vem da calculadora 3D e está correto. Falta a referência de catálogo e o custo_previsto, que está zerado nos 30 itens.

13. Catálogo, itens menores.
    - Certificado A4 vergê tem custo 0 e mostra 100%. Medir o custo da tinta.
    - 27 de 58 produtos ativos não têm ficha de material. Brindes têm custo digitado.
    - 15 de 20 produtos em m² não têm área mínima cobrada. Pode ser intencional.
    - Margem de fornecedor usa markup no catálogo e margem sobre a venda no resto. Quem digita 40% obtém 28,6%.
    - 13 OS concluídas sem receita e sem custo poluem as médias. Marcar como teste ou interna.
    - 4 itens de orçamentos enviados sem custo, entre eles 105 e 107, serão barrados na conversão.

## 3. Hipóteses não provadas

1. Causa do custo de R$ 200 no orçamento 69. Pode ter sido digitado à mão ou copiado. O valor 200 não bate com a conta.
2. Causa da divergência de custo_estimado em 50 orçamentos. Fórmulas, itens criados fora da tela ou taxa. Não foi isolada. Também não provei as 8 OS com custo previsto diferente, R$ 650,76.
3. Causa dos 23 itens sem custo. Não confirmada item a item. Um item aprovado tem custo de fórmula maior que zero e custo_unitario zero.
4. R$ 2.252 a R$ 2.295 de custo superestimado em 15 a 17 itens. Parecem custos digitados acima do cadastro, como acrílico colorido a R$ 400 contra R$ 190,55 do cristal. Não provado.
5. Quantidade menor que 1. O preço usa pelo menos 1 e o custo usa a quantidade real. Hoje há 0 itens nessa condição.
6. Taxa de prazo no desconto_avaliar. Hoje há 0 orçamentos afetados.
7. Quadro Acrílico e Acrílico Espelhado com preços e custos diferentes. Pode ser decisão comercial. O que não fecha é o espelhado ter custo 400 sem origem cadastrada.
8. Preço de revenda do parceiro abaixo do custo dele. É interpretação, não foi testada.
9. Efeito em reais da área em 3 casas no piso de desconto. Depende do custo por produto. Não quantifiquei.
10. Colunas preco_publico, preco_sugerido e preco_minimo nulas nos 58 ativos. Parecem mortas, porque o sistema usa preco_base.
11. Comissão de 10%. Não medi o valor em reais.
12. Números com divergência de contagem entre auditor e verificador, sem mudar a conclusão. Itens sem custo, 20 contra 23. Itens com área divergente, 15 contra 27. Soma de custo omitido de R$ 1,0 mil contra R$ 1,8 mil conforme o filtro.

## 4. O que foi coberto e o que não foi

Coberto, só com leitura.
- Funções vivas de preço, custo, totais, desconto e conversão. Lista de gatilhos e constraints.
- Recálculo de todos os 156 itens e 124 orçamentos contra os totais gravados. Resultado: 0 divergência nos 30 mais recentes, subtotal igual à soma dos itens em 100%, total igual a subtotal menos desconto menos crédito em 100%.
- Cruzamento orçamento com OS em valor e custo. Itens da OS contra itens do orçamento, 46 contra 46.
- Contas a receber contra OS. 35 contas somam R$ 11.639,75, igual à soma das OS.
- Catálogo, 70 produtos e 58 ativos. Faixas, níveis de parceiro, produto_precificacao, custo cheio, materiais.
- Descontos fora de alçada. Os 6 orçamentos com desconto estão dentro da alçada ou aprovados.
- Versões, itens órfãos, enviado ou aprovado sem item, valor aprovado contra valor atual. Sem problema.
- Preço especial de cliente. A tabela está vazia.

Não coberto.
- composicao-do-preco.ts, cost-engine.ts, desconto.ts e faixas.ts linha a linha.
- PDF e hash da versão congelada. Não testei o aviso falso.
- Preço por programa de parceiro e fluxo do portal do parceiro.
- Custo 3D e orcamento_3d_calculos.
- Margem de fornecedor_regras_venda, valores gravados.
- Aproveitamento de chapa e bobina. Hora de máquina por máquina.
- Tabela de preço por marcador em observacoes_internas.
- RLS.
- Código de edição de itens na tela, só as funções SQL e orcamento-publico.functions.ts.
- Taxa de cartão e impostos fora do desconto_avaliar. As estimativas são cálculo sobre os parâmetros, não medição de caixa.
- Escopo exato do custo em desconto_situacao_interna, que não auditei linha a linha.
- O corpo atual de orcamento_aplicar_preco. Li só a versão de 22/10.
- Validade padrão de 15 dias assumida quando validade_dias é nulo.
