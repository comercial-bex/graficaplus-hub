# Redesign completo — Bex Print OS · Industrial Grid

Direção escolhida: **v3 — Industrial Grid / telemetria print shop**. Base preta absoluta com pontos de tinta CMYK (ciano, magenta, verde-lime) aparecendo só nos pontos de decisão. Tipografia: **Montserrat** (display + corpo) + **JetBrains Mono** (rótulos técnicos/telemetria). Layout: dashboard clássico (sidebar fixa + header slim + conteúdo).

## Sistema de design (fundação)

Antes de tocar qualquer tela, redefino os tokens em `src/styles.css` para que TODO o app herde a paleta Bex — nenhuma tela precisa reescrever cores.

**Tokens novos (@theme + :root)**
- `--background: #050507`, `--foreground: #e8e8ea`, `--card: #0d0d10`, `--muted: #1a1a1f`, `--border: #232329`
- Acentos CMYK: `--cyan: #00d4ff`, `--magenta: #e91e63`, `--lime: #a8ff2e` (também mapeados para `--primary` = ciano, `--accent` = lime, `--destructive` = magenta)
- `--gradient-cmyk: linear-gradient(135deg, #00d4ff, #e91e63, #a8ff2e)` como assinatura
- Sombra neon: `--shadow-neon-lime`, `--shadow-neon-magenta`
- Sidebar: preto mais profundo `#030304` com borda ciano de 1px
- Fonts: `--font-sans: "Montserrat"`, `--font-mono: "JetBrains Mono"` (carregadas via `<link>` no `__root.tsx`)
- Background dot-grid: utility `.bex-grid` (radial-gradient de pontos #222 a cada 24px)
- Ring focus: ciano com 30% opacidade

Todos os componentes shadcn passam a herdar automaticamente. Não vou tocar nas cores hardcoded que sobraram — vou substituí-las por tokens semânticos.

## Componentes/primitivas novas

Ficam em `src/components/bex/`:
1. `BexLogo.tsx` — SVG oficial com BEX branco + X gradiente CMYK, prop `size` (sm/md/lg)
2. `BexBackground.tsx` — dot-grid + dois blurs radiais (ciano top-right, magenta bottom-left) usado no login, empty states e onboarding
3. `KpiCard.tsx` — card KPI com label mono, número Montserrat black, delta com cor semântica e sparkline opcional
4. `StatusChip.tsx` — chip com barra colorida por status/prioridade CMYK (aberto=ciano, em produção=magenta, concluído=lime)
5. `SectionHeader.tsx` — cabeçalho de página com breadcrumb mono + título display + ações à direita
6. `NeonButton.tsx` — variant do Button: hover troca fundo branco → gradiente CMYK

## Aplicação por área

### 1. Autenticação (login + signup)
- Fundo preto com `BexBackground` (dot-grid + blurs)
- Header `BEX` + `X` gradiente CMYK + tagline mono
- Card semi-transparente `bg-zinc-900/40 backdrop-blur-xl border border-zinc-800`
- Botão com borda gradiente CMYK (padding 1px + fill preto que vira transparente no hover)
- Rodapé com "telemetria": SERVER_ON • V 4.2.0 • SECURE_AUTH

Aplico em: `src/routes/login.tsx`, `src/routes/signup.tsx`.

### 2. Shell autenticado (sidebar + header)
`src/routes/_authenticated/route.tsx` + `src/components/app-sidebar.tsx`:
- Sidebar preto profundo, largura 240px, com `BexLogo` no topo e borda direita ciano 1px
- Grupos rotulados em Mono uppercase 10px, `text-zinc-500`
- Item ativo: fundo `#111` + barra vertical esquerda de 2px em gradiente CMYK + ícone ciano
- Item hover: `bg-zinc-900` + ícone magenta
- Header slim (h-14) com breadcrumb mono, busca global (cmd+k), badge de OS abertas, avatar
- Ícone de sino com dot magenta quando há alerta

### 3. Dashboard
`src/routes/_authenticated/dashboard.tsx`:
- Row de 4 `KpiCard` (Faturamento, Ticket médio, OS ativas, Margem) — label Mono, número 40px black, delta colorido
- Gráficos Recharts re-tematizados: linhas ciano/magenta/lime, grid `#232329`, tooltip preto com borda gradiente
- Card "Top produtos" com barra horizontal segmentada CMYK
- Card "Kanban resumo" com contadores por status

### 4. Listas densas (Clientes, Orçamentos, OS, Leads, Materiais, Produtos)
Todas seguem o mesmo shell:
- `SectionHeader` com título display + ação primária (Neon Button)
- Toolbar sticky: busca à esquerda, chips de filtro no meio, view toggle à direita
- Tabela: header Mono uppercase 11px, zebra sutil (`even:bg-zinc-950/30`), hover revela ações na última coluna, linha selecionada com borda esquerda ciano
- `StatusChip` para status/prioridade
- Empty state usa `BexBackground` reduzido + CTA

### 5. Kanban de produção
`src/routes/_authenticated/kanban.tsx`:
- Colunas com header colorido por status (ciano/magenta/lime/zinc), contador mono
- Card OS: barra vertical de prioridade CMYK (4px), título Montserrat, cliente, chip prazo, avatares responsáveis
- Drag hover: card ganha shadow neon-lime + escala 1.02
- Filtros no topo: cliente, responsável, prioridade, atrasadas

### 6. Detalhes (OS $id, Orçamento $id, Cliente $id)
- Header com breadcrumb mono, status chip, ações à direita (PDF, Baixar estoque, Converter, etc.)
- Tabs com underline gradiente CMYK no ativo
- Cards de resumo à esquerda, área principal à direita
- Histórico/log: linha do tempo com dots CMYK por tipo de evento

### 7. WhatsApp (3 colunas)
`src/routes/_authenticated/whatsapp.tsx`:
- Coluna 1 (conversas): busca + lista com avatar, última msg, dot magenta se não lido
- Coluna 2 (chat): bolhas do cliente `bg-zinc-900`, minhas em `bg-cyan-500/10 border-cyan-500/30`
- Coluna 3 (contexto do contato): cards de cliente, OS abertas, ações rápidas

### 8. Módulos operacionais menores
Design, Máquinas, Manutenção, Entregas, Ocorrências, Precificação, Movimentações, Logs, Relatórios, Automações, Respostas Rápidas: aplicam o mesmo shell (SectionHeader + toolbar + tabela/grade). Sem UI custom, herdam tokens.

### 9. PDF (Orçamento e OS)
`src/lib/pdf/DocumentoPDF.tsx`: troca cabeçalho roxo por barra preta com logo Bex + linha gradiente CMYK de 4px abaixo. Corpo continua legível para impressão (fundo branco, tinta preta). Cor de acento nos totais = magenta.

## Fluxo de implementação (ordem)

1. **Fundação** — tokens em `src/styles.css`, carregar Montserrat + JetBrains Mono em `__root.tsx`, meta title já OK
2. **Primitivas** — criar `BexLogo`, `BexBackground`, `KpiCard`, `StatusChip`, `SectionHeader`, `NeonButton`
3. **Auth** — aplicar direção v3 em `login.tsx` e `signup.tsx`
4. **Shell** — atualizar `_authenticated/route.tsx` (header slim) + `app-sidebar.tsx` (grupos, item ativo, logo)
5. **Dashboard** — refatorar `dashboard.tsx` com KpiCard + Recharts tematizados
6. **Listas** — passar `orcamentos.tsx`, `os.tsx`, `clientes.tsx`, `leads.tsx`, `produtos.tsx`, `materiais.tsx` para o padrão SectionHeader + toolbar
7. **Kanban** — retematizar `kanban.tsx` com barras CMYK e shadows neon
8. **WhatsApp** — 3 colunas com tratamento de bolhas
9. **Detalhes** — `orcamentos.$id.tsx`, `os.$id.tsx`, `clientes.$id.tsx` com tabs sublinhadas
10. **Rotas operacionais restantes** — aplicar SectionHeader (mudança leve, sem tocar lógica)
11. **PDF** — retematizar header do `DocumentoPDF.tsx`
12. **Cleanup** — buscar `text-white`, `bg-white`, `#..purple..` residuais em componentes e substituir por tokens

## Detalhes técnicos

- Fontes carregadas via `<link>` no head do root (não `@import` em CSS, para não quebrar Lightning CSS)
- Todos os `@theme` novos vão em `src/styles.css` na seção existente
- Componentes shadcn continuam sendo usados — apenas tokens mudam
- Nenhuma mudança em lógica, RPC, Supabase, ou permissões — puro UI/UX
- Progresso preservado: features de estoque, PDF, produtos, kanban continuam funcionando; só mudam de roupa
- Responsividade: aplicar padrão `grid-cols-[minmax(0,1fr)_auto]` nos headers de página que hoje usam `flex flex-wrap`
- Modo claro: **não** vou manter. Sistema fica dark-only (a marca é preto + CMYK)

## Fora do escopo

- Alteração de esquema do banco, RPCs, políticas RLS
- Novas features (mantemos as existentes)
- Modo claro / theming alternativo
- Refatoração de código não visual
- Animações complexas (Framer Motion) além das micro-transições já suportadas

Estimativa de arquivos tocados: ~35 (30 rotas + 5-6 componentes novos + tokens + PDF).
