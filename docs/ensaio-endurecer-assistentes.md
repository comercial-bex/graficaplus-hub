# C1: endurecer as assistentes de texto livre (14/11/2026)

Escopo: só código e testes. Nenhuma migração foi escrita nem aplicada, nenhum commit, nenhum PR. A triagem de
boas-vindas e os assistentes de texto livre continuam desligados.

## Regra do dono que isto implementa

A assistente da caixa de entrada e o atendente do ensaio nunca citam preço, validade, prazo nem data, e nunca fazem
orçamento. Dão só expectativa de produtos e entendem o que o contato precisa. Nunca perguntam se o contato é parceiro
ou cliente final, nem falam de tabela, desconto ou preço. Só existem duas modalidades (parceiro e cliente final), e a
palavra que o dono não usa não aparece em texto novo.

## O que o levantamento achou (confirmado no código antes de mudar)

| Ponto | Antes |
| --- | --- |
| Assistente (`assistente.ts`) | O contexto mandava `valor_total` do orçamento, a validade e o prazo da OS. As instruções mandavam repetir "o valor e o prazo exatamente como aparecem". `motivoParaBarrar` só pegava "R$ N" e datas dd/mm; `PALAVRAS_PROIBIDAS` era curta. |
| Servidor da assistente | O aviso fora do horário e a frase de transferência saíam direto para `whatsapp_ia_enviar`, sem verificador. |
| Atendente (`atendente.ts`) | Calculava o valor da tabela e somava ao texto quando a IA marcava `orcamento_pronto`. No ensaio, 11 de 31 respostas saíram com valor. |
| Ramo | Nada impedia a IA de perguntar se o contato é parceiro. |

## O que mudou

### 1. A IA não vê preço, validade nem prazo

- `OrcamentoNoContexto` tem só `numero`, `titulo` e `status`; `OsNoContexto` só `numero`, `titulo` e `etapa`.
- O servidor nem lê as colunas de valor e prazo: `orcamentos` pede `numero, titulo, status, created_at`; `ordens_servico`
  pede `numero, titulo, status`. Há teste lendo os `select` pedidos.
- Título digitado pela equipe que o verificador reprova ("Banner R$ 80 até 12/11") é descartado antes de ir à IA
  (`tituloSeguro`).
- Fala da equipe no histórico que o verificador reprova vai como "[mensagem da equipe omitida]", para a IA não copiar.
- `permitidos()` devolve conjuntos vazios. `reais` e `dataBR` saíram de `assistente.ts`.
- As instruções foram reescritas: objetivo é entender o que o contato precisa e dar expectativa de produtos; preço, prazo
  e orçamento são da equipe; nunca perguntar tipo de cliente nem falar de tabela, desconto ou preço; sem travessão, seta
  nem parênteses (senão o próprio verificador barra a resposta). Quando perguntarem preço ou prazo, a frase é "a equipe
  confirma isso com tudo certinho para o pedido".

### 2. Um verificador só, em todos os envios de texto

`verificarSaida` (em `assistente.ts`) chama `verificarTexto(texto, "cliente", extras)`, a lista mais estrita.
Passa por ele: a resposta (`motivoParaBarrar`, dentro de `decidirAcao`), o aviso fora do horário e a frase de
transferência, sempre com o texto JÁ MONTADO, com a assinatura. Tudo converge em `enviarVerificado`, a única porta que
chama `whatsapp_ia_enviar` no servidor da assistente.

Texto reprovado nunca é enfileirado:

- resposta reprovada: vira transferência, com motivo `texto reprovado pelo verificador: <regras>`;
- aviso fora do horário reprovado (por exemplo, configurado com "R$ 10"): não sai, o log leva `regras`, e a conversa passa
  para a equipe em silêncio;
- frase de transferência reprovada (por exemplo, assinatura com "R$ 10"): não sai, a transferência acontece do mesmo jeito,
  e o log da transferência leva `sem_mensagem` e `frase_reprovada_pelas_regras`.

Os logs e motivos levam só o NOME da regra, nunca o trecho.

### 3. Regras novas no verificador (`triagem/verificador.ts`), segunda rodada

