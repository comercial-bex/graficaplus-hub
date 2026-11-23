# Diagnóstico geral do Bex Print: relações que faltam, perfis, casos de uso e comparação com o segmento (23/11/2026)

**Somente leitura.** Nada foi alterado, criado, aplicado ou publicado. Nenhuma das soluções abaixo foi executada: são
propostas, com esforço, risco e ganho estimado, para o dono decidir.

Base: banco de produção (consultas só de leitura, 22/11/2026 às 21h40 em Belém), `main` com o PR #517 já mesclado, o mapa do
código feito em leitura e um levantamento público dos concorrentes. O diagnóstico anterior é o de 02/11 e o plano "para chegar aos
100" é o de 21/11 (nota 68).

## 0. Resumo em dez linhas

1. **O cérebro é sólido; o corpo ainda não obedece a ele.** O banco tem 215 de 215 tabelas com RLS, 477 chaves estrangeiras, 0 política
   de escrita aberta e **0 órfão** em 1.833 valores testados. Mas a ligação entre as etapas do negócio, com dado real, é fraca.
2. **Nota geral nesta régua: 60 de 100** (régua nova, que mede relação entre registros com dado real; ver 1.2). A de 21/11 (68)
   media saúde operacional. As duas não se comparam número a número.
3. **Desenho versus uso.** O sistema "existe" em 77% das capacidades que os líderes do segmento oferecem, mas só "roda com dado" em
   58%. O problema não é falta de módulo: é laço aberto.
4. **A cadeia de compra não é ligada por relação.** 14 compras de fornecedor, todas marcadas "pagas", têm **0** conta a pagar
   correspondente; só **4 de 65** entradas de estoque vêm de compra; o fornecedor é texto livre em 176 registros (pedidos, contas a
   pagar e materiais), contra 14 com chave.
5. **O caixa não se explica.** 78 de 99 movimentos de caixa não apontam para pagamento, conta a pagar ou OS: 41 entradas
   (R$ 6.975,81) e 36 saídas (R$ 13.002,86) do extrato sem documento.
6. **O chão de fábrica não alimenta o sistema.** Das 45 OS que passaram da entrada, 5 têm apontamento de máquina, 4 têm baixa de
   estoque e 2 têm registro de entrega.
7. **O funil não conversa consigo mesmo.** 3 de 152 leads apontam para um cliente; 8 leads com orçamento aprovado ou convertido não
   estão "ganhos"; **10 orçamentos aprovados (R$ 4.965,25) nunca viraram OS**, o mais antigo de 28/09.
8. **A tela esconde ligações que o banco já tem.** Das 30 ligações entre registros que avaliei na interface, 9 existem, 8 são parciais
   e 13 não existem. Exemplo: 72% das OS têm orçamento de origem, mas a ficha da OS não mostra nem linka esse orçamento.
9. **Muita coisa a manter.** Preço e orçamento (custo cheio, preço mínimo, versões, aval), máquina de estados da OS com travas no
   banco, fila de mensagens com bloqueio, rotinas (9 de 9 com sucesso) e o módulo de parceiros.
10. **Meta realista: de 60 para cerca de 80 em 6 a 8 semanas**, quase toda a subida por ligar o que já existe (seção 8). Passar de 90
    depende de hábito de uso (apontar, dar baixa, registrar entrega), não de código novo.

---

## 1. Como ler

### 1.1 Convenções

- **Cada porcentagem traz a fração que a gerou** (ex.: 39 de 49). Onde é média de várias frações, as frações estão listadas.
- **[medido]** = consulta no banco vivo. **[código]** = lido no repositório. **[público]** = página aberta de concorrente.
  **[não confirmado]** = indício sem prova; não é falha.
- **Ausência numa tabela não é defeito até saber qual é a tabela certa.** Todo "órfão" foi testado contra a tabela-alvo certa, e as
  colunas polimórficas (que apontam para tabelas diferentes conforme o tipo) não foram tratadas como defeito (seção 5.4).

### 1.2 A régua desta nota

A nota de 21/11 (68) julgava saúde operacional (quadro, TV, funil, higiene). Esta mede **quanto do dado realmente se liga de uma
etapa à outra**. Ela é mais dura de propósito, porque a pergunta de hoje é "o que deveria se relacionar e não se relaciona". Por
isso o número é menor sem o sistema ter piorado desde 21/11 (a seção 3 mostra que quase tudo ficou igual).

---

## 2. Placar (nota 60 de 100)

| # | Dimensão | % | Base | Peso |
|---|---|---|---|---|
| 1 | Estrutura do banco e segurança | **96** | RLS 215/215; funções `SECURITY DEFINER` com `search_path` fixo 516/516; colunas de relação com chave estrangeira 387/413 (94%); órfãos 0 em 1.833 valores; funções privilegiadas fechadas a `anon` 509/516 (99%); views com `security_invoker` 59/73 (81%); política de escrita aberta 0 | 15 |
| 2 | Funil comercial ligado | **57** | leads com cliente 3/152 (2%); orçamentos com lead ou conversa 82/136 (60%); orçamentos já enviados com cliente 69/97 (71%); aprovados e convertidos com OS 39/49 (80%); orçamento↔OS nos dois sentidos 39/39 (100%); leads "ganho" entre os com orçamento aprovado 3/11 (27%) | 12 |
| 3 | Da OS ao dinheiro | **49** | OS com orçamento 39/54 (72%); OS com conta a receber 39/53 (74%); pagamentos com parcela 39/44 (89%); pagamentos com movimento de caixa 17/44 (39%); caixa explicado por documento 21/99 (21%); compras com conta a pagar 0/14 (0%); OS concluídas com margem real 13/26 (50%) | 15 |
| 4 | Do atendimento ao chão | **37** | OS fora da entrada com apontamento 5/45 (11%); com baixa de estoque 4/45 (9%); com material previsto 22/54 (41%); com agenda de máquina 28/54 (52%); com entrega registrada 2/45 (4%); com inspeção 15/54 (28%); RIP ligados a OS 4/38 (11%); OS com itens 53/54 (98%); OS com responsável 41/54 (76%) | 15 |
| 5 | Compras e estoque | **43** | compras com item ligado a material 9/14 (64%); entradas de estoque vindas de compra 4/65 (6%); materiais com compra 11/87 (13%); materiais com custo 72/87 (83%); materiais com lote 57/87 (66%); produtos com lista de materiais 41/70 (59%); documentos que apontam fornecedor por chave 14/190 (7%) | 10 |
| 6 | Catálogo e preço | **77** | produtos com preço 70/70; com precificação 70/70; com ficha 69/70 (99%); com processos 57/70 (81%); com materiais 41/70 (59%); com compatibilidade de máquina 0/70; itens de orçamento com produto 150/176 (85%); itens de OS com produto 47/67 (70%); itens de OS com custo 67/67 | 10 |
| 7 | Perfis e acesso | **94** | permissões atribuídas 121/121; atribuições a permissão inexistente 0; usuários ativos com papel 23/23; rotas da equipe com entrada 89/90 (99%); papéis com ao menos uma pessoa ativa 7/10 (70%) | 5 |
| 8 | Recursos instalados que rodam | **75** | tabelas com dado 161/215 (54 estão vazias) | 5 |
| 9 | Ligações entre registros na tela | **43** | 30 ligações avaliadas: 9 existem, 8 parciais, 13 não existem (parcial vale meio ponto) | 13 |
| | **Nota geral (média ponderada)** | **60** | 14,4 + 6,8 + 7,4 + 5,6 + 4,3 + 7,7 + 4,7 + 3,8 + 5,6 | 100 |

