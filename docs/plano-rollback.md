# Plano de Rollback

A migration é aditiva. Para rollback lógico:
1. Bloquear escrita da aplicação.
2. Exportar `eventos_negocio`, `orcamento_versoes`, `contas_receber`, `parcelas_receber` e novas tabelas WhatsApp.
3. Reverter uso das RPCs nas rotas para o commit anterior.
4. Manter colunas adicionadas até validação manual; não executar DROP em produção sem backup.
5. Caso necessário, remover policies/RPCs criadas pela migration usando nomes declarados no arquivo SQL.
