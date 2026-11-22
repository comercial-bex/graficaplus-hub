# Orçamento de troféu de acrílico: catálogo, regras e a conta (22/11/2026)

Migração: `supabase/migrations/20261122200000_trofeu_catalogo_e_regras.sql`.
Conta: `src/domain/trofeus/conta.ts` (função pura). Fixture dos testes: `tests/apoio/trofeus.ts`.

## O pedido do dono

Precificar troféu de acrílico como o orçamento de 3D: o vendedor escolhe um modelo pronto, a altura, a quantidade e a
arte, e o sistema calcula. Referências: as imagens do JariCross (econômico e em duas camadas) e do KR Combat (premium,
11 peças). Regra de preço, decidida em 22/11: **custo cheio × 3**, com desconto por quantidade, ×3,5 no premium
exclusivo e ×4 só na urgência.

## O que esta etapa entrega (e o que ainda não)

Entrega: as três tabelas com os dados do dono plantados, a conta como função pura e testada, e a regra de acesso.
**Não entrega:** o servidor que calcula o preço para o vendedor nem a página do orçamento. Isso é o próximo PR. Tabela
com dado e conta testada ainda não é troféu orçado: pronto é quando o KR Combat do orçamento #255 sai com preço.

### Tabelas

| Tabela | O que guarda | Quem lê | Quem escreve |
| --- | --- | --- | --- |
| `trofeu_regras` | uma linha: escada de quantidade, piso, urgência, limites de altura, tinta, cola, gravação, preparo do laser, velocidade de corte, regras da arte, lista de provisórios | quem vê financeiro | admin e gestor |
| `trofeu_modelos` | nome, linha, altura de referência, minutos de mão de obra, ×3 da linha, `provisorio` | qualquer funcionário | admin e gestor |
| `trofeu_pecas` | peças de cada modelo: material, espessura, medida, quantidade, fator de forma, decoração | qualquer funcionário | admin e gestor |

`anon` não tem nenhum acesso. As três passam pela auditoria (`tg_auditar`), e as regras têm `id` uuid porque o gatilho de
auditoria converte o `id` em uuid (um `id` booleano quebraria a primeira alteração de preço).

### A conta

```
custo cheio       = material (área útil) + decoração + cola + máquina + mão de obra + rateio
custo de produção = material com sobra e falha + máquina + mão de obra + rateio + ocupação
multiplicador     = máximo entre (base da linha × fator da faixa) e o piso 2,2
preço             = custo cheio × multiplicador, fechado em ,90
margem líquida    = (preço sem imposto e sem metade do cartão − custo de produção) ÷ preço
```

Escolher outra altura escala a área ao quadrado, o corte e o tempo de mão de obra na proporção. A escada de quantidade
(1, 5, 20, 50) dá ×3, ×2,7, ×2,4 e ×2,2. O preparo do laser (5 min) se divide pelos troféus do pedido.

### Resultado com as taxas do banco de 22/11/2026 (peças e tempos provisórios)

| Modelo | Custo cheio | 1 troféu (×3) | 5 (×2,7) | 20 (×2,4) | 50 (×2,2) | Margem líquida em 1 |
| --- | --- | --- | --- | --- | --- | --- |
| Econômico 18 cm | R$ 17,74 | **R$ 53,90** | R$ 45,90 | R$ 40,90 | R$ 36,90 | 42,4% |
| Padrão 18 cm | R$ 28,45 | **R$ 85,90** | R$ 74,90 | R$ 65,90 | R$ 60,90 | 42,4% |
| Premium 28 cm | R$ 63,70 | **R$ 191,90** | R$ 169,90 | R$ 150,90 | R$ 137,90 | 41,8% |

Estes números são as peças das imagens com medida estimada. Mudam quando a primeira produção medir.

A arte: criação exclusiva = 3 h de designer a ×3, fechada na dezena = **R$ 220,00** (R$ 110,00 a partir de 20 troféus);
alteração extra R$ 30,00; nome individual R$ 4,00 por troféu. Adaptar o modelo ou o cliente mandar pronta: R$ 0.

## Provisório (a tela precisa avisar)

`trofeu_regras.provisorios` e `trofeu_modelos.provisorio` marcam: tinta (12 ml/m², o `custos_tabela` do banco está
vazio), cola (1 ml por junção), gravação (60 min/m²), preparo do laser (5 min), velocidade de corte (2 mm: 1,5 m/min;
3 mm: 1,0; 6 mm: 0,4), horas da arte (3 h), desconto da arte a partir de 20 troféus (50%), medidas das peças e o custo
do espelhado dourado (sem nota de compra; custo médio R$ 87,09 contra unitário R$ 174,18).

Depende do dono: a nota do espelhado dourado, a velocidade real de corte e gravação do laser e a impressora DTF UV
(cadastrada como inativa e sem custo).

## Ensaio no banco vivo (22/11/2026, desfeito por RAISE EXCEPTION)

A migração inteira, sem o COMMIT, mais a simulação de acesso por papel (`SET LOCAL ROLE authenticated` com o usuário
de cada papel):

| Quem | Modelos | Peças | Regras | Atualizar as regras |
| --- | --- | --- | --- | --- |
| Vendedor | 3 | 15 | 0 | a política barrou |
| Designer | 3 | 15 | 0 | a política barrou |
| Gestor | 3 | 15 | 1 | gravou |
| Admin | 3 | 15 | 1 | gravou |
| `anon` | permission denied | | | |

Auditoria: 19 linhas (1 de regras, 3 de modelos, 15 de peças). O seed produz 3 modelos, 15 peças (2 + 4 + 9) e 4 faixas;
a conferência final da migração confere isso, RLS ligado, nada para `anon` e duas políticas por tabela.

## Próximos passos

1. **PR seguinte:** funções de servidor `cotarTrofeu` e `salvarTrofeuNoOrcamento` (o vendedor recebe só o preço), lendo as
   taxas de `custos_tabela`, `maquinas` e `materiais`, como o 3D faz. Uma decisão para ele: o custo do material sai do
   custo unitário (última compra) ou do médio; o espelhado dourado tem os dois diferentes.
2. **Página "Orçamento de troféu"** em passos, com o simulador de multiplicador para o financeiro e o aval do gestor
   abaixo de ×2,2.
3. **Ficha de produção do troféu na OS.**
