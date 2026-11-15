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

**Pendência de cadastro.** A "Epson EcoTank L3250 (A4)" tem o tipo "Impressão jato de
tinta A4", que não corresponde a nenhuma etapa de produção. Por isso não se começa nem
se põe fila nela. Para usar, o tipo dela precisa ser um dos tipos de máquina do
sistema, como os das plotters.

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
