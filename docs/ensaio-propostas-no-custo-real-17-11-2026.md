# Propostas de preço no custo real (17/11/2026)

Migração: `supabase/migrations/20261117100000_propostas_de_preco_no_custo_real.sql`.

## O defeito

O cartão de "Preços pendentes" mostra o custo, o piso e as margens **gravados na proposta**. Duas funções
gravavam esses números só com o custo do material (`produtos.custo_medio`). Isso valia mesmo depois que a tela
"Preços por produto" e as propostas de 16/11 passaram a usar o custo real, que é:

- o custo de produção com a ocupação alvo;
- o imposto;
- a metade da taxa do cartão.

- **`preco_proposta_criar`**, a do botão "Pedir este preço" em Preços por produto. Veja o Adesivo vinil recortado a
  R$ 99,90:
  - o que o cartão mostraria: piso de R$ 12,07 e margem de 92,75%;
  - o certo: piso igual ao preço mínimo recomendado, R$ 72,84, e margem líquida de 58,71%.
- **`preco_proposta_aprovar`** regravava o registro com o custo do material na hora de aprovar. Em 16/11 isso
  atingiu as duas propostas manuais aprovadas pelo gestor:

| Proposta | O gestor viu ao decidir | O histórico passou a dizer |
| --- | --- | --- |
| Adesivo transparente, 59,90 para 71,90 | custo de produção 34,33, piso 71,73, margem 37,88 para 48,25 | custo 20,80, piso 29,71, margem 65,28 para 71,07 |
| Adesivo vinil recortado, 68,00 para 99,90 | custo de produção 38,06, piso 72,84, margem 39,34 para 58,71 | custo 7,24, piso 12,07, margem 89,35 para 92,75 |

O preço aprovado ficou certo nos dois casos. O erro estava só nos números guardados com a decisão.

## A correção

1. **`_preco_proposta_numeros`**: uma conta só para os números da proposta. É a mesma da migração de 16/11 e da tela
   Preços por produto:
   - custo = custo de produção;
   - piso = preço mínimo recomendado;
   - margem mínima = a do produto, ou 30 quando vazia ou zero;
   - margem = 1 − custo real ÷ preço.

   Produto sem custo real na visão (inativo, sem preço de balcão ou sem custo) cai na conta de antes, só com o
   material. O rastro de "proposta criada" diz qual base foi usada, sem custo em reais.

   É `SECURITY INVOKER`, e ninguém de fora a executa: nem `anon`, nem `authenticated`, nem `service_role`.
2. **`preco_proposta_criar` e `preco_proposta_aprovar`** passam a gravar com essa conta. O resto das duas fica igual,
   inclusive a trava do aprovar: o banco continua recusando preço abaixo do piso **do material**.

   O preço mínimo recomendado é recomendação (decisão do dono em 16/11/2026). Abaixo dele, o cartão fica vermelho e
   diz para não aprovar, mas não bloqueia.
3. **As duas propostas de 16/11 voltam aos números da decisão.** A restauração tem três condições:
   - vale só para esses dois registros;
   - só se ainda estiverem com os números do material;
   - só se a conta de hoje der exatamente o que o gestor viu. É a prova de que o custo não mudou desde então; se der
     outra coisa, a migração para.

   Nenhum preço muda: `produtos`, `produto_precos` e os orçamentos ficam como estão.

## Ensaio no banco vivo (17/11/2026, desfeito por RAISE EXCEPTION)

A migração inteira, sem o `COMMIT`, seguida de um bloco que testa cada caso como o gestor Raymison
(`set_config('request.jwt.claims', …)` + `SET LOCAL ROLE authenticated`) e termina em `RAISE EXCEPTION`.

| Caso | Resultado |
| --- | --- |
| Restauração | `8ad77013` = 38,06 / 72,84 / 40 / 39,34 / 58,71 e `a6821c5e` = 34,33 / 71,73 / 30 / 37,88 / 48,25; um rastro para cada |
| Conta auxiliar chamada por quem está logado | recusada (fechada) |
| Gestor pede 104,90 no recortado, que custa 99,90 | custo 38,06, piso 72,84, margem 58,71 para 60,68, `base=custo_real` |
| Gestor aprova | aprovada com os mesmos números; preço do produto 104,90 |
| Gestor pede 10,00 e tenta aprovar | recusada: "O preço proposto fica abaixo do piso de 12,07" |
| Produto inativo, sem custo real | custo 30,00 = custo do material, piso 46,15 = piso do material, `base=material` |

**Depois do ensaio, conferido no banco:**

- o md5 das duas funções é o de antes:
  - `preco_proposta_criar`: `4db878d2…`
  - `preco_proposta_aprovar`: `462f90af…`
- a conta auxiliar não existe;
- os dois registros continuam com os números do material;
- o preço do recortado continua 99,90;
- nenhuma proposta pendente;
- nenhum rastro de restauração.

## Aplicação

Aplicada pelo Claude Code com a autorização do dono para a Bex Print, depois do ensaio e do CI verde. A conferência
depois da aplicação está no PR.
