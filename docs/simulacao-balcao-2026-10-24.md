# Simulação de balcão — 24/10/2026

Cenários de cliente no balcão (e parceiro no portal) para **antecipar problemas antes de acontecerem**. Tudo roda em código, sem tocar no banco: `npx tsx scripts/simular-balcao.ts` (tabela) e `--detalhe` (avisos por cenário). Testes em `tests/simulacao-balcao.test.ts`.

Produtos como o dono nomeou: **A** Adesivo PROMO · **B** Adesivo TOP · **C** Lona PROMO · **D** Banner · **Y** Lona Backlight · **Z** Adesivo perfurado TOP. Preços: tabela de terceirizados do WhatsApp.

## Premissas (precisam de confirmação)

| Premissa | Valor usado | Onde ajustar |
|---|---|---|
| Impressão | 14 m²/h, boca útil 1,8 m (vinil: rolo de 1,06 m) | `capacidade-da-casa.ts` |
| Recorte | 800 mm/s, largura útil 1,26 m | idem |
| Operadores | 2 | idem |
| Janela do expresso | 6 h úteis (a tabela diz "3 a 6 horas úteis") | idem |
| Mão de obra máxima no expresso | 90 min de relógio — acima disso manda gente, e gente não se acelera | idem |
| Mão de obra | 3 min/linha, 3 min/m de bainha e ilhós, 4 min bastão e corda, 5 min conferência/pedido, decapagem por m² ou por peça (o que pesar mais) | idem |
| Taxa de expresso | 12% do valor dos produtos | `prazos_de_entrega` |
| Estoque | o do banco hoje: vinil 0, ilhós 0, lona 280 g 3,05 m², lona 440 g 44 m² | `BOBINAS` |

Os tempos de mão de obra são **chute informado**. Cronometrar uma lona com ilhós e uma decapagem real melhora tudo o que está abaixo.

## Resultado

"Expresso hoje" usa o estoque real. "Com estoque cheio" mostra o que **só a capacidade** permite, sem a falta de material na frente.

