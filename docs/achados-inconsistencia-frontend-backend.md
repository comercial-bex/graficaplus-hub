# Achados — Split-brain entre Frontend e Backend (tabelas divergentes)

> Diagnóstico gerado em 2026-07-12. Contagem de linhas verificada no banco real
> (Supabase `xzllbjbcdhkjrsiiytvn`): **todas as tabelas envolvidas estavam com 0 linhas**
> — não houve migração de dados necessária.
>
> **STATUS: CORRIGIDO em 2026-07-12** (Achados 1, 2 e 3). Alinhamento do frontend em
> `os.$id.tsx`, `dashboard.tsx`, `relatorios.tsx`; `typecheck` e `build` passam.
> Views/FK repontadas e 7 tabelas legadas dropadas (migrações `20260712140000` e
> `20260712150000`), aplicadas no banco. `types.ts` limpo das tabelas removidas.
>
> Nota: `os_tarefa_comentarios` **não** é legada (FK -> os_tarefas, schema canônico) — mantida.
> A legada de comentários era `comentarios_tarefa` (dropada).

## Resumo executivo

O frontend grava/consulta **tabelas diferentes** das que o backend (RPCs, views de
dashboard, guardas de fechamento de OS) usa para o **mesmo conceito**. O resultado é
que dados inseridos pela interface ficam **invisíveis** para a lógica que fecha OS e
calcula resultado financeiro. Isso afeta diretamente **fluxos que movem dinheiro**.

Severidade: **ALTA** — impacto em faturamento/lucro/margem e no bloqueio de fechamento de OS.

---

## Achado 1 — Custos da OS (impacto financeiro direto)

| Camada | Tabela usada | Onde |
|---|---|---|
| Frontend (grava) | `custos_os` | `os.$id.tsx:835` (insert), `os.$id.tsx:803` (leitura), `dashboard.tsx:132` |
| Backend (lê/valida) | `custos_operacionais_os` | `fechar_os` RPC + **todas** as views `vw_dashboard_*` (21 refs) |

**Consequência:**
- O custo lançado pelo operador na tela da OS vai para `custos_os`.
- A RPC `fechar_os` **bloqueia** o fechamento se não houver linha em `custos_operacionais_os`
  (`..._d474f123...sql:191`) → OS pode ficar **impossível de fechar**, ou
- Os dashboards financeiros (`lucro_realizado`, `margem_realizada`, `divergencia_custo`,
  `custo_realizado`, `retrabalho`) somam `custos_operacionais_os` → como está vazia,
  **o resultado financeiro é calculado sobre custo zero** (lucro/margem inflados).

**Complicador:** os schemas são **diferentes**, não é um rename:
- `custos_os` (frontend): `{ os_id, descricao, valor, categoria }`
- `custos_operacionais_os` (canônica): `{ os_id, categoria*, origem*, quantidade, valor_unitario, total, data, os_item_id, tarefa_id, usuario_id }`

A tela de custo não captura `origem/quantidade/valor_unitario`, exigidos pela canônica.

## Achado 2 — Tarefas da OS

| Camada | Tabela usada | Onde |
|---|---|---|
| Frontend (grava) | `tarefas` | `os.$id.tsx:477,697,706,712` |
| Backend (valida) | `os_tarefas` | `fechar_os` (guarda de tarefa obrigatória), view `vw_tarefas_kanban` |

**Consequência:** tarefas marcadas como **obrigatórias** pela interface vão para `tarefas`,
mas a guarda de fechamento lê `os_tarefas`. A trava de "tarefa obrigatória pendente"
fica **cega** às tarefas reais criadas na tela.

## Achado 3 — WhatsApp (legado vs canônico) — menor risco

- Legado: `conversas_whatsapp`, `mensagens_whatsapp` (têm RLS/trigger, **0 uso no frontend**).
- Canônico/usado: `whatsapp_conversas`, `whatsapp_mensagens`.
- `whatsapp_respostas_rapidas` e `whatsapp_automacoes` existem mas o frontend usa
  `respostas_rapidas` e `automacoes`. Aqui a canônica é a de nome **curto** (inverso do WhatsApp).
- Ação: candidatas a aposentadoria após confirmar contagem de linhas (0 = drop seguro).

---

## Direção de correção recomendada (a decidir + homologar)

O backend que move dinheiro (`fechar_os`, views de dashboard, RLS, `vw_tarefas_kanban`)
já está construído em torno de `custos_operacionais_os` e `os_tarefas`. Portanto a
**correção de menor risco é alinhar o frontend às tabelas canônicas**, não o contrário.

Passos propostos (todos em banco de homologação primeiro):
1. Confirmar contagem de linhas em cada par de tabelas (quem tem dado real?).
2. Migrar dados de `custos_os` → `custos_operacionais_os` e `tarefas` → `os_tarefas`
   (mapeando `valor` → `valor_unitario`/`total`, definindo `origem` default).
3. Ajustar a UI (`os.$id.tsx`, `dashboard.tsx`) para ler/gravar nas canônicas,
   incluindo os campos exigidos (`origem`, `quantidade`, `valor_unitario`).
4. Regenerar `types.ts` a partir do banco.
5. Aposentar as tabelas legadas (renomear para `zz_legacy_*`, depois drop após validação).
6. E2E do fluxo: lançar custo → fechar OS → conferir dashboard financeiro.

## Riscos de NÃO corrigir
- Resultado financeiro (lucro/margem) exibido **incorreto**.
- OS travando no fechamento por custo "ausente".
- Trava de tarefa obrigatória ineficaz.
