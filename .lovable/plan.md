## Diagnóstico atual

Hoje `/produtos` faz o mínimo:
- Tabela com apenas `nome`, `descricao`, `preco_base`, `ativo`.
- Só **criar** e **listar**. Não tem editar, desativar, duplicar, excluir, buscar nem filtrar.
- Sem categoria, unidade de venda, custo, margem ou markup.
- Sem distinção entre **produto** (lona, adesivo) e **serviço** (instalação, corte especial).
- Não conversa com `/orcamentos`, `/os`, `/materiais` nem `/precificacao` — o vendedor digita tudo na mão a cada OS.
- Catálogo começa vazio: zero produtos pré-cadastrados para uma gráfica padrão.

## Benchmark (Printavo, PrintLogic, MyPrintShop, Shopfloor, Tiny ERP gráfico)

O que o segmento entrega e vamos trazer:
- **Catálogo por categoria** (Impressão grande formato, Adesivos, Comunicação visual, Brindes, Acabamento, Serviços).
- **Unidade de venda** clara: m², unidade, metro linear, hora, peça.
- **Custo médio + preço de venda + margem/markup** calculados ao vivo no cadastro.
- **SKU / código interno** para busca rápida e integração com orçamento.
- **Variações** simples (ex.: lona 280g / 380g / 440g) via campo opcional.
- **Tempo estimado de produção** (min/m² ou min/unidade) para o Kanban estimar prazo.
- **Materiais consumidos** por produto (link opcional com `materiais`) — base para baixa de estoque automática quando a OS fecha.
- **Importação por CSV** e **exportação**.
- **Catálogo pré-semeado** para gráfica brasileira já sair com produtos comuns ativos.

## Mudanças no banco

Estender `produtos` (não quebra o que existe — só adiciona colunas nullable + default):

| Coluna | Tipo | Para que serve |
|---|---|---|
| `sku` | text único | Código curto para busca e referência em OS |
| `categoria` | enum (`impressao_grande_formato`, `adesivos`, `comunicacao_visual`, `brindes`, `acabamento`, `instalacao`, `servico`, `outros`) | Filtro e organização |
| `tipo` | enum (`produto`, `servico`) | Diferenciar item físico de serviço |
| `unidade` | text | `m2`, `un`, `m`, `hora`, `peca` |
| `custo_medio` | numeric | Custo de produção (visível só para financeiro/gestor) |
| `preco_base` | numeric (já existe) | Preço de tabela |
| `margem_minima` | numeric | % mínima aceitável (alerta no orçamento se vendedor descer abaixo) |
| `tempo_producao_min` | integer | Minutos por unidade/m² — alimenta agenda de máquina |
| `imagem_url` | text | Miniatura do produto |
| `observacoes_internas` | text | Notas técnicas (gramatura, tinta, fornecedor) |
| `updated_at` | timestamptz | Auditoria |

RLS já existe (`prod admin write` + `prod staff read`) — mantém. Vendedor continua vendo catálogo, só admin/gestor edita custo/margem.

## Mudanças no módulo /produtos

### CRUD completo
- **Editar** inline via Dialog (mesmo form do cadastro, pré-preenchido).
- **Duplicar** produto (acelera criar variações).
- **Ativar/desativar** com toggle (não deletar — mantém histórico em OS antigas).
- **Excluir** só para admin, com confirmação, e só se nunca usado em OS.

### Cadastro inteligente
- Form em 3 blocos: **Identificação** (nome, SKU, categoria, tipo, unidade) / **Comercial** (custo, preço, margem mínima — bloqueado para quem não vê financeiro) / **Produção** (tempo estimado, observações técnicas, imagem).
- **Calculadora ao vivo** dentro do form: ao digitar custo + preço mostra margem % e markup, com aviso visual quando margem < margem mínima.
- Link "Abrir na calculadora de precificação" leva para `/precificacao` pré-preenchida.

### Listagem profissional
- Busca por nome/SKU.
- Filtros por categoria, tipo, status ativo/inativo.
- Colunas: imagem mini, nome+SKU, categoria, unidade, custo (financeiro), preço, margem com semáforo (verde ≥ margem mínima, amarelo perto, vermelho abaixo), status, ações.
- Ordenação por margem, preço, nome.
- Visão alternativa em **grid de cards** (toggle), útil pro vendedor mostrar para cliente.

### Importação / exportação
- Botão **Importar CSV** com modelo baixável (colunas: sku, nome, categoria, tipo, unidade, custo, preco, margem_minima, tempo_min).
- Botão **Exportar CSV** do catálogo atual.
- Validação linha a linha com relatório de erros antes de gravar.

### Catálogo pré-semeado (uma vez, via migration)
Inserir ~25 produtos comuns para gráfica já ativos, prontos para editar:
- Impressão grande formato: Banner lona 280g, 380g, 440g; Adesivo vinil brilho, fosco; Adesivo perfurado; Lona backlight; Tecido sublimação.
- Adesivos / recorte: Recorte eletrônico em vinil; Adesivo de parede; Adesivo de chão antiderrapante; Etiqueta vinil branco.
- Comunicação visual: Placa ACM 3mm; Fachada com letra caixa; Totem; Painel PS.
- Brindes/offset: Cartão de visita 4x4 300g; Folder A4 4x4; Flyer A5; Pasta com bolso.
- Acabamento: Laminação BOPP brilho; Ilhós; Bastão de madeira para banner; Aplicação em parede.
- Serviços: Criação de arte; Instalação local; Projeto / medição em obra; Taxa de urgência.

Todos com unidade, categoria, tipo e tempo estimado padrão. Custo/preço ficam zerados para a gráfica preencher conforme realidade.

## Integração com outros módulos

- **/orcamentos** e **/os**: ao adicionar item, autocomplete buscando no catálogo (nome/SKU) preenche descrição, unidade, valor e custo unitário automaticamente. Mantém edição manual.
- **/precificacao**: botão "Salvar como produto" no resultado da calculadora cria entrada no catálogo já com custo composto e margem.
- **/materiais**: campo opcional "materiais consumidos por unidade" no produto — base futura para baixa automática de estoque ao concluir OS (apenas estrutura agora, baixa em iteração posterior).
- **/dashboard**: card "Top produtos vendidos no mês" e "Produto com pior margem média" (já tem dado em OS).

## Permissões e segurança

- `custo_medio`, `margem_minima` e coluna "Margem" só aparecem se `canSeeFinancials`.
- Vendedor vê preço base, categoria, unidade e tempo de produção.
- Exclusão definitiva só admin; demais usam desativar.
- Importação CSV: limite 500 linhas por arquivo, validação Zod por linha.

## Entrega proposta em duas ondas

**Onda 1 (esta tarefa):** migration de schema + seed do catálogo + nova UI completa (CRUD, busca, filtros, importação CSV, calculadora de margem no form, semáforo de margem). Integração com orçamento/OS via autocomplete.

**Onda 2 (próxima, se aprovado):** baixa automática de estoque via `materiais_consumidos`, relatório de produtos mais vendidos no dashboard, exportação avançada com filtros.

Posso seguir com a Onda 1 inteira?
