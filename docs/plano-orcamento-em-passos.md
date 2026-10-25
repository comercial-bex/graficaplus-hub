# Plano: orçamento em passos, como uma pequena loja

Data: 24/10/2026. Estado: **proposta, nada implementado**. Só `SELECT` no banco e leitura do código.

Pedido do dono, em resumo:

1. O orçamento tem a **mesma linguagem em todas as telas**: a da equipe, a do parceiro e a loja do cliente.
2. O orçamento é feito **em passos**: cliente, produtos, opções e acabamento, fechamento.
3. O **parceiro vê se há material**, mas **pode orçar e pedir mesmo sem material**. A equipe, não: precisa do material para fechar.
4. O **expresso** é uma taxa, em porcentagem sobre o produto.
5. Entrega ou retirada, forma de pagamento, anexo da imagem do produto, tudo simples e bonito, como uma pequena loja.

## Atualização de 25/10/2026

- **Passos do parceiro, degraus de quantidade, tamanhos em botões e resumo fixo no celular:** feitos (PRs #194 e #195).
- **Expresso, decisão do dono:** é **taxa em porcentagem sobre o valor dos produtos**, nunca valor fixo, porque o mesmo valor em reais pesa diferente num produto de R$ 50 e num de R$ 100. Para começar vale **12%** (provisório, "depois a gente vê"). A porcentagem fica na tabela `prazos_de_entrega`, e mudar o número não exige migração.
- **Feito no pedido do parceiro:** o parceiro escolhe Normal ou Expresso no passo "Condições"; o banco soma ao pedido uma linha "Taxa de expresso (12% sobre os produtos)" calculada sobre os produtos já recalculados pela tabela de parceiro. A taxa é o que o parceiro paga à gráfica; o preço de venda ao cliente dele continua sendo dele.
- **Tela da equipe em passos** (cliente, itens, condições, revisão; mesma barra, resumo lateral e barra fixa no celular): feita no PR seguinte. A revisão leva PDF, via de produção, link, WhatsApp e a conversão em OS.
- **Falta:** o mesmo prazo na tela da equipe, entrega ou retirada, forma de pagamento obrigatória, opções por produto, anexo da arte e estado de material.

## 1. Como está hoje (24/10/2026)

| Tela | O que existe | O que falta |
|---|---|---|
| Equipe (`/orcamentos/$id`, 1.956 linhas) | Cartões separados: escolha de produto, medidas, acabamento, desconto, acordo (pagamento, prazo, entrega), aviso de material | Sem abas nem passos: tudo numa página (a escolha do item, o acordo e o desconto aparecem em pontos diferentes dela) |
| Parceiro (`editor-de-orcamento.tsx`, 910 linhas) | Três blocos: "Cliente e orçamento", "Itens", "Resumo". Preço de custo pela tabela de parceiro; preço de venda é do parceiro | Sem passos. Sem entrega, pagamento, prazo, expresso. **Sem aviso de material.** Item sem anexo de imagem |
| Loja do cliente (`/catalogo/$token`, carrinho, cotação) | Carrinho no aparelho, opção por item, gera orçamento ou pede cotação pelo WhatsApp | Não compartilha o fluxo de opções e fechamento com as outras duas |
| Calculadora de custo | **Já tem 4 passos** (`BarraDePassos`, `passos-da-calculadora.ts`) com a barra, o resumo por passo e o botão "Avançar: …" | É interna, do financeiro. Serve de molde, não de tela do cliente |

Números do banco, que mostram onde o fluxo falha:

- **Pagamento:** 60 dos 64 orçamentos estão com `{"parcelas": 1}` e **sem forma de pagamento**. Ninguém escolhe; fica o padrão.
- **Entrega:** só 1 de 64 marcou `precisa_entrega`. **Prazo prometido:** só 7 de 64.
- **Acabamento:** só 2 itens têm acabamento escrito ("refile", "recorte no contorno"), e é texto livre.
- **Parceiros:** 8 cadastrados e **1 orçamento** de parceiro. O fluxo do parceiro quase não foi usado, então é o melhor lugar para mudar sem risco.
- **Expresso:** não existe em lugar nenhum do sistema (busca no código e nas migrações).

### Produtos e opções

45 produtos ativos. As opções que o dono descreveu ("qual banner, qual gramatura, com ilhós ou com bastão") **não são dados estruturados**:

- A gramatura é **outro produto**: "Lona 280g impressa" e "Lona 440g reforçada impressa" são dois cadastros.
- O acabamento existe como **serviço cadastrado** ("Acabamento de lona (bainha + ilhós)", "Laminação de adesivo"), mas nada liga o serviço ao produto que o aceita.
- "Banner com bastão e corda" é um produto à parte. O bastão e a corda vão no consumo por peça da ficha (`produto_materiais.por_peca`).
- O que o produto **exige** é texto (`exigencias`), por exemplo "Lote mínimo de 300 unidades" ou o limite de 0,5 m² de adesivo no carro.

Resultado: hoje o vendedor precisa **saber** que lona 440g com ilhós são dois itens. A loja não pergunta.

### Material e estoque

- A equipe tem o aviso `OrcamentoMaterialCheck`: mostra quanto o item consome e quanto há. É só aviso, não bloqueia.
- O parceiro **não vê nada de material**. Se vir o estoque cru, vê também quantidades que não são dele.
- A baixa de bobina real depende da importação do Flexi (planos anteriores). Hoje o saldo do sistema não é confiável: há 1 baixa por OS desde 21/09.

## 2. Os passos propostos

Mesmos passos nas três telas, com **a barra de passos** que a calculadora já usa (resumo de cada passo, subtotal, botão "Avançar: Produtos").

| Passo | Pergunta | O que tem |
|---|---|---|
| 1. Cliente | Para quem é? | Cliente já cadastrado (busca) ou cadastro rápido (nome e telefone). Parceiro: nome do cliente dele |
| 2. Produtos | O que vai ser feito? | Cartões com foto, nome e "a partir de R$". Escolher, medida, quantidade, **anexar a imagem/arte** do item. Aviso de exigência do produto ("lote mínimo 300") |
| 3. Opções | Como vai ser? | Por produto: **tipo** (ex. banner), **material/gramatura**, **acabamento** (ilhós, bastão e corda, bainha, laminação). Só aparecem as perguntas que o produto tem |
| 4. Fechamento | Prazo, entrega e pagamento | **Prazo** (normal ou expresso, com a taxa), **retirada ou entrega**, **forma de pagamento**, desconto (equipe) |
| 5. Revisão | Está certo? | Resumo por item, total, disponibilidade, botão **Enviar** (equipe) ou **Pedir à gráfica** (parceiro) |

Regras que valem em todas as telas:

- **O preço de custo e o preço de venda do parceiro nunca se misturam.** O preço de venda é dele e nunca chega à gráfica (já é regra do código em `domain/parceiros/preco.ts`).
- **Quem recalcula o preço é o banco**, não a tela. A tela só antecipa. A taxa do expresso entra na mesma função do banco; se só a tela somar, o valor do pedido diverge.
- Cada passo guarda o que foi digitado ao voltar. Passo incompleto aparece marcado, sem bloquear a navegação.

## 3. Dados novos

Nomes provisórios. Cada item é uma migração própria, com o ensaio em `BEGIN … ROLLBACK` como nas fases do Flexi.

**a) Opções por produto.** Duas tabelas:
- `produto_opcao_grupos` (produto, nome do grupo como "Acabamento" ou "Gramatura", obrigatório, escolha única ou várias).
- `produto_opcoes` (grupo, nome, e a **ligação**: outro produto/serviço, por exemplo o "Acabamento de lona (bainha + ilhós)", ou um material; mais o efeito no preço: soma fixa, por m² ou por peça).
Assim a gramatura continua sendo o produto que já existe, e o acabamento continua sendo o serviço que já existe. A tela passa a **oferecer** o que hoje o vendedor lembra.

