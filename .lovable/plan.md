ns
# Plano — BEX PRINT OS (Fase 1: MVP Operacional)

Escopo: single-tenant, visual conforme PRD (sidebar SaaS, roxo escuro + laranja). WhatsApp, precificação avançada, máquinas/estoque, instalações e IA ficam para fases seguintes — mas o **schema do banco já será criado pensando nelas** para evitar migrações destrutivas depois.

## 1. Fundação (Lovable Cloud)

- Ativar Lovable Cloud (Supabase gerenciado: DB, Auth, Storage, RLS).
- Auth: e-mail/senha. Trigger `handle_new_user` cria registro em `usuarios`.
- Enum `app_role`: `admin`, `gestor`, `financeiro`, `vendedor`, `designer`, `operador`, `estoque`, `instalador`, `cliente`.
- Tabela `user_roles` separada + função `has_role(uuid, app_role)` SECURITY DEFINER (padrão Lovable, evita recursão em RLS).
- Rota `_authenticated` com guard (TanStack) + `/login`, `/signup`, `/reset-password`.
- Listener `onAuthStateChange` no root + invalidação de queries.

## 2. Schema do banco (Fase 1)

Criar tabelas com RLS desde o início. GRANTs explícitos para `authenticated`/`service_role`.

**Núcleo Fase 1:**
- `usuarios`, `user_roles`
- `clientes`, `cliente_contatos`
- `orcamentos`, `orcamento_itens`
- `ordens_servico`, `itens_os`
- `tarefas`, `comentarios_tarefa`
- `arquivos` (com versionamento — nunca deletar, só marcar `substituido`)
- `aprovacoes` (arte / orçamento)
- `pagamentos`, `custos_os` (estrutura completa, mas UI básica)
- `logs_auditoria`

**Stubs vazios** (criadas agora, populadas em fases futuras): `maquinas`, `produtos`, `materiais`, `movimentacoes_estoque`, `entregas_instalacoes`, `ocorrencias`, `whatsapp_*`. Só schema + RLS, sem UI ainda.

**Storage buckets:**
- `arquivos-clientes` (privado, RLS via OS/cliente vinculado)
- `comprovantes` (privado)
- `avatares` (público)

## 3. RLS — matriz de permissão central

Regra de ouro do PRD:
- **Vendedor / Designer / Operador / Instalador NÃO veem** `custo_*`, `lucro_*`, `margem_*`, `preco_minimo`.
- **Admin / Gestor / Financeiro veem tudo financeiro.**

Implementação:
- RLS row-level controla **quais linhas** cada perfil vê.
- Views específicas (`orcamentos_vendedor_view`, `os_operador_view`, etc.) controlam **quais colunas** cada perfil vê — sem expor custo/margem/lucro.
- Componentes React consultam a view correspondente ao perfil ativo.

## 4. Módulos / Telas Fase 1

1. **Login / Signup / Reset password**
2. **Dashboard** — indicadores básicos (OS abertas, atrasadas, faturamento mês, orçamentos em aberto). Cards + 2 gráficos (Recharts).
3. **Clientes & Leads** — lista filtrável, cadastro PF/PJ, perfil do cliente com abas (Dados, Contatos, Orçamentos, OS, Arquivos, Histórico).
4. **Orçamentos** — criar/editar com itens, status, conversão em OS. Vendedor vê preço/desconto autorizado; gestor vê tudo.
5. **Ordens de Serviço** — criar/editar, abas (Resumo, Briefing, Arquivos, Tarefas, Comentários, Histórico, Financeiro condicional).
6. **Kanban de Produção** — colunas conforme PRD (24 status), drag-and-drop (`@dnd-kit`), cards com badges (prazo, prioridade, anexos, atraso).
7. **Arquivos** — upload drag-and-drop, versionamento, preview de imagem/PDF, marcação "final para produção".
8. **Financeiro básico** — lista de pagamentos por OS, registrar entrada/parcela, upload comprovante. Só admin/gestor/financeiro.
9. **Usuários & Permissões** — CRUD de usuários, atribuição de roles (só admin).
10. **Configurações** — perfil do usuário, dados da empresa.

## 5. Regras de negócio implementadas na Fase 1

- OS sem responsável → bloqueio.
- Mudança de status de OS → registro em `logs_auditoria` + entrada no histórico.
- Arquivo nunca deletado, apenas `status = substituido`.
- Aprovação de arte registra: data, usuário/cliente, canal, arquivo.
- Orçamento aprovado → botão "Converter em OS".
- Desconto acima de X% / margem abaixo do mínimo → flag "requer aprovação gestor" (gate por enquanto via UI, regra dura na Fase 2 com precificação).

## 6. Design system

- Tailwind v4 tokens em `src/styles.css` (oklch).
- Paleta: roxo escuro (primary), laranja (accent), cinza claro (background), verde/amarelo/vermelho/azul para status badges.
- Fontes: Inter para UI (limpa, padrão SaaS). Caso queira algo mais distintivo depois, troco.
- shadcn/ui: Sidebar, Table, Dialog, Sheet (drawer da OS), Tabs, Badge, Card, Form (react-hook-form + zod).

## 7. Detalhes técnicos

- TanStack Start + TanStack Query (loaders + `useSuspenseQuery`).
- Server functions (`createServerFn`) para mutações sensíveis (mudança de status, conversão orçamento→OS, registro de custo).
- `requireSupabaseAuth` middleware nas server fns.
- Zod em todas as entradas.
- React Hook Form para formulários.
- `@dnd-kit/core` para Kanban.
- Recharts para gráficos do dashboard.

## 8. Fora da Fase 1 (registrar e seguir)

Não construir agora, mas schema/stubs prontos:
- Precificação completa, custo previsto/real, pós-cálculo, margem/lucro (Fase 2)
- Máquinas, agenda, manutenção, estoque, movimentações (Fase 2)
- Ocorrências e retrabalho (Fase 2)
- Entregas e instalações (Fase 2)
- WhatsApp / Z-API / central de atendimento / bot / automações (Fase 3)
- Área do cliente externa (Fase 4)
- IA (Fase 5)

## 9. Critérios de aceite Fase 1

- Cadastrar cliente ✓
- Criar orçamento ✓
- Converter orçamento em OS ✓
- Mover OS no Kanban ✓
- Anexar e versionar arquivo ✓
- Aprovar arte (registro completo) ✓
- Registrar pagamento ✓
- Vendedor NÃO vê custo/lucro/margem (testado) ✓
- Operador NÃO vê valores (testado) ✓
- Logs de mudança de status ✓

---

Depois da sua aprovação, começo pela ativação do Lovable Cloud + schema + auth + sidebar, e seguimos módulo a módulo. Cada módulo grande (Kanban, OS detalhada) entra como entrega separada para você validar antes do próximo.