| # | Cenário | Área | Produtos | Taxa 12% | Máquina | Mão de obra | Relógio | Gargalo | Expresso hoje | Expresso c/ estoque cheio |
|---|---|---:|---:|---:|---:|---:|---:|---|---|---|
| S01 | A sozinho — 10 adesivos de 50×50 cm | 2,5 m² | R$ 59,75 | R$ 7,17 | 11 min | 8 min | 15 min | máquina | NÃO — falta material no estoque | cabe (folga 345 min) |
| S02 | B sozinho — 1 adesivo de 1,0×0,8 m | 0,8 m² | R$ 23,92 | R$ 2,87 | 3 min | 8 min | 7 min | mão de obra | NÃO — falta material no estoque | cabe (folga 353 min) |
| S03 | C sozinho — lona de 3×1 m | 3 m² | R$ 80,70 | R$ 9,68 | 13 min | 32 min | 29 min | mão de obra | NÃO — falta material no estoque | cabe (folga 331 min) |
| S04 | A + B + C juntos | 6,3 m² | R$ 164,37 | R$ 19,72 | 27 min | 38 min | 46 min | máquina | NÃO — falta material no estoque | cabe (folga 314 min) |
| S05 | C e D — lona e banner | 5,16 m² | R$ 162,56 | R$ 19,51 | 22 min | 43 min | 44 min | máquina | NÃO — falta material no estoque | cabe (folga 316 min) |
| S06 | D e C — os mesmos itens, em outra ordem | 5,16 m² | R$ 162,56 | R$ 19,51 | 22 min | 43 min | 44 min | máquina | NÃO — falta material no estoque | cabe (folga 316 min) |
| S07 | Y e Z — backlight e perfurado | 4 m² | R$ 219,60 | R$ 26,35 | 17 min | 29 min | 32 min | máquina | NÃO — falta material no estoque | NÃO — material não cadastrado |
| S08a | Limiar: B com exatamente 6,00 m² | 6 m² | R$ 179,40 | R$ 21,53 | 26 min | 11 min | 31 min | máquina | NÃO — falta material no estoque | cabe (folga 329 min) |
| S08b | Limiar: B com 6,02 m² | 6,02 m² | R$ 167,96 | R$ 20,16 | 26 min | 11 min | 31 min | máquina | NÃO — falta material no estoque | cabe (folga 329 min) |
| S09a | B em duas linhas de 4 m², limiar POR LINHA | 8 m² | R$ 239,20 | R$ 28,70 | 34 min | 15 min | 42 min | máquina | NÃO — falta material no estoque | cabe (folga 318 min) |
| S09b | B em duas linhas de 4 m², limiar POR PRODUTO | 8 m² | R$ 223,20 | R$ 26,78 | 34 min | 15 min | 42 min | máquina | NÃO — falta material no estoque | cabe (folga 318 min) |
| S10 | Adesivo + recorte simples — 2×0,5 m | 1 m² | R$ 44,90 | R$ 5,39 | 4 min | 13 min | 11 min | mão de obra | NÃO — falta material no estoque | cabe (folga 349 min) |
| S11 | Adesivo + recorte detalhado — 500 etiquetas de 4×4 cm | 0,8 m² | R$ 35,92 | R$ 4,31 | 5 min | 210 min | 110 min | mão de obra | NÃO — falta material no estoque | NÃO — o que manda no tempo é mão de obra, e mão de obra não se acelera |
| S12 | Lona TOP de fachada — 8×1,5 m (12 m²) | 12 m² | R$ 358,80 | R$ 43,06 | 51 min | 65 min | 84 min | máquina | NÃO — falta material no estoque | cabe (folga 276 min) |
| S13 | Lona TOP gigante — 12×3 m (36 m²) | 36 m² | R$ 1.076,40 | R$ 129,17 | 154 min | 146 min | 227 min | máquina | NÃO — falta material no estoque | cabe (folga 133 min) |
| S14a | B de 1,2×0,9 m — cabe girado no rolo de 1,06 m? | 1,08 m² | R$ 32,29 | R$ 3,87 | 5 min | 8 min | 9 min | máquina | NÃO — falta material no estoque | cabe (folga 351 min) |
| S14b | B de 1,5×1,5 m — passa da largura do rolo? | 2,25 m² | R$ 67,27 | R$ 8,07 | 10 min | 10 min | 14 min | máquina | NÃO — falta material no estoque | cabe (folga 346 min) |
| S15 | Banner pequeno — 0,3×0,4 m | 1 m² | R$ 37,90 | R$ 4,55 | 1 min | 12 min | 7 min | mão de obra | cabe (folga 353 min) | cabe (folga 353 min) |
| S16 | Pedido com 10 linhas diferentes de adesivo e lona | 6,51 m² | R$ 194,25 | R$ 23,31 | 28 min | 57 min | 56 min | mão de obra | NÃO — falta material no estoque | NÃO — material não cadastrado |
| S17 | 500 adesivos A de 10×10 cm | 5 m² | R$ 119,50 | R$ 14,34 | 21 min | 8 min | 25 min | máquina | NÃO — falta material no estoque | cabe (folga 335 min) |
| S18 | A + B + C em EXPRESSO | 6,3 m² | R$ 164,37 | R$ 19,72 | 27 min | 38 min | 46 min | máquina | NÃO — falta material no estoque | cabe (folga 314 min) |
| S19 | Lona TOP de 40 m² em EXPRESSO | 40 m² | R$ 1.196,00 | R$ 143,52 | 171 min | 220 min | 281 min | máquina | NÃO — falta material no estoque | cabe (folga 79 min) |
| S20 | Pedido pequeno em EXPRESSO com 5 h 40 min de fila | 2 m² | R$ 69,80 | R$ 8,38 | 9 min | 26 min | 362 min | mão de obra | NÃO — falta material no estoque | NÃO — pede 362 min e a janela do expresso é de 360 min (há 340 min de fila) |
| S21 | Lona TOP + adesivo com recorte, em EXPRESSO | 4 m² | R$ 149,60 | R$ 17,95 | 17 min | 45 min | 40 min | mão de obra | NÃO — falta material no estoque | cabe (folga 320 min) |
| S22 | Lona fosca e backlight em EXPRESSO | 3 m² | R$ 124,70 | R$ 14,96 | 13 min | 41 min | 33 min | mão de obra | NÃO — falta material no estoque | NÃO — material não cadastrado |
| S23 | Lona TOP 3×1 m sem acabamento | 3 m² | R$ 104,70 | R$ 12,56 | 13 min | 8 min | 17 min | máquina | cabe (folga 343 min) | cabe (folga 343 min) |
| S24 | Duas lonas PROMO (3×1 m cada) — estoque de 3,05 m² | 6 m² | R$ 161,40 | R$ 19,37 | 26 min | 56 min | 54 min | mão de obra | NÃO — falta material no estoque | cabe (folga 306 min) |

## Problemas encontrados

Do mais grave para o menos grave.

