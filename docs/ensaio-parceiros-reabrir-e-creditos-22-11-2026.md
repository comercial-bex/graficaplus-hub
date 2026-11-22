# Parceiros: reabrir chamado fechado sem atendimento, aviso que não o esconde e tela de créditos (22/11/2026)

Migrações novas: `20261122600000_parceiro_reabrir_chamado.sql`, `20261122610000_aviso_de_parceiros_nao_esconde_chamado_fechado.sql`
e `20261122700000_parceiros_creditos_painel.sql`. Tela nova: `/parceiros-creditos` (aba de Parceiros).

## O estado do banco antes (conferido em 22/11/2026, só leitura)

- As migrações `20261119120000` (coluna `fechado_sem_contato`, bloco "Chamados fechados sem nenhuma mensagem") e
  `20261119130000` (aviso sem o nome de quem fechou) **já estavam aplicadas desde 19/11/2026**, como dizem os cabeçalhos
  dos arquivos: a função de lista já devolve `fechado_sem_contato`, o lembrete já tem o bloco e já não cita quem fechou, e as
  permissões estão certas (`anon` e `authenticated` sem acesso às internas). Reaplicar não faria nada (a primeira para pela
  guarda de md5, a segunda é idempotente), então não foram reaplicadas.
- Os 8 parceiros "fechados sem atendimento" **já foram reabertos à mão em 19/11/2026 às 17:01:04** (origem `manual`,
  `reaberto_de` preenchido): Aline, Black produções, Connecta, Criativa Serviços Digitais, Jota Comunicação Visual, Longa data,
  Neon comunicação visual e Wa. Hoje nenhum está fechado sem contato; os 8 aparecem como abertos sem contato (73 h), no cartão
  e na simulação do aviso (7 pelo nome e a Wa em "E mais 1", pelo limite de 15 linhas).
- O lembrete de hoje (domingo, 22/11) **não envia por regra**: `lembrete_parceiros_sem_contato` devolve `domingo`, e o
  agendamento `parceiros-sem-contato` roda de segunda a sábado às 09:10 (Macapá). O próximo é segunda, 23/11. O agendamento
  `parceiro-credito-vencendo` (10:15, segunda a sábado) também está ativo, e a simulação dele hoje devolve lista vazia.

## Dois defeitos achados ao conferir (e corrigidos aqui)

1. **O aviso do grupo escondia o chamado fechado sem atendimento.** O aviso tem no máximo 15 linhas e a lista dos abertos era
   escrita primeiro: com 15 abertos sem contato (hoje são 16), o fechado caía em "E mais N" e nunca aparecia. Achado fechando a
   Wa pelo caminho real da caixa dentro de um ensaio revertido. Correção: até 5 das 15 linhas ficam guardadas para os
   fechados. O texto continua com a data e sem o nome de quem fechou.
2. **A tela Vendas diretas estava quebrada**: pedia `parceiros(nome)` e a tabela `parceiros` não tem coluna `nome` (tem
   `marca_nome`); a consulta falhava antes de listar qualquer coisa. Agora pede `marca_nome` e o nome do cliente, como o resto
   do sistema.

## `parceiro_reabrir_chamado(p_parceiro)`

Função nova que só ACRESCENTA: não altera `whatsapp_resolver` nem nenhum gatilho ou regra de fechamento da caixa do WhatsApp.

- Quem pode: `parceiros.manage` (admin e gestor) ou o responsável do próprio parceiro (que também lê parceiros). `anon` e quem
  não tem a permissão são recusados.
- Só parceiro ativo, que não seja conta de teste, com responsável, conversa e celular válido.
- Só reabre se o chamado mais recente está fechado **e** foi fechado sem nenhuma mensagem da equipe (a mesma conta do cartão e
  do aviso). Já aberto: não faz nada e diz `ja_aberto`. Fechado depois de a equipe falar: recusa com a frase.
- Abre pelo caminho de sempre (`_parceiro_garantir_chamado`), sem enviar mensagem, e **confere no banco** que o chamado novo
  existe, está aberto, é da mesma conversa e vem do fechado; se não, erro e nada fica gravado.
- Registra quem reabriu em `logs_auditoria` (`parceiro_chamado_reaberto`).
- Depois de reabrir, o chamado é "aberto agora": o prazo de 48 h do aviso recomeça (regra de `_parceiros_sem_contato`).

No cartão "Atendimento dos parceiros" (`/parceiros`) o chamado fechado sem atendimento ganha o botão **Reabrir chamado**
(só para a gerência e para o responsável do parceiro), e uma frase fixa no pé do cartão diz onde a função aparece.

