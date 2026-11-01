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
| 2b | Menu em coluna única com grupos e favoritos | Falta |
| 3 | Padrão de lista financeira (chips, período com atalhos, Ações em lote, rodapé de totais) | Falta |
| 6 | Filtros do WhatsApp ao lado da conversa | Falta |
| 7b, 7c | Tela do operador por máquina e linha do tempo | Falta |
| 8 | Regras do dinheiro: plano de contas, centro de custo, compra que gera conta a pagar, liquidar completo | Falta |
| 9 | Hora por centro de custo | Falta, depende de decisão |
| 10 | Agenda única | Falta |
| IA | Assistente que responde com os dados da gráfica | Plano abaixo |
| PDV | Venda de balcão | Plano abaixo, depende de prints |

**Publicação:** nada foi publicado no site. As ondas mescladas estão na `main`; o Publish (`deploy_project` do Lovable) só sai com o OK do dono. Ordem de sempre: migração aplicada antes do front (a da Onda 4 já está), esperar o Lovable sincronizar o commit da `main`, publicar, conferir o bundle novo.

## O que o dono precisa decidir

1. **Menu:** coluna única como a do Holdprint (recomendado) ou manter o trilho de ícones. Define a Onda 2b.
2. **Funil comercial vazio:** `funil_comercial` exclui `temporario=true` e 26 de 26 leads estão marcados. Incluir os temporários ou limpar a marca na conversão. Hoje o funil mostra zero.
3. **Hora por centro (Onda 9):** horas produtivas por centro (hoje 160 por máquina e 176 por pessoa; o Holdprint vem com 147 por pessoa e 110 a 588 por centro), encargo (hoje 32,19% do Simples; o Holdprint vem com 45%) e quem entra no repasse.
4. **Processos por JOB:** o Holdprint trabalha por processo de cada JOB (Revisão Comercial, Aprovação Financeira, Programação, Arte Final, Impressão, Produção, Expedição, Instalação, Entrega). Nós não temos roteiro de várias etapas por produto. Criar esse modelo só se o dono quiser; a Onda 7b e 7c funcionam por máquina sem ele.
5. **Verde-água:** a ação principal ficou `#0ebfa6` com letra `#121f3b`. A alternativa é `#087f72` com letra branca.

## O que fazer em cada onda que falta

### Onda 2b: menu e favoritos
- **Arquivos:** `src/components/menu/menu-lateral.tsx` (trilho de ícones mais painel; item em `h-11`, 16 px), `src/components/app-sidebar.tsx`, `src/routes/_authenticated/route.tsx`. A fonte do menu continua sendo `moduleMap.ts`; só muda a apresentação.
- **Fazer:** grupos recolhíveis em coluna única, estrela de favoritos por usuário (começar por `localStorage`, depois tabela se o dono quiser levar entre aparelhos), grupo "Favoritos" no alto.
- **Cuidado:** menu do parceiro é outro (`src/components/parceiro/menu-do-parceiro.tsx`); testes de menu e de permissão (`rolePermissions` é espelho em TS, não mexer sem ler a nota); celular usa gaveta.
- **Conferir:** teclado, celular, `vitest` e `tsc`, e o mesmo item para quem não tem a permissão.

### Onda 3: padrão de lista financeira
- **Fazer:** componente de lista com busca, botão Filtrar, menu Ações em lote, chips de filtro, período com atalhos (Hoje, Esta semana, Este mês, Mês passado, Próximo mês, Este ano) e rodapé de totais (pagas, a pagar, vencidas, total, selecionadas). Aplicar em `a-receber.tsx` (hoje são cartões por conta com parcelas) e `fluxo-caixa.tsx`; depois `compras.tsx`, `materiais.tsx`, `clientes.index.tsx`.
- **Não copiar do Holdprint:** lista que começa no mês atual e esconde o pago; o lançamento de novembro parece "não salvo". Mostrar "mostrando outubro, 2 em novembro".
- **Conferir:** soma dos selecionados e atalhos de período com a data de hoje passada de fora (regra de teste com "hoje").

### Onda 6: WhatsApp
- **Arquivos:** `src/routes/_authenticated/whatsapp-fila-humana.tsx`, `src/components/whatsapp/lista-de-conversas.tsx`. Ações de escrita passam por `src/lib/api/whatsapp-caixa.functions.ts` (regra do `AGENTS.md`).
- **Fazer:** chips Tudo, Agente e Status ao lado da conversa; Tag só se o dono quiser etiquetas.