1. **Hoje o expresso não pode ser prometido para quase nada.** Vinil branco e perfurado: estoque 0. Ilhós: 0. Lona 280 g: 3,05 m². Só cabem em expresso o banner pequeno (S15) e a lona sem acabamento (S23). Com estoque cheio, quase tudo cabe. Ou seja: o limite do expresso hoje é **material**, não máquina.
2. **Degrau de 6 m² faz o pedido maior sair mais barato.** Adesivo TOP: 6,00 m² custa R$ 179,40; 6,02 m² custa R$ 167,96 (S08a/S08b), R$ 11,44 a menos por 0,02 m² a mais. O cliente aprende a "esticar" o pedido e a loja perde margem. Alternativa sem degrau (função `valorProgressivo`): os primeiros 6 m² a R$ 29,90 e só o que passa a R$ 27,90; 6,02 m² passa a custar R$ 179,96. O teste garante que o progressivo nunca deixa o maior custar menos.
3. **A regra dos 6 m² é ambígua** e muda o valor: duas linhas de 4 m² de adesivo TOP custam R$ 239,20 se a regra vale por linha e R$ 223,20 se soma as linhas do mesmo produto (S09a/S09b). O sistema não tem a faixa de 6 m² nenhuma.
4. **A tabela do WhatsApp e o preço do sistema não batem.** Parceiro paga mais no sistema do que no WhatsApp em adesivo branco (R$ 46,75 contra R$ 29,90) e em lona PROMO (R$ 38,25 contra R$ 26,90); paga menos em banner (R$ 36,50 contra R$ 37,90) e em lona TOP até 6 m² (R$ 33,50 contra R$ 34,90). Quem compara as duas tabelas vê isso.
5. **Produtos e materiais que a tabela tem e o sistema não.** Sem cadastro: Adesivo PROMO, transparente, fosco, blackout, Lona fosca e Backlight. Sem material cadastrado: vinil transparente, vinil fosco e lona backlight. Pedido com qualquer um deles não reserva material nem vai em expresso (S07, S16, S22).
6. **Rolo de vinil de 1,06 m.** Peça de 1,5 m de lado sai em dois painéis com emenda (S14b). O 3×2 m do limiar (S08) vira dois painéis e 3 m de emenda. Se existir rolo de vinil mais largo, isso some.
7. **Mão de obra manda no tempo de pedido com muita peça pequena.** 500 etiquetas 4×4 cm com recorte detalhado: 5 min de máquina e 210 min de mão de obra (S11). Expresso bloqueado mesmo com estoque cheio. O mesmo vale para pedido com 10 linhas diferentes (S16).
8. **Fila na frente come a janela.** Pedido de 26 min de trabalho com 5 h 40 min de fila pede 362 min contra 360 de janela (S20). O sistema hoje não sabe quanto de fila existe quando promete expresso.
9. **Banner "a partir de R$ 37,90".** O sistema precisa de um preço fechado; sem ele o orçamento sai pelo piso. O cadastro cobra mínimo de 1 m² por peça e a tabela não fala em mínimo: banner de 0,3×0,4 m custa R$ 37,90 (S15).
10. **Ordem não importa e soma bate.** C e D = D e C (S05/S06); A+B+C custa a soma dos três sozinhos (S04). Isso está coberto por teste e funciona.

## Perguntas para o dono

1. A regra "acima de 6 m²" vale **por linha**, **por produto** ou **pelo pedido todo**?
2. Aceita trocar o degrau por faixa progressiva (só o que passa de 6 m² ganha o preço menor)?
3. Qual é o preço certo do parceiro: o do sistema ou o da tabela do WhatsApp? Principalmente adesivo branco e lona PROMO.
4. Cadastrar Adesivo PROMO, transparente, fosco, blackout, Lona fosca e Backlight como produto e material? Qual o estoque inicial de cada um?
5. Banner: qual é o preço fechado? Mantém o mínimo de 1 m²?
6. Existe rolo de vinil mais largo que 1,06 m?
7. Expresso: dá para exigir **estoque suficiente** no momento do pedido e bloquear a opção quando faltar? E quais produtos nunca vão em expresso (recorte detalhado, pedido com mais de N linhas)?
8. Quanto tempo leva de verdade: uma lona com bainha e ilhós, e a decapagem de um adesivo com recorte? Os números de mão de obra acima são chute.
9. A fila de produção entra na promessa do expresso, ou a gráfica promete por ordem de chegada?

## O que esta simulação não fez

- Não rodou os cenários no motor do banco (orçamento, conversão em OS, reserva de material). O banco foi consultado só para o estoque e o catálogo. A parte de conversão e taxa de expresso já foi ensaiada em transação com rollback nos PRs anteriores.
- Não mede custo, só preço de venda.
- Os tempos de máquina vêm de `tempoImpressao` e `tempoRecorte` com os parâmetros acima; a mão de obra é estimada.
