# Simulação de balcão — 24/10/2026

Cenários de cliente no balcão (e parceiro no portal) para **antecipar problemas antes de acontecerem**. Roda em código, sem tocar no banco: `npx tsx scripts/simular-balcao.ts` (tabela), `--detalhe` (avisos) e `--estoque` (estoque mínimo). Testes em `tests/simulacao-balcao.test.ts`.

Produtos como o dono nomeou: **A** Adesivo PROMO · **B** Adesivo TOP · **C** Lona PROMO · **D** Banner · **Y** Lona Backlight · **Z** Adesivo perfurado TOP. Preços: tabela de terceirizados do WhatsApp.

## Como a simulação enxerga a Bex

- **Tudo o que a Bex vende é impresso.** Lona, backlight, vinil e banner são a **superfície** em que a impressão é aplicada, não material vendido solto. Todo pedido passa pela plotter e tem **hora de máquina**; muitos têm também recorte e **hora de mão de obra**.
- **Mão de obra é diluída.** O custo de uma hora de operador sai do que ele recebe no mês dividido pelas horas dedicadas. A simulação conta minutos de mão de obra e quantos operadores há (1 ou 2).
- **O estoque é simulado, não o real.** Se a simulação esbarrasse no estoque de hoje, só mostraria a falta. Em vez disso o consumo de cada cenário vira o **estoque que a casa deveria ter**, com o nível em que avisar a compra (veja abaixo).
- **Fora do escopo por ora:** peças que não são impressão em superfície, como letra caixa cortada em acrílico (hora de máquina de corte, medida do material). Fica para depois dos produtos da tabela.

## Premissas (precisam de confirmação)

| Premissa | Valor usado | Onde ajustar |
|---|---|---|
| Impressão | 14 m²/h, boca útil 1,8 m (vinil: rolo de 1,06 m; lona: 1,6 m) | `capacidade-da-casa.ts` |
| Recorte | 800 mm/s, largura útil 1,26 m | idem |
| Operadores | 2 | idem |
| Janela do expresso | 6 h úteis (a tabela diz "3 a 6 horas úteis") | idem |
| Mão de obra máxima no expresso | 90 min de relógio; acima disso manda gente, e gente não se acelera | idem |
| Mão de obra | 3 min/linha, 3 min/m de bainha e ilhós, 4 min bastão e corda, 5 min conferência/pedido, decapagem por m² ou por peça (o que pesar mais) | idem |
| Taxa de expresso | 12% do valor dos produtos | `prazos_de_entrega` |
| Reposição de estoque | 7 dias; aviso de compra a 15% do estoque cheio | `planejamento-de-estoque.ts` |

Os tempos de mão de obra e a reposição são **chute informado**. Cronometrar uma lona com ilhós e uma decapagem real, e perguntar ao fornecedor o prazo de entrega, melhora tudo o que está abaixo.

## Resultado por cenário

A coluna "Material" é o consumo simulado em m² de superfície, já com o aproveitamento do rolo. "Expresso" mostra se o pedido caberia em expresso pela **capacidade** (máquina, mão de obra, fila).

