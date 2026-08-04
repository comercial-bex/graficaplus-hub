# Comparativo com o concorrente (Calcme) e plano de fechamento das lacunas

## O que as imagens mostram que o concorrente tem

1. **PCP visual em duas camadas** — colunas comerciais (Novo Pedido, Tirar Medida, Criação de Arte, Produção) e, dentro de Produção, sub-colunas de chão de fábrica (Preparação, Impressão, Acabamento), com cronômetro por card (8h10m, 2h08m) e avatar do responsável.
2. **Tarefas tipadas** ligadas ao card: Tarefa, Checklist, Comentário, Visita, Reunião, WhatsApp, Ligação — com agenda semanal, filtro "em aberto / atrasadas / concluídas" e detalhe da tarefa com endereço, veículo e descrição.
3. **Funil de orçamentos com status comercial** (Apresentação, Em Negociação, Dar Retorno, Aprovado, Perdido) + KPIs no topo (Em orçamento / Perdidos / Vendidos) e ações rápidas por linha (PDF, WhatsApp, e-mail, detalhamento de cálculo).
4. **Detalhamento de cálculo aberto**: Materiais (unidades + lucro %), Processos (horas + markup %), Mão de obra (horas + markup %) e o fechamento "Custo + Lucro = R$".
5. **Contrato / assinatura digital** ligado ao pedido, enviado por WhatsApp.
6. **Catálogo amplo de produtos** de gráfica rápida e brindes (crachás, canecas, chaveiros, adesivos, encadernação, etc.).

## Como estamos hoje (verificado no código e no banco)

| Recurso do concorrente | Nosso estado | Situação |
| --- | --- | --- |
| Kanban comercial | `/kanban` sobre `ordens_servico` | Existe |
| Sub-colunas de produção (Preparação/Impressão/Acabamento) | só `setor_atual` em texto; sem visão em duas camadas | Falta |
| Cronômetro por card / hora-máquina | `apontamentos_producao` grava início/fim, mas `maquinas` só tem `id, nome, tipo, ativa` — **sem custo/hora e sem capacidade** | Parcial |
| Tarefas tipadas + agenda | `os_tarefas` existe (prazos, checklist, minutos previstos/realizados) mas **sem tipo** e sem tela de agenda | Parcial |
| Funil comercial de orçamento com estágios | `orcamentos` com status, sem estágios de negociação nem KPIs de perdidos/vendidos | Parcial |
| Detalhamento de cálculo (material/processo/mão de obra) | existe completo só no 3D; no 2D há `custo_previsto`/`margem_prevista` sem quebra por processo e mão de obra | Falta (2D) |
| Contrato/assinatura | não existe | Falta |
| Fluxo de caixa | só entradas (`contas_receber`, `parcelas_receber`, `pagamentos`) — **não existe contas a pagar nem saldo de caixa** | Falta |
| Controle de estoque | `materiais`, `material_lotes`, `movimentacoes_estoque`, receitas por produto, baixa validada | Completo |
| Desperdício / perda | nenhuma tabela ou campo registra perda, sobra ou refile | Falta |
| Catálogo de produtos | `produtos` com SKU, categoria, custo médio, margem | Existe |

Também há uma pendência estrutural: as tabelas `maquinas_agenda` e `agenda_maquinas` **coexistem** no banco, o que gera risco de leitura divergente.

## Percentual estimado

| Bloco | Implementado |
| --- | --- |
| Comercial (lead → orçamento → OS) | 70% |
| Produção / PCP | 45% |
| Estoque | 85% |
| Financeiro | 40% (só recebimentos) |
| Custos e resultado | 55% (3D forte, 2D fraco) |
| Pós-venda / portal | 60% |
| **Média ponderada** | **~58%** |

## O que proponho construir (nesta ordem)

### Bloco 1 — Motor de custo unificado 2D (a base de tudo)
Replicar no orçamento 2D o que já existe no 3D: quebra em **Materiais** (consumo × custo, com sobra/refile), **Processos** (hora-máquina × custo/hora da máquina) e **Mão de obra** (horas × custo/hora do perfil), fechando em Custo + Markup = Preço. Isso exige adicionar em `maquinas` os campos de custo/hora, potência, setup e velocidade, e uma tabela de custo de mão de obra por função. Sem isso, nenhum resultado de OS é confiável.

### Bloco 2 — Desperdício e rendimento
Registrar perda por item de OS: área/quantidade planejada × produzida × perdida, com motivo (refile, erro de arte, falha de impressão, teste de cor). Alimenta o custo real da OS e um indicador de % de desperdício por máquina, operador e produto.

### Bloco 3 — Fluxo de caixa completo
Criar contas a pagar (fornecedor, categoria, vencimento, recorrência) e uma visão de caixa com saldo inicial, entradas previstas/realizadas, saídas previstas/realizadas e projeção por período. Hoje só enxergamos a metade que entra.

### Bloco 4 — Hora-máquina e ocupação
Consolidar a agenda em uma única tabela, remover a duplicada, e exibir ocupação por máquina (horas previstas vs. realizadas, ociosidade, custo de hora parada). Fecha o ciclo apontamento → custo real.

### Bloco 5 — PCP em duas camadas + tarefas tipadas
Kanban com sub-colunas de produção, cronômetro no card e tarefas com tipo (tarefa, checklist, visita, reunião, WhatsApp, ligação), mais uma agenda semanal com filtros de em aberto / atrasadas / concluídas.

### Bloco 6 — Funil comercial e ações rápidas
Estágios de negociação no orçamento, KPIs de Em orçamento / Perdidos / Vendidos, motivo de perda e ações por linha (PDF, WhatsApp, e-mail, ver detalhamento de cálculo).

### Bloco 7 — Contrato e aceite
Documento de acordo de serviço gerado a partir da OS, envio por link público e registro de aceite com data, IP e nome — aproveitando o token público que já existe.

## Detalhes técnicos

- Novas colunas em `maquinas`: `custo_hora`, `potencia_kw`, `setup_min`, `velocidade_m2_h`, `disponibilidade_pct`.
- Nova tabela `custos_mao_de_obra` (função, custo/hora, encargos %).
- Nova tabela `os_perdas` (os_id, item_id, quantidade, unidade, motivo, custo, operador, máquina).
- Novas tabelas `contas_pagar` e `caixa_movimentos`, mais uma view `vw_fluxo_caixa` por período.
- `os_tarefas` ganha `tipo` (enum) e vínculo opcional com cliente/lead, para tarefas sem OS.
- Remoção de `agenda_maquinas` após conferir que nenhum código a lê.
- Motor de cálculo 2D em `src/domain/orcamentos/cost-engine.ts`, espelhando o padrão de `src/domain/impressao3d/cost-engine.ts`, com testes unitários.
- Todas as tabelas novas com GRANT + RLS por perfil, seguindo o padrão atual.

## Sugestão de sequência

Blocos 1 e 2 primeiro (custo e desperdício), depois 3 e 4 (caixa e hora-máquina) — esses quatro são os que "fazem a conta fechar". Os blocos 5 a 7 são ganho de experiência e velocidade comercial e podem vir na sequência.