**Leitura.** A parte de baixo (banco, perfis, catálogo) está acima de 75. O que puxa a nota para baixo é a travessia entre etapas:
OS→chão (37), compra→estoque→pagar (43), OS→dinheiro (49), e a tela que não mostra o que o banco já sabe (43).

---

## 3. O que mudou desde o plano de 21/11 (consultas semanais, somente leitura)

| Indicador (plano de 21/11) | 21/11 | Agora | Leitura |
|---|---|---|---|
| OS abertas / com prazo vencido / paradas há mais de 7 dias | 21 cartões em 4 colunas (8, 6, 4 e 3), 20 vencidos | 27 / 26 / 11 | Não melhorou: as mesmas 21 continuam (8, 6, 4 e 3) e há mais 6 em outras etapas; o mutirão do fim de semana não apareceu no banco |
| Apontamentos de máquina nos últimos 14 dias; último | 0; 10/11 | 2; 10/11 | Igual. O novo bloco "ninguém começou numa máquina" estreia no aviso de segunda |
| TV vista nos últimos 5 minutos; último acesso | 0; 16/11 | 0; 16/11 | Igual: 3 aparelhos ativos, nenhum visto desde 16/11 |
| Orçamentos enviados parados há mais de 7 dias | 25 | 26 | Igual |
| Leads novos parados há mais de 1 dia / em atendimento parados há mais de 14 dias | 10 / 43 | 11 / 46 | Igual |
| Envios a número bloqueado depois do bloqueio | 4 (18 a 21/11, 09:00) | os mesmos 4 | **Sem vazamento novo**: nenhum depois do ajuste de 21/11 |
| Inativo com login livre | 0 | 0 | Mantido |
| Parceiros sem contato | 16 | 16 | O aviso de segunda 23/11 às 09:10 é o primeiro envio real com as correções |
| Rotinas agendadas (9 jobs) | ok | 9/9 com sucesso, 0 falha em 7 dias | Saudável |

O que **entrou** desde então: reabertura de chamado de parceiro, tela de créditos, aviso do grupo que não esconde chamado fechado,
troféu de acrílico com "Ler a ficha". Nada disso mexe nas lacunas abaixo.

---

## 4. O sistema como um todo

### 4.1 Perfis (quem usa, hoje)

| Papel | Pessoas ativas | Chaves de permissão | O que faz | Observação |
|---|---|---|---|---|
| admin | 1 (Harison) | 119 | Vê e gere a empresa; estorno de conta a pagar é só dele | Aprovação comercial é do gestor, não do admin |
| gestor | 1 (Raymison) | 100 | Valida atendimento, aprova desconto e margem, move o quadro | **Não paga nem dá baixa** (nenhuma chave `pagamentos.*`). Acumula o papel de vendedor |
| vendedor | 3 (Jhesselem, Maiara, Raymison) | 34 | Atende lead, orça, converte em OS | Não abre `/a-receber` (precisa de `financeiro.read`) |
| financeiro | 1 (Cibele) | 20 | Paga, dá baixa, estorna, vê custo e margem | Não abre o WhatsApp, embora o servidor cobre por WhatsApp |
| designer | 1 (Wellton) | 13 | Arte, mockup, pedido de aprovação | Não vê orçamentos nem aprovações |
| operador | 1 (Fernando) | 21 | Escolhe a máquina, aponta, acabamento | Não abre `/materiais` (sem `custos.read` nem `estoque.read`) e **não pode dar baixa de estoque** (sem `estoque.exit`, que só admin, gestor e estoque têm) |
| estoque | 0 | 17 | Entrada, saída e ajuste de estoque, compras | Papel sem ninguém |
| instalador | 0 | 12 | Entregas e instalações | Papel sem ninguém |
| cliente | 0 | n/d | Portal do cliente: aprovar arte, enviar arquivo e comprovante | Portal sem nenhum acesso até hoje |
| parceiro | 16 ativos | 1 | Portal do parceiro (6 telas): pedido, marca, crédito | Inclui 1 conta "TESTE Parceiro (apagar)" |

Fora da lista: Léo e Yvens, inativos e banidos. A **TV** não é papel: entra por PIN ou pareamento aprovado por admin ou gestor.

**Risco de pessoa única [medido]:** admin, gestor, financeiro, designer e operador têm **uma pessoa cada**. Se uma falta, a função
para (quem paga? quem valida atendimento? quem aponta?). Só o vendedor tem reserva.

### 4.2 Atividades (o ciclo de vida de um pedido) e a força de cada elo

Legenda: `━` forte (80% ou mais) · `─` parcial (40 a 79%) · `┄` fraco ou ausente (menos de 40%). O percentual é o do dado.

