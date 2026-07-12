-- Aposentadoria das tabelas WhatsApp duplicadas (não usadas).
-- Contexto: docs/achados-inconsistencia-frontend-backend.md (Achado 3).
--
-- O frontend usa `respostas_rapidas` e `automacoes` (nomes curtos); a edge
-- function `process-automations` também usa `automacoes`/`automacao_execucoes`.
-- As versões prefixadas `whatsapp_*` eram duplicatas sem uso, verificadas VAZIAS
-- (0 linhas), sem FK/função/view dependente. O bloco de setup em
-- 20260531210000_whatsapp_zapi.sql que as citava é DDL de migração (já executado),
-- não uma rotina viva — CASCADE remove policies/grants/triggers dessas tabelas.
--
-- Observação: `os_tarefa_comentarios` NÃO é legada (FK -> os_tarefas, faz parte do
-- schema operacional canônico) e foi mantida deliberadamente.

BEGIN;

DROP TABLE IF EXISTS public.whatsapp_automacoes CASCADE;
DROP TABLE IF EXISTS public.whatsapp_respostas_rapidas CASCADE;

COMMIT;
