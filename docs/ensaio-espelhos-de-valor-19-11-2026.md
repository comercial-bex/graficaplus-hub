# O desconto some da tela e do PDF: espelhos de valor (19/11/2026)

Migração: `supabase/migrations/20261119200000_espelhos_de_valor_seguem_o_gatilho.sql`.

## O que o dono viu

No orçamento #261 (Michely Leite de Amorim) o desconto de 20% não aparecia nem na tela da equipe nem no PDF do
cliente. A tela mostrava total R$ 1.604,89 e margem de 84,2%.

A tabela `orcamentos` estava certa:

| Campo | Valor |
| --- | --- |
| Subtotal | R$ 1.604,89 |
| Desconto | R$ 320,98 |
| Total | R$ 1.283,91 |

## Por quê

- **De onde a tela e o PDF leem o preço.** Leem pelas visões `orcamentos_financeiro` e `orcamentos_comercial`.
  Essas visões tiram subtotal, total, percentual de desconto, custo e margem de um **espelho**, a tabela
  `orcamento_custos`.
- **Quem copia para o espelho.** É o gatilho `tg_sync_orcamento_custos`, criado como `AFTER INSERT OR UPDATE OF
  valor_subtotal, valor_total, …`. Um gatilho "UPDATE OF colunas" só dispara quando o `UPDATE` **cita** uma dessas
  colunas.
- **Por que o desconto não chega lá.** `definir_desconto_do_orcamento` grava só `desconto_modo` e
  `desconto_informado`. Quem recalcula `valor_total` e `desconto_percentual` é o gatilho BEFORE de totais. Mudança
  feita por gatilho BEFORE não conta para "UPDATE OF" (está na documentação do Postgres).
- **O resultado.** O desconto aplicado pelo quadro de desconto ficava fora do espelho até alguém mexer num item.

**Quatro orçamentos estavam assim em 19/11/2026, todos com desconto:**

| Orçamento | Situação | Desconto | Espelho dizia | Tabela diz |
| --- | --- | --- | --- | --- |
| #108 | convertido (OS 169) | 40% | R$ 682,50 | R$ 409,50 |
| #187 | enviado | 19% | R$ 112,32 | R$ 90,98 |
| #191 | aprovado (OS 219) | 15% | R$ 58,34 | R$ 49,59 |
| #261 | enviado | 20% | R$ 1.604,89 | R$ 1.283,91 |

**O que estava certo:**

- **As OS 169 e 219** nasceram com o valor certo (R$ 409,50 e R$ 49,59), porque a conversão lê a tabela.
- **O link do cliente e o texto do WhatsApp** também leem a tabela.

**O PDF do cliente lê a visão e saiu sem desconto:**

- #187: gerado duas vezes em 06/11;
- #191: gerado em 06/11;
- #261: gerado em 19/11, às 16h20.

**O mesmo risco nos itens de OS.** `tg_sync_item_os_custos` é "UPDATE OF valor_unitario, custo_unitario,
valor_total". Quando muda só a quantidade, a largura ou a altura de um item com preço por m², o gatilho BEFORE
`tg_item_os_precificar_por_area` recalcula o valor, e o espelho `item_os_custos` não segue. Hoje nenhum item está
diferente, mas o caminho existe (ver o controle abaixo).

## A correção

1. **Os dois gatilhos de espelho disparam quando o valor muda, venha de onde vier.** Cada um passa a ser `AFTER
   UPDATE … WHEN (OLD.x IS DISTINCT FROM NEW.x OR …)`, com as mesmas colunas de antes, mais um gatilho `AFTER
   INSERT` (`…_ao_criar`).
   - A função de cada um não muda.
   - Os nomes ficam na mesma posição alfabética, então a ordem dos gatilhos AFTER não muda.
2. **O espelho dos orçamentos é ressincronizado com a tabela.** Só `valor_total` e `desconto_percentual`, que são a
   diferença do desconto. Qualquer outra diferença, ou orçamento sem linha no espelho, faz a migração parar.
3. **Um rastro `espelho_de_valor_resincronizado` por orçamento corrigido**, com o número e sem valor.

O gatilho da OS (`tg_sync_os_resultados_financeiros`) fica como está: nenhum gatilho BEFORE de `ordens_servico`
mexe nas colunas que ele espelha. Os quatro espelhos foram conferidos: OS 54 de 54, itens de OS 67 de 67, itens de
orçamento 171 de 171 iguais à tabela; orçamentos 4 de 135 diferentes.

## Controle sem a correção (19/11/2026, desfeito por RAISE EXCEPTION)

O caso de teste, rodado como o gestor Raymison sobre os gatilhos de antes:

| Caso | Banco | O que a tela lê |
| --- | --- | --- |
| Desconto de 10% no rascunho #251, que tem R$ 37,83 de itens | R$ 34,05 | R$ 37,83, desconto 0% |
| Item de OS `a34ff918`, quantidade de 2 para 3 | R$ 180,00 | espelho R$ 120,00 |

## Ensaio com a correção (19/11/2026, desfeito por RAISE EXCEPTION)

A migração inteira, sem o `COMMIT`, seguida dos mesmos casos, como o gestor:

| Caso | Resultado |
| --- | --- |
| Ressincronização | #108, #187, #191 e #261, um rastro para cada |
| O gestor lê o #261 pela visão | subtotal 1.604,89, total **1.283,91**, desconto 20%, custo 254,30 |
| Desconto de 10% no #251 | banco 34,05, visão **34,05** |
| Tirar o desconto do #251 | banco 37,83, visão 37,83 |
| Item de OS `a34ff918`, quantidade 3 | tabela 180,00, espelho **180,00** |

A conferência final da migração passou:

- espelho e tabela iguais em todos os orçamentos e itens de OS;
- os quatro gatilhos no lugar;
- as duas funções de gatilho sem `EXECUTE` para `anon` e `authenticated`.

**Depois dos dois ensaios, conferido no banco:**

- os gatilhos de antes, com `UPDATE OF`;
- os 4 espelhos ainda atrasados;
- nenhum rastro de ressincronização;
- o #251 sem desconto, com R$ 37,83;
- o item `a34ff918` com 2 peças e R$ 120,00.

## Aplicação

Aplicada pelo Claude Code com a autorização do dono para a Bex Print, depois do ensaio e do CI verde. A conferência
depois da aplicação está no PR.

**Depois de aplicar, é preciso refazer o PDF** dos orçamentos com PDF já gerado: #261 e #187, que estão enviados.
O PDF antigo fica no histórico com o preço cheio. O #191 já virou a OS 219 com o valor certo.