```
ENTRADA E VENDA
 WhatsApp ━(81% das conversas têm lead)━► Lead ┄(2% têm cliente)┄► Cliente
 Cliente ─(65% dos orçamentos têm cliente)─► Orçamento ━(80% dos aprovados viram OS)━► OS
      Lead ┄(status "ganho" em 27%)┄ Orçamento aprovado

PRODUÇÃO
 OS ━► Atendimento validado ━► Criação ━► Fila ━► Produção ━► Acabamento ━► Pronto ━► Entrega
 OS ┄(11% com apontamento)┄► Máquina           OS ┄(9% com baixa)┄► Estoque
 OS ┄(4% com entrega registrada)┄► Retirada     OS ─(50% das concluídas com margem real)─► Resultado

DINHEIRO (entrada)
 OS ─(74%)─► Conta a receber ━(100%)━► Parcelas ─(72% com pagamento)─► Pagamento ┄(39% com caixa)┄► Caixa
 Caixa ━(100% vem do extrato)━ Extrato          Caixa ┄(21% explicado por documento)┄ Documento

DINHEIRO (saída) E COMPRAS
 Pedido de compra ┄(sem ligação)┄ Compra de fornecedor ┄(0% com conta a pagar)┄► Conta a pagar
 Compra ┄(6% das entradas)┄► Estoque (lote) ┄(estoque_minimo: 33 de 35 abaixo)┄ Alerta

CATÁLOGO
 Produto ━(100% com preço e ficha)━► Preço ─(59% com materiais)─► Material ┄(texto livre)┄ Fornecedor
 Produto ┄(0% com máquina compatível)┄ Máquina

PARCEIROS
 Parceiro ━► Cliente ━► Conversa ━► Chamado ━► Crédito (15 concedidos, 0 usados)
```

### 4.3 Casos de uso por perfil e se funcionam com dado real

| # | Perfil | Caso de uso | Funciona hoje? | Evidência |
|---|---|---|---|---|
| UC01 | Vendedor | Atender o lead que chega pelo WhatsApp | **Sim** | 185 conversas, 152 leads, 4.059 mensagens |
| UC02 | Vendedor | Montar orçamento guiado e enviar PDF/link | **Sim** | 136 orçamentos, 104 versões |
| UC03 | Gestor | Validar atendimento e aprovar margem ou desconto | **Sim** | 5 avais registrados; fila do gestor com 0 pedidos |
| UC04 | Cliente | Aprovar orçamento e arte pelo link | **Sim** | 21 aprovações, 19 aprovações de arquivo |
| UC05 | Vendedor | Converter orçamento aprovado em OS | **Em parte** | 39 de 49; 10 aprovados parados (R$ 4.965,25) |
| UC06 | Designer | Criar arte e pedir aprovação | **Sim** | 904 arquivos |
| UC07 | Operador | Escolher a máquina, apontar, terminar | **Não na prática** | 5 de 45 OS com apontamento; último em 10/11 |
| UC08 | Operador e estoque | Dar baixa no material consumido | **Não na prática** | 4 de 45 OS; 5 saídas contra 65 entradas |
| UC09 | Atendimento | Avisar "pronto" e registrar entrega ou retirada | **Em parte** | Aviso sim; registro de entrega 2 de 45 |
| UC10 | Financeiro | Receber por parcela e conciliar extrato | **Em parte** | 39 contas; 95 linhas de extrato conciliadas, mas só 21% explicadas |
| UC11 | Financeiro | Pagar contas e comprovar | **Sim** | 112 contas, histórico, anexos, travas |
| UC12 | Estoque e financeiro | Registrar compra e refletir no estoque e no contas a pagar | **Não fecha** | 0 de 14 compras com conta a pagar; 6% das entradas |
| UC13 | Gestor | Acompanhar o quadro e a TV e cobrar atraso | **Em parte** | Quadro sim (194 mudanças de etapa); TV parada desde 16/11 |
| UC14 | Gestor | Ver margem real por OS, cliente ou produto | **Em parte** | Margem real em 13 de 26 concluídas |
| UC15 | Responsável de parceiro | Atender parceiro e reabrir chamado fechado sem atendimento | **Sim (novo)** | Entrou em 22/11; nenhum caso real ainda |
| UC16 | Parceiro | Cadastrar por convite, pedir, usar crédito | **Em parte** | 16 ativos; 0 crédito usado ainda |
| UC17 | Admin | Gerir equipe, permissões e auditoria | **Sim** | 121 permissões, 1.656 registros de auditoria |
| UC18 | Cliente | Portal: acompanhar pedido e enviar comprovante | **Não** | 0 acessos, 0 links, 0 solicitações |
| UC19 | Pós-venda | Garantia, retorno e reembolso | **Não** | 4 tabelas sem tela; a tela é só pesquisa NPS (12 pesquisas, 0 respostas) |
| UC20 | Instalador | Agendar e comprovar instalação | **Quase não** | 3 registros; papel sem pessoa |

---

## 5. Relações que faltam, são frágeis ou estão escondidas

Cada item: o que é, a prova, o impacto e a solução **proposta (não executada)**. Esforço: B (baixo), M (médio), A (alto).
Risco do banco: toda proposta de estrutura é **aditiva** (coluna nova opcional ou tabela de apoio, com ensaio e `ROLLBACK`).

### 5.1 No banco (estrutura que não existe)

**R1. Compra de material não gera conta a pagar nem entrada de estoque ligada** (esforço A, risco médio)
- Prova [medido]: `compras_fornecedor` (14) não tem coluna para conta a pagar; `material_lotes` e `movimentacoes_estoque` não têm
  coluna de compra; 14 de 14 compras estão marcadas `pago` e **0** têm conta a pagar do mesmo valor e fornecedor; só 4 das 65
  entradas de estoque têm origem `compra`; `contas_pagar` não tem `os_id` nem `material_id` preenchidos (0 de 112: 110 vêm de
  compromissos fixos).
- Impacto: o custo médio do material, o fluxo de caixa e o "quanto devo ao fornecedor" não se reconstroem da compra. A mesma saída
  aparece só no extrato (R1 e R4 são a mesma ferida).
- Proposta: `contas_pagar.compra_id` e `compra_item_id` em `material_lotes` e `movimentacoes_estoque`, todos opcionais; uma função
  única `registrar_compra()` que, numa só transação, cria ou vincula a conta a pagar, gera o lote e a entrada de estoque; preenchimento
  assistido das 14 compras existentes.

**R2. Fornecedor é texto livre em quatro estruturas** (esforço M, risco baixo)
- Prova [medido]: `pedidos_compra.fornecedor`, `contas_pagar.fornecedor` (112 de 112), `materiais.fornecedor` (63) e
  `material_lotes.fornecedor` são texto. Só `compras_fornecedor` tem chave para `fornecedores` (5 cadastrados). Em `contas_pagar`
  há 3 nomes distintos e nenhum bate exatamente com `fornecedores.nome`.
