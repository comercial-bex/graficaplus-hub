# Diagnóstico final — Bex Print, 29/10/2026

Medido hoje, entre 20h e 21h30 (Macapá), no banco de produção e na tela publicada. Nenhum dado foi alterado: os testes que gravam rodaram dentro de transações desfeitas, e o contador de OS foi devolvido ao valor de antes (215).

## 1. A nota

**Geral: 46%.** Cada verificação vale um ponto. São 70 pontos: 32 estão feitos.

| Camada | Nota | O que falta | Quem fecha |
|---|---|---|---|
| Sistema, o que depende de código | **74%** (20 de 27) | 7 ajustes pequenos | Eu |
| Operação, o que depende de uso e de dados | **30%** (6 de 20) | 14 hábitos e cadastros | Equipe |
| Decisões do dono | **26%** (6 de 23) | 17 decisões abertas | Você |

Em uma frase: **o que eu controlo está quase pronto; o que segura os 100% é o uso diário da equipe e 17 decisões suas.** A maior alavanca é uma só: o fechamento da OS (seção 6).

## 2. A analogia: a cozinha nova

Pense numa cozinha de restaurante que acabou de ser montada.

| Na cozinha | No sistema | Estado |
|---|---|---|
| Bancadas, fogão, encanamento e fiação | Preço, orçamento, pagamento, OS, agenda, avisos | Montados e testados: 74% |
| A comanda do garçom | O orçamento | Sai com forma de pagar, divisão e data de entrega |
| O couvert pago na mesa | O sinal em Pix | A comanda só vai para a cozinha depois que o couvert é marcado |
| O cronômetro do fogão | A agenda de máquina | Corrigido hoje: media o prato por unidade, e o certo é por metro quadrado |
| O caderno da despensa | O estoque | Só anota o que entra: 51 entradas e 2 saídas. O vinil nunca foi contado |
| O ponto do cozinheiro | O apontamento de hora | 2 registros contra 38 impressões |
| Fechar a conta da mesa | Fechar a OS | Exige seis carimbos e nenhuma das 18 mesas abertas tem todos |
| O relógio do salão | O relógio do banco | Marca a hora de Londres: das 21h à meia-noite ele diz que as mesas de amanhã já atrasaram |
| O cardápio | As regras de preço | 17 itens esperando o dono |

A cozinha funciona. O que falta é a equipe cozinhar nela do jeito novo e o dono fechar o cardápio.

## 3. Sistema: 27 verificações, 20 feitas

| # | Verificação | Resultado | Evidência de hoje |
|---|---|---|---|
| 1.1 | Contato novo do WhatsApp entra como lead sem ruído | Falta | 6 dos 17 leads são telefones da própria equipe e 3 já eram clientes cadastrados |
| 1.2 | Aviso de contato novo parado | Falta | Não existe. Dos 21 avisos do painel nenhum olha o lead |
| 2.1 | Preço por área exato | Feito | 41 itens por área: nenhum novo fora da conta; 2 seguem a área mínima; 6 antigos mantidos como o cliente viu |
| 2.2 | Condição de pagamento obrigatória e completa | Feito | 3 de 3 orçamentos criados depois da regra |
| 2.3 | Data de entrega: pendência e prazo padrão na OS | Feito | Ensaio com quatro casos |
| 2.4 | Item sem produto e sem custo avisa antes do pagamento | Feito | O 153 mostra o aviso na tela publicada |
| 3.1 | PDF e link corretos | Feito | PDF real com peça miúda: "R$ 0,075" e "R$ 9,00" |
| 3.2 | Aprovado vira OS com o valor aprovado | Feito | 19 de 19 sem divergência |
| 4.1 | Conta, parcelas, OS e orçamento no mesmo valor | Feito | 19 contas, 0 divergências, 0 parcela sem vencimento |
| 4.2 | Pix só converte depois de marcado | Feito | O 142 foi recusado hoje por isso |
| 4.3 | Avisos de vencimento no fuso de Macapá | **Falta** | Às 21h10 o painel mostrava 9 OS atrasadas e 2 parcelas vencidas. A real: 1 e 0 |
| 5.1 | OS nasce com prazo | Feito | Hoje |
| 5.2 | OS nasce com horário na máquina | Feito | Simulado na OS 212: 20 min no recorte |
| 5.3 | Agenda divide item maior que um dia | Falta | Item acima de 600 min só recebe a mensagem certa |
| 5.4 | Aviso de OS sem horário enxerga produto sem máquina | Falta | O aviso conta 1; 8 OS abertas estão sem reserva |
| 6.1 | Apontamento e custo cheio funcionam | Feito | Funções testadas; 2 usos reais |
| 6.2 | Flexi: importar e sugerir vínculo | Feito | 38 jobs, 19 sugestões geradas |
| 7.1 | Entrada, reserva e baixa de estoque funcionam | Feito | 51 entradas, 2 saídas ligadas a OS, reserva parcial detecta a falta |
| 8.1 | Retirada registra a saída e fechar diz o que falta | Feito | Simulado na OS 212 e nas 18 OS abertas |
| 8.2 | Entrega e instalação nascem quando o pedido pede | Feito | Simulado hoje: nasce "entrega, agendada" |
| 9.1 | Telas abrem sem erro | Feito | 58 de 58, sem nenhuma chamada com erro |
| 9.2 | Números da home batem com o banco | Feito | Vendido R$ 11.996,05, recebido R$ 5.170,74, concluído R$ 121,15 |
| 9.3 | Rotinas e fila de avisos saudáveis | Feito | 4 de 4 rotinas, 0 falhas, 37 avisos enviados |
| 9.4 | Acesso fechado | Feito | RLS em todas as tabelas; nenhuma função sem search_path |
| 9.5 | Gatilhos fechados ao público | Falta | 3 funções de gatilho com EXECUTE aberto, sem exposição real |
| 9.6 | Migrações aplicadas, testes e CI | Feito | Das migrações desde 22/10: 63 de 63 funções e 10 de 10 gatilhos existem no banco; 3.092 testes; CI verde |
| 9.7 | Sem coluna morta | Falta | `status_arte`: nada lê nem escreve |

