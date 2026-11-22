# Troféu de acrílico: gravar no orçamento e a conferência com o banco vivo (22/11/2026)

Migração: `supabase/migrations/20261122400000_salvar_trofeu_no_orcamento.sql`.
Servidor: `salvarTrofeuNoOrcamento` em `src/lib/api/trofeus.functions.ts`.

## A conferência com os números do banco vivo (depois de aplicar a 20261122300000)

A conta rodou com as linhas lidas do banco (regras, modelos, peças, materiais, custos fixos, mão de obra e máquinas), pela
mesma função que o servidor usa (`cotarTrofeuComABase`). Preço unitário, custo cheio e margem líquida:

| Modelo | 1 | 5 | 20 | 50 | Urgente (1) |
| --- | --- | --- | --- | --- | --- |
| Econômico 18 cm | **R$ 53,90** (custo 17,68; margem 42,6%) | R$ 45,90 (37,7%) | R$ 40,90 (31,9%) | R$ 36,90 (25,5%) | R$ 70,90 (×4) |
| Padrão 18 cm | **R$ 85,90** (custo 28,36; margem 42,6%) | R$ 74,90 (37,6%) | R$ 65,90 (30,6%) | R$ 60,90 (25,6%) | R$ 113,90 (×4) |
| Premium 28 cm (KR Combat) | **R$ 201,90** (custo 67,25; margem 41,7%) | R$ 179,90 (36,5%) | R$ 159,90 (29,7%) | R$ 145,90 (23,8%) | R$ 269,90 (×4) |

O premium por altura (1 troféu): 20 cm R$ 124,90; 25 cm R$ 170,90; 28 cm R$ 201,90; 30 cm R$ 223,90; 35 cm R$ 284,90.
Com arte exclusiva e 1 alteração: R$ 201,90 do troféu mais R$ 250,00 de arte (criação R$ 220,00 e alteração R$ 30,00).

Para o dono ver: **no piso (×2,2, a partir de 50 troféus) a margem líquida cai para 24–26%**, contra 42% em 1 troféu. É o que o
piso do dono entrega com as taxas de hoje; abaixo dele, o aval do gestor (simulador da etapa 3).

O que isto prova, e o que não prova: a conta com dados reais produz o preço. Ainda **nenhuma tela chama as funções de
servidor** (é a etapa 3), então o troféu ainda não saiu pela tela de orçamento. As funções de servidor estão provadas em teste
com o banco simulado, não chamadas em produção.

## A função `salvar_trofeu_no_orcamento`

Grava o troféu e as linhas de arte dele como itens do orçamento (`orcamento_itens`), sem tabelas novas:

- **O troféu:** uma linha (`origem_calculo = 'trofeu'`, `tipo_produto = 'Troféu de acrílico'`, que sai no PDF), com o preço unitário e
  o custo cheio que o servidor calculou. Sem `produto_id`: os gatilhos de custo do produto e de preço por área só agem em item com
  produto ou com `preco_m2`, então o valor fica como o servidor mandou.
- **A arte:** uma linha por item (criação exclusiva, alteração extra, nome individual), `origem_calculo = 'trofeu_arte'`,
  `tipo_produto = 'Arte do troféu'`, com o id do troféu em `parametros.trofeu_item_id`. **Não usa `gerado_por_item_id`**: essa coluna
  é das respostas que cobram e apaga em cascata. Salvar de novo o mesmo troféu troca as linhas de arte dele e só as dele.
- **A criação exclusiva leva o custo das horas de designer** (3 h × (mão de obra com encargos + rateio) = R$ 74,20); alteração e nome
  individual entram sem custo próprio. O desconto da arte por quantidade baixa o preço, não o custo.
- **Só entra em orçamento que ainda não virou OS**, e só altera troféu deste orçamento.
- **Segurança:** a função grava, então nasce fechada: `REVOKE ALL ... FROM PUBLIC, anon, authenticated` e só `authenticated`
  recebe `EXECUTE` de volta, porque o servidor chama com o cliente do próprio usuário e a função confere `orcamentos.create` por
  `auth.uid()`. A conferência final da migração prova que `anon` e `public` não executam.
- **Privacidade:** `custo_unitario`, `valor_unitario` e `parametros` de `orcamento_itens` não têm `SELECT` para `authenticated`
  (conferido no banco); só `especificacao` é lida pela equipe, e ela leva altura, número de peças e urgência, nunca valor.

## O servidor: `salvarTrofeuNoOrcamento`

- Entrada estrita: o navegador manda o que o vendedor escolheu (modelo, altura, quantidade, urgência, arte), o orçamento e, no máximo,
  o **total que viu**. Esse total só é comparado com a conta daqui (diferente: "O preço mudou desde a última conta. Confira o novo
  valor e salve de novo."); nunca é gravado. Preço, custo, valor, multiplicador e taxa são recusados.
- Recalcula com a mesma função da cotação e chama a RPC com o cliente do usuário. Devolve só ids e o preço gravado.
- As frases da conta ("A altura vai de 12 a 40 cm.") e da RPC ("Este orçamento já virou OS...") passam adiante; resposta do banco
  sem `item_id` é erro ("O banco não confirmou a gravação do troféu..."), nunca sucesso.

## Ensaio no banco vivo (22/11/2026, desfeito por RAISE EXCEPTION)

A migração inteira, sem o COMMIT, e depois, com `SET LOCAL ROLE` e o `sub` do usuário de cada papel, num orçamento em rascunho:

| Caso | Resultado |
| --- | --- |
| Vendedor grava o premium (R$ 201,90, custo 67,25) com arte exclusiva e 1 alteração | 3 linhas: troféu R$ 201,90, criação R$ 220,00 (custo 74,20) e alteração R$ 30,00; `produto_id` vazio; `valor_total` calculado pelos gatilhos |
| Vendedor edita o mesmo troféu: 5 unidades a R$ 179,90 e a arte sem a alteração | troféu 5 × R$ 179,90 = R$ 899,50; a alteração saiu, a criação ficou (uma linha de arte) |
| Designer (sem `orcamentos.create`) | "Permissão necessária: orcamentos.create" |
| `anon` | "permission denied for function salvar_trofeu_no_orcamento" |
| Orçamento que já virou OS | "Este orçamento já virou OS: os itens ficam como foram vendidos." |
| Preço zero | "O troféu está sem preço: refaça a conta antes de salvar." |
| Item de troféu de outro orçamento | "Este troféu não pertence a este orçamento." |
| Modelo inexistente | "Modelo de troféu não encontrado ou desativado." |
| Quantidade 2,5 | "A quantidade de troféus precisa ser um número inteiro, de 1 para cima." |
| `has_function_privilege` | `anon` falso, `authenticated` verdadeiro |

## Testes novos

- `tests/trofeus-no-servidor.test.ts` ganhou a parte de gravar: entrada estrita, permissão antes de ler e de gravar, o preço e o
  custo gravados são os da conta do servidor, comparação do total visto, parâmetros sem custo, retorno só com ids e preço, erros.
- `tests/trofeus-salvar-migracao.test.ts`: o SQL da migração (fechamento, permissão, recusas, escopo da arte, desfazer).
- `tests/trofeus-conta.test.ts` e `tests/trofeus-cotacao.test.ts`: custo da linha de arte, e que a linha do vendedor não leva custo.

## Desfazer

Só a função some (`DROP FUNCTION`); as linhas que ela gravou ficam, e o roteiro para tirá-las também está no fim da migração.
