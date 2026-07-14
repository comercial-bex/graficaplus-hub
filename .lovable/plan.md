
# Redesign — Novo Orçamento 3D (`/orcamento-3d-novo`)

Mantendo a identidade **Bex Print** (fundo dark, acentos CMYK, `KpiCard`/`SectionHeader`/`NeonButton`) já travada no projeto. O redesenho foca em **cognição**: cada campo se explica, o resultado é o herói da tela, e o upload deixa de "sumir".

## 1. Nova arquitetura da tela

Layout em **3 zonas verticais claras** (mobile stack + desktop 2/3 + 1/3):

```text
┌──────────────────────────────────────────────────────────┐
│  Cabeçalho: título + breadcrumb + botão "Salvar" fixo    │
├──────────────────────────────┬───────────────────────────┤
│  1. IDENTIFICAÇÃO            │                           │
│     Título · Cliente · Qtd   │                           │
│     [Foto do modelo]         │                           │
├──────────────────────────────┤   RESULTADO (sticky)      │
│  2. FATIADOR (o herói)       │   ┌──────────────┐        │
│     Dropzone grande do print │   │  R$ 18,49    │        │
│     Impressora · Filamento   │   │  Margem 50%  │        │
│     Peso (g) · Tempo (h m)   │   └──────────────┘        │
│                              │   Breakdown por linha     │
├──────────────────────────────┤   Unitário · Atacado      │
│  3. PARÂMETROS DE CUSTO      │                           │
│     Sliders/inputs +         │                           │
│     tooltips com médias      │                           │
└──────────────────────────────┴───────────────────────────┘
```

Cada bloco usa `SectionHeader` com número + ícone + subtítulo curto (ex.: "1 · Identificação — quem, o quê, quantos"). O botão **Salvar** vira `NeonButton` sticky no topo do resumo.

## 2. Upload proeminente (dois uploads, propósitos distintos)

Hoje o `<input type="file">` fica escondido embaixo dos campos. Vira **dropzone dedicada**, com dois cards lado a lado:

- **Foto do modelo** (novo) — imagem final da peça, usada como thumbnail do orçamento, do PDF e da listagem `/impressao-3d`. Salva em `arquivos-clientes/orcamentos-3d/{id}/modelo.jpg` e referenciada em `orcamentos_3d.foto_modelo_path`.
- **Print do fatiador** (existente) — screenshot do Bambu/Cura/Orca, usado para OCR de gramas + tempo. Fica com badge "Lendo…", "OK — 42g · 3h10m" ou "Não consegui ler — preencha manualmente".

Ambos aceitam drag-and-drop, colar do clipboard (`onPaste`), preview 200×200 com botão remover, e mostram o nome + tamanho do arquivo. O dropzone é `border-dashed border-primary/40 bg-primary/5 hover:bg-primary/10`.

## 3. OCR mais robusto (corrige o "não consegui ler")

O print anexado hoje falha porque o Tesseract com `por+eng` tem dificuldade com números pequenos em tema escuro do fatiador. Melhorias:

- Pré-processamento no cliente: **converter para grayscale + aumentar contraste + inverter se fundo escuro** via `<canvas>` antes de enviar ao Tesseract (ganho grande em prints do Bambu Studio).
- Ampliar regex: aceitar `1,234 h`, `1h 23min`, `1:23:45`, `42,09 g` e `42.09g`; ler também linhas em inglês (`filament used`, `estimated time`).
- Fallback: se OCR falhar, sugerir **"colar dados manualmente"** com dois campos grandes (peso g, tempo hh:mm) já em foco.
- Debug oculto: guardar o texto bruto lido em estado para diagnóstico se o usuário reclamar de novo.

## 4. Filamento em R$/kg (não em R$/g)

Hoje o `Select` mostra `R$ 0.150/g`. Muda para **`R$ 150,00 / kg`** — que é como o usuário compra e cadastra. Internamente a fórmula continua usando `custo_por_grama_calculado` (dividindo por 1000 apenas na exibição). Também mostra tipo (PLA, PETG…) e cor quando houver, ex.:

```text
PLA 3DX Natural · PLA · R$ 150,00/kg · aprov. 95%
```

Impressora ganha ícone e mostra `R$/h` + `W médio`, ex.:

```text
Bambu Lab A1 · R$ 1,38/h · 120 W
```

## 5. Tooltips em todo campo importante

Usar o `Tooltip` do shadcn (já disponível) com ícone `Info` do lucide ao lado de cada label. Conteúdos objetivos com **valor médio de mercado** quando faz sentido:

