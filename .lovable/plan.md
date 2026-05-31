
## Status atual do BEX PRINT OS

Análise comparada ao PRD completo (5 fases, ~30 módulos).

### Resumo executivo
- **Implementado: ~25%** (Fase 1 quase pronta, base de Fase 2 no banco)
- **Falta implementar: ~75%** (UI de Fases 2-5, WhatsApp/Z-API, IA, área do cliente)

### Status por Fase

| Fase | Escopo | % feito |
|---|---|---|
| **Fase 1 — MVP Operacional** | Auth, perfis, clientes, orçamentos, OS, Kanban, arquivos, financeiro básico, dashboard | **~75%** |
| **Fase 2 — Produção + Financeiro avançado** | Máquinas, agenda, estoque, precificação, custo real, pós-cálculo, ocorrências, manutenção | **~15%** (tabelas no banco, sem UI) |
| **Fase 3 — WhatsApp Z-API** | Central de atendimento, webhooks, automações, respostas rápidas | **0%** |
| **Fase 4 — Autoatendimento + Área do cliente** | Bot, aprovação externa de arte/orçamento, pós-venda | **0%** |
| **Fase 5 — IA** | Briefing, estimativa, risco de prejuízo, gargalos | **0%** |

### Detalhado por módulo (PRD seção 5)

| Módulo | Banco | UI | Status |
|---|---|---|---|
| Dashboard | — | básico | 40% |
| Clientes e Leads | ✅ | ✅ lista + 360º | 80% |
| WhatsApp Integrado | ❌ | ❌ | 0% |
| Orçamentos | ✅ | ✅ lista + detalhe + conversão OS | 85% |
| Ordens de Serviço | ✅ | ✅ lista + detalhe c/ abas + upload | 80% |
| Kanban Produção | ✅ | ✅ drag-and-drop | 80% |
| Design / aprovação arte | ✅ (tabela aprovacoes) | ❌ fluxo dedicado | 20% |
| Máquinas | ❌ | ❌ | 0% |
| Produtos / Precificação | ❌ | ❌ | 0% |
| Materiais / Estoque | ✅ tabelas | ❌ UI | 15% |
| Financeiro | ✅ | ✅ pagamentos + dialog | 60% |
| Entregas / Instalações | ✅ | ❌ UI | 15% |
| Arquivos / Histórico | ✅ + bucket | parcial (dentro da OS) | 40% |
| Ocorrências / Retrabalho | ✅ | ❌ | 15% |
| Relatórios | — | ❌ | 0% |
| Usuários e permissões | ✅ | ✅ básico | 70% |
| Configurações | — | ✅ placeholder | 20% |
| Logs / Auditoria | ✅ | ❌ | 30% |

---

## Plano desta entrega

Foco: **completar a malha visual de menus + dashboard rico com mock**, para você navegar a estrutura inteira e a gente refinar tela por tela.

### 1. Sidebar reorganizada (todos os menus do PRD)

Agrupar em: **Operação**, **Comercial**, **Produção**, **Estoque**, **Financeiro**, **Atendimento**, **Relatórios**, **Administração**. Cada item linkando para uma rota nova (mesmo que placeholder rico).

### 2. Novas rotas (placeholders com mock visual, não “em construção”)

Criar em `src/routes/_authenticated/`:
- `leads.tsx` — tabela mock de leads + funil
- `whatsapp.tsx` — layout 3 colunas (inbox / chat / contexto) com conversas mock
- `design.tsx` — fila de artes para aprovação (cards com versões mock)
- `maquinas.tsx` — grid das 5 máquinas do PRD (CNC, i1600, Bambu Lab, recorte, UV) com status, custo/h, ocupação
- `maquinas.agenda.tsx` — timeline semanal mock
- `manutencao.tsx` — lista de manutenções mock
- `produtos.tsx` — catálogo mock com margem
- `precificacao.tsx` — calculadora viva (custo → preço → margem → markup)
- `materiais.tsx` — estoque mock com alerta de mínimo
- `estoque.movimentacoes.tsx` — entradas/saídas mock
- `entregas.tsx` — agenda de entregas/instalações mock
- `ocorrencias.tsx` — lista de ocorrências/retrabalho mock
- `relatorios.tsx` — hub com cards para cada relatório
- `logs.tsx` — auditoria mock
- `respostas-rapidas.tsx` e `automacoes.tsx` — WhatsApp config mock

Cada placeholder usa shadcn (Card, Table, Badge, Tabs) + dados mockados realistas, não texto “em construção”.

### 3. Dashboard reformulado (dados mockados + gráficos)

Instalar **recharts** e construir:
- **KPIs reais (do banco)**: clientes, orçamentos abertos, OS abertas, OS atrasadas, faturamento/mês, a receber, ticket médio
- **KPIs mock (até ter dados)**: lucro previsto vs real, margem média, máquinas em uso, estoque crítico, conversas WhatsApp abertas
- **Gráficos** (recharts, dados mock):
  - AreaChart: Faturamento últimos 12 meses
  - BarChart: Lucro por mês (previsto vs real)
  - PieChart: OS por status
  - BarChart horizontal: Produtos mais vendidos
  - BarChart: Produção por máquina (horas)
  - LineChart: Tempo médio por etapa
  - Donut: Custo por categoria
  - BarChart: Retrabalho por setor
- **Listas**: OS atrasadas, próximos vencimentos, últimas conversas WhatsApp, estoque crítico
- Fallback gracioso quando o banco está vazio (usa mock para visualização)

### 4. Detalhes técnicos
- `bun add recharts` (componente de gráficos)
- Reorganizar `app-sidebar.tsx` em grupos com `hasRole`/`canSeeFinancials` corretos por perfil
- Criar `src/lib/mock-data.ts` central para dados de exemplo (faturamento, máquinas, conversas, etc.)
- Cada nova rota: `createFileRoute("/_authenticated/<rota>")` + `head()` com título próprio
- Manter código existente intacto (sem mexer em OS, Kanban, Orçamentos, Financeiro que já funcionam)

### 5. O que NÃO entra agora (próximos blocos)
- Integração real Z-API + webhooks (Fase 3)
- CRUDs completos de máquinas/produtos/materiais com validação e regras de bloqueio
- Pós-cálculo automático e regras de bloqueio de produção
- Área externa do cliente e bot de autoatendimento
- IA da Fase 5

Esses voltam em entregas seguintes, uma por vez, com lógica real.

---

**Posso seguir?** Após aprovação, eu implemento tudo isso de uma vez para você navegar a estrutura completa do ERP, e depois a gente refina cada página com lógica real.
