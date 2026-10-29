# Auditoria orçamento a orçamento — 29/10/2026

Pedido do dono: conferir como o sistema está se comportando depois das condições de pagamento (28/10), se falta algo, testar de verdade; e rever TODOS os orçamentos já feitos, um a um, contra o motor de preço atual (máquinas, horas, área em cm × m², estoque de vinil), mesmo os já entregues — para corrigir a conta e não errar de novo.

O que foi lido: os 52 orçamentos da base (cerca de 80 itens), as 28 OS (161–174 de venda; 175–187 são jobs importados da Flexi; 44 é 3D antigo), os 38 jobs impressos registrados pela Flexi (RIP da i1600, 23/09 a 24/10), os 2 apontamentos de máquina, a tabela de custos e o histórico dela, as fichas de material, o estoque e as movimentações, e o código vivo dos gatilhos de preço e da conversão em OS.

## 1. Resumo

| Achado | Tamanho | O que foi feito |
|---|---|---|
| **Brecha na condição de pagamento**: escolher só a forma (Pix) contava como "condição completa", porque todo orçamento nasce com `parcelas: 1`. O 152 saiu assim hoje às 9h14: o Pix pediu 50%, o PDF e o link diziam "1x", a conta a receber nasceria com uma parcela do total. | 4 orçamentos abertos (134, 146, 150, 152) | Tela e banco exigem a divisão escolhida (PR #282, migração `20261029200000`, no ar). Os 4 receberam `modelo = 50% + 50%` — é o que o cliente recebeu no Pix. |
| **Área da peça arredondada em 3 casas antes do preço** (0,001 m² = 10 × 10 cm): adesivo de 5 × 5 cm pagava 20% a mais; abaixo de 2,2 × 2,2 cm o preço virava ZERO. | 7 itens vendidos por m² afetados, R$ 5,02 a mais no total histórico; ainda abertos ou sem OS: 115 (+R$ 3,21), 150 (+R$ 1,80) e 152 (+R$ 0,02) | Área exata ao mm² nos 3 gatilhos e no front (migração `20261029100000`, no ar); total da linha em centavos; PDF escreve "R$ 0,075" quando o unitário em centavos não fecha. Ensaio: 120 × 5 × 5 cm a R$ 30 = R$ 9,00 (era 10,80); 1.000 × 1 × 1 cm = R$ 3,00 (era 0). |
| **Produção fora do sistema**: a Flexi prova 13 jobs que batem em medida, cópias e data com orçamentos que nunca viraram OS — 5 "rejeitados" (54, 56, 57, 62, 70) e o 115 (parceiro Yvens, 7 itens, impresso 24/10, ainda "enviado"). Sem OS, sem conta a receber, sem baixa de material. | R$ 245,71 (os 5) + R$ 366,00 (115) | Os 5 eram "aprovados" que **eu** marquei como rejeitados em 26/10 achando que eram clientes de teste — eram reais (Max Lima tem 7 orçamentos e 3 OS). Voltaram para "aprovado" com nota interna; decisão `orcamentos_produzidos_sem_os` para o gestor. |
| **Estoque de vinil**: estoque 0, mínimo 39,75 m², NENHUMA movimentação em toda a história, nenhuma contagem registrada. O sistema não sabe quanto vinil existe nem quanto saiu. | — | Não dá para corrigir por SQL: precisa contar as bobinas. A Flexi diz o que a i1600 imprimiu (cerca de 5 m² de adesivo e 29 m² de lona desde 23/09, aproximado); o recorte (plotter) não passa pela Flexi. Ver seção 7. |
| **Horas de máquina**: 2 apontamentos em todo o sistema (OS 165 laser 0 min; OS 169 i1600 1.000 min) contra 38 jobs impressos. A hora da i1600 pela Flexi: 34 m² ÷ 14 m²/h ≈ 2,4 h desde 23/09. | — | Só diagnóstico. O custo de máquina real da OS depende do apontamento, e ele não é feito. |
| **Mão de obra mudou em 25 e 27/10** (R$ 40/h + 80% → R$ 9,21/h + 32,19%): o custo gravado nos orçamentos de antes é o antigo. O 69 guarda custo R$ 2.934 onde o motor de hoje dá R$ 1.822. | 29 orçamentos até 25/10 | Preço não muda (é tabela); só a margem gravada mente. A tabela da seção 4 traz a margem recalculada hoje. |
| cm × m²: a única medida trocada é a já conhecida (98 → OS 168: 0,95 m onde era 9,5 cm, 54 m²). O 38 tem altura 0,1 onde era 1,0 (R$ 28 = 0,7 m² × 40, conta feita à mão). Nenhum caso novo. | 2 | 168 já cobrada do gestor em 28/10; 38 é rejeitado antigo. |

## 2. Teste real do que está no ar (condições de pagamento)

**Como se comportou.** O vendedor abriu o 152 às 9h14, escolheu Pix, mandou o orçamento com o QR Code de R$ 35,73 (50%) e o cliente aprovou pelo link às 9h35. A conversão automática recusou corretamente ("Sinal em Pix ainda não marcado como recebido"). Até aí, certo. O que estava errado: a condição gravada era `{forma: PIX, parcelas: 1}` — sem divisão — e a tela não mostrava o aviso "obrigatório", porque `condicaoCompleta` aceitava forma + `parcelas`, e `parcelas: 1` é o valor de nascença. Se o Pix fosse marcado como recebido, a OS nasceria com UMA parcela de R$ 71,46 vencendo hoje, enquanto o cliente pagou 50% combinando o resto na entrega.

**Prova no banco (ensaio com rollback, orçamento 132 de teste):** forma Dinheiro + `parcelas: 1` sem modelo → `converter_orcamento_em_os` recusa com "Orçamento sem condição de pagamento: combine a forma … e como divide". O 132 continua rascunho com a condição de ontem (entrada 30%). Nenhum número de OS foi consumido (última OS segue 187).

**O que ficou implementado e conferido:** os quatro modelos na tela; entrada em % ou R$; padrão da casa 50/50; PDF e link por extenso; Pix do sinal pelo combinado; conta a receber com entrada + saldo; recusa no banco. **O que faltava:** a régua "forma + divisão" tinha o furo acima — fechado hoje nas três portas (pendência de envio, conferência antes de converter, RAISE no banco).

**O que ainda não existe (não é defeito, é escolha a fazer):** a confirmação do Pix continua manual ("O Pix chegou"); decisão `pix_automatico_api_banco` segue aberta desde 25/10.

## 3. Motor de preço: área em cm virando m² (o erro de arredondamento)

Os gatilhos `tg_item_precificar_por_area` (orçamento), `tg_item_os_precificar_por_area` (OS) e `tg_orcamento_item_custo_do_produto` (custo) faziam `round(largura × altura, 3)` antes de multiplicar pelo preço. Três casas de m² é 0,001 m² — um quadrado de 10 × 10 cm. Para banner e lona não muda nada; para adesivo pequeno muda tudo:

| Peça | Área real | Área que entrava | Erro no preço |
|---|---|---|---|
| 5 × 5 cm | 0,0025 m² | 0,003 | +20% (115, item 6: 120 un a R$ 30 → R$ 10,80 em vez de R$ 9,00) |
| 6 × 6 cm | 0,0036 | 0,004 | +11% (115, item 4) |
| 21 × 5 cm | 0,0105 | 0,011 | +4,8% (150: R$ 37,50 em vez de R$ 35,70) |
| 11 × 7 cm | 0,0077 | 0,008 | +4% (115, item 3) |
| 2 × 2 cm | 0,0004 | 0,000 | preço ZERO |

Soma no histórico, nos 7 itens vendidos por m² que a conta atinge: R$ 5,02 a mais para a gráfica (um deles, o 56, saiu R$ 0,01 a menos). O problema não é o dinheiro de ontem; é mil etiquetas de 2 cm saírem de graça amanhã. A tela de medidas também escondia o erro: mostrava "0,00 m²" para a peça de 5 × 5 cm. Agora mostra "25 cm²".

Correção (no ar): área exata ao mm² (6 casas) nos três gatilhos e em `area.ts`; o total da linha é arredondado uma vez, em centavos; o unitário (coluna numeric 12,2, com 6 views dependendo dela — o tipo não foi mexido) é o total ÷ peças, e o PDF escreve "R$ 0,075" quando o unitário em centavos não reproduz o total. Faixa de parceiro acima de X m² segue igual. As colunas geradas `area_unitaria/area_total/area_cobrada` continuam com 3 casas (são de exibição e de consumo de material; seis views dependem delas) — o consumo de vinil de etiqueta miúda fica um pouco superestimado, nada mais.

Itens já gravados **não** mudam sozinhos (o gatilho só roda na escrita): 115, 150 e 152 continuam com o valor que o cliente viu. O 150 e o 152 estão aprovados e com Pix de 50% enviado: não mexi.

**Efeito colateral que achei e corrigi no mesmo dia (PR #286, migração `20261029300000`).** Um ensaio com rollback, inserindo na OS os itens como a conversão faz, mostrou que a conta nova mudaria o preço desses itens antigos ao converter: o 150 passaria de R$ 37,50 para R$ 35,70, o 152 de R$ 71,46 para R$ 71,44 e o 115 perderia R$ 3,21. A OS e a conta a receber, que copia o total do orçamento, passariam a discordar. O mesmo aconteceria se alguém mexesse só na arte ou na descrição do item, porque o gatilho recalcula a cada UPDATE. Agora o item da OS copia o do orçamento ao nascer, e nenhum dos dois gatilhos recalcula num UPDATE em que nenhuma entrada do preço mudou (preço por m², largura, altura, quantidade, área mínima, produto). Refeito o ensaio: os nove itens chegam à OS com o valor aprovado; mexer só na descrição do 150 mantém R$ 37,50; mudar a quantidade recalcula pela conta nova. O painel do parceiro também passou a calcular o total por área como o banco (área exata × peças × preço), porque o teste dele é espelhar o pedido gravado.

## 4. Orçamento por orçamento

Legenda: *margem hoje* = (preço − custo cheio do motor de hoje) ÷ preço, com mão de obra R$ 12,17/h, rateio R$ 12/h e as máquinas atuais. "Flexi" = job impresso na i1600 com a mesma medida/cópias.

| Nº | Situação | Cliente · item | Valor | O que achei | Ação |
|---|---|---|---|---|---|
| 1 | convertido → OS 44 | Urna e gatinho 3D | 121,15 | 3D antigo, concluído | — |
| 36 | rejeitado | john terry · banner 0,5×0,6 + adesivo 1,1×1,1 | 45,00 | aprovado em 13/10; sem produto (custo 0); sem prova na Flexi | fica rejeitado |
| 38 | rejeitado | Max Lima · banner 0,7×**0,1** | 28,00 | altura 0,1 é 1,0 (R$ 28 = 0,7 m² × 40): medida errada no registro; sem prova | fica rejeitado; exemplo do erro cm×m |
| 39 | rejeitado | Debora Martins · bola 33 ×30, bolão 48 ×20 | 609,00 | preço da faixa de 100 un aplicado a 30/20 un (não há faixa abaixo de 100) | decidir preço avulso dos adesivos de carroceria |
| 54 | rejeitado → **aprovado** | john terry · adesivo 10,3×3 cm ×137 | 15,07 | **Flexi 24/09**: "adesivo canetas" 3×10,5 ×64; sem OS, custo 0 | voltou para aprovado; decisão do gestor |
| 55 | convertido → OS 166 | banner 0,8×1,2 | 38,40 | R$ 40/m² (tabela 110); sem produto; **impresso 24/09 e de novo 21/10**; OS 166 está em "entrada" | OS parada no kanban; ver decisão banner 40×110 |
| 56 | rejeitado → **aprovado** | john terry · 3 banners + adesivo | 120,91 | **Flexi 28/09**: todos os 4 itens impressos; 3 sem produto | voltou para aprovado |
| 57 | rejeitado → **aprovado** | Max Lima · banner 0,6×0,9 | 21,60 | **Flexi 28/09** | voltou para aprovado |
| 61 | convertido → OS 163 | faixa 5×1,5 ×2 | 1.050,00 | sem produto (custo 0 no item; a OS tem R$ 274,52 previsto); não aparece na Flexi (terceirizado? não impresso?) | ligar a LON-440; conferir se foi produzido |
| 62 | rejeitado → **aprovado** | Max Lima · 2 banners | 57,60 | **Flexi 30/09**: os dois | voltou para aprovado |
| 65 | rejeitado | Dani Muniz · acrílico 0,8×0,47 | 300,80 | substituído pelo 67 no mesmo dia (OS 165) | ok |
| 67 | convertido → OS 165 | acrílico 3 mm, 3 peças | 680,00 | margem hoje 46,6%; custo 0 nos itens; apontamento do laser com 0 min | refazer apontamento; custo nos itens |
| 69 | rascunho (05/10) | PLACAS · 5 itens | 2.100,00 | **quadro acrílico 13 × 0,25 m² a R$ 89,90: custo hoje R$ 119,38 a peça → −32,8%**; custo gravado R$ 2.934 (MO antiga; hoje R$ 1.822); rascunho de 24 dias | reprecificar ou expirar |
| 70 | rejeitado → **aprovado** | Max Lima · banner 0,6×0,9 + adesivo | 30,60 | **Flexi 06/10** | voltou para aprovado |
| 71 | convertido → OS 167 | Amapuera · brindes | 745,00 | margens 10–19% (copos 18,9%, kit 10,2%); compra não lançada | decisão de brindes (28/10) |
| 72 | rejeitado | necessaire | 39,90 | margem 25% | — |
| 73 / 75 | convertidos → OS 161/162 | chaveiros 200 / 100 | 1.200 / 700 | margem 53% / 60%; sem medida; sem ficha | esperar medida (cobrada 27/10) |
| 78 | convertido → OS 164 | banner "terceirizado" 1,15×1,7 | 78,20 | **impresso na própria i1600 em 10/10** (não era terceirizado); OS 164 em "design" até hoje | mover a OS; ligar a BAN-LON |
| 80, 83–87 | rascunhos 3D (13–14/10) | brinquedos, ET, máscara | 44 a 1.240 | 3D sem mão de obra/rateio (decisão de 28/10); 15 dias parados | expirar ou reprecificar |
| 82 | enviado (13/10) | mali · adesivos 3×0,2 e 2×0,2 | 77,00 | preço de tabela; sem condição; 16 dias sem resposta | cobrar ou expirar |
| 98 | convertido → OS 168 | DTF 0,95×0,95 ×60 | 300,00 | **0,95 m onde era 9,5 cm (54 m²)**; pago; prazo 22/10 vencido | cobrado do gestor em 28/10 |
| 99 | enviado (21/10) | Griff · acrílico espelhado 25×4 cm | 100,00 | mínimo 0,1 m² × R$ 1.000 — certo | — |
| 101 | rejeitado | chaveiro Mario 40 × 3,38 | 135,20 | substituído pelo 112 (OS 172) | ok |
| 105 | enviado (21/10) | Aline Lima · banner 1×2 ×2 | 440,00 | R$ 110/m² certo pela tabela; sem produto; 7 dias sem resposta | ligar produto; cobrar |
| 106 | convertido → OS 174 | Alantec · adesivo recortado 0,6×0,8 | 32,64 | margem 68%; aguardando arte | — |
| 107 | enviado (22/10) | Max Lima · lona 0,8×1,2 | 28,80 | R$ 30/m² (tabela 45 a 70); **impresso em 21/10, um dia ANTES do orçamento**; sem produto | regularizar (virou pedido?) |
| 108 | convertido → OS 169 | Andre · lona 440 6,5 + 3,25 m² | 682,50 − 40% = 409,50 | impresso 22/10 (Flexi bate); **apontamento 1.000 min**; OS em "entrada"; pago | corrigir apontamento (~45 min) |
| 110–114 | convertidos → OS 170–173 | Mario 3D | 71 a 293 | preço = 2 × custo sem MO/rateio (chaveiro R$ 1,78) | decisão 3D |
| 115 | enviado (23/10) | Yvens (parceiro) · 7 itens | 366,00 | **impresso 24/10 (3 jobs batem: 60 un 15×8, 54 un 11×7, 50 un 20×15) sem virar OS**; itens 5 e 6 sem produto a R$ 30/m²; arredondamento +R$ 3,21 | converter em OS ou registrar; nova decisão |
| 132 | rascunho (teste) | Teste 03 | 123,20 | laboratório dos ensaios | — |
| 134 | enviado (26/10) | Itainara · acrílico espelhado 1×0,5 | 500,00 | Pix de R$ 250 enviado 27/10, sem resposta; **agora 50% + 50%** | lembrar o cliente |
| 136–140, 142 | rascunhos (26/10) | kits Reintegrar 3D; 142 + 400 chaveiros a 7,00 | 214 a 4.397 | 3D sem MO/rateio; chaveiro acima da tabela (6,50) | decisão 3D; 148/149 expirados são cascas |
| 146 | **aprovado 29/10** | Nilde · 500 chaveiros a 4,45 | 2.225,00 | abaixo da tabela (6,50), margem 37%; Pix de R$ 1.112,50 enviado 27/10; **agora 50% + 50%**; conversão espera "O Pix chegou" | conferir o Pix; faixas do chaveiro |
| 150 | aprovado 28/10 | Marcela · adesivo recortado 21×5 cm ×50 | 37,50 | arredondamento +R$ 1,80 (certo seria 35,70); Pix 18,75 enviado; **agora 50% + 50%** | não mexi (Pix já enviado) |
| 151 | enviado (28/10) | Nilde · A4 ×50 a 3,00 + expresso 12% | 168,00 | acima da tabela (2,50) | — |
| 152 | **aprovado 29/10** | Alan Paulo · lona 280 0,81×0,98 ×2 | 71,46 | saiu com forma Pix sem divisão (a brecha); Pix 35,73 enviado; cliente aprovou 9h35; **agora 50% + 50%** | marcar "O Pix chegou" quando cair → vira OS com 35,73 + 35,73 |

Orçamentos sem nenhum problema de conta: 1, 65, 72, 99, 101, 106, 151.

## 5. Flexi × orçamentos: o que foi impresso e não virou OS

| Impresso em | Job (cm × cópias) | Orçamento | Situação do orçamento |
|---|---|---|---|
| 24/09 | adesivo canetas 3×10,5 ×64 | 54 | aprovado sem OS (voltou hoje) |
| 24/09 e 21/10 | Banner Lona Fina 120×80 | 55 → OS 166 | OS em "entrada" |
| 28/09 | BANNER 50×60 ×3, 80×60, 100×80, ADESIVO 52×11 | 56 | aprovado sem OS (voltou hoje) |
| 28/09 | Banner lona 90×60 | 57 | aprovado sem OS (voltou hoje) |
| 30/09 | Banner lona 45×80 e 120×90 | 62 | aprovado sem OS (voltou hoje) |
| 06/10 | Banner Lona Fina 90×60 | 70 | aprovado sem OS (voltou hoje) |
| 10/10 | Banner 115×170 | 78 → OS 164 | OS em "design" |
| 21/10 | Lona 280 120×80 | 107 | só "enviado" (impresso antes do orçamento) |
| 22/10 | 500×130 e 250×130 | 108 → OS 169 | OS em "entrada" |
| 24/10 | 60 un 15×8, 54 un 11×7, 50 un 20×15 | 115 | só "enviado" |

Dos 38 jobs, a tela sugeriu orçamento para 18 (alguns só por medida parecida: a equipe confirma), 1 ficou para escolher e 19 não têm candidato (provas, trabalhos sem orçamento, ou medidas diferentes — "Otimizar Distribuição" 146×120, "99,5×222", "122×140", "81,8×200"…). A tela Importar Flexi tem o botão de sugerir vínculos e ninguém usou: `rip_job_vinculos` está vazia. Rodei a sugestão hoje (ver seção 8) para a equipe confirmar job a job.

## 6. Máquinas, horas e custo

- **Apontamentos**: 2 em toda a base (OS 165: laser aberto e fechado em 3 s; OS 169: i1600 fechada no teto de 1.000 min). Os outros 36 jobs impressos não têm tempo de máquina registrado, então `custo_real` das OS é zero em todas.
- **Hora da i1600 pela Flexi**: cerca de 34 m² em 38 jobs ÷ 14 m²/h = cerca de 2,4 h de impressão desde 23/09 (≈ R$ 37 de máquina + energia; aproximado, porque jobs aninhados numa folha contam duas vezes).
- **Mão de obra**: R$ 40/h + 80% até 25/10; R$ 10,65 em 25/10; R$ 9,21 + 32,19% desde 27/10. Todo custo gravado antes de 25/10 está inflado (69: R$ 2.934 → R$ 1.822 hoje; 71: R$ 535 → R$ 634 porque o custo digitado dos brindes subiu). O preço de venda não depende disso.
- **Máquinas**: iguais à auditoria de 28/10 (i1600 R$ 14,43/h locada; CO2 R$ 6,70/h e Fiber R$ 4,64/h pela depreciação — decisão aberta; 3D R$ 0,60–1,35/h; potência 3D 0,15 kW no cadastro × 0,5 kW na calculadora — decisão aberta).

## 7. Estoque de vinil

- `Vinil adesivo branco brilho`: estoque **0**, mínimo 39,75 m², bobina 1,06 × 50 m. **Nenhuma** entrada ou saída registrada — nem a compra da bobina. `estoque_inventarios` está vazia: nunca houve contagem.
- Previsto em OS: só a 174 (0,528 m²). Nenhuma OS com vinil foi concluída, então a baixa na conclusão nunca rodou.
- Consumo real que o sistema consegue medir, em valor aproximado (a separação adesivo × lona é pelo nome e pelo tamanho do job, e jobs aninhados numa folha contam duas vezes): Flexi, cerca de 5 m² de adesivo (1,4 em setembro, 3,6 em outubro) e cerca de 29 m² de lona e banner. O recorte (plotter de recorte) não passa pela Flexi — OS 174 e orçamento 150 são recorte.
- Ou seja: o "vinil andando baixo" não vem de nenhum número do sistema — a bobina está baixa no mundo real e o sistema diz zero porque ninguém contou. O que resolve: contar as bobinas (Estoque → inventário) e, daí em diante, concluir as OS (a baixa é na conclusão) e confirmar os vínculos da Flexi.

## 8. O que fiz hoje

**Código (PR #282 e PR #286, no ar):** área exata no preço por m² (3 gatilhos + `area.ts` + formulário + PDF); `condicaoCompleta` e (b4) exigem o modelo; peça miúda em cm² na tela de medidas; 13 testes novos/ajustados (`tests/area-exata-no-preco-por-m2`, `orcamentos-area`, `condicoes-de-pagamento`, `unidade-de-medida`, `orcamentos-tipos-de-produto`). O PR #286 acrescentou o preço gravado que não deriva (conversão copia o item aprovado, edição sem mudar o preço não recalcula) e o painel do parceiro na mesma conta do banco, com `tests/preco-gravado-nao-deriva`.

**Banco (migrações aplicadas e ensaiadas):** `20261029100000_area_exata_no_preco_por_m2`, `20261029200000_condicao_de_pagamento_exige_modelo` (função inteira, md5 igual ao vivo), `20261029300000_preco_gravado_nao_deriva`.

**Dados:** 134, 146, 150, 152 com `modelo = metade_metade`; 54, 56, 57, 62, 70 de volta a "aprovado" com nota interna (desfaz a virada errada de 26/10); decisão `orcamentos_produzidos_sem_os` registrada; sugestões de vínculo Flexi geradas pela tela.

**Avisos:** WhatsApp ao gestor (Raymison) com a lista de OS e orçamentos a corrigir, enfileirado em 29/10 às 12h20 (Macapá).

**O que não fiz de propósito:** não editei preço, medida, status de OS, apontamento nem itens de orçamento aberto (150 e 115 continuam com o valor antigo); não criei OS retroativa para os impressos sem OS; não mexi na tabela de brindes, no 3D, no banner 40 × 110 nem na hora das máquinas financiadas — são as decisões do dono (28/10) mais a nova de hoje.

## 9. Decisões e pendências

**Do dono:** (1) os 5 impressos sem OS + o 115: OS retroativa ou histórico? (2) as sete de 28/10 (3D, banner, materiais não comprados, hora financiada, potência 3D, brindes, faixas do chaveiro); (3) preço avulso dos adesivos de carroceria abaixo de 100 un (39).

**Do gestor (foi no WhatsApp):** contar o vinil e registrar o inventário; mover as OS 164, 166 e 169 no kanban (já impressas); corrigir o apontamento da 169 e refazer o da 165; conferir os Pix do 146 e do 152 e marcar "O Pix chegou"; regularizar o 107 (impresso antes do orçamento) e o 115 (impresso sem OS); confirmar os vínculos da Flexi na tela Importar Flexi; expirar ou reprecificar os rascunhos velhos (69, 80, 83–87, 136–142).
