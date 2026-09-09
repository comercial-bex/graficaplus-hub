# Orçamento em uma etapa só

Hoje criar um orçamento tem duas etapas: preencher a janelinha "Novo orçamento" (com um valor total digitado à mão) e, só depois, abrir o orçamento na lista para lançar os produtos e anexar as artes. A ideia é cortar essa parada no meio.

## O que muda

1. **Ao clicar em "Criar", o sistema já abre o orçamento pronto para lançar produtos.**
   Nada de voltar para a lista: você cai direto na tela do orçamento, com o campo de produto já em foco, pronto para digitar o primeiro item e anexar a arte.

2. **Some o campo "Valor total (R$)" da janelinha de criação.**
   O valor passa a ser sempre a soma dos produtos lançados, como já acontece na tela do orçamento. Assim não existe mais um valor digitado que briga com o valor real dos itens.

3. **Clicar em qualquer orçamento da lista abre a tela completa.**
   A linha inteira vira clicável (hoje só o número e o título são links), e a tela abre já com a área de lançamento de produtos visível no topo do bloco de itens.

4. **A janelinha de criação fica enxuta**: cliente (ou contato avulso) e título. Só isso.

## Detalhes técnicos

- `src/routes/_authenticated/orcamentos.index.tsx`: `handleCreate` passa a usar `.select("id").single()` no insert e chamar `navigate({ to: "/orcamentos/$id", params: { id } })`; remoção do campo `valor_total` do formulário (insert com `valor_total: 0`, `valor_subtotal: 0`); linha da tabela com `onClick` navegando para o detalhe (mantendo os botões de ação com `stopPropagation`).
- `src/routes/_authenticated/orcamentos.$id.tsx`: `autoFocus`/`ref` no campo de descrição do item (ou no `ProdutoAutocomplete`) quando o orçamento não tem itens, para o cursor já estar no lugar certo ao chegar da criação.
- Nenhuma mudança de banco: o total já é recalculado a partir dos itens.