O verificador tem dois escopos. O **completo** (padrão) roda tudo e é o das assistentes de texto livre. O **triagem**
(`{ escopo: "triagem" }`) roda só as regras comuns, as mesmas do banco, e é o da triagem de boas-vindas: o nome digitado
(`extrairNome`), os textos montados (`maquina.ts`) e os textos que o dono edita (`textos.ts`). Motivo: o nome do contato
volta no texto montado, e "Maria Barata", "Ana Caro", "João Barato" e "Cara Silva" não podem parar no passo do nome. As
regras só do código estão em `REGRAS_SO_DO_CODIGO` e o teste de paridade com o SQL usa o escopo triagem.

Regras só do código (valem nos dois ramos):

| Regra | Reprova | Passa |
| --- | --- | --- |
| `prazo_relativo` | "ainda hoje", "hoje mesmo", "amanhã mesmo", semana que vem, próxima semana, próximo mês, fica pronto, pronto em, garantia; hoje, amanhã e depois de amanhã só com pronto, entrega, chega, retirada (até 3 palavras) ou fica e sai (1 palavra) e até; dia da semana só com pronto, entrega, chega, retirada (até 2 palavras); "segunda que vem"; essa, esta, nessa, nesta semana; fim e final da semana; "fim de semana" com pronto ou entrega; validade; válido por ou até; daqui a | hoje, amanhã e prazo soltos; "Em que posso ajudar hoje?"; "Estamos fechados no domingo"; "Voltamos a atender na segunda"; "de segunda até sexta"; "entre segunda e sexta"; "Aberto no sábado até 12h" |
| `prazo_por_extenso` | um a quinze, vinte, trinta, quarenta e cinco etc. antes de dia, semana, hora, mês, meses, úteis; 24h ou mais com h; 3d; mesmo dia; dia 15, dia quinze; 15 de novembro e demais meses, também por extenso | "Tenha um dia ótimo"; "das 8h às 17h"; "8h30"; "letra 3D" |
| `data_numerica` | data de verdade (dia 1 a 31, mês 1 a 12): 10/11, 10/11/2026, vence 15/12, até 3/4 | 4/4 cores, 4/0, 1/0, 1/2 folha, 50/50, 20/30 cm, Quadra 10/12, Lote 5/6, cartão de visita 4/4 |
| `preco_sem_numero` | promoção, grátis, sem custo, a partir de, orçamento fechado, preço, preços, valor de; barato e caro só em afirmação sobre preço (é barato, mais caro, muito caro, saiu caro, caro demais) | Caro cliente, Cara Maria, "É caro?" e qualquer frase de pergunta; "valor" solto; "orçamento" solto |
| `preco_com_verbo` | custa, custo, cobramos, cobra, sai por, fica por, investimento de, orçamento de, a partir de, seguidos de dígito ou extenso (cinquenta, cem, mil e quinhentos); 1500; 1.500; N contos; pila; centavos; um real; por peça; o metro; cada depois de número ou no fim da frase | "100 unidades", "A4 de 90g", "5 cm", "banner 3x1", "orçamento de 3 banners", "1.000 cartões", "OS 1234", "terminado em 2233", "desde 2015", "cada detalhe" |
| `pagamento` | à vista, a vista, cartão de crédito ou débito, pagamento na entrega, metade na entrada, sinal, em 3x, em três vezes | "entrada" solta, "valor" solta |

**Escolha explicada: data_numerica.** "Quadra 10/12" e "Lote 5/6" são datas válidas e também endereço, então só o formato
não resolve. O pedido sugeria exigir contexto positivo (dia, até, para, entrega, validade). Isso deixaria "10/11" solto
passar, e o pedido também lista "10/11" como barrado. A regra implementada resolve pelo outro lado: três partes
(dd/mm/aaaa) é sempre data; com duas, é data a menos que venha depois de palavra de endereço ou impressão (quadra, lote,
casa, apto, bloco, sala, número, rua, cartão, visita, frente, verso, cor) ou antes de unidade, cor ou fração (cores, cm,
folha, x, kg, vias). Assim "10/11", "vence 15/12" e "até 3/4" barram, e quadra, lote e cartão 4/4 passam. A troca de
polaridade segue o princípio do verificador: na dúvida entre citar uma data e passar para a equipe, passa para a equipe.

**Outras escolhas.** "um dia" passa em "Tenha um dia ótimo", mas "em um dia" barra. "cada" só barra depois de número ou no
fim da frase. Número de quatro dígitos (1500) só vale como preço fora de quantidade, ano (1900 a 2100), telefone, CEP,
OS, pedido e endereço. A hora do relógio nunca barra: "h" só vale de 24 para cima.