- Impacto: não existe "tudo o que comprei e devo de um fornecedor".
- Proposta: `fornecedor_id` opcional nas quatro estruturas, preenchido por nome normalizado com tela de revisão; o texto fica como
  legado.

**R3. Duas estruturas de compra paralelas sem relação** (decisão do dono, esforço M)
- Prova [medido]: `compras_fornecedor` (14, itens 29) é a que está em uso; `pedidos_compra` (1, itens 1) tem `quantidade_recebida`
  mas não aponta para a compra que recebeu.
- Proposta: manter `compras_fornecedor` (em uso) e fazer o pedido apontar para ela (`compras_fornecedor.pedido_id`), ou aposentar o
  pedido se o dono não o usa. O fluxo canônico é decisão do dono.

**R4. O extrato não se explica por documento** (esforço M a A, risco médio)
- Prova [medido]: de 99 movimentos de caixa, 94 vêm do extrato; **41 entradas (R$ 6.975,81) sem pagamento** e **36 saídas
  (R$ 13.002,86) sem conta a pagar**; 27 dos 44 pagamentos (R$ 1.944,57) não têm movimento de caixa e nenhum casa por valor com uma
  entrada de extrato solta.
- Impacto: risco de contar a mesma receita duas vezes (pagamento e extrato) ou de não contar. **Cuidado:** parte pode ser legítima
  (tarifa, transferência, aporte); a medida diz "falta explicar", não "está errado".
- Proposta: assistente de conciliação que sugere pareamento por valor, data (±3 dias) e nome; regra de que todo movimento tem uma
  origem **ou** um motivo explícito ("tarifa", "transferência", "sócio").

**R5. Pagamento sem parcela** (esforço B)
- Prova [medido] e [código]: 5 de 44 pagamentos sem `parcela_id`. A ficha da OS e a tela de financeiro inserem direto em
  `pagamentos` (`os.$id.tsx:1197`, `financeiro.tsx:135`), em vez de passar por `confirmar_pagamento` pela parcela, que só
  `a-receber.tsx:294` usa.
- Proposta: um caminho único (`confirmar_pagamento`), com o atalho da ficha chamando a mesma função.

**R6. Orçamento aprovado que nunca virou OS** (esforço B)
- Prova [medido]: 10 orçamentos `aprovado` sem OS, **R$ 4.965,25**, o mais antigo de 28/09. Só 1 OS sem orçamento casa com algum
  deles pelo cliente; ou seja, não são "OS soltas": ficaram sem converter.
- Proposta: aviso ao vendedor para aprovado há mais de 2 dias sem OS (a rotina `integridade-orcamentos` já existe), com a pergunta
  "converter ou dar como perdido".

**R7. Lead ↔ cliente e o status do funil** (esforço M, risco baixo)
- Prova [medido]: 3 de 152 leads têm cliente; dos 128 "em atendimento", 0. O cliente é **derivável** em 14 (pela conversa) e em
  15 (pelo telefone). 8 leads com orçamento aprovado ou convertido não estão "ganho" (10 pela conversa). A RPC
  `converter_lead_em_cliente(uuid, jsonb, boolean)` existe e a tela de leads a chama (`leads.tsx:163`), mas não há rastro de uso em
  auditoria nem em eventos; o cliente entra por fora (o assistente "novo cliente" tem 130 usos).
- Proposta: preencher o `cliente_id` derivável; fazer `aprovar_orcamento` marcar o lead como ganho; mostrar na tela o link do
  cliente criado.

**R8. Orçamento já enviado sem cliente** (esforço B, conferir)
- Prova [medido]: 28 de 97 orçamentos não rascunho sem `cliente_id`, entre eles **18 dos 29 enviados**. A OS exige cliente (100%
  têm), então a aprovação precisa criar ou ligar um. [não confirmado] como a conversão trata isso.
- Proposta: exigir cliente (ou lead com conversa) no envio, ou criar o cliente na aprovação com confirmação.

**R9. OS sem orçamento, sem conta a receber e sem vendedor** (esforço B)
- Prova [medido]: 15 OS sem orçamento e 15 sem conta a receber (14 concluídas e 1 cancelada), e 13 concluídas sem vendedor: é o
  legado/balcão anterior ao fluxo.
- Proposta: marcar explicitamente como legado (uma coluna de origem), para sair das métricas e não parecer defeito.

**R10. Do chão ao custo real** (esforço M, decisão do dono)
- Prova [medido]: de 45 OS fora da entrada, 5 têm apontamento e 4 têm baixa de estoque; 22 de 54 têm material previsto; margem real em
  13 de 26 concluídas, e `custo_real` é nulo ou zero em 41 de 54 (76%). As 13 com margem vieram de `custos_operacionais_os` e
  snapshot, não de baixa nem de apontamento.
- Impacto: a margem "real" é a margem do que foi lançado à mão, não do que foi consumido.
- **Causa provável da baixa de estoque quase inexistente [medido, 23/11]:** `baixar_estoque_os` exige `estoque.exit`, e essa permissão
  só existe para **admin, gestor e o papel estoque** (que não tem ninguém). **O operador não a tem, nem o vendedor, nem o designer:
  quem consome o material não pode dar baixa nele.** Hoje só o admin e o gestor podem, e a ficha da OS mostra o botão "Baixar
  estoque" a todos (o banco recusa quem não pode). A "falta de hábito" do operador é, em parte, falta de permissão.
- Proposta: antes de exigir consumo, **decidir quem confirma**: dar `estoque.exit` ao operador, ou criar uma função de "confirmar
  consumo previsto" que só atue sobre a OS em que ele está trabalhando (mais segura que abrir o estoque inteiro). Depois, no
  "Terminei" do operador, mostrar o consumo previsto já preenchido para confirmar com um toque, ou "sem consumo" com motivo; só
  então fechar a OS.

**R11. Entrega e retirada sem registro** (esforço B a M)
- Prova [medido]: 26 de 26 OS concluídas sem registro em `entregas_instalacoes` (3 registros no total, para 54 OS).
- Proposta: um evento de retirada ou entrega de um toque (quem retirou, quando, foto ou assinatura opcional).

**R12. Produto ↔ máquina** (decisão do dono, esforço B a M)
- Prova [medido]: `maquina_compatibilidades` com 0 linhas; o produto chega à máquina por `produto_processos` → `processos.tipo_maquina`
  (texto). Das 10 máquinas, 3 têm apontamento, 5 têm agenda, 4 têm contrato, 0 têm manutenção.
