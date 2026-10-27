# Escolha de produto mais enxuta no orçamento

## Problema
Na etapa "Itens", o quadro "1. Que tipo de produto é?" e "2. Qual …?" fica sempre aberto com todos os cartões, mesmo depois de escolhido o produto. Ocupa a tela inteira e empurra a lista de itens para baixo.

## Proposta principal (recomendada): janela "Novo item"
- A tela de itens passa a mostrar só a **lista de itens** e um botão destacado **"+ Novo item"** (mais o "Peça 3D" e "Repetir último pedido" que já existem).
- Ao clicar em "+ Novo item" abre uma **janela (pop-up)** em duas etapas:
  1. Que tipo de produto é? (cartões dos tipos)
  2. Qual produto? (lista do tipo escolhido + "Outro item deste tipo")
- Escolhido o produto, a janela mostra o formulário (medida, quantidade, acabamento, preço, detalhes) e o botão **"Adicionar item"**. Ao adicionar, a janela fecha e o item aparece na lista.
- Opção **"Adicionar e lançar outro"** reabre direto na etapa 1, para lançar vários itens seguidos.
- Editar um item abre a mesma janela já preenchida, com "Trocar produto" para voltar à etapa 1.
- Orçamento sem itens: a janela abre sozinha na primeira vez (mantém o comportamento de "já abrir para lançar produtos").

## Alternativas (se preferir outra)
- **B. Recolher no lugar:** sem pop-up. Depois de escolher, os cartões somem e fica uma linha "Lona 440g · Trocar"; após adicionar o item tudo recolhe e aparece "+ Novo item".
- **C. Painel lateral:** em vez de janela central, um painel desliza da direita com as mesmas etapas, deixando a lista visível ao lado.
- **D. Busca rápida:** um único campo "Buscar produto…" com sugestões (mais vendidos, este cliente), e os cartões de tipo só como atalho dentro da busca.

## Fora do escopo
Preços, cálculo, catálogo e PDF não mudam. Visual segue o tema atual (claro/escuro).

## Detalhes técnicos
- `orcamentos.$id.tsx` (bloco ~1698): mover `EscolhaDeProduto` + campos do formulário para um `Dialog` controlado por estado `novoItemAberto`; abrir em "+ Novo item", em `editarItem` e automaticamente quando `itensDeProduto.length === 0`.
- `limparFormulario`/salvar fecham o diálogo; "Adicionar e lançar outro" limpa e mantém aberto com tipo zerado.
- `EscolhaDeProduto` mantém a lógica; apenas a etapa 2 só aparece com tipo escolhido e o formulário só após produto/item livre.
- Verificação com Playwright em 1109×693: abrir, escolher tipo/produto, adicionar, conferir lista e editar.
