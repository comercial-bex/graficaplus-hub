# Auditoria de preços — 28/10/2026

Conferência pedida pelo dono: as máquinas, a tabela e o algoritmo de preço estão certos? Os orçamentos e as OS abertas batem? O que foi lido: as 9 máquinas, os 79 produtos ativos (com a composição de custo recalculada um a um), os 65 itens de orçamento dos últimos 90 dias e as 15 OS de venda dos últimos 60 dias, mais apontamentos de máquina, materiais previstos e a calculadora 3D.

## 1. O motor de preço — o que bate

| Peça do motor | Valor no banco | Conferência |
|---|---|---|
| Energia | R$ 1,1339/kWh (tabela e config 3D iguais) | ok |
| Mão de obra | R$ 9,2102/h + 32,19% = R$ 12,17/h nas 5 funções e no 3D | ok (salário mínimo ÷ 176 h) |
| Rateio administrativo | R$ 12/h no 2D | ok — **no 3D está 0** (ver 2.3) |
| Plotter i1600 (locada) | R$ 14,43/h = parcela R$ 2.309 ÷ 160 h; 14 m²/h; 1 kW | ok |
| Plotter de recorte | R$ 0,70/h (R$ 6.994 ÷ 10.000 h), quitada | ok |
| Laser CO2 | R$ 6,70/h (R$ 66.979 ÷ 10.000 h) | conta certa, critério discutível (ver 2.4) |
| Fiber 30W | R$ 4,64/h (R$ 46.398 ÷ 10.000 h) | idem |
| Bambu A1 Combo / A1 / A1 / Mini | R$ 1,35 / 0,88 / 0,88 / 0,60 por hora (compra ÷ 4.000 h), espelhado em `maquinas.custo_hora` | ok |
| Acabamentos (laser / manual / recorte) | R$ 52,80/h · R$ 38,40/h · R$ 1,93/m | ok (regra de 27/10) |
| Metro quadrado | preço = max(largura × altura, área mínima) × preço/m²; área em m com 3 casas | a conta está certa; o erro aparece quando a MEDIDA entra errada (ver OS 168) |
| Produto por área (i1600) | hora de máquina = 1 ÷ 14 m²/h; mão de obra = × 1,5 | ok |
| Produto por tempo (laser) | minutos cadastrados × (máquina + energia + MO + rateio) | ok |
| Gravação (fiber) | 5–6 min por peça nos brindes | ok |
| Faixas de volume | só nos adesivos de tamanho fixo (praguinha, pragão, bolão, testeira, perfurado) | ok para esses; **chaveiro acrílico não tem** |
| Totais | orçamento = soma dos itens − desconto em todos os 49 orçamentos; OS idem (a 169 tem desconto de R$ 273) | ok |

## 2. O motor de preço — o que não batia

1. **Produto sem ficha saía com material zero na composição** (27 dos 79 ativos: todos os brindes, acrílico espelhado, quadro acrílico, cartão e panfleto terceirizados, letra caixa…). O chaveiro acrílico de R$ 2,25 de material "custava" R$ 0,55 na tela de precificação e no PDF de uso interno; a margem aparecia 92% onde a real é 57%. O item do orçamento e a alçada de desconto já usavam o custo digitado — só a função da tela contava diferente. **Corrigido hoje** (`custo_cheio_do_produto` usa o custo digitado quando não há ficha; migração `20261028100000`, composição de todos os produtos recalculada).
2. **Seis produtos ativos usam material que a gráfica não tem** (adesivo blackout, fosco, PROMO, perfurado promocional, lona fosca, lona backlight): o material foi marcado "não comprado" em 27/10, o custo cheio sai R$ 6–7/m² e a margem 90%. Decisão do dono: desativar ou "sob encomenda" com preço do fornecedor.
3. **Calculadora 3D sem mão de obra e sem rateio.** Nas quatro OS do Mario (170–173) e nos kits Reintegrar: `custo_mao_obra = 0`, `custo_indireto = 0` (`custo_admin_padrao` do 3D está 0; no 2D é R$ 12/h). Preço = (material + máquina + energia + 1% risco + 1% acabamento) × 2. Resultado: chaveiro a R$ 1,78, estrela a R$ 2,69, tirinha a R$ 3,17. Não há preço mínimo por peça. Decisão do dono: rateio 12/h no 3D, minutos de pós-processamento e embalagem por peça, piso por peça.
4. **Laser CO2 e Fiber cobram a depreciação, mas o caixa paga a parcela.** CO2: R$ 6,70/h contra R$ 1.726,74 ÷ 160 h = R$ 10,79/h; Fiber: R$ 4,64/h contra R$ 1.254 ÷ 160 h = R$ 7,84/h. A i1600 (locada) já usa a parcela. Efeito pequeno por peça (chaveiro +R$ 0,07; acrílico 1 m² +R$ 3,40), mas é o número que falta no caixa. Decisão do dono.
5. **Potência das impressoras 3D em dois lugares com dois números**: 0,15 kW no cadastro da máquina, 500 W na calculadora (estimativa provisória). A calculadora cobra energia 3× maior. Confirmar a potência real (A1 ≈ 95–150 W) e deixar um número só.
6. **Banner: tabela R$ 110/m², prática R$ 40/m².** BAN-LON (próprio) está a 110; 7 orçamentos de banner em 60 dias saíram a 40 sem ligar o produto (custo zero): OS 163, 164, 166 e orçamentos 36, 38, 56, 57, 62. Existe BAN-LON-COPY "terceirizado" a 40 com custo de lona própria na ficha e sem o custo do fornecedor. Decisão do dono: qual banner é o padrão.
7. **Brindes com margem de 10–30% contra markup de 60% da casa** (kit churrasco 3 pç 59 → 69; copos 24–30 → 40; necessaire 29,90 → 39,90; caneta 4,50 → 5,50). Imposto 6% + cartão 3,5% comem quase tudo no kit. Decisão do dono: regra de preço de brinde e nova tabela BRI-*.
8. **Chaveiro acrílico sem faixa de volume**: 100 un a 7,00; 200 a 6,00; 400 a 7,00; 500 a 4,45 — cada vendedor inventa o desconto. Decisão do dono: cadastrar as faixas.
9. **Medida improvável não é barrada**: um item de 0,95 × 0,95 m × 60 un (54 m²) a R$ 5 por unidade entrou e virou OS (168). Sugestão de solução (não feita, para o dono decidir): aviso no item quando a peça passa de 10 m² ou o preço por m² fica abaixo de R$ 10, e pendência "medida improvável" no painel.

