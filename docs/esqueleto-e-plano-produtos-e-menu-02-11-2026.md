# Esqueleto do Bex Print e plano: pasta do produto como no Holdprint e menu mais enxuto

Escrito em 02/11/2026 a pedido do dono, depois de ele mandar três capturas do Holdprint (lista "Produtos e Serviços" por família e a ficha "Banner em Lona" com as abas Descrição, Preço, Parâmetros, Processos, Fórmulas, Checklist, Orç.AI, Info, Campos e Histórico). O pedido: o esqueleto completo do sistema, a necessidade de cada módulo e como se ligam; o custeio de produtos e serviços copiado do Holdprint; e um plano, fase por fase, para enxugar o menu sem perder o objetivo. O objetivo dele: cada campo da pasta existe para a IA orçar sozinha depois.

Base: `origin/main` em 687993d (02/11, 13h08), banco de produção lido às 14h30 de 02/11 e a conta de teste do Holdprint (produto 128, Banner em Lona).

## 1. O que o dono viu e o que existe

**O achado principal:** a pasta do produto do Holdprint JÁ EXISTE no Bex Print, com 9 das 10 abas (PR #330, 01/11, migração `20261101300000`). Ela fica em `/produtos/<id>` e só abre pelo menu "⋮ › Abrir a pasta" de cada linha da lista. Clicar no nome do produto abre a janela antiga "Editar item" (Dados, Preço, Produção e ficha). Por isso a impressão de que "não foi criado": a porta é que está escondida.

Aba a aba, Holdprint (Banner em Lona) contra a pasta do Bex Print:

| Aba do Holdprint | O que tem lá | Bex Print hoje | Falta |
|---|---|---|---|
| Descrição | Nome, descrição em texto rico, Modelo de engenharia de custo, Família (chip "Em Lona"), Unidade na proposta (m²) | Família, subfamília e unidade; nome e descrição só se editam na janela da lista | Editar nome, descrição, família e unidade na própria pasta; "modelo de custo" = a base de cálculo (por área, por peça, por metro, por hora) |
| Preço | Preço padrão de venda, Método de cálculo (Por margem), Impostos, Preço especial para clientes | Preço de venda, sugerido, público, margem mínima, custo e a composição do custo (nível financeiro); edição só na janela da lista | Editar na pasta; mostrar o markup e as taxas da Planilha de custos; preço especial por cliente não existe |
| Parâmetros | Medidas do trabalho (largura, altura, cópias, descrição), Mídia de impressão (matéria-prima) | Medida padrão (largura, altura, cópias), material principal e máquina padrão só leitura | Escolher material e máquina na pasta; tamanhos prontos (`produto_tamanhos`, 103 linhas) sem tela na pasta |
| Parâmetros da lista de custos manuais | Processos com centro de custo, valor hora e horas; materiais com quantidade e preço; terceirizados com fornecedor e valor | Materiais do produto (`produto_materiais`, 65) na janela da lista; tempo do produto em minutos | Materiais na pasta; terceirizados não existem (tabela nova) |
| Processos | Sequência (Impressão: Solvente, Refile Manual) | Sequência com tempo por peça, subir, descer, tirar; catálogo `/processos` | Nada: já é igual |
| Fórmulas | Vazio no exemplo | Material por fórmula (`teto(perimetro / 0,5)`), com prévia; 0 fórmulas gravadas | **A fórmula não entra no custo nem no orçamento**: só a pasta a lê |
| Checklist | "Perguntas para guiar o orçamento" com descrição e resposta padrão | Perguntas com tipo, respostas, ação que acrescenta processo, resposta já marcada, modo da IA; 128 perguntas em 43 produtos | 26 produtos sem pergunta |
| Orç.AI | Personalidade e regras, Como descobrir as medidas, Perguntas obrigatórias, Habilitar | Igual, mais apelidos e a revisão de quem atende | Nada |
| Info | SKU, IPI, CST, NCM, Gera comissão, Disponível no PDV, Prazo de produção, Roteiro produtivo ("em breve") | Igual; o roteiro é a aba Processos | Nada |
| Campos | Campos extras do produto (vazio no exemplo) | Não existe | Aba nova |
| Histórico | Lista de alterações | Histórico por tabela e campo | Nada |

**Como está preenchido (69 produtos, 57 ativos):**

| O que | Produtos com | Sem |
|---|---|---|
| Roteiro da IA (personalidade, medidas, perguntas) | 69 | 0 |
| Sequência de processos | 57 | 12 |
| Perguntas do checklist | 43 | 26 |
| Materiais da ficha | 40 | 29 |
| Tamanhos prontos | 38 | 31 |
| Acabamentos ligados | 26 | 43 |
| Foto | 0 | 69 |
| Fórmula de material | 0 | 69 |
| Faixas de preço | 10 | 59 |

Processos: 19 no catálogo, 6 com produtividade medida (impressão eco-solvente, refile, bainha, ilhós, laminação, depilação); os outros 13 dependem do tempo digitado no produto. Centros de custo: 13 linhas da Planilha de custos (energia, markup, perdas, taxas, mão de obra) e 5 funções de mão de obra.

## 2. O esqueleto: módulos, telas, tabelas e como se ligam

79 telas logadas, 176 tabelas, menu em 4 áreas (Vendas, Produção, Financeiro, Administração), 13 subgrupos, 39 itens e 21 abas. O número de linhas diz o que vive e o que nunca foi usado.

### 2.1 A cadeia principal (é por ela que o dinheiro passa)

```
Contato (WhatsApp, funil)            whatsapp_conversas 44 · leads 30 · eventos_negocio 90
   └─ Cliente                        clientes 31 · arquivos 283 · cliente_contatos 0 · cliente_notas 0
        └─ Orçamento                 orcamentos 58 · orcamento_itens 86 · versoes 44 · custos 86
             ├─ lê o PRODUTO         produtos 69 · perguntas 128 · processos 102 · materiais 65 · tamanhos 103 · acabamentos 90 · faixas 37
             ├─ Aprovação pelo link  aprovacoes 3 · decisoes_pendentes 26
             └─ Ordem de serviço     ordens_servico 34 · itens_os 39 · os_tarefas 4 · status_historico 76
                  ├─ Agenda e máquinas   maquinas 9 · maquinas_agenda 16 · apontamentos 4
                  ├─ Materiais e estoque materiais 74 · lotes 50 · movimentacoes 54 · previstos 19 · reservas 7
                  ├─ Qualidade e perdas  qualidade_inspecoes 22 · os_perdas 1 · ocorrencias 0 · checklists_os 0
                  ├─ Entrega             entregas_instalacoes 0
                  └─ Financeiro          contas_receber 19 · parcelas 22 · pagamentos 19 · resultados 34
                                          caixa_movimentos 93 · banco_transacoes 91 · contas_pagar 110
Compras e fornecedores               fornecedores 2 · compras_fornecedor 8 · pedidos_compra 1 · catálogo LUGA 933 itens
```

O produto é o centro: perguntas, processos, materiais, fórmulas e preço alimentam o orçamento, a OS, o estoque, a agenda, o custo e a IA. É por isso que a pasta do produto vale mais que qualquer outra tela.

### 2.2 Os módulos, um a um

| Módulo (menu) | Telas | Tabelas vivas | Para que serve e com quem fala |
|---|---|---|---|
| WhatsApp | /whatsapp + 4 abas, /atendente-ensaio | whatsapp_* (862 mensagens, 44 conversas, 38 atendimentos, 332 na fila) | Entrada do pedido; cria lead e cliente; o rascunho da IA vira orçamento |
| Avisos ao cliente | /avisos | notificacoes_fila 59, templates 12 | Sai pelo WhatsApp quando a OS muda ou o boleto vence |
| Orçamentos | /orcamentos, /orcamentos/$id, /aprovacoes | orcamentos 58, itens 86, versoes 44, aprovacoes 3 | Lê o produto; gera OS, conta a receber e parcela |
| Catálogo de brindes | /catalogos (3 telas) | fornecedor_itens 933, fotos 766, custos 1.796; links e cotações 0 | Item de brinde da LUGA entra no orçamento; o link para o cliente nunca foi usado |
| Clientes | /clientes, /clientes/$id, /metragem | clientes 31, arquivos 283; portal_cliente_* 0 | Cadastro, histórico, documentos; o portal do cliente nunca foi aberto |
| Funil e contatos | /funil, /leads | leads 30, eventos_negocio 90 | Do contato ao orçamento |
| Parceiros | /parceiros | parceiros 8, programa 1, níveis 4; ofertas, campanhas, créditos 0 | Revenda com preço de parceiro |
| Pós-venda | /pos-venda | pesquisas 2; tickets, retornos, garantias 0 | Nunca operado |
| Meta do mês | /meta | metas_vendas 6 | Meta e realizado |
| Quadro e OS | /kanban, /os, /os/$id, /onde-para | ordens_servico 34, itens 39, tarefas 4, histórico 76 | A oficina; move status, aponta tempo, dá baixa de material |
| Agenda das máquinas | /maquinas-agenda, /capacidade, /conflitos-agenda | maquinas_agenda 16 | Quando cada peça roda em cada máquina |
| Máquinas | /maquinas, /manutencao | maquinas 9, velocidades 18, modos 4, contrato 4; manutencoes 0 | Custo-hora e velocidade entram no custo; manutenção nunca registrada |
| Artes e arquivos | /design, /arquivos | arquivos 283, comentarios 1 | Arte aprovada antes da máquina |
| Entregas | /entregas | 0 | Nunca operado |
| Perdas e ocorrências | /perdas, /ocorrencias | os_perdas 1; ocorrencias 0 | Quase não usado |
| Materiais e estoque | /materiais, /movimentacoes | materiais 74, custos 74, lotes 50, movimentações 54 | Custo do material entra no produto; a OS baixa o estoque |
| Compras | /compras, /fornecedores | pedidos_compra 1, compras_fornecedor 8, fornecedores 2 | Compra gera entrada; ainda não gera conta a pagar |
| Impressão 3D | /impressao-3d + 6 abas | orcamentos_3d 20, jobs 4, filamentos 33, impressoras 4 | Linha própria, com motor de custo próprio |
| Flexi | /importar-flexi | rip_jobs 38, vínculos 19 | Jobs do RIP ligados à OS |
| A receber | /a-receber, /financeiro | contas_receber 19, parcelas 22, pagamentos 19; comissoes 0 | Cobrança; comissão nunca calculada |
| Caixa e a pagar | /fluxo-caixa, /contas-bancarias, /compromissos, /reembolsos | caixa 93, banco 91, contas_pagar 110, compromissos 3; reembolsos 0 | O dinheiro que sai; conciliação do Pix |
| Preço e custo | /produtos, /produtos/$id, /processos, /planilha-custos, /custos-producao, /tabela-de-precos, /precificacao | produtos 69 e 12 tabelas satélites, processos 19, acabamentos 10, custos_tabela 13, mão de obra 5, faixas 37 | **O custeio.** É o bloco "Custeio" do Holdprint (Centros de custo, Equipamentos, Processos, Produtos e Serviços, Terceirizados) espalhado em 7 telas de duas áreas |
| Relatórios | /relatorios | views | 10 relatórios em cartões |
| Administração | /usuarios, /matriz-permissoes, /configuracoes-empresa, /configuracoes-api, /telas, /logs, /casos-de-uso, /mapa-sistema | usuarios 12, permissoes 120, perfil_permissoes 334, api_tokens 3, tv_dispositivos 3, logs 1.059 | Quem pode o quê; API e MCP; TVs |

### 2.3 O que nunca foi usado (candidatos a sair do menu)

Tabelas com zero linhas depois de meses no ar: pós-venda (tickets, retornos, garantias, oportunidades), portal do cliente (acessos, links, solicitações, comprovantes), links e cotações do catálogo, entregas e instalações, ocorrências, manutenções, reembolsos, checklists de OS, inventários de estoque, ofertas e campanhas de parceiro, comissões, compatibilidade máquina × produto, contatos e notas do cliente (novos), importações do fatiador, apontamentos e fechamentos 3D, relatórios salvos. Oito itens do menu vivem só disso: Pós-venda, Entregas e instalações, Perdas e ocorrências, Manutenção, Reembolsos (dois lugares), Catálogo › pedidos e gerenciar, Pagamentos e comissões (a parte de comissão).

## 3. O menu: hoje e a proposta

Holdprint: 12 entradas no trilho (Visão geral, Favoritos, Agenda, Cadastros, Custeio, CRM, Produção, Financeiro, Estoque, Relatórios, Insider AI, Ajustes), cada uma com até 5 subitens. O Custeio tem Centros de Custo, Equipamentos, Processos, Produtos e Serviços e Terceirizados.

Bex Print: 4 áreas, 13 subgrupos, 39 itens. O que cansa não é o número de áreas, é o número de itens por área (Vendas 11, Produção 11, Financeiro 12, Administração 5), com 21 abas por trás.

**Proposta (39 itens viram 25, com 36 abas; nenhuma tela some, muda de porta):**

| Área | Hoje | Proposta |
|---|---|---|
| Vendas | WhatsApp, Avisos, Orçamentos, Aprovações, Catálogo de brindes, Clientes, Funil, Parceiros, Pós-venda, Meta, Metragem | WhatsApp (Avisos vira aba), Orçamentos (Aprovações e Catálogo de brindes viram abas), Clientes (Pós-venda vira aba), Funil, Parceiros. Meta e Metragem viram cartões de Relatórios |
| Produção | Quadro, OS, Trabalho parado, Agenda, Máquinas, Artes, Entregas, Perdas, Materiais, Compras, 3D | Quadro, OS (Trabalho parado, Entregas e Perdas viram abas), Agenda, Máquinas, Artes, Materiais, Compras, 3D |
| Financeiro | A receber, Pagamentos e comissões, Caixa, Contas bancárias, Despesas fixas, Reembolsos, Fornecedores, Produtos, Planilha de custos, Tabela de preços, Simulador, Relatórios | A receber, Caixa (Contas bancárias, Despesas fixas e Reembolsos viram abas), Pagamentos e comissões, Fornecedores, **Custeio** (hub: Produtos e serviços, Processos, Acabamentos, Planilha de custos, Mão de obra, Tabela de preços, Simulador), Relatórios |
| Administração | Equipe, Dados da empresa, TVs, Histórico, Como funciona | Igual; API e MCP continua dentro de Dados da empresa |

O hub **Custeio** é o bloco do Holdprint que o dono pediu, inteiro num lugar só. A árvore do menu é decisão do dono (foi ele quem aprovou a de 06/10): a proposta fica aqui até o OK, e aí vira uma fase de um PR só, em `src/lib/menu.ts`, sem mexer no desenho do menu que a outra sessão está acabando (#396).

## 4. O plano, fase por fase

Cada fase é um PR a partir de `origin/main`, com `npx tsc --noEmit` e `TZ=UTC npx vitest run`, migração aplicada no banco antes do Publish, publicação pelo Lovable e prova no site (`provar_publicacao.sh`). Nada de apagar dado sem listar e esperar o OK.

| Fase | O que entrega | Como se prova | Fora dela |
|---|---|---|---|
| 1. A pasta vira a tela do produto | Lista `/produtos` como no Holdprint: famílias à esquerda com desenho e contagem, produtos à direita, busca, "Inserir produto" (assistente em passos) e "Editar famílias" (renomeia a família de todos de uma vez). Clicar no nome abre a pasta. Na pasta, Descrição editável (nome, descrição, família, base de cálculo, unidade na proposta), Preço editável para quem vê financeiro (com o markup e as taxas da Planilha mostrados), Parâmetros com material principal, máquina padrão e tamanhos prontos editáveis. A janela antiga fica como "Edição rápida" | Teste de tela sem navegador; no site: `familias-da-lista` e "Editar famílias" no chunk `produtos`, "Unidade na proposta" no chunk `produtos_._id` | Preço especial por cliente; apagar a janela antiga |
| 2. Aba Campos | `produto_perguntas.finalidade` (`cobranca` ou `informacao`): a aba Campos lista o que o item do orçamento pergunta só para informar a produção e a arte (texto, número, lista), sem mexer no preço; o item e a OS mostram as respostas | Migração com GRANT na mesma hora (lição do #337); teste do domínio; marcador "Campos" no chunk da pasta | Arquivo como campo |
| 3. Custos manuais e terceirizados | Materiais da ficha dentro da pasta (Parâmetros), "Horas de gente" por processo sem produtividade e a tabela nova `produto_terceirizados` (fornecedor, descrição, valor), somados na composição do custo | Ensaio com `RAISE EXCEPTION`; o cartão "Custo da peça" mostra a linha nova | Compra do terceirizado virar conta a pagar |
| 4. Fórmulas que entram no custo | O motor do item lê `produto_formulas` e grava o material calculado em `orcamento_item_custos`; fórmulas semeadas para ilhós (`teto(perimetro / 0,5)`), bastão (2 por peça) e corda nas lonas e banners; a pasta mostra a prévia com a medida padrão | Teste do motor com os casos dos 10 produtos de lona; soma do custo antes e depois nos itens existentes (não muda o que já foi orçado) | Fórmula de tempo |
| 5. Preencher | Catálogo do Holdprint atualizado em `catalogo_modelos` (famílias, subfamílias e os nomes que faltam, só nome); subfamília nos 69; perguntas sugeridas nos 26 sem; fotos por IA em lote (crédito do Lovable já autorizado; primeiro 1 produto para confirmar o modelo); apelidos | Contagens antes e depois; nenhuma pergunta nasce obrigatória | Produto novo sem custo e preço |
| 6. Pronto para a IA | Nota de 0 a 10 por produto (foto, descrição, família, unidade, medida padrão, material, processos, perguntas, fórmula quando couber, roteiro revisado) na lista e em Preencher as pastas; o MCP `bexprint_descrever` devolve a nota | Teste da nota; marcador no chunk | Mudar a IA do orçamento |
| 7. Menu | A proposta da seção 3, depois do OK do dono | Teste da árvore; `route` no site | Antes do OK |

Ordem de execução nesta sessão: 1, 2, 5 (parte de dados, não depende de tela), 4, 3, 6; a 7 espera a decisão.

## 4.1 Estado na noite de 02/11

| Fase | Estado |
|---|---|
| 1. A pasta vira a tela do produto | Mesclada (#399) e NO AR (deploy 810670ea, 10 marcadores provados nos arquivos `produtos-*` e `produtos_._id-*`) |
| 2. Aba Campos | Mesclada (#400) e NO AR (deploy ba4386e7, 7 marcadores); migração `20261102210000` aplicada; 18 campos opcionais semeados em placas, letreiros, brindes e acrílico (desfazer: `DELETE FROM produto_perguntas WHERE finalidade='informacao' AND created_at::date='2026-11-02'`) |
| 3. Custos manuais e terceirizados | Materiais da ficha já estão na pasta (fase 1). Horas de gente por processo e a tabela de terceirizados esperam a resposta do dono sobre o que a gráfica terceiriza |
| 4. Fórmulas no custo | Mesclada (#402); migração `20261102220000` aplicada e ensaiada; publicação em andamento ao fim da sessão |
| 5. Preencher | Catálogo do Holdprint atualizado em `catalogo_modelos` (33 nomes novos, 442 no total; só nome, sem produto). Campos semeados (fase 2). Fotos por IA dependem de alguém logado clicar "Gerar fotos que faltam" (o modelo de imagem ainda não foi confirmado). Subfamília não foi semeada: a família já faz esse papel |
| 6. Pronto para a IA | Mesclada (#404): nota de 0 a 10 na lista e no alto da pasta, com o que falta pelo nome |
| 7. Menu | OK do dono na noite de 02/11 ("tem meu sim para tudo"). Executada: 39 itens viraram 25 (as abas foram de 21 para 36). Aprovações, Catálogo de brindes e Meta do mês são abas de Orçamentos; Pós-venda e Metragem, de Clientes; Trabalho parado, Entregas, Perdas e Ocorrências, da OS; Contas bancárias, Despesas fixas e Reembolsos, do Caixa; o hub **Custeio** (a tela de produtos) leva Processos, Planilha de custos, Mão de obra, Tabela de preços e Simulador. Ninguém ganhou nem perdeu tela: mudou a porta. Avisos ao cliente ficou item próprio (a Cibele o abre sem abrir o WhatsApp) |

## 5. Decisões do dono

1. Menu: a proposta da seção 3 serve? O hub Custeio no Financeiro ou como área própria?
2. Quais perguntas ficam obrigatórias (hoje nenhuma).
3. Fotos por IA em lote para os 69: pode gastar o crédito? (teste com 1 primeiro)
4. Terceirizados: hoje a gráfica terceiriza o quê? (vale decidir antes da fase 3)
5. Preço especial por cliente: precisa? Hoje há preço de parceiro e faixas por quantidade.