- Proposta: manter o vínculo por tipo (trocando o texto por uma lista fechada) e aposentar a tabela vazia, ou povoá-la. Não ter as
  duas.

**R13. Jobs do RIP e a OS** (esforço M)
- Prova [medido]: 4 de 38 `rip_jobs` ligados a OS; a tabela de vínculo já guarda candidatos e confiança.
- Proposta: fila de decisão a partir das sugestões que o sistema já calcula.

**R14. Estruturas gêmeas e vazias** (higiene, esforço B)
- Prova [medido]: `os_resultados` (0) ao lado de `os_resultados_financeiros` (54) e dos snapshots (13);
  `producao_3d_apontamentos` (0) ao lado de `apontamentos_producao` (7); `whatsapp_contatos` (0) e `cliente_contatos` (0), e
  `orcamentos.contato_id` com 0 de 136 preenchidos; `notificacoes_operacionais` (0) ao lado de `notificacoes_fila` (315). No total,
  **54 de 215 tabelas estão vazias** (25%).
- Proposta: para cada uma, **ligar com dono e data, ou tirar do menu**. Nada se apaga em lote: cada tabela ou arquivo só sai com prova
  de que ninguém a usa (sem import, sem rota, sem cron, sem invocação).

**R15. Pós-venda só existe como pesquisa** (decisão do dono)
- Prova [medido] e [código]: `pos_venda_tickets`, `garantias`, `retornos` e `oportunidades` (0 linhas) não são lidas por nenhuma
  tela; a tela `/pos-venda` lê só `pos_venda_pesquisas` e `pos_venda_respostas` (12 pesquisas, 0 respostas).
- Proposta: construir o mínimo (garantia e retorno ligados à OS) **ou** tirar o esqueleto. Ver seção 7: nenhum líder documenta
  pós-venda, então é diferencial, mas só se for usado.

### 5.2 Na tela (o banco sabe, a interface não mostra)

**R16. Histórico de envios** [código]: `documentos_enviados` (27) só é gravada; nenhuma tela a lê. A pergunta "o que mandei a este
cliente e quando" não tem tela.

**R17. Cliente → o que ele deve** [código e medido]: nenhuma tela de cliente lê `parcelas_receber` ou `contas_receber`; a aba
Pagamentos só lista o que foi pago. Há 15 parcelas vencidas em aberto (R$ 3.885,15) que o atendente do cliente não vê ali.

**R18. Elos de navegação que não existem** [código]: OS → orçamento de origem, OS → cliente, OS → produto e ficha, OS → entrega,
orçamento → conversa, máquina → OS e apontamentos, material → compras, fornecedor e produtos, fornecedor → pedidos e contas a
pagar, pós-venda → OS e cliente, cliente → parceiro, lead → orçamento e cliente (a RPC devolve o id, que não vira link).
Parciais: orçamento → PDFs, OS → conta a receber, OS → compra, conversa → lead (link genérico). Na seção 4.2 cada elo tem o % do
dado: a ligação **existe no banco** em 72% das OS (orçamento) e em 100% dos itens de OS (custo), mas não aparece.

**R19. Perfis e telas** [código, a validar com o dono]: o vendedor converte em OS mas não abre `/a-receber`; o operador não abre
`/materiais`; o designer não vê orçamentos; o financeiro não abre o WhatsApp mas o servidor cobra por WhatsApp; máquinas, agenda e
capacidade abrem com `os.read`, então vendedor, financeiro, estoque, designer e instalador as veem; o estoque abre `/precos`, com
custo e margem. A ficha da OS não tem trava de permissão no front em três ações (status, baixar estoque, finalizar); o banco
recusa quem não pode (`baixar_estoque_os` exige `estoque.exit`), então é desorientação, não furo. `margem.read` não é lida por
nenhuma tela. O fallback de permissões no código está defasado em relação ao banco (7 chaves a mais para o vendedor).

### 5.3 Segurança (conferir, nenhuma falha aberta provada hoje)

**R20.** [medido]
- 7 funções privilegiadas abertas a `anon`: `abrir_aprovacao`, `arquivo_em_aprovacao_aberta`, `registrar_decisao_aprovacao`,
  `convite_de_parceiro`, `parceiro_cadastrar_rapido`, `programa_parceiros_publico` e `can_see_prices`. Seis são os fluxos públicos
  do desenho (aprovação por link, convite e cadastro de parceiro, já endurecidos e testados em 03/11 e 16/11).
  `can_see_prices(uuid)` aberta a `anon` não tem motivo claro (diz se um id tem permissão de preço); proposta: revogar depois de
  provar que nenhuma política para `anon` a usa.
- `parceiro_cadastrar_rapido` aceita um código-casa `BEXPRINT` [código]: confirmar com o dono se esse código é público por desenho
  e qual é a regra mínima de senha [não confirmado].
- **14 views sem `security_invoker`** (eram 3 em 02/11): as `*_financeiro` são assim por desenho (visão financeira com barreira);
  as `*_comercial` (`orcamentos`, `ordens_servico`, `itens_os`, `orcamento_itens`, `produtos`) pedem prova de que filtram por quem
  pergunta. Proposta: conferir uma a uma.
- **14 tabelas com RLS e nenhuma política** (`tv_*`, `catalogo_*`, `portal_cliente_links`, `permissoes_excecoes*` e outras): "ninguém
  acessa pelo app, só o servidor" é seguro, mas não está documentado; alguém pode "consertar" criando política aberta. Proposta:
  `COMMENT ON TABLE` e um teste que proíba política aberta nelas.
- Neste repositório **não existe a guarda automática** de funções abertas a `anon` (`supabase/tests` está vazio). Proposta: criar
  uma consulta de guarda e um teste que falhe se aparecer função privilegiada nova aberta a `anon`.

### 5.4 Falsos alarmes, provados (não são defeito)

- **26 colunas `_id` sem chave estrangeira:** 0 órfãos em 1.833 valores testados. As colunas polimórficas (`entidade_id`,
  `referencia_id`, `registro_id` e semelhantes) não podem ter chave única e estão corretas. `alertas_integridade.fila_id` aponta para
  `notificacoes_fila` (0 órfãos); testado contra `whatsapp_fila_envio` daria 18 "órfãos" falsos.
- **Orçamento ↔ OS:** 0 divergências nos dois sentidos (39 de 39); cliente da OS igual ao do orçamento em 39 de 39; vendedor
  divergente em 1.
