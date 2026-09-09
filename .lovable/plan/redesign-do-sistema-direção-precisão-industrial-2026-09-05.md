# Redesign do sistema — direção "Precisão industrial"

Aplicar a direção escolhida em todo o sistema: fundo preto profundo, cartões grafite, acentos ciano/magenta/amarelo, fonte Montserrat e telas em painel denso (indicadores no topo, tabela compacta logo abaixo).

## O que muda nas telas

1. **Base visual do sistema**
   - Montserrat em todo lugar (títulos e texto), carregada no topo do site.
   - Cores oficiais: fundo #050506, cartões #12131A, ciano #00D3F2, magenta #FF2D9B, amarelo #F5D90A.
   - Cartões com cantos arredondados, borda esquerda colorida e um brilho circular discreto no canto.
   - Botão principal em ciano sólido com texto escuro; sem brilho pulsante.

2. **Menu lateral**
   - Grupos com título pequeno em maiúsculas e espaçamento maior entre eles, para a lista longa deixar de parecer um bloco só.
   - Item ativo com faixa ciano à esquerda e fundo levemente ciano.
   - Rodapé com o cartão do usuário (inicial, nome e perfil) e o botão de sair.

3. **Cabeçalho de cada tela**
   - Faixa fixa no topo com o nome da tela, o caminho ("Painel · Comercial") em cinza pequeno e os botões de ação à direita.

4. **Faixa de indicadores (novidade nas listas)**
   - Quatro cartões no topo de Orçamentos, Ordens de Serviço, Clientes, Financeiro, Materiais, Produtos, Perdas e Impressão 3D.
   - Em Orçamentos: em aberto, aguardando aprovação, convertidos e valor do mês — todos calculados dos dados reais já existentes.

5. **Tabelas**
   - Cabeçalho escuro em maiúsculas pequenas, linhas compactas, separadores finos, realce suave ao passar o mouse, linha inteira clicável.
   - Barra acima da tabela com busca e filtros; rodapé com contagem de registros.
   - Selo de status padronizado: fundo translúcido + borda da mesma cor, tamanho e peso iguais em todo o sistema.

6. **Telas de detalhe (orçamento, OS, cliente)**
   - Mesmo cabeçalho, indicadores do documento no topo e blocos de conteúdo com a mesma moldura das listas.

## Ordem de execução

1. Tokens e fonte em `src/styles.css` + `__root.tsx`.
2. Componentes compartilhados: `SectionHeader`, `KpiCard`, `StatusChip`, `NeonButton`, `app-sidebar`.
3. Listas principais: orçamentos, OS, clientes, produtos, materiais, financeiro, fluxo de caixa.
4. Detalhes: orçamento, OS, cliente, impressão 3D.
5. Kanban, dashboard e telas administrativas.
6. Login, cadastro e portal público com a mesma base.

## Detalhes técnicos

- `src/styles.css`: reescrever os tokens `--background`, `--card`, `--primary`, `--accent`, `--border`, `--ring` em oklch equivalentes aos hex travados; criar `--font-display`/`--font-sans` apontando para Montserrat em `@theme`; manter `@theme inline` do shadcn intacto.
- `src/routes/__root.tsx`: `<link>` do Google Fonts para Montserrat 400/500/600/700 (nada de `@import` no CSS).
- `src/components/bex/KpiCard.tsx`: variantes de acento (ciano/magenta/amarelo/neutro), borda esquerda 4px, glow circular `absolute`, número em 3xl bold.
- `src/components/bex/StatusChip.tsx`: mapa único status → acento, `bg-<cor>/20 text-<cor> border-<cor>/30`, uppercase 9–10px.
- `src/components/bex/SectionHeader.tsx`: virar barra de 64px com breadcrumb acima do título e slot de ações.
- `src/components/app-sidebar.tsx`: manter todos os itens/grupos e as dicas (`Dica`), só ajustar espaçamento, tipografia dos rótulos de grupo e estado ativo; adicionar bloco de usuário no rodapé.
- Novo `src/components/bex/DataTable`-like wrapper (cabeçalho + busca + rodapé de contagem) reutilizado nas listas, sem mudar as queries.
- KPIs derivados dos dados já carregados por rota (`useMemo`), sem novas consultas ao banco.
- Sem alterações de banco, de regras de negócio ou de rotas.