| # | Cenário | Área | Produtos | Taxa 12% | Máquina | Mão de obra | Relógio | Gargalo | Material (m²) | Expresso |
|---|---|---:|---:|---:|---:|---:|---:|---|---|---|
| S01 | A sozinho — 10 adesivos de 50×50 cm | 2,5 m² | R$ 59,75 | R$ 7,17 | 11 min | 8 min | 15 min | máquina | vinil branco 2,875 | cabe (folga 345 min) |
| S02 | B sozinho — 1 adesivo de 1,0×0,8 m | 0,8 m² | R$ 23,92 | R$ 2,87 | 3 min | 8 min | 7 min | mão de obra | vinil branco 1,06 | cabe (folga 353 min) |
| S03 | C sozinho — lona de 3×1 m | 3 m² | R$ 80,70 | R$ 9,68 | 13 min | 32 min | 29 min | mão de obra | lona 280 5,12 | cabe (folga 331 min) |
| S04 | A + B + C juntos | 6,3 m² | R$ 164,37 | R$ 19,72 | 27 min | 38 min | 46 min | máquina | vinil branco 3,935; lona 280 5,12 | cabe (folga 314 min) |
| S05 | C e D — lona e banner | 5,16 m² | R$ 162,56 | R$ 19,51 | 22 min | 43 min | 44 min | máquina | lona 280 8,325 | cabe (folga 316 min) |
| S06 | D e C — os mesmos itens, em outra ordem | 5,16 m² | R$ 162,56 | R$ 19,51 | 22 min | 43 min | 44 min | máquina | lona 280 8,325 | cabe (folga 316 min) |
| S07 | Y e Z — backlight e perfurado | 4 m² | R$ 219,60 | R$ 26,35 | 17 min | 29 min | 32 min | máquina | lona backlight 3,52; vinil perfurado 2,335 | cabe (folga 328 min) |
| S08a | Limiar: B com exatamente 6,00 m² | 6 m² | R$ 179,40 | R$ 21,53 | 26 min | 11 min | 31 min | máquina | vinil branco 6,784 | cabe (folga 329 min) |
| S08b | Limiar: B com 6,02 m² | 6,02 m² | R$ 167,96 | R$ 20,16 | 26 min | 11 min | 31 min | máquina | vinil branco 6,805 | cabe (folga 329 min) |
| S09a | B em duas linhas de 4 m², limiar POR LINHA | 8 m² | R$ 239,20 | R$ 28,70 | 34 min | 15 min | 42 min | máquina | vinil branco 9,328 | cabe (folga 318 min) |
| S09b | B em duas linhas de 4 m², limiar POR PRODUTO | 8 m² | R$ 223,20 | R$ 26,78 | 34 min | 15 min | 42 min | máquina | vinil branco 9,328 | cabe (folga 318 min) |
| S10 | Adesivo + recorte simples — 2×0,5 m | 1 m² | R$ 44,90 | R$ 5,39 | 4 min | 13 min | 11 min | mão de obra | vinil branco 2,332 | cabe (folga 349 min) |
| S11 | Adesivo + recorte detalhado — 500 etiquetas de 4×4 cm | 0,8 m² | R$ 35,92 | R$ 4,31 | 5 min | 210 min | 110 min | mão de obra | vinil branco 1,256 | NÃO — o que manda no tempo é mão de obra, e mão de obra não se acelera |
| S12 | Lona TOP de fachada — 8×1,5 m (12 m²) | 12 m² | R$ 358,80 | R$ 43,06 | 51 min | 65 min | 84 min | máquina | lona 440 13,12 | cabe (folga 276 min) |
| S13 | Lona TOP gigante — 12×3 m (36 m²) | 36 m² | R$ 1.076,40 | R$ 129,17 | 154 min | 146 min | 227 min | máquina | lona 440 39,04 | cabe (folga 133 min) |
| S14a | B de 1,2×0,9 m — cabe girado no rolo de 1,06 m? | 1,08 m² | R$ 32,29 | R$ 3,87 | 5 min | 8 min | 9 min | máquina | vinil branco 1,484 | cabe (folga 351 min) |
| S14b | B de 1,5×1,5 m — passa da largura do rolo? | 2,25 m² | R$ 67,27 | R$ 8,07 | 10 min | 10 min | 14 min | máquina | vinil branco 3,604 | cabe (folga 346 min) |
| S15 | Banner pequeno — 0,3×0,4 m | 1 m² | R$ 37,90 | R$ 4,55 | 1 min | 12 min | 7 min | mão de obra | lona 280 0,8 | cabe (folga 353 min) |
| S16 | Pedido com 10 linhas diferentes de adesivo e lona | 6,51 m² | R$ 194,25 | R$ 23,31 | 28 min | 57 min | 56 min | mão de obra | vinil branco 3,975; lona 280 5,12; vinil transparente 1,063; vinil fosco 1,063 | cabe (folga 304 min) |
| S17 | 500 adesivos A de 10×10 cm | 5 m² | R$ 119,50 | R$ 14,34 | 21 min | 8 min | 25 min | máquina | vinil branco 5,668 | cabe (folga 335 min) |
| S18 | A + B + C em EXPRESSO | 6,3 m² | R$ 164,37 | R$ 19,72 | 27 min | 38 min | 46 min | máquina | vinil branco 3,935; lona 280 5,12 | cabe (folga 314 min) |
| S19 | Lona TOP de 40 m² em EXPRESSO | 40 m² | R$ 1.196,00 | R$ 143,52 | 171 min | 220 min | 281 min | máquina | lona 440 64,64 | cabe (folga 79 min) |
| S20 | Pedido pequeno em EXPRESSO com 5 h 40 min de fila | 2 m² | R$ 69,80 | R$ 8,38 | 9 min | 26 min | 362 min | mão de obra | lona 440 3,52 | NÃO — pede 362 min e a janela do expresso é de 360 min (há 340 min de fila) |
| S21 | Lona TOP + adesivo com recorte, em EXPRESSO | 4 m² | R$ 149,60 | R$ 17,95 | 17 min | 45 min | 40 min | mão de obra | lona 440 5,12; vinil branco 1,272 | cabe (folga 320 min) |
| S22 | Lona fosca e backlight em EXPRESSO | 3 m² | R$ 124,70 | R$ 14,96 | 13 min | 41 min | 33 min | mão de obra | lona fosca 3,52; lona backlight 1,92 | cabe (folga 327 min) |
| S23 | Lona TOP 3×1 m sem acabamento | 3 m² | R$ 104,70 | R$ 12,56 | 13 min | 8 min | 17 min | máquina | lona 440 5,12 | cabe (folga 343 min) |
| S24 | Duas lonas PROMO (3×1 m cada) — estoque de 3,05 m² | 6 m² | R$ 161,40 | R$ 19,37 | 26 min | 56 min | 54 min | mão de obra | lona 280 9,925 | cabe (folga 306 min) |

