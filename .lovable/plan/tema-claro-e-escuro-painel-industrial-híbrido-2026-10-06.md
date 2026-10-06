# Tema claro e escuro — painel industrial híbrido

Aplicar a direção escolhida **Hybrid Industrial Dashboard** ao conteúdo do sistema, mantendo a estrutura e o visual escuro do menu lateral. A fonte será Montserrat em toda a interface. O usuário poderá alternar entre claro e escuro, e a escolha permanecerá salva no dispositivo.

## Diagnóstico confirmado

- O sistema hoje usa os mesmos valores escuros em `:root` e `.dark`; portanto, ainda não existe um tema claro real.
- Não há seletor nem controle global de tema.
- O menu lateral já usa tokens próprios, o que permite mantê-lo escuro sem alterar seus grupos, links ou comportamento.
- A central de ajuda cobre 47 das 54 áreas exibidas no menu. Faltam explicações para Avisos, Funil, Custo por peça 3D, Produtividade 3D, TVs da oficina, Planilha de custos e Compromissos.
- Existem usos pontuais de cores fixas nas telas. Eles precisam ser convertidos para papéis semânticos para contraste correto nos dois temas.
- Os componentes compartilhados de cabeçalho, indicadores, painéis de dados, status e dicas já são uma boa base e serão aperfeiçoados, não substituídos.

## Referência de produto

A revisão seguirá práticas consolidadas em sistemas de gestão de gráfica e operação, como Printavo, shopVOX, OnPrintShop e Odoo:

- **Leitura operacional rápida:** indicador → pendência → ação → detalhe.
- **Densidade controlada:** tabelas compactas, filtros persistentes e informações secundárias sob demanda.
- **Estados inequívocos:** cor nunca será o único sinal; cada status terá texto, ícone ou descrição.
- **Ajuda contextual:** explicação perto da decisão, não documentação solta.
- **Divulgação progressiva:** custo, margem, regras e bloqueios aparecem quando são relevantes ao papel do usuário.
- **Consistência:** a mesma ação, status ou dado terá a mesma aparência em Dashboard, OS, Orçamentos e Kanban.

## O que será alterado

### 1. Sistema de temas

- Criar tokens completos para os dois temas em `src/styles.css`.
- **Tema claro:** fundo técnico `#F7F9FC`, superfícies `#FFFFFF`, texto `#20242D`, ciano `#00A9C6` e magenta `#E32686`, com amarelo reservado para atenção.
- **Tema escuro:** preservar a identidade grafite/CMYK atual, ajustando apenas contraste e hierarquia.
- Manter Montserrat para títulos, texto, formulários e tabelas; JetBrains Mono apenas para códigos e identificadores técnicos.
- Criar estados semânticos consistentes: sucesso, atenção, erro, informação, selecionado, desabilitado e foco.
- Remover dependências visuais de cores fixas nas áreas compartilhadas e nas telas prioritárias.

### 2. Alternância claro/escuro

- Adicionar um controle por ícone no cabeçalho superior, com dica “Usar tema claro/escuro”.
- Salvar a preferência no dispositivo e respeitar a preferência do sistema na primeira visita.
- Aplicar o tema antes da primeira pintura para evitar tela piscando ou trocando de cor ao abrir.
- Atualizar a cor da barra do navegador conforme o tema.
- Manter o menu lateral permanentemente escuro nos dois modos, sem alterar sua organização, rótulos, permissões ou atalhos.

### 3. Estrutura visual escolhida

- Cabeçalho superior claro/escuro com título da área, contexto e ações alinhadas.
- Indicadores compactos, com hierarquia numérica forte e sem efeitos decorativos excessivos.
- Painéis e tabelas como foco principal: bordas discretas, separação clara, linhas densas e realce de interação.
- Formulários com grupos lógicos, rótulos consistentes, campos obrigatórios claros e mensagens próximas do campo.
- Modais, menus, calendários, seletores, notificações, carregamentos, estados vazios e erros compatíveis com ambos os temas.
- Transições curtas e discretas, respeitando redução de movimento.

### 4. Componentes compartilhados

Aprimorar primeiro os componentes que propagam a mudança pelo sistema:

- `SectionHeader`: hierarquia da tela, caminho, descrição e ações.
- `KpiCard`: contraste, densidade, variação, ícone e dica opcional.
- `DataPanel`: busca, filtros, contagem, estado vazio e rolagem móvel.
- `StatusChip`: mapa único de estados e contraste nos dois temas.
- Botões, campos, tabelas, cartões, diálogos, menus, popovers, tooltips e notificações.
- `BexBackground`: retirar brilhos fixos e garantir fundo adequado a cada tema.

### 5. Dicas e orientação contextual

- Completar as sete áreas sem texto de ajuda.
- Revisar os textos existentes para sempre responder, quando aplicável: **o que é**, **de onde vem**, **o que altera** e **por que pode estar bloqueado**.
- Padronizar dicas de:
  - títulos e indicadores;
  - campos com cálculo, unidade ou impacto em preço/estoque;
  - ações destrutivas ou irreversíveis;
  - botões desabilitados;
  - status, siglas e indicadores financeiros;
  - importações, exportações e integrações.
- Desktop: abrir ao passar/focar; celular: abrir por toque sem acionar o elemento abaixo.
- Melhorar largura, contraste, seta, espaçamento e tempo de abertura das dicas.
- Evitar excesso: não adicionar tooltip a textos ou ícones universalmente óbvios.

### 6. Aplicação por prioridade

1. Base global e controle de tema.
2. Cabeçalho autenticado e componentes compartilhados.
3. Dashboard, Orçamentos, Ordens de Serviço e Kanban, garantindo identidade única.
4. Listas operacionais, financeiro, estoque, produção 3D e telas administrativas.
5. Formulários e detalhes extensos, incluindo orçamento e OS.
6. Login, cadastro, portais e páginas públicas, sem forçar o menu lateral onde ele não existe.

## Validação

- Conferir temas claro e escuro em desktop e celular.
- Confirmar que o menu lateral continua escuro, legível e funcional em ambos.
- Testar persistência do tema após recarregar e abrir nova página.
- Verificar contraste de texto, foco por teclado, campos desabilitados e estados de erro.
- Percorrer Dashboard → Orçamento → OS → Kanban nos dois temas.
- Conferir tooltips com mouse, teclado e toque.
- Garantir ausência de sobreposição, corte de texto e regressão nas tabelas.
- Executar verificação de tipos, testes relevantes e confirmar compilação sem erros.

## Limites

- Nenhuma mudança no banco, permissões, cálculos, rotas ou regras de negócio.
- Nenhuma reorganização do menu lateral.
- Nenhuma remoção de função que já serve ao fluxo atual.