**Antes e depois.** Na rodada anterior "hoje", "amanhã" e "prazo" soltos, qualquer dia da semana depois de na, no, até, entre
e a palavra caro ou cara em qualquer lugar barravam; isso travava a assistente e o aviso fora do horário ("Em que posso
ajudar hoje?", "Caro cliente"). Agora só barram em contexto de entrega e de preço.

### 4. Lista extra lida da tabela

`src/lib/api/termos-proibidos.ts` (`lerTermosExtras`) lê `whatsapp_triagem_termos_proibidos` (só leitura, só linhas
ativas) e `compilarTermosDoBanco` converte para regras: `trecho` e `padrao` (POSIX do Postgres, com `\y` virando `\b`),
`plano` e `bruto`, ramos `todos` e `cliente` (o ramo `nome` é só do nome digitado e fica de fora). A lista do código é o
piso: a da tabela só acrescenta. Falha de leitura, tabela ainda não aplicada ou linha que não compila: vale a lista do
código, nunca afrouxa (há testes e uma propriedade sorteada que provam que a lista extra nunca tira um problema).
Vale para o servidor da assistente e para o ensaio do atendente.

### 5. Atendente (`atendente.ts` e a rota do ensaio)

- Saíram `previaDoOrcamento`, `textoDoValor`, `TabelaDoAtendente` e a leitura da tabela de preços
  (`tabelaDoAtendente`). O atendente não lê mais preço nenhum.
- Saiu `orcamento_pronto` da ferramenta, das instruções e do tipo. Quando produto, medida, quantidade e as perguntas do
  checklist estão resolvidos, a instrução é transferir com o motivo "pedido completo para a equipe", sem montar orçamento.
  A passagem usa a frase fixa de transferência.
- `decidirAtendente(leitura, tipo, extras)` não tem mais prévia; o texto passa pelo verificador já montado.
- A tela do ensaio perdeu o bloco "Conta da tabela" e o ensaio grava `valor: null` (a coluna continua existindo, vazia).
  O ensaio segue funcionando: conversa, registra os itens entendidos, mede quanto responde e quanto passa para a equipe.

### 6. Testes

- `tests/triagem/verificador-endurecido.test.ts`: `it.each` com 52 frases de gráfica que PASSAM e 82 que BARRAM (com a
  regra esperada), o escopo da triagem, horário da casa montado a partir da tabela, sementes (43 textos, todas as
  variantes), lista extra, e duas propriedades sorteadas com semente fixa (o repo não tem fast-check).
- `tests/triagem/nome-e-termos-proibidos.test.ts`: Maria Barata, Ana Caro, João Barato, Cara Silva, Sandra Barbosa, Maria
  Segunda (e Pila Santos, Marcos Sinal) são aceitos como nome; Pix, Desconto, Hoje, Amanhã, Tabela e Parceiro seguem
  recusados.
- `tests/whatsapp-assistente-servidor.test.ts`: contexto com orçamento de 1.234,56 e OS com prazo sem "1.234", "1234", "R$",
  datas nem título com preço, e sem as colunas no `select`; `it.each` com "fica R$ 50", "custa 50 reais", "mil reais",
  "10%", "10 por cento", "pronto amanhã", "em 3 dias", "até sexta", "tabela", "parceiro", "Pix", "desconto" e "a partir de
  80", todos viram transferência sem enfileirar o texto (inclui a palavra que o dono não usa); resposta limpa responde; aviso
  fora do horário e transferência com texto de configuração com R$ 10 não enfileiram; termos extras da tabela, com erro de
  leitura e com linha inválida.
- `tests/atendente-em-ensaio.test.ts` e `tests/whatsapp-assistente.test.ts` foram adaptados ao novo contrato.
- `tests/triagem-dados-banco.test.ts`: a paridade entre o SQL semeado e o verificador agora compara só as regras que o
  banco conhece, com `{ escopo: "triagem" }` (o código tem seis regras a mais até a migração própria).

## O que continua sendo risco

1. **A barreira no banco (`whatsapp_ia_enviar`) fica para uma migração própria.** Hoje a proteção é só no código do
   servidor. Qualquer outro chamador da função (outra rota, outra sessão com service_role) enfileira o que quiser. A
   migração deve chamar a função de conferência de texto do banco dentro de `whatsapp_ia_enviar`.
2. **O banco não conhece as regras novas.** `REGRAS_SO_DO_CODIGO` (`prazo_relativo`, `prazo_por_extenso`, `data_numerica`,
   `preco_sem_numero`, `preco_com_verbo`, `pagamento`) existem só no código; a tabela
   `whatsapp_triagem_termos_proibidos` e a função `_triagem_*` do SQL têm 24 termos. O dono pode acrescentar termos pela
   tabela (a lista extra os lê). **A migração só precisa semear as regras novas na tabela se o dono quiser** que o banco
   e o código voltem a ser idênticos; a triagem de boas-vindas não depende delas (usa o escopo comum), e
   `tests/triagem-dados-banco.test.ts` compara só as regras comuns.
3. **Regra por palavra tem furo.** O que segura de verdade é a IA não receber nenhum dado de preço ou prazo; o verificador
   é o cinto. Quando o contato escreve o preço e a IA o repete, o verificador barra, mas o preço entra no histórico
   enviado à OpenAI. Furos conhecidos depois desta rodada, todos mandados à equipe só se a frase cair em outra regra:
   - **Prazo em linguagem de gíria ou vago (passam, verificado):** "uns diazinhos", "rapidinho", "logo logo", "meia hora",
     "num instante", "semaninha", "daqui uns dias". "ainda esta semana" cai.
   - **Grafia errada (passam, verificado):** "3 diaz", "amnhã pronto", "p1x", "presso". "R $ 50" e "preco" caem.
   - **Rodada nova:** a IA pode reescrever o mesmo preço por outro caminho ("quinhentão", "meio milhão", "uma nota",
     "uns cinquentão") que nenhuma lista cobre; "por unidade" e "por metro quadrado" sem número passam ("por metro" e "o
     metro" barram); "um dia" só barra fora de saudação.
   - **Dia da semana longe do verbo:** passa quando o verbo está a mais de duas palavras do dia; "fim de semana" sem
     pronto ou entrega passa; "Até amanhã" como despedida barra (até é verbo de prazo, pedido do dono).
   - **Letra 3D com "em":** "letra caixa em 3D" barra (aceito: vai para a equipe).
   - **Barato e caro soltos**, sem "é", "mais", "muito" etc., passam ("Barato!").
   - **Meses sozinhos** ("até novembro") e "março" sem dia passam, para não barrar o nome Marco.
4. **Mais transferências.** O verificador também aplica o estilo (sem travessão, seta nem parênteses) e o teto de 600
   caracteres. A IA que escrever assim vai para a equipe. As instruções pedem o estilo certo; se a taxa de transferência
   subir, o ajuste é nas instruções, não no verificador.
5. **O log de classificação ainda guarda a decisão crua da IA**, inclusive o campo `resposta` reprovado, para o painel
   "Decisões do assistente". O texto reprovado não vai para fila, motivo nem para o log de resposta, mas fica nesse log
   interno (não sai para o cliente).
6. **Linha de `whatsapp_ia_logs` e de `atendente_ensaios` antigas** continuam com os valores e prazos que a IA já escreveu
   antes da C1. Esta mudança não apaga histórico.
7. **Aviso fora do horário reprovado passa a transferir a conversa** (modo humano). É o pedido ("transferência
   silenciosa"), mas muda o estado de uma conversa à noite que antes só seria classificada. A cura é a equipe corrigir o
   texto de `mensagem_fora_horario` na configuração.
8. **Triagem de boas-vindas e demais envios** (`whatsapp-triagem`, cobrança, documentos) não foram tocados: seguem com a
   conferência própria deles.

## O que NÃO foi feito

- Nenhuma migração escrita ou aplicada; banco vivo intocado.
- Sem commit, sem PR; a branch `feat/c1-endurecer-assistentes` está só com a árvore de trabalho.
- A branch `lovable-sync-1794400486` não foi usada nem mesclada.
- O verificador do banco (`whatsapp_ia_enviar` e as funções `_triagem_*`) não foi alterado.
- A assistente e o ensaio continuam desligados: nada foi ligado nem testado contra a OpenAI de verdade, só contra dublês.
- Não foi tocada a cobrança, o envio de documentos nem o código da triagem de boas-vindas além do verificador compartilhado.