**b) Prazo e expresso.** Tabela `prazos_de_entrega` (nome, dias, taxa em %, em que base incide). O orçamento guarda o prazo escolhido e a taxa **congelada** no momento (o dono muda a taxa depois e o orçamento antigo não muda).

**c) Entrega.** Aproveita `precisa_entrega` e `endereco_entrega`. A taxa de entrega usa o serviço "Deslocamento" que já está cadastrado.

**d) Pagamento.** Aproveita `condicao_pagamento` (forma, parcelas, intervalo, primeiro vencimento). O passo 4 passa a **exigir a forma**, para sair dos 60 "parcelas: 1" sem forma.

**e) Anexo do item.** O orçamento da equipe já tem `orcamento_item_arquivos`. O do parceiro (`parceiro_orcamento_itens`) não tem. Precisa de uma tabela equivalente e de uma pasta de arquivos própria do parceiro.

## 4. Material para o parceiro

O parceiro vê **um estado por item**, nunca o saldo:

| Estado | Quando | O que o parceiro pode |
|---|---|---|
| Disponível | todos os materiais da ficha têm saldo para o item | Pedir normalmente |
| Parcial | falta parte do material, ou só a reposição cobre | Pedir, com aviso "prazo depende da reposição" |
| Sem material | nenhum material | **Pedir mesmo assim.** O pedido entra como "aguardando material", visível para a equipe |

