# Diagnóstico Parte 1 — BEX PRINT OS

Auditoria inicial executada em 2026-06-24 sobre o repositório `graficaplus-hub`.

## Conflitos confirmados
- Migrations com mesmo timestamp `20260531203000`, o que reduz previsibilidade operacional quando ferramentas ordenam apenas por versão.
- Estruturas duplicadas/incompatíveis para WhatsApp: `whatsapp_conversas`/`whatsapp_mensagens` e `conversas_whatsapp`/`mensagens_whatsapp`.
- Automação duplicada: `automacoes`/`automacao_execucoes` e `whatsapp_automacoes`.
- Agenda de máquinas divergente entre `maquinas_agenda` em rotas e `agenda_maquinas` no banco.
- Permissões hardcoded em TypeScript não cobrem o catálogo comercial solicitado.
- Operações críticas ainda aparecem em frontend como inserts/updates sequenciais, especialmente status de OS e conversões.
- Uso de `as any` em módulos operacionais, incluindo Supabase e rotas autenticadas.

## Decisão arquitetural desta etapa
- Tabelas canônicas mantêm os nomes já mais integrados ao schema: `leads`, `clientes`, `whatsapp_*`, `orcamentos`, `orcamento_itens`, `ordens_servico`, `itens_os`, `pagamentos`, `eventos_negocio`.
- Tabelas legadas não são excluídas nesta etapa; são inventariadas e recebem caminho de migração/aposentadoria documentado.
- Operações críticas novas são centralizadas em RPCs transacionais SECURITY DEFINER com `SET search_path = public`.

## Limitações desta execução
- Tipos Supabase não foram regenerados via CLI remoto por ausência de credenciais Supabase vinculadas neste ambiente.
- Testes de RLS com usuários reais exigem ambiente Supabase local/remoto com auth configurado.