## Tela de créditos (`/parceiros-creditos`)

`parceiros_creditos_painel()` (só leitura, `parceiros.read`, fechada para `anon`) devolve o saldo de cada parceiro pela **mesma
conta do cartão** (a migração confere a fórmula, e um teste compara o texto das duas) e o livro de lançamentos, com o pedido
(`parceiro_orcamentos.numero`) e a OS a que cada um se liga. A tela mostra:

- resumo: saldo disponível, já concedido, já pagou pedidos (ajuste da gerência não conta como pedido) e venceu sem uso;
- **O que vence**, por dia: hoje 14/12 (R$ 700,00 de 14 parceiros, em 22 dias) e 15/12 (R$ 50,00 de 1 parceiro, a Connecta), com o
  dia em que o aviso aos responsáveis começa (7 dias antes: 07/12 e 08/12);
- a lista de parceiros (busca, responsável, mostrar, ordem), cada um com o livro: cada lançamento e **o que ele pagou**. O uso
  sai do crédito que vence primeiro; devolução desfaz o uso do mesmo pedido; "venceu sem uso" é só a baixa. Enquanto não houve
  uso, o crédito de entrada diz a regra do programa (1ª compra, até 50% de um pedido de no mínimo R$ 150,00);
- a conferência: a soma do livro tem que bater com o saldo do banco; se não bater, a tela avisa e vale o do banco.

Ainda não há nenhum uso de crédito no banco (os 15 créditos de entrada, R$ 750,00, estão intactos), então os casos de uso,
devolução, vencimento e ajuste estão provados em teste e no navegador, não com dado real.

## Ensaios no banco vivo (desfeitos por `RAISE EXCEPTION`)

- Reabrir: ACL (`anon` não, `authenticated` sim, `public` não); Wa fechada pelo caminho real → `fechado_sem_contato`; `anon` recusado;
  vendedora que não é a responsável recusada ("Permissão necessária: parceiros.manage"); a responsável (Maiara) reabre (chamado
  novo WA-2611-0181 ligado ao fechado) e o prazo recomeça (0 h); segunda chamada → `ja_aberto` sem criar outro; a gerência
  reabre; chamado fechado depois de a equipe falar (Fb tecnologia) recusado; conta de teste e parceiro inexistente recusados;
  2 logs (Maiara e Raymison); `whatsapp_resolver` com o mesmo md5 e os 2 gatilhos de `whatsapp_atendimentos` iguais.
- Aviso: sem fechados, o texto de segunda é idêntico ao de antes; com 1 fechado entre 15 abertos, o bloco aparece com
  "Wa · fechado em 22/11", 15 linhas e "E mais 1.", sem "fechado por" e sem o nome de quem fechou; com os 8 fechados, 7 aparecem
  com a data e "E mais 1."; o caminho de enfileirar gera o mesmo texto da simulação; domingo não envia; `authenticated` não executa.
- Créditos: 15 parceiros, R$ 750,00, saldo igual ao do cartão nos 15, vencimentos 14/12 e 15/12, `anon` recusado e quem não tem
  `parceiros.read` recusado.

## Conferência

- `bunx tsc --noEmit` sem erro e `bunx vitest run`: 524 arquivos (1 pulado) e 8.698 testes aprovados (1 pulado).
- Navegador de verdade (Chromium, componentes reais, só o banco e o roteador simulados): **58 conferências, 0 falhas, 0 erros de
  console**: o cartão com cada perfil (gestor, responsáveis, quem só lê), o botão, os erros do banco, teclado, celular e tema
  escuro; a tela de créditos com os números do banco vivo, os filtros, o livro com uso, devolução, vencido e ajuste, os estados
  vazio, erro e função ausente, celular, alvos de toque e tema escuro.
- O menu aprovado (`tests/apoio/menu-aprovado.ts`) registra a aba "Créditos" como pedido do dono (22/11/2026).

## O que NÃO foi conferido

- O botão com um chamado fechado sem atendimento **de verdade**: hoje não há nenhum no banco (os 8 já foram reabertos). A
  função foi provada no banco vivo fechando e reabrindo dentro de um ensaio desfeito.
- O envio real de segunda-feira (23/11, 09:10): o texto e o caminho de enfileirar foram provados, o envio de verdade só no
  primeiro dia útil depois da aplicação.
- A tela de créditos com uso real de crédito: ainda não há nenhum.