## 4. Operação: 20 verificações, 6 feitas

A coluna "causa" separa o que ninguém tentou, o que não tem como funcionar e o que falha calado.

| # | Verificação | Resultado | Evidência de hoje | Causa |
|---|---|---|---|---|
| 1.1 | Contatos novos atendidos | Falta | 8 contatos de verdade, 5 deles há mais de 3 dias, nenhum com responsável nem próxima ação | Adoção |
| 1.2 | Conversas ligadas a cliente | Falta | 15 de 28 (descontadas 6 da equipe) | Adoção |
| 1.3 | Clientes ativos com contato | Feito | Nenhum sem telefone nem e-mail | |
| 2.1 | Orçamentos novos seguem as regras | Feito | 3 de 3 | |
| 2.2 | Rascunhos não ficam esquecidos | Falta | 7 de 8 com mais de 14 dias, R$ 5.606,49 parados | Adoção e decisão de preço |
| 3.1 | Aprovado vira OS | Falta | 7 sem OS: 142 espera o Pix, 153 espera os itens, 5 antigos aguardam o dono | Adoção e decisão |
| 3.2 | Enviado sem resposta é seguido | Falta | 4 parados há mais de 7 dias | Adoção |
| 3.3 | Pix marcado antes de converter | Feito | 3 de 3 conversões em Pix de hoje; a quarta foi "a faturar" | |
| 4.1 | Pagamento cai na parcela | Feito | 0 soltos | |
| 4.2 | Parcela vencida é cobrada | Feito | 0 vencidas de verdade | |
| 5.1 | Produto tem máquina padrão e tempo | Falta | 12 sem máquina e 14 sem tempo, de 46 produtos | Cadastro |
| 5.2 | OS anda | Falta | 8 paradas há mais de 5 dias; 6 já pagas ainda em "entrada" | Adoção |
| 5.3 | Material previsto e reservado | Falta | 5 sem previsto; 7 esperando material | Estoque sem entrada |
| 5.4 | Aceite da arte registrado | Falta | 1 de 18 OS. Os dois caminhos existem: link do cliente e aceite registrado pela equipe | Adoção |
| 6.1 | Hora de máquina apontada | Falta | 2 apontamentos contra 38 impressões; o último é de 23/10 | Adoção |
| 6.2 | Flexi em dia e vínculos confirmados | Falta | 0 de 19; a última importação é de 24/10 | Adoção |
| 7.1 | Estoque inicial confiável | Falta | Vinil: 0 nos 4 tipos. 45 de 64 materiais com saldo, mas só 2 saídas registradas | Adoção |
| 7.2 | Inventário feito | Falta | Nenhum | Adoção |
| 8.1 | OS cumpre os critérios para fechar | Falta | 0 de 18; 1 fechada de 19 | Adoção e desenho |
| 9.1 | Avisos ao cliente saem | Feito | Fila sem falha | |

## 5. Decisões do dono: 23, com 6 resolvidas

Abertas, da mais antiga para a mais nova (todas aparecem no painel inicial, em "Decisões do dono"):

1. Acréscimo de frente e verso
2. Convenção da bainha
3. Fila de produção no expresso
4. Prazo de reposição dos rolos
5. Rolo de vinil mais largo que 1,06 m
6. Tempos reais de mão de obra
7. Materiais dos sete produtos da tabela
8. Pix automático: API do banco e aviso de pagamento
9. Lona 440 g acima de 6 m²: margem de 25,7%, abaixo do mínimo de 35%
10. 3D: mão de obra e custo indireto zerados na calculadora
11. Banner: a tabela diz R$ 110/m² e a equipe vende a R$ 40/m²
12. Brindes gravados: margem de 10 a 30%, o markup da casa é 60%
13. Chaveiro acrílico: 500 un a R$ 4,45, sem faixa de volume
14. Impressoras 3D: 150 W no cadastro e 500 W na calculadora
15. Laser CO2 e Fiber: hora cobrada pela depreciação, e a parcela do financiamento é maior
16. Seis produtos ativos usam material que a gráfica não tem
17. Cinco orçamentos impressos sem virar OS: registrar retroativo ou deixar como histórico

