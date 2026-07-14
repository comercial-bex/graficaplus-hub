
# Ajustes no Novo Orçamento 3D — OCR, tempo unificado e dados do fatiador

Três problemas observados no print que você mandou (fatiador Bambu):

1. Leu **652 g** onde o correto é **6,52 g** — o parser está ignorando a vírgula decimal e concatenando os dígitos.
2. Campos de tempo estão separados em **horas** e **minutos** — você quer um único campo mais natural.
3. O print do fatiador tem mais informações úteis que hoje jogamos fora e que, faltando, geram prejuízo.

## 1. Corrigir o parser de gramas (bug real)

Arquivo: `src/domain/impressao3d/ocr.ts` — função `parseSlicerText`.

Hoje o regex é `/(\d+[.,]?\d*)\s*g\b/gi`. O `?` deixa o separador opcional e captura "652" quando na verdade o texto é "6,52". Ajustes:

- Trocar por dois passes: primeiro **preferir** valores com decimal explícito (`\d+[.,]\d+\s*g`), só cair para inteiro se não achar nenhum.
- Ao converter, tratar tanto vírgula quanto ponto como separador decimal (já faz), mas **rejeitar** matches sem separador quando o valor bruto tem 3+ dígitos e existe outro candidato com decimal na mesma imagem (evita "652" ganhar de "6,52").
- Extra: ler também "**filament used [g]**", "**used filament**", "**material**" como âncoras — pega o número mais próximo dessas labels em vez do maior número solto na tela.

Vou adicionar um teste rápido (bun test) cobrindo os dois casos ("6,52 g" e "652g total, 6,52g modelo") no `tests/`.

## 2. Campo de tempo unificado

Hoje: dois inputs (`Horas` + `Minutos`).
Novo: um único input `Tempo` aceitando formatos naturais e convertendo para minutos internamente:

- `2h 3m`, `2:03`, `2:03:45`, `123min`, `1,5h`, `90m`.
- Placeholder do input: `ex.: 2h 15m ou 2:15`.
- Abaixo em texto pequeno: `≈ 2h 15min · 135 minutos` (feedback ao vivo do que o motor entendeu).
- OCR passa a preencher direto esse campo (`Xh Ym`) em vez dos dois separados.
- Estado interno vira `tempoMinutos: number` (uma variável só); as fórmulas de custo passam a receber isso.

Arquivo: `src/routes/_authenticated/orcamento-3d-novo.tsx` (troca dos dois inputs + helper `parseTempoLivre`).

## 3. Aproveitar mais dados do print do fatiador

Levantamento do que o fatiador mostra e o que hoje **não** capturamos — e o impacto se faltar:

| Info no print | Já capturamos? | Impacto se faltar |
|---|---|---|
| Peso total do modelo (g) | Sim (com bug da vírgula) | Base de custo material |
| Tempo total de impressão | Sim | Base de custo máquina + energia |
| **Peso do suporte (g)** | Não | Subestima gasto de filamento; peça com muito suporte pode dar prejuízo |
| **Peso da purga/torre (g)** | Não | Mesmo problema — em multicolor a purga passa fácil de 20% do total |
| **Consumo estimado (m)** | Não (só grama) | Cross-check contra estoque de bobina |
| **Tipo de filamento** (PLA/PETG/ABS/TPU) | Não | Se diferente do cadastrado, R$/g muda; hoje confia cegamente no select |
| **Temperatura do bocal / mesa** | Não | Não afeta preço, mas útil para reimpressão idêntica |
| **Altura de camada / infill %** | Não | Guarda pra reproduzir a peça; peça re-cotada com infill maior vai gastar mais |
| **Nº de placas / peças** | Não | Se o print é de uma placa com 5 peças e o operador cotar 1, subestima 5× |
| **Custo estimado pelo fatiador** | Não | Sanity check contra nosso motor |

Proposta prática (sem inflar a tela):

- **Capturar 4 campos extras** do OCR e mostrar num bloco enxuto "Detectado no print" (abaixo do dropzone, dobrável):
  - Peso suporte (g) — soma no total antes do custo de material
  - Peso purga/torre (g) — soma no total antes do custo de material
  - Nº de peças na placa — multiplica o motor de custo automaticamente
  - Tipo de filamento detectado (PLA/PETG/…) — se diferente do select, mostra chip amarelo "atenção: fatiador diz PETG, você selecionou PLA"

- **Guardar em campos novos** em `orcamentos_3d` (via migration):
  - `peso_suporte_g numeric`
  - `peso_purga_g numeric`
  - `pecas_por_placa int default 1`
  - `filamento_tipo_detectado text` (só metadado, não altera cálculo)
  - `altura_camada_mm numeric` e `infill_pct numeric` (metadados de reprodutibilidade)

- **Ajuste no cost-engine**: o `pesoGramas` que entra na fórmula passa a ser `modelo + suporte + purga` × `pecas_por_placa`. Fórmula continua a mesma, só muda o input.

- **Regex novos** em `ocr.ts` para essas âncoras (`support`, `prime tower`, `purge`, `plate`, `layer height`, `infill`, `filament type`, `PLA/PETG/ABS/TPU/ASA/PC`).

## 4. Tooltip do filamento em R$/g

Você mencionou "tarifa de energia já tem denominação"; aproveitando o pente-fino, o select de filamento continua mostrando **R$/kg** (correto), mas hoje o breakdown do resumo mostra o cálculo em R$/g. Vou padronizar o resumo para exibir também `X g × R$ Y/kg = R$ Z` — mais legível.

## Arquivos afetados

- `src/domain/impressao3d/ocr.ts` — regex do peso, novos regex para suporte/purga/peças/tipo/camada/infill.
- `src/routes/_authenticated/orcamento-3d-novo.tsx` — campo único de tempo, bloco "Detectado no print", uso dos extras no `useMemo` de custo.
- `src/domain/impressao3d/cost-engine.ts` — só se preciso ajustar assinatura (provavelmente o cálculo agregado fica na tela; motor recebe pesoTotal já somado).
- `tests/impressao3d-ocr.test.ts` **(novo)** — casos: "6,52 g", "6.52g", "Total 12,4 g / suporte 3,1 g", tempo "2h 3m" e "2:03".
- Migration: colunas extras em `orcamentos_3d` conforme acima (nullable, sem quebrar dados existentes).

## Fora do escopo desta rodada

- Reler o print automaticamente ao trocar o arquivo (já funciona), mas sem reprocessamento em background para outras imagens.
- Enviar o texto bruto do OCR ao servidor para telemetria — mantenho só no state para debug local.
- Redesign da listagem `/impressao-3d` — segue como está.

Aprovando, aplico numa passada só (migration + código + teste).
