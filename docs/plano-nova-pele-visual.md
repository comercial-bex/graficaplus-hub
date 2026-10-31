# Plano da nova pele visual do Bex Print OS

Data: 31/10/2026. Referência visual: templates da Code and Chill (`demo.codeandchill.store`), usados como
**referência de padrões**, nunca como código: são templates pagos (US$ 78 cada, TypeScript + Vite sem framework) e o
hub é TanStack Start + React com tokens em `src/styles.css`. Protótipo no canvas "Bex Print — proposta visual".

## 1. O que foi medido no código (31/10/2026)

| Medida | Valor |
| --- | --- |
| Rotas | 94 (`src/routes`) |
| Componentes | 259 (46 em `ui/`, 13 em `bex/`) |
| Arquivos que usam `ui/button` | 203 |
| Arquivos que usam `ui/input` | 127 |
| Arquivos que usam `ui/card` | 121 |
| Arquivos que usam `ui/badge` | 72 |
| Telas com `StatusChip` | 56 |
| Telas com `SectionHeader` | 55 |
| Telas com `KpiCard` | 33 |
| Listas com `DataPanel` | 9 |
| Classes de paleta Tailwind fora dos tokens (`text-amber-600`, `bg-emerald-500`…) | 403 ocorrências |
| Cores hex cruas em `.tsx` | 43 |
| `@keyframes` próprios | 0 (há View Transitions de 160 ms e `prefers-reduced-motion` tratado) |

Leitura: a pele mora em ~12 arquivos. Trocar tokens + peças compartilhadas muda a percepção de 90% das telas.
As 403 classes de paleta e os 43 hex são a parte que **não** acompanha a troca e precisam de migração.

## 2. Padrões que os templates usam (e que cabem num sistema de trabalho)

- Fundo de página quente ("papel"), cartão branco, raio 16–24 px, anel de 1 px bem leve + sombra longa e suave.
- Tipografia humanista (Urbanist, Geist, Plus Jakarta Sans), números grandes com algarismos tabulares e um chip de
  variação ao lado, rótulos em caixa baixa de 13 px.
- Ícone em quadrado tingido (34 px) antes do título de cada cartão.
- **Um** cartão herói escuro por tela; o resto neutro. Hierarquia por contraste, não por quatro cores de acento.
- Botões pílula de 44 px, controle segmentado em pílula, busca em pílula.
- Status por ponto colorido + texto em caixa baixa, não por selo em caixa alta.
- Barra lateral flutuante (margem de 12 px, raio 20 px).
- Movimento curto: número conta ao entrar, cartão sobe 2 px no hover, gráfico desenha em ~600 ms.