- **Conversa ↔ cliente:** 0 conversas com o telefone de um cliente e sem vínculo. Os 133 contatos sem cliente são prospects, não falha.
- **Banco:** RLS em 100%, 0 política de escrita aberta, 0 função privilegiada sem `search_path` fixo.
- **Rotinas:** 9 de 9 com sucesso; sem falha em 7 dias.
- **Rotas:** só 1 rota da equipe sem nenhuma entrada (`/importar-flexi`, de abrir por endereço, dito no próprio menu).

### 5.5 Candidatos a código morto (listar, nunca apagar sem prova)

O mapa achou **32 arquivos inalcançáveis de um total de 933** em `src`. Conferi por amostra: `src/lib/mock-data.ts` e
`src/lib/api/example.functions.ts` não têm importador. Os demais, por grupo (a prova de cada um está no mapa): 14 componentes de
interface não usados (`accordion`, `carousel`, `drawer`, `form` e outros), 4 `schemas.ts` e `normalizacao.ts` de domínio,
`domain/financeiro/extrato.ts` (só um teste o importa; as telas usam `@/lib/extrato`, então o teste cobre uma cópia sem uso),
`domain/simulacao/*` (só script e teste) e dois barrels. A trava `sem-modulo-orfao` compara por nome de arquivo, sem o caminho, e por
isso deixa passar casos como `extrato` e `types`.

---

## 6. A lógica aplicada, módulo a módulo

### 6.1 Preço e orçamento: forte (manter)
Custo cheio × multiplicador, área útil da chapa, preço mínimo com aval do gestor, versões congeladas no reenvio, trava de status
no banco (`tg_orcamento_transicao_de_status`), aprovação por link com IP e nome, e os assistentes em passos. O troféu repete o
desenho com cotação só no servidor. **Fraqueza:** 29% dos orçamentos enviados sem cliente (R8) e 10 aprovados sem OS (R6). **Mudar:**
só o fecho (R6, R7, R8). Nada do motor de preço.

### 6.2 OS e processo: desenho forte, fecho fraco
A máquina de estados tem travas na tabela (OS de venda não avança sem a validação do gestor), "quem faz cada etapa" e linha do tempo
com 194 mudanças registradas. **Fraqueza:** as travas protegem a ordem das etapas, mas nada obriga a **provar o que aconteceu**
(consumo, tempo de máquina, entrega). O quadro mostra o que alguém clicou, não o que a máquina fez (R10, R11).

### 6.3 Chão e máquinas: o laço aberto mais caro
Apontamento, agenda, TV, RIP e compatibilidade existem, e quase nada alimenta o resto: 11% de apontamento, TV sem ser vista desde
16/11, `maquina_compatibilidades` vazia, RIP 11% ligado. A lógica do apontamento (uma máquina por vez, recusa de OS no atendimento)
está certa; falta o hábito e o caminho curto no celular do operador.

### 6.4 Compras e estoque: o elo mais frágil
É o único ponto onde a lógica **não** é de relação, e sim de texto e ação manual (R1 a R3). O alerta de estoque mínimo está
saturado: 33 de 35 materiais com mínimo estão abaixo dele. Ou os mínimos estão irreais, ou as entradas estão incompletas (só 4
entradas de compra em 65). Antes de ligar qualquer alarme novo, é preciso um inventário e uma recalibragem; do contrário o alerta vira
ruído.

### 6.5 Financeiro: disciplina boa, cadeia incompleta
Contas a pagar com histórico, anexos e travas de estorno; contas de consumo; extrato com conciliação (95 de 95 linhas ligadas ao
caixa). **Fraqueza:** a conciliação liga o extrato ao caixa, mas não o caixa ao documento (21%); pagamento por fora da parcela;
sem nota fiscal no sistema (não há tabela nem rota; a emissão acontece fora, a confirmar com o dono) e sem comissão em uso
(`comissoes` com 0 linhas e uma regra só, para o gestor).

### 6.6 Parceiros: diferencial, ainda sem uso real
Programa completo (níveis, crédito de entrada, avisos, "sem contato", reabertura, tela de créditos). **Fraqueza:** 0 crédito usado,
`parceiro_orcamentos.os_id` sem chave e 0 de 6 preenchidos, uma conta de teste ativa. O ganho aqui é de uso, não de código.

### 6.7 Mensagens e rotinas: forte (manter)
Fila com bloqueio de número nas três filas, lembretes de segunda a sábado, 9 de 9 rotinas com sucesso. **Pendência:** o primeiro envio
com as correções é o de segunda 23/11 (09:00 "Olá, Raymison!" e 09:10 parceiros).

### 6.8 Segurança e perfis: forte (manter), com conferências
Seção 5.3. A concentração em uma pessoa por papel é risco de operação, não de código.

---

## 7. Comparação com os melhores do segmento

Fontes: páginas públicas de Mubisys, YoPrint, Printavo e shopVOX; do Holdprint, a conta de teste de 31/10 e 01/11 já documentada
no repositório mais resumos de busca (o site dele não renderizou). **As notas dos concorrentes são só de funcionalidade anunciada,
não de teste lado a lado**, e "não verificado" não conta. Escala: Sim 100, Parcial 50, Não 0.

