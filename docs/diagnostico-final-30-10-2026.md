# Diagnóstico final — Bex Print, 30/10/2026 (segunda medição)

Medido em 30/10, entre 13h e 18h (Macapá), no banco de produção, depois de quatro pull requests e das decisões do dono tomadas por delegação. Mesmo método do diagnóstico de 29/10 (`docs/diagnostico-final-29-10-2026.md`): cada verificação vale um ponto, são 70, e o que falta é separado por quem fecha.

## 1. A nota

**Geral: 80%** (56 de 70), contra 46% em 29/10.

| Camada | 29/10 | 30/10 | O que falta | Quem fecha |
|---|---|---|---|---|
| Sistema, o que depende de código | 74% (20 de 27) | **100%** (27 de 27) | nada | |
| Decisões do dono | 26% (6 de 23) | **100%** (23 de 23) | nada | |
| Operação, o que depende de uso e de dados | 30% (6 de 20) | **30%** (6 de 20) | 14 hábitos e cadastros | Equipe |

Em uma frase: **tudo o que depende de código e de decisão está fechado. Os 14 pontos que faltam são trabalho do dia a dia que o sistema mostra e cobra, mas não faz por ninguém.** A operação não andou na nota porque duas coisas se compensaram: a conversa de cliente cadastrado passou a estar ligada ao cliente (1.2 passou), e dois orçamentos enviados hoje saíram sem a condição de pagamento (2.1 deixou de passar).

## 2. A analogia: a cozinha, um dia depois

Ontem a cozinha estava montada, o cardápio tinha 17 itens esperando o dono e a regra de fechar a conta exigia seis carimbos que ninguém dava.

Hoje o relógio do salão marca a hora de Macapá, as portas dos fundos estão trancadas, o recado do cliente cai no caderno certo e o dono do recado aparece sozinho quando alguém responde. O forno aceita pedido grande e o divide em turnos. A conta fecha sozinha quando o cliente retira e paga, com o carimbo "fechada com estimativa" quando faltou anotação. O cardápio está fechado.

O que falta é a equipe cozinhar nela do jeito novo: anotar a despensa, bater o ponto da máquina, registrar o aceite da arte e responder todo mundo que chama.

## 3. O que mudou entre as duas medições

| Mudança | Onde | Efeito medido |
|---|---|---|
| Um só relógio, `hoje_br()`, nas 22 funções, 8 visões e 4 padrões de coluna que liam a data de Greenwich; na tela, 22 usos de `toISOString().slice(0, 10)` trocados | #296 | Varredura em dois fusos de 59 visões e 102 funções de leitura: antes 5 respondiam diferente conforme o fuso, depois 0. OS atrasadas: 9 passou a 4 (a OS que vence hoje deixou de contar) |
| EXECUTE fechado em todas as funções de gatilho (4 estavam abertas ao anônimo); coluna morta `status_arte` removida; `search_path` das duas funções que faltavam | #296 e 20261030890000 | Gatilhos abertos 0; funções sem `search_path` 0 |
| Telefone da equipe não vira lead; o lead acompanha o atendimento (a primeira resposta humana o move e grava o responsável); aviso do contato encerrado sem resposta | #297 | Leads: 23 novos e 3 perdidos passaram a 4 novos, 10 em atendimento, 3 ganhos e 9 perdidos; conversas de cliente sem vínculo de 2 para 0 |
| A agenda divide o item que não cabe num dia; aviso do item que a agenda não consegue reservar | #298 | 300 min vai inteiro; 800 min vira 4 partes; 3.000 min vira 13 partes pulando o fim de semana; 20.000 min é recusado dizendo quanto precisa |
| Fechamento assistido da OS | #299 | Das 19 OS abertas de venda, as pagas e que saíram fecham; a 212 fecha ao registrar a retirada (custo 4,00, margem 89,33%, "fechada com estimativa") |
| Orçamento histórico fora do aviso e do lembrete diário; aviso do rascunho esquecido; aviso do orçamento enviado sem condição de pagamento | #299 | Aprovados sem OS de 7 para 2; rascunho esquecido: 7 de 8, R$ 5.606,49; enviados sem condição: 2 |
| As 17 decisões abertas e mais 3 que nasceram no caminho | #291 a #295 (outra sessão) e #299 | Decisões abertas no cartão: 26 registradas, 0 abertas |

## 4. O que a medição de hoje corrigiu no diagnóstico de ontem

Anotado para não ficar valendo o número errado:

- **"Nenhum aviso olha o contato novo" estava errado.** O aviso "Clientes esperando resposta no WhatsApp" já existia. O que faltava era o contato dado como resolvido sem nenhuma resposta (hoje, 4).
- **"Nenhum lead com responsável" lia o registro, não a conversa.** Na caixa do WhatsApp, 9 dos 14 contatos de verdade já tinham resposta humana e responsável; o lead nunca andava porque ninguém o atualiza. Agora ele anda sozinho.
- **"8 OS sem horário e o aviso vê 1"**: 4 eram impressão 3D (têm job), 1 era banner terceirizado, 1 estava pronta para retirada. Só 2 precisavam de cadastro (OS 168 e 214), e agora o aviso as lista.
- **As verificações 2.1 e 3.3 contavam orçamento de antes da regra.** Foram restritas aos criados depois dela (29/10 e 26/10). Com a definição certa, a 2.1 achou o que a de ontem não via: os orçamentos 157 e 158 foram ao cliente sem a condição de pagamento.
- **A decisão (b) dos cinco impressos sem OS tinha ficado só registrada.** Eles seguiam no aviso crítico e na mensagem das 9h ao gestor. Agora saem dos dois, sem mexer em status nem em dinheiro.
- **Fechar a OS tinha uma segunda causa.** Além dos seis registros, o gatilho de status só deixava admin e gestor mudar o status: quando o vendedor ou o operador registrava a retirada, a OS ficava presa em "aguardando retirada" e o erro era engolido como aviso.

## 5. Sistema: 27 verificações, 27 feitas

| # | Verificação | Evidência de hoje |
|---|---|---|
| 1.1 | Contato novo do WhatsApp entra como lead sem ruído | Ensaio com mensagens reais: telefone da equipe não cria lead, telefone novo cria; 6 leads da equipe marcados como perdidos com o motivo, 3 de cliente ligados e ganhos |
| 1.2 | Aviso de contato parado | `whatsapp_esperando_resposta` (já existia) e `whatsapp_encerrado_sem_resposta` (novo): 4 hoje |
| 2.1 | Preço por área exato | Inalterado desde 29/10; testes verdes |
| 2.2 | Condição de pagamento obrigatória e completa | A conversão recusa; hoje o aviso mostra o enviado sem condição |
| 2.3 | Data de entrega e prazo padrão na OS | Inalterado |
| 2.4 | Item sem produto e sem custo avisa antes do pagamento | Inalterado |
| 3.1 | PDF e link corretos | Inalterado |
| 3.2 | Aprovado vira OS com o valor aprovado | Inalterado |
| 4.1 | Conta, parcelas, OS e orçamento no mesmo valor | Inalterado |
| 4.2 | Pix só converte depois de marcado | Inalterado (o 142 segue recusado por isso) |
| 4.3 | Avisos de vencimento no fuso de Macapá | Varredura em dois fusos: 0 de 161 objetos dependem do fuso |
| 5.1 | OS nasce com prazo | Inalterado |
| 5.2 | OS nasce com horário na máquina | Inalterado |
| 5.3 | Agenda divide item maior que um dia | Ensaio nos quatro casos |
| 5.4 | Aviso de OS sem horário enxerga o item sem máquina | Aviso `item_sem_maquina_ou_tempo`: 2 itens de 24 |
| 6.1 | Apontamento e custo cheio funcionam | Inalterado |
| 6.2 | Flexi: importar e sugerir vínculo | Inalterado |
| 7.1 | Entrada, reserva e baixa de estoque funcionam | A baixa pela reserva agora também roda no fechamento |
| 8.1 | Retirada registra a saída e fechar diz o que falta | Mais que isso: a retirada fecha a OS paga; ensaio na 212, também como vendedor |
| 8.2 | Entrega e instalação nascem quando o pedido pede | Inalterado |
| 9.1 | Telas abrem sem erro | Reconferidas as telas alteradas depois do Publish (seção 9) |
| 9.2 | Números da home batem com o banco | Inalterado; "concluído" sobe quando a 212 fechar |
| 9.3 | Rotinas e fila de avisos saudáveis | 4 de 4 rotinas com a última execução ok, 0 falhas em 24 h; 18 de 18 avisos da semana enviados |
| 9.4 | Acesso fechado | 0 tabelas sem RLS; 0 funções SECURITY DEFINER sem `search_path`; 0 funções PL/pgSQL sem `search_path` |
| 9.5 | Gatilhos fechados ao público | 0 funções de gatilho executáveis por anônimo ou logado; trava no teste para as futuras |
| 9.6 | Migrações aplicadas, testes e CI | Todas as migrações de hoje aplicadas e iguais aos arquivos; typecheck limpo; testes e CI verdes |
| 9.7 | Sem coluna morta | `status_arte` removida (33 de 33 OS tinham o padrão; nada a lia) |

## 6. Decisões do dono: 23 de 23

O cartão "Decisões do dono" está vazio. As 17 abertas de 29/10 foram resolvidas em 30/10 por delegação, nos PRs 291 a 295, com a resposta e o valor de antes para desfazer em cada uma; três nasceram no caminho (piso por peça e minutos de pós-processamento do 3D, preço de tabela do banner próprio de R$ 64,90, e o fechamento da OS, que é a minha). Os efeitos em preço e cadastro foram aplicados no banco e conferem com o registrado.

## 7. Operação: 20 verificações, 6 feitas

