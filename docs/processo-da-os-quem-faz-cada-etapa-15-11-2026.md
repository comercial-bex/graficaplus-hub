# O processo da OS: quem faz cada etapa (15/11/2026)

Pedido do dono:

- "Eu seleciono o operador e o operador seleciona a máquina, dentro do modal da tarefa
  do Kanban."
- "Colocar em cenários de processos e quem executa cada processo, facilitando cada vez
  mais. E responsabilizando também por cada etapa."

## O processo, etapa por etapa

| Etapa (coluna) | O que se faz | Quem faz | Para avançar |
| --- | --- | --- | --- |
| **Atendimento** | Fecha o pacote: pedido, briefing, arquivos, prazo, pagamento | Atendimento (o vendedor da OS); pede a validação ao gestor | O gestor valida o atendimento e escolhe quem faz a criação |
| **Atendimento validado** | O gestor conferiu e deu o aval | Criação (a pessoa escolhida pelo gestor) | A criação começa a arte |
| **Criação** | Arte, mockup para o cliente, arquivo de impressão | Criação faz; o atendimento consegue o aceite do cliente | Aceite do cliente, arquivo final e a entrada paga (ou o aval do gestor para ficar devendo) |
| **Fila de produção** | Esperando a máquina | Operador (escolhido ao mandar para a fila) | O operador escolhe a máquina e começa |
| **Produção** | A peça na máquina | Operador | O operador termina e manda para o acabamento |
| **Acabamento e qualidade** | Corte, dobra, laminação, conferência | Operador | Marcar como pronta |
| **Entrega e finalizado** | Retirada, entrega ou instalação | Atendimento combina e entrega | Cliente retirou ou foi entregue; o financeiro fatura |

**Quem aprova é só o gestor:** valida o atendimento e libera saldo devedor e margem. O
admin só acompanha a empresa.

## O que a tela mostra

- **No cartão:** com quem está o próximo passo ("com Fernando · operador", "com o
  gestor", "com você" em verde).
- **Na ficha, em "Onde está":** "Agora: escolher a máquina e começar — com Fernando".
  - Se há um pedido aberto ao gestor e a trava continua, o passo é do gestor.
  - Sem a pessoa definida, diz o que falta ("ainda sem operador") e o passo vira
    escolher a pessoa.
- **No quadro:** o filtro **"Comigo"** deixa só as OS cujo próximo passo é de quem está
  logado. Para o gestor, entram também as que esperam por ele.
- **No cabeçalho de cada coluna:** "Quem faz: …", em todo tamanho de tela.
- **Na ficha, "Quem fez o quê":** a linha do tempo da OS, com quem levou a OS a cada
  etapa, quando, e quanto tempo ela ficou ali ("está há 2d 4h"). Vem de
  `os_status_historico`, que grava quem mudou em toda troca.

## A máquina

Na ficha da OS, na fila e na produção, há o bloco **"Máquina"**:

- **"Escolher a máquina e começar".** São os mesmos botões do painel do operador: a
  sugerida pelo produto em destaque e a ocupada dizendo com qual OS. Um toque começa a
  contar o tempo e leva a OS ao status da máquina, passando pelas travas de sempre
  (`comecar_na_maquina`). Na produção, o mesmo lugar troca de máquina ou fecha ("Terminei").
- **"Fila da máquina".** Na fila de produção, deixa a OS esperando numa máquina sem
  começar (`definir_maquina_da_os`). A TV da Oficina já mostra a OS na fila dessa
  máquina.
- **Quem pode.** Começar é de quem aponta (papel operador). Pôr na fila é do operador
  ou do gestor.

**A Epson EcoTank A4 (resolvido em 19/11/2026).** Ela tinha o tipo "Impressão jato de
tinta A4", que não corresponde a nenhuma etapa de produção, e por isso não se começava
nem se punha fila nela. Agora é do tipo `impressora_a4`, na etapa Impressão, ao lado da
plotter. Ver `docs/ensaio-epson-a4-impressora-de-producao-19-11-2026.md`.

## O atalho que foi fechado

Em 14/11/2026, às 21:19, a OS 221 (venda, sem validação) foi de "Entrada" para "Arte
aprovada".

**Como aconteceu.** O registro do aceite da arte na ficha mudava o status direto,
sem as travas. Faziam o mesmo:

- a aprovação interna;
- o link de aprovação do cliente;
- o envio do link.

**A correção.** A guarda agora é da tabela, num gatilho antes de mudar o status, e vale
para qualquer caminho:

- OS de venda no Atendimento, sem a validação do gestor, não avança.
- O fluxo da arte grava a decisão do cliente e deixa a OS no Atendimento. O mockup
  aprovado no orçamento é aceite legítimo.
- Qualquer outro caminho é recusado com a explicação, inclusive pelo gestor.
- O aceite rápido devolve o status de verdade e avisa: "A OS continua no Atendimento:
  falta o gestor validar".

**A OS 221.** Ficou onde está (acabamento): ela andou de verdade, e desfazer não ajuda.
Ela mostra na linha do tempo quem a moveu.

**Ensaio no banco (15/11/2026, com rollback).**

- O aceite na OS 163 ficou gravado e a OS seguiu no Atendimento.
- O gestor, mudando o status direto, foi recusado.
- Validada, a OS andou.
- A fila da Plotter de Impressão funcionou para o operador. A Epson foi recusada pelo
  tipo, uma OS fora da fila foi recusada, e o atendimento não pôde mexer (42501).

## Tempo de máquina só depois do Atendimento (16/11/2026)

Achado ao conferir a TV da Oficina. A Plotter de Impressão estava "ocupada" desde
10/11, às 14:40:

- um apontamento foi aberto pela agenda na OS 222, três minutos depois de a OS nascer;
- a OS ainda estava no Atendimento, sem validação do gestor, arte aprovada, arquivo
  final ou pagamento;
- o apontamento nunca foi fechado.

Com ele aberto, "Começar" na Plotter recusava qualquer outra OS, e o custo de máquina
da 222 crescia sozinho.

- **A porta.** `iniciar_apontamento`, a única função que abre apontamento, recusa OS no
  Atendimento ou em "Atendimento validado": "a produção começa na fila, depois da
  validação do gestor e das travas". Na Criação continua permitido (prova de cor,
  teste de material).
- **O dado.** O apontamento da 222 foi fechado sem tempo e sem custo, com o motivo
  escrito. A regra de apontamento esquecido lançaria cerca de 9 h de Plotter numa OS
  que não foi produzida. A reserva da agenda voltou a "agendado". Se o banner foi
  impresso naquele dia, o tempo real se lança à mão (a reserva previa 35 min).
- **Onde o trabalho para.** Em "Atendimento validado", quem destrava agora aparece como
  a criação, e não mais a gestão.

**A Epson EcoTank L3250 (A4), resolvido em 19/11/2026.** Ela estava sem tipo de produção,
e a TV da Oficina acusava 6 colunas de máquina num painel desenhado para 5. O dono
deixou a decisão comigo, e a saída foi tratá-la como máquina de impressão, não desativá-la:
é a máquina padrão do produto ativo "Certificado A4", e a OS 232 tem a reserva dela.

- Ela ganhou o tipo `impressora_a4`, na etapa Impressão: já se começa e se põe fila nela.
- A TV agrupa a plotter e a Epson numa coluna só, como já fazia com as 3D, e a parede
  continua com cinco colunas.
- Com duas impressoras, `em_impressao` deixou de apontar uma máquina só (como os lasers):
  a OS que estiver nesse status sem máquina aparece em "sem máquina" na TV, em vez de ir
  para a plotter por palpite.
