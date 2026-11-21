# Cálculo dos itens da OS: acrílico, adesivo e lona (21/11/2026)

Migração: `supabase/migrations/20261121130000_item_da_os_nasce_com_custo.sql`.

## O que o dono viu

Ao criar uma OS e incluir itens, o acrílico de 2 mm "dava um preço" que não batia com o metro quadrado que a gráfica
pratica (média de R$ 1.000/m²). Pedido: achar onde o m² não bate, olhar adesivo e lona, e conferir se o custeio está
sendo puxado.

## O que a investigação achou

### 1. A aba "Itens" da OS tratava o preço do m² como preço da peça (defeito de código, corrigido)

`src/components/os/itens-da-os.tsx` copiava `preco_base` e `custo_medio` do produto direto na linha
(`valor_unitario`, `custo_unitario`) e gravava `valor_total = quantidade × valor_unitario`. Em produto vendido por m²
os dois valores são **por m²**, e a aba não pedia largura nem altura:

| Item | Antes (aba Itens) | Agora |
| --- | --- | --- |
| 1 peça de acrílico 2 mm de 0,30 × 0,20 m | R$ 1.000,00 (o m² inteiro), custo R$ 151,13 | **R$ 100,00** (mínimo de 0,10 m² a R$ 1.000), custo R$ 15,11 |
| 3 peças de 0,50 × 0,40 m | R$ 3.000,00 | **R$ 600,00** (R$ 200,00 cada) |
| 120 adesivos de 5 × 5 cm (adesivo vinil branco, R$ 69,90/m²) | R$ 8.388,00 | **R$ 20,97** |

O total da OS é a soma dos itens (`tg_os_soma_os_itens`), então o erro ia para o total, para a cobrança e para a margem.
O orçamento corrigiu a mesma coisa em 20/10/2026 (`custoDaPecaPorArea`); a OS ficou com a conta antiga.

**Agora:** produto por m² pede largura, altura, peças e preço por m², mostra a conta antes de gravar (m² cobrados, valor
da peça, total) e usa as funções do orçamento (`src/domain/orcamentos/area.ts`), as mesmas do gatilho
`tg_item_os_precificar_por_area`. Sem largura e altura, a tela recusa o item. Quem não vê preço grava 0, e quem não vê
custo deixa o custo para o banco.

Uso real: 19 dos 67 itens de OS não vieram de orçamento: 13 são importações do RIP (sem preço), 5 são itens por peça
(OS 44 e 170 a 173) e 1 é por m² (OS 216, adesivo de 0,20 × 0,20 m com valor zero). O defeito estava de pé, mas pouco
usado; nenhuma OS existente está com total inflado por ele.

### 2. O item da OS não nascia com custo (defeito de banco, corrigido)

O orçamento tem o gatilho `tg_orcamento_item_custo_do_produto`; a OS não tinha nada igual. O vendedor, que não vê custo,
gravava custo 0, e a OS aparecia com margem de 100%. Eram 6 itens de 4 OS abertas (163, 164, 165 e 166, as de outubro que
estão no quadro). **Migração:** gatilho `BEFORE INSERT` em `itens_os` com a mesma regra do orçamento, e os 6 itens
preenchidos uma vez (custo × área da peça, com o mínimo), sem mexer em preço, em OS encerrada nem em orçamento.

| OS | Item | Custo antes | Custo depois |
| --- | --- | --- | --- |
| 163 | faixa banner (2 peças de 5,0 × 1,5 m) | 0,00 | 151,95 a peça |
| 164 | Banner com bastão e corda (1,15 × 1,70 m) | 0,00 | 23,95 |
| 165 | Acrílico 3 mm, 3 itens | 0,00 | 72,46 / 63,41 / 18,12 |
| 166 | Banner com bastão e corda (0,80 × 1,20 m) | 0,00 | 11,76 |

### 3. O acrílico de 2 mm: a tabela estava em R$ 600/m², e o dono já corrigiu hoje

Por que "R$ 1.000 de média" e a tabela dizendo outra coisa. Cada peça paga no mínimo 0,10 m², então o preço **por m² de
peça de verdade** é bem maior que o da tabela. Medido nos orçamentos e OS aprovados:

| Produto | Tabela | Custo do material | Custo real | Mínimo recomendado | Preço médio por m² cobrado | Preço médio por m² de peça real |
| --- | --- | --- | --- | --- | --- | --- |
| Acrílico Virgem Recortado 2 mm | **1.000** (era 600 até 21/11 10:39) | 151,13 | 254,43 | 521,14 | 600 | **815 a 1.110** |
| Acrílico Espelhado Recortado 2 mm | **1.350** (era 1.000 até 21/11 10:40) | 400,00 | 499,73 | 1.200,00 | 1.000 | **1.197 a 1.400** |
| Acrílico Virgem Recortado 3 mm | 800 | 181,16 | 291,85 | 624,69 | 824 a 835 | 854 a 1.038 |
| Quadro Acrílico | 1.000 | 187,74 | 300,05 | 647,38 | — | — |

