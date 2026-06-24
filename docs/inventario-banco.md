# Inventário do Banco

## Migrations auditadas
- `20260531172858_70c34c0f-bf50-43ba-bd7e-94186ba5ee46.sql`: base de usuários, clientes, orçamentos, OS, financeiro e auditoria.
- `20260531190903_6a9f1ec4-2e4f-4fd0-aa8b-fa53345cd971.sql`: documentos/PDF.
- `20260531191901_f968a005-2fa8-4d5d-915d-7ecf093f924e.sql`: logo de cliente.
- `20260531193000_prd_kanban_statuses.sql`: renomeações de status OS e índices de kanban.
- `20260531203000_*`: lote conflitante com permissões, financeiro, mocks, relatórios, arquivos e automações.
- `20260531210000_whatsapp_zapi.sql`: estrutura WhatsApp e leads.
- `20260531214005_centraliza_avanco_status_os.sql`: centralização parcial de avanço de status.
- `20260531214500_expand_prd_schema.sql`: expansão PRD, agenda, manutenção e automações.
- `20260601005753_*` e `20260601010730_*`: produtos e composição de materiais.

## Objetos canônicos por domínio
- CRM: `leads`, `clientes`, `cliente_contatos`.
- WhatsApp: `whatsapp_instancias`, `whatsapp_contatos`, `whatsapp_conversas`, `whatsapp_mensagens`, `whatsapp_anexos`, `whatsapp_participantes`, `whatsapp_fila_envio`, `whatsapp_webhook_eventos`, `whatsapp_logs`, `whatsapp_respostas_rapidas`, `whatsapp_automacoes`.
- Orçamentos: `orcamentos`, `orcamento_itens`, `orcamento_versoes`, `orcamento_versao_itens`.
- OS: `ordens_servico`, `itens_os`, `os_status_transicoes`.
- Financeiro: `contas_receber`, `parcelas_receber`, `pagamentos`.
- Auditoria: `eventos_negocio`, `logs_auditoria`.

## Objetos legados a aposentar após validação de dados
- `conversas_whatsapp`, `mensagens_whatsapp` → `whatsapp_conversas`, `whatsapp_mensagens`.
- Automação genérica duplicada deve ser consolidada com `whatsapp_automacoes` quando o escopo for atendimento.
- Rotas que referenciam `maquinas_agenda` devem apontar para `agenda_maquinas` ou view compatível.
