# Status real da implementação — Parte 1

Esta revisão confirma que a Parte 1 **não está 100% concluída**. A base foi iniciada, mas ainda há lacunas para atingir todos os critérios de aceitação do prompt original.

## Implementado nesta branch
- Documentação inicial de diagnóstico, inventário, schema canônico, migração, rollback, permissões, máquina de estados, fluxo e plano de testes.
- Migration aditiva para permissões, normalização, timeline, complementos WhatsApp, versionamento de orçamento, financeiro previsto e RPCs críticas.
- Proteção de rotas autenticadas por permissão declarada, com negação por padrão.
- Conversão de orçamento e avanço de status em telas principais via RPC.
- Confirmação de pagamentos registrados via RPC `confirmar_pagamento_registrado` para evitar update direto de status no navegador.

## Parcialmente implementado
- Consolidação de tabelas duplicadas: tabelas legadas foram preservadas; migração completa de dados e aposentadoria formal ainda não foi executada.
- Tipos Supabase: foram atualizadas assinaturas usadas no frontend, mas não houve regeneração via Supabase CLI.
- RLS: há policies iniciais para novos objetos, mas falta bateria de testes por perfil.
- WhatsApp: há estrutura canônica complementar, mas entrada/saída real de webhook e ações completas da interface ainda exigem integração de provedor.
- Cliente 360º: relações foram preparadas, mas a UI unificada ainda não foi concluída.
- Financeiro: previsão e confirmação/estorno foram adicionados; regras configuráveis de status financeiro ainda são limitadas.

## Não implementado ou pendente
- Teste real de migrations em banco vazio e banco legado.
- Teste de determinismo de schema entre duas instalações novas.
- Testes de concorrência para lead, orçamento, OS e pagamento.
- Remoção completa de `as any` em todo o projeto.
- Conversão de todos os fluxos comerciais do frontend para RPCs.
- Migração validada de `conversas_whatsapp`/`mensagens_whatsapp` para `whatsapp_conversas`/`whatsapp_mensagens`.
- Aposentadoria segura de estruturas legadas após contagem e validação de dados.

## Riscos conhecidos
- A migration é aditiva e preserva dados, mas deve ser validada em uma cópia do banco antes de produção.
- Ambientes com coluna gerada `leads.telefone_normalizado` precisam evitar update direto nessa coluna; a migration já trata essa condição dinamicamente.
- O build não pôde ser executado neste ambiente sem dependências instaladas.
