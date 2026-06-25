# Parte 3 — Impressão 3D, resultado, portal e homologação

## Implementado
- Extensão 1:1 de máquinas (`maquinas_3d_config`) para impressoras 3D.
- Extensão de materiais para filamentos (`materiais_3d_filamento`) e enriquecimento de lotes para rolos.
- Orçamentos 3D integrados a orçamentos gerais, com placas, consumos, serviços e cálculos imutáveis/versionados.
- Imports de slicer com hash SHA-256, metadados normalizados e bucket privado `slicer-imports`.
- Produção 3D com jobs, apontamentos, falhas, reimpressões e fechamento previsto versus realizado.
- `vw_resultado_os`, dashboards oficiais e RPC `fechar_os(p_os_id uuid)`.
- Portal do cliente com RLS por cliente e pós-venda com pesquisas, respostas, tickets, garantias, retornos e oportunidades.
- Motor matemático TypeScript com Decimal, testes determinísticos e parser inicial Bambu/G-code.

## Homologação E2E
1. Aplicar migrations em banco limpo.
2. Criar usuário vendedor, gerente, operador, financeiro e cliente.
3. Receber mensagem, criar lead, converter cliente e criar orçamento 3D.
4. Importar `.gcode` ou `.gcode.3mf`, validar SHA-256 e campos normalizados.
5. Calcular custo, aprovar margem/desconto, converter em OS.
6. Reservar máquina e rolo/lote; iniciar apontamento; registrar falha e reimpressão.
7. Registrar consumo real, energia real, acabamento, qualidade, embalagem, entrega e pagamento.
8. Executar `fechar_os(p_os_id)` e validar snapshot, dashboard e criação de pós-venda.
9. Logar como cliente e confirmar isolamento por RLS no portal.

## Deploy
- Rodar migrations Supabase em ordem cronológica.
- Regenerar tipos do Supabase após deploy do schema.
- Publicar frontend com as rotas de impressão 3D.
- Configurar bucket privado `slicer-imports` e políticas de storage equivalentes às permissões de arquivos.

## Rollback
- Reverter release frontend anterior.
- Restaurar snapshot/backup do banco anterior à migration `20260625090000_parte3_impressao3d_resultado_portal.sql`.
- Caso rollback lógico seja obrigatório, desabilitar rotas 3D e revogar permissões `impressao3d.*` antes de remover tabelas.

## Riscos e pendências
- O parser 3MF foi preparado com validações e contrato, mas leitura ZIP profunda deve ser validada com amostras reais do Bambu Studio no ambiente final.
- Tipos Supabase gerados precisam ser atualizados contra uma instância Supabase operacional.
- E2E completo depende de credenciais, storage e dados reais; este repositório contém os testes determinísticos do motor.
