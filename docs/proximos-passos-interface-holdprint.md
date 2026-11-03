# Próximos passos: interface e regras do Holdprint no Bex Print

Documento vivo para quem pegar o trabalho depois. Começou em 31/10/2026, a pedido do dono, depois de ele ver 20 capturas do Holdprint. O desenho e as decisões estão em [plano-interface-holdprint-31-10-2026.md](plano-interface-holdprint-31-10-2026.md); as capturas, em `referencias/holdprint-31-10/`. Este arquivo diz **o que já foi feito, o que falta, em que ordem e como retomar**.

## Estado das ondas

| Onda | O que é | Estado |
|---|---|---|
| 1 | Cores e letra (tokens, letra mínima de 12 px, `text-link`, menu 16 px) | Mesclada (#309) |
| 2 | Topo azul-marinho, cabeçalho de página com trilha, fundo liso | Mesclada (#310) |
| 5 | Quadro de orçamentos com total e quantidade por coluna | Mesclada (#311) |
| 7a | Total em reais no alto de cada coluna do quadro de produção | Mesclada (#312) |
| 4 | Dinheiro a receber e a pagar por janela no painel inicial (função no banco, já aplicada) | Mesclada (#313) |
| Funil | Lead do WhatsApp deixa de ser temporário pelos fatos (o funil mostrava zero) | Mesclada (#315), migração já aplicada |
| Cadastro | Ficha do cliente com inscrições, outros contatos e origem; documento validado também na edição | Mesclada (#319), migração já aplicada |
| Cadastro 2 | Origem no cadastro guiado Novo cliente | Mesclada (#321) |
| Cadastro 3 | Cliente de fora (país com bandeira e nome, WhatsApp com código do país), documento obrigatório para o Brasil, lista com Sem CPF/CNPJ | Mesclada (#324), migração já aplicada |
| Cadastro 4 | CEP que preenche o endereço e aba Histórico com notas do cliente | Mesclada (#327), migração já aplicada |
| Caixa | Pix contado em dobro: conciliação do extrato com os pagamentos, automática a cada importação | Mesclada (#324): 9 Pix, R$ 3.197,24 a menos nas entradas |
| Orçamento | Funil de negociação: Em negociação e Aceite verbal no quadro, validade à vista | Mesclada (#326), migração já aplicada |
| Seletor F1 | Tipo com desenho no estilo do Holdprint, família como filtro, foto grande no cartão, estrela de favorito e atalho Favoritos | Mesclada (#331), migração `20261101230000` já aplicada (família nas views) |
| Seletor F2 | Botão "Gerar foto com IA" no cadastro e na ficha do produto, "Copiar pedido" e "Gerar fotos que faltam" em lotes de 8; foto real enviada substitui | Mesclada (#332). O id do modelo de imagem do gateway não foi confirmado na documentação: a função tenta três e mostra o motivo se nenhum servir |
| Pasta do produto | `/produtos/$id` com Descrição, Preço, Parâmetros, Processos, Fórmulas, Checklist, Orç.IA, Info e Histórico, e o catálogo `/processos` (outra sessão) | Mesclada (#330), migração `20261101300000` aplicada. Ainda não entra no orçamento |
| Custeio fase 1 | A lista `/produtos` como o "Produtos e Serviços" do Holdprint: famílias à esquerda com desenho e contagem, "Inserir produto", "Editar famílias" (renomeia ou junta famílias de uma vez), o resto em "Mais"; o nome do produto abre a pasta, e a janela antiga vira "Edição rápida" no ⋮. Na pasta, Descrição editável (nome, descrição, família, categoria, tipo, unidade na proposta, "como se calcula", foto), Preço editável para o nível financeiro com o método de cálculo da casa, Parâmetros com máquina, material, tempo, observações, tamanhos prontos e a ficha de materiais. Plano completo em `esqueleto-e-plano-produtos-e-menu-02-11-2026.md` | Mesclada (#399), sem migração |
| Custeio fase 2 | Aba Campos da pasta: `produto_perguntas.finalidade` (`cobranca` ou `informacao`). Campo de informação é o que o item do orçamento pergunta só para a produção e a arte (texto da placa, cor, nome no brinde): aparece no item num bloco próprio, "Informações para a produção", grava em `orcamento_itens.respostas` e nunca acrescenta processo (regra no banco e no código). As 128 perguntas de hoje seguem `cobranca` | Mesclada (#400), migração `20261102210000` aplicada |
| Custeio fase 4 | As fórmulas da pasta entram no custo do item: a tela roda a fórmula na medida do item e grava a quantidade por peça em `orcamento_itens.materiais_por_formula`; o gatilho calcula `custo_formulas` pelo custo de compra do material; o espelho, a view financeira, o custo estimado do orçamento e a OS convertida somam os dois. O item mostra "Material por fórmula" e a margem na hora conta com ele; a pasta mostra o material por fórmula na medida padrão. Nenhuma fórmula foi semeada: a casa escreve as dela na aba Fórmulas (ex.: `teto(perimetro / 0,5)` para o ilhós a cada 50 cm) | Mesclada (#402), migração `20261102220000` aplicada e ensaiada (12 ilhós × R$ 0,35 = R$ 4,20 no item, no espelho e no custo estimado) |
| Custeio fase 6 | Nota "Pronto para a IA" de 0 a 10 por produto, na lista e no alto da pasta, com o que falta pelo nome: foto, descrição, família, unidade, medida padrão (produto por área), material principal (produto), processos, perguntas do checklist, fórmula de material (produto por área) e roteiro da IA escrito e revisado. A checagem que não cabe no produto sai da conta. Só leitura: `domain/catalogo/pronto-para-ia.ts` | Fase 6 do plano de 02/11, sem migração |
| Seletor F3 | Perguntas do produto respondidas no item do orçamento: obrigatória segura o item, a resposta que acrescenta processo entra no acabamento, tudo gravado em `orcamento_itens.respostas` | Mesclada (#337), migração `20261102003000` já aplicada (coluna e as três views de itens). **Ainda não mexe no preço**: a produtividade dos processos está vazia. **65 perguntas opcionais sugeridas em 02/11** (30 produtos): nas lonas e banners, "A instalação é por nossa conta?" (Sim acrescenta Instalação e Deslocamento de equipe) e "Precisa embalar para transporte?" (Sim acrescenta Embalagem); nos adesivos, "A aplicação é por nossa conta?", "Onde o adesivo vai aplicado?" e, nos impressos, "Precisa de laminação?" (Sim acrescenta Laminação). A marca de sugestão saiu da descrição em 02/11 (migração `20261102170000`), porque aparecia para quem atende; nenhuma é obrigatória até o dono decidir. As do Holdprint estão em `catalogo-do-holdprint-visto-em-01-11.md` |
| Seletor F4 | Relatórios em cartões com desenho, favoritos e categorias | Mesclada (#335) |
| Etapas e custo | Sequência de processos em 56 dos 67 produtos ativos, composição do custo na aba Preço da pasta (só nível financeiro), apelidos na busca e na IA, tamanho com "quando usar", resposta já marcada e pergunta que a casa não faz (`resposta_padrao`, `nao_perguntar`) | Migração `20261102110000` aplicada. O acabamento aparece à parte: **o custo cheio oficial não mudou**, somar é decisão do dono. Nenhuma pergunta nasce com `nao_perguntar` |
| Atendente em ensaio | `/atendente-ensaio`, aberta pela Fila humana: alguém escreve como cliente, e a réplica passa as conversas reais pelo atendente ao lado do que a equipe respondeu. A IA nunca escreve valor: a conta vem da tabela (`domain/whatsapp/atendente.ts`). Nada sai pelo WhatsApp e `ia_ativa` segue desligada | Migração `20261102200000` |
| Produtos fora da venda | Botão de ativar e desativar à vista (#362). O dono desativou 11 produtos nunca orçados: fachada luminosa, lonas backlight, dupla face, fosca, lisa, perfurada e texturizada, e adesivos blackout, fosco, PROMO e perfurado promocional. Reativar é um clique | Migração `20261102190000` aplicada |
| Medida fixa e fachada | Os 10 produtos que faltavam com o limite da máquina (migração `20261102180000`, aplicada). Adesivo de mão, pragão, bola e bolão ganharam a etapa de recorte. **As faixas de preço destes 9 produtos de medida fixa venceram em 04/10/2026 e eles não têm preço base: hoje saem zerados.** O rascunho da IA avisa; renovar a tabela é decisão do dono | Aberta |
| Instrução da IA por pergunta | `produto_perguntas.ia_modo` (perguntar, marcar só se o cliente falar, definir), `ia_resposta` e `ia_instrucao`, editáveis no Checklist da pasta. Vale só para a IA. O rascunho da IA grava as respostas e a cobrança. Limites reais de plotter, recorte, laser CO2, fiber e 3D no roteiro dos produtos de cada máquina, com textos nossos. Falta o dono confirmar emenda acima do rolo e o aviso do branco no transparente | Migração `20261102150000` aplicada |
| Resposta que cobra | A resposta que acrescenta processo com serviço vira linha do orçamento presa ao item (`gerado_por_item_id`): laminação pela área; instalação e deslocamento com horas e km digitados; embalagem e máscara sem cobrança, porque não têm preço. Mudar a resposta tira a linha, e tirar o item leva a cobrança junto. A IA ainda não preenche as respostas no rascunho. Linha por área grava largura, altura e preço por m², porque linha sem medida cobra no mínimo 1 no banco | Migração `20261102140000` aplicada |
| Banner 440 g | Produto próprio `BAN-440`, R$ 89,90/m² (decisão do dono). A pergunta "Em qual lona?" saiu do Banner 280 g. Sem preço de parceiro: vale o do nível | Migração `20261102130000` aplicada; só banco, sem publicar |
| Conta dupla do serviço | Serviço sem receita e com custo digitado deixou de somar tempo e rateio por cima (7 produtos mudaram, nenhum item de orçamento os usava). O cartão da pasta só mostra o acabamento à parte quando o custo conta pela velocidade da máquina; o simulador zera o tempo do serviço | Migração `20261102120500` aplicada |
| 2b | Menu em coluna única com grupos e favoritos | Quase pronta: nome no trilho e subgrupos recolhíveis (#322) e favoritos com estrela (#325); a coluna única só se o dono pedir |
| Menu enxuto | 39 itens viraram 25 (OK do dono em 02/11 à noite): tela que é desdobramento de outra virou aba dela, e o hub **Custeio** (tela de produtos) junta Processos, Planilha de custos, Mão de obra, Tabela de preços e Simulador, como o Custeio do Holdprint. A árvore aprovada dos testes (`tests/apoio/menu-aprovado.ts`) ganhou a camada `enxugarDeNovembro`, que transforma o cenário B de cada pessoa do mesmo jeito | Fase 7 do plano de 02/11 |
| 3 | Padrão de lista financeira (chips, período com atalhos, Ações em lote, rodapé de totais) | Quase pronta: Contas a pagar (#316) e Contas a receber (#320) mescladas; seleção por linha, total dos selecionados, Copiar resumo, Baixar CSV e Visões salvas em #392. Falta dar baixa em lote (depende do dono), Colunas e as listas de compras, materiais e clientes |
| 6 | Filtros do WhatsApp ao lado da conversa | Quase pronta: a caixa já tem abas de status, filtro de setor e busca; falta só filtro por responsável |
| 7b, 7c | Tela do operador por máquina e linha do tempo | Falta |
| 8 | Regras do dinheiro: plano de contas, centro de custo, compra que gera conta a pagar, liquidar completo | Falta |
| 9 | Hora por centro de custo | Falta, depende de decisão |
| 10 | Agenda única | Falta |
| IA | Assistente que responde com os dados da gráfica | Plano abaixo |
| PDV | Venda de balcão | Plano abaixo, depende de prints |
| API/MCP 1 | Token pessoal em Ajustes (Dados da empresa › API e MCP) e leitura REST `GET /api/v1/{clientes,orcamentos,os,contas_receber,contas_pagar}` com a permissão de quem gerou o token | Mesclada (#351, prefixo corrigido no #353), migração `20261102143000` já aplicada |
| API/MCP 2 | Endereço MCP `POST /api/mcp` com seis ferramentas de leitura (descobrir, descrever, consultar, contar, somar, exemplos), JSON-RPC por HTTP sem sessão, mesmo token da API | Mesclada (#377), sem migração |
| API/MCP 3 | Ações com ensaio: renovar orçamento vencido, mover etapa comercial e registrar nota do cliente (`bexprint_acoes`, `bexprint_executar`); só grava com `confirmado = true`, como a pessoa dona do token | Mesclada (#379), migração `20261102153000` já aplicada. Fora, até o dono liberar por ação: registrar pagamento, aprovar orçamento, qualquer coisa com valor ou mensagem ao cliente |

**Publicação:** as Ondas 1, 2, 4, 5 e 7a foram publicadas em 31/10/2026 com o OK do dono. O site responde em bexprint.com.br e bexprint.lovable.app redireciona para lá. Provado no bundle: `--topbar` e `#0ebfa6` no CSS, `vencimentos_por_janela` no chunk do painel e "Quadro de orçamentos" no chunk de orçamentos. Em 01/11/2026 foram publicadas também a Onda 3 em Contas a pagar (#316) e em Contas a receber (#320), a ficha do cliente (#319), a origem no cadastro guiado (#321) e o menu com o nome sempre visível e os subgrupos recolhíveis (#322). Provado nos arquivos do site: `fluxo-caixa`, `a-receber` (`filtro-origem`), `clientes.index` (Documentos fiscais), `clientes._id` (Outros contatos), `campos-da-ficha` (Possui inscrição estadual) e `route` (menu: `subgrupos-recolhidos`). Na noite de 01/11/2026 foram publicados também o cliente de fora com país e WhatsApp internacional, o documento obrigatório e o Pix conciliado (#324), os favoritos do menu (#325), o funil de negociação do orçamento (#326), o CEP que preenche o endereço e a aba Histórico (#327), no deploy c3de7ad0 sobre o commit 34db728. Provado nos arquivos do site, uma vez cada: "Código do país do telefone" e "Buscar o endereço pelo CEP" (`campo-de-cep`), "Aceite verbal" e "Em negociação" (`orcamentos.index`), `bexprint:menu:favoritos` e "Pôr nos favoritos" (`route`), "O que a equipe precisa saber sobre este cliente" (`clientes._id`), `conciliar_extrato_com_pagamentos` (`contas-bancarias`) e "Sem CPF/CNPJ" (`clientes.index`). Na madrugada de 02/11/2026 foram publicados o seletor visual (#331), a foto por IA (#332) e a pasta do produto (#330), no deploy dcf285ba sobre o commit e0d10b7, provados em 359 arquivos do site, uma vez cada: `data-ilustracao`, `filtro-de-familia`, "nos favoritos" e `bexprint:orcamento:produtos-favoritos` (`orcamentos._id`), "Gerar foto com IA", "Copiar pedido" e "Gerada pela IA" (`foto-do-produto`), "Gerar fotos que faltam" (`produtos`). Ainda em 02/11 foram publicados os relatórios em cartões (#335) e as perguntas do produto no item (#337), com os PRs #334 e #336 da outra sessão, no deploy 2e722253 sobre o commit 51b7fec; marcadores no site: `cartoes-de-relatorio` e `relatorio-faturamento` (`relatorios`), "Perguntas do produto" e "Responda antes de adicionar o item." (`orcamentos._id`). Em 02/11 também foi publicado o aviso de validade no painel inicial (#343), no deploy 19ef5acf sobre 75501d8 (marcadores `aviso-validade-orcamentos` e `dash-orcamentos-vencendo` no chunk `dashboard`). **Tropeço de 02/11:** `orcamento_itens.respostas` (#337) nasceu sem SELECT para `authenticated`, porque a tabela dá leitura coluna a coluna, e a tela do orçamento ficou sem itens para todo mundo até o GRANT do #342; antes de `ADD COLUMN`, conferir `information_schema.column_privileges` de uma coluna vizinha. O "Renovar e reenviar" (#346) saiu no deploy fe943e44 sobre 56e6908 (marcadores `renovar-orcamento` e "Renovar e reenviar" no chunk `orcamentos.index`). A API com token pessoal (#351, #353, #357) saiu no deploy 49cfc3e5 e foi provada de ponta a ponta: chunk `configuracoes-api` com "Seu token pessoal"; `GET /api/v1/recursos` 200 sem token; recursos sem token 401; com um token do admin de teste, 24 clientes, 9 orçamentos enviados, 34 OS, 19 parcelas a receber e 3 contas a pagar de outubro, com `x-ratelimit-remaining: 99`; o token foi revogado depois e passou a voltar 401. O MCP de leitura e as ações com ensaio (#377, #379) saíram no deploy 56ec021b e os valores por nível (#385) no deploy 64a97cbf, provados ao vivo com tokens do admin de teste, todos revogados depois: `initialize` e `tools/list` sem token (oito ferramentas), `tools/call` sem token recusado, leitura (24 clientes, 9 orçamentos enviados, 34 OS), soma de R$ 3.346,29 nos 9 enviados e R$ 8.542,25 nas 34 OS, as cinco ações em ensaio com dados reais (orçamentos 82 e 159 inalterados, zero notas, cinco chamadas no rastro `api_acoes`, nenhuma confirmada), `confirmado` como texto continua ensaio, ação de pagamento recusada. No bundle: `comando-mcp`, `bexprint_executar` e "só vem para quem vê preços" no chunk `configuracoes-api`. Na noite de 02/11 saíram as fases do custeio: a lista por família e a pasta editável (#399) no deploy 810670ea (dez marcadores: `familias-da-lista`, "Editar famílias", "Inserir produto", "Edição rápida", `numeros-do-catalogo`, "Unidade na proposta", "Como se calcula", "Método de cálculo da casa", `tamanhos-prontos`, "Materiais deste produto"), a aba Campos (#400) no deploy ba4386e7 (sete marcadores, entre eles `campos-do-produto` e "Informações para a produção" no chunk `orcamentos._id`) e as fórmulas no custo (#402) no deploy 3eacfc15. A correção do funil (#315) é só banco e já vale. Ordem de sempre: migração aplicada antes do front, esperar o Lovable sincronizar o commit da `main` (`get_project.latest_commit_sha`), publicar, provar no bundle com `curl -L` e avisar o dono para recarregar com Ctrl+Shift+R, por causa do service worker.

## Seletor de produto, fotos e relatórios (01/11, noite)

O dono mandou 14 capturas do orçamento e dos relatórios do Holdprint (resumo em [catalogo-do-holdprint-visto-em-01-11.md](catalogo-do-holdprint-visto-em-01-11.md)) e pediu nota cognitiva de 0 a 100. **Nota: 35.** A estrutura do Bex Print é boa; falta o que o olho pega primeiro.

| Tela | Bex Print em 01/11 | Nota |
|---|---|---|
| Escolher o produto | 2 passos (tipo e produto), 9 tipos com ícone pequeno, busca e 3 atalhos | 45 |
| Fotos de produto | 0 de 55 produtos com foto; o envio existe (`produtos-fotos`) e ninguém usou | 0 |
| Perguntas guiadas | acabamento em cartões por tipo com texto livre; 5 produtos com exigência legal | 35 |
| Medidas | quantidade, largura e altura, tamanhos prontos, prévia, aproveitamento | 70 |
| Custos do item | custo cheio e barra de composição | 55 |
| Relatórios | 10 relatórios em tabelas numa página só | 40 |
| Favoritos de produto | não tem | 0 |

Ondas F1 a F4 na tabela de estado. Dados usados: 55 produtos ativos em 8 categorias e 17 famílias, 5 acabamentos ligados a 15 produtos, 83 itens de orçamento em 90 dias usando 19 produtos. A F1 não muda o que o banco grava: `tipo_produto` e `produto_id` seguem iguais; os favoritos ficam no aparelho (`localStorage`, por e-mail), como os do menu.

## API e MCP (02/11)

O dono mandou as telas API/MCP e Integrações do Holdprint e a documentação (docs.holdworks.ai). O que eles têm: MCP hospedado com login OAuth e 10 ferramentas genéricas (descobrir entidade, descrever campos, consultar, contar, somar, buscar por id, relatório, descobrir ações, executar ação em ensaio por padrão, exemplos), API REST com `x-api-key` e 100 chamadas por minuto, skills `@holdprint/skills` que ensinam o modelo deles à LLM, e banco Mongo só de leitura liberado à mão. **O que vale para nós é o padrão** (poucas ferramentas genéricas, leitura primeiro, ação só com ensaio e confirmação), não a conexão: ligar no Holdprint só mostraria os dados de teste.

**Nota de "IA e integrações" em 02/11: 40 de 100.** Parâmetros dos produtos 55 (68 fichas, 56 produtos com processos, 6 de 15 processos com produtividade, 30 com perguntas, 0 fórmulas, 0 fotos), IA no atendimento e no orçamento 50 (Orç.IA no ar, roteiro por produto escrito para 55 e à espera de revisão, assistente do WhatsApp desligada de propósito), API e MCP 15 (não havia token nem porta pública).

**Onda 1 (#351):** token pessoal e leitura. Quem lê é a pessoa dona do token: `api_consultar` troca para `authenticated` com as claims dela e a RLS decide; a função é SECURITY INVOKER porque o Postgres não troca de papel em DEFINER. `orcamentos` e `ordens_servico` dão SELECT por coluna e `valor_total` não está liberado para `authenticated`: por isso a API não devolve valores nesta onda. A página fica fora do menu (a árvore é a aprovada no cenário B) e abre pelo botão em Dados da empresa. **Tropeço:** o prefixo `20261102120000` colidiu com a migração do #350 da outra sessão e a main ficou vermelha até o #353; com duas sessões no mesmo repositório, conferir o prefixo na `main` logo antes de abrir o PR.

**Ondas 2 e 3 (#377, #379):** o MCP fala JSON-RPC 2.0 por HTTP, sem sessão (`initialize`, `ping` e `tools/list` sem token; `tools/call` com o token pessoal em `Authorization: Bearer` ou `x-api-key`). Leitura: `bexprint_descobrir` (termo em português vira recurso), `bexprint_descrever`, `bexprint_consultar`, `bexprint_contar`, `bexprint_somar` (campo valor de contas a receber e a pagar, até 1.000 linhas, avisa se parcial) e `bexprint_exemplos`; a leitura sai pelo mesmo `lerRecurso` da API REST, com a mesma janela de 100 por minuto e a mesma RLS. Ação: `bexprint_acoes` lista e `bexprint_executar` roda em **ensaio por padrão**; só grava com `confirmado = true`, e só quando a pessoa disse que sim. `api_executar` troca para `authenticated` com as claims da pessoa dona do token, escrita barrada vira `sem_permissao` e cada chamada fica em `api_acoes`. Comando para o Claude Code: `claude mcp add --transport http bexprint https://bexprint.com.br/api/mcp --header "Authorization: Bearer SEU_TOKEN"`. `orcamentos` e `ordens_servico` têm `anon` com privilégio de tabela inteira (padrão do Supabase) e RLS sem política para visitante: conferir `pg_policies`, não o GRANT.

**Valores por nível (#385):** orçamento e OS passam a devolver `valor_total`, lido da view comercial (`orcamentos_comercial`, `ordens_servico_comercial`), só para quem vê preços: para os outros a chave NÃO vem (não é zero) e a resposta traz `ve_valores`. Também `cliente_nome` (sob a RLS de quem pede), `etapa_comercial`, o filtro `cliente_id` e a busca pelo nome do cliente. `bexprint_somar` soma orçamento e OS além das contas e recusa com `sem_valores` quando a pessoa não vê preços. Defeito de paginação corrigido: a ordenação não tinha desempate por `id`, então duas linhas com a mesma data podiam repetir ou sumir entre páginas e a soma sairia errada; custo e margem continuam fora da API. Para testar "pessoa sem preço" não há usuário só operacional no banco (todo operador e designer também é vendedor): trocar o papel dentro de um ensaio com rollback.

## O que o dono precisa decidir

1. **Menu e cliente de fora: resolvidos em 01/11.** O dono gostou do menu com o nome à vista e pediu os favoritos visíveis (#325). Tem cliente estrangeiro: o cadastro ganhou país com bandeira e nome e o WhatsApp com código do país (#324). A coluna única do Holdprint ficou de fora porque o dono aprovou o menu atual; só se ele pedir.
2. **Funil comercial vazio: resolvido em 31/10 (#315).** A marca de temporário nunca saía. Agora sai quando o lead ganha cliente, entra em atendimento, vira orçamento ou ganho. Medido: 16 leads qualificados e 11 ainda temporários, sendo 3 sem resposta e 8 descartados sem atendimento. Se o dono quiser contar também os descartados, basta mudar o filtro de `funil_comercial`.
3. **Hora por centro (Onda 9):** horas produtivas por centro (hoje 160 por máquina e 176 por pessoa; o Holdprint vem com 147 por pessoa e 110 a 588 por centro), encargo (hoje 32,19% do Simples; o Holdprint vem com 45%) e quem entra no repasse.
4. **Processos por JOB:** o Holdprint trabalha por processo de cada JOB (Revisão Comercial, Aprovação Financeira, Programação, Arte Final, Impressão, Produção, Expedição, Instalação, Entrega). Nós não temos roteiro de várias etapas por produto. Criar esse modelo só se o dono quiser; a Onda 7b e 7c funcionam por máquina sem ele.
5. **Verde-água:** a ação principal ficou `#0ebfa6` com letra `#121f3b`. A alternativa é `#087f72` com letra branca.
6. **O que o dono deixou para depois (01/11):** horas produtivas e encargo por centro (item 3), processos por JOB (item 4), se a compra paga entra sozinha no caixa (Onda 8b), os prints do PDV e o modelo e o teto de custo da IA.

## O que fazer em cada onda que falta

### Onda 2b: menu e favoritos
- **Arquivos:** `src/components/menu/menu-lateral.tsx` (trilho de ícones mais painel; item em `h-11`, 16 px), `src/components/app-sidebar.tsx`, `src/routes/_authenticated/route.tsx`. A fonte do menu continua sendo `moduleMap.ts`; só muda a apresentação.
- **Feito em 01/11 (a parte segura):** o trilho mostra o nome de cada área o tempo todo (antes só no celular e na dica do mouse) e os subgrupos do painel recolhem, com o estado lembrado neste aparelho; o subgrupo da tela atual nunca fecha.
- **Falta, se o dono quiser:** estrela de favoritos por usuário (começar por `localStorage`, depois tabela para levar entre aparelhos), grupo "Favoritos" no alto e, como alternativa maior, a coluna única do Holdprint.
- **Cuidado:** menu do parceiro é outro (`src/components/parceiro/menu-do-parceiro.tsx`); testes de menu e de permissão (`rolePermissions` é espelho em TS, não mexer sem ler a nota); celular usa gaveta.
- **Conferir:** teclado, celular, `vitest` e `tsc`, e o mesmo item para quem não tem a permissão.

### Onda 3: padrão de lista financeira
- **Feito (#316):** `src/domain/financeiro/lista-de-contas.ts` guarda a conta (situação, períodos, busca, totais em centavos) e `src/components/financeiro/lista-financeira.tsx` as peças (chips, busca, aviso de recorte, rodapé). Já aplicados na aba Contas a pagar da tela de Caixa.
- **Feito (#320):** Contas a receber com busca, chips, atalhos de período (a conta passa se alguma parcela vence no período), filtro por cliente, filtro por origem do cliente e rodapé de totais. `contas_a_receber` passou a devolver `cliente_origem`.
- **Feito (#392):** seleção por linha (caixa de 24 px, alvo de 44 px), cabeçalho que marca as que aparecem, barra com contagem e total dos selecionados por situação, Copiar resumo, Baixar CSV (Excel em português: BOM, ponto e vírgula, vírgula decimal, apóstrofo contra fórmula) e Visões: o filtro de agora guardado com nome, até 12 por tela, por pessoa, no aparelho (`bexprint:visoes:<tela>:<email>`). A seleção sobrevive à mudança de filtro e avisa as escondidas. Um teste garante que as peças novas não falam com o banco.
- **Falta:** `compras.tsx` e `materiais.tsx` com as mesmas peças; "Colunas" como no Holdprint; **dar baixa, pagar ou excluir em lote, que ficou de fora de propósito**: movimenta dinheiro registrado e pede lista e total na frente de quem confirma, então espera a decisão do dono.
- **Não copiar do Holdprint:** lista que começa no mês atual e esconde o pago; o lançamento de novembro parece "não salvo". Mostrar "mostrando outubro, 2 em novembro".
- **Conferir:** soma dos selecionados e atalhos de período com a data de hoje passada de fora (regra de teste com "hoje").

### Onda 6: WhatsApp
- **Arquivos:** `src/routes/_authenticated/whatsapp-fila-humana.tsx`, `src/components/whatsapp/lista-de-conversas.tsx`. Ações de escrita passam por `src/lib/api/whatsapp-caixa.functions.ts` (regra do `AGENTS.md`).
- **Achado em 01/11:** a caixa já tem abas de status (`AbaStatus`), filtro de setor (`FiltroDeSetor`) e busca em `lista-de-conversas.tsx`. Falta só o filtro por responsável e, se o dono quiser, etiquetas.

### Onda 7b e 7c: produção
- **7b:** tela do operador por máquina com Em breve (reserva futura), Aguardando (reserva vencida sem início), Produzindo (apontamento aberto), Finalizados, Problemas (atraso ou ocorrência), e faixa com horas, atrasados e finalizados. Base: `maquinas_agenda`, apontamentos.
- **7c:** linha do tempo por máquina com a marca do agora, em cima de `maquinas_agenda` (`agendar_os_interno` já reserva sozinho).
- **Nota:** o chaveiro de 500 unidades previu 500 minutos e o apontamento real foi de 97. Perfis de equipamento por material e espessura (produtividade em m por hora e preparo) corrigiriam isso; ver Onda 9.

### Onda 8: regras do dinheiro (com migração)
- **8a:** plano de contas em árvore e centro de custo, com rateio que precisa fechar no valor da conta (o Holdprint recusa no servidor com erro de código). Semear as contas de gráfica adaptadas (6 grupos, 58 contas).
- **8b:** compra passa a gerar as parcelas de conta a pagar pela condição escolhida. Hoje `registrar_compra_fornecedor` e `receber_pedido_compra` não tocam `contas_pagar` nem `caixa_movimentos`.
  - **Achado em 01/11, antes de mexer:** as 8 compras em `compras_fornecedor` são históricas, de julho a setembro de 2026, todas pagas e transcritas de prints do fornecedor. Nenhuma tem saída de caixa nem conta a pagar do mesmo valor. **Não fazer backfill**, porque criaria saída de caixa que nunca existiu no sistema.
  - A regra vale só para compra nova e a compra já tem os campos `pago`, `forma_pagamento` e `condicao_pagamento`. Paga entra no caixa na data da operação; a prazo gera parcelas. `contas_pagar` não tem coluna de compra, só `material_id`, `os_id` e `compromisso_id`: criar `compra_id`.
  - Decisão do dono antes de começar: a compra paga entra sozinha no caixa?
- **8c:** liquidar completo: data e conta bancária obrigatórias, motivo da diferença, comprovante, status agendado. Hoje, das 6 contas pagas, 0 têm comprovante e 3 não têm data de pagamento.
- **8d:** cartão de crédito (dia de fechar e vencer, compra parcelada caindo nas faturas, conferência por PDF) e conciliação lado a lado (hoje o extrato OFX e CSV vira movimento já conciliado e não casa com parcela).
  - **Achado em 01/11:** o extrato importado entra no caixa sem vínculo e a view soma também o pagamento do sistema, então o mesmo Pix conta duas vezes (8 casos certos, R$ 3.178,49, ver Problemas do nosso lado). A importação deve parear sozinha com pagamento ou parcela em aberto (valor exato, até 3 dias, um para um) e deixar o resto para conferência manual.
  - Existem duas contas bancárias que parecem a mesma, a segunda com o nome cortado e saldo inicial de 225 (talvez nascida da importação; não verifiquei): listar e pedir o OK do dono antes de mexer.
- **Cuidados:** prefixo de migração de 14 dígitos único (sessões paralelas colidem), ensaio com rollback, varredura em dois fusos, `REVOKE` de PUBLIC e anon em função nova, front só depois da migração.

### Onda 9: hora por centro
- Centros de custo com horas produtivas, pessoas, despesas, depreciação e repasse; a hora da máquina deixa de ser digitada. Valor da hora = (despesas + absorvido − rateado) ÷ horas produtivas. Depende da decisão 3.

### Onda 10: agenda única
- Calendário com vencimentos a pagar e a receber (`vencimentos_por_janela` já existe), entregas e reservas de máquina, cada um ligável por calendário.

## Cadastro de cliente: o que o Holdprint tem e o que ainda falta aqui

Comparado em 01/11/2026 na conta de teste do Holdprint (formulário rápido e ficha com abas).

| Holdprint | Bex Print hoje |
|---|---|
| Formulário rápido em uma tela: país, tipo de pessoa, CNPJ com lupa, nome, telefone e e-mail | Cadastro guiado em 6 passos mais o cadastro completo; a busca do CNPJ na Receita e a validação de CPF e CNPJ já existiam |
| País com bandeira; fora do Brasil some o CPF e o CNPJ | Feito (#324): país com bandeira e nome, some o CPF e o CNPJ, o WhatsApp leva o código do país. A regra do banco foi ampliada (número com + e código, fora do 55) |
| Documentos: inscrição municipal, possui inscrição estadual, inscrição estadual | Feito (#319), só para pessoa jurídica |
| Canais de contato: telefones 2 e 3, e-mail da nota, e-mail do boleto, site | Feito (#319) |
| Origem do cliente, com Cadastrar para criar origem nova | Campo feito (#319 e #321) com a lista do Leads; falta criar origem nova pela tela |
| Classificação ou grupo de cliente | Falta: `tipo_cliente` é sempre `pj` e não serve (30 de 31) |
| Endereços múltiplos (principal, entrega, cobrança) | Falta: hoje é um endereço só, em texto |
| Contatos (pessoas) | A aba Responsáveis e a tabela `cliente_contatos` existem, com 0 registros: ninguém usa |
| Matriz e filiais | Falta |
| Forma e condições de venda por cliente (opção de pagamento padrão) | Falta; a condição é escolhida em cada orçamento |
| Carteira de vendedores | Há um vendedor por cliente (`vendedor_id`) |
| Histórico com notas do cliente | Feito (#327): aba Histórico com Registrar nota e a linha do tempo |
| Arquivos do cliente (até 15 MB) | Falta |
| CEP preenche o endereço | Feito (#327) nos três cadastros, só onde está vazio; cliente de fora vê código postal livre |

**Medido no banco em 01/11/2026 (sem mostrar nenhum número de documento):** dos 31 clientes, 14 têm documento e todos passam na conferência dos dígitos (7 CPF e 7 CNPJ); 17 não têm documento (55%). Três clientes estão como pessoa jurídica com CPF: Aline, Black produções e Connecta IA, provavelmente MEI ou cadastro com o CPF do dono. Perguntar ao dono antes de trocar o tipo.

**A edição aceitava qualquer texto no documento** até o #319; agora usa o mesmo campo do cadastro, com máscara, validação e busca na Receita (que só preenche o que está vazio).

## Orçamento: o que o Holdprint tem e o que ficou

O dono esclareceu em 01/11: o orçamento do Bex Print, inclusive o fluxo 3D, já é bem estruturado. O Holdprint é só referência para melhorar; nada foi trocado.

| Holdprint | Bex Print |
|---|---|
| Painel de Negociação com colunas Rascunhos, Emitidos, Enviados, Em Negociação, Aceite Verbal | Quadro com totais (#311) e, agora, Em negociação e Aceite verbal entre Enviados e Aprovados (#326). "Emitido" não entrou: o PDF aqui sai a qualquer momento |
| Meta para aprovação (data, padrão 15 dias) | O orçamento já tem `validade_dias`; o quadro mostra "Validade: vence em N dias" e destaca até 3 dias (#326) |
| Contato obrigatório no orçamento | Já existem `contato_id` e o contato avulso; fica como possível entrega |
| Funil e etapas configuráveis | Etapa fixa, em marca à parte (`etapa_comercial`): o status não mudou |

O aviso dos orçamentos que vencem em até 3 dias (e dos que já venceram sem resposta) entrou no painel inicial em 02/11 (#343), com link para o quadro. "Renovar e reenviar" entrou no cartão do quadro em 02/11 (#346): expirado ou enviado vencido, com valor, volta a Enviado com a validade contando de novo e abre o orçamento para mandar ao cliente pelo botão de sempre; nada é enviado pelo quadro. Fica de fora, por depender do dono: contato obrigatório no orçamento (hoje 8, R$ 3.579,50).

## Plano da IA (assistente com os dados da gráfica)

**O que o Holdprint faz:** o Insider IA lê vendas, orçamentos, produção e financeiro e responde em conversa (faturamento por vendedor, margem por produto, clientes sumidos), com números reais, tabelas prontas e "análises que você não pediu" (quedas, recordes, tendências). É um recurso do plano pago.

**Para o Bex Print:** um assistente que só consulta, usando as funções do banco que a pessoa já pode chamar. Modelo de partida: o Assistente BEX do Bex Lite (ferramentas, propostas com confirmação).

**Já existe no código do Bex Print:** chamadas ao Lovable AI Gateway (`ai.gateway.lovable.dev`, chave `LOVABLE_API_KEY`) em `src/lib/api/materiais-ia.functions.ts` e `src/lib/api/flexi-importar.functions.ts`, e o assistente do WhatsApp com `OPENAI_API_KEY` em `src/lib/api/whatsapp-assistente.server.ts`. A IA-1 pode seguir o padrão do gateway, sem fornecedor novo. O custo conta nos créditos de IA do Lovable, então o teto de gasto é decisão do dono.

**Regras de segurança desde o primeiro dia**
- Sem SQL livre. Cada pergunta vira a chamada de uma ferramenta, e cada ferramenta é uma função do banco que checa a permissão de quem pergunta (como `can_see_financials`).
- Quem não vê financeiro não recebe número de dinheiro, mesmo perguntando.
- Texto de cliente e de WhatsApp é dado, nunca instrução (risco de injeção de comando).
- A resposta mostra o período e de qual função veio o número.
- Registrar pergunta e ferramenta usada, e limitar o gasto por pessoa e por dia.

**Ondas da IA**
1. **IA-0, decisões:** qual modelo e provedor, teto de custo, quem pode usar, onde fica o botão (o Holdprint usa um balão no canto).
2. **IA-1:** painel de conversa mais três ferramentas só de leitura, todas já existentes ou quase: `vencimentos_por_janela`, orçamentos por estado (a mesma conta do quadro), OS atrasadas.
3. **IA-2:** dez ferramentas (faturamento por vendedor e por período, margem por produto, clientes sem compra há N dias, estoque crítico) e um resumo diário proativo, reaproveitando os lembretes que já saem às 9h e às 12h.
4. **IA-3:** propostas com confirmação (criar tarefa, preparar cobrança); nada sai sem OK, e cobrança ao cliente segue a regra do financeiro.
- **Avaliação:** perguntas de ouro com a resposta conferida contra SQL feito à mão, rodadas a cada mudança de ferramenta.
- **Depende de:** Onda 8 (plano de contas melhora as respostas de despesa) e da decisão 2 (funil vazio daria resposta errada).

## Plano do PDV (venda de balcão)

**O que se sabe:** no menu do Holdprint, dentro de CRM, existe "PDV", ao lado de Painel de Negociação e Central de atendimento. Eu **não vi a tela**. O nome indica ponto de venda, a venda rápida de balcão.

**Antes de desenhar:** pedir ao dono prints do PDV (lista de produtos, carrinho, pagamento, recibo, abertura e fechamento de caixa) e perguntar quais vendas hoje passam pelo balcão sem orçamento.

**Hipótese de partida (a confirmar nos prints)**
- Venda rápida: escolhe o produto do catálogo, quantidade, forma de pagamento (Pix, dinheiro, cartão), emite recibo.
- Baixa de estoque na hora (o estoque só vale o que foi contado, decisão de 27/10).
- Cliente opcional; com WhatsApp cadastrado, o recibo sai pela conversa (sem envio automático sem OK).
- Caixa com abertura e fechamento por dia e por pessoa.

**Regras do Bex Print que o PDV não pode atropelar:** Pix de entrada com comprovante e "O Pix chegou"; condição de pagamento obrigatória; estorno com motivo; a OS nasce com prazo. Para venda de balcão de estoque, a OS não deveria exigir aceite da arte nem arquivo final (decisão do dono).

**Ondas do PDV:** PDV-0 prints e regras; PDV-1 venda rápida com recibo e baixa de estoque; PDV-2 caixa (abertura, fechamento, diferença); PDV-3 relatório do dia e integração com o dashboard.

## Como retomar

**Provar que o que foi publicado está no ar:** o menu e as telas de dentro moram em arquivos que a página de login não cita. Baixe `https://bexprint.com.br/login`, pegue os `/assets/*.js`, extraia deles os nomes `[A-Za-z0-9_.$-]+-[A-Za-z0-9_-]{8}\.js`, baixe todos (cerca de 350) e procure a frase nova com `grep -ao`. No zsh, use aspas simples nas expressões: o `$-` entre aspas duplas vira as opções do shell e a busca não acha nada. A rota `clientes.$id` vira `clientes._id` no nome do arquivo.

1. Ler este arquivo e o plano. Memória: notas `plano-interface-holdprint-31-10`, `dono-enxerga-mal-visual-claro-e-legivel`, `holdprint-benchmark-31-10-como-funciona`.
2. Antes de mexer: `git fetch`, partir de `origin/main`, um ramo por onda.
3. Conferir sempre: `TZ=UTC npx vitest run` e `npx tsc --noEmit` (o CI roda o mesmo). Não há `tsconfig.app.json`.
4. Letra nunca abaixo de 12 px, texto com contraste de 4,5:1 ou mais e nunca `text-primary`, `text-accent` nem o vermelho `#fd4746` como cor de letra. A guarda está em `tests/tema-claro-letra-legivel.test.ts` e `tests/accent-nao-e-cor-de-texto.test.ts`.
5. A barra lateral e o topo são azul-marinho nos dois temas (`AGENTS.md`).
6. Não vi as telas logadas do Bex Print. Depois de cada onda, pedir ao dono prints do antes e depois, ou montar o laboratório descartável (nota `laboratorio-descartavel-para-ver-a-tela`).
7. PR de cada onda: corpo em português, terminando com a linha "Generated with Claude Code"; commit terminando com o `Co-Authored-By` do modelo.

## Problemas do nosso lado que o teste achou (corrigir independente do visual)

- Funil comercial vazio: resolvido em 31/10 (#315).
- `tipo_cliente` desatualizado (18 pessoas físicas constam como jurídicas) e `cliente_contatos` com 0 registros; a ficha do cliente tem um endereço só e nenhum histórico.
- Compra no fornecedor não gera conta a pagar nem movimento de caixa (Onda 8b).
- ~~O fluxo de caixa conta o mesmo Pix duas vezes~~ **resolvido em 01/11 (#324).** `conciliar_extrato_com_pagamentos` liga a linha do extrato ao pagamento (valor exato, até 3 dias, um para um) e a importação do extrato chama sozinha. Aplicado: 9 Pix, R$ 3.197,24 a menos nas entradas (36.649,57 para 33.452,33), nenhum movimento apagado. Reversível: voltar `caixa_movimentos.pagamento_id` a nulo.
- "Resolver" ocorrência grava um status que `fechar_os` não libera (latente, hoje há 0 ocorrências).
- Um orçamento convertido em OS deixa a conta a receber sem cancelar se a OS é cancelada.