O que **não** cabe: vidro fosco (Kerfa, Pane), fundos com imagem, animação de página inteira. Celular barato ao sol
na oficina é o piso de contraste (comentários no código: StatusChip 11 px no celular em 21/10/2026, "contraste em
tela barata ao sol" no shell).

## 3. Tokens propostos (`src/styles.css`)

| Token | Claro (hoje → proposta) | Escuro (hoje → proposta) |
| --- | --- | --- |
| `--background` | `#f7f9fc` → `#f4f3ef` | `#0a0b10` → `#0b0c10` |
| `--card` | `#ffffff` (igual) | `#171925` → `#15171f` |
| `--foreground` | `#20242d` → `#15171c` | `#e2e8f0` → `#e6e8ee` |
| `--muted-foreground` | `#5d6779` → `#5d6472` | `#8b94a7` → `#9aa2b1` |
| `--radius` | `0.5rem` → `0.75rem` (controles) | idem |
| `--radius-card` (novo) | `1.25rem` | idem |
| `--shadow-card` (novo) | `0 0 0 1px rgb(21 23 28 / .06), 0 1px 2px rgb(21 23 28 / .04), 0 14px 34px -22px rgb(21 23 28 / .22)` | `0 0 0 1px rgb(255 255 255 / .07), 0 14px 34px -22px rgb(0 0 0 / .7)` |
| `--surface-hero` / `--surface-hero-foreground` (novos) | `#15171c` / `#f4f3ef` | `#f4f3ef` / `#15171c` (inverte) |
| `--chip-cyan-bg` / `-fg` (novos) | `#e6f7fa` / `#096b7d` | `rgb(0 211 242 / .14)` / `#4fd9ef` |
| `--chip-positive-bg` / `-fg` | `#e4f3ec` / `#116b4d` | `rgb(69 212 160 / .14)` / `#5fe0b0` |
| `--chip-warning-bg` / `-fg` | `#fbf0d9` / `#805600` | `rgb(245 200 74 / .14)` / `#f5c84a` |
| `--chip-magenta-bg` / `-fg` | `#fbe4ee` / `#b91e68` | `rgb(255 90 174 / .14)` / `#ff7cc0` |
| `--font-sans` | Montserrat → "Plus Jakarta Sans" (Montserrat fica só na marca; PDFs já usam Helvetica) | idem |
| `--duracao-curta` / `--curva` (novos) | `180ms` / `cubic-bezier(.2,.8,.2,1)` | idem |

Mantidos por decisão anterior do dono: sidebar escura nos dois temas (AGENTS.md), trilho dos módulos em ciano
(06/10/2026), item ativo em ciano com texto escuro, logo `LOGO_FUNDO_ESCURO` no painel, gradiente CMYK como
assinatura (passa a ser a linha de 3 px no topo do cartão herói, e sai do botão).

## 4. Fases

### Fase 0 — decidir (sem código)
Olhar o canvas e bater o martelo em três coisas: fonte (Plus Jakarta Sans), fundo papel (`#f4f3ef`) e a regra
"um herói por tela". Sem isso decidido, a fase 1 vira retrabalho.

### Fase 1 — tokens (1 PR, só `src/styles.css`)
Novos tokens da tabela acima + pares escuros + `@theme inline` para `--color-chip-*`, `--radius-card`,
`--shadow-card`. Risco: `--radius` é global; inputs, diálogos e selects mudam juntos. Rodar `bun run test`.

### Fase 2 — peças compartilhadas (2 PRs)
1. `src/components/bex/`: `KpiCard` (ícone em quadrado tingido, rótulo 13 px, valor 34 px tabular, chip, prop
   `destaque` para a variante herói; some a borda esquerda e o brilho), `StatusChip` (ponto + caixa baixa 12 px,
   13 px no celular), `SectionHeader` (título 32 px, sem régua), `DataPanel` (raio de cartão, busca em pílula,
   rodapé com paginação em pílulas), `NeonButton` (vira o `Button` primário; a borda CMYK sai).
2. `src/components/ui/`: `card` (raio e sombra novos), `button` (pílula, 44 px, variantes `tinta` e `suave`),
   `badge`, `tabs` (segmentado em pílula), `input` (44 px, anel em vez de borda), `table` (cabeçalho 12 px em
   caixa baixa, linha com hover), `dialog`/`sheet` (raio 20 px). Shell: `src/routes/_authenticated/route.tsx`
   (cabeçalho fixo some; saudação + data + busca + ações entram na própria tela) e
   `src/components/menu/menu-lateral.tsx` (flutuante com margem 12 px e raio 20 px; trilho e cores mantidos).

### Fase 3 — migração das cores fora dos tokens (1 PR grande ou 4 pequenos por família)
403 classes de paleta → semânticas: `amber-*` → `warning`/`chip-warning`, `emerald-*` → `success`/`positive`,
`sky-*` → `info`, `red-*` → `destructive`. 43 hex → tokens. Sem esta fase o tema escuro e os chips novos ficam
com manchas da pele antiga.

### Fase 4 — movimento (1 PR)
Contagem do número no `KpiCard` (`requestAnimationFrame`, 600 ms, desligada em `prefers-reduced-motion`),
entrada escalonada dos cartões do Início (40 ms entre cartões, `tw-animate-css` já está instalado), hover de
2 px no `Card`, animação padrão do Recharts em 600 ms.

### Fase 5 — passada tela a tela (1 PR por tela)
As dez mais usadas, aplicando "um herói por tela": `dashboard`, `os.index`, `os.$id`, `orcamentos.index`,
`kanban`, `whatsapp`, `clientes.index`, `financeiro`, `producao-3d`, `maquinas-agenda`. As outras 84 herdam das
peças.

## 5. Fora do escopo desta pele

- TV da oficina (`src/components/tv/tv-oficina.css`): palco fixo 1920×1080, piso de 24 px testado em
  `tests/tv-tela-fonte.test.ts`. É outro produto, lido a 4 m.
- PDFs (`src/lib/pdf/DocumentoPDF.tsx`, Helvetica) e a regra das logos (AGENTS.md).
- Portal do parceiro (`/parceiro`): carrega a marca do parceiro, não a do Bex Print.
- Login: já está na linguagem certa (painel escuro, CMYK, botão neon); só herda fonte e raio.

## 6. Riscos

- Contraste na oficina: anel de cartão nunca abaixo de 6% do primeiro plano; chip 13 px no celular; alvos 44 px.
- Tema escuro: todo token novo precisa do par escuro no mesmo PR.
- Testes que leem classes (267 arquivos em `tests/`): rodar a suíte a cada fase, não no fim.
- Licença: nenhuma linha dos templates entra no repositório; só padrões.