## Estoque que a simulação pede

Um dia típico de balcão (S01 a S05, S07, S10, S12, S15, S17, S21, uma vez cada) consome o abaixo. **Estoque cheio** é o que cobre o prazo de reposição já considerando que o aviso dispara a 15%: cheio = consumo do prazo ÷ 0,15. Quando o rolo cair abaixo de "avisar abaixo de", é hora de comprar.

| Material | Consumo/dia | Consumo/mês | Cobre o prazo | Estoque cheio | Avisar abaixo de |
|---|---:|---:|---:|---:|---:|
| Lona 280g brilho | 19,36 m² | 426,03 m² | 135,55 m² | 903,69 m² | 135,55 m² |
| Lona 440g reforçada | 18,24 m² | 401,28 m² | 127,68 m² | 851,2 m² | 127,68 m² |
| Vinil adesivo branco brilho | 17,14 m² | 377,11 m² | 119,99 m² | 799,92 m² | 119,99 m² |
| Lona backlight | 3,52 m² | 77,44 m² | 24,64 m² | 164,27 m² | 24,64 m² |
| Vinil adesivo perfurado | 2,34 m² | 51,37 m² | 16,35 m² | 108,98 m² | 16,35 m² |

Isso é ordem de grandeza para um dia inventado. O número de verdade vem do consumo real: os jobs do Flexi importados já dizem quantos m² saíram de cada material por dia.

## Problemas encontrados

