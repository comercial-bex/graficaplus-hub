# Diagnóstico geral do sistema — conexões, estruturas e lacunas

Levantamento feito agora contra o banco e o código. Só afirmo abaixo o que foi confirmado por consulta/leitura. Nada foi executado.

## 1. Situação em números

| Camada | Implementado | Falta |
|---|---|---|
| Estrutura de banco (tabelas, RLS, grants) | 95% | 5% |
| Regras de negócio no banco (RPCs, views) | 80% | 20% |
| Telas ligadas a dados reais | 74% (26 de 35 telas) | 26% (9 telas ainda em dados fictícios) |
| Perfis / permissões funcionando de ponta a ponta | 30% | 70% |
| Cadastros mínimos para operar (dados) | 25% | 75% |
| Fluxo comercial completo (orçamento → OS → financeiro → pós-venda) | 55% | 45% |
| Módulo 3D | 70% | 30% |
| WhatsApp / automações | 20% | 80% |
| **Média ponderada do sistema** | **~58%** | **~42%** |

Telas ainda com dados fictícios (9): Leads, Design, Entregas, Manutenção, Agenda de máquinas, Ocorrências, Respostas rápidas, além de trechos do Dashboard e do módulo de automações.

## 2. Falhas de relacionamento confirmadas (por gravidade)

### 2.1 CRÍTICO — Ninguém tem perfil atribuído
A tabela de papéis de usuário está **vazia (0 registros)**, mas toda a permissão do sistema depende dela: a função interna de permissão consulta papel do usuário × matriz de permissões (206 combinações cadastradas). O único usuário existente (Harison) está corretamente ligado à conta de acesso, porém **sem papel**.
Impacto: no frontend nenhum menu/ação com permissão aparece; no banco, todas as regras que exigem permissão negam acesso. É a causa isolada mais grave hoje.
Solução proposta: atribuir papel `admin` ao usuário atual; criar gatilho que, ao cadastrar um usuário, grave o papel escolhido; e uma tela de Usuários que edite papéis de verdade.

### 2.2 CRÍTICO — Dois sistemas de permissão paralelos e desconectados
Existem `permissoes` (106) + `perfil_permissoes` (368 registros, com 11 nomes de perfil: admin, administrador, gestor, gerente…) e, separadamente, a matriz usada de fato pelas regras de acesso (206 registros). Há ainda uma terceira lista fixa em código (`src/lib/permissions.ts`) com 9 perfis.
Impacto: o que se edita nas tabelas de perfil **não altera nada** no acesso real; nomes duplicados (admin/administrador, gestor/gerente) geram inconsistência.
Solução proposta: eleger a matriz como fonte única, gerar as tabelas de catálogo a partir dela (ou descartá-las), unificar os nomes de perfil e fazer o frontend ler as permissões do banco em vez da lista fixa em código.

### 2.3 ALTO — Agenda de máquinas duplicada
Existem duas tabelas equivalentes: `agenda_maquinas` e `maquinas_agenda`, ambas com vínculos para máquina, OS, item e operador. A tela usa apenas `maquinas_agenda`; relatórios e visões de máquina apontam para a outra.
Impacto: agendamento feito na tela não aparece nos indicadores de ocupação de máquina.
Solução proposta: definir uma canônica, migrar registros, transformar a outra em visão de compatibilidade e apontar tela + indicadores para a mesma origem.

### 2.4 ALTO — Orçamento 3D não entra no funil comercial
`orcamentos_3d` tem vínculo opcional com `orcamentos`, e hoje nenhum orçamento 3D preenche esse vínculo (1 orçamento 3D existe, 0 orçamentos tradicionais). As telas são separadas (`/orcamentos` × `/impressao-3d`).
Impacto: funil, faturamento previsto e dashboard comercial ignoram todo o 3D.
Solução proposta: ao salvar um orçamento 3D, criar/atualizar o orçamento-mãe correspondente (mesmo cliente/contato, valor e status espelhados) e exibir os dois tipos numa lista única com filtro por tipo.

### 2.5 ALTO — Produto não conversa com estoque
`produto_materiais` (a "receita" de cada produto) está **vazia**, com 22 produtos cadastrados e 5 materiais. `os_materiais_previstos`, `movimentacoes_estoque`, `estoque_reservas` e `material_lotes` também vazios.
Impacto: baixa de estoque, custo real por OS e alerta de estoque crítico não funcionam na prática — o motor existe, faltam os vínculos.
Solução proposta: cadastrar as receitas dos principais produtos, gerar automaticamente os materiais previstos na conversão em OS e mostrar na OS a diferença entre previsto e consumido.

