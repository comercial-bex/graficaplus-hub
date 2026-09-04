# Dicas explicativas em todo o sistema

Objetivo: quem abre qualquer tela entende o que ela faz, para que serve cada campo e o que cada botão vai provocar — sem precisar perguntar. Tudo em português do Brasil.

## O que o usuário vai ver

1. **Menu lateral** — ao passar o mouse em qualquer item, uma frase curta: "Kanban — arraste as ordens de serviço entre as etapas da produção".
2. **Título de cada tela** — um ícone de ajuda ao lado do título. Ao passar o mouse, um texto de 1 a 3 linhas: para que serve a tela, o que fazer nela e o cuidado principal (ex.: "Financeiro — registre pagamentos e acompanhe o que está em aberto. Confirmar um pagamento gera lançamento no caixa e não pode ser desfeito sem estorno").
3. **Campos de formulário** — ícone de ajuda nos campos que geram dúvida: medidas e área, preço por m², markup, margem, custo/hora de máquina, perda, prazos, tipo de movimentação de estoque, perfil de usuário, tarifas do 3D.
4. **Botões e ícones** — explicação ao passar o mouse em cada ação: converter em OS, aprovar, baixar estoque, fechar OS, gerar link do cliente, excluir, estornar, importar extrato. Nos botões desabilitados, a dica diz **por que** está bloqueado (ex.: "Vincule um cliente cadastrado para converter em OS").

## Como fica organizado

Um único arquivo central com todos os textos (`src/lib/dicas.ts`), separado por tela: dica da tela, dicas dos campos e dicas das ações. Assim você (ou eu) altera uma frase num lugar só, e ela muda em todo o sistema.

## Ordem do trabalho

1. Base: arquivo de textos, dica no título (`SectionHeader` ganha ajuda opcional), dica no menu lateral, e um componente único de dica para botões e ícones.
2. Comercial: Orçamentos (lista e detalhe), Orçamento 3D, Leads, Clientes, WhatsApp, Automações, Respostas rápidas.
3. Produção: OS (lista e detalhe), Kanban, Entregas, Máquinas, Agenda de máquinas, Manutenção, Produção 3D, Ocorrências, Arquivos, Design.
4. Estoque e custos: Materiais, Movimentações, Produtos, Precificação, Custos de produção, Perdas, Filamentos e Impressoras 3D.
5. Financeiro: Financeiro, Fluxo de caixa, Relatórios.
6. Administração e apoio: Usuários, Configurações, Configurações da empresa, Configurações 3D, Matriz de permissões, Logs, Portal do cliente, Pós-venda, Casos de uso, Mapa do sistema, Dashboard.

## Detalhes técnicos

- Novo `src/lib/dicas.ts`: mapa por rota com `{ tela, campos, acoes }`, tipado, sem texto solto espalhado pelas telas.
- `FieldTooltip` (já existe) vira o padrão dos campos; ganha variação só-ícone para usar ao lado de rótulos já montados.
- Novo `Dica` (ícone/wrapper) para botões e ícones, usando `Tooltip` do shadcn, com `aria-label` para leitor de tela e `title` de reserva no toque.
- `TooltipProvider` passa a ser montado uma vez em `src/routes/__root.tsx` em vez de um por componente.
- `SectionHeader` ganha prop opcional `ajuda`, renderizada ao lado do título.
- `app-sidebar.tsx` lê a descrição da rota do mesmo arquivo central.
- Botões desabilitados recebem wrapper que mantém a dica ativa (elemento desabilitado não dispara hover).
- Sem mudança de banco, de regra de negócio ou de layout — só camada de apresentação.