1. **Degrau de 6 m² faz o pedido maior sair mais barato.** Adesivo TOP: 6,00 m² custa R$ 179,40; 6,02 m² custa R$ 167,96 (S08a/S08b), R$ 11,44 a menos por 0,02 m² a mais. O cliente aprende a "esticar" o pedido e a loja perde margem. Alternativa sem degrau (`valorProgressivo`): os primeiros 6 m² a R$ 29,90 e só o que passa a R$ 27,90; 6,02 m² passa a custar R$ 179,96. Teste garante que o progressivo nunca deixa o maior custar menos.
2. **A regra dos 6 m² é ambígua** e muda o valor: duas linhas de 4 m² de adesivo TOP custam R$ 239,20 se a regra vale por linha e R$ 223,20 se soma por produto (S09a/S09b). O sistema não tem a faixa.
3. **A tabela do WhatsApp e o preço do parceiro no sistema não batem.** Adesivo branco: R$ 29,90 no WhatsApp e R$ 46,75 no sistema. Lona PROMO: R$ 26,90 e R$ 38,25. No sentido contrário, banner (R$ 37,90 e R$ 36,50) e lona TOP até 6 m² (R$ 34,90 e R$ 33,50).
4. **Produtos e materiais da tabela sem cadastro.** Sem produto: Adesivo PROMO, transparente, fosco, blackout, Lona fosca e Backlight. Sem material: vinil transparente, vinil fosco, vinil blackout, lona fosca e backlight. A simulação trata como se existissem (rolo comum da família), mas no sistema o pedido não reserva material.
5. **Rolo de vinil de 1,06 m.** Adesivo de 3×2 m do limiar vira dois painéis e 3 m de emenda (S08); peça de 1,5 m de lado também (S14b). Rolo mais largo some com isso.
6. **Mão de obra manda no tempo de pedido com muita peça pequena.** 500 etiquetas 4×4 cm com recorte detalhado: 5 min de máquina e 210 min de mão de obra (S11), fora do expresso. Pedido de 10 linhas diferentes também pesa (S16).
7. **Fila na frente come a janela.** Pedido de 26 min de trabalho com 5 h 40 min de fila pede 362 min contra 360 de janela (S20). O sistema hoje não sabe quanto de fila existe quando promete expresso.
8. **Pedido gigante em expresso.** 40 m² de lona TOP ocupa 281 min dos 360 (S19): cabe, mas com folga de 79 min, e só um pedido assim por janela.
9. **Banner "a partir de R$ 37,90".** O sistema precisa de preço fechado. O cadastro cobra mínimo de 1 m² por peça e a tabela não fala em mínimo: banner de 0,3×0,4 m custa R$ 37,90 (S15).
10. **Ordem não importa e soma bate.** C e D = D e C (S05/S06); A+B+C custa a soma dos três (S04). Coberto por teste.

## Perguntas para o dono

1. A regra "acima de 6 m²" vale **por linha**, **por produto** ou **pelo pedido todo**?
2. Aceita trocar o degrau por faixa progressiva (só o que passa de 6 m² ganha o preço menor)?
3. Qual é o preço certo do parceiro: o do sistema ou o da tabela do WhatsApp?
4. Cadastrar os produtos e materiais que faltam (PROMO, transparente, fosco, blackout, lona fosca, backlight)?
5. Banner: qual é o preço fechado? Mantém o mínimo de 1 m²?
6. Existe rolo de vinil mais largo que 1,06 m?
7. Quanto tempo leva de verdade uma lona com bainha e ilhós, e a decapagem de um adesivo com recorte? Os números de mão de obra são chute.
8. Qual o prazo de reposição de cada rolo (logística)? E o aviso de compra fica mesmo em 15%?
9. A fila de produção entra na promessa do expresso, ou promete-se por ordem de chegada?
10. O próximo produto a simular é a letra caixa em acrílico? Preciso do preço, da espessura e da máquina de corte.

## O que esta simulação não fez

- Não rodou os cenários no motor do banco (orçamento, conversão em OS, reserva de material). A taxa de expresso e a conversão em OS já foram ensaiadas com rollback nos PRs anteriores.
- Não mede custo, só preço de venda.
- Os tempos de máquina vêm de `tempoImpressao` e `tempoRecorte` com os parâmetros acima; a mão de obra é estimada.
