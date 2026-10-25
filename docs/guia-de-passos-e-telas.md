# Guia de passos e de telas

Data: 25/10/2026. Para quem vai fazer uma tela nova ou mexer numa existente no Bex Print.

O objetivo é o mesmo em todo o sistema: **menos tempo para fazer a tarefa e menos dúvida sobre o que fazer a seguir**. Isto vale para o balcão, para o parceiro e para quem cadastra.

Como foi feita a análise: li o que as sessões entregaram (PRs #187 a #214), medi cada tela do código (linhas, cartões, abas, campos, consultas) e comparei com o jeito das lojas de gráfica (Printi, 360imprimir). Não vi as telas funcionando com login, então a parte de densidade é leitura de código, não de uso. O que depende de uso real está marcado como "a medir".

## 1. O padrão

Uma tarefa que tem mais de uns 5 campos, ou escolhas que dependem umas das outras, vira **passos**:

1. **Uma pergunta por tela**, na linguagem de quem trabalha ("Qual é o tipo?", não "Variante").
2. **A resposta é um cartão** com ícone ou desenho, não um campo de texto. Texto livre só quando não há lista (nome, marca).
3. **Escolher avança sozinho** nos passos de um clique só. Passos com vários campos têm "Avançar".
4. **O que já foi escolhido fica à vista**: o passo de revisão resume tudo e dá para voltar a qualquer passo anterior.
5. **O sistema sugere, a pessoa decide**: nome, código, custo e preço vêm preenchidos pela escolha, e continuam editáveis.
6. **Nada é gravado antes do fim.** Se a gravação falhar no meio (o produto entrou e a ficha do material não), a tela diz o que ficou de fora.
7. **Sempre há saída**: "Cadastro completo" para quem quer o formulário inteiro, e "Voltar" em todo passo.
8. **Pendência vira frase.** Se não dá para avançar, a tela diz por quê, em uma linha.
9. **Passo que não se aplica não existe** (produto sem material pula o passo de material).

### Peças prontas

| Peça | Onde | Para quê |
|---|---|---|
| `Stepper` | `src/components/ui/stepper.tsx` | Barra de passos, com teclado e leitor de tela |
| `CartaoDeEscolha`, `GradeDeCartoes` | `src/components/orcamento/cartao-de-escolha.tsx` | A resposta em cartão: escolhido em verde, 2 colunas no celular, até 4 no computador |
| `PreviaDaPeca` | idem | Desenho na proporção da medida |
| `EscolhaDeMaterial` | `src/components/orcamento/escolha-de-material.tsx` | Variações do mesmo produto (lona 280 g ou 440 g) |
| `CobrancaDoAcabamento` | `src/components/orcamento/cobranca-do-acabamento.tsx` | Acabamento cobrado à parte, com os lados da bainha e o valor de cada um |
| `NovoProdutoEmPassos` | `src/components/produtos/novo-produto-em-passos.tsx` | Exemplo completo de assistente de seis passos |
| `PendenciasDoMeuPapel` | `src/components/painel/PendenciasDoMeuPapel.tsx` | O que falta de cada papel, com o caminho passo a passo |

### Receita para um assistente novo

1. **Escreva a regra sem tela**, em `src/domain/<area>/<nome>-em-passos.ts`: a lista de passos com a pergunta de cada um, quais passos cada caso percorre, a sugestão de cada valor, a pendência de cada passo e a função que transforma as respostas no registro. É testável sem navegador. O exemplo é `src/domain/catalogo/novo-produto-em-passos.ts`.
2. **Escreva a tela** só com cartões e campos, chamando a regra. Tamanho mínimo de toque: 44 px (os cartões já têm).
3. **Leia custo e preço pela view do nível de quem olha** (`fromFinancialView`). A tabela crua recusa a consulta inteira para quem não vê dinheiro. O teste `custo-de-material-pela-view` pega isto.
4. **Confirme a gravação no banco**, não só a ausência de erro: peça as linhas de volta (`.select()`), porque permissão negada pode não dar erro.
5. **Dois testes no mínimo**: a regra (sugestões, pendências, registro final) e o contrato da tela (o botão que abre, a gravação, a mensagem de falha parcial).
6. **Se a tela depende de um cadastro vazio, avise no painel** (ver o capítulo 5): crie a pendência em `pendencias_de_preenchimento()` e o guia dela em `pendenciasGuia.ts`.

### O que não fazer

- Passo só para contar passo. Se duas perguntas cabem na mesma tela sem esforço, é uma tela.
- Opção que muda o custo e não muda o preço (por exemplo "frente e verso" sem acréscimo): faz orçar abaixo do custo. A opção entra quando o preço dela existe.
- Preencher custo ou preço por palpite sem marcar. Quando for preciso, grave como **provisório** (observação interna no produto) e o painel passa a cobrar o número real.
- Texto "Carregando…" solto: use `<Carregando />`.

## 2. O que já está em passos

| Tarefa | Situação |
|---|---|
| Calculadora de custo do orçamento | 4 passos (já existia) |
| Orçamento do parceiro | 4 passos: cliente, itens, condições, revisão |
| Orçamento da equipe | passos, com prazo normal ou expresso |
| Item do orçamento | tamanhos, material e acabamento em cartões; tabela de degraus de quantidade; bainha com os lados e o valor de cada um |
| Prazo de produção | cartões Normal e Expresso, com a taxa em % |
| **Novo produto** | **6 passos**: tipo, variação, material do estoque, máquina e cobrança, preço, revisão |
| **Novo material (insumo)** | **6 passos**: tipo, material, marca, medida da embalagem, compra e estoque cheio (aviso a 15%), revisão |
| O que falta de cada papel | pendências com passo a passo e botão para o destino |

## 3. Análise por módulo

Medido no código de cada tela (25/10/2026). "Campos" são `Input`, `Select` e `Textarea`. A coluna da recomendação diz qual padrão serve melhor:

- **Assistente**: tarefa de criar ou configurar, com escolhas encadeadas.
- **Abas e seções**: tela de trabalho com muita informação do mesmo registro.
- **Painel de leitura**: tela que se olha, não se preenche.

| Tela | Linhas | Cartões | Abas | Campos | Consultas | Recomendação |
|---|---:|---:|---:|---:|---:|---|
| Orçamento (detalhe) | 2.353 | 4 | 0 | 7 | 11 | Já em passos. Falta o **resumo fixo** (total, prazo, pendências) sempre à vista e recolher os blocos que o passo atual não usa |
| Produtos | 1.452 | 8 | 1 | 19 | 8 | **Assistente feito** (novo produto). Edição segue em abas |
| OS (detalhe) | 1.373 | 7 | 6 | 15 | 16 | Abas e seções. Falta um cartão "próximo passo" no topo (o que falta para a OS andar) |
| Orçamento 3D (novo) | 1.188 | 5 | 0 | 17 | 5 | **Assistente**: peça, material, impressora, custo, revisão. Só 1 botão para 17 campos hoje |
| Precificação | 1.124 | 9 | 0 | 10 | 8 | Painel de leitura com simulador: os 3 números que mandam no topo (custo, preço, margem) |
| Relatórios | 1.040 | 12 | 0 | 2 | 2 | Painel de leitura: período em cartões e 3 números no topo, o resto recolhido |
| Compromissos | 1.012 | 5 | 0 | 7 | 7 | Abas e seções |
| Painel (dashboard) | 953 | 1 | 0 | 0 | 7 | Painel de leitura: pendências primeiro (já é), depois 3 números |
| Quadro de produção | 932 | 0 | 0 | 5 | 6 | Painel de trabalho: o cartão da OS deve mostrar prazo, material e próximo passo |
| Cliente (detalhe) | 927 | 6 | 6 | 16 | 11 | Abas e seções |
| Materiais | 874 | 0 | 0 | 13 | 6 | **Assistente de insumo novo feito** (cadastro completo segue num botão) |
| Capacidade | 789 | 8 | 0 | 0 | 4 | Painel de leitura |
| Meta | 782 | 5 | 0 | 0 | 3 | Painel de leitura |
| Usuários | 756 | 1 | 2 | 11 | 4 | **Assistente**: o papel em cartões (administrador, gestor, vendedor, operador…) e o que cada um vê |
| Fluxo de caixa, A receber | 695 / 623 | 3 / 5 | 2 / 0 | 10 / 4 | 6 / 3 | Painel de leitura, com a baixa em um clique |
| Clientes (lista e cadastro) | 608 | 0 | 0 | 15 | 5 | **Assistente**: pessoa física ou jurídica, documento (com a consulta de CNPJ, onde ela já existe), contato, condições |
| Máquinas | 618 | 2 | 0 | 1 | 5 | **Assistente**: tipo de máquina, velocidade, consumo, custo por hora |
| Leads | 557 | 3 | 0 | 11 | 3 | Funil em cartões; cadastro em 2 passos |
| Tabela de preços | 555 | 1 | 0 | 2 | 8 | Painel de leitura (já marca custo provisório) |
| Importar do Flexi | 543 | 3 | 0 | 3 | 4 | **Assistente**: arquivo, conferência, vínculo com o orçamento ou a OS |

### Assistentes que valem a pena, por ordem de ganho esperado

O ganho é a quantidade de campos do cadastro vezes a frequência. A frequência real está **a medir** (o sistema ainda não registra quanto cada tela é usada); a ordem abaixo usa só o tamanho do cadastro.

1. **Cliente novo** (15 campos). Tipo (pessoa física ou jurídica) → documento → contato → condições de pagamento → revisão.
2. ~~Insumo novo~~ **feito** (25/10/2026): tipo → material → marca → medida da embalagem → o que pagou e o **estoque cheio, com o mínimo a 15%** → revisão.
3. **Orçamento 3D** (17 campos). Peça → material → impressora → custo e preço → revisão.
4. **Máquina nova**. Tipo → velocidade → consumo (kW) → custo por hora.
5. **Usuário novo**. Papel em cartões, com o que cada papel enxerga.

## 4. Informação na tela: o que precisa estar à vista

Regra única: **o que decide a próxima ação fica visível sem rolar; o resto fica a um clique.**

| Tipo de tela | À vista sempre | A um clique |
|---|---|---|
| Orçamento | total e prazo, pendências do orçamento, o passo atual | histórico, observações internas, anexos |
| OS | status, prazo, o que falta para andar, material previsto | atividades, custos, anexos |
| Produto | nome, código, custo, preço, margem, sinal de provisório | ficha de materiais, acabamentos, fotos |
| Painel de cada papel | pendências do papel (some quando vazio) e 3 números | gráficos e listas longas |
| Quadro de produção | prazo, material faltando, máquina | detalhes da OS |
| Lista (clientes, OS, orçamentos) | busca, 2 filtros que mais se usam, ordenação por prazo | filtros avançados |

Para telas de leitura, cortar linhas antes de cortar números: um número com a comparação (mês anterior, meta) vale mais que dois gráficos.

## 5. Pendências de preenchimento: o painel cobra o que falta

Quando um cadastro está provisório ou vazio, o painel "O que falta de mim" mostra uma pendência para **financeiro, gestor e administrador**, todo dia, até alguém preencher. Hoje cobram:

- produtos com **custo e preço de balcão provisórios**;
- produtos ativos **sem custo**;
- produtos ativos **sem nenhum preço de venda**;
- **acabamentos sem preço de venda**;
- **rolos sem estoque cheio** (sem ele não há aviso de compra a 15%).

Para acrescentar uma: uma linha em `pendencias_de_preenchimento()` (banco), o guia em `GUIA_PENDENCIAS` (passos que usam as palavras do menu, que o teste confere) e, se o gestor também deve ver, a chave em `VISIVEL_TAMBEM_PARA`.

## 6. O que depende do dono

- **Custo real e preço de balcão dos sete produtos** ativados com valores provisórios (Adesivo PROMO, perfurado promocional, transparente, fosco, blackout, lona fosca e backlight).
- **Acréscimo de frente e verso** (e de ventosa no banner), para entrarem como opção com preço.
- **Estoque cheio de cada rolo**, para o aviso de compra a 15%.
- **Preço de venda** do recorte eletrônico, do laser e do acabamento manual.
- **Convenção da bainha**: o sistema sugere o contorno todo (lona) e os dois lados menores (banner); a equipe muda no cartão. Se a regra da casa for outra, é uma linha em `ladosSugeridos`.
- **Margens abaixo do mínimo cadastrado** com a tabela de terceirizados (adesivo TOP, lona PROMO, recorte acima de 6 m²): a tabela foi mantida como está.