## 3. OS por OS (venda, últimos 60 dias)

| OS | Cliente / item | O que está errado | Solução |
|---|---|---|---|
| 161, 162 | chaveiros acrílico 200 / 100 un | sem medida (cobrada do Yvens em 27/10); sem ficha de material; sem apontamento | esperar a medida; criar a ficha (acrílico 2 mm + argola) |
| 163 | 2 faixas de lona 5 × 1,5 m (15 m²) R$ 1.050 | item sem produto ligado: custo zero no item (a OS tem R$ 274,52 de material previsto, certo) | ligar o item a LON-440 para o custo por peça existir |
| 164 | banner terceirizado 1,15 × 1,70 R$ 78,20 | custo zero; preço do terceirizado com ficha de lona própria; custo do fornecedor não lançado | lançar o custo real do fornecedor |
| 165 | acrílico 3 mm (3 peças) R$ 680 | apontamento do laser com 0 min (abriu e fechou em 3 s); 3 itens com custo zero no item (material previsto R$ 340 está certo) | refazer o apontamento quando cortar; ligar o custo nos itens |
| 166 | banner 0,8 × 1,2 R$ 38,40 | item a R$ 40/m² (tabela 110), custo zero no item | mesma decisão do banner |
| 167 | brindes Amapuera R$ 745 | kit churrasco margem ~10%; copos custo digitado; compra dos brindes não lançada no estoque | ver decisão de brindes; lançar a compra |
| 168 | adesivo DTF 60 un R$ 300 | **medida 0,95 × 0,95 m = 54 m²** (provável 9,5 × 9,5 cm); custo zero; prazo 22/10 vencido; máquina DTF não chegou | corrigir a medida (0,095) e lançar o custo do DTF |
| 169 | lona 440 9,75 m² R$ 682,50 − 40% = R$ 409,50 | apontamento da i1600 **1.000 min (16 h)** fechado no teto para ~45 min de trabalho; desconto de 40% | corrigir o apontamento antes de concluir (senão custo de máquina R$ 260 em vez de ~R$ 12) |
| 170–173 | 3D Mario (kit, porta-lápis, chaveiro, estrela) | preço = 2 × custo sem mão de obra nem rateio (chaveiro R$ 1,78); jobs no rolo antigo "PLA 3DLAB" (0 g) | ver decisão 2.3; apontar o rolo usado em cada peça |
| 174 | adesivo recortado 0,48 m² R$ 32,64 | nada grave (custo 12,48 no item, 5,02 previsto) | — |

## 4. Orçamentos em aberto com preço fora da tabela

- **146** (enviado): 500 chaveiros a R$ 4,45 — tabela 6,50; custo 2,80 (margem 37%).
- **107** (enviado): lona 0,96 m² a R$ 30/m² — tabela 45 (280 g) a 70 (440 g); sem produto, custo zero.
- **115** (enviado): dois itens de adesivo a R$ 30/m² ao lado de quatro a R$ 55/m² no mesmo orçamento; os de 30 sem produto.
- **105** (enviado): banner 2 × 2 m² a R$ 110/m² — certo pela tabela, mas sem produto ligado (custo zero).
- **69** (rascunho): quadro acrílico 0,25 m² × 13 a R$ 89,90 com custo R$ 200 por peça — **prejuízo**.
- **99, 134** (enviados): acrílico espelhado — certos (área mínima 0,1 m² e R$ 1.000/m²).
- 3D (80–87, 136–140): preço = 2 × custo, consistente com a calculadora, mas com os mesmos zeros da decisão 2.3.

## 5. O que foi feito hoje

- Correção do custo cheio para produto sem ficha (migração `20261028100000`, aplicada e composição de 79 produtos recalculada).
- Sete decisões registradas na lista do dono (painel): 3D sem mão de obra/rateio; banner 40 × 110; produtos com material não comprado; hora de máquina financiada; potência das impressoras; margem dos brindes; faixas do chaveiro.
- Aviso no WhatsApp do gestor (Raymison) com as OS e os problemas, agendado para as 8h de 28/10 (fila `notificacoes_fila`, chave `auditoria-precos:20261028:gestor`). O dono não tem telefone no cadastro de usuários; recebe este relatório.

## 6. O que não fiz de propósito

- Não mexi em medida, apontamento, desconto nem preço de OS ou orçamento: são decisões de quem vendeu e do gestor; o aviso diz exatamente o que corrigir.
- Não desativei produtos nem mudei a tabela de brindes, a hora das máquinas financiadas ou a config 3D: são as sete decisões acima.
