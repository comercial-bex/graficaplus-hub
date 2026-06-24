# Parte 2 — Operação completa da OS

A migration `20260624120000_parte2_operacao_os.sql` complementa a fundação da Parte 1 sem substituir suas tabelas canônicas. Ela adiciona a camada operacional da OS: tarefas, arquivos versionados, estoque transacional, agenda de máquinas, manutenção, apontamentos de produção, qualidade, ocorrências/retrabalho, logística, custos realizados e fechamento operacional.

## Schema operacional implementado

- **Itens da OS**: `itens_os` passa a armazenar `especificacoes`, `custos_previstos`, `preco_snapshot`, `margem_prevista`, `planejamento`, vínculos de arquivo e flags de qualidade/entrega/instalação.
- **Tarefas**: `os_tarefas` registra responsável, setor, status, prazo, tempos previsto/real, dependências, checklist, anexos, comentários, criador e finalizador.
- **Arquivos**: `arquivos` recebe campos de versão, substituição, hash, tamanho, MIME, bucket, caminho, status e final; `arquivo_aprovacoes` e `arquivo_tokens_externos` cobrem aprovação e token externo.
- **Estoque**: `material_lotes`, `os_materiais_previstos`, `estoque_reservas` e extensões em `movimentacoes_estoque` tornam o ledger a fonte auditável.
- **Máquinas**: `maquinas_agenda` é a agenda canônica com constraint de exclusão para impedir sobreposição ativa; `maquina_compatibilidades` registra compatibilidade produto/máquina.
- **Manutenção**: `manutencoes` recebe campos de motivo, janelas, técnico, peças, custo, horas paradas, horímetro e recorrência.
- **Produção**: `apontamentos_producao` registra início, pausa, retomada, fim, quantidades, perdas, operador e máquina.
- **Qualidade**: `qualidade_checklists` e `qualidade_inspecoes` dão suporte a checklist configurável e bloqueios de fechamento.
- **Retrabalho/Ocorrências**: `ocorrencias` passa a manter causa, etapa, item/tarefa, custos, perdas e tarefa de retrabalho.
- **Logística**: `entregas_instalacoes` passa a guardar item, janela, responsável, checklist, rota, fotos, comprovante, assinatura e ocorrência.
- **Custos**: `custos_operacionais_os` separa custo realizado por categoria, origem, OS, item e tarefa.
- **Timeline**: `vw_timeline_os` expõe leitura única a partir de `eventos_negocio`, preservando logs especializados.

## RPCs

- `reservar_materiais_os(p_os_id uuid)`: reserva materiais previstos usando lotes bloqueados, evita duplicidade, permite parcialidade, retorna faltantes e grava timeline.
- `baixar_estoque_os(p_os_id uuid, p_consumos jsonb default null)`: baixa reservas da OS com locks, impede dupla baixa, gera movimentações e custo realizado.
- `estornar_baixa_estoque_os(p_movimentacao_origem_id uuid, p_motivo text)`: cria movimento inverso sem apagar a saída original.
- `fechar_os(p_os_id uuid)`: valida tarefas, qualidade, estoque, ocorrências, logística e custos; fecha operacionalmente ou retorna bloqueios, deixando bloqueios financeiros para a Parte 3.

## RLS e permissões

A migration cadastra as permissões adicionais de tarefas, arquivos, estoque, máquinas, manutenção, logística, custos e resultado. Admin/administrador recebe todas; perfis operacionais recebem permissões compatíveis. As novas tabelas têm RLS habilitado e políticas iniciais por permissão para leitura/escrita direta, com ações críticas protegidas por RPCs.

## Testes e validação

Use `scripts/parte2-validate-schema.sql` após aplicar migrations para verificar tabelas, funções e permissões críticas.

Cenários manuais/automatizados recomendados:

1. Reserva total, parcial, dupla reserva e faltantes.
2. Baixa transacional, dupla baixa, saldo insuficiente e estorno.
3. Agenda com conflito, conflito concorrente e manutenção bloqueante.
4. Versionamento, aprovação, reprovação, versão antiga e token expirado.
5. Produção com início, pausa, retomada, fim, perda, manutenção e qualidade.
6. Retrabalho com tarefa, consumo e custo separado.
7. Entrega/instalação com comprovante, assinatura e sincronização de status.
8. Fechamento operacional com bloqueios e sucesso.

## Deploy

1. Aplicar migrations em ambiente de homologação.
2. Executar `scripts/parte1/validate-schema.sql` e `scripts/parte2-validate-schema.sql`.
3. Exercitar o E2E operacional de uma OS criada pela Parte 1.
4. Promover para produção em janela com baixo volume de produção.

## Rollback

Preferir rollback por migration reversa em homologação. Em produção, preservar dados operacionais e desabilitar temporariamente chamadas às RPCs novas antes de remover constraints/tabelas.

## Preparação para Parte 3

A Parte 2 deixa custos operacionais realizados e `vw_resultado_operacional_os` preparados para a integração financeira final da Parte 3.
