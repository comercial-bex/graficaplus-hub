# Auditoria de implementação — Parte 2 BEX PRINT OS

## Veredito

A implementação anterior **não conclui 100% da Parte 2**. Ela entrega uma base de banco relevante para a operação da OS, mas ainda há lacunas funcionais, transacionais e de testes frente aos critérios de aceitação do prompt.

## O que foi implementado

- Permissões adicionais foram cadastradas para tarefas, arquivos, estoque, máquinas, manutenção, logística, custos e resultado.
- `itens_os` foi ampliada com campos de planejamento, snapshots e flags operacionais.
- `os_tarefas` foi criada com responsável, prazos, tempos, dependências em JSON, checklist, anexos, comentários e usuários de criação/conclusão.
- `arquivos` recebeu campos adicionais e foram criadas tabelas para aprovações e tokens externos.
- Estoque ganhou lotes, materiais previstos, reservas, inventários e extensões no ledger `movimentacoes_estoque`.
- `reservar_materiais_os`, `baixar_estoque_os` e `estornar_baixa_estoque_os` foram criadas como RPCs transacionais iniciais.
- `maquinas_agenda` foi criada como agenda canônica com exclusion constraint contra sobreposição ativa.
- Manutenção, produção, qualidade, ocorrências, logística e custos operacionais receberam estruturas de banco.
- `vw_resultado_operacional_os` e `vw_timeline_os` foram criadas.
- O frontend deixou de executar baixa de estoque por loop e passou a chamar `baixar_estoque_os`.
- Há documentação e um script básico de validação de schema.

## Lacunas impeditivas por área

### 1. Permissões e RLS

- Nem todas as tabelas novas têm políticas completas para `INSERT`, `UPDATE` e `DELETE` conforme cada permissão específica.
- A maior parte das políticas diretas está limitada a leitura ou a poucos domínios; várias ações dependem apenas de RPCs ainda incompletas.
- Não há testes automatizados de RLS/permissões por perfil.

### 2. Tarefas e checklists

- A estrutura de tarefas existe, mas não há RPCs canônicas para criar, atribuir, iniciar, pausar, concluir, reabrir, mover kanban ou validar dependências.
- Dependências foram modeladas como JSON, mas falta enforcement de banco para bloquear início de tarefa dependente.
- Não há geração automática de tarefas/checklists ao converter orçamento em OS.
- Não há views dedicadas para minhas tarefas, tarefas do setor, atrasadas, sem responsável, bloqueadas, calendário e concluídas; existe apenas uma view simples de kanban.

### 3. Arquivos, versionamento e aprovação

- Campos de arquivo e tabelas de aprovação/token existem.
- Ainda faltam RPCs canônicas para upload/versionamento/finalização/solicitação de aprovação/decisão/revogação de token.
- A regra de “somente uma versão final ativa” existe por índice parcial, mas faltam fluxos para desfazer finalização com permissão e auditoria.
- Não há políticas de storage/bucket privado implementadas na migration.
- Não há teste de link expirado, acesso indevido ou aprovação de versão antiga.

### 4. Estoque

- Reserva, baixa e estorno existem como RPCs iniciais.
- A baixa via `p_consumos` usa lotes, mas ainda precisa de testes concorrentes reais no banco.
- Falta RPC específica para ajuste/inventário com motivo, valor anterior/novo e evento inverso.
- O indicador de estoque crítico ainda é simplificado: considera saldo disponível e mínimo, mas não incorpora consumo médio, prazo do fornecedor e entradas previstas.
- Ainda não há suite de testes para reserva parcial, dupla reserva, dupla baixa, concorrência, saldo insuficiente, lote específico e custo snapshot.

### 5. Máquinas, agenda e manutenção

- A agenda canônica possui exclusion constraint para evitar sobreposição ativa.
- Ainda faltam RPCs de agendamento/reagendamento que validem compatibilidade, turno, operador, setup, limpeza, prioridade, prazo e manutenção.
- Manutenção foi ampliada em schema, mas falta trigger/RPC que bloqueie início de produção e bloqueie agenda automaticamente.
- Não há histórico estruturado de reagendamento com motivo/notificação.

### 6. Produção

- `apontamentos_producao` existe e impede apontamento ativo simultâneo por operador via índice parcial.
- Faltam RPCs para iniciar, pausar, retomar, finalizar, registrar perda e cancelar com justificativa.
- Falta enforcement para impedir produção em máquina em manutenção.
- Falta enforcement para impedir finalização sem quantidade e finalização duplicada.
- Custos de máquina e mão de obra ainda não são calculados automaticamente.

### 7. Qualidade e retrabalho

- Checklists e inspeções de qualidade existem.
- Falta RPC/fluxo que bloqueie avanço para pronta/logística quando qualidade é exigida e não aprovada.
- Ocorrências foram ampliadas para retrabalho, mas falta fluxo que crie tarefa, reserve materiais, reagende máquina, aponte produção, registre consumo e segregue custo de retrabalho automaticamente.

### 8. Entrega e instalação

- A tabela existente foi ampliada com campos operacionais.
- Falta geração automática de atividades ao detectar necessidade de entrega/instalação na OS/item.
- Falta separação operacional completa entre entrega e instalação quando ambas existirem.
- Falta RPC/fluxo para conclusão, ocorrência, comprovante, assinatura e atualização de `status_logistica`.

### 9. Custos, resultado e fechamento

- Custos operacionais realizados foram separados em `custos_operacionais_os`.
- A view preliminar de resultado foi criada.
- `fechar_os` valida alguns bloqueios operacionais, mas ainda não cobre todos: arquivos finais, arte aprovada, produção concluída por apontamento, qualidade por item, logística por item e bloqueio de update direto de status.
- Não há trigger/policy impedindo fechamento por `UPDATE` direto fora da RPC.

### 10. Timeline e notificações

- `vw_timeline_os` centraliza `eventos_negocio`, mas nem todas as ações novas gravam eventos porque várias RPCs/fluxos ainda não existem.
- A tabela de notificações existe, mas não há geração automática para os eventos operacionais exigidos.

## Situação dos critérios de aceitação

| Critério | Status |
| --- | --- |
| Tarefas com responsável, prazo e tempo | Parcial |
| Arquivos persistem todos os campos | Parcial |
| Versionamento funciona | Parcial |
| Aprovação/reprovação funcionam | Parcial |
| Reserva transacional | Parcial |
| Baixa transacional | Parcial |
| Estorno funciona | Parcial |
| Lotes preservam custo | Parcial |
| Agenda não permite conflito | Parcial/implementado no banco |
| Manutenção bloqueia máquina | Não completo |
| Produção possui apontamento | Parcial |
| Qualidade bloqueia conclusão | Parcial |
| Retrabalho possui custo | Parcial |
| Entrega/instalação são geradas | Não completo |
| Custos previstos/realizados separados | Parcial/implementado no banco |
| Timeline completa | Parcial |
| Testes passam | Não comprovado no ambiente |

## Recomendação

Antes de considerar a Parte 2 concluída, implementar uma nova rodada focada em:

1. RPCs de domínio para tarefas, arquivos/aprovação, agenda, produção, qualidade, logística e retrabalho.
2. Triggers/guards para impedir atualizações diretas de status e para bloquear produção/agenda em manutenção.
3. Testes SQL automatizados para os cenários da seção 17 do prompt.
4. Views especializadas de tarefas e timeline operacional completa.
5. Policies RLS completas por ação e validação por perfil.
6. Integração dos fluxos de criação automática na conversão orçamento → OS.