Pontos de segurança:
- O estado sai de uma função do banco que **devolve só o estado** (e, se o dono quiser, uma previsão em dias). O parceiro não lê `materiais` nem `produto_materiais`.
- O saldo do sistema hoje é pouco confiável (ver seção 1). **Mostrar "Disponível" com saldo errado promete o que não existe.** Antes de ligar isso para o parceiro, é preciso que a baixa por impressão (plano do Flexi, fase 3) esteja funcionando, ou o estado precisa de uma revisão manual.
- A **equipe** continua com o aviso de hoje e a regra de hoje: precisa do material para fechar.

## 5. Expresso

Um pedido de taxa **em porcentagem sobre o valor dos produtos**. Como o dono descreveu: a taxa é um percentual do produto, ou um valor que se chega a partir dele.

Proposta: tabela de prazos com a taxa em %. Exemplo, a definir: Normal 0%, Expresso 48 h +X%, Urgente 24 h +Y%. A taxa incide **sobre a soma dos produtos**, sem entrega nem desconto (a definir). O expresso **limita o prazo prometido**: o passo 4 não deixa escolher uma data anterior ao prazo daquele nível.

## 6. Entrega em fases

| Fase | O que entra | Esforço | Como saber que deu certo |
|---|---|---|---|
| 1 | **Esqueleto de passos** (barra, navegação, resumo por passo, validação de "pode avançar") em um componente único. Primeiro no **parceiro**, que é novo e pouco usado | M | O orçamento do parceiro sai em 5 passos. As contas de preço não mudam: os testes atuais de `domain/parceiros/preco.ts` continuam passando |
| 2 | Passo 4 completo: pagamento obrigatório, entrega ou retirada, **prazo com expresso** (migração + função de preço) | M | Um orçamento de teste com expresso tem a mesma taxa no cálculo da tela e no total que o banco grava |
| 3 | **Opções por produto** (migração e cadastro). Começar por banner e lona e por adesivo | M | Banner pergunta lona 280 ou 440 e acabamento. Cada escolha entra como linha do orçamento com o preço certo |
| 4 | **Anexo de imagem** por item (parceiro e equipe) | P | O parceiro anexa a arte e a equipe a vê no pedido |
| 5 | **Material para o parceiro** (função do banco que devolve o estado) | M, depende do estoque estar correto | O parceiro vê o estado sem nunca ver o saldo; o pedido "sem material" entra aguardando |
| 6 | Mesmos passos na **tela da equipe** | G (1.956 linhas) | Orçamento da equipe em 5 passos, sem perder desconto, acordo e aviso de material |
| 7 | **Loja do cliente** usando os mesmos passos e opções | M | O carrinho vira o passo 2 e fecha no passo 4 |

Por que começar pelo parceiro: é a tela com menos uso (1 orçamento), a mais curta e a que mais ganha com material e com o fechamento. Mexer na tela da equipe, que sustenta 64 orçamentos e a venda de hoje, fica para depois de o fluxo estar provado.

## 7. Riscos

- **Preço duplicado.** Se a tela e o banco somarem a taxa de expresso de jeitos diferentes, o total do pedido diverge. Mitigação: a taxa mora na função do banco e a tela só a mostra; teste que compara os dois.
- **Estado de material errado.** O saldo hoje é incompleto. Mitigação: só ligar a fase 5 depois da baixa por impressão, ou mostrar o estado como "a confirmar".
- **Opções no lugar de produtos.** Transformar "lona 440g" de produto em opção pode quebrar preço, estoque e relatórios que usam o produto. Mitigação: a opção **aponta** para o produto que já existe, sem substituí-lo.
- **Tela da equipe é grande.** Mitigação: só na fase 6, com o esqueleto já provado.
- **Anexo do parceiro** guarda arquivo de cliente final. Mitigação: pasta e permissão próprias, só o dono do orçamento e a equipe leem.

## 8. Perguntas para o dono

1. A taxa do **expresso** é um percentual único ou por nível (24 h, 48 h)? Incide só nos produtos, ou também em instalação e entrega?
2. O parceiro **escolhe o nível do expresso** e repassa ao cliente dele, ou a taxa só existe entre a gráfica e o parceiro?
3. Pedido do parceiro **sem material**: a equipe pode recusar, ou é sempre aceito e fica "aguardando material"? Há um prazo-limite?
4. Começamos pelo **parceiro** (recomendado) ou pela tela da equipe?
5. A **loja do cliente** entra neste ciclo ou depois?
6. **Pagamento do parceiro:** o pedido dele já é pago com crédito, fatura ou a prazo? O passo 4 do parceiro muda conforme a resposta.
7. Quais produtos têm **opções** para cadastrar primeiro? Proposta: banner e lona (gramatura e acabamento), adesivo (laminação e recorte), acrílico (espessura).