### Onda 7b e 7c: produção
- **7b:** tela do operador por máquina com Em breve (reserva futura), Aguardando (reserva vencida sem início), Produzindo (apontamento aberto), Finalizados, Problemas (atraso ou ocorrência), e faixa com horas, atrasados e finalizados. Base: `maquinas_agenda`, apontamentos.
- **7c:** linha do tempo por máquina com a marca do agora, em cima de `maquinas_agenda` (`agendar_os_interno` já reserva sozinho).
- **Nota:** o chaveiro de 500 unidades previu 500 minutos e o apontamento real foi de 97. Perfis de equipamento por material e espessura (produtividade em m por hora e preparo) corrigiriam isso; ver Onda 9.

### Onda 8: regras do dinheiro (com migração)
- **8a:** plano de contas em árvore e centro de custo, com rateio que precisa fechar no valor da conta (o Holdprint recusa no servidor com erro de código). Semear as contas de gráfica adaptadas (6 grupos, 58 contas).
- **8b:** compra passa a gerar as parcelas de conta a pagar pela condição escolhida. Hoje `registrar_compra_fornecedor` e `receber_pedido_compra` não tocam `contas_pagar` nem `caixa_movimentos`.
- **8c:** liquidar completo: data e conta bancária obrigatórias, motivo da diferença, comprovante, status agendado. Hoje, das 6 contas pagas, 0 têm comprovante e 3 não têm data de pagamento.
- **8d:** cartão de crédito (dia de fechar e vencer, compra parcelada caindo nas faturas, conferência por PDF) e conciliação lado a lado (hoje o extrato OFX e CSV vira movimento já conciliado e não casa com parcela).
- **Cuidados:** prefixo de migração de 14 dígitos único (sessões paralelas colidem), ensaio com rollback, varredura em dois fusos, `REVOKE` de PUBLIC e anon em função nova, front só depois da migração.

### Onda 9: hora por centro
- Centros de custo com horas produtivas, pessoas, despesas, depreciação e repasse; a hora da máquina deixa de ser digitada. Valor da hora = (despesas + absorvido − rateado) ÷ horas produtivas. Depende da decisão 3.

### Onda 10: agenda única
- Calendário com vencimentos a pagar e a receber (`vencimentos_por_janela` já existe), entregas e reservas de máquina, cada um ligável por calendário.

## Plano da IA (assistente com os dados da gráfica)

**O que o Holdprint faz:** o Insider IA lê vendas, orçamentos, produção e financeiro e responde em conversa (faturamento por vendedor, margem por produto, clientes sumidos), com números reais, tabelas prontas e "análises que você não pediu" (quedas, recordes, tendências). É um recurso do plano pago.

**Para o Bex Print:** um assistente que só consulta, usando as funções do banco que a pessoa já pode chamar. Modelo de partida: o Assistente BEX do Bex Lite (ferramentas, propostas com confirmação).

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

1. Ler este arquivo e o plano. Memória: notas `plano-interface-holdprint-31-10`, `dono-enxerga-mal-visual-claro-e-legivel`, `holdprint-benchmark-31-10-como-funciona`.
2. Antes de mexer: `git fetch`, partir de `origin/main`, um ramo por onda.
3. Conferir sempre: `TZ=UTC npx vitest run` e `npx tsc --noEmit` (o CI roda o mesmo). Não há `tsconfig.app.json`.
4. Letra nunca abaixo de 12 px, texto com contraste de 4,5:1 ou mais e nunca `text-primary`, `text-accent` nem o vermelho `#fd4746` como cor de letra. A guarda está em `tests/tema-claro-letra-legivel.test.ts` e `tests/accent-nao-e-cor-de-texto.test.ts`.
5. A barra lateral e o topo são azul-marinho nos dois temas (`AGENTS.md`).
6. Não vi as telas logadas do Bex Print. Depois de cada onda, pedir ao dono prints do antes e depois, ou montar o laboratório descartável (nota `laboratorio-descartavel-para-ver-a-tela`).
7. PR de cada onda: corpo em português, terminando com a linha "Generated with Claude Code"; commit terminando com o `Co-Authored-By` do modelo.

## Problemas do nosso lado que o teste achou (corrigir independente do visual)

- Funil comercial vazio (decisão 2).
- `tipo_cliente` desatualizado (18 pessoas físicas constam como jurídicas) e `cliente_contatos` com 0 registros; a ficha do cliente tem um endereço só e nenhum histórico.
- Compra no fornecedor não gera conta a pagar nem movimento de caixa (Onda 8b).
- `vw_fluxo_caixa` pode contar o mesmo Pix duas vezes nas entradas.
- "Resolver" ocorrência grava um status que `fechar_os` não libera (latente, hoje há 0 ocorrências).
- Um orçamento convertido em OS deixa a conta a receber sem cancelar se a OS é cancelada.
