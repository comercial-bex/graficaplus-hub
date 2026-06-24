# Plano de Migração

1. Aplicar migrations existentes em ordem lexicográfica.
2. Aplicar `20260624090000_parte1_fundacao_comercial.sql`.
3. Popular catálogo de permissões e matriz perfil-permissão.
4. Adicionar colunas ausentes por domínio sem remover dados.
5. Criar tabelas complementares de versionamento, financeiro previsto e timeline.
6. Migrar conversas legadas para estrutura canônica quando tabelas legadas existirem.
7. Executar validações com `scripts/parte1/validate-schema.sql`.
