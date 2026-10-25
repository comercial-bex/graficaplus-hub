# Análise: Printi e 360imprimir, e o que trazer para o orçamento da Bex

Data: 24/10/2026. Páginas olhadas no navegador: o adesivo redondo da Printi e o banner da 360imprimir (mais a vitrine inicial da 360imprimir). Só leitura: nada foi comprado, nenhum formulário foi enviado.

O que se traz é o **jeito de navegar**, não o conteúdo. Textos, fotos, marca, promoções e a garantia de preço são deles e ficam fora.

## 1. O que as duas lojas fazem

### Printi, adesivo redondo

| Parte da página | Como funciona |
|---|---|
| Topo | Preço "a partir de" com o preço por unidade ao lado |
| "Seu projeto começa aqui" | **Três pacotes prontos** (Econômica, Recomendada, Linha Especial) mais "Crie do seu jeito". Cada pacote mostra quantidade, total e preço por unidade |
| Configuração | Seções na ordem: **formato e tamanho**, **cores**, **material**, **acabamento**, **extras**, **como vem entregue**, **quantidade**. Cada seção tem **uma frase** explicando a escolha. Mostra 3 opções e um "Ver mais opções" |
| Tamanho | Medidas prontas em botões, e "Personalizar" com mínimo e máximo. A regra do formato aparece escrita ("altura igual à largura") |
| Quantidade | **Tabela de degraus**: quantidade, total, preço por unidade e **% de desconto**. Quanto maior, menor a unidade. Dá para digitar outra quantidade |
| Incompatibilidades | Avisos escritos no texto da página (por exemplo, certa laminação não serve para certo material) |
| Resumo | Quantidade, preço por unidade, total, **"Simular prazo de entrega"** e **Comprar** |
| Arte | **Não pede a arte antes de comprar.** Diz que o envio é na próxima página ou depois do pedido, e oferece um serviço de designer. Os **gabaritos** só são liberados depois de configurar |
| Abaixo | Especificações, descrição e perguntas frequentes |

### 360imprimir, banner

| Parte da página | Como funciona |
|---|---|
| Topo | Quatro abas de **nível**: Promoção, Econômico, Premium, Personalizar |
| Tamanho | Lista de **8 medidas prontas** (500×900 mm até 1000×3000 mm) e "Mostrar mais" |
| Material | 3 opções: lona brilho 280 g, lona fosca 280 g, tecido poliéster |
| Impressão | "Só frente" ou "Outros" |
| Acabamento | "Bastão e cordão" ou "bastão, cordão e ventosa" |
| Quantidade | Tabela: quantidade, **preço unitário**, **total**, com "Mostrar mais" |
| Barra fixa no rodapé | **Sempre à vista**: nome do produto, quantidade, "Resumo", preço (com o antigo riscado quando há promoção) e o botão **Iniciar compra** |
| Vitrine inicial | Cartões de categoria e um caminho "Use sua arte" ou "Use os nossos modelos" |

### O que as duas têm em comum

1. **Uma pergunta por seção, sempre na mesma ordem.** O produto muda; a ordem não.
2. **Opções prontas antes das livres.** Pacotes, níveis e medidas em botões vêm primeiro; o campo livre fica atrás de "Personalizar".
3. **Poucas opções à vista**, o resto atrás de "ver mais".
4. **Tabela de quantidade com preço por unidade** e desconto visível.
5. **Resumo e preço sempre à vista**, no fim da tela ou numa barra fixa.
6. **A arte vem depois da configuração.** Ninguém precisa do arquivo para saber o preço.
7. **Prazo e entrega estimados antes de fechar.**

## 2. O que a Bex já tem para isso

| Padrão | O que existe hoje | Falta |
|---|---|---|
| Medidas prontas em botões | `produto_tamanhos`: **42 tamanhos** cadastrados. No item do parceiro já aparecem como **pílulas pequenas, abaixo dos campos de medida** | Dar destaque: botões maiores **antes** dos campos, com "Personalizar" para o livre. Não conferi a tela da equipe |
| Tabela de degraus de quantidade | `produto_faixas_preco`: **33 faixas** e o preço por faixa já entra na conta do parceiro | Mostrar a **tabela** com o preço por unidade e o desconto de cada degrau, em vez de só aplicar a faixa |
| Resumo sempre à vista | Parceiro: coluna fixa à direita no computador | No celular o resumo fica **embaixo de tudo**. Falta uma barra fixa com o total |
| Passos | Calculadora de custo já tem. **Orçamento do parceiro agora tem** (este PR) | Equipe e loja |
| Pacotes (econômico, recomendado, premium) | Nada | Depende das opções por produto (fase 3 do plano) |
| Opções (material, acabamento) | Produtos separados e serviços soltos | Modelo de opções por produto (fase 3) |
| Prazo e expresso | Nada | Fase 2 do plano |
| Arte depois do preço | O orçamento da equipe tem anexo por item; o do parceiro não | Fase 4 do plano |
| Incompatibilidades | `exigencias` em texto livre | Regra estruturada (fase 3) |

## 3. O que trazer, em ordem

| # | O quê | Onde mexe | Esforço | Situação |
|---|---|---|---|---|
| 1 | Orçamento do parceiro **em passos** (cliente, itens, condições, revisão) | Só tela | M | **Feito neste PR** |
| 2 | **Barra fixa de resumo no celular**: total e "Avançar" sempre à vista | Só tela | P | **Feito** (PR da fase seguinte) |
| 3 | **Tamanhos em destaque** no item: botões maiores antes dos campos de medida (os 42 já cadastrados), com "Personalizar" para o livre | Só tela | P | **Feito** |
| 4 | **Tabela de degraus de quantidade** no item: quantidade, preço por unidade, desconto, com clique para aplicar | Só tela (as 33 faixas já existem) | M | **Feito** |
| 5 | **Prazo e expresso** como passo de fechamento, com taxa em % | Migração e função de preço | M | Plano, fase 2 |
| 6 | **Opções por produto** (material e acabamento) e **pacotes** | Migração e cadastro | G | Plano, fase 3 |
| 7 | **Anexo da arte depois do preço** e gabarito por produto | Tabela de anexos do parceiro | M | Plano, fase 4 |
| 8 | **Estado de material** para o parceiro | Função do banco | M | Plano, fase 5 |

Os itens 2, 3 e 4 não precisam de banco e dão a sensação de loja mais depressa: botões de medida, tabela de quantidade e preço sempre à vista.

## 4. O que NÃO trazer

- **Promoções, selo de "preço mais baixo" e preço riscado.** São da estratégia comercial deles.
- **Texto de SEO e descrições longas.** A Bex mostra o que o parceiro precisa decidir, não vende o produto para ele.
- **Checkout com cartão.** O parceiro faz **pedido** à gráfica, com crédito ou fatura; não compra.
- **Preço único.** Na Bex há o **preço de custo** do parceiro e o **preço de venda** dele, e os dois nunca se misturam. As lojas deles só têm um preço.
- **Fotos e marca.** Nada copiado; as telas da Bex usam as fotos dos próprios produtos.

## 5. Diferenças que mudam o desenho

- A Bex vende **por medida** (m²) e por **quantidade** ao mesmo tempo; Printi e 360imprimir vendem por quantidade com medida pronta. A tabela de degraus precisa funcionar nas duas bases.
- O parceiro **escolhe o preço de venda**. A barra fixa mostra "cliente paga", "você paga" e "seu ganho", não só um total.
- A Bex confirma o preço **no banco**, não na tela. Qualquer coisa que a tela mostre (degraus, expresso) é estimativa até o pedido.
