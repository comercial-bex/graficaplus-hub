# Janela "Novo item" em passos

## Como fica
No topo da janela, uma linha de passos clicáveis:

```text
 (1) Tipo  ──  (2) Produto  ──  (3) Medida e quantidade  ──  (4) Preço e revisão
```

1. **Tipo** — só os cartões de tipo (Lona e banner, Adesivo e recorte…), a busca e os "Mais vendidos". Clicou num tipo → vai sozinho para o passo 2.
2. **Produto** — só os produtos daquele tipo + "Outro item deste tipo" (item livre). Clicou → vai para o passo 3. Botão "Voltar" e o passo 1 mostra o tipo escolhido ("Lona e banner · trocar").
3. **Medida e quantidade** — descrição (já preenchida pelo produto), tamanhos prontos, largura × altura, quantidade, acabamento. Aviso de estoque e área mínima aparecem aqui.
4. **Preço e revisão** — preço/m², valor un., custo (se puder ver), margem, detalhes opcionais (especificação, artes) e o resumo em uma frase. Botões "Adicionar item" e "Adicionar e lançar outro".

- Cada passo já concluído vira um resumo curto clicável para voltar e trocar.
- Busca pelo nome no passo 1 pula direto para o passo 3.
- Impressão 3D no passo 1 continua abrindo a calculadora 3D.
- Editar um item abre direto no passo 3, com os passos 1 e 2 resumidos.
- Enter avança; não deixa avançar do passo 3 sem quantidade (e medida, se vendido por m²).

## Comparação com o mercado (Zênite, Calcgraf, Mubisys, Printi)
Esses sistemas usam o mesmo funil "categoria → produto → variáveis → preço", com o preço sempre visível no rodapé. Por isso, o **total do item fica fixo no rodapé da janela** em todos os passos.

## Fora do escopo
Cálculo, catálogo, estoque, PDF e a tabela de itens não mudam.

## Detalhes técnicos
- Estado `etapaItem: 1|2|3|4` em `orcamentos.$id.tsx`; `EscolhaDeProduto` recebe `etapa` para mostrar só tipos (1) ou só produtos (2), e chama avanço em `onEscolherProduto`/`onItemLivre`.
- Campos do formulário existentes divididos em dois blocos (3 e 4), sem mudar a lógica; rodapé fixo com total e botões.
- Novo componente pequeno `PassosDoItem` para a linha de passos.
- `limparFormulario` volta a etapa para 1; `editarItem` define 3.
- Verificar com Playwright: tipo → produto → medida → adicionar, e "lançar outro" voltando ao passo 1.