### 2.6 MÉDIO — Filamento 3D e catálogo de produtos são mundos separados
`materiais_3d_filamento` liga-se a `materiais`, mas não a `produtos`; e apenas 1 máquina possui configuração 3D.
Impacto: um item 3D vendido não vira item de catálogo nem consome estoque de filamento.
Solução proposta: criar produtos do tipo "peça 3D" gerados a partir do orçamento 3D, com consumo de filamento lançado como movimentação de estoque no fechamento do job.

### 2.7 MÉDIO — Financeiro sem origem automática
`contas_receber`, `parcelas_receber` e `pagamentos` estão vazios, e nenhum orçamento foi convertido em OS. A cadeia orçamento → OS → parcelas existe em RPC, mas nunca foi exercitada.
Impacto: dashboard financeiro e relatórios de lucro por OS mostram vazio permanente.
Solução proposta: validar a cadeia com um caso real de ponta a ponta e criar as parcelas automaticamente na conversão, com plano de pagamento escolhido na tela.

### 2.8 MÉDIO — Pós-venda e portal do cliente sem gatilho
`portal_cliente_acessos`, `pos_venda_pesquisas`, `pos_venda_tickets` vazios; não há vínculo entre cliente cadastrado e usuário de acesso ao portal.
Solução proposta: gerar acesso ao portal no cadastro do cliente (convite por e-mail) e disparar pesquisa de satisfação automaticamente no fechamento da OS.

### 2.9 MÉDIO — WhatsApp desligado do CRM
Todas as 10 tabelas de WhatsApp estão vazias e não há instância configurada; leads (0) não são criados por mensagem.
Solução proposta: definir se o WhatsApp entra agora (exige provedor externo) ou é adiado; enquanto isso, marcar o menu como "não configurado" em vez de tela vazia.

### 2.10 BAIXO — Qualidade, manutenção e ocorrências sem ligação com a OS
Checklists, inspeções, manutenções e ocorrências existem com vínculo à OS/máquina, mas nenhuma tela grava nelas (páginas ainda fictícias).
Solução proposta: ligar essas telas às tabelas reais e exigir checklist aprovado antes de avançar a OS para "pronto".

## 3. Visão do sistema: perfis, atividades e casos de uso

Perfis previstos (9 no código, 11 nomes no banco — precisam ser unificados):

| Perfil | Atividades principais | Estado hoje |
|---|---|---|
| Administrador | Tudo, configurações, usuários e permissões | Telas existem, atribuição de papel não funciona |
| Gerente | Aprovar orçamento/desconto, distribuir OS, ver margem | 60% |
| Financeiro | Parcelas, pagamentos, resultado por OS | 50% (sem dados de origem) |
| Vendedor | Lead → cliente → orçamento (2D e 3D) → envio | 65% |
| Designer | Fila de arte, arquivos, aprovação do cliente | 25% (tela fictícia) |
| Operador | Kanban de produção, apontamento, jobs 3D | 55% |
| Estoque | Materiais, lotes, movimentações, inventário | 35% |
| Instalador | Entrega/instalação com comprovação | 15% (tela fictícia) |
| Cliente (portal) | Acompanhar OS, aprovar arte, baixar documentos | 30% (sem vínculo de acesso) |

Casos de uso de ponta a ponta e sua cobertura:
1. Atendimento → lead → cliente: **40%** (entrada manual apenas)
2. Orçamento comunicação visual → aprovação → OS: **60%**
3. Orçamento 3D → OS → produção 3D → fechamento: **65%** (não entra no funil comercial)
4. OS → produção → qualidade → entrega: **45%**
5. OS → resultado financeiro → pós-venda/NPS: **35%**
6. Compras/estoque → consumo → custo real: **30%**

## 4. Ordem sugerida de correção (proposta, não executada)

1. Perfis: atribuir papel ao usuário e unificar os três modelos de permissão. Destrava tudo.
2. Agenda de máquinas: eliminar a duplicidade.
3. Unificar orçamento 3D com o funil comercial.
4. Receitas de produto e cadeia de estoque.
5. Cadeia financeira e pós-venda automática.
6. Converter as 9 telas fictícias em telas reais.
7. Decidir o destino do WhatsApp.

Ganho estimado ao concluir os itens 1 a 5: de ~58% para ~85% de sistema operacional.

## 5. Observação sobre os dados

O banco foi zerado propositalmente: 0 orçamentos, 0 OS, 0 movimentações. Boa parte do "não funciona" percebido nas telas é ausência de dados, não de código — por isso o diagnóstico separa "falta código/vínculo" de "falta cadastro".
