# Plano de Testes Parte 1

- Banco vazio: aplicar migrations e validar objetos canônicos.
- Banco legado: validar que tabelas legadas não são removidas e dados podem coexistir.
- Permissões: testar cada perfil contra rotas e RPCs.
- Concorrência: executar RPCs duas vezes para lead, orçamento, pagamento e status.
- E2E: mensagem recebida → lead → cliente → orçamento → OS → financeiro → timeline.