Fora da lista, a varredura trouxe mais uma que precisa de você: **como fechar a OS** (seção 6).

## 6. O que a varredura achou de novo

**Fechar a OS exige seis coisas e nenhuma das 18 OS abertas cumpre todas.** Simulei o fechamento das 18 dentro de uma transação desfeita. Quantas OS ficaram travadas por cada motivo:

| Motivo | OS travadas |
|---|---|
| Custo operacional lançado, que sai do apontamento de hora | 16 |
| Qualidade aprovada | 12 |
| Arquivo final do layout | 11 |
| Pagamentos em dia | 9 |
| Material baixado | 7 |
| Medidas dos itens | 5 |

Por isso o painel diz que só 1 de 19 OS foi concluída: o resto está vendido, pago e muitas vezes entregue, mas "parado no quadro". A OS 212 mostra o ponto: o cliente pagou tudo e retirou, e ainda assim não fecha, porque ninguém baixou o material nem lançou o custo da máquina. **Decisão do dono:** manter a exigência e treinar a equipe, ou deixar o sistema fechar com o previsto quando ninguém apontou, marcando o resultado como estimado.

**O relógio do banco está em UTC.** Pelo menos 23 funções e visões comparam datas com `current_date`, que é a data de Greenwich. Entre 21h e meia-noite em Macapá o "hoje" delas vira "amanhã". O efeito visível: o aviso de OS atrasada comparava a data com o horário e antecipava em um dia (9 contra 1), e as parcelas "vencidas" também (2 contra 0). A mesma causa pode datar um estorno de pagamento com o dia seguinte.

**O estoque só conhece entradas.** 51 entradas e 2 saídas desde maio. Sem a baixa na conclusão da OS, o saldo de quem tem saldo tende a ficar maior que o real, e o vinil, que nunca teve entrada, mostra zero nos quatro tipos.

**Leads têm ruído.** Dos 17 leads novos, 6 são telefones da própria equipe e 3 já eram clientes. Sobram 8 contatos de verdade: 5 com mais de 3 dias e 4 com mais de 7, nenhum com responsável nem próxima ação.

**A arte só tem aceite em 1 das 18 OS.** Há 5 OS já em produção ou retirada sem aceite registrado.

**Rascunhos antigos guardam R$ 5.606,49** em 7 orçamentos que nunca foram enviados.

**O que já estava redondo e foi conferido de novo:** preço por área exato, condição de pagamento, prazo da OS, conta e parcelas batendo com a OS nos 19 casos, PDF com peça miúda, entrega e instalação, Pix só converte marcado, 58 telas sem erro, números da home iguais ao banco, 63 funções e 10 gatilhos aplicados, testes e CI verdes.

## 7. O caminho para 100%

1. **Eu, em uma sessão: os 7 ajustes de sistema** (74% para 100%, o geral vai a 56%).
   - Data no fuso de Macapá nas 23 funções e visões, com ensaio de cada uma.
   - Lead: ignorar telefone da equipe, ligar ao cliente já cadastrado e avisar contato novo parado.
   - Fechar o EXECUTE aberto dos 3 gatilhos.
   - Agenda: dividir o item maior que um dia em partes.
   - Aviso de OS sem horário incluir produto sem máquina, e um aviso próprio para produto sem máquina padrão.
   - Remover a coluna morta `status_arte`.
2. **Você: a decisão do fechamento da OS.** É a que mais move a nota da operação.
3. **Você: as 17 decisões**, começando pelas que destravam número: os cinco impressos sem OS, banner, lona, brindes e hora de máquina.
4. **Equipe: quatro rotinas.**
   - Por pedido: marcar o Pix, converter, registrar o aceite da arte, mover a OS, apontar a hora, baixar o material e fechar.
   - Por semana: importar a Flexi e confirmar os vínculos, seguir os orçamentos parados e limpar os rascunhos.
   - Uma vez: máquina e tempo dos 12 a 14 produtos, e a contagem do vinil e do estoque.
   - Contatos: atender os 8 contatos novos e ligar as conversas aos clientes.

## 8. Como medi e o que não medi

- Banco: consultas só de leitura, mais ensaios dentro de transações desfeitas (fechamento, retirada, entrega, conversão). O contador de OS foi devolvido após cada ensaio que criava OS.
- Telas: 58 páginas abertas no sistema publicado (48 telas e 10 detalhes de OS, cliente e orçamento), com leitura do status de todas as chamadas. O único ruído foi de transição visual do navegador, porque a janela estava oculta.
- Números de painel conferidos contra o banco: vendido, recebido e concluído.
- Não medi: uso no celular, desempenho com muitos dados, e o que a equipe faz fora do sistema.
- A nota é uma fotografia das 21h de 29/10. A equipe converteu 4 OS hoje e os números continuam andando.