| Campo | Tooltip |
|---|---|
| Título | "Nome curto que aparece no PDF e na listagem — ex.: 'Porta-joias verde matcha'." |
| Cliente | "Opcional. Vincula o orçamento ao 360º do cliente e habilita conversão em OS." |
| Quantidade | "Nº de peças idênticas. O motor recalcula tempo/material proporcionalmente." |
| Impressora | "Custo/hora vem de `maquinas_3d_config` (depreciação + manutenção + rateio)." |
| Filamento | "Preço/kg vem de `materiais_3d_filamento`. Aproveitamento típico 90–97%." |
| Peso do modelo | "Total gasto no print (modelo + suportes + purga). Média peças pequenas 20–80 g." |
| Tempo | "Tempo total do print. Cada hora custa a linha 'Máquina' do resumo." |
| Tarifa energia | "R$/kWh da conta de luz. Média BR residencial 0,85–1,10; comercial 0,60–0,90." |
| Mão de obra R$/h | "Custo do operador incl. encargos. Sugerido 25–60 R$/h para operação 3D." |
| Mão de obra horas | "Só pós-processamento manual (remoção de suporte, lixa, montagem)." |
| % Acabamento | "Reserva para tinta, cola, verniz. Peça crua 0–3%, pintada 8–15%." |
| % Falha | "Provisão para reimpressão. FDM confiável 3–7%, resina/peça complexa 10–15%." |
| Adm./embalagem | "Rateio fixo por peça: caixa, plástico, etiqueta. Média 1,50–5,00 R$." |
| Markup | "Multiplica o custo operacional. Varejo 2,0–2,5×; atacado 1,3–1,5×." |

Tooltips abrem em hover no desktop e no toque do ícone no mobile.

## 6. Presets rápidos (aceleram e ensinam)

Chip row acima dos parâmetros de custo com **presets** que preenchem os 7 campos de uma vez, e podem ser ajustados depois:

- `Varejo padrão` (markup 2,0 · falha 5% · acabamento 5% · MO 40 R$/h)
- `Atacado` (markup 1,4 · falha 3% · acabamento 2% · MO 30 R$/h)
- `Peça pintada` (markup 2,3 · acabamento 12% · MO 50 R$/h)
- `Protótipo rápido` (markup 1,8 · falha 10% · acabamento 0%)

Também aplica o último preset usado pelo usuário como default (via `localStorage`).

## 7. Resumo (o herói) mais informativo

Card sticky é reorganizado em três "andares":

1. **Preço final gigante** (`text-4xl font-mono`) + margem % em `StatusChip` (verde/amarelo/vermelho conforme faixa).
2. **Breakdown** com barra de proporção ao lado de cada linha (mostra visualmente quanto cada custo pesa no total).
3. **Comparativos**: unitário (se qtd > 1), atacado 1,5× e ponto de equilíbrio (preço mínimo para margem 10%).

Botão **Salvar orçamento** vira `NeonButton` full-width, com estado de loading e checagem visual do que ainda falta (ex.: "Faltando: impressora, peso").

## 8. Acessibilidade & responsividade

- Todos os inputs numéricos com `inputMode="decimal"` (teclado numérico no mobile).
- Ordem de tab lógica: identificação → fatiador → parâmetros → salvar.
- Labels sempre visíveis (não usa `placeholder-as-label`).
- Contraste AA em cima do dark; ícones de estado (OCR ok/erro) com cor + ícone (não só cor).
- Empty states em cada select ("Nenhuma impressora ativa — cadastrar em /impressoras-3d").

## Detalhes técnicos

Arquivos afetados:

- `src/routes/_authenticated/orcamento-3d-novo.tsx` — refatorar o layout, adicionar tooltips, dropzones, presets, breakdown com barras.
- `src/components/bex/Dropzone.tsx` **(novo)** — componente drag/drop/paste com preview, usado nos dois uploads.
- `src/components/bex/FieldTooltip.tsx` **(novo)** — wrapper `Label + Info` com `Tooltip` do shadcn (uso repetido).
- `src/domain/impressao3d/ocr.ts` **(novo)** — extrai regex + pré-processamento de imagem (canvas) do arquivo atual, para caber teste unitário.
- `src/routes/_authenticated/orcamento-3d.$id.tsx` — passa a exibir `foto_modelo_path` como capa.
- `src/lib/pdf/DocumentoPDF.tsx` — se houver foto do modelo, inclui como thumbnail no cabeçalho do item.

Banco:

- Migration para adicionar `orcamentos_3d.foto_modelo_path text` (nullable). Sem alterar RLS.

Sem novas dependências (usa Tooltip do shadcn já instalado, Tesseract.js já no projeto, canvas nativo).

## Fora do escopo desta rodada

- Redesign da listagem `/impressao-3d` e da tela de detalhe `/orcamento-3d/$id` (só recebem o `foto_modelo_path` como capa).
- Cadastro de impressoras/filamentos (`/impressoras-3d`, `/filamentos-3d`) — a exibição em R$/kg é só no select desta tela.
- Portal do cliente e PDF do cliente (herdam a foto automaticamente sem mais mudanças).

Pronto para implementar quando você aprovar.