| Capacidade | Bex Print: existe | Bex Print: roda com dado | Líder | O que o líder faz |
|---|---|---|---|---|
| a. Funil e origem do lead | Sim | Parcial (lead↔cliente 2%) | Holdprint | Funil, etapas, meta, várias propostas por oportunidade. **Origem do lead: nenhum dos cinco mostra** (o Bex tem 152 de 152 com origem) |
| b. Custeio e preço | Sim | Sim | Holdprint, Mubisys | Custo-hora por centro, aproveitamento de bobina. **Preço mínimo e aval: não achei em nenhum** |
| c. Versões, link, prova | Sim | Sim | YoPrint, shopVOX | Estados enviado, visto, aprovado; prova em tamanho real |
| d. Orçamento → OS e ficha | Sim | Parcial (72%) | YoPrint | Ficha impressa com QR que abre o pedido |
| e. Quadro, capacidade, apontamento | Sim | Parcial (apontamento 11%) | Holdprint, Printavo | Terminal de apontamento, previsto × realizado, agenda por máquina |
| f. Estoque, compras, baixa por OS | Parcial | Não (baixa 9%, compra 6%) | Holdprint, YoPrint | Orçamento aprovado reserva a matéria-prima, o operador aponta, o sistema dá baixa; compra com recebimento parcial |
| g. Financeiro, NF, comissão | Parcial | Parcial | Mubisys, Holdprint | Pagar e receber, conciliação, **NF-e e NFS-e**, comissão só depois do pagamento do cliente, DRE |
| h. WhatsApp e automações | Sim | Sim | Mubisys, Holdprint | Caixa de atendimento e disparos; o Bex é de nível equivalente |
| i. Portal e loja | Parcial | Parcial (parceiro sim, cliente 0) | shopVOX, YoPrint | Portal com pagamento, reorder, loja. **Portal de parceiro ou revenda: nenhum dos cinco mostra** |
| j. Pós-venda | Parcial | Não (NPS sem resposta) | ninguém | **Nenhum líder documenta garantia ou retorno** |
| k. Relatórios e lucratividade | Parcial | Parcial (margem real 50%) | Mubisys, Holdprint | Curva ABC, margem por produto e cliente, ponto de equilíbrio |
| l. Integrações e API | Parcial | Parcial | YoPrint, shopVOX | Catálogos de fornecedor, gateways, contabilidade, Zapier, API aberta |
| m. Permissões e auditoria | Sim | Sim | ninguém publica | **Nenhum líder publica perfis de acesso nem auditoria** |

**Nota por funcionalidade (média das linhas verificadas):** Bex Print **77 existe** e **58 roda com dado**; Holdprint 85 (10 linhas);
shopVOX 67 (9); Mubisys 65 (10); YoPrint 55 (10); Printavo 55 (11). O número de linhas difere porque o que não foi verificado fica
de fora.

**Leitura honesta.**
- Em **desenho**, o Bex Print já está na faixa dos líderes (77 contra 55 a 85). Não precisa de mais módulos.
- Em **fecho com dado**, cai para 58: a distância para o Holdprint não está no que existe, e sim no que está ligado e usado
  (f, e, k, g).
- **Onde já está à frente ou único:** origem do lead, preço mínimo com aval do gestor, portal e programa de parceiros, permissões e
  auditoria, chamado de parceiro com aviso. São diferenciais reais, e só valem se continuarem sendo usados.
- **Onde os líderes têm algo que o Bex não tem:** emissão de NF-e e NFS-e dentro do sistema (decisão do dono: dentro ou com o
  contador), loja online com pagamento, aplicativo móvel de apontamento e relatórios de lucratividade já prontos.

As 8 capacidades que, segundo o levantamento, mais diferenciam os líderes de um sistema "bom mas jovem", e onde o Bex está:
(1) previsto × realizado — **laço aberto** (R10); (2) aprovação rastreada — **tem**; (3) custeio profundo — **tem**; (4) fiscal e
financeiro no mesmo sistema — **parcial, sem NF** (R1, R4); (5) WhatsApp ligado ao funil — **tem**, lead↔cliente fraco (R7);
(6) agenda com capacidade — **parcial** (R12); (7) portal do cliente — **instalado, vazio**; (8) lucratividade — **parcial** (R10).

---

## 8. Plano proposto (nada disto foi executado)

Princípio do dono: **mudar o necessário, melhorar o que já tem, manter o que serve.** Por isso o plano **não cria módulo novo**: liga o
que existe. Ganho = pontos estimados da nota geral (estimativa, não promessa).

### Onda 1: só a tela, sem tocar no banco (esforço B a M, risco quase nulo, +5 pontos)
- **Faixa "Relacionados"** na ficha do cliente, do orçamento e da OS (padrão de Odoo e Stripe), com os elos de R16 a R18: cliente →
  o que deve (parcelas e vencidas), OS → orçamento de origem, cliente, produto, entrega e conta a receber; orçamento → conversa e
  PDFs enviados (`documentos_enviados`, que já é gravado); material → compras, lotes e produtos; máquina → OS e apontamentos.
- Corrigir os desencontros de permissão da seção R19 (vendedor vê o a receber; operador vê o material; trava de tela nas três ações da OS).
- Dimensão afetada: 9 (43 → cerca de 80).

### Onda 2: acréscimos pequenos no banco, com ensaio e `ROLLBACK` (esforço M, risco baixo a médio, +8 pontos)
- R7 preencher `cliente_id` derivável dos leads e marcar o lead como ganho quando o orçamento é aprovado.
- R6 aviso de "aprovado sem OS" e R8 cliente obrigatório no envio.
- R5 caminho único de pagamento (pela parcela).
- R9 marcar o legado/balcão.
- R10 e R11 "confirmar consumo" no "Terminei" e evento de entrega de um toque (**decisão do dono sobre obrigatoriedade e sobre
  quem confirma o consumo: o operador hoje não tem `estoque.exit`**).
- Chaves estrangeiras de endurecimento nas colunas com 0 órfão: `orcamentos.conversa_id`, `arquivos.conversa_id`,
  `parceiro_orcamentos.os_id`, `whatsapp_atendimentos.responsavel_id`, `whatsapp_conversa_leituras.user_id` e
  `alertas_integridade.fila_id` (para `notificacoes_fila`). **Nenhuma** chave nas colunas polimórficas.
- Dimensões afetadas: 2, 3, 4 e 1.

### Onda 3: cadeia de compra e conciliação (esforço A, risco médio, depende de decisão, +6 pontos)
- R1 e R2 compra → conta a pagar → lote e entrada de estoque, e `fornecedor_id`.
- R3 o fluxo canônico (compra importada ou pedido).
- R4 assistente de conciliação do extrato com origem ou motivo.
- **Antes de tudo:** inventário e recalibragem dos mínimos de estoque, senão o alerta de 33 de 35 só aumenta o ruído.
- Dimensões afetadas: 5 e 3.

### Onda 4: higiene e decisões de produto (+2 pontos)
- R12 a R15: povoar ou aposentar `maquina_compatibilidades`; fila de decisão do RIP; estruturas gêmeas e vazias (ligar ou tirar do menu);
  pós-venda (mínimo ou retirar).
- Conferências de segurança do R20 e guarda automática de funções abertas a `anon`.
- Código morto: um por um, com prova, nunca em lote.

| Etapa | Nota estimada |
|---|---|
| Hoje | 60 |
| Depois da Onda 1 | 65 |
| Depois da Onda 2 | 73 |
| Depois da Onda 3 | 79 |
| Depois da Onda 4 | 81 |

Passar de 90 depende de **hábito**: operador apontando, baixa de estoque, registro de entrega, TV na parede. Isso é gente e rotina,
não código.

