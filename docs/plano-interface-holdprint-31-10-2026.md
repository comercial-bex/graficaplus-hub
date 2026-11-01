# Plano: interface e regras do Holdprint no Bex Print

31/10/2026. Feito a partir de 20 capturas que o dono enviou (guardadas fora do git, em `docs/referencias/holdprint-31-10/` na máquina do dono), do teste que fiz na conta de 7 dias do Holdprint e da leitura do nosso código e banco.

**Estado das ondas (atualizado ao fim de 31/10/2026):** as Ondas 1, 2, 4, 5 e 7a estão na `main` (#309 a #313). Nada foi publicado no site. O que falta, a ordem, as decisões do dono e os planos da IA e do PDV estão em [proximos-passos-interface-holdprint.md](proximos-passos-interface-holdprint.md); comece por lá.

## Objetivo principal

Quem usa o Bex Print o dia todo, inclusive o dono, que enxerga mal, abre qualquer tela e lê tudo sem esforço: menu azul-marinho com letra grande, fundo cinza-azulado, cartões brancos e botões legíveis. As telas do dia a dia seguem o mesmo desenho, e as regras de dinheiro e compra que hoje faltam entram em ondas pequenas, cada uma publicada e conferida antes da próxima.

## Fase 0: o que foi descoberto (fatos, com a fonte)

### Cores e letra, lado a lado

| Item | Holdprint (cores lidas nas capturas) | Bex Print hoje (lido em `src/styles.css` e nos componentes) |
|---|---|---|
| Menu lateral | `#212e57` azul-marinho; item ativo em pílula `#215168` | `#12131a` quase preto; trilho de ícones ciano mais painel |
| Barra do topo | `#121f3b` com sino e avatar menta | `h-14`, fundo do cartão com desfoque, tema claro |
| Fundo do conteúdo | `#f2f4f7`, cartões brancos com sombra suave | `#f7f9fc`, quase branco: o cartão branco mal se destaca |
| Botão principal | verde-água `#0ebfa6` com letra branca | ciano `#00a9c6` (branco sobre ele dá 2,8:1) |
| Tamanho da letra do menu | em torno de 16 px (estimado pelas capturas) | `text-[13px]` em `src/components/menu/menu-lateral.tsx` |
| Letra pequena no sistema | não medi | `text-xs` 1.116 usos, `text-[10px]` 165, `text-[11px]` 171, `text-base` só 150 |
| Cabeçalho da página | título grande e trilha "Home / Financeiro / Contas a pagar" | `SectionHeader`: título e descrição, sem trilha |
| Fonte | não medi | Montserrat (`--font-sans`) |

### Contraste (calculado)

| Combinação | Razão | Passa 4,5:1 |
|---|---|---|
| Branco sobre o verde do botão deles `#0ebfa6` | 2,3 | não |
| Azul-marinho `#121f3b` sobre `#0ebfa6` | 7,0 | sim |
| Branco sobre o vermelho do selo deles `#fd4746` | 3,4 | não |
| Branco sobre `#d62839` (vermelho mais escuro) | 5,0 | sim |
| Branco sobre o azul deles `#307ae7` | 4,1 | não |
| Branco sobre `#2563c9` | 5,7 | sim |
| Branco sobre o menu `#212e57` | 13,2 | sim |
| Cinza `#6b7280` sobre o fundo `#f2f4f7` | 4,4 | não |
| Cinza `#4b5563` sobre o fundo `#f2f4f7` | 6,9 | sim |

O visual deles lê bem principalmente por tamanho, espaço e o menu escuro com letra branca. O que não passa (letra branca no verde-água e no vermelho claro) a gente corrige sem mudar o tom.

### Paleta proposta (mantém os tons que o dono gostou)

| Papel | Valor |
|---|---|
| Menu lateral | `#212e57`, letra branca |
| Item ativo do menu | `#215168` |
| Barra do topo | `#121f3b` |
| Fundo da tela | `#f2f4f7` |
| Cartão | `#ffffff`, canto de 12 px, sombra suave |
| Ação principal | `#0ebfa6` com letra `#121f3b` (alternativa: `#087f72` com letra branca, 4,9:1) |
| Texto secundário | `#4b5563` |
| Perigo | `#d62839` com letra branca |
| Ação secundária azul | `#2563c9` com letra branca |
| Faixa por etapa da produção | `#071a25`, `#b5bd30`, `#a090e7`, `#d03ea9`, só como faixa fina no topo da coluna, nunca como letra |
| Marca | ciano `#00a9c6` fica no logo e no foco do teclado |

### Escala de letra proposta (decisão de acessibilidade, não medida do Holdprint)

Corpo 16 px, menu 16 px, tabela 15 px, rótulo mínimo 14 px, valor de cartão 30 px, título de página 24 px. Nada abaixo de 12 px. Alvo de clique de 44 px (o menu já tem `h-11`).

### O que existe no Bex Print (arquivos conferidos)

- Casca: `src/routes/_authenticated/route.tsx` (cabeçalho `h-14`), menu em `src/components/menu/menu-lateral.tsx` (itens `h-11`, trilho de ícones mais painel), `src/components/app-sidebar.tsx`, `src/components/ui/sidebar.tsx`.
- Peças prontas: `src/components/bex/` com `SectionHeader`, `KpiCard`, `StatusChip`, `DataPanel`, `Dica`, `ThemeToggle`.
- Tema claro e escuro já existem (`:root` e `.dark` em `src/styles.css`). Tailwind lê os tokens de lá.
- Guarda de contraste que já existe: `tests/accent-nao-e-cor-de-texto.test.ts`.
- O menu vivo é `moduleMap.ts`. O CI só roda `tsc --noEmit` e `vitest run`.
- Ainda não vi as telas do Bex Print logado. Para comparar lado a lado: o dono manda prints das mesmas telas, ou eu monto o laboratório descartável com dados falsos (nota `laboratorio-descartavel-para-ver-a-tela`).

## Mapa tela a tela: o que temos e o que falta

| Tela no Holdprint | Equivalente no Bex Print | Já temos | Falta |
|---|---|---|---|
| Visão Geral | `dashboard.tsx` | recebido, a receber, atrasado, faturamento, lucro, ticket médio | janelas Hoje, Amanhã, Semana, Mês de a receber e a pagar; saldo das contas; selo de período em cada cartão; ícone de ajuda nos títulos |
| Ponto de Equilíbrio | `meta.tsx` | página de ponto de equilíbrio | contribuição marginal, custo fixo vindo dos centros de custo, ranking ABC por cliente e vendedor |
| Painel de Negociação | `orcamentos.index.tsx` e `funil.tsx` | lista de orçamentos; funil calculado | quadro com total em R$ e contagem por coluna, alternância lista e quadro; o funil hoje está vazio (26 de 26 leads marcados como temporários) |
| Central de atendimento (Hold.One: a caixa de entrada de WhatsApp deles, com lista de conversas ao lado da conversa) | `whatsapp.tsx`, `whatsapp-fila-humana.tsx` | 4 filas, assumir, transferir, resolver com motivo | chips Tudo, Agente, Status (e Tag, se criarmos etiqueta) e lista ao lado da conversa |
| Acompanhamento e JOBs | `kanban.tsx`, `os.index.tsx` | quadro de 6 colunas com travas | total em R$ e contagem por coluna, alternância lista e quadro, filtro por período |
| Terminal de Produção | apontamento da OS, `maquinas-agenda.tsx`, `capacidade.tsx` | apontamento por máquina, reservas | tela do operador com Em breve, Aguardando, Produzindo, Finalizados, Problemas e faixa de horas, atrasados e finalizados |
| Gerenciamento e Planejamento | `maquinas-agenda.tsx`, `conflitos-agenda.tsx` | reserva automática de máquina | linha do tempo por máquina ou etapa com a marca do "agora" |
| Contas a pagar | `fluxo-caixa.tsx` | conta avulsa, compromissos, pagar | plano de contas, centro de custo com rateio, competência, documento, origem, status completos, liquidar com motivo da diferença e conta bancária, recibo, duplicar |
| Contas a receber | `a-receber.tsx` | baixa parcial, estorno com motivo | categoria da receita, origem, filtros em chips e rodapé de totais |
| Cartão de Crédito | não existe | nada | cartão com dia de fechar e vencer, compra parcelada caindo nas faturas, conferência por PDF |
| Conciliação Bancária | `movimentacoes.tsx`, `contas-bancarias.tsx` | importa extrato OFX e CSV | tela lado a lado que sugere o par entre extrato e parcela |
| Matéria Prima e Pedidos de compra | `materiais.tsx`, `compras.tsx` | lotes, custo médio, saldo só por função do banco | pedido com autorização, prazos prontos, prévia das parcelas e conta a pagar gerada |
| Agenda | sem calendário único | reservas de máquina, entregas | calendário com vencimentos a pagar e a receber, entregas e reservas ligáveis por calendário |
| Favoritos (estrela no menu) | não existe | nada | fixar telas por usuário |
| Insider AI, PDV | fora do plano agora | | PDV deve ser venda de balcão, ainda não vi a tela |

## Regras de negócio do Holdprint que vale trazer (vistas no teste)

- **Pedido de compra:** o rascunho nasce ao inserir o primeiro item; solicitar, aguardar autorização, autorizar (irreversível, com confirmação), enviar, confirmado pelo fornecedor, informar entrada; 10 status; prazos de pagamento prontos (7/14, 30/60/90, à vista mais 28 dias) e prévia das parcelas; frete com pagamento próprio. Não consegui concluir a entrada no teste.
- **Conta a pagar:** valor, vencimento e meio são obrigatórios; plano de contas em árvore (6 grupos, 58 contas de gráfica); rateio por centro de custo que precisa fechar no valor, e o servidor recusa com erro de código (`HOLD_EXPENSE_2`); competência; documento; origem (criação manual, pedido de compra, comissões, terceirizações, despesa fixa, fatura de cartão, transporte do pedido). Liquidar pede valor pago, data, motivo da diferença, meio, conta bancária e aceita juros, multa, desconto e retenção.
- **Custo da hora:** cada centro de custo soma despesas do mês, pessoas (horas por mês, salário, encargo padrão de 45%) e depreciação, divide pelas horas produtivas e devolve o valor da hora. Um centro pode repassar uma parte das suas despesas aos outros.
- **Custo fixo no resultado:** a soma dos centros (R$ 21.867,19 no teste) virou o "custo fixo" do Ponto de Equilíbrio e baixou o lucro do mês.
- **Cliente:** um campo obrigatório (nome), salvar e cadastrar novo, ficha em abas (identificação, endereços, gerenciamento, estatísticas, histórico, arquivos, documentos).
- **JOB:** etapas visíveis no quadro: Revisão Comercial, Aprovação Financeira, Programação, Arte Final, Impressão, Produção, e na linha do tempo também Expedição, Instalação e Entrega. A Aprovação Financeira é uma etapa explícita antes de produzir.
- **Ainda não vimos:** um orçamento aprovado virando JOB e um processo rodando no terminal. Para fechar a regra de produção precisamos de prints disso.

### O que não copiar do Holdprint

- Letra branca sobre o verde-água e o vermelho claro (contraste baixo).
- Percentual de lucro que explode quando as vendas são zero (R$ -21.867,19 e -2.186.719%): trocar por "sem vendas no mês".
- Lista que começa no mês atual e esconde o pago: o lançamento de novembro parece "não salvo". Avisar "mostrando outubro, 2 em novembro".
- Confirmação "Você tem certeza?" sem dizer o que vai acontecer.
- Em janela estreita o menu cobre o conteúdo e a tabela escapa da tela.

## Ondas de implementação

Cada onda termina com `tsc --noEmit` e `vitest run` verdes, rodando em UTC, e com prints do dono antes e depois. Migração do banco entra antes do Publish do front.

### Onda 1: cores e letra (só tokens)

Como serve ao objetivo: é o que o dono notou primeiro e muda o sistema inteiro com pouco risco.

- **Fazer:** em `src/styles.css`, trocar os tokens do tema claro pela paleta proposta (menu e topo azul-marinho, fundo `#f2f4f7`); subir `--text-xs` e `--text-sm` (um ajuste em todos os `text-xs` e `text-sm`); trocar os 336 usos de `text-[10px]` e `text-[11px]` por `text-xs`; menu de 13 px para 16 px. Tema escuro fica como está.
- **Conferir:** estender a guarda de contraste para os pares da tabela acima (todos de texto em 4,5:1 ou mais); `grep` por `text-accent` e `border-accent` sem `-foreground` (regra do projeto).
- **Não fazer:** usar o vermelho `#fd4746` ou o verde `#0ebfa6` como cor de letra sobre branco.

### Onda 2: casca (menu, topo, cabeçalho de página)

Como serve ao objetivo: dá a mesma moldura a todas as telas e traz o favorito, que o dono já usou no Holdprint.

- **Fazer:** menu em coluna única com grupos recolhíveis, ícone e rótulo de 16 px, pílula `#215168` no item ativo, estrela de favoritos por usuário; topo azul-marinho com sino e avatar; componente `PageHeader` (trilha, título e resumo na mesma linha, como "Painel de Negociação | R$ 0,00 em 0 Negócios") feito em cima do `SectionHeader`.
- **Fonte do menu continua `moduleMap.ts`.** Só muda a apresentação.
- **Decisão do dono:** coluna única como a deles (recomendado) ou manter o trilho de ícones.
- **Conferir:** testes de menu e permissão verdes; navegação por teclado; celular com gaveta.

### Onda 3: padrão de lista financeira

Como serve ao objetivo: o dinheiro é onde mais se olha lista; o padrão deles é fácil de ler.

- **Fazer:** componente de lista com busca, botão Filtrar, menu Ações em lote, linha de chips de filtro, período com atalhos (Hoje, Esta semana, Este mês, Mês passado, Próximo mês, Este ano) e rodapé de totais (pagas, a pagar, vencidas, total, selecionadas). Aplicar em `a-receber.tsx` e `fluxo-caixa.tsx`; depois `compras.tsx`, `materiais.tsx`, `clientes.index.tsx`.
- **Conferir:** teste da soma dos selecionados e dos atalhos de período, passando a data de hoje como parâmetro (regra de teste com "hoje").

### Onda 4: Visão Geral do dono

Como serve ao objetivo: a primeira tela do dia responde "quanto entra e sai".

- **Fazer:** cartões Total a receber e Total a pagar com Hoje, Amanhã, Semana e Mês; saldo das contas; selo de período nos cartões; ajuda em ícone nos títulos; percentual do lucro tratado quando as vendas são zero; lucro do mês já descontando o custo fixo (depois da Onda 8). `meta.tsx` ganha contribuição marginal e ranking ABC.
- **Conferir:** teste do cálculo de percentual com vendas 0, valor mínimo e valor normal.

### Onda 5: Painel de Negociação (orçamentos)

Como serve ao objetivo: o vendedor enxerga o funil de uma vez, com dinheiro por coluna.

- **Fazer:** quadro com colunas por estado (rascunho, enviado, aprovado, convertido, rejeitado, expirado), cada uma com total e contagem, alternando com a lista. Sem arrastar: aprovar e converter têm travas e continuam por botão. Expirar por validade (hoje não existe).
- **Corrigir antes:** o funil vazio. `funil_comercial` exclui `temporario=true` e 26 de 26 estão marcados; decisão do dono entre incluir temporários ou limpar a marca na conversão.
- **Conferir:** ensaio com rollback da função; total do quadro igual ao da lista.

### Onda 6: Atendimento no WhatsApp

- **Fazer:** lista de conversas ao lado da conversa com chips Tudo, Agente e Status (Tag depois, se o dono quiser etiquetas). Arquivos: `whatsapp-fila-humana.tsx`, `src/components/whatsapp/lista-de-conversas.tsx`.

### Onda 7: Produção

Como serve ao objetivo: o operador vê o que está rodando, o que atrasa e o que deu problema.

- **7a (barata):** total em R$ e contagem por coluna no `kanban.tsx`, alternância lista e quadro.
- **7b:** tela do operador por máquina com Em breve (reserva futura), Aguardando (reserva vencida sem início), Produzindo (apontamento aberto), Finalizados e Problemas (atraso ou ocorrência), mais a faixa de horas.
- **7c:** linha do tempo por máquina com a marca do agora, em cima de `maquinas_agenda`.
- **Decisão do dono:** o Holdprint trabalha por processo de cada JOB. Nós não temos roteiro de várias etapas por produto. Só criamos esse modelo se o dono quiser.

### Onda 8: regras do dinheiro (com migração)

Como serve ao objetivo: fecha o buraco que o teste mostrou, compra sem conta a pagar e despesa sem categoria útil.

- **8a:** plano de contas e centro de custo com rateio que precisa fechar no valor; semear as contas de gráfica adaptadas.
- **8b:** compra passa a gerar as parcelas de conta a pagar pela condição escolhida (`registrar_compra_fornecedor` e `receber_pedido_compra` hoje não tocam `contas_pagar`).
- **8c:** liquidar completo: data e conta bancária obrigatórias, motivo da diferença, comprovante, status agendado.
- **8d (depois):** cartão de crédito e conciliação lado a lado.
- **Cuidados do projeto:** prefixo de migração de 14 dígitos único, ensaio com rollback, varredura em dois fusos.

### Onda 9: hora por centro

- **Fazer:** centros de custo com horas produtivas, pessoas, despesas, depreciação e repasse; a hora da máquina deixa de ser digitada.
- **Decisão do dono:** horas produtivas por centro (hoje 160 por máquina e 176 por pessoa), encargo (hoje 32,19% do Simples; o Holdprint vem com 45%), e quem entra no repasse. Com os mesmos valores, a hora de máquina deu valores bem diferentes nos dois sistemas só pela escolha do número de horas.

### Onda 10: agenda única

- **Fazer:** calendário com vencimentos a pagar e a receber, entregas e reservas de máquina, cada um ligável por calendário.

## Fora do plano agora

Insider AI (conversa com os dados), PDV (venda de balcão, sem tela vista), portal do cliente deles, NF-e e boleto, central de estoque com vários depósitos.

## O que o teste mostrou do nosso lado (para corrigir, independente do visual)

- Funil comercial vazio por causa do marcador de lead temporário (Onda 5).
- `tipo_cliente` desatualizado (18 pessoas físicas constam como jurídicas) e `cliente_contatos` com 0 registros.
- Compra no fornecedor não gera conta a pagar nem movimento de caixa (Onda 8b).
- Das 6 contas a pagar pagas, 0 têm comprovante e 3 não têm data de pagamento.
- `vw_fluxo_caixa` pode contar o mesmo Pix duas vezes.
- Chaveiro de 500 unidades: a reserva previu 500 minutos e o apontamento real foi de 97.

## Decisões que preciso do dono

1. Menu em coluna única como o do Holdprint, ou manter o trilho de ícones.
2. Ação principal: verde-água com letra azul-marinho (recomendado) ou verde mais escuro com letra branca.
3. Funil: leads temporários entram ou não.
4. Horas produtivas e encargo para o custo da hora.
5. Se quer o modelo de processos por JOB na produção.