Medidas por `docs/medicao-da-operacao.sql` (somente leitura; repetir quando quiser).

| # | Verificação | Feitos de total | Passou | O que fazer e quem |
|---|---|---|---|---|
| 1.1 | Contatos novos atendidos | 17 de 20 | Não | Responder ou marcar como perdido: Serafim Filho, Josi Chagas, Gratidão (o aviso lista) |
| 1.2 | Conversa de cliente cadastrado ligada ao cliente | 17 de 17 | Sim | |
| 1.3 | Clientes ativos com contato | 24 de 24 | Sim | |
| 2.1 | Orçamentos novos com condição de pagamento completa | 2 de 4 | Não | Preencher a condição e reenviar os orçamentos 157 e 158 |
| 2.2 | Rascunhos com menos de 14 dias | 1 de 8 | Não | Enviar, ajustar ou rejeitar os nº 69, 80, 83, 84, 85, 86 e 87 (R$ 5.606,49) |
| 3.1 | Aprovados que viraram OS | 19 de 21 | Não | 142: marcar "O Pix chegou" se o dinheiro entrou; 153: trocar os itens por produto do catálogo |
| 3.2 | Enviados com menos de 7 dias ou já respondidos | 4 de 8 | Não | Ligar para os 4 orçamentos parados |
| 3.3 | Conversões em Pix com o Pix marcado | 3 de 3 | Sim | |
| 4.1 | Pagamentos ligados a uma parcela | 10 de 10 | Sim | |
| 4.2 | Parcelas vencidas há mais de 3 dias que já foram pagas | 4 de 4 | Sim | |
| 5.1 | Produtos com máquina padrão e tempo | 24 de 46 | Não | Cadastrar máquina e tempo nos 22 (os de fora, terceirizados e revenda, ainda precisam ser separados) |
| 5.2 | OS abertas andando | 7 de 18 | Não | Mover as OS paradas; 6 pagas ainda em "entrada" |
| 5.3 | OS com material previsto e estoque | 1 de 18 | Não | Depende do estoque contado (7.1 e 7.2) |
| 5.4 | OS com o aceite da arte registrado | 1 de 14 | Não | Registrar o aceite na OS (link do cliente ou aceite da equipe) |
| 6.1 | Apontamentos de hora contra impressões | 3 de 38 | Não | Apontar a hora de máquina |
| 6.2 | Vínculos da Flexi decididos | 0 de 19 | Não | Importar a Flexi (última de 24/10) e confirmar os vínculos |
| 7.1 | Materiais com entrada de estoque | 45 de 64 | Não | Dar entrada nos 19 sem entrada; contar o vinil |
| 7.2 | Inventário registrado | 0 de 1 | Não | Fazer o primeiro |
| 8.1 | OS que já saíram e estão fechadas | 1 de 2 | Não | Registrar a retirada da OS 212 (ela fecha sozinha) |
| 9.1 | Avisos ao cliente enviados | 18 de 18 | Sim | |

## 8. O caminho para 100%

Só falta a equipe. Em ordem de tamanho:

1. **Hoje, em meia hora, o atendimento:** registrar a retirada da OS 212; preencher a condição de pagamento e reenviar o 157 e o 158; marcar o Pix do 142 e trocar os itens do 153; responder os três contatos encerrados sem resposta. Isso leva 1.1, 2.1, 3.1 e 8.1 a "feito".
2. **Esta semana:** limpar os 7 rascunhos, ligar para os 4 orçamentos parados, importar a Flexi e confirmar os vínculos, apontar a hora de máquina, mover as OS paradas e registrar o aceite da arte (2.2, 3.2, 5.2, 5.4, 6.1 e 6.2).
3. **Uma vez só:** cadastrar máquina e tempo nos 22 produtos, dar entrada nos 19 materiais, contar o vinil e fazer o primeiro inventário (5.1, 7.1, 7.2, e com eles 5.3).

Depois disso, rodar `docs/medicao-da-operacao.sql` de novo: com os 20 pontos, o geral chega a 100%.

## 9. Como medi e o que não medi

- **Operação:** `docs/medicao-da-operacao.sql`, somente leitura.
- **Sistema:** consultas de varredura no banco (visões e funções em dois fusos, funções de gatilho abertas, `current_date` restante, funções sem `search_path`, tabelas sem RLS, rotinas) e ensaios dentro de transações desfeitas (fuso, contatos, agenda, fechamento por papel). A sequência de OS não foi tocada por nenhum ensaio.
- **Telas:** as 58 de 29/10 não foram reabertas inteiras; depois do Publish reabri as que mudaram (dashboard, OS e o diálogo de finalizar).
- **Não medi:** uso no celular, desempenho com muitos dados, e o que a equipe faz fora do sistema.
- **Para saber ao ler os números:** a margem real de uma OS "fechada com estimativa" é a prevista (o selo diz isso); a baixa de material pelo fechamento é movimento de estoque de verdade, pela reserva; a nota é uma fotografia das 18h de 30/10.