### O que manter, melhorar e mudar (resumo)

| Manter (serve) | Melhorar (já existe, falta ligar ou usar) | Mudar (decisão do dono) |
|---|---|---|
| Motor de preço, preço mínimo e aval; versões e aprovação por link | Lead→cliente e status do funil | Fluxo canônico de compra (R3) |
| Máquina de estados da OS e travas no banco | Apontamento, baixa de estoque e entrega com um toque | NF-e e NFS-e: dentro do sistema ou com o contador |
| Fila de mensagens com bloqueio e rotinas (9 de 9) | Conciliação do extrato com documento | Pós-venda: construir o mínimo ou retirar |
| Portal e programa de parceiros | Relacionados na tela; histórico de envios | Portal do cliente: ligar com dono e data, ou tirar do menu |
| RLS em 100%, funções com `search_path` fixo | Fornecedor por chave; compra → pagar → estoque | Obrigar consumo e entrega para fechar a OS (rigidez × operação) |
| Estados de vazio, dicas, assistentes em passos | Documentar e testar as 14 tabelas sem política e as 14 views | Reserva para papéis de pessoa única (pagar, validar, apontar) |

---

## 9. Decisões que só o dono pode tomar

1. Qual é o fluxo canônico de compra: nota importada (`compras_fornecedor`, em uso) ou pedido (`pedidos_compra`, 1 uso)?
2. Autoriza o preenchimento assistido de dados (lead→cliente derivável; fornecedor por chave nas 14 compras e 112 contas)? É escrita em
   produção, com ensaio e `ROLLBACK`, feita só depois do "sim".
3. Fechar a OS passa a exigir consumo confirmado e registro de entrega, ou continua opcional? **Antes disso: quem confirma o
   consumo?** Hoje o operador não tem `estoque.exit` e não pode dar baixa (R10): ou ele ganha essa permissão, ou nasce uma função
   de "confirmar consumo previsto" restrita à OS dele.
4. A emissão de nota fiscal é do sistema ou do contador?
5. Pós-venda: construir o mínimo (garantia e retorno ligados à OS) ou retirar do esqueleto?
6. Portal do cliente (0 acessos): ligar com dono e data, ou tirar do menu?
7. Estoque: inventário e novos mínimos antes de qualquer alarme.
8. Papéis sem pessoa (estoque, instalador) e função de reserva para pagar, validar e apontar.
9. O código-casa `BEXPRINT` do cadastro de parceiro e a regra mínima de senha.
10. Comissão (pendente de 21/11): hoje só o gestor tem regra e a tabela tem 0 linhas.

---

## 10. O que este diagnóstico não mediu

- **Não abri as telas no navegador logado.** As ligações da tela vêm de leitura do código; "não tem" significa que não achei no
  arquivo da tela, não que testei o clique.
- **Interface:** contraste, foco de teclado e layout no celular não foram reavaliados desde 02/11.
- O uso das telas por clique **não se mede**: a telemetria (`uso_de_telas`) cobre só os cinco assistentes "novo cliente, usuário,
  produto, material e máquina".
- **Concorrentes:** as notas são de funcionalidade anunciada em página pública, não de teste. Holdprint veio de conta de teste e de
  resumos de busca; Zênite e Calcgraf ficaram de fora por falta de fonte aberta.
- **[não confirmado]:** como a conversão trata orçamento enviado sem cliente; a regra de senha do cadastro público de parceiro.
  (As permissões por papel que li do código foram conferidas no banco vivo e batem: o gestor não tem `pagamentos.*`, o vendedor não
  tem `financeiro.read`, o operador não tem `custos.read` nem `estoque.read`, o financeiro não tem WhatsApp e o designer não tem
  orçamentos.)
- O primeiro envio real das rotinas corrigidas é o de segunda, 23/11.
- Parte dos movimentos de caixa "sem origem" pode ser legítima (tarifa, transferência, aporte).

---

## 11. Consultas para repetir a medição (somente leitura)

```sql
-- Ligações do funil
select count(*) leads, count(*) filter (where cliente_id is not null) com_cliente from leads;
select count(*) filter (where status::text='aprovado' and os_id is null) aprovados_sem_os,
       round(coalesce(sum(valor_total) filter (where status::text='aprovado' and os_id is null),0),2) valor
from orcamentos;

-- Chão: OS fora da entrada com apontamento, baixa de estoque e entrega
select count(*) os,
  count(*) filter (where exists (select 1 from apontamentos_producao a where a.os_id=o.id)) com_apontamento,
  count(*) filter (where exists (select 1 from movimentacoes_estoque m where m.os_id=o.id)) com_baixa,
  count(*) filter (where exists (select 1 from entregas_instalacoes e where e.os_id=o.id)) com_entrega
from ordens_servico o where o.status::text not in ('entrada','cancelado');

-- Caixa explicado por documento
select count(*) movimentos,
  count(*) filter (where pagamento_id is not null or conta_pagar_id is not null or os_id is not null) explicados
from caixa_movimentos;

-- Compras com conta a pagar do mesmo valor e fornecedor (hoje 0 de 14)
select count(*) from compras_fornecedor c join fornecedores f on f.id=c.fornecedor_id
where exists (select 1 from contas_pagar p where round(p.valor,2)=round(c.total,2)
              and lower(p.fornecedor) like '%'||lower(split_part(f.nome,' ',1))||'%');

-- Colunas de relação sem chave estrangeira (conferir cada uma antes de chamar de defeito)
with c as (select cl.oid reloid, a.attname, a.attnum from pg_attribute a join pg_class cl on cl.oid=a.attrelid
           where cl.relnamespace='public'::regnamespace and cl.relkind='r' and a.attnum>0 and not a.attisdropped
             and a.atttypid='uuid'::regtype and a.attname ~ '_id$'),
     f as (select conrelid, unnest(conkey) attnum from pg_constraint where contype='f' and connamespace='public'::regnamespace)
select count(*) total, count(*) filter (where exists (select 1 from f where f.conrelid=c.reloid and f.attnum=c.attnum)) com_fk from c;

-- Segurança: funções privilegiadas abertas a anon
select p.proname from pg_proc p where p.pronamespace='public'::regnamespace and p.prosecdef
  and has_function_privilege('anon', p.oid, 'EXECUTE') order by 1;

-- Tabelas vazias
select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE'
  and (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text::int = 0
order by 1;
```