Os dois preços de 2 mm foram alterados pelo próprio dono em 21/11 (10:39 e 10:40), antes desta análise. Os orçamentos
já enviados a R$ 600 (#196 enviado, #253 aprovado) ficam como foram.

### 4. Adesivo e lona: a conta está certa; o que diverge são preços e custos digitados

- **Conta:** dos 107 itens de orçamento por área, só 6 diferem da fórmula (área exata da peça com o mínimo, total em
  centavos): #115, #150 e #152, todos de antes de 29/10, com a área da peça ainda arredondada em 3 casas. Foram enviados
  ou aprovados assim; não foram mexidos.
- **Preço por m² diferente da tabela em 15 dos 32 itens de OS por m²:** o adesivo vinil branco a R$ 55 e a lona 280 g a
  R$ 45 eram o preço da tabela até 16/11 (17:04 a 17:16, aprovados pelo gerente); o banner a R$ 37,90 é o preço de
  parceiro; o acrílico 3 mm a R$ 1.000 na OS 230 foi ajuste do vendedor.
- **Preço da tabela abaixo do mínimo recomendado** (decisão do dono, nada mudou): Adesivo vinil recortado a R$ 65,00
  contra R$ 72,84 (a proposta de R$ 99,90 foi aprovada em 16/11 e o preço voltou a R$ 65,00 em 17/11 15:59, por
  edição do Harison, junto com o custo); Placa PS 2 mm com adesivo R$ 145,00 contra R$ 175,55; Laminação de adesivo
  R$ 28,00 contra R$ 28,97.

### 5. O custeio está sendo puxado, com 4 exceções digitadas à mão

A cadeia é: material muda → `tg_material_custo_propaga` → `recalcular_custo_produto` → `produtos.custo_medio`
(soma da ficha com `custo_medio` do material). Dos 18 produtos de adesivo, lona, banner, placa e acrílico (e seus
acabamentos) que têm ficha de material, 14 batem com ela. Quatro têm `custo_medio` digitado que **não** bate com a
ficha (o recálculo só roda quando a ficha ou o material mudam):

| Produto | custo_medio no produto | pela ficha de material |
| --- | --- | --- |
| Adesivo vinil recortado | 21,49 | 7,24 |
| Adesivo transparente | 21,77 | 20,80 |
| Laminação de adesivo | 12,00 | 8,40 |
| Acabamento de lona (bainha + ilhós) | 4,00 | 0,70 |

Podem estar certos (a ficha pode estar incompleta: corte, mão de obra), por isso **não foram trocados**: é decisão de
quem conhece o custo.

### 6. O que ficou como está (e por quê)

- As colunas de área geradas (`area_unitaria`, `area_total`, `area_cobrada`) ainda arredondam a **peça** em 3 casas,
  enquanto o preço usa 6. Em peça miúda o "m² cobrados" mostrado fica até 20% acima do que o preço usa (120 adesivos de
  5 × 5 cm: 0,360 m² mostrados, 0,300 m² cobrados). O preço está certo; é só a exibição. Mudar coluna gerada exige
  recriar as visões que dependem dela, então fica para uma migração própria.
- OS 169 e 219: o total da OS é menor que a soma dos itens por causa do desconto (40% e 15%); não é erro.
- Na tela "Nova OS", o campo "Valor total" passa a dizer que vale só até a inclusão dos itens (depois o total é a soma
  deles menos o desconto). Antes, o número digitado "mudava sozinho".

## Ensaio no banco vivo (21/11/2026, desfeito por `RAISE EXCEPTION`)

A migração inteira, sem o `COMMIT`, mais seis itens de teste numa OS existente.

| Item de teste | Resultado |
| --- | --- |
| Acrílico 2 mm 0,30 × 0,20 m, preço R$ 1.000 | vu 100,00, total 100,00, custo 15,11 |
| 3 peças de 0,50 × 0,40 m | vu 200,00, total 600,00, custo 30,23 |
| Chaveiro (un), custo zerado | custo 2,25 (preenchido) |
| Acrílico com custo informado 5,00 | custo 5,00 (mantido) |
| Item sem produto | custo 0 (não inventa) |
| 120 adesivos de 5 × 5 cm a R$ 30/m² (preço de teste) | total 9,00, custo 0,02 a peça |
| Os 6 itens de OS aberta sem custo | preenchidos; totais das OS 163, 164, 165 e 166 iguais (1050,00, 78,20, 680,00, 38,40) |
| Rastro em `logs_auditoria` | `custo_do_item_preenchido` em 4 OS |
| Função de gatilho | `anon`, `authenticated` e `PUBLIC` sem `EXECUTE`; `SECURITY DEFINER` |

## Aplicação

Depois do CI e do merge: aplicar a migração pela ferramenta do banco (o mesmo arquivo), conferir o gatilho ligado, a
função fechada e os 6 itens com custo, e publicar o front. A tela da aba Itens não foi vista no navegador (o editor
exige login): está coberta por teste da conta (`tests/item-da-os-por-area.test.ts`) e pelo contrato do código.
