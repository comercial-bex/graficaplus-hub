# Regras de preço do balcão — decididas em 24/10/2026

Escritas a partir da simulação de balcão ([simulacao-balcao-2026-10-24.md](simulacao-balcao-2026-10-24.md)) e da tabela de preços para terceirizados que a Bex manda no WhatsApp.

## 1. Preço da tabela

O sistema cobra do parceiro o preço da tabela publicada, que é o que a Bex já cobra por fora. Vale para os produtos que já existem no sistema:

| Tabela do WhatsApp | Produto no sistema | R$/m² | Acima de 6 m² (na linha) |
|---|---|---:|---:|
| Adesivo TOP | Adesivo vinil branco impresso | 29,90 | 27,90 |
| Adesivo impresso + recorte | Adesivo vinil recortado | 44,90 | 41,90 |
| Adesivo perfurado TOP | Adesivo perfurado (one way) | 54,90 | 52,90 |
| Banner | Banner com bastão e corda | 37,90 | — |
| Lona PROMO | Lona 280g impressa | 26,90 | — |
| Lona TOP para fachada | Lona 440g reforçada impressa | 34,90 | 29,90 |

O preço de balcão (cliente final) não mudou.

## 2. Faixa "acima de 6 m²": progressiva e por linha

- **Progressiva.** Os primeiros 6 m² saem ao preço cheio; só o que passa de 6 m² sai ao preço menor. Exemplo, adesivo TOP: 8 m² = 6 × 29,90 + 2 × 27,90 = R$ 235,20.
- **Por linha.** A área que conta é a da linha do orçamento: peça × quantidade. Duas linhas de 4 m² não ganham a faixa; uma linha de 8 m² ganha.
- **Por quê.** Com desconto sobre a linha inteira, 6,02 m² custava R$ 11,44 a menos que 6,00 m²: o cliente aprendia a esticar o pedido. Com a faixa progressiva o pedido maior nunca custa menos que o menor. Por linha, o preço fica na própria linha e não muda quando outra linha é editada.
- **Só no preço de tabela do parceiro.** Preço de balcão, oferta e faixa de quantidade não usam esta faixa.
- **Onde vive.** Colunas `produtos.preco_parceiro_acima` e `produtos.acima_de_m2`; o gatilho `tg_item_precificar_por_area` aplica; `parceiro_faixas_por_area()` entrega à tela do parceiro, que mostra a regra e antecipa o valor. A conta é a mesma em `src/domain/orcamentos/faixa-por-area.ts`.

## 3. Banner

"A partir de R$ 37,90" vira preço fechado de R$ 37,90/m², com a área mínima de 1 m² por peça que o cadastro já tinha.

## 4. Estoque

A simulação não esbarra no estoque real. O consumo simulado vira o estoque cheio sugerido e o nível de aviso de compra (15%), por material. Ver o final do relatório da simulação.

## 5. Expresso

O expresso só é oferecido quando a **capacidade** permite: tempo total de máquina, mão de obra e fila dentro da janela de 6 h úteis, e mão de obra de relógio até 90 min (mão de obra não se acelera). Isto ainda é regra da simulação; o sistema segue sem bloquear o expresso por capacidade.

## 6. O que fica fora e por quê

- **Sete produtos da tabela** (Adesivo PROMO, perfurado promocional, transparente, fosco, blackout, lona fosca e backlight) continuam inativos. A nota deles exige custo real antes de vender; sem o custo eu não ativo.
- **Margem.** Com estes preços, adesivo TOP, lona PROMO e recortado acima de 6 m² ficam abaixo da margem mínima cadastrada. Mantive os preços porque são os que a Bex já pratica; fica para o dono confirmar custo ou tabela.

| Produto | Custo/m² cadastrado | Margem até 6 m² | Margem acima de 6 m² | Mínima cadastrada |
|---|---:|---:|---:|---:|
| Adesivo TOP | 22,00 | 26% | 21% | 40% |
| Recortado | 26,00 | 42% | 38% | 40% |
| Perfurado | 34,00 | 38% | 36% | 35% |
| Banner | 14,50 | 62% | — | 40% |
| Lona PROMO | 18,00 | 33% | — | 35% |
| Lona TOP | 18,30 | 48% | 39% | 35% |
