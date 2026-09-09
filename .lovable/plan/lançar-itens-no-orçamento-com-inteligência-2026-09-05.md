# Lançar itens no orçamento com inteligência

Hoje o campo de produto é um botão discreto "Catálogo" no canto, e o resto é digitação livre. A ideia é inverter: o caminho principal passa a ser escolher um produto pronto do cadastro, já com medida, preço e material certos — e continuar podendo digitar tudo à mão quando o serviço for fora do padrão.

## O que muda na tela de itens

1. **Busca de produto em primeiro lugar**
   Um campo largo de busca no topo do bloco ("Buscar produto do catálogo…"), no lugar do botão pequeno. Mostra nome, código, categoria, preço e unidade. Digitar direto na descrição continua funcionando para itens avulsos.

2. **Sugestões antes mesmo de buscar**
   Com o campo aberto e vazio, aparecem: os produtos mais usados nos últimos orçamentos, os itens que este mesmo cliente já comprou e os já lançados neste orçamento (para repetir com outra medida). Assim o vendedor resolve o caso comum com um clique.

3. **Medidas pré-definidas**
   Ao escolher o produto, os tamanhos cadastrados dele viram botões (já existe) e o tamanho marcado como padrão é aplicado sozinho. Para produto vendido por m², preço por m² e custo já vêm preenchidos do cadastro. Se o produto tiver área mínima cobrada, a tela avisa quando a peça é menor e mostra a área que será faturada.

4. **Preço por faixa de quantidade**
   Quando o produto tem tabela de preço por quantidade, mudar a quantidade ajusta o preço unitário automaticamente e a tela mostra a faixa aplicada ("acima de 50 un: R$ 12,00") e o próximo degrau ("a partir de 100 un cai para R$ 10,50") — argumento de venda na hora.

5. **Conferência de material e estoque**
   Com o produto escolhido, um painel discreto mostra os materiais que ele consome, quanto o item pedido vai consumir e quanto existe em estoque, com marcação clara: suficiente, apertado ou insuficiente. Serve para o vendedor não prometer prazo que a produção não cumpre. É só aviso, não bloqueia o lançamento.

6. **Sinal de margem por item**
   Ao lado do valor, a margem do item comparada à margem mínima do produto, em verde/âmbar/vermelho, com aviso quando o desconto joga abaixo do mínimo.

7. **Repetir e duplicar**
   Cada linha da lista ganha "duplicar" (copia o item para ajustar medida ou quantidade) e a lista mostra o total de metragem e o total de itens no rodapé.

## Sugestões extras (dizer se entram)

- **Kits/combos**: salvar um conjunto de itens recorrente (ex.: "Kit fachada") e lançar de uma vez.
- **Prazo estimado automático**: somar o tempo de produção dos produtos escolhidos e sugerir a data de entrega do orçamento.
- **Alerta de item sem arte**: marcar na lista os itens ainda sem layout anexado antes de enviar ao cliente.

## Detalhes técnicos

- Arquivo principal: `src/routes/_authenticated/orcamentos.$id.tsx`; o seletor sai de `src/components/produto-autocomplete.tsx` para um novo `src/components/orcamento-produto-picker.tsx` (busca larga + grupos de sugestão), mantendo `fromFinancialView` para respeitar quem pode ver custo.
- Consultas novas (somente leitura): `produto_tamanhos` (já usada), `produto_faixas_preco`, `produto_materiais` + `materiais.estoque`, e `orcamento_itens` recentes agregados por `produto_id` para o ranking de mais usados.
- Cálculo de área e mínimo reaproveita `src/domain/orcamentos/area.ts` (`areaCobrada`, `valorUnitarioComMinimo`); a escolha de faixa vira função pura nova em `src/domain/orcamentos/faixas.ts` com teste em `tests/`.
- A precificação gravada continua vindo do trigger `tg_orcamento_itens_precificar`; a tela só sugere valores.
- Sem mudança de banco e sem mudança de rotas.
