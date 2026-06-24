# Schema Canônico Parte 1

O schema canônico desta etapa é materializado pela migration `20260624090000_parte1_fundacao_comercial.sql`.

## Princípios
- Nenhuma tabela legada é removida sem migração validada.
- Campos financeiros permanecem `NUMERIC`.
- IDs entre CRM, WhatsApp, orçamento e OS são preservados por FKs.
- Eventos críticos são gravados em `eventos_negocio`.
